"""Load the small CourtListener bulk tables (reference, people, positions, panels, disclosures) whole into DuckDB.

Every column is kept as VARCHAR in `private/acq/courtlistener/db/small.duckdb`; typed casts happen in the analysis SQL.
The big tables are slimmed by ingest.py instead. Nothing here is published directly: the build step selects fields.
Each file is decoded to a temporary CSV under private/scratch/cl_tmp (deleted right after loading).
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import duckdb  # noqa: E402

import pbz2  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db", "small.duckdb")
LATEST = os.path.join(ROOT, "private", "acq", "courtlistener", "latest_bulk.json")
BACKSLASH = chr(92)

TABLES = {
    "courts": "courts",
    "courthouses": "courthouses",
    "people-db-people": "person",
    "people-db-positions": "position",
    "people-db-educations": "education",
    "people-db-schools": "school",
    "people-db-political-affiliations": "political_affiliation",
    "people-db-races": "person_race",
    "people_db_race": "race",
    "people-db-retention-events": "retention_event",
    "court-appeals-to": "court_appeals_to",
    "search_opinioncluster_non_participating_judges": "cluster_non_participating",
    "originating-court-information": "originating_court",
    "search_opinioncluster_panel": "cluster_panel",
    "search_opinion_joined_by": "opinion_joined_by",
    "financial-disclosures": "fd",
    "financial-disclosure-investments": "fd_investment",
    "financial-disclosures-agreements": "fd_agreement",
    "financial-disclosures-debts": "fd_debt",
    "financial-disclosures-gifts": "fd_gift",
    "financial-disclosures-non-investment-income": "fd_non_investment_income",
    "financial-disclosures-positions": "fd_position",
    "financial-disclosures-reimbursements": "fd_reimbursement",
    "financial-disclosures-spousal-income": "fd_spousal_income",
}

# File paths and raw addendum text of the disclosure filings are not needed for aggregate analysis and never published.
DROP = {"fd": {"download_filepath", "filepath", "thumbnail", "addendum_content_raw", "addendum_redacted"}}


def main() -> None:
    latest = json.load(open(LATEST))
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    tmpdir = os.path.join(ROOT, "private", "scratch", "cl_tmp")
    os.makedirs(tmpdir, exist_ok=True)
    if os.path.exists(DB):
        os.remove(DB)
    con = duckdb.connect(DB)
    report = {}
    for key, table in TABLES.items():
        date, size, k = latest[f"{key}|csv.bz2"]
        name = k.split("/", 1)[1]
        t0 = time.time()
        path = os.path.join(tmpdir, table + ".csv")
        rd = pbz2.ParallelBz2Reader(name, size, workers=1, segment_mb=4000)
        with open(path, "wb") as h:
            for chunk in rd.chunks(1 << 24):
                h.write(chunk)
        # DuckDB's CSV reader treats a backslash before a quote as an escape and keeps other backslashes, like the
        # PostgreSQL COPY ... ESCAPE (backslash) that produced these files. All columns stay VARCHAR; "" becomes NULL.
        con.execute(
            f"CREATE TABLE {table} AS SELECT * FROM read_csv('{path}', header=true, all_varchar=true, "
            f"quote='\"', escape='{BACKSLASH}', ignore_errors=true, store_rejects=true, "
            f"rejects_table='rej_{table}', rejects_scan='rej_scan_{table}', max_line_size=268435456)"
        )
        for col in DROP.get(table, set()):
            con.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {col}")
        rows = con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        rej = con.execute(f"SELECT count(*) FROM rej_{table}").fetchone()[0]
        cols = len(con.execute(f"DESCRIBE {table}").fetchall())
        report[table] = {"file": name, "rows": rows, "columns": cols, "rejected_records": rej, "seconds": round(time.time() - t0, 1)}
        print(table, report[table], flush=True)
        os.remove(path)
    con.execute("CHECKPOINT")
    con.close()
    with open(os.path.join(os.path.dirname(DB), "small.done.json"), "w") as h:
        json.dump(report, h, indent=1)


if __name__ == "__main__":
    try:
        main()
    except BaseException:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
    sys.stdout.flush()
    os._exit(0)
