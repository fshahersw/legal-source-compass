"""Parse Minnesota Statutes chapter-full HTML from the Office of the Revisor."""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
import urllib.parse
from collections import Counter

from bs4 import BeautifulSoup, NavigableString, Tag

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))

BASE = "https://www.revisor.mn.gov"
CODE_ID = "mn-statutes"
CODE_NAME = "Minnesota Statutes"
EDITION = "2025 Minnesota Statutes"
PARSER_NAME = "mn-revisor-chapter-full"
PARSER_VERSION = "1"
STATUS_RE = re.compile(
    r"^(Repealed|Expired|Reserved|Vacant|Renumbered|Renumbered as|Transferred)\b",
    re.I,
)
CHAPTER_TITLE_RE = re.compile(r"^CHAPTER\s+([0-9A-Za-z]+)\.\s*(.+)$", re.I)
SECTION_HEADING_RE = re.compile(
    r"^([0-9A-Za-z]+(?:[.][0-9A-Za-z]+)*(?:-[0-9A-Za-z]+(?:[.][0-9A-Za-z]+)*)?)\s+(.+)$"
)
WS_RE = re.compile(r"\s+")


def normalized(text: str) -> str:
    return WS_RE.sub(" ", text.replace("\xa0", " ")).strip()


def citation_from_section_id(section_id: str) -> str:
    if not section_id.startswith("stat."):
        raise ValueError(f"unexpected section id: {section_id!r}")
    return section_id.removeprefix("stat.")


def heading_from_shn(citation: str, heading_text: str) -> str:
    text = normalized(heading_text)
    for prefix in (citation, f'"{citation}', f"'{citation}"):
        if text.startswith(prefix):
            return normalized(text[len(prefix) :].lstrip(" ."))
    match = SECTION_HEADING_RE.match(text)
    if match and match.group(1) == citation:
        return normalized(match.group(2).rstrip("."))
    raise ValueError(f"heading does not match citation {citation}: {text[:120]!r}")


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


def load_receipts(root: pathlib.Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]


def chapter_receipts(receipts: list[dict]) -> dict[str, dict]:
    by_chapter: dict[str, dict] = {}
    for receipt in receipts:
        if not receipt.get("ok") or receipt.get("label") != "chapter-full":
            continue
        match = re.search(r"/statutes/cite/([0-9A-Za-z]+)/full$", receipt["url"])
        if not match:
            continue
        chapter = match.group(1)
        by_chapter[chapter] = receipt
    return by_chapter


def part_label(part_url: str) -> str:
    slug = urllib.parse.unquote(part_url.rsplit("/part/", 1)[-1])
    return slug.replace("+", " ")


def parse_chapter_title(text: str) -> tuple[str, str]:
    match = CHAPTER_TITLE_RE.match(normalized(text))
    if not match:
        raise ValueError(f"unexpected chapter title: {text[:120]!r}")
    return match.group(1), normalized(match.group(2))


def parse_section_heading(section_div: Tag) -> tuple[str, str]:
    citation = citation_from_section_id(section_div.get("id", ""))
    heading_node = section_div.select_one("h1.shn")
    if heading_node is None:
        raise ValueError(f"section {citation}: missing h1.shn")
    heading = heading_from_shn(citation, heading_node.get_text(" ", strip=True))
    return citation, heading


def toc_rows(soup: BeautifulSoup) -> list[dict]:
    rows: list[dict] = []
    table = soup.select_one("#chapter_analysis tbody")
    if not table:
        return rows
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        anchor = cells[0].find("a", href=True)
        if not anchor:
            continue
        citation = normalized(anchor.get_text())
        heading = normalized(cells[1].get_text(" ", strip=False))
        inactive = "inactive" in (cells[1].get("class") or [])
        rows.append(
            {
                "citation": citation,
                "heading": heading,
                "inactive": inactive,
            }
        )
    return rows


def section_body(section_div: Tag) -> str:
    parts: list[str] = []
    for child in section_div.children:
        if isinstance(child, NavigableString):
            continue
        if not isinstance(child, Tag):
            continue
        if child.name == "h1" and "shn" in (child.get("class") or []):
            continue
        value = normalized(child.get_text("\n", strip=False))
        if value:
            parts.append(value)
    return "\n".join(parts).strip()


def history_text(section_div: Tag) -> str | None:
    sibling = section_div.find_next_sibling("div", class_="history")
    if not sibling:
        return None
    value = normalized(sibling.get_text("\n", strip=False))
    if value.lower().startswith("history:"):
        value = normalized(value.split(":", 1)[1])
    return value or None


def parse_status_row(div: Tag) -> tuple[str, str, str | None]:
    section_id = div.get("id", "")
    citation = section_id.removeprefix("stat.") if section_id.startswith("stat.") else normalized(
        div.find("b").get_text() if div.find("b") else ""
    )
    bold = div.find("b")
    full = normalized(div.get_text(" ", strip=False))
    if bold:
        heading = normalized(full[len(normalized(bold.get_text())) :].lstrip(" ."))
    else:
        heading = full
    status = STATUS_RE.search(heading)
    status_label = status.group(1).title() if status else None
    return citation, heading, status_label


def build_derivative_and_spans(
    rows: list[dict],
    chapter: str,
    receipt: dict,
) -> tuple[str, list[dict]]:
    """Attach unicode spans and derivative hash to parsed rows."""
    parts: list[str] = []
    cursor = 0
    enriched: list[dict] = []
    for row in rows:
        prefix = f"{row['citation']} {row['heading']}\n"
        parts.append(prefix)
        cursor += len(prefix)
        text = row["text"]
        span = {"unit": "unicode_code_points", "start": cursor, "end": cursor + len(text)}
        parts.append(text)
        cursor += len(text)
        suffix = "\n"
        history = row.get("history")
        if history:
            suffix += history + "\n"
        parts.append(suffix)
        cursor += len(suffix)
        enriched.append(
            {
                **row,
                "source": {
                    "url": receipt["url"],
                    "receipt_sha256": receipt["sha256"],
                    "member": chapter,
                    "span": span,
                },
                "text_sha256": sha256_bytes(text.encode("utf8")),
            }
        )
    derivative = "".join(parts)
    derivative_sha = sha256_bytes(derivative.encode("utf8"))
    for row in enriched:
        row["source"]["derivative_sha256"] = derivative_sha
    return derivative, enriched


def parse_chapter(
    html: bytes,
    chapter: str,
    part_name: str,
    receipt: dict,
    currency: dict,
) -> tuple[list[dict], list[dict], dict, str]:
    soup = BeautifulSoup(html, "lxml")
    statute_root = soup.select_one("#xtend.statute") or soup.select_one("#xtend")
    if statute_root is None:
        raise ValueError(f"chapter {chapter}: #xtend.statute missing")
    title_node = statute_root.select_one("h2.chapter_title")
    if title_node is None:
        raise ValueError(f"chapter {chapter}: chapter title missing")
    chapter_number, chapter_heading = parse_chapter_title(title_node.get_text(" ", strip=True))
    if chapter_number != chapter:
        raise ValueError(f"chapter {chapter}: title number {chapter_number!r} mismatch")

    toc = toc_rows(statute_root)
    inventory: list[dict] = []
    inventory.append(
        {
            "level": "part",
            "native_id": f"part:{part_name}",
            "number": None,
            "heading": part_name,
            "chapter": chapter,
            "url": receipt["url"],
        }
    )
    inventory.append(
        {
            "level": "chapter",
            "native_id": chapter,
            "number": chapter,
            "heading": chapter_heading,
            "part": part_name,
            "url": receipt["url"],
            "receipt_sha256": receipt["sha256"],
        }
    )
    for item in toc:
        inventory.append(
            {
                "level": "section",
                "native_id": item["citation"],
                "number": item["citation"],
                "heading": item["heading"],
                "chapter": chapter,
                "inactive": item["inactive"],
                "url": f"{BASE}/statutes/cite/{item['citation']}",
                "receipt_sha256": receipt["sha256"],
            }
        )

    draft_rows: list[dict] = []
    for section_div in statute_root.select("div.section"):
        citation, heading = parse_section_heading(section_div)
        body = section_body(section_div)
        history = history_text(section_div)
        status_label = heading if STATUS_RE.match(heading) else None
        draft_rows.append(
            {
                "state": "MN",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION,
                "native_id": citation,
                "identity_kind": "official_citation",
                "citation": citation,
                "citation_path": [
                    {"level": "part", "number": None, "heading": part_name},
                    {"level": "chapter", "number": chapter, "heading": chapter_heading},
                    {"level": "section", "number": citation, "heading": heading},
                ],
                "heading": heading,
                "text": body,
                "history": history,
                "status_label": status_label,
                "effective": None,
                "currency": currency,
                "occurrence": 1,
            }
        )

    for status_div in statute_root.select("div.sr"):
        citation, heading, status_label = parse_status_row(status_div)
        draft_rows.append(
            {
                "state": "MN",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION,
                "native_id": citation,
                "identity_kind": "official_citation",
                "citation": citation,
                "citation_path": [
                    {"level": "part", "number": None, "heading": part_name},
                    {"level": "chapter", "number": chapter, "heading": chapter_heading},
                    {"level": "section", "number": citation, "heading": heading},
                ],
                "heading": heading,
                "text": "",
                "history": None,
                "status_label": status_label or heading,
                "effective": None,
                "currency": currency,
                "occurrence": 1,
            }
        )

    for block_div in statute_root.select("div.sr_by_subd"):
        citation = citation_from_section_id(block_div.get("id", ""))
        h1 = block_div.find("h1")
        heading = (
            heading_from_shn(citation, h1.get_text(" ", strip=True))
            if h1
            else "Subdivisions renumbered, repealed, or no longer in effect"
        )
        parts = [
            normalized(subd.get_text("\n", strip=False))
            for subd in block_div.select("div.subd")
        ]
        body = "\n".join(value for value in parts if value).strip()
        status_label = "Repealed" if re.search(r"\bRepealed\b", body, re.I) else heading
        draft_rows.append(
            {
                "state": "MN",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION,
                "native_id": citation,
                "identity_kind": "official_citation",
                "citation": citation,
                "citation_path": [
                    {"level": "part", "number": None, "heading": part_name},
                    {"level": "chapter", "number": chapter, "heading": chapter_heading},
                    {"level": "section", "number": citation, "heading": heading},
                ],
                "heading": heading,
                "text": body,
                "history": None,
                "status_label": status_label,
                "effective": None,
                "currency": currency,
                "occurrence": 1,
            }
        )

    parsed_citations = {row["citation"] for row in draft_rows}
    toc_citations = [row["citation"] for row in toc]
    body_ids = {
        citation_from_section_id(node.get("id", ""))
        for node in statute_root.select("div.section, div.sr, div.sr_by_subd")
    }
    derivative, enriched = build_derivative_and_spans(draft_rows, chapter, receipt)
    occurrences = Counter()
    rows: list[dict] = []
    for row in enriched:
        occurrences[row["citation"]] += 1
        occurrence = occurrences[row["citation"]]
        native_id = row["citation"] if occurrence == 1 else f"{row['citation']}:occurrence:{occurrence}"
        rows.append(
            {
                **row,
                "native_id": native_id,
                "identity_kind": "official_citation"
                if occurrence == 1
                else "official_citation_with_occurrence",
                "occurrence": occurrence,
            }
        )
    report = {
        "chapter": chapter,
        "part": part_name,
        "chapter_heading": chapter_heading,
        "toc_sections": len(toc),
        "parsed_sections": len(rows),
        "toc_citations": toc_citations,
        "parsed_citations": sorted(parsed_citations),
        "toc_minus_parsed": sorted(set(toc_citations) - parsed_citations),
        "parsed_minus_toc": sorted(parsed_citations - set(toc_citations)),
        "toc_minus_body": sorted(set(toc_citations) - body_ids),
        "body_minus_toc": sorted(body_ids - set(toc_citations)),
        "inactive_toc_rows": sum(1 for item in toc if item["inactive"]),
    }
    return rows, inventory, report, derivative


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/MN"))
    args = ap.parse_args(argv)
    root = args.root
    chapters = json.loads((root / "chapter-list.json").read_text(encoding="utf8"))
    receipts = load_receipts(root)
    by_chapter = chapter_receipts(receipts)
    missing = sorted(set(chapters) - set(by_chapter))
    if missing:
        raise SystemExit(f"missing chapter-full capture for {len(missing)} chapters; first: {missing[0]}")

    parsed_dir = root / "parsed"
    extract_dir = root / "extract" / "chapters"
    parsed_dir.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)
    currency = {
        "statement": (
            "2025 Minnesota Statutes on the Minnesota Legislative Web Site, published by the "
            "Office of the Revisor of Statutes."
        ),
        "as_of": None,
    }

    all_rows: list[dict] = []
    chapter_reports: list[dict] = []
    derivatives: dict[str, dict] = {}
    inventory_path = parsed_dir / "inventory.jsonl"
    sections_path = parsed_dir / "sections.jsonl"

    with inventory_path.open("wb") as inventory_handle, sections_path.open("wb") as sections_handle:
        for chapter in sorted(chapters, key=lambda value: (len(value), value)):
            receipt = by_chapter[chapter]
            html = (root / receipt["stored_path"]).read_bytes()
            rows, inventory, report, derivative = parse_chapter(
                html,
                chapter,
                part_label(chapters[chapter]),
                receipt,
                currency,
            )
            chapter_reports.append(report)
            for item in inventory:
                inventory_handle.write(canonical_line(item))
            for row in rows:
                sections_handle.write(canonical_line(row))
            all_rows.extend(rows)
            derivative_sha = rows[0]["source"]["derivative_sha256"] if rows else sha256_bytes(b"")
            derivative_path = extract_dir / derivative_sha
            derivative_path.write_text(derivative, encoding="utf8")
            derivatives[chapter] = {
                "sha256": derivative_sha,
                "bytes": len(derivative.encode("utf8")),
                "text_code_points": len(derivative),
                "url": receipt["url"],
                "receipt_sha256": receipt["sha256"],
                "path": str(derivative_path.relative_to(root)),
            }

    gaps = [
        report
        for report in chapter_reports
        if report["parsed_minus_toc"]
        or report["body_minus_toc"]
        or report["toc_minus_body"]
    ]
    repeated = {
        key: count for key, count in Counter(row["citation"] for row in all_rows).items() if count > 1
    }
    empty_without_status = [
        row["native_id"] for row in all_rows if not row["text"].strip() and not row["status_label"]
    ]
    parse_report = {
        "schema_version": "publisher-code-parse-report/2",
        "jurisdiction": "MN",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "counts": {
            "parts": len({part_label(url) for url in chapters.values()}),
            "chapters": len(chapters),
            "inventory_sections": sum(report["toc_sections"] for report in chapter_reports),
            "sections": len(all_rows),
            "rows": len(all_rows),
            "inactive_toc_rows": sum(report["inactive_toc_rows"] for report in chapter_reports),
        },
        "expected_vs_parsed": {
            "expected_chapters": len(chapters),
            "parsed_chapters": len(chapter_reports),
            "gaps": gaps,
        },
        "anomalies": {
            "repeated_citations": repeated,
            "empty_bodies_without_status": empty_without_status,
        },
        "derivatives": derivatives,
        "output_hashes": {
            "inventory_jsonl": sha256_file(inventory_path),
            "sections_jsonl": sha256_file(sections_path),
        },
        "chapter_reports": chapter_reports,
        "status": "parsed" if not gaps and not empty_without_status else "parsed-review",
    }
    (parsed_dir / "parse-report.json").write_text(
        json.dumps(parse_report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    print(
        json.dumps(
            {
                "chapters": len(chapter_reports),
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
