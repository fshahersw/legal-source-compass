"""Aggregations over the official FJC IDB civil file (private/acq/fjc_idb/fjc_civil.duckdb).

Conventions (from the codebook):
* A case belongs to the statistical (fiscal) year of its FDATEUSE (filing) or TDATEUSE (termination), the dates the AO used in
  its published tables; fiscal years run 1 October - 30 September and are labelled by the year they end.
* Pending records carry termination date 1900-01-01 (status S / tape year 2099): they are open, not terminated.
* Days to termination = TERMDATE - FILEDATE for terminated cases with TERMDATE >= FILEDATE; other pairs are counted in
  data_quality and excluded from durations.
* -8 and blanks are missing; missing is never counted as a category.
Everything here is plain SQL so the numbers can be re-derived from the raw file with the stated rules.
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import duckdb  # noqa: E402

import idb_codes as ic  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "fjc_idb", "fjc_civil.duckdb")
CODEBOOK = os.path.join(ROOT, "private", "acq", "courtlistener", "idb_civil_codebook_1988_forward.txt")

from idb_codes import GROUP_LABEL, NOS_GROUPS, NOS_TO_GROUP  # noqa: E402,F401


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(DB, read_only=True)
    spill = os.path.join(ROOT, "private", "scratch", "duck_tmp")
    os.makedirs(spill, exist_ok=True)
    con.execute("PRAGMA threads=3")
    con.execute("PRAGMA memory_limit='3GB'")  # other jobs share this 15 GB machine; larger work spills to disk
    con.execute(f"PRAGMA temp_directory='{spill}'")
    return con


def prepare(con: duckdb.DuckDBPyConnection) -> dict:
    """Create the temp tables `dist`, `nosg` and the derived `cv` table; return the code tables."""
    text = open(CODEBOOK).read()
    nos = ic.parse_nos(text)
    labels = ic.parse_districts(text)
    rows = []
    for code, label in labels.items():
        cid = ic.court_id_for(label)
        state = label.split(" - ")[0]
        rows.append((code, cid, label, ic.USPS[state].upper() if ic.USPS[state] != "nmi" else "MP"))
    con.execute("CREATE TEMP TABLE dist(district VARCHAR, court_id VARCHAR, label VARCHAR, state VARCHAR)")
    con.executemany("INSERT INTO dist VALUES (?, ?, ?, ?)", rows)
    con.execute("CREATE TEMP TABLE nosg(nos INTEGER, grp VARCHAR)")
    con.executemany("INSERT INTO nosg VALUES (?, ?)", sorted(NOS_TO_GROUP.items()))
    con.execute(
        """
        CREATE TEMP TABLE cv AS
        SELECT d.court_id, d.state, c.district,
               (c.statuscd = 'S' OR c.tapeyear = 2099) AS pending,
               c.filedate, c.termdate,
               year(c.fdateuse) + CASE WHEN month(c.fdateuse) >= 10 THEN 1 ELSE 0 END AS fy_f,
               CASE WHEN c.statuscd = 'S' OR c.tapeyear = 2099 THEN NULL
                    ELSE year(c.tdateuse) + CASE WHEN month(c.tdateuse) >= 10 THEN 1 ELSE 0 END END AS fy_t,
               CASE WHEN NOT (c.statuscd = 'S' OR c.tapeyear = 2099) AND c.termdate >= c.filedate
                         AND c.termdate > DATE '1900-01-01' THEN date_diff('day', c.filedate, c.termdate) END AS days,
               c.nos, coalesce(g.grp, 'unmapped') AS grp, c.origin, c.juris, c.jury, c.classact, c.demanded,
               c.mdldock, c.plt, c.def, c.procprog, c.disp, c.noj, c.judgment, c.amtrec, c.prose, c.ifp, c.trclact
        FROM civil c
        JOIN dist d ON d.district = c.district
        LEFT JOIN nosg g ON g.nos = c.nos
        """
    )
    return {"nos": nos, "districts": labels}


def quality(con: duckdb.DuckDBPyConnection) -> dict:
    q = lambda s: con.execute(s).fetchone()
    return {
        "rows": q("SELECT count(*) FROM cv")[0],
        "pending": q("SELECT count(*) FROM cv WHERE pending")[0],
        "terminated": q("SELECT count(*) FROM cv WHERE NOT pending")[0],
        "terminated_with_valid_duration": q("SELECT count(*) FROM cv WHERE days IS NOT NULL")[0],
        "terminated_before_filed": q("SELECT count(*) FROM cv WHERE NOT pending AND termdate < filedate")[0],
        "missing_nos": q("SELECT count(*) FROM cv WHERE nos IS NULL")[0],
        "unmapped_nos_rows": q("SELECT count(*) FROM cv WHERE grp = 'unmapped'")[0],
        "missing_disp_terminated": q("SELECT count(*) FROM cv WHERE NOT pending AND disp IS NULL")[0],
        "fy_filed_range": list(q("SELECT min(fy_f), max(fy_f) FROM cv")),
        "fy_terminated_range": list(q("SELECT min(fy_t), max(fy_t) FROM cv")),
        "rows_dropped_unknown_district": q("SELECT (SELECT count(*) FROM civil) - (SELECT count(*) FROM cv)")[0],
    }


def run(con: duckdb.DuckDBPyConnection, scope: str) -> dict:
    """Aggregate by `scope` in {'court_id', 'state', 'us'}: per-FY filings, terminations, pending, durations, mixes."""
    key = {"court_id": "court_id", "state": "state", "us": "'US'", "nos": "CAST(nos AS VARCHAR)", "grp": "grp"}[scope]
    out: dict = {}

    def table(sql: str, cols: list[str]) -> list[dict]:
        return [dict(zip(cols, r)) for r in con.execute(sql).fetchall()]

    # filings by FY (AO filing year) with the case-mix counts
    out["filed"] = table(
        f"""
        SELECT {key} AS k, fy_f AS fy, count(*) AS filings,
               count(*) FILTER (WHERE classact = 1) AS class_action,
               count(*) FILTER (WHERE prose IN (1, 3)) AS pro_se_plaintiff,
               count(*) FILTER (WHERE prose IS NOT NULL) AS pro_se_known,
               count(*) FILTER (WHERE ifp = 'FP') AS ifp,
               count(*) FILTER (WHERE origin = 2) AS removed,
               count(*) FILTER (WHERE origin = 6) AS mdl_transfer_in,
               count(*) FILTER (WHERE origin = 13) AS mdl_originating,
               count(*) FILTER (WHERE mdldock IS NOT NULL) AS with_mdl_number,
               count(*) FILTER (WHERE jury IN ('B', 'P', 'D')) AS jury_demanded,
               count(*) FILTER (WHERE jury IS NOT NULL) AS jury_known,
               count(*) FILTER (WHERE juris = 3) AS federal_question,
               count(*) FILTER (WHERE juris = 4) AS diversity,
               count(*) FILTER (WHERE juris IN (1, 2)) AS us_party,
               count(*) FILTER (WHERE grp = 'product') AS product,
               count(*) FILTER (WHERE demanded IS NOT NULL AND demanded > 0) AS demand_stated,
               median(demanded) FILTER (WHERE demanded IS NOT NULL AND demanded > 0) AS demand_median_thousands
        FROM cv WHERE fy_f IS NOT NULL AND fy_f >= 1988 GROUP BY 1, 2 ORDER BY 1, 2
        """,
        ["k", "fy", "filings", "class_action", "pro_se_plaintiff", "pro_se_known", "ifp", "removed", "mdl_transfer_in",
         "mdl_originating", "with_mdl_number", "jury_demanded", "jury_known", "federal_question", "diversity", "us_party",
         "product", "demand_stated", "demand_median_thousands"],
    )
    # terminations by FY with durations and dispositions
    out["terminated"] = table(
        f"""
        SELECT {key} AS k, fy_t AS fy, count(*) AS terminations,
               count(days) AS with_duration, median(days) AS median_days,
               quantile_cont(days, 0.25) AS p25_days, quantile_cont(days, 0.75) AS p75_days, quantile_cont(days, 0.9) AS p90_days,
               count(*) FILTER (WHERE disp IN (0, 1, 10, 11)) AS transferred_remanded,
               count(*) FILTER (WHERE disp IN (2, 3, 12, 13, 14)) AS dismissed,
               count(*) FILTER (WHERE disp = 13) AS settled,
               count(*) FILTER (WHERE disp = 12) AS voluntary,
               count(*) FILTER (WHERE disp IN (4, 5, 6, 7, 8, 9, 15, 16, 17, 18, 19, 20)) AS judgment,
               count(*) FILTER (WHERE disp = 4) AS default_judgment,
               count(*) FILTER (WHERE disp = 5) AS consent_judgment,
               count(*) FILTER (WHERE disp = 6) AS motion_judgment,
               count(*) FILTER (WHERE disp IN (7, 8, 9)) AS trial_judgment,
               count(*) FILTER (WHERE disp = 7) AS jury_verdict,
               count(*) FILTER (WHERE disp = 9) AS court_trial,
               count(*) FILTER (WHERE disp IS NULL) AS disposition_missing,
               count(*) FILTER (WHERE procprog IN (7, 9)) AS jury_trial_progress,
               count(*) FILTER (WHERE procprog IN (6, 8)) AS court_trial_progress,
               count(*) FILTER (WHERE judgment = 1) AS judgment_plaintiff,
               count(*) FILTER (WHERE judgment = 2) AS judgment_defendant,
               median(days) FILTER (WHERE disp IN (7, 9) AND days IS NOT NULL) AS median_days_trial
        FROM cv WHERE fy_t IS NOT NULL AND fy_t >= 1988 GROUP BY 1, 2 ORDER BY 1, 2
        """,
        ["k", "fy", "terminations", "with_duration", "median_days", "p25_days", "p75_days", "p90_days", "transferred_remanded",
         "dismissed", "settled", "voluntary", "judgment", "default_judgment", "consent_judgment", "motion_judgment",
         "trial_judgment", "jury_verdict", "court_trial", "disposition_missing", "jury_trial_progress", "court_trial_progress",
         "judgment_plaintiff", "judgment_defendant", "median_days_trial"],
    )
    # pending at the end of each fiscal year: filed on/before the year-end and not yet terminated then
    out["pending"] = table(
        f"""
        WITH fy AS (SELECT range AS y FROM range(1988, 2027)),
        f AS (SELECT {key} AS k, fy_f, count(*) AS n FROM cv WHERE fy_f IS NOT NULL GROUP BY 1, 2),
        t AS (SELECT {key} AS k, fy_t, count(*) AS n FROM cv WHERE fy_t IS NOT NULL GROUP BY 1, 2),
        ks AS (SELECT DISTINCT {key} AS k FROM cv)
        SELECT ks.k AS k, fy.y AS fy,
               coalesce((SELECT sum(n) FROM f WHERE f.k = ks.k AND f.fy_f <= fy.y), 0)
             - coalesce((SELECT sum(n) FROM t WHERE t.k = ks.k AND t.fy_t <= fy.y), 0) AS pending
        FROM ks CROSS JOIN fy ORDER BY 1, 2
        """,
        ["k", "fy", "pending"],
    )
    return out


WINDOW = (2021, 2025)  # last five complete fiscal years


def window_mix(con: duckdb.DuckDBPyConnection, key: str, lo: int = WINDOW[0], hi: int = WINDOW[1]) -> dict:
    """Per-key mixes over fiscal years lo..hi: filings by NOS group and top NOS codes, terminations by disposition and group."""
    def table(sql: str, cols: list[str]) -> list[dict]:
        return [dict(zip(cols, r)) for r in con.execute(sql).fetchall()]

    return {
        "filed_groups": table(
            f"SELECT {key} AS k, grp, count(*) AS n FROM cv WHERE fy_f BETWEEN {lo} AND {hi} GROUP BY 1, 2 ORDER BY 1, 3 DESC",
            ["k", "grp", "n"]),
        "filed_nos": table(
            f"""SELECT k, nos, n FROM (SELECT {key} AS k, nos, count(*) AS n,
                       row_number() OVER (PARTITION BY {key} ORDER BY count(*) DESC, nos) AS r
                FROM cv WHERE fy_f BETWEEN {lo} AND {hi} AND nos IS NOT NULL GROUP BY 1, 2) WHERE r <= 8 ORDER BY k, n DESC""",
            ["k", "nos", "n"]),
        "filed_juris": table(
            f"SELECT {key} AS k, juris, count(*) AS n FROM cv WHERE fy_f BETWEEN {lo} AND {hi} AND juris IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 3 DESC",
            ["k", "juris", "n"]),
        "filed_origin": table(
            f"SELECT {key} AS k, origin, count(*) AS n FROM cv WHERE fy_f BETWEEN {lo} AND {hi} AND origin IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 3 DESC",
            ["k", "origin", "n"]),
        "term_groups": table(
            f"""SELECT {key} AS k, grp, count(*) AS n, count(days) AS with_days, median(days) AS median_days,
                       count(*) FILTER (WHERE disp = 13) AS settled, count(*) FILTER (WHERE disp IN (7, 8, 9)) AS trial_judgment
                FROM cv WHERE fy_t BETWEEN {lo} AND {hi} GROUP BY 1, 2 ORDER BY 1, 3 DESC""",
            ["k", "grp", "n", "with_days", "median_days", "settled", "trial_judgment"]),
        "term_disp": table(
            f"SELECT {key} AS k, disp, count(*) AS n FROM cv WHERE fy_t BETWEEN {lo} AND {hi} AND disp IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 3 DESC",
            ["k", "disp", "n"]),
        "term_procprog": table(
            f"SELECT {key} AS k, procprog, count(*) AS n FROM cv WHERE fy_t BETWEEN {lo} AND {hi} AND procprog IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 3 DESC",
            ["k", "procprog", "n"]),
        "term_judgment": table(
            f"SELECT {key} AS k, judgment, count(*) AS n, median(amtrec) FILTER (WHERE amtrec > 0) AS median_amtrec_thousands FROM cv "
            f"WHERE fy_t BETWEEN {lo} AND {hi} AND judgment IN (1, 2, 3) AND disp IN (4, 5, 6, 7, 8, 9) GROUP BY 1, 2 ORDER BY 1, 3 DESC",
            ["k", "judgment", "n", "median_amtrec_thousands"]),
    }


def mdl_cases(con: duckdb.DuckDBPyConnection) -> dict:
    """Cases carrying an MDL docket number (MDLDOCK): the FJC IDB association, a historical record, not current membership."""
    def table(sql: str, cols: list[str]) -> list[dict]:
        return [dict(zip(cols, r)) for r in con.execute(sql).fetchall()]

    base = "FROM cv WHERE mdldock IS NOT NULL AND regexp_matches(mdldock, '^[0-9]{1,4}$')"
    return {
        "totals": table(
            f"""SELECT CAST(mdldock AS INTEGER) AS mdl, count(*) AS cases, count(*) FILTER (WHERE pending) AS pending,
                       min(filedate) AS first_filed, max(filedate) AS last_filed, count(DISTINCT court_id) AS districts,
                       count(*) FILTER (WHERE origin = 6) AS transferred_in, count(*) FILTER (WHERE origin = 13) AS originating,
                       median(days) AS median_days, count(days) AS with_days,
                       count(*) FILTER (WHERE disp = 13) AS settled, count(*) FILTER (WHERE disp = 10) AS mdl_transfer_out,
                       count(*) FILTER (WHERE disp IN (2, 3, 12, 14)) AS dismissed_other, count(*) FILTER (WHERE disp IN (7, 8, 9)) AS trial,
                       count(*) FILTER (WHERE classact = 1) AS class_action
                {base} GROUP BY 1 ORDER BY 1""",
            ["mdl", "cases", "pending", "first_filed", "last_filed", "districts", "transferred_in", "originating", "median_days",
             "with_days", "settled", "mdl_transfer_out", "dismissed_other", "trial", "class_action"]),
        "by_fy": table(
            f"SELECT CAST(mdldock AS INTEGER) AS mdl, fy_f AS fy, count(*) AS n {base} AND fy_f >= 1988 GROUP BY 1, 2 ORDER BY 1, 2",
            ["mdl", "fy", "n"]),
        "by_district": table(
            f"""SELECT mdl, court_id, n FROM (SELECT CAST(mdldock AS INTEGER) AS mdl, court_id, count(*) AS n,
                       row_number() OVER (PARTITION BY CAST(mdldock AS INTEGER) ORDER BY count(*) DESC, court_id) AS r
                {base} GROUP BY 1, 2) WHERE r <= 12 ORDER BY mdl, n DESC""",
            ["mdl", "court_id", "n"]),
        "by_nos": table(
            f"""SELECT mdl, nos, n FROM (SELECT CAST(mdldock AS INTEGER) AS mdl, nos, count(*) AS n,
                       row_number() OVER (PARTITION BY CAST(mdldock AS INTEGER) ORDER BY count(*) DESC, nos) AS r
                {base} AND nos IS NOT NULL GROUP BY 1, 2) WHERE r <= 3 ORDER BY mdl, n DESC""",
            ["mdl", "nos", "n"]),
        "defendants": table(
            f"""SELECT mdl, def, n FROM (SELECT CAST(mdldock AS INTEGER) AS mdl, upper(trim(def)) AS def, count(*) AS n,
                       row_number() OVER (PARTITION BY CAST(mdldock AS INTEGER) ORDER BY count(*) DESC, upper(trim(def))) AS r
                {base} AND def IS NOT NULL GROUP BY 1, 2) WHERE r <= 3 ORDER BY mdl, n DESC""",
            ["mdl", "def", "n"]),
        "non_numeric": con.execute(
            "SELECT count(*), count(DISTINCT mdldock) FROM cv WHERE mdldock IS NOT NULL AND NOT regexp_matches(mdldock, '^[0-9]{1,4}$')"
        ).fetchone(),
    }
