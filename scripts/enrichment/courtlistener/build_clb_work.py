"""Aggregate the slim CourtListener tables into a small working database (work.duckdb) used by the clb_* builders.

    python3 -I -B build_clb_work.py [--steps court,year,...] [--list]

Every step is one SQL aggregate over the attached read-only slim tables (docket, cluster, citation, oral_argument, small, and
opinion/cmap when loaded) and writes a table w_* into work.duckdb. Dates outside 1700-01-01..2026-09-30 (the snapshot date) are
treated as not recorded; the count of such rows is kept (implausible_filed). Nothing here interprets legal meaning: counts, shares and
quantiles over rows in the CourtListener collection.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "fjc_idb"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import duckdb  # noqa: E402
import idb_codes  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
WORK = os.path.join(DB, "work.duckdb")
TMP = os.path.join(ROOT, "private", "scratch", "duck_tmp")
LO, HI = "DATE '1700-01-01'", "DATE '2026-09-30'"


def ok(col: str) -> str:
    return f"CASE WHEN {col} BETWEEN {LO} AND {HI} THEN {col} END"


def connect() -> duckdb.DuckDBPyConnection:
    os.makedirs(TMP, exist_ok=True)
    con = duckdb.connect(WORK)
    con.execute("PRAGMA memory_limit='4GB'")
    con.execute("PRAGMA threads=2")
    con.execute(f"PRAGMA temp_directory='{TMP}'")
    for alias, f in (("dk", "docket"), ("cl", "cluster"), ("ci", "citation"), ("oa", "oral_argument"), ("cm", "cmap"), ("sm", "small"), ("ix", "idb")):
        con.execute(f"ATTACH '{DB}/{f}.duckdb' AS {alias} (READ_ONLY)")
    con.execute("PRAGMA max_temp_directory_size='3GB'")
    if os.path.exists(os.path.join(DB, "opinion.done.json")):
        con.execute(f"ATTACH '{DB}/opinion.duckdb' AS op (READ_ONLY)")
    if os.path.exists(os.path.join(DB, "parenthetical.done.json")):
        con.execute(f"ATTACH '{DB}/parenthetical.duckdb' AS pr (READ_ONLY)")
    con.execute(
        f"""CREATE OR REPLACE TEMP VIEW d_base AS
            SELECT id, court_id, source, assigned_to_id, referred_to_id, appeal_from_id, idb_data_id, originating_court_information_id,
                   coalesce(nullif(regexp_extract(lower(docket_number), '[0-9]{{2}}-([a-z]{{2}})-[0-9]', 1), ''), federal_dn_case_type) AS case_type,
                   jurisdiction_type, jury_demand, nature_of_suit, cause, mdl_status, blocked,
                   {ok('date_filed')} AS filed, {ok('date_terminated')} AS term, date_filed AS raw_filed,
                   TRY_CAST(regexp_extract(nature_of_suit, '^\\s*([0-9]{{3}})(?:\\s|$)', 1) AS INTEGER) AS nos_code
            FROM dk.docket"""
    )
    con.execute("CREATE OR REPLACE TABLE nos_group (code INTEGER, grp VARCHAR)")
    con.executemany("INSERT INTO nos_group VALUES (?, ?)", list(idb_codes.NOS_TO_GROUP.items()))
    return con


STEPS: dict[str, str] = {}

STEPS["court"] = """
CREATE OR REPLACE TABLE w_court AS
SELECT court_id, count(*) AS dockets, count(filed) AS dated, count(*) - count(raw_filed) AS no_filed_date,
       count(raw_filed) - count(filed) AS implausible_filed, min(filed) AS first_filed, max(filed) AS last_filed,
       count(term) AS terminated, count(assigned_to_id) AS with_assigned, count(referred_to_id) AS with_referred,
       count(idb_data_id) AS with_idb, count(appeal_from_id) AS with_appeal_from, count(originating_court_information_id) AS with_origin_info,
       count(*) FILTER (WHERE mdl_status IS NOT NULL AND mdl_status <> '') AS mdl_flagged,
       count(nature_of_suit) AS with_nos, count(cause) AS with_cause, count(*) FILTER (WHERE blocked) AS blocked,
       count(*) FILTER (WHERE source & 1 = 1) AS recap
FROM d_base GROUP BY court_id"""

STEPS["year"] = """
CREATE OR REPLACE TABLE w_court_year AS
SELECT court_id, year(filed) AS yr, count(*) AS dockets, count(term) AS terminated,
       count(*) FILTER (WHERE case_type = 'cv') AS civil, count(*) FILTER (WHERE case_type = 'cr') AS criminal,
       count(*) FILTER (WHERE source & 1 = 1) AS recap
FROM d_base WHERE filed IS NOT NULL GROUP BY 1, 2"""

STEPS["source"] = """
CREATE OR REPLACE TABLE w_court_source AS
SELECT court_id, source, count(*) AS n FROM d_base GROUP BY 1, 2"""

STEPS["casetype"] = """
CREATE OR REPLACE TABLE w_court_casetype AS
SELECT court_id, case_type, count(*) AS n, count(term) AS n_term FROM d_base GROUP BY 1, 2"""

STEPS["nos"] = """
CREATE OR REPLACE TABLE w_court_nos AS
SELECT court_id, nature_of_suit AS nos_text, nos_code, count(*) AS n, count(term) AS n_term
FROM d_base WHERE nature_of_suit IS NOT NULL GROUP BY 1, 2, 3"""

STEPS["cause"] = """
CREATE OR REPLACE TABLE w_court_cause AS
SELECT court_id, cause, count(*) AS n FROM d_base WHERE cause IS NOT NULL GROUP BY 1, 2"""

STEPS["jt"] = """
CREATE OR REPLACE TABLE w_court_jt AS
SELECT court_id, jurisdiction_type, count(*) AS n FROM d_base WHERE jurisdiction_type IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_court_jury AS
SELECT court_id, jury_demand, count(*) AS n FROM d_base WHERE jury_demand IS NOT NULL GROUP BY 1, 2"""

STEPS["dur"] = """
CREATE OR REPLACE TABLE w_court_dur AS
SELECT court_id, scope, count(*) AS n, avg(days) AS mean_days, quantile_cont(days, 0.25) AS p25, quantile_cont(days, 0.5) AS p50,
       quantile_cont(days, 0.75) AS p75, quantile_cont(days, 0.9) AS p90
FROM (
  SELECT court_id, 'all' AS scope, date_diff('day', filed, term) AS days FROM d_base WHERE filed IS NOT NULL AND term >= filed
  UNION ALL
  SELECT court_id, 'cv', date_diff('day', filed, term) FROM d_base WHERE filed IS NOT NULL AND term >= filed AND case_type = 'cv'
) GROUP BY 1, 2"""

STEPS["fy"] = """
CREATE OR REPLACE TABLE w_court_fy_cv AS
SELECT court_id, year(filed + INTERVAL 3 MONTH) AS fy, count(*) AS civil, count(idb_data_id) AS with_idb, count(term) AS terminated
FROM d_base WHERE filed IS NOT NULL AND case_type = 'cv' GROUP BY 1, 2"""

STEPS["judge"] = """
CREATE OR REPLACE TABLE w_court_judge AS
SELECT court_id, assigned_to_id AS judge_id, count(*) AS n, count(term) AS n_term, min(filed) AS first_filed, max(filed) AS last_filed
FROM d_base WHERE assigned_to_id IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_court_referred AS
SELECT court_id, referred_to_id AS judge_id, count(*) AS n, count(term) AS n_term, min(filed) AS first_filed, max(filed) AS last_filed
FROM d_base WHERE referred_to_id IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_judge_year AS
SELECT assigned_to_id AS judge_id, year(filed) AS yr, count(*) AS n, count(term) AS n_term
FROM d_base WHERE assigned_to_id IS NOT NULL AND filed IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_judge_nos AS
SELECT d.assigned_to_id AS judge_id, coalesce(g.grp, CASE WHEN d.nos_code IS NULL THEN 'none' ELSE 'unmapped' END) AS grp, count(*) AS n
FROM d_base d LEFT JOIN nos_group g ON g.code = d.nos_code WHERE d.assigned_to_id IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_judge_dur AS
SELECT assigned_to_id AS judge_id, count(*) AS n, quantile_cont(date_diff('day', filed, term), 0.5) AS p50,
       quantile_cont(date_diff('day', filed, term), 0.25) AS p25, quantile_cont(date_diff('day', filed, term), 0.75) AS p75
FROM d_base WHERE assigned_to_id IS NOT NULL AND filed IS NOT NULL AND term >= filed AND case_type = 'cv' GROUP BY 1;
CREATE OR REPLACE TABLE w_judge_mdl AS
SELECT assigned_to_id AS judge_id, count(*) FILTER (WHERE mdl_status IS NOT NULL AND mdl_status <> '') AS mdl_flagged,
       count(*) FILTER (WHERE case_type = 'cv') AS civil, count(*) FILTER (WHERE case_type = 'cr') AS criminal,
       count(*) FILTER (WHERE source & 1 = 1) AS recap
FROM d_base WHERE assigned_to_id IS NOT NULL GROUP BY 1"""

STEPS["appeal"] = """
CREATE OR REPLACE TABLE w_appeal AS
SELECT court_id, appeal_from_id AS from_court, count(*) AS n FROM d_base WHERE appeal_from_id IS NOT NULL GROUP BY 1, 2"""

STEPS["nosnat"] = """
CREATE OR REPLACE TABLE w_nos_year AS
SELECT d.nos_code, coalesce(g.grp, CASE WHEN d.nos_code IS NULL THEN 'none' ELSE 'unmapped' END) AS grp, year(d.filed) AS yr, count(*) AS n, count(d.term) AS n_term
FROM d_base d LEFT JOIN nos_group g ON g.code = d.nos_code
WHERE d.filed IS NOT NULL AND d.nature_of_suit IS NOT NULL GROUP BY 1, 2, 3;
CREATE OR REPLACE TABLE w_nos_court AS
SELECT d.nos_code, coalesce(g.grp, CASE WHEN d.nos_code IS NULL THEN 'none' ELSE 'unmapped' END) AS grp, d.court_id, count(*) AS n
FROM d_base d LEFT JOIN nos_group g ON g.code = d.nos_code WHERE d.nature_of_suit IS NOT NULL GROUP BY 1, 2, 3"""

STEPS["clusterjoin"] = f"""
CREATE OR REPLACE TABLE w_cj AS
SELECT c.id AS cid, d.court_id, c.docket_id, c.case_name, {ok('c.date_filed')} AS filed, c.date_filed_is_approximate AS approx, c.precedential_status AS prec,
       c.citation_count AS cites, c.source AS csrc, c.scdb_id, c.scdb_decision_direction AS scdb_dir, c.scdb_votes_majority AS vmaj, c.scdb_votes_minority AS vmin,
       c.has_syllabus, c.has_headnotes, c.has_summary, c.has_attorneys, c.has_headmatter, c.blocked, d.blocked AS docket_blocked
FROM cl.cluster c LEFT JOIN (SELECT id, court_id, blocked FROM dk.docket) d ON d.id = c.docket_id"""

STEPS["cluster"] = """
CREATE OR REPLACE TABLE w_cl_court AS
SELECT court_id, count(*) AS clusters, count(filed) AS dated, min(filed) AS first_filed, max(filed) AS last_filed,
       count(*) FILTER (WHERE cites > 0) AS cited, sum(cites) AS cite_total, max(cites) AS cite_max,
       quantile_cont(cites, 0.5) FILTER (WHERE cites > 0) AS cite_p50_cited, quantile_cont(cites, 0.9) FILTER (WHERE cites > 0) AS cite_p90_cited,
       quantile_cont(cites, 0.99) FILTER (WHERE cites > 0) AS cite_p99_cited,
       count(*) FILTER (WHERE prec = 'Published') AS published, count(*) FILTER (WHERE has_syllabus) AS with_syllabus,
       count(*) FILTER (WHERE has_headnotes) AS with_headnotes, count(*) FILTER (WHERE has_summary) AS with_summary,
       count(*) FILTER (WHERE scdb_id IS NOT NULL) AS with_scdb
FROM w_cj GROUP BY court_id;
CREATE OR REPLACE TABLE w_cl_blocked AS
SELECT court_id, count(*) FILTER (WHERE coalesce(blocked, false) OR coalesce(docket_blocked, false)) AS blocked_clusters, count(DISTINCT docket_id) AS dockets_with_cluster
FROM w_cj GROUP BY court_id;
CREATE OR REPLACE TABLE w_cl_court_year AS
SELECT court_id, year(filed) AS yr, count(*) AS clusters, count(*) FILTER (WHERE cites > 0) AS cited, sum(cites) AS cite_total
FROM w_cj WHERE filed IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_cl_court_prec AS
SELECT court_id, prec, count(*) AS n FROM w_cj GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_cl_top AS
SELECT * FROM (
  SELECT court_id, cid, docket_id, case_name, filed, cites, row_number() OVER (PARTITION BY court_id ORDER BY cites DESC, cid) AS rn
  FROM w_cj WHERE cites > 0 AND NOT coalesce(blocked, false) AND NOT coalesce(docket_blocked, false)
) WHERE rn <= 10;
CREATE OR REPLACE TABLE w_cl_top_national AS
SELECT cid, court_id, docket_id, case_name, filed, cites FROM w_cj WHERE cites > 0 AND NOT coalesce(blocked, false) AND NOT coalesce(docket_blocked, false) ORDER BY cites DESC, cid LIMIT 1000"""

STEPS["reporters"] = """
CREATE OR REPLACE TABLE w_cl_reporter AS
SELECT j.court_id, c.reporter, count(*) AS n
FROM ci.citation c JOIN w_cj j ON j.cid = c.cluster_id GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_cl_cov AS
SELECT j.court_id, count(DISTINCT c.cluster_id) AS with_reporter_cite
FROM ci.citation c JOIN w_cj j ON j.cid = c.cluster_id GROUP BY 1"""

STEPS["oral"] = f"""
CREATE OR REPLACE TABLE w_oral_court AS
SELECT d.court_id, count(*) AS n, count(DISTINCT o.docket_id) AS dockets, min({ok('o.date_created')}) AS first_created, max({ok('o.date_created')}) AS last_created,
       quantile_cont(o.duration, 0.5) FILTER (WHERE o.duration > 0) AS p50_seconds, count(*) FILTER (WHERE o.has_transcript) AS with_transcript,
       sum(o.duration) FILTER (WHERE o.duration > 0) AS total_seconds
FROM oa.oral_argument o LEFT JOIN (SELECT id, court_id FROM dk.docket) d ON d.id = o.docket_id GROUP BY 1;
CREATE OR REPLACE TABLE w_oral_year AS
SELECT d.court_id, year({ok('o.date_created')}) AS yr, count(*) AS n
FROM oa.oral_argument o LEFT JOIN (SELECT id, court_id FROM dk.docket) d ON d.id = o.docket_id GROUP BY 1, 2"""

STEPS["scotus"] = """
CREATE OR REPLACE TABLE w_scotus_year AS
SELECT year(filed) AS yr, count(*) AS clusters, count(*) FILTER (WHERE scdb_id IS NOT NULL) AS scdb,
       count(*) FILTER (WHERE scdb_id IS NOT NULL AND vmaj IS NOT NULL AND vmin = 0) AS unanimous,
       count(*) FILTER (WHERE scdb_id IS NOT NULL AND vmaj = 5 AND vmin = 4) AS five_four,
       count(*) FILTER (WHERE scdb_id IS NOT NULL AND vmaj IS NOT NULL AND vmin IS NOT NULL) AS with_votes,
       count(*) FILTER (WHERE scdb_dir = 1) AS dir_conservative, count(*) FILTER (WHERE scdb_dir = 2) AS dir_liberal, count(*) FILTER (WHERE scdb_dir = 3) AS dir_unspecifiable
FROM w_cj WHERE court_id = 'scotus' AND filed IS NOT NULL GROUP BY 1"""

STEPS["opinion"] = """
CREATE OR REPLACE TABLE w_op AS
SELECT o.id AS oid, o.cluster_id AS cid, o.author_id, o.type, o.per_curiam, o.page_count, o.extracted_by_ocr, o.has_joined_by, o.len_plain_text,
       o.len_html_with_citations, j.court_id, j.filed
FROM op.opinion o LEFT JOIN w_cj j ON j.cid = o.cluster_id"""

STEPS["authors"] = """
CREATE OR REPLACE TABLE w_opa AS
SELECT o.oid, o.cid, o.author_id, o.type, o.per_curiam, o.court_id, o.filed,
       NOT (o.filed IS NOT NULL AND ((p.dob IS NOT NULL AND o.filed < p.dob + INTERVAL 25 YEAR) OR (p.dod IS NOT NULL AND o.filed > p.dod + INTERVAL 1 YEAR))) AS plausible
FROM w_op o
LEFT JOIN (SELECT TRY_CAST(id AS BIGINT) AS pid, TRY_CAST(date_dob AS DATE) AS dob, TRY_CAST(date_dod AS DATE) AS dod FROM sm.person) p ON p.pid = o.author_id
WHERE o.author_id IS NOT NULL;
CREATE OR REPLACE TABLE w_author AS
SELECT author_id, court_id, type, count(*) AS n, count(*) FILTER (WHERE per_curiam) AS per_curiam, min(filed) AS first_filed, max(filed) AS last_filed
FROM w_opa WHERE plausible GROUP BY 1, 2, 3;
CREATE OR REPLACE TABLE w_author_year AS
SELECT author_id, year(filed) AS yr, count(*) AS n FROM w_opa WHERE plausible AND filed IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_author_excl AS
SELECT author_id, count(*) AS n, min(filed) AS first_filed, max(filed) AS last_filed FROM w_opa WHERE NOT plausible GROUP BY 1;
CREATE OR REPLACE TABLE w_court_op AS
SELECT court_id, type, count(*) AS n, count(*) FILTER (WHERE author_id IS NOT NULL) AS with_author, count(*) FILTER (WHERE per_curiam) AS per_curiam,
       count(*) FILTER (WHERE extracted_by_ocr) AS ocr, count(*) FILTER (WHERE has_joined_by) AS with_joined_by
FROM w_op GROUP BY 1, 2"""

STEPS["flows"] = """
CREATE OR REPLACE TABLE w_cite_flow AS
SELECT a.court_id AS citing_court, b.court_id AS cited_court, count(*) AS n
FROM cm.cmap m JOIN w_op a ON a.oid = m.citing_opinion_id JOIN w_op b ON b.oid = m.cited_opinion_id WHERE a.cid IS DISTINCT FROM b.cid GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_cite_flow_year AS
SELECT a.court_id AS citing_court, year(a.filed) AS yr, count(*) AS n
FROM cm.cmap m JOIN w_op a ON a.oid = m.citing_opinion_id JOIN w_op b ON b.oid = m.cited_opinion_id WHERE a.filed IS NOT NULL AND a.cid IS DISTINCT FROM b.cid GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_cite_in AS
SELECT b.court_id AS cited_court, year(b.filed) AS cited_yr, count(*) AS n
FROM cm.cmap m JOIN w_op a ON a.oid = m.citing_opinion_id JOIN w_op b ON b.oid = m.cited_opinion_id WHERE b.filed IS NOT NULL AND a.cid IS DISTINCT FROM b.cid GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_cmap_total AS
SELECT count(*) AS links, count(*) FILTER (WHERE a.oid IS NULL OR b.oid IS NULL) AS opinion_not_in_opinion_table,
       count(*) FILTER (WHERE a.oid IS NOT NULL AND b.oid IS NOT NULL AND a.cid = b.cid) AS same_decision_links
FROM cm.cmap m LEFT JOIN w_op a ON a.oid = m.citing_opinion_id LEFT JOIN w_op b ON b.oid = m.cited_opinion_id"""

STEPS["flows2"] = """
CREATE OR REPLACE TABLE w_cite_lag AS
SELECT a.court_id AS citing_court, count(*) AS n, quantile_cont(date_diff('day', b.filed, a.filed) / 365.25, 0.5) AS median_years,
       quantile_cont(date_diff('day', b.filed, a.filed) / 365.25, 0.9) AS p90_years, avg(date_diff('day', b.filed, a.filed) / 365.25) AS mean_years
FROM cm.cmap m JOIN w_op a ON a.oid = m.citing_opinion_id JOIN w_op b ON b.oid = m.cited_opinion_id
WHERE a.filed IS NOT NULL AND b.filed IS NOT NULL AND a.filed >= b.filed AND a.cid IS DISTINCT FROM b.cid GROUP BY 1;
CREATE OR REPLACE TABLE w_cite_level_year AS
SELECT year(a.filed) AS yr, a.court_id AS citing_court, count(*) AS n, count(*) FILTER (WHERE a.court_id = b.court_id) AS same_court
FROM cm.cmap m JOIN w_op a ON a.oid = m.citing_opinion_id JOIN w_op b ON b.oid = m.cited_opinion_id
WHERE a.filed IS NOT NULL AND a.cid IS DISTINCT FROM b.cid GROUP BY 1, 2"""

STEPS["authcites"] = """
CREATE OR REPLACE TABLE w_author_cites AS
SELECT o.author_id, count(DISTINCT o.cid) AS clusters, sum(j.cites) AS cites, quantile_cont(j.cites, 0.5) AS p50
FROM (SELECT DISTINCT author_id, cid FROM w_opa WHERE plausible AND type IN ('010combined', '015unamimous', '020lead', '025plurality', '080onthemerits')) o
JOIN w_cj j ON j.cid = o.cid GROUP BY 1"""

STEPS["linkcheck"] = """
CREATE OR REPLACE TABLE w_cite_order AS
SELECT CASE WHEN a.filed IS NULL OR b.filed IS NULL THEN 'undated' WHEN a.filed < b.filed THEN 'citing_filed_before_cited' ELSE 'ordered' END AS order_class,
       (a.cid = b.cid) AS same_decision, count(*) AS n
FROM cm.cmap m JOIN w_op a ON a.oid = m.citing_opinion_id JOIN w_op b ON b.oid = m.cited_opinion_id GROUP BY 1, 2"""

STEPS["topcited"] = """
CREATE OR REPLACE TABLE w_top_citers AS
SELECT b.cid AS cited_cid, a.court_id AS citing_court, year(a.filed) AS yr, count(*) AS n
FROM cm.cmap m
JOIN w_op b ON b.oid = m.cited_opinion_id AND b.cid IN (SELECT cid FROM w_cl_top_national)
JOIN w_op a ON a.oid = m.citing_opinion_id
WHERE NOT (a.filed IS NOT NULL AND b.filed IS NOT NULL AND a.filed < b.filed)
GROUP BY 1, 2, 3;
CREATE OR REPLACE TABLE w_top_anach AS
SELECT b.cid AS cited_cid, count(*) AS n
FROM cm.cmap m
JOIN w_op b ON b.oid = m.cited_opinion_id AND b.cid IN (SELECT cid FROM w_cl_top_national)
JOIN w_op a ON a.oid = m.citing_opinion_id
WHERE a.filed IS NOT NULL AND b.filed IS NOT NULL AND a.filed < b.filed GROUP BY 1;
CREATE OR REPLACE TABLE w_top_links AS
SELECT b.cid AS cited_cid, count(*) AS links
FROM cm.cmap m JOIN w_op b ON b.oid = m.cited_opinion_id AND b.cid IN (SELECT cid FROM w_cl_top_national) GROUP BY 1;
CREATE OR REPLACE TABLE w_top_reporters AS
SELECT c.cluster_id AS cid, c.volume, c.reporter, c.page, c.type FROM ci.citation c WHERE c.cluster_id IN (SELECT cid FROM w_cl_top_national)"""

STEPS["parens"] = """
CREATE OR REPLACE TABLE w_paren AS
SELECT b.cid, b.court_id, count(*) AS n, avg(p.score) AS avg_score, count(DISTINCT p.describing_opinion_id) AS describing
FROM pr.parenthetical p JOIN w_op b ON b.oid = p.described_opinion_id GROUP BY 1, 2;
CREATE OR REPLACE TABLE w_paren_court AS
SELECT b.court_id, count(*) AS n, count(DISTINCT b.cid) AS clusters FROM pr.parenthetical p JOIN w_op b ON b.oid = p.described_opinion_id GROUP BY 1"""

ORDER = ["court", "year", "source", "casetype", "nos", "cause", "jt", "dur", "fy", "judge", "appeal", "nosnat", "clusterjoin", "cluster", "reporters", "oral", "scotus"]
LATER = ["opinion", "authors", "flows", "flows2", "linkcheck", "authcites", "topcited", "parens"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", default=",".join(ORDER))
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list:
        print("steps:", ", ".join(ORDER + LATER))
        return 0
    con = connect()
    for name in a.steps.split(","):
        sql = STEPS[name]
        t0 = time.time()
        for stmt in [s for s in sql.split(";\n") if s.strip()]:
            con.execute(stmt)
        tables = re.findall(r"CREATE OR REPLACE TABLE (\w+)", sql)
        counts = {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in tables}
        print(f"[{name}] {time.time() - t0:,.1f}s {counts}", flush=True)
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
