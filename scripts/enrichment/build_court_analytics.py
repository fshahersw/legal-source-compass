"""Build federal district court analytics from US Courts FCMS caseload profiles and JPML MDL data.

Inputs (private/acq/jpml): fcms_na_distprofile0630.2026.json and .2025.json (parse_fcms.py),
actions_series.json and mdl_meta.json (JPML parsers). Output dataset: court_analytics, keyed by court_spine id.
"""
import json
import sys
from bisect import bisect_left
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import corpus_writer as cw  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ACQ = ROOT / "private" / "acq" / "jpml"
FCMS_URL = "https://www.uscourts.gov/data-news/reports/statistical-reports/federal-court-management-statistics/federal-court-management-statistics-june-2026"
FCMS_PDF = "https://www.uscourts.gov/sites/default/files/document/fcms_na_distprofile0630.2026.pdf"

LABELS = {
    "filings": "Filings",
    "terminations": "Terminations",
    "pending": "Pending cases",
    "judgeships": "Judgeships",
    "vacant_judgeship_months": "Vacant judgeship months",
    "per_judge_total": "Filings per judgeship",
    "per_judge_civil": "Civil filings per judgeship",
    "per_judge_felony": "Felony filings per judgeship",
    "per_judge_pending": "Pending cases per judgeship",
    "per_judge_weighted_filings": "Weighted filings per judgeship",
    "per_judge_terminations": "Terminations per judgeship",
    "per_judge_trials": "Trials completed per judgeship",
    "median_months_felony": "Median months, felony filing to disposition",
    "median_months_civil": "Median months, civil filing to disposition",
    "median_months_civil_to_trial": "Median months, civil filing to trial",
    "civil_over_3y_count": "Civil cases over 3 years old",
    "civil_over_3y_pct": "Percent of civil cases over 3 years old",
}
# Lower is better for these when ranking speed/backlog.
LOWER_IS_BETTER = {"median_months_felony", "median_months_civil", "median_months_civil_to_trial", "civil_over_3y_pct", "per_judge_pending", "vacant_judgeship_months"}


def jpml_to_court_id(code: str):
    code = code.strip().upper()
    if code == "DC":
        return "dcd"
    if len(code) == 2:
        return code.lower() + "d"
    if len(code) == 3:
        return code.lower() + "d"
    return None


def latest(values):
    return next((v for v in reversed(values or []) if v is not None), None)


def fmt(v, digits=0):
    if v is None:
        return "Not recorded"
    if digits:
        return f"{v:,.{digits}f}"
    return f"{int(round(v)):,}"


def percentile(sorted_values, value):
    if value is None or not sorted_values:
        return None
    return round(100 * bisect_left(sorted_values, value) / max(1, len(sorted_values) - 1))


def main():
    current = json.loads((ACQ / "fcms_na_distprofile0630.2026.json").read_text())
    prior = {p["court_id"]: p for p in json.loads((ACQ / "fcms_na_distprofile0630.2025.json").read_text())}
    series = json.loads((ACQ / "actions_series.json").read_text())
    meta = json.loads((ACQ / "mdl_meta.json").read_text())
    report_dates = sorted(r["date"] for r in series["reports"])
    as_of = report_dates[-1]
    types = {r["mdl"]: r["mdl_type"] for r in meta["active_by_type"]}

    mdls_by_court = {}
    for entry in series["mdls"]:
        point = entry["points"].get(as_of)
        if not point:
            continue
        cid = jpml_to_court_id(point["district"] or "")
        mdls_by_court.setdefault(cid, []).append({
            "mdl": entry["mdl"], "title": entry["title"], "pending": point["pending"], "total": point["total"],
            "judge": point["judge"], "type": types.get(entry["mdl"]),
        })

    districts = [p for p in current if p["court_id"]]
    national = next(p for p in current if not p["court_id"])
    distributions = {}
    for key in LABELS:
        values = sorted(v for v in (latest(p["metrics"].get(key)) for p in districts) if v is not None)
        distributions[key] = values

    rows = []
    for p in districts:
        cid = p["court_id"]
        m = p["metrics"]
        prev = prior.get(cid)
        latest_vals = {k: latest(m.get(k)) for k in LABELS}
        pct = {}
        for key, value in latest_vals.items():
            raw = percentile(distributions[key], value)
            if raw is not None:
                pct[key] = 100 - raw if key in LOWER_IS_BETTER else raw
        nos_now = p["nature_of_suit"]["civil"]
        nos_prev = (prev or {}).get("nature_of_suit", {}).get("civil", {})
        nos = [
            {"category": cat, "filings": v, "prior": nos_prev.get(cat),
             "change_pct": round(100 * (v - nos_prev[cat]) / nos_prev[cat], 1) if nos_prev.get(cat) else None}
            for cat, v in nos_now.items()
        ]
        pi = next((x for x in nos if x["category"].startswith("Personal Injury")), None)
        mdls = sorted(mdls_by_court.get(cid, []), key=lambda x: -x["pending"])
        mdl_actions = sum(x["pending"] for x in mdls)
        title = f"U.S. District Court, {p['name'].title()}"
        facts = [["Court ID", cid], ["Reporting period", "12 months ending June 30, 2026 (FCMS)"]]
        for key, label in LABELS.items():
            value = latest_vals[key]
            digits = 1 if key.startswith("median") or key.endswith("_pct") or key == "vacant_judgeship_months" else 0
            facts.append([label, fmt(value, digits)])
        standing = p.get("standing", {})
        for key, label in (("filings", "National rank, filing growth"), ("median_months_civil", "National rank, civil time to disposition"), ("median_months_civil_to_trial", "National rank, civil time to trial")):
            if key in standing and standing[key].get("us") is not None:
                facts.append([label, f"{int(standing[key]['us'])} of 94 (circuit rank {int(standing[key]['circuit']) if standing[key].get('circuit') is not None else 'not recorded'})"])
        if pi:
            facts.append(["Personal injury / product liability filings", f"{fmt(pi['filings'])} ({'+' if (pi['change_pct'] or 0) > 0 else ''}{pi['change_pct']}% vs prior year)" if pi["change_pct"] is not None else fmt(pi["filings"])])
        facts.append(["Pending MDLs (JPML)", f"{len(mdls)} dockets, {mdl_actions:,} actions as of {as_of}"])
        facts.append(["Source", "Administrative Office of the U.S. Courts, Federal Court Management Statistics, June 2026; JPML pending MDL reports"])
        cells = {
            "court": title, "filings": fmt(latest_vals["filings"]), "pending": fmt(latest_vals["pending"]),
            "judgeships": fmt(latest_vals["judgeships"]), "civil_median": fmt(latest_vals["median_months_civil"], 1),
            "trial_median": fmt(latest_vals["median_months_civil_to_trial"], 1), "over_3y": f"{fmt(latest_vals['civil_over_3y_pct'], 1)}%",
            "mdls": str(len(mdls)),
        }
        badges = [b for b in [
            f"{len(mdls)} pending MDLs" if mdls else None,
            "Among the slowest civil dockets" if pct.get("median_months_civil", 50) <= 10 else None,
            "Among the fastest civil dockets" if pct.get("median_months_civil", 50) >= 90 else None,
            "High civil backlog" if pct.get("civil_over_3y_pct", 50) <= 10 else None,
        ] if b]
        rows.append(cw.record(
            "court_analytics", cid, title, source_url=FCMS_PDF,
            subtitle=f"{fmt(latest_vals['judgeships'])} judgeships · {fmt(latest_vals['filings'])} filings · {fmt(latest_vals['pending'])} pending · June 2026",
            cells=cells, facts=facts, badges=badges,
            links=[{"url": f"/courts/{cid}", "label": "Court profile"}, {"url": FCMS_URL, "label": "US Courts FCMS, June 2026"}],
            text=f"{p['name']} district court caseload statistics",
            filters={"court": [cid], "mdl_court": ["yes" if mdls else "no"], "date": "2026-06-30"},
            extra={
                "kind": "district",
                "analytics": {
                    "court_id": cid, "name": p["name"], "years": p["years"], "metrics": m, "standing": standing,
                    "percentile": pct, "nature_of_suit": nos, "criminal": p["nature_of_suit"].get("criminal", {}),
                    "civil_total": p["nature_of_suit"].get("civil_total"), "mdls": mdls, "mdl_actions": mdl_actions,
                    "mdl_as_of": as_of,
                },
            },
        ))
    rows.append(cw.record(
        "court_analytics", "summary:national", "U.S. District Courts — national caseload profile", source_url=FCMS_PDF,
        subtitle="All 94 districts · 12 months ending June 30, 2026",
        cells={"court": "All districts", "filings": fmt(latest(national["metrics"]["filings"])), "pending": fmt(latest(national["metrics"]["pending"])),
               "judgeships": fmt(latest(national["metrics"]["judgeships"])), "civil_median": fmt(latest(national["metrics"]["median_months_civil"]), 1),
               "trial_median": fmt(latest(national["metrics"]["median_months_civil_to_trial"]), 1),
               "over_3y": f"{fmt(latest(national['metrics']['civil_over_3y_pct']), 1)}%", "mdls": "—"},
        facts=[[LABELS[k], fmt(latest(national["metrics"].get(k)), 1 if k.startswith("median") or k.endswith("_pct") else 0)] for k in LABELS if national["metrics"].get(k)],
        text="national district courts caseload", filters={"_listing": ["no"], "kind": ["summary"]},
        extra={"kind": "national", "analytics": {"years": national["years"], "metrics": national["metrics"], "nature_of_suit": national["nature_of_suit"], "distributions": {k: {"min": v[0], "median": v[len(v) // 2], "max": v[-1]} for k, v in distributions.items() if v}}},
    ))
    cw.publish(
        "court_analytics", "Federal district court caseload analytics (US Courts FCMS, June 2026)", rows,
        listing_block=cw.listing(
            [("court", "Court"), ("judgeships", "Judgeships"), ("filings", "Filings"), ("pending", "Pending"), ("civil_median", "Civil median (mo)"), ("trial_median", "To trial (mo)"), ("over_3y", "Civil >3 yrs"), ("mdls", "MDLs")],
            [("mdl_court", "MDL transferee court", {"yes": "Has pending MDLs", "no": "No pending MDLs"})],
        ),
        summary={"source": FCMS_URL, "districts": len(districts), "period": "12 months ending 2026-06-30"},
    )


if __name__ == "__main__":
    main()
