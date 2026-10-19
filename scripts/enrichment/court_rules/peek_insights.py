"""Review aid: print the kept insights of the named documents (or the summary).

  python3 -I -B scripts/enrichment/court_rules/peek_insights.py [doc_id ...]
"""
import json
import os
import sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
PATH = os.path.join(ROOT, "private", "build", "court_rules", "work", "insights.json")


def main(argv):
    data = json.load(open(PATH))
    print(json.dumps(data["summary"]))
    if not argv:
        cats = Counter(i["category"] for d in data["documents"] for i in d["kept"])
        print(dict(cats))
        return
    for d in data["documents"]:
        if d["doc"] not in argv:
            continue
        print("##", d["doc"], "kept", len(d["kept"]), "dropped", d["dropped"])
        for i in d["kept"]:
            print(f"  [{i['category']}] {i['applies_to']} => {i['value']} | {i['section_label']} p{i['page']} | {i['quote'][:110]!r}")


if __name__ == "__main__":
    main(sys.argv[1:])
