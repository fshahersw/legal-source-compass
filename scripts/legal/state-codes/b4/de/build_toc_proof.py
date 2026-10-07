#!/usr/bin/env python3
"""Write <work>/landing/toc-proof.json for Delaware: publisher SectionHead markers per landed page vs landed sections.

Every child page linked from a retained chapter index (or from a page with sections) that has no complete receipt is listed
in unfetched_child_pages, which the shared lander refuses to land.

    build_toc_proof.py --work /tmp/sc4/de
"""
import argparse
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

from de_site import UNIT_URL_RE, child_page_urls, section_head_count  # noqa: E402


def build(work):
    landing = os.path.join(work, "landing")
    arc = Archive(work)
    units = [json.loads(x) for x in open(os.path.join(landing, "units.jsonl"), encoding="utf-8")]
    landed = Counter(json.loads(x)["unit_key"] for x in open(os.path.join(landing, "sections.jsonl"), encoding="utf-8"))
    gaps_path = os.path.join(landing, "gaps.json")
    gaps = json.load(open(gaps_path)) if os.path.exists(gaps_path) else []
    if gaps:
        raise SystemExit(f"{len(gaps)} gaps in landing/gaps.json; a page with a gap cannot prove markers == sections")
    pages, unfetched = [], set()
    for u in units:
        rec = arc.index[u["source_url"]]
        html = decode_html(arc.read(rec))[0]
        pages.append({"url": u["source_url"], "markers": section_head_count(html), "sections": landed[u["unit_key"]]})
    for url, rec in arc.index.items():
        m = UNIT_URL_RE.match(url)
        if rec.get("state") != "complete" or not m or m.group(3):
            continue
        for child in child_page_urls(decode_html(arc.read(rec))[0], m.group(1), m.group(2)):
            c = arc.index.get(child)
            if not c or c.get("state") != "complete":
                unfetched.add(child)
    proof = {"marker": 'div class="SectionHead" on each retained delcode.delaware.gov chapter or subchapter page',
             "pages": pages, "unfetched_child_pages": sorted(unfetched)}
    with open(os.path.join(landing, "toc-proof.json"), "w", encoding="utf-8") as f:
        json.dump(proof, f, indent=1)
    bad = [p for p in pages if p["markers"] != p["sections"]]
    return {"pages": len(pages), "markers": sum(p["markers"] for p in pages), "sections": sum(p["sections"] for p in pages),
            "mismatched_pages": len(bad), "first_mismatch": bad[0] if bad else None, "unfetched_child_pages": len(unfetched)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/de")
    print(json.dumps(build(ap.parse_args().work), indent=1))


if __name__ == "__main__":
    main()
