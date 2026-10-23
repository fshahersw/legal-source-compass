"""Exact checks of the openFDA build against independent source responses (bounded sample).

For a random sample of stored values, a DIFFERENT request is sent and its answer must equal the stored number:
  series      (subject, series, month) → search = the subject's search (+ the series clause) AND <date field> in that
              month, limit=1; meta.results.total must equal the stored monthly value (count aggregation vs search total).
  breakdowns  (subject, dim, period, term) → search + the term (exact) + the period window; total = stored value
              (and, for FAERS, + serious:1 = stored serious when stored).
  records     a MAUDE report re-read by report_number: date_received, event_type, product codes, event text equal.
Writes <outdir>/validation.json and exits 1 on any mismatch.

  python3 -I scripts/safety_v2/validate_openfda.py [--outdir DIR] [--n 30] [--seed 1025]
"""
import argparse
import gzip
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
import openfda_build as ob  # noqa: E402

SERIES = {s: (x, "drug/event.json", "receivedate", "faers") for s, x, _ in ob.FAERS_SERIES}
SERIES.update({s: (x, "device/event.json", "date_received", "maude") for s, x, _ in ob.MAUDE_SERIES})
DIMS = {"meddra_pt": ("patient.reaction.reactionmeddrapt.exact", "drug/event.json", "receivedate", "faers"),
        "device_problem": ("product_problems.exact", "device/event.json", "date_received", "maude"),
        "patient_problem": ("patient.patient_problems.exact", "device/event.json", "date_received", "maude"),
        "manufacturer": ("device.manufacturer_d_name.exact", "device/event.json", "date_received", "maude"),
        "brand_name": ("device.brand_name.exact", "device/event.json", "date_received", "maude")}


def rows_of(outdir, stream, target):
    out = []
    for f in sorted((Path(outdir) / stream / "chunks").glob(f"{target}-*.jsonl.gz")):
        out += [json.loads(line) for line in gzip.open(f)]
    return out


def month_window(m):
    end = c.month_add(m, 1)
    from datetime import date, timedelta
    last = date(int(end[:4]), int(end[5:7]), 1) - timedelta(days=1)
    return m.replace("-", "") + "01", last.strftime("%Y%m%d")


def total(run_http, key, endpoint, search):
    data, url = c.openfda_get(run_http, c.openfda_query(endpoint, search=search, limit=1), key)
    return (0 if data is None else data["meta"]["results"]["total"]), url


def quote(term):
    return '"' + term.replace('"', '\\"') + '"'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default=str(c.BUILD / "openfda"))
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=1025)
    args = ap.parse_args()
    rnd = random.Random(args.seed)
    key = c.openfda_key()
    http = c.Http(min_interval=0.3, log_path=Path(args.outdir) / "validation_requests.jsonl")
    plan = json.loads((Path(args.outdir) / "subjects" / "plan.json").read_text())
    subj = {s["id"]: s for s in plan["subjects"]}
    checks, bad = [], 0

    for stream in ("faers", "maude"):
        series = [(r, i) for r in rows_of(args.outdir, stream, "series") if r["series"] in SERIES for i in range(len(r["vals"]))]
        for r, i in rnd.sample(series, min(args.n, len(series))):
            extra, endpoint, field, src = SERIES[r["series"]]
            month = c.month_add(r["coverage_from"], i)
            a, b = month_window(month)
            search = ob.and_clause(ob.and_clause(subj[r["subject_id"]]["search"][src], extra), f"{field}:[{a}+TO+{b}]")
            got, url = total(http, key, endpoint, search)
            ok = got == r["vals"][i]
            bad += not ok
            checks.append({"kind": "series", "subject": r["subject_id"], "series": r["series"], "month": month,
                           "stored": r["vals"][i], "source": got, "ok": ok, "url": url})
        brk = [(r, i) for r in rows_of(args.outdir, stream, "breakdowns") if r["dim"] in DIMS for i in range(len(r["terms"])) if r["terms"][i]]
        for r, i in rnd.sample(brk, min(args.n, len(brk))):
            field, endpoint, datefield, src = DIMS[r["dim"]]
            term, value = r["terms"][i], r["vals"][i]
            stored_serious = (r.get("serious") or [None] * len(r["vals"]))[i]
            search = ob.and_clause(subj[r["subject_id"]]["search"][src], f"{field}:{quote(term)}")
            if r["period"] != "all":
                a, b = ob.period_bounds(r["period"])
                search = ob.and_clause(search, f"{datefield}:[{a}+TO+{b}]")
            got, url = total(http, key, endpoint, search)
            ok = got == value
            entry = {"kind": "breakdown", "subject": r["subject_id"], "dim": r["dim"], "period": r["period"], "term": term,
                     "stored": value, "source": got, "ok": ok, "url": url}
            if ok and stored_serious is not None:
                sgot, _ = total(http, key, endpoint, ob.and_clause(search, "serious:1"))
                entry.update({"stored_serious": stored_serious, "source_serious": sgot})
                ok = sgot == stored_serious
                entry["ok"] = ok
            bad += not ok
            checks.append(entry)

    recs = rows_of(args.outdir, "records", "maude_reports")
    for r in rnd.sample(recs, min(args.n // 2, len(recs))):
        data, url = c.openfda_get(http, c.openfda_query("device/event.json", search=f'report_number:"{r["report_number"]}"', limit=5), key)
        fresh = [ob.maude_record(x, r["retrieved_on"]) for x in (data or {}).get("results", [])]
        same = [x for x in fresh if x["report_number"] == r["report_number"]]
        fields = ("date_received", "event_type", "product_codes", "brand_names", "event_text", "device_problems")
        ok = bool(same) and all(same[0][f] == r[f] for f in fields)
        bad += not ok
        checks.append({"kind": "record", "report_number": r["report_number"], "ok": ok, "url": url,
                       "differs": [] if not same else [f for f in fields if same[0][f] != r[f]]})

    out = {"checked": len(checks), "mismatches": bad, "at": c.utc_now(), "checks": checks}
    (Path(args.outdir) / "validation.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({"checked": len(checks), "mismatches": bad}))
    if bad:
        for ch in checks:
            if not ch["ok"]:
                print(json.dumps(ch))
        sys.exit(1)


if __name__ == "__main__":
    main()
