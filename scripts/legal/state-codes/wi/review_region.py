"""Wisconsin chapter .txt live section rows for the shared reviewer."""
import os
import re
import sys


def section_row_from_chapter_text(
    txt_bytes: bytes,
    url: str,
    citation_path: str,
    section=None,
) -> dict | None:
    if "docs.legis.wisconsin.gov" not in (url or "") or not (url or "").endswith(".txt"):
        return None
    wi_dir = os.path.dirname(os.path.abspath(__file__))
    if wi_dir not in sys.path:
        sys.path.insert(0, wi_dir)
    import wi_parse  # noqa: WPS433

    chapter = url.rsplit("/", 1)[-1].replace(".txt", "")
    if not re.match(r"^[0-9]+[A-Za-z]*$", chapter):
        return None
    content = txt_bytes.decode("utf-8", errors="replace")
    txt_toc = wi_parse.inventory_from_txt_toc_region(content, chapter)
    try:
        import urllib.request
        from bs4 import BeautifulSoup

        html = urllib.request.urlopen(
            f"{wi_parse.BASE}/statutes/statutes/{chapter}", timeout=120
        ).read()
        html_toc, _ = wi_parse.chapter_toc(BeautifulSoup(html, "lxml"))
        toc_sections = (
            wi_parse.merge_toc_sections(html_toc, txt_toc)
            if len(txt_toc) > len(html_toc)
            else html_toc
        )
    except OSError:
        toc_sections = txt_toc
    rows, _, _ = wi_parse.parse_chapter_text(
        content,
        chapter,
        {"heading": chapter, "subject": None},
        toc_sections,
        [],
        "live",
        {"statement": "", "as_of": None},
        {"url": url, "sha256": "review-live"},
    )
    cite = (citation_path or "").split(":occurrence:", 1)[0]
    for row in rows:
        if row["citation"] == cite or row["native_id"].split(":occurrence:", 1)[0] == cite:
            return {
                "text": row.get("text") or "",
                "heading": row.get("heading"),
                "history": row.get("history"),
                "status_label": row.get("status_label"),
                "number": cite,
                "effective": row.get("effective"),
            }
    return None
