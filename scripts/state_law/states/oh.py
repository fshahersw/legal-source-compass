"""Ohio — Ohio Revised Code, Legislative Service Commission (codes.ohio.gov).

Source: `https://codes.ohio.gov/ohio-revised-code` -> `title-<n>` -> `chapter-<n>` -> one page per section
`https://codes.ohio.gov/ohio-revised-code/section-<number>` (about 33,000 pages). Each page prints the banner "The
Legislative Service Commission staff updates the Revised Code on an ongoing basis, as it completes its act review of
enacted legislation. ..." (kept as the currency statement), the section's `Effective:` date and `Latest Legislation`.

robots.txt (2026-10-23) is the single line `User-agent: * Disallow: /`. Standard parsers (RFC 9309, Python's
robotparser, Google's) read that line as a user-agent token with no rule, i.e. no restriction, but its evident intent
is to disallow every crawler. This module therefore does NOT crawl live by default: it re-parses the project's
retained publisher originals (33,343 section pages captured 2026-10-07, content-addressed in private Storage) with
`--option source=retained` (or `run.py --retained-index FILE`). A live crawl needs an explicit owner/lead decision
(`--option live=owner-approved`). The acquisition is blocked otherwise, never bypassed.

Release 2026-10-27 (owner decision "dont withhold any data. If its accurate and valuable, USE IT"): the file
was re-read on 2026-10-27 (26 bytes, sha256 a71947fb70496190c01031170ef74a4f2ccd5aeaa65163ce5a3a3aaac011122e,
unchanged) and still carries no rule any standard parser reads, so the retained edition is no longer held for
caution; it is loaded from the retained originals. A live crawl still needs `--option live=owner-approved`.

Parsing (`oh-section-page/1`): `<h1>Section 2305.10 | Bodily injury or injury to personal property.</h1>`
(number, catchline), breadcrumbs (title, chapter), `laws-section-info` (`Effective:` date -> `effective.start`, later
than the run date -> `future_effective`; `Latest Legislation:` -> history), `section.laws-body` paragraphs = text.
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

SITE = "https://codes.ohio.gov"
ROOT = SITE + "/ohio-revised-code"
PARSER = "oh-section-page/1"
BANNER = re.compile(r"The Legislative Service Commission staff updates the Revised Code on an ongoing basis, as it "
                    r"completes its act review of enacted legislation\.(?: Updates may be slower during some times of "
                    r"the year, depending on the volume of enacted legislation\.)?")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="OH", code_name="Ohio Revised Code", publisher="Ohio Legislative Service Commission",
        publisher_url=ROOT, official_source=True, access="html", hosts=("codes.ohio.gov",),
        codes=(lib.Code("ORC", "Ohio Revised Code", "Ohio Rev. Code Ann. § {n}",
                        patterns=((r"^r\.?c\.?\s*(?:§\s*)?([0-9]+\.[0-9]+[a-z]?)$", r"\1"),
                                  (r"^ohio rev\. code(?: ann\.)?\s*§\s*([0-9]+\.[0-9]+[a-z]?)$", r"\1"),
                                  (r"^o\.?r\.?c\.?\s*(?:§\s*)?([0-9]+\.[0-9]+[a-z]?)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt is the single "
                    "line 'User-agent: * Disallow: /' (parsers read it as no rule; intent reads as disallow-all): live "
                    "crawling needs an owner decision; retained originals (2026-10-07) are re-parsed instead and "
                    "released 2026-10-27 under the owner's 'don't withhold accurate data' decision."),
        update_cadence="Sections are updated as LSC completes act review; re-run after each act effective-date wave.")


META = _meta()


def parse_section_page(raw: bytes, run_date: str):
    doc = lxml_html.fromstring(raw.decode("utf-8", errors="replace"))
    h1 = doc.xpath('//section[contains(@class,"laws-header")]/h1')
    if not h1:
        return None
    head = sb.one_line(h1[0].text_content())
    m = re.match(r"^Section\s+(\S+)\s*\|\s*(.*)$", head)
    if not m:
        return None
    crumbs = [sb.one_line(a.text_content()) for a in doc.xpath('//div[@class="breadcrumbs"]//a')]
    title = next((c for c in crumbs if c.startswith("Title ")), None)
    chapter = next((c for c in crumbs if c.startswith("Chapter ")), None)
    info = {}
    for mod in doc.xpath('//div[@class="laws-section-info-module"]'):
        label = sb.one_line(" ".join(mod.xpath('./div[@class="label"]//text()'))).rstrip(":").strip()
        value = sb.one_line(" ".join(mod.xpath('./div[@class="value"]//text()')))
        info[label] = value
    body = doc.xpath('//section[contains(@class,"laws-body")]')
    lines = []
    if body:
        for el in body[0].iter("p", "table"):
            if el.tag == "p" and el.xpath("ancestor::table"):
                continue
            text = sb.el_text(el)
            if text:
                lines.append(text)
    banner = BANNER.search(sb.one_line(doc.text_content()))
    eff = info.get("Effective")
    start = sb.parse_us_date(eff) if eff else None
    tm = re.match(r"^Title\s+(\S+)\s+(.*)$", title or "")
    cm = re.match(r"^Chapter\s+(\S+)\s+(.*)$", chapter or "")
    return {"number": m.group(1), "heading": m.group(2).strip() or None, "text": "\n".join(lines),
            "history": info.get("Latest Legislation") or None,
            "effective": {"start": start, "end": None, "note": None} if start else None,
            "future": bool(start and start > run_date), "effective_text": eff,
            "title": (tm.group(1), tm.group(2)) if tm else (None, None),
            "chapter": (cm.group(1), cm.group(2)) if cm else (None, None),
            "banner": banner.group(0) if banner else None}


def _live_urls(ctx):
    root = ctx.get(ROOT)
    for t in dict.fromkeys(re.findall(r'href="/ohio-revised-code/(title-[0-9]+)"', root.text())):
        tpage = ctx.get(f"{ROOT}/{t}")
        for c in dict.fromkeys(re.findall(r'href="/ohio-revised-code/(chapter-[0-9]+)"', tpage.text())):
            cpage = ctx.get(f"{ROOT}/{c}")
            for s in dict.fromkeys(re.findall(r'href="/ohio-revised-code/(section-[0-9.]+[a-z]?)"', cpage.text())):
                yield f"{ROOT}/{s}"


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    retained = getattr(ctx, "retained", None)
    prefix = options.get("prefix", "")          # e.g. section-2305. for a bounded sample
    if retained is None and options.get("live") != "owner-approved":
        raise lib.Blocked("codes.ohio.gov robots.txt reads 'User-agent: * Disallow: /' (one line); live crawling "
                          "waits for an owner decision. Re-parse retained originals: --option source=retained")
    run_date = ctx.today.isoformat()
    if retained is not None:
        urls = sorted(retained.urls(f"{ROOT}/section-{prefix.removeprefix('section-')}"),
                      key=lambda u: sb.natural_key(u.rsplit("section-", 1)[1]))
    else:
        urls = [u for u in _live_urls(ctx) if u.rsplit("/", 1)[1].startswith(prefix or "section-")]
    banner_set = False
    for url in urls:
        fetched = ctx.get(url)
        s = parse_section_page(fetched.body, run_date)
        if s is None:
            ctx.log(f"{url}: no section heading printed; skipped")
            continue
        if not banner_set:
            ctx.edition(edition_label="Ohio Revised Code", currency_statement=s["banner"],
                        currency_source_url=url if s["banner"] else None)
            banner_set = True
        if s["future"]:
            status = {"status": "future_effective", "status_marker": s["effective_text"], "status_basis": "publisher_marker"}
        else:
            status = sb.status_kwargs(s["heading"], s["text"])
        if status is None:
            ctx.log(f"R.C. {s['number']}: no text and no marker; skipped")
            continue
        heading = s["heading"]
        if status["status"] not in ("in_force", "future_effective") and status["status_marker"] == heading:
            heading = None
        path = [{"level": "title", "label": "Title", "number": s["title"][0], "heading": s["title"][1]},
                {"level": "chapter", "label": "Chapter", "number": s["chapter"][0], "heading": s["chapter"][1]}]
        ctx.section(code="ORC", number=s["number"], heading=heading, text=s["text"], path=path, source=fetched,
                    history=s["history"], effective=s["effective"], **status)
        if not ctx.want_more():
            return
