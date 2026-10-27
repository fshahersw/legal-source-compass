"""CMS Medicare Part D Prescribers - by Geography and Drug, for the drugs named in products-liability MDL titles.

Reads the annual CSVs already acquired (one download per data year) from <acq>/cms/raw/partd_geo_DY<year>.csv and the
reviewed mapping in mdl_exposure_map.json, and writes the dry-run packet exposure_partd_mdl_drugs: one record per MDL
and geography (each state, DC, Puerto Rico, territory, and the nation) with a 2013-2024 series.

Rules:
- A row joins an MDL only when its Gnrc_Name (scope "ingredient") or Brnd_Name (scope "brand") equals a string listed
  for that MDL in the mapping file. No similarity matching.
- Claims, 30-day fills and drug cost add up across products. Prescribers and beneficiaries do not (one person can use
  two products), so a group value is published only when a single product row exists; otherwise it is None and the
  per-product values are kept.
- CMS publishes a geography-drug row only when it has at least 11 claims, and hides beneficiary counts under 11. A
  product the national row lists but a state row lacks therefore had 0 to 10 claims there: the state total is published
  as the interval [claims, claims_max], claims_max = claims + 10 x missing products. Nothing inside it is guessed.
- States are ranked on those intervals (50 states and DC, a state with no row counts as [0, 10 x products]); a rank is a
  range when the intervals overlap. A missing state-year stays missing in the series.
- The geography is the prescriber's state, not where the patient lives.

Usage: python -B build_partd.py [--acq <dir>]
"""
from __future__ import annotations

import argparse
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exposure_common as X  # noqa: E402

DATASET = "exposure_partd_mdl_drugs"
LABEL = "Medicare Part D prescriptions for MDL drugs, by state"
LANDING = "https://data.cms.gov/provider-summary-by-type-of-service/medicare-part-d-prescribers/medicare-part-d-prescribers-by-geography-and-drug"
PUBLISHER = "Centers for Medicare & Medicaid Services"
# CMS leaves out geography-drug rows with fewer than 11 claims, so a hidden product had at most this many claims.
HIDDEN_MAX_CLAIMS = 10
# data year -> CSV download (data.cms.gov catalog, read 2026-10-27)
SOURCES = {
    2013: "https://data.cms.gov/sites/default/files/2021-08/MUP_DPR_RY21_P04_V10_DY13_Geo_0.csv",
    2014: "https://data.cms.gov/sites/default/files/2021-08/MUP_DPR_RY21_P04_V10_DY14_Geo_0.csv",
    2015: "https://data.cms.gov/sites/default/files/2021-08/MUP_DPR_RY21_P04_V10_DY15_Geo_0.csv",
    2016: "https://data.cms.gov/sites/default/files/2021-08/MUP_DPR_RY21_P04_V10_DY16_Geo_0.csv",
    2017: "https://data.cms.gov/sites/default/files/2024-02/efe83dea-bdce-457f-b8b3-fe3b8e9e0c33/MUP_DPR_RY21_P04_V10_DY17_Geo.csv",
    2018: "https://data.cms.gov/sites/default/files/2021-08/MUP_DPR_RY21_P04_V10_DY18_Geo.csv",
    2019: "https://data.cms.gov/sites/default/files/2021-08/MUP_DPR_RY21_P04_V10_DY19_Geo.csv",
    2020: "https://data.cms.gov/sites/default/files/2022-07/ca71b7df-4d48-4c2d-aded-2ca22285739c/MUP_DPR_RY22_P04_V10_DY20_Geo.csv",
    2021: "https://data.cms.gov/sites/default/files/2023-04/3d3ebd5b-b4bf-45b4-876d-afa7916d1b72/MUP_DPR_RY23_P04_V10_DY21_Geo.csv",
    2022: "https://data.cms.gov/sites/default/files/2024-05/410ed206-d782-4dba-b442-6bcd45ae2016/MUP_DPR_RY24_P04_V10_DY22_Geo.csv",
    2023: "https://data.cms.gov/sites/default/files/2025-04/9fe6b8a6-0cb9-4b7c-9760-87800da010a8/MUP_DPR_RY25_P04_V10_DY23_Geo.csv",
    2024: "https://data.cms.gov/sites/default/files/2026-05/3e80b44e-5a87-4414-959a-b6a7c8c18720/MUP_DPR_RY26_P04_V10_DY24_Geo.csv",
}


def matchers(mapping: dict) -> list[dict]:
    """Included Part D entries with exact-match sets."""
    out = []
    for entry in mapping["partd"]:
        if not entry.get("include"):
            continue
        out.append({
            **entry,
            "_generic": set(entry["generic_names"]),
            "_brand": set(entry.get("brand_names") or []),
            "_exclude": set(entry.get("exclude_brands") or []),
        })
    return out


def row_matches(entry: dict, generic: str, brand: str) -> bool:
    if generic not in entry["_generic"]:
        return False
    if entry["scope"] == "brand":
        return brand in entry["_brand"]
    return brand not in entry["_exclude"]


def geo_of(row: dict) -> dict | None:
    """National or a state/territory with an exact FIPS code; other codes (armed forces, unknown, foreign) are skipped."""
    level = row.get("Prscrbr_Geo_Lvl", "")
    if level == "National":
        return {"level": "national", "fips": None, "usps": "US", "name": "United States"}
    if level == "State":
        code = (row.get("Prscrbr_Geo_Cd") or "").strip()
        hit = X.STATE_FIPS.get(code)
        if hit:
            return {"level": "state", "fips": code, "usps": hit[0], "name": hit[1]}
    return None


def product(row: dict) -> dict:
    return {
        "brand": row["Brnd_Name"],
        "generic": row["Gnrc_Name"],
        "prescribers": X.num(row.get("Tot_Prscrbrs")),
        "claims": X.num(row.get("Tot_Clms")),
        "fills": X.num(row.get("Tot_30day_Fills")),
        "cost": X.num(row.get("Tot_Drug_Cst")),
        "benes": X.num(row.get("Tot_Benes")),
    }


def _sum(values):
    vals = [v for v in values if v is not None]
    if len(vals) != len(values) or not vals:
        return None  # one product's figure is missing, so the total is not known
    total = sum(vals)
    return round(total, 2) if isinstance(total, float) else total


def year_point(year: int, products: list[dict], national_keys: set[tuple[str, str]] | None = None) -> dict:
    """One year for one geography. `national_keys` are the products the national row lists that year: a product missing
    here was hidden by CMS (fewer than 11 claims) or not prescribed, so the true total lies in [claims, claims_max]."""
    products = sorted(products, key=lambda p: (p["generic"], p["brand"]))
    present = {(p["generic"], p["brand"]) for p in products}
    missing = sorted(f"{b} ({g})" for g, b in (national_keys or set()) - present)
    single = products[0] if len(products) == 1 and not missing else None
    claims = _sum([p["claims"] for p in products])
    return {
        "year": year,
        "claims": claims,
        "claims_max": None if claims is None else claims + HIDDEN_MAX_CLAIMS * len(missing),
        "fills": _sum([p["fills"] for p in products]),
        "cost": _sum([p["cost"] for p in products]),
        "prescribers": single["prescribers"] if single else None,
        "benes": single["benes"] if single else None,
        "lower_bound": bool(missing),
        "missing_products": missing,
        "products": products,
    }


def collect(rows_by_year: dict[int, list[dict]], entries: list[dict]) -> tuple[dict, dict]:
    """(mdl, usps) -> {"geo": ..., "years": {year: [products]}} plus counters of skipped geographies."""
    groups: dict[tuple[str, str], dict] = {}
    skipped: dict[str, int] = {}
    for year, rows in sorted(rows_by_year.items()):
        for row in rows:
            generic, brand = row.get("Gnrc_Name", ""), row.get("Brnd_Name", "")
            hits = [e for e in entries if row_matches(e, generic, brand)]
            if not hits:
                continue
            geo = geo_of(row)
            if geo is None:
                key = f'{row.get("Prscrbr_Geo_Lvl")}:{row.get("Prscrbr_Geo_Cd") or ""}:{row.get("Prscrbr_Geo_Desc") or ""}'
                skipped[key] = skipped.get(key, 0) + 1
                continue
            for entry in hits:
                g = groups.setdefault((entry["mdl"], geo["usps"]), {"entry": entry, "geo": geo, "years": {}})
                g["years"].setdefault(year, []).append(product(row))
    return groups, skipped


def build_records(groups: dict, years: list[int]) -> list[dict]:
    rows = []
    national: dict[tuple[str, int], set[tuple[str, str]]] = {}
    for (mdl, usps), g in groups.items():
        if usps == "US":
            for y, products in g["years"].items():
                national[(mdl, y)] = {(p["generic"], p["brand"]) for p in products}
    for (mdl, usps), g in sorted(groups.items(), key=lambda kv: (int(kv[0][0]), kv[0][1] != "US", kv[0][1])):
        entry, geo = g["entry"], g["geo"]
        series = [
            year_point(y, g["years"][y], None if usps == "US" else national.get((mdl, y), set()))
            for y in years
            if y in g["years"]
        ]
        latest = series[-1] if series else None
        rid = f"partd:{mdl}:{usps}"
        title = f"MDL {mdl} drugs in Medicare Part D, {geo['name']}"
        exposure = {
            "kind": "partd_mdl_drug",
            "mdl": mdl,
            "mdl_title": entry["mdl_title"],
            "basis": entry["basis"],
            "scope": entry["scope"],
            "generic_names": entry["generic_names"],
            "brand_names": entry.get("brand_names") or [],
            "class_name": entry.get("class_name"),
            "class_source_url": entry.get("class_source_url"),
            "note": entry.get("note"),
            "geo": geo,
            "years_published": years,
            "series": series,
            "unit": {"claims": "prescription fills incl. refills", "fills": "standardized 30-day fills", "cost": "US dollars, gross drug cost"},
            "publisher": PUBLISHER,
            "sources": [{"year": y, "url": SOURCES[y]} for y in years if y in SOURCES],
        }
        cells = {
            "mdl": mdl,
            "geography": geo["name"],
            "latest_year": latest["year"] if latest else None,
            "claims": latest["claims"] if latest else None,
            "fills": latest["fills"] if latest else None,
        }
        facts = [
            {"label": "MDL", "value": f"{mdl}: {entry['mdl_title']}"},
            {"label": "Prescriber geography", "value": geo["name"]},
            {"label": "Drugs matched", "value": ", ".join(entry.get("brand_names") or entry["generic_names"])},
            {"label": "Latest data year", "value": str(latest["year"]) if latest else "Not recorded"},
            {"label": "Claims, latest year", "value": "Not recorded" if not latest or latest["claims"] is None else (f"{latest['claims']:,} to {latest['claims_max']:,} (CMS hides products with fewer than 11 claims)" if latest["lower_bound"] else f"{latest['claims']:,}")},
        ]
        rows.append(X.record(
            DATASET, rid, title,
            source_url=LANDING,
            subtitle=f"{PUBLISHER}, Part D Prescribers by Geography and Drug, {years[0]}-{years[-1]}",
            cells=cells,
            facts=facts,
            text=" ".join([entry["mdl_title"], *entry["generic_names"], *(entry.get("brand_names") or [])]),
            filters={"mdl": [mdl], "geo_level": [geo["level"]], "state": [usps]},
            state="" if usps == "US" else usps,
            links=[{"label": "CMS dataset", "url": LANDING}],
            extra={"exposure": exposure},
        ))
    add_ranks(rows)
    return rows


RANKED_STATES = frozenset(usps for usps, _ in X.STATE_FIPS.values()) - {"AS", "GU", "MP", "PR", "VI"}


def rank_intervals(intervals: dict[str, tuple[int, int]]) -> dict[str, tuple[int, int]]:
    """usps -> (best, worst) rank among the given [lo, hi] claim intervals, highest first. A state is certainly below
    every other state whose lo exceeds its hi, and possibly below every state whose hi exceeds its lo; equal exact
    values share a rank."""
    out = {}
    for usps, (lo, hi) in intervals.items():
        others = [v for k, v in intervals.items() if k != usps]
        best = 1 + sum(1 for o_lo, _ in others if o_lo > hi)
        worst = 1 + sum(1 for _, o_hi in others if o_hi > lo)
        out[usps] = (best, worst)
    return out


def median_of(values: list[float]) -> float | None:
    v = sorted(values)
    if not v:
        return None
    mid = len(v) // 2
    return v[mid] if len(v) % 2 else (v[mid - 1] + v[mid]) / 2


def add_ranks(rows: list[dict]) -> None:
    """For each MDL, rank the 50 states and DC by claims in the latest national data year, on [claims, claims_max]
    intervals. A state with no row that year counts as [0, 10 x the products the national row lists] (CMS shows no row
    under 11 claims) for the others' ranks and the median, but gets no rank itself. `rank`..`rank_max` is a range when
    the intervals overlap. The national record keeps the median state as an interval. Territories get no rank."""
    by_mdl: dict[str, list[dict]] = {}
    for r in rows:
        by_mdl.setdefault(r["item"]["exposure"]["mdl"], []).append(r["item"]["exposure"])
    for exposures in by_mdl.values():
        for e in exposures:
            e["latest_rank"] = None
        nation = next((e for e in exposures if e["geo"]["usps"] == "US"), None)
        if not nation or not nation["series"]:
            continue
        latest = nation["series"][-1]
        year, total = latest["year"], latest["claims"]
        hidden_max = HIDDEN_MAX_CLAIMS * len(latest["products"])
        intervals: dict[str, tuple[int, int]] = {}
        with_row: dict[str, dict] = {}
        for e in exposures:
            usps = e["geo"]["usps"]
            if usps not in RANKED_STATES:
                continue
            point = next((p for p in e["series"] if p["year"] == year), None)
            if point and point["claims"] is not None:
                intervals[usps] = (point["claims"], point["claims_max"])
                with_row[usps] = e
        no_row = sorted(RANKED_STATES - set(intervals))
        for usps in no_row:
            intervals[usps] = (0, hidden_max)
        ranks = rank_intervals(intervals)
        for usps, e in with_row.items():
            lo, hi = intervals[usps]
            best, worst = ranks[usps]
            e["latest_rank"] = {
                "year": year,
                "rank": best,
                "rank_max": worst,
                "of": len(intervals),
                "measure": "claims",
                "share_of_national": round(lo / total, 6) if total else None,
                "share_is_lower_bound": hi > lo,
            }
        nation["state_distribution"] = {
            "year": year,
            "states": len(intervals),
            "states_with_row": len(with_row),
            "states_lower_bound": sum(1 for u in with_row if intervals[u][1] > intervals[u][0]),
            "median_lo": median_of([lo for lo, _ in intervals.values()]),
            "median_hi": median_of([hi for _, hi in intervals.values()]),
        }


def read_year(path: str):
    """Stream one year's rows (about 120k); the files are read one at a time."""
    with open(path, newline="", encoding="utf-8-sig") as fh:
        yield from csv.DictReader(fh)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=X.DEFAULT_ACQ)
    args = ap.parse_args(argv)
    mapping = X.load_map()
    entries = matchers(mapping)
    raw = os.path.join(args.acq, "cms", "raw")
    rows_by_year = {}
    for year in sorted(SOURCES):
        path = os.path.join(raw, f"partd_geo_DY{year}.csv")
        if not os.path.exists(path):
            raise SystemExit(f"missing {path}; acquire it once from {SOURCES[year]}")
        rows_by_year[year] = read_year(path)
    years = sorted(rows_by_year)
    groups, skipped = collect(rows_by_year, entries)
    records = build_records(groups, years)
    by_mdl: dict[str, int] = {}
    for r in records:
        by_mdl[r["item"]["exposure"]["mdl"]] = by_mdl.get(r["item"]["exposure"]["mdl"], 0) + 1
    summary = {
        "publisher": PUBLISHER,
        "source_url": LANDING,
        "years": [years[0], years[-1]],
        "mapping": "scripts/enrichment/exposure_geo/mdl_exposure_map.json",
        "mapping_reviewed": mapping["reviewed"],
        "records_by_mdl": by_mdl,
        "skipped_geographies": skipped,
        "excluded_mdls": [{"mdl": e["mdl"], "reason": e["exclude_reason"]} for e in mapping["partd"] if not e.get("include")],
        "licence": "U.S. government work (public domain)",
        "caveats": [
            "Geography is the prescriber's state, not the patient's residence.",
            "CMS leaves out rows with fewer than 11 claims and hides beneficiary counts under 11; a state total missing a product is published as an interval [claims, claims_max].",
            "Beneficiaries and prescribers are not added across products.",
            "Medicare Part D only: no Medicaid, commercial or cash prescriptions, and no Part B (clinic-administered) drugs.",
        ],
    }
    block = X.listing(
        [("mdl", "MDL"), ("geography", "Prescriber state"), ("latest_year", "Year"), ("claims", "Claims"), ("fills", "30-day fills")],
        [("mdl", "MDL", {e["mdl"]: f"MDL {e['mdl']}" for e in entries})],
    )
    out = X.write_packet(args.acq, DATASET, LABEL, records, listing_block=block, summary=summary)
    print(f"{DATASET}: {len(records)} records -> {out}")
    print(f"skipped geographies: {sum(skipped.values())} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
