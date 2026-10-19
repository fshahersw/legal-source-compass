"""Diagnostic: one line per rule document (scope, levels, courts, part, status, counts) from the build (read-only)."""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

BUILD = os.path.join(fetchlib.ROOT, "private", "build", "court_rules")


def main(argv):
    rows = fetchlib.load_json(os.path.join(BUILD, "court_rule_documents.json"))["rows"]
    scope = argv[0] if argv else None
    print(Counter((r["filters"]["scope"][0], tuple(r["filters"].get("level") or [])) for r in rows))
    print(Counter(r["filters"]["part"][0] for r in rows))
    for r in rows:
        f = r["filters"]
        if scope and f["scope"][0] != scope:
            continue
        info = r["item"]["rule_document"]
        print(json.dumps([r["id"], r["title"][:70], f.get("level"), f.get("court"), f.get("state"), f["part"], info["status"], info["sections"], info["insights"]]))


if __name__ == "__main__":
    main(sys.argv[1:])
