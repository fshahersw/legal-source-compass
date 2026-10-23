"""Rows of ecfr_parallel_authorities: one record per authority and CFR title group, exactly as the table prints them.

A printed entry "301 et seq.....20 Part 658 / 29 Part 290" under "5 U.S.C." yields two records (CFR title 20 and CFR
title 29) that share the authority. The authority, the heading it is printed under, the parts list and the printed page
are kept as published; links and counts are derived from exact keys only (authorities_common).
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
import ptoa_parse as P  # noqa: E402

LABEL = "Parallel Table of Authorities and Rules (CFR Index and Finding Aids)"
GRANULE_NUMBER = 4


def source_urls(year: str, page: int | None) -> tuple[str, str]:
    pkg = C.PACKAGE_FMT.format(year=year)
    gid = f"{pkg}-{GRANULE_NUMBER}"
    details = f"https://www.govinfo.gov/app/details/{pkg}/{gid}"
    pdf = f"https://www.govinfo.gov/content/pkg/{pkg}/pdf/{gid}.pdf"
    return details, pdf


def pdf_page_of(printed_page: int | None, first_printed_page: int | None) -> int | None:
    """The PDF's first page carries the introduction (folio first-1); the table starts on its second page."""
    if printed_page is None or first_printed_page is None:
        return None
    return printed_page - first_printed_page + 2


def build_rows(
    result: P.ParseResult,
    *,
    year: str,
    retrieved_at: str,
    section_ids: set[str],
    part_ids: set[str],
) -> tuple[list[dict], dict]:
    rows: list[dict] = []
    seen: collections.Counter = collections.Counter()
    counts: dict = collections.Counter()
    authority_states: collections.Counter = collections.Counter()
    part_pairs: set[tuple[int, str]] = set()
    part_pairs_resolved: set[tuple[int, str]] = set()
    part_ranges = 0
    unparsed_tokens = 0
    first_page = result.pages[0]
    pkg = C.PACKAGE_FMT.format(year=year)
    details_url, pdf_url = source_urls(year, None)
    for e in result.entries:
        link = C.usc_link(e, section_ids)
        authority_states[(e.category, link["state"])] += 1
        counts[f"entries:{e.category}"] += 1
        citation = C.usc_citation(e)
        usc_filters = C.usc_filter_values(e, link)
        for g in e.groups:
            stem = C.entry_key(e) + f":cfr{g.cfr_title}"
            seen[stem] += 1
            rid = stem if seen[stem] == 1 else f"{stem}~{seen[stem]}"
            parts = [C.part_state(g.cfr_title, t, part_ids) for t in g.parts]
            for p in parts:
                part_pairs.add((g.cfr_title, p["part"]))
                if p["state"] == "resolved":
                    part_pairs_resolved.add((g.cfr_title, p["part"]))
            part_ranges += len(g.part_ranges)
            unparsed_tokens += len(g.unparsed_tokens)
            n_res = sum(1 for p in parts if p["state"] == "resolved")
            pdf_page = pdf_page_of(e.page, first_page)
            page_url = pdf_url + (f"#page={pdf_page}" if pdf_page else "")
            title = f"{citation} → {C.short_title(g)}"
            link_label = C.LINK_LABEL[link["state"]]
            cells = {
                "authority": citation,
                "category": C.CATEGORY_LABEL[e.category],
                "cfr_title": str(g.cfr_title),
                "parts": g.text,
                "parts_stored": f"{n_res} of {len(g.parts)}" if g.parts else "Not recorded",
                "u_s_code": link_label,
                "page": str(e.page) if e.page else "Not recorded",
            }
            links = [{"url": page_url, "label": f"CFR Index and Finding Aids, {year} (GovInfo PDF, printed page {e.page})"}]
            if link.get("href"):
                links.append({"url": link["href"], "label": f"{citation} in the Atlas"})
            facts = [
                ["Authority as printed", e.authority],
                ["Printed under", e.heading],
                ["CFR title", str(g.cfr_title)],
                [f"{g.label or 'Part'} as printed", g.text],
                ["U.S. Code link", link_label + (f" ({link['reason']})" if link.get("reason") else "")],
                ["Edition", f"CFR Index and Finding Aids, {year}"],
                ["Table revised as of", result.revised_as_of or "Not recorded"],
                ["Printed page", str(e.page) if e.page else "Not recorded"],
                ["Source", pdf_url],
                ["Retrieved", retrieved_at],
            ]
            if e.leader_missing:
                facts.append(["Typesetting note", "The printed row has no leader dots and its parts are printed on the next line; the authority and the parts are joined from those two consecutive printed lines, as printed."])
            filters: dict[str, list[str]] = {
                "category": [e.category],
                "cfr_title": [str(g.cfr_title)],
                "link": [link["state"]],
                **usc_filters,
            }
            if e.usc_title:
                filters["usc_title"] = [e.usc_title]
            if e.sub:
                filters["sub"] = [e.sub]
            if parts:
                filters["cfr_part"] = [f"{g.cfr_title}:{p['part']}" for p in parts]
            row = writer.record(
                C.DATASET,
                rid,
                title,
                source_url=page_url,
                cells=cells,
                facts=facts,
                text=f"{citation} {e.authority} {g.cfr_title} CFR {g.text}",
                filters=filters,
                subtitle=f"Printed under {e.heading}",
                badges=[C.CATEGORY_LABEL[e.category]],
                links=links,
            )
            row["detail"]["ptoa"] = {
                "edition": year,
                "package": pkg,
                "page": e.page,
                "heading": e.heading,
                "authority": e.authority,
                "citation": citation,
                "category": e.category,
                "sub": e.sub,
                "variant": e.variant,
                "link": link,
                "cfr": {
                    "title": g.cfr_title,
                    "label": g.label,
                    "parts_text": g.text,
                    "parts": [p["part"] for p in parts],
                    "parts_stored": [p["part"] for p in parts if p["state"] == "resolved"],
                    "part_ranges": g.part_ranges,
                    "unparsed": g.unparsed_tokens,
                },
                "leader_missing": e.leader_missing,
            }
            rows.append(row)
    stats = {
        "entries": len(result.entries),
        "rows": len(rows),
        "entries_by_category": {k.split(":", 1)[1]: v for k, v in counts.items() if k.startswith("entries:")},
        "authority_link_states": {f"{c}/{s}": n for (c, s), n in sorted(authority_states.items())},
        "authority_part_pairs": sum(len(r["detail"]["ptoa"]["cfr"]["parts"]) for r in rows),
        "distinct_cfr_parts": len(part_pairs),
        "distinct_cfr_parts_stored": len(part_pairs_resolved),
        "part_range_tokens": part_ranges,
        "unparsed_part_tokens": unparsed_tokens,
        "anomalies": result.anomalies,
        "pages": list(result.pages),
        "revised_as_of": result.revised_as_of,
    }
    return rows, stats


def listing_block() -> dict:
    return writer.listing(
        [
            ("authority", "Authority"),
            ("cfr_title", "CFR title"),
            ("parts", "Parts as printed"),
            ("parts_stored", "Parts stored"),
            ("u_s_code", "U.S. Code link"),
            ("page", "Page"),
        ],
        [
            ("category", "Authority type", {k: v for k, v in C.CATEGORY_LABEL.items()}),
            ("link", "U.S. Code link", {k: v for k, v in C.LINK_LABEL.items()}),
            ("cfr_title", "CFR title", {str(n): f"Title {n}" for n in range(1, 51) if n != 35}),
        ],
    )
