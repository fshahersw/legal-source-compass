"""Step 4: download EDGAR submissions and XBRL companyfacts for every linked registrant.

Input:  private/acq/sec-companies/evidence.json
Cache:  private/acq/sec-companies/submissions/, companyfacts/ (raw JSON, unchanged)
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sec_http as h  # noqa: E402

ACQ = h.ACQ


def submissions_url(cik: str) -> str:
    return f"https://data.sec.gov/submissions/CIK{cik}.json"


def companyfacts_url(cik: str) -> str:
    return f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"


def fetch(cik: str):
    sub = h.get_json(submissions_url(cik), kind="submissions")
    facts = h.get(companyfacts_url(cik), kind="companyfacts", compress=True, timeout=180)
    return cik, sub is not None, facts is not None


def linked_ciks():
    data = json.loads((ACQ / "evidence.json").read_text())
    return sorted({p["cik"] for p in data["pairs"] if p["tier"]})


def main():
    ciks = linked_ciks()
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(fetch, ciks))
    print(len(ciks), "registrants;", sum(1 for _, s, _ in results if s), "submissions;", sum(1 for _, _, f in results if f), "companyfacts")


if __name__ == "__main__":
    main()
