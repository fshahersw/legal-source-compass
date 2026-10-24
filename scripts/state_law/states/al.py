"""Alabama — Legislative Services Agency, Code of Alabama on ALISON (alison.legislature.state.al.us), state-law/1.

The site's public JSON endpoint /api/code-of-alabama?page=N (500 nodes per page, ~120 pages; an empty page ends the
list) returns every node of the code: Title/Chapter/Article/Division/Part rows and Section rows with displayId,
catchLine, content (HTML), history, versionId, effectiveDate, supersessionDate, parentId (= the parent's codeId) and
sortOrder. Sections with several versions carry their own effective/supersession dates: a version whose
effectiveDate is after the run date is future_effective; one whose supersessionDate has passed is no longer in force
and is excluded (counted in rejects.jsonl.gz with reason "superseded version"); a supersessionDate still ahead becomes
effective.end. The API prints no currency sentence; the newest node updatedAt is kept as source_last_modified.
robots.txt is not published (the path returns the app shell); 1 request/second.
"""
from __future__ import annotations

import datetime as dt
import html as _html
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

HOST = "alison.legislature.state.al.us"
API = f"https://{HOST}/api/code-of-alabama"

META = lib.StateMeta(
    state="AL",
    code_name="Code of Alabama 1975",
    publisher="Alabama Legislature — Legislative Services Agency (ALISON)",
    publisher_url=f"https://{HOST}/code-of-alabama",
    official_source=True,
    access="api",
    hosts=(HOST,),
    parser="al-alison-api/1",
    min_interval_s=1.0,
    codes=(lib.Code("ALC", "Code of Alabama 1975", "Ala. Code § {n}",
                    lib.alias_patterns(["Ala. Code", "Ala. Code 1975", "Code of Ala.", "Code of Alabama", "Ala. Code Ann."])),),
    terms_note="Code text served by the Legislature's ALISON system; the site states no compilation-through date.",
    update_cadence="Continuous (nodes carry updatedAt; amended sections appear after each session); re-check monthly.",
)

LEVEL = {"title": "title", "subtitle": "subtitle", "chapter": "chapter", "subchapter": "subchapter", "article": "article",
         "division": "division", "subdivision": "subdivision", "part": "part", "subpart": "subpart"}


def _date(v: str | None) -> dt.date | None:
    if not v:
        return None
    try:
        return dt.date.fromisoformat(v[:10])
    except ValueError:
        return None


def _text(value) -> str:
    """lib.html_text, then one more entity decoding: the API double-encodes some entities ("&amp;amp;", "&amp;sect;"),
    which read as "&amp;" / "&sect;" after one pass (414 sections were refused as markup on 2026-10-23)."""
    text = lib.html_text(value or "")
    if re.search(r"&(?:[a-zA-Z][a-zA-Z0-9]{1,30}|#\d+|#x[0-9a-fA-F]+);", text):
        text = _html.unescape(text)
    return text


def acquire(ctx: lib.RunContext) -> None:
    pages: list[tuple[lib.Fetched, list[dict]]] = []
    page_no = 1
    max_pages = 2 if ctx.sample is not None else 1000
    while page_no <= max_pages:
        got = ctx.fetch(f"{API}?page={page_no}", method="publisher_api", headers={"Accept": "application/json"})
        rows = json.loads(got.body)
        if not isinstance(rows, list):
            raise RuntimeError(f"page {page_no}: unexpected payload")
        if not rows:
            break
        pages.append((got, rows))
        page_no += 1
    by_code = {}
    for _got, rows in pages:
        for row in rows:
            by_code[row["codeId"]] = row
    updated = max((row.get("updatedAt") or "" for _g, rows in pages for row in rows), default="")
    ctx.edition(edition_label=None, currency_statement=None, currency_source_url=f"{API}?page=1",
                source_last_modified=f"newest node updatedAt {updated}" if updated else None)

    def path_of(row: dict) -> list[dict]:
        chain = []
        parent = by_code.get(row.get("parentId"))
        seen = set()
        while parent is not None and parent["codeId"] not in seen:
            seen.add(parent["codeId"])
            level = LEVEL.get((parent.get("type") or "").lower(), "other")
            chain.append({"level": level, "label": parent.get("type") or "Group",
                          "number": parent.get("displayId"), "heading": lib.html_text(parent.get("catchLine") or "") or None})
            parent = by_code.get(parent.get("parentId"))
        return list(reversed(chain))

    counts: dict[str, int] = {}
    for _got, rows in pages:
        for row in rows:
            if row.get("type") == "Section":
                counts[row["displayId"]] = counts.get(row["displayId"], 0) + 1
    seen: dict[str, int] = {}
    for got, rows in pages:
        for row in (r for r in rows if r.get("type") == "Section"):  # the API lists nodes in code order
            if not ctx.want_more():
                return
            number = row["displayId"]
            seen[number] = seen.get(number, 0) + 1
            start, end = _date(row.get("effectiveDate")), _date(row.get("supersessionDate"))
            if end and end <= ctx.today:
                ctx._rejects.write({"state": "AL", "code": "ALC", "number": number, "reason": "superseded version",
                                    "source_url": got.url, "source_sha256": got.sha256})
                continue
            status = marker = None
            if start and start > ctx.today:
                status, marker = "future_effective", f"effectiveDate {row.get('effectiveDate')}"
            effective = {"start": start.isoformat() if start else None, "end": end.isoformat() if end else None, "note": None}
            multi = counts[number] > 1
            ctx.section(code="ALC", number=number, heading=_text(row.get("catchLine")) or None,
                        text=_text(row.get("content")), history=_text(row.get("history")) or None,
                        source=got, path=path_of(row), status=status, status_marker=marker, effective=effective,
                        version=_text(row.get("title")) if multi else None,
                        version_index=seen[number] if multi else None)
