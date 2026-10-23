"""Delaware — Delaware Code Online (delcode.delaware.gov), Code Revisors / Division of Legislative Services, state-law/1.

index.html lists titles (titleN/index.html); a title page lists chapters (cNNN/index.html); a chapter page prints
#TitleHead (TITLE n, title name, part name, CHAPTER n. name, subchapter) and #CodeBody div.Section blocks:
div.SectionHead "§ 8101. Catchline." + p paragraphs + the source-law history (text and links after the last p).
Chapters with subchapters print subchapter pages (scNN/index.html) linked from the chapter page. Section numbers
are only unique within a title: number = "<title>:<section>" (MODEL.md). No robots.txt (404); 1 request/second.
The home page states that the version on the site "is considered an official version of the State of Delaware
statutory code" and which acts it includes ("This version includes all acts enacted as of <date>, up to and including
<n> Del. Laws, c. <m>."); that sentence is kept verbatim as the currency statement.
"""
from __future__ import annotations

import pathlib
import re
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "delcode.delaware.gov"
BASE = f"https://{HOST}/"

META = lib.StateMeta(
    state="DE",
    code_name="Delaware Code",
    publisher="Delaware Code Revisors and Division of Legislative Services (delcode.delaware.gov)",
    publisher_url=BASE,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="de-delcode-html/1",
    min_interval_s=1.0,
    codes=(lib.Code("DELC", "Delaware Code", "Del. Code Ann. tit. {t}, § {s}", (
        lib.Pattern(r"(?:del\.?\s?code\s?(?:ann\.?)?,?\s?)?tit\.?\s?([0-9]+),?\s?§\s?([0-9][0-9a-z.\-]*)", r"\1:\2"),
        lib.Pattern(r"([0-9]+)\s?del\.?\s?c\.?\s?(?:ann\.?\s?)?§\s?([0-9][0-9a-z.\-]*)", r"\1:\2"),
    )),),
    terms_note="Delaware Code Online, published by the State; the home page states the latest session law included.",
    update_cadence="Updated as acts are enacted (home page names the last act included); re-check monthly.",
)

HEAD_RE = re.compile(r"^§+\s*([0-9][0-9A-Za-z.\-]*?)\.\s*(.*)$")


def _t(el) -> str:
    return lib.norm_ws(el.text_content()) if el is not None else ""


def parse_chapter(page: lib.Fetched) -> tuple[list[dict], list[dict]]:
    root = lxml_html.document_fromstring(page.body)
    head = root.get_element_by_id("TitleHead") if root.xpath('//*[@id="TitleHead"]') else None
    path: list[dict] = []
    if head is not None:
        h1 = _t(head.find("h1"))
        h4s = head.findall("h4")
        tm = re.match(r"^TITLE\s+(\S+)$", h1)
        if tm:
            path.append({"level": "title", "label": "Title", "number": tm.group(1), "heading": _t(h4s[0]) if h4s else None})
        h2 = _t(head.find("h2"))
        if h2:
            pm = re.match(r"^PART\s+([IVXLC0-9A-Z]+)\.?\s*(.*)$", h2, re.I)
            path.append({"level": "part", "label": "Part", "number": pm.group(1) if pm else None,
                         "heading": (pm.group(2) if pm else h2) or None})
        h3 = _t(head.find("h3"))
        cm = re.match(r"^CHAPTER\s+([0-9A-Za-z]+)\.?\s*(.*)$", h3, re.I)
        if cm:
            path.append({"level": "chapter", "label": "Chapter", "number": cm.group(1), "heading": cm.group(2) or None})
        sub = _t(h4s[1]) if len(h4s) > 1 else ""
        sm = re.match(r"^Subchapter\s+([IVXLC0-9A-Z]+)\.?\s*(.*)$", sub, re.I)
        if sm:
            path.append({"level": "subchapter", "label": "Subchapter", "number": sm.group(1), "heading": sm.group(2) or None})
    sections = []
    for div in root.find_class("Section"):
        sh = next((d for d in div if "SectionHead" in (d.get("class") or "")), None)
        if sh is None:
            continue
        m = HEAD_RE.match(_t(sh))
        if not m:
            raise RuntimeError(f"unparsed section head {_t(sh)!r} in {page.url}")
        paras, history = [], []
        seen_p = False
        for child in div:
            if child is sh:
                continue
            if child.tag == "p":
                paras.append(lib.html_text(lxml_html.tostring(child, encoding="unicode", with_tail=False)))
                seen_p = True
                if child.tail and lib.norm_ws(child.tail):
                    history = [child.tail]
                continue
            if seen_p:
                history.append(child.text_content())
                if child.tail:
                    history.append(child.tail)
        if not seen_p:  # a status-only entry: everything after the head is its history line
            history = [sh.tail or ""] + [lxml_html.tostring(c, encoding="unicode", method="text") for c in div if c is not sh]
        sections.append({"number": m.group(1), "heading": m.group(2) or None, "text": "\n".join(p for p in paras if p),
                         "history": lib.norm_ws("".join(history)) or None})
    return path, sections


def acquire(ctx: lib.RunContext) -> None:
    home = ctx.get(BASE + "index.html", fallback_fresh=True)
    flat = lib.html_text(home.body)
    # the home page's currency sentence, verbatim (the sentence before it names the preparers and official status)
    statement = re.search(r"This version includes all acts enacted as of[^\n]*", flat)
    ctx.edition(edition_label=None, currency_statement=statement.group(0) if statement else None,
                currency_source_url=BASE)
    titles = list(dict.fromkeys(re.findall(r'href="\s*(?:\.\./)?(title\d+[a-z]?/index\.html)', home.text())))
    if ctx.sample is not None:
        titles = ["title10/index.html"]
    for title_path in titles:
        if not ctx.want_more():
            break
        tpage = ctx.get(BASE + title_path, fallback_fresh=True)
        tdir = title_path.rsplit("/", 1)[0]
        title_no = re.match(r"title(\d+[a-z]?)", tdir).group(1)
        chapters = list(dict.fromkeys(re.findall(r'href="\s*(c\d+[a-z]?/index\.html)', tpage.text())))
        if ctx.sample is not None:
            chapters = ["c081/index.html"]
        queue = [f"{BASE}{tdir}/{c}" for c in chapters]
        while queue:
            if not ctx.want_more():
                break
            url = queue.pop(0)
            page = ctx.get(url, fallback_fresh=True)
            subs = [urllib.parse.urljoin(url, s) for s in dict.fromkeys(re.findall(r'href="\s*(sc\d+[a-z]?/index\.html)', page.text()))]
            queue = subs + queue
            path, sections = parse_chapter(page)
            for item in sections:
                if not ctx.want_more():
                    break
                ctx.section(code="DELC", number=f"{title_no}:{item['number']}", heading=item["heading"], text=item["text"],
                            history=item["history"], source=page, path=path)
