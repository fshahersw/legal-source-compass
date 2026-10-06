"""Shared Oregon Revised Statutes publisher helpers (official legislature HTML)."""
from __future__ import annotations

import html as html_lib
import re

BASE = "https://www.oregonlegislature.gov"
INDEX_URL = BASE + "/bills_laws/Pages/ORS.aspx?FollowSite=0"
ORS_BASE = BASE + "/bills_laws/ors/"

CODE_ID = "or-ors"
CODE_NAME = "Oregon Revised Statutes"
EDITION = "2025 Oregon Revised Statutes"
PARSER_NAME = "or-legislature-chapter-html"
PARSER_VERSION = "1"
SECTION_ID_REGEX = (
    r"^[0-9]+[A-Z]?(?:\.[0-9]+[A-Z]?)+"
    r"(?:\:occurrence\:[2-9][0-9]*)?$"
)

NAMED_ENTITIES = {
    "amp": "&",
    "apos": "'",
    "gt": ">",
    "lt": "<",
    "nbsp": " ",
    "quot": '"',
    "mdash": "—",
    "ndash": "–",
    "rsquo": "’",
    "lsquo": "‘",
    "rdquo": "”",
    "ldquo": "“",
    "sect": "§",
    "para": "¶",
}


def entity_decode(text: str) -> str:
    def replace_entity(match: re.Match[str]) -> str:
        whole, entity = match.group(0), match.group(1)
        if entity.startswith("#"):
            numeric = (
                int(entity[2:], 16)
                if entity[1].lower() == "x"
                else int(entity[1:], 10)
            )
            if 0 < numeric <= 0x10FFFF:
                return chr(numeric)
            return whole
        return NAMED_ENTITIES.get(entity.lower(), whole)

    return re.sub(r"&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);", replace_entity, text, flags=re.I)


def detect_encoding(raw: bytes) -> str:
    latin = raw.decode("latin1")
    charset = re.search(
        r'<meta\b[^>]*charset\s*=\s*["\']?([^"\'\s;>]+)',
        latin,
        re.I,
    )
    value = (charset.group(1) if charset else "").lower()
    if value in ("windows-1252", "cp1252"):
        return "windows-1252"
    if value in ("utf-8", "utf8"):
        return "utf-8"
    raise ValueError(f"Unsupported or missing publisher charset: {value or 'none'}")


def html_text(fragment: str, encoding: str) -> str:
    decoded = fragment.encode("latin1").decode(encoding)
    decoded = entity_decode(decoded)
    decoded = re.sub(r"<\s*br\s*/?>", "\n", decoded, flags=re.I)
    decoded = re.sub(r"</(?:p|div|li|tr|h[1-6])\s*>", "\n", decoded, flags=re.I)
    decoded = re.sub(r"<[^>]*>", "", decoded)
    decoded = re.sub(r"[\t\f\v ]+", " ", decoded)
    decoded = decoded.replace("\r", "")
    decoded = re.sub(r"\n[\t ]*", "\n", decoded)
    return decoded.strip()


def chapter_url(chapter_id: str) -> str:
    match = re.fullmatch(r"(\d+)([A-Za-z]*)", str(chapter_id))
    if not match:
        raise ValueError(f"invalid chapter id: {chapter_id!r}")
    number, suffix = match.groups()
    return f"{ORS_BASE}ors{int(number):03d}{suffix.lower()}.html"


def parse_index_groups(index_html: str) -> list[dict]:
    """Parse the 60 official ORS index title rows (chapter ranges and counts)."""
    groups: list[dict] = []
    pattern = re.compile(
        r"Title Number\s*</a>\s*:\s*([0-9]+[A-Z]?)\.([\s\S]*?)</tr>",
        re.I,
    )
    for match in pattern.finditer(index_html):
        title_number = match.group(1).upper()
        plain = match.group(2)
        plain = re.sub(r"<[^>]*>", " ", plain)
        plain = (
            plain.replace("&nbsp;", " ")
            .replace("&#8206;", " ")
            .replace("&amp;", "&")
        )
        plain = re.sub(r"\s+", " ", plain).strip()
        range_match = re.search(
            r"(.+?)\s*-\s*Chapters\s+([0-9]+[A-Z]?)\s*-\s*([0-9]+[A-Z]?)"
            r"[\s\S]*?\((\d+)\)",
            plain,
            re.I,
        )
        if range_match:
            name, start, end, count = range_match.groups()
        else:
            single = re.search(
                r"(.+?)\s*-\s*Chapter\s+([0-9]+[A-Z]?)[\s\S]*?\((\d+)\)",
                plain,
                re.I,
            )
            if not single:
                raise ValueError(f"Unparsed publisher index group {title_number}: {plain}")
            name, start, count = single.group(1), single.group(2), single.group(3)
            end = start
        groups.append(
            {
                "title_number": title_number,
                "title_name": name.strip(),
                "chapter_start": start.upper(),
                "chapter_end": end.upper(),
                "index_document_count": int(count),
                "index_label": plain,
            }
        )
    return groups


def chapter_sort_key(chapter_id: str) -> tuple:
    match = re.fullmatch(r"(\d+)([A-Z]*)", chapter_id, re.I)
    if not match:
        return (1, chapter_id)
    return (0, int(match.group(1)), match.group(2).upper())


def numeric_chapter_ids(start: str, end: str) -> list[str]:
    start_match = re.fullmatch(r"(\d+)([A-Z]*)", start, re.I)
    end_match = re.fullmatch(r"(\d+)([A-Z]*)", end, re.I)
    if not start_match or not end_match:
        raise ValueError(f"invalid chapter range: {start}-{end}")
    first, last = int(start_match.group(1)), int(end_match.group(1))
    return [str(value) for value in range(first, last + 1)]


def chapter_num_key(chapter_id: str) -> tuple[int, str]:
    match = re.fullmatch(r"(\d+)([A-Z]*)", str(chapter_id), re.I)
    if not match:
        raise ValueError(chapter_id)
    return int(match.group(1)), match.group(2).upper()


def title_group_for_chapter(groups: list[dict], chapter_id: str) -> dict:
    number, suffix = chapter_num_key(chapter_id)
    matches = []
    for group in groups:
        start_n, start_s = chapter_num_key(group["chapter_start"])
        end_n, end_s = chapter_num_key(group["chapter_end"])
        if (start_n, start_s) <= (number, suffix) <= (end_n, end_s):
            matches.append(group)
    if len(matches) != 1:
        raise ValueError(f"chapter {chapter_id} maps to {len(matches)} index groups")
    return matches[0]
