"""Parse and stage the official Wisconsin Statutes capture.

The HTML rendition supplies typed statutory and annotation blocks.  Section
inventory is read separately from each chapter's publisher TOC, and the JSON
rendition supplies an independent section-path/text audit.
"""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import pathlib
import re
import shutil
from collections import Counter, defaultdict

from bs4 import BeautifulSoup

ROOT_DEFAULT = pathlib.Path("/tmp/sc/WI")
BASE = "https://docs.legis.wisconsin.gov"
CODE_ID = "wi-statutes"
CODE_NAME = "Wisconsin Statutes"
PARSER_NAME = "wi-official-toc-text"
PARSER_VERSION = "1.0.0"
CHAPTER_RE = re.compile(r"^([0-9]+[A-Za-z]*)\.\s+(.+)$")
STATUS_RE = re.compile(r"^(?:Repealed|Reserved|Renumbered|Expired|Vacant)\.?$", re.I)
EFFECTIVE_RE = re.compile(
    r"\b(effective|takes effect|expires?|expiration|applies? (?:first |only )?to)\b", re.I
)
ANNOTATION_START_RE = re.compile(
    r"^(?:Cross-reference:|NOTE:|Notes?:|Judicial Council Note|Legislative Council Note|"
    r"Compiler(?:’s|'s) Note|Attorney General|See also |ANNOTATION:)",
    re.I,
)
HIERARCHY_START_RE = re.compile(r"^SUBCHAPTER\s+[A-Z0-9IVXLC.-]+$", re.I)
UNLABELLED_ANNOTATION_RE = re.compile(
    r"(?:\bv\.\s|\b\d+\s+(?:Wis\.(?:\s+(?:2d|3d))?|N\.W\.2d|U\.S\.|"
    r"F\.(?:\s*Supp\.|\s*(?:2d|3d|4th))|Atty\. Gen\.)|\bOAG\s+\d)",
    re.I,
)
WS_RE = re.compile(r"\s+")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: pathlib.Path, block: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(block), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_line(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode(
        "utf8"
    )


def normalized(text: str) -> str:
    return WS_RE.sub(" ", text.replace("\xa0", " ")).strip()


def heading_key(text: str) -> str:
    return normalized(text).replace("’", "'").rstrip(" .;:").casefold()


def clean_tag(tag, remove_selectors=()) -> str:
    node = copy.copy(tag)
    for selector in remove_selectors:
        for child in node.select(selector):
            child.decompose()
    text = node.get_text("", strip=False).replace("\xa0", " ")
    return re.sub(r"[\r\n\t]+", " ", text).strip()


def load_receipts(root: pathlib.Path) -> list[dict]:
    receipts = []
    with (root / "receipts.jsonl").open(encoding="utf8") as handle:
        for line in handle:
            if line.strip():
                receipts.append(json.loads(line))
    return receipts


def receipt_maps(receipts: list[dict]) -> tuple[dict[str, dict], dict[str, dict]]:
    by_url: dict[str, dict] = {}
    by_label: dict[str, dict] = {}
    for receipt in receipts:
        if receipt.get("ok") and receipt.get("retrieval_method") == "direct":
            by_url.setdefault(receipt["url"], receipt)
            if receipt.get("label"):
                by_label.setdefault(receipt["label"], receipt)
    return by_url, by_label


def read_receipt(root: pathlib.Path, receipt: dict) -> bytes:
    return (root / receipt["stored_path"]).read_bytes()


def parse_master_toc(text: str) -> tuple[list[dict], dict[str, dict]]:
    """Return publisher subject headings and chapter metadata from the plain TOC."""
    lines = text.splitlines()
    try:
        start = lines.index("TABLE OF CONTENTS") + 1
    except ValueError as exc:
        raise ValueError("TABLE OF CONTENTS marker absent") from exc
    subjects: list[dict] = []
    chapters: dict[str, dict] = {}
    pending_heading: list[str] = []
    current_subject = None
    for raw in lines[start:]:
        line = raw.strip()
        if not line:
            continue
        match = CHAPTER_RE.match(line)
        if match:
            if pending_heading:
                heading = normalized(" ".join(pending_heading))
                current_subject = {
                    "ordinal": len(subjects) + 1,
                    "heading": heading,
                    "native_id": f"subject:{len(subjects) + 1}",
                }
                subjects.append(current_subject)
                pending_heading = []
            chapter, heading = match.groups()
            chapters[chapter] = {
                "chapter": chapter,
                "heading": heading,
                "subject": current_subject,
            }
        else:
            pending_heading.append(line)
    return subjects, chapters


def currency_metadata(prefaces_json: dict) -> tuple[str, dict]:
    lines = prefaces_json["content"].splitlines()
    if len(lines) < 4 or not lines[0].startswith("Updated "):
        raise ValueError("unexpected publisher currency statement")
    edition = lines[0].strip()
    statement = "\n".join(line.strip() for line in lines[:4])
    # The contract mapping forbids parsing a prose date into through_date.
    return edition, {"statement": statement, "as_of": None}


def chapter_toc(soup: BeautifulSoup) -> tuple[list[dict], list[dict]]:
    """Parse the chapter's publisher TOC, including publisher subchapter labels."""
    sections: list[dict] = []
    subchapters: list[dict] = []
    current_subchapter = None
    pending_subchapter = None
    for element in soup.select(".qstoc_subchap, .qstoc_entry"):
        classes = element.get("class") or []
        text = normalized(element.get_text(" ", strip=False))
        if "qstoc_subchap" in classes:
            match = re.match(r"^SUBCHAPTER\s+(.+)$", text, re.I)
            if match:
                pending_subchapter = match.group(1)
            elif pending_subchapter is not None:
                current_subchapter = {
                    "number": pending_subchapter,
                    "heading": text,
                }
                subchapters.append(current_subchapter)
                pending_subchapter = None
            continue
        anchor = element.select_one('a[rel^="statutes/"]')
        if not anchor:
            continue
        citation = anchor.get("rel", [""])[0].split("/", 1)[-1]
        heading_node = copy.copy(element)
        heading_anchor = heading_node.select_one('a[rel^="statutes/"]')
        if heading_anchor:
            heading_anchor.decompose()
        for tab in heading_node.select(".qstab"):
            tab.decompose()
        heading = normalized(clean_tag(heading_node))
        sections.append(
            {
                "citation": citation,
                "heading": heading,
                "subchapter": current_subchapter,
                "url": BASE + (anchor.get("href") or f"/statutes/statutes/{citation}"),
            }
        )
    return sections, subchapters


def section_note_text(tag) -> str:
    return clean_tag(tag, (".reference",))


def statutory_line(tag, is_root: bool) -> str:
    remove = [".reference"]
    if is_root:
        remove.extend([".qsnum_sect", ".qstitle_sect"])
    return clean_tag(tag, remove)


def parse_chapter_html(
    html: bytes,
    chapter: str,
    chapter_meta: dict,
    edition: str,
    currency: dict,
    receipt: dict,
) -> tuple[list[dict], list[dict], dict, str]:
    soup = BeautifulSoup(html, "lxml")
    toc_sections, subchapters = chapter_toc(soup)
    toc_by_citation = defaultdict(list)
    for item in toc_sections:
        toc_by_citation[item["citation"]].append(item)

    chapter_heading_tag = soup.select_one(".qstitle_chap")
    chapter_heading = normalized(chapter_heading_tag.get_text(" ", strip=False)) if chapter_heading_tag else None
    chapter_heading_mismatch = None
    if chapter_heading:
        # Casing and final punctuation differ between the master TOC and chapter display.
        display_key = heading_key(chapter_heading)
        toc_key = heading_key(chapter_meta.get("heading", ""))
        if display_key != toc_key:
            chapter_heading_mismatch = {
                "master_toc": chapter_meta.get("heading"),
                "chapter_display": chapter_heading,
            }

    body_blocks = []
    current_block = None
    history_elements = defaultdict(list)
    note_elements = defaultdict(list)
    annotation_counts = Counter()
    for element in soup.select("div[data-section]"):
        citation = element.get("data-section")
        classes = element.get("class") or []
        if any(name.startswith("qsatxt_") for name in classes):
            if "qsatxt_1sect" in classes:
                current_block = {"root": element, "citation": citation, "elements": []}
                body_blocks.append(current_block)
            if current_block and current_block["citation"] == citation:
                current_block["elements"].append(element)
        elif "qsnote_history" in classes:
            history_elements[citation].append(element)
            annotation_counts["history"] += 1
        elif any(name.startswith("qsnote_") for name in classes):
            note_elements[citation].append(element)
            for name in classes:
                if name.startswith("qsnote_"):
                    annotation_counts[name.removeprefix("qsnote_")] += 1

    occurrences = Counter()
    rows = []
    derivative_parts = []
    cursor = 0
    for block in body_blocks:
        root = block["root"]
        citation = block["citation"]
        occurrences[citation] += 1
        occurrence = occurrences[citation]
        heading_tag = root.select_one(".qstitle_sect")
        heading = normalized(heading_tag.get_text(" ", strip=False)) if heading_tag else None
        lines = []
        for index, element in enumerate(block["elements"]):
            line = statutory_line(element, is_root=(element is root or index == 0))
            if line:
                lines.append(line)
        text = "\n".join(lines)
        histories = [section_note_text(tag) for tag in history_elements[citation]]
        history = "\n".join(value for value in histories if value) or None
        effective_notes = []
        for tag in note_elements[citation]:
            value = section_note_text(tag)
            if EFFECTIVE_RE.search(value):
                effective_notes.append(value)
        effective = "\n".join(effective_notes) or None
        status_label = heading if heading and STATUS_RE.match(heading) else None

        toc_options = toc_by_citation.get(citation, [])
        toc_item = toc_options[min(occurrence - 1, len(toc_options) - 1)] if toc_options else None
        subchapter = toc_item.get("subchapter") if toc_item else None
        hierarchy = [
            {
                "level": "chapter",
                "number": chapter,
                "heading": chapter_heading or chapter_meta["heading"],
            }
        ]
        if subchapter:
            hierarchy.append(
                {
                    "level": "subchapter",
                    "number": subchapter["number"],
                    "heading": subchapter["heading"],
                }
            )
        hierarchy.append({"level": "section", "number": citation, "heading": heading})

        prefix = f"{citation} {heading or ''}\n"
        derivative_parts.append(prefix)
        cursor += len(prefix)
        span = {"unit": "unicode_code_points", "start": cursor, "end": cursor + len(text)}
        derivative_parts.append(text)
        cursor += len(text)
        suffix = "\n"
        if history:
            suffix += history + "\n"
        derivative_parts.append(suffix)
        cursor += len(suffix)

        native_id = citation if occurrence == 1 else f"{citation}:occurrence:{occurrence}"
        rows.append(
            {
                "state": "WI",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": edition,
                "native_id": native_id,
                "identity_kind": "official_citation"
                if occurrence == 1
                else "official_citation_with_occurrence",
                "citation": citation,
                "citation_path": hierarchy,
                "heading": heading,
                "text": text,
                "history": history,
                "status_label": status_label,
                "effective": effective,
                "currency": currency,
                "source": {
                    "url": receipt["url"],
                    "receipt_sha256": receipt["sha256"],
                    "member": None,
                    "span": span,
                },
                "text_sha256": sha256_bytes(text.encode("utf8")),
                "occurrence": occurrence,
            }
        )
    derivative = "".join(derivative_parts)
    stats = {
        "chapter": chapter,
        "heading": chapter_meta["heading"],
        "chapter_display_heading": chapter_heading,
        "chapter_heading_mismatch": chapter_heading_mismatch,
        "toc_sections": len(toc_sections),
        "body_sections": len(rows),
        "toc_citations": [item["citation"] for item in toc_sections],
        "body_citations": [item["citation"] for item in rows],
        "subchapters": subchapters,
        "annotation_counts": dict(annotation_counts),
    }
    return rows, toc_sections, stats, derivative


def json_top_level_sections(chapter_json: dict, chapter: str) -> list[str]:
    prefix = f"/statutes/statutes/{chapter}/"
    values = []
    for path in chapter_json.get("children", []):
        if not path.startswith(prefix):
            continue
        tail = path[len(prefix) :]
        if tail and "/" not in tail and not tail.startswith("_") and tail != "title":
            values.append(f"{chapter}.{tail}")
    return values


def json_section_marker_counts(chapter_json: dict, toc_sections: list[dict]) -> dict[str, int]:
    """Count each exact TOC heading in plain JSON text (TOC plus body occurrence)."""
    lines = [normalized(line) for line in chapter_json.get("content", "").splitlines() if line.strip()]
    counts = {}
    for item in toc_sections:
        marker = normalized(f"{item['citation']} {item['heading']}")
        counts[item["citation"]] = sum(
            line == marker or line.startswith(marker + " ") for line in lines
        )
    return counts


def line_records(content: str) -> list[dict]:
    records = []
    cursor = 0
    for value in content.splitlines(keepends=True):
        text = value.rstrip("\r\n")
        records.append({"text": text, "normalized": normalized(text), "start": cursor, "end": cursor + len(text)})
        cursor += len(value)
    if not records or cursor < len(content):
        text = content[cursor:]
        records.append({"text": text, "normalized": normalized(text), "start": cursor, "end": len(content)})
    return records


def _heading_end(raw_line: str, citation: str, heading: str) -> int:
    """Return the source offset immediately after the exact section heading."""
    position = len(raw_line) - len(raw_line.lstrip())
    if not raw_line.startswith(citation, position):
        raise ValueError(f"section line does not start with {citation!r}")
    position += len(citation)
    while position < len(raw_line) and raw_line[position].isspace():
        position += 1
    heading_pattern = r"\s+".join(re.escape(token) for token in re.split(r"\s+", heading))
    match = re.match(heading_pattern, raw_line[position:])
    if not match:
        raise ValueError(f"section heading mismatch for {citation}: {raw_line[:120]!r}")
    return position + match.end()


def parse_chapter_text(
    content: str,
    chapter: str,
    chapter_meta: dict,
    toc_sections: list[dict],
    subchapters: list[dict],
    edition: str,
    currency: dict,
    receipt: dict,
) -> tuple[list[dict], dict, str]:
    """Parse complete publisher plain text using the independently captured HTML TOC."""
    records = line_records(content)
    # Locate the first (TOC) occurrence of every exact publisher section heading.
    toc_indexes = []
    cursor = 0
    for item in toc_sections:
        marker = normalized(f"{item['citation']} {item['heading']}")
        found = next(
            (index for index in range(cursor, len(records)) if records[index]["normalized"] == marker),
            None,
        )
        if found is None:
            raise ValueError(f"chapter {chapter}: TOC marker absent for {item['citation']}")
        toc_indexes.append(found)
        cursor = found + 1

    # Locate the body occurrence in order after the complete TOC.
    body_indexes = []
    cursor = (toc_indexes[-1] + 1) if toc_indexes else 0
    for item in toc_sections:
        marker = normalized(f"{item['citation']} {item['heading']}")
        found = next(
            (
                index
                for index in range(cursor, len(records))
                if records[index]["normalized"] == marker
                or records[index]["normalized"].startswith(marker + " ")
            ),
            None,
        )
        if found is None:
            raise ValueError(f"chapter {chapter}: body marker absent for {item['citation']}")
        body_indexes.append(found)
        cursor = found + 1

    rows = []
    occurrences = Counter()
    annotation_counts = Counter()
    span_mismatches = []
    for ordinal, (item, body_index) in enumerate(zip(toc_sections, body_indexes)):
        citation = item["citation"]
        occurrences[citation] += 1
        occurrence = occurrences[citation]
        line = records[body_index]
        heading_end = _heading_end(line["text"], citation, item["heading"])
        remainder = line["text"][heading_end:]
        if remainder.strip():
            leading = len(remainder) - len(remainder.lstrip())
            text_start = line["start"] + heading_end + leading
        else:
            text_start = records[body_index + 1]["start"] if body_index + 1 < len(records) else line["end"]
        segment_end_index = body_indexes[ordinal + 1] if ordinal + 1 < len(body_indexes) else len(records)

        boundary_index = segment_end_index
        history = None
        effective_notes = []
        boundary_kind = None
        for index in range(body_index + 1, segment_end_index):
            stripped = records[index]["text"].strip()
            if stripped.startswith("History:"):
                boundary_index = index
                history = stripped
                boundary_kind = "history"
                break
            if HIERARCHY_START_RE.match(stripped):
                boundary_index = index
                boundary_kind = "hierarchy_heading"
                break
            if ANNOTATION_START_RE.match(stripped):
                boundary_index = index
                boundary_kind = "labelled_annotation"
                break
            if (
                UNLABELLED_ANNOTATION_RE.search(stripped)
                and not re.match(r"^(?:\([^)]+\)|[0-9]+[A-Za-z]*\.)\s", stripped)
            ):
                boundary_index = index
                boundary_kind = "unlabelled_annotation"
                break
        # A no-history section can be followed by an all-caps subchapter/article
        # heading before the next section marker.  It is hierarchy, not section text.
        if boundary_index == segment_end_index:
            index = segment_end_index - 1
            while index > body_index and not records[index]["text"].strip():
                index -= 1
            uppercase_start = None
            while index > body_index:
                value = records[index]["text"].strip()
                letters = [character for character in value if character.isalpha()]
                if value and letters and value == value.upper():
                    uppercase_start = index
                    index -= 1
                    continue
                break
            if uppercase_start is not None:
                boundary_index = uppercase_start
                boundary_kind = "hierarchy_heading"
        text_end = records[boundary_index]["start"] if boundary_index < len(records) else len(content)
        while text_end > text_start and content[text_end - 1] in "\r\n":
            text_end -= 1
        text = content[text_start:text_end]

        if boundary_index < segment_end_index:
            for index in range(boundary_index, segment_end_index):
                value = records[index]["text"].strip()
                if not value:
                    continue
                if index == boundary_index and boundary_kind == "history":
                    annotation_counts["history"] += 1
                    continue
                if EFFECTIVE_RE.search(value) and re.match(r"^(?:NOTE:|Notes?:)", value, re.I):
                    effective_notes.append(value)
                if ANNOTATION_START_RE.match(value):
                    annotation_counts["labelled"] += 1
                else:
                    annotation_counts["unlabelled_after_boundary"] += 1

        heading = item["heading"]
        status_label = heading if STATUS_RE.match(heading) else None
        hierarchy = [
            {"level": "chapter", "number": chapter, "heading": chapter_meta["heading"]}
        ]
        if item.get("subchapter"):
            hierarchy.append(
                {
                    "level": "subchapter",
                    "number": item["subchapter"]["number"],
                    "heading": item["subchapter"]["heading"],
                }
            )
        hierarchy.append({"level": "section", "number": citation, "heading": heading})
        native_id = citation if occurrence == 1 else f"{citation}:occurrence:{occurrence}"
        span = {"unit": "unicode_code_points", "start": text_start, "end": text_end}
        if content[text_start:text_end] != text:
            span_mismatches.append(native_id)
        rows.append(
            {
                "state": "WI",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": edition,
                "native_id": native_id,
                "identity_kind": "official_citation"
                if occurrence == 1
                else "official_citation_with_occurrence",
                "citation": citation,
                "citation_path": hierarchy,
                "heading": heading,
                "text": text,
                "history": history,
                "status_label": status_label,
                "effective": "\n".join(effective_notes) or None,
                "currency": currency,
                "source": {
                    "url": receipt["url"],
                    "receipt_sha256": receipt["sha256"],
                    "member": None,
                    "span": span,
                },
                "text_sha256": sha256_bytes(text.encode("utf8")),
                "occurrence": occurrence,
            }
        )
    stats = {
        "chapter": chapter,
        "heading": chapter_meta["heading"],
        "toc_sections": len(toc_sections),
        "body_sections": len(rows),
        "toc_citations": [item["citation"] for item in toc_sections],
        "body_citations": [row["citation"] for row in rows],
        "subchapters": subchapters,
        "annotation_counts": dict(annotation_counts),
        "span_mismatches": span_mismatches,
        "sections_without_history": sum(1 for row in rows if row["history"] is None),
    }
    return rows, stats, content


def write_json(path: pathlib.Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf8")


def build(root: pathlib.Path, store: pathlib.Path | None = None) -> dict:
    receipts = load_receipts(root)
    by_url, by_label = receipt_maps(receipts)
    required_seed = by_label["prefaces-toc-json"]
    prefaces = json.loads(read_receipt(root, required_seed))
    edition, currency = currency_metadata(prefaces)
    toc_text = read_receipt(root, by_label["prefaces-toc-txt"]).decode("utf8")
    subjects, chapters = parse_master_toc(toc_text)
    capture_plan = json.loads((root / "extract" / "capture-plan.json").read_text(encoding="utf8"))
    expected_chapters = capture_plan["chapters_index_page"]
    if expected_chapters != capture_plan["chapters_prefaces_toc"]:
        raise ValueError("master chapter inventories disagree")
    if set(chapters) != set(expected_chapters):
        raise ValueError("plain TOC chapter inventory disagrees with capture plan")

    parsed_dir = root / "parsed"
    staged_dir = root / "staged"
    shutil.rmtree(parsed_dir, ignore_errors=True)
    shutil.rmtree(staged_dir, ignore_errors=True)
    parsed_dir.mkdir(parents=True)
    (staged_dir / "chapters").mkdir(parents=True)

    inventory_path = parsed_dir / "inventory.jsonl"
    sections_path = parsed_dir / "sections.jsonl"
    all_rows = []
    inventory_rows = []
    chapter_reports = []
    input_hashes = {}
    derivative_entries = []
    audit_totals = Counter()
    annotation_totals = Counter()
    json_text_mismatches = []
    repeated = Counter()

    for subject in subjects:
        inventory_rows.append(
            {
                "level": "subject",
                "native_id": subject["native_id"],
                "number": None,
                "heading": subject["heading"],
                "url": BASE + "/statutes/prefaces/toc",
            }
        )

    with inventory_path.open("wb") as inventory_handle, sections_path.open("wb") as section_handle:
        for item in inventory_rows:
            inventory_handle.write(canonical_line(item))
        for chapter in expected_chapters:
            toc_html_url = f"{BASE}/statutes/statutes/{chapter}"
            json_url = toc_html_url + ".json"
            txt_url = toc_html_url + ".txt"
            pdf_url = toc_html_url + ".pdf"
            for url in (toc_html_url, json_url, txt_url, pdf_url):
                if url not in by_url:
                    raise ValueError(f"missing successful capture: {url}")
            toc_html_receipt = by_url[toc_html_url]
            json_receipt = by_url[json_url]
            txt_receipt = by_url[txt_url]
            input_hashes[chapter] = {
                "toc_html": toc_html_receipt["sha256"],
                "json": json_receipt["sha256"],
                "txt": txt_receipt["sha256"],
                "pdf": by_url[pdf_url]["sha256"],
            }
            chapter_meta = chapters[chapter]
            toc_soup = BeautifulSoup(read_receipt(root, toc_html_receipt), "lxml")
            toc_sections, subchapters = chapter_toc(toc_soup)
            chapter_json = json.loads(read_receipt(root, json_receipt))
            txt_content = read_receipt(root, txt_receipt).decode("utf8")
            rows, chapter_stats, derivative = parse_chapter_text(
                txt_content,
                chapter,
                chapter_meta,
                toc_sections,
                subchapters,
                edition,
                currency,
                txt_receipt,
            )
            display_heading = chapter_json.get("description")
            chapter_stats["chapter_display_heading"] = display_heading
            if (
                display_heading
                and heading_key(display_heading) != heading_key(chapter_meta["heading"])
            ):
                chapter_stats["chapter_heading_mismatch"] = {
                    "master_toc": chapter_meta["heading"],
                    "chapter_display": display_heading,
                }
            else:
                chapter_stats["chapter_heading_mismatch"] = None
            json_marker_counts = json_section_marker_counts(chapter_json, toc_sections)
            independent_ids = [
                item["citation"] for item in toc_sections if json_marker_counts[item["citation"]] >= 2
            ]
            txt_matches_json = txt_content == chapter_json.get("content", "")
            for row in rows:
                span = row["source"]["span"]
                if txt_content[span["start"] : span["end"]] != row["text"]:
                    json_text_mismatches.append(row["native_id"])
                repeated[row["citation"]] += 1
                section_handle.write(canonical_line(row))
            all_rows.extend(rows)
            for sub in chapter_stats["subchapters"]:
                row = {
                    "level": "subchapter",
                    "native_id": f"{chapter}:subchapter:{sub['number']}",
                    "number": sub["number"],
                    "heading": sub["heading"],
                    "chapter": chapter,
                    "url": toc_html_url,
                    "receipt_sha256": toc_html_receipt["sha256"],
                }
                inventory_handle.write(canonical_line(row))
            chapter_inventory = {
                "level": "chapter",
                "native_id": chapter,
                "number": chapter,
                "heading": chapter_meta["heading"],
                "url": toc_html_url,
                "receipt_sha256": toc_html_receipt["sha256"],
                "subject": chapter_meta["subject"]["heading"] if chapter_meta["subject"] else None,
            }
            inventory_handle.write(canonical_line(chapter_inventory))
            for section in toc_sections:
                item = {
                    "level": "section",
                    "native_id": section["citation"],
                    "number": section["citation"],
                    "heading": section["heading"],
                    "chapter": chapter,
                    "url": section["url"],
                    "receipt_sha256": toc_html_receipt["sha256"],
                }
                inventory_handle.write(canonical_line(item))
            derivative_bytes = derivative.encode("utf8")
            derivative_sha = sha256_bytes(derivative_bytes)
            derivative_path = staged_dir / "chapters" / derivative_sha
            derivative_path.write_bytes(derivative_bytes)
            for row in rows:
                row["source"]["derivative_sha256"] = derivative_sha
            derivative_entries.append(
                {
                    "kind": "chapter_text_derivative",
                    "path": f"chapters/{derivative_sha}",
                    "sha256": derivative_sha,
                    "bytes": len(derivative_bytes),
                    "text_code_points": len(derivative),
                    "unit_key": chapter,
                    "url": txt_url,
                    "original_sha256": txt_receipt["sha256"],
                    "retrieved_at": txt_receipt["retrieved_at"],
                    "retrieval_method": "direct",
                }
            )
            toc_ids = chapter_stats["toc_citations"]
            body_ids = chapter_stats["body_citations"]
            chapter_stats["independent_json_sections"] = len(independent_ids)
            chapter_stats["json_marker_count_anomalies"] = {
                citation: count for citation, count in json_marker_counts.items() if count < 2
            }
            chapter_stats["json_extra_marker_occurrences"] = {
                citation: count for citation, count in json_marker_counts.items() if count > 2
            }
            chapter_stats["txt_matches_json_content"] = txt_matches_json
            chapter_stats["toc_minus_body"] = sorted(Counter(toc_ids) - Counter(body_ids))
            chapter_stats["body_minus_toc"] = sorted(Counter(body_ids) - Counter(toc_ids))
            chapter_stats["json_minus_body"] = sorted(Counter(independent_ids) - Counter(body_ids))
            chapter_stats["body_minus_json"] = sorted(Counter(body_ids) - Counter(independent_ids))
            chapter_reports.append(chapter_stats)
            audit_totals.update(
                {
                    "toc_sections": len(toc_ids),
                    "parser_sections": len(body_ids),
                    "json_sections": len(independent_ids),
                    "txt_json_exact_matches": int(txt_matches_json),
                }
            )
            annotation_totals.update(chapter_stats["annotation_counts"])

    # Rows were written before derivative hashes were attached. Rewrite once, stably.
    with sections_path.open("wb") as handle:
        for row in all_rows:
            handle.write(canonical_line(row))

    inventory_count = sum(1 for _ in inventory_path.open("rb"))
    repeated_citations = {key: count for key, count in repeated.items() if count > 1}
    empty_bodies = [row["native_id"] for row in all_rows if not row["text"]]
    non_status_empty = [row["native_id"] for row in all_rows if not row["text"] and not row["status_label"]]
    chapter_gaps = [
        {
            "chapter": report["chapter"],
            "toc_minus_body": report["toc_minus_body"],
            "body_minus_toc": report["body_minus_toc"],
            "json_minus_body": report["json_minus_body"],
            "body_minus_json": report["body_minus_json"],
            "json_marker_count_anomalies": report["json_marker_count_anomalies"],
            "txt_matches_json_content": report["txt_matches_json_content"],
            "span_mismatches": report["span_mismatches"],
        }
        for report in chapter_reports
        if report["toc_minus_body"]
        or report["body_minus_toc"]
        or report["json_minus_body"]
        or report["body_minus_json"]
        or report["json_marker_count_anomalies"]
        or not report["txt_matches_json_content"]
        or report["span_mismatches"]
    ]
    audit = {
        "method": (
            "exact complete .txt-to-JSON-content equality plus exact TOC/body heading-marker counts; "
            "section spans are independently sliced from the retained plain-text rendition"
        ),
        "totals": dict(audit_totals),
        "chapter_mismatches": chapter_gaps,
        "json_normalized_text_mismatches": json_text_mismatches,
        "passed": not chapter_gaps and not json_text_mismatches,
    }
    parse_report = {
        "schema_version": "state-code-parse-report/1",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "counts": {
            "subjects": len(subjects),
            "titles": 0,
            "chapters": len(expected_chapters),
            "subchapters": sum(len(report["subchapters"]) for report in chapter_reports),
            "inventory_rows": inventory_count,
            "sections": len(all_rows),
            "rows": len(all_rows),
        },
        "expected_vs_parsed": {
            "expected_chapters": len(expected_chapters),
            "captured_chapters": len(chapter_reports),
            "expected_sections": audit_totals["toc_sections"],
            "parsed_sections": len(all_rows),
            "gaps": chapter_gaps,
        },
        "anomalies": {
            "repeated_citations": repeated_citations,
            "empty_bodies": empty_bodies,
            "empty_bodies_without_status": non_status_empty,
            "chapter_heading_mismatches": [
                {
                    "chapter": report["chapter"],
                    **report["chapter_heading_mismatch"],
                }
                for report in chapter_reports
                if report["chapter_heading_mismatch"]
            ],
            "plain_text_extra_section_heading_occurrences": [
                {"chapter": report["chapter"], "citations": report["json_extra_marker_occurrences"]}
                for report in chapter_reports
                if report["json_extra_marker_occurrences"]
            ],
            "annotations_excluded_from_text": dict(annotation_totals),
            "publisher_html_omits_tables_and_graphics_in_20_named_sections": [
                "11.1101",
                "20.005",
                "35.84",
                "49.19",
                "82.50",
                "88.35",
                "94.64",
                "108.18",
                "167.07",
                "348.15",
                "348.19",
                "348.29",
                "348.295",
                "409.521",
                "709.03",
                "709.033",
                "767.813",
                "853.55",
                "853.56",
                "990.001",
            ],
        },
        "independent_audit": audit,
        "input_hashes": {
            "master_toc_txt": by_label["prefaces-toc-txt"]["sha256"],
            "master_toc_json": by_label["prefaces-toc-json"]["sha256"],
            "chapters": input_hashes,
        },
        "output_hashes": {
            "inventory_jsonl": sha256_file(inventory_path),
            "sections_jsonl": sha256_file(sections_path),
        },
        "chapter_reports": chapter_reports,
    }
    write_json(parsed_dir / "parse-report.json", parse_report)

    sections_gz = staged_dir / "sections.jsonl.gz"
    with sections_path.open("rb") as source, gzip.GzipFile(
        filename="", mode="wb", fileobj=sections_gz.open("wb"), mtime=0
    ) as target:
        shutil.copyfileobj(source, target, 1 << 20)

    raw_entries = []
    raw_by_sha = {}
    for receipt in receipts:
        if not receipt.get("ok"):
            continue
        existing = raw_by_sha.get(receipt["sha256"])
        if existing:
            if receipt["url"] != existing["url"] and receipt["url"] not in existing["additional_urls"]:
                existing["additional_urls"].append(receipt["url"])
            continue
        entry = {
            "kind": "publisher_original",
            "path": receipt["stored_path"],
            "sha256": receipt["sha256"],
            "bytes": receipt["bytes"],
            "url": receipt["url"],
            "additional_urls": [],
            "retrieved_at": receipt["retrieved_at"],
            "retrieval_method": receipt["retrieval_method"],
        }
        raw_by_sha[receipt["sha256"]] = entry
    raw_entries.extend(raw_by_sha.values())
    raw_entries.sort(key=lambda value: (value["url"], value["sha256"]))
    manifest = {
        "schema_version": "publisher-code-staging/1",
        "state": "WI",
        "code_id": CODE_ID,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "counts": parse_report["counts"],
        "files": raw_entries
        + derivative_entries
        + [
            {
                "kind": "sections_jsonl_gzip",
                "path": "sections.jsonl.gz",
                "sha256": sha256_file(sections_gz),
                "bytes": sections_gz.stat().st_size,
                "url": None,
                "retrieved_at": None,
                "retrieval_method": "derived",
            }
        ],
    }
    write_json(staged_dir / "manifest.json", manifest)
    proxied = [receipt for receipt in receipts if receipt.get("retrieval_method", "").startswith("proxied:")]
    failed = [receipt for receipt in receipts if not receipt.get("ok")]
    source = {
        "schema_version": "publisher-code-source/1",
        "state": "WI",
        "publisher": "Wisconsin Legislative Reference Bureau",
        "publisher_url": "https://legis.wisconsin.gov/lrb/",
        "official_urls": [
            BASE + "/statutes/statutes",
            BASE + "/statutes/prefaces/toc",
            BASE + "/statutes/prefaces/certificate",
        ],
        "edition": edition,
        "currency": currency,
        "publication_statement": prefaces["content"].splitlines()[1].strip(),
        "certification_statement": read_receipt(root, by_label["prefaces-certificate-txt"])
        .decode("utf8")
        .strip(),
        "license_terms": "No terms or license gate encountered.",
        "gates": [],
        "proxied_items": [
            {"url": receipt["url"], "retrieval_method": receipt["retrieval_method"]}
            for receipt in proxied
        ],
        "failed_requests": [
            {
                "url": receipt["url"],
                "status": receipt.get("status"),
                "error": receipt.get("error"),
            }
            for receipt in failed
        ],
        "known_publisher_format_limit": (
            "The certification states that tables and graphic images in 20 named sections are omitted "
            "from HTML and Folio; the captured PDF renditions include them."
        ),
    }
    write_json(staged_dir / "source.json", source)

    result = {
        "parse_report": parse_report,
        "source": source,
        "manifest": manifest,
        "sections_gz_sha256": sha256_file(sections_gz),
        "manifest_sha256": sha256_file(staged_dir / "manifest.json"),
        "raw_files": len(raw_entries),
        "raw_bytes": sum(item["bytes"] for item in raw_entries),
    }
    if store:
        store.mkdir(parents=True, exist_ok=True)
        write_json(store / "source.json", source)
        write_json(store / "manifest.json", manifest)
        write_json(store / "parse-report.json", parse_report)
        with (store / "sample-sections.jsonl").open("wb") as handle:
            sample_indexes = (
                [round(i * (len(all_rows) - 1) / 24) for i in range(25)] if len(all_rows) >= 25 else list(range(len(all_rows)))
            )
            for index in sample_indexes:
                handle.write(canonical_line(all_rows[index]))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=pathlib.Path, default=ROOT_DEFAULT)
    parser.add_argument("--store", type=pathlib.Path)
    args = parser.parse_args()
    result = build(args.root, args.store)
    summary = {
        "counts": result["parse_report"]["counts"],
        "audit_passed": result["parse_report"]["independent_audit"]["passed"],
        "raw_files": result["raw_files"],
        "raw_bytes": result["raw_bytes"],
        "sections_gz_sha256": result["sections_gz_sha256"],
        "manifest_sha256": result["manifest_sha256"],
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
