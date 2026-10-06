#!/usr/bin/env python3
"""Write landing/toc-proof.json for VT from fullchapter § markers vs landed sections."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

SEC_HEAD = re.compile(r"<b>\s*§\s*([^<]+?)\.\s*(.*?)\s*</b>", re.S | re.I)


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
        html = decode_html(arc.read(rec))[0]
        markers = len(SEC_HEAD.findall(html))
        sections = sec_by.get(unit["unit_key"], 0)
        pages.append({"url": url, "markers": markers, "sections": sections})
        if markers != sections:
            raise SystemExit(f"TOC mismatch {url}: markers={markers} sections={sections}")
    proof = {
        "marker": "<b>§ …</b> entries in statutes-detail list on fullchapter HTML",
        "pages": pages,
        "unfetched_child_pages": [],
    }
    out = os.path.join(landing, "toc-proof.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(proof, handle, indent=1)
    return {"path": out, "pages": len(pages)}


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/vt"
    print(json.dumps(build(work)))
