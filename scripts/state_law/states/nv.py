"""Nevada — Nevada Revised Statutes, Legislative Counsel Bureau (leg.state.nv.us).

Source: `https://www.leg.state.nv.us/NRS/` ("NEVADA REVISED STATUTES — TABLE OF TITLES AND CHAPTERS") links one
windows-1252 HTML file per chapter (`NRS-011.html`, `NRS-001A.html` ...). Each chapter file carries the Bureau's
revision stamp (`[Rev. 4/15/2026 10:40:13 AM--2025]`), kept on the source record as `page_revised`; the index prints
no code-wide currency line. robots.txt disallows only report/exhibit/opinion paths.

Parsing (`nv-chapter-html/1`): `p.Chapter` ("CHAPTER 11 - LIMITATION OF ACTIONS"); `p.DocHeading` lines are group
headings; a section starts at a `p.SectBody` that carries `span.Section` (number) and `span.Leadline` (catchline);
following `p.SectBody` paragraphs are text; `p.SourceNote` (`[1911 CPA § 24; RL § 4966; NCL § 8523]`) is the
history. The table of contents (`COHead2`/`COLeadline`) is skipped. The Wingdings flush-left glyph the Bureau uses
before a continuation paragraph is layout, not text, and is dropped. Repealed sections are not printed in chapter
files (they live in the Bureau's separate repealed-sections tables), so status comes only from printed markers.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from lxml import html as lxml_html

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

INDEX_URL = "https://www.leg.state.nv.us/NRS/"
PARSER = "nv-chapter-html/1"
REV = re.compile(r"\[Rev\.\s*([^\]]+?)\]")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="NV", code_name="Nevada Revised Statutes", publisher="Nevada Legislature, Legislative Counsel Bureau",
        publisher_url=INDEX_URL, official_source=True, access="html", hosts=("www.leg.state.nv.us",),
        codes=(lib.Code("NRS", "Nevada Revised Statutes", "Nev. Rev. Stat. § {n}",
                        patterns=((r"^n\.?r\.?s\.?\s*(?:§\s*)?([0-9]+[a-z]?\.[0-9]+[a-z]?)$", r"\1"),
                                  (r"^nev\. rev\. stat\.(?: ann\.)?\s*§\s*([0-9]+[a-z]?\.[0-9]+[a-z]?)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt disallows only "
                    "report, exhibit and opinion paths."),
        update_cadence=("Chapters are reissued after each regular session (the revision stamp names the session "
                        "year); re-run after each session's reissue and quarterly."))


META = _meta()


def _drop_glyphs(p):
    for span in p.xpath('.//span[contains(@style, "Wingdings")]'):
        span.drop_tree()


def parse_chapter(raw: bytes):
    doc = lxml_html.fromstring(raw.decode("windows-1252", errors="replace"))
    rev = REV.search(sb.one_line(doc.text_content()))
    chapter = doc.xpath('//p[@class="Chapter"]')
    heading = None
    if chapter:
        m = re.match(r"^CHAPTER\s+\S+\s+-\s+(.*)$", sb.one_line(chapter[0].text_content()))
        heading = m.group(1) if m else None
    sections, cur, group = [], None, None
    for p in doc.xpath("//body//p"):
        cls = p.get("class") or ""
        if cls == "DocHeading":
            if cur:
                sections.append(cur)
                cur = None
            group = sb.one_line(p.text_content()) or None
            continue
        if cls == "SourceNote":
            if cur is not None:
                cur["history"].append(sb.one_line(p.text_content()))
            continue
        if cls != "SectBody":
            continue
        _drop_glyphs(p)
        number_span = p.xpath('./span[@class="Section"]')
        if number_span:
            if cur:
                sections.append(cur)
            lead = p.xpath('./span[@class="Leadline"]')
            number = sb.one_line(number_span[0].text_content())
            catch = sb.one_line(lead[0].text_content()) if lead else None
            last = lead[0] if lead else number_span[0]
            rest = []
            for sib in last.itersiblings():
                if sib.get("class") == "Empty" and not rest:
                    if sib.tail:
                        rest.append(sib.tail)
                    continue
                rest.append(sb.el_text(sib) if isinstance(sib.tag, str) else "")
                if sib.tail:
                    rest.append(sib.tail)
            if last.tail:
                rest.insert(0, last.tail)
            first = sb.one_line("".join(rest).replace("\u2002", " "))
            cur = {"number": number, "heading": catch, "lines": [first] if first else [], "history": [], "group": group}
            continue
        if cur is not None:
            text = sb.one_line(sb.el_text(p).replace("\u2002", " "))
            if text:
                cur["lines"].append(text)
    if cur:
        sections.append(cur)
    out = [{"number": s["number"], "heading": s["heading"], "text": "\n".join(s["lines"]),
            "history": "\n".join(s["history"]) or None, "group": s["group"]} for s in sections]
    return {"heading": heading, "revised": rev.group(1) if rev else None, "sections": out}


def list_chapters(index_html: str):
    """[(chapter, href, name, title_no, title_name)] in index order."""
    import html as _html

    out, title = [], (None, None)
    pattern = re.compile(r'<h3[^>]*>\s*TITLE\s+(\S+)\s+—\s+([^<]+?)\s*</h3>|'
                         r'<a href="(NRS-0*([0-9]+[A-Z]?)\.html)">([^<]*)</a>\s*(?:—\s*([^<]+?))?\s*</li>')
    for m in pattern.finditer(index_html):
        if m.group(1):
            title = (m.group(1), sb.one_line(_html.unescape(m.group(2))))
            continue
        num = m.group(4)
        if any(num == c[0] for c in out):
            continue
        name = sb.one_line(_html.unescape(m.group(6) or m.group(5) or "")) or None
        out.append((num, m.group(3), name, title[0], title[1]))
    return out


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    index = ctx.get(INDEX_URL)
    ctx.edition(edition_label="Nevada Revised Statutes", currency_statement=None, currency_source_url=None)
    chapters = list_chapters(index.text())
    if only:
        chapters = [c for c in chapters if c[0] in only]
    ctx.log(f"{len(chapters)} chapters listed")
    for number, href, name, title_no, title_name in chapters:
        fetched = ctx.get(INDEX_URL + href)
        parsed = parse_chapter(fetched.body)
        path = []
        if title_no:
            path.append({"level": "title", "label": "Title", "number": title_no, "heading": title_name})
        path.append({"level": "chapter", "label": "Chapter", "number": number, "heading": parsed["heading"] or name})
        counts: dict[str, int] = {}
        for s in parsed["sections"]:
            counts[s["number"]] = counts.get(s["number"], 0) + 1
        seen: dict[str, int] = {}
        for s in parsed["sections"]:
            status = sb.status_kwargs(s["heading"], s["text"])
            if status is None:
                ctx.log(f"NRS {s['number']}: no text and no marker; skipped")
                continue
            index_ = None
            if counts[s["number"]] > 1:
                seen[s["number"]] = seen.get(s["number"], 0) + 1
                index_ = seen[s["number"]]
            # the page anchors "NRS388DSec010" for 388D.010; a number printed without a period gets the page itself
            fragment = s["number"].split(".", 1)[1] if "." in s["number"] else None
            if fragment is None:
                ctx.log(f"NRS {s['number']!r} ({href}): no period in the number; linked to the chapter page")
            source = dict(fetched.source(), page_revised=parsed["revised"],
                          display_url=f"{INDEX_URL}{href}#NRS{href[4:-5]}Sec{fragment}" if fragment else f"{INDEX_URL}{href}")
            ctx.section(code="NRS", number=s["number"], heading=s["heading"], text=s["text"], path=path,
                        source=source, history=s["history"], version_index=index_, **status)
            if not ctx.want_more():
                return
