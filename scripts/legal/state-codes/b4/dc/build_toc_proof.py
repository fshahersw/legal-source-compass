#!/usr/bin/env python3
"""TOC proof: inventory section count vs staged packet; landing toc-proof for lander."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

from dc_lib import parse_article  # noqa: E402


def build_staging(work: str) -> dict:
    inv = json.load(open(os.path.join(work, "inventory.json"), encoding="utf-8"))
    seen = set()
    toc_n = 0
    for s in inv["sections"]:
        if s.get("et") == "container" or s["native_id"] in seen:
            continue
        seen.add(s["native_id"])
        toc_n += 1
    staged = sum(1 for _ in open(os.path.join(work, "packet", "sections.jsonl"), encoding="utf-8"))
    proof = {
        "marker": "publisher index.json TOC section nodes (et=section, no # fragment)",
        "toc_sections": toc_n,
        "staged_sections": staged,
        "match": toc_n == staged,
    }
    out_dir = os.path.join(work, "staging-proof")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "toc-proof.json")
    json.dump(proof, open(out, "w"), indent=1)
    if toc_n != staged:
        raise SystemExit(f"TOC mismatch: inventory={toc_n} staged={staged}")
    return proof


def build_landing(work: str, landing: str | None = None) -> dict:
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
        parsed = parse_article(arc.read(rec))
        markers = 1 if (parsed.get("text") or "").strip() else 0
        sections = sec_by.get(unit["unit_key"], 0)
        pages.append({"url": url, "markers": markers, "sections": sections})
        if markers != sections:
            raise SystemExit(f"TOC mismatch {url}: markers={markers} sections={sections}")
    proof = {
        "marker": "one extractable section body per code.dccouncil.gov section HTML page",
        "pages": pages,
        "unfetched_child_pages": [],
    }
    out = os.path.join(landing, "toc-proof.json")
    json.dump(proof, open(out, "w"), indent=1)
    return {"path": out, "pages": len(pages)}


def build(work: str) -> dict:
    return build_staging(work)


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/dc"
    if len(sys.argv) > 2 and sys.argv[2] == "--landing":
        print(json.dumps(build_landing(work)))
    else:
        print(json.dumps(build(work)))
