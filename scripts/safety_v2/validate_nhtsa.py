"""Exact checks of staged NHTSA complaints against NHTSA's own complaints API (a different publication of the same data).

For a random sample of staged complaints: GET https://api.nhtsa.gov/complaints/complaintsByVehicle?make=&model=&modelYear=
for the complaint's first vehicle, find the same ODI number (a vehicle the API does not resolve is skipped and listed),
and compare: date filed (= received), crash, fire, injuries,
deaths, the set of top-level component names, and the description text (whitespace-normalised). Writes
<outdir>/validation.json; exits 1 on any mismatch. Complaints whose vehicle has no model year are skipped (the API needs one).

  python3 -I scripts/safety_v2/validate_nhtsa.py [--outdir DIR] [--n 20] [--seed 1025]
"""
import argparse
import gzip
import json
import random
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402

API = "https://api.nhtsa.gov/complaints/complaintsByVehicle"


def norm(t):
    return re.sub(r"\s+", " ", t or "").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default=str(c.BUILD / "nhtsa"))
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=1025)
    args = ap.parse_args()
    rows = []
    for f in sorted((Path(args.outdir) / "chunks").glob("nhtsa_complaints-*.jsonl.gz")):
        rows += [json.loads(line) for line in gzip.open(f)]
    rnd = random.Random(args.seed)
    pool = [r for r in rows if r["items"] and r["items"][0]["model_year"]]
    http = c.Http(min_interval=1.0, log_path=Path(args.outdir) / "validation_requests.jsonl")
    checks, bad, skipped = [], 0, []
    rnd.shuffle(pool)
    for r in pool:
        if len(checks) >= args.n or len(skipped) > 3 * args.n:
            break
        it = r["items"][0]
        url = API + "?" + urllib.parse.urlencode({"make": it["make"], "model": it["model"], "modelYear": it["model_year"]})
        status, body = http.request(url, allow=(400, 404))
        found = [x for x in (json.loads(body).get("results") or []) if x.get("odiNumber") == r["odino"]] if status == 200 else []
        if not found:
            # the API names some models differently from the flat file (e.g. 'F-150 HYBRID'): not comparable, not a mismatch
            skipped.append({"odino": r["odino"], "status": status, "url": c.public_url(url)})
            continue
        a = found[0]
        filed = a.get("dateComplaintFiled") or ""
        filed_iso = f"{filed[6:10]}-{filed[0:2]}-{filed[3:5]}" if re.fullmatch(r"\d\d/\d\d/\d{4}", filed) else None
        # the API joins component names with commas and some names contain one ("FUEL SYSTEM, GASOLINE"), so both
        # sides are compared as their comma-separated parts
        ours_top = sorted({x.strip() for i in r["items"] if i["component"]
                           for x in i["component"].split(":")[0].split(",") if x.strip()})
        api_top = sorted({x.strip() for x in (a.get("components") or "").split(",") if x.strip()})
        diffs = {}
        if filed_iso != r["received"]:
            diffs["received"] = [r["received"], filed_iso]
        for ours, theirs in (("crash", "crash"), ("fire", "fire"), ("injured", "numberOfInjuries"), ("deaths", "numberOfDeaths")):
            if (r[ours] or 0) != (a.get(theirs) or 0):
                diffs[ours] = [r[ours], a.get(theirs)]
        if ours_top != api_top:
            diffs["components"] = [ours_top, api_top]
        if norm(r["description"]) != norm(a.get("summary")):
            diffs["description"] = [norm(r["description"])[:120], norm(a.get("summary"))[:120]]
        ok = not diffs
        bad += not ok
        checks.append({"odino": r["odino"], "ok": ok, "diffs": diffs, "url": url})
    out = {"checked": len(checks), "mismatches": bad, "skipped_not_in_api": skipped, "at": c.utc_now(), "checks": checks}
    (Path(args.outdir) / "validation.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({"checked": len(checks), "mismatches": bad, "skipped": len(skipped)}))
    if bad:
        for ch in checks:
            if not ch["ok"]:
                print(json.dumps(ch)[:600])
        sys.exit(1)


if __name__ == "__main__":
    main()
