"""Parse archived MCA section HTML into a staging packet (one part = one text unit).

Reads /tmp/sc4/mt inventory + Archive receipts. Usage: python3 parse.py [--work /tmp/sc4/mt]
"""
import argparse
import html as html_mod
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, html_text, sha256_hex, write_packet  # noqa: E402

BASE = "https://mca.legmt.gov/bills/mca/"
HOME = BASE + "index.html"
SECTION_URL_RE = re.compile(
    r"https://mca\.legmt\.gov/bills/mca/(title_\d+)/((?:chapter|article)_\w+)/part_\d+/section_\d+/[^/]+\.html$",
    re.I,
)
EDITION_RE = re.compile(
    r"<h1>\s*Montana Code Annotated\s+(\d{4})\s*</h1>", re.I
)
CURRENCY_RE = re.compile(r"<p><strong>(.*?)</strong></p>", re.S | re.I)
TITLE_HEAD_RE = re.compile(
    r'<h4 class="section-title-title">\s*(.*?)\s*</h4>', re.S | re.I
)
CHAPTER_HEAD_RE = re.compile(
    r'<h3 class="section-chapter-title">\s*(.*?)\s*</h3>', re.S | re.I
)
PART_HEAD_RE = re.compile(
    r'<h2 class="section-part-title">\s*(.*?)\s*</h2>', re.S | re.I
)
SECTION_HEAD_RE = re.compile(
    r'<h1 class="section-section-title">\s*(.*?)\s*</h1>', re.S | re.I
)
SECTION_BODY_RE = re.compile(
    r'<div class="section-doc"[^>]*>.*?<div class="section-content">(.*?)</div>',
    re.S | re.I,
)
HISTORY_RE = re.compile(
    r'<div class="history-doc"[^>]*>.*?<div class="history-content">(.*?)</div>',
    re.S | re.I,
)
CITATION_RE = re.compile(r'<span class="citation">([^<]+)</span>', re.I)
STATUS_RE = re.compile(r"\b(repealed|reserved|expired|transferred)\b", re.I)


def norm_inline(s):
    return collapse(html_mod.unescape(re.sub(r"\s+", " ", s or "")))


def edition_from_home(arc):
    rec = arc.index.get(HOME)
    if not rec or rec.get("state") != "complete":
        return {
            "edition_year": None,
            "currency": {"statement": None, "as_of": None},
            "receipt_sha256": None,
        }
    html = decode_html(arc.read(rec))[0]
    year_m = EDITION_RE.search(html)
    cur_m = CURRENCY_RE.search(html)
    return {
        "edition_year": year_m.group(1) if year_m else None,
        "currency": {
            "statement": norm_inline(cur_m.group(1)) if cur_m else None,
            "as_of": None,
        },
        "receipt_sha256": rec["sha256"],
    }


def parse_section_page(html, url, receipt):
    m = SECTION_URL_RE.match(url)
    if not m:
        raise ValueError("not a section url: " + url)
    title_dir, sub_dir = m.group(1), m.group(2)
    part_dir = url.split("/")[-3]
    native_id = f"{title_dir}/{sub_dir}/{part_dir}"

    title_heading = norm_inline(TITLE_HEAD_RE.search(html).group(1)) if TITLE_HEAD_RE.search(html) else None
    chapter_heading = (
        norm_inline(CHAPTER_HEAD_RE.search(html).group(1)) if CHAPTER_HEAD_RE.search(html) else None
    )
    part_heading = norm_inline(PART_HEAD_RE.search(html).group(1)) if PART_HEAD_RE.search(html) else None
    section_title = (
        norm_inline(SECTION_HEAD_RE.search(html).group(1)) if SECTION_HEAD_RE.search(html) else None
    )

    body_html = SECTION_BODY_RE.search(html)
    body = html_text(body_html.group(1)) if body_html else ""
    hist_html = HISTORY_RE.search(html)
    history = html_text(hist_html.group(1)) if hist_html else None
    if history and history.startswith("History:"):
        history = history[len("History:") :].strip()
        history = ("History: " + history) if history else None

    cit_m = CITATION_RE.search(html)
    citation = cit_m.group(1).strip() if cit_m else None
    heading = section_title
    if not heading and body:
        line = body.split("\n", 1)[0]
        if citation and line.startswith(citation):
            heading = norm_inline(line[len(citation) :].lstrip(". "))

    status_label = None
    combined = " ".join(filter(None, [heading, body, history, chapter_heading]))
    if STATUS_RE.search(combined):
        status_label = STATUS_RE.search(combined).group(1).capitalize()

    if not body.strip() and status_label:
        body = f"[{status_label}.]"

    sub_level = "article" if sub_dir.startswith("article") else "chapter"
    sub_num = re.sub(r"^(chapter|article)_", "", sub_dir).rstrip("p")
    sub_num = sub_num.lstrip("0") or "0"

    hierarchy = [
        {"level": "title", "number": title_dir.replace("title_", "").lstrip("0") or "0", "heading": title_heading},
        {"level": sub_level, "number": sub_num, "heading": chapter_heading},
        {"level": "part", "number": part_dir.replace("part_", "").lstrip("0") or "0", "heading": part_heading},
        {"level": "section", "number": citation or "", "heading": heading},
    ]

    return {
        "native_id": native_id,
        "url": url,
        "citation": citation,
        "heading": heading,
        "body": body,
        "history": history,
        "status_label": status_label,
        "hierarchy": hierarchy,
        "source_receipt_sha256": receipt["sha256"],
    }


def build_parts(inventory, parsed_by_url):
    chapters = []
    sections_out = []
    verification = []
    occ = {}

    for part in inventory["parts"]:
        native_id = part["native_id"]
        toc_secs = part.get("sections") or []
        part_sections = []
        missing = []
        for toc_row in toc_secs:
            url = toc_row["url"]
            if url not in parsed_by_url:
                missing.append(url)
                continue
            part_sections.append(parsed_by_url[url])

        chapter_chunks = []
        offset = 0
        sep = "\n\n"
        part_rows = []

        for row in part_sections:
            body = row["body"]
            cit = row["citation"] or "unknown"
            occ[cit] = occ.get(cit, 0) + 1
            citation_path = cit if occ[cit] == 1 else f"{cit}@{occ[cit]}"
            start = offset
            if chapter_chunks:
                offset += len(sep)
                start = offset
            chapter_chunks.append(body)
            offset += len(body)
            part_rows.append(
                {
                    "chapter_native_id": native_id,
                    "citation_path": citation_path,
                    "citation": cit,
                    "number": cit,
                    "heading": row["heading"],
                    "start": start,
                    "end": offset,
                    "history": row["history"],
                    "status_label": row["status_label"],
                    "hierarchy": row["hierarchy"],
                    "source_url": row["url"],
                    "source_receipt_sha256": row["source_receipt_sha256"],
                    "edition": None,
                    "currency": {"statement": None, "as_of": None},
                    "effective": None,
                    "state": "MT",
                    "duplicate_occurrence": occ[cit] > 1,
                }
            )

        chapter_text = sep.join(chapter_chunks)
        if part_sections:
            first = part_sections[0]
            path = [
                {"type": "title", "number": first["hierarchy"][0]["number"], "heading": first["hierarchy"][0]["heading"]},
                {
                    "type": first["hierarchy"][1]["level"],
                    "number": first["hierarchy"][1]["number"],
                    "heading": first["hierarchy"][1]["heading"],
                },
                {"type": "part", "number": first["hierarchy"][2]["number"], "heading": first["hierarchy"][2]["heading"]},
            ]
            chapters.append(
                {
                    "native_id": native_id,
                    "path": path,
                    "heading": first["hierarchy"][2]["heading"],
                    "text": chapter_text,
                    "raw_sha256s": sorted({r["source_receipt_sha256"] for r in part_sections}),
                    "source_urls": [r["url"] for r in part_sections],
                    "state": "MT",
                }
            )
            sections_out.extend(part_rows)

        verification.append(
            {
                "native_id": native_id,
                "toc_count": len(toc_secs),
                "parsed_count": len(part_sections),
                "missing_urls": missing,
                "mismatch": len(toc_secs) != len(part_sections),
            }
        )

    return chapters, sections_out, verification


def verify_packet(chapters, sections, arc):
    errors = []
    by_id = {c["native_id"]: c["text"] for c in chapters}
    for s in sections:
        text = by_id[s["chapter_native_id"]][s["start"] : s["end"]]
        if not text.strip() and not s.get("status_label"):
            errors.append(f"empty text {s['citation_path']}")
    for rec in arc.index.values():
        if rec.get("state") == "complete":
            try:
                arc.read(rec)
            except SystemExit:
                errors.append("receipt checksum " + rec["url"])
    return errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/mt")
    a = ap.parse_args()
    arc = Archive(a.work)
    inv_path = os.path.join(a.work, "inventory.json")
    if not os.path.exists(inv_path):
        raise SystemExit("missing inventory.json — run acquire.py first")
    inventory = json.load(open(inv_path))
    edition_meta = edition_from_home(arc)
    edition_str = (
        f"Montana Code Annotated {edition_meta['edition_year']}"
        if edition_meta.get("edition_year")
        else "Montana Code Annotated"
    )

    parsed_by_url = {}
    for url, rec in arc.index.items():
        if not SECTION_URL_RE.match(url) or rec.get("state") != "complete":
            continue
        html = decode_html(arc.read(rec))[0]
        row = parse_section_page(html, url, rec)
        row["edition"] = edition_str
        parsed_by_url[url] = row

    chapters, sections, verification = build_parts(inventory, parsed_by_url)
    for s in sections:
        s["edition"] = edition_str
        s["currency"] = edition_meta["currency"]

    man = write_packet(
        a.work,
        "MT",
        source={"system": "mca.legmt.gov", "base_url": BASE, "unit": "part_html_sections"},
        edition=edition_meta,
        chapters=chapters,
        sections=sections,
        extra={
            "parts_in_inventory": len(inventory.get("parts", [])),
            "sections_in_inventory": len(inventory.get("sections", [])),
            "section_pages_parsed": len(parsed_by_url),
        },
    )

    mismatches = [v for v in verification if v["mismatch"] or v["missing_urls"]]
    verify_errors = verify_packet(chapters, sections, arc)
    report = {
        "source": BASE,
        "edition_verbatim": edition_meta,
        "manifest": man,
        "verification": {
            "part_mismatches": mismatches,
            "span_or_receipt_errors": verify_errors,
            "parts_verified": len(verification) - len(mismatches),
            "parts_total": len(verification),
        },
        "counts": {
            "titles": len(inventory.get("titles", [])),
            "parts": len(inventory.get("parts", [])),
            "sections_toc": len(inventory.get("sections", [])),
            "sections_parsed": len(sections),
            "chapter_units": len(chapters),
        },
        "requests": {
            "total_indexed": len(arc.index),
            "complete": sum(1 for r in arc.index.values() if r.get("state") == "complete"),
            "direct": sum(1 for r in arc.index.values() if r.get("route") == "direct"),
            "firecrawl": sum(1 for r in arc.index.values() if r.get("route") == "firecrawl"),
        },
    }
    with open(os.path.join(a.work, "REPORT.json"), "w") as f:
        json.dump(report, f, indent=1)
    with open(os.path.join(a.work, "verification_parts.json"), "w") as f:
        json.dump(verification, f, indent=1)
    print(json.dumps(man, indent=1))


if __name__ == "__main__":
    main()
