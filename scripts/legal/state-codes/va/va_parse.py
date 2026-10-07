"""Parse Code of Virginia vacodefull title HTML with API inventory cross-check."""
from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import pathlib
import re
import sys

from bs4 import BeautifulSoup, Comment, Declaration, Doctype, NavigableString, ProcessingInstruction, Tag

BASE = "https://law.lis.virginia.gov"
CODE_ID = "va-code"
CODE_NAME = "Code of Virginia"
EDITION = "Code of Virginia"
PARSER_NAME = "va-vacodefull-title-html"
PARSER_VERSION = "3"
# Text between block elements of #va_code (bare text, links, spans, non-header bold) belongs to the section as one paragraph.
INLINE_TAGS = {"a", "span", "i", "em", "strong", "u", "sup", "sub", "font", "small", "abbr", "b"}
SKIP_STRINGS = (Comment, Declaration, Doctype, ProcessingInstruction)
SECTION_ID_REGEX = (
    r"^[0-9][0-9A-Za-z.]*(?:-[0-9][0-9A-Za-z.]*)+"
    r"(?:\:[0-9A-Za-z.]+)*"
    r"(?:\:occurrence\:[2-9][0-9]*)?$"
)
CURRENCY = {
    "statement": "Code of Virginia as published on the Virginia Law Portal (law.lis.virginia.gov).",
    "as_of": None,
}
WS_RE = re.compile(r"\s+")
HISTORY_TAIL = re.compile(
    r"^((Code|Acts|R\. P\.)\s+\d{4}|Repealed by Acts|Added by Acts|Amended by Acts|"
    r"Derived from|Enacted by|From Acts)",
    re.I,
)
STATUS_RE = re.compile(
    r"\b(Repealed|Reserved|Expired|Renumbered|Transferred|Omitted|Superseded|Vacant|Deleted)\b",
    re.I,
)
H2_SUBTITLE = re.compile(r"^Subtitle\s+(\S+)\s*\.?\s*(.*)$", re.I)
H2_PART = re.compile(r"^Part\s+(\S+)\s*\.?\s*(.*)$", re.I)
H3_CHAPTER = re.compile(r"^Chapter\s+(\S+)\s*\.?\s*(.*)$", re.I)
H3_ARTICLE = re.compile(r"^Article\s+(\S+)\s*\.?\s*(.*)$", re.I)
CITATION_NUM = re.compile(r"^[0-9][0-9A-Za-z.]*-[0-9][0-9A-Za-z.]*$")


def normalized(text: str) -> str:
    return WS_RE.sub(" ", html_lib.unescape(text.replace("\xa0", " "))).strip()


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


def section_sort_key(value: str) -> tuple:
    parts: list[tuple] = []
    for piece in re.split(r"([.-])", value):
        if piece in (".", "-"):
            parts.append((0, piece))
        elif piece.isdigit():
            parts.append((1, int(piece)))
        else:
            parts.append((2, piece))
    return tuple(parts)


def section_in_range(number: str, start: str, end: str) -> bool:
    key = section_sort_key(number)
    return section_sort_key(start) <= key <= section_sort_key(end)


def title_sort_key(value: str) -> tuple:
    match = re.match(r"^(\d+)(.*)$", value)
    if not match:
        return (1, value)
    return (0, int(match.group(1)), match.group(2))


def load_receipts(root: pathlib.Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]


def title_body_receipts(receipts: list[dict]) -> dict[str, dict]:
    by_title: dict[str, dict] = {}
    for receipt in receipts:
        if not receipt.get("ok"):
            continue
        label = receipt.get("label") or ""
        if not label.startswith("title-body:"):
            continue
        title = label.split(":", 1)[1]
        by_title[title] = receipt
    return by_title


def load_api_inventory(root: pathlib.Path) -> tuple[dict[str, list[str]], dict[str, dict]]:
    """Return ordered section lists per title and section metadata keyed by citation."""
    receipts = load_receipts(root)
    ordered: dict[str, list[str]] = {}
    meta: dict[str, dict] = {}
    seen: set[str] = set()

    def title_heading(name: str) -> str:
        return normalized(name.title()) if name.isupper() else normalized(name)

    for receipt in receipts:
        if not receipt.get("ok") or not (receipt.get("label") or "").startswith("api-sections:"):
            continue
        title = receipt["label"].split(":")[1]
        data = json.loads((root / receipt["stored_path"]).read_text(encoding="utf8"))
        title_number = data["TitleNumber"]
        title_name = title_heading(data.get("TitleName") or "")
        subtitle = {
            "number": data.get("SubtitleNum") or None,
            "heading": title_heading(data.get("SubtitleName") or "") or None,
        }
        part = {
            "number": data.get("PartNum") or None,
            "heading": title_heading(data.get("PartName") or "") or None,
        }
        chapter = {
            "number": data.get("ChapterNum") or None,
            "heading": title_heading(data.get("ChapterName") or "") or None,
        }
        for article in data.get("ArticleList") or []:
            article_node = {
                "number": article.get("ArticleNum") or None,
                "heading": title_heading(article.get("ArticleName") or "") or None,
            }
            for subpart in article.get("SubPartList") or []:
                for section in subpart.get("SectionList") or []:
                    citation = section["SectionNumber"]
                    if citation in seen:
                        continue
                    seen.add(citation)
                    ordered.setdefault(title_number, []).append(citation)
                    path = [{"level": "title", "number": title_number, "heading": title_name}]
                    if subtitle["number"] or subtitle["heading"]:
                        path.append({"level": "subtitle", **subtitle})
                    if part["number"] or part["heading"]:
                        path.append({"level": "part", **part})
                    if chapter["number"] or chapter["heading"]:
                        path.append({"level": "chapter", **chapter})
                    if article_node["number"] or article_node["heading"]:
                        path.append({"level": "article", **article_node})
                    path.append(
                        {
                            "level": "section",
                            "number": citation,
                            "heading": normalized(section.get("SectionTitle") or ""),
                        }
                    )
                    meta[citation] = {
                        "heading": normalized(section.get("SectionTitle") or ""),
                        "citation_path": path,
                        "title": title_number,
                    }
    for title, citations in ordered.items():
        ordered[title] = sorted(citations, key=section_sort_key)
    return ordered, meta


HEADER_LABEL = re.compile(
    r"^(?:§§?\s*)?"
    r"((?:[0-9][0-9A-Za-z.]*-[0-9][0-9A-Za-z.]*"
    r"(?:\s*,\s*[0-9][0-9A-Za-z.]*-[0-9][0-9A-Za-z.]*)*)"
    r"(?:\s+through\s+[0-9][0-9A-Za-z.]*-[0-9][0-9A-Za-z.]*)?)"
    r"\.\s*(.*)$",
    re.I,
)


def parse_header_citations(label: str, ordered_api: list[str]) -> list[tuple[str, str]]:
    text = normalized(label)
    match = HEADER_LABEL.match(text)
    if not match:
        return []
    nums_part, heading = match.group(1).strip(), match.group(2).strip()
    nums: list[str] = []
    if re.search(r"\bthrough\b", nums_part, re.I):
        parts = re.split(r"\s+through\s+", nums_part, maxsplit=1, flags=re.I)
        if len(parts) == 2:
            start, end = parts[0].strip(), parts[1].strip()
            nums = [n for n in ordered_api if section_in_range(n, start, end)]
    else:
        for piece in re.split(r"\s*,\s*", nums_part):
            piece = piece.strip()
            if CITATION_NUM.match(piece):
                nums.append(piece)
    return [(n, heading) for n in nums]


def apply_hierarchy_line(text: str, hierarchy: dict) -> None:
    text = normalized(text)
    if not text:
        return
    match = H2_SUBTITLE.match(text)
    if match:
        hierarchy["subtitle"] = {"number": match.group(1), "heading": normalized(match.group(2)) or None}
        hierarchy.pop("part", None)
        hierarchy.pop("chapter", None)
        hierarchy.pop("article", None)
        return
    match = H2_PART.match(text)
    if match:
        hierarchy["part"] = {"number": match.group(1), "heading": normalized(match.group(2)) or None}
        hierarchy.pop("chapter", None)
        hierarchy.pop("article", None)
        return
    match = H3_CHAPTER.match(text)
    if match:
        hierarchy["chapter"] = {"number": match.group(1), "heading": normalized(match.group(2)) or None}
        hierarchy.pop("article", None)
        return
    match = H3_ARTICLE.match(text)
    if match:
        hierarchy["article"] = {"number": match.group(1), "heading": normalized(match.group(2)) or None}
        return
    if not hierarchy.get("title_heading"):
        hierarchy["title_heading"] = text


def html_hierarchy_path(title_number: str, hierarchy: dict, citation: str, heading: str) -> list[dict]:
    path = [
        {
            "level": "title",
            "number": title_number,
            "heading": hierarchy.get("title_heading"),
        }
    ]
    for level in ("subtitle", "part", "chapter", "article"):
        node = hierarchy.get(level)
        if node:
            path.append({"level": level, **node})
    path.append({"level": "section", "number": citation, "heading": heading})
    return path


def table_text(table: Tag) -> str:
    """A publisher table as text: one line per row, the row's cell texts separated by a tab (no characters added)."""
    rows = []
    for tr in table.find_all("tr"):
        cells = [normalized(cell.get_text(" ", strip=False)) for cell in tr.find_all(["td", "th"])]
        cells = [c for c in cells if c]
        if cells:
            rows.append("\t".join(cells))
    if not rows:
        return normalized(table.get_text(" ", strip=False))
    return "\n".join(rows)


def split_history(paragraphs: list[str]) -> tuple[str, str | None]:
    history: list[str] = []
    body = list(paragraphs)
    while body and HISTORY_TAIL.match(body[-1]):
        history.insert(0, body.pop())
    text = "\n".join(body).strip()
    hist = "\n".join(history).strip() or None
    return text, hist


def count_section_markers(raw_html: str, ordered_api: list[str]) -> int:
    soup = BeautifulSoup(raw_html, "lxml")
    node = soup.find(id="va_code")
    if node is None:
        return 0
    seen: set[str] = set()
    for child in node.children:
        if not isinstance(child, Tag) or child.name != "b":
            continue
        for citation, _ in parse_header_citations(child.get_text(" ", strip=True), ordered_api):
            seen.add(citation)
    return len(seen)


def count_section_versions(raw_html: str, ordered_api: list[str]) -> int:
    """Printed section versions: every single-citation header is one version; a citation only named in comma/range headers is one."""
    soup = BeautifulSoup(raw_html, "lxml")
    node = soup.find(id="va_code")
    if node is None:
        return 0
    single: dict[str, int] = {}
    grouped: set[str] = set()
    for child in node.children:
        if not isinstance(child, Tag) or child.name != "b":
            continue
        pairs = parse_header_citations(child.get_text(" ", strip=True), ordered_api)
        if len(pairs) == 1:
            single[pairs[0][0]] = single.get(pairs[0][0], 0) + 1
        else:
            grouped.update(c for c, _ in pairs)
    return sum(single.values()) + len(grouped - set(single))


def parse_title(
    raw_html: str,
    title_number: str,
    receipt: dict,
    ordered_api: list[str],
    api_meta: dict[str, dict],
) -> tuple[list[dict], list[dict], dict, str]:
    soup = BeautifulSoup(raw_html, "lxml")
    node = soup.find(id="va_code")
    if node is None:
        raise ValueError(f"title {title_number}: missing #va_code")
    # The publisher's stylesheet hides these (.hiddenTable {display: none !important}); they are not part of the printed text.
    for hidden in node.select(".hiddenTable"):
        hidden.decompose()

    hierarchy: dict = {"title_heading": None}
    inventory: list[dict] = [
        {
            "level": "title",
            "native_id": f"title-{title_number}",
            "number": title_number,
            "heading": None,
            "url": receipt["url"],
            "receipt_sha256": receipt["sha256"],
        }
    ]
    # citation -> every printed version of that section, in page order (the first keeps the plain citation as its identity).
    bodies: dict[str, list[dict]] = {}
    current: dict | None = None
    paragraphs: list[str] = []
    inline: list[str] = []

    def flush_inline() -> None:
        if current is not None:
            value = normalized("".join(inline))
            if value:
                paragraphs.append(value)
        inline.clear()

    def flush_section() -> None:
        nonlocal current, paragraphs
        flush_inline()
        if current is None:
            return
        text, history = split_history(paragraphs)
        heading = current["heading"]
        status_label = None
        if STATUS_RE.search(heading) or STATUS_RE.search(text) or not text.strip():
            status_label = heading if STATUS_RE.search(heading) else (heading or "Repealed")
        for citation in current["citations"]:
            api = api_meta.get(citation)
            citation_path = (
                api["citation_path"]
                if api
                else html_hierarchy_path(title_number, hierarchy, citation, heading)
            )
            hd = heading or (api["heading"] if api else "")
            versions = bodies.setdefault(citation, [])
            if len(current["citations"]) > 1 and versions:
                continue
            if len(versions) and citation_path and citation_path[-1].get("heading") != hd:
                citation_path = citation_path[:-1] + [{**citation_path[-1], "heading": hd}]
            versions.append(
                {
                    "citation": citation,
                    "occurrence": len(versions) + 1,
                    "heading": hd,
                    "text": text,
                    "history": history,
                    "status_label": status_label,
                    "citation_path": citation_path,
                }
            )
        current = None
        paragraphs = []

    for child in node.children:
        if isinstance(child, SKIP_STRINGS):
            continue
        if isinstance(child, NavigableString):
            inline.append(str(child))
            continue
        if not isinstance(child, Tag):
            continue
        if child.name in ("h2", "h3"):
            flush_section()
            apply_hierarchy_line(child.get_text(" ", strip=True), hierarchy)
            continue
        if child.name == "b":
            pairs = parse_header_citations(child.get_text(" ", strip=True), ordered_api)
            if pairs:
                flush_section()
                citations = [c for c, _ in pairs]
                heading = pairs[0][1]
                current = {"citations": citations, "heading": heading}
                continue
        if child.name in INLINE_TAGS:
            inline.append(child.get_text())
            continue
        if child.name == "br":
            flush_inline()
            continue
        flush_inline()
        if current is None:
            continue
        value = table_text(child) if child.name == "table" else normalized(child.get_text("\n", strip=False))
        if value:
            paragraphs.append(value)

    flush_section()

    api_set = set(ordered_api)
    if ordered_api:
        emit_order = ordered_api
    else:
        emit_order = sorted(bodies.keys(), key=section_sort_key)

    draft: list[dict] = []
    for citation in emit_order:
        if bodies.get(citation):
            draft.extend(bodies[citation])
            continue
        if not ordered_api:
            continue
        api = api_meta[citation]
        heading = api["heading"]
        status_label = heading if STATUS_RE.search(heading) else "Not in title HTML"
        draft.append(
            {
                "citation": citation,
                "occurrence": 1,
                "heading": heading,
                "text": "",
                "history": None,
                "status_label": status_label,
                "citation_path": api["citation_path"],
            }
        )
    for item in draft:
        item["native_id"] = item["citation"] if item["occurrence"] == 1 else f"{item['citation']}:occurrence:{item['occurrence']}"

    for item in draft:
        inventory.append(
            {
                "level": "section",
                "native_id": item["native_id"],
                "number": item["citation"],
                "heading": item["heading"],
                "title": title_number,
                "url": f"{BASE}/vacode/{item['citation']}/",
                "receipt_sha256": receipt["sha256"],
            }
        )

    derivative_parts: list[str] = []
    cursor = 0
    rows: list[dict] = []
    for item in draft:
        prefix = f"§ {item['citation']}. {item['heading']}\n"
        derivative_parts.append(prefix)
        cursor += len(prefix)
        body = item["text"]
        span = {"unit": "unicode_code_points", "start": cursor, "end": cursor + len(body)}
        derivative_parts.append(body)
        cursor += len(body)
        suffix = "\n"
        if item["history"]:
            suffix += item["history"] + "\n"
        derivative_parts.append(suffix)
        cursor += len(suffix)
        rows.append(
            {
                "state": "VA",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION,
                "native_id": item["native_id"],
                "identity_kind": "official_citation",
                "citation": item["citation"],
                "citation_path": item["citation_path"],
                "heading": item["heading"],
                "text": body,
                "history": item["history"],
                "status_label": item["status_label"],
                "effective": None,
                "currency": CURRENCY,
                "occurrence": item["occurrence"],
                "source": {
                    "url": receipt["url"],
                    "receipt_sha256": receipt["sha256"],
                    "member": f"title-{title_number}",
                    "span": span if body else None,
                },
                "text_sha256": sha256_bytes(body.encode("utf8")),
            }
        )

    derivative = "".join(derivative_parts)
    derivative_sha = sha256_bytes(derivative.encode("utf8"))
    for row in rows:
        row["source"]["derivative_sha256"] = derivative_sha

    marker_count = count_section_markers(raw_html, ordered_api)
    report = {
        "title": title_number,
        "url": receipt["url"],
        "marker_count": marker_count,
        "html_sections": sum(1 for v in bodies.values() if v),
        "html_versions": sum(len(v) for v in bodies.values()),
        "api_sections": len(ordered_api),
        "parsed_sections": len(rows),
        "api_minus_parsed": sorted(api_set - {r["citation"] for r in rows}, key=section_sort_key),
        "parsed_minus_api": sorted({r["citation"] for r in rows} - api_set, key=section_sort_key),
        "inventory_sections": sum(1 for item in inventory if item.get("level") == "section"),
    }
    return rows, inventory, report, derivative


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/VA"))
    args = ap.parse_args(argv)
    root = args.root
    receipts = load_receipts(root)
    bodies = title_body_receipts(receipts)
    if not bodies:
        raise SystemExit("no title-body receipts found")

    ordered_api, api_meta = load_api_inventory(root)
    parsed_dir = root / "parsed"
    extract_dir = root / "extract" / "titles"
    parsed_dir.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict] = []
    title_reports: list[dict] = []
    derivatives: dict[str, dict] = {}
    inventory_path = parsed_dir / "inventory.jsonl"
    sections_path = parsed_dir / "sections.jsonl"

    titles = sorted(bodies, key=title_sort_key)
    with inventory_path.open("wb") as inventory_handle, sections_path.open("wb") as sections_handle:
        for title_number in titles:
            receipt = bodies[title_number]
            raw_html = (root / receipt["stored_path"]).read_text(encoding="utf8")
            rows, inventory, report, derivative = parse_title(
                raw_html,
                title_number,
                receipt,
                ordered_api.get(title_number, []),
                api_meta,
            )
            title_reports.append(report)
            for item in inventory:
                inventory_handle.write(canonical_line(item))
            for row in rows:
                sections_handle.write(canonical_line(row))
            all_rows.extend(rows)
            derivative_sha = sha256_bytes(derivative.encode("utf8"))
            derivative_path = extract_dir / derivative_sha
            derivative_path.write_text(derivative, encoding="utf8")
            derivatives[title_number] = {
                "sha256": derivative_sha,
                "bytes": len(derivative.encode("utf8")),
                "text_code_points": len(derivative),
                "url": receipt["url"],
                "receipt_sha256": receipt["sha256"],
                "path": str(derivative_path.relative_to(root)),
                "title": title_number,
            }

    api_gaps = [
        r
        for r in title_reports
        if r["api_sections"] and (r["api_minus_parsed"] or r["parsed_minus_api"])
    ]
    marker_gaps = [r for r in title_reports if r["marker_count"] != r["html_sections"]]
    empty_without_status = [
        row["native_id"]
        for row in all_rows
        if not row["text"].strip() and not row["status_label"]
    ]
    parse_report = {
        "schema_version": "publisher-code-parse-report/2",
        "jurisdiction": "VA",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "counts": {
            "titles": len(titles),
            "inventory_sections": sum(r["inventory_sections"] for r in title_reports),
            "sections": len(all_rows),
            "rows": len(all_rows),
            "api_inventory_sections": sum(r["api_sections"] for r in title_reports),
            "html_markers": sum(r["marker_count"] for r in title_reports),
        },
        "expected_vs_parsed": {
            "expected_titles": len(titles),
            "parsed_titles": len(title_reports),
            "api_gaps": api_gaps,
            "marker_gaps": marker_gaps,
        },
        "anomalies": {"empty_bodies_without_status": empty_without_status},
        "derivatives": derivatives,
        "output_hashes": {
            "inventory_jsonl": sha256_file(inventory_path),
            "sections_jsonl": sha256_file(sections_path),
        },
        "title_reports": title_reports,
        "status": (
            "parsed"
            if not api_gaps and not marker_gaps and not empty_without_status
            else "parsed-review"
        ),
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
                "api_gaps": len(api_gaps),
                "marker_gaps": len(marker_gaps),
                "status": parse_report["status"],
            },
            sort_keys=True,
        )
    )
    return 0 if parse_report["status"] == "parsed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
