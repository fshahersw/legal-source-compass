"""Remove check lines whose URL host matches the given host so check_sources.py re-checks them (old lines are archived).

Usage: python3 -I -B requeue_checks.py <host-substring>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PATH = os.path.join(ROOT, "private", "acq", "third_party_data", "official_pages", "_checks.jsonl")
ARCHIVE = os.path.join(ROOT, "private", "acq", "third_party_data", "official_pages", "_checks_superseded.jsonl")

needle = sys.argv[1]
keep, drop = [], []
for raw in open(PATH, encoding="utf-8"):
    line = json.loads(raw)
    (drop if needle in (line.get("url") or "") else keep).append(raw)
with open(ARCHIVE, "a", encoding="utf-8") as handle:
    handle.writelines(drop)
with open(PATH, "w", encoding="utf-8") as handle:
    handle.writelines(keep)
print("requeued", len(drop), "kept", len(keep))
