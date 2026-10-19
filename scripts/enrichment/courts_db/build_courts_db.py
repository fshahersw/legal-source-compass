"""Build courts_db: court metadata and structure from Free Law Project's Courts-DB, one record per court.

Input: courts_db/data/courts.json at the pinned revision (private/acq/courts_db/courts.json, BSD-2-Clause) and the court page ids
(court_spine; private/build/judge_xwalk/lookups/court_spine.jsonl). Courts-DB ids are CourtListener court ids, so a record links to a
court page only when its id is exactly a court_spine id; nothing is matched by name.

Each record keeps what Courts-DB records: level, type, system, location, citation string, the court's website, dates of operation
and reorganisation, divisions, alternate names, notes, the parent grouping (e.g. a county branch under its
statewide court), the courts grouped under it, and the appeal route where Courts-DB records one (appeal_to, lower_courts or a
federal circuit number). Codes are shown with their Courts-DB meaning; empty values are "Not recorded".

    python3 -I -B scripts/enrichment/courts_db/build_courts_db.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.parse
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402
import courtsdb_lib as lib  # noqa: E402

REVISION = "c22604df"
SOURCE = os.path.join(ROOT, "private", "acq", "courts_db", "courts.json")
SPINE = os.path.join(ROOT, "private", "build", "judge_xwalk", "lookups", "court_spine.jsonl")
OUT = os.path.join(ROOT, "private", "build", "courts_db")
PROJECT = "https://free.law/projects/courts-db/"
CREDIT = f"Courts-DB, compiled by Free Law Project (BSD-2-Clause), revision {REVISION}"


def website(value) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = urllib.parse.urlparse(value.strip())
    return value.strip() if parsed.scheme in ("http", "https") and parsed.netloc else None


def ref(cid: str, by_id: dict, spine: set) -> dict:
    court = by_id[cid]
    return {"id": cid, "name": court.get("name") or cid, "page": cid in spine,
            "level": lib.label(lib.LEVELS, court.get("level")), "active": court.get("active") if isinstance(court.get("active"), bool) else None}


def main():
    t0 = time.time()
    raw = open(SOURCE, "rb").read()
    courts = json.loads(raw)
    by_id = {c["id"]: c for c in courts}
    if len(by_id) != len(courts):
        raise SystemExit("duplicate Courts-DB ids")
    spine = {json.loads(line)["id"] for line in open(SPINE)}
    children = lib.children_index(by_id)
    appeals = lib.appeal_index(by_id)
    rows, counts = [], Counter()
    for cid in sorted(by_id):
        c = by_id[cid]
        chain = lib.parent_chain(cid, by_id)
        parent = chain[0] if chain else None
        siblings = len(children.get(parent, [])) - 1 if parent else 0
        target = c.get("appeal_to") if isinstance(c.get("appeal_to"), str) and c.get("appeal_to") in by_id else None
        circuit = lib.circuit_id(c, by_id)
        url = website(c.get("court_url"))
        level = lib.label(lib.LEVELS, c.get("level"))
        system = lib.label(lib.SYSTEMS, c.get("system"))
        ctype = lib.label(lib.TYPES, c.get("type"))
        periods = lib.periods(c.get("dates"))
        started = next((p["start"] for p in periods if p["start"]), None)
        ended = next((p["end"] for p in reversed(periods) if p["end"]), None)
        active = c.get("active") if isinstance(c.get("active"), bool) else None
        profile = {
            "court_id": cid, "name": c.get("name") or cid, "citation_string": c.get("citation_string") or None,
            "name_abbreviation": c.get("name_abbreviation") or None, "system": system, "level": level, "type": ctype,
            "level_code": c.get("level") or None, "location": c.get("location") or None, "jurisdiction": c.get("jurisdiction") or None,
            "active": active, "notes": (c.get("notes") or "").strip() or None, "court_url": url, "periods": periods,
            "divisions": lib.strings(c.get("divisions")), "division_type": c.get("division_type") or None,
            "sub_names": lib.strings(c.get("sub_names")), "locations_count": c.get("locations") if isinstance(c.get("locations"), int) else None,
            "parent_chain": [ref(p, by_id, spine) for p in chain],
            "children": [ref(k, by_id, spine) for k in children.get(cid, [])],
            "siblings": max(siblings, 0),
            "appeal_to": ref(target, by_id, spine) if target else None,
            "circuit": ref(circuit, by_id, spine) if circuit and circuit != target else None,
            "appealed_from": [ref(k, by_id, spine) for k in appeals.get(cid, [])],
            "has_page": cid in spine,
            "credit": CREDIT,
        }
        counts["records"] += 1
        counts["with_page"] += cid in spine
        counts["with_parent"] += bool(chain)
        counts["with_children"] += bool(profile["children"])
        counts["with_appeal_route"] += bool(target or circuit)
        counts["with_dates"] += bool(periods)
        counts["with_website"] += bool(url)
        counts["with_divisions"] += bool(profile["divisions"])
        links = ([{"label": "Court page", "url": f"/courts/{cid}"}] if cid in spine else []) + ([{"label": "Court website", "url": url}] if url else [])
        facts = [[k, lib.NOT_RECORDED if v in (None, "", []) else str(v)] for k, v in [
            ("Court", profile["name"]), ("Courts-DB id", cid), ("System", system), ("Level", level), ("Type", ctype),
            ("Location", profile["location"]), ("Citation string", profile["citation_string"]),
            ("Active", None if active is None else ("yes" if active else "no")),
            ("Began", started), ("Ended", ended),
            ("Reorganised", "; ".join(d for p in periods for d in p["reorganizations"]) or None),
            ("Part of", " → ".join(r["name"] for r in profile["parent_chain"]) or None),
            ("Courts grouped under it", len(profile["children"]) or None),
            ("Appeals go to", (profile["appeal_to"] or profile["circuit"] or {}).get("name")),
            ("Courts recorded as appealing here", len(profile["appealed_from"]) or None),
            ("Divisions", "; ".join(profile["divisions"]) or None),
            ("Other names", "; ".join(profile["sub_names"]) or None),
            ("Court website", url), ("Notes", profile["notes"]),
            ("Source", CREDIT + ". Dates are as Courts-DB records them; a court it does not list as active or inactive is shown as not recorded.")]]
        rows.append(writer.record(
            "courts_db", cid, profile["name"], source_url=url or PROJECT,
            subtitle=" · ".join(x for x in [system, level, profile["location"] or ""] if x and x != lib.NOT_RECORDED),
            cells={"court": profile["name"], "court_id": cid, "system": system, "level": level, "type": ctype,
                   "location": profile["location"], "active": None if active is None else ("yes" if active else "no"),
                   "began": started, "children": len(profile["children"]), "page": "yes" if cid in spine else "no"},
            badges=["Courts-DB"] + (["Court page"] if cid in spine else []),
            facts=facts,
            text=" ".join([profile["name"], profile["citation_string"] or "", " ".join(profile["sub_names"]), " ".join(profile["divisions"]), profile["location"] or ""]),
            filters={"system": [c.get("system") or "not_recorded"], "level": [c.get("level") or "not_recorded"],
                     "location": [profile["location"] or "Not recorded"], "page": ["yes" if cid in spine else "no"]},
            links=links, state=profile["location"] or "", extra={"profile": profile}))
    summary = {"source": f"{CREDIT}; each court's website as Courts-DB records it",
               "coverage": dict(counts), "spine_courts": len(spine), "spine_without_courts_db": len(spine - set(by_id)),
               "notes": ["Courts-DB ids are CourtListener court ids; a record links to a court page only on an exact id match.",
                         "The appeal route is shown only where Courts-DB records one; most state trial courts carry only their parent grouping."]}
    spec = {"dataset": "courts_db", "label": "Court metadata and structure (Courts-DB)", "rows": rows,
            "listing_block": writer.listing(
                [("court", "Court"), ("system", "System"), ("level", "Level"), ("location", "Location"), ("began", "Began"), ("children", "Grouped courts"), ("page", "Court page")],
                [("system", "System", {k: v for k, v in lib.SYSTEMS.items()}), ("level", "Level", {k: v for k, v in lib.LEVELS.items()}),
                 ("page", "Court page", {"yes": "Has a court page", "no": "No court page"})]),
            "summary": {**summary, "totals": {"records": len(rows)}}, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "inputs": [{"url": f"https://raw.githubusercontent.com/freelawproject/courts-db/{REVISION}/courts_db/data/courts.json",
                        "path": "private/acq/courts_db/courts.json", "sha256": hashlib.sha256(raw).hexdigest()},
                       {"url": "corpus:court_spine", "path": "private/build/judge_xwalk/lookups/court_spine.jsonl",
                        "sha256": hashlib.sha256(open(SPINE, "rb").read()).hexdigest()}]}
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "courts_db.json")
    with open(path + ".tmp", "w") as h:
        json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
    os.replace(path + ".tmp", path)
    print("courts_db", len(rows), "rows", os.path.getsize(path) // 1024, "KB", json.dumps(dict(counts)), f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
