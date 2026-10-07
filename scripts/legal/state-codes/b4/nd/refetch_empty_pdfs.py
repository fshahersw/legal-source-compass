#!/usr/bin/env python3
"""Re-fetch chapter PDFs that pdftotext parsed as zero sections (force=True)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402
from parse import BASE, pdf_text, split_pdf_sections  # noqa: E402


def empty_pdf_chapters(work: str) -> list[str]:
    if os.path.isfile(os.path.join(work, "REPORT.json")):
        ms = json.load(open(os.path.join(work, "REPORT.json")))["mismatches"]
        return sorted(
            {
                m["chapter"]
                for m in ms
                if m.get("reason") == "toc_pdf_citation_mismatch" and m.get("pdf_count") == 0
            }
        )
    return []


def main():
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/nd"
    arc = Archive(work, min_interval=1.0)
    slugs = empty_pdf_chapters(work)
    if not slugs:
        print(json.dumps({"refetched": 0, "note": "no empty-pdf chapters in REPORT"}))
        return
    results = []
    for slug in slugs:
        pdf_url = BASE + slug.replace(".html", ".pdf")
        rec = arc.fetch(pdf_url, accept="application/pdf,*/*", force=True)
        parsed_n = 0
        if rec.get("state") == "complete":
            parsed_n = len(split_pdf_sections(pdf_text(arc.read(rec))))
        results.append(
            {
                "chapter": slug,
                "url": pdf_url,
                "http_status": rec.get("http_status"),
                "bytes": rec.get("bytes"),
                "sections_parsed": parsed_n,
            }
        )
    out = os.path.join(work, "refetch_empty_pdfs.json")
    json.dump({"refetched": len(results), "chapters": results}, open(out, "w"), indent=2)
    print(json.dumps({"refetched": len(results), "path": out, "with_text": sum(1 for r in results if r["sections_parsed"] > 0)}))


if __name__ == "__main__":
    main()
