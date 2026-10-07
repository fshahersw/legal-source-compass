"""Parse and stage the captured Kentucky Revised Statutes publisher packet.

Primary extraction uses PyMuPDF.  The independent audit uses pypdf and the
publisher's separately captured HTML inventory.  Nothing in this script writes
to a database or network service.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
import os
import pathlib
import re
import shutil
import sys
import time
from typing import Iterable

import pymupdf
from pypdf import PdfReader

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))
from provenance_fetch import sha256_file, verify_store  # noqa: E402

import parse_index  # noqa: E402

BASE = "https://apps.legislature.ky.gov/law/statutes/"
CODE_ID = "ky-revised-statutes"
CODE_NAME = "Kentucky Revised Statutes"
EDITION = "Kentucky Revised Statutes - Unofficial Online Version"
CURRENCY_SESSION = "Includes enactments through the 2026 Regular Session"
CURRENCY_UPDATED = "The KRS database was last updated on 10/05/2026"
CURRENCY_STATEMENT = CURRENCY_SESSION + "\n" + CURRENCY_UPDATED
PARSER_NAME = "ky-lrc-pdf"
PARSER_VERSION = "1"
REPORT_AGENT = "bc-1f0b5008-152e-57f7-b6b9-337bbfbe2bb0"
STATUS_RE = re.compile(
    r"^(Repealed(?:,|\.|$)|Reserved(?:\.|$)|Renumbered as\b|Transferred to\b|"
    r"Expired(?:,|\.|$)|Vacant(?:\.|$)|Not yet utilized\b|Superseded\b)",
    re.I,
)
HEADING_EFFECTIVE_RE = re.compile(r"(\(Effective\b[^)]*\))", re.I)
SECTION_ID_RE = (
    r"^[0-9]+[A-Z]?(?:\.[0-9]+[A-Z]?(?:-[0-9]+[A-Z]?)?)"
    r"(?::occurrence:[1-9][0-9]*)?$"
)


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def json_bytes(value, *, pretty=False) -> bytes:
    if pretty:
        return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode()
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def hash_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def write_json(path: pathlib.Path, value, *, pretty=True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json_bytes(value, pretty=pretty))


def receipt_index(root: pathlib.Path):
    receipts = [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]
    successful = {}
    for receipt in receipts:
        if receipt.get("ok") and receipt.get("retrieval_method") == "direct":
            successful.setdefault(receipt["url"], receipt)
    return receipts, successful


def raw_bytes(root: pathlib.Path, receipt: dict) -> bytes:
    return (root / receipt["stored_path"]).read_bytes()


def section_citation(unit: dict, section: dict) -> str:
    if not unit.get("chapter_first"):
        raise ValueError("section unit has no parent chapter: " + unit["chapter_label"])
    return unit["chapter_first"] + section["section_suffix"]


def build_plan(root: pathlib.Path, successful: dict):
    if BASE not in successful:
        raise ValueError("captured title index is missing")
    index = parse_index.parse_index(raw_bytes(root, successful[BASE]))
    units = index["chapters"]
    missing_units = [BASE + unit["href"] for unit in units if unit["href"] and BASE + unit["href"] not in successful]
    if missing_units:
        raise ValueError("missing %d linked unit pages; first: %s" % (len(missing_units), missing_units[0]))

    plan = []
    currencies = collections.Counter()
    run_dates = collections.Counter()
    seen_native_ids = set()
    for unit in units:
        if not unit["href"]:
            unit["sections"] = []
            continue
        unit_url = BASE + unit["href"]
        chapter = parse_index.parse_chapter(raw_bytes(root, successful[unit_url]))
        unit["page_title"] = chapter["page_title"]
        unit["sections"] = chapter["sections"]
        currencies[chapter["currency_statement"]] += 1
        run_dates[chapter["run_date"]] += 1
        for section in chapter["sections"]:
            citation = section_citation(unit, section)
            url = BASE + section["href"]
            if section["native_id"] in seen_native_ids:
                raise ValueError("duplicate publisher native section id: " + section["native_id"])
            seen_native_ids.add(section["native_id"])
            plan.append({"unit": unit, "section": section, "citation_path": citation, "url": url})

    missing_sections = [item["url"] for item in plan if item["url"] not in successful]
    if missing_sections:
        raise ValueError(
            "missing %d section PDFs; first: %s" % (len(missing_sections), missing_sections[0])
        )
    if currencies != collections.Counter({CURRENCY_SESSION: sum(currencies.values())}):
        raise ValueError("unit currency statements are inconsistent: %r" % currencies)
    if run_dates != collections.Counter({"10/05/2026": sum(run_dates.values())}):
        raise ValueError("unit database update dates are inconsistent: %r" % run_dates)
    return index, units, plan


def normalized_layout_text(value: str, *, with_end_map=False):
    """Collapse PDF line layout without changing the retained source substring.

    Word commonly emits a printed ``--`` as ``-\\n-`` and wraps hyphenated words
    after the hyphen.  The optional map points each normalized character to the
    corresponding end offset in the original string.
    """
    output = []
    end_map = []
    index = 0
    while index < len(value):
        if not value[index].isspace():
            output.append(value[index])
            end_map.append(index + 1)
            index += 1
            continue
        end = index + 1
        while end < len(value) and value[end].isspace():
            end += 1
        previous = output[-1] if output else ""
        following = value[end] if end < len(value) else ""
        if previous == "-" or following in ".,;:)":
            index = end
            continue
        if output and output[-1] != " " and following:
            output.append(" ")
            end_map.append(end)
        index = end
    normalized = "".join(output).strip()
    if with_end_map:
        leading = len("".join(output)) - len("".join(output).lstrip())
        trailing = len("".join(output).rstrip())
        return normalized, end_map[leading:trailing]
    return normalized


def split_section_text(raw_text: str, citation_path: str, heading: str):
    """Split one publisher PDF text while retaining body offsets in ``raw_text``."""
    raw_text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    normalized, end_map = normalized_layout_text(raw_text, with_end_map=True)
    expected = normalized_layout_text(citation_path + " " + heading)
    if not normalized.startswith(expected):
        raise ValueError("PDF heading does not match inventory heading")
    content_start = end_map[len(expected) - 1]
    while content_start < len(raw_text) and raw_text[content_start].isspace():
        content_start += 1
    history_match = re.search(r"(?m)^History\s*:", raw_text[content_start:])
    history_start = content_start + history_match.start() if history_match else len(raw_text)
    effective_match = re.search(r"(?m)^Effective\s*:", raw_text[content_start:history_start])
    effective_start = content_start + effective_match.start() if effective_match else history_start

    body_region = raw_text[content_start:effective_start]
    left = len(body_region) - len(body_region.lstrip())
    right = len(body_region.rstrip())
    body_start = content_start + left
    body_end = content_start + right
    text = raw_text[body_start:body_end]
    if not text and status_label(heading):
        heading_lead = re.match(r"^\s*" + re.escape(citation_path) + r"\s+", raw_text)
        if not heading_lead:
            raise ValueError("could not locate status heading text")
        heading_region = raw_text[heading_lead.end():content_start]
        left = len(heading_region) - len(heading_region.lstrip())
        right = len(heading_region.rstrip())
        body_start = heading_lead.end() + left
        body_end = heading_lead.end() + right
        text = raw_text[body_start:body_end]
    effective = raw_text[effective_start:history_start].strip() or None
    history = raw_text[history_start:].strip() or None
    if effective is None:
        match = HEADING_EFFECTIVE_RE.search(heading)
        effective = match.group(1) if match else None
    return {
        "raw_text": raw_text,
        "text": text,
        "body_start": body_start,
        "body_end": body_end,
        "effective": effective,
        "history": history,
    }


def extract_pdf(root: pathlib.Path, receipt: dict, citation_path: str, heading: str):
    body = raw_bytes(root, receipt)
    if not body.startswith(b"%PDF-"):
        raise ValueError("successful section response is not a PDF")
    with pymupdf.open(stream=body, filetype="pdf") as document:
        page_count = len(document)
        text = "".join(page.get_text("text") for page in document)
    if not text:
        raise ValueError("PDF has no extractable text")
    split = split_section_text(text, citation_path, heading)
    split["pages"] = page_count
    return split


def hierarchy(unit: dict, citation_path: str, section_heading: str):
    title_label = unit["title_label"]
    title = next(
        (
            part
            for part in [title_label]
            if part
        ),
        None,
    )
    title_match = re.match(r"TITLE\s+([IVXLC]+)\s+(.*)$", title or "")
    values = [
        {
            "level": "title",
            "number": title_match.group(1) if title_match else None,
            "heading": title_match.group(2) if title_match else title,
        },
        {
            "level": "chapter",
            "number": unit["chapter_first"],
            "heading": unit["chapter_heading"],
        },
    ]
    if unit["unit_level"] != "chapter":
        values.append(
            {
                "level": unit["unit_level"],
                "number": unit["unit_number"],
                "heading": unit["unit_heading"],
            }
        )
    values.append({"level": "section", "number": citation_path, "heading": section_heading})
    return values


def status_label(heading: str):
    return heading if STATUS_RE.match(heading) else None


def status_category(label: str):
    lowered = label.lower()
    if lowered.startswith("not yet utilized"):
        return "Not yet utilized"
    return label.split(None, 1)[0].rstrip(",.").title()


def inventory_rows(index: dict, units: list[dict], plan: list[dict]) -> Iterable[dict]:
    by_unit = collections.defaultdict(list)
    for item in plan:
        by_unit[id(item["unit"])].append(item)
    emitted_titles = set()
    for unit in units:
        ordinal = unit["title_ordinal"]
        if ordinal not in emitted_titles:
            title = index["titles"][ordinal - 1]
            emitted_titles.add(ordinal)
            yield {
                "level": "title",
                "native_id": "title:" + title["title_roman"],
                "number": title["title_roman"],
                "heading": title["title_heading"],
                "url": BASE,
            }
        yield {
            "level": unit["unit_level"],
            "native_id": ("unit:" + unit["chapter_id"] if unit["chapter_id"] else
                          "placeholder:%s:%s" % (ordinal, unit["chapter_label"])),
            "number": unit["unit_number"],
            "heading": unit["unit_heading"],
            "url": BASE + unit["href"] if unit["href"] else None,
            "title_ordinal": ordinal,
            "chapter_number": unit["chapter_first"],
            "label": unit["chapter_label"],
            "linked": bool(unit["href"]),
        }
        for item in by_unit[id(unit)]:
            section = item["section"]
            yield {
                "level": "section",
                "native_id": section["native_id"],
                "number": item["citation_path"],
                "heading": section["heading"],
                "url": item["url"],
                "unit_native_id": "unit:" + unit["chapter_id"],
            }


def build_source(receipts: list[dict]):
    proxied = [
        {
            "url": receipt["url"],
            "retrieval_method": receipt["retrieval_method"],
            "retrieved_at": receipt["retrieved_at"],
        }
        for receipt in receipts
        if receipt.get("ok") and str(receipt.get("retrieval_method", "")).startswith("proxied:")
    ]
    return {
        "schema_version": "state-code-source/1",
        "state": "KY",
        "code_id": CODE_ID,
        "code_name": CODE_NAME,
        "publisher": "Kentucky Legislative Research Commission",
        "publisher_url": "https://legislature.ky.gov/",
        "official_urls": [
            BASE,
            "https://legislature.ky.gov/Law/Statutes/Pages/default.aspx",
            "https://legislature.ky.gov/Law/Statutes/Pages/StatRevInfo.aspx",
            "https://legislature.ky.gov/Law/Statutes/Pages/KRSEDS.aspx",
        ],
        "edition": EDITION,
        "currency": {
            "statement": CURRENCY_STATEMENT,
            "as_of": None,
            "session_statement": CURRENCY_SESSION,
            "database_update_statement": CURRENCY_UPDATED,
        },
        "official_status_note": (
            "The statutes provided on this website are an unofficial posting of the Kentucky "
            "Revised Statutes as maintained in the official internal statutory database of the "
            "Kentucky Legislative Research Commission."
        ),
        "licence_terms_notes": [
            (
                "Under KRS 61.874, it is unlawful to use any records available on this site for "
                "a commercial purpose without agreement with the Legislative Research Commission."
            ),
            (
                "Placing these files on the Internet does not alter or relinquish any copyright "
                "or proprietary interest or entitlement of the Commonwealth of Kentucky relating "
                "to this information."
            ),
            "No terms page, licence acceptance, CAPTCHA, or authentication gate was encountered.",
        ],
        "gates": [],
        "proxied_items": proxied,
        "scope_exclusions": [
            (
                "The separately linked Kentucky Rules of Evidence page is not part of the "
                "Kentucky Revised Statutes title/chapter hierarchy and was not parsed as KRS."
            )
        ],
    }


def raw_manifest_entries(root: pathlib.Path, receipts: list[dict]):
    grouped = {}
    for receipt in receipts:
        if not receipt.get("ok"):
            continue
        sha = receipt["sha256"]
        entry = grouped.setdefault(
            sha,
            {
                "kind": "publisher_original",
                "path": receipt["stored_path"],
                "sha256": sha,
                "bytes": receipt["bytes"],
                "retrieval_method": receipt["retrieval_method"],
                "sources": [],
            },
        )
        entry["sources"].append(
            {
                "url": receipt["url"],
                "final_url": receipt.get("final_url"),
                "retrieved_at": receipt["retrieved_at"],
                "status": receipt.get("status"),
                "label": receipt.get("label"),
            }
        )
    return sorted(grouped.values(), key=lambda item: item["sha256"])


def gzip_file(source: pathlib.Path, destination: pathlib.Path):
    with source.open("rb") as incoming, destination.open("wb") as raw_out:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_out, mtime=0, compresslevel=9) as outgoing:
            shutil.copyfileobj(incoming, outgoing, 1 << 20)


def independent_audit(root: pathlib.Path, plan: list[dict], successful: dict):
    citation_mismatches = []
    failures = []
    normalized_matches = 0
    primary_characters = 0
    independent_characters = 0
    page_count = 0
    for number, item in enumerate(plan, 1):
        receipt = successful[item["url"]]
        path = root / receipt["stored_path"]
        try:
            reader = PdfReader(str(path))
            extracted = "".join((page.extract_text() or "") for page in reader.pages)
            page_count += len(reader.pages)
            first = re.match(r"\s*(\S+)", extracted)
            observed = first.group(1) if first else None
            if observed != item["citation_path"]:
                citation_mismatches.append(
                    {"native_id": item["section"]["native_id"], "expected": item["citation_path"],
                     "observed": observed}
                )
            primary = extract_pdf(
                root, receipt, item["citation_path"], item["section"]["heading"]
            )["raw_text"]
            pnorm = re.sub(r"\s+", "", primary)
            inorm = re.sub(r"\s+", "", extracted)
            primary_characters += len(pnorm)
            independent_characters += len(inorm)
            normalized_matches += pnorm == inorm
        except Exception as exc:  # retained in the audit, never silently dropped
            failures.append(
                {"native_id": item["section"]["native_id"], "error": "%s: %s" %
                 (type(exc).__name__, str(exc)[:300])}
            )
        if number % 2000 == 0:
            print("audit", number, "/", len(plan), flush=True)
    ratio = independent_characters / primary_characters if primary_characters else 0
    return {
        "method": "pypdf extraction and first-token citation, independent of primary PyMuPDF parser",
        "pdfs_checked": len(plan),
        "pages_checked": page_count,
        "citation_matches": len(plan) - len(citation_mismatches) - len(failures),
        "citation_mismatches": len(citation_mismatches),
        "citation_mismatch_examples": citation_mismatches[:25],
        "extraction_failures": len(failures),
        "failure_examples": failures[:25],
        "normalized_full_text_matches": normalized_matches,
        "primary_non_whitespace_characters": primary_characters,
        "independent_non_whitespace_characters": independent_characters,
        "independent_to_primary_character_ratio": ratio,
        "passed": not failures and not citation_mismatches and 0.995 <= ratio <= 1.005,
    }


def sample_rows(sections_path: pathlib.Path):
    chosen = []
    status_seen = set()
    for number, line in enumerate(sections_path.read_text(encoding="utf8").splitlines(), 1):
        row = json.loads(line)
        take = number <= 8 or number % 5000 == 0
        label = row.get("status_label")
        status = label.split(",", 1)[0].split(" ", 1)[0].lower() if label else None
        if status and status not in status_seen:
            status_seen.add(status)
            take = True
        if row["occurrence"] > 1 or (row.get("effective") and "2027" in row["effective"]):
            take = True
        if take and len(chosen) < 25:
            chosen.append(row)
    return chosen


def build(root: pathlib.Path, store: pathlib.Path):
    receipts, successful = receipt_index(root)
    checked, verification_problems = verify_store(root)
    if verification_problems:
        raise ValueError("verify_store failed for %d objects" % len(verification_problems))
    index, units, plan = build_plan(root, successful)
    print("plan", len(index["titles"]), "titles", len(units), "units", len(plan), "sections")

    parsed = root / "parsed"
    staged = root / "staged"
    work = root / (".build-%d" % os.getpid())
    if work.exists():
        shutil.rmtree(work)
    (work / "parsed").mkdir(parents=True)
    (work / "staged" / "chapters").mkdir(parents=True)

    inventory_path = work / "parsed" / "inventory.jsonl"
    with inventory_path.open("w", encoding="utf8") as handle:
        for row in inventory_rows(index, units, plan):
            handle.write(json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n")

    citation_totals = collections.Counter(item["citation_path"] for item in plan)
    citation_seen = collections.Counter()
    derivative_entries = []
    heading_mismatches = []
    sections_path = work / "parsed" / "sections.jsonl"
    parsed_count = 0
    empty_bodies = 0
    status_counts = collections.Counter()
    total_pages = 0
    with sections_path.open("w", encoding="utf8") as sections_out:
        for item in plan:
            section = item["section"]
            receipt = successful[item["url"]]
            try:
                extracted = extract_pdf(
                    root, receipt, item["citation_path"], section["heading"]
                )
            except ValueError as exc:
                heading_mismatches.append(
                    {"native_id": section["native_id"], "citation": item["citation_path"],
                     "error": str(exc)}
                )
                continue
            derivative_body = extracted["raw_text"].encode("utf8")
            derivative_sha = hash_bytes(derivative_body)
            derivative_rel = "chapters/" + derivative_sha
            (work / "staged" / derivative_rel).write_bytes(derivative_body)
            citation_seen[item["citation_path"]] += 1
            occurrence = citation_seen[item["citation_path"]]
            repeated = citation_totals[item["citation_path"]] > 1
            intake_path = (
                "%s:occurrence:%d" % (item["citation_path"], occurrence)
                if repeated else item["citation_path"]
            )
            label = status_label(section["heading"])
            unit_key = "section:" + section["native_id"]
            row = {
                "state": "KY",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION,
                "native_id": section["native_id"],
                "identity_kind": "publisher_native_id",
                "intake_citation_path": intake_path,
                "citation": "KRS " + item["citation_path"],
                "citation_path": hierarchy(item["unit"], item["citation_path"], section["heading"]),
                "heading": section["heading"],
                "text": extracted["text"],
                "history": extracted["history"],
                "status_label": label,
                "effective": extracted["effective"],
                "currency": {"statement": CURRENCY_STATEMENT, "as_of": None},
                "source": {
                    "url": item["url"],
                    "receipt_sha256": receipt["sha256"],
                    "derivative_sha256": derivative_sha,
                    "member": derivative_rel,
                    "unit_key": unit_key,
                    "span": {
                        "unit": "unicode_code_points",
                        "start": extracted["body_start"],
                        "end": extracted["body_end"],
                    },
                },
                "text_sha256": hash_bytes(extracted["text"].encode()),
                "occurrence": occurrence,
            }
            span = row["source"]["span"]
            if extracted["raw_text"][span["start"]:span["end"]] != row["text"]:
                raise ValueError("section derivative span mismatch for " + row["native_id"])
            sections_out.write(
                json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n"
            )
            derivative_entries.append(
                {
                    "kind": "unit_text_derivative",
                    "unit_key": unit_key,
                    "unit_kind": "publisher_section_pdf",
                    "chapter_number": item["unit"]["chapter_first"],
                    "path": derivative_rel,
                    "sha256": derivative_sha,
                    "bytes": len(derivative_body),
                    "text_code_points": len(extracted["raw_text"]),
                    "retrieval_method": "derived:pymupdf",
                    "url": item["url"],
                    "retrieved_at": receipt["retrieved_at"],
                    "original_sha256": receipt["sha256"],
                }
            )
            parsed_count += 1
            total_pages += extracted["pages"]
            empty_bodies += not bool(extracted["text"])
            if label:
                status_counts[status_category(label)] += 1
            if len(derivative_entries) % 2000 == 0:
                print("parsed sections", len(derivative_entries), "/", len(plan), flush=True)

    if heading_mismatches:
        raise ValueError(
            "PDF/inventory heading mismatch for %d sections; first: %r" %
            (len(heading_mismatches), heading_mismatches[0])
        )
    if parsed_count != len(plan):
        raise ValueError("parsed count %d != expected %d" % (parsed_count, len(plan)))

    source = build_source(receipts)
    source_path = work / "staged" / "source.json"
    write_json(source_path, source)
    staged_sections = work / "staged" / "sections.jsonl.gz"
    gzip_file(sections_path, staged_sections)

    raw_entries = raw_manifest_entries(root, receipts)
    generated_at = now_iso()
    intake_manifest = {
        "schema_version": "publisher-code-manifest/2",
        "jurisdiction": "KY",
        "publisher": "Kentucky Legislative Research Commission",
        "publisher_url": "https://legislature.ky.gov/",
        "source_system": CODE_ID,
        "code_title": CODE_NAME,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "retrieval": {
            "methods": ["publisher_page"],
            "source_url_patterns": [
                r"^https://apps\.legislature\.ky\.gov/law/statutes/statute\.aspx\?id=[0-9]+$"
            ],
            "terms_gate": False,
            "official_source": True,
            "rate_limit_ms": 1000,
        },
        "structure": {
            "levels": ["title", "chapter", "subchapter", "subtitle", "article", "section"],
            "unit": "publisher section PDF and its text derivative",
        },
        "section_id": {
            "scheme": "official_citation_path",
            "regex": (
                r"^[0-9]+[A-Z]?(\.[0-9]+[A-Z]?(-[0-9]+[A-Z]?)?)"
                r"(:occurrence:[1-9][0-9]*)?$"
            ),
            "example": "367.3611:occurrence:1",
            "citation_format": "KRS {official_section_number}",
        },
        "currency": {"basis": "publisher_statement", "location": "unit-page banner"},
        "review": {"reviewed_by": REPORT_AGENT, "reviewed_at": generated_at},
    }
    manifest = {
        "schema_version": "state-code-staging-manifest/1",
        "generated_at": generated_at,
        "state": "KY",
        "code_id": CODE_ID,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "intake_manifest": intake_manifest,
        "retrieval": {
            "methods": sorted({entry["retrieval_method"] for entry in raw_entries}),
            "rate_limit_ms": 1000,
            "terms_gate": False,
            "official_source": True,
        },
        "structure": {
            "levels": ["title", "chapter", "subchapter", "subtitle", "article", "section"],
            "unit": "publisher section PDF and its text derivative",
        },
        "section_id": {
            "scheme": "official_citation_path_with_occurrence_for_parallel_versions",
            "regex": SECTION_ID_RE,
            "example": "367.3611:occurrence:1",
            "citation_format": "KRS {official_section_number}",
        },
        "currency": {"basis": "publisher_statement", "location": "unit-page banner"},
        "objects": raw_entries + derivative_entries + [
            {
                "kind": "sections_jsonl_gzip",
                "path": "sections.jsonl.gz",
                "sha256": sha256_file(staged_sections),
                "bytes": staged_sections.stat().st_size,
                "retrieval_method": "derived:" + PARSER_NAME + "/" + PARSER_VERSION,
                "url": None,
                "retrieved_at": None,
            },
            {
                "kind": "source_metadata",
                "path": "source.json",
                "sha256": sha256_file(source_path),
                "bytes": source_path.stat().st_size,
                "retrieval_method": "derived:manual-source-review",
                "url": None,
                "retrieved_at": None,
            },
        ],
    }
    manifest_path = work / "staged" / "manifest.json"
    write_json(manifest_path, manifest)

    audit = independent_audit(root, plan, successful)
    unit_counts = collections.Counter(unit["unit_level"] for unit in units)
    repeated = {citation: count for citation, count in citation_totals.items() if count > 1}
    parse_report = {
        "schema_version": "state-code-parse-report/1",
        "state": "KY",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "counts": {
            "titles": len(index["titles"]),
            "chapter_index_rows": unit_counts["chapter"],
            "linked_chapter_pages": sum(
                unit["unit_level"] == "chapter" and bool(unit["href"]) for unit in units
            ),
            "chapter_placeholders": sum(
                unit["unit_level"] == "chapter" and not unit["href"] for unit in units
            ),
            "subchapters": unit_counts["subchapter"],
            "subtitles": unit_counts["subtitle"],
            "articles": unit_counts["article"],
            "linked_unit_pages": sum(bool(unit["href"]) for unit in units),
            "sections_expected": len(plan),
            "rows_parsed": parsed_count,
            "source_unit_derivatives": len(derivative_entries),
            "pdf_pages": total_pages,
            "empty_bodies": empty_bodies,
            "status_labels": dict(sorted(status_counts.items())),
        },
        "expected_vs_parsed": {
            "official_section_inventory": len(plan),
            "parsed_rows": parsed_count,
            "missing": 0,
            "unexpected": 0,
        },
        "repeated_citations": {
            "groups": len(repeated),
            "additional_occurrences": sum(count - 1 for count in repeated.values()),
            "citations": repeated,
            "identity_rule": "all parallel occurrences use :occurrence:N in intake_citation_path",
        },
        "anomalies": {
            "heading_mismatches": heading_mismatches,
            "empty_bodies": empty_bodies,
            "robots_txt_http_404": sum(
                receipt.get("url", "").endswith("/robots.txt") and not receipt.get("ok")
                for receipt in receipts
            ),
            "scope_exclusion": source["scope_exclusions"],
        },
        "capture_verification": {
            "verify_store_checked_unique_objects": checked,
            "verify_store_problems": verification_problems,
        },
        "independent_audit": audit,
        "input_hashes": {
            "receipts_jsonl": sha256_file(root / "receipts.jsonl"),
            "title_index": successful[BASE]["sha256"],
        },
        "output_hashes": {
            "inventory_jsonl": sha256_file(inventory_path),
            "sections_jsonl": sha256_file(sections_path),
            "sections_jsonl_gz": sha256_file(staged_sections),
            "source_json": sha256_file(source_path),
            "manifest_json": sha256_file(manifest_path),
        },
    }
    write_json(work / "parsed" / "parse-report.json", parse_report)

    if parsed.exists():
        shutil.rmtree(parsed)
    if staged.exists():
        shutil.rmtree(staged)
    os.replace(work / "parsed", parsed)
    os.replace(work / "staged", staged)
    work.rmdir()

    store.mkdir(parents=True, exist_ok=True)
    shutil.copy2(staged / "source.json", store / "source.json")
    shutil.copy2(staged / "manifest.json", store / "manifest.json")
    shutil.copy2(parsed / "parse-report.json", store / "parse-report.json")
    with (store / "sample-sections.jsonl").open("w", encoding="utf8") as handle:
        for row in sample_rows(parsed / "sections.jsonl"):
            handle.write(json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n")

    raw_bytes_total = sum(entry["bytes"] for entry in raw_entries)
    report = f"""---
cursor:
  subagentId: "{REPORT_AGENT}"
---
# Kentucky Revised Statutes acquisition and staging

- Official source: Kentucky Legislative Research Commission, {BASE}
- Edition as published: `{EDITION}`
- Currency as published: `{CURRENCY_SESSION}`; `{CURRENCY_UPDATED}`
- Publisher status: the site calls this an unofficial posting maintained in LRC's official internal statutory database.
- Newer enacted-law exclusion stated by publisher: none identified. The publisher says the online version may be updated between sessions for delayed effective dates and database corrections.
- Counts: {len(index["titles"])} titles; {unit_counts["chapter"]} chapter index rows ({sum(unit["unit_level"] == "chapter" and bool(unit["href"]) for unit in units)} linked, {sum(unit["unit_level"] == "chapter" and not unit["href"] for unit in units)} unlinked placeholders/ranges); {len(plan)} section inventory entries; {parsed_count} staged rows.
- Nested units: {unit_counts["subchapter"]} subchapters, {unit_counts["subtitle"]} subtitles, {unit_counts["article"]} articles; {sum(bool(unit["href"]) for unit in units)} linked unit pages total.
- Originals: {len(raw_entries)} unique retained raw files; {raw_bytes_total} bytes; all {checked} unique successful receipt objects passed `verify_store`.
- Staged hashes: `sections.jsonl.gz` `{sha256_file(staged / "sections.jsonl.gz")}`; `manifest.json` `{sha256_file(staged / "manifest.json")}`.
- Gaps: zero linked KRS unit pages and zero section PDFs missing from the captured official inventory. The separately linked Kentucky Rules of Evidence page is out of KRS scope.
- Gates: none encountered. Direct access did not require terms acceptance, CAPTCHA, or authentication. The publisher's commercial-use and proprietary-interest notices are retained in `source.json`.
- Proxied items: {len(source["proxied_items"])}.
- Anomalies: {len(repeated)} repeated-citation groups / {sum(count - 1 for count in repeated.values())} additional parallel occurrences; {empty_bodies} empty bodies (retained status placeholders); one unsuccessful `robots.txt` observation (HTTP 404, not a corpus gap).
- Tests: run separately with `python3 -m unittest discover -s scripts/legal/state-codes/ky -p 'test_*.py'`.
- Independent audit: pypdf checked {audit["pdfs_checked"]} PDFs / {audit["pages_checked"]} pages; {audit["citation_matches"]} citation matches, {audit["citation_mismatches"]} mismatches, {audit["extraction_failures"]} failures; character ratio {audit["independent_to_primary_character_ratio"]:.9f}; passed={str(audit["passed"]).lower()}.
- What remains: batch-lead review and mechanical conversion to `publisher-code-intake/2`; no corpus or Supabase write was performed.
"""
    (store / "report.md").write_text(report, encoding="utf8")
    print(json.dumps(parse_report["counts"], sort_keys=True))
    print("sections.jsonl.gz", sha256_file(staged / "sections.jsonl.gz"))
    print("manifest.json", sha256_file(staged / "manifest.json"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/tmp/sc/KY")
    parser.add_argument(
        "--store",
        default=(
            "/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/"
            "internal/state-codes/batch-b/ky"
        ),
    )
    args = parser.parse_args()
    build(pathlib.Path(args.root), pathlib.Path(args.store))


if __name__ == "__main__":
    main()
