"""Stream the CourtListener bulk files the first loader left out into slim DuckDB tables, never storing the source CSV.

    python3 -I -B ingest_rest.py <bankruptcy|unmatched|paren_top> [--limit-mb N] [--workers 4] [--segment-mb 48]

Reuses the first loader's pieces (../courtlistener/pbz2.py parallel bzip2 block decoding over HTTP, the same pyarrow CSV
options as ingest.py: quote '"', backslash escape, embedded newlines, invalid rows skipped and counted). One DuckDB file per
table under private/acq/courtlistener/db/ with a <table>.done.json completion marker, like the other tables.

* bankruptcy: randoms/bankruptcy-dockets-2022-09-19.csv.bz2. Debtor names (case_name*, which name individuals) and PACER ids are
  not selected; dates, court, docket number and the recorded judge fields are.
* unmatched: unmatched-citations-2026-09-30.csv.bz2, all ten columns (citation strings are short reporter citations).
* paren_top: parentheticals-2026-09-30.csv.bz2, but only the rows describing an opinion of the 1,000 clusters in clb_top_cited
  (work.duckdb w_cl_top_national + w_op), with their text. Every other row is dropped as it streams.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CL = os.path.join(ROOT, "scripts", "enrichment", "courtlistener")
sys.path.insert(0, HERE)
sys.path.insert(0, CL)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import duckdb  # noqa: E402
import pyarrow as pa  # noqa: E402
import pyarrow.csv as pacsv  # noqa: E402

import cl_stream as cl  # noqa: E402
import pbz2  # noqa: E402
from ingest import d, flag, i, s  # noqa: E402  (same typed-cast helpers as the first loader)

DB_DIR = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
LATEST = os.path.join(ROOT, "private", "acq", "courtlistener", "latest_bulk.json")
S16 = "SMALLINT"

SPECS: dict[str, dict] = {
    "bankruptcy": {
        "key": "randoms/bankruptcy-dockets|csv.bz2",
        "table": "bankruptcy",
        "block": 1 << 26,
        "header": ["id", "date_created", "date_modified", "assigned_to_str", "referred_to_str", "date_filed", "date_terminated", "case_name_short",
                   "case_name", "case_name_full", "docket_number", "docket_number_core", "pacer_case_id", "date_blocked", "blocked", "assigned_to_id",
                   "court_id", "referred_to_id"],
        # About 22 million rows: only what the profiles use is kept (docket-number case-type code, not the full number).
        "cols": [
            ("id", "BIGINT", i("id")),
            ("court_id", "VARCHAR", "court_id"),
            ("date_filed", "DATE", d("date_filed")),
            ("date_terminated", "DATE", d("date_terminated")),
            ("date_created", "DATE", d("date_created")),
            ("blocked", "BOOLEAN", flag("blocked")),
            # PACER case-type code inside the docket number (1:19-bk-12345 -> bk); NULL when the number has none (19-12345)
            ("dn_type", "VARCHAR", "nullif(regexp_extract(lower(docket_number), '^[0-9]+:[0-9]{2}-([a-z]{2})-', 1), '')"),
            ("has_docket_number", "BOOLEAN", "(length(coalesce(docket_number, '')) > 0)"),
            ("assigned_to_id", "BIGINT", i("assigned_to_id")),
            ("referred_to_id", "BIGINT", i("referred_to_id")),
            ("assigned_to_str", "VARCHAR", s("assigned_to_str", 80)),
            ("has_referred_str", "BOOLEAN", "(length(coalesce(referred_to_str, '')) > 0)"),
            ("filed_unparsed", "BOOLEAN", "(date_filed IS NOT NULL AND TRY_CAST(substr(date_filed, 1, 10) AS DATE) IS NULL)"),
        ],
    },
    "unmatched": {
        "key": "unmatched-citations|csv.bz2",
        "table": "unmatched_citation",
        "block": 1 << 25,
        "header": ["id", "volume", "reporter", "page", "type", "status", "citation_string", "court_id", "year", "citing_opinion_id"],
        "cols": [
            ("id", "BIGINT", i("id")),
            ("volume", "VARCHAR", s("volume", 16)),
            ("reporter", "VARCHAR", s("reporter", 60)),
            ("page", "VARCHAR", s("page", 16)),
            ("type", S16, f"TRY_CAST(type AS {S16})"),
            ("status", S16, f"TRY_CAST(status AS {S16})"),
            ("citation_string", "VARCHAR", s("citation_string", 120)),
            ("court_id", "VARCHAR", s("court_id", 40)),
            ("year", S16, f"TRY_CAST(year AS {S16})"),
            ("citing_opinion_id", "BIGINT", i("citing_opinion_id")),
        ],
    },
    # The disclosure report file paths that load_small.py dropped: CourtListener's PDF path (linked) and the original file name, which
    # carries the filer code of the Administrative Office's naming (Surname-Initials. position. circuit. district) used to check attribution.
    "fd_files": {
        "key": "financial-disclosures|csv.bz2",
        "table": "fd_file",
        "block": 1 << 24,
        "header": ["id", "date_created", "date_modified", "year", "download_filepath", "filepath", "thumbnail", "thumbnail_status", "page_count", "sha1",
                   "report_type", "is_amended", "addendum_content_raw", "addendum_redacted", "has_been_extracted", "person_id"],
        "cols": [
            ("id", "BIGINT", i("id")),
            ("person_id", "BIGINT", i("person_id")),
            ("year", S16, f"TRY_CAST(year AS {S16})"),
            ("filepath", "VARCHAR", s("filepath", 300)),
            ("download_filepath", "VARCHAR", s("download_filepath", 400)),
        ],
    },
    "paren_top": {
        "key": "parentheticals|csv.bz2",
        "table": "paren_top",
        "block": 1 << 26,
        "header": ["id", "text", "score", "described_opinion_id", "describing_opinion_id", "group_id"],
        "cols": [
            ("id", "BIGINT", i("id")),
            ("described_opinion_id", "BIGINT", i("described_opinion_id")),
            ("describing_opinion_id", "BIGINT", i("describing_opinion_id")),
            ("group_id", "BIGINT", i("group_id")),
            ("score", "DOUBLE", "TRY_CAST(score AS DOUBLE)"),
            ("text", "VARCHAR", "text"),
        ],
        # only rows that describe an opinion of a top-cited cluster
        "where": "TRY_CAST(described_opinion_id AS BIGINT) IN (SELECT oid FROM keep_oid)",
    },
}


def prepare_paren_top(con) -> int:
    """Copy the opinion ids of the 1,000 clb_top_cited clusters into keep_oid (from work.duckdb, read-only)."""
    con.execute(f"ATTACH '{os.path.join(DB_DIR, 'work.duckdb')}' AS wk (READ_ONLY)")
    con.execute("CREATE TABLE keep_oid AS SELECT DISTINCT oid, cid FROM wk.w_op WHERE cid IN (SELECT cid FROM wk.w_cl_top_national)")
    con.execute("CREATE TABLE keep_cid AS SELECT cid FROM wk.w_cl_top_national")
    con.execute("DETACH wk")
    return con.execute("SELECT count(*) FROM keep_oid").fetchone()[0]


def run(name: str, limit_mb: int | None, workers: int, segment_mb: int) -> dict:
    spec = SPECS[name]
    latest = json.load(open(LATEST))
    date, size, key = latest[spec["key"]]
    obj = key.split("/", 1)[1]  # path under bulk-data/
    os.makedirs(DB_DIR, exist_ok=True)
    path = os.path.join(DB_DIR, spec["table"] + ".duckdb")
    if os.path.exists(path):
        os.remove(path)
    con = duckdb.connect(path)
    con.execute("PRAGMA threads=2")
    cols = spec["cols"]
    con.execute(f"CREATE TABLE {spec['table']} ({', '.join(f'{n} {t}' for n, t, _ in cols)})")
    kept_ids = prepare_paren_top(con) if name == "paren_top" else None
    raw_cols = sorted({tok for _, _, expr in cols for tok in spec["header"] if tok in expr.replace("(", " ").replace(")", " ").replace(",", " ").split()})
    select = ", ".join(f"{expr} AS {n}" for n, _, expr in cols)
    where = f" WHERE {spec['where']}" if spec.get("where") else ""
    stats = cl.StreamStats()
    limit = limit_mb * 1_000_000 if limit_mb else None
    rd = pbz2.ParallelBz2Reader(obj, size, workers=workers, segment_mb=segment_mb, limit=limit, stats=stats)
    bad: list[tuple[int, int, str]] = []

    def on_invalid(row) -> str:
        bad.append((row.actual_columns, row.number, (row.text or "")[:60]))
        return "skip"

    ropts = pacsv.ReadOptions(block_size=spec["block"], use_threads=True)
    popts = pacsv.ParseOptions(quote_char='"', double_quote=False, escape_char=chr(92), newlines_in_values=True, invalid_row_handler=on_invalid)
    copts = pacsv.ConvertOptions(include_columns=raw_cols, column_types={c: pa.string() for c in raw_cols}, strings_can_be_null=True, null_values=[""])
    reader = pacsv.open_csv(pa.PythonFile(rd, mode="r"), read_options=ropts, parse_options=popts, convert_options=copts)
    header_seen = list(reader.schema.names)
    t0 = time.time()
    rows_read = 0
    last = t0
    try:
        for batch in reader:
            tbl = pa.Table.from_batches([batch])
            con.register("b", tbl)
            con.execute(f"INSERT INTO {spec['table']} SELECT {select} FROM b{where}")
            con.unregister("b")
            rows_read += batch.num_rows
            now = time.time()
            if now - last > 30:
                last = now
                print(f"[{name}] {rows_read:,} rows read, {stats.compressed/1e6:,.0f}/{(limit or size)/1e6:,.0f} MB compressed, {stats.rate_mb_s():.1f} MB/s, {now-t0:,.0f}s, retries {stats.retries}", flush=True)
    except pa.ArrowInvalid as exc:
        if not limit:
            raise
        print(f"[{name}] limit run ended on the truncated final record (expected): {str(exc)[:120]}", flush=True)
    con.execute("CHECKPOINT")
    total = con.execute(f"SELECT count(*) FROM {spec['table']}").fetchone()[0]
    con.close()
    out = {
        "table": spec["table"],
        "file": obj,
        "url": cl.BASE + obj,
        "date": date,
        "compressed_bytes": size,
        "rows": total,
        "rows_read": rows_read,
        "columns_selected": [n for n, _, _ in cols],
        "raw_columns_read": raw_cols,
        "header_matches_expected": sorted(header_seen) == sorted(raw_cols),
        "seconds": round(time.time() - t0, 1),
        "compressed_mb_read": round(stats.compressed / 1e6, 1),
        "db_bytes": os.path.getsize(path),
        "limit_mb": limit_mb,
        "skipped_invalid_rows": len(bad),
        "skipped_samples": bad[:20],
        "filter_opinion_ids": kept_ids,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    print("DONE", json.dumps(out), flush=True)
    with open(os.path.join(DB_DIR, spec["table"] + ".done.json"), "w") as h:
        json.dump(out, h, indent=1)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("name", choices=sorted(SPECS))
    ap.add_argument("--limit-mb", type=int, default=None)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--segment-mb", type=int, default=48)
    a = ap.parse_args()
    try:
        run(a.name, a.limit_mb, a.workers, a.segment_mb)
    except BaseException:  # noqa: BLE001 - pyarrow's IO thread can keep the interpreter alive after an error
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
    sys.stdout.flush()
    os._exit(0)
