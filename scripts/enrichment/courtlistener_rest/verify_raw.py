"""Independent second path from the raw bulk files: re-stream them with the plain `bzip2 -dc` reader (cl_stream) and Python's csv module
(no pyarrow, no pbz2 block splitting, no DuckDB) and recount what the bankruptcy and unmatched-citation datasets publish.

    python3 -I -B verify_raw.py [bankruptcy] [unmatched]

Writes private/build/courtlistener_rest/verify_raw_<name>.json with every comparison and the mismatch count.
Bankruptcy (per court): rows, rows with a termination date in range, rows with an assigned judge id, and, for three courts, the median
days to termination. Unmatched: rows by status and by type, and rows per listed reporter.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import statistics
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import cl_stream as cl  # noqa: E402

csv.field_size_limit(1 << 30)
LO = dt.date(1700, 1, 1)
MEDIAN_COURTS = ("cacb", "ganb", "vtb")


def rows_of(name: str):
    r = cl.decompressed_reader(name, cl.StreamStats())
    text = io.TextIOWrapper(r.proc.stdout, encoding="utf-8", errors="replace", newline="")
    rd = csv.reader(text, quotechar='"', escapechar=chr(92), doublequote=False)
    header = next(rd)
    n_bad = 0
    for row in rd:
        if len(row) != len(header):
            n_bad += 1
            continue
        yield header, row
    yield header, None  # sentinel carrying the bad-row count through `bad`
    rows_of.bad = n_bad  # type: ignore[attr-defined]


def day(s: str, hi: dt.date):
    try:
        d = dt.date.fromisoformat(s[:10])
    except ValueError:
        return None
    return d if LO <= d <= hi else None


def bankruptcy() -> dict:
    hi = dt.date(2022, 9, 19)
    n, term, judge = Counter(), Counter(), Counter()
    durs = defaultdict(list)
    ix = None
    total = 0
    for header, row in rows_of("randoms/bankruptcy-dockets-2022-09-19.csv.bz2"):
        if row is None:
            break
        if ix is None:
            ix = {k: i for i, k in enumerate(header)}
        total += 1
        c = row[ix["court_id"]]
        n[c] += 1
        f = day(row[ix["date_filed"]], hi)
        t = day(row[ix["date_terminated"]], hi)
        if t:
            term[c] += 1
        if row[ix["assigned_to_id"]].strip():
            judge[c] += 1
        if c in MEDIAN_COURTS and f and t and t >= f:
            durs[c].append((t - f).days)
    spec = json.load(open(os.path.join(rc.OUT, "clb_bankruptcy_courts.json")))
    prof = {r["id"]: r["item"]["profile"] for r in spec["rows"]}
    checks = []

    def check(fig, where, raw, shown):
        checks.append({"figure": fig, "where": where, "raw": raw, "displayed": shown, "match": raw == shown})

    check("rows in file (csv rows with the header's column count)", "overview", total, prof["overview:all"]["dockets_in_file"])
    for cid, p in prof.items():
        if cid == "overview:all":
            continue
        check("dockets", cid, n[cid], p["dockets"])
        check("terminated", cid, term[cid], p["terminated"])
        check("with judge id", cid, judge[cid], p["with_judge_id"])
    for cid in MEDIAN_COURTS:
        if cid in prof and prof[cid]["duration_days"]:
            check("median days to termination", cid, float(statistics.median(durs[cid])), prof[cid]["duration_days"]["p50"])
            check("n with duration", cid, len(durs[cid]), prof[cid]["duration_days"]["n"])
    return {"rows_read": total, "bad_rows": getattr(rows_of, "bad", None), "checks": checks}


def unmatched() -> dict:
    st, ty, rep = Counter(), Counter(), Counter()
    total = 0
    ix = None
    for header, row in rows_of("unmatched-citations-2026-09-30.csv.bz2"):
        if row is None:
            break
        if ix is None:
            ix = {k: i for i, k in enumerate(header)}
        total += 1
        st[int(row[ix["status"]])] += 1
        ty[int(row[ix["type"]])] += 1
        rep[row[ix["reporter"]][:60]] += 1
    spec = json.load(open(os.path.join(rc.OUT, "clb_unmatched_citations.json")))
    prof = {r["id"]: r["item"]["profile"] for r in spec["rows"]}
    ov = prof["overview:all"]
    checks = []

    def check(fig, where, raw, shown):
        checks.append({"figure": fig, "where": where, "raw": raw, "displayed": shown, "match": raw == shown})

    check("rows", "overview", total, ov["citations"])
    for s in ov["statuses"]:
        check(f"status {s['code']}", "overview", st[s["code"]], s["n"])
    for t in ov["types"]:
        check(f"type {t['code']}", "overview", ty[t["code"]], t["n"])
    for rid, p in prof.items():
        if rid.startswith("reporter:"):
            check("citations", rid, rep[p["reporter"]], p["citations"])
    return {"rows_read": total, "bad_rows": getattr(rows_of, "bad", None), "checks": checks}


def main(argv) -> int:
    names = argv or ["bankruptcy", "unmatched"]
    bad_total = 0
    for name in names:
        t0 = time.time()
        res = {"bankruptcy": bankruptcy, "unmatched": unmatched}[name]()
        bad = [c for c in res["checks"] if not c["match"]]
        bad_total += len(bad)
        res.update({"method": "sequential bzip2 -dc + Python csv over the raw bulk file", "seconds": round(time.time() - t0, 1), "comparisons": len(res["checks"]), "mismatches": len(bad)})
        with open(os.path.join(rc.OUT, f"verify_raw_{name}.json"), "w") as h:
            json.dump(res, h, indent=1, default=str)
        print(name, res["comparisons"], "comparisons;", len(bad), "mismatches;", res["seconds"], "s", flush=True)
        for c in bad[:20]:
            print("  MISMATCH", c)
    return 1 if bad_total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
