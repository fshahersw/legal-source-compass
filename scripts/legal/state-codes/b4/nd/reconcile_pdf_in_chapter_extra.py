"""Verify PDF in-chapter extras are duplicate hits not listed on the official HTML TOC."""
import argparse
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from citation import canon_citation, filter_sections_to_official_toc  # noqa: E402
from parse import BASE, parse_toc, pdf_text, split_pdf_sections, sections_for_chapter, chapter_id_from_slug  # noqa: E402


def run(work: str):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    rows = []
    for slug in inv["chapters"]:
        html_url = BASE + slug
        pdf_url = html_url.replace(".html", ".pdf")
        hrec = arc.index.get(html_url)
        prec = arc.index.get(pdf_url)
        if not hrec or hrec.get("state") != "complete" or not prec or prec.get("state") != "complete":
            continue
        html, _ = decode_html(arc.read(hrec))
        chapter_id, _, toc_rows = parse_toc(html)
        if not chapter_id:
            chapter_id = chapter_id_from_slug(slug)
        parsed = sections_for_chapter(split_pdf_sections(pdf_text(arc.read(prec))), chapter_id)
        if len(parsed) <= len(toc_rows):
            continue
        kept, dropped = filter_sections_to_official_toc(parsed, toc_rows)
        ct = Counter(canon_citation(r["citation"]) for r in toc_rows)
        all_dup = all(
            ct.get(d["canon"], 0) > 0 and d["reason"] == "absent_from_official_html_toc" for d in dropped
        )
        rows.append(
            {
                "chapter": slug,
                "official_html": html_url,
                "official_pdf": pdf_url,
                "toc_count": len(toc_rows),
                "pdf_in_chapter_before": len(parsed),
                "pdf_in_chapter_after": len(kept),
                "dropped": dropped,
                "all_dropped_are_pdf_duplicates": all_dup and len(dropped) == len(parsed) - len(toc_rows),
            }
        )
    out = {
        "chapters_with_pdf_in_chapter_extra": len(rows),
        "all_reconciled_as_official_toc_duplicates": all(r["all_dropped_are_pdf_duplicates"] for r in rows),
        "chapters": rows,
    }
    path = os.path.join(work, "pdf_in_chapter_extra_reconciliation.json")
    json.dump(out, open(path, "w"), indent=2)
    print(json.dumps({"written": path, **{k: out[k] for k in out if k != "chapters"}}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nd")
    run(ap.parse_args().work)


if __name__ == "__main__":
    main()
