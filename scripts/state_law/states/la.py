"""Louisiana — Louisiana State Legislature (legis.la.gov) Louisiana Laws, state-law/1 parser.

Tables of contents: Laws_Toc.aspx?folder=<n>&level=Parent. The Revised Statutes folder (75) lists the titles; each
title's section list is the page's ASP.NET postback for that title (an ordinary form POST of the page's own hidden
fields). The codes (Civil Code 67, Code of Civil Procedure 68, Code of Criminal Procedure 69, Code of Evidence 70,
Children's Code 71) list their articles directly. Each section/article: LawPrint.aspx?d=<id>: #LabelName ("RS 9:5604",
"CC 3492") and #LabelDocument paragraphs: "§5604.  Catchline" / "Art. 3492.  Catchline", the text, then the history
paragraphs ("Acts 1990, No. 1091, §1 …"). The constitution and chamber rules are not statutes and are skipped.
No robots.txt on the host (404); 1 request/second. LawSearch.aspx prints the currency statement ("Laws have been
updated through …"), kept verbatim. Hierarchy: code › title (RS, from the TOC) › the headers each LawPrint page prints above the first
section of a group (CODE TITLE, CHAPTER, PART, SUBPART, SECTION …), carried forward in TOC order.
"""
from __future__ import annotations

import html as _html
import pathlib
import re
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "legis.la.gov"
BASE = f"https://{HOST}/legis/"
LA = r"(?:la\.?\s?)?"

# folder, code key, publisher label prefix, code name, citation template, aliases
CODES = [
    (75, "RS", "RS", "Louisiana Revised Statutes", "La. Stat. Ann. § {n}", ["La. Stat. Ann.", "La. R.S.", "R.S.", "La. Rev. Stat. Ann.", "La. Rev. Stat.", "LSA-R.S."]),
    (67, "CC", "CC", "Civil Code", "La. Civ. Code Ann. art. {n}", ["La. Civ. Code Ann. art.", "La. Civ. Code art.", "La. C.C. art.", "C.C. art.", "Civil Code art.", "La. C.C."]),
    (68, "CCP", "CCP", "Code of Civil Procedure", "La. Code Civ. Proc. Ann. art. {n}", ["La. Code Civ. Proc. Ann. art.", "La. Code Civ. Proc. art.", "La. C.C.P. art.", "C.C.P. art.", "La. C.C.P."]),
    (69, "CCRP", "CCRP", "Code of Criminal Procedure", "La. Code Crim. Proc. Ann. art. {n}", ["La. Code Crim. Proc. Ann. art.", "La. Code Crim. Proc. art.", "La. C.Cr.P. art.", "C.Cr.P. art."]),
    (70, "CE", "CE", "Code of Evidence", "La. Code Evid. Ann. art. {n}", ["La. Code Evid. Ann. art.", "La. Code Evid. art.", "La. C.E. art.", "C.E. art."]),
    (71, "CHC", "CHC", "Children's Code", "La. Child. Code Ann. art. {n}", ["La. Child. Code Ann. art.", "La. Ch.C. art.", "Ch.C. art.", "La. Children's Code art."]),
]

META = lib.StateMeta(
    state="LA",
    code_name="Louisiana Laws (Revised Statutes and Codes)",
    publisher="Louisiana State Legislature (legis.la.gov)",
    publisher_url=BASE + "LawSearch.aspx",
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="la-legis-lawprint/1",
    min_interval_s=1.0,
    codes=tuple(lib.Code(key, name, template, lib.alias_patterns(aliases, prefix=None if key == "RS" else None))
                for _f, key, _p, name, template, aliases in CODES),
    terms_note="Louisiana Laws as published by the Legislature; the site's own currency statement is shown verbatim.",
    update_cadence="After each session (the site lists laws not yet folded in); re-check monthly.",
)

HISTORY_RE = re.compile(r"^(?:Acts\s+\d{4}|Amended by|Added by|Amended and reenacted|Enacted by|Redesignated|"
                        r"Repealed by|Reenacted|Re-enacted|Source:|Transferred by|Renumbered|Amended and renumbered)")
SECTION_RE = re.compile(r"^(?:§|Art\.)\s*([0-9][0-9A-Za-z.:\-]*?)\.\s*(.*)$")
TITLE_RE = re.compile(r"^TITLE\s+([0-9A-Z.\-]+)$")


HEADER_RE = re.compile(r"^(CODE TITLE|CODE BOOK|BOOK|TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|SUBPART|SECTION|SUBSECTION)"
                       r"\s+([0-9A-Z][0-9A-Z.\-]*?)(?:\.\s*|--|\s+|$)(.*)$")
HEADER_LEVEL = {"CODE BOOK": ("division", "Book", 0), "BOOK": ("division", "Book", 0), "CODE TITLE": ("title", "Title", 1),
                "TITLE": ("title", "Title", 1), "SUBTITLE": ("subtitle", "Subtitle", 2), "CHAPTER": ("chapter", "Chapter", 3),
                "SUBCHAPTER": ("subchapter", "Subchapter", 4), "PART": ("part", "Part", 5), "SUBPART": ("subpart", "Subpart", 6),
                "SECTION": ("subdivision", "Section", 7), "SUBSECTION": ("other", "Subsection", 8)}


def parse_lawprint(page: lib.Fetched) -> dict:
    """Headers printed above the first section of a group (CHAPTER 1. PRESCRIPTION …), the § / Art. line, the text,
    and the trailing history paragraphs."""
    root = lxml_html.document_fromstring(page.body)
    name = root.get_element_by_id("LabelName")
    doc = root.get_element_by_id("LabelDocument")
    label = lib.norm_ws(name.text_content())
    paras = [lib.html_text(lxml_html.tostring(p, encoding="unicode")) for p in doc.iter("p")]
    paras = [p for p in paras if p]
    start = next((i for i, p in enumerate(paras) if SECTION_RE.match(p)), None)
    headers: list[dict] = []
    heading = None
    rest = paras
    if start is not None:
        for line in paras[:start]:
            m = HEADER_RE.match(line)
            if m:
                level, word, rank = HEADER_LEVEL[m.group(1)]
                headers.append({"level": level, "label": word, "number": m.group(2), "heading": lib.norm_ws(m.group(3)) or None,
                                "rank": rank})
            elif headers and line != "(BLANK)":
                headers[-1]["heading"] = lib.norm_ws(f"{headers[-1]['heading'] or ''} {line}")
        heading = SECTION_RE.match(paras[start]).group(2) or None
        rest = paras[start + 1:]
    cut = len(rest)
    while cut > 0 and HISTORY_RE.match(rest[cut - 1]):
        cut -= 1
    return {"label": label, "heading": heading, "text": "\n".join(rest[:cut]),
            "history": "\n".join(rest[cut:]) or None, "headers": headers}


def postback(ctx: lib.RunContext, url: str, page: lib.Fetched, target: str) -> lib.Fetched:
    fields = {k: _html.unescape(v) for k, v in re.findall(
        r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', page.text())}
    fields["__EVENTTARGET"] = target
    fields["__EVENTARGUMENT"] = ""
    return ctx.fetch(url, data=urllib.parse.urlencode(fields).encode(),
                     headers={"Content-Type": "application/x-www-form-urlencoded"})


def law_links(page: lib.Fetched, prefix: str) -> list[tuple[str, str]]:
    """(d id, label) for every Law.aspx link whose label is a section of this code ("RS 9:5604", "CC 3492")."""
    out = []
    for d, label in re.findall(r'href="Law\.aspx\?d=(\d+)"[^>]*>(.*?)</a>', page.text(), re.S):
        label = lib.norm_ws(_html.unescape(re.sub(r"<[^>]+>", " ", label)))
        if re.match(rf"^{prefix}\s+\d", label) and (d, label) not in out:
            out.append((d, label))
    return out


def title_targets(page: lib.Fetched) -> list[tuple[str, str, str | None]]:
    """(title number, postback target, heading) from the Revised Statutes folder page."""
    rows = re.findall(r'<tr[^>]*>\s*<td[^>]*><a id="[^"]+" href="javascript:__doPostBack\(&#39;([^&]+)&#39;[^>]*>(TITLE[^<]*)</a></td>'
                      r'\s*<td[^>]*><a[^>]*>([^<]*)</a>', page.text())
    out = []
    for target, label, heading in rows:
        m = TITLE_RE.match(lib.norm_ws(label))
        if m:
            out.append((m.group(1), target, lib.norm_ws(_html.unescape(heading)) or None))
    return out


def emit(ctx: lib.RunContext, code: str, prefix: str, d: str, label: str, base: list[dict], context: list[dict]) -> None:
    """Emit one section; `context` (headers seen so far in this title/code) is updated in place."""
    page = ctx.get(f"{BASE}LawPrint.aspx?d={d}", fallback_fresh=True)
    parsed = parse_lawprint(page)
    if parsed["label"] != label:
        raise RuntimeError(f"d={d} prints {parsed['label']!r}, TOC lists {label!r}")
    for header in parsed["headers"]:
        context[:] = [c for c in context if c["rank"] < header["rank"]] + [header]
    number = parsed["label"][len(prefix):].strip()
    path = base + [{k: v for k, v in c.items() if k != "rank"} for c in context]
    ctx.section(code=code, number=number, heading=parsed["heading"], text=parsed["text"], history=parsed["history"],
                source=page, path=path)


def acquire(ctx: lib.RunContext) -> None:
    search = ctx.fetch(BASE + "LawSearch.aspx")
    flat = lib.html_text(search.body)
    lines = [m.group(0) for m in re.finditer(r"[^\n]*(?:Laws have been updated through|laws updated through)[^\n]*", flat)]
    ctx.edition(edition_label=None, currency_statement="\n".join(lines) or None, currency_source_url=search.url)
    for folder, code, prefix, _name, _tmpl, _aliases in CODES:
        if ctx.sample is not None and code not in ("RS", "CC"):
            continue
        if not ctx.want_more():
            break
        url = f"{BASE}Laws_Toc.aspx?folder={folder}&level=Parent"
        page = ctx.fetch(url)
        if code == "RS":
            titles = title_targets(page)
            if len(titles) < 40:
                raise RuntimeError(f"Revised Statutes folder lists {len(titles)} titles")
            if ctx.sample is not None:
                titles = [t for t in titles if t[0] == "9"]
            for number, target, heading in titles:
                if not ctx.want_more():
                    break
                listing = postback(ctx, url, page, target)
                links = [(d, l) for d, l in law_links(listing, prefix) if re.match(rf"^RS {re.escape(number)}:", l)]
                if ctx.sample is not None:
                    links = [x for x in links if re.match(r"^RS 9:56\d\d$", x[1])][:30]
                base = [{"level": "title", "label": "Title", "number": number, "heading": heading}]
                context: list[dict] = []
                for d, label in links:
                    if not ctx.want_more():
                        break
                    emit(ctx, code, prefix, d, label, base, context)
        else:
            links = law_links(page, prefix)
            if ctx.sample is not None:
                links = [x for x in links if x[1] in ("CC 3492", "CC 3493", "CC 3494", "CC 3495", "CC 3496", "CC 3497",
                                                      "CC 3498", "CC 3499", "CC 3500", "CC 2315")]
            context = []
            for d, label in links:
                if not ctx.want_more():
                    break
                emit(ctx, code, prefix, d, label, [], context)
