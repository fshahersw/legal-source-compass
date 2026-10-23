"""Case-law stage 2: list (and optionally delete) storage objects under caselaw/read/ and caselaw/citator/ that the
current build no longer references, e.g. the trial build's objects after the full build.

    cd scripts/enrichment/caselaw
    python3 -I -B cleanup_objects.py                 # dry run: counts and bytes of unreferenced objects
    python3 -I -B cleanup_objects.py --delete        # delete them (only keys under the two stage-2 prefixes)

Referenced = an object of the current reading-store state (read/groups.json) or citator state
(citator/partitions.json), or a key that a loaded case row points to (meta/cases-*.jsonl.gz). Run it only after the
case rows of the current build are loaded (load_caselaw.py cases), so no live row points to a deleted object.
Stage-1 objects (caselaw/courtlistener/) are never listed or touched.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import load_caselaw  # noqa: E402

BUILD = load_caselaw.BUILD
PREFIXES = ("caselaw/read/2026-09-30", "caselaw/citator/2026-09-30")


def referenced() -> set[str]:
    keys = set()
    p = os.path.join(BUILD, "read", "groups.json")
    if os.path.exists(p):
        for g in json.load(open(p)).values():
            keys.update(o["key"] for o in g["objects"])
    p = os.path.join(BUILD, "citator", "partitions.json")
    if os.path.exists(p):
        for v in json.load(open(p)).values():
            keys.update(o["key"] for o in v["objects"])
    keys.update(load_caselaw.referenced_keys())
    return keys


def list_prefix(st, prefix: str) -> list[dict]:
    """Every object under prefix (recursing into folders) via the storage list endpoint."""
    out, folders = [], [prefix]
    while folders:
        folder = folders.pop()
        offset = 0
        while True:
            r = st._retry(lambda: st.s.post(f"{st.url}/storage/v1/object/list/{st.bucket}", headers={**st.h, "Content-Type": "application/json"},
                                            data=json.dumps({"prefix": folder + "/", "limit": 1000, "offset": offset,
                                                             "sortBy": {"column": "name", "order": "asc"}}), timeout=120))
            if r.status_code != 200:
                raise SystemExit(f"list {folder} -> HTTP {r.status_code}")
            items = r.json()
            for it in items:
                path = f"{folder}/{it['name']}"
                if it.get("id") is None:
                    folders.append(path)
                else:
                    out.append({"key": path, "bytes": (it.get("metadata") or {}).get("size") or 0})
            if len(items) < 1000:
                break
            offset += 1000
    return out


def main(argv=None) -> int:
    import store

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--delete", action="store_true")
    a = ap.parse_args(argv)
    st = store.Storage()
    keep = referenced()
    stale = []
    total = 0
    for prefix in PREFIXES:
        objs = list_prefix(st, prefix)
        total += len(objs)
        stale.extend(o for o in objs if o["key"] not in keep)
    print(json.dumps({"listed": total, "referenced": len(keep), "unreferenced": len(stale),
                      "unreferenced_bytes": sum(o["bytes"] for o in stale)}))
    if a.delete:
        for i in range(0, len(stale), 100):
            batch = [o["key"] for o in stale[i:i + 100]]
            assert all(k.startswith(PREFIXES) for k in batch)
            r = st._retry(lambda: st.s.delete(f"{st.url}/storage/v1/object/{st.bucket}", headers={**st.h, "Content-Type": "application/json"},
                                              data=json.dumps({"prefixes": batch}), timeout=120))
            if r.status_code != 200:
                raise SystemExit(f"delete -> HTTP {r.status_code}")
        print(json.dumps({"deleted": len(stale)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
