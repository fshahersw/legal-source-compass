"""Independent spot check of clb_district_crossview.

* values: re-read from the formatted text facts of the FCMS and judicial-business records (a different path from the series arrays the builder reads);
* ranks: compared with the ranks the FJC dataset already published for the same measure;
* correlations: recomputed with numpy (average ranks via np.unique) from the per-district values stored in the dataset.
Writes private/build/courtlistener/spot_checks_crossview.json.
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
import numpy as np  # noqa: E402

B = os.path.join(ROOT, "private", "build")


def rows(path):
    return {r["id"]: r for r in json.load(open(os.path.join(B, path)))["rows"]}


def num(text):
    m = re.match(r"\s*([-+]?[0-9][0-9,]*\.?[0-9]*)", str(text))
    return float(m.group(1).replace(",", "")) if m else None


def avg_ranks(values):
    arr = np.asarray(values, dtype=float)
    _, inv, counts = np.unique(arr, return_inverse=True, return_counts=True)
    ends = np.cumsum(counts)
    starts = ends - counts + 1
    return ((starts + ends) / 2.0)[inv]


def main() -> int:
    cv = rows("courtlistener/clb_district_crossview.json")
    fcms = rows("uscourts_fcms/fcms_court_profiles.json")
    jb = rows("uscourts_caseload/court_jb_districts.json")
    fjc = rows("fjc_idb/fjc_civil_districts.json")
    checks = []

    def check(what, where, mine, shown, tol=1e-9):
        ok = (mine is not None and shown is not None and abs(float(mine) - float(shown)) <= tol) if isinstance(mine, (int, float)) or isinstance(shown, (int, float)) else mine == shown
        checks.append({"figure": what, "where": where, "recomputed": mine, "displayed": shown, "match": bool(ok)})

    districts = [k for k in cv if not k.startswith("corr:")]
    check("districts", "clb_district_crossview", 94, len(districts))
    sample = districts[::5] + ["cand", "nysd", "txsd", "vid", "gud"]
    for cid in sorted(set(sample)):
        if cid not in cv:
            continue
        m = {x["key"]: x for x in cv[cid]["item"]["profile"]["metrics"]}
        facts = dict((k, v) for k, v in fcms[f"{cid}:2025-09-30"]["detail"]["facts"])
        for key, label in (("fcms_judgeships", "Authorized judgeships (count)"), ("fcms_vacant_months", "Vacant judgeship months (months)"),
                           ("fcms_median_months_civil", "Median months, civil filing to disposition (months)"), ("fcms_weighted_per_judgeship", "Weighted filings per judgeship (per judgeship)"),
                           ("fcms_pending", "Pending cases (count)"), ("fcms_filings", "Filings (count)")):
            text = facts.get(label)
            mine = num(text) if text and "Not recorded" not in text else None
            shown = m.get(key, {}).get("value")
            if mine is None and shown is None:
                check(f"{key} (not published)", f"{cid}", True, True)
            else:
                check(key, f"{cid}", mine, shown, 0.051 if key in ("fcms_vacant_months", "fcms_median_months_civil") else 0.0)
        jf = dict((k, v) for k, v in jb[cid]["detail"]["facts"])
        check("jb_terminated", cid, num(jf.get("Civil cases terminated (C-4A)")), m.get("jb_terminated", {}).get("value"))
        check("jb_mdl_pending", cid, num(jf.get("MDL actions pending in the district (S-19)")), m.get("jb_mdl_pending", {}).get("value"))
        fr = fjc[cid]["item"]["profile"]["ranks"]
        if "fjc_filings" in m and m["fjc_filings"]["rank"] and "filings" in fr:
            check("rank of civil filings agrees with the FJC dataset's published rank", cid, fr["filings"][0], m["fjc_filings"]["rank"][0])
        if "fjc_pending" in m and m["fjc_pending"]["rank"] and "pending_end" in fr:
            check("rank of pending civil cases agrees with the FJC dataset's published rank", cid, fr["pending_end"][0], m["fjc_pending"]["rank"][0])
    per = {cid: {x["key"]: x["value"] for x in cv[cid]["item"]["profile"]["metrics"]} for cid in districts}
    for rid, r in cv.items():
        if not rid.startswith("corr:"):
            continue
        c = r["item"]["profile"]["correlation"]
        pairs = [(per[cid][c["a"]], per[cid][c["b"]]) for cid in districts if c["a"] in per[cid] and c["b"] in per[cid]]
        xs, ys = zip(*pairs)
        rho = float(np.corrcoef(avg_ranks(xs), avg_ranks(ys))[0, 1])
        check("Spearman rho", rid, round(rho, 3), c["rho"], 0.0011)
        check("n", rid, len(pairs), c["n"])
        z, se = np.arctanh(rho), 1 / np.sqrt(len(pairs) - 3)
        check("interval low", rid, round(float(np.tanh(z - 1.96 * se)), 3), c["ci_low"], 0.0011)
        check("interval high", rid, round(float(np.tanh(z + 1.96 * se)), 3), c["ci_high"], 0.0011)
    bad = [c for c in checks if not c["match"]]
    with open(os.path.join(B, "courtlistener", "spot_checks_crossview.json"), "w") as h:
        json.dump({"method": "formatted facts text of the source records, published FJC ranks, and a numpy Spearman", "checks": len(checks), "mismatches": len(bad), "details": checks}, h, indent=1, default=str)
    print(f"{len(checks)} figures recomputed; {len(bad)} mismatches")
    for c in bad[:20]:
        print("MISMATCH", c)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
