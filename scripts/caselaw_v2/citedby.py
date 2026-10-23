"""Case law v2 step 5: cited_by / cited_by_cases for the run's clusters, from CourtListener's citation map.

    python3 -I -B scripts/caselaw_v2/citedby.py --run all                       # opinion->cluster from the opinions pass
    python3 -I -B scripts/caselaw_v2/citedby.py --run sample --o2c-duckdb /dev/shm/opinion.duckdb   # or from a copy of
                                                                                 # the stage-1 opinion table

Same definition as stage 2 (scripts/enrichment/caselaw/citator.py): for a case C,
  cited_by        distinct citing opinions in the citation map that cite an opinion of C, whose own cluster is not C,
                  exists in the cluster table and is not blocked (cluster or docket flag)
  cited_by_cases  their distinct clusters
The citation map (citation-map-2026-09-30.csv.bz2, 533 MB) is streamed, never stored. The opinion -> cluster map
covers every opinion of the snapshot: <run>/omap/u*.npy written by opinions.py for all 20 units (the full pass must be
complete), or the `opinion` table of a DuckDB copy (id, cluster_id). Writes table cited_by(cluster_id, cited_by,
cited_by_cases) into <run>/meta.duckdb for every selected cluster (0 when nothing cites it: a computed count) and
<run>/citedby_report.json.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import BULK, SNAPSHOT, WORK, V2Error, now, read_json, write_json  # noqa: E402

CMAP = f"citation-map-{SNAPSHOT}.csv.bz2"


def dense_o2c(run_dir: str, duck: str | None, allow_partial: bool):
    import numpy as np

    if duck:
        import duckdb

        con = duckdb.connect(duck, read_only=True)
        t = con.execute("SELECT id, cluster_id FROM opinion WHERE cluster_id IS NOT NULL").fetchnumpy()
        con.close()
        oid, cid = np.asarray(t["id"], np.int64), np.asarray(t["cluster_id"], np.int64)
        source = {"kind": "duckdb", "path": duck, "opinions": int(len(oid))}
    else:
        files = sorted(glob.glob(os.path.join(run_dir, "omap", "u*.npy")))
        units = read_json(os.path.join(WORK, "units.json"))
        ck = read_json(os.path.join(run_dir, "checkpoint.json"), {"units": {}})
        complete = [u for u, s in ck["units"].items() if s.get("status") in ("complete", "uploaded") and not s.get("partial")]
        if len(complete) != units["input"]["units"] and not allow_partial:
            raise V2Error(f"the opinions pass is not complete ({len(complete)} of {units['input']['units']} units): "
                          "cited_by needs every opinion's cluster")
        parts = [np.load(f) for f in files]
        both = np.concatenate(parts) if parts else np.zeros((0, 2), np.int32)
        oid, cid = both[:, 0].astype(np.int64), both[:, 1].astype(np.int64)
        source = {"kind": "omap", "files": len(files), "opinions": int(len(oid)), "partial": len(complete) != units["input"]["units"]}
    dense = np.full(int(oid.max()) + 1 if len(oid) else 1, -1, dtype=np.int32)
    dense[oid] = cid
    return dense, source


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--o2c-duckdb", default=None)
    ap.add_argument("--allow-partial", action="store_true", help="tests only: accept an incomplete opinions pass")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--limit-mb", type=int, default=None)
    a = ap.parse_args()

    import duckdb
    import numpy as np
    import pyarrow as pa
    import pyarrow.csv as pacsv

    import cl_stream
    import pbz2
    from clusters import head_size

    run_dir = os.path.join(WORK, "runs", a.run)
    con = duckdb.connect(os.path.join(run_dir, "meta.duckdb"))
    sel = np.load(os.path.join(run_dir, "selection.npz"))["cluster_id"].astype(np.int64)
    blocked = con.execute("SELECT DISTINCT cluster_id FROM blocked_ids").fetchnumpy()["cluster_id"].astype(np.int64)
    z = np.load(os.path.join(run_dir, "all_clusters.npz"))
    exists = np.unpackbits(z["bits"])[: int(z["n"])].astype(bool)
    o2c, o2c_source = dense_o2c(run_dir, a.o2c_duckdb, a.allow_partial)
    top = int(max(o2c.max(initial=0), sel.max(initial=0), blocked.max(initial=0), len(exists))) + 1
    target = np.zeros(top, dtype=bool)
    target[sel] = True
    # a citing cluster counts when it exists in the cluster table and is not blocked (cluster or docket flag); a
    # cluster without a docket row still counts (stage 2: cluster LEFT JOIN docket)
    excluded = np.ones(top, dtype=bool)
    excluded[: len(exists)] = ~exists
    excluded[blocked] = True

    url = BULK + CMAP
    size = head_size(url)
    stats = cl_stream.StreamStats()
    limit = a.limit_mb * 1_000_000 if a.limit_mb else None
    rd = pbz2.ParallelBz2Reader(url, size, workers=a.workers, segment_mb=48, limit=limit, stats=stats)
    cols = ["cited_opinion_id", "citing_opinion_id"]
    reader = pacsv.open_csv(pa.PythonFile(rd, mode="r"), read_options=pacsv.ReadOptions(block_size=1 << 26, use_threads=True),
                            parse_options=pacsv.ParseOptions(quote_char='"', double_quote=False, escape_char="\\"),
                            convert_options=pacsv.ConvertOptions(include_columns=cols, column_types={c: pa.int64() for c in cols}))
    t0 = time.time()
    rows = kept = 0
    k_op: list = []
    k_cl: list = []
    pending = 0

    def compact():
        nonlocal k_op, k_cl, pending
        if len(k_op) > 1:
            k_op = [np.unique(np.concatenate(k_op))]
            k_cl = [np.unique(np.concatenate(k_cl))]
        pending = 0

    def lookup(ids):
        out = np.full(len(ids), -1, dtype=np.int64)
        ok = (ids >= 0) & (ids < len(o2c))
        out[ok] = o2c[ids[ok]]
        return out

    truncated = False
    try:
        for batch in reader:
            cited = batch.column(0).to_numpy(zero_copy_only=False)
            citing = batch.column(1).to_numpy(zero_copy_only=False)
            rows += len(cited)
            cc = lookup(cited)
            m = (cc >= 0) & (cc < top)
            m[m] = target[cc[m]]
            if not m.any():
                continue
            cc, citing = cc[m], citing[m]
            ic = lookup(citing)
            ok = (ic >= 0) & (ic != cc)
            ok[ok] = ~excluded[ic[ok]]  # ic comes from the o2c map, so ic < top
            cc, citing, ic = cc[ok], citing[ok], ic[ok]
            k_op.append(np.unique((cc << 32) | citing))
            k_cl.append(np.unique((cc << 32) | ic))
            kept += len(cc)
            pending += len(cc)
            if pending > 20_000_000:
                compact()
    except pa.ArrowInvalid:
        if not limit:
            raise
        truncated = True
    compact()
    ops = k_op[0] if k_op else np.zeros(0, np.int64)
    cls = k_cl[0] if k_cl else np.zeros(0, np.int64)
    c1, n1 = np.unique(ops >> 32, return_counts=True)
    c2, n2 = np.unique(cls >> 32, return_counts=True)
    cited_by = dict(zip(c1.tolist(), n1.tolist()))
    cited_cases = dict(zip(c2.tolist(), n2.tolist()))
    import pyarrow as pa2

    tbl = pa2.table({"cluster_id": pa2.array(sel), "cited_by": pa2.array([int(cited_by.get(int(c), 0)) for c in sel], pa2.int32()),
                     "cited_by_cases": pa2.array([int(cited_cases.get(int(c), 0)) for c in sel], pa2.int32())})
    con.execute("DROP TABLE IF EXISTS cited_by")
    con.register("t", tbl)
    con.execute("CREATE TABLE cited_by AS SELECT * FROM t")
    con.unregister("t")
    con.execute("CHECKPOINT")
    con.close()
    rep = {"run": a.run, "source": url, "bytes": size, "rows_read": rows, "links_kept": kept, "truncated_by_limit": truncated,
           "o2c": o2c_source, "clusters": int(len(sel)), "clusters_cited": len(cited_by), "seconds": round(time.time() - t0, 1),
           "built_at": now()}
    write_json(os.path.join(run_dir, "citedby_report.json"), rep)
    print(json.dumps(rep, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
