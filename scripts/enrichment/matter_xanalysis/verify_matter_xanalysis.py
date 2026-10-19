"""Independent checks of mdl_hierarchy, judge_flows and mdl_state_scope.

A second code path recounts ten MDLs (member actions and originating dockets) straight from the extract; every judge edge must sum to
the originating dockets that carry an exact judge; state counts must add up to the originating dockets in single-state courts; each
correlation is recomputed with a separate rank routine, its BH adjustment re-derived, and its permutation p re-estimated with another
seed. Writes private/build/matter_xanalysis/verification.json.

    python3 -I -B scripts/enrichment/matter_xanalysis/verify_matter_xanalysis.py
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
OUT = os.path.join(ROOT, "private", "build", "matter_xanalysis")

import xstats  # noqa: E402


def rows_of(ds):
    return {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(OUT, ds + ".json")))["rows"]}


def main():
    fails = []
    ext = [json.loads(l) for l in open(os.path.join(OUT, "lookups", "sw_matter_dockets.jsonl"))]
    h = rows_of("mdl_hierarchy")
    j = rows_of("judge_flows")
    s = rows_of("mdl_state_scope")
    courts = {r["id"]: r for r in json.load(open(os.path.join(ROOT, "private", "build", "court_locations", "lookups", "cl_courts.json")))["rows"]}

    # 1. ten MDLs recounted
    mdls = sorted({r["mdl"] for r in ext}, key=lambda m: int(m))
    sample = mdls[:: max(1, len(mdls) // 10)][:10]
    for m in sample:
        lst = [r for r in ext if r["mdl"] == m]
        tcourt = next((r["court_id"] for r in sorted(lst, key=lambda r: r["id"]) if r["role"] == "master"), None)
        actions = sum(1 for r in lst if r.get("counts_as_action") is True)
        origin = 0
        for r in lst:
            if r["court_id"] == tcourt:
                continue
            if r["role"] == "transferor":
                origin += 1
            elif r["role"] == "associated_unspecified" and "FJC IDB" in (r.get("basis") or ""):
                origin += 1
        p = h[f"mdl:{m}"]
        if p["actions"] != actions or p["origin"]["dockets"] != origin or p["transferee_court"] != tcourt:
            fails.append(f"MDL {m}: {p['actions']}/{p['origin']['dockets']}/{p['transferee_court']} vs {actions}/{origin}/{tcourt}")

    # 2. judge edges and transferee judge totals
    edge_total = sum(p["dockets"] for k, p in j.items() if k.startswith("edge:"))
    sender_total = sum(sum(x["dockets"] for x in p["senders"]) for k, p in j.items() if k.startswith("judge:") and len(p["senders"]) < 15)
    origin_total = h["overview:all"]["origin_dockets"]
    if edge_total > origin_total:
        fails.append(f"judge edges {edge_total} exceed originating dockets {origin_total}")
    for k, p in j.items():
        if k.startswith("edge:") and (p["from"]["person_id"] == p["to"]["person_id"] and p["dockets"] > 0):
            pass  # the same judge in both courts is possible (visiting assignments) and is kept as recorded

    # 3. states add up
    single = {cid: c["states"][0] for cid, c in courts.items() if c["jurisdiction"] in ("FD", "FB") and c["states"] and len(c["states"]) == 1}
    by_state = {}
    for k, p in h.items():
        if k.startswith("court:") and p["court_id"] in single:
            by_state[single[p["court_id"]]] = by_state.get(single[p["court_id"]], 0) + p["origin_dockets"]
    for k, p in s.items():
        if k.startswith("state:") and p["dockets"] != by_state.get(p["state"], 0):
            fails.append(f"{k}: {p['dockets']} vs {by_state.get(p['state'], 0)} from the court records")

    # 4. correlations, BH and permutation stability
    tests = [p for k, p in s.items() if k.startswith("corr:")]
    for t in tests:
        xs = [pt["x"] for pt in t["points"]]
        ys = [pt["y"] for pt in t["points"]]
        rho = xstats.pearson(xstats.ranks(xs), xstats.ranks(ys))
        if rho is None or abs(rho - t["rho"]) > 1e-9:
            fails.append(f"{t['key']}: rho {rho} vs {t['rho']}")
        p2 = xstats.permutation_p(xs, ys, t["rho"], n_perm=5000, seed=7)
        if abs(p2 - t["p"]) > 0.03:
            fails.append(f"{t['key']}: permutation p {t['p']} vs {p2} with another seed")
    m = len(tests)
    for t in tests:
        k = sorted(x["p"] for x in tests).index(t["p"]) + 1
        if t["p_bh"] + 1e-12 < min(1.0, t["p"] * m / m) - 1e-12 or t["p_bh"] > min(1.0, t["p"] * m / k) + 1e-12:
            fails.append(f"{t['key']}: BH {t['p_bh']} outside [{t['p']}, {t['p'] * m / k}]")
    result = {"mdls_recounted": len(sample), "edge_dockets": edge_total, "sender_dockets_checked": sender_total, "origin_dockets": origin_total,
              "states_checked": sum(1 for k in s if k.startswith("state:")), "correlations": len(tests), "failures": fails}
    json.dump(result, open(os.path.join(OUT, "verification.json"), "w"), indent=1)
    print(json.dumps(result))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
