#!/usr/bin/env python3
"""Write landing/toc-proof.json for NH from archived *-mrg.htm section markers vs landed units."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

SECTION_SPLIT = re.compile(
    r"<center>\s*<h3>\s*Section\s+([\d]+(?:-[A-Z])?:[\d]+(?:-[a-z])?)\s*</h3>\s*</center>", re.I
)


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
        markers = len(SECTION_SPLIT.findall(html))
        sections = sec_by.get(unit["unit_key"], 0)
        pages.append({"url": url, "markers": markers, "sections": sections})
        if markers != sections:
            raise SystemExit(f"TOC mismatch {url}: markers={markers} sections={sections}")
    proof = {
        "marker": "<center><h3>Section …</h3></center> on merged chapter HTML (*-mrg.htm)",
        "pages": pages,
        "unfetched_child_pages": [],
    }
    os.makedirs(landing, exist_ok=True)
    out = os.path.join(landing, "toc-proof.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(proof, handle, indent=1)
    return {"path": out, "pages": len(pages)}


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/nh"
    print(json.dumps(build(work)))
