"""Acquire committees and subcommittees from the Congress.gov API v3.

  python3 -I -B acquire_committees.py --list              /committee list pages (limit 250) -> private/build/congress/committee_list.json
  python3 -I -B acquire_committees.py --congress-lists    /committee/{congress} for every Congress the API knows, newest first,
                                                          until two consecutive Congresses list nothing
  python3 -I -B acquire_committees.py --details 1000      /committee/{chamber}/{systemCode} for every listed committee, up to N
                                                          new requests

The list gives system code, name, chamber, type and update date; the detail adds the current-or-historical flag, official website,
parent, subcommittees, name history (with establishing authority) and counts of reports, bills, communications and nominations.
The per-Congress lists give the Congress numbers in which each committee exists. The API has no committee-membership endpoint.
Responses are stored unchanged (gzip) under private/acq/congress/.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cg_api as api  # noqa: E402
import committees_common as cc  # noqa: E402
from acquire_members import CONGRESSES, congresses, pages  # noqa: E402

LIST = api.BUILD / "committee_list.json"
CONGRESS_LISTS = api.BUILD / "committee_congress_lists.json"


def list_all(tag: str | None = None) -> list[dict]:
    total, rows = pages("/committee", "committees", tag)
    by_code: dict[str, dict] = {}
    dup = 0
    for r in rows:
        if r["systemCode"] in by_code:
            dup += 1
            continue
        by_code[r["systemCode"]] = r
    out = {"listed_count": total, "rows_read": len(rows), "unique_codes": len(by_code), "duplicates": dup,
           "retrieved_at": api.now_utc(), "committees": sorted(by_code.values(), key=lambda r: r["systemCode"])}
    api.BUILD.mkdir(parents=True, exist_ok=True)
    LIST.write_text(json.dumps(out))
    print(json.dumps({k: out[k] for k in ("listed_count", "rows_read", "unique_codes", "duplicates")} | {"requests_used": api.used()}))
    return out["committees"]


def congress_lists(tag: str | None = None) -> None:
    import re

    rows = congresses(tag) if not CONGRESSES.exists() or tag else json.loads(CONGRESSES.read_text())["congresses"]
    numbers = sorted({int(m.group(1)) for c in rows if (m := re.search(r"/congress/(\d+)", c.get("url") or ""))}, reverse=True)
    out: dict[str, list[str]] = {}
    seen: dict[str, dict] = {}  # the newest list entry per code, for committees the main list does not hold
    empty = 0
    for n in numbers:
        total, items = pages(f"/committee/{n}", "committees", tag)
        out[str(n)] = sorted({c["systemCode"] for c in items})
        for c in items:
            seen.setdefault(c["systemCode"], c)
        print(json.dumps({"congress": n, "listed": total, "unique": len(out[str(n)]), "requests_used": api.used()}), flush=True)
        empty = empty + 1 if not items else 0
        if empty >= 2:
            break
    CONGRESS_LISTS.write_text(json.dumps({"retrieved_at": api.now_utc(), "by_congress": out, "items": seen}))


def stored_detail(chamber: str, code: str) -> dict | None:
    base = api.stored_name(f"/committee/{chamber}/{code}", {"format": "json"})
    best = None
    for p in [base, *sorted(base.parent.glob(base.name.replace(".json.gz", "__at_*.json.gz")))]:
        if p.exists():
            d = json.loads(api.gzip.decompress(p.read_bytes())).get("committee") or {}
            if best is None or (d.get("updateDate") or "") >= (best.get("updateDate") or ""):
                best = d
    return best


def details(n: int, workers: int = 2, tag: str | None = None) -> None:
    from concurrent.futures import ThreadPoolExecutor

    todo = []
    for c in json.loads(LIST.read_text())["committees"]:
        chamber = cc.chamber_path(c.get("chamber"))
        if not chamber:
            continue
        dest = api.stored_name(f"/committee/{chamber}/{c['systemCode']}", {"format": "json"})
        if dest.with_suffix(".missing").exists():
            continue
        if not dest.exists():
            todo.append((chamber, c["systemCode"], None))
        elif tag and (c.get("updateDate") or "") > ((stored_detail(chamber, c["systemCode"]) or {}).get("updateDate") or ""):
            todo.append((chamber, c["systemCode"], tag))
    todo = todo[:n]
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for _ in pool.map(lambda x: api.get(f"/committee/{x[0]}/{x[1]}", _tag=x[2]), todo):
            done += 1
            if done % 100 == 0:
                print(json.dumps({"details_fetched": done, "requests_used": api.used()}), flush=True)
    print(json.dumps({"details_fetched": done, "requests_used": api.used()}))


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--congress-lists", action="store_true")
    ap.add_argument("--refresh-date")
    ap.add_argument("--details", type=int, default=0)
    a = ap.parse_args(argv)
    if a.list:
        list_all(a.refresh_date)
    if a.congress_lists:
        congress_lists(a.refresh_date)
    if a.details:
        details(a.details, tag=a.refresh_date)


if __name__ == "__main__":
    main(sys.argv[1:])
