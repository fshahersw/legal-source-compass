"""Turn a saved read-only SQL result (the JSON file a database tool wrote to disk) into a lookup JSON file.

  python3 -I -B scripts/enrichment/gov_domains/save_mcp_rows.py <saved result file> <name>

The saved file is {"result": "<preamble><untrusted-data-ID>[...rows...]</untrusted-data-ID><postscript>"}; only the JSON
array between the tags is read, and it is written unchanged to private/build/gov_domains/lookups/<name>.json with a
sidecar <name>.meta.json holding the source file's sha256 and the row count. Used instead of a direct database read
when the environment file cannot be sourced; the lookups are read-only copies of the court directory and Census county
names that the reports join against.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "gov_domains", "lookups")


def rows_of(saved: bytes) -> list:
    outer = json.loads(saved.decode("utf-8"))
    text = outer["result"]
    match = re.search(r"<untrusted-data-([0-9a-f-]+)>\n(.*)\n</untrusted-data-\1>", text, re.S)
    if not match:
        raise SystemExit("no data block found")
    rows = json.loads(match.group(2))
    if not isinstance(rows, list):
        raise SystemExit("data block is not a list")
    return rows


def main(argv: list[str]) -> None:
    if len(argv) != 2 or not re.fullmatch(r"[a-z0-9_]{1,60}", argv[1]):
        raise SystemExit(__doc__)
    with open(argv[0], "rb") as handle:
        saved = handle.read()
    rows = rows_of(saved)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, argv[1] + ".json"), "w", encoding="utf-8") as handle:
        json.dump(rows, handle, ensure_ascii=False, sort_keys=True)
    with open(os.path.join(OUT, argv[1] + ".meta.json"), "w", encoding="utf-8") as handle:
        json.dump({"source_sha256": hashlib.sha256(saved).hexdigest(), "rows": len(rows)}, handle)
    print(argv[1], len(rows))


if __name__ == "__main__":
    main(sys.argv[1:])
