"""Parsers for the eCFR agency list (admin API agencies.json) and the printed list of agency-prepared CFR indexes.

agencies.json: {"agencies": [{name, short_name, display_name, sortable_name, slug, cfr_references: [{title, chapter,
subtitle, subchapter, part}], children: [...]}]}. Every node is kept with its parent; references are kept exactly as
published (a key the eCFR omits stays absent; a null stays null).

Agency-prepared indexes (CFR Index and Finding Aids, "List of Agency-Prepared Indexes Appearing in Individual CFR
Volumes"): two printed columns, "Title and chapter or part" and "Agency". An index row is linked to an agency only on an
exact title + chapter match to exactly one agency's cfr_references; anything else stays unlinked.
"""
from __future__ import annotations

import html
import json
import re


def flatten(doc: dict) -> list[dict]:
    """Depth-first list of agency nodes: {..., "parent": slug|None, "depth": int, "order": int}."""
    out: list[dict] = []

    def walk(a: dict, parent: str | None, depth: int) -> None:
        node = {
            "name": a.get("name"),
            "short_name": a.get("short_name"),
            "display_name": a.get("display_name"),
            "sortable_name": a.get("sortable_name"),
            "slug": a.get("slug"),
            "cfr_references": [dict(r) for r in a.get("cfr_references", [])],
            "children": [c.get("slug") for c in a.get("children", [])],
            "parent": parent,
            "depth": depth,
            "order": len(out),
        }
        out.append(node)
        for c in a.get("children", []):
            walk(c, a.get("slug"), depth + 1)

    for a in doc.get("agencies", []):
        walk(a, None, 0)
    return out


def parse_agencies(raw: bytes) -> list[dict]:
    return flatten(json.loads(raw))


def ref_text(ref: dict) -> str:
    """'Title 21, Chapter I' from one published reference; only keys the eCFR printed are used."""
    parts = [f"Title {ref['title']}"] if ref.get("title") is not None else []
    for key, label in (("subtitle", "Subtitle"), ("chapter", "Chapter"), ("subchapter", "Subchapter"), ("part", "Part")):
        if ref.get(key) is not None:
            parts.append(f"{label} {ref[key]}")
    return ", ".join(parts)


def ref_key(ref: dict) -> tuple:
    return (ref.get("title"), ref.get("subtitle"), ref.get("chapter"), ref.get("subchapter"), ref.get("part"))


COL = 40
ENTRY = re.compile(r"^(\d{1,2}) CFR\b")
CHAPTER = re.compile(r"\bChapters? ([IVXLC]+(?: and [IVXLC]+)?)\b")


def parse_prepared_indexes(raw: str) -> list[dict]:
    """Rows of the agency-prepared index list, text as printed (wraps joined by one space)."""
    m = re.search(r"<pre>(.*?)</pre>", raw, flags=re.S)
    lines = html.unescape(m.group(1) if m else raw).split("\n")
    rows: list[dict] = []
    cur: dict | None = None
    started = False
    for line in lines:
        if line.startswith("----"):
            started = True
            continue
        if not started or not line.strip():
            continue
        if ENTRY.match(line):
            cur = {"left": [], "right": []}
            rows.append(cur)
        if cur is None:
            continue
        padded = line.rstrip()
        if len(padded) > COL and padded[COL - 2 : COL].strip() == "" and padded[COL - 1] == " ":
            left, right = padded[:COL].strip(), padded[COL:].strip()
        else:
            left, right = padded.strip(), ""
        if left:
            cur["left"].append(left)
        if right:
            cur["right"].append(right)
    out = []
    for r in rows:
        left = re.sub(r"\s+", " ", " ".join(r["left"])).strip()
        right = re.sub(r"\s+", " ", " ".join(r["right"])).strip()
        mt = ENTRY.match(left)
        count = re.search(r"\((\d+) indexes?\)", left)
        rest = left[mt.end() :].strip() if mt else left
        out.append(
            {
                "cfr_title": int(mt.group(1)) if mt else None,
                "scope": re.sub(r"\s*\(\d+ indexes?\)", "", rest).strip(),
                "indexes_printed": count.group(0) if count else None,
                "agency_as_printed": right or None,
                "left_as_printed": left,
            }
        )
    return out


def link_prepared(row: dict, agencies: list[dict]) -> dict:
    """Slug of the one agency whose cfr_references has exactly this title and single chapter; else None with a reason."""
    m = CHAPTER.search(row["scope"])
    if not m or " and " in m.group(1) or row["cfr_title"] is None:
        return {"slug": None, "reason": "scope is not a single chapter"}
    chapter = m.group(1)
    hits = [
        a["slug"]
        for a in agencies
        if any(r.get("title") == row["cfr_title"] and r.get("chapter") == chapter and r.get("subtitle") is None for r in a["cfr_references"])
    ]
    if len(hits) == 1:
        return {"slug": hits[0], "reason": None}
    return {"slug": None, "reason": f"{len(hits)} agencies list title {row['cfr_title']}, chapter {chapter}"}
