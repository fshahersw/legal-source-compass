"""Independent section-count audit for Alabama ALISON API page parses."""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from al_lib import SECTION_ID_REGEX  # noqa: E402
from al_parse import api_page_receipts, discover_last_page, load_receipts  # noqa: E402

SECTION_ID_RE = re.compile(SECTION_ID_REGEX)


def count_sections_with_content(data: list[dict]) -> int:
    return sum(
        1
        for row in data
        if row.get("type") == "Section"
        and str(row.get("content") or "").strip()
        and " through " not in str(row.get("displayId") or "").lower()
        and SECTION_ID_RE.match(str(row.get("displayId") or "").strip() or "")
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/AL"))
    args = ap.parse_args(argv)
    root = args.root
    last_page = discover_last_page(root)
    parse_report_path = root / "parsed" / "parse-report.json"
    parse_report = json.loads(parse_report_path.read_text(encoding="utf8"))
    sections_path = root / "parsed" / "sections.jsonl"

    parsed_by_page: dict[int, int] = {}
    span_errors = 0
    derivatives: dict[str, str] = {}
    for line in sections_path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        page = int(row["source"]["page"])
        parsed_by_page[page] = parsed_by_page.get(page, 0) + 1
        span = row["source"].get("span")
        deriv_sha = row["source"].get("derivative_sha256")
        if deriv_sha and deriv_sha not in derivatives:
            derivative_path = root / "extract" / "pages" / deriv_sha
            if derivative_path.exists():
                derivatives[deriv_sha] = derivative_path.read_text(encoding="utf8")
        if span is not None:
            if span.get("unit") != "unicode_code_points":
                span_errors += 1
            elif deriv_sha in derivatives:
                body = derivatives[deriv_sha][span["start"] : span["end"]]
                if body != row["text"] or span["end"] - span["start"] != len(row["text"]):
                    span_errors += 1

    raw_with_content = 0
    page_mismatches = []
    by_page = api_page_receipts(load_receipts(root), last_page)
    for page in range(1, last_page + 1):
        receipt = by_page[page]
        data = json.loads((root / receipt["stored_path"]).read_bytes())
        expected = count_sections_with_content(data)
        raw_with_content += expected
        parsed = parsed_by_page.get(page, 0)
        if expected != parsed:
            page_mismatches.append(
                {
                    "page": page,
                    "unit_key": f"api-page-{page}",
                    "raw_sections_with_content": expected,
                    "parsed_rows": parsed,
                }
            )

    parsed_rows = sum(parsed_by_page.values())
    passed = (
        not page_mismatches
        and raw_with_content == parsed_rows
        and span_errors == 0
        and parsed_rows == parse_report["counts"]["rows"]
    )
    audit = {
        "method": (
            "independent count of Section nodes with non-empty content per API page "
            "compared to parsed section rows and unicode derivative spans"
        ),
        "raw_sections_with_content": raw_with_content,
        "parsed_rows": parsed_rows,
        "section_count_match": raw_with_content == parsed_rows,
        "page_mismatches": page_mismatches,
        "span_errors": span_errors,
        "passed": passed,
        "result": "passed" if passed else "failed",
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
