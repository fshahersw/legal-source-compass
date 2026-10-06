"""Shared Maryland Code (mgaleg StatuteText HTML) publisher helpers."""
from __future__ import annotations

import hashlib
import html as htmllib
import re
import unicodedata

from bs4 import BeautifulSoup

BASE = "https://mgaleg.maryland.gov/mgawebsite"
CODE_ID = "md-code"
CODE_NAME = "Maryland Code"
EDITION_KEY = "oct1"
ENACTMENTS = "true"
PARSER_NAME = "md-statute-text-html"
PARSER_VERSION = "1"
LANDING = BASE + "/Laws/Statutes"
SECTION_ID_REGEX = r"^[a-z0-9]+ [0-9][0-9A-Za-z.\-]+$"
STATUTE_URL_PATTERN = (
    r"^https://mgaleg\.maryland\.gov/mgawebsite/Laws/StatuteText\?"
    r"article=[a-z0-9]+&section=[^&]+&enactments=true$"
)
PDF_URL_PATTERN = r"^https://mgaleg\.maryland\.gov/\d+RS/Statute_Web/[a-z0-9]+/[a-z0-9]+\.pdf$"

DASHES = ("\u2013", "\u2014", "\u2212")
_DASH_CLASS = "".join(DASHES)
# Default publisher marker: §14. (period ends the marker, not part of the section id).
SECTION_MARK = re.compile(
    r"§\s*([0-9][0-9A-Za-z." + _DASH_CLASS + r"\-]*)\s*\.(?:[ \t]*([^\n\r]*))?",
)
# Decimal sections where the trailing period is part of the section number (§15–1628.2).
SECTION_MARK_DECIMAL = re.compile(
    r"§\s*([0-9][0-9A-Za-z" + _DASH_CLASS + r"\-]*\.[0-9]+)\s+(?:\s*(.*))?",
    re.S,
)
SECTION_MARK_ARTICLE = re.compile(r"§\s*Article\s+(\d+)\.\s*(.*)", re.S)
# Rare pages omit the period before body text (§9–1602).
SECTION_MARK_NO_TRAILING_DOT = re.compile(
    r"§\s*([0-9][0-9A-Za-z" + _DASH_CLASS + r"\-]+)\s+(.*)",
    re.S,
)
STATUS = re.compile(
    r"^(Reserved|Repealed|Renumbered|Transferred|Expired|Omitted|Vacant|Deleted|"
    r"Not in effect|Superseded)\b",
    re.I,
)
_BODY_START = re.compile(r"^\([a-zA-Z0-9]")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_section_number(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    for dash in DASHES:
        text = text.replace(dash, "-")
    return text.strip()


def article_heading_from_display(article_display: str) -> str:
    display = (article_display or "").strip()
    if " - (" in display and display.endswith(")"):
        return display.split(" - (", 1)[0].strip()
    return display


def citation_path(article_code: str, section_display: str) -> str:
    return "%s %s" % (article_code.lower(), normalize_section_number(section_display))


def statute_url(article_code: str, section_display: str, enactments: str = ENACTMENTS) -> str:
    from urllib.parse import quote

    return "%s/Laws/StatuteText?article=%s&section=%s&enactments=%s" % (
        BASE,
        quote(article_code),
        quote(section_display, safe=""),
        enactments,
    )


def clean_lines(text: str) -> str:
    lines = []
    for raw in text.splitlines():
        line = htmllib.unescape(raw).replace("\xa0", " ").strip()
        if line in ("Previous", "Next"):
            continue
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def _opening_section_chunk(body: str) -> str:
    """Publisher puts the section marker on the first § line; later § tokens are cross-references."""
    lines = body.splitlines()
    for index, line in enumerate(lines):
        if line.strip().startswith("§"):
            return "\n".join(lines[index:])
    raise ValueError("no section marker in StatuteText")


def _match_section_marker(body: str) -> tuple[str, str, str]:
    """Return (section_number, remainder, inline_heading_after_marker)."""
    opening = _opening_section_chunk(body)
    for pattern in (SECTION_MARK_DECIMAL, SECTION_MARK_ARTICLE):
        match = pattern.search(opening)
        if not match or match.start() > 2:
            continue
        if pattern is SECTION_MARK_ARTICLE:
            return (
                normalize_section_number(match.group(1)),
                (match.group(2) or "").strip(),
                "",
            )
        section_number = normalize_section_number(match.group(1))
        remainder = (match.group(2) or "").strip()
        if not remainder:
            remainder = opening[match.end() :].strip()
        return section_number, remainder, ""
    match = SECTION_MARK.search(opening)
    if match and match.start() <= 2:
        section_number = normalize_section_number(match.group(1))
        inline_heading = (match.group(2) or "").strip()
        remainder = opening[match.end() :].strip()
        if inline_heading and _BODY_START.match(inline_heading):
            remainder = (inline_heading + "\n" + remainder).strip() if remainder else inline_heading
            inline_heading = ""
        return section_number, remainder, inline_heading
    match = SECTION_MARK_NO_TRAILING_DOT.search(opening)
    if match and match.start() <= 2:
        section_number = normalize_section_number(match.group(1))
        remainder = (match.group(2) or "").strip()
        if not remainder:
            remainder = opening[match.end() :].strip()
        return section_number, remainder, ""
    raise ValueError("no section marker in StatuteText")


def parse_statute_html(html: str) -> dict:
    """Return article_heading, section_number, heading, text, status_note from StatuteText HTML."""
    soup = BeautifulSoup(html, "lxml")
    node = soup.find(id="StatuteText")
    if node is None:
        raise ValueError("no StatuteText")
    for tag in node.select("button, .btn-group, .row"):
        tag.decompose()
    article_heading = None
    for center in node.find_all("div", style=re.compile(r"text-align:\s*center", re.I)):
        bold = center.find("span", style=re.compile(r"font-weight:\s*bold", re.I))
        if bold:
            article_heading = clean_lines(bold.get_text(" "))
            center.decompose()
            break
    for br in node.find_all("br"):
        br.replace_with("\n")
    body = clean_lines(node.get_text("\n"))
    section_number, remainder, inline_heading = _match_section_marker(body)
    if inline_heading and not _BODY_START.match(inline_heading) and not remainder.startswith("("):
        heading = inline_heading
        text = remainder
    else:
        heading = ""
        text = (inline_heading + "\n" + remainder).strip() if inline_heading else remainder
    text = clean_lines(text)
    status_note = None
    if not text and heading:
        text = heading
        status_note = heading
    elif STATUS.match(text):
        status_note = text.split("\n", 1)[0]
    return {
        "article_heading": article_heading,
        "section_number": section_number,
        "heading": heading,
        "text": text,
        "status_note": status_note,
    }
