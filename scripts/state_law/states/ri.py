"""Rhode Island — General Laws of Rhode Island, Rhode Island General Assembly (webserver.rilegislature.gov).

Source: `https://webserver.rilegislature.gov/Statutes/Statutes.html` lists the titles (`TITLE<n>/INDEX.HTM`); each
title index lists its chapters (`<ch>/INDEX.htm`); each chapter index lists its sections (`<section>.htm`), one page
per section. No robots.txt (HTTP 404). About 33,000 section pages. The publisher prints no currency line.

Parsing (`ri-section-page/1`): `<h1>` "Title 9 / Courts and Civil Procedure — Procedure Generally", `<h2>` "Chapter 1 /
Causes of Action", the first bold paragraph `§ 9-1-14. Limitation of actions ...` (number, catchline), the following
paragraphs = text, and the `History of Section.` block = history. A catchline that is a marker with no text
("Repealed.", "[Reserved.]") is a status entry.
"""
from __future__ import annotations

import re
import sys
import urllib.parse
from pathlib import Path

from lxml import html as lxml_html

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

BASE = "https://webserver.rilegislature.gov/Statutes/"
INDEX = BASE + "Statutes.html"
PARSER = "ri-section-page/1"
HEAD = re.compile(r"^§+\s*([0-9]+[A-Z0-9]*(?:\.[0-9A-Z]+)*-[0-9A-Z]+(?:\.[0-9A-Z]+)*-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)\.?\s*(.*)$",
                  re.S)


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="RI", code_name="General Laws of Rhode Island", publisher="Rhode Island General Assembly",
        publisher_url=INDEX, official_source=True, access="html", hosts=("webserver.rilegislature.gov",),
        codes=(lib.Code("RIGL", "General Laws of Rhode Island", "R.I. Gen. Laws § {n}",
                        patterns=((r"^r\.?i\.? gen\.? laws(?: ann\.)?\s*§\s*([0-9][0-9a-z.]*-[0-9a-z.]+-[0-9a-z.]+)$", r"\1"),
                                  (r"^r\.?i\.?g\.?l\.?\s*(?:§\s*)?([0-9][0-9a-z.]*-[0-9a-z.]+-[0-9a-z.]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note="Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). No robots.txt.",
        update_cadence="Sections are posted as public laws are compiled after each session; re-run each autumn and "
                       "quarterly.")


META = _meta()


def parse_section_page(raw: bytes):
    doc = lxml_html.fromstring(raw.decode("utf-8", errors="replace"))
    h1 = doc.xpath("//h1")
    h2 = doc.xpath("//h2")

    def split(el, word):
        if not el:
            return None, None
        parts = [sb.one_line(x) for x in el[0].xpath(".//text()") if sb.one_line(x)]
        m = re.match(rf"^{word}\s+(\S+)$", parts[0]) if parts else None
        return (m.group(1) if m else None), (" ".join(parts[1:]) or None)

    title_no, title_head = split(h1, "Title")
    chapter_no, chapter_head = split(h2, "Chapter")
    body = None
    for div in doc.xpath("//body/div"):
        if div.xpath("./p/b"):
            body = div
            break
    if body is None:
        return None
    paras = body.xpath("./p")
    head = sb.one_line(paras[0].text_content()) if paras else ""
    m = HEAD.match(head)
    if not m:
        return None
    lines = []
    for p in paras[1:]:
        text = sb.one_line(sb.el_text(p))
        if text:
            lines.append(text)
    for table in body.xpath("./table"):
        text = sb.el_text(table)
        if text:
            lines.append(text)
    history = None
    for div in body.xpath("./div"):
        t = sb.one_line(div.text_content())
        if t.startswith("History of Section."):
            history = t[len("History of Section."):].strip() or None
    return {"number": m.group(1), "heading": m.group(2).strip() or None, "text": "\n".join(lines),
            "history": history, "title": (title_no, title_head), "chapter": (chapter_no, chapter_head)}


def hrefs(html: str, pattern: str):
    out = []
    for h in re.findall(r'href="([^"]+)"', html, re.I):
        if re.search(pattern, h, re.I) and h not in out:
            out.append(h)
    return out


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]   # e.g. 9-1
    index = ctx.get(INDEX, fallback_fresh=True)
    ctx.edition(edition_label="General Laws of Rhode Island", currency_statement=None, currency_source_url=None)
    titles = hrefs(index.text(), r"TITLE[0-9A-Z.]+/INDEX\.HTM$")
    for t in titles:
        title_url = urllib.parse.urljoin(INDEX, t.replace("//Statutes", "/Statutes"))
        title_url = re.sub(r"^http://", "https://", title_url)
        if only and not any(re.search(rf"/TITLE{re.escape(c.split('-')[0])}/", title_url) for c in only):
            continue
        tpage = ctx.get(title_url, fallback_fresh=True)
        for c in hrefs(tpage.text(), r"^[0-9A-Z.\-]+/INDEX\.htm$"):
            if only and c.split("/")[0] not in only:
                continue
            chap_url = urllib.parse.urljoin(title_url, c)
            cpage = ctx.get(chap_url, fallback_fresh=True)
            ctx.prefetch(urllib.parse.urljoin(chap_url, s) for s in hrefs(cpage.text(), r"^[0-9A-Za-z.\-]+\.htm$")
                         if s.upper() != "INDEX.HTM")  # retained runs: read ahead
            for s in hrefs(cpage.text(), r"^[0-9A-Za-z.\-]+\.htm$"):
                if s.upper() == "INDEX.HTM":
                    continue
                fetched = ctx.get(urllib.parse.urljoin(chap_url, s), fallback_fresh=True)
                parsed = parse_section_page(fetched.body)
                if parsed is None:
                    ctx.log(f"{s}: no section heading printed; skipped")
                    continue
                status = sb.status_kwargs(parsed["heading"], parsed["text"])
                if status is None:
                    ctx.log(f"R.I. Gen. Laws § {parsed['number']}: no text and no marker; skipped")
                    continue
                heading = parsed["heading"]
                if status["status"] != "in_force" and status["status_marker"] == heading:
                    heading = None
                path = [{"level": "title", "label": "Title", "number": parsed["title"][0], "heading": parsed["title"][1]},
                        {"level": "chapter", "label": "Chapter", "number": parsed["chapter"][0],
                         "heading": parsed["chapter"][1]}]
                ctx.section(code="RIGL", number=parsed["number"], heading=heading, text=parsed["text"], path=path,
                            source=fetched, history=parsed["history"], **status)
                if not ctx.want_more():
                    return
