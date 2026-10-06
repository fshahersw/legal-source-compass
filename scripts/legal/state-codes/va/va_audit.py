"""Independent vacodefull marker and API inventory audit for Virginia parses."""
from __future__ import annotations

import argparse
import json
import pathlib

from va_parse import (  # noqa: E402
    count_section_markers,
    load_api_inventory,
    load_receipts,
    title_body_receipts,
)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/VA"))
    args = ap.parse_args(argv)
    root = args.root
    parse_report_path = root / "parsed" / "parse-report.json"
    parse_report = json.loads(parse_report_path.read_text(encoding="utf8"))
    sections_path = root / "parsed" / "sections.jsonl"

    parsed_by_title: dict[str, list[dict]] = {}
    span_errors = 0
    derivatives: dict[str, str] = {}
    for line in sections_path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        member = row["source"]["member"]
        title = member.removeprefix("title-")
        parsed_by_title.setdefault(title, []).append(row)
        span = row["source"].get("span")
        deriv_sha = row["source"].get("derivative_sha256")
        if deriv_sha and deriv_sha not in derivatives:
            derivative_path = root / "extract" / "titles" / deriv_sha
            if derivative_path.exists():
                derivatives[deriv_sha] = derivative_path.read_text(encoding="utf8")
        if span is not None and deriv_sha in derivatives:
            if span.get("unit") != "unicode_code_points":
                span_errors += 1
            else:
                body = derivatives[deriv_sha][span["start"] : span["end"]]
                if body != row["text"] or span["end"] - span["start"] != len(row["text"]):
                    span_errors += 1

    ordered_api, _ = load_api_inventory(root)
    receipts = load_receipts(root)
    bodies = title_body_receipts(receipts)

    raw_markers = 0
    title_mismatches = []
    api_mismatches = []
    for title, receipt in sorted(bodies.items()):
        raw_html = (root / receipt["stored_path"]).read_text(encoding="utf8")
        api_list = ordered_api.get(title, [])
        markers = count_section_markers(raw_html, api_list)
        raw_markers += markers
        rows = parsed_by_title.get(title, [])
        parsed = len(rows)
        title_report = next(
            (row for row in parse_report.get("title_reports", []) if row["title"] == title),
            None,
        )
        html_sections = title_report["html_sections"] if title_report else None
        if markers != html_sections:
            title_mismatches.append(
                {
                    "title": title,
                    "raw_markers": markers,
                    "html_sections": html_sections,
                    "parsed_rows": parsed,
                }
            )
        if api_list:
            api_set = set(api_list)
            parsed_set = {row["citation"] for row in rows}
            if api_set != parsed_set:
                api_mismatches.append(
                    {
                        "title": title,
                        "api_sections": len(api_set),
                        "parsed_sections": len(parsed_set),
                        "api_minus_parsed": len(api_set - parsed_set),
                        "parsed_minus_api": len(parsed_set - api_set),
                    }
                )

    parsed_rows = sum(len(rows) for rows in parsed_by_title.values())
    passed = (
        not title_mismatches
        and not api_mismatches
        and span_errors == 0
        and parsed_rows == parse_report["counts"]["rows"]
        and raw_markers == sum(
            row["html_sections"] for row in parse_report.get("title_reports", [])
        )
    )
    audit = {
        "method": (
            "independent <b>§ section header expansion counts on vacodefull title HTML "
            "compared to parsed rows, unicode spans in title text derivatives, and "
            "official CoVSectionsGetListOfJson inventory per title"
        ),
        "raw_markers": raw_markers,
        "parsed_rows": parsed_rows,
        "span_errors": span_errors,
        "title_mismatches": title_mismatches,
        "api_mismatches": api_mismatches,
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
