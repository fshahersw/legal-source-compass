"""Stream one CourtListener bulk table into a slim DuckDB table, never storing the source CSV.

    python3 -I -B ingest.py <table> [--limit-mb N] [--workers 4] [--segment-mb 48]

HTTP -> parallel bzip2 block decoding (pbz2) -> pyarrow streaming CSV reader (only the columns named in SPECS) ->
DuckDB INSERT with typed casts. One DuckDB file per table under private/acq/courtlistener/db/ so several ingests can
run at once. Text-heavy columns (opinion text, summaries, attorney lists) are reduced to lengths / presence flags at
insert time; contact-like personal fields are not selected at all.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import duckdb  # noqa: E402
import pyarrow as pa  # noqa: E402
import pyarrow.csv as pacsv  # noqa: E402

import cl_stream as cl  # noqa: E402
import pbz2  # noqa: E402

DB_DIR = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
LATEST = os.path.join(ROOT, "private", "acq", "courtlistener", "latest_bulk.json")

D = "TRY_CAST(substr({c}, 1, 10) AS DATE)"
I = "TRY_CAST({c} AS BIGINT)"
S = "SMALLINT"


def d(c: str) -> str:
    return D.format(c=c)


def i(c: str) -> str:
    return I.format(c=c)


def s(c: str, n: int = 120) -> str:
    return f"left({c}, {n})"


def flag(c: str) -> str:
    return f"({c} = 't')"


def has(c: str) -> str:
    return f"(length(coalesce({c}, '')) > 0)"


# name -> (duckdb type, expression over the raw string columns)
SPECS: dict[str, dict] = {
    "dockets": {
        "table": "docket",
        "block": 1 << 26,
        "cols": [
            ("id", "BIGINT", i("id")),
            ("source", S, f"TRY_CAST(source AS {S})"),
            ("court_id", "VARCHAR", "court_id"),
            ("date_filed", "DATE", d("date_filed")),
            ("date_terminated", "DATE", d("date_terminated")),
            ("date_argued", "DATE", d("date_argued")),
            ("date_created", "DATE", d("date_created")),
            ("nature_of_suit", "VARCHAR", s("nature_of_suit")),
            ("cause", "VARCHAR", s("cause")),
            ("jury_demand", "VARCHAR", s("jury_demand", 40)),
            ("jurisdiction_type", "VARCHAR", s("jurisdiction_type", 60)),
            ("assigned_to_id", "BIGINT", i("assigned_to_id")),
            ("referred_to_id", "BIGINT", i("referred_to_id")),
            ("appeal_from_id", "VARCHAR", "appeal_from_id"),
            ("idb_data_id", "BIGINT", i("idb_data_id")),
            ("originating_court_information_id", "BIGINT", i("originating_court_information_id")),
            ("docket_number", "VARCHAR", s("docket_number", 60)),
            ("docket_number_core", "VARCHAR", s("docket_number_core", 40)),
            ("mdl_status", "VARCHAR", s("mdl_status", 40)),
            ("federal_dn_case_type", "VARCHAR", s("federal_dn_case_type", 12)),
            ("federal_dn_office_code", "VARCHAR", s("federal_dn_office_code", 12)),
            ("blocked", "BOOLEAN", flag("blocked")),
            ("parent_docket_id", "BIGINT", i("parent_docket_id")),
            ("case_name", "VARCHAR", s("case_name", 160)),
        ],
    },
    "opinion-clusters": {
        "table": "cluster",
        "block": 1 << 27,
        "cols": [
            ("id", "BIGINT", i("id")),
            ("docket_id", "BIGINT", i("docket_id")),
            ("date_filed", "DATE", d("date_filed")),
            ("date_filed_is_approximate", "BOOLEAN", flag("date_filed_is_approximate")),
            ("case_name", "VARCHAR", s("case_name", 160)),
            ("source", "VARCHAR", s("source", 12)),
            ("precedential_status", "VARCHAR", s("precedential_status", 30)),
            ("citation_count", "INTEGER", "TRY_CAST(citation_count AS INTEGER)"),
            ("scdb_id", "VARCHAR", s("scdb_id", 20)),
            ("scdb_decision_direction", S, f"TRY_CAST(scdb_decision_direction AS {S})"),
            ("scdb_votes_majority", S, f"TRY_CAST(scdb_votes_majority AS {S})"),
            ("scdb_votes_minority", S, f"TRY_CAST(scdb_votes_minority AS {S})"),
            ("judges", "VARCHAR", s("judges", 240)),
            ("nature_of_suit", "VARCHAR", s("nature_of_suit", 80)),
            ("posture", "VARCHAR", s("posture", 80)),
            ("disposition", "VARCHAR", s("disposition", 60)),
            ("blocked", "BOOLEAN", flag("blocked")),
            ("has_attorneys", "BOOLEAN", has("attorneys")),
            ("has_syllabus", "BOOLEAN", has("syllabus")),
            ("has_headnotes", "BOOLEAN", has("headnotes")),
            ("has_summary", "BOOLEAN", has("summary")),
            ("has_procedural_history", "BOOLEAN", has("procedural_history")),
            ("has_history", "BOOLEAN", has("history")),
            ("has_headmatter", "BOOLEAN", has("headmatter")),
        ],
    },
    "opinions": {
        "table": "opinion",
        "block": 1 << 28,
        "cols": [
            ("id", "BIGINT", i("id")),
            ("cluster_id", "BIGINT", i("cluster_id")),
            ("author_id", "BIGINT", i("author_id")),
            ("type", "VARCHAR", s("type", 24)),
            ("per_curiam", "BOOLEAN", flag("per_curiam")),
            ("page_count", "INTEGER", "TRY_CAST(page_count AS INTEGER)"),
            ("extracted_by_ocr", "BOOLEAN", flag("extracted_by_ocr")),
            ("has_download_url", "BOOLEAN", has("download_url")),
            ("has_joined_by", "BOOLEAN", has("joined_by_str")),
            ("len_plain_text", "INTEGER", "length(coalesce(plain_text, ''))"),
            ("len_html", "INTEGER", "length(coalesce(html, ''))"),
            ("len_html_lawbox", "INTEGER", "length(coalesce(html_lawbox, ''))"),
            ("len_html_columbia", "INTEGER", "length(coalesce(html_columbia, ''))"),
            ("len_html_anon_2020", "INTEGER", "length(coalesce(html_anon_2020, ''))"),
            ("len_xml_harvard", "INTEGER", "length(coalesce(xml_harvard, ''))"),
            ("len_html_with_citations", "INTEGER", "length(coalesce(html_with_citations, ''))"),
            ("date_created", "DATE", d("date_created")),
        ],
    },
    "citation-map": {
        "table": "cmap",
        "block": 1 << 26,
        "cols": [
            ("cited_opinion_id", "BIGINT", i("cited_opinion_id")),
            ("citing_opinion_id", "BIGINT", i("citing_opinion_id")),
            ("depth", S, f"TRY_CAST(depth AS {S})"),
        ],
    },
    "citations": {
        "table": "citation",
        "block": 1 << 25,
        "cols": [
            ("cluster_id", "BIGINT", i("cluster_id")),
            ("volume", "VARCHAR", s("volume", 12)),
            ("reporter", "VARCHAR", s("reporter", 40)),
            ("page", "VARCHAR", s("page", 12)),
            ("type", S, f"TRY_CAST(type AS {S})"),
        ],
    },
    "fjc-integrated-database": {
        "table": "idb",
        "block": 1 << 25,
        "cols": [
            ("id", "BIGINT", i("id")),
            ("dataset_source", S, f"TRY_CAST(dataset_source AS {S})"),
            ("office", "VARCHAR", s("office", 8)),
            ("docket_number", "VARCHAR", s("docket_number", 20)),
            ("origin", S, f"TRY_CAST(origin AS {S})"),
            ("date_filed", "DATE", d("date_filed")),
            ("jurisdiction", S, f"TRY_CAST(jurisdiction AS {S})"),
            ("nature_of_suit", "INTEGER", "TRY_CAST(nature_of_suit AS INTEGER)"),
            ("title", "VARCHAR", s("title", 12)),
            ("section", "VARCHAR", s("section", 12)),
            ("subsection", "VARCHAR", s("subsection", 12)),
            ("diversity_of_residence", S, f"TRY_CAST(diversity_of_residence AS {S})"),
            ("class_action", S, f"TRY_CAST(class_action AS {S})"),
            ("monetary_demand", "BIGINT", i("monetary_demand")),
            ("county_of_residence", "VARCHAR", s("county_of_residence", 8)),
            ("arbitration_at_filing", "VARCHAR", s("arbitration_at_filing", 4)),
            ("arbitration_at_termination", "VARCHAR", s("arbitration_at_termination", 4)),
            ("mdl_docket_number", "VARCHAR", s("multidistrict_litigation_docket_number", 12)),
            ("plaintiff", "VARCHAR", s("plaintiff", 100)),
            ("defendant", "VARCHAR", s("defendant", 100)),
            ("date_transfer", "DATE", d("date_transfer")),
            ("transfer_office", "VARCHAR", s("transfer_office", 8)),
            ("transfer_docket_number", "VARCHAR", s("transfer_docket_number", 20)),
            ("transfer_origin", S, f"TRY_CAST(transfer_origin AS {S})"),
            ("date_terminated", "DATE", d("date_terminated")),
            ("termination_class_action_status", S, f"TRY_CAST(termination_class_action_status AS {S})"),
            ("procedural_progress", S, f"TRY_CAST(procedural_progress AS {S})"),
            ("disposition", S, f"TRY_CAST(disposition AS {S})"),
            ("nature_of_judgement", S, f"TRY_CAST(nature_of_judgement AS {S})"),
            ("amount_received", "BIGINT", i("amount_received")),
            ("judgment", S, f"TRY_CAST(judgment AS {S})"),
            ("pro_se", S, f"TRY_CAST(pro_se AS {S})"),
            ("year_of_tape", "INTEGER", "TRY_CAST(year_of_tape AS INTEGER)"),
            ("nature_of_offense", "VARCHAR", s("nature_of_offense", 8)),
            ("version", S, f"TRY_CAST(version AS {S})"),
            ("circuit_id", "VARCHAR", s("circuit_id", 8)),
            ("district_id", "VARCHAR", s("district_id", 8)),
        ],
    },
    "oral-arguments": {
        "table": "oral_argument",
        "block": 1 << 26,
        "cols": [
            ("id", "BIGINT", i("id")),
            ("docket_id", "BIGINT", i("docket_id")),
            ("source", "VARCHAR", s("source", 8)),
            ("duration", "INTEGER", "TRY_CAST(duration AS INTEGER)"),
            ("date_created", "DATE", d("date_created")),
            ("stt_status", S, f"TRY_CAST(stt_status AS {S})"),
            ("has_transcript", "BOOLEAN", has("stt_transcript")),
            ("judges", "VARCHAR", s("judges", 200)),
        ],
    },
    "parentheticals": {
        "table": "parenthetical",
        "block": 1 << 26,
        "cols": [
            ("described_opinion_id", "BIGINT", i("described_opinion_id")),
            ("describing_opinion_id", "BIGINT", i("describing_opinion_id")),
            ("score", "DOUBLE", "TRY_CAST(score AS DOUBLE)"),
            ("len_text", "INTEGER", "length(coalesce(text, ''))"),
        ],
    },
}


def run(table: str, limit_mb: int | None, workers: int, segment_mb: int, block_mb: int | None = None) -> dict:
    spec = dict(SPECS[table])
    if block_mb:
        spec["block"] = block_mb << 20  # smaller CSV blocks cap memory on text-heavy tables (opinions)
    latest = json.load(open(LATEST))
    date, size, key = latest[f"{table}|csv.bz2"]
    name = key.split("/", 1)[1]
    os.makedirs(DB_DIR, exist_ok=True)
    path = os.path.join(DB_DIR, spec["table"] + ".duckdb")
    if os.path.exists(path):
        os.remove(path)
    con = duckdb.connect(path)
    con.execute("PRAGMA threads=2")
    cols = spec["cols"]
    con.execute(f"CREATE TABLE {spec['table']} ({', '.join(f'{n} {t}' for n, t, _ in cols)})")
    raw_cols = sorted(_raw_cols(table, spec))
    select = ", ".join(f"{expr} AS {n}" for n, _, expr in cols)
    stats = cl.StreamStats()
    limit = limit_mb * 1_000_000 if limit_mb else None
    rd = pbz2.ParallelBz2Reader(name, size, workers=workers, segment_mb=segment_mb, limit=limit, stats=stats)
    ropts = pacsv.ReadOptions(block_size=spec["block"], use_threads=True)
    # CourtListener's own load script uses COPY ... WITH (FORMAT csv, ESCAPE '\'): a quote inside a quoted field is
    # written as \" (not ""), and a literal backslash as \\.
    bad: list[tuple[int, int, str]] = []

    def on_invalid(row) -> str:
        # The dockets file contains a few rows whose middle columns are missing (a 16-field row where 54 are
        # expected); PostgreSQL's own loader would reject them too. They are skipped and counted, never repaired.
        bad.append((row.actual_columns, row.number, row.text[:60]))
        return "skip"

    popts = pacsv.ParseOptions(
        quote_char='"', double_quote=False, escape_char="\\", newlines_in_values=True, invalid_row_handler=on_invalid
    )
    copts = pacsv.ConvertOptions(
        include_columns=raw_cols,
        column_types={c: pa.string() for c in raw_cols},
        strings_can_be_null=True,
        null_values=[""],
    )
    reader = pacsv.open_csv(pa.PythonFile(rd, mode="r"), read_options=ropts, parse_options=popts, convert_options=copts)
    t0 = time.time()
    rows = 0
    last = t0
    try:
        for batch in reader:
            tbl = pa.Table.from_batches([batch])
            con.register("b", tbl)
            con.execute(f"INSERT INTO {spec['table']} SELECT {select} FROM b")
            con.unregister("b")
            rows += batch.num_rows
            now = time.time()
            if now - last > 30:
                last = now
                print(f"[{table}] {rows:,} rows, {stats.compressed/1e6:,.0f}/{(limit or size)/1e6:,.0f} MB compressed, {stats.rate_mb_s():.1f} MB/s, {now-t0:,.0f}s, retries {stats.retries}", flush=True)
    except pa.ArrowInvalid as exc:
        if not limit:
            raise  # a full-file run must parse to the end
        print(f"[{table}] limit run ended on the truncated final record (expected): {str(exc)[:120]}", flush=True)
    con.execute("CHECKPOINT")
    total = con.execute(f"SELECT count(*) FROM {spec['table']}").fetchone()[0]
    con.close()
    out = {
        "table": spec["table"],
        "file": name,
        "date": date,
        "rows": total,
        "seconds": round(time.time() - t0, 1),
        "compressed_mb_read": round(stats.compressed / 1e6, 1),
        "db_bytes": os.path.getsize(path),
        "limit_mb": limit_mb,
        "skipped_invalid_rows": len(bad),
        "skipped_samples": bad[:20],
    }
    print("DONE", json.dumps(out), flush=True)
    with open(os.path.join(DB_DIR, spec["table"] + ".done.json"), "w") as h:
        json.dump(out, h, indent=1)
    return out


def _raw_cols(table: str, spec: dict) -> set[str]:
    """Raw CSV column names referenced by the expressions, checked against the real header."""
    import re

    names = json.load(open(os.path.join(ROOT, "private", "acq", "courtlistener", "headers.json")))[table]["columns"]
    used = set()
    for _, _, expr in spec["cols"]:
        for tok in re.findall(r"[a-z_][a-z_0-9]*", expr):
            if tok in names:
                used.add(tok)
    return used


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("table", choices=sorted(SPECS))
    ap.add_argument("--limit-mb", type=int, default=None)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--segment-mb", type=int, default=48)
    ap.add_argument("--block-mb", type=int, default=None)
    a = ap.parse_args()
    try:
        run(a.table, a.limit_mb, a.workers, a.segment_mb, a.block_mb)
    except BaseException:  # noqa: BLE001 - pyarrow's IO thread can keep the interpreter alive after an error
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
    sys.stdout.flush()
    os._exit(0)
