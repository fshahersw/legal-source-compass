"""CDC PLACES county estimates (2025 release, BRFSS 2023) for the conditions linked to MDLs in mdl_exposure_map.json.

Reads <acq>/cdc/places_county_2025_selected.csv, a single Socrata export of dataset swc5-untb filtered to the measures
named in the mapping, and writes the dry-run packet exposure_places_county: one record per county (5-digit FIPS) and
one for the United States.

Each measure keeps the published crude and age-adjusted prevalence with its 95% confidence interval. A county or measure
CDC did not publish (Kentucky and Pennsylvania have no 2023 BRFSS-based estimates in this release) has no value; it is
never filled from a neighbour or the state. Estimates are model-based small-area estimates, not counts of patients.

Usage: python -B build_places.py [--acq <dir>]
"""
from __future__ import annotations

import argparse
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exposure_common as X  # noqa: E402

DATASET = "exposure_places_county"
LABEL = "CDC PLACES county health estimates for MDL-linked conditions"
SOCRATA_ID = "swc5-untb"
LANDING = "https://data.cdc.gov/d/swc5-untb"
EXPORT = "https://data.cdc.gov/resource/swc5-untb.csv"
PUBLISHER = "Centers for Disease Control and Prevention"
RELEASE = "2025"
TYPE_KEY = {"CrdPrv": "crude", "AgeAdjPrv": "age_adjusted"}


def measures_from_map(mapping: dict) -> list[str]:
    return sorted({m["measure"] for m in mapping["places"]})


def interval(row: dict) -> dict:
    return {"v": X.num(row.get("data_value")), "lo": X.num(row.get("low_confidence_limit")), "hi": X.num(row.get("high_confidence_limit"))}


def collect(rows, wanted: set[str]) -> dict[str, dict]:
    """locationid -> county record body. Rows for other measures or value types are ignored."""
    out: dict[str, dict] = {}
    for row in rows:
        mid = row.get("measureid", "")
        kind = TYPE_KEY.get(row.get("datavaluetypeid", ""))
        if mid not in wanted or not kind:
            continue
        loc = (row.get("locationid") or "").strip()
        usps = (row.get("stateabbr") or "").strip()
        national = usps == "US"
        if not national and (len(loc) != 5 or not loc.isdigit()):
            continue
        key = "US" if national else loc
        body = out.setdefault(key, {
            "fips": None if national else loc,
            "usps": usps,
            "state_name": row.get("statedesc") or "",
            "county": None if national else (row.get("locationname") or ""),
            "population": X.num(row.get("totalpopulation")),
            "adult_population": X.num(row.get("totalpop18plus")),
            "measures": {},
        })
        m = body["measures"].setdefault(mid, {
            "label": row.get("measure") or mid,
            "category": row.get("category") or "",
            "year": row.get("year") or "",
            "source": row.get("datasource") or "",
            "unit": row.get("data_value_unit") or "%",
        })
        m[kind] = interval(row)
        note = (row.get("data_value_footnote") or "").strip()
        if note:
            m.setdefault("footnotes", {})[kind] = note
    return out


def links_for(mapping: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for m in mapping["places"]:
        if m["basis"] == "candidate_unreviewed":
            continue
        out.setdefault(m["measure"], []).append({
            "mdls": m["mdls"], "basis": m["basis"], "relation": m["relation"],
            "source_label": m["source_label"], "source_url": m["source_url"], "caveat": m.get("caveat"),
            "sources": [{"label": m["source_label"], "url": m["source_url"]}, *m.get("more_sources", [])],
        })
    return out


def build_records(bodies: dict[str, dict], mapping: dict) -> list[dict]:
    links = links_for(mapping)
    rows = []
    for key in sorted(bodies, key=lambda k: (k != "US", k)):
        b = bodies[key]
        name = "United States" if key == "US" else f"{b['county']}, {b['state_name']}"
        exposure = {
            "kind": "places_county",
            "release": RELEASE,
            "publisher": PUBLISHER,
            **b,
            "mdl_links": {mid: links.get(mid, []) for mid in sorted(b["measures"])},
            "sources": [{"label": f"PLACES county data, {RELEASE} release", "url": LANDING}],
        }
        cells = {"county": name, "fips": b["fips"] or "US"}
        for mid, m in sorted(b["measures"].items()):
            cells[mid.lower()] = (m.get("crude") or {}).get("v")
        facts = [{"label": "Geography", "value": name}, {"label": "Release", "value": f"PLACES {RELEASE} (BRFSS 2023 model-based estimates)"}]
        for mid, m in sorted(b["measures"].items()):
            crude = m.get("crude") or {}
            value = "Not recorded" if crude.get("v") is None else f"{crude['v']}% (95% CI {crude.get('lo')}-{crude.get('hi')})"
            facts.append({"label": m["label"], "value": value})
        rows.append(X.record(
            DATASET, f"places:{key}", name,
            source_url=LANDING,
            subtitle=f"{PUBLISHER}, PLACES county data, {RELEASE} release",
            cells=cells,
            facts=facts,
            text=name,
            filters={"state": [b["usps"]], "geo_level": ["national" if key == "US" else "county"]},
            state="" if key == "US" else b["usps"],
            links=[{"label": "CDC PLACES dataset", "url": LANDING}],
            extra={"exposure": exposure},
        ))
        # every row carries the column so a bulk insert keeps it (PostgREST takes columns from the first row)
        rows[-1]["county_geoids"] = [] if key == "US" else [key]
    return rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=X.DEFAULT_ACQ)
    args = ap.parse_args(argv)
    mapping = X.load_map()
    wanted = set(measures_from_map(mapping))
    path = os.path.join(args.acq, "cdc", "places_county_2025_selected.csv")
    with open(path, newline="", encoding="utf-8") as fh:
        bodies = collect(csv.DictReader(fh), wanted)
    records = build_records(bodies, mapping)
    states = sorted({b["usps"] for b in bodies.values() if b["usps"] != "US"})
    summary = {
        "publisher": PUBLISHER,
        "source_url": LANDING,
        "export_url": EXPORT,
        "socrata_id": SOCRATA_ID,
        "release": RELEASE,
        "measures": sorted(wanted),
        "counties": sum(1 for k in bodies if k != "US"),
        "states_present": states,
        "states_absent": sorted(set(X.USPS_NAME) - set(states) - {"AS", "GU", "MP", "VI", "PR"}),
        "mapping": "scripts/enrichment/exposure_geo/mdl_exposure_map.json",
        "licence": "U.S. government work (public domain)",
        "caveats": [
            "Model-based small-area estimates from BRFSS 2023 and Census population data, not counts of patients.",
            "A measure linked to an MDL describes a treated or injured population, never plaintiffs.",
        ],
    }
    block = X.listing([("county", "County"), ("fips", "FIPS")] + [(m.lower(), m) for m in sorted(wanted)])
    out = X.write_packet(args.acq, DATASET, LABEL, records, listing_block=block, summary=summary)
    print(f"{DATASET}: {len(records)} records ({summary['counties']} counties) -> {out}")
    print(f"states absent: {summary['states_absent']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
