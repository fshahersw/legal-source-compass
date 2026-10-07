"""Parse archived Wyoming title PDFs and stage packet under /tmp/sc4/wy/packet.

Usage: python3 parse.py [--work /tmp/sc4/wy]
"""
import argparse
import json
import os
import sys

_WY = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_WY, ".."))
sys.path.insert(0, _WY)
from sc_common import Archive, write_packet  # noqa: E402

from titles import CURRENCY_STATEMENT, DOWNLOAD_PAGE, TITLE_PDFS, pdf_url  # noqa: E402
from wy_parse import parse_title_text, pdf_to_text, toc_citation_paths  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/wy")
    a = ap.parse_args()
    arc = Archive(a.work)
    all_chapters = []
    all_sections = []
    mismatches = []
    genuine_duplicates = []
    empty_gaps = []
    inventory = {"titles": {}, "total_sections_toc": 0, "total_sections_parsed": 0}

    for key, label in TITLE_PDFS:
        url = pdf_url(key)
        rec = arc.index.get(url)
        if not rec or rec.get("state") != "complete":
            mismatches.append({"title": key, "reason": "missing_raw", "url": url})
            continue
        pdf_path = os.path.join(a.work, rec["file"])
        text = pdf_to_text(pdf_path)
        toc_ids = toc_citation_paths(text, key)
        chs, secs, parsed_paths = parse_title_text(
            text,
            title_key=key,
            title_label=label,
            source_url=url,
            receipt_sha=rec["sha256"],
        )
        inventory["titles"][key] = {
            "label": label,
            "toc_sections": len(toc_ids),
            "parsed_sections": len(parsed_paths),
            "chapters": len(chs),
        }
        inventory["total_sections_toc"] += len(toc_ids)
        inventory["total_sections_parsed"] += len(parsed_paths)
        for p in toc_ids:
            if ":" in p:
                genuine_duplicates.append({"title": key, "citation_path": p})
        if toc_ids != parsed_paths:
            diff = []
            for i, (t, p) in enumerate(zip(toc_ids, parsed_paths)):
                if t != p:
                    diff.append({"index": i, "toc": t, "parsed": p})
                    if len(diff) >= 5:
                        break
            extra_toc = toc_ids[len(parsed_paths) :][:5]
            extra_parsed = parsed_paths[len(toc_ids) :][:5]
            mismatches.append(
                {
                    "title": key,
                    "reason": "toc_ordered_mismatch",
                    "toc_count": len(toc_ids),
                    "parsed_count": len(parsed_paths),
                    "first_diffs": diff,
                    "toc_tail": extra_toc,
                    "parsed_tail": extra_parsed,
                }
            )
        all_chapters.extend(chs)
        all_sections.extend(secs)

    edition = None
    source = {
        "publisher": "Wyoming Legislative Service Office",
        "publisher_url": "https://wyoleg.gov/",
        "download_page": DOWNLOAD_PAGE,
        "format": "application/pdf per title",
        "currency_statement": CURRENCY_STATEMENT,
    }
    man = write_packet(
        a.work,
        "WY",
        source=source,
        edition=edition,
        chapters=all_chapters,
        sections=all_sections,
        extra={"currency_statement": CURRENCY_STATEMENT},
    )
    inventory["total_chapters"] = len(all_chapters)
    inventory["manifest"] = man
    json.dump(inventory, open(os.path.join(a.work, "inventory.json"), "w"), indent=2)
    json.dump(mismatches, open(os.path.join(a.work, "parse_mismatches.json"), "w"), indent=2)
    json.dump(genuine_duplicates, open(os.path.join(a.work, "genuine_duplicates.json"), "w"), indent=2)
    json.dump(empty_gaps, open(os.path.join(a.work, "empty_section_gaps.json"), "w"), indent=2)
    print(
        json.dumps(
            {
                "chapters": len(all_chapters),
                "sections": len(all_sections),
                "mismatches": len(mismatches),
                "genuine_duplicates": len(genuine_duplicates),
            }
        )
    )


if __name__ == "__main__":
    main()
