"""Michigan — Michigan Compiled Laws, Michigan Legislative Council (legislature.mi.gov).

Source: the publisher's MCL XML directory `https://www.legislature.mi.gov/documents/mcl/` lists one UTF-16 XML file
per MCL chapter (`Chapter%20<n>.xml`, 241 files, ~474 MB in all, largest ~24 MB). The Chapter Index page prints the
currency line ("Michigan Compiled Laws Complete Through PA 114 of 2026"). On 2026-10-23 robots.txt answered HTTP 502
(the site's error page); RFC 9309 and the shared fetcher treat a 5xx robots.txt as complete disallow, so a live run is
refused (Blocked) until robots.txt answers normally; nothing else changes then. The project's retained originals
(205 chapter XML files + directory + index, captured 2026-10-06) are re-parsed with `--option source=retained`.

Parsing (`mi-mcl-xml/1`): `MCLChapterInfo` (chapter `Name`/`Title`) > `MCLStatuteInfo` (the act: `Name` "Act 236 of
1961", `Heading`) > optional nested `MCLDocumentInfoCollection`s > `MCLSectionInfo` (`MCLNumber`, `CatchLine`,
`BodyText`, `HistoryText`, `Repealed`). `BodyText`/`HistoryText` hold the publisher's own escaped markup
(`<Section-Number>`, `<Paragraph><P>`, `<Emph>`); text is the paragraphs' plain text without the `Sec. 1.` label.
History is the `HistoryData` items, one per line. Editor's notes and commentary are not kept. `Repealed` = true with
a `Repealed. ...` catchline is the publisher's marker. A repealed act printed only as `LongTitle` "691.2 Repealed.
1961, Act 236, ..." becomes a status-only section for that single number (ranges are logged, not expanded).
"""
from __future__ import annotations

import html as _html
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

from lxml import html as lxml_html

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

INDEX_URL = "https://legislature.mi.gov/Laws/ChapterIndex"
DIR_URL = "https://www.legislature.mi.gov/documents/mcl/"
FILE_BASE = "https://www.legislature.mi.gov/documents/mcl/"
SECTION_PAGE = "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-{}"
RETAINED_INDEX_URL = "https://www.legislature.mi.gov/Laws/ChapterIndex"
RETAINED_DIR_URL = "https://legislature.mi.gov/documents/mcl/"
PARSER = "mi-mcl-xml/1"


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="MI", code_name="Michigan Compiled Laws", publisher="Michigan Legislature, Legislative Council",
        publisher_url="https://legislature.mi.gov/Laws/ChapterIndex", official_source=True, access="bulk",
        hosts=("legislature.mi.gov", "www.legislature.mi.gov"),
        codes=(lib.Code("MCL", "Michigan Compiled Laws", "Mich. Comp. Laws § {n}",
                        patterns=((r"^m\.?c\.?l\.?a?\.?\s*(?:§\s*)?([0-9]+\.[0-9a-z]+)$", r"\1"),
                                  (r"^mich\. comp\. laws(?: ann\.)?\s*§\s*([0-9]+\.[0-9a-z]+)$", r"\1"),
                                  (r"^mich\. comp\. laws serv\.\s*§\s*([0-9]+\.[0-9a-z]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). The Legislature publishes "
                    "the MCL as per-chapter XML in an open directory. robots.txt answered HTTP 502 on 2026-10-23 "
                    "(treated as disallow-all); retained originals of 2026-10-06 are re-parsed instead."),
        update_cadence="Chapter files are rewritten as public acts are compiled (file dates in the directory); "
                       "re-run monthly, comparing the 'Complete Through PA n of yyyy' line.")


META = _meta()


def _markup_text(fragment: str | None) -> list[str]:
    """Plain-text lines of the publisher's escaped markup (already unescaped once by the XML parser)."""
    if not fragment or not fragment.strip():
        return []
    root = lxml_html.fragment_fromstring(fragment, create_parent="div")
    for label in root.xpath(".//section-number"):
        label.drop_tree()  # the "Sec. 1." label; drop_tree keeps the text after it
    lines = []
    paras = root.xpath(".//p")
    if paras:
        for p in paras:
            line = sb.one_line("".join(p.itertext()))
            if line:
                lines.append(line)
    else:
        line = sb.one_line("".join(root.itertext()))
        if line:
            lines.append(line)
    return lines


def _history(fragment: str | None) -> str | None:
    if not fragment:
        return None
    items = re.findall(r"<HistoryData>(.*?)</HistoryData>", fragment, re.S)
    lines = [sb.one_line(_html.unescape(re.sub(r"<[^>]+>", "", i))) for i in items]
    lines = [x for x in lines if x]
    return "\n".join(lines) or None


def _t(el, tag):
    child = el.find(tag)
    return child.text if child is not None and child.text else None


def parse_chapter(raw: bytes):
    """One chapter XML -> dict(chapter, heading, events) with events ('act', info) / ('section', info) in order."""
    root = ET.fromstring(raw)
    if root.tag != "MCLChapterInfo":
        raise ValueError(f"unexpected root {root.tag}")
    chapter = (_t(root, "Name") or "").strip()
    title = sb.one_line(_t(root, "Title") or "") or None
    events = []

    def walk(collection, acts):
        for item in list(collection):
            if item.tag == "MCLStatuteInfo":
                act = {"name": sb.one_line(_t(item, "Name") or "") or None,
                       "heading": sb.one_line(_t(item, "Heading") or "") or None,
                       "repealed": (_t(item, "Repealed") or "").lower() == "true",
                       "long_title": sb.one_line(_t(item, "LongTitle") or "") or None,
                       "history": _history(_t(item, "HistoryText"))}
                events.append(("act", act))
                sub = item.find("MCLDocumentInfoCollection")
                if sub is not None and len(sub):
                    walk(sub, acts + [act])
                elif act["repealed"] and act["long_title"]:
                    events.append(("repealed_act", act))
            elif item.tag == "MCLSectionInfo":
                number = sb.one_line(_t(item, "MCLNumber") or "")
                catch = sb.one_line(_t(item, "CatchLine") or "") or None
                events.append(("section", {
                    "number": number, "heading": catch, "lines": _markup_text(_t(item, "BodyText")),
                    "history": _history(_t(item, "HistoryText")),
                    "repealed": (_t(item, "Repealed") or "").lower() == "true",
                    "act": acts[-1] if acts else None}))
            elif item.tag == "MCLDocumentInfoCollection":
                walk(item, acts)
            elif item.tag in ("MCLDivisionInfo", "MCLChapterInfo"):
                sub = item.find("MCLDocumentInfoCollection")
                if sub is not None:
                    walk(sub, acts)

    top = root.find("MCLDocumentInfoCollection")
    if top is not None:
        walk(top, [])
    return {"chapter": chapter, "title": title, "events": events}


def list_chapter_files(listing_html: str):
    files = re.findall(r'HREF="/documents/mcl/(Chapter%20[0-9A-Za-z]+\.xml)"', listing_html, re.I)
    seen, out = set(), []
    for f in files:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return sorted(out, key=lambda f: sb.natural_key(f.split("%20", 1)[1][:-4]))


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = {c.strip() for c in options.get("chapters", "").split(",") if c.strip()}
    retained = getattr(ctx, "retained", None)
    # the 2026-10-06 capture recorded the index on www. and the directory and files without it
    index_url, dir_url, file_base = (RETAINED_INDEX_URL, RETAINED_DIR_URL, RETAINED_DIR_URL) if retained is not None \
        else (INDEX_URL, DIR_URL, FILE_BASE)
    index = ctx.get(index_url)
    page = lib.html_text(index.body)
    m = re.search(r"Michigan Compiled Laws Complete Through PA \d+ of \d{4}", page)
    ctx.edition(edition_label="Michigan Compiled Laws", currency_statement=m.group(0) if m else None,
                currency_source_url=index_url if m else None)
    listing = ctx.get(dir_url)
    files = list_chapter_files(listing.text())
    if only:
        files = [f for f in files if f.split("%20", 1)[1][:-4] in only]
    ctx.log(f"{len(files)} chapter files listed by the publisher")
    for name in files:
        fetched = ctx.get(file_base + name, method="publisher_bulk")
        parsed = parse_chapter(fetched.body)
        chapter_step = {"level": "chapter", "label": "Chapter", "number": parsed["chapter"], "heading": parsed["title"]}
        counts: dict[str, int] = {}
        for kind, info in parsed["events"]:
            if kind == "section":
                counts[info["number"]] = counts.get(info["number"], 0) + 1
        seen: dict[str, int] = {}
        for kind, info in parsed["events"]:
            if kind == "repealed_act":
                lt = re.match(r"^(\d+\.\d+[a-z]*)\s+(Repealed\b.*)$", info["long_title"] or "")
                if not lt:
                    ctx.log(f"repealed act printed for a range, not expanded: {info['long_title']!r}")
                    continue
                number = lt.group(1)
                if number in counts:
                    continue
                path = [chapter_step, {"level": "act", "label": "Act", "number": info["name"], "heading": info["heading"]}]
                ctx.section(code="MCL", number=number, heading=None, text="", path=path,
                            source=dict(fetched.source(), display_url=SECTION_PAGE.format(number.replace(".", "-"))),
                            status="repealed", status_marker=info["long_title"], status_basis="publisher_marker")
                if not ctx.want_more():
                    return
                continue
            if kind != "section":
                continue
            text = "\n".join(info["lines"])
            flag_marker = info["heading"] if info["repealed"] and re.match(r"^Repealed\b", info["heading"] or "") else None
            status = sb.status_kwargs(info["heading"], text, flag_status="repealed" if flag_marker else None,
                                      flag_marker=flag_marker)
            if status is None:
                ctx.log(f"MCL {info['number']}: no text and no marker; skipped")
                continue
            heading = info["heading"]
            if status["status"] != "in_force" and status["status_marker"] == heading:
                heading = None
            act = info["act"]
            path = [chapter_step]
            if act:
                path.append({"level": "act", "label": "Act", "number": act["name"], "heading": act["heading"]})
            index_ = None
            if counts[info["number"]] > 1:
                seen[info["number"]] = seen.get(info["number"], 0) + 1
                index_ = seen[info["number"]]
            ctx.section(code="MCL", number=info["number"], heading=heading, text=text, path=path,
                        source=dict(fetched.source(), display_url=SECTION_PAGE.format(info["number"].replace(".", "-"))),
                        history=info["history"], version_index=index_, **status)
            if not ctx.want_more():
                return
