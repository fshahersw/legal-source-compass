"""Build clb_top_cited_parentheticals: how later opinions describe the 1,000 most-cited clusters (clb_top_cited), in their own words.

Source: parentheticals-2026-09-30.csv.bz2, streamed by ingest_rest.py (paren_top) keeping only rows whose described opinion belongs to
one of the 1,000 clusters of clb_top_cited, with the parenthetical text. CourtListener extracts a parenthetical from the citing
opinion's text (for example "(holding that ...)"), scores it, and groups similar ones (group_id). Per cluster: counts, describing courts
and decades, and up to 12 of the highest-scored parentheticals, at most one per group, with the describing case. Describing cases that
CourtListener flags as blocked from search engines are not named. The text is shown as CourtListener extracted it.
"""
from __future__ import annotations

import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402

DATASET = "clb_top_cited_parentheticals"
SHOW = 12
MAX_TEXT = 600


def clip(s):
    s = " ".join((s or "").split())
    return s if len(s) <= MAX_TEXT else s[: MAX_TEXT - 1].rstrip() + "…"


def build() -> dict:
    con = duckdb.connect()
    con.execute("PRAGMA threads=3")
    for alias, f in (("pt", "paren_top"), ("wk", "work"), ("sm", "small")):
        con.execute(f"ATTACH '{os.path.join(rc.DB, f + '.duckdb')}' AS {alias} (READ_ONLY)")
    top_ids = rc.published_ids("clb_top_cited")
    spine = rc.spine_ids()
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2]} for r in con.execute("SELECT id, full_name, jurisdiction FROM sm.courts").fetchall()}
    top = con.execute("SELECT cid, court_id, case_name, filed, cites FROM wk.w_cl_top_national ORDER BY cites DESC, cid").fetchall()
    assert {f"cluster:{t[0]}" for t in top} == top_ids, "the work table's top-1000 differs from the published clb_top_cited ids"
    con.execute("""CREATE TEMP TABLE p AS
        SELECT t.id, t.score, t.group_id, t.text, k.cid AS described_cid, t.describing_opinion_id AS doid, o.cid AS dcid, o.court_id AS dcourt, o.filed AS dfiled,
               j.case_name AS dname, coalesce(j.blocked, false) OR coalesce(j.docket_blocked, false) AS dblocked
        FROM pt.paren_top t JOIN pt.keep_oid k ON k.oid = t.described_opinion_id
        LEFT JOIN wk.w_op o ON o.oid = t.describing_opinion_id LEFT JOIN wk.w_cj j ON j.cid = o.cid""")
    stats = {r[0]: r[1:] for r in con.execute(
        "SELECT described_cid, count(*), count(DISTINCT doid), count(DISTINCT group_id), avg(score), count(dcid) FROM p GROUP BY 1").fetchall()}
    by_court = defaultdict(Counter)
    by_decade = defaultdict(Counter)
    for cid, court, dec, n in con.execute("SELECT described_cid, dcourt, year(dfiled) // 10 * 10, count(*) FROM p GROUP BY 1, 2, 3").fetchall():
        if court:
            by_court[cid][court] += n
        if dec:
            by_decade[cid][int(dec)] += n
    picks = defaultdict(list)
    for row in con.execute("""SELECT described_cid, id, score, group_id, text, dcid, dcourt, dfiled, dname, dblocked FROM (
                                SELECT *, row_number() OVER (PARTITION BY described_cid, group_id ORDER BY score DESC, id) AS g FROM p) WHERE g = 1
                              ORDER BY described_cid, score DESC, id""").fetchall():
        cid = row[0]
        if len(picks[cid]) >= SHOW:
            continue
        _, pid, score, gid, text, dcid, dcourt, dfiled, dname, dblocked = row
        picks[cid].append({"parenthetical_id": pid, "score": cc.r2(score), "group_id": gid, "text": clip(text), "truncated": len(" ".join((text or "").split())) > MAX_TEXT,
                           "describing_cluster_id": dcid if dcid and not dblocked else None, "describing_case": (dname or None) if dcid and not dblocked else None,
                           "describing_case_withheld": bool(dcid and dblocked), "describing_court_id": dcourt, "describing_court": courts.get(dcourt, {}).get("name") if dcourt else None,
                           "describing_year": dfiled.year if dfiled else None,
                           "describing_url": f"https://www.courtlistener.com/opinion/{dcid}/" if dcid and not dblocked else None,
                           "describing_court_link": rc.court_link(dcourt, spine)})
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = []
    for rank, (cid, court, name, filed, cites) in enumerate(top, 1):
        st = stats.get(cid)
        n, ndesc, ngroups, avg, with_court = st if st else (0, 0, 0, None, 0)
        bc = by_court.get(cid, Counter())
        known = sum(bc.values())
        grp = Counter()
        for c, k in bc.items():
            j = courts.get(c, {}).get("jur")
            grp["Federal" if j in cc.FEDERAL_JURISDICTIONS else "State" if j in cc.STATE_JURISDICTIONS else "Other"] += k
        top_courts = [{"court_id": c, "name": courts.get(c, {}).get("name", c), "n": k, "share_pct": cc.share(k, known), "link": rc.court_link(c, spine)} for c, k in sorted(bc.items(), key=lambda kv: (-kv[1], kv[0]))[:6]]
        cname = courts.get(court, {}).get("name", court)
        profile = {"rank": rank, "cluster_id": cid, "case_name": name, "court_id": court, "court": cname, "date_filed": str(filed) if filed else None, "times_cited": cites,
                   "parentheticals": n, "describing_opinions": ndesc, "groups": ngroups, "avg_score": cc.r2(avg), "with_describing_court": known,
                   "describing_courts": top_courts, "describing_groups": dict(grp), "by_decade": [{"decade": d, "n": k} for d, k in sorted(by_decade.get(cid, Counter()).items())],
                   "examples": picks.get(cid, []), "url": f"https://www.courtlistener.com/opinion/{cid}/", "top_cited_record": f"/records/clb_top_cited/cluster:{cid}"}
        ex = picks.get(cid, [])
        rows.append(writer.record(
            DATASET, f"cluster:{cid}", f"How courts describe {name or 'case name not recorded'}", source_url=rc.PAREN_URL,
            subtitle=f"rank {rank} by citation_count · {n:,} parentheticals from {ndesc:,} opinions · {ngroups:,} groups",
            cells={"rank": rank, "case": name, "court": cname, "year": filed.year if filed else None, "parentheticals": n, "describing_opinions": ndesc, "groups": ngroups,
                   "federal_pct": cc.share(grp.get("Federal", 0), known), "state_pct": cc.share(grp.get("State", 0), known)},
            badges=["CourtListener bulk data", "Extracted from opinion text"],
            facts=rc.facts([("Case (as recorded)", name), ("Court", cname), ("Rank among the most cited (citation_count)", rank),
                            ("Parentheticals describing its opinions", f"{n:,} from {ndesc:,} describing opinions, in {ngroups:,} groups of similar descriptions"),
                            ("Describing courts", "; ".join(f"{t['name']} {t['share_pct']}%" for t in top_courts[:4]) or None),
                            ("Highest-scored description", f"\"{ex[0]['text']}\"" + (f" ({ex[0]['describing_case']}, {ex[0]['describing_year']})" if ex[0]["describing_case"] else "") if ex else None),
                            ("Reading", "Parentheticals are CourtListener's extraction of the words citing opinions use to describe this case; the score and grouping are CourtListener's. They summarise what other courts said, not the holding as verified here.")]),
            text=f"parentheticals {name} {cname}", filters={"court": [court or "unknown"]},
            links=[{"label": "Opinion on CourtListener", "url": profile["url"]}, {"label": "Most-cited record", "url": profile["top_cited_record"]}] + ([{"label": "Court profile", "url": f"/courts/{court}"}] if court in spine else []),
            extra={"profile": profile}))
    done = __import__("json").load(open(os.path.join(rc.DB, "paren_top.done.json")))
    summary = {
        "source": "CourtListener bulk data: parentheticals, opinions, opinion clusters, dockets (Free Law Project)", "snapshot": cc.SNAPSHOT, "terms": rc.TERMS,
        "totals": {"clusters": len(rows), "parentheticals": sum(r["item"]["cells"]["parentheticals"] for r in rows), "parenthetical_rows_streamed": done["rows_read"],
                   "clusters_with_parentheticals": sum(1 for r in rows if r["item"]["cells"]["parentheticals"])},
        "definitions": {"parenthetical": "a description of a cited opinion that CourtListener extracted from the citing opinion's text", "score": "CourtListener's descriptiveness score of the parenthetical",
                        "group": "CourtListener's group of similar parentheticals (group_id)", "examples": f"up to {SHOW} parentheticals per cluster: the highest-scored one of each group, highest first",
                        "describing court": "court of the describing opinion's cluster docket"},
        "caveats": ["Parentheticals summarise what other opinions said about the case; they are not a verified statement of its holding.",
                    "Describing cases that CourtListener flags as blocked from search engines are not named.", f"Text longer than {MAX_TEXT} characters is cut and marked."],
        "grain": "one record per cluster of clb_top_cited (same ids)"}
    return {DATASET: {
        "dataset": DATASET, "label": "How later opinions describe the 1,000 most-cited opinion clusters: CourtListener parentheticals (Sept 30, 2026)",
        "listing_block": writer.listing([("rank", "Rank"), ("case", "Case"), ("court", "Court"), ("year", "Year"), ("parentheticals", "Parentheticals"), ("describing_opinions", "Describing opinions"),
                                         ("groups", "Groups"), ("federal_pct", "From federal courts %"), ("state_pct", "From state courts %")], []),
        "summary": summary, "rows": rows, "built_at": built_at,
        "inputs": [{"url": rc.PAREN_URL, "path": "streamed; rows for top-cited opinions kept in private/acq/courtlistener/db/paren_top.duckdb", "sha256": None},
                   {"url": rc.OPINIONS_URL, "path": "work.duckdb w_op", "sha256": None}, {"url": rc.CLUSTERS_URL, "path": "work.duckdb w_cj, w_cl_top_national", "sha256": None}]}}


if __name__ == "__main__":
    rc.write(build())
