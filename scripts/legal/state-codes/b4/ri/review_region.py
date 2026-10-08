"""Rhode Island section-page HTML: one section row for the shared reviewer."""
import os
import sys


def section_row_from_html(
    html_bytes: bytes,
    url: str,
    citation_path: str,
    section=None,
) -> dict | None:
    """Re-parse one RI Gen. Laws section page with the same parser as landing."""
    if "rilegislature.gov" not in (url or ""):
        return None
    ri_dir = os.path.dirname(os.path.abspath(__file__))
    if ri_dir not in sys.path:
        sys.path.insert(0, ri_dir)
    from parse import parse_section_html  # noqa: WPS433

    cite = (citation_path or "").split("#", 1)[0]
    if ":" in cite:
        cite = cite.split(":", 1)[-1]
    meta = {
        "citation_number": cite,
        "toc_label": (section or {}).get("heading") or (section or {}).get("citation"),
    }
    parsed = parse_section_html(html_bytes, meta)
    if not (parsed.get("text") or parsed.get("heading") or parsed.get("status_label")):
        return None
    return {
        "text": parsed.get("text") or "",
        "heading": parsed.get("heading"),
        "history": parsed.get("history"),
        "status_label": parsed.get("status_label"),
        "number": cite,
    }
