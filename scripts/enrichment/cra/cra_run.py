"""Run the extraction over every registered report and print a summary (development aid; the builder is build_cra.py).

    python3 -I -B scripts/enrichment/cra/cra_run.py [family] [report id substring]
"""
from __future__ import annotations

import collections
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_extract  # noqa: E402

if __name__ == "__main__":
    fam = sys.argv[1] if len(sys.argv) > 1 else None
    sub = sys.argv[2] if len(sys.argv) > 2 else ""
    res, reps = cra_extract.run(family=fam, only=sub)
    by = collections.Counter(f.report_id for f in res.facts)
    for r in reps:
        tabs = [t for t in res.tables if t["report"] == r["id"]]
        print(f"{r['id']:26s} facts={by.get(r['id'], 0):5d} tables={sum(t['status'] == 'extracted' for t in tabs)} held={sum(t['status'] == 'held' for t in tabs)}")
    for i in res.issues:
        print("ISSUE", i.report_id, f"p{i.page}", i.table[:70], "|", i.reason[:150])
    print(len(res.facts), "facts", len(res.issues), "issues")
