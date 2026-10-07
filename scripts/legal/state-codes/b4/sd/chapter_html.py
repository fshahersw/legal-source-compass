"""Extract section inventory fields from SD Legislature chapter Statute JSON (Html bundle)."""
import re

SECTION_LINK_RE = re.compile(
    r"Statutes/Codified_Laws/DisplayStatute\.aspx\?Type=Statute&amp;Statute=([0-9]+-[0-9]+-[0-9][0-9.]*)(?:\"|&)"
)
CATCHLINE_RE = re.compile(
    r'DisplayStatute\.aspx\?[^"]*Statute=([^"&]+)"[^>]*><span[^>]*>[^<]*</span></a>'
    r'<span[^>]*>\.\s*</span><span class="[^"]*CL[^"]*">([^<]*)</span>',
    re.I,
)
CHAPTER_SECTION_SPLIT = re.compile(
    r'(?=<p[^>]*><a href="https://sdlegislature.gov/Statutes/Codified_Laws/DisplayStatute\.aspx\?Type=Statute&amp;Statute=)'
)


def section_citations_from_html(html: str) -> list[str]:
    if not html:
        return []
    seen = set()
    out = []
    for m in SECTION_LINK_RE.finditer(html):
        cit = m.group(1)
        if cit not in seen:
            seen.add(cit)
            out.append(cit)
    return out


def catchlines_from_html(html: str) -> dict[str, str]:
    return {m.group(1): (m.group(2).strip() or None) for m in CATCHLINE_RE.finditer(html or "")}


def section_html_fragments(html: str) -> dict[str, str]:
    """Map section citation -> HTML fragment (same shape as a single-section Statute payload field)."""
    if not html:
        return {}
    parts = CHAPTER_SECTION_SPLIT.split(html)
    out = {}
    for part in parts[1:]:
        m = SECTION_LINK_RE.search(part)
        if not m:
            continue
        cit = m.group(1)
        if cit not in out:
            out[cit] = part
    return out


def title_chapter_from_citation(citation: str) -> tuple[int | None, int | None]:
    bits = citation.split("-")
    if len(bits) < 2:
        return None, None
    try:
        return int(bits[0]), int(bits[1].split(".")[0])
    except ValueError:
        return None, None
