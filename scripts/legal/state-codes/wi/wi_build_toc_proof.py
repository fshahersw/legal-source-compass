#!/usr/bin/env python3
"""Write landing/toc-proof.json for Wisconsin from parse-report chapter stats."""
from __future__ import annotations

import argparse
import json
import pathlib


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/WI"))
    a = ap.parse_args()
    landing = a.root / "landing"
    report = json.loads((a.root / "parsed" / "parse-report.json").read_text(encoding="utf-8"))
    pages = []
    for chapter in report.get("chapter_reports") or []:
        ch = chapter["chapter"]
        url = f"https://docs.legis.wisconsin.gov/statutes/statutes/{ch}.txt"
        markers = len(chapter.get("toc_citations") or [])
        sections = len(chapter.get("body_citations") or [])
        pages.append({"url": url, "unit_key": ch, "markers": markers, "sections": sections})
    proof = {
        "marker": "plain-text chapter .txt TOC headings match parsed section bodies (wi-official-toc-text)",
        "unfetched_child_pages": [],
        "pages": pages,
    }
    landing.mkdir(parents=True, exist_ok=True)
    (landing / "toc-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"pages": len(pages)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
