#!/usr/bin/env python3
"""Compare landing section count to publisher section-heading markers in parsed HTML."""
import argparse
import importlib.util
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))


def load_parser():
    spec = importlib.util.spec_from_file_location("tx_parse", os.path.join(HERE, "..", "..", "tx-parse.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(root: str, parsed_name: str, landing: str | None = None):
    root = os.path.abspath(root)
    parsed = os.path.join(root, parsed_name)
    landing = landing or os.path.join(root, "landing")
    parser = load_parser()
    toc_markers = 0
    for line in open(os.path.join(parsed, "chapters.jsonl"), encoding="utf-8"):
        ch = json.loads(line)
        receipt = json.loads(open(os.path.join(root, "receipts", ch["code"] + ".json"), encoding="utf-8").read())
        with zipfile.ZipFile(os.path.join(root, receipt["raw_file"])) as zf:
            raw = zf.read(ch["publisher_member"])
        _, blocks, rows = parser.parse_chapter(raw, ch["code"], ch["publisher_member"])
        markers = sum(1 for b in blocks if b["kind"] == "section_heading")
        if markers != len(rows) or markers != ch["section_occurrences"]:
            raise SystemExit(f"internal marker drift {ch['id']}: markers={markers} rows={len(rows)}")
        toc_markers += markers
    staged = sum(1 for _ in open(os.path.join(landing, "sections.jsonl"), encoding="utf-8"))
    summary = json.loads(open(os.path.join(parsed, "summary.json"), encoding="utf-8").read())
    out = {
        "official_publisher_section_headings": toc_markers,
        "parsed_section_occurrences": summary["section_occurrences"],
        "staged_landing_sections": staged,
        "match": toc_markers == staged == summary["section_occurrences"],
    }
    path = os.path.join(root, "toc_count_compare.json")
    json.dump(out, open(path, "w"), indent=2)
    print(json.dumps(out, indent=2))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc4/tx")
    ap.add_argument("--parsed", default="parsed-v5-20261007")
    ap.add_argument("--landing", default=None)
    a = ap.parse_args()
    run(a.root, a.parsed, a.landing)


if __name__ == "__main__":
    main()
