"""Parse acquired Delaware Code HTML into a staging packet (chapter + subchapter units).

Usage: python3 parse.py [--work /tmp/sc4/de]
"""
import argparse
import html as html_mod
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, html_text, write_packet  # noqa: E402

from de_site import (  # noqa: E402
    BASE,
    CHAPTER_INDEX_RE,
    UNIT_URL_RE,
    chap_num_from_slug,
    child_page_urls,
    is_chapter_index,
    section_head_count,
)

SECTION_RE = re.compile(
    r'<div class="Section">\s*<div class="SectionHead" id="([^"]*)">(.*?)</div>(.*?)</div>\s*(?:<br\s*/?>)?',
    re.S | re.I,
)
TOC_ITEM_RE = re.compile(r'<ul class="chaptersections">(.*?)</ul>', re.S | re.I)
TOC_LINK_RE = re.compile(r'<a\s+href="#([^"]+)"[^>]*>\s*(.*?)\s*</a>', re.S | re.I)
TITLE_HEAD_RE = re.compile(r'<div id="TitleHead">(.*?)</div>', re.S | re.I)
H_TAG_RE = re.compile(r"<h([1-6])[^>]*>(.*?)</h[1-6]>", re.S | re.I)
BODY_RE = re.compile(r"(?is)(<p\b.*?</p>)")
HISTORY_START_RE = re.compile(r"\d+\s+Del\.\s+C\.|^\s*\d+\s+Del\.\s+Laws", re.I | re.M)
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
    return num.rstrip("."), heading, t


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
        if len(history) < 30 and "Del." not in history:
            history = None
    return body, history


def parse_title_head(html):
    title_heading = chapter_heading = subchapter_heading = None
    title_num = None
    th = TITLE_HEAD_RE.search(html)
    if not th:
        return title_num, title_heading, chapter_heading, subchapter_heading
    saw_chapter = False
    for level, frag in H_TAG_RE.findall(th.group(1)):
        text = norm_inline(re.sub(r"<[^>]+>", " ", frag))
        if level == "1" and text.upper().startswith("TITLE"):
            m = re.search(r"TITLE\s+(\d+)", text, re.I)
            if m:
                title_num = m.group(1)
            continue
        if level == "4" and not saw_chapter and title_heading is None:
            title_heading = text
            continue
        if level == "3" and text.upper().startswith("CHAPTER"):
            chapter_heading = text
            saw_chapter = True
            continue
        if level == "4" and saw_chapter and text.lower().startswith("subchapter"):
            subchapter_heading = text
    return title_num, title_heading, chapter_heading, subchapter_heading


def parse_unit_page(html, url, receipt):
    meta = UNIT_URL_RE.match(url)
    if not meta:
        raise ValueError("not a unit url: " + url)
    title_num, chap_slug, sub_slug = meta.group(1), meta.group(2), meta.group(3)
    chap_num = chap_num_from_slug(chap_slug)
    _, title_heading, chapter_heading, subchapter_heading = parse_title_head(html)
    if not title_num:
        title_num = meta.group(1)

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
        occ[sec_num] = occ.get(sec_num, 0) + 1
        citation = f"§ {sec_num}"

        start = offset
        if chapter_chunks:
            offset += len(sep)
            start = offset
        chapter_chunks.append(body)
        offset += len(body)

        hierarchy = [
            {"level": "title", "number": title_num, "heading": title_heading},
            {"level": "chapter", "number": chap_num, "heading": chapter_heading},
        ]
        if sub_slug:
            hierarchy.append(
                {
                    "level": "subchapter",
                    "number": sub_slug,
                    "heading": subchapter_heading,
                }
            )
        hierarchy.append({"level": "section", "number": sec_num, "heading": heading})

        native_id = f"title{title_num}/{chap_slug}" + (f"/{sub_slug}" if sub_slug else "")
        sections.append(
            {
                "chapter_native_id": native_id,
                "citation": citation,
                "number": sec_num,
                "heading": heading,
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
                "_title": title_num,
                "_chap_num": chap_num,
                "_chap_slug": chap_slug,
                "_sub_slug": sub_slug,
                "_occ": occ[sec_num],
            }
        )

    chapter_text = sep.join(chapter_chunks)
    native_id = f"title{title_num}/{chap_slug}" + (f"/{sub_slug}" if sub_slug else "")
    unit_row = {
        "native_id": native_id,
        "path": [
            {"type": "title", "number": title_num, "heading": title_heading},
            {"type": "chapter", "number": chap_num, "heading": chapter_heading},
        ],
        "heading": subchapter_heading or chapter_heading,
        "text": chapter_text,
        "raw_sha256s": [receipt["sha256"]],
        "source_urls": [url],
        "unit_kind": "subchapter" if sub_slug else "chapter",
        "subchapter_slug": sub_slug,
        "toc_section_ids": [x[0] for x in toc_ids],
        "toc_labels": [x[1] for x in toc_ids],
    }
    if sub_slug:
        unit_row["path"].append(
            {"type": "subchapter", "number": sub_slug, "heading": subchapter_heading}
        )
    inv = {
        "url": url,
        "native_id": native_id,
        "kind": unit_row["unit_kind"],
        "title": title_num,
        "chapter": chap_num,
        "subchapter": sub_slug,
        "section_heads_html": section_head_count(html),
        "parsed_count": len(sections),
        "toc_count": len(toc_ids),
        "is_index_only": False,
    }
    return unit_row, sections, inv


def assign_citation_paths(all_sections):
    """title-chapter-section by default; insert subchapter slug only when section number repeats in chapter."""
    by_chapter = defaultdict(list)
    for s in all_sections:
        by_chapter[(s["_title"], s["_chap_slug"])].append(s)
    for (_t, _c), secs in by_chapter.items():
        num_counts = Counter(x["number"] for x in secs)
        for s in secs:
            t, ch, sub, num, occ = s["_title"], s["_chap_num"], s["_sub_slug"], s["number"], s["_occ"]
            if num_counts[num] > 1 and sub:
                base = f"{t}-{ch}-{sub}-{num}"
            else:
                base = f"{t}-{ch}-{num}"
            s["citation_path"] = base if occ == 1 else f"{base}@{occ}"
            s["duplicate_occurrence"] = occ > 1
            for k in ("_title", "_chap_num", "_chap_slug", "_sub_slug", "_occ"):
                s.pop(k, None)


def edition_from_home(arc):
    rec = arc.index.get(BASE + "index.html")
    if not rec or rec.get("state") != "complete":
        return {"statement": None, "as_of": None, "notice_verbatim": None, "receipt_sha256": None}
    html = decode_html(arc.read(rec))[0]
    notice_m = re.search(r"<h3>\s*Notice\s*</h3>\s*<p>(.*?)</p>", html, re.S | re.I)
    notice = norm_inline(notice_m.group(1)) if notice_m else None
    return {
        "statement": notice,
        "as_of": None,
        "notice_verbatim": notice,
        "receipt_sha256": rec["sha256"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/de")
    a = ap.parse_args()
    arc = Archive(a.work)
    edition = edition_from_home(arc)
    units, sections, inventory, skipped_indexes = [], [], [], []

    for url, rec in sorted(arc.index.items()):
        if rec.get("state") != "complete" or not UNIT_URL_RE.match(url):
            continue
        html = decode_html(arc.read(rec))[0]
        meta = UNIT_URL_RE.match(url)
        if CHAPTER_INDEX_RE.match(url) and is_chapter_index(html, meta.group(1), meta.group(2)):
            skipped_indexes.append(
                {
                    "url": url,
                    "kind": "chapter_index",
                    "child_urls": child_page_urls(html, meta.group(1), meta.group(2)),
                    "section_heads_html": 0,
                    "staged": False,
                }
            )
            continue
        if section_head_count(html) == 0:
            skipped_indexes.append(
                {"url": url, "kind": "empty_page", "section_heads_html": 0, "staged": False}
            )
            continue
        unit, secs, inv = parse_unit_page(html, url, rec)
        if not unit["text"].strip() and inv["parsed_count"] > 0:
            raise SystemExit("empty unit text with sections: " + url)
        if not unit["text"].strip():
            skipped_indexes.append(
                {"url": url, "kind": "empty_content", "section_heads_html": inv["section_heads_html"], "staged": False}
            )
            continue
        units.append(unit)
        sections.extend(secs)
        inventory.append(inv)

    assign_citation_paths(sections)
    os.makedirs(a.work, exist_ok=True)
    with open(os.path.join(a.work, "inventory.json"), "w") as f:
        json.dump({"content_units": inventory, "skipped": skipped_indexes}, f, indent=1)

    sub_count = sum(1 for u in units if u.get("unit_kind") == "subchapter")
    man = write_packet(
        a.work,
        "DE",
        source={
            "system": "delcode.delaware.gov",
            "base_url": BASE,
            "unit": "html_page",
        },
        edition=edition,
        chapters=units,
        sections=sections,
        extra={
            "currency_home_notice_sha256": edition.get("receipt_sha256"),
            "citation_path_rule": "title-chapter-section; title-chapter-subchapter_slug-section when section number repeats within chapter",
            "content_units": len(units),
            "subchapter_units": sub_count,
            "chapter_index_pages_skipped": len([x for x in skipped_indexes if x["kind"] == "chapter_index"]),
        },
    )
    print(json.dumps(man, indent=1))


if __name__ == "__main__":
    main()
