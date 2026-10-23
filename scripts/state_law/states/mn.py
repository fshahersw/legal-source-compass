"""Minnesota — Minnesota Statutes, Office of the Revisor of Statutes (revisor.mn.gov).

Source: `https://www.revisor.mn.gov/statutes/` (page heading "2025 Minnesota Statutes") lists the parts; each part
page (`/statutes/part/<NAME>`) lists its chapters; `https://www.revisor.mn.gov/statutes/cite/<ch>/full` prints a whole
chapter. robots.txt disallows only /alpha/, /beta/ and search-result paths.

Parsing (`mn-chapter-full/1`): `<h2 class="chapter_title">CHAPTER 541. LIMITATION OF TIME, COMMENCING ACTIONS</h2>`;
each section is `<div class="section" id="stat.541.05">` with `<h1 class="shn">541.05 VARIOUS CASES, SIX YEARS.</h1>`,
subdivisions (`Subdivision 1.` + headnote, printed by the Revisor and kept as text lines) and paragraphs; the
`<div class="history">` that follows is the history. Status-only rows are `<div class="sr"><b>541.11</b> MS 1949
[Repealed, 1953 c 378 s 5]</div>`: the bracketed marker sets `repealed`/`expired`/`renumbered`/`transferred`/
`reserved`; `[Obsolete]` and other markers outside the shared status set are kept verbatim with status
`not_recorded` (basis `publisher_marker`).
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

INDEX_URL = "https://www.revisor.mn.gov/statutes/"
FULL_URL = "https://www.revisor.mn.gov/statutes/cite/{}/full"
SECTION_PAGE = "https://www.revisor.mn.gov/statutes/cite/{}"
PARSER = "mn-chapter-full/1"
STATUS_WORDS = {"repealed": "repealed", "expired": "expired", "renumbered": "renumbered", "transferred": "transferred",
                "reserved": "reserved", "vacant": "reserved"}


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="MN", code_name="Minnesota Statutes", publisher="Minnesota Office of the Revisor of Statutes",
        publisher_url=INDEX_URL, official_source=True, access="html", hosts=("www.revisor.mn.gov",),
        codes=(lib.Code("MS", "Minnesota Statutes", "Minn. Stat. § {n}",
                        patterns=((r"^minn\. stat\.(?: ann\.)?\s*§\s*([0-9]+[a-z]?\.[0-9a-z]+)$", r"\1"),
                                  (r"^m\.\s?s\.a?\.?\s*(?:§\s*)?([0-9]+[a-z]?\.[0-9a-z]+)$", r"\1"),
                                  (r"^minnesota statutes,? section\s*([0-9]+[a-z]?\.[0-9a-z]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt disallows only "
                    "/alpha/, /beta/ and search result paths."),
        update_cadence=("A full edition every odd year and a supplement in even years, plus section updates as laws "
                        "take effect; re-run after each edition/supplement and quarterly."))


META = _meta()


def _status_row(div):
    number = sb.one_line(div.xpath("string(./b)"))
    rest = sb.one_line(div.text_content())
    if rest.startswith(number):
        rest = rest[len(number):].strip()
    m = re.search(r"\[([A-Za-z]+)\b[^\]]*\]", rest)
    marker = m.group(0) if m else rest
    word = m.group(1).lower() if m else ""
    status = STATUS_WORDS.get(word, "not_recorded")
    return number, rest, status, marker


def parse_chapter(raw: bytes):
    doc = lxml_html.fromstring(raw)
    title = doc.xpath('//h2[@class="chapter_title"]')
    heading = None
    if title:
        m = re.match(r"^CHAPTER\s+\S+?\.\s*(.*)$", sb.one_line(title[0].text_content()))
        heading = m.group(1) if m else None
    out = []
    root = doc.xpath('//*[@id="xtend"]')
    scope = root[0] if root else doc
    for div in scope.xpath('.//div[@class="section" or @class="sr"]'):
        if div.get("class") == "sr":
            number, rest, status, marker = _status_row(div)
            out.append({"number": number, "heading": None, "text": "", "history": None, "status": status,
                        "marker": marker, "row": rest})
            continue
        shn = div.xpath('./h1[@class="shn"]')
        if not shn:
            continue
        head = sb.one_line(shn[0].text_content())
        sid = (div.get("id") or "").removeprefix("stat.")
        number = sid if head.startswith(sid) else head.split()[0]
        sec_heading = head[len(number):].strip() or None
        lines = []
        for el in div.iter("p", "h2", "h3", "table"):
            if el.xpath("ancestor::table"):
                continue                       # table cells are read with their table
            for a in el.xpath('.//a[@class="permalink"]'):
                a.drop_tree()
            text = sb.el_text(el)
            if text:
                lines.append(text)
        hist = div.getnext()
        history = None
        if hist is not None and hist.get("class") == "history":
            history = sb.one_line(hist.text_content())
            history = re.sub(r"^History:\s*", "", history) or None
        out.append({"number": number, "heading": sec_heading, "text": sb.ws("\n".join(lines)), "history": history})
    return {"heading": heading, "sections": out}


def list_parts(index_html: str):
    seen, out = set(), []
    for href in re.findall(r'href="(https://www\.revisor\.mn\.gov/statutes/part/[^"]+)"', index_html):
        if href not in seen:
            seen.add(href)
            out.append(href)
    return out


def list_chapters(part_html: str):
    import html as _html

    out = []
    for ch, name in re.findall(r'href="https://www\.revisor\.mn\.gov/statutes/cite/([0-9A-Z]+)">[^<]*</a></td>\s*'
                               r'<td>([^<]*)</td>', part_html):
        out.append((ch, sb.one_line(_html.unescape(name)) or None))
    return out


def acquire(ctx):
    import html as _html
    import urllib.parse

    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    index = ctx.fetch(INDEX_URL)
    h1 = re.findall(r"<h1[^>]*>(.*?)</h1>", index.text(), re.S)
    label = next((sb.one_line(re.sub(r"<[^>]+>", "", h)) for h in h1 if "Minnesota Statutes" in h), None)
    ctx.edition(edition_label=label, currency_statement=label, currency_source_url=INDEX_URL)
    parts = list_parts(index.text())
    wanted_parts = [p.strip().upper() for p in options.get("parts", "").split("|") if p.strip()]
    for part_url in parts:
        part_name = sb.one_line(_html.unescape(urllib.parse.unquote_plus(urllib.parse.unquote(
            part_url.rsplit("/part/", 1)[1]))))
        if wanted_parts and part_name.upper() not in wanted_parts:
            continue
        part = ctx.fetch(part_url)
        chapters = list_chapters(part.text())
        if only:
            chapters = [c for c in chapters if c[0] in only]
        for chapter, chapter_name in chapters:
            fetched = ctx.fetch(FULL_URL.format(chapter))
            parsed = parse_chapter(fetched.body)
            path = [{"level": "part", "label": "Part", "number": None, "heading": part_name},
                    {"level": "chapter", "label": "Chapter", "number": chapter,
                     "heading": parsed["heading"] or chapter_name}]
            counts: dict[str, int] = {}
            for s in parsed["sections"]:
                counts[s["number"]] = counts.get(s["number"], 0) + 1
            seen: dict[str, int] = {}
            for s in parsed["sections"]:
                if "status" in s:
                    status = {"status": s["status"], "status_marker": s["marker"], "status_basis": "publisher_marker"}
                else:
                    status = sb.status_kwargs(s["heading"], s["text"])
                if status is None:
                    ctx.log(f"Minn. Stat. § {s['number']}: no text and no marker; skipped")
                    continue
                index_ = None
                if counts[s["number"]] > 1:
                    seen[s["number"]] = seen.get(s["number"], 0) + 1
                    index_ = seen[s["number"]]
                ctx.section(code="MS", number=s["number"], heading=s["heading"], text=s["text"], path=path,
                            source=dict(fetched.source(), display_url=SECTION_PAGE.format(s["number"])),
                            history=s["history"], version_index=index_, **status)
                if not ctx.want_more():
                    return
