"""Parse Wyoming Statutes from official title PDFs (pdftotext layout output).

Section boundaries follow the publisher PDF layout: a new W.S. section begins only at a line
that starts the full citation `{title}-{chapter}-{section}.` with heading text on the same line.
Subdivisions such as `1-1-123.1.` (Ski Safety Act blocks inside 1-1-123) are not section headers.
"""
import re
import subprocess

from titles import CURRENCY_STATEMENT

# Heading must begin on the same line as the citation (excludes bare `1-1-123.` page artifacts).
SECTION_HEADER = re.compile(
    r"^\s*(\d{1,2}(?:\.\d)?)-(\d+(?:\.?[A-Z])?)-(\d+)\.(?!\d)(\s+)(.+)$"
)
SECTION_CONST_HEADER = re.compile(
    r"^\s*Article\s+(\d+),\s*Section\s+(\d+)\s+(.+)$",
    re.IGNORECASE,
)
TITLE_HEAD = re.compile(r"^\s*TITLE\s+(\d+(?:\.\d)?)\s*-\s*(.+?)\s*$", re.IGNORECASE)
CHAPTER_HEAD = re.compile(r"^\s*CHAPTER\s+(\d+)\s*-\s*(.+?)\s*$", re.IGNORECASE)
REV_ART_HEAD = re.compile(r"^\s*REVISED\s+ARTICLE\s+(\d+(?:\.?[A-Z])?)\s*-\s*(.+?)\s*$", re.IGNORECASE)
ARTICLE_HEAD = re.compile(r"^\s*ARTICLE\s+(\d+(?:\.?[A-Z])?)\s*-\s*(.+?)\s*$", re.IGNORECASE)
PART_HEAD = re.compile(r"^\s*PART\s+(\d+)\.?\s*(.*)$", re.IGNORECASE)
SUBSECTION_START = re.compile(r"^\s*\([a-zA-Z0-9]+\)")


def collapse_line(s):
    return re.sub(r"\s+", " ", (s or "").replace("\u00a0", " ")).strip()


def title_num_from_key(key):
    if key in ("34.1", "97"):
        return key
    return str(int(key))


def normalize_pdf_text(raw):
    return raw.replace("\f", "\n")


def pdf_to_text(pdf_path):
    p = subprocess.run(
        ["pdftotext", "-layout", pdf_path, "-"],
        capture_output=True,
        check=True,
    )
    return normalize_pdf_text(p.stdout.decode("utf-8", errors="replace"))


def _occurrence_path(base, seen):
    n = seen.get(base, 0) + 1
    seen[base] = n
    return base if n == 1 else f"{base}:{n}"


def toc_citation_paths(text, title_key):
    """Ordered section list implied by the title PDF text (same rules as the parser)."""
    expected = title_num_from_key(title_key)
    seen = {}
    out = []
    for line in text.split("\n"):
        if expected == "97":
            m = SECTION_CONST_HEADER.match(line)
            if m:
                base = f"97-{m.group(1)}-{m.group(2)}"
                out.append(_occurrence_path(base, seen))
                continue
        m = SECTION_HEADER.match(line)
        if m and m.group(1) == expected:
            base = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            out.append(_occurrence_path(base, seen))
    return out


def split_heading_body(section_lines):
    if not section_lines:
        return "", ""
    first = section_lines[0]
    m = SECTION_HEADER.match(first) or SECTION_CONST_HEADER.match(first)
    if m:
        tail = m.group(5) if m.re is SECTION_HEADER else m.group(3)
    else:
        tail = first
    heading_parts = [collapse_line(tail)]
    body_start = 1
    for i in range(1, min(4, len(section_lines))):
        line = section_lines[i]
        if not line.strip():
            continue
        if SUBSECTION_START.match(line):
            body_start = i
            break
        if SECTION_HEADER.match(line) or SECTION_CONST_HEADER.match(line):
            break
        if i == 1 and not SUBSECTION_START.match(line):
            heading_parts.append(collapse_line(line))
            body_start = i + 1
        else:
            body_start = i
            break
    heading = collapse_line(" ".join(heading_parts))
    body = "\n".join(section_lines[body_start:]).strip("\n")
    if body:
        full = heading + "\n\n" + body if heading else body
    else:
        full = heading
    return heading, full


def parse_title_text(text, *, title_key, title_label, source_url, receipt_sha):
    lines = text.split("\n")
    expected_title = title_num_from_key(title_key)
    title_heading = title_label
    chapter_num = None
    chapter_heading = None
    article_num = None
    article_heading = None
    part_num = None
    part_heading = None

    chapters = {}
    chapter_order = []
    current_lines = []
    current_meta = None
    cite_seen = {}
    doc_order_sections = []

    def flush_section():
        nonlocal current_lines, current_meta
        if not current_meta or not current_lines:
            current_lines = []
            current_meta = None
            return
        heading, full_text = split_heading_body(current_lines)
        if not full_text.strip():
            full_text = collapse_line(current_lines[0])
        meta = {**current_meta, "heading": heading, "text": full_text}
        cid = meta["chapter_native_id"]
        if cid not in chapters:
            chapters[cid] = {
                "native_id": cid,
                "heading": meta["chapter_heading"],
                "sections_raw": [],
                "source_url": source_url,
                "raw_sha256": receipt_sha,
            }
            chapter_order.append(cid)
        chapters[cid]["sections_raw"].append(meta)
        doc_order_sections.append(meta)
        current_lines = []
        current_meta = None

    def start_ws_section(line, tnum, cnum, snum):
        nonlocal current_meta, current_lines, chapter_num, chapter_heading
        chapter_num = chapter_num or cnum
        chapter_heading = chapter_heading or f"Chapter {cnum}"
        cid = f"{tnum}-{cnum}"
        hierarchy = [{"level": "title", "number": tnum, "heading": title_heading}]
        if expected_title == "34.1":
            # UCC citations use articles, not fabricated chapters. Preserve the
            # publisher's punctuation (2.A and 4A are distinct printed tokens).
            hierarchy.append({"level": "article", "number": cnum,
                              "heading": chapter_heading if chapter_num == cnum else None})
        else:
            hierarchy.append({"level": "chapter", "number": cnum, "heading": chapter_heading or ""})
        if article_num and expected_title != "34.1":
            hierarchy.append({"level": "article", "number": article_num, "heading": article_heading or ""})
        if part_num:
            hierarchy.append({"level": "part", "number": part_num, "heading": part_heading or ""})
        base = f"{tnum}-{cnum}-{snum}"
        cite_path = _occurrence_path(base, cite_seen)
        flush_section()
        current_meta = {
            "chapter_native_id": cid,
            "chapter_heading": chapter_heading or f"Chapter {cnum}",
            "hierarchy_prefix": hierarchy,
            "citation_path": cite_path,
            "citation": f"{base}.",
            "section_number": snum,
            "source_url": source_url,
            "source_receipt_sha256": receipt_sha,
        }
        current_lines = [line]

    for line in lines:
        t = TITLE_HEAD.match(line)
        if t:
            title_heading = collapse_line(t.group(2))
            continue
        c = CHAPTER_HEAD.match(line)
        if c:
            chapter_num = c.group(1)
            chapter_heading = collapse_line(c.group(2))
            article_num = None
            article_heading = None
            part_num = None
            continue
        ra = REV_ART_HEAD.match(line)
        if ra:
            flush_section()
            chapter_num = ra.group(1)
            chapter_heading = collapse_line(ra.group(2))
            article_num = None
            article_heading = None
            part_num = None
            continue
        ar = ARTICLE_HEAD.match(line)
        if ar and not REV_ART_HEAD.match(line):
            if expected_title == "34.1":
                flush_section()
                chapter_num = ar.group(1)
                chapter_heading = collapse_line(ar.group(2))
                article_num = None
                article_heading = None
                part_num = None
                part_heading = None
                continue
            article_num = ar.group(1)
            article_heading = collapse_line(ar.group(2))
            continue
        pr = PART_HEAD.match(line)
        if pr and collapse_line(pr.group(2)):
            part_num = pr.group(1)
            part_heading = collapse_line(pr.group(2))
            continue

        m = SECTION_HEADER.match(line)
        if m:
            tnum, cnum, snum = m.group(1), m.group(2), m.group(3)
            if tnum != expected_title:
                if current_meta:
                    current_lines.append(line)
                continue
            start_ws_section(line, tnum, cnum, snum)
            continue

        m = SECTION_CONST_HEADER.match(line)
        if m and expected_title == "97":
            anum, snum = m.group(1), m.group(2)
            chapter_heading = chapter_heading or f"Article {anum}"
            cid = f"97-{anum}"
            hierarchy = [
                {"level": "title", "number": "97", "heading": title_heading},
                {"level": "article", "number": anum, "heading": chapter_heading or ""},
            ]
            base = f"97-{anum}-{snum}"
            cite_path = _occurrence_path(base, cite_seen)
            printed = f"Article {anum}, Section {snum}"
            flush_section()
            current_meta = {
                "chapter_native_id": cid,
                "chapter_heading": chapter_heading or f"Article {anum}",
                "hierarchy_prefix": hierarchy,
                "citation_path": cite_path,
                "citation": printed,
                "section_number": snum,
                "source_url": source_url,
                "source_receipt_sha256": receipt_sha,
            }
            current_lines = [line]
            continue

        if current_meta:
            current_lines.append(line)

    flush_section()

    chapter_rows = []
    section_rows = []
    for cid in chapter_order:
        ch = chapters[cid]
        chunks = []
        for sec in ch["sections_raw"]:
            text = sec["text"]
            if not text.strip():
                continue
            chunks.append(text)
        if not chunks:
            continue
        ch_text = "\n\n".join(chunks)
        chapter_rows.append(
            {
                "native_id": cid,
                "heading": ch["heading"],
                "text": ch_text,
                "raw_sha256s": [receipt_sha],
                "source_urls": [source_url],
            }
        )
        offset = 0
        for sec in ch["sections_raw"]:
            text = sec.get("text", "")
            if not text.strip():
                continue
            start = offset
            end = start + len(text)
            offset = end + 2
            low = text.lower()
            head_low = (sec.get("heading") or "").lower()
            status = hist = None
            if head_low.startswith("repealed") or (
                not head_low and "repealed" in low.split("\n", 1)[0]
            ):
                status = collapse_line(sec["heading"] or text.split("\n", 1)[0])
                hist = status
            elif head_low.startswith("reserved"):
                status = collapse_line(sec["heading"] or text.split("\n", 1)[0])
                hist = status
            hierarchy = list(sec["hierarchy_prefix"])
            hierarchy.append(
                {"level": "section", "number": sec["section_number"], "heading": sec["heading"]}
            )
            section_rows.append(
                {
                    "state": "WY",
                    "chapter_native_id": cid,
                    "citation_path": sec["citation_path"],
                    "citation": sec["citation"],
                    "hierarchy": hierarchy,
                    "heading": sec["heading"],
                    "history": hist,
                    "status_label": status,
                    "edition": None,
                    "currency": {"statement": CURRENCY_STATEMENT, "as_of": None},
                    "effective": None,
                    "start": start,
                    "end": end,
                    "source_url": sec["source_url"],
                    "source_receipt_sha256": sec["source_receipt_sha256"],
                }
            )

    parsed_paths = [s["citation_path"] for s in doc_order_sections]
    return chapter_rows, section_rows, parsed_paths


def inventory_section_ids(text, title_key):
    return toc_citation_paths(text, title_key)
