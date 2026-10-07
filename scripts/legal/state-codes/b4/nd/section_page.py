"""Official ND section HTML pages (chapter TOC links use PDF; HTML uses ?section=)."""

import re
import urllib.parse

from sc_common import collapse, html_text  # noqa: E402

from citation import canon_citation  # noqa: E402

BASE = "https://ndlegis.gov/cencode/"

SECTION_QUERY = re.compile(r"[?&]section=([^&#]+)", re.I)
INLINE_SECTION = re.compile(
    r"<(?:p|div)[^>]*>\s*(\d{1,2}-\d{2}-\d{1,4}(?:\.\d+)?)\.[ \t]+(.+?)\s*</(?:p|div)>",
    re.S | re.I,
)


def official_section_html_url(chapter_slug: str, citation: str) -> str:
    return BASE + chapter_slug + "?" + urllib.parse.urlencode({"section": citation})


def official_section_pdf_fragment(chapter_slug: str, citation: str) -> str:
    return BASE + chapter_slug.replace(".html", ".pdf") + "#nameddest=" + citation


def body_from_section_html_page(html: str, citation: str) -> str | None:
    """Return printed section body when the section HTML page includes it (not TOC-only)."""
    key = canon_citation(citation)
    for m in INLINE_SECTION.finditer(html):
        if canon_citation(collapse(m.group(1))) != key:
            continue
        block = collapse(html_text(m.group(0)))
        if len(block) > len(citation) + 10:
            return block
    return None


def section_from_query_url(url: str) -> str | None:
    m = SECTION_QUERY.search(url)
    return m.group(1) if m else None
