"""Fetch (1) the field definitions and code legends of the people and disclosure endpoints (HTTP OPTIONS: CourtListener's own
choices with display names) and (2) every ABA rating row (paged list, 20 rows per page; not in the bulk files).

    python3 -I -B fetch_api_reference.py [max_requests]

Responses are archived by cl_api (raw bytes, sha256, url, retrieved_at). Re-running reuses the archive.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cl_api  # noqa: E402

OPTIONS_ENDPOINTS = ["people/", "positions/", "educations/", "schools/", "political-affiliations/", "aba-ratings/", "retention-events/", "sources/",
                     "financial-disclosures/", "investments/", "debts/", "gifts/", "agreements/", "non-investment-incomes/", "spouse-incomes/",
                     "disclosure-positions/", "reimbursements/", "courts/"]


def main() -> None:
    c = cl_api.Client(max_requests=int(sys.argv[1]) if len(sys.argv) > 1 else 160)
    for ep in OPTIONS_ENDPOINTS:
        r = c.get(cl_api.build_url(ep), method="OPTIONS")
        print("OPTIONS", ep, r["status"], "cached" if r.get("cached") else "", flush=True)
    url = cl_api.build_url("aba-ratings/", [("order_by", "id")])
    pages = rows = 0
    while url:
        r = c.get(url)
        if r["status"] != 200:
            raise SystemExit(f"aba-ratings page failed: {r['status']}")
        j = r["json"]
        pages += 1
        rows += len(j["results"])
        url = j.get("next")
        if pages % 20 == 0:
            print("aba pages", pages, "rows", rows, flush=True)
    print("aba done: pages", pages, "rows", rows, "requests this run", c.requests, flush=True)


if __name__ == "__main__":
    main()
