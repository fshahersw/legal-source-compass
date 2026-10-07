"""Parse official Washington 2026 RCW archive HTML (title + chapter index pages)."""
import html as html_mod
import re
from urllib.parse import unquote, urlparse, urlunparse, urlparse as _urlparse


def normalize_publisher_url(href: str) -> str:
    """Encode literal spaces in lawfilesext paths (leg.wa.gov index sometimes emits unescaped spaces)."""
    p = _urlparse(href.strip())
    path = p.path.replace(" ", "%20")
    return urlunparse((p.scheme, p.netloc.lower(), path, "", p.query, p.fragment))

import re as _re

from sc_common import collapse, html_text  # noqa: E402 — caller must set sys.path to b4 parent

ARCHIVE_INDEX = (
    "https://leg.wa.gov/state-laws-and-rules/state-laws-rcw/past-versions-of-state-laws/2026-rcw-archive/"
)
ARCHIVE_YEAR = "2026"

TITLE_ROW = re.compile(
    r'<a\s+href="(https?://lawfilesext\.leg\.wa\.gov/law/RCWArchive/\d+/[^"]+TITLE\.htm)"[^>]*>\s*Title\s+([^<]+)\s*</a>',
    re.I,
)
TITLE_HEAD = re.compile(r"\bTitle\s+([0-9]+[A-Z]?)\s+RCW\b", re.I)
CHAPTERS_HEAD = re.compile(r"<b>\s*Chapters\s*</b>", re.I)
CHAPTER_ROW = re.compile(
    r"<tr\b[^>]*>([\s\S]*?)</tr>",
    re.I,
)
CHAPTER_LINK = re.compile(
    r"href=['\"]?(https?://lawfilesext\.leg\.wa\.gov/law/RCWArchive/\d+/[^'\"]+CHAPTER\.htm)['\"]?",
    re.I,
)
CHAPTER_ID_TEXT = re.compile(r">\s*([0-9]+(?:\.[0-9]+[A-Z]?)+)\s*</a>", re.I)
CHAPTER_PAGE_HEAD = re.compile(r"\bChapter\s+([0-9]+(?:\.[0-9]+[A-Z]?)+)\s*(?:</a>)?\s*RCW\b", re.I)
SECTIONS_HEAD = re.compile(r"<b>\s*Sections\s*</b>", re.I)
SECTION_ROW_LINK = re.compile(
    r"<tr\b[^>]*>\s*<td[^>]*>\s*<a\s+href=['\"]?[^'\"]+['\"]?>\s*([0-9]+(?:\.[0-9]+[A-Z]?)+)\s*</a>",
    re.I,
)
COMBINED_CHAPTER_PDF = re.compile(
    r"href=['\"]?(https?://lawfilesext\.leg\.wa\.gov[^'\"]+COMBINEDCHAPTER\.pdf)['\"]?[^>]*>\s*Complete\s+Chapter",
    re.I,
)


def path_title_id(href: str) -> str | None:
    path = unquote(urlparse(href).path)
    m = re.search(r"RCW\s+([0-9]+[A-Z]?)\s+TITLE\.htm$", path, re.I)
    return m.group(1).upper() if m else None


def path_chapter_id(href: str) -> str | None:
    path = unquote(urlparse(href).path)
    m = re.search(r"RCW\s+([0-9]+[A-Z]?)\s*\.\s*([0-9]+[A-Z]?)\s+CHAPTER\.htm$", path, re.I)
    if not m:
        return None
    return f"{m.group(1).upper()}.{m.group(2).upper()}"


def parse_archive_index(html: str) -> list[dict]:
    rows = []
    seen = set()
    for href, label in TITLE_ROW.findall(html):
        href = normalize_publisher_url(html_mod.unescape(href))
        label = collapse(html_mod.unescape(label))
        if href in seen:
            continue
        seen.add(href)
        pid = path_title_id(href)
        rows.append(
            {
                "row_label": label,
                "title_url": href,
                "path_title_id": pid,
                "row_path_match": pid == label.upper() if pid else False,
            }
        )
    if not rows:
        raise ValueError("no title rows on archive index page")
    return rows


def parse_title_page(html: str) -> dict:
    visible = html_text(html)
    m = TITLE_HEAD.search(visible)
    if not m:
        raise ValueError("Title N RCW heading not found")
    native_title_id = m.group(1).upper()
    if not CHAPTERS_HEAD.search(html):
        raise ValueError("Chapters heading not found")
    chapters = []
    for row in CHAPTER_ROW.findall(html):
        if not re.search(r"CHAPTER\.htm", row, re.I):
            continue
        lm = CHAPTER_LINK.search(row)
        if not lm:
            continue
        href = normalize_publisher_url(html_mod.unescape(lm.group(1)))
        cells = re.findall(r"<td\b[^>]*>([\s\S]*?)</td>", row, re.I)
        desc = html_text(cells[1]) if len(cells) > 1 else ""
        tid = path_chapter_id(href)
        text_id = None
        tm = CHAPTER_ID_TEXT.search(row)
        if tm:
            text_id = tm.group(1).upper()
        chapters.append(
            {
                "chapter_id": text_id or tid,
                "href_chapter_id": tid,
                "chapter_url": href,
                "description": desc,
                "identity_ok": bool(tid and text_id and tid == text_id),
            }
        )
    if not chapters:
        raise ValueError("no chapter links on title page")
    title_heading = ""
    tm2 = re.search(r"Title\s+[0-9]+[A-Z]?\s+RCW.*?</font>.*?<b>([^<]+)</b>", html, re.I | re.S)
    if tm2:
        title_heading = collapse(html_text(tm2.group(1)))
    return {
        "native_title_id": native_title_id,
        "title_heading": title_heading,
        "chapters": chapters,
    }


def parse_chapter_index(html: str) -> dict:
    visible = html_text(html)
    m = CHAPTER_PAGE_HEAD.search(visible) or CHAPTER_PAGE_HEAD.search(html)
    chapter_id = m.group(1).upper() if m else None
    pdf_m = COMBINED_CHAPTER_PDF.search(html)
    if not pdf_m:
        raise ValueError("Complete Chapter PDF link not found")
    pdf_url = normalize_publisher_url(html_mod.unescape(pdf_m.group(1)))
    sections = []
    if SECTIONS_HEAD.search(html):
        for sm in SECTION_ROW_LINK.finditer(html):
            sec_id = sm.group(1).upper()
            if chapter_id and not sec_id.startswith(chapter_id.split(".")[0]):
                # still allow if full chapter prefix matches
                if not sec_id.startswith(chapter_id.rsplit(".", 1)[0] if "." in chapter_id else chapter_id):
                    pass
            sections.append({"section_id": sec_id, "toc_label": ""})
    # enrich headings from row second cell
    for row in CHAPTER_ROW.findall(html):
        sm = SECTION_ROW_LINK.search(row)
        if not sm:
            continue
        sec_id = sm.group(1).upper()
        cells = re.findall(r"<td\b[^>]*>([\s\S]*?)</td>", row, re.I)
        heading = html_text(cells[1]) if len(cells) > 1 else ""
        for s in sections:
            if s["section_id"] == sec_id:
                s["toc_label"] = heading
    ch_heading = ""
    hm = re.search(r"Chapter\s+[0-9].*?<b>([^<]+)</b>", html, re.I | re.S)
    if hm:
        ch_heading = collapse(html_text(hm.group(1)))
    return {
        "chapter_id": chapter_id,
        "chapter_heading": ch_heading,
        "complete_chapter_pdf_url": pdf_url,
        "sections_toc": sections,
    }
