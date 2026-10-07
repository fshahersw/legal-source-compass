#!/usr/bin/env python3
"""Reconcile Maryland index-capture section lists against parsed/sections.jsonl."""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from md_lib import EDITION_KEY, PARSER_NAME, PARSER_VERSION, normalize_section_number, parse_statute_html  # noqa: E402
from md_parse import load_inventory, load_receipts, section_receipts  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/MD"))
    args = ap.parse_args(argv)
    root = args.root
    parse_report_path = root / "parsed" / "parse-report.json"
    if not parse_report_path.exists():
        raise SystemExit("run md_parse.py first")
    parse_report = json.loads(parse_report_path.read_text(encoding="utf8"))
    sections_path = root / "parsed" / "sections.jsonl"

    parsed_by_article: dict[str, list[str]] = {}
    parsed_keys: set[tuple[str, str]] = set()
    span_errors = 0
    derivatives: dict[str, str] = {}
    for line in sections_path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        article = row["source"]["article_code"]
        section_key = (
            article,
            normalize_section_number(row["source"]["section_display"]),
        )
        parsed_keys.add(section_key)
        parsed_by_article.setdefault(article, []).append(section_key[1])
        span = row["source"].get("span")
        deriv_sha = row["source"].get("derivative_sha256")
        if deriv_sha and deriv_sha not in derivatives:
            derivative_path = root / "extract" / "articles" / deriv_sha
            if derivative_path.exists():
                derivatives[deriv_sha] = derivative_path.read_text(encoding="utf8")
        if span is not None:
            if span.get("unit") != "unicode_code_points":
                span_errors += 1
            elif deriv_sha in derivatives:
                body = derivatives[deriv_sha][span["start"] : span["end"]]
                if body != row["text"] or span["end"] - span["start"] != len(row["text"]):
                    span_errors += 1

    inventory = load_inventory(root)
    captured = section_receipts(load_receipts(root))
    article_mismatches = []
    inventory_sections = 0
    inventory_captured = 0
    independent_parsed = 0
    independent_errors = 0
    for article_row in inventory:
        article_code = article_row["article_code"]
        expected = [normalize_section_number(sec["display"]) for sec in article_row["sections"]]
        inventory_sections += len(expected)
        inventory_captured += sum(1 for display in expected if (article_code, display) in captured)
        parsed = sorted(parsed_by_article.get(article_code, []))
        expected_sorted = sorted(expected)
        missing = sorted(set(expected_sorted) - set(parsed))
        extra = sorted(set(parsed) - set(expected_sorted))
        if missing or extra:
            article_mismatches.append(
                {
                    "article_code": article_code,
                    "expected": len(expected),
                    "parsed": len(parsed),
                    "missing": missing[:10],
                    "missing_count": len(missing),
                    "extra": extra[:10],
                    "extra_count": len(extra),
                }
            )
        for display in expected:
            receipt = captured.get((article_code, display))
            if not receipt:
                continue
            html = (root / receipt["stored_path"]).read_text(encoding="utf8", errors="replace")
            try:
                parsed_html = parse_statute_html(html)
                if parsed_html["section_number"] == display:
                    independent_parsed += 1
                else:
                    independent_errors += 1
            except ValueError:
                independent_errors += 1

    parsed_rows = sum(len(v) for v in parsed_by_article.values())
    capture_complete = inventory_captured == inventory_sections
    reconcile_passed = (
        span_errors == 0
        and independent_errors == 0
        and parse_report["counts"].get("parse_errors", 0) == 0
        and parsed_rows == parse_report["counts"].get("sections_parsed", 0)
        and parse_report["counts"].get("sections_parsed", 0)
        == parse_report["counts"].get("sections_captured", 0)
        and not any(row.get("extra_count") for row in article_mismatches)
    )
    passed = reconcile_passed and capture_complete and parsed_rows == inventory_sections
    audit = {
        "method": (
            "index-capture section lists per article compared to parsed rows; "
            "independent StatuteText re-parse for captured receipts; derivative span checks"
        ),
        "edition_key": EDITION_KEY,
        "inventory_sections": inventory_sections,
        "inventory_captured": inventory_captured,
        "capture_complete": capture_complete,
        "parsed_rows": parsed_rows,
        "independent_parsed": independent_parsed,
        "independent_errors": independent_errors,
        "article_mismatches": article_mismatches[:50],
        "article_mismatch_count": len(article_mismatches),
        "span_errors": span_errors,
        "reconcile_passed": reconcile_passed,
        "passed": passed,
        "result": "passed" if passed else ("partial" if parsed_rows else "review"),
    }
    parse_report["independent_audit"] = audit
    parse_report["status"] = "audited" if passed else ("audited-partial" if parsed_rows else "parsed-review")
    parse_report_path.write_text(
        json.dumps(parse_report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    audit_report = {
        "schema_version": "publisher-code-audit-report/1",
        "jurisdiction": "MD",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "audit": audit,
    }
    (root / "parsed" / "audit-report.json").write_text(
        json.dumps(audit_report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf8",
    )
    print(json.dumps(audit, sort_keys=True))
    return 0 if reconcile_passed or parsed_rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
