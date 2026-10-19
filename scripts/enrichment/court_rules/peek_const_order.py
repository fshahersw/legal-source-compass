"""Diagnostic: the article groups of one state's constitution in printed order, as the browse page shows them.

  python3 -I -B scripts/enrichment/court_rules/peek_const_order.py ST
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

WORK = os.path.join(fetchlib.ROOT, "private", "build", "court_rules", "work")


def main(argv):
    groups = []
    with fetchlib.open_text(os.path.join(WORK, "constitution_sections.jsonl")) as handle:
        for line in handle:
            s = json.loads(line)
            if s["state"] != argv[0]:
                continue
            if groups and groups[-1][0] == s.get("article"):
                groups[-1][2] += 1
            else:
                groups.append([s.get("article"), s.get("article_title"), 1, s["text"][:70].replace("\n", " ")])
    for g in groups:
        print(json.dumps(g, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
