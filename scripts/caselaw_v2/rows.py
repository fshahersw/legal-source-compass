"""Case law v2 step 6: database rows for the load RPCs of database/contracts/caselaw-v2.sql (and caselaw-read-v1.sql).

    python3 -I -B scripts/caselaw_v2/rows.py --run all [--tiers 4,5,6,7] [--allow-partial]

Inputs (all local, from the earlier steps of the run): courts.json, <run>/meta.duckdb (clusters, citations, panel,
people, cited_by), <run>/units/u*.json (objects) and <run>/attach/u*.jsonl.gz (opinion pointers).
Outputs under <run>/rows/:
  courts.json            caselaw_load_courts_v2 rows: every registry court of tiers 1-7 (level, system, jurisdiction,
                         parent, dates) — tiers of courts already holding cases are kept by the RPC
  objects.jsonl          caselaw_load_objects_v1 rows (key, kind "read", bytes, sha256) of every staged object
  cases-pNN.jsonl.gz     caselaw_load_cases_v2 rows, only for clusters with at least one stored opinion (as stage 2:
                         a cluster without opinions gets no case row), tiers 4-7, ordered by cluster_id
  attach-uNN.jsonl.gz    caselaw_attach_opinions_v2 rows per unit: {cluster_id, opinions: [{id, type, author, per_curiam,
                         key, s, n}]}; author = the judge CourtListener links (people table, exact id) when the opinion
                         has an author_id, else CourtListener's author_str (stage 2 rule)
  rows_report.json       counts
Case fields are CourtListener's as published (stage 2 rules): case_name falls back to case_name_full, else
"Not recorded"; case_name_full only when it differs; citations "volume reporter page" in CourtListener type order;
panel names "first middle last suffix"; cited_by / cited_by_cases from citedby.py (required: never a placeholder).
"""
from __future__ import annotations

import argparse
import collections
import glob
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, WORK, V2Error, now, read_json, read_jsonl, write_json  # noqa: E402

PART_ROWS = 50_000
CITE_TYPE_ORDER = {8: 0, 1: 1, 2: 2, 5: 3, 3: 4, 4: 5, 7: 6, 6: 7, 9: 8}  # = scripts/enrichment/caselaw/citator.py


def cite_order_sql(alias: str = "c") -> str:
    cases = " ".join(f"WHEN {k} THEN {v}" for k, v in CITE_TYPE_ORDER.items())
    pref = (f"CASE WHEN {alias}.reporter = 'U.S.' THEN 0 WHEN {alias}.reporter = 'S. Ct.' THEN 1 "
            f"WHEN {alias}.reporter LIKE 'L. Ed.%' THEN 2 WHEN {alias}.reporter LIKE '%LEXIS%' OR {alias}.reporter = 'WL' THEN 9 ELSE 5 END")
    vol = f"least(coalesce(try_cast({alias}.volume AS BIGINT), 0), 999999)"
    return f"((CASE {alias}.type {cases} ELSE 99 END) * 10 + {pref}) * 1000000 + {vol}"


def clean(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def case_row(r: dict) -> dict:
    full = clean(r.get("case_name_full"))
    name = clean(r.get("case_name")) or full or "Not recorded"
    return {"cluster_id": int(r["cluster_id"]), "tier": int(r["tier"]), "court_id": r["court_id"],
            "date_filed": str(r["date_filed"]) if r.get("date_filed") else None, "date_approx": bool(r.get("date_approx")),
            "case_name": name, "case_name_full": full if full and full != name else None,
            "docket_number": clean(r.get("docket_number")), "precedential_status": clean(r.get("precedential_status")),
            "citation_count": r.get("citation_count"), "citations": list(r.get("citations") or []),
            "judges": clean(r.get("judges")), "panel": list(r["panel"]) if r.get("panel") else None,
            "disposition": clean(r.get("disposition")), "cited_by": int(r["cited_by"]), "cited_by_cases": int(r["cited_by_cases"]),
            "cap_file": clean(r.get("filepath_json_harvard")), "source": clean(r.get("source"))}


def type_rank(t):
    order = ["010combined", "015unamimous", "020lead", "025plurality", "030concurrence", "035concurrenceinpart", "040dissent",
             "050addendum", "060remittitur", "070rehearing", "080onthemerits", "090onmotiontostrike", "100trialcourt"]
    return order.index(t) if t in order else len(order)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--tiers", default="4,5,6,7")
    ap.add_argument("--allow-partial", action="store_true", help="tests only: build rows from an incomplete opinions pass")
    a = ap.parse_args()
    import duckdb

    tiers = sorted({int(t) for t in a.tiers.split(",")})
    if any(t not in (4, 5, 6, 7) for t in tiers):
        raise V2Error("rows are built for tiers 4-7 only (tiers 1-3 are stage 2's)")
    run_dir = os.path.join(WORK, "runs", a.run)
    out = os.path.join(run_dir, "rows")
    os.makedirs(out, exist_ok=True)
    units = [read_json(p) for p in sorted(glob.glob(os.path.join(run_dir, "units", "u*.json")))]
    if not units:
        raise V2Error("no units: run opinions.py first")
    if any(u["partial"] for u in units) and not a.allow_partial:
        raise V2Error("partial units (a bounded sample): pass --allow-partial to build rows from them anyway")
    stats = collections.Counter()

    # courts
    reg = read_json(os.path.join(WORK, "courts.json"))

    def tier_of(c):
        if c.get("excluded"):
            return None
        if c["tier"]:
            return c["tier"]
        if c["court_id"] == "scotus":
            return 1
        return {"F": 2, "S": 3}.get(c.get("level") or "")

    courts = [{"court_id": c["court_id"], "tier": tier_of(c), "full_name": c["full_name"] or c["court_id"], "short_name": c["short_name"],
               "citation_string": c["citation_string"], "cases": 0, "level": c["level"], "system": c["system"],
               "jurisdiction": c["jurisdiction"], "parent_court_id": c["parent_court_id"], "url": c["url"],
               "start_date": c["start_date"], "end_date": c["end_date"], "in_use": c["in_use"]}
              for c in reg["courts"] if tier_of(c)]
    # caselaw.courts / the app accept ids matching ^[a-z0-9_-]{1,40}$; CourtListener has two others (txctapp13A,
    # txctapp13B, no clusters in the snapshot): reported, never renamed
    import re

    bad = [c["court_id"] for c in courts if not re.fullmatch(r"[a-z0-9_-]{1,40}", c["court_id"])]
    courts = [c for c in courts if c["court_id"] not in bad]
    write_json(os.path.join(out, "courts.json"), courts)
    stats["courts"] = len(courts)
    stats["courts_skipped_id_pattern"] = len(bad)

    # objects
    with open(os.path.join(out, "objects.jsonl"), "w") as h:
        for u in units:
            for o in u["objects"]:
                if o["tier"] in tiers:
                    h.write(json.dumps({"key": o["key"], "kind": "read", "bytes": o["bytes"], "sha256": o["sha256"]}) + "\n")
                    stats["objects"] += 1

    # attach rows (and the set of clusters that have opinions)
    con = duckdb.connect(os.path.join(run_dir, "meta.duckdb"), read_only=True)
    con.execute("PRAGMA disable_progress_bar")
    people = dict(con.execute("SELECT person_id, name FROM people WHERE name <> ''").fetchall())
    with_ops: set[int] = set()
    for u in units:
        by = collections.defaultdict(list)
        for r in read_jsonl(os.path.join(ROOT, u["attach"])):
            if r["tier"] not in tiers:
                continue
            author = people.get(r["author_id"]) if r.get("author_id") is not None else None
            by[r["cluster_id"]].append({"id": r["opinion_id"], "type": r["type"], "author": author or clean(r.get("author_str")),
                                        "per_curiam": bool(r["per_curiam"]), "key": r["key"], "s": r["s"], "n": r["n"]})
        path = os.path.join(out, f"attach-u{u['unit']:02d}.jsonl.gz")
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as h:
            for cid in sorted(by):
                ops = sorted(by[cid], key=lambda o: (type_rank(o["type"]), o["id"]))
                h.write(json.dumps({"cluster_id": cid, "opinions": ops}, ensure_ascii=False, separators=(",", ":")) + "\n")
                stats["attach_clusters"] += 1
                stats["attach_opinions"] += len(ops)
                with_ops.add(cid)
    # case rows
    if not con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = 'cited_by'").fetchone()[0]:
        raise V2Error("table cited_by is missing: run citedby.py first (cited_by is required for every case row)")
    con.execute("CREATE TEMP TABLE want (cluster_id BIGINT)")
    con.executemany("INSERT INTO want VALUES (?)", [[c] for c in sorted(with_ops)])
    q = f"""
    WITH cites AS (SELECT c.cluster_id, list(c.volume || ' ' || c.reporter || ' ' || c.page ORDER BY {cite_order_sql('c')}, c.reporter, c.page) AS citations
                   FROM citations c JOIN want w USING (cluster_id) GROUP BY 1),
         pan AS (SELECT p.cluster_id, list(pe.name ORDER BY pe.name_last, pe.name_first, pe.person_id) AS panel
                 FROM panel p JOIN people pe USING (person_id) JOIN want w USING (cluster_id) WHERE pe.name <> '' GROUP BY 1)
    SELECT k.*, ci.citations, pan.panel, b.cited_by, b.cited_by_cases
    FROM clusters k JOIN want w USING (cluster_id) LEFT JOIN cites ci USING (cluster_id) LEFT JOIN pan USING (cluster_id)
    LEFT JOIN cited_by b USING (cluster_id)
    WHERE k.tier IN ({', '.join(str(t) for t in tiers)})
    ORDER BY k.cluster_id"""
    cur = con.execute(q)
    cols = [d[0] for d in cur.description]
    part = 0
    n_in_part = 0
    h = None
    missing_citedby = 0
    while True:
        rows = cur.fetchmany(10_000)
        if not rows:
            break
        for row in rows:
            r = dict(zip(cols, row))
            if r.get("cited_by") is None:
                missing_citedby += 1
                continue
            if h is None or n_in_part >= PART_ROWS:
                if h:
                    h.close()
                h = gzip.open(os.path.join(out, f"cases-p{part:02d}.jsonl.gz"), "wt", encoding="utf-8", compresslevel=6)
                part += 1
                n_in_part = 0
            rec = case_row(r)
            h.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
            n_in_part += 1
            stats["cases"] += 1
            stats[f"tier{rec['tier']}"] += 1
            stats["no_citations"] += 0 if rec["citations"] else 1
            stats["with_panel"] += 1 if rec["panel"] else 0
            stats["with_cap_file"] += 1 if rec["cap_file"] else 0
    if h:
        h.close()
    con.close()
    if missing_citedby:
        raise V2Error(f"{missing_citedby} clusters have no cited_by row")
    rep = {"run": a.run, "tiers": tiers, "built_at": now(), "stats": dict(stats), "case_parts": part}
    write_json(os.path.join(out, "rows_report.json"), rep)
    print(json.dumps(rep, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
