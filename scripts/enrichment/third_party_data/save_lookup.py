"""Save a read-only corpus SQL result (as returned by the Supabase MCP tool and saved to a file) as a lookup JSON.

Usage: python3 -I -B save_lookup.py <mcp_result_file> <out_name> "<sql description>"
Writes private/build/third_party_data/lookups/<out_name>.json = {"query", "saved_at", "rows": [...]}
Rows whose single field "blob" holds tab/newline text are kept as-is; the builder splits them.
"""
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LOOKUPS = os.path.join(ROOT, "private", "build", "third_party_data", "lookups")


def extract_rows(raw):
    """The MCP result is a JSON object whose 'result' text wraps a JSON array between <untrusted-data-*> tags."""
    try:
        outer = json.loads(raw)
        text = outer["result"] if isinstance(outer, dict) else raw
    except (ValueError, KeyError, TypeError):
        text = raw
    if isinstance(outer, list) and outer and isinstance(outer[0], dict) and "text" in outer[0]:
        text = json.loads(outer[0]["text"])["result"]
    match = re.search(r"<untrusted-data-[0-9a-f-]+>\s*(\[.*\])\s*</untrusted-data-", text, re.S)
    if not match:
        raise SystemExit("no data array found")
    return json.loads(match.group(1))


if __name__ == "__main__":
    src, name, desc = sys.argv[1], sys.argv[2], sys.argv[3]
    rows = extract_rows(open(src, encoding="utf-8").read())
    os.makedirs(LOOKUPS, exist_ok=True)
    out = os.path.join(LOOKUPS, name + ".json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump({"query": desc, "saved_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "source": "public.corpus_records / public.corpus_datasets via Supabase MCP execute_sql (SELECT only)", "rows": rows},
                  handle, ensure_ascii=False, indent=0)
    print(out, len(rows), "rows")
