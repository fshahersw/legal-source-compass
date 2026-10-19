"""Save read-only SELECT results fetched through the Supabase MCP tool as a lookup file.

The MCP tool writes any large result to a text file shaped like
    {"result": "Below is the result ... <untrusted-data-UUID>\\n[ ...rows... ]\\n</untrusted-data-UUID> ..."}
This helper strips that wrapper, concatenates the row arrays of one or more result files, and writes
private/build/firm_intel/lookups/<name>.json as {"query", "source", "retrieved_at", "rows"}.

    python3 -I -B save_lookup.py <name> <query-label> <result file> [<result file> ...]

It never talks to the network and never reads credentials.
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

LOOKUPS = Path(__file__).resolve().parents[3] / "private" / "build" / "firm_intel" / "lookups"
# The preamble also mentions the tag ("... within the <untrusted-data-X> boundaries"), so the opening tag must be
# followed by a newline and the closing tag must carry the same id.
BLOCK = re.compile(r"<untrusted-data-([0-9a-f-]+)>\n(.*)\n</untrusted-data-\1>", re.S)


def rows_from_result(path: Path) -> list:
    outer = json.loads(path.read_text(encoding="utf-8"))
    text = outer["result"] if isinstance(outer, dict) and "result" in outer else outer
    match = BLOCK.search(text)
    if not match:
        raise SystemExit(f"{path}: no untrusted-data block found")
    rows = json.loads(match.group(2))
    if not isinstance(rows, list):
        raise SystemExit(f"{path}: expected a JSON array")
    return rows


def main() -> None:
    name, label, *files = sys.argv[1:]
    if not files:
        raise SystemExit(__doc__)
    rows: list = []
    for file in files:
        part = rows_from_result(Path(file))
        print(f"{file}: {len(part)} rows")
        rows.extend(part)
    LOOKUPS.mkdir(parents=True, exist_ok=True)
    out = LOOKUPS / f"{name}.json"
    payload = {
        "query": label,
        "source": "public.corpus_records via Supabase MCP execute_sql (read-only SELECT)",
        "retrieved_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "row_count": len(rows),
        "rows": rows,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out} ({len(rows)} rows, {out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
