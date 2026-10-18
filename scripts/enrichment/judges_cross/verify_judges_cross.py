"""Self-verification: re-read published judge_cross_* records and compare them with fresh downloads of the official
sources (FJC export, JPML pending report, JPML terminated report), independent of the cached raw files.

Run: cd <repo> && . private/scratch/env.sh && python3 scripts/enrichment/judges_cross/verify_judges_cross.py
"""
import csv
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import common as c  # noqa: E402
import corpus_writer as cw  # noqa: E402
from build_judge_profiles import services  # noqa: E402

ROOT = HERE.parents[2]
OUT = ROOT / "private" / "scratch" / "judges-cross" / "verify"
UA = {"User-Agent": "SeegerWeiss Research firasshaher99@gmail.com"}
FJC_URL = "https://www.fjc.gov/sites/default/files/history/judges.csv"
PENDING_URL = "https://www.jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets_By_Actions_Pending-October-1-2026.pdf"
TERMINATED_URL = "https://www.jpml.uscourts.gov/sites/jpml/files/JPML_Fiscal_Year_2025_Terminated_Litigations_Report_0.pdf"


def fetch(url, name):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        path.write_bytes(r.read())
    return path


def record(dataset, rid, select="id,item"):
    base, key = cw._base()
    req = urllib.request.Request(base + f"corpus_records?select={select}&dataset=eq.{dataset}&id=eq.{urllib.request.quote(rid)}",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())[0]["item"]


def main():
    checks = []
    fjc = list(csv.DictReader(fetch(FJC_URL, "fjc.csv").open(encoding="utf-8-sig")))
    for cid in ("njd", "laed", "nysd"):
        d = record("judge_cross_districts", cid)["district"]
        active = senior = dem = 0
        for row in fjc:
            sitting = [s for s in services(row) if not s["termination"]]
            if sitting and c.district_court_id(sitting[-1]["court"]) == cid:
                if sitting[-1]["senior_status"]:
                    senior += 1
                else:
                    active += 1
                    dem += sitting[-1]["party"] == "Democratic"
        checks.append(f"judge_cross_districts/{cid} active,senior,active_dem: published={d['active']},{d['senior']},{d['party_active'].get('Democratic', 0)} source={active},{senior},{dem} {FJC_URL}")

    pending_txt = subprocess.run(["pdftotext", "-layout", str(fetch(PENDING_URL, "pending.pdf")), "-"], capture_output=True, text=True, check=True).stdout
    for nid, mdl in (("1394031", 2738), ("1387376", 2846), ("1393296", 2873)):
        p = record("judge_cross_profiles", nid)["cross"]
        m = next(x for x in p["pending_mdls"] if x["mdl"] == mdl)
        line = next((ln for ln in pending_txt.splitlines() if re.search(rf"MDL\s*-\s*{mdl}\b", ln)), "")
        tail = re.search(r"([\d,]+)\s+([\d,]+)\s*$", line)
        src = (int(tail.group(1).replace(",", "")), int(tail.group(2).replace(",", ""))) if tail else None
        checks.append(f"judge_cross_profiles/{nid} pending_mdls[{mdl}] pending,total: published={m['pending']},{m['total']} source={src} {PENDING_URL}")

    term_txt = subprocess.run(["pdftotext", "-layout", str(fetch(TERMINATED_URL, "terminated.pdf")), "-"], capture_output=True, text=True, check=True).stdout
    rows, _, _ = c.parse_terminated_text(term_txt)
    p = record("judge_cross_profiles", "1387376")["cross"]
    for h in p["historical_mdls"]:
        src = [r for r in rows if r["mdl"] == h["mdl"]]
        checks.append(f"judge_cross_profiles/1387376 historical[{h['mdl']}] judge,closed,year: published={h['judge_as_printed']},{h['closed']},{h['year']} "
                      f"source={[(r['transferee_judge'], r['actions_closed'], r['termination_year'], r['district_name']) for r in src]} {TERMINATED_URL}")

    cov = record("judge_cross_disclosure_matches", "coverage:1394031")["coverage"]
    checks.append(f"judge_cross_disclosure_matches/coverage:1394031 reports(year:lines)={[(r['year'], r['lines']) for r in cov['reports']]} matches={cov['matches']} (compare: CourtListener API financial-disclosures?person=2955 and investments?financial_disclosure=<id>)")
    print("\n".join(checks))


if __name__ == "__main__":
    main()
