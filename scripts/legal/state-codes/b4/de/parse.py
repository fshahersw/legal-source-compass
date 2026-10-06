"""Parse acquired Delaware Code Online chapter HTML into a staging packet.

Reads verbatim originals from Archive work dir (/tmp/sc4/de). One chapter page = one source unit.
Usage: python3 parse.py [--work /tmp/sc4/de]
"""
import argparse
import html as html_mod
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, html_text, write_packet  # noqa: E402

BASE = "https://delcode.delaware.gov/"
CHAPTER_URL_RE = re.compile(
    r"https://delcode\.delaware\.gov/title(\d+)/(c[^/]+)/index\.html$"
)
SECTION_RE = re.compile(
    r'<div class="Section">\s*<div class="SectionHead" id="([^"]*)">(.*?)</div>(.*?)</div>\s*(?:<br\s*/?>)?',
    re.S | re.I,
)
TOC_ITEM_RE = re.compile(
    r'<ul class="chaptersections">(.*?)</ul>', re.S | re.I
)
TOC_LINK_RE = re.compile(r'<a\s+href="#([^"]+)"[^>]*>\s*(.*?)\s*</a>', re.S | re.I)
TITLE_HEAD_RE = re.compile(r'<div id="TitleHead">(.*?)</div>', re.S | re.I)
H_TAG_RE = re.compile(r"<h([1-6])[^>]*>(.*?)</h[1-6]>", re.S | re.I)
BODY_RE = re.compile(r"(?is)(<p\b.*?</p>)")
HISTORY_START_RE = re.compile(
    r"\d+\s+Del\.\s+C\.|^\s*\d+\s+Del\.\s+Laws", re.I | re.M
)
STATUS_IN_HEADING_RE = re.compile(r"\b(repealed|reserved|expired|transferred)\b", re.I)


def norm_inline(s):
    return collapse(html_mod.unescape(re.sub(r"\s+", " ", s or "")))


def parse_section_head(raw):
    t = norm_inline(re.sub(r"<[^>]+>", " ", raw))
    t = re.sub(r"§+", "", t)
    t = re.sub(r"\u2009", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    m = re.match(r"^([^.]+)\.\s*(.*)$", t)
    if not m:
        return None, None, t
    num = re.sub(r"\s+", "", m.group(1))
    heading = m.group(2).strip() or None
    head_line = t
    return num.rstrip("."), heading, head_line


def published_body_fallback(body, heading, status_label, history=None):
    if body and body.strip():
        return body
    m = re.search(r"\[([^\]]+)\]", heading or "")
    if m:
        return "[" + m.group(1).strip() + "]"
    if status_label:
        return f"[{status_label}.]"
    if history and history.strip():
        return history.strip()
    return body or ""


def split_body_history(inner):
    """Statutory paragraphs vs trailing source-note / history tail."""
    paras = BODY_RE.findall(inner)
    if not paras:
        rest = html_text(inner).strip()
        return rest, rest or None
    body = "\n\n".join(t for p in paras for t in [html_text(p)] if t).strip()
    if not body:
        body = html_text(re.sub(r"(?is)<p\b[^>]*>\s*</p>", "", inner)).strip()
    tail_html = BODY_RE.split(inner, maxsplit=len(paras))[-1]
    history = html_text(tail_html).strip() or None
    if history and not HISTORY_START_RE.search(history):
        # Some sections have only body; stray markup can look like tail.
        if len(history) < 30 and "Del." not in history:
            history = None
    return body, history


def parse_chapter_page(html, url, receipt):
    m = CHAPTER_URL_RE.match(url)
    if not m:
        raise ValueError("not a chapter url: " + url)
    title_num, chap_slug = m.group(1), m.group(2)
    chap_num = chap_slug[1:].lstrip("0") or "0"
    if chap_num.isdigit():
        chap_num = str(int(chap_num))

    th = TITLE_HEAD_RE.search(html)
    title_heading, chapter_heading = "", ""
    if th:
        for level, frag in H_TAG_RE.findall(th.group(1)):
            text = norm_inline(re.sub(r"<[^>]+>", " ", frag))
            if level == "1" and text.upper().startswith("TITLE"):
                continue
            if level == "4" and not title_heading:
                title_heading = text
            if level == "3" and text.upper().startswith("CHAPTER"):
                chapter_heading = text

    toc_block = TOC_ITEM_RE.search(html)
    toc_ids = []
    if toc_block:
        for aid, label in TOC_LINK_RE.findall(toc_block.group(1)):
            toc_ids.append((aid.strip(), norm_inline(label)))

    idx = html.lower().find('<div id="codebody">')
    body_html = html[idx:] if idx >= 0 else html

    sections = []
    chapter_chunks = []
    offset = 0
    sep = "\n\n"
    occ = {}

    for anchor, head_raw, tail in SECTION_RE.findall(body_html):
        anchor = anchor.strip()
        sec_num, heading, head_line = parse_section_head(head_raw)
        if not sec_num:
            sec_num = anchor
        body, history = split_body_history(tail)
        status = None
        if STATUS_IN_HEADING_RE.search(heading or ""):
            status = STATUS_IN_HEADING_RE.search(heading).group(1).capitalize()
        body = published_body_fallback(body, heading, status, history)
        if not body.strip() and head_line:
            body = head_line
        occ_key = f"{title_num}-{chap_num}-{sec_num}"
        occ[occ_key] = occ.get(occ_key, 0) + 1
        citation_path = occ_key if occ[occ_key] == 1 else f"{occ_key}@{occ[occ_key]}"
        citation = f"§ {sec_num}"

        start = offset
        if chapter_chunks:
            offset += len(sep)
            start = offset
        chapter_chunks.append(body)
        offset += len(body)

        hierarchy = [
            {"level": "title", "number": title_num, "heading": title_heading or None},
            {"level": "chapter", "number": chap_num, "heading": chapter_heading or None},
            {"level": "section", "number": sec_num, "heading": heading or None},
        ]
        sections.append(
            {
                "chapter_native_id": f"title{title_num}/{chap_slug}",
                "citation_path": citation_path,
                "citation": citation,
                "number": sec_num,
                "heading": heading or None,
                "start": start,
                "end": offset,
                "history": history,
                "status_label": status,
                "hierarchy": hierarchy,
                "source_url": url,
                "source_receipt_sha256": receipt["sha256"],
                "edition": None,
                "currency": {"statement": None, "as_of": None},
                "effective": None,
                "duplicate_occurrence": occ[occ_key] > 1,
            }
        )

    chapter_text = sep.join(chapter_chunks)
    native_id = f"title{title_num}/{chap_slug}"
    chapter_row = {
        "native_id": native_id,
        "path": [
            {"type": "title", "number": title_num, "heading": title_heading or None},
            {"type": "chapter", "number": chap_num, "heading": chapter_heading or None},
        ],
        "heading": chapter_heading or None,
        "text": chapter_text,
        "raw_sha256s": [receipt["sha256"]],
        "source_urls": [url],
        "toc_section_ids": [x[0] for x in toc_ids],
        "toc_labels": [x[1] for x in toc_ids],
    }
    inv = {
        "url": url,
        "native_id": native_id,
        "title": title_num,
        "chapter": chap_num,
        "toc_count": len(toc_ids),
        "parsed_count": len(sections),
        "toc_ids": [x[0] for x in toc_ids],
        "parsed_ids": [s["number"] for s in sections],
    }
    return chapter_row, sections, inv


def edition_from_home(arc):
    rec = arc.index.get(BASE + "index.html")
    if not rec or rec.get("state") != "complete":
        return {"statement": None, "as_of": None, "notice_verbatim": None, "receipt_sha256": None}
    html = decode_html(arc.read(rec))[0]
    notice_m = re.search(
        r"<h3>\s*Notice\s*</h3>\s*<p>(.*?)</p>", html, re.S | re.I
    )
    notice = norm_inline(notice_m.group(1)) if notice_m else None
    as_of = None
    if notice:
        dm = re.search(r"enacted as of\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})", notice)
        if dm:
            as_of = None  # prose date — contract says do not parse to ISO
    return {
        "statement": notice,
        "as_of": as_of,
        "notice_verbatim": notice,
        "receipt_sha256": rec["sha256"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/de")
    a = ap.parse_args()
    arc = Archive(a.work)
    edition = edition_from_home(arc)
    chapters, sections, inventory = [], [], []
    for url, rec in sorted(arc.index.items()):
        if not CHAPTER_URL_RE.match(url) or rec.get("state") != "complete":
            continue
        html = decode_html(arc.read(rec))[0]
        ch, secs, inv = parse_chapter_page(html, url, rec)
        chapters.append(ch)
        sections.extend(secs)
        inventory.append(inv)
    os.makedirs(a.work, exist_ok=True)
    with open(os.path.join(a.work, "inventory.json"), "w") as f:
        json.dump(inventory, f, indent=1)
    man = write_packet(
        a.work,
        "DE",
        source={
            "system": "delcode.delaware.gov",
            "base_url": BASE,
            "unit": "chapter_html_page",
        },
        edition=edition,
        chapters=chapters,
        sections=sections,
        extra={
            "currency_home_notice_sha256": edition.get("receipt_sha256"),
            "titles_in_inventory": len({i["title"] for i in inventory}),
            "chapter_pages": len(chapters),
        },
    )
    print(json.dumps(man, indent=1))


if __name__ == "__main__":
    main()
