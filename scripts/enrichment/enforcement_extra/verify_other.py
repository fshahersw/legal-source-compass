"""Independent checks for eousa_caseload_annual, fsis_recalls, fsis_enforcement_quarterly and ussc_sentencing_districts.

  eousa   per-district deliverable-7 record counts and distinct deliverable-16 civil case IDs recounted from the raw
          CSVs with plain string splitting (no builder code); national totals; every district record links to an
          existing court id
  fsis    every record's recall number, title and FSIS URL occur in the raw listing HTML; every quoted pounds phrase
          occurs in the raw HTML; no duplicate URLs; official annual comparison differences listed
  qer     every stored row quote occurs in the stored PDF text
  ussc    assembled records equal the per-year aggregates (cases, medians, shares) for every district and year

  python3 -I -B verify_other.py     exits 1 on any failure
"""
from __future__ import annotations

import collections
import glob
import gzip
import html
import json
import os
import sys
import zipfile

from common import ACQ, BUILD, LOOKUPS, iter_build_rows, read_build_meta

failures: list[str] = []


def fail(msg):
    failures.append(msg) if len(failures) < 100 else None


def eousa() -> dict:
    z = zipfile.ZipFile(os.path.join(ACQ, "eousa", "FY2025_ANNUAL_DATA.ZIP"))
    d7 = collections.Counter()
    with z.open("deliverable_7_annual_combined_details_by_program_category_and_lead_charge.csv") as f:
        next(f)
        for line in f:
            parts = line.decode("latin-1").split(",")
            if len(parts) >= 6:
                d7[parts[1].strip()] += 1
    d16 = collections.defaultdict(set)
    with z.open("deliverable_16_paragraph_25c_annual_cumulative.csv") as f:
        next(f)
        for line in f:
            parts = line.decode("latin-1").split(",")
            if len(parts) >= 3:
                d16[parts[1].strip()].add(parts[2])
    courts = set(json.load(open(os.path.join(LOOKUPS, "court_spine_districts.json")))["ids"])
    n = 0
    for row in iter_build_rows(os.path.join(BUILD, "eousa_caseload_annual.json")):
        n += 1
        p = row["item"]["profile"]
        if row["id"] == "eousa:2025:national":
            if p["lead_charge_records_total"] != sum(d7.values()):
                fail("eousa national lead-charge total differs")
            if p["government_defendant_cases"] != sum(len(v) for v in d16.values()):
                fail("eousa national government-defendant total differs")
            continue
        code = p["district_code"]
        crim = (p.get("criminal_lead_charge_records") or {}).get("records", 0)
        if crim != d7.get(code, 0):
            fail(f"eousa {code} deliverable 7 records {crim} != {d7.get(code, 0)}")
        gov = (p.get("government_defendant_civil") or {}).get("cases", 0)
        if gov != len(d16.get(code, ())):
            fail(f"eousa {code} deliverable 16 cases {gov} != {len(d16.get(code, ()))}")
        if p["court_id"] and p["court_id"] not in courts:
            fail(f"eousa {code} links to unknown court {p['court_id']}")
        blob = json.dumps(row)
        if "R0" in blob and any(c in blob for c in ("2024R0", "2025R0")):
            fail(f"eousa {code} carries a case ID")
    return {"dataset": "eousa_caseload_annual", "records": n, "d7_rows": sum(d7.values()), "districts": len(d7)}


def fsis() -> dict:
    raw = ""
    for p in sorted(glob.glob(os.path.join(ACQ, "fsis", "listing", "*.html.gz"))):
        with gzip.open(p, "rt", encoding="utf-8") as f:
            raw += f.read()
    raw_text = html.unescape(raw)
    flat = " ".join(raw_text.split())
    urls = set()
    n = 0
    for row in iter_build_rows(os.path.join(BUILD, "fsis_recalls.json")):
        n += 1
        if row["source_url"] in urls:
            fail(f"fsis duplicate url {row['source_url']}")
        urls.add(row["source_url"])
        if row["source_url"] not in raw:
            fail(f"fsis {row['id']} url not in raw pages")
        num = row["item"]["cells"].get("number")
        if num and num not in raw_text:
            fail(f"fsis {row['id']} number {num} not in raw pages")
        if " ".join(row["title"].split()[:4]) not in flat:
            fail(f"fsis {row['id']} title not in raw pages")
        pounds = row["detail"].get("pounds_recalled")
        if pounds:
            phrase = pounds.split("“", 1)[1].rstrip("”)")
            if phrase not in flat:
                fail(f"fsis {row['id']} pounds phrase not in raw pages")
    meta = read_build_meta(os.path.join(BUILD, "fsis_recalls.json"))
    diffs = [c for c in meta["summary"]["official_comparison"] if c["difference"]]
    return {"dataset": "fsis_recalls", "records": n, "official_years": len(meta["summary"]["official_comparison"]),
            "years_with_count_difference": [(c["year"], c["difference"]) for c in diffs]}


def qer() -> dict:
    n = rows = 0
    for row in iter_build_rows(os.path.join(BUILD, "fsis_enforcement_quarterly.json")):
        n += 1
        fy = row["item"]["cells"]["fy"]
        p = glob.glob(os.path.join(ACQ, "fsis", "qer", f"*fy{fy}*.md.gz"))
        p = [x for x in p if ("q4" in os.path.basename(x)) or fy == 2026]
        with gzip.open(p[0], "rt", encoding="utf-8") as f:
            md = f.read()
        for t in row["item"]["tables"]:
            for r in t["rows"]:
                rows += 1
                if r["quote"] not in md:
                    fail(f"qer FY{fy} table {t['table']} quote not found")
    return {"dataset": "fsis_enforcement_quarterly", "records": n, "rows_checked": rows}


def ussc() -> dict:
    years = {}
    for p in glob.glob(os.path.join(BUILD, "ussc_years", "FY*.json")):
        y = json.load(open(p))
        years[y["fy"]] = y
    from ussc_codes import DISTRICTS
    by_court = {v[1]: k for k, v in DISTRICTS.items()}
    n = 0
    for row in iter_build_rows(os.path.join(BUILD, "ussc_sentencing_districts.json")):
        n += 1
        p = row["item"]["profile"]
        y = years[p["fy"]]
        unit = y["national"] if p["court_id"] is None else y["districts"][str(by_court[p["court_id"]])]
        for k in ("cases", "prison_median", "prison_mean", "sentence_median", "within_pct", "mm_pct"):
            if p["total"][k] != unit["total"][k]:
                fail(f"ussc {row['id']} {k} differs")
        if sum(o["cases"] for o in p["offenses"]) != p["total"]["cases"]:
            fail(f"ussc {row['id']} offense counts do not sum to cases")
        if sum(c["cases"] for c in p["offense_by_sentence_type"]) != p["total"]["cases"]:
            fail(f"ussc {row['id']} offense x sentence type does not sum to cases")
    return {"dataset": "ussc_sentencing_districts", "records": n, "years": len(years)}


if __name__ == "__main__":
    results = [eousa(), fsis(), qer(), ussc()]
    print(json.dumps({"results": results, "failures": len(failures)}, indent=1))
    for f in failures[:40]:
        print("FAIL", f)
    with open(os.path.join(BUILD, "verify_other.json"), "w", encoding="utf-8") as fh:
        json.dump({"results": results, "failures": failures}, fh, indent=1)
    sys.exit(1 if failures else 0)
