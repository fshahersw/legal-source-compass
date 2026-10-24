"""Delaware — Delaware Code Online (delcode.delaware.gov), Code Revisors / Division of Legislative Services, state-law/1.

index.html lists titles (titleN/index.html); a title page lists chapters (cNNN/index.html); a chapter page prints
#TitleHead (TITLE n, title name, part name, CHAPTER n. name, subchapter) and #CodeBody div.Section blocks:
div.SectionHead "§ 8101. Catchline." + p paragraphs + the source-law history (text and links after the last p).
Chapters with subchapters print subchapter pages (scNN/index.html) linked from the chapter page. Section numbers
are only unique within a title: number = "<title>:<section>" (MODEL.md). No robots.txt (404); 1 request/second.
The home page states that the version on the site "is considered an official version of the State of Delaware
statutory code" and which acts it includes ("This version includes all acts enacted as of <date>, up to and including
<n> Del. Laws, c. <m>."); that sentence is kept verbatim as the currency statement.
"""
from __future__ import annotations

import datetime as _dt
import html as _html
import pathlib
import re
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "delcode.delaware.gov"
BASE = f"https://{HOST}/"

META = lib.StateMeta(
    state="DE",
    code_name="Delaware Code",
    publisher="Delaware Code Revisors and Division of Legislative Services (delcode.delaware.gov)",
    publisher_url=BASE,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="de-delcode-html/1",
    min_interval_s=1.0,
    codes=(lib.Code("DELC", "Delaware Code", "Del. Code Ann. tit. {t}, § {s}", (
        lib.Pattern(r"(?:del\.?\s?code\s?(?:ann\.?)?,?\s?)?tit\.?\s?([0-9]+),?\s?§\s?([0-9][0-9a-z.\-]*)", r"\1:\2"),
        lib.Pattern(r"([0-9]+)\s?del\.?\s?c\.?\s?(?:ann\.?\s?)?§\s?([0-9][0-9a-z.\-]*)", r"\1:\2"),
    )),),
    terms_note="Delaware Code Online, published by the State; the home page states the latest session law included.",
    update_cadence="Updated as acts are enacted (home page names the last act included); re-check monthly.",
)

# "8101", "2-101.1", and the Article 9 transition sections "A-101"
NUM = r"(?:[A-Z]-)?[0-9][0-9A-Za-z.\-]*?"
# "Definitions [Effective until Oct. 21, 2026]." / "Definitions [Effective Oct. 21, 2026]." — the publisher prints the
# outgoing and the incoming text of a section around an amendment's effective date
EFFECTIVE_RE = re.compile(r"\s*\[Effective\s+(until\s+)?([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})\]\.?\s*$")
# "§ 8101. Catchline." — the number ends at the first period followed by a space (so "§ 2-101.1. Title" is 2-101.1);
# a few heads print a space before that period ("§ 17-1201 . Law applicable to ...")
HEAD_RE = re.compile(rf"^§\s*({NUM})\s?\.(?:\s+(.*))?$")
# a status-only entry whose history ends with the repealing act ("...; repealed by 78 Del. Laws, c. 229, § 2,
# effective Apr. 19, 2012.") and whose head carries no "[Repealed.]"
REPEALED_BY_RE = re.compile(r"\brepealed by\s+[^;]*", re.I)
# "§§ 164,165. [Reserved.]" lists numbers; "§§ 166-169. [Reserved.]" is a range (ledgered, never expanded: section
# numbers carry hyphens themselves, as in the UCC title's "§ 2-101")
MULTI_RE = re.compile(rf"^§§\s*({NUM}(?:\s*(?:,|and|&)\s*{NUM})+)\.(?:\s+(.*))?$")
RANGE_RE = re.compile(rf"^§§\s*{NUM}\s*(?:-|\u2013|\u2014|to|through)\s*{NUM}\.(?:\s+(.*))?$")


def _t(el) -> str:
    return lib.norm_ws(el.text_content()) if el is not None else ""


def parse_chapter(page: lib.Fetched) -> tuple[list[dict], list[dict]]:
    root = lxml_html.document_fromstring(page.body)
    head = root.get_element_by_id("TitleHead") if root.xpath('//*[@id="TitleHead"]') else None
    path: list[dict] = []
    if head is not None:
        h1 = _t(head.find("h1"))
        h4s = head.findall("h4")
        tm = re.match(r"^TITLE\s+(\S+)$", h1)
        if tm:
            path.append({"level": "title", "label": "Title", "number": tm.group(1), "heading": _t(h4s[0]) if h4s else None})
        h2 = _t(head.find("h2"))
        if h2:
            pm = re.match(r"^PART\s+([IVXLC0-9A-Z]+)\.?\s*(.*)$", h2, re.I)
            path.append({"level": "part", "label": "Part", "number": pm.group(1) if pm else None,
                         "heading": (pm.group(2) if pm else h2) or None})
        h3 = _t(head.find("h3"))
        cm = re.match(r"^CHAPTER\s+([0-9A-Za-z]+)\.?\s*(.*)$", h3, re.I)
        if cm:
            path.append({"level": "chapter", "label": "Chapter", "number": cm.group(1), "heading": cm.group(2) or None})
        sub = _t(h4s[1]) if len(h4s) > 1 else ""
        sm = re.match(r"^Subchapter\s+([IVXLC0-9A-Z]+)\.?\s*(.*)$", sub, re.I)
        if sm:
            path.append({"level": "subchapter", "label": "Subchapter", "number": sm.group(1), "heading": sm.group(2) or None})
    sections = []
    for div in root.find_class("Section"):
        sh = next((d for d in div if "SectionHead" in (d.get("class") or "")), None)
        if sh is None:
            continue
        head = _t(sh)
        m = HEAD_RE.match(head)
        multi = None if m else MULTI_RE.match(head)
        if not m and not multi:
            reason = "range entry" if RANGE_RE.match(head) else "unparsed section head"
            sections.append({"reject": f"{reason}: {head[:200]}"})
            continue
        numbers = [m.group(1)] if m else re.split(r"\s*(?:,|and|&)\s*", multi.group(1))
        heading = (m or multi).group(2) or None
        paras, history = [], []
        seen_p = False
        for child in div:
            if child is sh:
                continue
            if child.tag == "p":
                paras.append(lib.html_text(lxml_html.tostring(child, encoding="unicode", with_tail=False)))
                seen_p = True
                if child.tail and lib.norm_ws(child.tail):
                    history = [child.tail]
                continue
            if seen_p:
                history.append(child.text_content())
                if child.tail:
                    history.append(child.tail)
        if not seen_p:  # a status-only entry: everything after the head is its history line
            history = [sh.tail or ""] + [lxml_html.tostring(c, encoding="unicode", method="text") for c in div if c is not sh]
        for number in numbers:
            sections.append({"number": number, "heading": heading, "text": "\n".join(p for p in paras if p),
                             "history": lib.norm_ws("".join(history)) or None})
    return path, sections


def effective_fields(heading: str | None, today: _dt.date) -> dict:
    """Heading without its "[Effective ...]" bracket, plus version, effective dates and status from it. The outgoing
    text ("until" a date on or before today) is expired; incoming text effective after today is not yet in effect;
    otherwise the text is in force. No bracket: nothing is added."""
    m = EFFECTIVE_RE.search(heading or "")
    if not m:
        return {"heading": heading}
    raw = m.group(2).replace("Sept.", "Sep.")
    day = None
    for fmt in ("%b. %d, %Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            day = _dt.datetime.strptime(raw, fmt).date()
            break
        except ValueError:
            continue
    if day is None:
        raise RuntimeError(f"unreadable effective date {m.group(0)!r}")
    marker = m.group(0).strip().rstrip(".")
    out = {"heading": (heading[: m.start()].rstrip() + ".") if heading[: m.start()].strip() else None,
           "version": marker.strip("[]"), "status_marker": marker, "status_basis": "publisher_marker"}
    if m.group(1):
        out["effective"] = {"end": day.isoformat(), "note": marker.strip("[]")}
        out["status"] = "expired" if day <= today else "in_force"
    else:
        out["effective"] = {"start": day.isoformat(), "note": marker.strip("[]")}
        out["status"] = "future_effective" if day > today else "in_force"
    return out


def repealed_by(item: dict) -> dict:
    """Status of a status-only entry (no text) whose history names the repealing act; {} otherwise."""
    m = REPEALED_BY_RE.search(item.get("history") or "") if not item.get("text") else None
    return {"status": "repealed", "status_marker": lib.norm_ws(m.group(0)).rstrip(".;, ")} if m else {}


def links(page_text: str, pattern: str) -> list[str]:
    """Link targets matching `pattern`, in page order, once each. The publisher wraps hrefs in encoded newlines and
    spaces (href="&#xA;   title1/index.html&#xA; "), so each href is unescaped and trimmed before it is matched."""
    out = []
    for raw in re.findall(r'href="([^"]*)"', page_text):
        m = re.fullmatch(pattern, _html.unescape(raw).strip())
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out


def acquire(ctx: lib.RunContext) -> None:
    home = ctx.get(BASE + "index.html", fallback_fresh=True)
    flat = lib.html_text(home.body)
    # the home page's currency sentence, verbatim (the sentence before it names the preparers and official status)
    statement = re.search(r"This version includes all acts enacted as of[^\n]*", flat)
    ctx.edition(edition_label=None, currency_statement=statement.group(0) if statement else None,
                currency_source_url=BASE)
    titles = links(home.text(), r"(?:\.\./)?(title\d+[a-z]?/index\.html)")
    if not titles:
        raise RuntimeError(f"{BASE}index.html: no title links found")
    if ctx.sample is not None:
        titles = ["title10/index.html"]
    for title_path in titles:
        if not ctx.want_more():
            break
        tpage = ctx.get(BASE + title_path, fallback_fresh=True)
        tdir = title_path.rsplit("/", 1)[0]
        title_no = re.match(r"title(\d+[a-z]?)", tdir).group(1)
        # title pages link chapters as "../title10/c001/index.html"
        chapters = links(tpage.text(), r"(?:\.\./title\d+[a-z]?/)?(c\d+[a-z]?/index\.html)")
        if ctx.sample is not None:
            chapters = ["c081/index.html"]
        queue = [f"{BASE}{tdir}/{c}" for c in chapters]
        while queue:
            if not ctx.want_more():
                break
            url = queue.pop(0)
            page = ctx.get(url, fallback_fresh=True)
            subs = [urllib.parse.urljoin(url, s) for s in
                    links(page.text(), r"((?:\.\./)*(?:title\d+[a-z]?/)?(?:c\d+[a-z]?/)?sc\d+[a-z]?/index\.html)")]
            queue = subs + queue
            path, sections = parse_chapter(page)
            printed: dict[str, int] = {}
            for item in sections:
                if "number" in item:
                    printed[item["number"]] = printed.get(item["number"], 0) + 1
            seen: dict[str, int] = {}
            for item in sections:
                if not ctx.want_more():
                    break
                if "reject" in item:
                    if ctx.sample is not None and not item["reject"].startswith("range entry"):
                        raise RuntimeError(f"{item['reject']} in {page.url}")
                    # a head the parser cannot read is ledgered, never guessed (the loader bounds the share)
                    ctx._rejects.write({"state": "DE", "code": "DELC", "number": None, "reason": item["reject"],
                                        "source_url": page.url, "source_sha256": page.sha256})
                    continue
                fields = effective_fields(item["heading"], ctx.today)
                if "status" not in fields:
                    fields.update(repealed_by(item))
                if printed[item["number"]] > 1:  # outgoing and incoming text of one section: both kept, as versions
                    seen[item["number"]] = seen.get(item["number"], 0) + 1
                    fields["version_index"] = seen[item["number"]]
                ctx.section(code="DELC", number=f"{title_no}:{item['number']}", text=item["text"],
                            history=item["history"], source=page, path=path, **fields)
