"""Build agency_safety_openfda_device_recalls from the openFDA device recall bulk export.

Usage:
  python -I -B scripts/enrichment/openfda_device_recalls/build_device_recalls.py --acq DIR --dry-run
  python -I -B scripts/enrichment/openfda_device_recalls/build_device_recalls.py --acq DIR --publish --expect-sha256 HEX

Input: <acq>/raw/device_recall/manifest.json and the zip partitions it lists (fetch_device_recalls.py); each zip's
sha256 must equal the manifest. --dry-run writes the packet to <acq>/packets/agency_safety_openfda_device_recalls/
(rows.jsonl.gz, catalog.json, summary.json) and prints the manifest digest. --publish writes through
scripts/enrichment/corpus_writer.py (credentials only from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY) and refuses
to run unless the rebuilt rows hash to --expect-sha256, so the lead publishes exactly the reviewed packet.
"""
import argparse
import gzip
import hashlib
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import recall_rows as rr  # noqa: E402

ROOT = HERE.parents[2]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def digest(rows):
    """The digest corpus_writer.publish stores as manifest_sha256 (rows before ordinals are assigned)."""
    return hashlib.sha256("\n".join(json.dumps(row, sort_keys=True) for row in rows).encode()).hexdigest()


def load(acq):
    raw_dir = Path(acq) / "raw" / "device_recall"
    manifest = json.loads((raw_dir / "manifest.json").read_text(encoding="utf-8"))
    records = []
    for part in manifest["partitions"]:
        path = raw_dir / part["file"]
        if sha256_file(path) != part["sha256"]:
            raise SystemExit(f"{path} does not match its manifest sha256")
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            if len(names) != 1:
                raise SystemExit(f"{path}: expected one member, found {names}")
            doc = json.loads(zf.read(names[0]))
        results = doc["results"]
        if part.get("records_listed") is not None and len(results) != part["records_listed"]:
            raise SystemExit(f"{path}: {len(results)} records, listing says {part['records_listed']}")
        records.extend((part, r) for r in results)
    return manifest, records


def build(acq):
    manifest, records = load(acq)
    export_date = manifest["export_date"]
    rows = [rr.row(raw, bulk_url=part["url"], export_date=export_date) for part, raw in records]
    rows.sort(key=lambda r: (r["item"]["sort_date"] or "", r["id"]), reverse=True)  # newest initiation first
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate product recall numbers")
    part0 = manifest["partitions"][0]
    summary = rr.summary(rows, export_date=export_date, bulk_url=part0["url"], sha256=part0["sha256"])
    return manifest, rows, summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=str(ROOT / "private" / "acq" / "de-fda-exact"))
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--publish", action="store_true")
    ap.add_argument("--expect-sha256")
    args = ap.parse_args()
    import corpus_writer as writer  # noqa: E402  (shared listing/publish helpers)

    manifest, rows, summary = build(args.acq)
    sha = digest(rows)
    listing_block = writer.listing(rr.listing_columns(), [
        ("recall_status", "Status", {k.lower(): k for k in summary["by_status"] if k != "Not recorded"}),
    ])
    if args.dry_run:
        out = Path(args.acq) / "packets" / rr.DATASET
        out.mkdir(parents=True, exist_ok=True)
        with gzip.open(out / "rows.jsonl.gz", "wt", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, sort_keys=True) + "\n")
        catalog = {"id": rr.DATASET, "label": rr.LABEL, "expected_records": len(rows), "manifest_sha256": sha,
                   "listing": {**listing_block, "total": len(rows)}, "summary": summary}
        (out / "catalog.json").write_text(json.dumps(catalog, indent=1) + "\n", encoding="utf-8")
        (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
        print(json.dumps({"dataset": rr.DATASET, "records": len(rows), "manifest_sha256": sha, "packet": str(out),
                          "recall_events": summary["recall_events"], "records_with": summary["records_with"]}))
        return
    if args.expect_sha256 != sha:
        raise SystemExit(f"rows hash {sha}, expected {args.expect_sha256}: rebuild the packet and review it first")
    writer.publish(rr.DATASET, rr.LABEL, rows, listing_block=listing_block, summary=summary)


if __name__ == "__main__":
    main()
