"""Independent bold-heading audit for Oregon ORS chapter HTML parses."""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from or_parse import load_receipts, parse_chapter_html  # noqa: E402


def chapter_from_url(url: str) -> str | None:
    match = re.search(r"/ors(\d{3})([a-z]*)\.html$", url, re.I)
    if not match:
        return None
    return str(int(match.group(1))) + match.group(2).upper()


def count_bold_headings(raw: bytes, chapter_id: str) -> int:
    parsed = parse_chapter_html(raw, chapter_id)
    return len(parsed["sections"])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/OR"))
    args = ap.parse_args(argv)
    root = args.root
    parse_report_path = root / "parsed" / "parse-report.json"
    parse_report = json.loads(parse_report_path.read_text(encoding="utf8"))
    sections_path = root / "parsed" / "sections.jsonl"

    parsed_by_chapter: dict[str, int] = {}
    span_errors = 0
    derivatives: dict[str, str] = {}
    for line in sections_path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        chapter = row["citation_path"][1]["number"]
        parsed_by_chapter[chapter] = parsed_by_chapter.get(chapter, 0) + 1
        span = row["source"].get("span")
        deriv_sha = row["source"].get("derivative_sha256")
        if deriv_sha and deriv_sha not in derivatives:
            derivative_path = root / "extract" / "chapters" / deriv_sha
            if derivative_path.exists():
                derivatives[deriv_sha] = derivative_path.read_text(encoding="utf8")
        if span is not None:
            if span.get("unit") != "unicode_code_points":
                span_errors += 1
            elif deriv_sha in derivatives:
                body = derivatives[deriv_sha][span["start"] : span["end"]]
                if body != row["text"] or span["end"] - span["start"] != len(row["text"]):
                    span_errors += 1

    raw_markers = 0
    chapter_mismatches = []
    for receipt in load_receipts(root):
        if not receipt.get("ok") or receipt.get("label") != "chapter-html":
            continue
        chapter = chapter_from_url(receipt["url"])
        if not chapter:
            continue
        raw = (root / receipt["stored_path"]).read_bytes()
        expected = count_bold_headings(raw, chapter)
        raw_markers += expected
        parsed = parsed_by_chapter.get(chapter, 0)
        if expected != parsed:
            chapter_mismatches.append(
                {"chapter": chapter, "raw_headings": expected, "parsed_rows": parsed}
            )

    parsed_rows = sum(parsed_by_chapter.values())
    passed = (
        not chapter_mismatches
        and raw_markers == parsed_rows
        and span_errors == 0
        and parsed_rows == parse_report["counts"]["rows"]
    )
    audit = {
        "method": (
            "independent re-parse bold ORS section headings per chapter compared to "
            "stored section rows and unicode derivative spans"
        ),
        "raw_markers": raw_markers,
        "parsed_rows": parsed_rows,
        "section_count_match": raw_markers == parsed_rows,
        "chapter_mismatches": chapter_mismatches,
        "span_errors": span_errors,
        "passed": passed,
        "result": "passed" if passed else "review",
    }
    parse_report["independent_audit"] = audit
    parse_report["status"] = "audited" if passed else parse_report.get("status", "parsed-review")
    parse_report_path.write_text(
        json.dumps(parse_report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    (root / "parsed" / "audit-report.json").write_text(
        json.dumps(audit, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    print(json.dumps(audit, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
