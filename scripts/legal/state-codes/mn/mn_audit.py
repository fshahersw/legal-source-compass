"""Independent HTML marker audit for the Minnesota chapter-full parse."""
from __future__ import annotations

import argparse
import json
import pathlib
import re

SECTION_MARKER = re.compile(br'<div class="section"', re.I)
STATUS_MARKER = re.compile(br'<div class="sr"', re.I)
STATUS_BY_SUBD_MARKER = re.compile(br'<div class="sr_by_subd"', re.I)


def receipts(root: pathlib.Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]


def chapter_from_url(url: str) -> str | None:
    match = re.search(r"/statutes/cite/([0-9A-Za-z]+)/full$", url)
    return match.group(1) if match else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/MN"))
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
        deriv_sha = row["source"]["derivative_sha256"]
        if deriv_sha not in derivatives:
            derivatives[deriv_sha] = None
        if span is not None:
            if span.get("unit") != "unicode_code_points":
                span_errors += 1

    raw_markers = 0
    chapter_mismatches = []
    for receipt in receipts(root):
        if not receipt.get("ok") or receipt.get("label") != "chapter-full":
            continue
        chapter = chapter_from_url(receipt["url"])
        if not chapter:
            continue
        html = (root / receipt["stored_path"]).read_bytes()
        expected = (
            len(SECTION_MARKER.findall(html))
            + len(STATUS_MARKER.findall(html))
            + len(STATUS_BY_SUBD_MARKER.findall(html))
        )
        raw_markers += expected
        parsed = parsed_by_chapter.get(chapter, 0)
        if expected != parsed:
            chapter_mismatches.append(
                {"chapter": chapter, "raw_markers": expected, "parsed_rows": parsed}
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
            "independent raw HTML div.section, div.sr, and div.sr_by_subd marker counts "
            "compared to parsed rows"
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
