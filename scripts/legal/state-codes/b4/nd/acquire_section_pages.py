"""Fetch official ND section HTML pages for TOC/PDF gap citations (resumable)."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from section_page import official_section_html_url  # noqa: E402


def run(work: str):
    gaps = [
        g
        for g in json.load(open(os.path.join(work, "empty_section_gaps.json")))
        if g.get("reason") == "on_official_html_toc_pdf_has_no_section_text"
    ]
    arc = Archive(work)
    fetched = 0
    for g in gaps:
        url = official_section_html_url(g["chapter"], g["citation"])
        rec = arc.fetch(url, accept="text/html,*/*")
        if rec.get("state") == "complete":
            fetched += 1
    out = {"gap_sections": len(gaps), "fetched_complete": fetched}
    json.dump(out, open(os.path.join(work, "section_page_acquire.json"), "w"), indent=2)
    print(json.dumps(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nd")
    run(ap.parse_args().work)


if __name__ == "__main__":
    main()
