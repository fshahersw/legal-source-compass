"""Case law v2 step 2: case (cluster) metadata of the selected court tiers, streamed from the bulk clusters file.

    python3 -I -B scripts/caselaw_v2/clusters.py --run sa --groups sa
    python3 -I -B scripts/caselaw_v2/clusters.py --run sample --courts calctapp,nysd --years 2016:2016 [--limit-mb 600]

HTTP ranges -> parallel bzip2 segments (scripts/enrichment/courtlistener/pbz2.py) -> pyarrow streaming CSV reader (only
the columns below) -> DuckDB: each batch is joined to the local docket table (private/acq/courtlistener/db/docket.duckdb:
id, court_id, blocked, docket_number of every docket of the same snapshot) and to the court registry (courts.json), and
the clusters of the selected tiers/courts/years are inserted into <run>/meta.duckdb table `clusters`. The source CSV is
never stored.

Kept per cluster (values exactly as CourtListener publishes them; nothing inferred): cluster_id, docket_id, court_id, tier,
date_filed, date_approx, case_name, case_name_short, case_name_full, docket_number, judges, precedential_status,
citation_count, disposition, source, filepath_json_harvard (the Caselaw Access Project file CourtListener merged, an
exact crosswalk), date_modified.
Blocked clusters or clusters on blocked dockets (CourtListener's flag) are counted per court and never kept; table
`blocked_ids` lists every blocked cluster of any court (the opinions step shows citations into them as plain text) and
`no_docket` the clusters whose docket row is missing from the docket table (reported, never guessed); all_clusters.npz is
a bitmap of every cluster id in the file (the cited-by count, like stage 2, counts only citing clusters that exist).

Also writes <run>/selection.npz (sorted cluster ids + tier + court index; the opinions step filters with it) and
<run>/clusters_report.json (counts per court: kept, blocked, expected from the registry; source URL, bytes, seconds).
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BULK, DOCKET_DB, FILES, WORK, V2Error, now, read_json, tiers_for, write_json)  # noqa: E402

COLS = ["id", "date_modified", "judges", "date_filed", "date_filed_is_approximate", "case_name_short", "case_name",
        "case_name_full", "source", "disposition", "citation_count", "precedential_status", "blocked", "filepath_json_harvard",
        "docket_id"]

SELECT = """
SELECT TRY_CAST(b.id AS BIGINT) AS cluster_id, TRY_CAST(b.docket_id AS BIGINT) AS docket_id, d.court_id, t.tier,
       TRY_CAST(substr(b.date_filed, 1, 10) AS DATE) AS date_filed, coalesce(b.date_filed_is_approximate = 't', false) AS date_approx,
       b.case_name, b.case_name_short, b.case_name_full, d.docket_number, b.judges, b.precedential_status,
       TRY_CAST(b.citation_count AS INTEGER) AS citation_count, b.disposition, b.source, b.filepath_json_harvard,
       b.date_modified, coalesce(b.blocked = 't', false) OR coalesce(d.blocked, false) AS blocked
FROM b LEFT JOIN docket.docket d ON d.id = TRY_CAST(b.docket_id AS BIGINT) LEFT JOIN target t ON t.court_id = d.court_id
"""

CREATE = """
CREATE TABLE IF NOT EXISTS clusters (cluster_id BIGINT PRIMARY KEY, docket_id BIGINT, court_id VARCHAR, tier SMALLINT, date_filed DATE,
  date_approx BOOLEAN, case_name VARCHAR, case_name_short VARCHAR, case_name_full VARCHAR, docket_number VARCHAR, judges VARCHAR,
  precedential_status VARCHAR, citation_count INTEGER, disposition VARCHAR, source VARCHAR, filepath_json_harvard VARCHAR,
  date_modified VARCHAR);
CREATE TABLE IF NOT EXISTS blocked_counts (court_id VARCHAR, n BIGINT);
CREATE TABLE IF NOT EXISTS blocked_ids (cluster_id BIGINT, court_id VARCHAR);
CREATE TABLE IF NOT EXISTS no_docket (cluster_id BIGINT, docket_id BIGINT);
"""


def run_dir(run: str) -> str:
    if not run or not all(ch.isalnum() or ch in "_-" for ch in run):
        raise V2Error("--run must be a short name of letters, digits, _ or -")
    return os.path.join(WORK, "runs", run)


def existing_tier(c: dict) -> int | None:
    """Tier of a court already loaded by stage 2 (comparison runs only)."""
    if c.get("excluded"):
        return None
    if c["court_id"] == "scotus":
        return 1
    return {"F": 2, "S": 3}.get(c.get("level") or "")


def targets(tiers: list[int], courts: list[str] | None, allow_existing: bool = False) -> list[tuple[str, int]]:
    """(court_id, tier) pairs to keep. Tiers 1-3 are taken only with --allow-existing (count comparison with the
    loaded stage-2 rows); excluded courts never."""
    reg = read_json(os.path.join(WORK, "courts.json"))
    if not reg:
        raise V2Error("courts.json is missing: run courts.py first")
    out = []
    for c in reg["courts"]:
        tier = c["tier"] if c["tier"] is not None else (existing_tier(c) if allow_existing else None)
        if tier is None:
            continue
        if not re.fullmatch(r"[a-z0-9_-]{1,40}", c["court_id"]):
            print(f"[clusters] court id {c['court_id']!r} does not match the caselaw court id pattern: not loaded", flush=True)
            continue
        if courts:
            if c["court_id"] in courts:
                out.append((c["court_id"], tier))
        elif tier in tiers:
            out.append((c["court_id"], tier))
    if courts:
        missing = sorted(set(courts) - {c for c, _ in out})
        if missing:
            raise V2Error(f"not loadable courts in the registry: {', '.join(missing)}")
    return out


def head_size(url: str) -> int:
    import ssl
    import urllib.request

    ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt") if os.path.exists("/root/.ccr/ca-bundle.crt") else None
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        return int(r.headers["Content-Length"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--groups", default="all")
    ap.add_argument("--courts", default=None, help="comma-separated court ids (overrides --groups)")
    ap.add_argument("--years", default=None, help="first:last year of date_filed (sample runs)")
    ap.add_argument("--limit-mb", type=int, default=None, help="read only the first N MB of the compressed file (trial)")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--allow-existing", action="store_true", help="also keep named tier 1-3 courts (count comparison only)")
    a = ap.parse_args()

    import duckdb
    import pyarrow as pa
    import pyarrow.csv as pacsv

    import cl_stream
    import pbz2

    out = run_dir(a.run)
    os.makedirs(out, exist_ok=True)
    courts = [c.strip() for c in a.courts.split(",")] if a.courts else None
    tgt = targets(tiers_for(a.groups) if not courts else [], courts, a.allow_existing)
    y0 = y1 = None
    if a.years:
        y0, y1 = (int(x) for x in a.years.split(":"))
    url = BULK + FILES["clusters"]
    size = head_size(url)
    db_path = os.path.join(out, "meta.duckdb")
    if os.path.exists(db_path):
        os.remove(db_path)  # a rerun rebuilds the table from the source (about 10 minutes for the whole file)
    con = duckdb.connect(db_path)
    con.execute("PRAGMA threads=2")
    con.execute("PRAGMA memory_limit='2GB'")
    con.execute(f"ATTACH '{DOCKET_DB}' AS docket (READ_ONLY)")
    con.execute(CREATE)
    con.execute("CREATE TEMP TABLE target (court_id VARCHAR, tier SMALLINT)")
    con.executemany("INSERT INTO target VALUES (?, ?)", tgt)
    year_sql = "" if y0 is None else f" AND year(date_filed) BETWEEN {y0} AND {y1}"

    stats = cl_stream.StreamStats()
    limit = a.limit_mb * 1_000_000 if a.limit_mb else None
    rd = pbz2.ParallelBz2Reader(url, size, workers=a.workers, segment_mb=48, limit=limit, stats=stats)
    header = json.load(open(os.path.join(os.path.dirname(DOCKET_DB), "..", "headers.json")))["opinion-clusters"]["columns"]
    reader = pacsv.open_csv(
        pa.PythonFile(rd, mode="r"),
        read_options=pacsv.ReadOptions(block_size=1 << 26, use_threads=True),
        parse_options=pacsv.ParseOptions(quote_char='"', double_quote=False, escape_char="\\", newlines_in_values=True),
        convert_options=pacsv.ConvertOptions(include_columns=COLS, column_types={c: pa.string() for c in COLS},
                                             strings_can_be_null=True, null_values=[""]))
    if reader.schema.names != [c for c in header if c in COLS]:
        raise V2Error("the clusters CSV header differs from the recorded header")
    import numpy as np

    t0 = time.time()
    rows = 0
    last = t0
    seen_ids = np.zeros(16_000_000, dtype=bool)  # every cluster id of the file (citedby.py: a citing cluster must exist)
    blocked = collections.Counter()
    truncated = False
    try:
        for batch in reader:
            con.register("b", pa.Table.from_batches([batch]))
            con.execute(f"CREATE OR REPLACE TEMP TABLE allrows AS {SELECT}")
            ids_b = con.execute("SELECT cluster_id FROM allrows WHERE cluster_id IS NOT NULL").fetchnumpy()["cluster_id"]
            if len(ids_b):
                top = int(ids_b.max()) + 1
                if top > len(seen_ids):
                    seen_ids = np.concatenate([seen_ids, np.zeros(top - len(seen_ids) + 1_000_000, dtype=bool)])
                seen_ids[np.asarray(ids_b, dtype=np.int64)] = True
            # every blocked cluster of any court (citation anchors into them are shown as plain text, linked nowhere)
            con.execute("INSERT INTO blocked_ids SELECT cluster_id, court_id FROM allrows WHERE blocked")
            con.execute("INSERT INTO no_docket SELECT cluster_id, docket_id FROM allrows WHERE court_id IS NULL")
            con.execute(f"CREATE OR REPLACE TEMP TABLE sel AS SELECT * FROM allrows WHERE tier IS NOT NULL{year_sql}")
            con.execute("INSERT INTO clusters SELECT * EXCLUDE (blocked) FROM sel WHERE NOT blocked")
            for c, n in con.execute("SELECT court_id, count(*) FROM sel WHERE blocked GROUP BY 1").fetchall():
                blocked[c] += n
            con.unregister("b")
            rows += batch.num_rows
            if time.time() - last > 30:
                last = time.time()
                kept = con.execute("SELECT count(*) FROM clusters").fetchone()[0]
                print(f"[clusters] {rows:,} rows read, {kept:,} kept, {stats.compressed / 1e6:,.0f}/{(limit or size) / 1e6:,.0f} MB, "
                      f"{stats.rate_mb_s():.1f} MB/s, {last - t0:,.0f}s", flush=True)
    except pa.ArrowInvalid as exc:
        if not limit:
            raise
        truncated = True
        print(f"[clusters] limit run ended on the truncated final record (expected): {str(exc)[:100]}", flush=True)
    con.executemany("INSERT INTO blocked_counts VALUES (?, ?)", sorted(blocked.items()))
    per_court = {c: {"kept": n} for c, n in con.execute("SELECT court_id, count(*) FROM clusters GROUP BY 1").fetchall()}
    reg = {c["court_id"]: c for c in read_json(os.path.join(WORK, "courts.json"))["courts"]}
    for c, _t in tgt:
        e = per_court.setdefault(c, {"kept": 0})
        e["blocked"] = blocked.get(c, 0)
        e["expected_all"] = reg[c].get("expected_clusters")
    # the opinions step's filter: sorted cluster ids with tier and court index
    np.savez_compressed(os.path.join(out, "all_clusters.npz"), bits=np.packbits(seen_ids), n=np.int64(len(seen_ids)),
                        count=np.int64(int(seen_ids.sum())))

    ids = con.execute("SELECT cluster_id, tier, court_id FROM clusters ORDER BY cluster_id").fetchnumpy()
    court_names = sorted({c for c, _ in tgt})
    cidx = {c: i for i, c in enumerate(court_names)}
    np.savez(os.path.join(out, "selection.npz"), cluster_id=np.asarray(ids["cluster_id"], dtype=np.int64),
             tier=np.asarray(ids["tier"], dtype=np.int8),
             court=np.asarray([cidx[c] for c in ids["court_id"]], dtype=np.int32), courts=np.asarray(court_names))
    extra = {"blocked_all": con.execute("SELECT count(*) FROM blocked_ids").fetchone()[0],
             "no_docket": con.execute("SELECT count(*) FROM no_docket").fetchone()[0]}
    con.execute("CHECKPOINT")
    con.close()
    report = {"run": a.run, "groups": None if courts else a.groups, "courts": courts, "years": a.years, "snapshot_file": url,
              "source_bytes": size, "limit_mb": a.limit_mb, "truncated_by_limit": truncated, "rows_read": rows,
              "kept": int(sum(v["kept"] for v in per_court.values())), "blocked": int(sum(blocked.values())),
              "blocked_all_courts": extra["blocked_all"], "clusters_without_docket_row": extra["no_docket"],
              "compressed_mb_read": round(stats.compressed / 1e6, 1), "seconds": round(time.time() - t0, 1), "built_at": now(),
              "docket_table": os.path.relpath(DOCKET_DB, os.path.dirname(os.path.dirname(WORK))), "per_court": per_court}
    write_json(os.path.join(out, "clusters_report.json"), report)
    print(json.dumps({k: v for k, v in report.items() if k != "per_court"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
