"""Parse archived ND Century Code chapter HTML TOCs + PDF bodies into a staging packet."""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, html_text, sha256_hex, write_packet  # noqa: E402

from citation import canon_citation, citations_equal_lists, filter_sections_to_official_toc  # noqa: E402

STATE = "ND"
BASE = "https://ndlegis.gov/cencode/"
INFO = "https://ndlegis.gov/general-information/north-dakota-century-code/index.html"

TOC_ROW = re.compile(
    r"<tr>\s*<td[^>]*>\s*<a\s+href=\"[^\"]*#nameddest=[^\"]*\">([^<]+)</a>\s*</td>\s*"
    r"<td[^>]*>(.*?)</td>",
    re.S | re.I,
)
CHAPTER_HEAD = re.compile(r"<h1>\s*Chapter\s+(\d+-\d+)\s*</h1>", re.I)
CHAPTER_H3 = re.compile(r"<h3>\s*(.*?)\s*</h3>", re.S | re.I)
SECTION_HEAD = re.compile(r"^\s*(\d{1,2}-\d{2}-\d{2}(?:\.\d+)?)\.\s+(.+)$", re.M)
REPEALED = re.compile(r"^\s*Repealed\b", re.I | re.M)
CHAPTER_REPEALED = re.compile(r"\[Repealed\b", re.I)
SL_HISTORY = re.compile(r"\bS\.L\.\s+\d{4}", re.I)

OFFICIAL_STATEMENT = (
    "North Dakota Century Code published on this website is the official version of the "
    "North Dakota Century Code and may vary from any printed or online versions of the "
    "North Dakota Century Code available from private publishers."
)
UPDATE_STATEMENT = (
    "07/01/25 UPDATE: All statutory changes approved by the 69th Legislative Assembly are now "
    "reflected on this website regardless of the statute becoming effective earlier than July 1, "
    "due to an emergency clause, or on August 1, due to operation of law."
)


def pdf_text(body: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(body)
        path = f.name
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", path, "-"],
            capture_output=True,
            check=True,
            timeout=120,
        )
        return out.stdout.decode("utf-8", "replace")
    finally:
        os.unlink(path)


def parse_toc(html: str):
    m = CHAPTER_HEAD.search(html)
    chapter_id = m.group(1) if m else None
    h3 = CHAPTER_H3.search(html)
    chapter_heading = collapse(html_text(h3.group(1))) if h3 else None
    rows = []
    for cit, name in TOC_ROW.findall(html):
        cit = collapse(cit)
        name = collapse(html_text(name))
        rows.append({"citation": cit, "heading": name})
    return chapter_id, chapter_heading, rows


def split_pdf_sections(text: str):
    """Return list of {citation, heading, body} in document order."""
    matches = list(SECTION_HEAD.finditer(text))
    if not matches:
        return []
    out = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        block = text[start:end].strip()
        heading_line = collapse(m.group(2))
        body = block
        out.append({"citation": m.group(1), "heading": heading_line, "body": body})
    return out


def hierarchy_for(chapter_id: str, chapter_heading: str | None, citation: str, section_heading: str):
    title_n, ch_n, _ = citation.split("-", 2)
    return [
        {"level": "title", "number": title_n, "heading": None},
        {"level": "chapter", "number": chapter_id or f"{title_n}-{ch_n}", "heading": chapter_heading},
        {"level": "section", "number": citation, "heading": section_heading},
    ]


def status_and_history(body: str):
    status = None
    history = None
    if REPEALED.search(body):
        status = "Repealed"
        history = collapse(body.split("\n", 1)[-1]) if "\n" in body else collapse(body)
    elif SL_HISTORY.search(body):
        for line in body.splitlines():
            if SL_HISTORY.search(line):
                history = collapse(line)
                break
    return status, history


def chapter_native_id(slug: str) -> str:
    return slug.replace(".html", "").lower()


def chapter_id_from_slug(slug: str) -> str | None:
    m = re.match(r"t(\d+)c(\d+)", slug, re.I)
    if not m:
        return None
    return f"{int(m.group(1))}-{int(m.group(2)):02d}" if len(m.group(2)) <= 2 else f"{int(m.group(1))}-{int(m.group(2))}"


def citation_chapter_id(citation: str) -> str | None:
    parts = citation.strip().split("-")
    if len(parts) < 3:
        return None
    return f"{int(parts[0])}-{int(parts[1]):02d}"


def sections_for_chapter(parsed: list[dict], chapter_id: str | None) -> list[dict]:
    if not chapter_id:
        return parsed
    return [s for s in parsed if citation_chapter_id(s["citation"]) == chapter_id]


def repealed_chapter_notice(text: str, parsed_all: list[dict]) -> str | None:
    """Chapter-level repealed stub PDF (no section headings). Not a section marked repealed inside a full chapter."""
    if parsed_all:
        return None
    if not CHAPTER_REPEALED.search(text):
        return None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) > 8:
        return None
    return collapse(text)


def run(work: str):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    pdf_only = set(inv.get("pdf_only_html") or [])
    chapters_out = []
    sections_out = []
    toc_counts = {}
    pdf_counts = {}
    mismatches = []
    empty_section_gaps = []
    flag_classification = []

    for slug in inv["chapters"]:
        html_url = BASE + slug
        pdf_url = BASE + slug.replace(".html", ".pdf")
        hrec = arc.index.get(html_url)
        prec = arc.index.get(pdf_url)
        html_only_toc = hrec and hrec.get("state") == "complete"
        if not prec or prec.get("state") != "complete":
            mismatches.append({"chapter": slug, "reason": "missing_pdf"})
            continue
        pdf_body = arc.read(prec)
        text = pdf_text(pdf_body)
        parsed_all = split_pdf_sections(text)
        if html_only_toc:
            html, _ = decode_html(arc.read(hrec))
            chapter_id, chapter_heading, toc_rows = parse_toc(html)
        else:
            if slug not in pdf_only and not html_only_toc:
                pdf_only.add(slug)
            chapter_id = chapter_id_from_slug(slug)
            if parsed_all:
                chapter_id = citation_chapter_id(parsed_all[0]["citation"]) or chapter_id
            chapter_heading = None
            toc_rows = [{"citation": s["citation"], "heading": s["heading"]} for s in parsed_all]
        if not chapter_id:
            chapter_id = chapter_id_from_slug(slug)
        parsed = sections_for_chapter(parsed_all, chapter_id)
        pdf_dropped_official: list[dict] = []
        if html_only_toc and toc_rows:
            parsed, pdf_dropped_official = filter_sections_to_official_toc(parsed, toc_rows)
            if pdf_dropped_official:
                flag_classification.append(
                    {
                        "chapter": slug,
                        "class": "pdf_in_chapter_extra_reconciled",
                        "dropped": pdf_dropped_official,
                        "official_html": html_url,
                    }
                )
        pdf_counts[slug] = len(parsed)
        toc_counts[slug] = len(toc_rows)
        toc_cits = [r["citation"] for r in toc_rows]
        pdf_cits = [s["citation"] for s in parsed]
        chapter_status_note = None
        repealed_notice = repealed_chapter_notice(text, parsed_all) if not parsed else None
        if repealed_notice:
            chapter_status_note = repealed_notice
            toc_canon = {canon_citation(c) for c in toc_cits}
            for row in toc_rows:
                if canon_citation(row["citation"]) not in {canon_citation(s["citation"]) for s in parsed}:
                    empty_section_gaps.append(
                        {
                            "chapter": slug,
                            "citation": row["citation"],
                            "heading": row.get("heading"),
                            "reason": "chapter_repealed_pdf_has_no_section_text",
                            "chapter_status_note": chapter_status_note,
                        }
                    )
            flag_classification.append(
                {
                    "chapter": slug,
                    "class": "repealed_chapter_notice_only",
                    "toc_count": len(toc_rows),
                    "pdf_section_count": 0,
                }
            )
        toc_canon = {canon_citation(c) for c in toc_cits}
        stray_pdf = [s["citation"] for s in parsed_all if canon_citation(s["citation"]) not in toc_canon]
        cross_chapter_stray = [c for c in stray_pdf if citation_chapter_id(c) != chapter_id]
        pdf_canon = {canon_citation(c) for c in pdf_cits}
        if not repealed_notice and not citations_equal_lists(toc_cits, pdf_cits):
            mismatches.append(
                {
                    "chapter": slug,
                    "reason": "toc_pdf_citation_mismatch",
                    "toc_only": [c for c in toc_cits if canon_citation(c) not in pdf_canon][:20],
                    "pdf_only": [c for c in pdf_cits if canon_citation(c) not in toc_canon][:20],
                    "toc_count": len(toc_cits),
                    "pdf_count": len(pdf_cits),
                }
            )
            if len(toc_cits) > len(pdf_cits):
                flag_classification.append({"chapter": slug, "class": "toc_extra_sections"})
            elif len(pdf_cits) > len(toc_cits):
                flag_classification.append({"chapter": slug, "class": "pdf_extra_in_chapter"})
            else:
                flag_classification.append({"chapter": slug, "class": "same_count_citation_drift"})
        elif cross_chapter_stray:
            flag_classification.append(
                {
                    "chapter": slug,
                    "class": "pdf_cross_chapter_stray_reconciled",
                    "stray_count": len(cross_chapter_stray),
                    "stray_sample": cross_chapter_stray[:5],
                }
            )
        toc_by = {canon_citation(r["citation"]): r for r in toc_rows}
        seen = {}
        native = chapter_native_id(slug)
        ch_text = text
        if repealed_notice and not parsed:
            chapters_out.append(
                {
                    "native_id": native,
                    "path": [
                        {"type": "title", "number": chapter_id.split("-")[0] if chapter_id else None, "heading": None},
                        {"type": "chapter", "number": chapter_id, "heading": chapter_heading},
                    ],
                    "heading": chapter_heading,
                    "text": ch_text,
                    "status_note": chapter_status_note,
                    "raw_sha256s": [prec["sha256"]] + ([hrec["sha256"]] if html_only_toc else []),
                    "source_urls": [pdf_url] + ([html_url] if html_only_toc else []),
                }
            )
            continue
        for sec in parsed:
            cit = sec["citation"]
            seen[cit] = seen.get(cit, 0) + 1
            occ = seen[cit]
            citation_path = cit if occ == 1 else f"{cit}#{occ}"
            toc_row = toc_by.get(canon_citation(cit), {})
            heading = toc_row.get("heading") or sec["heading"]
            body = sec["body"]
            start = ch_text.find(body)
            if start < 0:
                start = ch_text.find(cit + ".")
            end = start + len(body) if start >= 0 else start
            if start < 0:
                mismatches.append({"chapter": slug, "reason": "span_not_found", "citation": cit})
                continue
            status, history = status_and_history(body)
            sections_out.append(
                {
                    "chapter_native_id": native,
                    "citation": cit,
                    "citation_path": citation_path,
                    "number": cit,
                    "heading": heading,
                    "start": start,
                    "end": end,
                    "history": history,
                    "status_label": status,
                    "state": STATE,
                    "hierarchy": hierarchy_for(chapter_id, chapter_heading, cit, heading),
                    "edition": None,
                    "currency": {"statement": OFFICIAL_STATEMENT + " " + UPDATE_STATEMENT, "as_of": None},
                    "effective": None,
                    "source_url": pdf_url,
                    "source_receipt_sha256": prec["sha256"],
                    "duplicate_occurrence": occ > 1,
                }
            )
        ch_row = {
            "native_id": native,
            "path": [
                {"type": "title", "number": chapter_id.split("-")[0] if chapter_id else None, "heading": None},
                {"type": "chapter", "number": chapter_id, "heading": chapter_heading},
            ],
            "heading": chapter_heading,
            "text": ch_text,
            "raw_sha256s": [prec["sha256"]] + ([hrec["sha256"]] if html_only_toc else []),
            "source_urls": [pdf_url] + ([html_url] if html_only_toc else []),
        }
        if chapter_status_note:
            ch_row["status_note"] = chapter_status_note
        chapters_out.append(ch_row)

    edition = {
        "official_statement": OFFICIAL_STATEMENT,
        "update_statement": UPDATE_STATEMENT,
        "source_page": INFO,
    }
    man = write_packet(
        work,
        STATE,
        source={"publisher": "North Dakota Legislative Branch", "base_url": BASE, "info_url": INFO},
        edition=edition,
        chapters=chapters_out,
        sections=sections_out,
        extra={"currency_published_through": None},
    )
    json.dump(empty_section_gaps, open(os.path.join(work, "empty_section_gaps.json"), "w"), indent=2)
    json.dump(flag_classification, open(os.path.join(work, "flag_classification.json"), "w"), indent=2)
    verify(work, arc, mismatches, toc_counts, pdf_counts, man, empty_section_gaps, flag_classification)
    return man


def verify(work, arc, mismatches, toc_counts, pdf_counts, man, empty_section_gaps, flag_classification):
    packet = os.path.join(work, "packet")
    bad_hash = []
    for r in arc.index.values():
        if r.get("state") == "complete":
            try:
                arc.read(r)
            except SystemExit:
                bad_hash.append(r["url"])
    span_bad = []
    ch_rows = [json.loads(x) for x in open(os.path.join(packet, "chapters.jsonl"))]
    text_by = {}
    for c in ch_rows:
        p = os.path.join(packet, "chapter-text", c["text_sha256"] + ".txt")
        text_by[c["native_id"]] = open(p, encoding="utf-8").read()
    for line in open(os.path.join(packet, "sections.jsonl")):
        s = json.loads(line)
        t = text_by[s["chapter_native_id"]]
        slice_ = t[s["start"] : s["end"]]
        if sha256_hex(slice_) != s["text_sha256"]:
            span_bad.append(s.get("citation_path", s.get("citation")))
    report = {
        "state": STATE,
        "source_urls": [INFO, BASE + "index.html"],
        "edition_statements": [OFFICIAL_STATEMENT, UPDATE_STATEMENT],
        "currency_as_of": None,
        "titles": json.load(open(os.path.join(work, "inventory.json")))["title_count"],
        "chapters": man["chapters"],
        "sections": man["sections"],
        "raw_objects_complete": sum(1 for r in arc.index.values() if r.get("state") == "complete"),
        "raw_bytes": sum(r.get("bytes", 0) for r in arc.index.values() if r.get("state") == "complete"),
        "requests": len(arc.index),
        "routes": {
            "direct": sum(1 for r in arc.index.values() if r.get("route") == "direct" and r.get("state") == "complete"),
            "firecrawl": sum(
                1 for r in arc.index.values() if r.get("route") == "firecrawl" and r.get("state") == "complete"
            ),
        },
        "mismatches": mismatches,
        "empty_section_gaps": empty_section_gaps,
        "flag_classification": flag_classification,
        "receipt_rehash_failures": bad_hash,
        "span_verify_failures": span_bad,
        "manifest": man,
    }
    json.dump(report, open(os.path.join(work, "REPORT.json"), "w"), indent=2)
    print("REPORT sections", man["sections"], "mismatches", len(mismatches), "span_bad", len(span_bad))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/nd")
    run(ap.parse_args().work)


if __name__ == "__main__":
    main()
