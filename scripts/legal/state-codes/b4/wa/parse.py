#!/usr/bin/env python3
"""Parse archived WA chapter PDFs + HTML TOC into a staging packet."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, write_packet  # noqa: E402

from wa_pdf import pdf_to_text, split_sections  # noqa: E402

ARCHIVE_YEAR = "2026"


def run(work: str):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json"), encoding="utf-8"))
    edition = {"statement": inv.get("edition"), "publisher_pages": inv.get("archive_index_url")}
    chapters_out = []
    sections_out = []
    sep = "\n\n"
    mismatches = []
    for title in inv["titles"]:
        tnum = title["native_title_id"]
        thead = title.get("title_heading")
        for ch in title["chapters"]:
            if ch.get("fetch_failed") or ch.get("parse_failed") or ch.get("pdf_fetch_failed"):
                continue
            toc = ch.get("sections_toc") or []
            pdf_sha = ch.get("chapter_pdf_receipt_sha256")
            pdf_url = ch.get("chapter_pdf_url") or ch.get("complete_chapter_pdf_url")
            if not pdf_sha or not pdf_url:
                continue
            rec = next((r for r in arc.index.values() if r.get("sha256") == pdf_sha), None)
            if not rec:
                rec = arc.index.get(pdf_url)
            if not rec or rec.get("state") != "complete":
                continue
            raw = arc.read(rec)
            text = pdf_to_text(raw)
            toc_ids = [s["section_id"] for s in toc]
            parsed_all = split_sections(text, toc_ids)
            by_id = {s["section_id"]: s for s in parsed_all}
            parsed_secs = []
            missing = []
            for sid in toc_ids:
                row = by_id.get(sid.upper())
                if row:
                    parsed_secs.append(row)
                else:
                    missing.append(sid)
            if missing or len(parsed_secs) != len(toc):
                mismatches.append(
                    {
                        "chapter_id": ch.get("chapter_id"),
                        "toc": len(toc),
                        "parsed": len(parsed_secs),
                        "missing": missing,
                        "extra_pdf_headings": len(parsed_all) - len(by_id),
                        "url": pdf_url,
                    }
                )
            native_id = ch.get("chapter_id") or ""
            chead = ch.get("chapter_heading") or ch.get("description")
            parts = []
            ch_sections = []
            for i, row in enumerate(parsed_secs):
                if parts:
                    parts.append(sep)
                start = len("".join(parts))
                parts.append(row["text"])
                end = len("".join(parts))
                sec_id = row["section_id"]
                ch_sections.append(
                    {
                        "chapter_native_id": native_id,
                        "state": "WA",
                        "citation_path": sec_id,
                        "citation": f"RCW {sec_id}",
                        "number": sec_id,
                        "heading": row.get("heading"),
                        "hierarchy": [
                            {"level": "title", "number": tnum, "heading": thead},
                            {"level": "chapter", "number": native_id, "heading": chead},
                            {"level": "section", "number": sec_id, "heading": row.get("heading")},
                        ],
                        "history": row.get("history"),
                        "status_label": None,
                        "edition": edition["statement"],
                        "currency": {"statement": None, "as_of": ARCHIVE_YEAR},
                        "effective": None,
                        "start": start,
                        "end": end,
                        "source_url": pdf_url,
                        "source_receipt_sha256": rec["sha256"],
                    }
                )
            if not parts:
                continue
            ch_text = "".join(parts)
            chapters_out.append(
                {
                    "native_id": native_id,
                    "state": "WA",
                    "path": [
                        {"level": "title", "number": tnum, "heading": thead},
                        {"level": "chapter", "number": native_id, "heading": chead},
                    ],
                    "heading": chead,
                    "text": ch_text,
                    "raw_sha256s": [rec["sha256"]],
                    "source_urls": [pdf_url],
                }
            )
            sections_out.extend(ch_sections)
    man = write_packet(
        work,
        "WA",
        source={
            "publisher": "Washington State Legislature (Code Reviser)",
            "base_url": "https://lawfilesext.leg.wa.gov/law/RCWArchive/2026/",
            "system": "wa-rcw-archive-2026-pdf",
        },
        edition=edition,
        chapters=chapters_out,
        sections=sections_out,
        extra={"code_title": "Revised Code of Washington", "toc_mismatches": mismatches},
    )
    rep = {
        "chapters": len(chapters_out),
        "sections": len(sections_out),
        "toc_mismatch_chapters": len(mismatches),
        "mismatches_sample": mismatches[:20],
    }
    with open(os.path.join(work, "REPORT.json"), "w") as f:
        json.dump(rep, f, indent=1)
    return man, rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/wa")
    a = ap.parse_args()
    man, rep = run(a.work)
    print(json.dumps({**man, **rep}, indent=1))


if __name__ == "__main__":
    main()
