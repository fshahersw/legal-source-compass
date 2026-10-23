"""Case-law stage 2b: parentheticals that describe the three tiers' cases, with their text, from the CourtListener bulk
file (streamed, never stored).

    cd scripts/enrichment/caselaw
    python3 -I -B parentheticals.py            # -> private/build/caselaw_read/citator/parentheticals.parquet

Input: https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/parentheticals-2026-09-30.csv.bz2
(292,482,829 bytes; PostgreSQL COPY CSV with ESCAPE '\\'), the stage-1 selection (opinion -> cluster, blocked) and the
local opinion/cluster/docket tables (for the describing opinion's cluster and its blocked flag).

Kept: a parenthetical whose described opinion belongs to an unblocked cluster of the three tiers. Then, per described
cluster: describing opinions in a blocked cluster (or docket) and in the described cluster itself are dropped; within a
CourtListener parenthetical group (group_id) only the highest-scoring parenthetical is kept (ties: lower id); the
remaining ones are ranked by score (descending, then id) and the first TOP are written, with the total count.
Text is kept exactly as CourtListener publishes it.
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "courtlistener"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

SNAPSHOT = "2026-09-30"
FILE = f"parentheticals-{SNAPSHOT}.csv.bz2"
URL = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/" + FILE
INPUT_BYTES = 292_482_829
TOP = 50
DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
SELECTION = os.path.join(ROOT, "private", "build", "caselaw", "work", "selection.parquet")
OUT = os.path.join(ROOT, "private", "build", "caselaw_read", "citator")
EXPECTED = ["id", "text", "score", "described_opinion_id", "describing_opinion_id", "group_id"]

csv.field_size_limit(1 << 30)


def parse_rows(stream, keep_described, header_expected=EXPECTED):
    """Yield (id, text, score, described_opinion_id, describing_opinion_id, group_id) for kept rows.

    `stream` is a text stream of the CSV (header first). PostgreSQL COPY CSV: unquoted empty = NULL, backslash escape."""
    reader = csv.reader(stream, escapechar="\\", doublequote=False, strict=True)
    header = next(reader)
    idx = {c: header.index(c) for c in header_expected if c in header}
    missing = [c for c in header_expected if c not in idx]
    if missing:
        raise ValueError(f"parentheticals header lacks {missing}: {header}")
    for row in reader:
        described = row[idx["described_opinion_id"]]
        if not described or int(described) not in keep_described:
            continue
        score = row[idx["score"]]
        group = row[idx["group_id"]]
        describing = row[idx["describing_opinion_id"]]
        yield (int(row[idx["id"]]), row[idx["text"]], float(score) if score else None, int(described),
               int(describing) if describing else None, int(group) if group else None)


RANK_SQL = """
CREATE TEMP TABLE pr AS
SELECT p.id, p.score, p.group_id, p.describing_opinion_id, sd.cluster_id AS described_cluster_id, od.cluster_id AS describing_cluster_id
FROM praw p
JOIN sel sd ON sd.opinion_id = p.described_opinion_id
JOIN opin od ON od.id = p.describing_opinion_id
JOIN blk b ON b.cluster_id = od.cluster_id
WHERE NOT b.blocked AND od.cluster_id <> sd.cluster_id;
CREATE TEMP TABLE pr_group AS
SELECT * EXCLUDE (gr) FROM (
  SELECT *, row_number() OVER (PARTITION BY described_cluster_id, coalesce(group_id, -id) ORDER BY score DESC NULLS LAST, id) AS gr
  FROM pr) WHERE gr = 1;
CREATE TEMP TABLE pr_top AS
SELECT * FROM (
  SELECT described_cluster_id, id, score, describing_opinion_id, describing_cluster_id, group_id,
         row_number() OVER (PARTITION BY described_cluster_id ORDER BY score DESC NULLS LAST, id) AS rnk,
         count(*) OVER (PARTITION BY described_cluster_id) AS total
  FROM pr_group) WHERE rnk <= {top};
"""


def main() -> int:
    import duckdb

    import cl_stream

    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    con = duckdb.connect()
    con.execute("PRAGMA threads=2")
    con.execute("PRAGMA memory_limit='4GB'")
    con.execute("SET preserve_insertion_order=false")
    con.execute(f"SET temp_directory='{os.path.join(OUT, 'duck_tmp')}'")
    con.execute("SET max_temp_directory_size='600MB'")
    con.execute(f"CREATE TEMP TABLE sel AS SELECT opinion_id, cluster_id FROM read_parquet('{SELECTION}') WHERE NOT blocked")
    keep = {r[0] for r in con.execute("SELECT opinion_id FROM sel").fetchall()}
    con.execute("CREATE TEMP TABLE praw (id BIGINT, text VARCHAR, score DOUBLE, described_opinion_id BIGINT, describing_opinion_id BIGINT, group_id BIGINT)")
    stats = cl_stream.StreamStats()
    reader = cl_stream.decompressed_reader(URL, stats)
    text = io.TextIOWrapper(reader.proc.stdout, encoding="utf-8", newline="")
    import pandas as pd

    cols = ["id", "text", "score", "described_opinion_id", "describing_opinion_id", "group_id"]
    batch, kept = [], 0

    def flush(rows):
        frame = pd.DataFrame(rows, columns=cols).astype({"id": "int64", "described_opinion_id": "int64", "describing_opinion_id": "Int64",
                                                        "group_id": "Int64", "score": "float64"})
        con.register("frame", frame)
        con.execute("INSERT INTO praw SELECT id, text, score, described_opinion_id, describing_opinion_id, group_id FROM frame")
        con.unregister("frame")

    for row in parse_rows(text, keep):
        batch.append(row)
        if len(batch) >= 200_000:
            flush(batch)
            kept += len(batch)
            batch = []
    if batch:
        flush(batch)
        kept += len(batch)
    reader.close()
    if reader.error:
        raise reader.error
    if stats.compressed != INPUT_BYTES:
        raise SystemExit(f"read {stats.compressed} compressed bytes, expected {INPUT_BYTES}")
    print(f"[paren] kept {kept:,} rows describing tier opinions ({time.time() - t0:.0f}s, {stats.compressed / 1e6:.0f} MB)", flush=True)
    for name in ("opinion", "cluster", "docket"):
        con.execute(f"ATTACH '{os.path.join(DB, name + '.duckdb')}' AS {name} (READ_ONLY)")
    con.execute("CREATE TEMP TABLE opin AS SELECT o.id, o.cluster_id FROM opinion.opinion o WHERE o.id IN (SELECT DISTINCT describing_opinion_id FROM praw)")
    con.execute("""CREATE TEMP TABLE blk AS
        SELECT k.id AS cluster_id, coalesce(k.blocked, false) OR coalesce(d.blocked, false) AS blocked
        FROM cluster.cluster k LEFT JOIN docket.docket d ON d.id = k.docket_id
        WHERE k.id IN (SELECT cluster_id FROM opin)""")
    con.execute(RANK_SQL.format(top=TOP))
    out = os.path.join(OUT, "parentheticals.parquet")
    con.execute(f"""COPY (SELECT t.described_cluster_id, t.id, r.text, t.score, t.describing_opinion_id, t.describing_cluster_id, t.group_id,
                         t.rnk, t.total FROM pr_top t JOIN praw r ON r.id = t.id ORDER BY t.described_cluster_id, t.rnk)
                   TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)""")
    os.replace(out + ".tmp", out)
    summary = {
        "source": URL, "input_bytes": stats.compressed, "rows_describing_tier_opinions": kept,
        "after_exclusions": con.execute("SELECT count(*) FROM pr").fetchone()[0],
        "after_group_dedupe": con.execute("SELECT count(*) FROM pr_group").fetchone()[0],
        "kept_top": con.execute("SELECT count(*) FROM pr_top").fetchone()[0],
        "described_clusters": con.execute("SELECT count(DISTINCT described_cluster_id) FROM pr_top").fetchone()[0],
        "top": TOP, "seconds": round(time.time() - t0, 1), "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(os.path.join(OUT, "parentheticals.json"), "w") as h:
        json.dump(summary, h, indent=1)
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
