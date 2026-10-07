"""Extract section statute text printed on the official ND chapter HTML page (when present)."""

import re

from sc_common import collapse, html_text  # noqa: E402

from citation import canon_citation  # noqa: E402

TOC_ROW_CELL = re.compile(
    r"<tr>\s*<td[^>]*>\s*<a\s+href=\"[^\"]*#nameddest=[^\"]*\">([^<]+)</a>\s*</td>\s*"
    r"<td[^>]*>(.*?)</td>",
    re.S | re.I,
)
INLINE_SECTION = re.compile(
    r"<(?:p|div)[^>]*>\s*(\d{1,2}-\d{2}-\d{2}(?:\.\d+)?)\.\s+(.+?)\s*</(?:p|div)>",
    re.S | re.I,
)


def _body_after_heading(cell_html: str, heading: str | None) -> str | None:
    text = collapse(html_text(cell_html))
    if not text:
        return None
    if heading:
        h = collapse(heading)
        if text == h:
            return None
        if text.startswith(h):
            rest = text[len(h) :].strip(" -–—:\u00a0")
            if len(rest) < 20:
                return None
            return rest
    if len(text) < 25:
        return None
    return text


def section_bodies_from_chapter_html(html: str, toc_rows: list[dict]) -> dict[str, str]:
    """Map canonical citation -> printed body text from the chapter HTML (TOC cells or inline blocks)."""
    heading_by = {canon_citation(r["citation"]): r.get("heading") for r in toc_rows}
    bodies: dict[str, str] = {}
    for cit, cell in TOC_ROW_CELL.findall(html):
        cit = collapse(cit)
        key = canon_citation(cit)
        rest = _body_after_heading(cell, heading_by.get(key))
        if rest:
            bodies[key] = f"{cit}. {rest}"
    for cit, rest in INLINE_SECTION.findall(html):
        cit = collapse(cit)
        key = canon_citation(cit)
        if key in bodies:
            continue
        block = collapse(html_text(rest))
        if len(block) >= 20:
            bodies[key] = f"{cit}. {block}"
    return bodies
