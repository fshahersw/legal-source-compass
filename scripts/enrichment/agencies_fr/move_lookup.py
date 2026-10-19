"""Move a JSON lookup written in the builder folder into private/build/agencies_fr/lookups/ (validates JSON first).

Usage: python3 -I -B move_lookup.py <src.json> <lookup name>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOOKUPS = os.path.join(HERE, "..", "..", "..", "private", "build", "agencies_fr", "lookups")

src, name = sys.argv[1], sys.argv[2]
with open(src, encoding="utf-8") as fh:
    payload = json.load(fh)
os.makedirs(LOOKUPS, exist_ok=True)
with open(os.path.join(LOOKUPS, name), "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, sort_keys=True)
os.remove(src)
print(json.dumps({"saved": name, "rows": len(payload.get("rows", []))}))
