"""EPA UCMR 5 PFAS occurrence in public drinking water, the exposure geography for the AFFF MDL (2873).

Reads the EPA occurrence zip already acquired (<acq>/epa/ucmr5-occurrence-data.zip: UCMR5_All.txt, UCMR5_ZIPCodes.txt,
UCMR5_AddtlDataElem.txt) and the SDWIS water-system tables (<acq>/epa/sdwis/water_system_<agency>_<type>.csv, only
pwsid, type and population served are read; contact fields are never kept). Writes two dry-run packets:

- exposure_ucmr5_pfas_systems: one record per public water system (PWSID) sampled for the 29 UCMR 5 PFAS.
- exposure_ucmr5_pfas_states: one record per state, territory or tribal primacy agency as EPA codes it, plus the nation.

Rules:
- PFAS only; lithium (also in UCMR 5) is left out.
- A detection is a result EPA reports with sign "=" (at or above the minimum reporting level). "<" results are
  non-detects and are never turned into zero concentrations.
- "At or above 4.0 ng/L" compares single results with the value of the 2024 PFOA and PFOS MCLs. It is not a compliance
  finding: compliance uses running annual averages.
- Population served comes from SDWIS by exact PWSID; a system SDWIS does not list has none (never estimated).
- Water systems link to places only through the ZIP codes EPA publishes for them; there is no county link.

Usage: python -B build_ucmr5.py [--acq <dir>]
"""
from __future__ import annotations

import argparse
import csv
import glob
import io
import os
import sys
import zipfile
from decimal import Decimal, InvalidOperation

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exposure_common as X  # noqa: E402

SYSTEMS = "exposure_ucmr5_pfas_systems"
STATES = "exposure_ucmr5_pfas_states"
LANDING = "https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule"
ZIP_URL = "https://www.epa.gov/system/files/other-files/2023-08/ucmr5-occurrence-data.zip"
SDWIS_URL = "https://data.epa.gov/efservice/WATER_SYSTEM"
PUBLISHER = "U.S. Environmental Protection Agency"
NOT_PFAS = {"lithium"}
MCL_COMPARE = {"PFOA", "PFOS"}
THRESHOLD_NGL = Decimal("4.0")
SIZE = {"L": "Large (more than 10,000 people)", "S": "Small (10,000 or fewer)"}
TRIBAL = {f"{n:02d}": f"Tribal systems, EPA Region {n}" for n in range(1, 11)}
TRIBAL["NN"] = "Navajo Nation"


def agency_name(code: str) -> str:
    if code in X.USPS_NAME:
        return X.USPS_NAME[code]
    return TRIBAL.get(code, code)


def ngl(raw: str) -> Decimal | None:
    """µg/L as published -> ng/L, exactly (Decimal), or None when blank."""
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return Decimal(text) * 1000
    except InvalidOperation:
        return None


def iso(date: str) -> str | None:
    parts = (date or "").strip().split("/")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    m, d, y = parts
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


def fnum(d: Decimal | None):
    if d is None:
        return None
    d = d.normalize()
    return int(d) if d == d.to_integral_value() else float(d)


def aggregate(results) -> dict[str, dict]:
    """PWSID -> system body from UCMR5_All rows."""
    systems: dict[str, dict] = {}
    for r in results:
        contaminant = (r.get("Contaminant") or "").strip()
        if not contaminant or contaminant in NOT_PFAS:
            continue
        pwsid = (r.get("PWSID") or "").strip()
        if not pwsid:
            continue
        s = systems.setdefault(pwsid, {
            "pwsid": pwsid, "name": (r.get("PWSName") or "").strip(), "agency": (r.get("State") or "").strip(),
            "size": (r.get("Size") or "").strip(), "samples": set(), "first": None, "last": None, "analytes": {},
        })
        s["samples"].add((r.get("SampleID") or "").strip())
        day = iso(r.get("CollectionDate") or "")
        if day:
            s["first"] = day if s["first"] is None or day < s["first"] else s["first"]
            s["last"] = day if s["last"] is None or day > s["last"] else s["last"]
        a = s["analytes"].setdefault(contaminant, {"results": 0, "detects": 0, "max_ngl": None, "mrl_ngl": ngl(r.get("MRL") or "")})
        a["results"] += 1
        if (r.get("AnalyticalResultsSign") or "").strip() == "=":
            value = ngl(r.get("AnalyticalResultValue") or "")
            if value is not None:
                a["detects"] += 1
                a["max_ngl"] = value if a["max_ngl"] is None or value > a["max_ngl"] else a["max_ngl"]
    return systems


def zip_codes(rows) -> dict[str, list[str]]:
    out: dict[str, set[str]] = {}
    for r in rows:
        pwsid, z = (r.get("PWSID") or "").strip(), (r.get("ZIPCODE") or "").strip()
        if pwsid and z:
            out.setdefault(pwsid, set()).add(z)
    return {k: sorted(v) for k, v in out.items()}


def reported_sources(rows) -> dict[str, str]:
    """PWSID -> 'Yes' if any sample point reported potential PFAS sources, else the most informative answer given."""
    rank = {"Yes": 3, "No": 2, "DK": 1}
    out: dict[str, str] = {}
    for r in rows:
        if (r.get("AdditionalDataElement") or "").strip() != "PotentialPFASSources":
            continue
        pwsid, answer = (r.get("PWSID") or "").strip(), (r.get("Response") or "").strip()
        if answer in rank and rank[answer] > rank.get(out.get(pwsid, ""), 0):
            out[pwsid] = answer
    return out


def sdwis_population(paths) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for path in paths:
        with open(path, newline="", encoding="utf-8", errors="replace") as fh:
            for r in csv.DictReader(fh):
                pwsid = (r.get("pwsid") or "").strip()
                if pwsid:
                    out[pwsid] = {"population": X.num(r.get("population_served_count")), "type": (r.get("pws_type_code") or "").strip(), "activity": (r.get("pws_activity_code") or "").strip()}
    return out


def system_view(s: dict, zips: dict, sources: dict, sdwis: dict) -> dict:
    analytes = []
    for name, a in sorted(s["analytes"].items()):
        analytes.append({"analyte": name, "results": a["results"], "detects": a["detects"], "max_ngl": fnum(a["max_ngl"]), "mrl_ngl": fnum(a["mrl_ngl"])})
    detected = [a for a in analytes if a["detects"] > 0]
    def mx(code):
        hit = s["analytes"].get(code)
        return hit["max_ngl"] if hit else None
    over = sorted(code for code in MCL_COMPARE if (mx(code) or Decimal(0)) >= THRESHOLD_NGL)
    meta = sdwis.get(s["pwsid"])
    return {
        "kind": "ucmr5_system",
        "pwsid": s["pwsid"],
        "name": s["name"],
        "agency": s["agency"],
        "agency_name": agency_name(s["agency"]),
        "size": s["size"],
        "size_label": SIZE.get(s["size"], s["size"] or None),
        "samples": len(s["samples"] - {""}),
        "first_sample": s["first"],
        "last_sample": s["last"],
        "analytes_tested": len(analytes),
        "analytes_detected": len(detected),
        "any_detect": bool(detected),
        "pfoa_max_ngl": fnum(mx("PFOA")),
        "pfos_max_ngl": fnum(mx("PFOS")),
        "pfoa_pfos_at_or_above_4": over,
        "analytes": analytes,
        "zip_codes": zips.get(s["pwsid"], []),
        "potential_sources_reported": sources.get(s["pwsid"]),
        "population_served": meta["population"] if meta else None,
        "sdwis_type": meta["type"] if meta else None,
        "unit": "ng/L (parts per trillion)",
    }


def state_view(code: str, systems: list[dict]) -> dict:
    def pop(rows):
        known = [r["population_served"] for r in rows if r["population_served"] is not None]
        return {"sum": sum(known) if known else None, "systems_with_population": len(known), "systems_without_population": len(rows) - len(known)}
    detect = [s for s in systems if s["any_detect"]]
    over = [s for s in systems if s["pfoa_pfos_at_or_above_4"]]
    by_analyte: dict[str, int] = {}
    for s in systems:
        for a in s["analytes"]:
            if a["detects"]:
                by_analyte[a["analyte"]] = by_analyte.get(a["analyte"], 0) + 1
    firsts = [s["first_sample"] for s in systems if s["first_sample"]]
    lasts = [s["last_sample"] for s in systems if s["last_sample"]]
    top = sorted(detect, key=lambda s: (-(s["analytes_detected"]), -(s["pfoa_max_ngl"] or 0) - (s["pfos_max_ngl"] or 0), s["pwsid"]))[:10]
    return {
        "kind": "ucmr5_state",
        "agency": code,
        "agency_name": "United States" if code == "US" else agency_name(code),
        "systems_sampled": len(systems),
        "systems_with_detect": len(detect),
        "systems_pfoa_pfos_at_or_above_4": len(over),
        "population_sampled": pop(systems),
        "population_with_detect": pop(detect),
        "population_pfoa_pfos_at_or_above_4": pop(over),
        "systems_by_size": {k: sum(1 for s in systems if s["size"] == k) for k in ("L", "S")},
        "systems_detecting_by_analyte": dict(sorted(by_analyte.items(), key=lambda kv: (-kv[1], kv[0]))),
        "first_sample": min(firsts) if firsts else None,
        "last_sample": max(lasts) if lasts else None,
        "top_systems": [{"pwsid": s["pwsid"], "name": s["name"], "analytes_detected": s["analytes_detected"], "pfoa_max_ngl": s["pfoa_max_ngl"], "pfos_max_ngl": s["pfos_max_ngl"], "population_served": s["population_served"]} for s in top],
        "threshold_note": "Single results compared with 4.0 ng/L, the value of the 2024 PFOA and PFOS MCLs; not a compliance finding.",
        "unit": "ng/L (parts per trillion)",
    }


def system_records(views: list[dict], mdl: dict) -> list[dict]:
    rows = []
    for v in sorted(views, key=lambda v: (v["agency"], v["pwsid"])):
        state = v["agency"] if v["agency"] in X.USPS_NAME else ""
        facts = [
            {"label": "Water system ID", "value": v["pwsid"]},
            {"label": "Primacy agency", "value": v["agency_name"]},
            {"label": "PFAS detected", "value": f"{v['analytes_detected']} of {v['analytes_tested']} tested"},
            {"label": "PFOA, highest result", "value": "Not detected" if v["pfoa_max_ngl"] is None else f"{v['pfoa_max_ngl']} ng/L"},
            {"label": "PFOS, highest result", "value": "Not detected" if v["pfos_max_ngl"] is None else f"{v['pfos_max_ngl']} ng/L"},
            {"label": "Population served (SDWIS)", "value": "Not recorded" if v["population_served"] is None else f"{v['population_served']:,}"},
        ]
        rows.append(X.record(
            SYSTEMS, f"ucmr5:pws:{v['pwsid']}", v["name"] or v["pwsid"],
            source_url=LANDING,
            subtitle=f"{PUBLISHER}, UCMR 5 occurrence data; {v['agency_name']}",
            cells={"pwsid": v["pwsid"], "agency": v["agency"], "detected": v["analytes_detected"], "pfoa_max_ngl": v["pfoa_max_ngl"], "pfos_max_ngl": v["pfos_max_ngl"], "population_served": v["population_served"]},
            facts=facts,
            text=" ".join([v["pwsid"], v["name"], v["agency_name"], *v["zip_codes"]]),
            filters={"state": [v["agency"]], "detected": ["yes" if v["any_detect"] else "no"], "size": [v["size"] or "unknown"]},
            state=state,
            links=[{"label": "EPA UCMR occurrence data", "url": LANDING}],
            extra={"exposure": {**v, "mdl": mdl["mdl"], "mdl_relation": mdl["relation"], "publisher": PUBLISHER, "sources": [{"label": "UCMR 5 occurrence data (zip)", "url": ZIP_URL}, {"label": "SDWIS water system (population served)", "url": SDWIS_URL}]}},
        ))
    return rows


def state_records(views: list[dict], mdl: dict) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for v in views:
        groups.setdefault(v["agency"], []).append(v)
    bodies = [state_view("US", views)] + [state_view(code, rows) for code, rows in sorted(groups.items())]
    rows = []
    for b in bodies:
        code = b["agency"]
        facts = [
            {"label": "Water systems sampled", "value": f"{b['systems_sampled']:,}"},
            {"label": "Systems with any PFAS detected", "value": f"{b['systems_with_detect']:,}"},
            {"label": "Systems with a PFOA or PFOS result at or above 4.0 ng/L", "value": f"{b['systems_pfoa_pfos_at_or_above_4']:,}"},
        ]
        rows.append(X.record(
            STATES, f"ucmr5:state:{code}", f"PFAS in drinking water (UCMR 5), {b['agency_name']}",
            source_url=LANDING,
            subtitle=f"{PUBLISHER}, UCMR 5 occurrence data",
            cells={"agency": b["agency_name"], "systems": b["systems_sampled"], "with_detect": b["systems_with_detect"], "pfoa_pfos_ge_4": b["systems_pfoa_pfos_at_or_above_4"]},
            facts=facts,
            text=b["agency_name"],
            filters={"state": [code], "geo_level": ["national" if code == "US" else ("state" if code in X.USPS_NAME else "tribal")]},
            state=code if code in X.USPS_NAME else "",
            links=[{"label": "EPA UCMR occurrence data", "url": LANDING}],
            extra={"exposure": {**b, "mdl": mdl["mdl"], "mdl_title": mdl["mdl_title"], "mdl_relation": mdl["relation"], "publisher": PUBLISHER, "sources": [{"label": "UCMR 5 occurrence data (zip)", "url": ZIP_URL}, {"label": "SDWIS water system (population served)", "url": SDWIS_URL}]}},
        ))
    return rows


def _tsv(zf: zipfile.ZipFile, name: str):
    with zf.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline=""), delimiter="\t")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=X.DEFAULT_ACQ)
    args = ap.parse_args(argv)
    mapping = X.load_map()
    mdl = mapping["ucmr5"]
    epa = os.path.join(args.acq, "epa")
    with zipfile.ZipFile(os.path.join(epa, "ucmr5-occurrence-data.zip")) as zf:
        stamps = {i.filename: "%04d-%02d-%02d" % i.date_time[:3] for i in zf.infolist()}
        systems = aggregate(_tsv(zf, "UCMR5_All.txt"))
        zips = zip_codes(_tsv(zf, "UCMR5_ZIPCodes.txt"))
        sources = reported_sources(_tsv(zf, "UCMR5_AddtlDataElem.txt"))
    sdwis_files = sorted(glob.glob(os.path.join(epa, "sdwis", "water_system_*_*.csv")))
    sdwis = sdwis_population(sdwis_files)
    views = [system_view(s, zips, sources, sdwis) for s in systems.values()]
    sys_rows = system_records(views, mdl)
    st_rows = state_records(views, mdl)
    matched = sum(1 for v in views if v["population_served"] is not None)
    common = {
        "publisher": PUBLISHER,
        "source_url": LANDING,
        "zip_url": ZIP_URL,
        "zip_file_dates": stamps,
        "sdwis_url": SDWIS_URL,
        "sdwis_files": len(sdwis_files),
        "systems": len(views),
        "systems_with_sdwis_population": matched,
        "mdl": mdl["mdl"],
        "licence": "U.S. government work (public domain)",
        "caveats": [
            "Occurrence only: UCMR 5 does not identify the source of PFAS, and a detection is not evidence of AFFF.",
            "Single results compared with 4.0 ng/L are not MCL compliance findings.",
            "Lithium is left out.",
            "Population served is from SDWIS by exact PWSID and is missing where SDWIS has no row.",
        ],
    }
    out1 = X.write_packet(args.acq, SYSTEMS, "PFAS in drinking water by water system (EPA UCMR 5)", sys_rows,
                          listing_block=X.listing([("pwsid", "PWSID"), ("agency", "State"), ("detected", "PFAS detected"), ("pfoa_max_ngl", "PFOA max ng/L"), ("pfos_max_ngl", "PFOS max ng/L"), ("population_served", "Population served")]),
                          summary=common)
    out2 = X.write_packet(args.acq, STATES, "PFAS in drinking water by state (EPA UCMR 5)", st_rows,
                          listing_block=X.listing([("agency", "State or agency"), ("systems", "Systems sampled"), ("with_detect", "With PFAS detected"), ("pfoa_pfos_ge_4", "PFOA/PFOS at or above 4 ng/L")]),
                          summary=common)
    print(f"{SYSTEMS}: {len(sys_rows)} records -> {out1}")
    print(f"{STATES}: {len(st_rows)} records -> {out2}")
    print(f"SDWIS population matched for {matched} of {len(views)} systems from {len(sdwis_files)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
