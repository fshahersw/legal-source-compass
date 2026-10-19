"""Unwrap saved Supabase MCP `execute_sql` outputs into a JSON Lines lookup file (read-only corpus lookups).

The MCP tool saves oversized results as `{"result": "...<untrusted-data-UUID>[rows]</untrusted-data-UUID>..."}`.
This script extracts the JSON array between the boundary tags, optionally unwraps one key per row, and writes
one JSON object per line. Usage:
    python3 -I -B save_mcp.py OUT.jsonl [--key r] IN1.txt IN2.txt ...
"""
import json
import re
import sys


def unwrap(path: str):
    raw = open(path, encoding="utf-8").read()
    outer = json.loads(raw)
    text = outer["result"] if isinstance(outer, dict) else outer
    # The preamble mentions the tag once in prose; the data block is the tag followed by a newline and a JSON array.
    m = re.search(r"<untrusted-data-([0-9a-f-]+)>\n(\[.*\])\n</untrusted-data-\1>", text, re.S)
    if not m:
        raise SystemExit(f"no untrusted-data block in {path}")
    return json.loads(m.group(2))


def main(argv):
    out = argv[1]
    key = None
    files = []
    i = 2
    while i < len(argv):
        if argv[i] == "--key":
            key = argv[i + 1]
            i += 2
        else:
            files.append(argv[i])
            i += 1
    n = 0
    with open(out, "w", encoding="utf-8") as fh:
        for f in files:
            rows = unwrap(f)
            for row in rows:
                fh.write(json.dumps(row[key] if key else row, ensure_ascii=False, sort_keys=True) + "\n")
                n += 1
            print(f"{f.rsplit('/', 1)[-1]}: {len(rows)} rows")
    print(f"wrote {n} rows -> {out}")


if __name__ == "__main__":
    main(sys.argv)
