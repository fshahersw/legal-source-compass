"""Colorado CRS / Constitution title HTML: one section row for the shared reviewer."""
import os
import sys


def section_row_from_title_html(
    html_bytes: bytes,
    url: str,
    citation_path: str,
    section=None,
) -> dict | None:
    """Re-parse one section from an olls.info title HTM file (CRS or constitution)."""
    if "olls.info/crs" not in (url or ""):
        return None
    co_dir = os.path.dirname(os.path.abspath(__file__))
    if co_dir not in sys.path:
        sys.path.insert(0, co_dir)
    from co_parse import (  # noqa: WPS433
        decode_html,
        parse_constitution_title,
        parse_crs_title,
        title_number_from_name,
    )

    member = url.rsplit("/", 1)[-1]
    try:
        title_number = title_number_from_name(member)
    except ValueError:
        return None
    raw = html_bytes if isinstance(html_bytes, bytes) else html_bytes.encode("utf-8", "replace")
    raw_html = decode_html(raw)
    receipt = {"url": url, "sha256": "review-live", "ok": True, "label": "crs-download"}
    if title_number == "0":
        rows, *_ = parse_constitution_title(raw_html, receipt)
    else:
        rows, *_ = parse_crs_title(raw_html, receipt, title_number)

    want = (citation_path or "").split("#", 1)[0]
    want_base = want.split(":occurrence:", 1)[0]
    for row in rows:
        native_id = row["native_id"]
        base = native_id.split(":occurrence:", 1)[0]
        citation = row.get("citation") or base
        if native_id == want or base == want_base or citation == want_base:
            hier_num = None
            if section:
                hier_num = ((section.get("hierarchy") or [{}])[-1] or {}).get("number")
            return {
                "text": row.get("text") or "",
                "heading": row.get("heading"),
                "history": row.get("history"),
                "status_label": row.get("status_label"),
                "number": hier_num or base,
            }
    return None
