"""Verify PDF stray sections (other chapters) are absent from the chapter HTML TOC."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from citation import canon_citation  # noqa: E402
from parse import BASE, parse_toc, pdf_text, split_pdf_sections, citation_chapter_id, chapter_id_from_slug  # noqa: E402


def run(work: str):
    arc = Archive(work)
    rows = json.load(open(os.path.join(work, "flag_classification.json")))
    targets = [r for r in rows if r.get("class") == "pdf_cross_chapter_stray_reconciled"]
    out = {"reconciled_chapters": len(targets), "samples": []}
    for row in targets[:25]:
        slug = row["chapter"]
        html_url = BASE + slug
        pdf_url = html_url.replace(".html", ".pdf")
        hrec = arc.index.get(html_url)
        prec = arc.index.get(pdf_url)
        if not hrec or not prec:
            continue
        html, _ = decode_html(arc.read(hrec))
        _, _, toc = parse_toc(html)
        toc_canon = {canon_citation(r["citation"]) for r in toc}
        parsed = split_pdf_sections(pdf_text(arc.read(prec)))
        ch_id = chapter_id_from_slug(slug)
        stray = [
            s["citation"]
            for s in parsed
            if canon_citation(s["citation"]) not in toc_canon and citation_chapter_id(s["citation"]) != ch_id
        ]
        out["samples"].append(
            {
                "chapter": slug,
                "official_html": html_url,
                "official_pdf": pdf_url,
                "stray_in_pdf_not_in_toc": stray[:10],
                "stray_absent_from_html_toc": all(canon_citation(c) not in toc_canon for c in stray),
            }
        )
    path = os.path.join(work, "pdf_stray_reconciliation.json")
    json.dump(out, open(path, "w"), indent=2)
    print(json.dumps({"written": path, "reconciled_chapters": out["reconciled_chapters"], "samples": len(out["samples"])}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nd")
    run(ap.parse_args().work)


if __name__ == "__main__":
    main()
