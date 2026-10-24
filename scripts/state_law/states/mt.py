"""Montana — Montana Code Annotated, Legislative Services Division (mca.legmt.gov).

Source: `https://mca.legmt.gov/bills/mca/index.html` (heading "Montana Code Annotated 2025", line "Updated August
2026") -> `title_XXXX/chapters_index.html` -> `chapter_XXXX/parts_index.html` -> `part_XXXX/sections_index.html` ->
one page per section `section_XXXX/<tttt>-<cccc>-<pppp>-<ssss>.html` ("Each MCA section is a separate web page" per
the site's help page; there is no bulk download). No robots.txt (HTTP 404). Title 0 is the Montana Constitution and
is not part of this statutory code. The footer says the printed version prevails in case of inconsistencies.

Parsing (`mt-section-page/1`): `div.section-doc` holds one `div.section-content` per printed version; its catchline
span carries the citation, an optional `effective-clause` ("(Temporary)", "(Effective October 1, 2026)") and the
catchline; the remaining paragraphs are text; `div.history-doc` ("History: ...") is the history. Several printed
versions give one record each (`@1`, `@2`), version = the effective clause; a dated clause later than the run date is
`future_effective`. A catchline that is itself a status ("Repealed.", "Renumbered ...", "Terminated.") over a credit
line is a status entry. Annotations, compiler's comments and case notes are not on these pages and are not kept.
"""
from __future__ import annotations

import re
import sys
import urllib.parse
from pathlib import Path

from lxml import html as lxml_html

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

BASE = "https://mca.legmt.gov/bills/mca/"
HOME = BASE + "index.html"
PARSER = "mt-section-page/1"
STATUS_HEAD = re.compile(r"^(Repealed|Renumbered|Terminated|Expired|Superseded|Reserved|Transferred|Omitted)\b", re.I)
WORD = {"repealed": "repealed", "renumbered": "renumbered", "terminated": "expired", "expired": "expired",
        "reserved": "reserved", "transferred": "transferred"}


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="MT", code_name="Montana Code Annotated", publisher="Montana Legislature, Legislative Services Division",
        publisher_url=HOME, official_source=True, access="html", hosts=("mca.legmt.gov",),
        codes=(lib.Code("MCA", "Montana Code Annotated", "Mont. Code Ann. § {n}",
                        patterns=((r"^m\.?c\.?a\.?\s*(?:§\s*)?([0-9]+-[0-9]+-[0-9]+[a-z]?)$", r"\1"),
                                  (r"^mont\. code ann\.\s*§\s*([0-9]+-[0-9]+-[0-9]+[a-z]?)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). No robots.txt; one page per "
                    "section (no bulk download). The site's footer: the printed version prevails over the Internet "
                    "version in case of inconsistencies."),
        update_cadence=("New MCA edition every odd year with interim updates (the home page's 'Updated <month year>' "
                        "line); re-run when that line changes."))


META = _meta()


def links(html: str, pattern: str):
    out = []
    for href in re.findall(r'href="([^"]+)"', html):
        href = href[2:] if href.startswith("./") else href
        if re.search(pattern, href) and href not in out:
            out.append(href)
    return out


def parse_section_page(raw: bytes):
    doc = lxml_html.fromstring(raw)
    versions = []
    for block in doc.xpath('//div[contains(@class,"section-doc")]/div[contains(@class,"section-content")]'):
        paras = block.xpath(".//p")
        if not paras:
            continue
        catch = paras[0].xpath('.//span[@class="catchline"]')
        number, clause, heading = None, None, None
        first_rest = ""
        if catch:
            cite = catch[0].xpath('.//span[@class="citation"]')
            number = sb.one_line(cite[0].text_content()) if cite else None
            eff = catch[0].xpath('.//span[@class="effective-clause"]')
            clause = sb.one_line(eff[0].text_content()) if eff else None
            full = sb.one_line(catch[0].text_content())
            heading = full
            if number and heading.startswith(number):
                heading = heading[len(number):].lstrip(".  ").strip()
            if clause and heading.startswith(clause):
                heading = heading[len(clause):].strip()
            rest = []
            if catch[0].tail:
                rest.append(catch[0].tail)
            for sib in catch[0].itersiblings():
                rest.append(sib.text_content())
                if sib.tail:
                    rest.append(sib.tail)
            first_rest = sb.one_line("".join(rest))
        lines = [first_rest] if first_rest else []
        for p in paras[1:]:
            text = sb.one_line(sb.el_text(p))
            if text:
                lines.append(text)
        versions.append({"number": number, "clause": clause, "heading": heading or None, "lines": lines})
    hist = doc.xpath('//div[contains(@class,"history-doc")]')
    history = None
    if hist:
        history = re.sub(r"^History:\s*", "", sb.one_line(hist[0].text_content()).replace(" ", " ")) or None
    header = {}
    for cls, key in (("section-title-title", "title"), ("section-chapter-title", "chapter"),
                     ("section-part-title", "part")):
        el = doc.xpath(f'//*[@class="{cls}"]')
        header[key] = sb.one_line(el[0].text_content()) if el else None
    return {"versions": versions, "history": history, "header": header}


def _split_label(text: str | None, word: str):
    m = re.match(rf"^{word}\s+([0-9A-Za-z.]+)\.\s*(.*)$", text or "", re.I)
    return (m.group(1), m.group(2) or None) if m else (None, text)


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only_parts = [p.strip() for p in options.get("parts", "").split(",") if p.strip()]   # e.g. 27-2-2
    run_date = ctx.today.isoformat()
    home = ctx.get(HOME, fallback_fresh=True)
    text = lib.html_text(home.body).split("\n")
    label = next((l for l in text if re.fullmatch(r"Montana Code Annotated \d{4}", l)), None)
    updated = next((l for l in text if re.fullmatch(r"Updated [A-Z][a-z]+ \d{4}", l)), None)
    ctx.edition(edition_label=label, currency_statement=" / ".join(x for x in (label, updated) if x) or None,
                currency_source_url=HOME)
    for title_href in links(home.text(), r"^title_\w+/chapters_index\.html$"):
        if title_href.startswith("title_0000/"):
            continue                                           # Montana Constitution
        title_url = urllib.parse.urljoin(HOME, title_href)
        if only_parts and not any(title_href.startswith(f"title_{int(p.split('-')[0]) * 10:04d}/") for p in only_parts):
            continue
        tpage = ctx.get(title_url, fallback_fresh=True)
        for chap_href in links(tpage.text(), r"^(?:\./)?chapter_\w+/parts_index\.html$"):
            chap_url = urllib.parse.urljoin(title_url, chap_href)
            if only_parts and not any(f"chapter_{int(p.split('-')[1]) * 10:04d}/" in chap_url and
                                      f"title_{int(p.split('-')[0]) * 10:04d}/" in chap_url for p in only_parts):
                continue
            cpage = ctx.get(chap_url, fallback_fresh=True)
            for part_href in links(cpage.text(), r"^(?:\./)?part_\w+/sections_index\.html$"):
                part_url = urllib.parse.urljoin(chap_url, part_href)
                if only_parts and not any(f"part_{int(p.split('-')[2]) * 10:04d}/" in part_url and
                                          f"chapter_{int(p.split('-')[1]) * 10:04d}/" in part_url and
                                          f"title_{int(p.split('-')[0]) * 10:04d}/" in part_url for p in only_parts):
                    continue
                ppage = ctx.get(part_url, fallback_fresh=True)
                for sec_href in links(ppage.text(), r"^(?:\./)?section_\w+/[\w-]+ ?\.html$"):
                    sec_url = urllib.parse.urljoin(part_url, sec_href.replace(" ", "%20"))
                    fetched = ctx.get(sec_url, fallback_fresh=True)
                    parsed = parse_section_page(fetched.body)
                    hdr = parsed["header"]
                    t_no, t_head = _split_label(hdr["title"], "TITLE")
                    c_no, c_head = _split_label(hdr["chapter"], "CHAPTER")
                    p_no, p_head = _split_label(hdr["part"], "Part")
                    path = [{"level": "title", "label": "Title", "number": t_no, "heading": t_head},
                            {"level": "chapter", "label": "Chapter", "number": c_no, "heading": c_head},
                            {"level": "part", "label": "Part", "number": p_no, "heading": p_head}]
                    versions = [v for v in parsed["versions"] if v["number"]]
                    for k, v in enumerate(versions, 1):
                        text_ = "\n".join(v["lines"])
                        effective, status = None, None
                        if v["clause"]:
                            effective = {"start": None, "end": None, "note": v["clause"]}
                            m = re.match(r"^\(Effective ([A-Z][a-z]+ \d{1,2}, \d{4})\)$", v["clause"])
                            if m:
                                effective["start"] = sb.parse_us_date(m.group(1))
                                if effective["start"] and effective["start"] > run_date:
                                    status = {"status": "future_effective", "status_marker": v["clause"],
                                              "status_basis": "publisher_marker"}
                        heading = v["heading"]
                        sm = STATUS_HEAD.match(heading or "")
                        if status is None and sm and len(text_) <= 400:
                            marker = " ".join(x for x in (heading, text_) if x)
                            status = {"status": WORD.get(sm.group(1).lower(), "not_recorded"), "status_marker": marker,
                                      "status_basis": "publisher_marker"}
                            heading, text_ = None, ""
                        if status is None:
                            status = sb.status_kwargs(heading, text_)
                        if status is None:
                            ctx.log(f"MCA {v['number']}: no text and no marker; skipped")
                            continue
                        index_ = k if len(versions) > 1 else None
                        ctx.section(code="MCA", number=v["number"], heading=heading, text=text_, path=path,
                                    source=fetched, history=parsed["history"], effective=effective,
                                    version=v["clause"] if index_ else None, version_index=index_, **status)
                        if not ctx.want_more():
                            return
