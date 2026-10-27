"""Write the source_url packet for agency_safety_fda_press_recalls from the acquired FDA recall-announcement table.

Usage: python -I -B scripts/enrichment/fda_warning_letters/build_press_recall_urls.py --acq DIR

Input: <acq>/raw/press_recalls/manifest.json and its page files (fetch_press_recalls.py), sha256-checked.
Output: <acq>/packets/agency_safety_fda_press_recalls_source_url/update.sql (+ summary.json). No database access;
the lead runs update.sql. Matching happens inside that SQL on exact keys (see press_recalls.py).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import press_recalls as pr  # noqa: E402

ROOT = HERE.parents[2]


def load(acq):
    raw = Path(acq) / "raw" / "press_recalls"
    manifest = json.loads((raw / "manifest.json").read_text(encoding="utf-8"))
    rows = []
    for entry in manifest["files"]:
        if not entry["file"].startswith("page_"):
            continue
        body = (raw / entry["file"]).read_bytes()
        if hashlib.sha256(body).hexdigest() != entry["sha256"] or entry["http_status"] != 200:
            raise SystemExit(f"{entry['file']} does not match its manifest entry")
        rows.extend(pr.parse_rows(json.loads(body)))
    return manifest, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=str(ROOT / "private" / "acq" / "de-fda-exact"))
    args = ap.parse_args()
    manifest, rows = load(args.acq)
    paths = {r["path"] for r in rows}
    unique = pr.unique_table_rows(rows)
    scope = pr.read_scope(manifest, rows)
    rule = pr.rule_for(scope)
    sql = pr.update_sql(unique, rule)
    out = Path(args.acq) / "packets" / "agency_safety_fda_press_recalls_source_url"
    out.mkdir(parents=True, exist_ok=True)
    # bytes, not text mode: on Windows text mode would write CRLF and the file would not hash to update_sql_sha256
    (out / "update.sql").write_bytes(sql.encode("utf-8"))
    summary = {"dataset": pr.DATASET, "table_pages": len(paths), "table_rows_with_unique_key": len(unique),
               "totals_reported": manifest.get("totals_reported"), "read_scope": scope, "rule": rule,
               "update_sql_sha256": hashlib.sha256(sql.encode("utf-8")).hexdigest()}
    (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
