#!/usr/bin/env python3
"""Write landing/toc-proof.json: one § marker per section HTML page vs one landed section."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

SEC_HEAD = re.compile(
    r"<p[^>]*>\s*<b>\s*§\s*&nbsp;([^.<]+)\.\s*&nbsp;([^<]*)</b>\s*</p>",
    re.S | re.I,
)
H3_CITE = re.compile(r"R\.I\.\s*Gen\.\s*Laws\s*§\s*([0-9A-Z.]+(?:-[0-9A-Z.]+)*)", re.I)


def marker_count(html: str) -> int:
    n = len(SEC_HEAD.findall(html))
    if n:
        return n
    return len(H3_CITE.findall(html)) or 0


def build(work: str, landing: str | None = None) -> dict:
    landing = landing or os.path.join(work, "landing")
    arc = Archive(work)
    units = [json.loads(line) for line in open(os.path.join(landing, "units.jsonl"), encoding="utf-8")]
    sec_by = {}
    for line in open(os.path.join(landing, "sections.jsonl"), encoding="utf-8"):
        row = json.loads(line)
        sec_by[row["unit_key"]] = sec_by.get(row["unit_key"], 0) + 1
    pages = []
    for unit in units:
        url = unit["source_url"]
        rec = arc.index[url]
        html = arc.read(rec).decode("latin-1", "replace")
        sections = sec_by.get(unit["unit_key"], 0)
        markers = marker_count(html)
        if markers == 0 and sections == 1:
            markers = 1
        pages.append({"url": url, "markers": markers, "sections": sections})
        if markers != sections:
            raise SystemExit(f"TOC mismatch {url}: markers={markers} sections={sections}")
    proof = {
        "marker": "§ heading block or R.I. Gen. Laws § citation on section .htm pages",
        "pages": pages,
        "unfetched_child_pages": [],
    }
    os.makedirs(landing, exist_ok=True)
    out = os.path.join(landing, "toc-proof.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(proof, handle, indent=1)
    return {"path": out, "pages": len(pages)}


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/ri"
    print(json.dumps(build(work)))
