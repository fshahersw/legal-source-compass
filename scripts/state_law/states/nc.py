"""North Carolina — General Statutes of North Carolina, North Carolina General Assembly (ncleg.gov).

Source: the General Statutes table of contents `https://www.ncleg.gov/Laws/GeneralStatutesTOC` (currency line "The
General Statutes include changes through S.L. 2026-30.") links one HTML file per chapter at
`https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_<n>.html` (397 chapters). robots.txt
publishes `Crawl-delay: 2` (behind a byte-order mark the shared robots parser does not read, so the module sets a 2 s
minimum interval itself).

Parsing (`nc-chapter-html/1`): headings are `<h3>` (chapter) and centered paragraphs (Article / Part / Subpart /
SUBCHAPTER label, then its name on the next centered line). A section starts at a paragraph whose bold text is
`§ 1C-1601.  What property exempt; ...`; following justified paragraphs are its text. The session-law history is the
balanced parenthetical the publisher appends to the last paragraph (`(1981, c. 490, s. 1; 2025-46, s. 6(a).)`), cut
off into `history`. A heading that is itself a marker (`Repealed by Session Laws ...`, `Reserved for future
codification purposes.`, `Expired ...`) with no text below it is a status entry. Version prefixes such as
`(Effective until December 1, 2026)` / `(Effective December 1, 2026)` become `version` + `effective`. Ranges
(`§§ 1C-1 through 1C-1599.  Reserved ...`) are logged, not expanded into sections.
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

TOC_URL = "https://www.ncleg.gov/Laws/GeneralStatutesTOC"
CHAPTER_URL = "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_{}.html"
SECTION_PAGE = "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_{}/GS_{}.html"
PARSER = "nc-chapter-html/1"
# "§ 1C-1601." and the article-numbered chapters' "§ 25-2-313." / "§ 58-1-1." / "§ 36C-1-101." (chapter-article-section)
SECTION_HEAD = re.compile(r"^§\s*([0-9]+[A-Z]*-[0-9A-Za-z.]+?(?:-[0-9A-Za-z.]+?)?)\.?\s{1,}(.*)$", re.S)
RANGE_HEAD = re.compile(r"^§§\s*")
HIER = re.compile(r"^(Article|Part|Subpart|SUBCHAPTER|Subchapter|SubChapter)\s+([0-9A-Z][0-9A-Za-z.\-]*?)\.?$")
VERSION = re.compile(r"^\((Effective|Contingently effective|For contingent|Repealed effective|Expires|"
                     r"Expiration|Applicable)[^()]*(?:\([^()]*\)[^()]*)*\)\s*")
HISTORY_START = re.compile(r"^\(\s*(?:\d{4}\b|\d{2,4}-\d+|Code\b|Rev\.|C\.\s?S\.|R\.\s?C\.|P\.R\.|Ex\.\s?Sess\.|"
                           r"Pub\.|Laws\b|Priv\.|1[0-9]{3}\s*\(|Res\.|Const\.)")
LEVEL = {"article": "article", "part": "part", "subpart": "subpart", "subchapter": "subchapter"}


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="NC", code_name="General Statutes of North Carolina", publisher="North Carolina General Assembly",
        publisher_url=TOC_URL, official_source=True, access="html", hosts=("www.ncleg.gov",),
        codes=(lib.Code("GS", "General Statutes of North Carolina", "N.C. Gen. Stat. § {n}",
                        # numbers include the article-numbered chapters' "25-2-314"
                        patterns=((r"^n\.?c\.?g\.?s\.?\s*(?:§\s*)?([0-9]+[a-z]*-[0-9a-z.]+(?:-[0-9a-z.]+)?)$", r"\1"),
                                  (r"^g\.\s?s\.\s*(?:§\s*)?([0-9]+[a-z]*-[0-9a-z.]+(?:-[0-9a-z.]+)?)$", r"\1"),
                                  (r"^n\.c\. gen\. stat\.(?: ann\.)?\s*§\s*([0-9]+[a-z]*-[0-9a-z.]+(?:-[0-9a-z.]+)?)$", r"\1"))),),
        parser=PARSER, min_interval_s=2.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt allows the "
                    "statute paths and asks for Crawl-delay: 2."),
        update_cadence="Chapters are republished as session laws take effect; re-run monthly and after each "
                       "session law batch (compare the 'changes through S.L.' line).")


META = _meta()


def _centered_classes(doc) -> set[str]:
    names = set()
    for style in doc.xpath("//style/text()"):
        for name, body in re.findall(r"\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}", style):
            if re.search(r"text-align\s*:\s*center", body):
                names.add(name)
    return names


def split_history(text: str):
    """Cut the publisher's trailing session-law parenthetical off the last paragraph."""
    stripped = text.rstrip()
    if not stripped.endswith(")"):
        return text, None
    depth = 0
    for i in range(len(stripped) - 1, -1, -1):
        ch = stripped[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                candidate = stripped[i:]
                if HISTORY_START.match(candidate) and (i == 0 or stripped[i - 1] in " \t\n"):
                    return stripped[:i].rstrip(), candidate
                return text, None
    return text, None


def parse_chapter(raw: bytes, chapter: str):
    doc = lxml_html.fromstring(raw)
    centered = _centered_classes(doc)
    styles = " ".join(doc.xpath("//style/text()"))
    bold_classes = {n for n, body in re.findall(r"\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}", styles)
                    if re.search(r"font-weight\s*:\s*bold", body)}
    blocks = []
    for el in doc.xpath("//body//*[self::p or self::h1 or self::h2 or self::h3 or self::h4 or self::table]"):
        if el.tag != "table" and el.xpath("ancestor::table"):
            continue
        text = sb.el_text(el)
        if not text:
            continue
        classes = set((el.get("class") or "").split())
        bold = _first_span_bold(el, bold_classes)
        blocks.append({"tag": el.tag, "text": text, "centered": el.tag.startswith("h") or bool(classes & centered),
                       "bold": bold})
    hier: dict[str, tuple] = {}
    order = ["subchapter", "article", "part", "subpart"]
    sections, current, pending_label = [], None, None
    chapter_heading = None
    for i, b in enumerate(blocks):
        text = sb.one_line(b["text"]) if b["tag"] != "table" else b["text"]
        if b["tag"].startswith("h"):
            if current:
                sections.append(current)
                current = None
            if not re.match(r"^Chapter\s", text) and chapter_heading is None:
                chapter_heading = text
            continue
        if b["centered"] and b["tag"] == "p":
            m = HIER.match(text)
            if m:
                if current:
                    sections.append(current)
                    current = None
                level = LEVEL[m.group(1).lower()]
                for child in order[order.index(level):]:
                    hier.pop(child, None)
                hier[level] = (m.group(2), None, m.group(1))
                pending_label = level
                continue
            if pending_label and not current:
                num, _, label = hier[pending_label]
                hier[pending_label] = (num, text, label)
                pending_label = None
                continue
            if re.match(r"^(Articles|Parts)\s+\S+\s+(to|through)\s", text):
                pending_label = None
                continue
        pending_label = None
        if b["bold"] and b["tag"] == "p" and RANGE_HEAD.match(text):
            if current:
                sections.append(current)
            current = None
            sections.append({"range": text})
            continue
        m = SECTION_HEAD.match(text) if b["bold"] and b["tag"] == "p" else None
        if m:
            if current:
                sections.append(current)
            heading = m.group(2).strip()
            version = None
            vm = VERSION.match(heading)
            if vm:
                version = vm.group(0).strip()
                heading = heading[vm.end():].strip()
            current = {"number": m.group(1), "heading": heading or None, "version": version, "body": [],
                       "path": [(lvl, hier[lvl][0], hier[lvl][2], hier[lvl][1]) for lvl in order if lvl in hier]}
            continue
        if current is not None:
            current["body"].append(b["text"])
    if current:
        sections.append(current)
    out = []
    for s in sections:
        if "range" in s:
            out.append(s)
            continue
        body = "\n".join(s["body"])
        text, history = split_history(body)
        if not s["body"]:
            # heading-only entry: the history may sit at the end of the heading line itself
            h, hist = split_history(s["heading"] or "")
            if hist:
                s["heading"], history = h.strip() or None, hist
        out.append({"number": s["number"], "heading": s["heading"], "version": s["version"], "text": sb.ws(text),
                    "history": sb.one_line(history) if history else None, "path": s["path"]})
    return {"chapter_heading": chapter_heading, "sections": out}


def _first_span_bold(el, bold_classes) -> bool:
    """True when the paragraph's first text-bearing span uses a bold class (publisher's heading style)."""
    for span in el.iter("span"):
        if (span.text or "").strip():
            return bool(set((span.get("class") or "").split()) & bold_classes) or "bold" in (span.get("style") or "")
    return False


def _effective(version: str | None, run_date: str):
    if not version:
        return None, None, None
    eff = {"start": None, "end": None, "note": version}
    status = None
    if re.search(r"until", version, re.I):
        eff["end"] = sb.parse_us_date(version.split("until", 1)[1])
    else:
        m = re.match(r"^\(Effective\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})\)", version)
        if m:
            eff["start"] = sb.parse_us_date(m.group(1))
            if eff["start"] and eff["start"] > run_date:
                status = "future_effective"
    return eff, status, (version if status else None)


def list_chapters(toc_html: str):
    seen, out = set(), []
    for c in re.findall(r"/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_([0-9A-Z]+)\.html", toc_html):
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    run_date = ctx.today.isoformat()
    toc = ctx.get(TOC_URL)
    page = lib.html_text(toc.body)
    m = re.search(r"The General Statutes include changes through S\.L\. \d{4}-\d+\s*\.?", page)
    statement = sb.one_line(m.group(0)).replace(" .", ".") if m else None
    ctx.edition(edition_label="General Statutes of North Carolina", currency_statement=statement,
                currency_source_url=TOC_URL)
    chapters = list_chapters(toc.text())
    if only:
        chapters = [c for c in chapters if c in only]
    ctx.log(f"{len(chapters)} chapters listed in the table of contents")
    for chapter in chapters:
        fetched = ctx.get(CHAPTER_URL.format(chapter))
        parsed = parse_chapter(fetched.body, chapter)
        chapter_step = {"level": "chapter", "label": "Chapter", "number": chapter, "heading": parsed["chapter_heading"]}
        counts: dict[str, int] = {}
        for s in parsed["sections"]:
            if "number" in s:
                counts[s["number"]] = counts.get(s["number"], 0) + 1
        seen: dict[str, int] = {}
        for s in parsed["sections"]:
            if "range" in s:
                ctx.log(f"range entry not expanded: {s['range'][:100]!r}")
                continue
            eff, fstatus, fmarker = _effective(s["version"], run_date)
            if fstatus:
                status = {"status": fstatus, "status_marker": fmarker, "status_basis": "publisher_marker"}
            else:
                status = sb.status_kwargs(s["heading"], s["text"])
            if status is None:
                ctx.log(f"G.S. {s['number']}: no text and no marker; skipped")
                continue
            heading = s["heading"]
            if status["status"] not in ("in_force", "future_effective") and status["status_marker"] == heading:
                heading = None
            index = None
            if counts[s["number"]] > 1:
                seen[s["number"]] = seen.get(s["number"], 0) + 1
                index = seen[s["number"]]
            path = [chapter_step] + [{"level": lvl, "label": label, "number": num, "heading": head}
                                     for lvl, num, label, head in s["path"]]
            ctx.section(code="GS", number=s["number"], heading=heading, text=s["text"], path=path,
                        source=dict(fetched.source(), display_url=SECTION_PAGE.format(chapter, s["number"])),
                        history=s["history"], version=s["version"] if index else None, version_index=index,
                        effective=eff, **status)
            if not ctx.want_more():
                return
