#!/usr/bin/env python3
"""Report Texas citation_path gaps where parsed ZIP HTML has multiple section headings per anchor (~N paths)."""
from __future__ import annotations

import argparse
import collections
import json
import os
import pathlib
import sys


def load_corpus_paths(path: str) -> set[str]:
    out: set[str] = set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("{"):
                out.add(json.loads(line)["citation_path"])
            else:
                out.add(line.split("\t", 1)[-1] if "\t" in line else line)
    return out


def expected_paths(sections: list[dict]) -> list[str]:
    by_chapter: dict[str, list[dict]] = collections.defaultdict(list)
    for row in sections:
        by_chapter[row["chapter_id"]].append(row)
    paths: list[str] = []
    for ch_id, rows in by_chapter.items():
        code = ch_id.split(":")[0]
        occ: dict[str, int] = collections.Counter()
        for row in sorted(rows, key=lambda r: (r["text_start"], r["id"])):
            anchor = row["native_section_anchor"]
            base = f"{code}:{anchor}"
            occ[base] += 1
            n = occ[base]
            paths.append(base if n == 1 else f"{base}~{n}")
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parsed", required=True, help="parsed directory with sections.jsonl")
    ap.add_argument("--corpus-paths", required=True, help="file of citation_path values (one per line)")
    ap.add_argument("--out", default="-", help="write gaps JSON (default stdout)")
    a = ap.parse_args()
    corpus = load_corpus_paths(a.corpus_paths)
    sections = [json.loads(x) for x in open(os.path.join(a.parsed, "sections.jsonl"), encoding="utf-8")]
    parsed_paths = set(expected_paths(sections))
    missing = sorted(parsed_paths - corpus)
    extra = sorted(corpus - parsed_paths)
    report = {
        "parsed_occurrence_paths": len(parsed_paths),
        "corpus_paths": len(corpus),
        "missing_in_corpus": missing,
        "missing_count": len(missing),
        "corpus_only_count": len(extra),
    }
    text = json.dumps(report, indent=2)
    if a.out == "-":
        print(text)
    else:
        pathlib.Path(a.out).write_text(text + "\n", encoding="utf-8")
        print(json.dumps({"missing_count": len(missing), "out": a.out}))


if __name__ == "__main__":
    main()
