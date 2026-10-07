"""Independent HTML marker audit for Colorado CRS title HTM parses."""
from __future__ import annotations

import argparse
import json
import pathlib
import re

from lxml import html

CRS_SECTION = re.compile(
    r"^(\d+(?:\.\d+)?-\d+(?:\.\d+)?-\d+(?:\.\d+)?)\.\s+"
)
CONST_SECTION = re.compile(r"^Section\s+\d+(?:\.\d+)?\.\s", re.I)


def is_bold(paragraph) -> bool:
    return bool(paragraph.xpath("./b|./span/b|./strong"))


def title_number_from_name(name: str) -> str:
    match = re.search(r"crs2026-title-(\d+(?:\.\d+)?)\.htm$", name, re.I)
    if not match:
        raise ValueError(name)
    raw = match.group(1)
    return raw if "." in raw else str(int(raw))


def count_markers(raw: bytes, title_number: str) -> tuple[int, int]:
    text = raw.decode("cp1252", errors="replace")
    tree = html.fromstring(text)
    bold = 0
    plain = 0
    for paragraph in tree.iter("p"):
        line = " ".join(paragraph.text_content().split())
        if not line:
            continue
        if title_number == "0":
            if CONST_SECTION.match(line) and is_bold(paragraph):
                bold += 1
            continue
        if CRS_SECTION.match(line):
            if is_bold(paragraph):
                bold += 1
            else:
                plain += 1
    return bold, plain


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/CO"))
    args = ap.parse_args(argv)
    root = args.root
    parse_report_path = root / "parsed" / "parse-report.json"
    parse_report = json.loads(parse_report_path.read_text(encoding="utf8"))
    sections_path = root / "parsed" / "sections.jsonl"

    parsed_by_member: dict[str, list[dict]] = {}
    span_errors = 0
    derivatives: dict[str, str] = {}
    for line in sections_path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        member = row["source"]["member"]
        parsed_by_member.setdefault(member, []).append(row)
        span = row["source"].get("span")
        deriv_sha = row["source"].get("derivative_sha256")
        if deriv_sha and deriv_sha not in derivatives:
            derivative_path = root / "extract" / "titles" / deriv_sha
            if derivative_path.exists():
                derivatives[deriv_sha] = derivative_path.read_text(encoding="utf8")
        if span is not None:
            if span.get("unit") != "unicode_code_points":
                span_errors += 1
            elif deriv_sha in derivatives:
                body = derivatives[deriv_sha][span["start"] : span["end"]]
                if body != row["text"] or span["end"] - span["start"] != len(row["text"]):
                    span_errors += 1

    receipts = [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]
    title_receipts = {
        receipt["url"].rsplit("/", 1)[-1]: receipt
        for receipt in receipts
        if receipt.get("ok")
        and receipt.get("label") == "crs-download"
        and receipt["url"].endswith(".htm")
        and not receipt["url"].endswith("index.htm")
    }

    raw_bold = 0
    raw_plain = 0
    title_mismatches = []
    for member, receipt in sorted(title_receipts.items()):
        title_number = title_number_from_name(member)
        raw = (root / receipt["stored_path"]).read_bytes()
        bold, plain = count_markers(raw, title_number)
        raw_bold += bold
        raw_plain += plain
        rows = parsed_by_member.get(member, [])
        with_span = sum(1 for row in rows if row["source"].get("span") is not None)
        if title_number == "0":
            if bold != len(rows) or with_span != bold:
                title_mismatches.append(
                    {
                        "member": member,
                        "raw_bold": bold,
                        "parsed_rows": len(rows),
                        "parsed_with_span": with_span,
                    }
                )
        elif bold != with_span:
            title_mismatches.append(
                {
                    "member": member,
                    "raw_bold": bold,
                    "raw_plain": plain,
                    "parsed_rows": len(rows),
                    "parsed_with_span": with_span,
                }
            )

    parsed_rows = sum(len(rows) for rows in parsed_by_member.values())
    passed = (
        not title_mismatches
        and span_errors == 0
        and parsed_rows == parse_report["counts"]["rows"]
        and raw_bold == sum(
            1
            for rows in parsed_by_member.values()
            for row in rows
            if row["source"].get("span") is not None
        )
    )
    audit = {
        "method": (
            "independent bold/plain paragraph marker counts on retained title HTM compared "
            "to parsed section rows and unicode spans in title text derivatives"
        ),
        "raw_bold_markers": raw_bold,
        "raw_plain_markers": raw_plain,
        "parsed_rows": parsed_rows,
        "span_errors": span_errors,
        "title_mismatches": title_mismatches,
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
