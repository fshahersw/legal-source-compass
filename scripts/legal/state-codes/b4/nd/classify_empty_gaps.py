"""Classify empty TOC/PDF gap sections (repealed/reserved TOC, PDF parser miss, no body)."""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from citation import canon_citation, filter_sections_to_official_toc  # noqa: E402
from parse import (  # noqa: E402
    chapter_id_from_slug,
    parse_toc,
    pdf_text,
    sections_for_chapter,
    split_pdf_sections,
)

REPEALED_TOC = re.compile(r"\b(?:\[)?Repealed\b", re.I)
RESERVED_TOC = re.compile(r"\b(?:\[)?Reserved\b", re.I)
PDF_SECTION = re.compile(r"^\s*(\d{1,2}-\d{2}-\d{1,4}(?:\.\d+)?)\.[ \t]+", re.M)


def pdf_prints_section(text: str, citation: str) -> bool:
    return bool(PDF_SECTION.search(text, pos=0) or re.search(rf"^\s*{re.escape(citation)}\.[ \t]+", text, re.M))


def run(work: str):
    gaps = [
        g
        for g in json.load(open(os.path.join(work, "empty_section_gaps.json")))
        if g.get("reason") == "on_official_html_toc_pdf_has_no_section_text"
    ]
    arc = Archive(work)
    rows = []
    for item in gaps:
        html, _ = decode_html(arc.read(arc.index[item["official_html"]]))
        chapter_id, _, toc = parse_toc(html)
        ch_id = chapter_id or chapter_id_from_slug(item["chapter"])
        row = next((r for r in toc if canon_citation(r["citation"]) == canon_citation(item["citation"])), {})
        heading = row.get("heading") or item.get("heading") or ""
        pdf_url = item["official_html"].replace(".html", ".pdf")
        text = pdf_text(arc.read(arc.index[pdf_url]))
        parsed = filter_sections_to_official_toc(sections_for_chapter(split_pdf_sections(text), ch_id), toc)[0]
        in_packet = canon_citation(item["citation"]) in {canon_citation(s["citation"]) for s in parsed}
        toc_repealed = bool(REPEALED_TOC.search(heading))
        toc_reserved = bool(RESERVED_TOC.search(heading))
        pdf_body = pdf_prints_section(text, item["citation"])
        if in_packet:
            klass = "staged_unexpected"
        elif toc_repealed:
            klass = "toc_repealed"
        elif toc_reserved:
            klass = "toc_reserved"
        elif pdf_body:
            klass = "pdf_body_parser_miss"
        else:
            klass = "no_official_body"
        rows.append(
            {
                **item,
                "toc_heading": heading,
                "class": klass,
                "toc_repealed": toc_repealed,
                "toc_reserved": toc_reserved,
                "pdf_prints_body": pdf_body,
            }
        )
    out_path = os.path.join(work, "empty_gap_classification.json")
    json.dump(rows, open(out_path, "w"), indent=2)
    summary = {}
    for r in rows:
        summary[r["class"]] = summary.get(r["class"], 0) + 1
    rep_res = sum(1 for r in rows if r["toc_repealed"] or r["toc_reserved"])
    print(json.dumps({"written": out_path, "total": len(rows), "by_class": summary, "toc_repealed_or_reserved": rep_res}, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nd")
    run(ap.parse_args().work)


if __name__ == "__main__":
    main()
