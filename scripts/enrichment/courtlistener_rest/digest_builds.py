"""Print a sha256 of the rows of every build file in private/build/courtlistener_rest (built_at excluded), to show a rebuild is identical."""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rest_common as rc  # noqa: E402

for name in sorted({n.removesuffix(".gz") for n in os.listdir(rc.OUT)}):
    if not name.endswith(".json") or not name.startswith("clb_"):
        continue
    spec = rc.read_build(name.removesuffix(".json"))
    if "rows" not in spec:
        continue
    rows = spec["rows"]
    h = hashlib.sha256("\n".join(json.dumps(r, sort_keys=True) for r in rows).encode()).hexdigest()
    s = hashlib.sha256(json.dumps(spec.get("summary"), sort_keys=True).encode()).hexdigest()
    print(f"{name:42s} {len(rows):6d} rows  rows {h[:16]}  summary {s[:16]}")
