"""Pure helpers for the ecfr_parallel_authorities rows: ids, citations, exact-key link states, filters.

Linking rules (the stream brief, restated as code):
  * A U.S. Code authority links to a stored section only when title and section key match a stored us_code_sections id
    exactly (id = "<title>:<key>", appendix titles "5a"). Nothing is expanded, normalised for case or matched by range.
  * "N et seq." and "A--B" are kept as published. They are never linked as a section; the start/end key is recorded so
    the section page can show them as a separate, labelled group.
  * "N note" is the note that follows section N: it links to section N and keeps the state `resolved_note`.
  * A CFR part links to a stored ecfr_sections_full part only on exact title + part designation
    (id = "cfr:<title>:part-<part>"). A part range ("1301--1309") is not expanded.
"""
from __future__ import annotations

import re

import ptoa_parse as P

DATASET = "ecfr_parallel_authorities"
PACKAGE_FMT = "GPO-CFR-INDEX-{year}"

CATEGORY_LABEL = {
    "usc": "U.S. Code",
    "stat": "Statutes at Large",
    "publaw": "Public law",
    "presidential": "Presidential document",
}

LINK_LABEL = {
    "resolved": "Section stored",
    "resolved_note": "Note to a stored section",
    "not_in_stored_code": "Not in the stored Code",
    "et_seq": "“et seq.” (kept as published)",
    "range": "Range (kept as published)",
    "other_form": "Other form (kept as published)",
    "not_applicable": "Not a U.S. Code authority",
}


def slug(text: str) -> str:
    return re.sub(r"\s+", "_", text.strip())


def usc_citation(entry: P.Entry) -> str:
    """Display citation composed from the printed heading and authority (a label, not a quotation)."""
    a = entry.authority
    if entry.category == "usc":
        t = entry.usc_title or ""
        if t.endswith("a"):
            return f"{t[:-1]} U.S.C. App." if a == "App." else f"{t[:-1]} U.S.C. App. {a}"
        if entry.variant == "1939 I.R.C.":
            return f"26 U.S.C. (1939 I.R.C.) {a}"
        return f"{t} U.S.C. {a}"
    if entry.category == "stat":
        return f"{entry.heading.replace(' Stat.', '')} Stat. {a}"
    if entry.category == "publaw":
        return f"Pub. L. {a}"
    return f"{entry.sub}: {a}"


def entry_key(entry: P.Entry) -> str:
    """Stable id stem for an authority (without the CFR title)."""
    if entry.category == "usc":
        t = entry.usc_title or ""
        if entry.variant:
            t += "." + entry.variant.split(" ")[0]
        return f"usc:{t}:{slug(entry.authority)}"
    if entry.category == "stat":
        return f"stat:{entry.heading.replace(' Stat.', '')}:{slug(entry.authority)}"
    if entry.category == "publaw":
        return f"publaw:{slug(entry.authority)}"
    return f"pres:{slug(entry.sub or '')}:{slug(entry.authority)}"


def usc_link(entry: P.Entry, section_ids: set[str]) -> dict:
    """The U.S. Code link state of one authority. `section_ids` is the set of stored us_code_sections ids."""
    if entry.category != "usc":
        return {"state": "not_applicable"}
    cls = P.classify_usc(entry.authority)
    kind = cls["kind"]
    title = entry.usc_title or ""
    if entry.variant == "1939 I.R.C.":
        return {
            "state": "not_in_stored_code",
            "kind": kind,
            "reason": "Section of the Internal Revenue Code of 1939; the stored Title 26 is the 1986 Code",
        }

    def stored(key: str) -> bool:
        return f"{title}:{key}" in section_ids

    if kind in ("exact", "note"):
        key = cls["keys"][0]
        if stored(key):
            return {
                "state": "resolved" if kind == "exact" else "resolved_note",
                "kind": kind,
                "id": f"{title}:{key}",
                "title": title,
                "key": key,
                "href": f"/law/uscode/{title}/{key}",
            }
        reason = (
            "Appendix units are stored under their own keys; no stored unit has this designation"
            if title.endswith("a")
            else "No section with this title and number in the stored Code"
        )
        return {"state": "not_in_stored_code", "kind": kind, "title": title, "key": key, "reason": reason}
    if kind == "et_seq":
        return {"state": "et_seq", "kind": kind, "title": title, "start": cls["start"], "start_stored": stored(cls["start"])}
    if kind == "range":
        return {
            "state": "range",
            "kind": kind,
            "title": title,
            "start": cls["start"],
            "end": cls["end"],
            "start_stored": stored(cls["start"]),
            "end_stored": stored(cls["end"]),
        }
    return {"state": "other_form", "kind": kind, "title": title}


def usc_filter_values(entry: P.Entry, link: dict) -> dict[str, list[str]]:
    """Filter arrays that let a page ask for exactly one section (usc) or a range/et seq. starting or ending there."""
    out: dict[str, list[str]] = {}
    if entry.category != "usc" or entry.variant == "1939 I.R.C.":
        return out
    title = entry.usc_title or ""
    kind = link.get("kind")
    if kind in ("exact", "note"):
        out["usc"] = [f"{title}:{link['key']}"]
    elif kind == "et_seq":
        out["usc_edge"] = [f"{title}:{link['start']}"]
    elif kind == "range":
        edges = [f"{title}:{link['start']}"]
        if link["end"] != link["start"]:
            edges.append(f"{title}:{link['end']}")
        out["usc_edge"] = edges
    return out


def part_state(cfr_title: int, token: str, part_ids: set[str]) -> dict:
    pid = f"cfr:{cfr_title}:part-{token}"
    if pid in part_ids:
        return {"part": token, "state": "resolved", "id": pid, "href": f"/law/cfr/{cfr_title}/part/{token}"}
    return {"part": token, "state": "not_in_stored_ecfr"}


def cfr_label(group: P.Group) -> str:
    return f"{group.cfr_title} CFR {group.label or 'Part'} {group.text}"


def short_title(group: P.Group, limit: int = 10) -> str:
    toks = group.parts + group.part_ranges + group.unparsed_tokens
    if len(toks) <= limit and group.text:
        text = group.text
    else:
        text = ", ".join(toks[:limit]) + f", … ({len(toks)} in all)"
    return f"{group.cfr_title} CFR {group.label or 'Part'} {text}"
