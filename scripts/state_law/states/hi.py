"""Hawaii — Legislative Reference Bureau / Hawaii State Legislature, Hawaii Revised Statutes (data.capitol.hawaii.gov),
state-law/1.

/hrscurrent/ is a directory listing of volumes (Vol13_Ch0601-0676/), each a listing of chapter folders (HRS0657/),
each a listing of one HTML file per section (HRS_0657-0007.htm = § 657-7, HRS_0657-0001_0005.htm = § 657-1.5) plus the
chapter's table of contents (HRS_0657-.htm: "CHAPTER 657", its heading, "Part I. …" headings and the section list).
A section file prints "<b>§657-7  Catchline.</b> text … [L 1907, c 113, §1; …]" (the bracket is the history), further
paragraphs, then the Bureau's notes under XNotesHeading paragraphs (case notes, attorney general opinions, law
reviews, cross references; annotations, not kept). Repealed sections print "§657-12  REPEALED.  L 1972, …"; one file
can cover several repealed numbers ("§§657-16 and 657-17 REPEALED."), emitted once per listed number. robots.txt allows
all but *.axd; 1 request/second. The data host prints no currency sentence; the listing dates of /hrscurrent/ are kept
as source_last_modified. Retained mode re-parses the section pages this project captured on 2026-10-06..12.
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "data.capitol.hawaii.gov"
BASE = f"https://{HOST}"
ROOT = f"{BASE}/hrscurrent/"

META = lib.StateMeta(
    state="HI",
    code_name="Hawaii Revised Statutes",
    publisher="Hawaii State Legislature — Legislative Reference Bureau (capitol.hawaii.gov)",
    publisher_url=ROOT,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="hi-capitol-hrscurrent/1",
    min_interval_s=1.0,
    codes=(lib.Code("HRS", "Hawaii Revised Statutes", "Haw. Rev. Stat. § {n}",
                    lib.alias_patterns(["Haw. Rev. Stat. Ann.", "Haw. Rev. Stat.", "HRS", "H.R.S.",
                                        "Hawaii Revised Statutes"])),),
    terms_note=("HRS as posted by the Legislature (hrscurrent); the Bureau's case notes, opinions, law review and "
                "cross-reference notes are not kept. No currency sentence is printed on the data host; the listing "
                "dates are shown."),
    update_cadence="Republished after each regular session (listing dates); re-check each January and July.",
)

LISTING_RE = re.compile(r'(\d{1,2}/\d{1,2}/\d{4})\s+\d{1,2}:\d{2} [AP]M\s+(?:&lt;dir&gt;|\d+) <A HREF="([^"]+)"', re.I)
# "1-2", "657-7", and the article-numbered code chapters "412:3-604", "490:4-407" (chapter:article-section)
NUM = r"\d+[A-Z]?(?::\d+[A-Z]?)?-\d+[0-9A-Za-z.]*"
HEAD_RE = re.compile(rf"^\[?§§?\s*({NUM})\]?\s*(.*)$")
DASHES = str.maketrans({"\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-"})
MULTI_RE = re.compile(rf"^\[?§§\s*({NUM}(?:\s*(?:,|and|&)\s*(?:{NUM}|\d+[0-9A-Za-z.]*))+)\]?\s+(.*)$")
RANGE_RE = re.compile(rf"^\[?§§\s*{NUM}\s+to\s+{NUM}")
HISTORY_RE = re.compile(r"\s*\[((?:[^\[\]]*?)\b(?:L|RL|PC|CC|HRS|CL|Sp)\b[^\[\]]*\d{4}[^\[\]]*)\]\s*$")
PART_RE = re.compile(r"^(Part|Subpart|Article)\s+([0-9IVXLC]+[A-Z]?)\.\s*(.*)$")
TOC_SECTION_RE = re.compile(rf"^({NUM})((?:\s*(?:,|and|to)\s*[0-9][0-9A-Za-z.\-]*)*)\s")
CHAPTER_RE = re.compile(r"^CHAPTER\s+(\d+[A-Z]?)\s*$")


def listing(page: lib.Fetched) -> list[tuple[str, str]]:
    """(listing date, absolute URL) for each entry of a directory listing, in printed order."""
    return [(date, BASE + href) for date, href in LISTING_RE.findall(page.text())]


def chapter_toc(page: lib.Fetched) -> tuple[str | None, str | None, dict[str, list[dict]]]:
    """(chapter number, chapter heading, {section number: [part/subpart steps]}) from HRS_<ch>-.htm."""
    lines = [line for line in lib.html_text(page.body).split("\n") if line.strip()]
    number = heading = None
    steps: list[dict] = []
    where: dict[str, list[dict]] = {}
    for index, line in enumerate(lines):
        m = CHAPTER_RE.match(line)
        if m and number is None:
            number = m.group(1)
            nxt = lines[index + 1] if index + 1 < len(lines) else ""
            heading = nxt if nxt and not PART_RE.match(nxt) and nxt != "Section" else None
            continue
        pm = PART_RE.match(line)
        if pm:  # a Part starts a new group; a Subpart nests under the current Part
            level = {"Part": "part", "Subpart": "subpart", "Article": "article"}[pm.group(1)]
            step = {"level": level, "label": pm.group(1), "number": pm.group(2), "heading": pm.group(3) or None}
            steps = [s for s in steps if s["level"] == "part"] + [step] if level == "subpart" else [step]
            continue
        sm = TOC_SECTION_RE.match(line + " ")
        if sm:  # "657-16, 17 Repealed" lists 657-16 and 657-17
            chapter_no = sm.group(1).split("-", 1)[0]
            for item in [sm.group(1)] + re.findall(r"[0-9][0-9A-Za-z.\-]*", sm.group(2)):
                where.setdefault(item if "-" in item else f"{chapter_no}-{item}", list(steps))
    return number, heading, where


def parse_section(page: lib.Fetched) -> dict:
    root = lxml_html.document_fromstring(page.text())
    container = root.find_class("WordSection1")
    paras = container[0].findall("p") if container else root.iter("p")
    body: list = []
    started = False
    for p in paras:  # part headings and their notes can precede the section; the notes follow it
        notes = (p.get("class") or "").startswith("XNotes")
        if not started:
            if not notes and re.match(r"^\[?§", lib.norm_ws(p.text_content())):
                started = True
            else:
                continue
        if notes:
            break
        body.append(p)
    texts = [lib.html_text(lxml_html.tostring(p, encoding="unicode")) for p in body]
    keep = [(p, t) for p, t in zip(body, texts) if t]
    if not keep:
        raise RuntimeError(f"{page.url}: no section text")
    first, first_text = keep[0]
    # the head is the start of the text covered by the leading bold runs; a run may follow the previous one after a
    # space, a non-bold hyphen ("<b>§1</b>-<b>2 Certain laws ...</b>" is §1-2) or a non-bold "§" / "[" ("§<b>26H-6 ...")
    head_end = 0
    for b in first.iter("b"):
        bt = lib.norm_ws(b.text_content())
        if not bt:
            continue
        at = first_text.find(bt, head_end)
        if at < 0 or not re.fullmatch(r"[\s\-‐‑–§\[]{0,3}", first_text[head_end:at]):
            continue
        head_end = at + len(bt)
    head = lib.norm_ws(first_text[:head_end])
    # numbers are matched with the publisher's non-breaking/figure hyphens read as "-" (same length, so the text after
    # the head is cut at the same place)
    head_cmp = head.translate(DASHES)
    numbers: list[str] = []
    multi = MULTI_RE.match(head_cmp)
    if RANGE_RE.match(head_cmp):
        return {"range": head}
    if multi:
        listed = re.split(r"\s*(?:,|and|&)\s*", multi.group(1))
        chapter = listed[0].split("-", 1)[0]
        numbers = [n if "-" in n else f"{chapter}-{n}" for n in listed]
        heading = multi.group(2) or None
    else:
        m = HEAD_RE.match(head_cmp)
        if not m:
            raise RuntimeError(f"{page.url}: no section line in {head[:80]!r}")
        numbers = [m.group(1)]
        heading = m.group(2) or None
    lines = [first_text[len(head):].strip()] + [t for _p, t in keep[1:]]
    lines = [line for line in lines if line]
    history = None
    if lines:
        hm = HISTORY_RE.search(lines[-1])
        if hm:
            history = lib.norm_ws(hm.group(1))
            lines[-1] = lines[-1][: hm.start()].rstrip()
            if not lines[-1]:
                lines.pop()
    status = marker = None
    if heading and re.match(r"^(?:REPEALED|Repealed)\.?$", heading):
        status, marker = "repealed", heading
        if lines and not history:  # "§657-12  REPEALED.  L 1972, c 105, §1(q)." — the repealing act is the history
            history = lines.pop() if len(lines) == 1 else None
    return {"numbers": numbers, "heading": heading, "text": "\n".join(lines), "history": history, "status": status,
            "marker": marker}


def acquire(ctx: lib.RunContext) -> None:
    root = ctx.get(ROOT, fallback_fresh=True)
    volumes = [(d, u) for d, u in listing(root) if re.search(r"/Vol\d+_Ch[^/]+/$", u)]
    if len(volumes) < 10:
        raise RuntimeError(f"/hrscurrent/ lists {len(volumes)} volumes")
    dates = sorted({d for d, _u in volumes}, key=lambda d: tuple(int(x) for x in (d.split("/")[2], *d.split("/")[:2])))
    ctx.edition(edition_label=None, currency_statement=None, currency_source_url=ROOT,
                source_last_modified=f"hrscurrent volume folders dated {dates[0]}" + (f"–{dates[-1]}" if len(dates) > 1 else ""))
    if ctx.sample is not None:
        volumes = [v for v in volumes if "Vol13_Ch0601-0676" in v[1]]
    for _date, vol_url in volumes:
        if not ctx.want_more():
            break
        chapters = [u for _d, u in listing(ctx.get(vol_url, fallback_fresh=True)) if re.search(r"/HRS\d+[A-Z]*/$", u)]
        if ctx.sample is not None:
            chapters = [u for u in chapters if u.endswith("/HRS0657/")]
        for chap_url in chapters:
            if not ctx.want_more():
                break
            files = [u for _d, u in listing(ctx.get(chap_url, fallback_fresh=True)) if u.lower().endswith(".htm")]
            toc_url = next((u for u in files if re.search(r"/HRS_\d+[A-Z]*-\.htm$", u, re.I)), None)
            number = heading = None
            where: dict[str, list[dict]] = {}
            if toc_url:
                number, heading, where = chapter_toc(ctx.get(toc_url, fallback_fresh=True))
            folder = re.search(r"/HRS0*(\d+[A-Z]*)/$", chap_url).group(1)
            chapter_step = {"level": "chapter", "label": "Chapter", "number": number or folder, "heading": heading}
            ctx.prefetch(u for u in files if u != toc_url)  # retained runs: read ahead
            for url in files:
                if url == toc_url:
                    continue
                if not ctx.want_more():
                    break
                page = ctx.get(url, fallback_fresh=True)
                try:
                    parsed = parse_section(page)
                except RuntimeError as error:
                    if ctx.sample is not None:
                        raise
                    # one page the parser cannot read is ledgered, never guessed (the loader bounds the share)
                    ctx._rejects.write({"state": "HI", "code": "HRS", "number": None, "reason": str(error)[:300],
                                        "source_url": page.url, "source_sha256": page.sha256})
                    continue
                if "range" in parsed:
                    ctx._rejects.write({"state": "HI", "code": "HRS", "number": None, "reason": f"range entry: {parsed['range'][:200]}",
                                        "source_url": page.url, "source_sha256": page.sha256})
                    continue
                for num in parsed["numbers"]:
                    if not ctx.want_more():
                        break
                    ctx.section(code="HRS", number=num, heading=parsed["heading"], text=parsed["text"],
                                history=parsed["history"], source=page, path=[chapter_step] + where.get(num, []),
                                status=parsed["status"], status_marker=parsed["marker"])
