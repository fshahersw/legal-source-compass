"""Alaska — Alaska State Legislature, Legislative Affairs Agency, Alaska Statutes (akleg.gov/basis), state-law/1.

basis/statutes.asp prints the edition ("Alaska Statutes 2025") and the title list. The page's own script requests:
statutes.asp?media=js&type=TOC&title=9 (the chapters of a title: loadTOC("09.10") "Chapter 10. Limitations of
Actions."), …&title=09.10 (the sections of a chapter: "Sec. 09.10.010.   General limitations on civil actions."),
and statutes.asp?media=print&secStart=09.10.010&secEnd=09.10.240 (the printable text of a section range). One print
request per chapter covers the chapter. In the print text each section opens with <b><a name="09.10.010"> </a>Sec.
09.10.010.   Catchline. <BR></b>, followed by its text (<BR>-separated subsections); an article heading prints as
<b><h7>Article 2. Forcible Entry and Detainer.</h7></b>. A repealed section's catchline ends with the bracketed note
("[Repealed, § 1 ch 27 SLA 1966.]"). The pages are labelled ISO-8859-1 and decoded as windows-1252 (lib.decode_bytes).
robots.txt does not restrict basis/statutes.asp; 1 request/second (~1,900 requests). Retained mode re-parses the
print ranges this project captured on 2026-10-06..12.
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

HOST = "www.akleg.gov"
PAGE = f"https://{HOST}/basis/statutes.asp"

META = lib.StateMeta(
    state="AK",
    code_name="Alaska Statutes",
    publisher="Alaska State Legislature — Legislative Affairs Agency (akleg.gov)",
    publisher_url=PAGE,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="ak-basis-print/1",
    min_interval_s=1.0,
    codes=(lib.Code("AS", "Alaska Statutes", "Alaska Stat. § {n}",
                    lib.alias_patterns(["Alaska Stat. Ann.", "Alaska Stat.", "AS", "A.S."])),),
    terms_note="Alaska Statutes as served by the Legislature's BASIS system; the edition year is the publisher's label.",
    update_cadence="Annual edition (Alaska Statutes <year>); re-check each autumn.",
)

SEC_RE = re.compile(r"^Secs?\.\s+([0-9]{2}\.[0-9]{2}\.[0-9]{3}[0-9A-Za-z]*)\.?\s*(.*)$")
RANGE_RE = re.compile(r"^Secs\.\s+[0-9.]+\s*(?:[-–—]|to|and|,)")
CHAPTER_RE = re.compile(r'loadTOC\("([0-9]{2}\.[0-9]{2}[0-9A-Za-z]*)"\);[^>]*>\s*<b>\s*Chapter\s+([0-9A-Za-z]+)\.\s*([^<]*)<BR>', re.I)
TOC_SEC_RE = re.compile(r"#([0-9]{2}\.[0-9]{2}\.[0-9]{3}[0-9A-Za-z]*)\s*>")
ARTICLE_RE = re.compile(r"^Article\s+([0-9A-Za-z]+)\.\s*(.*)$")


def split_print(page: lib.Fetched) -> list[tuple[str, str]]:
    """[("article"|"section", html chunk)] in printed order."""
    text = page.text()
    parts = re.split(r'(?i)<b>\s*(?=<h7>|<a name="[0-9])', text)
    out = []
    for part in parts[1:]:
        out.append(("article" if part.lstrip().lower().startswith("<h7>") else "section", part))
    return out


def parse_print(page: lib.Fetched) -> list[dict]:
    out: list[dict] = []
    article = None
    for kind, chunk in split_print(page):
        if kind == "article":
            am = ARTICLE_RE.match(lib.norm_ws(lib.html_text(chunk)))
            article = ({"level": "article", "label": "Article", "number": am.group(1), "heading": am.group(2) or None}
                       if am else None)
            continue
        head_html, _, body_html = chunk.partition("</b>")
        head = lib.norm_ws(lib.html_text(head_html))
        if RANGE_RE.match(head):
            out.append({"range": head})
            continue
        m = SEC_RE.match(head)
        if not m:
            raise RuntimeError(f"{page.url}: unparsed section head {head[:80]!r}")
        out.append({"number": m.group(1), "heading": m.group(2) or None, "text": lib.html_text(body_html),
                    "article": article})
    return out


def acquire(ctx: lib.RunContext) -> None:
    landing = ctx.fetch(PAGE)
    flat = lib.html_text(landing.body)
    label = re.search(r"Alaska Statutes \d{4}", flat)
    ctx.edition(edition_label=label.group(0) if label else None, currency_statement=None, currency_source_url=PAGE)
    titles = sorted({int(n) for n in re.findall(r"Title (\d+)\. ", flat)})
    if len(titles) < 40:
        raise RuntimeError(f"statutes page lists {len(titles)} titles")
    title_names = {int(m.group(1)): m.group(2) for m in re.finditer(r"^Title (\d+)\. (.+?)\.?$", flat, re.M)}
    if ctx.sample is not None:
        titles = [9]
    for title in titles:
        if not ctx.want_more():
            break
        toc = ctx.fetch(f"{PAGE}?media=js&type=TOC&title={title}")
        chapters = [(c, n, lib.norm_ws(h)) for c, n, h in CHAPTER_RE.findall(toc.text())]
        if ctx.sample is not None:
            chapters = [c for c in chapters if c[0] == "09.10"]
        title_step = {"level": "title", "label": "Title", "number": str(title), "heading": title_names.get(title)}
        for chapter_id, chapter_no, chapter_head in chapters:
            if not ctx.want_more():
                break
            ctoc = ctx.fetch(f"{PAGE}?media=js&type=TOC&title={chapter_id}")
            numbers = list(dict.fromkeys(TOC_SEC_RE.findall(ctoc.text())))
            if not numbers:
                continue
            page = ctx.get(f"{PAGE}?media=print&secStart={numbers[0]}&secEnd={numbers[-1]}", fallback_fresh=True)
            chapter_step = {"level": "chapter", "label": "Chapter", "number": chapter_no,
                            "heading": chapter_head.rstrip(".") + "." if chapter_head else None}
            for item in parse_print(page):
                if not ctx.want_more():
                    break
                if "range" in item:
                    ctx._rejects.write({"state": "AK", "code": "AS", "number": None, "reason": f"range entry: {item['range'][:200]}",
                                        "source_url": page.url, "source_sha256": page.sha256})
                    continue
                path = [title_step, chapter_step] + ([item["article"]] if item["article"] else [])
                ctx.section(code="AS", number=item["number"], heading=item["heading"], text=item["text"], source=page,
                            path=path)
