"""Shared Alabama Code (ALISON API) publisher helpers."""
from __future__ import annotations

import html as html_lib
import re

BASE = "https://alison.legislature.state.al.us"
API = BASE + "/api/code-of-alabama"
LANDING = BASE + "/code-of-alabama"

CODE_ID = "al-code-of-alabama"
CODE_NAME = "Code of Alabama"
EDITION = "Code of Alabama (ALISON)"
PARSER_NAME = "al-alison-api"
PARSER_VERSION = "1"
SECTION_ID_REGEX = (
    r"^[0-9]+[A-Z]?-[0-9]+[A-Z]?-[0-9]+[A-Z0-9.-]*"
    r"(?:\:occurrence\:[2-9][0-9]*)?$"
)
API_URL_PATTERN = (
    r"^https://alison\.legislature\.state\.al\.us/api/code-of-alabama(?:\?page=\d+)?$"
)

STATUS_ONLY_RE = re.compile(
    r"^(?:"
    r"repealed\b.*|"
    r"this section (?:was )?repealed\b.*|"
    r"repealed by\b.*|"
    r"repealed in\b.*|"
    r"all provisions of title\b.*|"
    r"reserved\.?$"
    r")",
    re.I | re.S,
)


def html_to_text(fragment: str | None) -> str:
    if not fragment:
        return ""
    text = html_lib.unescape(fragment)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def section_heading(title: str | None, display_id: str) -> str | None:
    if not title:
        return None
    cleaned = html_lib.unescape(title).strip()
    prefix = f"Section {display_id} "
    if cleaned.startswith(prefix):
        cleaned = cleaned[len(prefix) :].strip()
    elif cleaned.upper().startswith("REPEALED "):
        cleaned = cleaned[9:].strip()
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix) :].strip()
    return cleaned or None


def status_note_for(content_html: str | None, title: str | None) -> str | None:
    text = html_to_text(content_html)
    if not text:
        title_upper = (title or "").upper()
        if "REPEALED" in title_upper:
            return "repealed_empty"
        if "RESERVED" in title_upper:
            return "reserved_empty"
        return "empty"
    if STATUS_ONLY_RE.match(text):
        lower = text.lower()
        if "repeal" in lower:
            return "repealed"
        if lower.strip() == "reserved." or lower.strip() == "reserved":
            return "reserved"
        return "status_only"
    return None


def title_catchline(node: dict | None) -> str | None:
    if not node:
        return None
    return (node.get("catchLine") or node.get("shortTitle") or node.get("title") or "").strip() or None
