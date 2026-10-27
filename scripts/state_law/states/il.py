"""Illinois — Illinois General Assembly, ILCS on ilga.gov (Legislative Reference Bureau database), state-law/1.

Path: /Legislation/ILCS/Chapters -> each chapter's Acts page -> each act's "View Entire Act" page
(details?...&ChapAct=FullText). Each section is a <table> whose lines (split at <br>) are: the citation line
"(735 ILCS 5/13-202) (from Ch. 110, par. 13-202)", optional "(Text of Section …)" version lines, the "Sec. N." line
whose second run is the catchline, body lines, and the "(Source: P.A. …)" line (kept as history). Heading tables
"(735 ILCS 5/Art. XIII Pt. 1 heading)" give articles/parts. robots.txt: Crawl-delay 10 (honoured). The robots file
asks automated systems to prefer ftp.ilga.gov; that repository is a static copy "updated on 11/21/2025 with all
Public Acts through Public Act 104-433" (its aReadMe), so the current text is read from the website at the 10 s pace.

Status: "(Repealed)" style catchlines -> repealed; a version or single text whose source note names a Public Act
effective after the run date -> future_effective (the publisher's own warning, printed on every page); "(Text of
Section before amendment by P.A. X)" -> in_force with effective.end; "(Text of Section WITH the changes made by
P.A. 89-7, which has been held unconstitutional)" -> not_recorded with the marker; its companion "(Text of Section
WITHOUT the changes made by P.A. 89-7, …)" -> in_force (current_compilation), version label kept verbatim.

Versions: a number printed more than once becomes @1, @2 … in print order, whether the publisher prints the versions in
separate tables or one after the other in the same table (735 ILCS 5/13-213 prints the WITH and WITHOUT texts in one
table, each with its own "Sec." line and "(Source: …)" line; `table_versions` splits them).

Retained mode: every page is read with ctx.get(fallback_fresh=True), so `--option source=retained` re-parses this
project's sha256-checked captures of 2026-10-06/07 (Chapters, Acts, Articles and FullText pages) and reads fresh,
at the robots pace, only the pages the capture lacked.
"""
from __future__ import annotations

import datetime as dt
import html as _html
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "www.ilga.gov"
SITE = f"https://{HOST}"
CHAPTERS = SITE + "/Legislation/ILCS/Chapters"

META = lib.StateMeta(
    state="IL",
    code_name="Illinois Compiled Statutes",
    publisher="Illinois General Assembly — Legislative Reference Bureau ILCS database (ilga.gov)",
    publisher_url=CHAPTERS,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="il-ilga-act-fulltext/1",
    min_interval_s=10.0,
    codes=(lib.Code("ILCS", "Illinois Compiled Statutes", "{t} Ill. Comp. Stat. {s}", (
        lib.Pattern(r"(\d+)\s?ilcs\s?((?:\d+(?:\.\d+)?)/[0-9a-z][0-9a-z.\-]*)", r"\1:\2"),
        lib.Pattern(r"(\d+)\s?ill\.\s?comp\.\s?stat\.\s?(?:ann\.\s?)?(?:§\s?)?((?:\d+(?:\.\d+)?)/[0-9a-z][0-9a-z.\-]*)", r"\1:\2"),
    )),),
    terms_note=("ILCS text from the General Assembly's website; the site states the provisions have not been edited "
                "for publication and that the printed Secretary of State copy is the only official law."),
    update_cadence="Continuous (Public Acts folded in as enacted); re-check monthly; full refresh yearly.",
)

CITE_RE = re.compile(r"^\((\d+)\s+ILCS\s+([0-9.]+)/([^)]+?)\)")
HEADING_ID_RE = re.compile(r"^\((\d+)\s+ILCS\s+([0-9.]+)/(.+?)\s+heading\)\s*(.*)$")
SEC_RE = re.compile(r"^Sec\.\s+([0-9A-Za-z][0-9A-Za-z.\-]*?)\.\s*$")
SEC_INLINE_RE = re.compile(r"^Sec\.\s+([0-9A-Za-z][0-9A-Za-z.\-]*?)\.\s+(.*)$")
SOURCE_RE = re.compile(r"^\(Source:.*\)\.?$")
# The "Sec. N." line carries a catchline and, when the section has none, its first body run in the same position, so
# the second run is a catchline only when it reads like one. When unsure it is body text: no printed word is lost.
STATUS_RUN_RE = re.compile(r"^[(\[]\s*(?:repealed|renumbered|reserved|blank|text omitted)[^)\]]*[)\]]\.?$", re.I)
ARTICLE_TITLE_RE = re.compile(r"^(?:Article|Section|Part|Division)\s+[0-9A-Za-z.\-]+\.\s+[^.]+\.$")
SENTENCE_BREAK_RE = re.compile(r"(?<!\bInc)(?<!\bCo)(?<!\bCorp)(?<!\bNo)(?<!\bNos)(?<!\bSt)(?<!\bDr)(?<!\bU\.S)(?<!\bLtd)\.\s+[A-Z\"“(]")
SUBJECT_RE = re.compile(r"^(?:Any|Every|All|No|Each|The|A|An|This|That|Such|Notwithstanding)\b")
FINITE_RE = re.compile(r"\b(?:is|are|was|were|has|have|had|does|do|will|may|can|shall|must|be)\b")
MODAL_RE = re.compile(r"\b(?:shall|must|is hereby|are hereby|is declared|are declared)\b|\bmeans?\s+(?:the|a|an|any|each|every|all)\b", re.I)


def is_catchline(run: str) -> bool:
    text = lib.norm_ws(run)
    if not text:
        return False
    if STATUS_RUN_RE.match(text) or ARTICLE_TITLE_RE.match(text):
        return True
    if len(text) > 200 or not text.endswith(".") or text[0] in "\"“'‘([":
        return False
    if SUBJECT_RE.match(text) and FINITE_RE.search(text) and len(text) >= 50:
        return False
    return not (SENTENCE_BREAK_RE.search(text) or MODAL_RE.search(text))
VERSION_RE = re.compile(r"^\(Text of (?:Section|Article|Part)[^)]*\)$")
EFF_RE = re.compile(r"P\.A\.\s*([0-9]+-[0-9]+)[^;)]*?eff\.\s*(\d{1,2})-(\d{1,2})-(\d{2,4})")
UNIT_LEVEL = {"Art.": "article", "Pt.": "part", "Div.": "division", "Subdiv.": "subdivision", "Tit.": "title",
              "Ch.": "chapter", "Subpt.": "subpart", "Subart.": "subarticle"}
NOTICE_RE = re.compile(r"Updating the database of the Illinois Compiled Statutes \(ILCS\) is an ongoing process\.[^\n]*")


def _eff_date(day: str, month: str, year: str) -> dt.date | None:
    y = int(year)
    if y < 100:
        y += 2000 if y <= 69 else 1900
    try:
        return dt.date(y, int(month), int(day))
    except ValueError:
        return None


def table_lines(table) -> list[list[str]]:
    """Lines of a section table, split at <br>/<p>; each line is the list of its text nodes (runs) in order.
    Runs keep their own whitespace; join them with "" (never insert spaces the publisher did not print)."""
    lines: list[list[str]] = [[]]

    def add(text: str | None) -> None:
        if text:
            lines[-1].append(_html.unescape(text).replace("\xa0", " ").replace("\n", " "))

    def walk(el, nested: bool) -> None:
        tag = el.tag.lower() if isinstance(el.tag, str) else ""
        # <br>/<p> always break; a <div> row breaks only at the section table's own level (the publisher wraps a
        # paragraph's continuation lines in nested hanging-indent tables, which continue the paragraph)
        if tag in ("br", "p") or (tag == "div" and not nested):
            lines.append([])
        elif tag in ("script", "style"):
            add(el.tail)
            return
        if tag:
            add(el.text)
        for child in el:
            walk(child, nested or tag == "table")
        add(el.tail)

    for child in table:
        walk(child, False)
    out = []
    for line in lines:
        runs = [r for r in line if r.strip()]
        if runs:
            out.append(runs)
    return out


def joined(runs: list[str]) -> str:
    return lib.norm_ws("".join(runs))


def heading_steps(unit: str) -> list[tuple[str, str]]:
    """'Art. XIII Pt. 1' -> [('article','XIII'), ('part','1')]."""
    tokens = re.findall(r"(Art\.|Pt\.|Div\.|Subdiv\.|Tit\.|Ch\.|Subpt\.|Subart\.)\s*([0-9A-Za-z.\-]+?)(?=\s+(?:Art\.|Pt\.|Div\.|Subdiv\.|Tit\.|Ch\.|Subpt\.|Subart\.)|$)", unit)
    return [(UNIT_LEVEL[k], v) for k, v in tokens]


def parse_act_page(ctx: lib.RunContext, page: lib.Fetched, chapter: str, chapter_heading: str | None,
                   act: str, act_heading: str | None, today: dt.date) -> int:
    root = lxml_html.document_fromstring(page.body)
    host = root.find_class("billtext-host")
    if not host:
        raise RuntimeError(f"no billtext-host in {page.url}")
    base = [
        {"level": "chapter", "label": "Chapter", "number": chapter, "heading": chapter_heading},
        {"level": "act", "label": "Act", "number": act, "heading": act_heading},
    ]
    context: list[dict] = []
    headings: dict[tuple, str | None] = {}
    count = 0
    pending: list[tuple] = []
    top_tables = [t for t in host[0].iter("table")
                  if not any(a.tag == "table" for a in t.iterancestors() if a is not host[0] and host[0] in a.iterancestors())]
    for table in top_tables:
        lines = table_lines(table)
        if not lines:
            continue
        first = joined(lines[0])
        hid = HEADING_ID_RE.match(first)
        if hid:
            steps = heading_steps(hid.group(3))
            text = " ".join([hid.group(4)] + [joined(line) for line in lines[1:]])
            text = re.sub(r"^(?:ARTICLE|PART|DIVISION|SUBDIVISION|SUBPART|TITLE|CHAPTER|SUBARTICLE)\s+[0-9A-Za-z.\-]+\.?\s*", "", lib.norm_ws(text), flags=re.I)
            headings[tuple(steps)] = lib.norm_ws(text) or None
            context = []
            for i in range(1, len(steps) + 1):
                level, number = steps[i - 1]
                context.append({"level": level, "label": level.title(), "number": number,
                                "heading": headings.get(tuple(steps[:i]))})
            continue
        cite = CITE_RE.match(first)
        if not cite or cite.group(1) != chapter or cite.group(2) != act:
            continue
        section_no = cite.group(3).strip()
        if section_no.endswith("heading"):
            continue
        for seg in table_versions(lines):
            pending.append(_version_item(seg, page, chapter, act, section_no, today, base + list(context)))
    # number versions: same number printed more than once -> @1, @2 … (in one table or in separate tables)
    totals: dict[str, int] = {}
    for item in pending:
        totals[item["number"]] = totals.get(item["number"], 0) + 1
    seen: dict[str, int] = {}
    for item in pending:
        if not ctx.want_more():
            break
        n = item["number"]
        seen[n] = seen.get(n, 0) + 1
        multi = totals[n] > 1
        ctx.section(code="ILCS", number=n, heading=item["heading"], text=item["text"], history=item["history"],
                    source=page, path=item["path"], status=item["status"], status_marker=item["marker"],
                    effective=item["effective"], version=item["version"] if multi else None,
                    version_index=seen[n] if multi else None)
        count += 1
    return count


def table_versions(lines: list[list[str]]) -> list[dict]:
    """The printed versions of one section table (line 0 = citation line). The publisher prints a second version of
    the same section inside the same table when it keeps both texts — e.g. 735 ILCS 5/13-213: "(Text of Section WITH
    the changes made by P.A. 89-7, which has been held unconstitutional)" … "(Source: P.A. 89-7, …)" then "(Text of
    Section WITHOUT the changes made by P.A. 89-7, …)" "Sec. 13-213. …" … "(Source: …)". Each version is returned in
    print order: {version_lines, heading, text, history}. A later version is read only when the line right after a
    "(Source: …)" line is a "(Text of …)" version line; anything else after the source line is ignored as before."""
    out: list[dict] = []
    i = 1
    while i < len(lines):
        version_lines = []
        while i < len(lines) and VERSION_RE.match(joined(lines[i])):
            version_lines.append(joined(lines[i]))
            i += 1
        if i >= len(lines):
            break
        sec_runs = [r for r in lines[i] if r.strip()]
        heading = None
        body_first: list[str] = []
        match = SEC_RE.match(lib.norm_ws(sec_runs[0]))
        if match:
            # second run = catchline when it reads like one; otherwise it is the section's first body text
            if len(sec_runs) > 1 and is_catchline(sec_runs[1]):
                heading = lib.norm_ws(sec_runs[1])
                body_first = sec_runs[2:]
            else:
                body_first = sec_runs[1:]
        else:
            inline = SEC_INLINE_RE.match(joined(sec_runs))
            if not inline:
                break
            body_first = [inline.group(2)]
        body = [joined(body_first)] if body_first else []
        history = None
        j = i + 1
        while j < len(lines):
            text_line = joined(lines[j])
            j += 1
            if SOURCE_RE.match(text_line):
                history = text_line
                break
            body.append(text_line)
        out.append(dict(version_lines=version_lines, heading=heading, history=history,
                        text="\n".join(part for part in body if lib.norm_ws(part))))
        if history is not None and j < len(lines) and VERSION_RE.match(joined(lines[j])):
            i = j
            continue
        break
    return out


def _version_item(seg: dict, page: lib.Fetched, chapter: str, act: str, section_no: str, today: dt.date,
                  path: list[dict]) -> dict:
    """Status, marker and effective dates of one printed version (rules in the module docstring)."""
    history = seg["history"]
    status = marker = None
    effective = None
    label = seg["version_lines"][-1] if seg["version_lines"] else None
    if label and "held unconstitutional" in label and " WITH " in f" {label} ":
        status, marker = "not_recorded", label
    if status is None and history:
        future = [(d, m.group(0)) for m in EFF_RE.finditer(history)
                  if (d := _eff_date(m.group(3), m.group(2), m.group(4))) and d > today]
        before = label and re.search(r"before amendment by P\.A\.", label)
        if future and not before:
            when, frag = max(future)
            status, marker = "future_effective", frag
            effective = {"start": when.isoformat(), "end": None, "note": None}
    if status is None and label and re.search(r"before amendment by P\.A\.\s*([0-9]+-[0-9]+)", label):
        pa = re.search(r"P\.A\.\s*([0-9]+-[0-9]+)", label).group(1)
        later = re.search(rf"P\.A\.\s*{re.escape(pa)}[^;)]*?eff\.\s*(\d{{1,2}})-(\d{{1,2}})-(\d{{2,4}})", page.text())
        if later and (d := _eff_date(later.group(2), later.group(1), later.group(3))):
            if d > today:
                effective = {"start": None, "end": d.isoformat(), "note": label}
            else:
                status, marker = "not_recorded", label
    return dict(number=f"{chapter}:{act}/{section_no}", heading=seg["heading"], text=seg["text"], history=history,
                status=status, marker=marker, effective=effective, version=label, path=path)


def chapter_links(page: lib.Fetched) -> list[tuple[str, str, str]]:
    out = []
    for href in re.findall(r'href="([^"]*Legislation/ILCS/Acts\?[^"]*)"', page.text()):
        href = _html.unescape(href)
        number = re.search(r"ChapterNumber=(\d+)", href)
        name = re.search(r"Chapter=([^&]+)", href)
        if number:
            out.append((number.group(1), name.group(1) if name else None, href if href.startswith("http") else SITE + href))
    return list(dict.fromkeys(out))


def act_links(page: lib.Fetched, chapter: str) -> list[tuple[str, str | None, str]]:
    """(act number, act heading, Articles URL) from a chapter's Acts page (one anchor per act)."""
    out = []
    for href, label in re.findall(r'<a[^>]*href="([^"]*Legislation/ILCS/Articles\?[^"]*)"[^>]*>(.*?)</a>', page.text(), re.S):
        label = lib.norm_ws(_html.unescape(re.sub(r"<[^>]+>", " ", label)))
        match = re.match(rf"^{chapter}\s+ILCS\s+([0-9.]+)/\s*(.*)$", label)
        if not match:
            continue
        href = _html.unescape(href)
        out.append((match.group(1), match.group(2) or None, href if href.startswith("http") else SITE + href))
    if not out:
        raise RuntimeError(f"chapter {chapter}: no act links")
    return list(dict.fromkeys(out))


def fulltext_url(articles_page: lib.Fetched) -> str:
    links = [_html.unescape(h) for h in re.findall(r'href="([^"]*details\?[^"]*ChapAct=FullText[^"]*)"', articles_page.text())]
    if not links:
        raise RuntimeError(f"no View Entire Act link on {articles_page.url}")
    href = links[0]
    return href if href.startswith("http") else SITE + href


SAMPLE = [("735", {"5", "110"})]


def acquire(ctx: lib.RunContext) -> None:
    chapters_page = ctx.get(CHAPTERS, fallback_fresh=True)
    chapters = chapter_links(chapters_page)
    if len(chapters) < 60:
        raise RuntimeError(f"Chapters page lists {len(chapters)} chapters")
    today = ctx.today
    stated = False
    if ctx.sample is not None:
        wanted = dict(SAMPLE)
        chapters = [c for c in chapters if c[0] in wanted]
    for number, name, url in chapters:
        if not ctx.want_more():
            break
        acts_page = ctx.get(url, fallback_fresh=True)
        acts = act_links(acts_page, number)
        if ctx.sample is not None:
            acts = [a for a in acts if a[0] in dict(SAMPLE)[number]]
            acts.sort(key=lambda a: a[0] != "110")  # the small act first, then a slice of the Code of Civil Procedure
        for act, act_name, articles_url in acts:
            if not ctx.want_more():
                break
            articles = ctx.get(articles_url, fallback_fresh=True)
            if "billtext-host" in articles.text() and f"({number} ILCS {act}/" in articles.text():
                target = None  # an act without articles prints its whole text on the Articles page itself
            elif ctx.sample is not None and act == "5":
                limits = [_html.unescape(h) for h in re.findall(r'href="([^"]*details\?[^"]*SeqStart=101400000[^"]*)"', articles.text())]
                target = SITE + limits[0] if limits and limits[0].startswith("/") else (limits[0] if limits else fulltext_url(articles))
            else:
                target = fulltext_url(articles)
            page = articles if target is None else ctx.get(target, fallback_fresh=True)
            if not stated:
                notice = NOTICE_RE.search(lib.html_text(page.body))
                ctx.edition(edition_label=None, currency_statement=notice.group(0) if notice else None,
                            currency_source_url=page.url)
                stated = True
            parse_act_page(ctx, page, number, lib.norm_ws(name.replace("+", " ")) if name else None, act, act_name, today)
