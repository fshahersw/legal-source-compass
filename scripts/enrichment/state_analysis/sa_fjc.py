"""FJC Integrated Database (civil, 1988 forward) aggregations by county of residence and by district.

Reads the typed DuckDB copy of the official file (private/acq/fjc_idb/fjc_civil.duckdb, built unchanged from
https://www.fjc.gov/sites/default/files/idb/textfiles/cv88on.zip by scripts/enrichment/fjc_idb/load_civil.py), read-only.

Codebook rules applied (private/acq/courtlistener/idb_civil_codebook_1988_forward.txt, "COUNTY OF RESIDENCE"):
  * COUNTY is the county of residence of the first listed plaintiff; when the United States is plaintiff it is the first
    listed defendant's county; land condemnation cases carry the tract's county.
  * 88888 = a residence in the U.S. but outside the district's home state; 99999 = outside the U.S.
  * Other codes are taken as 5-digit county FIPS codes only when they are a current county of the same state as the filing
    district; anything else is reported as "code not matched to a current county" (never re-assigned).
  * A case belongs to the fiscal year (1 Oct - 30 Sep, labelled by its end) of FDATEUSE, as the FJC/AO tables do.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "fjc_idb"))

import duckdb  # noqa: E402

import idb_codes as ic  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "fjc_idb", "fjc_civil.duckdb")
CODEBOOK = os.path.join(ROOT, "private", "acq", "courtlistener", "idb_civil_codebook_1988_forward.txt")
IDB_URL = "https://www.fjc.gov/sites/default/files/idb/textfiles/cv88on.zip"
IDB_PAGE = "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present"
FY_SERIES = list(range(2016, 2026))  # FY2016-FY2025: complete fiscal years
FY_WINDOW = (2021, 2025)  # the five-year window used for rates
PRISONER = sorted(next(codes for key, _, codes in ic.NOS_GROUPS if key == "prisoner"))
# "Core" filings: no prisoner petitions, no MDL-numbered cases, no U.S.-plaintiff cases (one definition for every query).
CORE_SQL = "NOT v.prisoner AND NOT v.mdl AND coalesce(v.juris, 0) <> 1"
# Bumped whenever county_counts gains or changes an output, so the build cache recomputes.
COUNTS_VERSION = "nos_core-v1"


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(DB, read_only=True)
    spill = os.path.join(ROOT, "private", "scratch", "enrich", "state_analysis", "duck_tmp")
    os.makedirs(spill, exist_ok=True)
    con.execute("PRAGMA threads=2")
    con.execute("PRAGMA memory_limit='2GB'")
    con.execute(f"PRAGMA temp_directory='{spill}'")
    return con


def district_table() -> list[tuple[str, str | None, str, str | None]]:
    """(FJC district code, court id, codebook label, USPS) from the codebook's DISTRICT section."""
    text = open(CODEBOOK).read()
    rows = []
    for code, label in ic.parse_districts(text).items():
        state = label.split(" - ")[0]
        usps = ic.USPS.get(state)
        rows.append((code, ic.court_id_for(label), label, usps.upper() if usps and usps != "nmi" else None))
    return rows


# FIPS codes the Census Bureau replaced for the same territory when a county was renamed (county-changes list,
# https://www.census.gov/programs-surveys/geography/technical-documentation/county-changes.html). Splits and merges are not recoded.
RECODE = {"12025": "12086", "46113": "46102"}


def prepare(con: duckdb.DuckDBPyConnection, county_state: dict[str, str]) -> None:
    """Temp tables: dist (district code -> court id, state), cty (current county fips -> USPS), cv (filings with FY and flags)."""
    con.execute("CREATE OR REPLACE TEMP TABLE dist(district VARCHAR, court_id VARCHAR, label VARCHAR, usps VARCHAR)")
    con.executemany("INSERT INTO dist VALUES (?, ?, ?, ?)", district_table())
    con.execute("CREATE OR REPLACE TEMP TABLE recode(old VARCHAR, new VARCHAR)")
    con.executemany("INSERT INTO recode VALUES (?, ?)", sorted(RECODE.items()))
    con.execute("CREATE OR REPLACE TEMP TABLE cty(fips VARCHAR, usps VARCHAR)")
    con.executemany("INSERT INTO cty VALUES (?, ?)", sorted(county_state.items()))
    pris = ",".join(str(n) for n in PRISONER)
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE cv AS
        SELECT d.court_id, d.usps AS dist_usps, coalesce(r.new, c.county) AS code,
               year(c.fdateuse) + CASE WHEN month(c.fdateuse) >= 10 THEN 1 ELSE 0 END AS fy,
               c.nos, c.juris, c.mdldock IS NOT NULL AS mdl, c.nos IN ({pris}) AS prisoner,
               c.classact = 1 AS classact, c.prose IN (1, 3) AS prose, c.prose IS NOT NULL AS prose_known,
               c.origin = 2 AS removed
        FROM civil c JOIN dist d ON d.district = c.district LEFT JOIN recode r ON r.old = c.county
        WHERE c.fdateuse IS NOT NULL
        """
    )


def county_counts(con: duckdb.DuckDBPyConnection) -> dict:
    """Per current county (same state as the filing district): filings by FY (all and core), NOS group mix and flags for the window."""
    lo, hi = FY_WINDOW
    q = f"""
        SELECT v.code, v.fy, count(*) AS n,
               count(*) FILTER (WHERE {CORE_SQL}) AS core
        FROM cv v JOIN cty t ON t.fips = v.code AND t.usps = v.dist_usps
        WHERE v.fy BETWEEN {FY_SERIES[0]} AND {FY_SERIES[-1]}
        GROUP BY 1, 2
    """
    out: dict[str, dict] = {}
    for code, fy, n, core in con.execute(q).fetchall():
        rec = out.setdefault(code, {"fy": {}, "core_fy": {}})
        rec["fy"][int(fy)] = int(n)
        rec["core_fy"][int(fy)] = int(core)
    q2 = f"""
        SELECT v.code, count(*) FILTER (WHERE v.prisoner) AS prisoner, count(*) FILTER (WHERE v.mdl) AS mdl,
               count(*) FILTER (WHERE v.juris = 1) AS us_plaintiff, count(*) FILTER (WHERE v.juris = 2) AS us_defendant,
               count(*) FILTER (WHERE v.juris = 3) AS federal_question, count(*) FILTER (WHERE v.juris = 4) AS diversity,
               count(*) FILTER (WHERE v.classact) AS class_action, count(*) FILTER (WHERE v.prose) AS pro_se,
               count(*) FILTER (WHERE v.prose_known) AS pro_se_known, count(*) FILTER (WHERE v.removed) AS removed
        FROM cv v JOIN cty t ON t.fips = v.code AND t.usps = v.dist_usps
        WHERE v.fy BETWEEN {lo} AND {hi}
        GROUP BY 1
    """
    cols = ["prisoner", "mdl", "us_plaintiff", "us_defendant", "federal_question", "diversity", "class_action", "pro_se", "pro_se_known", "removed"]
    for row in con.execute(q2).fetchall():
        out.setdefault(row[0], {"fy": {}, "core_fy": {}})["window"] = dict(zip(cols, (int(x) for x in row[1:])))
    # NOS groups in the window
    con.execute("CREATE OR REPLACE TEMP TABLE nosg(nos INTEGER, grp VARCHAR)")
    con.executemany("INSERT INTO nosg VALUES (?, ?)", sorted(ic.NOS_TO_GROUP.items()))
    q3 = f"""
        SELECT v.code, coalesce(g.grp, 'unmapped') AS grp, count(*)
        FROM cv v JOIN cty t ON t.fips = v.code AND t.usps = v.dist_usps LEFT JOIN nosg g ON g.nos = v.nos
        WHERE v.fy BETWEEN {lo} AND {hi}
        GROUP BY 1, 2
    """
    for code, grp, n in con.execute(q3).fetchall():
        out.setdefault(code, {"fy": {}, "core_fy": {}}).setdefault("nos", {})[grp] = int(n)
    # NOS groups among core filings only (no prisoner petitions, no MDL-numbered cases, no U.S.-plaintiff cases). The
    # IDB COUNTY of an MDL direct filing follows the court's or defendant's county, so only core filings speak to residence.
    q3c = f"""
        SELECT v.code, coalesce(g.grp, 'unmapped') AS grp, count(*)
        FROM cv v JOIN cty t ON t.fips = v.code AND t.usps = v.dist_usps LEFT JOIN nosg g ON g.nos = v.nos
        WHERE v.fy BETWEEN {lo} AND {hi} AND {CORE_SQL}
        GROUP BY 1, 2
    """
    for code, grp, n in con.execute(q3c).fetchall():
        out.setdefault(code, {"fy": {}, "core_fy": {}}).setdefault("nos_core", {})[grp] = int(n)
    # where residents filed: court id by county
    q4 = f"""
        SELECT v.code, v.court_id, count(*)
        FROM cv v JOIN cty t ON t.fips = v.code AND t.usps = v.dist_usps
        WHERE v.fy BETWEEN {lo} AND {hi}
        GROUP BY 1, 2
    """
    for code, court, n in con.execute(q4).fetchall():
        out.setdefault(code, {"fy": {}, "core_fy": {}}).setdefault("by_court", {})[court] = int(n)
    return out


def district_composition(con: duckdb.DuckDBPyConnection, county_district: dict[str, str], screened: list[str] | None = None) -> dict:
    """Per filing district, window FY counts by where the first plaintiff lives (codebook residence classes).

    Codes the builder screened out as not reflecting residence form their own class ('screened_code').
    """
    lo, hi = FY_WINDOW
    con.execute("CREATE OR REPLACE TEMP TABLE cdist(fips VARCHAR, court_id VARCHAR)")
    con.executemany("INSERT INTO cdist VALUES (?, ?)", sorted(county_district.items()))
    con.execute("CREATE OR REPLACE TEMP TABLE screened(fips VARCHAR)")
    if screened:
        con.executemany("INSERT INTO screened VALUES (?)", [(f,) for f in screened])
    q = f"""
        SELECT v.court_id,
          CASE WHEN v.code IS NULL THEN 'missing'
               WHEN v.code = '88888' THEN 'out_of_state'
               WHEN v.code = '99999' THEN 'outside_us'
               WHEN t.fips IS NULL THEN 'unmatched_code'
               WHEN v.code IN (SELECT fips FROM screened) THEN 'screened_code'
               WHEN cd.court_id = v.court_id THEN 'own_counties'
               WHEN cd.court_id IS NOT NULL THEN 'other_in_state'
               ELSE 'in_state_no_district' END AS cls,
          (v.prisoner OR v.mdl OR coalesce(v.juris, 0) = 1) AS excluded,
          count(*)
        FROM cv v
        LEFT JOIN cty t ON t.fips = v.code AND t.usps = v.dist_usps
        LEFT JOIN cdist cd ON cd.fips = v.code
        WHERE v.fy BETWEEN {lo} AND {hi}
        GROUP BY 1, 2, 3
    """
    out: dict[str, dict] = {}
    for court, cls, excluded, n in con.execute(q).fetchall():
        rec = out.setdefault(court, {"all": {}, "core": {}})
        rec["all"][cls] = rec["all"].get(cls, 0) + int(n)
        if not excluded:
            rec["core"][cls] = rec["core"].get(cls, 0) + int(n)
    q2 = f"""
        SELECT court_id, fy, count(*) FROM cv WHERE fy BETWEEN {FY_SERIES[0]} AND {FY_SERIES[-1]} GROUP BY 1, 2
    """
    for court, fy, n in con.execute(q2).fetchall():
        out.setdefault(court, {"all": {}, "core": {}}).setdefault("fy", {})[int(fy)] = int(n)
    return out


def state_unmatched(con: duckdb.DuckDBPyConnection) -> dict:
    """Per state of the filing district: window counts of codes that are not a current county of that state (by code)."""
    lo, hi = FY_WINDOW
    q = f"""
        SELECT v.dist_usps, v.code, count(*)
        FROM cv v LEFT JOIN cty t ON t.fips = v.code AND t.usps = v.dist_usps
        WHERE v.fy BETWEEN {lo} AND {hi} AND t.fips IS NULL AND v.code IS NOT NULL AND v.code NOT IN ('88888', '99999')
        GROUP BY 1, 2
    """
    out: dict[str, dict[str, int]] = {}
    for usps, code, n in con.execute(q).fetchall():
        out.setdefault(usps or "", {})[code] = int(n)
    return out
