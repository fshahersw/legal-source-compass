"""Reconcile New Jersey LCTOC listing/history rows with parsed statute spans.

This is a source concordance only. It does not expand printed ranges, decide
repeal/effect, or treat TOC history as statutory body text.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import zipfile


TOC_ENTRY = re.compile(r"^(?:N\.J\.S\.|C\.)\s+2A:(14|31)-")
CITATION = re.compile(r"(?<![A-Za-z0-9])2A:(?:14|31)-[0-9]+[A-Za-z]?(?:\.[0-9]+)?")
TITLE = re.compile(r"^TITLE\s+2A\.")
CHAPTER = re.compile(r"^Chapter\s+(\d+)\.")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def parse_toc(text):
    """Return the exact selected TOC citation blocks with Unicode spans."""
    lines = text.splitlines(keepends=True)
    offsets = []
    offset = 0
    for line in lines:
        offsets.append(offset)
        offset += len(line)

    title_2a = False
    chapter = None
    records = []
    i = 0
    while i < len(lines):
        line = lines[i].rstrip("\r\n")
        if TITLE.match(line.strip()):
            title_2a = True
            chapter = None
        elif re.match(r"^TITLE\s+", line.strip()):
            title_2a = False
            chapter = None
        chapter_match = CHAPTER.match(line.strip())
        if chapter_match:
            chapter = int(chapter_match[1]) if title_2a else None

        if title_2a and chapter in (14, 31) and TOC_ENTRY.match(line.strip()):
            start_i = i
            j = i + 1
            # Continuation/history rows are indented. Preserve them verbatim;
            # a blank line or next flush-left heading begins a new TOC item.
            while j < len(lines):
                next_line = lines[j].rstrip("\r\n")
                if not next_line.strip():
                    break
                if not next_line[:1].isspace():
                    break
                j += 1
            block = "".join(lines[start_i:j])
            first = line.strip()
            # Collect only complete citation tokens literally on the entry
            # line; printed ranges are not expanded.
            citation_ids = list(dict.fromkeys(m.group(0) for m in CITATION.finditer(first)))
            start = offsets[start_i]
            end = offsets[j] if j < len(lines) else len(text)
            # The source span ends at this record's last nonblank continuation,
            # not at the following blank separator.
            if j > start_i and j - 1 < len(offsets):
                end = offsets[j - 1] + len(lines[j - 1])
            records.append({
                "record_id": f"2A:{chapter}:line-{start_i + 1}:{sha(block.encode('utf-8'))[:12]}",
                "native_title": "2A",
                "native_chapter": chapter,
                "source_start_line": start_i + 1,
                "source_end_line": j,
                "source_span_unit": "unicode_code_points_in_normalized_LCTOC_TXT",
                "source_span": [start, end],
                "source_text_sha256": sha(block.encode("utf-8")),
                "entry_line": first,
                "explicit_citations_on_entry_line": citation_ids,
                "grouping_literal": " to " if re.search(r"\bto\b", first) else (" and " if re.search(r"\band\b", first) else None),
                "history_text": block,
            })
            i = j
            continue
        i += 1
    return records


def verify_lctoc(base, parsed):
    name = "LCTOC"
    receipt_path = base / f"{name}-TEXT.zip.receipt.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    raw_path = base / receipt["raw_file"]
    raw = raw_path.read_bytes()
    inventory = json.loads((base / f"{name}-TEXT.zip.receipt.json.inventory.json").read_text(encoding="utf-8"))
    if receipt.get("http_status") != 200 or len(raw) != receipt.get("bytes") or sha(raw) != receipt.get("sha256"):
        raise ValueError("LCTOC archive receipt mismatch")
    if inventory.get("archive_sha256") != sha(raw):
        raise ValueError("LCTOC member inventory archive hash mismatch")
    with zipfile.ZipFile(raw_path) as archive:
        if len(archive.infolist()) != 2 or set(archive.namelist()) != {"LCTOC.TXT", "LCTOC.RTF"}:
            raise ValueError("Unexpected LCTOC archive members")
        members = {info.filename: archive.read(info) for info in archive.infolist()}
    for member, data in members.items():
        inventory_row = next((row for row in inventory["entries"] if row["name"] == member), None)
        stored = parsed / "members" / member
        if not inventory_row or len(data) != inventory_row["bytes"] or sha(data) != inventory_row["sha256"]:
            raise ValueError(f"LCTOC raw member inventory mismatch: {member}")
        if not stored.exists() or stored.read_bytes() != data:
            raise ValueError(f"LCTOC parsed copy differs from original member: {member}")
    normalized = members["LCTOC.TXT"].decode("cp1252", errors="strict").replace("\r\n", "\n").encode("utf-8")
    toc_text_path = parsed / "members" / "LCTOC.TXT.utf8"
    if not toc_text_path.exists() or toc_text_path.read_bytes() != normalized:
        raise ValueError("LCTOC TXT normalized copy mismatch")
    return receipt, inventory, members, normalized.decode("utf-8")


def run(base, parsed, output):
    if output.exists():
        raise ValueError("Output exists; use a fresh versioned directory")
    report = json.loads((parsed / "parse-report.json").read_text(encoding="utf-8"))
    statutes_receipt = json.loads((base / "STATUTES-TEXT.zip.receipt.json").read_text(encoding="utf-8"))
    receipt, inventory, members, toc_text = verify_lctoc(base, parsed)
    records = parse_toc(toc_text)
    raw_rtf = members["LCTOC.RTF"]
    for record in records:
        rendered_line = record["entry_line"].encode("cp1252", errors="strict")
        count = raw_rtf.count(rendered_line)
        if count < 1:
            raise ValueError(f"TOC TXT entry line is not present literally in paired RTF: {record['record_id']}")
        record["paired_rtf_literal_entry_line_matches"] = count
        record["paired_rtf_member_sha256"] = sha(raw_rtf)
    statute_bytes = (parsed / "sections.jsonl").read_bytes()
    if sha(statute_bytes) != report["sections_sha256"]:
        raise ValueError("Statute section manifest hash mismatch")
    statute_rows = [
        json.loads(line)
        for line in statute_bytes.decode("utf-8").splitlines()
        if line
    ]
    body_rows = [
        row for row in statute_rows
        if row.get("native_title") == "2A"
        and (row.get("citation", "").startswith("2A:14-") or row.get("citation", "").startswith("2A:31-"))
    ]
    toc_by_citation = collections.defaultdict(list)
    toc_citation_source = []
    for record in records:
        for citation in record["explicit_citations_on_entry_line"]:
            toc_by_citation[citation].append(record)
            toc_citation_source.append(citation)

    mappings = []
    title_bytes = (parsed / "titles/2A.txt").read_bytes()
    title_text = title_bytes.decode("utf-8", errors="strict")
    for row in body_rows:
        start, end = row["title_span"]
        if (row["title_text_file"] != "titles/2A.txt"
                or sha(title_bytes) != row["title_text_sha256"]
                or not 0 <= start < end <= len(title_text)
                or sha(title_text[start:end].encode("utf-8")) != row["text_sha256"]):
            raise ValueError("Selected statute title/span hash mismatch")
        entries = toc_by_citation.get(row["citation"], [])
        mappings.append({
            "citation": row["citation"],
            "occurrence": row["occurrence"],
            "exact_body_match": True,
            "toc_status": "explicit_exact_citation" if entries else "no_exact_TOC_entry_line_reference",
            "toc_record_ids": [record["record_id"] for record in entries],
            "toc_entry_lines": [record["entry_line"] for record in entries],
            "body_source": {
                "source_url": report["source"]["STATUTES"]["source_url"],
                "archive_sha256": report["source"]["STATUTES"]["archive_sha256"],
                "raw_member": "STATUTES.TXT",
                "raw_member_sha256": next(m["sha256"] for m in report["source"]["STATUTES"]["members"] if m["name"] == "STATUTES.TXT"),
                "statutes_version_marker": report["statutes_version_marker"],
                "native_title": row["native_title"],
                "title_text_file": row["title_text_file"],
                "title_text_sha256": row["title_text_sha256"],
                "absolute_source_span": [row["start"], row["end"]],
                "title_relative_span": row["title_span"],
                "span_unit": row["span_unit"],
                "heading": row["heading"],
                "text_sha256": row["text_sha256"],
                "text_characters": row["text_characters"],
            },
        })

    body_citations = {row["citation"] for row in body_rows}
    toc_citations = set(toc_by_citation)
    toc_marker = next((line.strip() for line in toc_text.splitlines() if line.strip()), "")
    report_value = {
        "purpose": "Exact source concordance only; no range expansion, repeal conclusion, or calculator activation.",
        "toc_source": {
            "source_url": receipt["source_url"],
            "retrieved_at": receipt["finished_at"],
            "receipt_file": "LCTOC-TEXT.zip.receipt.json",
            "member_inventory_file": "LCTOC-TEXT.zip.receipt.json.inventory.json",
            "raw_file": receipt["raw_file"],
            "member_inventory_sha256": sha((base / "LCTOC-TEXT.zip.receipt.json.inventory.json").read_bytes()),
            "download_listing_sha256": receipt["inventory_sha256"],
            "archive_sha256": receipt["sha256"],
            "raw_bytes": receipt["bytes"],
            "raw_txt_sha256": next(m["sha256"] for m in inventory["entries"] if m["name"] == "LCTOC.TXT"),
            "raw_rtf_sha256": next(m["sha256"] for m in inventory["entries"] if m["name"] == "LCTOC.RTF"),
            "toc_version_marker": toc_marker,
            "text_encoding": "CP1252 decoded, CRLF normalized to LF, UTF-8 derivative",
            "toc_marker_scope": "TOC UPDATED to P.L.2026, c.30 and JR 2",
        },
        "statutes_source": {
            "source_url": report["source"]["STATUTES"]["source_url"],
            "retrieved_at": report["source"]["STATUTES"]["retrieved_at"],
            "receipt_file": "STATUTES-TEXT.zip.receipt.json",
            "raw_file": statutes_receipt["raw_file"],
            "archive_sha256": report["source"]["STATUTES"]["archive_sha256"],
            "raw_txt_sha256": next(m["sha256"] for m in report["source"]["STATUTES"]["members"] if m["name"] == "STATUTES.TXT"),
            "statutes_version_marker": report["statutes_version_marker"],
            "marker_difference": "TOC reports JR 2; STATUTES marker reports P.L.2026, c.30 and J.R.1. The captured markers differ; this reconciliation does not determine legal significance.",
        },
        "toc_records_title_2a_chapter_14_or_31": len(records),
        "explicit_toc_citation_references": len(toc_citation_source),
        "unique_explicit_toc_citations": len(toc_citations),
        "toc_exact_entry_lines_found_in_paired_rtf": len(records),
        "duplicate_explicit_toc_citation_references": sorted(c for c, n in collections.Counter(toc_citation_source).items() if n > 1),
        "parsed_body_occurrences_2a_chapter_14_or_31": len(body_rows),
        "parsed_body_distinct_citations_2a_chapter_14_or_31": len(body_citations),
        "exact_toc_citations_without_body_match": sorted(toc_citations - body_citations),
        "body_citations_without_exact_toc_entry_line_reference": sorted(body_citations - toc_citations),
        "range_expansion": "None. For printed ranges, only literal endpoint citations are recorded and mapped. Interior identities are not generated.",
        "publication_allowed": False,
        "calculation_activation_allowed": False,
    }

    output.mkdir(parents=True)
    (output / "toc-records.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in records), encoding="utf-8", newline="\n")
    (output / "body-toc-mapping.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in mappings), encoding="utf-8", newline="\n")
    (output / "reconciliation-report.json").write_text(json.dumps(report_value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md = [
        "# New Jersey LCTOC and statute-heading reconciliation",
        "",
        "This is an exact-source concordance. The LCTOC is a table of contents and amendment/history listing, not statutory text. No printed range was expanded and no repeal/effect conclusion is made.",
        "",
        f"- LCTOC records in Title 2A, Chapters 14 and 31: {len(records)}",
        f"- Explicit listed citations: {len(toc_citation_source)} references / {len(toc_citations)} distinct citations",
        f"- Parsed body sections in those chapters: {len(body_rows)} occurrences / {len(body_citations)} distinct citations",
        f"- TOC citations without exact parsed body key: {', '.join(sorted(toc_citations - body_citations)) or 'none'}",
        f"- Body citations without exact citation on a TOC entry line: {', '.join(sorted(body_citations - toc_citations)) or 'none'}",
        "",
        f"The TOC marker is `{report_value['toc_source']['toc_version_marker']}`. The statutes text marker is `{report['statutes_version_marker']}`. They differ as to JR number (TOC JR 2; statutes J.R.1); no legal significance is inferred.",
        "",
        "The TOC has an entry for `2A:14-18` marked `repealed 2023, c.250, s.51`, but the parsed statutes headings have no exact `2A:14-18` body key. This is an unmatched source reference, not a conclusion about the repeal or present law. The literal TOC range `2A:14-2a to 2A:14-2c` does not create an individual TOC link for body heading `2A:14-2b`; that intermediate citation is not expanded.",
        "",
        "`body-toc-mapping.jsonl` includes every parsed Title 2A citation in Chapters 14 and 31 with exact source/title spans and text hashes. Exact TOC citation links retain the full original entry/history block through `record_id`; missing exact TOC references are labelled as such, not interpreted as repeal or absence of law. Printed range endpoints are retained literally, without expanding interior citations.",
        "",
        f"Sources: [LCTOC archive](https://pub.njleg.gov/statutes/LCTOC-TEXT.zip), [STATUTES archive](https://pub.njleg.gov/statutes/STATUTES-TEXT.zip). Retrieval receipts, raw member hashes, normalized source bytes and parsed section hashes are in the audit JSON and source tree.",
        "",
        "The publisher markers and exact captured text do not independently establish current legal effect. Publication and calculator activation remain false.",
        "",
    ]
    (output / "README.md").write_text("\n".join(md), encoding="utf-8")
    return report_value


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=pathlib.Path, required=True, help="NJ firecrawl-1918 capture directory")
    parser.add_argument("--parsed", type=pathlib.Path, required=True, help="NJ parsed-v5 directory")
    parser.add_argument("--output", type=pathlib.Path, required=True, help="New private output directory")
    args = parser.parse_args()
    print(json.dumps(run(args.base, args.parsed, args.output), ensure_ascii=False, indent=2))
