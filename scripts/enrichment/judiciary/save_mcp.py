"""Unwrap a saved Supabase MCP `execute_sql` output (read-only corpus lookup) into a JSON file under private/build/judiciary/lookups.

  python3 -I -B save_mcp.py <saved tool output .txt> <out name> [<column holding a json_agg array>]

The MCP tool stores oversized results as {"result": "...<untrusted-data-UUID>\n[rows]\n</untrusted-data-UUID>..."}; the
array between the boundary tags is the query result. With a column name, that column of the single row is written
(queries use json_agg so one call returns a whole lookup). The file is written with its sha256 next to it.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402

OUT = fl.ROOT / "private" / "build" / "judiciary" / "lookups"


def unwrap(path: str):
    raw = open(path, encoding="utf-8").read()
    try:
        outer = json.loads(raw)
        text = outer["result"] if isinstance(outer, dict) else outer
    except ValueError:
        text = raw
    m = re.search(r"<untrusted-data-([0-9a-f-]+)>\s*(\[.*\])\s*</untrusted-data-\1>", text, re.S)
    if not m:
        raise SystemExit(f"no untrusted-data block in {path}")
    return json.loads(m.group(2))


def main(argv: list[str]) -> None:
    rows = unwrap(argv[1])
    if len(argv) > 3:
        rows = rows[0][argv[3]]
        if isinstance(rows, str):
            rows = json.loads(rows)
    OUT.mkdir(parents=True, exist_ok=True)
    data = json.dumps(rows, sort_keys=True, indent=0).encode()
    (OUT / argv[2]).write_bytes(data)
    print(json.dumps({"file": str(OUT / argv[2]), "rows": len(rows), "sha256": hashlib.sha256(data).hexdigest()}))


if __name__ == "__main__":
    main(sys.argv)
