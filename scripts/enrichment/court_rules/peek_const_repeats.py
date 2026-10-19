"""Diagnostic: re-run one state's constitution extraction without the repeated-section gate and show what repeats.

  python3 -I -B scripts/enrichment/court_rules/peek_const_repeats.py ST [N]
"""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract_constitutions as EC  # noqa: E402
import fetchlib  # noqa: E402


def main(argv):
    st = argv[0]
    n = int(argv[1]) if len(argv) > 1 else 4
    EC.REPEATED_LIMIT = 1.01
    EC.save_text = lambda name, text: ("(not saved)", "")
    sources = json.load(open(os.path.join(HERE, "constitution_sources.json")))
    src = sources["states"][st] if "states" in sources else sources[st]
    m = {}
    for r in fetchlib.read_manifest():
        if r.get("http_status") == 200 and r.get("path"):
            m[r["path"]] = r
    info, rows = EC.extract_state(st, src, m)
    keys = Counter((r["article"], r["section"]) for r in rows if r["section"])
    rep = [k for k, c in keys.items() if c > 1]
    print(json.dumps({"state": st, "units": len(rows), "sections": sum(keys.values()), "repeated_keys": len(rep),
                      "repeated_units": sum(keys[k] for k in rep), "cleanup": info.get("cleanup")}))
    if len(argv) > 2:  # print one unit in full: ST N ORDINAL
        for r in rows:
            if r["ordinal"] == int(argv[2]):
                print(r["text"][:3000])
        return
    for k in rep[:n]:
        for r in rows:
            if (r["article"], r["section"]) == k:
                print("  ", k, r["ordinal"], json.dumps(r["text"][:160], ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
