"""Acquire CRS report metadata from the Congress.gov API v3 (/crsreport list and /crsreport/{id} detail).

  python3 -I -B acquire_crs.py --list                 every list page (limit 250), saved as stored responses
  python3 -I -B acquire_crs.py --details 7600         detail records, Active reports first, newest update first,
                                                      up to N new requests (and never past the stream budget)

The list gives id, title, content type, status, publish/update dates and version for every report; the detail adds
authors, topics, formats (official PDF/HTML links) and related legislation. The stream's Congress.gov budget is 8,000
requests in total (congress_api.BUDGET); 260 are kept back for the bill verification sample and retries.
Report text and summaries are not stored in the dataset (metadata and links only).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import congress_api as api  # noqa: E402
import common as cm  # noqa: E402

LIMIT = 250
RESERVE = 260
INDEX = cm.BUILD / "crs_list.json"


def list_all() -> list[dict]:
    first = api.get("/crsreport", offset=0, limit=LIMIT)
    total = int(first["pagination"]["count"])
    reports = list(first["CRSReports"])
    for offset in range(LIMIT, total, LIMIT):
        page = api.get("/crsreport", offset=offset, limit=LIMIT)
        reports.extend(page["CRSReports"])
    by_id: dict[str, dict] = {}
    for r in reports:
        by_id.setdefault(r["id"], r)
    out = {"listed_count": total, "rows_read": len(reports), "unique_ids": len(by_id), "reports": sorted(by_id.values(), key=lambda r: r["id"])}
    cm.BUILD.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(out))
    print(json.dumps({k: out[k] for k in ("listed_count", "rows_read", "unique_ids")} | {"requests_used": api.used()}))
    return out["reports"]


def priority(r: dict) -> tuple:
    return (0 if r.get("status") == "Active" else 1, "".join(chr(255 - ord(c)) for c in (r.get("updateDate") or "")))


def details(n: int) -> None:
    reports = json.loads(INDEX.read_text())["reports"]
    done = 0
    for r in sorted(reports, key=priority):
        if done >= n:
            break
        dest = api.stored_name(f"/crsreport/{r['id']}", {"format": "json"})
        if dest.exists() or dest.with_suffix(".missing").exists():
            continue
        if api.used() >= api.BUDGET - RESERVE:
            print(json.dumps({"stopped": "budget reserve reached", "requests_used": api.used()}))
            break
        api.get(f"/crsreport/{r['id']}")
        done += 1
        if done % 250 == 0:
            print(json.dumps({"details_fetched": done, "requests_used": api.used()}), flush=True)
    print(json.dumps({"details_fetched": done, "requests_used": api.used()}))


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--details", type=int, default=0)
    a = ap.parse_args(argv)
    if a.list:
        list_all()
    if a.details:
        details(a.details)


if __name__ == "__main__":
    main(sys.argv[1:])
