"""Parse Colorado Revised Statutes 2026 publisher HTM title files."""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys

from lxml import html

BASE = "https://olls.info/crs/"
CONTENT = "https://content.leg.colorado.gov"
CODE_ID = "co-crs"
CODE_NAME = "Colorado Revised Statutes"
EDITION = "Colorado Revised Statutes 2026"
PARSER_NAME = "co-olls-title-htm"
PARSER_VERSION = "1"
CRS_SECTION = re.compile(
    r"^(\d+(?:\.\d+)?-\d+(?:\.\d+)?-\d+(?:\.\d+)?)\.\s+(.*)$"
)
CONST_SECTION = re.compile(r"^Section\s+(\d+(?:\.\d+)?)\.\s*(.*)$", re.I)
TITLE_CENTER = re.compile(r"^TITLE\s+(\d+(?:\.\d+)?)\s*$", re.I)
ARTICLE_CENTER = re.compile(r"^ARTICLE\s+(\d+(?:\.\d+)?)\s*$", re.I)
PART_CENTER = re.compile(r"^PART\s+(\d+)\b(.*)$", re.I)
SUBPART_CENTER = re.compile(r"^SUBPART\s+(\d+)\b(.*)$", re.I)
STATUS_RE = re.compile(
    r"\((?:Repealed|Reserved|Omitted|Expired|Renumbered|Transferred|Deleted)[^)]*\)|"
    r"^(?:Repealed|Reserved|Omitted|Expired|Renumbered|Transferred|Deleted)\.?$",
    re.I,
)
SOURCE_RE = re.compile(r"^Source:", re.I)
ANNOTATION_RE = re.compile(
    r"^(?:ANNOTATION|Editor's note:|Cross references:|Law reviews\.|"
    r"Official Comment|WARNING:|IT IS AGAINST THE LAW:)",
    re.I,
)
WS_RE = re.compile(r"\s+")
SECTION_ID_REGEX = (
    r"^(?:[0-9]+(?:\.[0-9]+)?-[0-9]+(?:\.[0-9]+)?-[0-9]+(?:\.[0-9]+)?|"
    r"[IVXLC]+-[0-9]+(?:\.[0-9]+)?)"
    r"(?:\:occurrence\:[2-9][0-9]*)?$"
)
CURRENCY = {
    "statement": (
        "Colorado Revised Statutes 2026 as published by the Office of Legislative Legal Services."
    ),
    "as_of": None,
}


def normalized(text: str) -> str:
    return WS_RE.sub(" ", text.replace("\xa0", " ")).strip()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_line(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf8")


def is_bold(paragraph) -> bool:
    return bool(paragraph.xpath("./b|./span/b|./strong"))


def decode_html(raw: bytes) -> str:
    return raw.decode("cp1252", errors="replace")


def title_number_from_name(name: str) -> str:
    match = re.search(r"crs2026-title-(\d+(?:\.\d+)?)\.htm$", name, re.I)
    if not match:
        raise ValueError(f"unexpected title member: {name!r}")
    raw = match.group(1)
    if "." not in raw:
        return str(int(raw))
    return raw


def load_receipts(root: pathlib.Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]


def title_receipts(receipts: list[dict]) -> dict[str, dict]:
    by_member: dict[str, dict] = {}
    for receipt in receipts:
        if not receipt.get("ok") or receipt.get("label") != "crs-download":
            continue
        url = receipt["url"]
        if not url.endswith(".htm") or url.endswith("index.htm"):
            continue
        member = url.rsplit("/", 1)[-1]
        by_member[member] = receipt
    return by_member


def document_title(raw_html: str) -> str:
    match = re.search(r"<title>([^<]+)</title>", raw_html, re.I)
    return normalized(match.group(1)) if match else ""


def apply_center_lines(centers: list[str], hierarchy: dict, inventory: list[dict], url: str) -> None:
    for line in centers:
        if TITLE_CENTER.match(line):
            number = TITLE_CENTER.match(line).group(1)
            hierarchy["title"] = {"number": number, "heading": None}
            continue
        article = ARTICLE_CENTER.match(line)
        if article:
            hierarchy["article"] = {"number": article.group(1), "heading": None}
            continue
        part = PART_CENTER.match(line)
        if part:
            extra = normalized(part.group(2))
            hierarchy["part"] = {
                "number": part.group(1),
                "heading": extra.lstrip(" -") or None,
            }
            continue
        subpart = SUBPART_CENTER.match(line)
        if subpart:
            extra = normalized(subpart.group(2))
            hierarchy["subpart"] = {
                "number": subpart.group(1),
                "heading": extra.lstrip(" -") or None,
            }
            continue
        if hierarchy.get("article") and hierarchy["article"].get("heading") is None:
            hierarchy["article"]["heading"] = line
            inventory.append(
                {
                    "level": "article",
                    "native_id": f"title-{hierarchy['title']['number']}:article-{hierarchy['article']['number']}",
                    "number": hierarchy["article"]["number"],
                    "heading": line,
                    "url": url,
                }
            )
            continue
        if hierarchy.get("part") and not hierarchy["part"].get("heading"):
            hierarchy["part"]["heading"] = line
            continue
        if line.upper() == "ANNOTATION":
            continue
        inventory.append({"level": "structure_note", "native_id": line[:80], "heading": line, "url": url})


def split_catchline_and_body(heading_field: str) -> tuple[str, str]:
    """Split a publisher catchline from statute body when both share one paragraph."""
    text = normalized(heading_field)
    if not text:
        return "", ""
    match = re.match(r"^(.+?\.\s*)(\S.*)$", text)
    if match and len(match.group(2)) > 30 and match.group(2)[0].isupper():
        return normalized(match.group(1)), normalized(match.group(2))
    return text, ""


def occurrence_key(citation: str, occurrence: int) -> str:
    if occurrence == 1:
        return citation
    return f"{citation}:occurrence:{occurrence}"


def citation_path(hierarchy: dict, citation: str, heading: str) -> list[dict]:
    path: list[dict] = []
    title = hierarchy.get("title") or {}
    path.append(
        {
            "level": "title",
            "number": title.get("number"),
            "heading": title.get("heading"),
        }
    )
    article = hierarchy.get("article")
    if article:
        path.append(
            {
                "level": "article",
                "number": article.get("number"),
                "heading": article.get("heading"),
            }
        )
    part = hierarchy.get("part")
    if part:
        path.append(
            {
                "level": "part",
                "number": part.get("number"),
                "heading": part.get("heading"),
            }
        )
    subpart = hierarchy.get("subpart")
    if subpart:
        path.append(
            {
                "level": "subpart",
                "number": subpart.get("number"),
                "heading": subpart.get("heading"),
            }
        )
    path.append({"level": "section", "number": citation, "heading": heading})
    return path


def finalize_section(
    section: dict,
    hierarchy: dict,
    receipt: dict,
    title_number: str,
    edition: str,
    derivative_parts: list[str],
    cursor: int,
) -> tuple[dict, int]:
    body = "\n".join(section["body_lines"]).strip()
    history = "\n".join(section["history_lines"]).strip() or None
    heading = section["heading"]
    status_label = None
    if STATUS_RE.search(heading) or STATUS_RE.search(body):
        status_label = heading if STATUS_RE.search(heading) else "Repealed"
    elif not body.strip():
        status_label = heading or "Empty section body"
    prefix = f"{section['citation']} {heading}\n"
    derivative_parts.append(prefix)
    cursor += len(prefix)
    span = {"unit": "unicode_code_points", "start": cursor, "end": cursor + len(body)}
    derivative_parts.append(body)
    cursor += len(body)
    suffix = "\n"
    if history:
        suffix += history + "\n"
    derivative_parts.append(suffix)
    cursor += len(suffix)
    row = {
        "state": "CO",
        "code_id": CODE_ID,
        "code_name": CODE_NAME,
        "edition": edition,
        "native_id": section.get("native_id", section["citation"]),
        "identity_kind": "official_citation",
        "citation": section["citation"],
        "citation_path": citation_path(hierarchy, section["citation"], heading),
        "heading": heading,
        "text": body,
        "history": history,
        "status_label": status_label,
        "effective": None,
        "currency": CURRENCY,
        "occurrence": 1,
        "source": {
            "url": receipt["url"],
            "receipt_sha256": receipt["sha256"],
            "member": receipt["url"].rsplit("/", 1)[-1],
            "span": span,
        },
        "text_sha256": sha256_bytes(body.encode("utf8")),
    }
    return row, cursor


def parse_crs_title(
    raw_html: str,
    receipt: dict,
    title_number: str,
) -> tuple[list[dict], list[dict], dict, str]:
    tree = html.fromstring(raw_html)
    hierarchy = {
        "title": {
            "number": title_number,
            "heading": document_title(raw_html).split(" - ")[0],
        }
    }
    inventory: list[dict] = [
        {
            "level": "title",
            "native_id": f"title-{title_number}",
            "number": title_number,
            "heading": hierarchy["title"]["heading"],
            "url": receipt["url"],
            "receipt_sha256": receipt["sha256"],
        }
    ]
    toc: list[tuple[str, str]] = []
    body_sections: dict[str, dict] = {}
    current: dict | None = None
    center_buffer: list[str] = []
    citation_occurrences: dict[str, int] = {}

    def flush_current() -> None:
        nonlocal current
        if current is None:
            return
        body_sections[current["native_id"]] = current
        current = None

    for paragraph in tree.iter("p"):
        text = normalized(paragraph.text_content())
        if not text:
            continue
        if paragraph.get("align") == "center":
            center_buffer.append(text)
            continue
        if center_buffer:
            apply_center_lines(center_buffer, hierarchy, inventory, receipt["url"])
            center_buffer = []

        match = CRS_SECTION.match(text)
        if match:
            citation, heading = match.group(1), match.group(2)
            if is_bold(paragraph):
                flush_current()
                citation = match.group(1)
                heading_raw = match.group(2)
                heading, inline_body = split_catchline_and_body(heading_raw)
                citation_occurrences[citation] = citation_occurrences.get(citation, 0) + 1
                native_id = occurrence_key(citation, citation_occurrences[citation])
                current = {
                    "citation": citation,
                    "native_id": native_id,
                    "heading": heading,
                    "body_lines": [inline_body] if inline_body else [],
                    "history_lines": [],
                    "phase": "body",
                    "occurrence": citation_occurrences[citation],
                }
            else:
                toc.append((citation, heading))
                inventory.append(
                    {
                        "level": "section",
                        "native_id": citation,
                        "number": citation,
                        "heading": heading,
                        "title": title_number,
                        "url": receipt["url"],
                        "receipt_sha256": receipt["sha256"],
                    }
                )
            continue

        if current is None:
            continue
        if current["phase"] == "body":
            if SOURCE_RE.match(text) or paragraph.find(".//i") is not None:
                current["history_lines"].append(text)
                current["phase"] = "history"
            elif ANNOTATION_RE.match(text):
                current["phase"] = "annotation"
            else:
                current["body_lines"].append(text)
        elif current["phase"] == "history":
            if ANNOTATION_RE.match(text):
                current["phase"] = "annotation"
            else:
                current["history_lines"].append(text)

    if center_buffer:
        apply_center_lines(center_buffer, hierarchy, inventory, receipt["url"])
    flush_current()

    toc_citations = [c for c, _ in toc]
    toc_headings = dict(toc)
    parsed_rows: list[dict] = []
    derivative_parts: list[str] = []
    cursor = 0
    seen: set[str] = set()
    toc_occurrences: dict[str, int] = {}

    def emit_section(native_id: str, citation: str, heading: str | None = None) -> None:
        nonlocal cursor
        section = body_sections.get(native_id)
        if section is None:
            hd = heading or toc_headings.get(citation, "")
            status_label = hd if STATUS_RE.search(hd) else "Repealed"
            row = {
                "state": "CO",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION,
                "native_id": native_id,
                "identity_kind": "official_citation",
                "citation": citation,
                "citation_path": citation_path(hierarchy, citation, hd),
                "heading": hd,
                "text": "",
                "history": None,
                "status_label": status_label,
                "effective": None,
                "currency": CURRENCY,
                "occurrence": int(native_id.split(":occurrence:", 1)[1])
                if ":occurrence:" in native_id
                else 1,
                "source": {
                    "url": receipt["url"],
                    "receipt_sha256": receipt["sha256"],
                    "member": receipt["url"].rsplit("/", 1)[-1],
                    "span": None,
                },
                "text_sha256": sha256_bytes(b""),
            }
            parsed_rows.append(row)
            seen.add(native_id)
            return
        if heading and not section["heading"]:
            section["heading"] = heading
        row, cursor = finalize_section(
            section, hierarchy, receipt, title_number, EDITION, derivative_parts, cursor
        )
        row["native_id"] = native_id
        row["occurrence"] = section.get("occurrence", 1)
        if row["occurrence"] > 1:
            row["identity_kind"] = "official_citation_with_occurrence"
        parsed_rows.append(row)
        seen.add(native_id)

    for citation, heading in toc:
        toc_occurrences[citation] = toc_occurrences.get(citation, 0) + 1
        native_id = occurrence_key(citation, toc_occurrences[citation])
        emit_section(native_id, citation, heading)
    for native_id in body_sections:
        if native_id not in seen:
            emit_section(native_id, body_sections[native_id]["citation"])

    derivative = "".join(derivative_parts)
    derivative_sha = sha256_bytes(derivative.encode("utf8"))
    for row in parsed_rows:
        row["source"]["derivative_sha256"] = derivative_sha

    parsed_citations = {row["citation"] for row in parsed_rows}
    report = {
        "title": title_number,
        "member": receipt["url"].rsplit("/", 1)[-1],
        "document_title": document_title(raw_html),
        "toc_sections": len(toc),
        "bold_sections": len(body_sections),
        "parsed_sections": len(parsed_rows),
        "toc_citations": toc_citations,
        "parsed_citations": sorted(parsed_citations),
        "toc_minus_parsed": sorted(set(toc_citations) - parsed_citations),
        "parsed_minus_toc": sorted(parsed_citations - set(toc_citations)),
        "inventory_sections": sum(1 for item in inventory if item.get("level") == "section"),
    }
    return parsed_rows, inventory, report, derivative


def parse_constitution_title(
    raw_html: str,
    receipt: dict,
) -> tuple[list[dict], list[dict], dict, str]:
    tree = html.fromstring(raw_html)
    hierarchy: dict = {
        "title": {"number": "0", "heading": "Colorado Constitution"},
        "article": None,
    }
    inventory: list[dict] = [
        {
            "level": "title",
            "native_id": "title-0",
            "number": "0",
            "heading": "Colorado Constitution",
            "url": receipt["url"],
            "receipt_sha256": receipt["sha256"],
        }
    ]
    center_buffer: list[str] = []
    current: dict | None = None
    derivative_parts: list[str] = []
    cursor = 0
    parsed_rows: list[dict] = []
    occurrences: dict[str, int] = {}
    article_roman = None

    def article_from_center(line: str) -> str | None:
        match = re.match(r"^ARTICLE\s+([IVXLC]+)\s*$", line, re.I)
        return match.group(1).upper() if match else None

    def flush_current() -> None:
        nonlocal current, cursor
        if current is None:
            return
        body = "\n".join(current["body_lines"]).strip()
        history = "\n".join(current["history_lines"]).strip() or None
        heading = current["heading"]
        native_id = current["native_id"]
        base_citation = current["citation"]
        status_label = heading if STATUS_RE.search(heading) else None
        if not body.strip() and not status_label:
            status_label = heading or "Empty section body"
        prefix = f"Section {current['section_number']}. {heading}\n"
        derivative_parts.append(prefix)
        cursor += len(prefix)
        span = {"unit": "unicode_code_points", "start": cursor, "end": cursor + len(body)}
        derivative_parts.append(body)
        cursor += len(body)
        suffix = "\n"
        if history:
            suffix += history + "\n"
        derivative_parts.append(suffix)
        cursor += len(suffix)
        path = [
            {
                "level": "title",
                "number": hierarchy["title"]["number"],
                "heading": hierarchy["title"]["heading"],
            },
            {
                "level": "article",
                "number": current["article"],
                "heading": current.get("article_heading"),
            },
            {"level": "section", "number": native_id, "heading": heading},
        ]
        parsed_rows.append(
            {
                "state": "CO",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION,
                "native_id": native_id,
                "identity_kind": "official_citation"
                if current.get("occurrence", 1) == 1
                else "official_citation_with_occurrence",
                "citation": base_citation,
                "citation_path": path,
                "heading": heading,
                "text": body,
                "history": history,
                "status_label": status_label,
                "effective": None,
                "currency": CURRENCY,
                "occurrence": current.get("occurrence", 1),
                "source": {
                    "url": receipt["url"],
                    "receipt_sha256": receipt["sha256"],
                    "member": receipt["url"].rsplit("/", 1)[-1],
                    "span": span,
                },
                "text_sha256": sha256_bytes(body.encode("utf8")),
            }
        )
        current = None

    for paragraph in tree.iter("p"):
        text = normalized(paragraph.text_content())
        if not text:
            continue
        if paragraph.get("align") == "center":
            center_buffer.append(text)
            continue
        if center_buffer:
            for line in center_buffer:
                roman = article_from_center(line)
                if roman:
                    article_roman = roman
                    hierarchy["article"] = {"number": roman, "heading": None}
                    inventory.append(
                        {
                            "level": "article",
                            "native_id": f"const-article-{roman}",
                            "number": roman,
                            "heading": None,
                            "url": receipt["url"],
                        }
                    )
                elif hierarchy.get("article") and hierarchy["article"].get("heading") is None:
                    hierarchy["article"]["heading"] = line
            center_buffer = []

        match = CONST_SECTION.match(text)
        if match and is_bold(paragraph):
            flush_current()
            section_number = match.group(1)
            heading_raw = match.group(2)
            heading, inline_body = split_catchline_and_body(heading_raw)
            article = article_roman or "?"
            base_citation = f"{article}-{section_number}"
            occurrences[base_citation] = occurrences.get(base_citation, 0) + 1
            occurrence = occurrences[base_citation]
            citation = occurrence_key(base_citation, occurrence)
            current = {
                "citation": base_citation,
                "native_id": citation,
                "section_number": section_number,
                "heading": heading,
                "article": article,
                "article_heading": (hierarchy.get("article") or {}).get("heading"),
                "body_lines": [inline_body] if inline_body else [],
                "history_lines": [],
                "phase": "body",
                "occurrence": occurrence,
            }
            inventory.append(
                {
                    "level": "section",
                    "native_id": citation,
                    "number": base_citation,
                    "heading": heading,
                    "url": receipt["url"],
                    "receipt_sha256": receipt["sha256"],
                }
            )
            continue
        if current is None:
            continue
        if current["phase"] == "body":
            if SOURCE_RE.match(text) or paragraph.find(".//i") is not None:
                current["history_lines"].append(text)
                current["phase"] = "history"
            elif ANNOTATION_RE.match(text):
                current["phase"] = "annotation"
            else:
                current["body_lines"].append(text)
        elif current["phase"] == "history" and not ANNOTATION_RE.match(text):
            current["history_lines"].append(text)

    flush_current()
    derivative = "".join(derivative_parts)
    derivative_sha = sha256_bytes(derivative.encode("utf8"))
    for row in parsed_rows:
        row["source"]["derivative_sha256"] = derivative_sha
    report = {
        "title": "0",
        "member": receipt["url"].rsplit("/", 1)[-1],
        "document_title": document_title(raw_html),
        "toc_sections": 0,
        "bold_sections": len(parsed_rows),
        "parsed_sections": len(parsed_rows),
        "toc_citations": [],
        "parsed_citations": [row["citation"] for row in parsed_rows],
        "toc_minus_parsed": [],
        "parsed_minus_toc": [],
        "inventory_sections": len(parsed_rows),
    }
    return parsed_rows, inventory, report, derivative


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/CO"))
    args = ap.parse_args(argv)
    root = args.root
    receipts = load_receipts(root)
    by_member = title_receipts(receipts)
    if not by_member:
        raise SystemExit("no per-title HTM receipts found")

    parsed_dir = root / "parsed"
    extract_dir = root / "extract" / "titles"
    parsed_dir.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict] = []
    title_reports: list[dict] = []
    derivatives: dict[str, dict] = {}
    inventory_path = parsed_dir / "inventory.jsonl"
    sections_path = parsed_dir / "sections.jsonl"

    members = sorted(by_member, key=lambda name: (float(title_number_from_name(name)), name))
    with inventory_path.open("wb") as inventory_handle, sections_path.open("wb") as sections_handle:
        for member in members:
            receipt = by_member[member]
            raw = (root / receipt["stored_path"]).read_bytes()
            html_text = decode_html(raw)
            title_number = title_number_from_name(member)
            if title_number == "0":
                rows, inventory, report, derivative = parse_constitution_title(html_text, receipt)
            else:
                rows, inventory, report, derivative = parse_crs_title(html_text, receipt, title_number)
            title_reports.append(report)
            for item in inventory:
                inventory_handle.write(canonical_line(item))
            for row in rows:
                sections_handle.write(canonical_line(row))
            all_rows.extend(rows)
            derivative_sha = sha256_bytes(derivative.encode("utf8"))
            derivative_path = extract_dir / derivative_sha
            derivative_path.write_text(derivative, encoding="utf8")
            derivatives[member] = {
                "sha256": derivative_sha,
                "bytes": len(derivative.encode("utf8")),
                "text_code_points": len(derivative),
                "url": receipt["url"],
                "receipt_sha256": receipt["sha256"],
                "path": str(derivative_path.relative_to(root)),
                "title": title_number,
            }

    gaps = [report for report in title_reports if report["toc_minus_parsed"]]
    empty_without_status = [
        row["native_id"] for row in all_rows if not row["text"].strip() and not row["status_label"]
    ]
    parse_report = {
        "schema_version": "publisher-code-parse-report/2",
        "jurisdiction": "CO",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "counts": {
            "titles": len(members),
            "inventory_sections": sum(report["inventory_sections"] for report in title_reports),
            "sections": len(all_rows),
            "rows": len(all_rows),
            "toc_sections": sum(report["toc_sections"] for report in title_reports),
            "bold_sections": sum(report["bold_sections"] for report in title_reports),
        },
        "expected_vs_parsed": {
            "expected_titles": len(members),
            "parsed_titles": len(title_reports),
            "gaps": gaps,
        },
        "anomalies": {
            "empty_bodies_without_status": empty_without_status,
        },
        "derivatives": derivatives,
        "output_hashes": {
            "inventory_jsonl": sha256_file(inventory_path),
            "sections_jsonl": sha256_file(sections_path),
        },
        "title_reports": title_reports,
        "status": "parsed" if not gaps and not empty_without_status else "parsed-review",
    }
    (parsed_dir / "parse-report.json").write_text(
        json.dumps(parse_report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    print(
        json.dumps(
            {
                "titles": len(title_reports),
                "rows": len(all_rows),
                "gaps": len(gaps),
                "empty_bodies_without_status": len(empty_without_status),
                "status": parse_report["status"],
            },
            sort_keys=True,
        )
    )
    return 0 if parse_report["status"] == "parsed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
