"""Release the rows the 2026-09-27 bundle export left out because the source's classifier gave them no category.

Owner decision 2026-10-27 ("dont withhold any data. If its accurate and valuable, USE IT"): lacking a category is not
inaccuracy. At bundle build (SCRAPE deploy/exporters/generic_areas.py, is_categorized) these rows were dropped and
counted as corpus_datasets.metadata.summary.excluded_uncategorized:

  court_documents        doc_type == 'other_unknown' (basis no_family_no_pattern_match)   30,079 of 50,940
  source_documents       family == 'uncategorized'                                           381 of 993
  mdl_docket_documents   doc_type other/unknown/uncategorized                             30,846 of 35,862 (see --mdl-inspect)

This builder reads the same hash-pinned snapshot files the published rows came from (the SHA-256 values below are the
`source_files` recorded in each dataset's live metadata), and writes one corpus_records row per left-out file, labelled
"Not classified" (filter value kept as the source's own: doc_type 'other_unknown' / agency 'uncategorized').
The rows' category column stays the dataset id, as for every published row (the category crosswalk maps
court_documents and source_documents to 'mixed').

What stays out, and why (nothing is held for caution, keywords or unknown status):
  court_documents   a file whose bytes (SHA-256) and normalised address equal a row already published (or another
                    released row): the same document at an address alias. This is the rule of the 2026-10-07 cleanup
                    (issue cleanup_20261007_court_documents_url_norm_extra: host www-stripped, path decoded and
                    case-folded, scheme/query/fragment ignored).
  source_documents  a row whose saved bytes are an HTML page while its record names a non-HTML file (a github.com
                    page view saved for a .json address): the copy is not the document; inaccurate. (Office files
                    stored as .bin are the files themselves and are released.)
No row carries a source-reported seal or restriction: neither snapshot has such a field (court-website and agency
files downloaded from public addresses).

Titles: the saved files are not in private storage (corpus_artifacts rows for this collection are ready = false and
the objects are absent), so the project title rules (scripts/document-titles) cannot read them. A released court
document is labelled "<file name> (title not recorded)", as the published rows are when no title passed review; the
first-page heading recorded at indexing is kept as its own fact, never promoted to a title. Source documents keep the
title and title basis their collection recorded. No "Open saved copy" link is emitted (there is no stored copy).

  python -I -B scripts/enrichment/bundle_unclassified/build_unclassified.py \
      --court-index  <SCRAPE>/sources/court_document_library_20260919/index.sqlite3 \
      --source-db    <SCRAPE>/sources/source_directory_documents_20260919/documents.sqlite3 \
      --out          private/acq/release-bundle-uncategorized-exclusions
  python -I -B scripts/enrichment/bundle_unclassified/build_unclassified.py --mdl-inspect <unit>/documents.jsonl

No network. Reads SQLite read-only (immutable URI). Writes <dataset>.rows.jsonl, <dataset>.held.json, report.json.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from collections import Counter
from urllib.parse import unquote, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "document-titles"))
import derive_titles as dt  # noqa: E402

RELEASE = "bundle-unclassified-2026-10-27"
NOT_CLASSIFIED = "Not classified"

# source_files recorded in the live corpus_datasets metadata (read 2026-10-27).
COURT_INDEX_SHA256 = "38392e5e20fb435bdb703a9bc3a5f51f5fd4b9e29c6535ae43a23b5491509fc5"
SOURCE_DB_SHA256 = "4a23b7577218a12b36534650bbcef8beeb3de2c5fc594355ad968a68f080d06a"
MDL_DOCUMENTS_SHA256 = "28584e6c387816dda2a0242b727fda85314f43b25bae36b2c758be413fb57430"

COURT_UNCLASSIFIED = "other_unknown"
SOURCE_UNCLASSIFIED = "uncategorized"
MDL_UNCLASSIFIED = ("other", "unknown", "uncategorized", "other_unknown")

MANIFEST_LABELS = {
    "court_expansion_file_download_v2_4_2026-08-20": "Court expansion download (2026-08-20 snapshot)",
    "state_trial_court_acquisition_v1_2026-08-20": "State trial court acquisition (2026-08-20 snapshot)",
}
LINK_LABELS = {
    "none": "No court match",
    "matched": "Single court (exact host match)",
    "ambiguous": "Multiple candidate courts (host shared)",
}
COURT_QUALIFICATION = (
    "Downloaded government court-website file (manifest snapshot 2026-08-20; manifests "
    "court_expansion_file_download_v2_4_2026-08-20 and state_trial_court_acquisition_v1_2026-08-20). The source's "
    "document-type classifier matched no family or file-name pattern for this file (basis no_family_no_pattern_match), "
    "so it is shown as Not classified; lacking a type says nothing about the file's accuracy. completed_at is a download "
    "timestamp, never a legal effective date. Court joins are exact website-host matches only; a host shared by "
    "multiple courts is listed as ambiguous with candidates, never guessed. No county field exists in these manifests; "
    "none is inferred."
)
SOURCE_QUALIFICATION = (
    "Files downloaded on 2026-09-19 from official agency, court, legislature and science hosts (robots.txt respected, "
    "one request per host at a time). The list of addresses came from locally saved discovery lists, so this is a "
    "partial collection, not an agency's complete publications. The collection gave this file no document category; it "
    "is shown as Not classified. A file is whatever the address returned on that date; it may since have been revised "
    "or withdrawn."
)
TITLE_BASIS_NOT_RECORDED = (
    "Not recorded: the saved file is not in private storage, so the project title rules could not read it "
    "(released 2026-10-27). The label above is the file name, not a title."
)
FTS_TEXT_CAP = 120000
SECTION_TEXT_CAP = 60000


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def require_hash(path, expected, label):
    actual = sha256_file(path)
    if actual != expected:
        raise SystemExit(f"{label}: SHA-256 {actual} differs from the published source file {expected}; not the same snapshot")
    return actual


def connect_ro(path):
    uri = "file:" + os.path.abspath(path).replace("\\", "/") + "?mode=ro&immutable=1"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def values(value):
    if value is None or value == "":
        return []
    return [str(value)]


def flatten(value):
    """Search text in the shape of the exporter's flatten(): every value except URLs, in order."""
    if isinstance(value, dict):
        return " ".join(flatten(v) for k, v in value.items() if k not in ("url", "local_path"))
    if isinstance(value, (list, tuple)):
        return " ".join(flatten(v) for v in value)
    return str(value or "")


def binary_size(n):
    """Court-documents size cell: 1024-based, one decimal (33130 -> '32.4 KB')."""
    if n is None:
        return "Not recorded"
    if n < 1024:
        return f"{n} B"
    for unit, scale in (("KB", 1024), ("MB", 1024 ** 2), ("GB", 1024 ** 3)):
        if n < scale * 1024 or unit == "GB":
            return f"{n / scale:.1f} {unit}"


def decimal_size(n):
    """Source-documents size cell: 1000-based (21894 -> '22 KB', 2986489 -> '3.0 MB')."""
    if n is None:
        return "Not recorded"
    if n < 1000:
        return f"{n} B"
    if n < 1000 ** 2:
        return f"{round(n / 1000)} KB"
    if n < 1000 ** 3:
        return f"{n / 1000 ** 2:.1f} MB"
    return f"{n / 1000 ** 3:.1f} GB"


def normalised_address(url):
    """The 2026-10-07 alias rule: host www-stripped, path decoded and case-folded; scheme/query/fragment ignored."""
    parts = urlsplit(url or "")
    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host + unquote(parts.path or "").casefold()


def file_name(source_url, fallback):
    segment = unquote(urlsplit(source_url or "").path.rsplit("/", 1)[-1])
    return segment or (fallback or "")


def json_list(text):
    try:
        value = json.loads(text or "[]")
    except ValueError:
        return []
    return [str(v) for v in value] if isinstance(value, list) else []


def readable_heading(text):
    """The index's first-page heading, kept only when it is readable text (never as a title)."""
    if not text:
        return None
    clean = dt.clean(text)
    if not clean or dt.has_non_latin(clean) or dt.garbled(clean) or dt.BLANK_RE.search(clean):
        return None
    return clean


# ---------------------------------------------------------------- court_documents


def court_row(r):
    rid = r["id"]
    manifest = r["manifest"]
    manifest_label = MANIFEST_LABELS.get(manifest, manifest)
    link_status = r["link_status"]
    link_label = LINK_LABELS.get(link_status, link_status)
    state = r["state"] or ""
    court_state = r["court_state"] or ""
    court_id = r["court_id"] or ""
    source_url = r["source_url"] or r["final_url"] or ""
    name = file_name(source_url, r["filename"])
    title = f"{name} (title not recorded)"
    heading = readable_heading(r["title"])

    badges = [link_label]
    if state:
        badges.append("State: manifest jurisdiction code")
    elif court_state:
        badges.append("State: state of the matched court")

    facts = [
        ["Document type", NOT_CLASSIFIED],
        ["Type basis", r["doc_type_basis"]],
        ["Manifest", manifest_label],
    ]
    if r["wave"]:
        facts.append(["Manifest wave", r["wave"]])
    facts += [["Host (as recorded in the download)", r["host"] or "Not recorded"], ["Court match", link_label]]
    if link_status == "matched" and court_id:
        facts.append(["Court (court_spine id)", court_id])
        if court_state:
            facts.append(["State of the matched court (from court_spine, independent of jurisdiction_codes)", court_state])
    if link_status == "ambiguous":
        candidates = sorted(json_list(r["candidate_court_ids"]))
        if candidates:
            facts.append(["Candidate courts (host is shared, never guessed)", ", ".join(candidates)])
    if state:
        facts.append(["State (USPS, from manifest jurisdiction_codes)", state])
    facts += [
        ["Bytes", str(r["bytes"]) if r["bytes"] is not None else "Not recorded"],
        ["File type", r["extension"] or "Not recorded"],
        ["SHA-256 (at manifest build time)", r["sha256"]],
        ["Download started (download timestamp, not an effective date)", r["started_at"] or "Not recorded"],
        ["Download completed (download timestamp, not an effective date)", r["completed_at"] or "Not recorded"],
    ]
    if r["final_url"] and r["final_url"] != source_url:
        facts.append(["Address after redirects (as recorded)", r["final_url"]])
    facts += [["Title basis", TITLE_BASIS_NOT_RECORDED], ["Title extracted from first page text", "no"]]
    if heading:
        facts.append(["First-page heading recorded at indexing (verbatim; not reviewed as a title)", heading])
    facts += [
        ["File name (from the source address)", name],
        ["Document date", "Not recorded (the manifest holds download timestamps only, which are not document dates)"],
    ]

    source_link = {"url": source_url, "label": "Source URL (as recorded, not re-checked)"}
    detail_links = [source_link]
    if link_status == "matched" and court_id:
        detail_links.append({"url": f"#courts?id={court_id}", "label": "Court detail"})
    provenance = (
        f"Downloaded government court-website file from the {manifest_label} manifest. Host and file bytes are as "
        "recorded by the download pipeline; not re-fetched or re-verified here."
    )
    detail = {
        "id": rid,
        "title": title,
        "subtitle": NOT_CLASSIFIED,
        "qualification": COURT_QUALIFICATION,
        "facts": facts,
        "links": detail_links,
        "sections": [{"heading": "Provenance", "text": provenance}],
    }
    item = {
        "id": rid,
        "title": title,
        "subtitle": f"{NOT_CLASSIFIED} · {manifest_label}",
        "cells": {
            "document": title,
            "doc_type": NOT_CLASSIFIED,
            "jurisdiction": state or court_state or "—",
            "manifest": manifest_label,
            "size": binary_size(r["bytes"]),
            "host": r["host"] or "",
        },
        "badges": badges,
        "links": [source_link],
    }
    filters = {
        "state": values(state),
        "court": values(court_id),
        "doc_type": [COURT_UNCLASSIFIED],
        "file_type": values(r["extension"]),
        "manifest": values(manifest),
        "link_status": values(link_status),
        "host": values(r["host"]),
        "_listing": ["yes"],
    }
    return {
        "dataset": "court_documents",
        "id": rid,
        "category": "court_documents",
        "state": state,
        "county_geoids": [],
        "title": title,
        "source_url": source_url,
        "item": item,
        "detail": detail,
        "text": " ".join(part for part in (rid, title, NOT_CLASSIFIED, flatten({k: v for k, v in detail.items() if k not in ("id", "title", "subtitle")})) if part),
        "filters": filters,
    }


def build_court(index_path):
    con = connect_ro(index_path)
    try:
        rows = [dict(r) for r in con.execute("SELECT * FROM documents ORDER BY id")]
    finally:
        con.close()
    published = [r for r in rows if r["doc_type"] != COURT_UNCLASSIFIED]
    candidates = [r for r in rows if r["doc_type"] == COURT_UNCLASSIFIED]
    seen = {}
    for r in published:
        seen.setdefault((r["sha256"], normalised_address(r["source_url"] or r["final_url"])), ("published", r["id"]))
    # Survivor among unclassified aliases: address without a query first, then the shorter address, then the id.
    candidates.sort(key=lambda r: (bool(urlsplit(r["source_url"] or "").query), len(r["source_url"] or ""), r["id"]))
    out, held = [], []
    for r in candidates:
        key = (r["sha256"], normalised_address(r["source_url"] or r["final_url"]))
        if key in seen:
            kind, survivor = seen[key]
            held.append({
                "id": r["id"],
                "reason": "duplicate_file_address_alias",
                "detail": f"Byte-identical file (SHA-256 {r['sha256']}) at an address that differs from {kind} row {survivor} only by URL normalisation (host www-stripped, path decoded/case-folded, scheme/query/fragment ignored).",
                "source_url": r["source_url"],
                "survivor_id": survivor,
                "survivor_is": kind,
            })
            continue
        seen[key] = ("released", r["id"])
        out.append(court_row(r))
    out.sort(key=lambda row: row["id"])
    return out, held, {"native_rows": len(rows), "published_snapshot_rows": len(published), "unclassified_rows": len(candidates)}


# ---------------------------------------------------------------- source_documents


def saved_extension(raw_path):
    tail = (raw_path or "").rsplit("/", 1)[-1]
    return tail.rsplit(".", 1)[-1].lower() if "." in tail else ""


def source_row(r, body):
    rid = str(r["id"])
    ext = (r["ext"] or "").lower()
    url = r["url"]
    text_chars = r["text_chars"] or 0
    has_text = bool(text_chars)
    badges = [ext.upper()] if ext else []
    if not has_text:
        badges.append("No extractable text (scan or unsupported)")
    size = decimal_size(r["bytes"])
    facts = [
        ["Source address", url],
        ["Document category", NOT_CLASSIFIED],
        ["Host", r["host"]],
        ["Title basis", r["title_basis"] or "Not recorded"],
        ["File", f"{r['filename'] or file_name(url, '')} ({size})"],
        ["Saved (download time)", r["fetched_at"] or "Not recorded"],
        ["Published / effective date", "Not recorded by the download; read the document"],
        ["SHA-256 (prefix)", (r["sha256"] or "")[:16] + "…"],
    ]
    sections = []
    full_text = ""
    if has_text:
        full_text = body or ""
        complete = r["text_sha256"] and hashlib.sha256(full_text.encode("utf-8")).hexdigest() == r["text_sha256"]
        if not complete:
            facts.append([
                "Search text",
                f"First {len(full_text):,} of {text_chars:,} characters: the full text file is not in this snapshot; the index holds this prefix.",
            ])
        heading = "Extracted text" if text_chars <= SECTION_TEXT_CAP and complete else f"Extracted text (first {min(SECTION_TEXT_CAP, len(full_text)):,} of {text_chars:,} characters)"
        sections.append({"heading": heading, "text": full_text[:SECTION_TEXT_CAP]})
    else:
        facts.append(["Extracted text", f"None: scanned or unsupported format (status: {r['extraction_status'] or 'not recorded'})"])
    links = [{"url": url, "label": "Source address"}]
    title = r["title"] or f"{file_name(url, r['filename'])} (title not recorded)"
    detail = {"title": title, "subtitle": r["host"], "qualification": SOURCE_QUALIFICATION, "facts": facts, "links": links, "sections": sections}
    item = {
        "id": rid,
        "title": title,
        "subtitle": url,
        "cells": {"size": size, "type": ext.upper(), "saved": (r["fetched_at"] or "")[:10], "agency": NOT_CLASSIFIED},
        "badges": badges,
        "links": links,
    }
    return {
        "dataset": "source_documents",
        "id": rid,
        "category": "source_documents",
        "state": "",
        "county_geoids": [],
        "title": title,
        "source_url": url,
        "item": item,
        "detail": detail,
        "text": full_text if has_text and full_text else flatten(detail),
        "filters": {"agency": [SOURCE_UNCLASSIFIED], "type": values(ext), "text": ["yes" if has_text else "no"], "_listing": ["yes"]},
    }


def build_source(db_path):
    con = connect_ro(db_path)
    try:
        rows = [dict(r) for r in con.execute(
            "SELECT d.*, c.c2 AS body FROM docs d LEFT JOIN docs_fts_content c ON c.id = d.id ORDER BY d.id")]
    finally:
        con.close()
    candidates = [r for r in rows if (r["family"] or SOURCE_UNCLASSIFIED) == SOURCE_UNCLASSIFIED]
    out, held = [], []
    for r in candidates:
        saved = saved_extension(r["raw_path"])
        ext = (r["ext"] or "").lower()
        # Office files are stored as .bin by the collector; only an HTML page saved for a non-HTML address is a mismatch.
        if saved in ("html", "htm") and ext not in ("html", "htm", ""):
            held.append({
                "id": str(r["id"]),
                "reason": "saved_bytes_not_the_named_file",
                "detail": f"The record names a .{ext} file but the saved bytes are a .{saved} file ({r['raw_path']}): the copy is a page view of {r['host']}, not the file; inaccurate as a document record.",
                "source_url": r["url"],
            })
            continue
        out.append(source_row(r, r.get("body")))
    out.sort(key=lambda row: int(row["id"]))
    return out, held, {"native_rows": len(rows), "published_snapshot_rows": len(rows) - len(candidates), "unclassified_rows": len(candidates)}


# ---------------------------------------------------------------- mdl_docket_documents (inspection only)


def inspect_mdl(path):
    """The MDL bundle (sources/mdl_docket_documents_20260919) is not on this machine; inspect it before a row builder is written."""
    require_hash(path, MDL_DOCUMENTS_SHA256, "mdl documents.jsonl")
    keys, doc_types, sealed = Counter(), Counter(), Counter()
    total = 0
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            total += 1
            keys.update(row.keys())
            doc_type = str(row.get("doc_type") or "").strip().lower()
            unclassified = not doc_type or doc_type in MDL_UNCLASSIFIED
            doc_types["unclassified" if unclassified else "classified"] += 1
            for key in ("is_sealed", "sealed"):
                if key in row:
                    sealed[(key, bool(row[key]), unclassified)] += 1
    return {"rows": total, "keys": dict(keys), "doc_type": dict(doc_types), "sealed": {f"{k}={v} unclassified={u}": n for (k, v, u), n in sealed.items()}}


# ---------------------------------------------------------------- packet


def facet_counts(rows, keys):
    counts = {key: Counter() for key in keys}
    for row in rows:
        for key in keys:
            for value in row["filters"].get(key, []):
                counts[key][value] += 1
    return {key: dict(sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))) for key, c in counts.items()}


def ids_digest(ids):
    return hashlib.sha256("\n".join(sorted(ids)).encode("utf-8")).hexdigest()


def write_dataset(out_dir, dataset, rows, held):
    path = os.path.join(out_dir, f"{dataset}.rows.jsonl")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    with open(os.path.join(out_dir, f"{dataset}.held.json"), "w", encoding="utf-8") as handle:
        json.dump(held, handle, ensure_ascii=False, indent=1)
    return {"rows_path": os.path.basename(path), "rows_sha256": sha256_file(path), "ids_sha256": ids_digest(r["id"] for r in rows)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--court-index")
    parser.add_argument("--source-db")
    parser.add_argument("--out")
    parser.add_argument("--mdl-inspect")
    args = parser.parse_args(argv)
    if args.mdl_inspect:
        print(json.dumps(inspect_mdl(args.mdl_inspect), indent=1))
        return 0
    if not (args.court_index and args.source_db and args.out):
        parser.error("--court-index, --source-db and --out are required")
    os.makedirs(args.out, exist_ok=True)
    report = {"release": RELEASE, "datasets": {}}

    require_hash(args.court_index, COURT_INDEX_SHA256, "court index.sqlite3")
    rows, held, counts = build_court(args.court_index)
    files = write_dataset(args.out, "court_documents", rows, held)
    report["datasets"]["court_documents"] = {
        **counts, **files, "source_sha256": COURT_INDEX_SHA256, "released": len(rows),
        "held": dict(Counter(h["reason"] for h in held)),
        "facets": facet_counts(rows, ("state", "doc_type", "file_type", "manifest", "link_status", "host")),
        "titles": {"heading_fact": sum(1 for r in rows if any(f[0].startswith("First-page heading") for f in r["detail"]["facts"]))},
    }

    require_hash(args.source_db, SOURCE_DB_SHA256, "source documents.sqlite3")
    rows, held, counts = build_source(args.source_db)
    files = write_dataset(args.out, "source_documents", rows, held)
    report["datasets"]["source_documents"] = {
        **counts, **files, "source_sha256": SOURCE_DB_SHA256, "released": len(rows),
        "held": dict(Counter(h["reason"] for h in held)),
        "facets": facet_counts(rows, ("agency", "type", "text")),
        "hosts": dict(Counter(r["item"]["subtitle"].split("/")[2] for r in rows).most_common()),
    }
    report["datasets"]["mdl_docket_documents"] = {
        "released": 0,
        "status": "not built: sources/mdl_docket_documents_20260919 (documents.jsonl SHA-256 " + MDL_DOCUMENTS_SHA256 + ") is not on this machine",
    }
    with open(os.path.join(args.out, "report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=1)
    print(json.dumps({k: {x: v.get(x) for x in ("released", "held", "rows_sha256", "ids_sha256")} for k, v in report["datasets"].items()}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
