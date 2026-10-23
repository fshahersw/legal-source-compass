"""Nebraska — Revised Statutes of Nebraska, Revisor of Statutes (nebraskalegislature.gov).

Source: `https://nebraskalegislature.gov/laws/browse-statutes.php` ("Nebraska Revised Statutes by Chapter") links each
chapter's full printout `https://nebraskalegislature.gov/laws/display-chapters.php?chapter=<n>` (every section with
its text, source note, cross references and annotations). robots.txt asks for `Crawl-delay: 3` (honored) and
disallows only search pages.

Parsing (`ne-display-chapter/1`): one `<div class="printwidth">` per section: `<strong>25-101. Civil action.</strong>`
(number, catchline), `<p>` paragraphs = text, `<div class="source">` = history ("Source: ..."), which may also print
`Effective Date: <date>` / `Operative Date: <date>` (kept in `effective`; a later date than the run date is
`future_effective`). `Cross References`, `Annotations` (case notes) and `Note:` blocks are not kept.
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

SITE = "https://nebraskalegislature.gov"
INDEX = SITE + "/laws/browse-statutes.php"
PARSER = "ne-display-chapter/1"
HEAD = re.compile(r"^(\d+[A-Z]?-\d+(?:\.\d+)*[A-Z]?(?:\.\d+)*)\.\s*(.*)$", re.S)
DATE = re.compile(r"(Effective|Operative) Date:\s*([A-Z][a-z]+ \d{1,2}, \d{4})")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="NE", code_name="Revised Statutes of Nebraska", publisher="Nebraska Legislature, Revisor of Statutes",
        publisher_url=INDEX, official_source=True, access="html", hosts=("nebraskalegislature.gov",),
        codes=(lib.Code("NRS", "Revised Statutes of Nebraska", "Neb. Rev. Stat. § {n}",
                        patterns=((r"^neb\. rev\. stat\.(?: ann\.)?\s*§\s*([0-9]+[a-z]?-[0-9][0-9a-z.]*)$", r"\1"),
                                  (r"^r\.?r\.?s\.?\s*(?:§\s*)?([0-9]+[a-z]?-[0-9][0-9a-z.]*)$", r"\1"))),),
        parser=PARSER, min_interval_s=3.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt: Crawl-delay 3. "
                    "Annotations and cross references printed on the chapter pages are not kept."),
        update_cadence="Sections change on their operative dates after each session; re-run after the session's "
                       "operative date and quarterly.")


META = _meta()


def parse_chapter(raw: bytes, run_date: str):
    doc = lxml_html.fromstring(raw.decode("utf-8", errors="replace"))
    out = []
    for block in doc.xpath('//div[@class="printwidth"]'):
        strong = block.xpath("./strong")
        if not strong:
            continue
        m = HEAD.match(sb.one_line(strong[0].text_content()))
        if not m:
            continue
        number, heading = m.group(1), m.group(2).strip() or None
        lines, history, eff = [], None, None
        for child in block:
            if not isinstance(child.tag, str) or child is strong[0]:
                continue
            cls = child.get("class") or ""
            if child.tag == "div" and cls == "source":
                src = sb.one_line(child.text_content())
                dm = DATE.search(src)
                if dm:
                    src = sb.one_line(src[:dm.start()])
                    start = sb.parse_us_date(dm.group(2))
                    eff = {"start": start, "end": None, "note": dm.group(0)}
                history = re.sub(r"^Source:\s*", "", src) or None   # the printed label is not part of the history
                continue
            if child.tag == "div" and cls in ("anno", "cross"):
                continue
            if child.tag in ("p", "table", "div"):
                text = sb.el_text(child)
                if text and not text.startswith("Note:"):
                    lines.append(text)
        out.append({"number": number, "heading": heading, "text": "\n".join(lines), "history": history,
                    "effective": eff})
    return out


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    run_date = ctx.today.isoformat()
    index = ctx.get(INDEX)
    ctx.edition(edition_label="Revised Statutes of Nebraska", currency_statement=None, currency_source_url=None)
    chapters = []
    for num, name in re.findall(r'href="/laws/browse-chapters\.php\?chapter=([0-9A-Za-z]+)"[^>]*>(.*?)</a>',
                                index.text(), re.S):
        if num not in [c[0] for c in chapters]:
            chapters.append((num, sb.one_line(re.sub(r"<[^>]+>", " ", name)) or None))
    if only:
        chapters = [c for c in chapters if c[0] in only]
    ctx.log(f"{len(chapters)} chapters listed")
    for chapter, name in chapters:
        fetched = ctx.get(f"{SITE}/laws/display-chapters.php?chapter={chapter}")
        sections = parse_chapter(fetched.body, run_date)
        counts: dict[str, int] = {}
        for s in sections:
            counts[s["number"]] = counts.get(s["number"], 0) + 1
        seen: dict[str, int] = {}
        heading_name = re.sub(r"^\d+\s*[-–—]?\s*", "", name or "") or None
        for s in sections:
            eff = s["effective"]
            if eff and eff["start"] and eff["start"] > run_date:
                status = {"status": "future_effective", "status_marker": eff["note"], "status_basis": "publisher_marker"}
            else:
                status = sb.status_kwargs(s["heading"], s["text"])
            if status is None:
                ctx.log(f"Neb. Rev. Stat. § {s['number']}: no text and no marker; skipped")
                continue
            heading = s["heading"]
            if status["status"] not in ("in_force", "future_effective") and status["status_marker"] == heading:
                heading = None
            index_ = None
            if counts[s["number"]] > 1:
                seen[s["number"]] = seen.get(s["number"], 0) + 1
                index_ = seen[s["number"]]
            ctx.section(code="NRS", number=s["number"], heading=heading, text=s["text"],
                        path=[{"level": "chapter", "label": "Chapter", "number": chapter, "heading": heading_name}],
                        source=dict(fetched.source(), display_url=f"{SITE}/laws/statutes.php?statute={s['number']}"),
                        history=s["history"], effective=eff, version=(eff or {}).get("note") if index_ else None,
                        version_index=index_, **status)
            if not ctx.want_more():
                return
