"""Florida — The Florida Legislature, Online Sunshine (official), state-law/1 parser.

Source pages: the statutes landing page lists 49 titles; each title index lists its chapters; each chapter's
"View Entire Chapter" page (index.cfm?App_mode=Display_Statute&URL=<range>/<chapter>/<chapter>.html) returns the
publisher's chapter XHTML: Title, ChapterTitle, optional Part, then Section blocks (SectionNumber, Catchline,
SectionBody, History, Note). Notes are editorial and dropped; the History line is kept separately.
robots.txt allows everything for generic agents (only /employees/ is disallowed); 1 request/second.
Edition label "The <year> Florida Statutes" is printed on every index page; no through-date is printed.
"""
from __future__ import annotations

import pathlib
import re
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "www.leg.state.fl.us"
BASE = f"https://{HOST}/statutes/"
LANDING = BASE + "index.cfm?Mode=View%20Statutes&Submenu=1&Tab=statutes"
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII",
         "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX", "XXXI",
         "XXXII", "XXXIII", "XXXIV", "XXXV", "XXXVI", "XXXVII", "XXXVIII", "XXXIX", "XL", "XLI", "XLII", "XLIII",
         "XLIV", "XLV", "XLVI", "XLVII", "XLVIII", "XLIX"]

META = lib.StateMeta(
    state="FL",
    code_name="Florida Statutes",
    publisher="The Florida Legislature — Online Sunshine (leg.state.fl.us)",
    publisher_url=LANDING,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="fl-online-sunshine/1",
    min_interval_s=1.0,
    codes=(lib.Code("FS", "Florida Statutes", "Fla. Stat. § {n}",
                    lib.alias_patterns(["Fla. Stat.", "Fla. Stat. Ann.", "F.S.", "Florida Statutes", "F.S.A.", "Fla. Stat. ch."])),),
    terms_note="Florida Statutes published by the Legislature on Online Sunshine; public record; robots.txt permits.",
    update_cadence="Annual edition after each regular session (new edition usually by mid-year); re-check monthly.",
)


def _text(el) -> str:
    return lib.norm_ws(el.text_content()) if el is not None else ""


def title_chapters(page: lib.Fetched) -> list[tuple[str, str]]:
    """(chapter number, full-chapter URL) in printed order from a title index page."""
    out = []
    for href in re.findall(r'href="(index\.cfm\?App_mode=Display_Statute&(?:amp;)?URL=[^"]*ContentsIndex\.html[^"]*)"', page.text()):
        href = href.replace("&amp;", "&")
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(href).query)
        url_part = query["URL"][0]
        match = re.match(r"^(\d{4}-\d{4})/(\d{4}[A-Z]?)/\2ContentsIndex\.html$", url_part)
        if not match:
            continue
        chapter = match.group(2).lstrip("0") or "0"
        full = BASE + f"index.cfm?App_mode=Display_Statute&URL={match.group(1)}/{match.group(2)}/{match.group(2)}.html"
        if (chapter, full) not in out:
            out.append((chapter, full))
    return out


def parse_chapter(ctx: lib.RunContext, page: lib.Fetched, title_roman: str, title_heading: str | None) -> int:
    root = lxml_html.document_fromstring(page.body)
    chapter_el = root.find_class("Chapter")
    if not chapter_el:
        raise RuntimeError(f"no Chapter block in {page.url}")
    chapter_el = chapter_el[0]
    title_num = _text(next(iter(chapter_el.find_class("TitleNumber")), None)).replace("TITLE", "").strip() or title_roman
    title_name = _text(next(iter(chapter_el.find_class("TitleName")), None)) or title_heading
    chap_num = _text(next(iter(chapter_el.find_class("ChapterNumber")), None)).replace("CHAPTER", "").strip()
    chap_name = _text(next(iter(chapter_el.find_class("ChapterName")), None))
    base_path = [
        {"level": "title", "label": "Title", "number": title_num, "heading": title_name},
        {"level": "chapter", "label": "Chapter", "number": chap_num, "heading": chap_name},
    ]
    count = 0
    for section in chapter_el.iter("div"):
        if "Section" not in (section.get("class") or "").split():
            continue
        if not ctx.want_more():
            break
        path = list(base_path)
        part = next((a for a in section.iterancestors("div") if "Part" in (a.get("class") or "").split()), None)
        if part is not None:
            pt = next(iter(part.find_class("PartTitle")), None)
            number = _text(next(iter(pt.find_class("PartNumber")), None)).replace("PART", "").strip() if pt is not None else ""
            names = [el for el in part.iter("span") if "PartTitle" in (el.get("class") or "").split()]
            path.append({"level": "part", "label": "Part", "number": number or None,
                         "heading": _text(names[0]) if names else None})
        num_el = next((c for c in section if "SectionNumber" in (c.get("class") or "").split()), None)
        number = _text(num_el)
        catch = next((c for c in section if "Catchline" in (c.get("class") or "").split()), None)
        heading = None
        if catch is not None:
            ct = catch.find_class("CatchlineText")
            heading = _text(ct[0]) if ct else _text(catch).rstrip("—").strip()
        body = next((c for c in section if "SectionBody" in (c.get("class") or "").split()), None)
        text = lib.html_text(lxml_html.tostring(body, encoding="unicode")) if body is not None else ""
        hist = next((c for c in section if "History" in (c.get("class") or "").split()), None)
        history = _text(hist) or None
        if not number:
            raise RuntimeError(f"section without number in {page.url}")
        ctx.section(code="FS", number=number, heading=heading, text=text, history=history, source=page, path=path)
        count += 1
    return count


SAMPLE_CHAPTERS = [("VIII", "95"), ("XLV", "768")]


def acquire(ctx: lib.RunContext) -> None:
    landing = ctx.fetch(LANDING)
    titles = re.findall(r"App_mode=Display_Index&(?:amp;)?Title_Request=([IVXL]+)", landing.text())
    titles = [t for t in dict.fromkeys(titles) if t in ROMAN]
    if len(titles) < 40:
        raise RuntimeError(f"landing page lists {len(titles)} titles; expected 49")
    if ctx.sample is not None:
        titles = [t for t, _c in SAMPLE_CHAPTERS]
    edition_set = False
    for title in titles:
        if not ctx.want_more():
            break
        page = ctx.fetch(BASE + f"index.cfm?App_mode=Display_Index&Title_Request={title}")
        flat = lib.html_text(page.body)
        if not edition_set:
            match = re.search(r"The (\d{4}) Florida Statutes", flat)
            if not match:
                raise RuntimeError("edition label 'The <year> Florida Statutes' not printed")
            ctx.edition(edition_label=match.group(0), currency_statement=None, currency_source_url=page.url)
            edition_set = True
        heading_match = re.search(rf"TITLE {title}\s*\n?\s*([A-Z][^\n]*)", flat)
        chapters = title_chapters(page)
        if ctx.sample is not None:
            wanted = {c for t, c in SAMPLE_CHAPTERS if t == title}
            chapters = [c for c in chapters if c[0] in wanted]
        for chapter, url in chapters:
            if not ctx.want_more():
                break
            got = ctx.fetch(url)
            parse_chapter(ctx, got, title, heading_match.group(1).strip() if heading_match else None)
