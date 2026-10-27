"""Read-only corpus snapshots for the exact judge-link packets (de-judges-data workstream).

Workers have no production credentials. The inputs of the link builders are therefore captured with read-only SELECTs (run by the
lead or a worker through the SQL console), whose saved JSON result is converted here into a plain snapshot file:

  python -I -B snapshot_io.py <saved result file> <snapshot name>

The saved result is either a bare JSON array of rows or the console wrapper text that embeds that array between
<untrusted-data-...> markers. Every snapshot row must be a single-column object; the column value (a jsonb array built with
jsonb_agg) becomes the snapshot. Snapshots land in private/acq/de-judges-data/snapshots/<name>.json together with the SQL that
produced them (recorded by the caller in snapshots/_manifest.json) and the sha256 of the bytes written.
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# The acquisition dir is git-ignored. Workstream agents run in temporary worktrees, so it sits in the main checkout (which survives
# worktree removal) when that exists; DE_JUDGES_ACQ overrides it, and elsewhere it is <repo>/private/acq/de-judges-data.
MAIN_CHECKOUT = Path(r"C:\Users\firas\Downloads\corpusfolder")
ACQ = Path(os.environ.get("DE_JUDGES_ACQ") or ((MAIN_CHECKOUT if MAIN_CHECKOUT.is_dir() else ROOT) / "private" / "acq" / "de-judges-data"))
SNAP = ACQ / "snapshots"
MARK = re.compile(r"<untrusted-data-[0-9a-f-]+>\s*(\[.*\])\s*</untrusted-data-[0-9a-f-]+>", re.S)


def extract_rows(text):
    """The JSON array of result rows inside a saved console result (or the text itself when it is already an array)."""
    text = text.strip()
    if text.startswith("["):
        return json.loads(text)
    outer = json.loads(text)
    body = outer["result"] if isinstance(outer, dict) else outer
    m = MARK.search(body)
    if not m:
        raise ValueError("no result rows found in the saved file")
    return json.loads(m.group(1))


def single_column(rows):
    """The value of the only column of the only row (a jsonb_agg result)."""
    if len(rows) != 1 or len(rows[0]) != 1:
        raise ValueError(f"expected one row with one column, got {len(rows)} rows")
    value = next(iter(rows[0].values()))
    return json.loads(value) if isinstance(value, str) else value


def save(name, value, query=None):
    SNAP.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    path = SNAP / f"{name}.json"
    path.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    man_path = SNAP / "_manifest.json"
    manifest = json.loads(man_path.read_text(encoding="utf-8")) if man_path.exists() else {}
    manifest[name] = {"file": path.name, "sha256": digest, "rows": len(value) if isinstance(value, list) else None,
                      "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "query": query or manifest.get(name, {}).get("query")}
    man_path.write_text(json.dumps(manifest, indent=1, sort_keys=True), encoding="utf-8")
    return path, digest


def load(name):
    """A snapshot after checking its sha256 against the manifest."""
    manifest = json.loads((SNAP / "_manifest.json").read_text(encoding="utf-8"))
    entry = manifest[name]
    data = (SNAP / entry["file"]).read_bytes()
    if hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise SystemExit(f"snapshot {name}: sha256 differs from its manifest entry")
    return json.loads(data.decode("utf-8"))


def main(argv):
    if len(argv) < 2:
        raise SystemExit("usage: snapshot_io.py <saved result file> <snapshot name> [query file]")
    rows = extract_rows(Path(argv[0]).read_text(encoding="utf-8"))
    value = single_column(rows)
    query = Path(argv[2]).read_text(encoding="utf-8") if len(argv) > 2 else None
    path, digest = save(argv[1], value, query)
    print(json.dumps({"snapshot": argv[1], "rows": len(value) if isinstance(value, list) else None, "file": str(path), "sha256": digest}))


if __name__ == "__main__":
    main(sys.argv[1:])
