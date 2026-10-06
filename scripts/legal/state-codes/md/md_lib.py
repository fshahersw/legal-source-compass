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
SECTION_MARK = re.compile(
    r"§\s*([0-9][0-9A-Za-z." + "".join(DASHES) + r"\-]*)\s*\.(?:\s*(.*))?",
    re.S,
)
STATUS = re.compile(
    r"^(Reserved|Repealed|Renumbered|Transferred|Expired|Omitted|Vacant|Deleted|"
    r"Not in effect|Superseded)\b",
    re.I,
)


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
    match = SECTION_MARK.search(body)
    if not match:
        raise ValueError("no section marker in StatuteText")
    section_number = normalize_section_number(match.group(1))
    remainder = body[match.end() :].strip()
    inline_heading = (match.group(2) or "").strip()
    if inline_heading and not remainder.startswith("("):
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
