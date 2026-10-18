"""Attach the validation results to the built FJC datasets' summaries (run after build, validate_against_ao and spot_check_fjc).

Adds summary.validation = {vs_ao: {...}, independent_recheck: {...}} to every fjc_civil_* build file, then rewrites it atomically.
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BUILD = os.path.join(ROOT, "private", "build", "fjc_idb")
DATASETS = ["fjc_civil_districts", "fjc_civil_states", "fjc_civil_national", "fjc_civil_nos", "fjc_civil_mdls"]


def main() -> None:
    ao = json.load(open(os.path.join(BUILD, "validation_vs_ao.json")))
    sc = json.load(open(os.path.join(BUILD, "spot_checks.json")))
    s = ao["summary"]
    block = {
        "vs_ao": {
            "source": ao["source"],
            "scope": "94 districts x FY2014-FY2025",
            "terminations": {"compared": s["terminated"]["compared"], "exact": s["terminated"]["exact"]},
            "filings": {"compared": s["filed"]["compared"], "exact": s["filed"]["exact"], "within_1pct_or_1_case": s["filed"]["within_1pct_or_1_case"]},
            "pending": {"compared": s["pending"]["compared"], "exact": s["pending"]["exact"], "within_1pct_or_1_case": s["pending"]["within_1pct_or_1_case"]},
            "reading": ("IDB terminations by statistical year equal the AO's published civil terminations in every district-year. Filings equal the AO's in "
                        "a minority of district-years and are within 1% (or 1 case) in most; differences go both ways and are largest in FY2014-FY2016 "
                        "for S.D. W.Va. (mass-tort filings). Pending at year end inherits the filing differences. IDB is a later snapshot of the same reports; "
                        "the AO's published tables remain the reference for official counts."),
            "worst_filing_differences": s["filed"]["worst"][:5],
        },
        "independent_recheck": {"method": sc["method"], "figures_recomputed": sc["checks"], "mismatches": sc["mismatches"], "raw_rows_read": sc["rows_read"],
                                "note": "The reader that loaded the data into DuckDB rejected 1,190 malformed lines (0.011%); they are excluded everywhere."},
    }
    for ds in DATASETS:
        path = os.path.join(BUILD, ds + ".json")
        b = json.load(open(path))
        b["summary"]["validation"] = block
        with open(path + ".tmp", "w") as h:
            json.dump(b, h, ensure_ascii=False, sort_keys=True)
        os.replace(path + ".tmp", path)
        print(ds, "validation block attached")


if __name__ == "__main__":
    main()
