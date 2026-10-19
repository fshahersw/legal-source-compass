"""Step 6 inputs: the registrants in company_sec_profiles, their EDGAR submissions and XBRL companyfacts.

Reads the CIK list from the published company_sec_profiles dataset (read-only; credentials from the environment) and caches
data.sec.gov submissions and companyfacts JSON through sec_http (8 requests/second, SEC fair-access User-Agent).
Writes private/build/sec_statements/lookups/companies.json.

    python3 -I -B scripts/enrichment/sec/fetch_company_docs.py [--refresh]   (--refresh re-downloads companyfacts)
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import corpus_writer as cw  # noqa: E402
import fetch_xbrl as fx  # noqa: E402
import sec_http as h  # noqa: E402

OUT = h.ROOT / "private" / "build" / "sec_statements" / "lookups"


def main():
    rows = cw.fetch_all("company_sec_profiles", select="id,title")
    companies = sorted({r["id"]: r.get("title") or r["id"] for r in rows if len(r["id"]) == 10 and r["id"].isdigit()}.items())

    def one(pair):
        cik, name = pair
        sub = h.get_json(fx.submissions_url(cik), kind="submissions")
        facts = h.get(fx.companyfacts_url(cik), kind="companyfacts", compress=True, timeout=180, refresh="--refresh" in sys.argv)
        return {"cik": cik, "name": name, "submissions": sub is not None, "companyfacts": facts is not None}

    with ThreadPoolExecutor(max_workers=6) as pool:
        out = list(pool.map(one, companies))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "companies.json").write_text(json.dumps(out, indent=1))
    print(len(out), "registrants;", sum(c["submissions"] for c in out), "submissions;", sum(c["companyfacts"] for c in out), "companyfacts")


if __name__ == "__main__":
    main()
