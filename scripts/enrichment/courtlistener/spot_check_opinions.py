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
    con.execute("PRAGMA memory_limit='9GB'")
    con.execute("PRAGMA threads=2")
    con.execute(f"PRAGMA temp_directory='{os.path.join(ROOT, 'private', 'scratch', 'duck_tmp')}'")
    con.execute("PRAGMA max_temp_directory_size='3GB'")
    for alias, f in (("dk", "docket"), ("cl", "cluster"), ("op", "opinion"), ("cm", "cmap"), ("pr", "parenthetical"), ("ci", "citation"), ("sm", "small")):
        con.execute(f"ATTACH '{DB}/{f}.duckdb' AS {alias} (READ_ONLY)")
    # authored opinions with the lifespan rule: an opinion dated before the author's 25th birthday or more than a year after their recorded death is set aside
    con.execute(
        f"""CREATE TEMP TABLE oa AS
            SELECT o.id AS oid, o.cluster_id AS cid, o.author_id, o.type, o.per_curiam,
                   NOT (k.date_filed BETWEEN {LO} AND {HI} AND ((p.dob IS NOT NULL AND k.date_filed < p.dob + INTERVAL 25 YEAR) OR (p.dod IS NOT NULL AND k.date_filed > p.dod + INTERVAL 1 YEAR))) AS lifeok
            FROM op.opinion o LEFT JOIN cl.cluster k ON k.id = o.cluster_id
            LEFT JOIN (SELECT TRY_CAST(id AS BIGINT) AS pid, TRY_CAST(date_dob AS DATE) AS dob, TRY_CAST(date_dod AS DATE) AS dod FROM sm.person) p ON p.pid = o.author_id
            WHERE o.author_id IS NOT NULL""")
    # opinion -> court as a one-off lookup table built with plain joins (the work step uses a LEFT JOIN to a narrowed docket view)
    con.execute(
        """CREATE TEMP TABLE oc AS SELECT o.id AS oid, o.cluster_id AS cid, o.author_id, o.type, o.per_curiam, d.court_id, coalesce(a.lifeok, true) AS lifeok
           FROM op.opinion o JOIN cl.cluster k ON k.id = o.cluster_id JOIN dk.docket d ON d.id = k.docket_id LEFT JOIN oa a ON a.oid = o.id""")
    def links_by_citing(a_court, b_court=None):
        """Links citing court a -> cited court b (any court when b is None), between different decisions. Materialises the citing court's links first so each query stays small."""
        con.execute(f"CREATE OR REPLACE TEMP TABLE lc AS SELECT m.citing_opinion_id AS x, m.cited_opinion_id AS y FROM cm.cmap m WHERE m.citing_opinion_id IN (SELECT oid FROM oc WHERE court_id = '{a_court}')")
        cond = "" if b_court is None else f"AND b.court_id = '{b_court}'"
        return con.execute(f"SELECT count(*) FROM lc JOIN oc a ON a.oid = lc.x JOIN oc b ON b.oid = lc.y WHERE a.cid <> b.cid {cond}").fetchone()[0]

    def links_by_cited(b_court):
        con.execute(f"CREATE OR REPLACE TEMP TABLE rc AS SELECT m.citing_opinion_id AS x, m.cited_opinion_id AS y FROM cm.cmap m WHERE m.cited_opinion_id IN (SELECT oid FROM oc WHERE court_id = '{b_court}')")
        return con.execute("SELECT count(*) FROM rc JOIN oc a ON a.oid = rc.x JOIN oc b ON b.oid = rc.y WHERE a.cid <> b.cid").fetchone()[0]

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
        ta = con.execute(f"SELECT author_id, count(*) c FROM oc WHERE court_id = '{cid}' AND author_id IS NOT NULL AND lifeok GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1").fetchone()
        if ta:
            check("top author (id, opinions)", w, [int(ta[0]), ta[1]], [o["top_authors"][0]["person_id"], o["top_authors"][0]["opinions"]])
        cit = p["item"]["profile"].get("citations")
        if cit:
            made = links_by_citing(cid)
            check("citation links made (both opinions resolve to a court, different decisions)", w, made, cit["cites_made"])
            check("citation links received (different decisions)", w, links_by_cited(cid), cit["cited_by_others"])
            same = con.execute("SELECT count(*) FROM lc JOIN oc a ON a.oid = lc.x JOIN oc b ON b.oid = lc.y WHERE a.cid <> b.cid AND b.court_id = ?", [cid]).fetchone()[0]
            check("self-citation share", w, round(100.0 * same / made, 1) if made else None, cit["self_citation_pct"], 0.051)
    # ---------------------------------------------------------------- flows dataset
    cross = [r for r in flows.values() if r["id"].startswith("cite:")]
    cross.sort(key=lambda r: -r["item"]["profile"]["count"])
    sample = cross[:6] + cross[len(cross) // 2: len(cross) // 2 + 4] + cross[-4:]
    for r in sample:
        p = r["item"]["profile"]
        check("citation links citing court -> cited court", r["id"], links_by_citing(p["citing_court"], p["cited_court"]), p["count"])
    ov = flows["overview:all"]["item"]["profile"]
    both = con.execute("SELECT count(*) FROM cm.cmap m WHERE m.citing_opinion_id IN (SELECT oid FROM oc) AND m.cited_opinion_id IN (SELECT oid FROM oc)").fetchone()[0]
    same_dec = con.execute("SELECT count(*) FROM cm.cmap m JOIN op.opinion a ON a.id = m.citing_opinion_id JOIN op.opinion b ON b.id = m.cited_opinion_id AND b.cluster_id = a.cluster_id").fetchone()[0]
    check("links between two opinions of the same decision (set aside)", "overview:all", same_dec, ov["same_decision_links"])
    # every same-decision link has both opinions in oc (same docket, same court), so resolved = both - same decision
    same_in_oc = con.execute("SELECT count(*) FROM cm.cmap m JOIN op.opinion a ON a.id = m.citing_opinion_id JOIN op.opinion b ON b.id = m.cited_opinion_id AND b.cluster_id = a.cluster_id WHERE a.cluster_id IN (SELECT cid FROM oc)").fetchone()[0]
    check("citation links with a court on both sides (different decisions)", "overview:all", both - same_in_oc, ov["citations"])
    before = con.execute(
        f"""SELECT count(*) FROM cm.cmap m JOIN op.opinion a ON a.id = m.citing_opinion_id JOIN op.opinion b ON b.id = m.cited_opinion_id AND b.cluster_id <> a.cluster_id
            JOIN cl.cluster ka ON ka.id = a.cluster_id JOIN cl.cluster kb ON kb.id = b.cluster_id
            WHERE ka.date_filed BETWEEN {LO} AND {HI} AND kb.date_filed BETWEEN {LO} AND {HI} AND ka.date_filed < kb.date_filed""").fetchone()[0]
    check("links where the citing opinion is dated before the cited opinion", "overview:all", before, ov["citing_filed_before_cited"])
    total_links = con.execute("SELECT count(*) FROM cm.cmap").fetchone()[0]
    missing = con.execute("SELECT count(*) FROM cm.cmap m WHERE m.citing_opinion_id NOT IN (SELECT id FROM op.opinion) OR m.cited_opinion_id NOT IN (SELECT id FROM op.opinion)").fetchone()[0]
    check("rows in the citation map", "overview:all", total_links, ov["map_links"])
    check("links where an opinion is not in the opinion table", "overview:all", missing, ov["opinion_not_in_opinion_table"])
    check("resolved + court unresolved + same decision + opinion missing = every row of the citation map", "overview:all", total_links, ov["citations"] + ov["unresolved"] + ov["same_decision_links"] + ov["opinion_not_in_opinion_table"])
    check("court pairs published are the largest 1,500 of those with at least 100 links", "overview:all", [min(ov["cross_edges_published"], 1500), ov["cross_edge_floor"]], [len(cross), min(r["item"]["profile"]["count"] for r in cross)])
    for cid in ("ca9", "ca2", "cadc"):
        r = flows.get(f"citing:{cid}")
        if not r:
            continue
        p = r["item"]["profile"]
        links_by_citing(cid)  # materialises this court's citing links as lc
        med = con.execute(
            f"""SELECT median(date_diff('day', kb.date_filed, ka.date_filed) / 365.25), count(*)
                FROM lc JOIN oc a ON a.oid = lc.x JOIN oc b ON b.oid = lc.y
                JOIN cl.cluster ka ON ka.id = a.cid JOIN cl.cluster kb ON kb.id = b.cid
                WHERE a.cid <> b.cid AND ka.date_filed BETWEEN {LO} AND {HI} AND kb.date_filed BETWEEN {LO} AND {HI} AND ka.date_filed >= kb.date_filed""").fetchone()
        check("median years between cited and citing opinion", f"citing:{cid}", round(float(med[0]), 1), p["lag"]["median_years"], 0.051)
        check("links in the age basis", f"citing:{cid}", med[1], p["lag"]["n"])
    cm = flows["matrix:circuits"]["item"]["profile"]
    for a, b in (("ca9", "ca9"), ("ca9", "scotus"), ("ca5", "ca5"), ("cadc", "scotus"), ("ca2", "ca9")):
        n = links_by_citing(a, b)
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
        valid = f"""FROM cm.cmap m JOIN op.opinion oa ON oa.id = m.citing_opinion_id JOIN op.opinion ob ON ob.id = m.cited_opinion_id AND ob.cluster_id = ?
                    LEFT JOIN cl.cluster ka ON ka.id = oa.cluster_id LEFT JOIN cl.cluster kb ON kb.id = ob.cluster_id LEFT JOIN dk.docket dc ON dc.id = ka.docket_id
                    WHERE {{cond}} coalesce(ka.date_filed BETWEEN {LO} AND {HI} AND kb.date_filed BETWEEN {LO} AND {HI} AND ka.date_filed < kb.date_filed, false)"""
        valid_sql = valid.replace("{cond}", "NOT")
        by_court = con.execute(f"SELECT dc.court_id, count(*) {valid_sql} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1", [cid]).fetchone()
        if by_court and p["citing_courts"]:
            check("most frequent citing court among links not dated before the cited opinion (id, links)", w, [by_court[0], by_court[1]], [p["citing_courts"][0]["court_id"], p["citing_courts"][0]["count"]])
        known = con.execute(f"SELECT count(*) {valid_sql}", [cid]).fetchone()[0]
        aside = con.execute(f"SELECT count(*) {valid.replace('{cond}', '')}", [cid]).fetchone()[0]
        check("links with a known citing court, not dated before the cited opinion", w, known, p["links_with_known_citing_court"])
        check("links set aside because the citing opinion is dated before the cited one", w, aside, p["links_citing_filed_before_cited"])
        check("first cited year is not before the cluster's own filing year", w, True, not (p["first_cited_year"] and p["date_filed"] and p["first_cited_year"] < int(p["date_filed"][:4])))
        pn = con.execute("SELECT count(*) FROM pr.parenthetical WHERE described_opinion_id IN (SELECT id FROM op.opinion WHERE cluster_id = ?)", [cid]).fetchone()[0]
        check("parenthetical descriptions", w, pn, (p["parentheticals"] or {}).get("n", 0))
        cites = con.execute("SELECT count(*) FROM ci.citation WHERE cluster_id = ?", [cid]).fetchone()[0]
        check("reporter citations on file", w, cites, len(p["citations"]))
    ids_sorted = [r["item"]["profile"]["cluster_id"] for r in ranked]
    top1000 = con.execute(
        """SELECT k.id FROM cl.cluster k LEFT JOIN dk.docket d ON d.id = k.docket_id
           WHERE k.citation_count > 0 AND NOT coalesce(k.blocked, false) AND NOT coalesce(d.blocked, false) ORDER BY k.citation_count DESC, k.id LIMIT 1000""").fetchall()
    check("the 1,000 clusters listed are the 1,000 not-blocked clusters with the highest citation_count (ties by id)", "clb_top_cited", [x[0] for x in top1000], ids_sorted)
    blocked_listed = con.execute(f"SELECT count(*) FROM cl.cluster k LEFT JOIN dk.docket d ON d.id = k.docket_id WHERE k.id IN ({', '.join(str(i) for i in ids_sorted)}) AND (coalesce(k.blocked, false) OR coalesce(d.blocked, false))").fetchone()[0]
    check("no listed cluster is blocked from search engines", "clb_top_cited", 0, blocked_listed)
    # ---------------------------------------------------------------- judge authorship
    with_op = [r for r in judges.values() if r["item"]["profile"].get("opinions")]
    with_op.sort(key=lambda r: -r["item"]["profile"]["opinions"]["authored"])
    named = [judges[k] for k in ("5749", "3753", "1213") if k in judges and judges[k]["item"]["profile"].get("opinions")]
    for r in with_op[:10] + with_op[len(with_op) // 2: len(with_op) // 2 + 6] + with_op[-6:] + named:
        p = r["item"]["profile"]["opinions"]
        pid = int(r["id"])
        w = f"clb_judge_dockets {pid}"
        n, pc, excl = con.execute("SELECT count(*) FILTER (WHERE lifeok), count(*) FILTER (WHERE lifeok AND per_curiam), count(*) FILTER (WHERE NOT lifeok) FROM oa WHERE author_id = ?", [pid]).fetchone()
        check("opinions authored (inside the author's recorded lifespan)", w, n, p["authored"])
        check("opinions set aside as dated outside the author's lifespan", w, excl, p["excluded_outside_lifespan"])
        check("per curiam among them", w, pc, p["per_curiam"])
        lead = con.execute(f"SELECT count(*) FROM oa WHERE author_id = ? AND lifeok AND type IN ({LEAD})", [pid]).fetchone()[0]
        check("lead, combined or similar opinions", w, lead, p["lead_or_combined"])
        if "clusters_with_lead_opinion" in p:
            cl_n, cl_sum = con.execute(
                f"""SELECT count(*), sum(k.citation_count) FROM cl.cluster k WHERE k.id IN (SELECT cid FROM oa WHERE author_id = ? AND lifeok AND type IN ({LEAD}))""", [pid]).fetchone()
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
