"""Rows of ecfr_subject_index: one record per subject heading of the CFR Subject/Agency Index (long headings in segments).

A heading's entries are kept in print order with their nesting level and their CFR references exactly as printed. A
heading with more than SEGMENT entries is split at a first-level entry (or, inside one very long group, at the entry that
reaches 2 x SEGMENT) into consecutive records "Heading (part k of m)" so that no stored record becomes unwieldy; every
segment repeats the heading and carries its own printed page range and its own CFR part filter.
"""
from __future__ import annotations

import collections
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import authorities_common as C  # noqa: E402
import corpus_writer as writer  # noqa: E402
import subject_parse as S  # noqa: E402

DATASET = "ecfr_subject_index"
LABEL = "CFR Subject/Agency Index (CFR Index and Finding Aids)"
SEGMENT = 150
GRANULE_NUMBER = 2


def source_urls(year: str) -> tuple[str, str]:
    pkg = C.PACKAGE_FMT.format(year=year)
    gid = f"{pkg}-{GRANULE_NUMBER}"
    return (
        f"https://www.govinfo.gov/app/details/{pkg}/{gid}",
        f"https://www.govinfo.gov/content/pkg/{pkg}/pdf/{gid}.pdf",
    )


def segments(entries: list[S.Entry], size: int = SEGMENT) -> list[list[S.Entry]]:
    out: list[list[S.Entry]] = []
    cur: list[S.Entry] = []
    for e in entries:
        if cur and ((len(cur) >= size and e.level == 0) or len(cur) >= 2 * size):
            out.append(cur)
            cur = []
        cur.append(e)
    if cur or not out:
        out.append(cur)
    return out


def letter_of(heading: str) -> str:
    c = heading.strip()[:1].upper()
    return c if c.isalpha() else "#"


def build_rows(headings: list[S.Heading], *, year: str, retrieved_at: str, part_ids: set[str], revised_as_of: str) -> tuple[list[dict], dict]:
    details_url, pdf_url = source_urls(year)
    rows: list[dict] = []
    seen: collections.Counter = collections.Counter()
    refs_total = 0
    refs_resolved = 0
    parts_seen: set[tuple[int, str]] = set()
    parts_resolved: set[tuple[int, str]] = set()
    entries_total = 0
    xrefs_total = 0
    no_ref_entries = 0
    segmented = 0
    for h in headings:
        stem = f"subject:{C.slug(h.text)}"
        seen[stem] += 1
        base = stem if seen[stem] == 1 else f"{stem}~{seen[stem]}"
        segs = segments(h.entries)
        if len(segs) > 1:
            segmented += 1
        for k, seg in enumerate(segs, 1):
            rid = base if len(segs) == 1 else f"{base}:part{k}"
            title = h.text if len(segs) == 1 else f"{h.text} (part {k} of {len(segs)})"
            refs = [(e, r) for e in seg for r in e.refs]
            titles = sorted({r["title"] for _, r in refs})
            pairs = sorted({(r["title"], r["part"]) for _, r in refs})
            for t, p in pairs:
                parts_seen.add((t, p))
                if f"cfr:{t}:part-{p}" in part_ids:
                    parts_resolved.add((t, p))
            refs_total += len(refs)
            refs_resolved += sum(1 for _, r in refs if f"cfr:{r['title']}:part-{r['part']}" in part_ids)
            n_x = sum(1 for e in seg if e.xref)
            entries_total += len(seg)
            xrefs_total += n_x
            no_ref_entries += sum(1 for e in seg if not e.xref and not e.refs)
            pages = {e.pdf_page + 1 for e in seg}
            if k == 1 or not pages:
                pages.add(h.pdf_page + 1)
            pages = sorted(pages)
            page_text = f"{pages[0]}" if pages[0] == pages[-1] else f"{pages[0]}–{pages[-1]}"
            xref_texts = [e.text for e in seg if e.xref and e.level == 0][:6]
            cells = {
                "heading": title,
                "entries": str(len(seg) - n_x),
                "cfr_references": str(len(refs)),
                "cfr_titles": ", ".join(str(t) for t in titles) if titles else "Not recorded",
                "page": page_text,
            }
            link = {"url": pdf_url + f"#page={pages[0]}", "label": f"CFR Index and Finding Aids, {year} (GovInfo PDF, page {pages[0]})"}
            facts = [
                ["Subject heading as printed", h.text],
                ["Entries in this record", str(len(seg) - n_x)],
                ["CFR references", str(len(refs))],
                ["Distinct CFR parts referenced", str(len(pairs))],
                ["Printed pages", page_text],
                ["Edition", f"CFR Index and Finding Aids, {year}"],
                ["Index covers regulations codified as of", revised_as_of],
                ["Source", pdf_url],
                ["Retrieved", retrieved_at],
            ]
            if len(segs) > 1:
                facts.insert(2, ["Segment", f"part {k} of {len(segs)} of a long heading"])
            filters: dict[str, list[str]] = {"letter": [letter_of(h.text)]}
            if titles:
                filters["cfr_title"] = [str(t) for t in titles]
            if pairs:
                filters["cfr_part"] = [f"{t}:{p}" for t, p in pairs]
            row = writer.record(
                DATASET,
                rid,
                title,
                source_url=link["url"],
                cells=cells,
                facts=facts,
                text=" ".join([h.text] + [e.text for e in seg]),
                filters=filters,
                subtitle=f"Printed page {page_text}",
                badges=[],
                links=[link],
            )
            row["detail"]["subject"] = {
                "edition": year,
                "heading": h.text,
                "segment": {"index": k, "of": len(segs)},
                "pages": [pages[0], pages[-1]],
                "xrefs": xref_texts,
                "entries": [
                    {"l": e.level, "t": e.text, **({"x": 1} if e.xref else {}), **({"r": [[r["title"], r["part"], r["sections"]] for r in e.refs]} if e.refs else {})}
                    for e in seg
                ],
            }
            rows.append(row)
    stats = {
        "headings": len(headings),
        "records": len(rows),
        "headings_in_segments": segmented,
        "entries": entries_total,
        "cross_reference_entries": xrefs_total,
        "entries_without_cfr_reference": no_ref_entries,
        "cfr_references": refs_total,
        "cfr_references_to_stored_parts": refs_resolved,
        "distinct_cfr_parts_referenced": len(parts_seen),
        "distinct_cfr_parts_stored": len(parts_resolved),
    }
    return rows, stats


def listing_block() -> dict:
    letters = {chr(c): chr(c) for c in range(ord("A"), ord("Z") + 1)}
    return writer.listing(
        [
            ("heading", "Subject heading"),
            ("entries", "Entries"),
            ("cfr_references", "CFR references"),
            ("cfr_titles", "CFR titles"),
            ("page", "Page"),
        ],
        [
            ("letter", "Begins with", letters),
            ("cfr_title", "CFR title", {str(n): f"Title {n}" for n in range(1, 51) if n != 35}),
        ],
    )
