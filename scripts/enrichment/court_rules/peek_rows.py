"""Diagnostic: print the item extras of given build rows (read-only).

  python3 -I -B scripts/enrichment/court_rules/peek_rows.py <dataset> <id> [<id> ...]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

BUILD = os.path.join(fetchlib.ROOT, "private", "build", "court_rules")


def main(argv):
    rows = fetchlib.load_json(os.path.join(BUILD, f"{argv[0]}.json"))["rows"]
    want = set(argv[1:])
    for r in rows:
        if r["id"] in want:
            extra = {k: v for k, v in r["item"].items() if k not in ("cells", "badges", "links")}
            print(json.dumps({"id": r["id"], "title": r.get("title"), "extra": extra, "text": (r.get("text") or "")[:300]}, ensure_ascii=False)[:1500])


if __name__ == "__main__":
    main(sys.argv[1:])
