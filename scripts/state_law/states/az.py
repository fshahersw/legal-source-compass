"""Arizona — Arizona Legislature (azleg.gov) Arizona Revised Statutes, state-law/1 parser.

/arstitle/ lists 49 titles and prints the compilation statement; /arsDetail/?title=N lists chapters (div.accordion
h5: "Chapter 5" + heading), articles (div.article: "Article 1" + heading) and section links
(/viewdocument/?docName=https://www.azleg.gov/ars/12/00542.htm); each section page prints
<font color=GREEN>12-542</font>. <font color=PURPLE><u>catchline</u></font> then paragraphs.

robots.txt sets Crawl-delay: 120 for every agent (honoured). A fresh full run is therefore ~25,000 section pages x
120 s (about 35 days). The practical full path is the retained-original mode (run.py --option source=retained):
re-parse the publisher pages this project captured from azleg.gov on 2026-10-06/07, kept content-addressed in
private Storage, each checked against its recorded sha256; the edition keeps their original retrieval time. The
publisher compiles once a year ("the next update of this compilation will not take place until after the conclusion
of the 58th Legislature, 1st Regular Session"), so the October 2026 capture is the current compilation until then.
"""
from __future__ import annotations

import html as _html
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "www.azleg.gov"
BASE = f"https://{HOST}"
LANDING = BASE + "/arstitle/"

META = lib.StateMeta(
    state="AZ",
    code_name="Arizona Revised Statutes",
    publisher="Arizona State Legislature — Legislative Council (azleg.gov)",
    publisher_url=LANDING,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="az-azleg-ars/1",
    min_interval_s=120.0,
    codes=(lib.Code("ARS", "Arizona Revised Statutes", "Ariz. Rev. Stat. § {n}",
                    lib.alias_patterns(["Ariz. Rev. Stat.", "Ariz. Rev. Stat. Ann.", "A.R.S.", "ARS",
                                        "Arizona Revised Statutes"])),),
    terms_note=("Online ARS maintained by the Legislature for drafting; the site states the official version is "
                "published by a commercial publisher (not used) and that this version reflects the law effective on "
                "January 1 of the year after the latest session. robots.txt Crawl-delay 120 s."),
    update_cadence="Once a year after the regular session (next after the 58th Legislature, 1st Regular Session, 2027).",
)

SECTION_URL_RE = re.compile(r"docName=(https://www\.azleg\.gov/ars/(\d+[A-Z]?)/([0-9A-Za-z.\-]+)\.htm)")
STATEMENT_RE = re.compile(r"The Arizona Revised Statutes have been updated to include[^\n]*")


def title_structure(page: lib.Fetched) -> tuple[str | None, list[dict]]:
    """(title heading, [{chapter, chapter_heading, article, article_heading, url, number, catchline}]) in order."""
    root = lxml_html.document_fromstring(page.body)
    top = root.find_class("topTitle")
    heading = None
    if top:
        match = re.match(r"^Title\s+\S+\s+-\s+(.*)$", lib.norm_ws(top[0].text_content()))
        heading = match.group(1) if match else None
    rows = []
    for chapter in root.find_class("accordion"):
        h5 = chapter.find(".//h5")
        if h5 is None:
            continue
        links = h5.findall(".//a")
        chap_no = lib.norm_ws(links[0].text_content()).replace("Chapter", "").strip() if links else None
        chap_head = next((lib.norm_ws(d.text_content()) for d in h5.findall("div") if "two-thirds" in (d.get("class") or "")), None)
        holders = chapter.find_class("article") or [chapter]
        for holder in holders:
            art_no = art_head = None
            if holder is not chapter:
                a = holder.find("a")
                art_no = lib.norm_ws(a.text_content()).replace("Article", "").strip() if a is not None else None
                span = next((s for s in holder.findall("span") if "five-sixths" in (s.get("class") or "")), None)
                art_head = lib.norm_ws(span.text_content()) if span is not None else None
            for ul in holder.iter("ul"):
                link = ul.find(".//a")
                if link is None:
                    continue
                match = SECTION_URL_RE.search(_html.unescape(link.get("href") or ""))
                if not match:
                    continue
                right = next((li for li in ul.findall("li") if "colright" in (li.get("class") or "")), None)
                rows.append({"chapter": chap_no, "chapter_heading": chap_head, "article": art_no,
                             "article_heading": art_head, "url": match.group(1),
                             "number": lib.norm_ws(link.text_content()),
                             "catchline": lib.norm_ws(right.text_content()) if right is not None else None})
    return heading, rows


def parse_section(page: lib.Fetched) -> tuple[str, str | None, str]:
    root = lxml_html.document_fromstring(page.body)
    paragraphs = root.findall(".//p")
    if not paragraphs:
        raise RuntimeError(f"no paragraphs in {page.url}")
    first = paragraphs[0]
    green = next((f for f in first.iter("font") if (f.get("color") or "").upper() == "GREEN"), None)
    purple = next((f for f in first.iter("font") if (f.get("color") or "").upper() == "PURPLE"), None)
    if green is None:
        raise RuntimeError(f"no section number marker in {page.url}")
    number = lib.norm_ws(green.text_content()).rstrip(".")
    heading = lib.norm_ws(purple.text_content()) if purple is not None else None
    text = "\n".join(t for t in (lib.html_text(lxml_html.tostring(p, encoding="unicode")) for p in paragraphs[1:]) if t)
    return number, heading, text


def base_number(label: str) -> str:
    """The index labels the second printed version of a section "3-3493; Version 2"; the page prints "3-3493"."""
    return re.sub(r";\s*Version\s+\d+\s*$", "", label)


def version_fields(number: str, text: str, count: int, seen: dict[str, int]) -> dict:
    """A section the publisher prints in more than one version (03493.htm and 03493.01.htm): each version is kept
    with its own version line, "(L17, Ch. 295, sec. 2. Conditionally Eff.)", and none is called in force, since the
    pages do not say which condition has occurred."""
    seen[number] = seen.get(number, 0) + 1
    first = text.split("\n", 1)[0].strip()
    match = re.fullmatch(r"\(([^()]+)\)", first)
    line = lib.norm_ws(match.group(1)) if match else None
    note = (f"The publisher prints {count} versions of this section; this version is marked ({line})." if line else
            f"The publisher prints {count} versions of this section; this version carries no version line.")
    return {"version": line, "version_index": seen[number], "status": "not_recorded", "status_basis": "not_recorded",
            "effective": {"note": note}}


def acquire(ctx: lib.RunContext) -> None:
    landing = ctx.get(LANDING)
    statement = STATEMENT_RE.search(lib.html_text(landing.body))
    ctx.edition(edition_label=None, currency_statement=statement.group(0) if statement else None,
                currency_source_url=LANDING)
    titles = []
    # the landing page links "arsDetail?title=1"; the title pages themselves are read at "arsDetail/?title=1"
    for match in re.finditer(r'arsDetail/?\?title=(\d+[A-Z]?)', landing.text()):
        if match.group(1) not in titles:
            titles.append(match.group(1))
    if not titles:
        raise RuntimeError(f"{LANDING}: no title links found")
    if ctx.sample is not None:
        titles = ["12"]
    for title in titles:
        if not ctx.want_more():
            break
        page = ctx.get(f"{BASE}/arsDetail/?title={title}")
        title_heading, rows = title_structure(page)
        printed = {}
        for row in rows:
            printed[base_number(row["number"])] = printed.get(base_number(row["number"]), 0) + 1
        seen: dict[str, int] = {}
        for row in rows:
            if not ctx.want_more():
                break
            if ctx.retained is not None and row["url"] not in ctx.retained.by_url:
                if ctx.sample is not None:
                    continue
                raise RuntimeError(f"listed section has no retained original: {row['url']}")
            section_page = ctx.get(row["url"])
            number, heading, text = parse_section(section_page)
            if number != base_number(row["number"]):
                raise RuntimeError(f"{row['url']} prints {number}, index lists {row['number']}")
            versions = version_fields(number, text, printed[number], seen) if printed[number] > 1 else {}
            path = [{"level": "title", "label": "Title", "number": title, "heading": title_heading},
                    {"level": "chapter", "label": "Chapter", "number": row["chapter"], "heading": row["chapter_heading"]}]
            if row["article"]:
                path.append({"level": "article", "label": "Article", "number": row["article"], "heading": row["article_heading"]})
            ctx.section(code="ARS", number=number, heading=heading, text=text, source=section_page, path=path, **versions)
