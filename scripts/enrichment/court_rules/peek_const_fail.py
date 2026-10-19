"""Diagnostic: for one state, show why constitution provisions fail the second-path check (read-only).

  python3 -I -B scripts/enrichment/court_rules/peek_const_fail.py ST [N]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402
import verify_court_rules as V  # noqa: E402


def main(argv):
    st = argv[0]
    n = int(argv[1]) if len(argv) > 1 else 3
    states = {c["state"]: c for c in fetchlib.load_json(os.path.join(V.BUILD, "work", "constitutions.json"))["states"]}
    src = "".join(V.source_text_words(f["path"]) for f in states[st]["files"] if os.path.exists(os.path.join(fetchlib.ROOT, f["path"])))
    rows = [r for r in V.load("state_constitution_sections") if r["item"]["constitution_section"]["state"] == st]
    shown = 0
    for r in rows:
        w = V.words(r["text"])
        windows = V.provision_windows(r["text"], 60)
        bad = [win for win in windows if win not in src]
        if not bad:
            continue
        win = bad[0]
        k = len(win)
        while k > 10 and win[:k] not in src:
            k -= 10
        at = src.find(win[:k])
        print(json.dumps({"id": r["id"], "windows": len(windows), "bad": len(bad), "provision": win,
                          "source_after_prefix": src[at:at + 140] if at >= 0 else None, "prefix_len": k}))
        shown += 1
        if shown >= n:
            break
    print("source chars", len(src))


if __name__ == "__main__":
    main(sys.argv[1:])
