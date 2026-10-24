"""Maine — Office of the Revisor of Statutes, Maine Revised Statutes (legislature.maine.gov/statutes), state-law/1.

/statutes/ prints "This version of the Maine Revised Statutes reflects changes made through the <session>, is current
through <date>, and is subject to change without notice." (kept verbatim; the date is currency_through) and lists the
titles (14/title14ch0sec0.html); a title page lists its chapters (title14ch205sec0.html), a chapter page its sections
(title14sec752-C.html). A section page prints the hierarchy (div.MRSTitle / MRSPart / MRSChapter / MRSSubChapter /
MRSArticle "Chapter 205: LIMITATION OF ACTIONS") and div.MRSSection (class status_current …) with h3.heading_section
"§752-C. Sexual acts towards minors", the text in div.mrs-text blocks (subsection/paragraph labels inline), bracketed
history after each unit (span.bhistory "[PL 1999, c. 639, §1 (NEW).]") and the SECTION HISTORY list (div.qhistory);
both are kept as history. A status note prints as div.headnote_blip ("(REPEALED)", "(WHOLE SECTION TEXT EFFECTIVE
7/1/27)" …). Sections are numbered within a title: number = "<title>:<section>" ("14:752-C"). robots.txt disallows
only bill search and LawMakerWeb paths; 1 request/second. Retained mode re-parses the section pages this project
captured on 2026-10-06..12 (pages state "Data for this page extracted on 10/05/2026").
"""
from __future__ import annotations

import datetime as dt
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "legislature.maine.gov"
BASE = f"https://{HOST}/statutes/"

META = lib.StateMeta(
    state="ME",
    code_name="Maine Revised Statutes",
    publisher="Maine Legislature — Office of the Revisor of Statutes (legislature.maine.gov)",
    publisher_url=BASE,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="me-revisor-mrs/1",
    min_interval_s=1.0,
    codes=(lib.Code("MRS", "Maine Revised Statutes", "Me. Rev. Stat. tit. {t}, § {s}", (
        lib.Pattern(r"(?:me\.?\s?rev\.?\s?stat\.?\s?(?:ann\.?\s?)?,?\s?)?tit\.?\s?([0-9]+(?:-[a-z])?),?\s?§\s?([0-9][0-9a-z.\-]*)",
                    r"\1:\2"),
        lib.Pattern(r"([0-9]+(?:-[a-z])?)\s?m\.?\s?r\.?\s?s\.?\s?a?\.?\s?(?:§\s?)?([0-9][0-9a-z.\-]*)", r"\1:\2"),
    )),),
    terms_note="Maine Revised Statutes as published by the Revisor; the site's currency sentence is kept verbatim.",
    update_cadence="After each session (statement names the session and a current-through date); re-check quarterly.",
)

LEVEL = {"MRSTitle": "title", "MRSPart": "part", "MRSChapter": "chapter", "MRSSubChapter": "subchapter",
         "MRSArticle": "article", "MRSSubPart": "subpart", "MRSSubArticle": "subarticle"}
STRUCT_RE = re.compile(r"^(Title|Part|Chapter|Subchapter|Article|Subpart|Subarticle)\s+([0-9A-Za-z.\-]+):\s*(.*)$")
HEAD_RE = re.compile(r"^§\s*([0-9][0-9A-Za-z.\-]*)\.\s*(.*)$")
EFFECTIVE_RE = re.compile(r"EFFECTIVE\s+(\d{1,2})/(\d{1,2})/(\d{2,4})")


def _date(m: re.Match) -> dt.date:
    year = int(m.group(3))
    return dt.date(year + 2000 if year < 100 else year, int(m.group(1)), int(m.group(2)))


def unit_lines(el, out: list[str], history: list[str]) -> None:
    """Text lines of a section body (div.mrs-text blocks, bhistory spans moved to history), in document order."""
    for child in el:
        if not isinstance(child.tag, str):
            continue
        cls = child.get("class") or ""
        if "bhistory" in cls:
            text = lib.norm_ws(child.text_content())
            if text:
                history.append(text.strip("[]"))
            continue
        if "qhistory" in cls or "headnote_blip" in cls or child.tag == "h3":
            continue
        if "mrs-text" in cls:
            inner_hist = [lib.norm_ws(s.text_content()) for s in child.find_class("bhistory")]
            for span in child.find_class("bhistory"):
                span.drop_tree()
            text = lib.html_text(lxml_html.tostring(child, encoding="unicode", with_tail=False))
            if text:
                out.extend(line for line in text.split("\n") if line)
            history.extend(h.strip("[]") for h in inner_hist if h)
            continue
        unit_lines(child, out, history)


def parse_section(page: lib.Fetched, today: dt.date) -> dict:
    root = lxml_html.document_fromstring(page.text())
    path = []
    for div in root.iter("div"):
        cls = (div.get("class") or "").split()
        kind = next((c for c in cls if c in LEVEL), None)
        if kind and "toc" in cls:
            m = STRUCT_RE.match(lib.norm_ws(div.text_content()))
            if m:
                path.append({"level": LEVEL[kind], "label": m.group(1), "number": m.group(2), "heading": m.group(3) or None})
    versions = []
    for sec in root.find_class("MRSSection"):
        h3 = sec.find(".//h3")
        hm = HEAD_RE.match(lib.norm_ws(h3.text_content())) if h3 is not None else None
        if not hm:
            raise RuntimeError(f"{page.url}: no section heading")
        blip = sec.find_class("headnote_blip")
        note = lib.norm_ws(blip[0].text_content()) if blip else None
        lines: list[str] = []
        history: list[str] = []
        unit_lines(sec, lines, history)
        for q in sec.find_class("qhistory_list"):
            text = lib.norm_ws(q.text_content())
            if text:
                history.append(text)
        status = marker = None
        effective = None
        classes = (sec.get("class") or "").split()
        if note:
            inner = note.strip("()")
            eff = EFFECTIVE_RE.search(inner)
            if eff and "REPEALED" not in inner.upper() and "WHOLE SECTION TEXT EFFECTIVE" in inner.upper():
                when = _date(eff)
                effective = {"start": when.isoformat(), "end": None, "note": note}
                if when > today:
                    status, marker = "future_effective", note
            elif eff and "REPEALED" in inner.upper():
                when = _date(eff)
                effective = {"start": None, "end": when.isoformat(), "note": note}
                if when <= today:
                    status, marker = "repealed", note
            elif inner.upper().startswith("REALLOCATED TO"):
                status, marker = "renumbered", note
            else:
                status, marker = lib.classify_status(inner, None)
                marker = note if status else None
        if status is None and "status_current" not in classes and any(c.startswith("status_") for c in classes):
            status, marker = "not_recorded", None
        versions.append({"number": hm.group(1), "heading": hm.group(2) or None, "text": "\n".join(lines),
                         "history": "\n".join(dict.fromkeys(history)) or None, "status": status, "marker": marker,
                         "effective": effective, "note": note})
    if not versions:
        raise RuntimeError(f"{page.url}: no div.MRSSection")
    return {"path": path, "versions": versions}


def acquire(ctx: lib.RunContext) -> None:
    index = ctx.get(BASE, fallback_fresh=True)
    flat = lib.html_text(index.body)
    statement = re.search(r"This version of the Maine Revised Statutes reflects changes made through[^\n]*", flat)
    through = None
    if statement:
        tm = re.search(r"current through ([A-Z][a-z]+ \d{1,2}, \d{4})", statement.group(0))
        through = dt.datetime.strptime(tm.group(1), "%B %d, %Y").date().isoformat() if tm else None
    ctx.edition(edition_label=None, currency_statement=statement.group(0) if statement else None,
                currency_source_url=BASE, currency_through=through)
    titles = list(dict.fromkeys(re.findall(r'href="([0-9]+(?:-[A-Z])?/title[0-9]+(?:-[A-Z])?ch0sec0\.html)"', index.text())))
    if len(titles) < 40:
        raise RuntimeError(f"index lists {len(titles)} titles")
    if ctx.sample is not None:
        titles = ["14/title14ch0sec0.html"]
    for title_link in titles:
        if not ctx.want_more():
            break
        title_no = title_link.split("/", 1)[0]
        tpage = ctx.get(BASE + title_link, fallback_fresh=True)
        chapters = list(dict.fromkeys(re.findall(rf'href="\./(title{re.escape(title_no)}ch[0-9A-Za-z\-]+sec0\.html)"',
                                                 tpage.text())))
        chapters = [c for c in chapters if not c.endswith("ch0sec0.html")]
        if ctx.sample is not None:
            chapters = ["title14ch205sec0.html"]
        for chapter in chapters:
            if not ctx.want_more():
                break
            cpage = ctx.get(f"{BASE}{title_no}/{chapter}", fallback_fresh=True)
            sections = list(dict.fromkeys(re.findall(rf'href="\./(title{re.escape(title_no)}sec[0-9A-Za-z.\-]+\.html)"',
                                                     cpage.text())))
            ctx.prefetch(f"{BASE}{title_no}/{link}" for link in sections)  # retained runs: read ahead
            for link in sections:
                if not ctx.want_more():
                    break
                page = ctx.get(f"{BASE}{title_no}/{link}", fallback_fresh=True)
                parsed = parse_section(page, ctx.today)
                multi = len(parsed["versions"]) > 1
                for index_no, version in enumerate(parsed["versions"], start=1):
                    ctx.section(code="MRS", number=f"{title_no}:{version['number']}", heading=version["heading"],
                                text=version["text"], history=version["history"], source=page, path=parsed["path"],
                                status=version["status"], status_marker=version["marker"],
                                effective=version["effective"], version=version["note"] if multi else None,
                                version_index=index_no if multi else None)
