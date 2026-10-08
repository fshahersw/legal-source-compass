"""Michigan Compiled Laws live section rows for the shared reviewer (one chapter XML file)."""
from parse import parse_chapter


def section_row_from_chapter(xml_bytes: bytes, citation_path: str) -> dict | None:
    """Return {text, heading, history} for one MCL section in a chapter file."""
    chapter = parse_chapter(xml_bytes)
    want = (citation_path or "").strip()
    for sec in chapter["sections"]:
        if sec["mcl"] == want:
            return {
                "number": sec["mcl"],
                "text": sec["text"] or "",
                "heading": sec.get("heading"),
                "history": sec.get("history"),
                "status_label": sec.get("status_note") if sec.get("text_from_catchline") else None,
            }
    return None
