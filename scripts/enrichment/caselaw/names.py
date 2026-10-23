"""Case-law stage 2 (optional input): the full case names (parties) of the three tiers' clusters, streamed from the
CourtListener clusters bulk file (never stored).

    cd scripts/enrichment/caselaw
    python3 -I -B names.py          # -> private/build/caselaw_read/meta/names.parquet (cluster_id, case_name_full)

Input: https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinion-clusters-2026-09-30.csv.bz2
(2,467,613,433 bytes). Only `id` and `case_name_full` are kept, for unblocked clusters of the stage-1 selection, and
only when case_name_full is not empty. The value is kept exactly as published.
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

import read_store as rs  # noqa: E402

FILE = "opinion-clusters-2026-09-30.csv.bz2"
URL = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/" + FILE
INPUT_BYTES = 2_467_613_433
OUT = os.path.join(ROOT, "private", "build", "caselaw_read", "meta")

csv.field_size_limit(1 << 30)


def parse(stream, keep):
    reader = csv.reader(stream, escapechar="\\", doublequote=False, strict=True)
    header = next(reader)
    i_id, i_full = header.index("id"), header.index("case_name_full")
    for row in reader:
        cid = int(row[i_id])
        if cid in keep and row[i_full].strip():
            yield cid, row[i_full]


def main() -> int:
    import duckdb
    import pandas as pd

    import cl_stream

    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    con = duckdb.connect()
    con.execute("PRAGMA threads=1")
    keep = {r[0] for r in con.execute(f"SELECT DISTINCT cluster_id FROM read_parquet('{rs.SELECTION}') WHERE NOT blocked").fetchall()}
    stats = cl_stream.StreamStats()
    reader = cl_stream.decompressed_reader(URL, stats)
    text = io.TextIOWrapper(reader.proc.stdout, encoding="utf-8", newline="")
    rows = list(parse(text, keep))
    reader.close()
    if reader.error:
        raise reader.error
    if stats.compressed != INPUT_BYTES:
        raise SystemExit(f"read {stats.compressed} compressed bytes, expected {INPUT_BYTES}")
    frame = pd.DataFrame(rows, columns=["cluster_id", "case_name_full"])
    con.register("frame", frame)
    out = os.path.join(OUT, "names.parquet")
    con.execute(f"COPY (SELECT * FROM frame ORDER BY cluster_id) TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)")
    os.replace(out + ".tmp", out)
    summary = {"source": URL, "input_bytes": stats.compressed, "clusters_selected": len(keep), "with_full_name": len(rows),
               "seconds": round(time.time() - t0, 1), "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with open(os.path.join(OUT, "names.json"), "w") as h:
        json.dump(summary, h, indent=1)
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
