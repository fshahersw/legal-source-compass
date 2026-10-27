"""Build agency_safety_fda_warning_letters_index from the FDA.gov warning-letter table pages.

Usage:
  python -I -B scripts/enrichment/fda_warning_letters/build_warning_letters.py --acq DIR --dry-run
  python -I -B scripts/enrichment/fda_warning_letters/build_warning_letters.py --acq DIR --publish --expect-sha256 HEX

Input: <acq>/raw/warning_letters/manifest.json and the page files it lists (fetch_warning_letters.py); each file's
sha256 must equal the manifest and the union of letters must equal the table total. --dry-run writes the packet to
<acq>/packets/agency_safety_fda_warning_letters_index/. --publish goes through scripts/enrichment/corpus_writer.py
(credentials only from the environment) and refuses rows that do not hash to --expect-sha256.
"""
import argparse
import gzip
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import wl_parse as wp  # noqa: E402
import wl_rows  # noqa: E402

ROOT = HERE.parents[2]


def digest(rows):
    return hashlib.sha256("\n".join(json.dumps(row, sort_keys=True) for row in rows).encode()).hexdigest()


def load(acq):
    raw_dir = Path(acq) / "raw" / "warning_letters"
    manifest = json.loads((raw_dir / "manifest.json").read_text(encoding="utf-8"))
    passes = {}
    for entry in manifest["files"]:
        if not entry["file"].startswith("page_"):
            continue
        body = (raw_dir / entry["file"]).read_bytes()
        if hashlib.sha256(body).hexdigest() != entry["sha256"] or entry["http_status"] != 200:
            raise SystemExit(f"{entry['file']} does not match its manifest entry")
        direction = entry["file"].split("_")[1]
        passes.setdefault(direction, []).append(wp.parse_rows(json.loads(body)))
    letters = wp.union([rows for direction in sorted(passes, key=lambda d: d != "desc") for rows in passes[direction]])
    if len(letters) != manifest["table_total"]:
        raise SystemExit(f"read {len(letters)} letters, FDA's table lists {manifest['table_total']}")
    captured = min(e["retrieved_at"] for e in manifest["files"])
    return manifest, letters, captured


def build(acq):
    manifest, letters, captured = load(acq)
    rows = [wl_rows.row(letter, captured=captured) for letter in letters.values()]
    rows.sort(key=lambda r: (r["item"]["sort_date"] or "", r["id"]), reverse=True)
    if len({r["id"] for r in rows}) != len(rows):
        raise SystemExit("duplicate letter ids")
    summary = wl_rows.summary(rows, captured=captured, table_total=manifest["table_total"], passes=manifest["passes"])
    return rows, summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=str(ROOT / "private" / "acq" / "de-fda-exact"))
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--publish", action="store_true")
    ap.add_argument("--expect-sha256")
    args = ap.parse_args()
    import corpus_writer as writer  # noqa: E402

    rows, summary = build(args.acq)
    sha = digest(rows)
    listing_block = writer.listing(
        [("posted_date", "Posted"), ("letter_issue_date", "Issued"), ("company_name", "Company"),
         ("issuing_office", "Issuing office"), ("subject", "Subject"), ("closeout_letter", "Closeout")],
        [("closeout", "Closeout letter", {"yes": "Yes", "no": "No"})],
    )
    if args.dry_run:
        out = Path(args.acq) / "packets" / wl_rows.DATASET
        out.mkdir(parents=True, exist_ok=True)
        with gzip.open(out / "rows.jsonl.gz", "wt", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, sort_keys=True) + "\n")
        catalog = {"id": wl_rows.DATASET, "label": wl_rows.LABEL, "expected_records": len(rows), "manifest_sha256": sha,
                   "listing": {**listing_block, "total": len(rows)}, "summary": summary}
        (out / "catalog.json").write_text(json.dumps(catalog, indent=1) + "\n", encoding="utf-8")
        (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
        print(json.dumps({"dataset": wl_rows.DATASET, "records": len(rows), "manifest_sha256": sha, "packet": str(out),
                          "posted_from": summary["posted_from"], "posted_to": summary["posted_to"]}))
        return
    if args.expect_sha256 != sha:
        raise SystemExit(f"rows hash {sha}, expected {args.expect_sha256}: rebuild the packet and review it first")
    writer.publish(wl_rows.DATASET, wl_rows.LABEL, rows, listing_block=listing_block, summary=summary)


if __name__ == "__main__":
    main()
