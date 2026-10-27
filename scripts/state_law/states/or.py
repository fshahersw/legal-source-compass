"""Oregon — Oregon Revised Statutes, Legislative Counsel Committee (oregonlegislature.gov).

Source: the ORS page `https://www.oregonlegislature.gov/bills_laws/Pages/ORS.aspx?FollowSite=0` lists the titles with
their chapter ranges and carries the edition statement ("The 2025 Edition does not include changes to the law made by
the 2025 special session and the 2026 regular session ..."); each chapter is one HTML file
`https://www.oregonlegislature.gov/bills_laws/ors/ors<NNN>.html` (Word-exported, windows-1252). The first chapter of a
title prints the title's chapter list ("Chapter 12. …" then bare "14. …" lines, lettered chapters as "72A. …"); the
module reads the listed chapters plus every whole number of the title's range (unlisted "Former Provisions" chapters
print status entries only; numbers without a file answer 404 and are skipped; a listed chapter that is not served is
ledgered as unavailable). robots.txt places no restriction on these paths.

Parsing (`or-chapter-html/1`): a section starts at a paragraph whose bold run is `12.110 Actions for certain injuries
...` (number + catchline); the rest of that paragraph and the following paragraphs are its text, until the next bold
section, a centered group heading (e.g. `GENERAL PROVISIONS`) or a `Note:` paragraph
(Legislative Counsel notes and temporary provisions compiled as notes are not ORS sections and are not kept). The
bracketed source note that ends a section (`[Amended by 1957 c.374 §3; 1991 c.968 §2]`, `[2019 c.448 §2]`) is the
history. A bold number followed only by `[Repealed by 1973 c.731 §2]` is a status entry. Text is the 2025 Edition as
printed; later session-law changes are not in the edition (the currency statement says so).
"""
from __future__ import annotations

import html as _html
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

INDEX_URL = "https://www.oregonlegislature.gov/bills_laws/Pages/ORS.aspx?FollowSite=0"
ORS_BASE = "https://www.oregonlegislature.gov/bills_laws/ors/"
PARSER = "or-chapter-html/1"
SECTION = re.compile(r"^([0-9]+[A-Z]?\.[0-9]+[A-Za-z]?)(?:\s+(.*))?$", re.S)
HISTORY = re.compile(r"\s*(\[(?:[^\[\]]*?(?:\d{4} c\.|Formerly|Renumbered|Repealed|Amended|Subsection|Section|"
                     r"\d{4} s\.s\.)[^\[\]]*)\])\s*$")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="OR", code_name="Oregon Revised Statutes", publisher="Oregon Legislature, Legislative Counsel Committee",
        publisher_url=INDEX_URL, official_source=True, access="html", hosts=("www.oregonlegislature.gov",),
        codes=(lib.Code("ORS", "Oregon Revised Statutes", "Or. Rev. Stat. § {n}",
                        patterns=((r"^o\.?r\.?s\.?\s*(?:§\s*)?([0-9]+[a-z]?\.[0-9]+[a-z]?)$", r"\1"),
                                  (r"^or\. rev\. stat\.(?: ann\.)?\s*§\s*([0-9]+[a-z]?\.[0-9]+[a-z]?)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020); Legislative Counsel's "
                    "annotations and notes are not kept. robots.txt places no restriction on /bills_laws/ors/."),
        update_cadence=("A new ORS edition every odd year (the 2027 Edition 'in early 2028' per the publisher); "
                        "re-run when a new edition is posted."))


META = _meta()


def chapter_url(chapter: str) -> str:
    m = re.fullmatch(r"(\d+)([A-Za-z]*)", chapter)
    return f"{ORS_BASE}ors{int(m.group(1)):03d}{m.group(2).lower()}.html"


def parse_index(index_html: str):
    groups = []
    for m in re.finditer(r"Title Number\s*</a>\s*:\s*([0-9]+[A-Z]?)\.\s*(.*?)\s*-\s*Chapters?\s+([0-9]+[A-Z]?)"
                         r"(?:\s*-\s*([0-9]+[A-Z]?))?", index_html):
        groups.append({"title": m.group(1), "name": sb.one_line(_html.unescape(m.group(2))),
                       "start": m.group(3), "end": m.group(4) or m.group(3)})
    return groups


def title_chapters(raw: bytes):
    """Chapter numbers printed in a title's chapter list at the top of its first chapter file. The list prints
    "Chapter 1. Courts and Judicial Officers Generally" and then one bare "2. Supreme Court; Court of Appeals" line per
    further chapter (lettered chapters as "72A. …"), ending at a "_______________" rule."""
    text = lib.html_text(raw) if lib else sb.strip_tags(raw.decode("windows-1252", "replace"))
    out: list[str] = []
    in_list = False
    for line in text.split("\n"):
        line = line.strip()
        m = re.match(r"^Chapter\s+(\d+[A-Z]?)\.\s", line)
        if not m and in_list:
            m = re.match(r"^(\d+[A-Z]?)\.\s", line)
            if not m and line:
                break
        if m:
            in_list = True
            if m.group(1) not in out:
                out.append(m.group(1))
    return out


def title_chapter_numbers(group: dict, listed: list[str]) -> list[str]:
    """Every chapter to read for a title: the chapters its list prints, the title's first chapter (a "Former
    Provisions" chapter prints the list but is not in it), and every whole number in the title's printed range (former
    provisions chapters inside the range are not listed either). Numbers that have no file answer 404 and are skipped."""
    lo = int(re.match(r"\d+", group["start"]).group(0))
    hi = int(re.match(r"\d+", group["end"]).group(0))
    wanted = set(listed) | {group["start"]} | {str(n) for n in range(lo, hi + 1)}
    return sorted(wanted, key=sb.natural_key)


def parse_chapter(raw: bytes):
    doc = lxml_html.fromstring(raw.decode("windows-1252", errors="replace"))
    paras = doc.xpath("//body//p")
    sections, cur, group, mode = [], None, None, None
    chapter_heading = None
    started = False
    for p in paras:
        text = sb.el_text(p)
        one = sb.one_line(text)
        if not one:
            continue
        if chapter_heading is None:
            m = re.match(r"^Chapter\s+\S+\s+—\s+(.*)$", one)
            if m:
                chapter_heading = m.group(1)
                continue
        bold = p.xpath("./b|./span/b|./b/span")
        lead_bold = ""
        if bold:
            first_text = (p.text or "").strip()
            if not first_text:
                lead_bold = sb.one_line(bold[0].text_content())
        sm = SECTION.match(lead_bold) if lead_bold else None
        if sm:
            if cur:
                sections.append(cur)
            started = True
            rest = one[len(lead_bold):].strip() if one.startswith(lead_bold) else one.split(lead_bold, 1)[-1].strip()
            heading = (sm.group(2) or "").strip() or None
            cur = {"number": sm.group(1), "heading": heading, "lines": [rest] if rest else [], "group": group}
            mode = "text"
            continue
        centered = (p.get("align") == "center") or "text-align:center" in (p.get("style") or "").replace(" ", "")
        if started and centered and not re.search(r"[a-z]", one) and not one.startswith("("):
            if cur:
                sections.append(cur)
                cur = None
            group = one
            mode = None
            continue
        if cur is None:
            continue
        if one.startswith("Note:") or one.startswith("Note "):
            mode = "note"
            continue
        if mode == "text":
            cur["lines"].append(text)
    if cur:
        sections.append(cur)
    out = []
    for s in sections:
        body = sb.ws("\n".join(s["lines"]))
        status = sb.marker_status(s["heading"], body)[0]
        history = None
        whole = re.fullmatch(r"\[([^\[\]]*)\]", body)
        if not status and whole and not s["heading"]:
            # "12.133 [1983 c.589 §2; repealed by 1999 c.130 §1]": the bracket is the entry's status marker
            word = re.search(r"\b(repealed|renumbered|transferred|expired)\b", whole.group(1), re.I)
            if word:
                out.append({"number": s["number"], "heading": None, "text": "", "history": None, "group": s["group"],
                            "status": word.group(1).lower(), "marker": body})
                continue
        if not status:
            m = HISTORY.search(body)
            if m:
                history = m.group(1)
                body = body[:m.start()].rstrip()
        out.append({"number": s["number"], "heading": s["heading"], "text": body, "history": history,
                    "group": s["group"]})
    return {"heading": chapter_heading, "sections": out}


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    index = ctx.get(INDEX_URL)
    page = lib.norm_ws(lib.html_text(index.body))
    m = re.search(r"The 20\d\d Edition does not include changes to the law .*?for the most up-to-date version of the "
                  r"law\.", page)
    edition = re.search(r"Oregon Revised Statutes \(ORS\) - (20\d\d Edition)", page)
    ctx.edition(edition_label=edition.group(1) if edition else None, currency_statement=m.group(0) if m else None,
                currency_source_url=INDEX_URL)
    groups = parse_index(index.text())
    ctx.log(f"{len(groups)} title groups on the ORS page")
    for g in groups:
        if only and not any(sb.natural_key(g["start"]) <= sb.natural_key(c) <= sb.natural_key(g["end"]) for c in only):
            continue
        first = ctx.get(chapter_url(g["start"]), fallback_fresh=True, accept_status=(200, 404))
        listed = title_chapters(first.body) if first.status == 200 else []
        if not listed:
            ctx.log(f"title {g['title']}: no chapter list printed on chapter {g['start']}; reading its whole range")
        chapters = title_chapter_numbers(g, listed)
        if only:
            chapters = [c for c in chapters if c in only]
        for chapter in chapters:
            if chapter == g["start"]:
                fetched = first
            else:
                fetched = ctx.get(chapter_url(chapter), fallback_fresh=True, accept_status=(200, 404))
            if fetched.status != 200:
                if chapter in listed:
                    # a chapter the title list prints but the publisher does not serve is ledgered, never dropped
                    # silently; load.py refuses the edition until the gap is accepted and named in its note
                    url = chapter_url(chapter)
                    ctx._rejects.write({"state": "OR", "code": "ORS", "number": None,
                                        "reason": f"unavailable: {url} returned HTTP {fetched.status}",
                                        "source_url": url, "source_sha256": None})
                continue
            parsed = parse_chapter(fetched.body)
            counts: dict[str, int] = {}
            for s in parsed["sections"]:
                counts[s["number"]] = counts.get(s["number"], 0) + 1
            seen: dict[str, int] = {}
            for s in parsed["sections"]:
                if s.get("status"):
                    status = {"status": s["status"], "status_marker": s["marker"], "status_basis": "publisher_marker"}
                else:
                    status = sb.status_kwargs(s["heading"], s["text"])
                if status is None:
                    ctx.log(f"ORS {s['number']}: no text and no marker; skipped")
                    continue
                index_ = None
                if counts[s["number"]] > 1:
                    seen[s["number"]] = seen.get(s["number"], 0) + 1
                    index_ = seen[s["number"]]
                path = [{"level": "title", "label": "Title", "number": g["title"], "heading": g["name"]},
                        {"level": "chapter", "label": "Chapter", "number": chapter, "heading": parsed["heading"]}]
                # Centered group headings (e.g. GENERAL PROVISIONS) are unnumbered; lib.node_id gives unnumbered
                # steps a position-based id, so two groups in one chapter would collide. Kept out of the path.
                ctx.section(code="ORS", number=s["number"], heading=s["heading"], text=s["text"], path=path,
                            source=fetched, history=s["history"], version_index=index_, **status)
                if not ctx.want_more():
                    return
