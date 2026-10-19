"""Aggregate the CourtListener slim tables this stream uses into rest_work.duckdb (tables r_*), read by the build_clb_* builders here.

    python3 -I -B build_rest_work.py [--steps bk,oa,oc,pn,um] [--list]

Inputs (all read-only, private/acq/courtlistener/db/): bankruptcy (randoms/bankruptcy-dockets-2022-09-19), unmatched_citation,
oral_argument, docket, small (courts, people, originating-court information, cluster panels), work (w_cj cluster->court,
w_op opinion->cluster/court). Every step is plain counting, quantiles and joins on exact ids; nothing is matched by name.
Dates outside 1700-01-01 .. the file's snapshot date are treated as not recorded (counted separately).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import duckdb  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
WORK = os.path.join(DB, "rest_work.duckdb")
TMP = os.path.join(ROOT, "private", "scratch", "duck_tmp_rest")
LO = "DATE '1700-01-01'"
HI_2026 = "DATE '2026-09-30'"  # main snapshot
HI_BK = "DATE '2022-09-19'"  # the bankruptcy file's own date


def ok(col: str, hi: str = HI_2026) -> str:
    return f"CASE WHEN {col} BETWEEN {LO} AND {hi} THEN {col} END"


def connect() -> duckdb.DuckDBPyConnection:
    os.makedirs(TMP, exist_ok=True)
    con = duckdb.connect(WORK)
    con.execute("PRAGMA memory_limit='5GB'")
    con.execute("PRAGMA threads=3")
    con.execute(f"PRAGMA temp_directory='{TMP}'")
    con.execute("PRAGMA max_temp_directory_size='3GB'")
    for alias, f in (("bk", "bankruptcy"), ("um", "unmatched_citation"), ("oa", "oral_argument"), ("dk", "docket"), ("sm", "small"), ("wk", "work")):
        con.execute(f"ATTACH '{DB}/{f}.duckdb' AS {alias} (READ_ONLY)")
    return con


Q = "quantile_cont({x}, [0.1, 0.25, 0.5, 0.75, 0.9])"
STEPS: dict[str, str] = {}

# --- bankruptcy dockets (2022-09-19 file) ------------------------------------------------------------------------------
STEPS["bk"] = f"""
CREATE OR REPLACE TEMP VIEW bkv AS
SELECT id, court_id, {ok('date_filed', HI_BK)} AS filed, date_filed AS raw_filed, {ok('date_terminated', HI_BK)} AS term, date_terminated AS raw_term,
       date_created, blocked, coalesce(dn_type, 'none') AS dn_type, assigned_to_id, assigned_to_str
FROM bk.bankruptcy;
CREATE OR REPLACE TABLE r_bk_court AS
SELECT court_id, count(*) AS n, count(filed) AS dated, count(raw_filed) - count(filed) AS implausible_filed, count(*) - count(raw_filed) AS no_filed,
       min(filed) AS first_filed, max(filed) AS last_filed, count(term) AS terminated, count(raw_term) - count(term) AS implausible_term,
       count(*) FILTER (WHERE term < filed) AS term_before_filed,
       count(assigned_to_id) AS with_judge_id, count(*) FILTER (WHERE assigned_to_id IS NULL AND assigned_to_str IS NOT NULL) AS judge_name_only,
       count(*) FILTER (WHERE blocked) AS blocked, min(date_created) AS first_created, max(date_created) AS last_created
FROM bkv GROUP BY 1;
CREATE OR REPLACE TABLE r_bk_dur AS
SELECT court_id, count(*) AS n, {Q.format(x='term - filed')} AS q FROM bkv WHERE term >= filed GROUP BY 1;
CREATE OR REPLACE TABLE r_bk_year AS
SELECT court_id, year(filed) AS yr, count(*) AS n, count(term) AS terminated, count(*) FILTER (WHERE dn_type = 'ap') AS ap,
       quantile_cont(term - filed, 0.5) FILTER (WHERE term >= filed) AS p50_days, count(*) FILTER (WHERE term >= filed) AS n_dur
FROM bkv WHERE filed IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_bk_type AS
SELECT court_id, dn_type, count(*) AS n, count(term) AS terminated, quantile_cont(term - filed, 0.5) FILTER (WHERE term >= filed) AS p50_days,
       count(*) FILTER (WHERE term >= filed) AS n_dur
FROM bkv GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_bk_judge AS
SELECT court_id, assigned_to_id AS pid, count(*) AS n, min(filed) AS first_filed, max(filed) AS last_filed,
       quantile_cont(term - filed, 0.5) FILTER (WHERE term >= filed) AS p50_days, count(*) FILTER (WHERE term >= filed) AS n_dur
FROM bkv WHERE assigned_to_id IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_bk_judge_name AS
SELECT court_id, assigned_to_str AS name, count(*) AS n FROM bkv WHERE assigned_to_id IS NULL AND assigned_to_str IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_bk_created AS
SELECT court_id, year(date_created) AS yr, count(*) AS n FROM bkv GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_bk_in_docket AS
SELECT b.court_id, count(d.id) AS in_docket, count(*) FILTER (WHERE d.court_id = b.court_id) AS same_court,
       count(*) FILTER (WHERE d.date_filed = b.raw_filed) AS same_filed, count(*) FILTER (WHERE d.date_terminated IS NOT DISTINCT FROM b.raw_term) AS same_term,
       count(*) FILTER (WHERE d.assigned_to_id IS NOT DISTINCT FROM b.assigned_to_id) AS same_judge
FROM bkv b LEFT JOIN (SELECT id, court_id, date_filed, date_terminated, assigned_to_id FROM dk.docket) d ON d.id = b.id GROUP BY 1;
CREATE OR REPLACE TABLE r_bk_docket_total AS
SELECT court_id, count(*) AS n, count(*) FILTER (WHERE date_filed <= {HI_BK}) AS filed_by_file_date
FROM dk.docket WHERE court_id IN (SELECT DISTINCT court_id FROM bk.bankruptcy) GROUP BY 1"""

# --- oral arguments (2026-09-30) ---------------------------------------------------------------------------------------
STEPS["oa"] = f"""
CREATE OR REPLACE TEMP VIEW oav AS
SELECT o.id, o.docket_id, o.source, CASE WHEN o.duration > 0 THEN o.duration END AS secs, o.duration AS raw_secs, o.has_transcript, o.stt_status, o.judges,
       {ok('o.date_created')} AS created, d.court_id, {ok('d.date_argued')} AS argued, d.date_argued AS raw_argued
FROM oa.oral_argument o LEFT JOIN (SELECT id, court_id, date_argued FROM dk.docket) d ON d.id = o.docket_id;
CREATE OR REPLACE TABLE r_oa_court AS
SELECT court_id, count(*) AS n, count(DISTINCT docket_id) AS dockets, count(argued) AS with_argued, count(raw_argued) - count(argued) AS implausible_argued,
       min(argued) AS first_argued, max(argued) AS last_argued, count(secs) AS with_duration, sum(secs) AS total_secs,
       count(*) FILTER (WHERE has_transcript) AS with_transcript, count(judges) AS with_judges, min(created) AS first_created, max(created) AS last_created,
       count(*) FILTER (WHERE source = 'C') AS src_c, count(*) FILTER (WHERE source = 'H') AS src_h
FROM oav GROUP BY 1;
CREATE OR REPLACE TABLE r_oa_dur AS
SELECT court_id, count(*) AS n, {Q.format(x='secs')} AS q, max(secs) AS max_secs FROM oav WHERE secs IS NOT NULL GROUP BY 1;
CREATE OR REPLACE TABLE r_oa_year AS
SELECT court_id, year(argued) AS yr, count(*) AS n, quantile_cont(secs, 0.5) AS p50_secs, sum(secs) AS total_secs, count(secs) AS with_duration,
       count(*) FILTER (WHERE has_transcript) AS with_transcript
FROM oav WHERE argued IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_oa_stt AS
SELECT court_id, stt_status, count(*) AS n FROM oav GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_oa_name AS
WITH t AS (
  SELECT court_id, argued, secs, trim(regexp_replace(regexp_replace(tok, '^[[:space:]]*and[[:space:]]+', '', 'i'), '[[:space:]]+', ' ', 'g')) AS name
  FROM (SELECT court_id, argued, secs, unnest(regexp_split_to_array(judges, '[[:space:]]*(,|;|&|[[:space:]]and[[:space:]])[[:space:]]*')) AS tok FROM oav WHERE judges IS NOT NULL)
), f AS (SELECT *, lower(name) AS key FROM t WHERE length(name) >= 2 AND name NOT ILIKE 'and'),
sp AS (SELECT court_id, key, name, count(*) AS k FROM f GROUP BY 1, 2, 3),
pick AS (SELECT court_id, key, first(name ORDER BY k DESC, name) AS name FROM sp GROUP BY 1, 2)
SELECT f.court_id, f.key, p.name, count(*) AS n, quantile_cont(f.secs, 0.5) AS p50_secs, min(year(f.argued)) AS first_yr, max(year(f.argued)) AS last_yr
FROM f JOIN pick p ON p.court_id IS NOT DISTINCT FROM f.court_id AND p.key = f.key GROUP BY 1, 2, 3"""

# --- originating-court information on appellate dockets (2026-09-30) -------------------------------------------------------
STEPS["oc"] = f"""
CREATE OR REPLACE TEMP VIEW ocv AS
SELECT d.id, d.court_id, d.appeal_from_id AS from_court, {ok('d.date_filed')} AS app_filed, {ok('d.date_terminated')} AS app_term,
       TRY_CAST(o.assigned_to_id AS BIGINT) AS lower_judge, o.assigned_to_str AS lower_judge_str, TRY_CAST(o.ordering_judge_id AS BIGINT) AS ordering_judge,
       {ok('TRY_CAST(substr(o.date_filed, 1, 10) AS DATE)')} AS low_filed, {ok('TRY_CAST(substr(o.date_judgment, 1, 10) AS DATE)')} AS judgment,
       {ok('TRY_CAST(substr(o.date_judgment_eod, 1, 10) AS DATE)')} AS judgment_eod, {ok('TRY_CAST(substr(o.date_filed_noa, 1, 10) AS DATE)')} AS noa,
       {ok('TRY_CAST(substr(o.date_received_coa, 1, 10) AS DATE)')} AS received, {ok('TRY_CAST(substr(o.date_disposed, 1, 10) AS DATE)')} AS disposed
FROM (SELECT id, court_id, appeal_from_id, date_filed, date_terminated, originating_court_information_id FROM dk.docket WHERE originating_court_information_id IS NOT NULL) d
JOIN sm.originating_court o ON TRY_CAST(o.id AS BIGINT) = d.originating_court_information_id;
CREATE OR REPLACE TEMP TABLE r_oc_base AS SELECT * FROM ocv;
CREATE OR REPLACE TABLE r_oc_court AS
SELECT court_id, count(*) AS n, count(from_court) AS with_from, count(lower_judge) AS with_judge_id,
       count(*) FILTER (WHERE lower_judge IS NULL AND lower_judge_str IS NOT NULL) AS judge_name_only, count(ordering_judge) AS with_ordering_id,
       count(low_filed) AS with_low_filed, count(judgment) AS with_judgment, count(noa) AS with_noa, count(received) AS with_received,
       count(app_filed) AS with_app_filed, count(app_term) AS with_app_term, min(app_filed) AS first_filed, max(app_filed) AS last_filed
FROM r_oc_base GROUP BY 1;
CREATE OR REPLACE TABLE r_oc_int AS
WITH iv AS (
  SELECT court_id, 'low_filed_to_judgment' AS k, judgment - low_filed AS days FROM r_oc_base WHERE judgment IS NOT NULL AND low_filed IS NOT NULL
  UNION ALL SELECT court_id, 'judgment_to_noa', noa - judgment FROM r_oc_base WHERE noa IS NOT NULL AND judgment IS NOT NULL
  UNION ALL SELECT court_id, 'noa_to_received', received - noa FROM r_oc_base WHERE received IS NOT NULL AND noa IS NOT NULL
  UNION ALL SELECT court_id, 'app_filed_to_term', app_term - app_filed FROM r_oc_base WHERE app_term IS NOT NULL AND app_filed IS NOT NULL
  UNION ALL SELECT court_id, 'judgment_to_app_term', app_term - judgment FROM r_oc_base WHERE app_term IS NOT NULL AND judgment IS NOT NULL
)
SELECT court_id, k, count(*) FILTER (WHERE days >= 0) AS n, count(*) FILTER (WHERE days < 0) AS negative,
       quantile_cont(days, [0.25, 0.5, 0.75, 0.9]) FILTER (WHERE days >= 0) AS q
FROM iv GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_oc_year AS
SELECT court_id, year(app_filed) AS yr, count(*) AS n, count(app_term) AS terminated,
       quantile_cont(app_term - app_filed, 0.5) FILTER (WHERE app_term >= app_filed) AS p50_days, count(*) FILTER (WHERE app_term >= app_filed) AS n_dur,
       quantile_cont(noa - judgment, 0.5) FILTER (WHERE noa >= judgment) AS p50_noa_days, count(*) FILTER (WHERE noa >= judgment) AS n_noa
FROM r_oc_base WHERE app_filed IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_oc_from AS
SELECT court_id, from_court, count(*) AS n, quantile_cont(app_term - app_filed, 0.5) FILTER (WHERE app_term >= app_filed) AS p50_days,
       count(*) FILTER (WHERE app_term >= app_filed) AS n_dur
FROM r_oc_base WHERE from_court IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_oc_judge AS
WITH fc AS (SELECT court_id, lower_judge AS pid, from_court, count(*) AS k FROM r_oc_base WHERE lower_judge IS NOT NULL AND from_court IS NOT NULL GROUP BY 1, 2, 3),
pk AS (SELECT court_id, pid, first(from_court ORDER BY k DESC, from_court) AS main_from FROM fc GROUP BY 1, 2)
SELECT b.court_id, b.lower_judge AS pid, count(*) AS n, min(b.app_filed) AS first_filed, max(b.app_filed) AS last_filed, pk.main_from
FROM r_oc_base b LEFT JOIN pk ON pk.court_id = b.court_id AND pk.pid = b.lower_judge WHERE b.lower_judge IS NOT NULL GROUP BY 1, 2, pk.main_from;
CREATE OR REPLACE TABLE r_oc_dockets AS
SELECT court_id, count(*) AS dockets FROM dk.docket WHERE court_id IN (SELECT DISTINCT court_id FROM r_oc_base) GROUP BY 1"""

# --- appellate panels (cluster panel table, 2026-09-30) -------------------------------------------------------------------
STEPS["pn"] = """
CREATE OR REPLACE TABLE r_pn_base AS
SELECT DISTINCT TRY_CAST(p.opinioncluster_id AS BIGINT) AS cid, TRY_CAST(p.person_id AS BIGINT) AS pid, j.court_id, j.filed,
       coalesce(j.blocked, false) OR coalesce(j.docket_blocked, false) AS blocked
FROM sm.cluster_panel p LEFT JOIN wk.w_cj j ON j.cid = TRY_CAST(p.opinioncluster_id AS BIGINT);
CREATE OR REPLACE TABLE r_pn_size AS
SELECT cid, court_id, filed, count(*) AS size FROM r_pn_base GROUP BY 1, 2, 3;
CREATE OR REPLACE TABLE r_pn_court AS
SELECT s.court_id, count(*) AS clusters, count(s.filed) AS dated, min(s.filed) AS first_filed, max(s.filed) AS last_filed,
       quantile_cont(s.size, 0.5) AS p50_size, sum(s.size) AS seats, c.clusters AS court_clusters
FROM r_pn_size s LEFT JOIN (SELECT court_id, count(*) AS clusters FROM wk.w_cj GROUP BY 1) c ON c.court_id = s.court_id GROUP BY s.court_id, c.clusters;
CREATE OR REPLACE TABLE r_pn_sizes AS SELECT court_id, size, count(*) AS n FROM r_pn_size GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_pn_year AS
SELECT court_id, year(filed) AS yr, count(*) AS clusters, quantile_cont(size, 0.5) AS p50_size, count(*) FILTER (WHERE size >= 4) AS size4plus
FROM r_pn_size WHERE filed IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_pn_judge AS
SELECT court_id, pid, count(*) AS n, min(filed) AS first_filed, max(filed) AS last_filed FROM r_pn_base GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_pn_pair AS
SELECT a.court_id, a.pid AS p1, b.pid AS p2, count(*) AS n, min(a.filed) AS first_filed, max(a.filed) AS last_filed
FROM r_pn_base a JOIN r_pn_base b ON a.cid = b.cid AND a.pid < b.pid GROUP BY 1, 2, 3;
CREATE OR REPLACE TABLE r_pn_person_year AS
SELECT pid, year(filed) AS yr, count(*) AS n FROM r_pn_base WHERE filed IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_jb AS
SELECT TRY_CAST(j.person_id AS BIGINT) AS pid, count(*) AS n, count(DISTINCT j.opinion_id) AS opinions FROM sm.opinion_joined_by j GROUP BY 1"""

# --- unmatched citations (2026-09-30) ---------------------------------------------------------------------------------------
STEPS["um"] = """
CREATE OR REPLACE TEMP TABLE r_um_base AS
SELECT u.reporter, u.type, u.status, u.citation_string AS cs, u.court_id AS cited_court, CASE WHEN u.year BETWEEN 1600 AND 2026 THEN u.year END AS cited_year,
       u.citing_opinion_id AS oid, o.cid, o.court_id AS citing_court, year(o.filed) AS citing_year
FROM um.unmatched_citation u LEFT JOIN (SELECT oid, cid, court_id, filed FROM wk.w_op) o ON o.oid = u.citing_opinion_id;
CREATE OR REPLACE TABLE r_um_total AS
SELECT status, type, count(*) AS n, count(DISTINCT oid) AS opinions, count(oid) FILTER (WHERE cid IS NULL) AS citing_not_in_opinion_table FROM r_um_base GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_um_rep AS
WITH ty AS (SELECT reporter, type, count(*) AS k FROM r_um_base GROUP BY 1, 2),
tp AS (SELECT reporter, first(type ORDER BY k DESC, type) AS type, count(*) AS types FROM ty GROUP BY 1)
SELECT b.reporter, count(*) AS n, count(DISTINCT b.cs) AS strings, count(DISTINCT b.oid) AS opinions, tp.type, tp.types,
       count(*) FILTER (WHERE b.status = 1) AS s1, count(*) FILTER (WHERE b.status = 2) AS s2, count(*) FILTER (WHERE b.status = 3) AS s3,
       count(*) FILTER (WHERE b.status = 4) AS s4, count(*) FILTER (WHERE b.status = 5) AS s5,
       count(b.citing_court) AS with_citing_court, min(b.citing_year) AS first_citing_year, max(b.citing_year) AS last_citing_year
FROM r_um_base b JOIN tp ON tp.reporter IS NOT DISTINCT FROM b.reporter GROUP BY 1, tp.type, tp.types;
CREATE OR REPLACE TABLE r_um_rep_top AS
WITH g AS (SELECT reporter, cs, count(*) AS n FROM r_um_base GROUP BY 1, 2),
t AS (SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY reporter ORDER BY n DESC, cs) AS rn FROM g) WHERE rn <= 10),
s AS (SELECT b.reporter, b.cs, b.status, count(*) AS k FROM r_um_base b JOIN t ON t.reporter IS NOT DISTINCT FROM b.reporter AND t.cs = b.cs GROUP BY 1, 2, 3),
sp AS (SELECT reporter, cs, first(status ORDER BY k DESC, status) AS status, count(*) AS statuses FROM s GROUP BY 1, 2)
SELECT t.reporter, t.cs, t.n, sp.status, sp.statuses, t.rn FROM t JOIN sp ON sp.reporter IS NOT DISTINCT FROM t.reporter AND sp.cs = t.cs;
CREATE OR REPLACE TABLE r_um_rep_court AS
SELECT * FROM (SELECT reporter, citing_court, count(*) AS n, row_number() OVER (PARTITION BY reporter ORDER BY count(*) DESC, citing_court) AS rn
               FROM r_um_base WHERE citing_court IS NOT NULL GROUP BY 1, 2) WHERE rn <= 8;
CREATE OR REPLACE TABLE r_um_rep_decade AS
SELECT reporter, citing_year // 10 * 10 AS decade, count(*) AS n FROM r_um_base WHERE citing_year IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_um_court AS
SELECT citing_court AS court_id, count(*) AS n, count(DISTINCT cs) AS strings, count(DISTINCT oid) AS opinions,
       count(*) FILTER (WHERE status = 1) AS s1, count(*) FILTER (WHERE status = 2) AS s2, count(*) FILTER (WHERE status = 3) AS s3,
       count(*) FILTER (WHERE status = 4) AS s4, count(*) FILTER (WHERE status = 5) AS s5
FROM r_um_base WHERE citing_court IS NOT NULL GROUP BY 1;
CREATE OR REPLACE TABLE r_um_court_rep AS
SELECT * FROM (SELECT citing_court AS court_id, reporter, count(*) AS n, row_number() OVER (PARTITION BY citing_court ORDER BY count(*) DESC, reporter) AS rn
               FROM r_um_base WHERE citing_court IS NOT NULL GROUP BY 1, 2) WHERE rn <= 10;
CREATE OR REPLACE TABLE r_um_court_type AS
SELECT citing_court AS court_id, type, count(*) AS n FROM r_um_base WHERE citing_court IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_um_court_year AS
SELECT citing_court AS court_id, citing_year AS yr, count(*) AS n, count(DISTINCT oid) AS opinions FROM r_um_base WHERE citing_court IS NOT NULL AND citing_year IS NOT NULL GROUP BY 1, 2;
CREATE OR REPLACE TABLE r_um_court_ops AS
SELECT court_id, count(*) AS opinions FROM wk.w_op WHERE court_id IN (SELECT DISTINCT citing_court FROM r_um_base) GROUP BY 1;
CREATE OR REPLACE TABLE r_um_cited_court AS
SELECT cited_court, count(*) AS n FROM r_um_base GROUP BY 1;
CREATE OR REPLACE TABLE r_um_year AS
SELECT citing_year AS yr, count(*) AS n, count(DISTINCT oid) AS opinions FROM r_um_base GROUP BY 1;
DROP TABLE r_um_base"""  # temp tables keep the work file small

ORDER = ["bk", "oa", "oc", "pn", "um"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", default=",".join(ORDER))
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list:
        print("steps:", ", ".join(ORDER))
        return 0
    con = connect()
    for name in a.steps.split(","):
        sql = STEPS[name]
        t0 = time.time()
        for stmt in [s for s in sql.split(";\n") if s.strip()]:
            con.execute(stmt)
        tables = [t for t in re.findall(r"CREATE OR REPLACE TABLE (\w+)", sql) if not re.search(rf"DROP TABLE {t}\b", sql)]
        counts = {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in tables}
        print(f"[{name}] {time.time() - t0:,.1f}s {counts}", flush=True)
    con.execute("CHECKPOINT")
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
