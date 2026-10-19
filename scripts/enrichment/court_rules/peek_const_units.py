"""Diagnostic: per state, constitution units, repeated (article, section) pairs and very short units (read-only).

  python3 -I -B scripts/enrichment/court_rules/peek_const_units.py [ST ...]
"""
import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

WORK = os.path.join(fetchlib.ROOT, "private", "build", "court_rules", "work")


def main(argv):
    by = defaultdict(list)
    with fetchlib.open_text(os.path.join(WORK, "constitution_sections.jsonl")) as handle:
        for line in handle:
            s = json.loads(line)
            by[s["state"]].append(s)
    states = argv or sorted(by)
    for st in states:
        units = by.get(st, [])
        pairs = Counter((u.get("article"), u.get("section")) for u in units if u.get("section"))
        repeated = [k for k, n in pairs.items() if n > 1]
        short = [u for u in units if len(u["text"].strip()) < 60]
        arts = len({u.get("article") for u in units if u.get("article")})
        if "--show" in os.environ.get("PEEK", "") or len(states) == 1:
            for key in repeated[:3]:
                for u in units:
                    if (u.get("article"), u.get("section")) == key:
                        print("   ", key, u["ordinal"], json.dumps(u["text"][:200], ensure_ascii=False))
        print(json.dumps({"state": st, "units": len(units), "articles": arts, "repeated_pairs": len(repeated), "repeated_examples": repeated[:6],
                          "short_units": len(short), "short_examples": [(u.get("article"), u.get("section"), u["text"][:60]) for u in short[:4]]},
                         ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
