"""Independent spot check of clb_court_benches and clb_bench_cohorts: recompute displayed figures with plain SQL on small.duckdb.

The builder uses Python loops over the loaded tables; this script re-derives the same definitions in SQL (different code path) for
a sample of courts and cohorts and compares them with the built files. Writes private/build/courtlistener/spot_checks_benches.json.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import clb_common as cc  # noqa: E402
import duckdb  # noqa: E402

BUILD = os.path.join(ROOT, "private", "build", "courtlistener")
JUD = ", ".join(f"'{t}'" for t in sorted(cc.JUDICIAL_POSITIONS))
COURTS = ["cand", "nysd", "txsd", "ca9", "scotus", "cacd", "flsd", "ilnd", "dcd", "ca5", "mad", "wyd", "cal", "tex", "nysupct"]


def main() -> int:
    con = duckdb.connect(os.path.join(ROOT, "private", "acq", "courtlistener", "db", "small.duckdb"), read_only=True)
    benches = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(BUILD, "clb_court_benches.json")))["rows"]}
    cohorts = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(BUILD, "clb_bench_cohorts.json")))["rows"]}
    checks = []

    def check(what, where, mine, shown):
        ok = (abs(mine - shown) < 1e-6) if isinstance(mine, float) and shown is not None else (mine == shown)
        checks.append({"figure": what, "where": where, "recomputed": mine, "displayed": shown, "match": bool(ok)})

    base = f"""
      SELECT p.*, c.jurisdiction, pe.gender, pe.date_dod,
             TRY_CAST(substr(p.date_start, 1, 10) AS DATE) AS s, TRY_CAST(substr(p.date_termination, 1, 10) AS DATE) AS e
      FROM position p JOIN courts c ON c.id = p.court_id JOIN person pe ON pe.id = p.person_id
      WHERE p.position_type IN ({JUD})"""
    for cid in COURTS:
        if cid not in benches:
            continue
        pos, persons, active, women, wtot, med = con.execute(
            f"""WITH b AS ({base} AND p.court_id = '{cid}')
                SELECT count(*), count(DISTINCT person_id),
                       count(*) FILTER (WHERE s IS NOT NULL AND e IS NULL AND date_dod IS NULL),
                       count(*) FILTER (WHERE s IS NOT NULL AND e IS NULL AND date_dod IS NULL AND gender = 'f'),
                       count(*) FILTER (WHERE s IS NOT NULL AND e IS NULL AND date_dod IS NULL AND gender IN ('f', 'm')),
                       median(date_diff('day', s, e) / 365.25) FILTER (WHERE e IS NOT NULL AND e >= s)
                FROM b""").fetchone()
        b = benches[cid]
        check("positions on record", f"clb_court_benches {cid}", pos, b["positions"])
        check("people with a position", f"clb_court_benches {cid}", persons, b["persons"])
        check("positions with no recorded end date", f"clb_court_benches {cid}", active, b["active"])
        shown_w = b["women_active_pct"]
        mine_w = None if not wtot else round(100.0 * women / wtot, 1)
        check("women share of active (gender recorded)", f"clb_court_benches {cid}", mine_w, shown_w)
        if med is not None and b["median_tenure_years_ended"] is not None:
            check("median years served (ended)", f"clb_court_benches {cid}", round(float(med), 2), round(b["median_tenure_years_ended"], 2))
        else:
            check("median years served (ended) presence", f"clb_court_benches {cid}", med is None, b["median_tenure_years_ended"] is None)
    fed = "('F', 'FD', 'FB', 'FBP', 'FS')"
    for aid in list(cohorts)[:0]:
        pass
    for rid, prof in cohorts.items():
        if rid.startswith("appointer:") and len([k for k in checks if k["where"].startswith("clb_bench_cohorts appointer")]) < 24:
            apid = prof["appointer_person_id"]
            n, people = con.execute(
                f"""SELECT count(*), count(DISTINCT p.person_id) FROM ({base}) p
                    WHERE p.how_selected = 'a_pres' AND p.jurisdiction IN {fed}
                      AND p.appointer_id IN (SELECT id FROM position WHERE person_id = '{apid}')""").fetchone()
            check("federal positions by appointer", f"clb_bench_cohorts {rid}", n, prof["positions"])
            check("people appointed", f"clb_bench_cohorts {rid}", people, prof["persons"])
    for rid, prof in cohorts.items():
        if rid.startswith("decade:") and prof["decade"] in (1950, 1990, 2010):
            d = prof["decade"]
            n = con.execute(f"SELECT count(*) FROM ({base}) p WHERE p.jurisdiction IN {fed} AND s >= DATE '{d}-01-01' AND s < DATE '{d + 10}-01-01'").fetchone()[0]
            check("federal positions started in the decade", f"clb_bench_cohorts {rid}", n, prof["positions"])
    for rid, prof in cohorts.items():
        if rid.startswith("school:") and len([k for k in checks if k["where"].startswith("clb_bench_cohorts school")]) < 5:
            n = con.execute(
                f"""SELECT count(DISTINCT e.person_id) FROM education e
                    WHERE e.school_id = '{prof['school_id']}' AND e.degree_level IN ('jd', 'llb')
                      AND e.person_id IN (SELECT person_id FROM ({base}) p WHERE p.jurisdiction IN {fed})""").fetchone()[0]
            check("federal judges with a law degree from the school", f"clb_bench_cohorts {rid}", n, prof["persons"])
    bad = [c for c in checks if not c["match"]]
    with open(os.path.join(BUILD, "spot_checks_benches.json"), "w") as h:
        json.dump({"method": "plain SQL on small.duckdb, independent of the builder's Python loops", "checks": len(checks), "mismatches": len(bad), "details": checks}, h, indent=1, default=str)
    print(f"{len(checks)} figures recomputed; {len(bad)} mismatches")
    for c in bad[:12]:
        print("MISMATCH", c)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
