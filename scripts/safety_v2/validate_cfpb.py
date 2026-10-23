"""Exact checks of staged CFPB rows against the CFPB complaint API (search endpoint), a different publication of the data.

  aggregates  (company, product, issue, state, month) → API hits.total with the same filters and the month's dates
              (months at least --settled months before the build's latest date, so later publication cannot differ)
  records     complaint id (received in a settled month) → API document: date received, product, sub-product, issue,
              sub-issue, company, state, company response (unless pending), timely; a complaint the API no longer
              publishes is listed separately (a source change after the snapshot, not a parsing error)
Writes <outdir>/validation.json; exits 1 on any mismatch.

  python3 -I scripts/safety_v2/validate_cfpb.py [--outdir DIR] [--n 20] [--seed 1025] [--settled 3]
"""
import argparse
import gzip
import json
import random
import sys
import urllib.parse
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402

API = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/"


def rows(outdir, target):
    out = []
    for f in sorted((Path(outdir) / "chunks").glob(f"{target}-*.jsonl.gz")):
        out += [json.loads(line) for line in gzip.open(f)]
    return out


def month_end(m):
    nxt = c.month_add(m, 1)
    return (date(int(nxt[:4]), int(nxt[5:7]), 1) - timedelta(days=1)).isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default=str(c.BUILD / "cfpb"))
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=1025)
    ap.add_argument("--settled", type=int, default=3)
    args = ap.parse_args()
    manifest = json.loads((Path(args.outdir) / "manifest.json").read_text())
    latest = manifest["inputs"]["latest_received"][:7]
    cutoff = c.month_add(latest, -args.settled)
    rnd = random.Random(args.seed)
    http = c.Http(min_interval=1.0, log_path=Path(args.outdir) / "validation_requests.jsonl")
    checks, bad = [], 0
    agg = [r for r in rows(args.outdir, "cfpb_monthly") if r["month"] <= cutoff and r["state"]]
    for r in rnd.sample(agg, min(args.n, len(agg))):
        q = {"company": r["company"], "product": r["product"], "issue": r["issue"], "state": r["state"],
             "date_received_min": f"{r['month']}-01", "date_received_max": month_end(r["month"]), "size": 0, "no_aggs": "true"}
        url = API + "?" + urllib.parse.urlencode(q)
        status, body = http.request(url)
        got = json.loads(body)["hits"]["total"]["value"]
        ok = got == r["complaints"]
        bad += not ok
        checks.append({"kind": "aggregate", "key": r, "source": got, "ok": ok, "url": url})
    recs = [r for r in rows(args.outdir, "cfpb_complaints") if r["date_received"][:7] <= cutoff]
    removed = []
    for r in rnd.sample(recs, min(args.n // 2, len(recs))):
        url = API + str(r["complaint_id"])
        status, body = http.request(url)
        doc = json.loads(body)
        hits = doc.get("hits", {}).get("hits") or []
        src = hits[0]["_source"] if hits else doc.get("_source", {})
        if not src:
            removed.append({"complaint_id": r["complaint_id"], "url": url})  # no longer published: a source change, listed
            continue
        diffs = {}
        pairs = (("date_received", (src.get("date_received") or "")[:10]), ("product", src.get("product")),
                 ("sub_product", src.get("sub_product") or ""), ("issue", src.get("issue")), ("sub_issue", src.get("sub_issue") or ""),
                 ("company", src.get("company")), ("state", src.get("state")), ("company_response", src.get("company_response")),
                 ("timely", {"Yes": True, "No": False}.get(src.get("timely"))))
        for k, theirs in pairs:
            if k == "company_response" and "In progress" in (r.get(k), theirs):
                continue  # a pending response changes after the snapshot
            if (r.get(k) or None) != (theirs or None) and not (k == "timely" and r.get(k) == theirs):
                diffs[k] = [r.get(k), theirs]
        ok = not diffs
        bad += not ok
        checks.append({"kind": "record", "complaint_id": r["complaint_id"], "ok": ok, "diffs": diffs, "url": url})
    out = {"checked": len(checks), "mismatches": bad, "settled_through": cutoff, "no_longer_published": removed,
           "at": c.utc_now(), "checks": checks}
    (Path(args.outdir) / "validation.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({"checked": len(checks), "mismatches": bad, "no_longer_published": len(removed)}))
    if bad:
        for ch in checks:
            if not ch["ok"]:
                print(json.dumps(ch)[:700])
        sys.exit(1)


if __name__ == "__main__":
    main()
