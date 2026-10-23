"""Virginia — Code of Virginia, Division of Legislative Automated Systems (law.lis.virginia.gov).

Source: the Virginia Law Library `https://law.lis.virginia.gov/law-library/` offers every Code title as a CSV download
(`https://law.lis.virginia.gov/CSV/CoVTitle_<n>.csv`, columns TitleNum, TitleName, SubTitleNum, SubTitleName, PartNum,
PartName, ChapterNum, ChapterName, ArticleNum, ArticleName, SubPartNum, SubPartName, Section, Title, Body). One row
per section; `Body` is the publisher's HTML. The developer page also documents JSON/XML web services; the CSVs are the
bulk path (one request per title instead of one per section). No robots.txt (HTTP 404). The site prints no code-wide
currency line.

Parsing (`va-title-csv/1`): text = the `<p>` paragraphs of `Body`; the closing paragraph that is the session-law
history (`Code 1950, § 1-13.1; 1964, c. 252; 2005, c. 839.`) goes to `history`. A row whose `Title` is `Repealed` /
`Expired` / `Reserved` with a marker body (`Repealed by Acts 2005, c. 839, cl. 10, effective October 1, 2005.`) is a
status entry. Version prefixes in the `Title` such as `(Effective until July 1, 2027)` become `version`/`effective`.
"""
from __future__ import annotations

import csv
import io
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

LIBRARY_URL = "https://law.lis.virginia.gov/law-library/"
BASE = "https://law.lis.virginia.gov"
SECTION_PAGE = "https://law.lis.virginia.gov/vacode/{}/"
PARSER = "va-title-csv/1"
HISTORY = re.compile(r"^(?:Code \d{4},|\d{4}, (?:cc?\.|p\.|Sp\.|Ex\.)|Acts \d{4},|R\.\s?P\.\s?\d{4}|\d{4}, Spec\.)")
VERSION = re.compile(r"^\((Effective|Expires|Contingent)[^()]*\)\s*")
LEVELS = [("SubTitleNum", "SubTitleName", "subtitle", "Subtitle"), ("PartNum", "PartName", "part", "Part"),
          ("ChapterNum", "ChapterName", "chapter", "Chapter"), ("ArticleNum", "ArticleName", "article", "Article"),
          ("SubPartNum", "SubPartName", "subpart", "Subpart")]


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="VA", code_name="Code of Virginia", publisher="Virginia General Assembly, Division of Legislative Automated Systems",
        publisher_url="https://law.lis.virginia.gov/vacode/", official_source=True, access="bulk",
        hosts=("law.lis.virginia.gov",),
        codes=(lib.Code("VAC", "Code of Virginia", "Va. Code Ann. § {n}",
                        patterns=((r"^va\. code(?: ann\.)?\s*§\s*([0-9]+(?:\.[0-9]+)?[a-z]?-[0-9a-z.:\-]+)$", r"\1"),
                                  (r"^code of virginia\s*§\s*([0-9]+(?:\.[0-9]+)?[a-z]?-[0-9a-z.:\-]+)$", r"\1"),
                                  (r"^code\s*§\s*([0-9]+(?:\.[0-9]+)?[a-z]?-[0-9a-z.:\-]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). The Virginia Law Library "
                    "publishes per-title CSV downloads; no robots.txt."),
        update_cadence="Sections change on July 1 each year (and on other stated effective dates); re-run each July "
                       "and quarterly.")


META = _meta()


def body_parts(body_html: str):
    """(text lines, history or None) from the publisher's Body HTML."""
    if not body_html.strip():
        return [], None
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    lines = []
    for el in root:
        if not isinstance(el.tag, str):
            continue
        text = sb.el_text(el)
        if text:
            lines.extend(text.split("\n"))
    if root.text and root.text.strip():
        lines.insert(0, sb.one_line(root.text))
    history = None
    if lines and HISTORY.match(lines[-1]):
        history = lines.pop()
    return lines, history


def list_titles(library_html: str):
    out = []
    for href in re.findall(r"href='(/CSV/CoVTitle_[0-9A-Za-z.]+\.csv)'", library_html):
        if href not in out:
            out.append(href)
    return out


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("titles", "").split(",") if c.strip()]
    run_date = ctx.today.isoformat()
    library = ctx.fetch(LIBRARY_URL)
    ctx.edition(edition_label="Code of Virginia", currency_statement=None, currency_source_url=None)
    titles = list_titles(library.text())
    if only:
        titles = [t for t in titles if t.rsplit("_", 1)[1][:-4] in only]
    ctx.log(f"{len(titles)} title CSV files listed")
    for href in titles:
        fetched = ctx.fetch(BASE + href, method="publisher_bulk")
        rows = list(csv.DictReader(io.StringIO(fetched.body.decode("utf-8-sig"))))
        counts: dict[str, int] = {}
        for row in rows:
            counts[row["Section"]] = counts.get(row["Section"], 0) + 1
        seen: dict[str, int] = {}
        for row in rows:
            number = row["Section"].strip()
            heading = sb.one_line(row["Title"]) or None
            version, effective, fstatus = None, None, None
            vm = VERSION.match(heading or "")
            if vm:
                version = vm.group(0).strip()
                heading = heading[vm.end():].strip() or None
                effective = {"start": None, "end": None, "note": version}
                if "until" in version.lower():
                    effective["end"] = sb.parse_us_date(version)
                else:
                    effective["start"] = sb.parse_us_date(version)
                    if effective["start"] and effective["start"] > run_date:
                        fstatus = "future_effective"
            lines, history = body_parts(row["Body"])
            text = "\n".join(lines)
            if fstatus:
                status = {"status": fstatus, "status_marker": version, "status_basis": "publisher_marker"}
            else:
                status = sb.status_kwargs(heading, text)
            if status is None:
                ctx.log(f"Va. Code § {number}: no text and no marker; skipped")
                continue
            if status["status"] not in ("in_force", "future_effective") and \
                    re.fullmatch(r"(Repealed|Expired|Reserved|Renumbered|Transferred)\.?", heading or ""):
                heading = None
            index_ = None
            if counts[number] > 1:
                seen[number] = seen.get(number, 0) + 1
                index_ = seen[number]
            path = [{"level": "title", "label": "Title", "number": row["TitleNum"].strip(),
                     "heading": sb.one_line(row["TitleName"]) or None}]
            for num_key, name_key, level, label in LEVELS:
                if row.get(num_key, "").strip():
                    path.append({"level": level, "label": label, "number": row[num_key].strip(),
                                 "heading": sb.one_line(row.get(name_key, "")) or None})
            ctx.section(code="VAC", number=number, heading=heading, text=text, path=path,
                        source=dict(fetched.source(), display_url=SECTION_PAGE.format(number)),
                        history=history, version=version if index_ else None, version_index=index_,
                        effective=effective, **status)
            if not ctx.want_more():
                return
