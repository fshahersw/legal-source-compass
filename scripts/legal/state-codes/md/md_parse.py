#!/usr/bin/env python3
"""Parse Maryland Code oct1 StatuteText HTML receipts into parsed/sections.jsonl."""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))

from md_lib import (  # noqa: E402
    CODE_ID,
    CODE_NAME,
    EDITION_KEY,
    ENACTMENTS,
    LANDING,
    PARSER_NAME,
    PARSER_VERSION,
    article_heading_from_display,
    citation_path,
    normalize_section_number,
    parse_statute_html,
    sha256_bytes,
    statute_url,
)
from provenance_fetch import verify_store  # noqa: E402

SECTION_LABEL = re.compile(r"^section:oct1:([a-z0-9]+):(.+)$")


def canonical_line(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf8")


def sha256_file(path: pathlib.Path) -> str:
    digest = __import__("hashlib").sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load_receipts(root: pathlib.Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]


def section_receipts(receipts: list[dict]) -> dict[tuple[str, str], dict]:
    out: dict[tuple[str, str], dict] = {}
    for receipt in receipts:
        if not receipt.get("ok"):
            continue
        label = receipt.get("label") or ""
        match = SECTION_LABEL.match(label)
        if not match:
            continue
        key = (match.group(1), normalize_section_number(match.group(2)))
        previous = out.get(key)
        if previous is None or receipt["retrieved_at"] >= previous["retrieved_at"]:
            out[key] = receipt
    return out


def load_inventory(root: pathlib.Path) -> list[dict]:
    rows = json.load(open(root / "extract" / "index-capture.json", encoding="utf8"))
    return [row for row in rows if row["edition_key"] == EDITION_KEY]


def build_derivative_and_spans(
    rows: list[dict],
    article_code: str,
    pdf_receipt: dict,
) -> tuple[str, list[dict]]:
    parts: list[str] = []
    cursor = 0
    enriched: list[dict] = []
    unit_key = "article:%s:%s" % (EDITION_KEY, article_code)
    for section in rows:
        path = section["citation_path_key"]
        heading = section["heading"] or ""
        prefix = "%s %s\n" % (path, heading) if heading else "%s\n" % path
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
                "state": "MD",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": EDITION_KEY,
                "native_id": path,
                "identity_kind": "official_citation_path",
                "citation": path,
                "citation_path": section["citation_path"],
                "heading": heading,
                "text": text,
                "history": None,
                "status_label": section.get("status_note"),
                "status_note": section.get("status_note"),
                "effective": None,
                "currency": {
                    "statement": (
                        "Maryland Code articles on mgaleg.maryland.gov with enactments=true "
                        "(in effect as of October 1)."
                    ),
                    "as_of": None,
                },
                "source": {
                    "url": section["source_url"],
                    "receipt_sha256": section["receipt_sha256"],
                    "member": unit_key,
                    "article_code": article_code,
                    "section_display": section["section_display"],
                    "pdf_receipt_sha256": pdf_receipt["sha256"],
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
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/MD"))
    args = ap.parse_args(argv)
    root = args.root
    inventory = load_inventory(root)
    by_article = {row["article_code"]: row for row in inventory}
    receipts = load_receipts(root)
    captured = section_receipts(receipts)
    pdf_by_article = {}
    for receipt in receipts:
        if not receipt.get("ok"):
            continue
        label = receipt.get("label") or ""
        if label.startswith("pdf:%s:" % EDITION_KEY):
            pdf_by_article[label.split(":", 2)[2]] = receipt

    parsed_dir = root / "parsed"
    extract_dir = root / "extract" / "articles"
    parsed_dir.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict] = []
    article_reports: list[dict] = []
    derivatives: dict[str, dict] = {}
    parse_errors: list[dict] = []
    inventory_path = parsed_dir / "inventory.jsonl"
    sections_path = parsed_dir / "sections.jsonl"
    expected_sections = sum(len(row["sections"]) for row in inventory)
    missing_capture: list[dict] = []

    with inventory_path.open("wb") as inventory_handle, sections_path.open("wb") as sections_handle:
        for article_row in sorted(inventory, key=lambda row: row["article_code"]):
            article_code = article_row["article_code"]
            article_heading = article_heading_from_display(article_row["article_display"])
            pdf_receipt = pdf_by_article.get(article_code)
            if pdf_receipt is None:
                pdf_receipt = {
                    "sha256": article_row.get("article_link_receipt"),
                    "url": article_row.get("pdf_url"),
                    "retrieved_at": None,
                }
            parsed_sections: list[dict] = []
            for sec in article_row["sections"]:
                display = sec["display"]
                norm = normalize_section_number(display)
                key = (article_code, norm)
                receipt = captured.get(key)
                if receipt is None:
                    missing_capture.append(
                        {
                            "article_code": article_code,
                            "section_display": display,
                            "url": statute_url(article_code, display, ENACTMENTS),
                        }
                    )
                    continue
                html = (root / receipt["stored_path"]).read_text(encoding="utf8", errors="replace")
                try:
                    parsed = parse_statute_html(html)
                except ValueError as exc:
                    parse_errors.append(
                        {
                            "article_code": article_code,
                            "section_display": display,
                            "error": str(exc),
                            "receipt_sha256": receipt["sha256"],
                        }
                    )
                    continue
                if parsed["section_number"] != norm:
                    parse_errors.append(
                        {
                            "article_code": article_code,
                            "section_display": display,
                            "error": "section number mismatch: page %r inventory %r"
                            % (parsed["section_number"], norm),
                            "receipt_sha256": receipt["sha256"],
                        }
                    )
                    continue
                path_key = citation_path(article_code, display)
                parsed_sections.append(
                    {
                        "section_display": display,
                        "citation_path_key": path_key,
                        "heading": parsed["heading"],
                        "text": parsed["text"],
                        "status_note": parsed["status_note"],
                        "source_url": receipt["url"],
                        "receipt_sha256": receipt["sha256"],
                        "citation_path": [
                            {
                                "level": "article",
                                "number": article_code,
                                "heading": article_heading or parsed.get("article_heading"),
                            },
                            {
                                "level": "section",
                                "number": display,
                                "heading": parsed["heading"] or None,
                            },
                        ],
                    }
                )
            inventory_handle.write(
                canonical_line(
                    {
                        "level": "article",
                        "edition_key": EDITION_KEY,
                        "article_code": article_code,
                        "article_display": article_row["article_display"],
                        "pdf_url": article_row["pdf_url"],
                        "sections_expected": len(article_row["sections"]),
                        "sections_captured": sum(
                            1
                            for sec in article_row["sections"]
                            if (article_code, normalize_section_number(sec["display"])) in captured
                        ),
                        "sections_parsed": len(parsed_sections),
                    }
                )
            )
            if not parsed_sections:
                article_reports.append(
                    {
                        "article_code": article_code,
                        "sections_expected": len(article_row["sections"]),
                        "sections_parsed": 0,
                        "skipped": True,
                    }
                )
                continue
            derivative, rows = build_derivative_and_spans(parsed_sections, article_code, pdf_receipt)
            unit_key = "article:%s:%s" % (EDITION_KEY, article_code)
            for row in rows:
                sections_handle.write(canonical_line(row))
            all_rows.extend(rows)
            derivative_sha = rows[0]["source"]["derivative_sha256"]
            derivative_path = extract_dir / derivative_sha
            derivative_path.write_text(derivative, encoding="utf8")
            derivatives[unit_key] = {
                "sha256": derivative_sha,
                "bytes": len(derivative.encode("utf8")),
                "text_code_points": len(derivative),
                "url": pdf_receipt.get("url") or article_row["pdf_url"],
                "receipt_sha256": pdf_receipt.get("sha256"),
                "path": str(derivative_path.relative_to(root)),
                "article_code": article_code,
            }
            article_reports.append(
                {
                    "article_code": article_code,
                    "sections_expected": len(article_row["sections"]),
                    "sections_parsed": len(parsed_sections),
                    "sections_missing_capture": len(article_row["sections"]) - len(parsed_sections),
                    "unit_key": unit_key,
                    "derivative_sha256": derivative_sha,
                }
            )

    checked, problems = verify_store(root)
    parse_report = {
        "schema_version": "publisher-code-parse-report/2",
        "jurisdiction": "MD",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "edition_key": EDITION_KEY,
        "counts": {
            "articles": len(inventory),
            "sections_expected": expected_sections,
            "sections_captured": len(captured),
            "sections_parsed": len(all_rows),
            "rows": len(all_rows),
            "parse_errors": len(parse_errors),
            "missing_capture": len(missing_capture),
        },
        "expected_vs_parsed": {
            "expected_sections": expected_sections,
            "captured_sections": len(captured),
            "parsed_sections": len(all_rows),
            "capture_complete": len(captured) >= expected_sections,
        },
        "anomalies": {
            "parse_errors_sample": parse_errors[:20],
            "missing_capture_sample": missing_capture[:20],
        },
        "derivatives": derivatives,
        "output_hashes": {
            "inventory_jsonl": sha256_file(inventory_path),
            "sections_jsonl": sha256_file(sections_path),
        },
        "article_reports": article_reports,
        "verify_store": {"checked": checked, "problems": problems},
        "publisher": {"landing_url": LANDING, "enactments": ENACTMENTS},
        "status": "parsed-partial" if len(all_rows) < expected_sections else "parsed",
    }
    (parsed_dir / "parse-report.json").write_text(
        json.dumps(parse_report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    gaps_path = parsed_dir / "gaps.json"
    gaps_path.write_text(
        json.dumps(
            {
                "missing_capture": missing_capture,
                "parse_errors": parse_errors,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf8",
    )
    print(
        json.dumps(
            {
                "articles": len(inventory),
                "expected_sections": expected_sections,
                "captured": len(captured),
                "parsed_rows": len(all_rows),
                "missing_capture": len(missing_capture),
                "parse_errors": len(parse_errors),
                "verify_store": [checked, len(problems)],
                "status": parse_report["status"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
