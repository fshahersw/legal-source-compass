#!/usr/bin/env python3
"""Compare staged NJ section occurrences with the publisher STATUTES table of contents.

The official bulk compilation pairs STATUTES.TXT with STATUTES.RTF styled headnotes. Section
occurrences are the publisher section headnotes the parser binds (including duplicate citation
keys as separate ordered occurrences). This does not expand LCTOC history ranges.
"""
import argparse
import collections
import importlib.util
import json
import pathlib
import zipfile


def load_parser():
    path = pathlib.Path(__file__).resolve().parents[2] / "nj-parse-bulk.py"
    spec = importlib.util.spec_from_file_location("nj_parse_bulk", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def publisher_section_occurrences(capture: pathlib.Path) -> tuple[list, collections.Counter]:
    receipt = json.loads((capture / "STATUTES-TEXT.zip.receipt.json").read_text(encoding="utf-8"))
    raw = capture / receipt["raw_file"]
    with zipfile.ZipFile(raw) as archive:
        text = archive.read("STATUTES.TXT").decode("cp1252", errors="strict").replace("\r\n", "\n")
        rtf = archive.read("STATUTES.RTF").decode("cp1252", errors="strict")
    parser = load_parser()
    headings, _ = parser.bind_headings(text, rtf)
    sections = [row for row in headings if row["kind"] == "section"]
    keys = collections.Counter(row["citation"] for row in sections)
    return sections, keys


def staged_counts(parsed: pathlib.Path) -> tuple[int, collections.Counter]:
    keys = collections.Counter()
    n = 0
    with (parsed / "sections.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            n += 1
            keys[row["citation"]] += 1
    return n, keys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--capture", type=pathlib.Path, default=pathlib.Path("/tmp/sc4/nj/capture-20261007"))
    ap.add_argument("--parsed", type=pathlib.Path, default=pathlib.Path("/tmp/sc4/nj/parsed-20261007"))
    args = ap.parse_args()
    pub_sections, pub_keys = publisher_section_occurrences(args.capture)
    staged_n, staged_keys = staged_counts(args.parsed)
    repeated = {k: v for k, v in staged_keys.items() if v > 1}
    out = {
        "publisher_statutes_rtf_section_occurrences": len(pub_sections),
        "publisher_distinct_citation_keys": len(pub_keys),
        "publisher_repeated_citation_groups": len([k for k, v in pub_keys.items() if v > 1]),
        "staged_section_occurrences": staged_n,
        "staged_distinct_citation_keys": len(staged_keys),
        "staged_repeated_citation_groups": len(repeated),
        "match": len(pub_sections) == staged_n and pub_keys == staged_keys,
    }
    print(json.dumps(out, indent=2))
    if not out["match"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
