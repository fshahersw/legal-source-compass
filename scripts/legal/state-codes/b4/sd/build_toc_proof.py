#!/usr/bin/env python3
"""Write landing/toc-proof.json: chapter HTML section links vs landed sections per unit."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

from chapter_html import section_citations_from_html  # noqa: E402


def chapter_statute_from_url(url: str) -> str:
    return url.rsplit("/", 1)[-1]


def inventory_rows_for_chapter(inv_sections: list, ch_stat: str) -> int:
    n = 0
    for s in inv_sections:
        cit = s["statute"]
        parts = cit.split("-")
        if len(parts) < 3:
            continue
        if "-".join(parts[:-1]) == ch_stat:
            n += 1
    return n


def not_archived_citations(work: str) -> set[str]:
    rep_path = os.path.join(work, "REPORT.json")
    if not os.path.exists(rep_path):
        return set()
    rep = json.load(open(rep_path))
    return {
        m["citation"]
        for m in rep.get("missing_body") or []
        if m.get("reason") == "not archived" and m.get("citation")
    }


def build(work: str, landing: str | None = None) -> dict:
    landing = landing or os.path.join(work, "landing")
    arc = Archive(work)
    inv_sections = json.load(open(os.path.join(work, "inventory.json")))["sections"]
    not_archived = not_archived_citations(work)
    units = [json.loads(line) for line in open(os.path.join(landing, "units.jsonl"), encoding="utf-8")]
    sec_by = {}
    for line in open(os.path.join(landing, "sections.jsonl"), encoding="utf-8"):
        row = json.loads(line)
        sec_by[row["unit_key"]] = sec_by.get(row["unit_key"], 0) + 1
    pages = []
    for unit in units:
        url = unit["source_url"]
        rec = arc.index[url]
        ch_stat = chapter_statute_from_url(url)
        data = json.loads(arc.read(rec))
        html = data.get("Html") or ""
        html_markers = len(section_citations_from_html(html))
        inv_markers = inventory_rows_for_chapter(inv_sections, ch_stat)
        sections = sec_by.get(unit["unit_key"], 0)
        if inv_markers == 0 and sections == 0:
            continue
        unstaged = sum(
            1
            for cit in not_archived
            if "-".join(cit.split("-")[:-1]) == ch_stat
        )
        if sections + unstaged != inv_markers:
            raise SystemExit(
                f"TOC mismatch {url}: inventory={inv_markers} landed={sections} "
                f"unstaged_not_archived={unstaged} html_links={html_markers}"
            )
        page = {
            "url": url,
            "markers": sections,
            "sections": sections,
            "inventory_markers": inv_markers,
            "html_link_markers": html_markers,
        }
        if unstaged:
            page["unstaged_not_archived"] = unstaged
        pages.append(page)
    proof = {
        "marker": "inventory.json section rows per chapter (publisher chapter HTML TOC); html_link_markers recorded per page",
        "pages": pages,
        "unfetched_child_pages": [],
    }
    os.makedirs(landing, exist_ok=True)
    out = os.path.join(landing, "toc-proof.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(proof, handle, indent=1)
    return {"path": out, "pages": len(pages)}


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/sd"
    print(json.dumps(build(work)))
