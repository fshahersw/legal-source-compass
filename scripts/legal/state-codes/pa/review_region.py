"""Pennsylvania title-page live regions for the shared reviewer.

palegis.us serves one HTML document per title. The reverse check must compare only the sampled
section's body (from its section-start marker through the line before the next section-start marker),
not neighboring sections on the same page. Cross-reference, amendment, and effective-date notes are
publisher annotations and are not section body text.
"""
import re

from parse import parse_title

_ANCHOR = re.compile(r"^\d{2}c[0-9A-Za-z.]+[svh]$")
_CROSS_REF = re.compile(r"(?i)^cross references?\.")
_EFFECTIVE = re.compile(r"(?i)^effective date\.")
_AMENDMENT = re.compile(r"(?i)^\d{4}\s+amendment\.")
_ENACTMENT = re.compile(r"^\([A-Z][a-z]{2}\. \d{1,2}, \d{4}")


def citation_parts(citation_path: str) -> tuple[str, str]:
    title, number = citation_path.split(":", 1)
    return title.zfill(2), number


def section_body_lines(document: str, citation_path: str) -> list[str] | None:
    """Printed body lines for one section (same slice the parser stores as text), or None if not found."""
    ttl, number = citation_parts(citation_path)
    parsed = parse_title(document, ttl)
    for sec in parsed["sections"]:
        if sec["number"] == number:
            return parsed["lines"][sec["first"] : sec["last"]]
    return None


def is_publisher_annotation_line(line: str) -> bool:
    """Notes the parser keeps out of section text, or palegis anchor tokens when they appear as lines."""
    s = line.strip()
    if not s:
        return True
    compact = re.sub(r"\s+", "", s)
    if _ANCHOR.match(compact):
        return True
    if _CROSS_REF.match(s) or _EFFECTIVE.match(s) or _AMENDMENT.match(s) or _ENACTMENT.match(s):
        return True
    if re.match(r"(?i)^see section \d+ of act \d+", s):
        return True
    return False
