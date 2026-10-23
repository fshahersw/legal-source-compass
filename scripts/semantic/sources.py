"""Document sources for the semantic index: one function per corpus that yields Doc objects (see chunking.py).

Only text the corpus already stores is used. Builders read the published rows (the files under private/build/<slug>/ are the
exact rows that were published to corpus_records, with publish receipts; scripts/semantic/verify_sources.py checks them against
the live corpus by aggregate hash through read-only SQL). A corpus whose stored text is a search blob (bills, CRS products,
oversight and FTC reports) is embedded from its title, official title, policy area, subjects and summary fields instead, composed
in a fixed order; those chunks say so (`composed` in the corpus registry) because their offsets index the composed text.

Datasets (ids of the semantic index, not always of corpus_records):
    us_code_sections       stored section text, notes excluded
    ecfr_sections_full     stored current section text
    crs_reports            title, content type and topics (the corpus stores no report text)
    caselaw_scotus         Supreme Court majority/lead opinions from the case-law reading store (needs storage access; run by
                           whoever holds the service credential, see ScotusSource)
    congress_bills         titles, policy area, subjects and the CRS summary as stored
    oversight_reports      title, reporting office, agency and the description as published
    doj_oig_reports        the same fields for the Department of Justice OIG
    ftc_publications_index title, series and the summary as published
"""
from __future__ import annotations

import gzip
import json
import os
import re
from collections.abc import Callable, Iterator
from typing import Any

from chunking import Doc

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BUILD = os.path.join(ROOT, "private", "build")

SOURCE_FILES = {
    "us_code_sections": os.path.join(BUILD, "uscode", "us_code_sections.json.gz"),
    "ecfr_sections_full": os.path.join(BUILD, "ecfr_full", "ecfr_sections_full.rows.jsonl.gz"),
    "crs_reports": os.path.join(BUILD, "legislation", "crs_reports.json"),
    "congress_bills": os.path.join(BUILD, "legislation", "congress_bills.rows.jsonl.gz"),
    "oversight_reports": os.path.join(BUILD, "oversight", "oversight_reports.json"),
    "doj_oig_reports": os.path.join(BUILD, "oversight", "doj_oig_reports.json"),
    "ftc_publications_index": os.path.join(BUILD, "ftc_data", "ftc_publications_index.json"),
}
USC_TITLES_FILE = os.path.join(BUILD, "uscode", "us_code_titles.json")

# Whether the chunk offsets index the corpus's stored text (False) or a text composed from record fields (True).
COMPOSED = {
    "us_code_sections": False,
    "ecfr_sections_full": False,
    "caselaw_scotus": False,
    "crs_reports": True,
    "congress_bills": True,
    "oversight_reports": True,
    "doj_oig_reports": True,
    "ftc_publications_index": True,
}
# The corpus_records dataset a semantic dataset's record ids belong to (the opinion index is keyed by cluster id).
CORPUS_DATASET = {d: d for d in COMPOSED if d != "caselaw_scotus"}

LABELS = {
    "us_code_sections": "U.S. Code sections",
    "ecfr_sections_full": "Code of Federal Regulations",
    "crs_reports": "CRS reports",
    "caselaw_scotus": "Supreme Court opinions",
    "congress_bills": "Federal bills",
    "oversight_reports": "Inspector General reports",
    "doj_oig_reports": "DOJ Inspector General reports",
    "ftc_publications_index": "FTC reports",
}

_WS = re.compile(r"\s+")


def encode_href(path: str) -> str:
    """In-app path with every segment percent-encoded the way the app's own links are (encodeURIComponent: spaces, '+', ':' and
    '/' inside a segment are escaped). Idempotent: an already encoded segment is decoded first, so it is never encoded twice."""
    from urllib.parse import quote, unquote

    if not path.startswith("/") or "?" in path or "#" in path:
        raise ValueError(f"not an in-app path: {path!r}")
    return "/" + "/".join(quote(unquote(seg), safe="!~*'()") for seg in path[1:].split("/"))


def _one_line(value: Any) -> str:
    return _WS.sub(" ", value).strip() if isinstance(value, str) else ""


def _load_rows(path: str) -> Iterator[dict]:
    """Rows of a build file: a JSON object with a `rows` array, or one JSON row per line."""
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as handle:
        head = handle.read(1)
        handle.seek(0)
        if path.endswith(".jsonl.gz") or path.endswith(".jsonl"):
            for line in handle:
                if line.strip():
                    yield json.loads(line)
        else:
            assert head == "{", path
            yield from json.load(handle)["rows"]


def source_file_digest(dataset: str) -> dict:
    """Size and sha256 of the build file a dataset is read from (recorded in the manifest)."""
    import hashlib

    path = SOURCE_FILES[dataset]
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return {"path": os.path.relpath(path, ROOT), "bytes": os.path.getsize(path), "sha256": h.hexdigest()}


# ---------------------------------------------------------------------------------------------------------------- U.S. Code
def _usc_title_names() -> dict[str, str]:
    out = {}
    try:
        with open(USC_TITLES_FILE, encoding="utf-8") as handle:
            for r in json.load(handle)["rows"]:
                t = r.get("detail", {}).get("usc_title", {})
                if t.get("number") is not None and t.get("name"):
                    out[str(t["number"])] = _one_line(t["name"])
    except OSError:
        pass
    return out


def usc_doc(row: dict, titles: dict[str, str]) -> Doc | None:
    text = row.get("text") or ""
    if not text.strip():
        return None  # repealed, transferred, omitted and reserved sections have no operative text
    u = (row.get("detail") or {}).get("usc") or {}
    title, key = str(u.get("title") or ""), str(u.get("key") or "")
    if not title or not key:
        return None
    citation = _one_line(u.get("citation")) or _one_line(row.get("title"))
    heading_text = _one_line(u.get("heading"))
    trail = [f"Title {title} {titles[title]}" if title in titles else f"Title {title}"]
    for entry in u.get("path") or []:
        if isinstance(entry, list) and len(entry) >= 4:
            label = _one_line(f"{entry[2]} {entry[3]}")
            if label:
                trail.append(label)
    trail.append(f"{citation} {heading_text}".strip())
    return Doc(
        dataset="us_code_sections",
        record_id=str(row["id"]),
        title=_one_line(row.get("title")) or citation,
        heading=" > ".join(trail),
        text=text,
        href=encode_href(f"/law/uscode/{title}/{key}"),
        source_url=row.get("source_url") or None,
        max_chunks=60,
    )


def iter_us_code_sections(path: str | None = None) -> Iterator[Doc]:
    titles = _usc_title_names()

    def order(row: dict):
        t, _, k = str(row["id"]).partition(":")
        return (int(t) if t.isdigit() else 10_000, t, k)

    rows = sorted(_load_rows(path or SOURCE_FILES["us_code_sections"]), key=order)
    for row in rows:
        doc = usc_doc(row, titles)
        if doc:
            yield doc


# ---------------------------------------------------------------------------------------------------------------------- CFR
def cfr_doc(row: dict) -> Doc | None:
    text = row.get("text") or ""
    d = row.get("detail") or {}
    if not text.strip() or d.get("reserved") is True:
        return None
    title_no, ident = str(d.get("title_number") or ""), str(d.get("identifier") or "")
    if not title_no or not ident:
        return None
    where = _one_line((row.get("item") or {}).get("subtitle") or d.get("subtitle"))
    title = _one_line(row.get("title"))
    return Doc(
        dataset="ecfr_sections_full",
        record_id=str(row["id"]),
        title=title,
        heading=f"Code of Federal Regulations > {where} > {title}" if where else f"Code of Federal Regulations > {title}",
        text=text,
        href=encode_href(f"/law/cfr/{title_no}/{ident}"),
        source_url=d.get("ecfr_url") or row.get("source_url") or None,
        max_chunks=60,
    )


def iter_ecfr_sections_full(path: str | None = None) -> Iterator[Doc]:
    for row in _load_rows(path or SOURCE_FILES["ecfr_sections_full"]):
        doc = cfr_doc(row)
        if doc:
            yield doc


# ---------------------------------------------------------------------------------------------------- composed-text corpora
def _join(lines: list[str]) -> str:
    return "\n".join(x for x in lines if x)


def crs_doc(row: dict) -> Doc | None:
    crs = (row.get("detail") or {}).get("crs") or {}
    title = _one_line(crs.get("title") or (row.get("item") or {}).get("cells", {}).get("title"))
    if not title:
        return None
    topics = [_one_line(t) for t in crs.get("topics") or [] if isinstance(t, str) and t.strip()]
    kind = _one_line(crs.get("contentType"))
    body = _join([f"Topics: {'; '.join(topics)}" if topics else "", f"Type: {kind}" if kind else ""])
    rid = str(row["id"])
    return Doc(
        dataset="crs_reports",
        record_id=rid,
        title=_one_line(row.get("title")) or title,
        heading=f"Congressional Research Service > {title}",
        text=body or title,
        href=encode_href(f"/records/crs_reports/{rid}"),
        source_url=row.get("source_url") or None,
        max_chunks=2,
    )


def iter_crs_reports(path: str | None = None) -> Iterator[Doc]:
    for row in _load_rows(path or SOURCE_FILES["crs_reports"]):
        doc = crs_doc(row)
        if doc:
            yield doc


def _summary_lines(summary: Any) -> list[str]:
    out: list[str] = []
    for block in (summary or {}).get("blocks", []) if isinstance(summary, dict) else []:
        x = _one_line(block.get("x"))
        if not x:
            continue
        out.append(f"- {x}" if block.get("k") == "li" else x)
    return out


def bill_doc(row: dict) -> Doc | None:
    b = (row.get("detail") or {}).get("bill") or {}
    titles = b.get("titles") or {}
    display = _one_line(titles.get("display"))
    citation = _one_line(b.get("display")) or _one_line((row.get("item") or {}).get("cells", {}).get("citation"))
    if not (display or citation):
        return None
    official = []
    for t in titles.get("official") or []:
        o = _one_line(t.get("title")) if isinstance(t, dict) else ""
        if o and o != display and o not in official:
            official.append(o)
    subjects = [_one_line(s) for s in (b.get("subjects") or [])[:14] if isinstance(s, str) and s.strip()]
    area = _one_line(b.get("policyArea"))
    summary = _summary_lines(b.get("summary"))
    parts = [*(f"Official title: {o}" for o in official[:2])]
    if area:
        parts.append(f"Policy area: {area}")
    if subjects:
        parts.append(f"Subjects: {'; '.join(subjects)}")
    if summary:
        parts.append("Summary:\n" + "\n".join(summary))
    rid = str(row["id"])
    typ, number, congress = str(b.get("type") or ""), str(b.get("number") or ""), b.get("congress")
    href = encode_href(
        f"/law/legislation/federal/{congress}/{typ}/{number}"
        if congress and typ and number
        else f"/records/congress_bills/{rid}"
    )
    return Doc(
        dataset="congress_bills",
        record_id=rid,
        title=_one_line(row.get("title")) or citation,
        heading=f"{citation}: {display}" if display else citation,
        text="\n".join(parts) if parts else (display or citation),
        href=href,
        source_url=row.get("source_url") or None,
        max_chunks=6,
    )


def iter_congress_bills(path: str | None = None, newest_first: bool = True) -> Iterator[Doc]:
    docs = (bill_doc(row) for row in _load_rows(path or SOURCE_FILES["congress_bills"]))
    if not newest_first:
        yield from (d for d in docs if d)
        return
    # newest Congress first, so a budget or disk limit leaves the older bills out rather than the current ones
    buckets: dict[int, list[Doc]] = {}
    for d in docs:
        if d:
            buckets.setdefault(int(d.record_id.split("-", 1)[0]) if d.record_id.split("-", 1)[0].isdigit() else 0, []).append(d)
    for congress in sorted(buckets, reverse=True):
        yield from buckets[congress]


def oversight_doc(row: dict) -> Doc | None:
    o = (row.get("item") or {}).get("oversight") or {}
    title = _one_line(row.get("title"))
    if not title:
        return None
    desc = _one_line(o.get("description"))
    body = _join(
        [
            f"Reported by: {_one_line(o.get('oig'))}" if o.get("oig") else "",
            f"Agency reviewed: {_one_line(o.get('agency_reviewed'))}" if o.get("agency_reviewed") else "",
            f"Report type: {_one_line(o.get('type'))}" if o.get("type") else "",
            f"Description: {desc}" if desc else "",
        ]
    )
    rid = str(row["id"])
    return Doc(
        dataset="oversight_reports",
        record_id=rid,
        title=title,
        heading=f"Inspector General report > {title}",
        text=body or title,
        href=encode_href(f"/records/oversight_reports/{rid}"),
        source_url=row.get("source_url") or None,
        max_chunks=3,
    )


def doj_oig_doc(row: dict) -> Doc | None:
    d = (row.get("item") or {}).get("dojoig") or {}
    title = _one_line(row.get("title"))
    if not title:
        return None
    components = [_one_line(c) for c in d.get("components") or [] if isinstance(c, str) and c.strip()]
    body = _join(
        [
            f"Report type: {_one_line(d.get('type'))}" if d.get("type") else "",
            f"Components: {'; '.join(components)}" if components else "",
            f"Entity: {_one_line(d.get('entity'))}" if d.get("entity") else "",
            f"Location: {_one_line(d.get('location'))}" if d.get("location") else "",
            f"Description: {_one_line(d.get('description'))}" if d.get("description") else "",
        ]
    )
    rid = str(row["id"])
    return Doc(
        dataset="doj_oig_reports",
        record_id=rid,
        title=title,
        heading=f"Department of Justice Inspector General report > {title}",
        text=body or title,
        href=encode_href(f"/records/doj_oig_reports/{rid}"),
        source_url=row.get("source_url") or None,
        max_chunks=3,
    )


def ftc_publication_doc(row: dict) -> Doc | None:
    item = row.get("item") or {}
    title = _one_line(row.get("title"))
    summary = _one_line(item.get("summary"))
    if not title:
        return None
    series = _one_line((item.get("cells") or {}).get("series"))
    body = _join([f"Series: {series}" if series else "", summary])
    rid = str(row["id"])
    return Doc(
        dataset="ftc_publications_index",
        record_id=rid,
        title=title,
        heading=f"Federal Trade Commission > {title}",
        text=body or title,
        href=encode_href(f"/records/ftc_publications_index/{rid}"),
        source_url=item.get("page_url") or row.get("source_url") or None,
        max_chunks=3,
    )


def _iter_with(builder: Callable[[dict], Doc | None], dataset: str, path: str | None) -> Iterator[Doc]:
    for row in _load_rows(path or SOURCE_FILES[dataset]):
        doc = builder(row)
        if doc:
            yield doc


def iter_oversight_reports(path: str | None = None) -> Iterator[Doc]:
    return _iter_with(oversight_doc, "oversight_reports", path)


def iter_doj_oig_reports(path: str | None = None) -> Iterator[Doc]:
    return _iter_with(doj_oig_doc, "doj_oig_reports", path)


def iter_ftc_publications_index(path: str | None = None) -> Iterator[Doc]:
    return _iter_with(ftc_publication_doc, "ftc_publications_index", path)


ITERATORS: dict[str, Callable[..., Iterator[Doc]]] = {
    "us_code_sections": iter_us_code_sections,
    "ecfr_sections_full": iter_ecfr_sections_full,
    "crs_reports": iter_crs_reports,
    "congress_bills": iter_congress_bills,
    "oversight_reports": iter_oversight_reports,
    "doj_oig_reports": iter_doj_oig_reports,
    "ftc_publications_index": iter_ftc_publications_index,
}
