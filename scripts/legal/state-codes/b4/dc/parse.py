#!/usr/bin/env python3
"""Parse archived D.C. Code section HTML into a staging packet."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, write_packet  # noqa: E402

from dc_lib import HOST, chapter_key_from_parent, parse_article, section_citation_path  # noqa: E402


def run(work: str):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json"), encoding="utf-8"))
    edition = {
        "statement": "Code of the District of Columbia (D.C. Law Library)",
        "publisher_pages": inv.get("source_root"),
    }
    chapters_out = []
    sections_out = []
    seen_native: set[str] = set()
    for sec in inv["sections"]:
        if sec["native_id"] in seen_native:
            continue
        seen_native.add(sec["native_id"])
        if not sec.get("receipt_sha256"):
            continue
        rec = next((r for r in arc.index.values() if r.get("sha256") == sec["receipt_sha256"]), None)
        if not rec:
            rec = arc.index.get(sec["source_url"])
        if not rec or rec.get("state") != "complete":
            continue
        parsed = parse_article(arc.read(rec))
        if parsed["native_id"] != sec["native_id"]:
            raise SystemExit(f"identity mismatch {sec['native_id']} vs {parsed['native_id']}")
        cite_path = section_citation_path(parsed["native_id"])
        ck = chapter_key_from_parent(sec.get("parent_outline"))
        title_parts = (parsed.get("title") or "").split(".", 1)
        heading = title_parts[1].strip() if len(title_parts) > 1 else parsed.get("title")
        body = parsed["text"]
        unit_id = f"section-{cite_path}"
        chapters_out.append(
            {
                "native_id": unit_id,
                "state": "DC",
                "path": [
                    {"level": "chapter", "number": ck, "heading": sec.get("parent_outline")},
                    {"level": "section", "number": cite_path, "heading": heading},
                ],
                "heading": parsed.get("title") or f"§ {cite_path}",
                "text": body,
                "raw_sha256s": [rec["sha256"]],
                "source_urls": [sec["source_url"]],
                "sections_expected": 1,
            }
        )
        sections_out.append(
            {
                "chapter_native_id": unit_id,
                "state": "DC",
                "citation_path": cite_path,
                "citation": parsed.get("title") or f"§ {cite_path}",
                "number": cite_path,
                "heading": heading,
                "hierarchy": [
                    {"level": "chapter", "number": ck, "heading": sec.get("toc_title")},
                    {"level": "section", "number": cite_path, "heading": heading},
                ],
                "history": None,
                "status_label": None,
                "edition": edition["statement"],
                "currency": {"statement": None, "as_of": None},
                "effective": None,
                "start": 0,
                "end": len(body),
                "source_url": sec["source_url"],
                "source_receipt_sha256": rec["sha256"],
            }
        )
    man = write_packet(
        work,
        "DC",
        source={
            "publisher": "Council of the District of Columbia",
            "base_url": HOST + "/us/dc/council/code",
            "system": "dc-council-html",
        },
        edition=edition,
        chapters=chapters_out,
        sections=sections_out,
        extra={"code_title": "Code of the District of Columbia"},
    )
    rep = {"toc_sections": len(inv["sections"]), "staged_sections": len(sections_out), "chapters": len(chapters_out)}
    json.dump(rep, open(os.path.join(work, "REPORT.json"), "w"), indent=1)
    return man, rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/dc")
    a = ap.parse_args()
    man, rep = run(a.work)
    print(json.dumps({**man, **rep}, indent=1))


if __name__ == "__main__":
    main()
