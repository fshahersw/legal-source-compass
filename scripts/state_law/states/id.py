"""Idaho — Idaho Legislature, Legislative Services Office, Idaho Statutes (legislature.idaho.gov), state-law/1.

/statutesrules/idstat/ lists the titles (Title5), a title page lists its chapters (Title5/T5CH2; repealed chapters are
printed without a link), a chapter page lists its sections (Title5/T5CH2/SECT5-219). A section page prints, inside
div.pgbrk, centered header lines (TITLE 5 / its heading / CHAPTER 2 / its heading, and PART lines where a part starts)
then "5-219.  <span uppercase>Catchline.</span> text", further paragraphs, a "History:" line and the bracketed history
("[(5-219) C.C.P. 1881, sec. 159; …]"). The statutes page states "Idaho Statutes are updated to the website July 1
following the legislative session."; the linked "How current is this law?" page states the session the statutes are
current through. Both sentences are kept verbatim. robots.txt disallows only WordPress admin and calendar paths;
1 request/second. Retained mode re-parses the section pages this project captured on 2026-10-06..12.
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "legislature.idaho.gov"
BASE = f"https://{HOST}"
INDEX = f"{BASE}/statutesrules/idstat/"
CURRENT = f"{BASE}/statutesrules/howcurrentisthislaw/"

META = lib.StateMeta(
    state="ID",
    code_name="Idaho Statutes",
    publisher="Idaho Legislature — Legislative Services Office (legislature.idaho.gov)",
    publisher_url=INDEX,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="id-lso-idstat/1",
    min_interval_s=1.0,
    codes=(lib.Code("IC", "Idaho Code", "Idaho Code § {n}",
                    lib.alias_patterns(["Idaho Code Ann.", "Idaho Code", "I.C.", "Idaho Stat."])),),
    terms_note="Idaho Statutes as published by the Legislature; the site's own currency sentences are shown verbatim.",
    update_cadence="Updated to the website July 1 following each session (publisher statement); re-check each July.",
)

NUM = r"\d+[A-Z]?-\d+[0-9A-Z]*(?:\.\d+[A-Z]?)?"
SECTION_RE = re.compile(rf"^({NUM})\.\s*(.*)$")
HEADER_RE = re.compile(r"^(TITLE|CHAPTER|PART|SUBPART|ARTICLE)\s+([0-9A-Z.\-]+)\s*$")
LEVEL = {"TITLE": "title", "CHAPTER": "chapter", "PART": "part", "SUBPART": "subpart", "ARTICLE": "article"}
RANK = {"title": 0, "chapter": 1, "article": 2, "part": 2, "subpart": 3}


def _flat(el) -> str:
    return lib.html_text(lxml_html.tostring(el, encoding="unicode"))


def parse_section(page: lib.Fetched) -> dict:
    root = lxml_html.document_fromstring(page.text())
    box = root.find_class("pgbrk")
    if not box:
        raise RuntimeError(f"{page.url}: no div.pgbrk")
    divs = [d for d in box[0] if d.tag == "div"]
    headers: list[dict] = []
    pending = None
    number = heading = None
    lines: list[str] = []
    history: list[str] = []
    mode = "head"
    for div in divs:
        style = (div.get("style") or "").replace(" ", "").lower()
        text = _flat(div)
        if not text:
            continue
        if mode == "head":
            if "text-align:center" in style:
                hm = HEADER_RE.match(text)
                if hm:
                    pending = {"level": LEVEL[hm.group(1)], "label": hm.group(1).title(), "number": hm.group(2),
                               "heading": None}
                    headers.append(pending)
                elif pending is not None and pending["heading"] is None:
                    pending["heading"] = text
                continue
            sm = SECTION_RE.match(text)
            if not sm:
                raise RuntimeError(f"{page.url}: no section line in {text[:80]!r}")
            number = sm.group(1)
            span = next((s for s in div.iter("span") if "uppercase" in (s.get("style") or "").replace(" ", "").lower()),
                        None)
            heading = lib.norm_ws(span.text_content()) if span is not None else None
            rest = sm.group(2)
            if heading and lib.norm_ws(rest).startswith(heading):
                rest = lib.norm_ws(rest)[len(heading):].strip()
            if rest:
                lines.append(rest)
            mode = "text"
            continue
        if mode == "text" and re.match(r"^History:?$", text):
            mode = "history"
            continue
        if mode == "history":
            history.append(text)
        else:
            lines.append(text)
    if number is None:
        raise RuntimeError(f"{page.url}: no section")
    hist = lib.norm_ws(" ".join(history))
    hm = re.match(r"^\[(.*)\]$", hist)
    return {"number": number, "heading": heading or None, "text": "\n".join(lines),
            "history": (hm.group(1) if hm else hist) or None, "headers": headers}


def statement(ctx: lib.RunContext) -> tuple[str | None, str]:
    index = ctx.get(INDEX, fallback_fresh=True)
    found = [m.group(0) for m in re.finditer(r"Idaho Statutes are updated to the website[^\n]*", lib.html_text(index.body))]
    try:
        page = ctx.fetch(CURRENT)
        found += [m.group(0) for m in re.finditer(r"Idaho Statutes and Constitutions are current through[^\n]*",
                                                   lib.html_text(page.body))]
        url = CURRENT
    except lib.Blocked:
        url = INDEX
    return ("\n".join(dict.fromkeys(found)) or None), url


def acquire(ctx: lib.RunContext) -> None:
    text, url = statement(ctx)
    ctx.edition(edition_label=None, currency_statement=text, currency_source_url=url)
    index = ctx.get(INDEX, fallback_fresh=True)
    titles = list(dict.fromkeys(re.findall(r'href="(/statutesrules/idstat/Title\d+[A-Z]?)/?"', index.text())))
    if len(titles) < 60:
        raise RuntimeError(f"index lists {len(titles)} titles")
    if ctx.sample is not None:
        titles = ["/statutesrules/idstat/Title5"]
    for title in titles:
        if not ctx.want_more():
            break
        try:
            tpage = ctx.get(f"{BASE}{title}/", fallback_fresh=True)
        except RuntimeError as error:
            if ctx.sample is not None or "HTTP 404" not in str(error):
                raise
            # a title the index lists but the publisher does not serve (Title 22 on 2026-10-23) is ledgered as
            # unavailable; the loader refuses such an edition until the gap is accepted and named in its note
            ctx._rejects.write({"state": "ID", "code": "IC", "number": None,
                                "reason": f"unavailable: {BASE}{title}/ returned HTTP 404",
                                "source_url": f"{BASE}{title}/", "source_sha256": None})
            continue
        chapters = list(dict.fromkeys(re.findall(rf'href="({re.escape(title)}/T\d+[A-Z]?CH[0-9A-Z]+)/?"', tpage.text())))
        if ctx.sample is not None:
            chapters = [f"{title}/T5CH2"]
        for chapter in chapters:
            if not ctx.want_more():
                break
            cpage = ctx.get(f"{BASE}{chapter}/", fallback_fresh=True)
            sections = list(dict.fromkeys(re.findall(rf'href="({re.escape(chapter)}/SECT[0-9A-Z.\-]+)/?"', cpage.text())))
            context: list[dict] = []
            for link in sections:
                if not ctx.want_more():
                    break
                page = ctx.get(f"{BASE}{link}", fallback_fresh=True)
                parsed = parse_section(page)
                for header in parsed["headers"]:  # every page repeats TITLE/CHAPTER; a PART prints where it starts
                    same = next((c for c in context if c["level"] == header["level"]), None)
                    if same is not None and same["number"] == header["number"]:
                        continue
                    rank = RANK[header["level"]]
                    context[:] = [c for c in context if RANK[c["level"]] < rank] + [header]
                status = marker = None
                if not parsed["text"] and parsed["heading"]:
                    status, marker = lib.classify_status(parsed["heading"], None)
                ctx.section(code="IC", number=parsed["number"], heading=parsed["heading"], text=parsed["text"],
                            history=parsed["history"], source=page, path=list(context), status=status,
                            status_marker=marker)
