"""Prove official 'No Sections' chapter stubs: TOC vs print page anchors/text."""
import argparse
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

from parse import decode_ak, section_anchors_in_page, ak_fragment_text  # noqa: E402

BASE = "https://www.akleg.gov/basis/statutes.asp"


def toc_says(ch: str, arc: Archive) -> str:
    html, _ = decode_ak(arc.read(arc.fetch(f"{BASE}?media=js&type=TOC&title={ch}")))
    if "No Sections" in html:
        return "No Sections"
    return "has_section_links"


def prove(work: str, sample: int | None):
    arc = Archive(work, min_interval=1.0)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    stubs = [c["chapter"] for c in inv["chapters"] if not c["sections"]]
    pick = stubs if sample is None or sample >= len(stubs) else random.sample(stubs, sample)
    rows = []
    for ch in sorted(pick):
        url = f"{BASE}?media=print&secStart={ch}&secEnd={ch}"
        rel = f"chapter/{ch.replace('.', '_')}.html"
        rec = arc.fetch(url, rel=rel, force=True)
        page, _ = decode_ak(arc.read(rec)) if rec["state"] == "complete" else ("", "")
        anchors = section_anchors_in_page(page)
        text = ak_fragment_text(page)[:500] if page else ""
        rows.append(
            {
                "chapter": ch,
                "toc": toc_says(ch, arc),
                "print_url": url,
                "receipt_sha256": rec.get("sha256"),
                "section_anchors_on_page": anchors,
                "section_anchor_count": len(anchors),
                "text_excerpt": text,
            }
        )
    out = {"stub_chapters_in_inventory": len(stubs), "sampled": len(rows), "rows": rows}
    path = os.path.join(work, "stub_proof.json")
    json.dump(out, open(path, "w"), indent=1)
    print(json.dumps({"stub_chapters": len(stubs), "sampled": len(rows), "path": path}, indent=1))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/ak")
    ap.add_argument("--sample", type=int, default=25)
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    prove(a.work, None if a.all else a.sample)


if __name__ == "__main__":
    main()
