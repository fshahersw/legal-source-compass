"""Independent marker/count audit for the Oklahoma complete-title RTF parse.

This intentionally does not import the parser.  It re-extracts each retained RTF,
counts simple publisher marker lines, and compares those counts to parsed JSONL.
"""
from __future__ import annotations

import collections
import hashlib
import json
import pathlib
import re
import sys

from striprtf.striprtf import rtf_to_text


def is_marker(line: str) -> bool:
    return (
        (line.startswith("§") or line.startswith("Rule "))
        and ".  " in line
    )


def normalized_key(line: str, title: str) -> str:
    prefix, _heading = line.split(".  ", 1)
    if prefix.startswith("§"):
        key = prefix[1:].strip()
        if key.lower().startswith(f"{title.lower()}-rule "):
            return title + key[len(title) :]
        if key.lower().startswith(f"{title.lower()}-"):
            return title + key[len(title) :]
        digest = hashlib.sha256(key.encode("utf8")).hexdigest()[:16]
        return f"{title}:marker:{digest}"
    return f"{title}-Rule {prefix[len('Rule '):]}"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def main() -> None:
    root = pathlib.Path(sys.argv[1])
    receipts = [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]
    title_receipts = sorted(
        [
            row
            for row in receipts
            if row.get("ok") and str(row.get("label", "")).startswith("title:")
        ],
        key=lambda row: row["label"],
    )
    body_count = 0
    inventory_count = 0
    body_keys: collections.Counter[str] = collections.Counter()
    inventory_keys: collections.Counter[str] = collections.Counter()
    body_region_chars = 0
    covered_body_region_chars = 0
    derivative_hashes_match = True

    for receipt in title_receipts:
        title = receipt["label"].split(":")[1]
        raw = (root / receipt["stored_path"]).read_text(encoding="latin1")
        text = rtf_to_text(raw)
        derivative = root / "extract" / f"os{title}.txt"
        if (
            not derivative.exists()
            or sha256_bytes(derivative.read_bytes()) != sha256_bytes(text.encode("utf8"))
        ):
            derivative_hashes_match = False
        lines = text.splitlines(keepends=True)
        offsets: list[int] = []
        offset = 0
        for line_with_end in lines:
            line = line_with_end.rstrip("\r\n")
            if is_marker(line):
                if "\t" in line and line.rsplit("\t", 1)[-1].isdigit():
                    inventory_count += 1
                    inventory_keys[normalized_key(line.rsplit("\t", 1)[0], title)] += 1
                elif "\t" not in line:
                    body_count += 1
                    body_keys[normalized_key(line, title)] += 1
                    offsets.append(offset)
            offset += len(line_with_end)
        if offsets:
            # Every character from the first body marker through EOF belongs to one
            # marker-delimited section region, including markers and separators.
            body_region_chars += len(text) - offsets[0]
            covered_body_region_chars += len(text) - offsets[0]

    parsed_path = root / "parsed" / "sections.jsonl"
    parsed_rows = 0
    parsed_keys: collections.Counter[str] = collections.Counter()
    span_errors = 0
    derivatives: dict[str, str] = {}
    for path in (root / "extract").glob("os*.txt"):
        derivatives[sha256_bytes(path.read_bytes())] = path.read_text(encoding="utf8")
    with parsed_path.open(encoding="utf8") as handle:
        for line in handle:
            row = json.loads(line)
            parsed_rows += 1
            key = row["native_id"].split(":occurrence:", 1)[0]
            parsed_keys[key] += 1
            span = row["source"]["span"]
            if span is not None:
                derivative = derivatives.get(row["source"]["derivative_sha256"])
                if (
                    derivative is None
                    or derivative[span["start"] : span["end"]] != row["text"]
                    or span["end"] - span["start"] != len(row["text"])
                ):
                    span_errors += 1

    passed = (
        len(title_receipts) == 90
        and body_count == parsed_rows
        and body_keys == parsed_keys
        and inventory_count == body_count - 1
        and not (inventory_keys - body_keys)
        and derivative_hashes_match
        and span_errors == 0
        and body_region_chars == covered_body_region_chars
    )
    result = {
        "method": "independent plain-text line-marker count and derivative span re-slice",
        "passed": passed,
        "titles": len(title_receipts),
        "plain_text_inventory_markers": inventory_count,
        "plain_text_body_markers": body_count,
        "parsed_rows": parsed_rows,
        "inventory_missing_from_body": sum((inventory_keys - body_keys).values()),
        "body_markers_not_in_inventory": sum((body_keys - inventory_keys).values()),
        "body_region_code_points": body_region_chars,
        "covered_body_region_code_points": covered_body_region_chars,
        "body_region_coverage_percent": (
            round(100 * covered_body_region_chars / body_region_chars, 6)
            if body_region_chars
            else 0
        ),
        "derivative_hashes_match": derivative_hashes_match,
        "span_errors": span_errors,
    }
    (root / "parsed" / "audit-report.json").write_text(
        json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf8",
    )
    print(json.dumps(result, sort_keys=True))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
