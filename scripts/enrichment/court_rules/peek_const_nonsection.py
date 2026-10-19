"""Diagnostic: sample the units without a section number for one state (read-only).

  python3 -I -B scripts/enrichment/court_rules/peek_const_nonsection.py ST [N]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

WORK = os.path.join(fetchlib.ROOT, "private", "build", "court_rules", "work")


def main(argv):
    st = argv[0]
    n = int(argv[1]) if len(argv) > 1 else 8
    rows = []
    with fetchlib.open_text(os.path.join(WORK, "constitution_sections.jsonl")) as handle:
        for line in handle:
            s = json.loads(line)
            if s["state"] == st and not s.get("section"):
                rows.append(s)
    print(len(rows), "units without a section")
    step = max(1, len(rows) // n)
    for s in rows[::step][:n]:
        print(" ", s["ordinal"], s.get("article"), len(s["text"]), json.dumps(s["text"][:200], ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
