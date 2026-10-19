"""Review aid: latest constitution/regulation acquisition result per state.

  python3 -I -B scripts/enrichment/court_rules/peek_log.py [constitutions|regulations]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402


def main(argv):
    which = argv[0] if argv else "constitutions"
    latest = {}
    for line in open(os.path.join(fetchlib.ACQ, which, "acquire_log.jsonl"), encoding="utf-8"):
        row = json.loads(line)
        latest[row.get("state")] = row
    for st in sorted(latest):
        r = latest[st]
        extra = {k: r[k] for k in ("parts", "failed", "items", "bytes", "kind") if k in r}
        err = (r.get("errors") or [""])[0][:120] if r.get("errors") else ""
        print(f"{st} {r.get('result')} {extra} {err}")


if __name__ == "__main__":
    main(sys.argv[1:])
