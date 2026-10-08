"""Indiana Code live section rows for the shared reviewer (one title HTML member inside the official ZIP)."""
from parse import EFFECTIVE_NOTE_RE, EFFECTIVE_RE, parse_member


def section_row_from_member(html_bytes: bytes, member: str, citation_path: str, section=None) -> dict | None:
    """Return {text, heading, history} for one section, matching the landing parser."""
    parsed = parse_member(html_bytes, member, "review-live")
    want = (citation_path or "").split("#", 1)[0]
    for row in parsed["sections"]:
        native = row["native_id"].split("#", 1)[0]
        if native == want:
            hier_num = ((section or {}).get("hierarchy") or [{}])[-1].get("number") if section else None
            return {
                "text": row["text"] or "",
                "heading": row.get("heading"),
                "history": row.get("history"),
                "status_label": row.get("status_label"),
                "number": hier_num or native,
            }
    return None


def is_publisher_annotation_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return True
    if EFFECTIVE_RE.search(s):
        return True
    if EFFECTIVE_NOTE_RE.match(s):
        return True
    return False
