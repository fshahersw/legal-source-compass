#!/usr/bin/env python3
"""Check official HTML TOC vs PDF for citation pairs that differ only by leading zeros."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402
from citation import canon_citation  # noqa: E402
from parse import BASE, parse_toc, pdf_text, split_pdf_sections  # noqa: E402


def leading_zero_pairs(work: str) -> list[dict]:
    ms = json.load(open(os.path.join(work, "REPORT.json")))["mismatches"]
    pairs = []
    for m in ms:
        if m.get("reason") != "toc_pdf_citation_mismatch":
            continue
        if m.get("toc_count") != m.get("pdf_count"):
            continue
        to = m.get("toc_only") or []
        po = m.get("pdf_only") or []
        if not to or not po or len(to) != len(po):
            continue
        ok = all(any(canon_citation(t) == canon_citation(p) for p in po) for t in to)
        if ok:
            for t in to:
                p = next(p for p in po if canon_citation(t) == canon_citation(p))
                pairs.append({"chapter": m["chapter"], "toc_citation": t, "pdf_citation": p})
    return pairs


def main():
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/nd"
    arc = Archive(work)
    records = []
    for pair in leading_zero_pairs(work):
        slug = pair["chapter"]
        html_url = BASE + slug
        pdf_url = BASE + slug.replace(".html", ".pdf")
        hrec, prec = arc.index.get(html_url), arc.index.get(pdf_url)
        toc_heading = pdf_heading = None
        if hrec and hrec.get("state") == "complete":
            html, _ = decode_html(arc.read(hrec))
            _, _, rows = parse_toc(html)
            for r in rows:
                if canon_citation(r["citation"]) == canon_citation(pair["toc_citation"]):
                    toc_heading = r["heading"]
                    break
        if prec and prec.get("state") == "complete":
            for s in split_pdf_sections(pdf_text(arc.read(prec))):
                if canon_citation(s["citation"]) == canon_citation(pair["pdf_citation"]):
                    pdf_heading = s["heading"]
                    break
        same_section = (
            canon_citation(pair["toc_citation"]) == canon_citation(pair["pdf_citation"])
            and toc_heading is not None
            and pdf_heading is not None
            and toc_heading.strip().lower() == pdf_heading.strip().lower()
        )
        records.append({**pair, "toc_heading": toc_heading, "pdf_heading": pdf_heading, "same_section": same_section})
    out = os.path.join(work, "leading_zero_verification.json")
    json.dump(records, open(out, "w"), indent=2)
    print(json.dumps({"pairs": len(records), "same_section": sum(1 for r in records if r["same_section"]), "path": out}))


if __name__ == "__main__":
    main()
