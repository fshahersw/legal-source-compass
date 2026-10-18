"""Independent spot check of clb_court_profiles: recompute displayed figures straight from the slim tables with plain SQL.

The builder aggregates through work.duckdb; this script goes back to docket / cluster / citation / oral_argument and re-derives a
sample of courts' figures with different SQL (modulo instead of bit-and for the RECAP flag, regexp_matches instead of regexp_extract,
median() instead of quantile_cont, argmax via ORDER BY). Writes private/build/courtlistener/spot_checks_courts.json.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import duckdb  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
BUILD = os.path.join(ROOT, "private", "build", "courtlistener")
SAMPLE = ["cand", "nysd", "txsd", "cacd", "flsd", "ilnd", "dcd", "mad", "wyd", "cacb", "jpml", "ca9", "ca5", "cadc", "scotus", "cal", "nysupct", "tex", "ohnb", "azd", "vid", "gud", "cavc", "uscfc", "tax", "bap9", "navajo"]
LO, HI = "DATE '1700-01-01'", "DATE '2026-09-30'"


def main() -> int:
    con = duckdb.connect(":memory:")
    con.execute("PRAGMA memory_limit='3GB'")
    con.execute("PRAGMA threads=2")
    for alias, f in (("dk", "docket"), ("cl", "cluster"), ("ci", "citation"), ("oa", "oral_argument")):
        con.execute(f"ATTACH '{DB}/{f}.duckdb' AS {alias} (READ_ONLY)")
    prof = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(BUILD, "clb_court_profiles.json")))["rows"]}
    fjc = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(ROOT, "private", "build", "fjc_idb", "fjc_civil_districts.json")))["rows"]}
    checks = []

    def check(what, where, mine, shown, tol=0.0):
        if isinstance(mine, float) or isinstance(shown, float):
            ok = mine is not None and shown is not None and abs(float(mine) - float(shown)) <= max(tol, 1e-9)
        else:
            ok = mine == shown
        checks.append({"figure": what, "where": where, "recomputed": mine, "displayed": shown, "match": bool(ok)})

    for cid in SAMPLE:
        p = prof.get(cid)
        if not p:
            continue
        w = f"clb_court_profiles {cid}"
        d = p["dockets"]
        if d:
            n, dated, first, last, recap, term, assigned = con.execute(
                f"""SELECT count(*), count(CASE WHEN date_filed BETWEEN {LO} AND {HI} THEN 1 END), min(CASE WHEN date_filed BETWEEN {LO} AND {HI} THEN date_filed END),
                           max(CASE WHEN date_filed BETWEEN {LO} AND {HI} THEN date_filed END), sum(CASE WHEN source % 2 = 1 THEN 1 ELSE 0 END),
                           count(CASE WHEN date_terminated BETWEEN {LO} AND {HI} THEN 1 END), count(assigned_to_id)
                    FROM dk.docket WHERE court_id = '{cid}'""").fetchone()
            check("dockets", w, n, d["total"])
            check("dockets with a plausible filing date", w, dated, d["dated"])
            check("first filed", w, str(first) if first else None, d["first_filed"])
            check("last filed", w, str(last) if last else None, d["last_filed"])
            check("RECAP dockets", w, int(recap or 0), d["recap"])
            check("dockets with a plausible termination date", w, term, d["terminated"])
            check("dockets with an assigned judge", w, assigned, d["with_assigned_judge"])
            y = con.execute(f"SELECT count(*) FROM dk.docket WHERE court_id = '{cid}' AND date_filed BETWEEN DATE '2019-01-01' AND DATE '2019-12-31'").fetchone()[0]
            shown = next((r["dockets"] for r in d["by_year"] if r["yr"] == 2019), 0)
            check("dockets filed in 2019", w, y, shown)
            cv = con.execute(
                f"""SELECT count(*) FROM dk.docket WHERE court_id = '{cid}' AND date_filed BETWEEN DATE '2019-01-01' AND DATE '2019-12-31'
                     AND (regexp_matches(lower(docket_number), '[0-9]{{2}}-cv-[0-9]')
                          OR (NOT regexp_matches(lower(docket_number), '[0-9]{{2}}-[a-z]{{2}}-[0-9]') AND federal_dn_case_type = 'cv'))""").fetchone()[0]
            shown_cv = next((r["civil"] for r in d["by_year"] if r["yr"] == 2019), 0)
            check("civil-numbered dockets filed in 2019", w, cv, shown_cv)
            top_judge = con.execute(f"SELECT assigned_to_id, count(*) c FROM dk.docket WHERE court_id = '{cid}' AND assigned_to_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1").fetchone()
            if top_judge:
                check("most frequent assigned judge (id, dockets)", w, [int(top_judge[0]), top_judge[1]], [d["judges_assigned"][0]["person_id"], d["judges_assigned"][0]["dockets"]])
            med = con.execute(
                f"""SELECT median(date_diff('day', date_filed, date_terminated)), count(*) FROM dk.docket WHERE court_id = '{cid}'
                     AND date_filed BETWEEN {LO} AND {HI} AND date_terminated BETWEEN {LO} AND {HI} AND date_terminated >= date_filed
                     AND (regexp_matches(lower(docket_number), '[0-9]{{2}}-cv-[0-9]')
                          OR (NOT regexp_matches(lower(docket_number), '[0-9]{{2}}-[a-z]{{2}}-[0-9]') AND federal_dn_case_type = 'cv'))""").fetchone()
            if med[1] >= 30 and d["duration"].get("civil"):
                check("median days filing to termination, civil", w, round(float(med[0]), 1), d["duration"]["civil"]["median_days"], 0.051)
                check("civil duration n", w, med[1], d["duration"]["civil"]["n"])
            else:
                check("civil duration shown only when n >= 30", w, med[1] >= 30, bool(d["duration"].get("civil")))
        c = p["clusters"]
        if c:
            cn, cited, csum, cmax = con.execute(
                f"""SELECT count(*), count(CASE WHEN k.citation_count > 0 THEN 1 END), sum(k.citation_count), max(k.citation_count)
                    FROM cl.cluster k JOIN dk.docket x ON x.id = k.docket_id WHERE x.court_id = '{cid}'""").fetchone()
            check("opinion clusters", w, cn, c["total"])
            check("clusters cited at least once", w, cited, c["cited"])
            check("sum of times cited", w, int(csum or 0), c["cite_total"])
            check("max times cited", w, cmax, c["cite_max"])
            top = con.execute(f"SELECT k.id, k.citation_count FROM cl.cluster k JOIN dk.docket x ON x.id = k.docket_id WHERE x.court_id = '{cid}' AND k.citation_count > 0 ORDER BY k.citation_count DESC, k.id LIMIT 1").fetchone()
            if top and c["top_cited"]:
                check("most cited cluster (id, times cited)", w, [top[0], top[1]], [c["top_cited"][0]["cluster_id"], c["top_cited"][0]["times_cited"]])
            wr = con.execute(f"SELECT count(DISTINCT t.cluster_id) FROM ci.citation t JOIN cl.cluster k ON k.id = t.cluster_id JOIN dk.docket x ON x.id = k.docket_id WHERE x.court_id = '{cid}'").fetchone()[0]
            check("clusters with a reporter citation", w, wr, c["with_reporter_cite"])
        o = p["oral_arguments"]
        n_oral = con.execute(f"SELECT count(*) FROM oa.oral_argument o JOIN dk.docket x ON x.id = o.docket_id WHERE x.court_id = '{cid}'").fetchone()[0]
        check("oral arguments", w, n_oral, o["total"] if o else 0)
        cov = p["fjc_coverage"]
        if cov:
            row = next((r for r in cov["by_fy"] if r["fy"] == 2024), None)
            if row:
                n_fy = con.execute(
                    f"""SELECT count(*) FROM dk.docket WHERE court_id = '{cid}' AND date_filed BETWEEN DATE '2023-10-01' AND DATE '2024-09-30'
                         AND (regexp_matches(lower(docket_number), '[0-9]{{2}}-cv-[0-9]')
                              OR (NOT regexp_matches(lower(docket_number), '[0-9]{{2}}-[a-z]{{2}}-[0-9]') AND federal_dn_case_type = 'cv'))""").fetchone()[0]
                fj = next(s["filings"] for s in fjc[cid]["series"] if s["fy"] == 2024)
                check("civil-numbered dockets filed in FY2024", w, n_fy, row["cl_civil_dockets"])
                check("FJC civil filings FY2024 (from the published FJC dataset)", w, fj, row["fjc_filings"])
                check("CL / FJC ratio FY2024", w, round(n_fy / fj, 3), row["cl_to_fjc_ratio"], 0.0011)
    # totals across all courts
    tot = con.execute("SELECT count(*) FROM dk.docket").fetchone()[0]
    check("sum of court dockets equals the table row count", "all courts", tot, sum((p["dockets"] or {}).get("total", 0) for p in prof.values()))
    nclus = con.execute("SELECT count(*) FROM cl.cluster k JOIN dk.docket x ON x.id = k.docket_id").fetchone()[0]
    check("sum of court clusters equals clusters joined to a docket", "all courts", nclus, sum((p["clusters"] or {}).get("total", 0) for p in prof.values()))
    ndistinct = con.execute("SELECT count(DISTINCT id) FROM dk.docket").fetchone()[0]
    check("docket ids are unique", "docket table", ndistinct, tot)
    bad = [c for c in checks if not c["match"]]
    with open(os.path.join(BUILD, "spot_checks_courts.json"), "w") as h:
        json.dump({"method": "plain SQL on the slim docket, cluster, citation and oral_argument tables, independent of the work aggregates", "checks": len(checks), "mismatches": len(bad), "details": checks}, h, indent=1, default=str)
    print(f"{len(checks)} figures recomputed; {len(bad)} mismatches")
    for c in bad[:20]:
        print("MISMATCH", c)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
