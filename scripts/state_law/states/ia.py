"""Iowa — Iowa Legislature, Legislative Services Agency, Iowa Code (legis.iowa.gov), state-law/1.

/law/iowaCode lists the titles of the current annual edition ("Iowa Code - 2026"); each title page
(/law/iowaCode/chapters?title=XV&year=2026) lists its chapters with per-chapter files, among them the chapter's "slim"
XML (/docs/publications/ICC/2026/attachments/614_slim.xml). The page lists these per-chapter files under
"Unofficial Version - PDF and RTF formats"; the official version is the authenticated volume PDF set ("Official Version
- PDF format: Vol I … Vol VIII"). The text is the same publisher's; the label is recorded in terms_note.

A chapter XML: slim:Level codeChapter (heading: identifier + headnote) > optional codeSubchapter / codePart levels >
slim:Section codeSection: div.heading (identifier "614.1", headnote "Period."), p.para, nested div.subsection /
letteredPara / subpara (each with its own div.heading), div.history (historyItem: "90 Acts, ch 1241, §2", kept), and
div.footnotes (editorial notes, not kept). Empty character spans (em-dash, em-space, new-line, dotLeader …) are
rendered by lib.slim_text, the same rendering every stored quote is checked against. robots.txt disallows only
/chambers/; 1 request/second (~1,300 chapter files).
"""
from __future__ import annotations

import email.utils
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import etree  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "www.legis.iowa.gov"
BASE = f"https://{HOST}"
CODE = f"{BASE}/law/iowaCode"
S = "{urn:legix:slim}"
X = "{http://www.w3.org/1999/xhtml}"

META = lib.StateMeta(
    state="IA",
    code_name="Iowa Code",
    publisher="Iowa Legislature — Legislative Services Agency (legis.iowa.gov)",
    publisher_url=CODE,
    official_source=True,
    access="bulk",
    hosts=(HOST,),
    parser="ia-legis-slim-xml/1",
    min_interval_s=1.0,
    codes=(lib.Code("IC", "Iowa Code", "Iowa Code § {n}",
                    lib.alias_patterns(["Iowa Code Ann.", "Iowa Code", "I.C.A.", "ICA"])),),
    terms_note=("Annual Iowa Code edition from the Legislature's per-chapter XML, which the publisher lists under "
                "'Unofficial Version' (the official version is the authenticated volume PDF set of the same edition). "
                "Footnotes are not kept."),
    update_cadence="Annual edition (Iowa Code <year>); re-check each January for the next edition.",
)

LEVEL = {"codeSubchapter": ("subchapter", "Subchapter"), "codePart": ("part", "Part"), "codeDivision": ("division", "Division"),
         "codeArticle": ("article", "Article"), "codeSubtitle": ("subtitle", "Subtitle")}
TITLE_ROW_RE = re.compile(r"^Title ([IVXLC]+) - (.+?) \(Ch\. [^)]*\)$", re.M)


def render(el) -> list[str]:
    out: list[str] = []
    lib.slim_inline(el, out)
    return [lib.norm_ws(x) for x in "".join(out).split("\x1e") if lib.norm_ws(x)]


def heading_parts(el) -> tuple[str | None, str | None]:
    head = el.find(f"{X}div[@class='heading']") if el.tag != f"{S}Level" else el.find(f"{S}Heading")
    if head is None:
        return None, None
    ident = head.find(f"{X}span[@class='identifier']")
    note = head.find(f"{X}span[@class='headnote']")
    return (" ".join(render(ident)) or None if ident is not None else None,
            " ".join(render(note)) or None if note is not None else None)


def block_lines(el, out: list[str]) -> None:
    """Lines of a section body: a division's heading (identifier [headnote]) leads its first line."""
    for child in el:
        cls = child.get("class") or ""
        if child.tag == f"{X}div" and cls in ("heading", "history", "footnotes", "footnote"):
            continue
        if child.tag == f"{X}div" and child.find(f"{X}div[@class='heading']") is not None:
            lead = " ".join(render(child.find(f"{X}div[@class='heading']")))
            inner: list[str] = []
            block_lines(child, inner)
            if lead and inner:
                inner[0] = f"{lead} {inner[0]}"
            elif lead:
                inner = [lead]
            out.extend(inner)
        else:
            out.extend(render(child))


def parse_chapter(body: bytes) -> list[dict]:
    """Sections of one chapter XML in order: number, heading, text, history, path below the chapter."""
    root = etree.fromstring(body)
    out: list[dict] = []

    def walk(level, path: list[dict]) -> None:
        for child in level:
            if child.tag == f"{S}Level" and child.get("class") in LEVEL:
                ident, note = heading_parts(child)
                lvl, label = LEVEL[child.get("class")]
                walk(child, path + [{"level": lvl, "label": label, "number": ident, "heading": note}])
            elif child.tag == f"{S}Level":
                walk(child, path)
            elif child.tag == f"{S}Section":
                number, heading = heading_parts(child)
                lines: list[str] = []
                block_lines(child, lines)
                history = [" ".join(render(item)) for item in child.iterfind(f"{X}div[@class='history']/{X}div[@class='historyItem']")]
                out.append({"number": number, "heading": heading, "text": "\n".join(lines),
                            "history": "\n".join(h for h in history if h) or None, "path": path, "id": child.get("id")})

    body_el = root.find(f"{S}Body")
    chapter = body_el.find(f"{S}Level") if body_el is not None else None
    if chapter is None:
        return out
    walk(chapter, [])
    return out


def chapter_step(body: bytes) -> dict:
    root = etree.fromstring(body)
    level = root.find(f"{S}Body/{S}Level")
    ident, note = heading_parts(level) if level is not None else (None, None)
    return {"level": "chapter", "label": "Chapter", "number": ident or root.get("name"), "heading": note}


def acquire(ctx: lib.RunContext) -> None:
    index = ctx.fetch(CODE)
    flat = lib.html_text(index.body)
    label = re.search(r"Iowa Code - (\d{4})", flat)
    if not label:
        raise RuntimeError("Iowa Code page names no edition year")
    year = label.group(1)
    period = re.search(rf"Year: {year} \([^)]*\)", flat)
    titles = list(dict.fromkeys(re.findall(rf'href="(/law/iowaCode/chapters\?title=[IVXLC]+&(?:amp;)?year={year})"',
                                           index.text())))
    if len(titles) < 16:
        raise RuntimeError(f"Iowa Code page lists {len(titles)} titles")
    title_names = {m.group(1): lib.norm_ws(m.group(2)) for m in TITLE_ROW_RE.finditer(flat)}
    if ctx.sample is not None:
        titles = [t for t in titles if "title=XV&" in t.replace("&amp;", "&")]
    modified: list[str] = []
    for title_link in titles:
        if not ctx.want_more():
            break
        tpage = ctx.fetch(BASE + title_link.replace("&amp;", "&"))
        title_no = re.search(r"title=([IVXLC]+)", title_link).group(1)
        title_step = {"level": "title", "label": "Title", "number": title_no, "heading": title_names.get(title_no)}
        chapters = list(dict.fromkeys(re.findall(rf'href="(/docs/publications/ICC/{year}/attachments/[0-9A-Za-z]+_slim\.xml)"',
                                                 tpage.text())))
        if ctx.sample is not None:
            chapters = [c for c in chapters if c.endswith("/614_slim.xml")]
        for link in chapters:
            if not ctx.want_more():
                break
            page = ctx.get(BASE + link, fallback_fresh=True)
            if page.headers.get("last-modified"):
                modified.append(page.headers["last-modified"])
            chapter = chapter_step(page.body)
            for item in parse_chapter(page.body):
                if not ctx.want_more():
                    break
                status = marker = None
                if not item["text"]:
                    status, marker = lib.classify_status(item["heading"], None)
                    status = status or "not_recorded"
                ctx.section(code="IC", number=item["number"], heading=item["heading"], text=item["text"],
                            history=item["history"], source=page, path=[title_step, chapter] + item["path"],
                            status=status, status_marker=marker)
    newest = max(modified, key=lambda v: email.utils.parsedate_to_datetime(v), default=None)
    ctx.edition(edition_label=f"Iowa Code - {year}", currency_statement=period.group(0) if period else None,
                currency_source_url=CODE,
                source_last_modified=f"newest chapter file Last-Modified {newest}" if newest else None)
