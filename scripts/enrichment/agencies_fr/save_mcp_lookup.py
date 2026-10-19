"""Save a read-only corpus query result (saved by the SQL tool as text) as a JSON lookup for the builder.

The SQL tool wraps rows in an untrusted-data envelope; only the JSON array between the boundary tags is kept.
Usage: python3 -I -B save_mcp_lookup.py <tool-output.txt> <lookup.json> <query description>
"""
import datetime as dt
import hashlib
import json
import re
import sys


def extract_rows(text):
    """Return the JSON row array inside the envelope (the tool output is a JSON object with a 'result' string)."""
    try:
        outer = json.loads(text)
        if isinstance(outer, dict) and "result" in outer:
            text = outer["result"]
        elif isinstance(outer, list) and outer and isinstance(outer[0], dict) and "text" in outer[0]:
            text = json.loads(outer[0]["text"])["result"]
    except (ValueError, KeyError, TypeError):
        pass
    match = re.search(r"<untrusted-data-[0-9a-f-]+>\s*(\[.*\])\s*</untrusted-data-[0-9a-f-]+>", text, re.S)
    if not match:
        raise SystemExit("no row array found")
    return json.loads(match.group(1))


def main(src, dst, description):
    text = open(src, encoding="utf-8").read()
    rows = extract_rows(text)
    payload = {
        "query": description,
        "saved_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rows": rows,
    }
    raw = json.dumps(payload, sort_keys=True).encode()
    with open(dst, "wb") as fh:
        fh.write(raw)
    print(json.dumps({"rows": len(rows), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
