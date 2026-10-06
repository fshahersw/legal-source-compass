"""Parse Alabama Code JSON API pages from ALISON capture receipts."""
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

from al_lib import (  # noqa: E402
    API,
    CODE_ID,
    CODE_NAME,
    EDITION,
    LANDING,
    PARSER_NAME,
    PARSER_VERSION,
    SECTION_ID_REGEX,
    html_to_text,
    section_heading,
    status_note_for,
    title_catchline,
)

LAST_PAGE_DEFAULT = 119


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


def api_page_from_receipt(receipt: dict) -> int | None:
    label = receipt.get("label") or ""
    url = receipt.get("url") or ""
    if "api/code-of-alabama" not in url:
        return None
    match = re.fullmatch(r"api-page:(\d+)", label)
    if match:
        return int(match.group(1))
    match = re.fullmatch(r"discover-page:(\d+)", label)
    if match:
        return int(match.group(1))
    match = re.fullmatch(r"probe:api-page-(\d+)", label)
    if match:
        return int(match.group(1))
    if label == "probe-api-page-1":
        return 1
    if "page=" not in url:
        return 1
    match = re.search(r"page=(\d+)", url)
    return int(match.group(1)) if match else None


def receipt_priority(label: str) -> int:
    if re.fullmatch(r"api-page:\d+", label):
        return 0
    if re.fullmatch(r"discover-page:\d+", label):
        return 1
    if re.fullmatch(r"probe:api-page-\d+", label):
        return 2
    if label == "probe-api-page-1":
        return 3
    return 4


def api_page_receipts(receipts: list[dict], last_page: int) -> dict[int, dict]:
    by_page: dict[int, tuple[int, dict]] = {}
    for receipt in receipts:
        if not receipt.get("ok"):
            continue
        page = api_page_from_receipt(receipt)
        if page is None or page > last_page:
            continue
        label = receipt.get("label") or ""
        priority = receipt_priority(label)
        previous = by_page.get(page)
        if previous is None or priority < previous[0]:
            by_page[page] = (priority, receipt)
    return {page: row[1] for page, row in by_page.items()}


SECTION_ID_RE = re.compile(SECTION_ID_REGEX)


def parse_display_id(display_id: str) -> tuple[str | None, str | None]:
    parts = display_id.split("-", 2)
    if len(parts) < 3:
        return None, None
    return parts[0], parts[1]


def parse_api_page(
    data: list[dict],
    page: int,
    receipt: dict,
) -> tuple[list[dict], dict]:
    ctx_title: dict | None = None
    ctx_chapter: dict | None = None
    rows: list[dict] = []
    section_nodes = 0
    sections_with_content = 0
    skipped_empty = 0
    skipped_non_citation = 0

    for node in data:
        node_type = node.get("type")
        if node_type == "Title":
            ctx_title = node
            ctx_chapter = None
            continue
        if node_type == "Chapter":
            ctx_chapter = node
            continue
        if node_type != "Section":
            continue
        section_nodes += 1
        display_id = str(node.get("displayId") or "").strip()
        if not display_id:
            continue
        if " through " in display_id.lower() or not SECTION_ID_RE.match(display_id):
            skipped_non_citation += 1
            continue
        content_html = node.get("content") or ""
        if not str(content_html).strip():
            skipped_empty += 1
            continue
        sections_with_content += 1
        text = html_to_text(content_html)
        note = status_note_for(content_html, node.get("title"))
        title_num, chapter_num = parse_display_id(display_id)
        if title_num is None and ctx_title:
            title_num = str(ctx_title.get("displayId") or "")
        if chapter_num is None and ctx_chapter:
            chapter_num = str(ctx_chapter.get("displayId") or "")
        heading = section_heading(node.get("title"), display_id)
        rows.append(
            {
                "display_id": display_id,
                "title_number": title_num,
                "chapter_number": chapter_num,
                "title_heading": title_catchline(ctx_title),
                "chapter_heading": title_catchline(ctx_chapter),
                "heading": heading,
                "text": text,
                "history": node.get("history"),
                "status_note": note,
                "api_index": node.get("sortOrder"),
            }
        )

    summary = {
        "page": page,
        "unit_key": f"api-page-{page}",
        "section_nodes": section_nodes,
        "sections_with_content": sections_with_content,
        "skipped_empty_sections": skipped_empty,
        "skipped_non_citation_sections": skipped_non_citation,
        "parsed_rows": len(rows),
    }
    return rows, summary


def build_derivative_and_spans(
    rows: list[dict],
    page: int,
    receipt: dict,
) -> tuple[str, list[dict]]:
    parts: list[str] = []
    cursor = 0
    enriched: list[dict] = []
    unit_key = f"api-page-{page}"
    for section in rows:
        citation = section["display_id"]
        heading = section["heading"] or ""
        prefix = f"{citation} {heading}\n" if heading else f"{citation}\n"
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
                "state": "AL",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION,
                "native_id": citation,
                "identity_kind": "official_citation",
                "citation": citation,
                "citation_path": [
                    {
                        "level": "title",
                        "number": section["title_number"],
                        "heading": section["title_heading"],
                    },
                    {
                        "level": "chapter",
                        "number": section["chapter_number"],
                        "heading": section["chapter_heading"],
                    },
                    {
                        "level": "section",
                        "number": citation,
                        "heading": heading,
                    },
                ],
                "heading": heading,
                "text": text,
                "history": section.get("history"),
                "status_label": section.get("status_note"),
                "status_note": section.get("status_note"),
                "effective": None,
                "currency": {
                    "statement": (
                        "Code of Alabama as published on alison.legislature.state.al.us "
                        "(ALISON JSON API). Session-law updates require separate reconciliation."
                    ),
                    "as_of": None,
                },
                "source": {
                    "url": receipt["url"],
                    "receipt_sha256": receipt["sha256"],
                    "member": unit_key,
                    "page": page,
                    "api_index": section.get("api_index"),
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


def discover_last_page(root: pathlib.Path) -> int:
    plan = root / "extract" / "capture-plan.json"
    if plan.exists():
        return int(json.loads(plan.read_text(encoding="utf8"))["discovered_last_page"])
    totals = root / "extract" / "capture-totals.json"
    if totals.exists():
        return int(json.loads(totals.read_text(encoding="utf8"))["last_page"])
    return LAST_PAGE_DEFAULT


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/AL"))
    args = ap.parse_args(argv)
    root = args.root
    last_page = discover_last_page(root)
    receipts = load_receipts(root)
    by_page = api_page_receipts(receipts, last_page)
    missing = [page for page in range(1, last_page + 1) if page not in by_page]
    if missing:
        raise SystemExit(f"missing API page capture for pages: {missing[:10]} (total {len(missing)})")

    parsed_dir = root / "parsed"
    extract_dir = root / "extract" / "pages"
    parsed_dir.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict] = []
    page_reports: list[dict] = []
    derivatives: dict[str, dict] = {}
    global_occurrences: Counter[str] = Counter()
    inventory_path = parsed_dir / "inventory.jsonl"
    sections_path = parsed_dir / "sections.jsonl"

    with inventory_path.open("wb") as inventory_handle, sections_path.open("wb") as sections_handle:
        for page in range(1, last_page + 1):
            receipt = by_page[page]
            raw = (root / receipt["stored_path"]).read_bytes()
            data = json.loads(raw)
            if not isinstance(data, list):
                raise SystemExit(f"page {page}: expected JSON array")
            page_rows, summary = parse_api_page(data, page, receipt)
            inventory_handle.write(
                canonical_line(
                    {
                        "level": "api_page",
                        "unit": "api_page",
                        "native_id": summary["unit_key"],
                        "number": page,
                        "unit_key": summary["unit_key"],
                        "url": receipt["url"],
                        "receipt_sha256": receipt["sha256"],
                        "section_nodes": summary["section_nodes"],
                        "sections_with_content": summary["sections_with_content"],
                        "section_count": summary["parsed_rows"],
                        "skipped_empty_sections": summary["skipped_empty_sections"],
                    }
                )
            )
            derivative, rows = build_derivative_and_spans(page_rows, page, receipt)
            for row in rows:
                global_occurrences[row["citation"]] += 1
                occurrence = global_occurrences[row["citation"]]
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
            derivatives[summary["unit_key"]] = {
                "sha256": derivative_sha,
                "bytes": len(derivative.encode("utf8")),
                "text_code_points": len(derivative),
                "url": receipt["url"],
                "receipt_sha256": receipt["sha256"],
                "path": str(derivative_path.relative_to(root)),
                "page": page,
            }
            page_reports.append({**summary, "receipt_sha256": receipt["sha256"], "url": receipt["url"]})

    repeated = {
        key: count for key, count in Counter(row["citation"] for row in all_rows).items() if count > 1
    }
    parse_report = {
        "schema_version": "publisher-code-parse-report/2",
        "jurisdiction": "AL",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "counts": {
            "api_pages": last_page,
            "sections": len(all_rows),
            "rows": len(all_rows),
            "skipped_empty_sections": sum(report["skipped_empty_sections"] for report in page_reports),
        },
        "expected_vs_parsed": {
            "expected_api_pages": last_page,
            "parsed_api_pages": len(page_reports),
            "sections_with_content": sum(report["sections_with_content"] for report in page_reports),
        },
        "anomalies": {"repeated_citations": repeated},
        "derivatives": derivatives,
        "output_hashes": {
            "inventory_jsonl": sha256_file(inventory_path),
            "sections_jsonl": sha256_file(sections_path),
        },
        "page_reports": page_reports,
        "publisher": {
            "landing_url": LANDING,
            "api_url": API,
        },
        "status": "parsed",
    }
    (parsed_dir / "parse-report.json").write_text(
        json.dumps(parse_report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    print(
        json.dumps(
            {
                "api_pages": len(page_reports),
                "rows": len(all_rows),
                "sections_with_content": parse_report["expected_vs_parsed"]["sections_with_content"],
                "skipped_empty_sections": parse_report["counts"]["skipped_empty_sections"],
                "status": parse_report["status"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
