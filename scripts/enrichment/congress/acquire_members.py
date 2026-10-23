"""Acquire members of Congress from the Congress.gov API v3.

  python3 -I -B acquire_members.py --list                 /member list pages (limit 250) -> private/build/congress/member_list.json
  python3 -I -B acquire_members.py --congress-lists       /member/congress/{n}?currentMember=false for every Congress the API
                                                          knows (the API documentation recommends this filter for completeness)
  python3 -I -B acquire_members.py --details 3000         /member/{bioguideId} for every listed member (current members first),
                                                          up to N new requests
  python3 -I -B acquire_members.py --refresh-date 2026-11-01 --list   re-read the pages and store them beside the earlier ones

The list gives name, state, district, party, chamber terms (start/end years) and portrait for every member; the detail adds
current-member flag, birth/death year, official website, per-Congress terms with party, leadership positions, previous names
and the sponsored/cosponsored legislation counts. Responses are stored unchanged (gzip) under private/acq/congress/.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cg_api as api  # noqa: E402

LIMIT = 250
LIST = api.BUILD / "member_list.json"
CONGRESS_LISTS = api.BUILD / "member_congress_lists.json"
CONGRESSES = api.BUILD / "congresses.json"


def pages(path: str, key: str, tag: str | None = None, **params) -> tuple[int, list[dict]]:
    first = api.get(path, _tag=tag, offset=0, limit=LIMIT, **params)
    if first is None:
        return 0, []
    total = int(first["pagination"]["count"])
    rows = list(first[key])
    for offset in range(LIMIT, total, LIMIT):
        page = api.get(path, _tag=tag, offset=offset, limit=LIMIT, **params)
        rows.extend((page or {}).get(key, []))
    return total, rows


def list_all(tag: str | None = None) -> list[dict]:
    total, rows = pages("/member", "members", tag)
    by_id: dict[str, dict] = {}
    dup = 0
    for r in rows:
        if r["bioguideId"] in by_id:
            dup += 1
            continue
        by_id[r["bioguideId"]] = r
    out = {"listed_count": total, "rows_read": len(rows), "unique_ids": len(by_id), "duplicates": dup,
           "retrieved_at": api.now_utc(), "members": sorted(by_id.values(), key=lambda r: r["bioguideId"])}
    api.BUILD.mkdir(parents=True, exist_ok=True)
    LIST.write_text(json.dumps(out))
    print(json.dumps({k: out[k] for k in ("listed_count", "rows_read", "unique_ids", "duplicates")} | {"requests_used": api.used()}))
    return out["members"]


def congresses(tag: str | None = None) -> list[dict]:
    total, rows = pages("/congress", "congresses", tag)
    api.BUILD.mkdir(parents=True, exist_ok=True)
    CONGRESSES.write_text(json.dumps({"listed_count": total, "retrieved_at": api.now_utc(), "congresses": rows}))
    print(json.dumps({"congresses": total, "requests_used": api.used()}))
    return rows


def congress_lists(tag: str | None = None) -> None:
    """Members listed per Congress (currentMember=false). Congresses before the first one the member data covers return an
    empty list; the loop stops after two empty Congresses in a row going backwards."""
    rows = congresses(tag) if not CONGRESSES.exists() or tag else json.loads(CONGRESSES.read_text())["congresses"]
    numbers = sorted({int(m.group(1)) for c in rows if (m := re.search(r"/congress/(\d+)", c.get("url") or ""))}, reverse=True)
    out: dict[str, list[str]] = {}
    empty = 0
    for n in numbers:
        total, members = pages(f"/member/congress/{n}", "members", tag, currentMember="false")
        out[str(n)] = sorted({m["bioguideId"] for m in members})
        print(json.dumps({"congress": n, "listed": total, "unique": len(out[str(n)]), "requests_used": api.used()}), flush=True)
        empty = empty + 1 if not members else 0
        if empty >= 2:
            break
    CONGRESS_LISTS.write_text(json.dumps({"retrieved_at": api.now_utc(), "by_congress": out}))


def stored_detail(bio: str) -> dict | None:
    """The newest stored detail response for a member (untagged first fetch or a later dated refresh)."""
    base = api.stored_name(f"/member/{bio}", {"format": "json"})
    best = None
    for p in [base, *sorted(base.parent.glob(base.name.replace(".json.gz", "__at_*.json.gz")))]:
        if p.exists():
            d = json.loads(api.gzip.decompress(p.read_bytes())).get("member") or {}
            if best is None or (d.get("updateDate") or "") >= (best.get("updateDate") or ""):
                best = d
    return best


def details(n: int, workers: int = 2, tag: str | None = None) -> None:
    from concurrent.futures import ThreadPoolExecutor

    listed = {m["bioguideId"]: m for m in json.loads(LIST.read_text())["members"]}
    if CONGRESS_LISTS.exists():
        for bios in json.loads(CONGRESS_LISTS.read_text())["by_congress"].values():
            for b in bios:
                listed.setdefault(b, {"bioguideId": b})
    todo = []
    for bio, m in sorted(listed.items(), key=lambda kv: (0 if not any((t or {}).get("endYear") for t in ((kv[1].get("terms") or {}).get("item") or [])[-1:]) else 1, kv[0])):
        dest = api.stored_name(f"/member/{bio}", {"format": "json"})
        if dest.with_suffix(".missing").exists():
            continue
        if not dest.exists():
            todo.append((bio, None))
            continue
        have = stored_detail(bio) or {}
        if (m.get("updateDate") or "") > (have.get("updateDate") or "") and tag:
            todo.append((bio, tag))  # updated since our copy: a dated refresh is stored beside the first
    todo = todo[:n]
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for _ in pool.map(lambda x: api.get(f"/member/{x[0]}", _tag=x[1]), todo):
            done += 1
            if done % 250 == 0:
                print(json.dumps({"details_fetched": done, "requests_used": api.used()}), flush=True)
    print(json.dumps({"details_fetched": done, "pending_before": len(todo), "requests_used": api.used()}))


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
