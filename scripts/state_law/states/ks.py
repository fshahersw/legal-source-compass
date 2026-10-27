"""Kansas — Office of Revisor of Statutes, Kansas Statutes (ksrevisor.gov), state-law/1.

/ksa.html lists the chapters (statutes/ksa_ch60.html) and prints "These statutes include amendments and new laws enacted
during the <year> legislative session." (kept verbatim) with a note that the authenticated text is the printed Kansas
Statutes Annotated. A chapter page lists its articles ("Article 5.—LIMITATIONS OF ACTIONS") and, under each, the
sections ("60-513" + a link to chapters/ch60/060_005_0013.html whose text is the catchline, or "Repealed."). A section
page prints, inside div#print, p.ksa_stat paragraphs (the first opens with span.stat_number "60-513." and
span.stat_caption "Actions limited to two years.") and p.ksa_stat_hist ("History: L. 1963, ch. 303, 60-513; …"); the
Revisor's source notes, law review references and case annotations follow outside div#print and are not kept. A
repealed section prints only its number and a history ending "Repealed, L. 1981, ch. 233, § 1; July 1."; its status is
read from that history (and the chapter list's "Repealed."). Section numbers can contain a comma ("79-32,117").
robots.txt disallows only asset paths; 1 request/second.
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "www.ksrevisor.gov"
BASE = f"https://{HOST}"
INDEX = f"{BASE}/ksa.html"
NUM = r"[0-9]+[a-z]?-[0-9]+[a-z]?(?:,[0-9]+[a-z]?)?"

META = lib.StateMeta(
    state="KS",
    code_name="Kansas Statutes",
    publisher="Kansas Office of Revisor of Statutes (ksrevisor.gov)",
    publisher_url=INDEX,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="ks-revisor-ksa/1",
    min_interval_s=1.0,
    codes=(lib.Code("KSA", "Kansas Statutes", "Kan. Stat. Ann. § {n}", (
        lib.Pattern(rf"(?:k\.?s\.?a\.?|kan\.?\s?stat\.?\s?ann\.?|kan\.?\s?stat\.?)\s?(?:[0-9]{{4}}\s?supp\.?\s?)?"
                    rf"(?:§\s?)?({NUM})", r"\1"),
        lib.Pattern(rf"({NUM})", r"\1"),
    )),),
    terms_note=("Kansas Statutes as posted by the Revisor; the site notes that the authenticated text is the printed "
                "Kansas Statutes Annotated and Cumulative Supplement. Source notes, law review references and case "
                "annotations are not kept."),
    update_cadence="After each session (statement names the session included); re-check each July.",
)

ARTICLE_RE = re.compile(r"^Article\s+([0-9A-Za-z]+)\.?\s*[—–-]+\s*(.*)$")
CHAPTER_RE = re.compile(r"^Chapter\s+([0-9A-Za-z]+)\.?\s*[—–-]+\s*(.*)$")


def chapter_toc(page: lib.Fetched) -> tuple[dict | None, list[tuple[dict | None, str, str, str]]]:
    """(chapter step, [(article step, number, caption, section URL)]) in printed order."""
    root = lxml_html.document_fromstring(page.text())
    chapter = None
    for el in root.iter("h1", "h2", "h3", "div", "p", "span", "a"):
        cm = CHAPTER_RE.match(lib.norm_ws(el.text_content()))
        if cm and len(el.text_content()) < 300:
            chapter = {"level": "chapter", "label": "Chapter", "number": cm.group(1), "heading": cm.group(2) or None}
            break
    out: list[tuple[dict | None, str, str, str]] = []
    for li in root.iter("li"):
        anchor = li.find("a")
        am = ARTICLE_RE.match(lib.norm_ws(anchor.text_content())) if anchor is not None else None
        if am is None:
            continue
        article = {"level": "article", "label": "Article", "number": am.group(1), "heading": am.group(2) or None}
        for item in li.iter("li"):
            link = item.find("a")
            if link is None or "/statutes/chapters/" not in (link.get("href") or ""):
                continue
            number = lib.norm_ws(item.text or "")
            out.append((article, number, lib.norm_ws(link.text_content()), BASE + link.get("href")))
    if not out:  # chapters without articles list sections directly
        for item in root.iter("li"):
            link = item.find("a")
            if link is not None and "/statutes/chapters/" in (link.get("href") or ""):
                out.append((None, lib.norm_ws(item.text or ""), lib.norm_ws(link.text_content()), BASE + link.get("href")))
    return chapter, out


def parse_section(page: lib.Fetched) -> dict:
    root = lxml_html.document_fromstring(page.text())
    box = root.get_element_by_id("print", None)
    if box is None:
        raise RuntimeError(f"{page.url}: no div#print")
    number = heading = None
    lines: list[str] = []
    history: list[str] = []
    for p in box.iter("p", "table"):
        if any(a.tag == "table" for a in p.iterancestors()):
            continue  # a table is read whole
        cls = p.get("class") or ""
        if p.tag == "table" or cls.startswith("ksa_stat") and cls != "ksa_stat_hist":
            if p.tag == "p" and number is None:
                num = p.find_class("stat_number")
                cap = p.find_class("stat_caption")
                if num:
                    number = lib.norm_ws(num[0].text_content()).rstrip(".")
                    heading = lib.norm_ws(cap[0].text_content()) if cap else None
                    for span in num + cap:
                        span.drop_tree()
            text = lib.html_text(lxml_html.tostring(p, encoding="unicode"))
            if text:
                lines.append(text)
        elif cls == "ksa_stat_hist":
            num = p.find_class("stat_number") if number is None else []
            if num:  # a repealed section prints its number in a history paragraph and has no text paragraph
                number = lib.norm_ws(num[0].text_content()).rstrip(".")
                cap = p.find_class("stat_caption")
                heading = lib.norm_ws(cap[0].text_content()) if cap else None
                for span in num + cap:
                    span.drop_tree()
            for span in p.find_class("history"):
                span.drop_tree()
            text = lib.html_text(lxml_html.tostring(p, encoding="unicode"))
            if text:
                history.append(text)
    if number is None:
        raise RuntimeError(f"{page.url}: no stat_number")
    return {"number": number, "heading": heading or None, "text": "\n".join(lines), "history": "\n".join(history) or None}


def acquire(ctx: lib.RunContext) -> None:
    index = ctx.get(INDEX, fallback_fresh=True)
    flat = lib.html_text(index.body)
    statement = re.search(r"These statutes include amendments and new laws enacted during the[^\n]*", flat)
    ctx.edition(edition_label=None, currency_statement=statement.group(0) if statement else None, currency_source_url=INDEX)
    chapters = list(dict.fromkeys(re.findall(r'href="(/statutes/ksa_ch[0-9a-z]+\.html)"', index.text())))
    if len(chapters) < 60:
        raise RuntimeError(f"index lists {len(chapters)} chapters")
    if ctx.sample is not None:
        chapters = ["/statutes/ksa_ch60.html"]
    for link in chapters:
        if not ctx.want_more():
            break
        cpage = ctx.get(BASE + link, fallback_fresh=True)
        chapter, entries = chapter_toc(cpage)
        if ctx.sample is not None:
            entries = [e for e in entries if e[0] and e[0]["number"] == "5"]
        ctx.prefetch(e[3] for e in entries)  # retained runs: read ahead
        listed = {lib.norm_number(e[1]) for e in entries if e[1]}
        emitted: set[str] = set()
        for article, number, caption, url in entries:
            if not ctx.want_more():
                break
            page = ctx.get(url, fallback_fresh=True)
            parsed = parse_section(page)
            if number and lib.norm_number(number) != lib.norm_number(parsed["number"]):
                # The chapter list prints reserved ranges ("23-4,102 through 23-4,124. Reserved") and links them to the
                # next section's page. A reserved range is no section: skip it; the linked section is read from its
                # own entry (or here, once, when the list has none).
                if re.search(r"through.*Reserved", number, re.I) or re.search(r"Reserved", caption or "", re.I):
                    if lib.norm_number(parsed["number"]) in listed or lib.norm_number(parsed["number"]) in emitted:
                        continue
                else:
                    raise RuntimeError(f"{url} prints {parsed['number']!r}, chapter list says {number!r}")
            if lib.norm_number(parsed["number"]) in emitted:
                continue
            emitted.add(lib.norm_number(parsed["number"]))
            status = marker = None
            also: list[lib.Fetched] = []
            if not parsed["text"]:  # the history on the page ("Repealed, L. 1981, …"), else the chapter list's caption
                for part in (parsed["history"] or "").split(";"):
                    status, marker = lib.classify_status(part.strip(), None)
                    if status:
                        break
                if status is None:
                    status, marker = lib.classify_status(caption, None)
                    also = [cpage] if status else []
                status = status or "not_recorded"
            path = [s for s in (chapter, article) if s]
            ctx.section(code="KSA", number=parsed["number"], heading=parsed["heading"], text=parsed["text"],
                        history=parsed["history"], source=page, path=path, status=status, status_marker=marker,
                        also=also)
