"""Case law v2 step 3: reporter citations, panels and judge names for the run's clusters (small bulk files).

    python3 -I -B scripts/caselaw_v2/citations.py --run all

Streams three bulk files of the pinned snapshot (never stored) into <run>/meta.duckdb:
  citations-2026-09-30.csv.bz2                 -> table citations (cluster_id, volume, reporter, page, type) for the
                                                  run's clusters, exactly as published
  search_opinioncluster_panel-2026-09-30.csv.bz2 -> table panel (cluster_id, person_id) for the run's clusters
  people-db-people-2026-09-30.csv.bz2          -> table people (person_id, name = "first middle last suffix"), the names
                                                  stage 2 shows for panels and opinion authors (exact ids, never matched
                                                  by name)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import BULK, FILES, WORK, V2Error, now, read_json, write_json  # noqa: E402

SPECS = {
    "citations": {"file": FILES["citations"], "cols": ["volume", "reporter", "page", "type", "cluster_id"],
                  "create": "CREATE TABLE citations (cluster_id BIGINT, volume VARCHAR, reporter VARCHAR, page VARCHAR, type SMALLINT)",
                  "insert": """INSERT INTO citations SELECT TRY_CAST(b.cluster_id AS BIGINT), b.volume, b.reporter, b.page,
                               TRY_CAST(b.type AS SMALLINT) FROM b JOIN clusters k ON k.cluster_id = TRY_CAST(b.cluster_id AS BIGINT)"""},
    "panel": {"file": FILES["panel"], "cols": ["opinioncluster_id", "person_id"],
              "create": "CREATE TABLE panel (cluster_id BIGINT, person_id BIGINT)",
              "insert": """INSERT INTO panel SELECT TRY_CAST(b.opinioncluster_id AS BIGINT), TRY_CAST(b.person_id AS BIGINT) FROM b
                           JOIN clusters k ON k.cluster_id = TRY_CAST(b.opinioncluster_id AS BIGINT)"""},
    "people": {"file": FILES["people"], "cols": ["id", "name_first", "name_middle", "name_last", "name_suffix"],
               "create": "CREATE TABLE people (person_id BIGINT, name VARCHAR, name_last VARCHAR, name_first VARCHAR)",
               "insert": """INSERT INTO people SELECT TRY_CAST(b.id AS BIGINT),
                              concat_ws(' ', nullif(trim(b.name_first), ''), nullif(trim(b.name_middle), ''), nullif(trim(b.name_last), ''),
                                        nullif(trim(b.name_suffix), '')), b.name_last, b.name_first FROM b"""},
}


def head_size(url: str) -> int:
    from clusters import head_size as hs

    return hs(url)


def stream_table(con, name: str, workers: int) -> dict:
    import pyarrow as pa
    import pyarrow.csv as pacsv

    import cl_stream
    import pbz2

    spec = SPECS[name]
    url = BULK + spec["file"]
    size = head_size(url)
    stats = cl_stream.StreamStats()
    if size > 50_000_000:
        src = pa.PythonFile(pbz2.ParallelBz2Reader(url, size, workers=workers, segment_mb=48, stats=stats), mode="r")
    else:  # a few MB: decompressed in memory, never written to disk
        import bz2

        src = pa.BufferReader(bz2.decompress(b"".join(cl_stream.open_stream(url, stats))))
    reader = pacsv.open_csv(
        src,
        read_options=pacsv.ReadOptions(block_size=1 << 25, use_threads=True),
        parse_options=pacsv.ParseOptions(quote_char='"', double_quote=False, escape_char="\\", newlines_in_values=True),
        convert_options=pacsv.ConvertOptions(include_columns=spec["cols"], column_types={c: pa.string() for c in spec["cols"]},
                                             strings_can_be_null=True, null_values=[""]))
    con.execute(f"DROP TABLE IF EXISTS {name}")
    con.execute(spec["create"])
    t0 = time.time()
    rows = 0
    for batch in reader:
        con.register("b", pa.Table.from_batches([batch]))
        con.execute(spec["insert"])
        con.unregister("b")
        rows += batch.num_rows
    kept = con.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
    return {"url": url, "bytes": size, "rows_read": rows, "kept": kept, "seconds": round(time.time() - t0, 1)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args()
    import duckdb

    run_dir = os.path.join(WORK, "runs", a.run)
    db = os.path.join(run_dir, "meta.duckdb")
    if not os.path.exists(db):
        raise V2Error("meta.duckdb is missing: run clusters.py first")
    con = duckdb.connect(db)
    con.execute("PRAGMA threads=2")
    con.execute("PRAGMA memory_limit='2GB'")
    rep = {name: stream_table(con, name, a.workers) for name in ("citations", "panel", "people")}
    con.execute("CHECKPOINT")
    con.close()
    rep["built_at"] = now()
    write_json(os.path.join(run_dir, "citations_report.json"), rep)
    print(json.dumps(rep, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
