"""Parse Oregon Revised Statutes chapter HTML from the Oregon Legislature site."""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))

from or_lib import (  # noqa: E402
    BASE,
    CODE_ID,
    CODE_NAME,
    EDITION,
    PARSER_NAME,
    PARSER_VERSION,
    chapter_sort_key,
    detect_encoding,
    html_text,
    title_group_for_chapter,
)


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
        if not receipt.get("ok"):
            continue
        label = receipt.get("label") or ""
        if label not in ("chapter-html", "toc-probe"):
            continue
        match = re.search(r"/ors(\d{3})([a-z]*)\.html$", receipt["url"], re.I)
        chapter = None
        if match:
            chapter = str(int(match.group(1))) + match.group(2).upper()
        if chapter:
            by_chapter[str(chapter)] = receipt
    return by_chapter


def parse_chapter_html(raw: bytes, chapter_id: str) -> dict:
    encoding = detect_encoding(raw)
    latin = raw.decode("latin1")
    citation = re.compile(
        rf"^\s*({re.escape(str(chapter_id))}\.\d+[A-Z]?)\b",
        re.I,
    )
    paragraphs = []
    for match in re.finditer(r"<p\b[^>]*>[\s\S]*?</p\s*>", latin, re.I):
        fragment = match.group(0)
        bold_texts = [
            html_text(bold.group(1), encoding)
            for bold in re.finditer(r"<b\b[^>]*>([\s\S]*?)</b\s*>", fragment, re.I)
        ]
        paragraphs.append(
            {
                "start": match.start(),
                "end": match.end(),
                "html": fragment,
                "bold_texts": bold_texts,
            }
        )
    section_heads = []
    for index, paragraph in enumerate(paragraphs):
        for bold in paragraph["bold_texts"]:
            hit = citation.match(bold)
            if not hit:
                continue
            section_heads.append(
                {
                    "paragraph_index": index,
                    "citation": hit.group(1),
                    "title": bold[hit.end() :].strip(" .:;"),
                }
            )
            break
    metadata = re.search(
        r"Chapter\s+([0-9]+[A-Z]?)\s+([^<\r\n]+)",
        latin,
        re.I,
    )
    chapter_title = None
    if metadata:
        chapter_title = html_text(metadata.group(2), encoding)
        chapter_title = re.sub(r"^[\u2010-\u2015-]\s*", "", chapter_title)
    sections = []
    for index, head in enumerate(section_heads):
        start = paragraphs[head["paragraph_index"]]["start"]
        end = (
            paragraphs[section_heads[index + 1]["paragraph_index"]]["start"]
            if index + 1 < len(section_heads)
            else len(latin)
        )
        sections.append(
            {
                "chapter": str(chapter_id),
                "chapter_title": chapter_title,
                "citation": f"ORS {head['citation']}",
                "title": head["title"] or None,
                "source_span": {"byte_start": start, "byte_end": end},
                "text": html_text(latin[start:end], encoding),
            }
        )
    return {"encoding": encoding, "sections": sections}


def parse_title_chapter_list_html(raw: bytes) -> dict:
    encoding = detect_encoding(raw)
    latin = raw.decode("latin1")
    paragraphs = []
    for match in re.finditer(r"<p\b[^>]*>[\s\S]*?</p\s*>", latin, re.I):
        paragraphs.append(
            {
                "start": match.start(),
                "end": match.end(),
                "text": html_text(match.group(0), encoding),
            }
        )
    title_index = next(
        (index for index, row in enumerate(paragraphs) if re.fullmatch(r"TITLE\s+\d+[A-Z]?", row["text"], re.I)),
        -1,
    )
    if title_index < 0:
        return {"encoding": encoding, "title_number": None, "title_name": None, "chapters": []}
    title_number = re.fullmatch(r"TITLE\s+(\d+[A-Z]?)", paragraphs[title_index]["text"], re.I)
    title_number = title_number.group(1) if title_number else None
    title_name = None
    for row in paragraphs[title_index + 1 :]:
        if row["text"] and not re.match(r"^Chapter\s+\d+", row["text"], re.I):
            title_name = re.sub(r"\s+", " ", row["text"]).strip()
            break
    start_index = next(
        (
            index
            for index, row in enumerate(paragraphs)
            if index > title_index and re.match(r"^Chapter\s+\d+[A-Z]?\.", row["text"], re.I)
        ),
        -1,
    )
    if start_index < 0:
        return {
            "encoding": encoding,
            "title_number": title_number,
            "title_name": title_name,
            "chapters": [],
        }
    chapters = []
    for row in paragraphs[start_index:]:
        if re.fullmatch(r"_{3,}", row["text"]):
            break
        first = re.match(r"^Chapter\s+(\d+[A-Z]?)\.\s*([\s\S]+)$", row["text"], re.I)
        next_match = re.match(r"^(\d+[A-Z]?)\.\s+([\s\S]+)$", row["text"], re.I)
        hit = first or next_match
        if not hit:
            continue
        chapters.append(
            {
                "chapter": hit.group(1),
                "title": re.sub(r"\s+", " ", hit.group(2)).strip(),
                "source_span": {"byte_start": row["start"], "byte_end": row["end"]},
            }
        )
    return {
        "encoding": encoding,
        "title_number": title_number,
        "title_name": title_name,
        "chapters": chapters,
    }


def build_derivative_and_spans(
    sections: list[dict],
    chapter: str,
    receipt: dict,
    title_meta: dict,
) -> tuple[str, list[dict]]:
    parts: list[str] = []
    cursor = 0
    enriched: list[dict] = []
    for section in sections:
        citation = section["citation"].removeprefix("ORS ").strip()
        heading = section["title"] or ""
        prefix = f"{citation} {heading}\n"
        parts.append(prefix)
        cursor += len(prefix)
        text = section["text"]
        span = {"unit": "unicode_code_points", "start": cursor, "end": cursor + len(text)}
        parts.append(text)
        cursor += len(text)
        parts.append("\n")
        cursor += 1
        enriched.append(
            {
                "state": "OR",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION,
                "native_id": citation,
                "identity_kind": "official_citation",
                "citation": citation,
                "citation_path": [
                    {
                        "level": "title",
                        "number": title_meta["title_number"],
                        "heading": title_meta["title_name"],
                    },
                    {
                        "level": "chapter",
                        "number": chapter,
                        "heading": section.get("chapter_title"),
                    },
                    {
                        "level": "section",
                        "number": citation,
                        "heading": heading,
                    },
                ],
                "heading": heading,
                "text": text,
                "history": None,
                "status_label": None,
                "effective": None,
                "currency": {
                    "statement": (
                        "2025 Oregon Revised Statutes as published on oregonlegislature.gov. "
                        "Session-law updates after the 2025 edition require separate reconciliation."
                    ),
                    "as_of": None,
                },
                "source": {
                    "url": receipt["url"],
                    "receipt_sha256": receipt["sha256"],
                    "member": chapter,
                    "byte_start": section["source_span"]["byte_start"],
                    "byte_end": section["source_span"]["byte_end"],
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/OR"))
    args = ap.parse_args(argv)
    root = args.root
    chapter_list = json.loads((root / "chapter-list.json").read_text(encoding="utf8"))
    index_groups = json.loads((root / "index-groups.json").read_text(encoding="utf8"))
    receipts = load_receipts(root)
    by_chapter = chapter_receipts(receipts)
    chapter_keys = set(chapter_list) | set(by_chapter)
    missing = sorted(set(chapter_list) - set(by_chapter), key=chapter_sort_key)
    if missing:
        raise SystemExit(
            f"missing chapter-html capture for {len(missing)} chapters; first: {missing[0]}"
        )
    extra = sorted(set(by_chapter) - set(chapter_list), key=chapter_sort_key)
    if extra:
        print(
            json.dumps(
                {
                    "chapters_in_receipts_not_in_chapter_list": len(extra),
                    "sample": extra[:10],
                },
                sort_keys=True,
            ),
            flush=True,
        )

    parsed_dir = root / "parsed"
    extract_dir = root / "extract" / "chapters"
    parsed_dir.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict] = []
    chapter_reports: list[dict] = []
    derivatives: dict[str, dict] = {}
    inventory_path = parsed_dir / "inventory.jsonl"
    sections_path = parsed_dir / "sections.jsonl"

    with inventory_path.open("wb") as inventory_handle, sections_path.open("wb") as sections_handle:
        for chapter in sorted(chapter_keys, key=chapter_sort_key):
            receipt = by_chapter[chapter]
            raw = (root / receipt["stored_path"]).read_bytes()
            parsed = parse_chapter_html(raw, chapter)
            title_meta = chapter_list.get(chapter) or {}
            if not title_meta.get("title_number"):
                title_meta = title_group_for_chapter(index_groups, chapter)
                title_meta = {
                    "title_number": title_meta["title_number"],
                    "title_name": title_meta["title_name"],
                }
            inventory_handle.write(
                canonical_line(
                    {
                        "level": "chapter",
                        "native_id": chapter,
                        "number": chapter,
                        "heading": parsed["sections"][0]["chapter_title"]
                        if parsed["sections"]
                        else None,
                        "title_number": title_meta["title_number"],
                        "url": receipt["url"],
                        "receipt_sha256": receipt["sha256"],
                        "section_count": len(parsed["sections"]),
                    }
                )
            )
            derivative, rows = build_derivative_and_spans(
                parsed["sections"], chapter, receipt, title_meta
            )
            occurrences = Counter()
            for row in rows:
                occurrences[row["citation"]] += 1
                occurrence = occurrences[row["citation"]]
                if occurrence > 1:
                    row["native_id"] = f"{row['citation']}:occurrence:{occurrence}"
                    row["identity_kind"] = "official_citation_with_occurrence"
                    row["occurrence"] = occurrence
                else:
                    row["occurrence"] = 1
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
            chapter_reports.append(
                {
                    "chapter": chapter,
                    "encoding": parsed["encoding"],
                    "sections": len(parsed["sections"]),
                    "chapter_title": parsed["sections"][0]["chapter_title"]
                    if parsed["sections"]
                    else None,
                }
            )

    empty_chapters = [report["chapter"] for report in chapter_reports if report["sections"] == 0]
    repeated = {
        key: count for key, count in Counter(row["citation"] for row in all_rows).items() if count > 1
    }
    parse_report = {
        "schema_version": "publisher-code-parse-report/2",
        "jurisdiction": "OR",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "counts": {
            "chapters": len(chapter_keys),
            "sections": len(all_rows),
            "rows": len(all_rows),
            "empty_chapters": len(empty_chapters),
        },
        "expected_vs_parsed": {
            "expected_chapters": len(chapter_keys),
            "parsed_chapters": len(chapter_reports),
            "empty_chapters": empty_chapters,
        },
        "anomalies": {"repeated_citations": repeated},
        "derivatives": derivatives,
        "output_hashes": {
            "inventory_jsonl": sha256_file(inventory_path),
            "sections_jsonl": sha256_file(sections_path),
        },
        "chapter_reports": chapter_reports,
        "status": "parsed" if not empty_chapters else "parsed-review",
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
                "empty_chapters": len(empty_chapters),
                "status": parse_report["status"],
            },
            sort_keys=True,
        )
    )
    return 0 if parse_report["status"] == "parsed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
