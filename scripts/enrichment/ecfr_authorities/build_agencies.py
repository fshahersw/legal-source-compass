"""Rows of ecfr_agencies: the eCFR's own agency list (admin API) plus the printed list of agency-prepared CFR indexes.

One record per agency node exactly as the eCFR lists it (parents and child agencies, slug unique), carrying the CFR
titles and chapters it is responsible for as published. Six further records (kind "agency_prepared_index") are the rows of
the printed "List of Agency-Prepared Indexes Appearing in Individual CFR Volumes"; each is linked to an agency only on an
exact title + single-chapter match to exactly one agency.

A link to the Atlas agency profile (/agencies/<id>) is made only when the eCFR slug equals the Federal Register agency slug
of exactly one stored fr_agency_profiles record.
"""
from __future__ import annotations

import collections
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import agencies_parse as A  # noqa: E402
import authorities_common as C  # noqa: E402
import corpus_writer as writer  # noqa: E402

DATASET = "ecfr_agencies"
LABEL = "eCFR agencies and the CFR titles and chapters they are responsible for"
API_URL = "https://www.ecfr.gov/api/admin/v1/agencies.json"
FR_SLUG = re.compile(r"^https://www\.federalregister\.gov/agencies/([a-z0-9-]+)$")


def fr_slug_index(fr_rows: list[dict]) -> dict[str, str]:
    """Federal Register agency slug -> stored agency id, for slugs that occur exactly once."""
    found: dict[str, set[str]] = collections.defaultdict(set)
    for r in fr_rows:
        for link in (r.get("item") or {}).get("links", []):
            m = FR_SLUG.match(link.get("url", ""))
            if m:
                found[m.group(1)].add(str(r["id"]))
    return {s: next(iter(ids)) for s, ids in found.items() if len(ids) == 1}


def build_rows(
    agencies: list[dict],
    prepared: list[dict],
    *,
    year: str,
    retrieved_at: str,
    fr_slugs: dict[str, str],
    titles_asof: str | None,
) -> tuple[list[dict], dict]:
    by_slug = {a["slug"]: a for a in agencies}
    rows: list[dict] = []
    linked_fr = 0
    for a in agencies:
        refs = a["cfr_references"]
        ref_lines = [A.ref_text(r) for r in refs]
        titles = sorted({r["title"] for r in refs if r.get("title") is not None})
        parent = by_slug.get(a["parent"]) if a["parent"] else None
        children = [by_slug[s] for s in a["children"] if s in by_slug]
        fr_id = fr_slugs.get(a["slug"])
        if fr_id:
            linked_fr += 1
        links = [{"url": API_URL, "label": "eCFR agency list (admin API)"}]
        links += [{"url": f"/law/cfr/{t}", "label": f"CFR title {t} in the Atlas"} for t in titles[:12]]
        if fr_id:
            links.append({"url": f"/agencies/{fr_id}", "label": "Agency profile in the Atlas"})
        cells = {
            "name": a["name"],
            "short_name": a["short_name"] or "Not recorded",
            "kind": "Component agency" if a["parent"] else "Agency",
            "parent": parent["name"] if parent else "None",
            "children": str(len(children)),
            "cfr_references": "; ".join(ref_lines) if ref_lines else "Not recorded",
        }
        facts = [
            ["Name", a["name"]],
            ["Short name", a["short_name"] or "Not recorded"],
            ["Display name", a["display_name"] or "Not recorded"],
            ["Sortable name", a["sortable_name"] or "Not recorded"],
            ["Slug", a["slug"]],
            ["Parent agency", parent["name"] if parent else "None (top level)"],
            ["Child agencies", str(len(children))],
            ["CFR titles and chapters, as published", "; ".join(ref_lines) if ref_lines else "Not recorded"],
            ["Source", API_URL],
            ["Retrieved", retrieved_at],
        ]
        filters = {
            "kind": ["child" if a["parent"] else "top"],
            "cfr_title": [str(t) for t in titles],
            "slug": [a["slug"]],
        }
        if a["parent"]:
            filters["parent"] = [a["parent"]]
        row = writer.record(
            DATASET,
            f"agency:{a['slug']}",
            a["name"],
            source_url=API_URL,
            cells=cells,
            facts=facts,
            text=" ".join(filter(None, [a["name"], a["short_name"], a["display_name"], a["sortable_name"], a["slug"]] + ref_lines)),
            filters=filters,
            subtitle=(f"Part of {parent['name']}" if parent else (f"{len(children)} component agencies" if children else "")),
            badges=["Component agency"] if a["parent"] else ["Agency"],
            links=links,
        )
        row["detail"]["agency"] = {
            "slug": a["slug"],
            "name": a["name"],
            "short_name": a["short_name"],
            "display_name": a["display_name"],
            "sortable_name": a["sortable_name"],
            "parent": a["parent"],
            "children": [{"slug": c["slug"], "name": c["name"]} for c in children],
            "cfr_references": refs,
            "order": a["order"],
            "fr_agency_id": fr_id,
        }
        rows.append(row)
    pkg = C.PACKAGE_FMT.format(year=year)
    gid = f"{pkg}-3"
    pdf_url = f"https://www.govinfo.gov/content/pkg/{pkg}/pdf/{gid}.pdf"
    linked_prep = 0
    for i, p in enumerate(prepared, 1):
        link = A.link_prepared(p, agencies)
        if link["slug"]:
            linked_prep += 1
        title = f"{p['cfr_title']} CFR {p['scope']}".strip() + (f" — {p['agency_as_printed']}" if p["agency_as_printed"] else "")
        cells = {
            "name": title,
            "kind": "Agency-prepared index",
            "cfr_references": p["left_as_printed"],
            "parent": p["agency_as_printed"] or "Not recorded",
        }
        facts = [
            ["CFR title and chapter or parts, as printed", p["left_as_printed"]],
            ["Agency, as printed", p["agency_as_printed"] or "Not recorded"],
            ["Indexes printed", p["indexes_printed"] or "Not recorded"],
            ["Linked agency", by_slug[link["slug"]]["name"] if link["slug"] else f"Not linked ({link['reason']})"],
            ["Edition", f"CFR Index and Finding Aids, {year}"],
            ["Source", pdf_url],
            ["Retrieved", retrieved_at],
        ]
        links = [{"url": pdf_url, "label": f"CFR Index and Finding Aids, {year} (GovInfo PDF)"}, {"url": f"/law/cfr/{p['cfr_title']}", "label": f"CFR title {p['cfr_title']} in the Atlas"}]
        if link["slug"]:
            links.append({"url": f"/records/{DATASET}/agency:{link['slug']}", "label": "Agency record"})
        row = writer.record(
            DATASET,
            f"prepared-index:{p['cfr_title']}-{i}",
            title,
            source_url=pdf_url,
            cells=cells,
            facts=facts,
            text=" ".join([p["left_as_printed"], p["agency_as_printed"] or ""]),
            filters={"kind": ["prepared_index"], "cfr_title": [str(p["cfr_title"])], **({"slug": [link["slug"]]} if link["slug"] else {})},
            subtitle="Agency-prepared index appearing in CFR volumes",
            badges=["Agency-prepared index"],
            links=links,
        )
        row["detail"]["prepared_index"] = {**p, "linked_agency": link["slug"], "not_linked_reason": link["reason"], "edition": year}
        rows.append(row)
    stats = {
        "agency_records": len(agencies),
        "top_level": sum(1 for a in agencies if not a["parent"]),
        "child_agencies": sum(1 for a in agencies if a["parent"]),
        "references": sum(len(a["cfr_references"]) for a in agencies),
        "linked_to_fr_profile": linked_fr,
        "prepared_index_records": len(prepared),
        "prepared_index_linked": linked_prep,
        "cfr_titles_as_of": titles_asof,
    }
    return rows, stats


def listing_block() -> dict:
    return writer.listing(
        [
            ("name", "Name"),
            ("short_name", "Short name"),
            ("kind", "Kind"),
            ("parent", "Parent"),
            ("cfr_references", "CFR titles and chapters"),
        ],
        [
            ("kind", "Kind", {"top": "Agency", "child": "Component agency", "prepared_index": "Agency-prepared index"}),
            ("cfr_title", "CFR title", {str(n): f"Title {n}" for n in range(1, 51) if n != 35}),
        ],
    )
