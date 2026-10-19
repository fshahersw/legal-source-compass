"""Print the local-rules candidates found for each court, compactly, for review (no network).

  python3 -I -B scripts/enrichment/court_rules/show_candidates.py [court ...]
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
PATH = os.path.join(ROOT, "private", "build", "court_rules", "lookups", "local_rules_candidates.json")
SKIP = re.compile(r"twitter|facebook|linkedin|youtube|pacer\.|/news/|/judges?/|forms?/|/jury|/employment|\.gov/?$", re.I)


def main(argv):
    data = json.load(open(PATH))
    for c in data["courts"]:
        if argv and c["court"] not in argv:
            continue
        docs = [d for d in c["documents"] if not SKIP.search(d["url"])]
        strong = [d for d in docs if re.search(r"local|circuit rule|rules of (practice|court)|frap|rule", d["text"] + " " + d["url"], re.I)]
        print(f"## {c['court']} {c['host']} followed={[f['url'] for f in c['followed']][:4]} err={c['errors']}")
        for d in strong[:14]:
            print(f"   {d['url']}  | {d['text'][:80]}")


if __name__ == "__main__":
    main(sys.argv[1:])
