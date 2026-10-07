#!/usr/bin/env python3
"""TOC proof: chapter HTML section rows vs parsed packet sections (pre-land)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def build(work: str) -> dict:
    inv = json.load(open(os.path.join(work, "inventory.json"), encoding="utf-8"))
    sec_by_ch = {}
    pkt = os.path.join(work, "packet", "sections.jsonl")
    if os.path.exists(pkt):
        for line in open(pkt, encoding="utf-8"):
            row = json.loads(line)
            cid = row["chapter_native_id"]
            sec_by_ch[cid] = sec_by_ch.get(cid, 0) + 1
    pages = []
    mismatches = []
    for title in inv["titles"]:
        for ch in title["chapters"]:
            cid = ch.get("chapter_id")
            markers = len(ch.get("sections_toc") or [])
            sections = sec_by_ch.get(cid, 0)
            if markers == 0 and sections == 0:
                continue
            pages.append(
                {
                    "chapter_id": cid,
                    "title": title.get("native_title_id"),
                    "markers": markers,
                    "sections": sections,
                    "chapter_url": ch.get("chapter_url"),
                }
            )
            if markers != sections:
                mismatches.append(pages[-1])
    proof = {
        "marker": "section-id anchors in chapter index HTML vs parsed Complete Chapter PDF sections",
        "pages": pages,
        "mismatch_count": len(mismatches),
        "unfetched_child_pages": [],
    }
    out_dir = os.path.join(work, "staging-proof")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "toc-proof.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(proof, f, indent=1)
    if mismatches:
        raise SystemExit(f"TOC mismatch on {len(mismatches)} chapters (first: {mismatches[0]})")
    return {"path": out, "pages": len(pages), "sections": sum(p["sections"] for p in pages)}


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/wa"
    print(json.dumps(build(work)))
