#!/usr/bin/env python3
"""Compare staged landing section counts with publisher LAW_TOC_SECTIONS_TBL rows."""
import argparse
import json
import os
from collections import Counter


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc4/ca")
    ap.add_argument("--parsed", default="parsed-pubinfo-20261007")
    ap.add_argument("--landing", default=None)
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    parsed = os.path.join(root, a.parsed)
    landing = a.landing or os.path.join(root, "landing")
    toc_rows = sum(1 for _ in open(os.path.join(parsed, "toc-sections.jsonl"), encoding="utf-8"))
    staged = sum(1 for _ in open(os.path.join(landing, "sections.jsonl"), encoding="utf-8"))
    toc_by_code = Counter()
    for line in open(os.path.join(parsed, "toc-sections.jsonl"), encoding="utf-8"):
        toc_by_code[json.loads(line)["LAW_CODE"].strip()] += 1
    staged_by_code = Counter()
    for line in open(os.path.join(landing, "sections.jsonl"), encoding="utf-8"):
        staged_by_code[json.loads(line)["citation_path"].split(":", 1)[0]] += 1
    mismatched = {k for k in set(toc_by_code) | set(staged_by_code) if toc_by_code[k] != staged_by_code[k]}
    out = {
        "publisher_toc_section_rows": toc_rows,
        "staged_landing_sections": staged,
        "match": toc_rows == staged and not mismatched,
        "law_codes_with_count_mismatch": len(mismatched),
    }
    print(json.dumps(out, indent=2))
    if not out["match"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
