"""Profile one IDB file (value distributions of chosen columns per year key) before the aggregation rules are fixed.

  python3 -I -B profile_idb.py <zip> <year column> <col> [<col> ...]
Writes private/build/judiciary/profile_<zip stem>.json.
"""
from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402
import idb_stream  # noqa: E402


def main(argv: list[str]) -> None:
    zpath, ycol, cols = Path(argv[1]), argv[2], argv[3:]
    per = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    n = bad = 0
    for r in idb_stream.rows(zpath):
        if r.get("__bad__"):
            bad += 1
            continue
        n += 1
        y = r.get(ycol, "")
        for c in cols:
            per[c][y][r.get(c, "")] += 1
    out = {"rows": n, "bad_lines": bad,
           "columns": {c: {y: dict(cnt.most_common(60)) | {"__distinct__": len(cnt)} for y, cnt in sorted(v.items())} for c, v in per.items()}}
    dest = fl.ROOT / "private" / "build" / "judiciary" / f"profile_{zpath.stem}.json"
    dest.write_text(json.dumps(out, indent=1))
    print(json.dumps({"rows": n, "bad": bad, "out": str(dest)}))


if __name__ == "__main__":
    main(sys.argv)
