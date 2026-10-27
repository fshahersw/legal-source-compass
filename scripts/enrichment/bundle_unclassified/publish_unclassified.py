"""Lead only: append the released "Not classified" rows to a live dataset and patch its catalog entry.

  python -I -B scripts/enrichment/bundle_unclassified/publish_unclassified.py --packet <dir> --dataset court_documents            # dry run
  python -I -B scripts/enrichment/bundle_unclassified/publish_unclassified.py --packet <dir> --dataset court_documents --execute  # writes

Reads <dir>/<dataset>.rows.jsonl (hash-checked against report.json) and <dir>/live_before.json (the live state the
packet was prepared against). Refuses to write when the live id set, row count or ordinals differ from that state.
Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment only (service role), never printed.

The rows are added with corpus_writer.append (no delete, no overwrite). The catalog entry keeps every metadata key;
the listing totals and select-filter option counts are recounted from the live rows plus the new rows, the
qualification says what the release added, and the previous listing/summary/counts are stored under
metadata.release_bundle_unclassified_20261027.before so database/contracts/bundle-unclassified-release-20261027-v1.rollback.sql
restores them exactly. Writes metadata.<dataset>.before.json and metadata.<dataset>.after.json to the packet.
"""
import argparse
import copy
import hashlib
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import corpus_writer as cw  # noqa: E402

RELEASE_KEY = "release_bundle_unclassified_20261027"
RELEASE = "bundle-unclassified-2026-10-27"
NEW_OPTION_LABELS = {
    "court_documents": {"doc_type": {"other_unknown": "Not classified"}},
    "source_documents": {"agency": {"uncategorized": "Not classified"}},
}
QUALIFICATIONS = {
    "court_documents": (
        "Index of the downloaded court-website documents of two manifests (snapshot 2026-08-20): "
        "court_expansion_file_download_v2_4_2026-08-20, state_trial_court_acquisition_v1_2026-08-20. {total:,} records: "
        "{classified:,} with a document type from the source classifier and {added:,} it could not classify, shown as "
        "Not classified (released 2026-10-27; lacking a type is not inaccuracy). {held} completed_at is a download "
        "timestamp, never a legal effective date. Court joins are exact website-host matches only; a host shared by "
        "multiple courts is listed as ambiguous with candidates, never guessed. No county field exists anywhere in these "
        "manifests; none is inferred."
    ),
    "source_documents": (
        "Files downloaded on 2026-09-19 from official agency, court, legislature and science hosts (robots.txt respected, "
        "one request per host at a time). {total:,} records: {classified:,} with a document category and {added:,} the "
        "collection gave none, shown as Not classified (released 2026-10-27). {held} The list of addresses came from "
        "locally saved discovery lists, so this is a partial collection, not an agency's complete publications. Hosts that "
        "refused the crawler and were not retried: assets.americashealthrankings.org (robots_disallowed), apps.azsos.gov "
        "(robots_disallowed), prd.cdn.sos.ca.gov (robots_disallowed), www4.courts.ca.gov (robots_disallowed), sos.ga.gov "
        "(robots_disallowed), www.njconsumeraffairs.gov (forbidden), www.nycourts.gov (forbidden). A file is whatever the "
        "address returned on that date; it may since have been revised or withdrawn."
    ),
}
HELD_TEXT = {
    "duplicate_file_address_alias": "{n:,} byte-identical files at an address alias of a listed file are not listed twice.",
    "saved_bytes_not_the_named_file": "{n:,} saved copy that is a web page view instead of the named file is left out.",
}


def ids_md5(ids):
    """md5 of the ids sorted by code point and joined by newlines (Postgres: string_agg(id, E'\\n' order by id collate "C"))."""
    return hashlib.md5("\n".join(sorted(ids)).encode("utf-8")).hexdigest()


def option_label(dataset, name, value):
    label = NEW_OPTION_LABELS.get(dataset, {}).get(name, {}).get(value)
    if label:
        return label
    if dataset == "source_documents" and name == "type":
        return value.upper()
    return value


def recount_listing(listing, dataset, filter_rows, total, qualification):
    """Listing block with exact option counts over filter_rows (live + new); options keep their order, new ones follow."""
    out = copy.deepcopy(listing)
    out["total"] = total
    out["qualification"] = qualification
    for filt in out.get("filters", []):
        if filt.get("type") != "select" or "options" not in filt:
            continue
        name = filt["name"]
        counts = Counter(str(v) for row in filter_rows for v in (row.get(name) or []) if v is not None and str(v) != "")
        kept, known = [], set()
        for option in filt["options"]:
            value = str(option["value"])
            known.add(value)
            if counts.get(value):
                kept.append(dict(option, count=counts[value]))
        extra = sorted(((v, n) for v, n in counts.items() if v not in known), key=lambda kv: (-kv[1], kv[0]))
        kept += [{"count": n, "label": option_label(dataset, name, v), "value": v} for v, n in extra]
        filt["options"] = kept
    return out


def merge_metadata(dataset, live_metadata, live_columns, live_filters, new_rows, report):
    """The catalog metadata after the release: every live key kept; listing, summary and counts recomputed; before-state stored."""
    added = len(new_rows)
    total = len(live_filters) + added
    held = report.get("held") or {}
    held_text = " ".join(HELD_TEXT[k].format(n=n) for k, n in sorted(held.items()) if k in HELD_TEXT)
    qualification = QUALIFICATIONS[dataset].format(total=total, classified=len(live_filters), added=added, held=held_text).replace("  ", " ")
    filter_rows = list(live_filters) + [row["filters"] for row in new_rows]
    md = copy.deepcopy(live_metadata)
    md[RELEASE_KEY] = {
        "release": RELEASE,
        "added_rows": added,
        "first_ordinal": min(row["ordinal"] for row in new_rows) if new_rows and "ordinal" in new_rows[0] else None,
        "rows_sha256": report["rows_sha256"],
        "ids_sha256": report["ids_sha256"],
        "source_sha256": report["source_sha256"],
        "held": held,
        "before": {
            "metadata": {k: live_metadata.get(k) for k in ("listing", "listing_modes", "summary", "expected_records", "exported_records")},
            "columns": dict(live_columns),
        },
    }
    if isinstance(md.get("listing"), dict):
        md["listing"] = recount_listing(md["listing"], dataset, filter_rows, total, qualification)
    if isinstance(md.get("listing_modes"), dict):
        md["listing_modes"] = {k: recount_listing(v, dataset, filter_rows, total, qualification) if isinstance(v, dict) else v for k, v in md["listing_modes"].items()}
    summary = dict(md.get("summary") or {})
    summary.update({"records": total, "listing_records": total, "excluded_uncategorized": 0, "not_classified_records": added, "held_at_release": held})
    md["summary"] = summary
    md["expected_records"] = total
    md["exported_records"] = total
    return md


def manifest_digest(previous, rows_sha256):
    return hashlib.sha256(f"{previous or ''}\n{rows_sha256}".encode("utf-8")).hexdigest()


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_rows(path):
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--packet", required=True)
    parser.add_argument("--dataset", required=True, choices=sorted(QUALIFICATIONS))
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--resume", action="store_true", help="continue an interrupted --execute run")
    args = parser.parse_args(argv)

    report = read_json(os.path.join(args.packet, "report.json"))["datasets"][args.dataset]
    expected = read_json(os.path.join(args.packet, "live_before.json"))[args.dataset]
    rows_path = os.path.join(args.packet, report["rows_path"])
    if sha256_file(rows_path) != report["rows_sha256"]:
        raise SystemExit(f"{rows_path}: SHA-256 differs from report.json; rebuild the packet")
    rows = load_rows(rows_path)
    new_ids = {row["id"] for row in rows}

    live = cw._call("GET", f"corpus_datasets?id=eq.{args.dataset}&select=imported_records,expected_records,manifest_sha256,metadata")
    if not live:
        raise SystemExit(f"{args.dataset}: no catalog entry")
    live = live[0]
    live_rows = cw.fetch_all(args.dataset, select="id,filters")
    prior = [row for row in live_rows if row["id"] not in new_ids]
    if len(prior) != len(live_rows) and not args.resume:
        raise SystemExit(f"{args.dataset}: {len(live_rows) - len(prior)} release rows are already live; use --resume")
    if len(prior) != expected["count"] or ids_md5(row["id"] for row in prior) != expected["ids_md5"]:
        raise SystemExit(f"{args.dataset}: live rows ({len(prior)}) differ from the state the packet was prepared against ({expected['count']}, md5 {expected['ids_md5']}); re-run the dry-run SELECTs")
    if RELEASE_KEY in (live["metadata"] or {}) and not args.resume:
        raise SystemExit(f"{args.dataset}: metadata already carries {RELEASE_KEY}; already released")

    first = int(expected["max_ordinal"]) + 1
    for offset, row in enumerate(rows):
        row["ordinal"] = first + offset
    before_metadata = live["metadata"] or {}
    if RELEASE_KEY in before_metadata:  # resume after the patch: rebuild from the stored before-state
        stored = before_metadata[RELEASE_KEY]["before"]
        before_metadata = {**{k: v for k, v in before_metadata.items() if k != RELEASE_KEY}, **{k: v for k, v in stored["metadata"].items() if v is not None}}
        columns = stored["columns"]
    else:
        columns = {k: live[k] for k in ("imported_records", "expected_records", "manifest_sha256")}
    merged = merge_metadata(args.dataset, before_metadata, columns, [row["filters"] or {} for row in prior], rows, report)
    digest = manifest_digest(columns.get("manifest_sha256"), report["rows_sha256"])
    for name, value in (("before", live["metadata"]), ("after", merged)):
        with open(os.path.join(args.packet, f"metadata.{args.dataset}.{name}.json"), "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=1)
    summary = {"dataset": args.dataset, "live_before": len(prior), "append": len(rows), "after": len(prior) + len(rows), "first_ordinal": first, "manifest_sha256": digest, "execute": args.execute}
    print(json.dumps(summary))
    if not args.execute:
        return 0
    # source_documents rows carry up to 120,000 characters of text each: smaller requests.
    batch = 50 if args.dataset == "source_documents" else cw.BATCH
    cw.append(args.dataset, rows, metadata=merged, expected_before=len(prior), first_ordinal=first, manifest_sha256=digest, resume=args.resume, batch=batch)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
