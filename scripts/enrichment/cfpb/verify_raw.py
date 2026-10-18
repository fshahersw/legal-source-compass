"""Verify displayed figures against the raw acquired files (Census CSVs, catalog HTML) and measure SEC name-match rates.

Writes private/build/cfpb/raw_checks.json. Usage: python3 -I -B scripts/enrichment/cfpb/verify_raw.py
"""
import csv
import html
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import aggregate  # noqa: E402
from cfpb_lib import SEP, build_name_index, match_name  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "cfpb")
OUT = os.path.join(ROOT, "private", "build", "cfpb")


def load(name):
    with open(os.path.join(OUT, f"{name}.json"), encoding="utf-8") as handle:
        return {r["id"]: r for r in json.load(handle)["rows"]}


def census(path, name, year):
    with open(path, newline="", encoding="latin-1") as handle:
        for row in csv.DictReader(handle):
            if row["SUMLEV"] == "040" and row["NAME"] == name:
                return int(row[f"POPESTIMATE{year}"])
    return None


def main():
    results = []
    states = load("cfpb_complaints_states")
    v2025 = os.path.join(ACQ, "census", "NST-EST2025-ALLDATA.csv")
    v2020 = os.path.join(ACQ, "census", "nst-est2020-alldata.csv")
    for code, name, year, path in (("GA", "Georgia", "2025", v2025), ("MS", "Mississippi", "2025", v2025), ("MS", "Mississippi", "2022", v2025),
                                   ("TX", "Texas", "2025", v2025), ("CA", "California", "2015", v2020), ("PR", "Puerto Rico", "2025", v2025)):
        row = next(r for r in states[f"cfpb-state:{code}"]["item"]["state_profile"]["years"] if r["year"] == year)
        raw = census(path, name, year)
        rate = round(row["complaints"] * 100000.0 / raw, 2)
        results.append({"check": f"{name} population {year} and per-100k", "build_value": [row["population"], row["per_100k"]],
                        "raw_value": [raw, rate], "where": f"{os.path.relpath(path, ROOT)} NAME={name} POPESTIMATE{year}",
                        "match": row["population"] == raw and row["per_100k"] == rate})
    reports = load("cfpb_research_reports")
    for rid in ("cfpb-report:2025-fair-lending-report", "cfpb-report:card-act-conference-key-findings", "cfpb-report:building-the-cfpb"):
        rep = reports[rid]["item"]["report"]
        path = os.path.join(ACQ, "reports", f"page-{rep['catalog_page']:03d}.html")
        with open(path, encoding="utf-8") as handle:
            raw = html.unescape(handle.read())
        ok = rep["title"] in raw and f'datetime="{rep["date"]}' in raw and rep["summary"][:60] in " ".join(raw.split())
        results.append({"check": f"Report {rid} title/date/summary", "build_value": [rep["title"], rep["date"], rep["summary"][:60]],
                        "raw_value": "present in raw catalog page" if ok else "missing", "where": os.path.relpath(path, ROOT), "match": ok})
    # SEC exact-name match rate over every company named in the CSV (not only the top 250)
    agg = aggregate.aggregate_zip()
    companies = sorted({k.split(SEP)[0] for k in agg["co"]})
    with open(os.path.join(OUT, "lookups", "company_sec_profiles_titles.json"), encoding="utf-8") as handle:
        index = build_name_index(json.load(handle)["rows"])
    statuses = {}
    for name in companies:
        statuses[name] = match_name(name, index)
    matched = {n: s[1] for n, s in statuses.items() if s[0] == "matched"}
    out = {"raw_checks": results, "raw_matches": sum(r["match"] for r in results), "raw_total": len(results),
           "sec_match_all_companies": {"companies": len(companies), "matched": len(matched),
                                       "ambiguous": sum(1 for s in statuses.values() if s[0] == "ambiguous"),
                                       "matched_names": matched}}
    with open(os.path.join(OUT, "raw_checks.json"), "w", encoding="utf-8") as handle:
        json.dump(out, handle, indent=1)
    for r in results:
        print("OK " if r["match"] else "MISMATCH", r["check"], r["build_value"], r["raw_value"])
    print(json.dumps(out["sec_match_all_companies"]))


if __name__ == "__main__":
    main()
