#!/usr/bin/env python3
"""Write landing/toc-proof.json: official HTML chapter TOC rows vs landed sections per unit."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

from parse import parse_toc  # noqa: E402


def build(work: str, landing: str | None = None) -> dict:
    landing = landing or os.path.join(work, "landing")
    arc = Archive(work)
    units = [json.loads(line) for line in open(os.path.join(landing, "units.jsonl"), encoding="utf-8")]
    sec_by: dict[str, int] = {}
    for line in open(os.path.join(landing, "sections.jsonl"), encoding="utf-8"):
        row = json.loads(line)
        sec_by[row["unit_key"]] = sec_by.get(row["unit_key"], 0) + 1
    pages = []
    for unit in units:
        pdf_url = unit["source_url"]
        slug = pdf_url.rsplit("/", 1)[-1].replace(".pdf", ".html")
        html_url = pdf_url.replace(".pdf", ".html")
        rec = arc.index.get(html_url)
        if not rec or rec.get("state") != "complete":
            raise SystemExit(f"missing archived HTML TOC for {html_url}")
        html, _ = decode_html(arc.read(rec))
        _, _, rows = parse_toc(html)
        markers = len(rows)
        sections = sec_by.get(unit["unit_key"], 0)
        pages.append({"url": html_url, "unit_key": unit["unit_key"], "markers": markers, "sections": sections})
        if markers != sections:
            raise SystemExit(f"TOC mismatch {html_url}: markers={markers} sections={sections}")
    proof = {
        "marker": "official HTML chapter TOC section link rows (ndlegis.gov/cencode/tNNcNN.html)",
        "pages": sorted(pages, key=lambda p: p["unit_key"]),
        "unfetched_child_pages": [],
    }
    out = os.path.join(landing, "toc-proof.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(proof, handle, indent=1)
    return {"path": out, "pages": len(pages)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nd")
    ap.add_argument("--landing", default=None)
    a = ap.parse_args()
    print(json.dumps(build(a.work, a.landing)))


if __name__ == "__main__":
    main()
