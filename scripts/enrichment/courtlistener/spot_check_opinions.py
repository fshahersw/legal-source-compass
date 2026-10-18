"""Independent spot check of the opinion-dependent CourtListener datasets: clb_court_flows, clb_top_cited, the opinion/citation sections of
clb_court_profiles, and the authorship section of clb_judge_dockets.

Everything is recomputed from the slim tables (opinion, cluster, docket, cmap, parenthetical, citation) with SQL written differently from the
work aggregates: IN-subqueries instead of materialised joins, explicit court lookups per sample, and median() instead of quantile_cont().
Writes private/build/courtlistener/spot_checks_opinions.json.
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

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
BUILD = os.path.join(ROOT, "private", "build", "courtlistener")
LO, HI = "DATE '1700-01-01'", "DATE '2026-09-30'"
LEAD = ", ".join(f"'{t}'" for t in sorted(cc.LEAD_OPINION_TYPES))


def rows(name):
    return {r["id"]: r for r in json.load(open(os.path.join(BUILD, name + ".json")))["rows"]}


def main() -> int:
    con = duckdb.connect(":memory:")
    con.execute("PRAGMA memory_limit='4GB'")
    con.execute("PRAGMA threads=2")
    con.execute(f"PRAGMA temp_directory='{os.path.join(ROOT, 'private', 'scratch', 'duck_tmp')}'")
    con.execute("PRAGMA max_temp_directory_size='2GB'")
    for alias, f in (("dk", "docket"), ("cl", "cluster"), ("op", "opinion"), ("cm", "cmap"), ("pr", "parenthetical"), ("ci", "citation")):
        con.execute(f"ATTACH '{DB}/{f}.duckdb' AS {alias} (READ_ONLY)")
    # opinion -> court as a one-off lookup table built with plain joins (the work step uses a LEFT JOIN to a narrowed docket view)
    con.execute(
        """CREATE TEMP TABLE oc AS SELECT o.id AS oid, o.cluster_id AS cid, o.author_id, o.type, o.per_curiam, d.court_id
           FROM op.opinion o JOIN cl.cluster k ON k.id = o.cluster_id JOIN dk.docket d ON d.id = k.docket_id""")
    profiles = rows("clb_court_profiles")
    flows = rows("clb_court_flows")
    top = rows("clb_top_cited")
    judges = rows("clb_judge_dockets")
    checks = []

    def check(what, where, mine, shown, tol=0.0):
        if isinstance(mine, float) or isinstance(shown, float):
            ok = mine is not None and shown is not None and abs(float(mine) - float(shown)) <= max(tol, 1e-9)
        else:
            ok = mine == shown
        checks.append({"figure": what, "where": where, "recomputed": mine, "displayed": shown, "match": bool(ok)})

    # ---------------------------------------------------------------- court profile opinion sections
    for cid in ["scotus", "ca9", "ca5", "cadc", "cand", "txsd", "nysd", "cal", "nysupct", "tex", "mad", "ca2", "ilnd", "cafc", "flsd"]:
        p = profiles.get(cid)
        if not p:
            continue
        o = p["item"]["profile"].get("opinions")
        w = f"clb_court_profiles {cid}"
        n, auth, pc = con.execute(f"SELECT count(*), count(author_id), count(*) FILTER (WHERE per_curiam) FROM oc WHERE court_id = '{cid}'").fetchone()
        if not n:
            check("no opinions section when the court has no opinions", w, True, o is None)
            continue
        check("opinions", w, n, o["total"])
        check("opinions with an author, share", w, round(100.0 * auth / n, 1), o["with_author_pct"], 0.051)
        check("per curiam opinions", w, pc, o["per_curiam"])
        top_type = con.execute(f"SELECT type, count(*) c FROM oc WHERE court_id = '{cid}' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1").fetchone()
        check("most frequent opinion type (code, count)", w, [top_type[0], top_type[1]], [o["types"][0]["value"], o["types"][0]["count"]])
        ta = con.execute(f"SELECT author_id, count(*) c FROM oc WHERE court_id = '{cid}' AND author_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1").fetchone()
        if ta:
            check("top author (id, opinions)", w, [int(ta[0]), ta[1]], [o["top_authors"][0]["person_id"], o["top_authors"][0]["opinions"]])
        cit = p["item"]["profile"].get("citations")
        if cit:
            made = con.execute(
                f"""SELECT count(*) FROM cm.cmap m WHERE m.citing_opinion_id IN (SELECT oid FROM oc WHERE court_id = '{cid}')
                     AND m.cited_opinion_id IN (SELECT oid FROM oc)""").fetchone()[0]
            check("citation links made (both opinions resolve to a court)", w, made, cit["cites_made"])
            recv = con.execute(
                f"""SELECT count(*) FROM cm.cmap m WHERE m.cited_opinion_id IN (SELECT oid FROM oc WHERE court_id = '{cid}')
                     AND m.citing_opinion_id IN (SELECT oid FROM oc)""").fetchone()[0]
            check("citation links received", w, recv, cit["cited_by_others"])
            same = con.execute(
                f"""SELECT count(*) FROM cm.cmap m JOIN oc a ON a.oid = m.citing_opinion_id AND a.court_id = '{cid}' JOIN oc b ON b.oid = m.cited_opinion_id AND b.court_id = '{cid}'""").fetchone()[0]
            check("self-citation share", w, round(100.0 * same / made, 1) if made else None, cit["self_citation_pct"], 0.051)
    # ---------------------------------------------------------------- flows dataset
    cross = [r for r in flows.values() if r["id"].startswith("cite:")]
    cross.sort(key=lambda r: -r["item"]["profile"]["count"])
    sample = cross[:6] + cross[len(cross) // 2: len(cross) // 2 + 4] + cross[-4:]
    for r in sample:
        p = r["item"]["profile"]
        n = con.execute(
            f"""SELECT count(*) FROM cm.cmap m WHERE m.citing_opinion_id IN (SELECT oid FROM oc WHERE court_id = '{p['citing_court']}')
                 AND m.cited_opinion_id IN (SELECT oid FROM oc WHERE court_id = '{p['cited_court']}')""").fetchone()[0]
        check("citation links citing court -> cited court", r["id"], n, p["count"])
    ov = flows["overview:all"]["item"]["profile"]
    resolved = con.execute("SELECT count(*) FROM cm.cmap m WHERE m.citing_opinion_id IN (SELECT oid FROM oc) AND m.cited_opinion_id IN (SELECT oid FROM oc)").fetchone()[0]
    check("citation links with a court on both sides", "overview:all", resolved, ov["citations"])
    total_links = con.execute("SELECT count(*) FROM cm.cmap").fetchone()[0]
    missing = con.execute("SELECT count(*) FROM cm.cmap m WHERE m.citing_opinion_id NOT IN (SELECT id FROM op.opinion) OR m.cited_opinion_id NOT IN (SELECT id FROM op.opinion)").fetchone()[0]
    check("rows in the citation map", "overview:all", total_links, ov["map_links"])
    check("links where an opinion is not in the opinion table", "overview:all", missing, ov["opinion_not_in_opinion_table"])
    check("resolved + court unresolved + opinion missing = every row of the citation map", "overview:all", total_links, ov["citations"] + ov["unresolved"] + ov["opinion_not_in_opinion_table"])
    for cid in ("ca9", "ca2", "cadc"):
        r = flows.get(f"citing:{cid}")
        if not r:
            continue
        p = r["item"]["profile"]
        med = con.execute(
            f"""SELECT median(date_diff('day', kb.date_filed, ka.date_filed) / 365.25), count(*)
                FROM cm.cmap m JOIN oc a ON a.oid = m.citing_opinion_id AND a.court_id = '{cid}' JOIN oc b ON b.oid = m.cited_opinion_id
                JOIN cl.cluster ka ON ka.id = a.cid JOIN cl.cluster kb ON kb.id = b.cid
                WHERE ka.date_filed BETWEEN {LO} AND {HI} AND kb.date_filed BETWEEN {LO} AND {HI} AND ka.date_filed >= kb.date_filed""").fetchone()
        check("median years between cited and citing opinion", f"citing:{cid}", round(float(med[0]), 1), p["lag"]["median_years"], 0.051)
        check("links in the age basis", f"citing:{cid}", med[1], p["lag"]["n"])
    cm = flows["matrix:circuits"]["item"]["profile"]
    for a, b in (("ca9", "ca9"), ("ca9", "scotus"), ("ca5", "ca5"), ("cadc", "scotus"), ("ca2", "ca9")):
        n = con.execute(
            f"""SELECT count(*) FROM cm.cmap m WHERE m.citing_opinion_id IN (SELECT oid FROM oc WHERE court_id = '{a}')
                 AND m.cited_opinion_id IN (SELECT oid FROM oc WHERE court_id = '{b}')""").fetchone()[0]
        shown = cm["cells"][cm["rows"].index(a)][cm["columns"].index(b)]
        check("circuit matrix cell", f"matrix:circuits {a}>{b}", n, shown)
    appeals = [r for r in flows.values() if r["id"].startswith("appeal:")]
    appeals.sort(key=lambda r: -r["item"]["profile"]["dockets"])
    for r in appeals[:5] + appeals[len(appeals) // 2: len(appeals) // 2 + 3]:
        p = r["item"]["profile"]
        n = con.execute("SELECT count(*) FROM dk.docket WHERE court_id = ? AND appeal_from_id = ?", [p["appellate_court"], p["from_court"]]).fetchone()[0]
        check("dockets appealed from -> to", r["id"], n, p["dockets"])
    # ---------------------------------------------------------------- top cited
    ranked = sorted(top.values(), key=lambda r: r["item"]["profile"]["rank"])
    for r in ranked[:12] + ranked[400:404] + ranked[-4:]:
        p = r["item"]["profile"]
        cid = p["cluster_id"]
        w = r["id"]
        k = con.execute("SELECT citation_count, case_name, docket_id FROM cl.cluster WHERE id = ?", [cid]).fetchone()
        check("times cited (cluster citation_count)", w, k[0], p["times_cited"])
        links = con.execute("SELECT count(*) FROM cm.cmap m WHERE m.cited_opinion_id IN (SELECT id FROM op.opinion WHERE cluster_id = ?)", [cid]).fetchone()[0]
        check("links in the bulk citation map pointing at the cluster's opinions", w, links, p["map_links"])
        by_court = con.execute(
            """SELECT c, count(*) FROM (SELECT (SELECT d.court_id FROM cl.cluster kk JOIN dk.docket d ON d.id = kk.docket_id WHERE kk.id = o.cluster_id) AS c
                                        FROM cm.cmap m JOIN op.opinion o ON o.id = m.citing_opinion_id
                                        WHERE m.cited_opinion_id IN (SELECT id FROM op.opinion WHERE cluster_id = ?)) GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1""", [cid]).fetchone()
        if by_court and p["citing_courts"]:
            check("most frequent citing court (id, links)", w, [by_court[0], by_court[1]], [p["citing_courts"][0]["court_id"], p["citing_courts"][0]["count"]])
        pn = con.execute("SELECT count(*) FROM pr.parenthetical WHERE described_opinion_id IN (SELECT id FROM op.opinion WHERE cluster_id = ?)", [cid]).fetchone()[0]
        check("parenthetical descriptions", w, pn, (p["parentheticals"] or {}).get("n", 0))
        cites = con.execute("SELECT count(*) FROM ci.citation WHERE cluster_id = ?", [cid]).fetchone()[0]
        check("reporter citations on file", w, cites, len(p["citations"]))
    ids_sorted = [r["item"]["profile"]["cluster_id"] for r in ranked]
    top1000 = con.execute("SELECT id FROM cl.cluster WHERE citation_count > 0 ORDER BY citation_count DESC, id LIMIT 1000").fetchall()
    check("the 1,000 clusters listed are the 1,000 with the highest citation_count (ties by id)", "clb_top_cited", [x[0] for x in top1000], ids_sorted)
    # ---------------------------------------------------------------- judge authorship
    with_op = [r for r in judges.values() if r["item"]["profile"].get("opinions")]
    with_op.sort(key=lambda r: -r["item"]["profile"]["opinions"]["authored"])
    for r in with_op[:10] + with_op[len(with_op) // 2: len(with_op) // 2 + 6] + with_op[-6:]:
        p = r["item"]["profile"]["opinions"]
        pid = int(r["id"])
        w = f"clb_judge_dockets {pid}"
        n, pc = con.execute("SELECT count(*), count(*) FILTER (WHERE per_curiam) FROM op.opinion WHERE author_id = ?", [pid]).fetchone()
        check("opinions authored", w, n, p["authored"])
        check("per curiam among them", w, pc, p["per_curiam"])
        lead = con.execute(f"SELECT count(*) FROM op.opinion WHERE author_id = ? AND type IN ({LEAD})", [pid]).fetchone()[0]
        check("lead, combined or similar opinions", w, lead, p["lead_or_combined"])
        if "clusters_with_lead_opinion" in p:
            cl_n, cl_sum = con.execute(
                f"""SELECT count(*), sum(k.citation_count) FROM cl.cluster k WHERE k.id IN (SELECT cluster_id FROM op.opinion WHERE author_id = ? AND type IN ({LEAD}))""", [pid]).fetchone()
            check("clusters with a lead opinion by the author", w, cl_n, p["clusters_with_lead_opinion"])
            check("times those clusters were cited (sum of citation_count)", w, int(cl_sum or 0), p["times_cited_total"])
    bad = [c for c in checks if not c["match"]]
    with open(os.path.join(BUILD, "spot_checks_opinions.json"), "w") as h:
        json.dump({"method": "plain SQL on the slim opinion, cluster, docket, cmap, parenthetical and citation tables, independent of the work aggregates", "checks": len(checks), "mismatches": len(bad), "details": checks}, h, indent=1, default=str)
    print(f"{len(checks)} figures recomputed; {len(bad)} mismatches")
    for c in bad[:25]:
        print("MISMATCH", c)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
