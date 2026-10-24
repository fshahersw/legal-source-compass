"""Kentucky — Legislative Research Commission, Kentucky Revised Statutes (apps.legislature.ky.gov), state-law/1.

The KRS index (/law/statutes/) lists titles and chapters (chapter.aspx?id=N); each chapter page lists its sections
(statute.aspx?id=N), and each section is a one-section PDF: "413.140 Actions to be brought within one year.", the
text (hanging-indent subsections), "Effective:" and "History:" lines, then Legislative Research Commission notes
(annotations, dropped). Text comes from `pdftotext -layout` (the canonical rendering every quote is checked against);
a paragraph starts at a subsection label or a line not indented beyond the paragraph's first line, otherwise the
publisher's wrapped line continues it. No robots.txt on the host (404); 1 request/second. The index prints
"Includes enactments through the <session>" and "The KRS database was last updated on <date>" (currency, verbatim).
Retained mode re-parses the statute PDFs this project captured on 2026-10-06 (index/chapter pages are read fresh).
"""
from __future__ import annotations

import datetime as dt
import html as _html
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

HOST = "apps.legislature.ky.gov"
BASE = f"https://{HOST}/law/statutes/"

META = lib.StateMeta(
    state="KY",
    code_name="Kentucky Revised Statutes",
    publisher="Kentucky General Assembly — Legislative Research Commission (legislature.ky.gov)",
    publisher_url=BASE,
    official_source=True,
    access="pdf",
    hosts=(HOST,),
    parser="ky-lrc-krs-pdf/1",
    min_interval_s=1.0,
    codes=(lib.Code("KRS", "Kentucky Revised Statutes", "Ky. Rev. Stat. Ann. § {n}",
                    lib.alias_patterns(["Ky. Rev. Stat. Ann.", "Ky. Rev. Stat.", "KRS", "K.R.S.",
                                        "Kentucky Revised Statutes"])),),
    terms_note=("KRS published by the Legislative Research Commission; the index states that chapter titles, "
                "centered headings, catchlines and explanatory notes are informational and not part of the law. "
                "Commission notes are not kept."),
    update_cadence="After each session (database 'last updated' date printed on the index); re-check monthly.",
)

MARKER_RE = re.compile(r"^\((?:\d{1,3}|[a-z]{1,3}|[ivxlc]{1,6}|[A-Z])\)")
HEAD_RE = re.compile(r"^(\d+[A-Z]?\.\d+[0-9A-Za-z]*)\s+(.*)$")
EFFECTIVE_RE = re.compile(r"^Effective:\s*(.+)$")
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
DATE_RE = re.compile(rf"({MONTHS})\s+(\d{{1,2}}),\s+(\d{{4}})")
NOTE_RE = re.compile(r"^(?:Legislative Research Commission Note|Catchline at repeal|Formerly codified as|Note:)", re.I)


def _date(text: str) -> dt.date | None:
    m = DATE_RE.search(text)
    if not m:
        return None
    return dt.date(int(m.group(3)), MONTHS.split("|").index(m.group(1)) + 1, int(m.group(2)))


def parse_pdf(body: bytes) -> dict:
    lines = [l for l in lib.pdf_layout_lines(body)]
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        raise RuntimeError("empty KRS PDF")
    head = HEAD_RE.match(lines[0].strip())
    if not head:
        raise RuntimeError(f"no section line: {lines[0][:80]!r}")
    number, heading = head.group(1), lib.norm_ws(head.group(2))
    rest = lines[1:]
    # a catchline that wraps continues until it ends with a period (the publisher ends every catchline with one)
    while heading and not heading.endswith(".") and rest and rest[0].strip() and not MARKER_RE.match(rest[0].strip()):
        heading = lib.norm_ws(heading + " " + rest.pop(0).strip())
    paragraphs: list[str] = []
    start_indent = None
    effective_line = None
    history: list[str] = []
    mode = "text"
    for raw in rest:
        stripped = raw.strip()
        if not stripped:
            if mode == "text":
                start_indent = None
            continue
        if mode != "notes" and NOTE_RE.match(stripped):
            mode = "notes"
            continue
        if mode == "notes":
            continue
        eff = EFFECTIVE_RE.match(stripped)
        if mode == "text" and eff:
            effective_line = stripped
            mode = "meta"
            continue
        if stripped.startswith("History:"):
            mode = "history"
            history.append(stripped)
            continue
        if mode == "history":
            history.append(stripped)
            continue
        if mode == "meta":
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        ends_sentence = bool(paragraphs) and paragraphs[-1].rstrip().endswith((".", ":", ";"))
        if start_indent is None or MARKER_RE.match(stripped) or (indent <= start_indent and ends_sentence):
            paragraphs.append(stripped)
            start_indent = indent
        else:
            paragraphs[-1] = paragraphs[-1] + " " + stripped
    return {"number": number, "heading": heading, "text": "\n".join(lib.norm_ws(p) for p in paragraphs),
            "history": lib.norm_ws(" ".join(history)) or None, "effective_line": effective_line}


def index_structure(page: lib.Fetched) -> tuple[list[tuple[str, str | None, str | None, str]], str | None]:
    """[(chapter number, chapter heading, title label, chapter URL)] in printed order, and the currency statement."""
    text = page.text()
    out = []
    title = None
    for m in re.finditer(r'(TITLE\s+[IVXL]+[^<]{0,120})|href="(chapter\.aspx\?id=\d+)"[^>]*>(.*?)</a>', text, re.S):
        if m.group(1):
            title = lib.norm_ws(m.group(1))
            continue
        label = lib.norm_ws(_html.unescape(re.sub(r"<[^>]+>", " ", m.group(3))))
        cm = re.match(r"^CHAPTER\s+(\S+)\s*(.*)$", label)
        if cm:
            out.append((cm.group(1), cm.group(2) or None, title, BASE + m.group(2)))
    flat = lib.html_text(page.body)
    through = re.search(r"Includes enactments through[^\n]*", flat)
    updated = re.search(r"The KRS database was last updated on[^\n]*", flat)
    statement = "\n".join(x.group(0) for x in (through, updated) if x) or None
    return out, statement


def acquire(ctx: lib.RunContext) -> None:
    index = ctx.fetch(BASE)
    chapters, statement = index_structure(index)
    if len(chapters) < 500:
        raise RuntimeError(f"KRS index lists {len(chapters)} chapters")
    ctx.edition(edition_label=None, currency_statement=statement, currency_source_url=BASE)
    if ctx.sample is not None:
        chapters = [c for c in chapters if c[0] == "413"]
    for number, heading, title, url in chapters:
        if not ctx.want_more():
            break
        page = ctx.fetch(url)
        links = re.findall(r'href="(statute\.aspx\?id=\d+)"', page.text())
        title_match = re.match(r"^TITLE\s+([IVXL]+)\s*(.*)$", title or "")
        path = []
        if title_match:
            path.append({"level": "title", "label": "Title", "number": title_match.group(1), "heading": title_match.group(2) or None})
        path.append({"level": "chapter", "label": "Chapter", "number": number, "heading": heading})
        ctx.prefetch(BASE + link for link in dict.fromkeys(links))  # retained runs: download the chapter's PDFs ahead
        for link in dict.fromkeys(links):
            if not ctx.want_more():
                break
            pdf = ctx.get(BASE + link, fallback_fresh=True)
            if not pdf.body.startswith(b"%PDF"):
                raise RuntimeError(f"{pdf.url} is not a PDF")
            parsed = parse_pdf(pdf.body)
            status = marker = None
            effective = None
            when = _date(parsed["effective_line"] or "")
            if when:
                effective = {"start": when.isoformat(), "end": None, "note": parsed["effective_line"]}
                if when > ctx.today:
                    status, marker = "future_effective", parsed["effective_line"]
            ctx.section(code="KRS", number=parsed["number"], heading=parsed["heading"], text=parsed["text"],
                        history=parsed["history"], source=pdf, path=path, status=status, status_marker=marker,
                        effective=effective)
