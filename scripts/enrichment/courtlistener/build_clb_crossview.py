"""Build clb_district_crossview: one record per federal district court that lines up the project's official statistics with CourtListener's collection.

Sources (all already built/published by this project): FJC Integrated Database civil series (fjc_civil_districts), U.S. Courts Federal Court
Management Statistics (12 months ending 2025-09-30), CJRA semiannual reports (2025-09-30), judicial-business tables (FY2025), the CourtListener
court profiles and bench dataset. Every metric keeps its own source and period; nothing is imputed. The correlation records are Spearman rank
correlations across the districts that have both values, with a Fisher-z 95% interval; they describe association across 94 courts, not cause.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402

B = os.path.join(ROOT, "private", "build")
OUT = os.path.join(B, "courtlistener")
DATASET = "clb_district_crossview"
FY = 2025
FCMS_PERIOD = "2025-09-30"
CJRA_PERIOD = "2025-09-30"


def load_rows(path: str) -> dict:
    return {r["id"]: r for r in json.load(open(os.path.join(B, path)))["rows"]}


def last(series: dict | None, key: str, idx: int = -1):
    arr = (series or {}).get(key)
    if not isinstance(arr, list) or not arr:
        return None
    try:
        return arr[idx]
    except IndexError:
        return None


# key -> (label, unit, source label, period label)
METRICS = [
    ("fjc_filings", "Civil filings", "cases", "FJC IDB", "FY2025"),
    ("fjc_terminations", "Civil terminations", "cases", "FJC IDB", "FY2025"),
    ("fjc_pending", "Civil cases pending at year end", "cases", "FJC IDB", "FY2025"),
    ("fjc_median_days", "Median days filing to termination (terminated that year)", "days", "FJC IDB", "FY2025"),
    ("fjc_class_action_pct", "Class action share of filings", "percent", "FJC IDB", "FY2025"),
    ("fjc_pro_se_pct", "Pro se plaintiff share of filings", "percent", "FJC IDB", "FY2025"),
    ("fjc_product_pct", "Product liability and health-care injury share of filings", "percent", "FJC IDB (project grouping)", "FY2025"),
    ("fjc_settled_pct", "Settled share of terminations", "percent", "FJC IDB", "FY2025"),
    ("fjc_trial_pct", "Terminated during or after trial, share of terminations", "percent", "FJC IDB", "FY2025"),
    ("fcms_filings", "Total filings (civil and criminal)", "cases", "FCMS", "12 months ending Sept 30, 2025"),
    ("fcms_pending", "Total pending cases", "cases", "FCMS", "12 months ending Sept 30, 2025"),
    ("fcms_judgeships", "Authorized judgeships", "judgeships", "FCMS", "12 months ending Sept 30, 2025"),
    ("fcms_vacant_months", "Vacant judgeship months", "months", "FCMS", "12 months ending Sept 30, 2025"),
    ("fcms_weighted_per_judgeship", "Weighted filings per judgeship", "per judgeship", "FCMS", "12 months ending Sept 30, 2025"),
    ("fcms_pending_per_judgeship", "Pending cases per judgeship", "per judgeship", "FCMS", "12 months ending Sept 30, 2025"),
    ("fcms_median_months_civil", "Median months, civil filing to disposition", "months", "FCMS", "12 months ending Sept 30, 2025"),
    ("fcms_over3y_pct", "Civil cases over 3 years old, share of pending civil caseload", "percent", "FCMS", "12 months ending Sept 30, 2025"),
    ("fcms_trials_per_judgeship", "Trials completed per judgeship", "per judgeship", "FCMS", "12 months ending Sept 30, 2025"),
    ("cjra_civil_3y", "Civil cases pending more than three years", "cases", "CJRA report", "Sept 30, 2025"),
    ("cjra_motions_6m", "Motions pending more than six months", "motions", "CJRA report", "Sept 30, 2025"),
    ("cjra_bench_trials_6m", "Bench trials submitted more than six months", "cases", "CJRA report", "Sept 30, 2025"),
    ("jb_terminated", "Civil cases terminated", "cases", "Judicial Business C-4A", "FY2025"),
    ("jb_trial_rate_pct", "Trial rate (terminated during or after trial / terminated)", "percent", "Judicial Business C-4A", "FY2025"),
    ("jb_mdl_pending", "MDL actions pending in the district", "cases", "Judicial Business S-19", "Sept 30, 2025"),
    ("cl_dockets_total", "Dockets in CourtListener's collection (all years)", "dockets", "CourtListener", "snapshot 2026-09-30"),
    ("cl_civil_fy", "Civil-numbered dockets filed in the fiscal year", "dockets", "CourtListener", "FY2025"),
    ("cl_coverage_ratio", "CourtListener civil-numbered dockets / FJC civil filings", "ratio", "CourtListener and FJC IDB", "FY2025"),
    ("cl_clusters", "Opinion clusters in CourtListener", "clusters", "CourtListener", "snapshot 2026-09-30"),
    ("cl_cited_pct", "Opinion clusters cited at least once", "percent", "CourtListener", "snapshot 2026-09-30"),
    ("bench_active", "Judicial positions with no recorded end date", "positions", "CourtListener people database", "snapshot 2026-09-30"),
    ("bench_women_pct", "Women among those (gender recorded)", "percent", "CourtListener people database", "snapshot 2026-09-30"),
    ("bench_tenure", "Median years served, positions that have ended", "years", "CourtListener people database", "snapshot 2026-09-30"),
]
LABEL = {k: (lab, unit, src, per) for k, lab, unit, src, per in METRICS}

# (metric a, metric b, role, why)
PAIRS = [
    ("fjc_filings", "fcms_filings", "validity", "Two official sources count the same court's workload (civil only vs civil and criminal): a low rank correlation would flag a matching problem."),
    ("fjc_pending", "fcms_pending", "validity", "Pending civil cases (FJC) against total pending cases (FCMS)."),
    ("fjc_terminations", "jb_terminated", "validity", "Civil terminations from two official sources for the same fiscal year."),
    ("fjc_trial_pct", "jb_trial_rate_pct", "validity", "Share of civil terminations during or after trial from FJC IDB and from Judicial Business C-4A."),
    ("fjc_median_days", "fcms_median_months_civil", "validity", "Median time to disposition measured two ways (FJC: cases terminated in the year; FCMS: published median)."),
    ("fcms_vacant_months", "fcms_median_months_civil", "context", "Whether districts with more vacant judgeship months also show longer median civil times."),
    ("fcms_vacant_months", "fcms_pending_per_judgeship", "context", "Whether more vacancy months go with more pending cases per authorized judgeship."),
    ("fcms_weighted_per_judgeship", "fcms_median_months_civil", "context", "Weighted workload per judgeship against median time to civil disposition."),
    ("fcms_weighted_per_judgeship", "cjra_civil_3y", "context", "Workload per judgeship against civil cases pending more than three years."),
    ("fjc_product_pct", "jb_mdl_pending", "context", "Share of filings that are product-liability type against MDL actions pending in the district."),
    ("fjc_product_pct", "fcms_median_months_civil", "context", "Product-liability share of filings against median civil time."),
    ("jb_mdl_pending", "cjra_civil_3y", "context", "MDL actions pending against civil cases pending more than three years."),
    ("fjc_pro_se_pct", "fcms_median_months_civil", "context", "Pro se plaintiff share of filings against median civil time."),
    ("fjc_pro_se_pct", "jb_trial_rate_pct", "context", "Pro se plaintiff share against the trial rate."),
    ("fjc_class_action_pct", "fcms_median_months_civil", "context", "Class action share of filings against median civil time."),
    ("cjra_civil_3y", "fjc_pending", "context", "Civil cases pending more than three years against all pending civil cases."),
    ("cl_coverage_ratio", "fjc_filings", "context", "Whether CourtListener's civil-docket coverage differs between large and small districts."),
    ("cl_cited_pct", "fjc_filings", "context", "Share of a district's opinion clusters that other opinions cite, against the district's size."),
]


fisher_ci = cc.fisher_ci
strength = cc.strength


def facts(pairs):
    return [[k, "Not recorded" if v is None else str(v)] for k, v in pairs]


def build() -> dict[str, dict]:
    fjc = {k: v["item"]["profile"] for k, v in load_rows("fjc_idb/fjc_civil_districts.json").items()}
    fcms = {k.split(":")[0]: v["item"]["fcms"] for k, v in load_rows("uscourts_fcms/fcms_court_profiles.json").items() if k.endswith(":" + FCMS_PERIOD) and v["item"]["fcms"]["kind"] == "district"}
    cjra = {k: v["item"] for k, v in load_rows("uscourts_cjra/court_cjra_districts.json").items()}
    jb = {k: v["item"] for k, v in load_rows("uscourts_caseload/court_jb_districts.json").items()}
    cl = {k: v["item"]["profile"] for k, v in load_rows("courtlistener/clb_court_profiles.json").items()}
    bench = {k: v["item"]["profile"] for k, v in load_rows("courtlistener/clb_court_benches.json").items()}
    ids = sorted(fjc)
    values: dict[str, dict] = {}
    for cid in ids:
        f = fjc[cid]
        s = next((x for x in f["series"] if x["fy"] == FY), None)
        m: dict = {}
        if s and not s.get("partial"):
            m.update(fjc_filings=s["filings"], fjc_terminations=s["terminations"], fjc_pending=s["pending_end"], fjc_median_days=s["median_days"], fjc_class_action_pct=s["class_action_pct"],
                     fjc_pro_se_pct=s["pro_se_plaintiff_pct"], fjc_product_pct=s["product_pct"], fjc_settled_pct=s["settled_pct"], fjc_trial_pct=s["trial_pct"])
        fc = fcms.get(cid)
        if fc:
            sr = fc["series"]
            m.update(fcms_filings=last(sr, "filings"), fcms_pending=last(sr, "pending"), fcms_judgeships=last(sr, "judgeships"), fcms_vacant_months=last(sr, "vacant_judgeship_months"),
                     fcms_weighted_per_judgeship=last(sr, "pj_weighted_filings"), fcms_pending_per_judgeship=last(sr, "pj_pending"), fcms_median_months_civil=last(sr, "median_months_civil"),
                     fcms_over3y_pct=last(sr, "civil_over_3y_pct"), fcms_trials_per_judgeship=last(sr, "pj_trials"))
        cj = cjra.get(cid)
        if cj and CJRA_PERIOD in cj["periods"]:
            i = cj["periods"].index(CJRA_PERIOD)
            m.update(cjra_civil_3y=last(cj["series"], "civil_3y", i), cjra_motions_6m=last(cj["series"], "motions_6m", i), cjra_bench_trials_6m=last(cj["series"], "bench_trials_6m", i))
        j = jb.get(cid)
        if j and FY in j["years"]:
            i = j["years"].index(FY)
            m.update(jb_terminated=last(j["series"], "terminated_total", i), jb_trial_rate_pct=last(j["series"], "trial_rate_pct", i), jb_mdl_pending=last(j["series"], "mdl_pending", i))
        c = cl.get(cid)
        if c:
            d = c.get("dockets") or {}
            cov = c.get("fjc_coverage") or {}
            row = next((r for r in cov.get("by_fy", []) if r["fy"] == FY), None)
            m.update(cl_dockets_total=d.get("total"), cl_civil_fy=row["cl_civil_dockets"] if row else None, cl_coverage_ratio=row["cl_to_fjc_ratio"] if row else None,
                     cl_clusters=(c.get("clusters") or {}).get("total"), cl_cited_pct=(c.get("clusters") or {}).get("cited_pct"))
        b = bench.get(cid)
        if b:
            m.update(bench_active=b["active"], bench_women_pct=b["women_active_pct"], bench_tenure=b["median_tenure_years_ended"])
        values[cid] = {k: v for k, v in m.items() if v is not None}

    ranks: dict = {}
    for key, *_ in METRICS:
        vals = sorted(((v[key], cid) for cid, v in values.items() if key in v), key=lambda t: (-t[0], t[1]))
        n = len(vals)
        for pos, (val, cid) in enumerate(vals):
            first = next(i for i, (x, _) in enumerate(vals) if x == val)  # ties share the best rank
            ranks.setdefault(cid, {})[key] = [first + 1, n]

    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    inputs = [{"url": "https://www.courtlistener.com/help/api/bulk-data/", "path": "published datasets fjc_civil_districts, fcms_court_profiles, court_cjra_districts, court_jb_districts, clb_court_profiles, clb_court_benches (project build files)", "sha256": None}]
    rows = []
    for cid in ids:
        f = fjc[cid]
        v = values[cid]
        r = ranks.get(cid, {})
        cells = {"court": f["name"], "state": f["state"], "circuit": f["circuit"], "fjc_filings": v.get("fjc_filings"), "fjc_median_days": v.get("fjc_median_days"),
                 "fcms_median_months_civil": v.get("fcms_median_months_civil"), "fcms_vacant_months": v.get("fcms_vacant_months"), "cjra_civil_3y": v.get("cjra_civil_3y"),
                 "jb_trial_rate_pct": v.get("jb_trial_rate_pct"), "jb_mdl_pending": v.get("jb_mdl_pending"), "cl_coverage_ratio": v.get("cl_coverage_ratio")}
        metric_rows = [{"key": k, "label": LABEL[k][0], "unit": LABEL[k][1], "source": LABEL[k][2], "period": LABEL[k][3], "value": v[k], "rank": r.get(k)} for k, *_ in METRICS if k in v]
        missing = [LABEL[k][0] for k, *_ in METRICS if k not in v]
        rows.append(writer.record(
            DATASET, cid, f"{f['name']}: official statistics lined up with CourtListener's collection (FY2025)", source_url="https://www.courtlistener.com/help/api/bulk-data/", state=f["state"],
            subtitle=f"{f['circuit']} · {len(metric_rows)} of {len(METRICS)} measures available",
            cells=cells, badges=["Cross-source view", "FY2025", "Each measure keeps its own source"],
            facts=facts([("Court", f["name"]), ("Court id", cid), ("Circuit (court spine id)", f["circuit"]), *[(f"{m['label']} ({m['source']}, {m['period']})", f"{m['value']:,}" + (f" (rank {m['rank'][0]} of {m['rank'][1]})" if m["rank"] else "")) for m in metric_rows],
                         ("Not available", "; ".join(missing) if missing else None), ("Reading", "Ranks are among the districts that have the measure (1 = highest value). Measures come from different sources and periods, each labelled.")]),
            text=f"{f['name']} {cid} district cross source statistics", filters={"circuit": [f["circuit"] or "unknown"], "state": [f["state"] or "unknown"]},
            links=[{"label": "Court profile", "url": f"/courts/{cid}"}, {"label": "FJC civil caseload record", "url": f"/records/fjc_civil_districts/{cid}"},
                   {"label": "CourtListener court statistics", "url": f"/records/clb_court_profiles/{cid}"}],
            extra={"profile": {"court_id": cid, "name": f["name"], "state": f["state"], "circuit": f["circuit"], "metrics": metric_rows}}))
    corr_rows = []
    for a, b, role, why in PAIRS:
        xs, ys = [], []
        for cid in ids:
            va, vb = values[cid].get(a), values[cid].get(b)
            if va is not None and vb is not None:
                xs.append(va)
                ys.append(vb)
        rho, n = cc.spearman(xs, ys)
        if rho is None:
            continue
        ci = fisher_ci(rho, n)
        zero_in = ci is not None and ci[0] <= 0 <= ci[1]
        corr_rows.append({"a": a, "b": b, "role": role, "why": why, "rho": round(rho, 3), "n": n, "ci_low": round(ci[0], 3) if ci else None, "ci_high": round(ci[1], 3) if ci else None,
                          "strength": strength(rho), "interval_includes_zero": zero_in})
    for c in corr_rows:
        la, lb = LABEL[c["a"]], LABEL[c["b"]]
        rows.append(writer.record(
            DATASET, f"corr:{c['a']}|{c['b']}", f"Rank correlation across districts: {la[0]} and {lb[0]}", source_url="https://www.courtlistener.com/help/api/bulk-data/",
            subtitle=f"Spearman ρ = {c['rho']:+.2f} (n = {c['n']}) · {c['strength']} · {'cross-source check' if c['role'] == 'validity' else 'context'}",
            cells={"court": f"{la[0]} × {lb[0]}", "state": None, "circuit": c["role"], "fjc_filings": None, "fjc_median_days": None, "fcms_median_months_civil": None, "fcms_vacant_months": None,
                   "cjra_civil_3y": None, "jb_trial_rate_pct": None, "jb_mdl_pending": None, "cl_coverage_ratio": None, "rho": c["rho"], "n": c["n"]},
            badges=["Cross-source view", "Association, not cause", "Cross-source check" if c["role"] == "validity" else "Context"],
            facts=facts([("Measure A", f"{la[0]} ({la[2]}, {la[3]})"), ("Measure B", f"{lb[0]} ({lb[2]}, {lb[3]})"), ("Spearman rank correlation", f"{c['rho']:+.3f}"), ("Districts with both values", c["n"]),
                         ("95% interval (Fisher z)", f"{c['ci_low']:+.3f} to {c['ci_high']:+.3f}" + (" (includes zero)" if c["interval_includes_zero"] else "")),
                         ("Strength (|ρ|: <0.2 very weak, <0.4 weak, <0.6 moderate, <0.8 strong)", c["strength"]), ("Why this pair", c["why"]),
                         ("Reading", "Descriptive association across districts; it does not show that one measure causes the other, and districts differ in many other ways.")]),
            text=f"correlation {la[0]} {lb[0]} districts", filters={"circuit": [c["role"]], "state": ["unknown"]}, links=[],
            extra={"profile": {"correlation": c, "a": {"key": c["a"], "label": la[0], "unit": la[1], "source": la[2], "period": la[3]}, "b": {"key": c["b"], "label": lb[0], "unit": lb[1], "source": lb[2], "period": lb[3]}}}))
    summary = {
        "source": "Project datasets: FJC Integrated Database civil series, U.S. Courts FCMS, CJRA reports and Judicial Business tables, CourtListener bulk data (docket, cluster, people)", "snapshot": cc.SNAPSHOT,
        "terms": "Each underlying dataset keeps its own source and terms; see their summaries.",
        "metrics": [{"key": k, "label": lab, "unit": unit, "source": src, "period": per} for k, lab, unit, src, per in METRICS],
        "totals": {"districts": len(ids), "correlation_pairs": len(corr_rows)},
        "definitions": {"correlation": "Spearman rank correlation over the districts that have both values; 95% interval from the Fisher z transform with standard error 1/sqrt(n-3)",
                        "strength": "|ρ| under 0.2 very weak or none, under 0.4 weak, under 0.6 moderate, under 0.8 strong, otherwise very strong",
                        "pairs": "a fixed list chosen before computing: 'validity' pairs compare the same concept across two sources, 'context' pairs ask a stated question; no pair was added after seeing results",
                        "periods": "all measures are aligned to fiscal year 2025 (Oct 1, 2024 to Sept 30, 2025) except the CourtListener and people-database snapshot measures"},
        "caveats": ["Rank correlations across 94 districts describe association only.", "Measures differ in scope (civil only vs civil and criminal) and source; the validity pairs show how closely sources agree.",
                    "CourtListener measures describe its collection, not complete court totals."],
        "grain": "one record per federal district court plus one record per correlation pair"}
    return {DATASET: {
        "dataset": DATASET, "label": "District court cross-source view: FJC, FCMS, CJRA, Judicial Business and CourtListener measures with rank correlations (FY2025)",
        "listing_block": writer.listing([("court", "Court / pair"), ("state", "State"), ("circuit", "Circuit / role"), ("fjc_filings", "Civil filings (FJC)"), ("fjc_median_days", "Median days (FJC)"),
                                         ("fcms_median_months_civil", "Median months, civil (FCMS)"), ("fcms_vacant_months", "Vacant judgeship months"), ("cjra_civil_3y", "Civil pending 3+ yrs (CJRA)"),
                                         ("jb_trial_rate_pct", "Trial rate %"), ("jb_mdl_pending", "MDL actions pending"), ("cl_coverage_ratio", "CourtListener / FJC civil"), ("rho", "Spearman ρ"), ("n", "Districts")], []),
        "summary": summary, "rows": rows, "built_at": built_at, "inputs": inputs}}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    out = build()
    for ds, spec in out.items():
        path = os.path.join(OUT, ds + ".json")
        with open(path + ".tmp", "w") as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(ds, len(spec["rows"]), "rows", os.path.getsize(path) // 1024, "KB")
        for r in spec["rows"]:
            if r["id"].startswith("corr:"):
                print("  ", r["item"]["subtitle"], "|", r["title"][40:])


if __name__ == "__main__":
    main()
