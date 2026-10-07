#!/usr/bin/env python3
"""Write landing/toc-proof.json: chapter HTML TOC rows vs landed sections per unit."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from to_landing import unit_key  # noqa: E402


def toc_markers_for_chapter(inv, chapter_id: str) -> int:
    best = 0
    for title in inv["titles"]:
        for ch in title["chapters"]:
            if ch.get("chapter_id") == chapter_id:
                best = max(best, len(ch.get("sections_toc") or []))
    return best


def build(work: str, landing: str | None = None) -> dict:
    landing = landing or os.path.join(work, "landing")
    inv = json.load(open(os.path.join(work, "inventory.json"), encoding="utf-8"))
    sec_by = {}
    for line in open(os.path.join(landing, "sections.jsonl"), encoding="utf-8"):
        row = json.loads(line)
        sec_by[row["unit_key"]] = sec_by.get(row["unit_key"], 0) + 1
    units = [json.loads(line) for line in open(os.path.join(landing, "units.jsonl"), encoding="utf-8")]
    pages = []
    for unit in units:
        uk = unit["unit_key"]
        cid = uk
        markers = toc_markers_for_chapter(inv, cid)
        sections = sec_by.get(uk, 0)
        pages.append({"url": unit["source_url"], "chapter_id": cid, "markers": markers, "sections": sections})
        if markers != sections:
            raise SystemExit(f"TOC mismatch {cid} {unit['source_url']}: markers={markers} sections={sections}")
    proof = {
        "marker": "chapter index HTML section rows (max per chapter_id across title pages) vs landed sections",
        "pages": pages,
        "unfetched_child_pages": [],
    }
    os.makedirs(landing, exist_ok=True)
    out = os.path.join(landing, "toc-proof.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(proof, f, indent=1)
    return {"path": out, "pages": len(pages), "sections": sum(p["sections"] for p in pages)}


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/wa-full"
    print(json.dumps(build(work)))
