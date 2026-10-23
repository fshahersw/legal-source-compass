"""Missouri — Revised Statutes of Missouri, Missouri Revisor of Statutes (revisor.mo.gov).

Source: the Revisor's home page `https://revisor.mo.gov/main/Home.aspx` lists every chapter
(`OneChapter.aspx?chapter=N`); `https://revisor.mo.gov/main/ViewChapter.aspx?chapter=N` prints a whole chapter. The
home page states: "In accordance with Section 3.090, the language of statutory sections enacted during a legislative session are updated and available
on this website on the effective date of such enacted statutory section." and "CERTIFICATION STATUS: Currently the
statutes posted on this website are uncertified and unofficial" — both are kept verbatim in the currency statement.
No robots.txt (the site answers its home page).

Parsing (`mo-viewchapter-html/1`): each section is a `<div class="norm">` whose first paragraph opens with the bold
`516.120.  What actions within five years.  —` heading. Paragraphs of that div are the text; the footnote block
(`<div class="foot">`) is not text: of it only the publisher's source/history lines (`(RSMo 1939 § 1014)`,
`(L. 1990 H.B. 974)`, `Prior revisions: ...`) are kept as `history`; case annotations, cross references and
revisor's notes are dropped (annotations are not kept). The dark-green separator line after each section
(`516.110 8/28/1939`) is the date the publisher prints for that version: `effective.start`, and
`future_effective` when it is later than the run date.
"""
from __future__ import annotations

import re
import time
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

HOME_URL = "https://revisor.mo.gov/main/Home.aspx"
CHAPTER_URL = "https://revisor.mo.gov/main/ViewChapter.aspx?chapter={}"
SECTION_PAGE = "https://revisor.mo.gov/main/OneSection.aspx?section={}"
PARSER = "mo-viewchapter-html/1"
# "537.090." and the UCC chapter's "400.2-313." / "400.4A-101." (chapter.article-section)
NUM = r"\d+\.\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?"
HEAD = re.compile(rf"^({NUM})\.\s*(.*?)\s*—?\s*$", re.S)
HISTORY = re.compile(r"^(\((?:RSMo|L\.|A\.L\.|CC\b|R\.S\.|Laws|Amended|Transferred|Repealed|Formerly)|Prior revisions:)")
DATE_LINE = re.compile(rf"-{{5,}}\s*({NUM})\s+(\d{{1,2}})/(\d{{1,2}})/(\d{{4}})\s*-{{5,}}")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="MO", code_name="Revised Statutes of Missouri", publisher="Missouri Revisor of Statutes (Committee on Legislative Research)",
        publisher_url=HOME_URL, official_source=True, access="html", hosts=("revisor.mo.gov",),
        codes=(lib.Code("RSMO", "Revised Statutes of Missouri", "Mo. Rev. Stat. § {n}",
                        patterns=((r"^(?:§\s*)?([0-9]+\.[0-9]+[a-z]?),?\s*rsmo(?:\s*(?:supp\.\s*)?\d{4})?$", r"\1"),
                                  (r"^rsmo\.?\s*§?\s*([0-9]+\.[0-9]+[a-z]?)$", r"\1"),
                                  (r"^mo\. ann\. stat\.\s*§\s*([0-9]+\.[0-9]+[a-z]?)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). The Revisor states the "
                    "posted statutes are uncertified and unofficial; it is nonetheless the state's own publisher and "
                    "updates sections on their effective dates. No robots.txt."),
        update_cadence="Sections change on their effective dates (usually August 28 and January 1); re-run monthly "
                       "and right after August 28.")


META = _meta()


def parse_chapter(raw: bytes, chapter: str, run_date: str):
    doc = lxml_html.fromstring(raw)
    text_all = raw.decode("utf-8", errors="replace")
    dates: dict[str, list[str]] = {}
    for m in DATE_LINE.finditer(text_all.replace(" ", " ")):
        dates.setdefault(m.group(1), []).append(f"{int(m.group(4)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}")
    used: dict[str, int] = {}
    out = []
    for div in doc.xpath('//div[contains(concat(" ", normalize-space(@class), " "), " norm ")]'):
        if div.xpath('ancestor::div[contains(concat(" ", normalize-space(@class), " "), " norm ")]'):
            continue
        first = div.xpath('./p[contains(concat(" ", normalize-space(@class), " "), " norm ")][1]')
        if not first:
            continue
        bold = first[0].xpath('./span[@class="bold"]')
        if not bold:
            continue
        head_text = sb.one_line(bold[0].text_content())
        m = HEAD.match(head_text)
        if not m:
            continue
        number = m.group(1)
        heading = m.group(2).strip().rstrip("—").strip() or None
        lines = []
        lead = sb.one_line(first[0].text_content())
        if lead.startswith(head_text):
            lead = lead[len(head_text):]
        lead = lead.lstrip("—").strip()
        if lead:
            lines.append(lead)
        history = []
        for child in div:
            if not isinstance(child.tag, str) or child is first[0]:
                continue
            classes = (child.get("class") or "").split()
            if child.tag == "div" and "foot" in classes:
                for p in child.xpath(".//p"):
                    line = sb.one_line(p.text_content()).replace("­", "")
                    if HISTORY.match(line):
                        history.append(line)
                continue
            text = sb.el_text(child).replace("­", "")
            if text:
                lines.append(text)
        k = used.get(number, 0)
        used[number] = k + 1
        date = dates.get(number, [None] * (k + 1))[k] if len(dates.get(number, [])) > k else None
        out.append({"number": number, "heading": heading, "text": sb.ws("\n".join(lines)),
                    "history": "\n".join(history) or None, "date": date})
    return out


def list_chapters(home_html: str):
    """[(chapter, chapter_name, title_number, title_name)] in the home page's order."""
    import html as _html

    out, seen = [], set()
    for block in re.findall(r"<details\b.*?</details>", home_html, re.S):
        summary = re.search(r"<summary[^>]*>(.*?)</summary>", block, re.S)
        label = sb.one_line(_html.unescape(re.sub(r"<[^>]+>", " ", summary.group(1)))) if summary else ""
        tm = re.match(r"^Chs?\.\s*\S+\s+([IVXLC]+)\s+(.*)$", label)
        for c, name in re.findall(r'/main/OneChapter\.aspx\?chapter=([0-9A-Za-z]+)"[^>]*>(.*?)</a>', block, re.S):
            if c in seen:
                continue
            seen.add(c)
            name = sb.one_line(_html.unescape(re.sub(r"<[^>]+>", " ", name)))
            name = re.sub(r"^" + re.escape(c) + r"\s+", "", name) or None
            out.append((c, name, tm.group(1) if tm else None, tm.group(2) if tm else None))
    return out


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    run_date = ctx.today.isoformat()
    home = ctx.get(HOME_URL)
    page = lib.html_text(home.body)
    parts = []
    m = re.search(r"In accordance with Section 3\.090, the language of statutory sections enacted during a legislative "
                  r"session are updated and available on this website on the effective date of such enacted statutory "
                  r"section\.", lib.norm_ws(page))
    if m:
        parts.append(m.group(0))
    m = re.search(r"CERTIFICATION STATUS:\s*Currently the statutes posted on this website are uncertified and "
                  r"unofficial(?: \(see FAQ for more information\))?\.?", lib.norm_ws(page))
    if m:
        parts.append(m.group(0))
    ctx.edition(edition_label="Revised Statutes of Missouri", currency_statement=" ".join(parts) or None,
                currency_source_url=HOME_URL)
    chapters = list_chapters(home.text())
    if only:
        chapters = [c for c in chapters if c[0] in only]
    ctx.log(f"{len(chapters)} chapters listed on the home page")
    for chapter, chapter_name, title_no, title_name in chapters:
        path = ([{"level": "title", "label": "Title", "number": title_no, "heading": title_name}] if title_no else [])
        path.append({"level": "chapter", "label": "Chapter", "number": chapter, "heading": chapter_name})
        fetched = ctx.get(CHAPTER_URL.format(chapter))
        for wait in (10, 30, 60):
            if "LoadChap.aspx" not in (fetched.final_url or ""):
                break
            # a chapter the revisor is still assembling is answered with a short LoadChap.aspx page (chapters 95 and 227
            # on 2026-10-23): ask again later instead of reading it as a chapter with no sections
            ctx.log(f"chapter {chapter}: the publisher answered with its loading page; asking again in {wait}s")
            time.sleep(wait)
            fetched = ctx.get(CHAPTER_URL.format(chapter))
        if "LoadChap.aspx" in (fetched.final_url or ""):
            raise RuntimeError(f"chapter {chapter}: the publisher kept answering with its loading page")
        sections = parse_chapter(fetched.body, chapter, run_date)
        if not sections:
            ctx.log(f"chapter {chapter}: no sections printed")
            continue
        counts: dict[str, int] = {}
        for s in sections:
            counts[s["number"]] = counts.get(s["number"], 0) + 1
        seen: dict[str, int] = {}
        for s in sections:
            effective = {"start": s["date"], "end": None, "note": None} if s["date"] else None
            if s["date"] and s["date"] > run_date:
                status = {"status": "future_effective", "status_basis": "publisher_marker",
                          "status_marker": f"{s['number']} {int(s['date'][5:7])}/{int(s['date'][8:10])}/{s['date'][:4]}"}
            else:
                status = sb.status_kwargs(s["heading"], s["text"])
            if status is None:
                ctx.log(f"RSMo {s['number']}: no text and no marker; skipped")
                continue
            heading = s["heading"]
            if status["status"] not in ("in_force", "future_effective") and status["status_marker"] == heading:
                heading = None
            index = None
            if counts[s["number"]] > 1:
                seen[s["number"]] = seen.get(s["number"], 0) + 1
                index = seen[s["number"]]
            ctx.section(code="RSMO", number=s["number"], heading=heading, text=s["text"],
                        path=path,
                        source=dict(fetched.source(), display_url=SECTION_PAGE.format(s["number"])),
                        history=s["history"], effective=effective, version_index=index,
                        version=(f"{s['number']} {int(s['date'][5:7])}/{int(s['date'][8:10])}/{s['date'][:4]}"
                                 if index and s["date"] else None), **status)
            if not ctx.want_more():
                return
