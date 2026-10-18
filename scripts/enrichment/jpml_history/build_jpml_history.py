"""Build the JPML pending-MDL history datasets from the monthly reports in private/acq/jpml_history/.

Datasets written to private/build/jpml_history/<dataset>.json (publish-ready, never published from here):
  jpml_pending_history_mdls    one row per MDL number: monthly series across every valid report
  jpml_pending_history_months  one row per report month + per-district rows + summary:overview
  jpml_statistics_extra        built by build_statistics_extra.py (separate script)

Inputs: private/acq/jpml_history/_manifest.jsonl and the PDFs it lists (sha256-verified), plus read-only corpus
lookups saved under private/build/jpml_history/lookups/ (court_spine_fd.json, mdl_ids.json).

Rules: only printed values; a report that fails its printed-total checks is excluded, never repaired; derived
figures state their formula in the dataset summary.
"""
import hashlib
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import corpus_writer as cw  # noqa: E402
import analytics as an  # noqa: E402
import parse_reports as pr  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "jpml_history"
OUT = ROOT / "private" / "build" / "jpml_history"
LOOKUPS = OUT / "lookups"
ARCHIVE = "https://www.jpml.uscourts.gov/pending-mdl-reports-archive"
CURRENT = "https://www.jpml.uscourts.gov/pending-mdls-0"
DS_MDLS = "jpml_pending_history_mdls"
DS_MONTHS = "jpml_pending_history_months"
TYPE_LABELS = {
    "actions_pending": "Distribution of Pending MDL Dockets by Actions Pending",
    "district": "Distribution of Pending MDL Dockets by District",
    "mdl_number": "Docket Summary Listing (Pending MDLs by MDL Number)",
    "mdl_type": "Docket Type Summary (Pending MDLs by Docket Type)",
    "terminated": "MDLs Terminated (recently terminated listing)",
}
PRODUCTS = "Products Liability"
TERMS = (
    "No terms of use or licence is published on the JPML pages these reports come from (pending-mdl-reports-archive, pending-mdls-0 and "
    "statistics-info were read on 2026-10-18; the site footer carries navigation links only, and no privacy, copyright or terms page is linked). "
    "robots.txt sets a 10-second crawl delay, which the acquisition honoured, and disallows only /includes/, /misc/, /modules/, /profiles/, /scripts/ "
    "and /themes/ (none used). The reports are official publications of the Judicial "
    "Panel on Multidistrict Litigation, a body of the U.S. federal judiciary; works prepared by federal employees in their official duties are not "
    "subject to U.S. copyright (17 U.S.C. 105), which is our reading, not a statement on the source site. Every figure keeps its source report "
    "URL; JPML does not endorse this compilation. No form, account or agreement was needed to download any file."
)
MASS_TORT_TYPES = {"Products Liability", "Common Disaster", "Air Disaster"}  # same definition as mdl_analytics
GROWTH_LABELS = {
    "fast_growth": "Growing 25%+ in 12 months",
    "growing": "Growing 5–25%",
    "stable": "Stable (±5%)",
    "declining": "Declining 5%+",
    "insufficient_history": "Less than 12 months of reports",
}
STATUS3 = {"pending": "pending", "listed_after_closing_date": "pending", "terminated": "terminated", "no_longer_listed": "no_longer_listed", "closing_date_before_last_listing": "no_longer_listed"}


def growth_bucket(pct_change_12m):
    """mdl_analytics buckets on the 12-month change in actions pending (percent of the pending count 12 months earlier)."""
    if pct_change_12m is None:
        return "insufficient_history"
    if pct_change_12m >= 25:
        return "fast_growth"
    if pct_change_12m >= 5:
        return "growing"
    if pct_change_12m > -5:
        return "stable"
    return "declining"


def load_manifest():
    entries = [json.loads(x) for x in (ACQ / "_manifest.jsonl").read_text().splitlines() if x.strip()]
    latest = {}
    for e in entries:
        if e["status"] == 200 and e.get("sha256"):
            latest[e["url"]] = e
    return latest


def verify(entry):
    data = (ACQ / entry["path"]).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != entry["sha256"]:
        raise SystemExit(f"sha256 mismatch for {entry['path']}")
    return data


# ------------------------------------------------------------------ report inventory + parsing

def inventory(manifest):
    reports = []
    for url, e in sorted(manifest.items()):
        if not e["path"].startswith("reports/"):
            continue
        verify(e)
        text = pr.pdftotext(ACQ / e["path"])
        title = pr.report_title(text)
        filters = pr.report_filters(text)
        kind_title = pr.report_type_from_title(title)
        if any("Closed Litigations" in f for f in filters):
            kind_title = "terminated"  # same printed title as the by-number listing; the filter says closed
        kind_url = pr.report_type_from_url(url)
        rep = {
            "url": url, "path": e["path"], "sha256": e["sha256"], "bytes": e["bytes"], "retrieved_at": e["retrieved_at"],
            "listed_on": e.get("listed_on"), "link_text": e.get("link_text"), "printed_title": title,
            "type": kind_title or kind_url, "type_from_url": kind_url, "type_agrees_with_url": kind_title == kind_url,
            "report_date": pr.report_date(text), "file_date": pr.date_from_filename(url), "filters_printed": filters,
        }
        rep["month"] = an.month_of(rep["report_date"]) if rep["report_date"] else None
        if rep["type"] in ("actions_pending", "district"):
            parsed = pr.parse_pending_report(text)
            v = pr.validate_pending(parsed)
        elif rep["type"] in ("mdl_type", "mdl_number"):
            parsed = pr.parse_type_report(text, listing=rep["type"] == "mdl_number")
            v = pr.validate_type(parsed)
        elif rep["type"] == "terminated":
            parsed = pr.parse_terminated_report(text)
            v = pr.validate_terminated(parsed)
        else:
            parsed, v = None, {"valid": False, "checks": [{"check": "report_type_recognised", "ok": False}]}
        if rep["report_date"] is None and rep["type"] != "terminated":
            v = {**v, "valid": False, "checks": v["checks"] + [{"check": "report_date_printed", "ok": False}]}
        if rep["report_date"] and rep["file_date"] and rep["report_date"] != rep["file_date"]:
            v.setdefault("warnings", []).append({"check": "report_date_matches_file_name", "parsed": rep["report_date"], "printed": rep["file_date"], "ok": False})
        rep["valid"], rep["checks"], rep["warnings"] = v["valid"], v["checks"], v.get("warnings", [])
        rep["printed"] = parsed["printed"] if parsed else None
        rep["rows"] = parsed["rows"] if parsed else []
        rep["unparsed"] = parsed["unparsed"] if parsed else []
        reports.append(rep)
    return reports


def cross_checks(ap, other):
    """Compare a valid Actions Pending report with another valid report of the same date."""
    a = {r["mdl"]: r for r in ap["rows"]}
    b = {r["mdl"]: r for r in other["rows"] if r.get("transferred", True)}
    untransferred = sorted(r["mdl"] for r in other["rows"] if not r.get("transferred", True))
    out = {"other_type": other["type"], "other_filters": other.get("filters_printed"), "same_mdl_set": set(a) == set(b), "only_in_actions_pending": sorted(set(a) - set(b)), "only_in_other": sorted(set(b) - set(a)), "untransferred_in_other": untransferred}
    common = set(a) & set(b)
    if other["type"] == "district":
        out["pending_differs"] = sorted(m for m in common if a[m]["pending"] != b[m]["pending"])
        out["total_differs"] = sorted(m for m in common if a[m]["total"] != b[m]["total"])
        out["judges_differ"] = sorted(m for m in common if a[m]["judge"] != b[m]["judge"])
    out["district_differs"] = sorted(m for m in common if a[m]["district"] != b[m]["district"])
    out["agree"] = out["same_mdl_set"] and not out["district_differs"] and not out.get("pending_differs") and not out.get("total_differs") and not out.get("judges_differ")
    return out


def assemble_months(reports):
    by_month = defaultdict(lambda: defaultdict(list))
    for r in reports:
        if r["month"] and r["type"] != "terminated":
            by_month[r["month"]][r["type"]].append(r)
    months, excluded = {}, []
    for m in sorted(by_month):
        kinds = by_month[m]
        pick = {}
        for k in ("actions_pending", "district", "mdl_number", "mdl_type"):
            valid = [r for r in kinds.get(k, []) if r["valid"]]
            pick[k] = valid[0] if valid else None
            for r in kinds.get(k, []):
                if not r["valid"]:
                    excluded.append({"month": m, "type": k, "url": r["url"], "failed_checks": [c for c in r["checks"] if not c.get("ok")], "unparsed": r["unparsed"][:5]})
        primary = pick["actions_pending"] or pick["district"]
        if not primary:
            excluded.append({"month": m, "type": "month", "url": None, "failed_checks": [{"check": "no valid actions-pending or district report"}], "unparsed": []})
            continue
        checks = []
        if pick["actions_pending"]:
            for k in ("district", "mdl_number", "mdl_type"):
                if pick[k]:
                    checks.append(cross_checks(pick["actions_pending"], pick[k]))
        months[m] = {"month": m, "primary": primary, "pick": pick, "cross_checks": checks, "all": {k: v for k, v in kinds.items()}}
    return months, excluded


# ------------------------------------------------------------------ per-MDL history

def closings_from(reports):
    """mdl -> closing evidence from every valid terminated listing (printed Date Closed), newest listing last."""
    out = defaultdict(list)
    for r in sorted((r for r in reports if r["type"] == "terminated" and r["valid"]), key=lambda r: r["report_date"]):
        for row in r["rows"]:
            out[row["mdl"]].append({"date_closed": row["date_closed"], "listing_date": r["report_date"], "url": r["url"], "title": row["title"]})
    return out


def build_mdl_history(months, spine, closings=None):
    closings = closings or {}
    order = sorted(months)
    latest = order[-1]
    first = order[0]
    typ_by_month = {m: ({r["mdl"]: r for r in months[m]["pick"]["mdl_type"]["rows"]} if months[m]["pick"]["mdl_type"] else None) for m in order}
    listing_by_month = {m: ({r["mdl"]: r for r in months[m]["pick"]["mdl_number"]["rows"]} if months[m]["pick"]["mdl_number"] else None) for m in order}
    points = defaultdict(dict)
    for m in order:
        rep = months[m]["primary"]
        for row in rep["rows"]:
            t = typ_by_month[m].get(row["mdl"]) if typ_by_month[m] is not None else None
            lst = listing_by_month[m].get(row["mdl"]) if listing_by_month[m] is not None else None
            points[row["mdl"]][m] = {
                "month": m, "report_date": rep["report_date"], "pending": row["pending"], "total": row["total"],
                "district": row["district"], "district_printed": row["district_printed"], "judge": row["judge"],
                "judge_title": row["judge_title"], "judges": row["judges"], "title": row["title"],
                "type": t["type"] if t else None, "type_recorded": typ_by_month[m] is not None,
                "master_docket": (t or lst or {}).get("master_docket"), "date_filed": (t or lst or {}).get("date_filed"),
                "date_transferred": (t or lst or {}).get("date_transferred"), "source_url": rep["url"], "source_type": rep["type"],
            }
    courts = {}
    out = []
    for mdl in sorted(points):
        pts = points[mdl]
        series = [pts[m] for m in sorted(pts)]
        last = series[-1]
        pk = an.peak(series)
        first_m, last_m = series[0]["month"], series[-1]["month"]
        expected = [m for m in order if first_m <= m <= last_m]
        absent = [m for m in expected if m not in pts]
        transferred = next((p["date_transferred"] for p in reversed(series) if p["date_transferred"]), None)
        filed = next((p["date_filed"] for p in reversed(series) if p["date_filed"]), None)
        types = an.periods([p for p in series if p["type_recorded"]], "type")
        districts = an.periods(series, "district")
        for d in districts:
            if d["value"] not in courts:
                courts[d["value"]] = an.match_court(d["value"], spine)
            d["court"] = courts[d["value"]]
        rec = {
            "mdl": mdl, "title": last["title"], "titles": an.periods(series, "title"),
            "first_report": series[0]["report_date"], "last_report": last["report_date"],
            "first_month": first_m, "last_month": last_m, "reports": len(series), "absent_months": absent,
            "in_latest_report": last_m == latest, "left_censored": first_m == first,
            "pending": last["pending"], "total": last["total"], "district": last["district"], "judge": last["judge"],
            "judge_title": last["judge_title"], "type": next((t["value"] for t in reversed(types) if t["value"]), None),
            "types": types, "districts": districts, "judges": an.periods(series, "judge"),
            "date_filed": filed, "date_transferred": transferred, "master_docket": next((p["master_docket"] for p in reversed(series) if p["master_docket"]), None),
            "peak_pending": pk["pending"], "peak_month": pk["month"], "peak_report_date": pk["report_date"],
            "months_first_to_peak": an.month_diff(first_m, pk["month"]),
            "months_peak_to_last": an.month_diff(pk["month"], last_m),
            "pending_vs_peak_pct": an.share_pct(last["pending"], pk["pending"]),
            "age_months_at_last": an.months_between_dates(transferred, last["report_date"]),
            "age_months_at_peak": an.months_between_dates(transferred, pk["report_date"]),
            "change_1m": an.change(pts, last_m, 1), "change_3m": an.change(pts, last_m, 3), "change_6m": an.change(pts, last_m, 6), "change_12m": an.change(pts, last_m, 12),
            "pct_change_1m": an.pct_change(pts, last_m, 1), "pct_change_3m": an.pct_change(pts, last_m, 3), "pct_change_6m": an.pct_change(pts, last_m, 6), "pct_change_12m": an.pct_change(pts, last_m, 12),
            "total_change_12m": an.change(pts, last_m, 12, "total"),
            "series": [{k: p[k] for k in ("month", "report_date", "pending", "total", "district", "district_printed", "judge", "judge_title", "type", "source_url")} for p in series],
        }
        rec["left_pending_12m"] = (rec["total_change_12m"] - rec["change_12m"]) if rec["total_change_12m"] is not None and rec["change_12m"] is not None else None
        closed = sorted({c["date_closed"] for c in closings.get(mdl, [])})
        ev = closings.get(mdl, [])
        rec["date_closed"] = closed[-1] if closed else None
        rec["closed_evidence"] = ev[-1] if ev else None
        rec["closed_dates_printed"] = closed
        if rec["in_latest_report"]:
            rec["exit_status"] = "pending" if not closed else "listed_after_closing_date"
        else:
            rec["exit_status"] = "terminated" if closed and closed[-1] >= last["report_date"] else ("no_longer_listed" if not closed else "closing_date_before_last_listing")
        out.append(rec)
    return out, courts


# ------------------------------------------------------------------ per-month analytics

def build_month_stats(months, mdl_hist, spine):
    order = sorted(months)
    born = {r["mdl"]: r["date_transferred"] for r in mdl_hist}
    stats = []
    prev = None
    for m in order:
        rep = months[m]["primary"]
        rows = rep["rows"]
        pend = [r["pending"] for r in rows]
        total_p = sum(pend)
        by_d = defaultdict(lambda: {"mdls": 0, "pending": 0, "total": 0})
        for r in rows:
            by_d[r["district"]]["mdls"] += 1
            by_d[r["district"]]["pending"] += r["pending"]
            by_d[r["district"]]["total"] += r["total"]
        judges = Counter(j["name"] for r in rows for j in r["judges"])
        t = months[m]["pick"]["mdl_type"]
        type_rows = {x["mdl"]: x["type"] for x in t["rows"]} if t else None
        missing_type = sorted(r["mdl"] for r in rows if type_rows is not None and r["mdl"] not in type_rows)
        by_type = None
        pl = {"actions_pct": None, "mdls_pct": None, "note": "No valid Docket Type Summary for this month"}
        if type_rows is not None:
            agg = defaultdict(lambda: {"mdls": 0, "pending": 0})
            for r in rows:
                key = type_rows.get(r["mdl"], "Not recorded in type report")
                agg[key]["mdls"] += 1
                agg[key]["pending"] += r["pending"]
            by_type = sorted(({"type": k, **v, "pending_share_pct": an.share_pct(v["pending"], total_p)} for k, v in agg.items()), key=lambda x: -x["pending"])
            if missing_type:
                pl = {"actions_pct": None, "mdls_pct": None, "note": f"{len(missing_type)} MDLs in the pending report are absent from the type report"}
            else:
                plv = agg.get(PRODUCTS, {"mdls": 0, "pending": 0})
                pl = {"actions_pct": an.share_pct(plv["pending"], total_p), "mdls_pct": an.share_pct(plv["mdls"], len(rows)), "actions": plv["pending"], "mdls": plv["mdls"], "note": None}
        ages = defaultdict(lambda: {"mdls": 0, "pending": 0})
        for r in rows:
            age = an.months_between_dates(born.get(r["mdl"]), rep["report_date"])
            band = "Not recorded" if age is None else ("under 1 year" if age < 12 else "1-3 years" if age < 36 else "3-5 years" if age < 60 else "5-10 years" if age < 120 else "10+ years")
            ages[band]["mdls"] += 1
            ages[band]["pending"] += r["pending"]
        mdls_now = {r["mdl"] for r in rows}
        consecutive = prev is not None and an.month_diff(prev["month"], m) == 1
        rec = {
            "month": m, "report_date": rep["report_date"], "source_type": rep["type"], "source_url": rep["url"],
            "pending_mdls": len(rows), "pending_actions": total_p, "total_actions": sum(r["total"] for r in rows),
            "printed": {k: rep["printed"][k] for k in ("dockets", "pending", "total", "districts", "judges")},
            "judge_titles_printed": rep["printed"]["judge_titles"], "buckets_pending_printed": rep["printed"]["buckets_pending"], "buckets_total_printed": rep["printed"]["buckets_total"],
            "top1_share_pct": an.top_n_share(pend, 1), "top5_share_pct": an.top_n_share(pend, 5), "top10_share_pct": an.top_n_share(pend, 10),
            "top10": [{"mdl": r["mdl"], "title": r["title"], "pending": r["pending"]} for r in sorted(rows, key=lambda r: (-r["pending"], r["mdl"]))[:10]],
            "hhi_mdl_pending": an.hhi(pend),
            "hhi_district_pending": an.hhi([v["pending"] for v in by_d.values()]),
            "hhi_district_mdls": an.hhi([v["mdls"] for v in by_d.values()]),
            "districts": len(by_d), "judges": len(judges), "judges_with_2plus_mdls": sum(1 for v in judges.values() if v >= 2),
            "mdls_with_2plus_judges": sum(1 for r in rows if len(r["judges"]) >= 2),
            "median_pending": sorted(pend)[len(pend) // 2] if len(pend) % 2 else (sorted(pend)[len(pend) // 2 - 1] + sorted(pend)[len(pend) // 2]) / 2,
            "mdls_zero_pending": sum(1 for p in pend if p == 0),
            "by_district": sorted(({"district": d, "court": an.match_court(d, spine), **v, "pending_share_pct": an.share_pct(v["pending"], total_p)} for d, v in by_d.items()), key=lambda x: (-x["pending"], x["district"])),
            "by_type": by_type, "type_report_url": t["url"] if t else None, "missing_type_mdls": missing_type,
            "products_liability": pl, "by_age": [{"band": b, **ages[b]} for b in ("under 1 year", "1-3 years", "3-5 years", "5-10 years", "10+ years", "Not recorded") if b in ages],
            "entered": sorted(mdls_now - prev["mdl_set"]) if consecutive else None,
            "left": sorted(prev["mdl_set"] - mdls_now) if consecutive else None,
            "change_pending_1m": total_p - prev["pending_actions"] if consecutive else None,
            "reports": [{"type": k, "url": r["url"], "sha256": r["sha256"], "valid": r["valid"], "printed_title": r["printed_title"]} for k, rs in sorted(months[m]["all"].items()) for r in rs],
            "cross_checks": months[m]["cross_checks"],
            "mdl_set": mdls_now,
        }
        stats.append(rec)
        prev = rec
    return stats


# ------------------------------------------------------------------ rows

def lifetime_curve(r, fyrec):
    """Fiscal-year-end points (September 30, from the JPML Statistical Analysis Summary by Docket) followed by the monthly
    report points. Both are printed counts of actions pending; the two sources are labelled, never blended."""
    pts = [{"date": p["date"], "pending": p["pending"], "source": "fiscal_year_statistics", "fy": p["fy"]} for p in fyrec["series"]] if fyrec else []
    pts += [{"date": p["report_date"], "pending": p["pending"], "source": "monthly_report"} for p in r["series"]]
    return sorted(pts, key=lambda x: (x["date"], x["source"]))


def mdl_rows(hist, latest_month, months_order, fy=None):
    rank = {r["mdl"]: i + 1 for i, r in enumerate(sorted((r for r in hist if r["in_latest_report"]), key=lambda r: (-r["pending"], r["mdl"])))}
    rows = []
    for r in hist:
        court = r["districts"][-1]["court"] if r["districts"] else {"court_id": None}
        links = [{"url": f"/matters/lens/{r['mdl']}", "label": f"MDL {r['mdl']} case lens"}]
        seen = set()
        for d in r["districts"]:
            cid = d["court"]["court_id"]
            if cid and cid not in seen:
                seen.add(cid)
                links.append({"url": f"/courts/{cid}", "label": f"{d['court']['label']} (transferee court)"})
        fyrec = (fy or {}).get(r["mdl"])
        if fyrec:
            links.append({"url": f"/records/jpml_statistics_extra/mdl:{r['mdl']}", "label": f"Fiscal-year-end history, FY{fyrec['first_fy']} onward"})
        links.append({"url": r["series"][-1]["source_url"], "label": f"JPML report of {r['last_report']} (PDF)"})
        links.append({"url": ARCHIVE, "label": "JPML pending MDL reports archive"})
        status = {
            "pending": f"In the latest report ({r['last_report']})",
            "terminated": f"Last listed {r['last_report']}; closed {r['date_closed']} (JPML terminated listing of {(r['closed_evidence'] or {}).get('listing_date')})",
            "no_longer_listed": f"Last listed {r['last_report']}; no closing date in the terminated listings read",
            "listed_after_closing_date": f"In the latest report ({r['last_report']}) although a terminated listing prints closing date {r['date_closed']}",
            "closing_date_before_last_listing": f"Last listed {r['last_report']}; terminated listing prints closing date {r['date_closed']}, before that report",
        }[r["exit_status"]]
        dist_hist = "; ".join(f"{d['value']} {an.span(d['from'], d['to'])}" for d in r["districts"])
        judge_hist = "; ".join(f"{d['value']} {an.span(d['from'], d['to'])}" for d in r["judges"])
        type_hist = "; ".join(f"{d['value'] or 'not listed'} {an.span(d['from'], d['to'])}" for d in r["types"]) or "Not recorded"
        facts = [
            ["MDL number", str(r["mdl"])],
            ["Title as printed (latest report)", r["title"]],
            ["Status in the monthly reports", status],
            ["Reports in series", f"{r['reports']} monthly report{'s' if r['reports'] != 1 else ''}, {an.span(r['first_report'], r['last_report']).replace('–', ' to ')}"],
            ["Months absent between first and last appearance", ", ".join(r["absent_months"]) or "None"],
            ["Actions now pending (latest report)", an.fmt(r["pending"])],
            ["Total actions, historical (latest report)", an.fmt(r["total"])],
            ["Peak pending in series", f"{an.fmt(r['peak_pending'])} in the report of {r['peak_report_date']}"],
            ["Months from first appearance in series to peak", str(r["months_first_to_peak"]) + (" (first appearance is the first report in the series; earlier history not covered)" if r["left_censored"] else "")],
            ["Latest pending as share of peak", an.pct(r["pending_vs_peak_pct"])],
            ["Change in pending, 1 / 3 / 6 / 12 months", " / ".join(an.signed(r[k]) for k in ("change_1m", "change_3m", "change_6m", "change_12m"))],
            ["Percent change in pending, 1 / 3 / 6 / 12 months", " / ".join(an.pct(r[k]) for k in ("pct_change_1m", "pct_change_3m", "pct_change_6m", "pct_change_12m"))],
            ["New actions, 12 months (change in total actions)", an.signed(r["total_change_12m"])],
            ["Actions resolved, 12 months (derived: new − change in pending)", an.fmt(r["left_pending_12m"])],
            ["Docket type (JPML Docket Type Summary)", type_hist],
            ["Transferee district as printed, by period", dist_hist],
            ["Transferee judge as printed, by period", judge_hist],
            ["Date filed / date transferred (JPML listing)", f"{r['date_filed'] or 'Not recorded'} / {r['date_transferred'] or 'Not recorded'}"],
            ["Months since transfer at latest report", an.fmt(r["age_months_at_last"])],
            ["Master docket", r["master_docket"] or "Not recorded"],
        ]
        if fyrec:
            facts.append(["Fiscal-year-end history (Sept 30, JPML Statistical Analysis)", f"{fyrec['fiscal_years']} editions, FY{fyrec['first_fy']} to FY{fyrec['last_fy']}; peak {an.fmt(fyrec['peak_pending'])} pending at Sept 30, FY{fyrec['peak_fy']}; pending at Sept 30, FY{fyrec['last_fy']}: {an.fmt(fyrec['pending'])}"])
        else:
            facts.append(["Fiscal-year-end history (Sept 30, JPML Statistical Analysis)", "Not recorded: the MDL is not listed in a validated fiscal-year edition (FY1992–FY2025)"])
        for note in (r.get("cross_source_notes") or []):
            facts.append(["Cross-check with the fiscal-year statistics", note])
        facts.append(["Source", f"JPML MDL Statistics Reports (monthly, CM/ECF), Distribution of Pending MDL Dockets by Actions Pending, {r['first_report']} to {r['last_report']}; counts are actions (cases)"])
        cells = {
            "mdl": str(r["mdl"]), "litigation": r["title"], "type": r["type"] or "Not recorded", "pending": an.fmt(r["pending"]),
            "peak": an.fmt(r["peak_pending"]), "peak_month": r["peak_month"], "change_12m": an.signed(r["change_12m"]),
            "first": r["first_month"], "last": r["last_month"], "district": r["district"] or "Not recorded", "judge": r["judge"] or "Not recorded",
        }
        growth = growth_bucket(r["pct_change_12m"])
        mass_tort = r["type"] in MASS_TORT_TYPES
        badges = [b for b in [
            "Mass tort" if mass_tort else None,
            GROWTH_LABELS[growth] if growth != "insufficient_history" else None,
            "In latest report" if r["in_latest_report"] else "No longer listed",
            f"#{rank[r['mdl']]} by pending" if r["mdl"] in rank and rank[r["mdl"]] <= 25 else None,
            "At series peak" if r["in_latest_report"] and r["pending"] == r["peak_pending"] and r["reports"] > 1 else None,
            "Judge changed" if len(r["judges"]) > 1 else None,
        ] if b]
        # the mdl_analytics `analytics` block (same field names) so one reader serves both datasets; `history` carries the rest
        analytics = {
            "mdl": r["mdl"], "type": r["type"], "mass_tort": mass_tort, "status": STATUS3[r["exit_status"]], "district": r["district"], "judge": r["judge"], "judge_title": r["judge_title"],
            "pending": r["pending"], "total": r["total"], "as_of": r["last_report"], "change_1m": r["change_1m"], "change_3m": r["change_3m"], "change_12m": r["change_12m"],
            "new_12m": r["total_change_12m"], "resolved_12m": r["left_pending_12m"], "date_filed": r["date_filed"], "date_transferred": r["date_transferred"], "date_closed": r["date_closed"],
            "master_docket": r["master_docket"], "age_years": round(r["age_months_at_last"] / 12, 1) if r["age_months_at_last"] is not None else None, "growth": growth,
            "peak_pending": r["peak_pending"], "peak_date": r["peak_report_date"],
            "series": [{"date": p["report_date"], "pending": p["pending"], "total": p["total"]} for p in r["series"]],
        }
        rows.append(cw.record(
            DS_MDLS, str(r["mdl"]), r["title"], source_url=r["series"][-1]["source_url"],
            subtitle=f"MDL {r['mdl']} · {r['district'] or 'district not recorded'} · {an.fmt(r['pending'])} pending ({r['last_report']}) · peak {an.fmt(r['peak_pending'])} ({r['peak_month']})",
            cells=cells, facts=facts, badges=badges, links=links,
            text=f"{r['type']} {r['judge']} {r['district']} {r['master_docket']}",
            filters={
                "type": [(r["type"] or "not_recorded").lower()], "mass_tort": ["yes" if mass_tort else "no"], "status": [STATUS3[r["exit_status"]]], "status_detail": [r["exit_status"]],
                "growth": [growth], "district": [r["district"] or ""], "court": [court["court_id"]] if court.get("court_id") else [],
                "first_month": [r["first_month"]], "date": r["last_report"],
            },
            extra={"kind": "mdl", "analytics": analytics, "history": r, "rank_latest": rank.get(r["mdl"]), "lifetime_curve": lifetime_curve(r, fyrec), "fy_history_available": bool(fyrec)},
        ))
    return rows


def month_rows(stats, months_order, excluded, notes=None):
    """notes: month -> list of cross-check sentences against the fiscal-year statistics (see build_all.py)."""
    rows = []
    for s in stats:
        pl = s["products_liability"]
        facts = [
            ["Report month", s["month"]], ["Report date (printed)", s["report_date"]],
            ["Pending MDL dockets", an.fmt(s["pending_mdls"])], ["Actions now pending", an.fmt(s["pending_actions"])],
            ["Total actions, historical", an.fmt(s["total_actions"])],
            ["Top 10 MDLs' share of pending actions (computed)", an.pct(s["top10_share_pct"], 2)],
            ["Largest MDL's share of pending actions (computed)", an.pct(s["top1_share_pct"], 2)],
            ["HHI of pending actions across MDLs (computed, 0–10,000)", an.fmt(s["hhi_mdl_pending"])],
            ["HHI of pending actions across transferee districts (computed, 0–10,000)", an.fmt(s["hhi_district_pending"])],
            ["Transferee districts / judges (computed; printed)", f"{s['districts']} / {s['judges']} ({s['printed']['districts']} / {s['printed']['judges']} printed)"],
            ["Products liability share of pending actions / MDLs", f"{an.pct(pl['actions_pct'], 2)} / {an.pct(pl['mdls_pct'], 2)}" + (f" — {pl['note']}" if pl["note"] else "")],
            ["Change in pending actions from previous month", an.signed(s["change_pending_1m"])],
            ["MDLs entering / leaving since previous month", "Not recorded" if s["entered"] is None else f"{len(s['entered'])} / {len(s['left'])}"],
        ]
        for note in (notes or {}).get(s["month"], []):
            facts.append(["Cross-check with the fiscal-year statistics (Sept 30)", note])
        facts.append(["Source", f"JPML MDL Statistics Report of {s['report_date']}, {pr_label(s['source_type'])}; counts are MDL dockets and actions"])
        cells = {
            "month": s["month"], "mdls": an.fmt(s["pending_mdls"]), "pending": an.fmt(s["pending_actions"]), "total": an.fmt(s["total_actions"]),
            "top10": an.pct(s["top10_share_pct"], 1), "hhi_district": an.fmt(s["hhi_district_pending"]),
            "districts": str(s["districts"]), "judges": str(s["judges"]), "pl_share": an.pct(pl["actions_pct"], 1),
        }
        rec = {k: v for k, v in s.items() if k != "mdl_set"}
        rows.append(cw.record(
            DS_MONTHS, s["month"], f"Pending MDLs, report of {s['report_date']}", source_url=s["source_url"],
            subtitle=f"{an.fmt(s['pending_mdls'])} MDLs · {an.fmt(s['pending_actions'])} actions pending · top 10 hold {an.pct(s['top10_share_pct'], 1)}",
            cells=cells, facts=facts, links=[{"url": x["url"], "label": f"{pr_label(x['type'])} (PDF)"} for x in s["reports"] if x["valid"]] + [{"url": ARCHIVE, "label": "JPML pending MDL reports archive"}],
            text=f"JPML pending MDL report {s['month']} {s['report_date']}",
            filters={"kind": ["month"], "year": [s["month"][:4]], "date": s["report_date"]},
            extra={"kind": "month", "month_stats": rec},
        ))
    return rows


def pr_label(kind):
    return TYPE_LABELS.get(kind, kind or "report")


def district_rows(stats, courts):
    series = defaultdict(list)
    for s in stats:
        for d in s["by_district"]:
            series[d["district"]].append({"month": s["month"], "report_date": s["report_date"], "mdls": d["mdls"], "pending": d["pending"], "pending_share_pct": d["pending_share_pct"], "source_url": s["source_url"]})
    latest = stats[-1]
    latest_by = {d["district"]: d for d in latest["by_district"]}
    rows = []
    for code in sorted(series):
        pts = series[code]
        court = courts.get(code) or {"court_id": None, "label": None, "status": "unmatched"}
        pk = an.peak(pts)
        last = pts[-1]
        links = ([{"url": f"/courts/{court['court_id']}", "label": court["label"]}] if court.get("court_id") else []) + [{"url": ARCHIVE, "label": "JPML pending MDL reports archive"}]
        rows.append(cw.record(
            DS_MONTHS, f"district:{code}", f"Transferee district {code}" + (f" ({court['label']})" if court.get("label") else ""), source_url=last["source_url"],
            subtitle=f"{last['mdls']} MDLs · {an.fmt(last['pending'])} actions pending ({last['report_date']})",
            cells={"month": "district", "mdls": str(last["mdls"]), "pending": an.fmt(last["pending"]), "total": "—", "top10": "—", "hhi_district": "—", "districts": code, "judges": "—", "pl_share": "—"},
            facts=[["JPML district code (as printed)", code], ["Court directory match", f"{court.get('court_id') or 'none'} ({court.get('status')}; {court.get('method')})"],
                   ["Pending MDLs / actions (latest report in which the district appears)", f"{last['mdls']} / {an.fmt(last['pending'])} ({last['report_date']})"],
                   ["Peak pending actions in series", f"{an.fmt(pk['pending'])} ({pk['report_date']})"],
                   ["Reports in which the district appears", f"{len(pts)} ({pts[0]['month']} to {pts[-1]['month']})"],
                   ["Listed in latest report", "Yes" if code in latest_by else "No"],
                   ["Source", "JPML monthly pending-MDL reports (Actions Pending), actions summed by transferee district (computed)"]],
            text=f"district {code} {court.get('label') or ''}", filters={"_listing": ["no"], "kind": ["district"], "court": [court["court_id"]] if court.get("court_id") else []},
            links=links, extra={"kind": "district", "district": code, "court_id": court.get("court_id"), "court": court, "series": pts},
        ))
    return rows


def overview_row(stats, hist, excluded, inventory_rows, courts, fy_link=False):
    latest = stats[-1]
    series = [{k: s[k] for k in ("month", "report_date", "pending_mdls", "pending_actions", "total_actions", "top1_share_pct", "top5_share_pct", "top10_share_pct", "hhi_mdl_pending", "hhi_district_pending", "hhi_district_mdls", "districts", "judges", "judges_with_2plus_mdls", "mdls_with_2plus_judges", "change_pending_1m", "median_pending")} | {"products_liability_actions_pct": s["products_liability"]["actions_pct"], "products_liability_mdls_pct": s["products_liability"]["mdls_pct"], "entered": len(s["entered"]) if s["entered"] is not None else None, "left": len(s["left"]) if s["left"] is not None else None, "by_age": s["by_age"]} for s in stats]
    in_latest = [r for r in hist if r["in_latest_report"]]
    movers = sorted((r for r in in_latest if r["change_12m"] is not None), key=lambda r: -r["change_12m"])
    born = [r for r in hist if not r["left_censored"]]
    overview = {
        "first_month": stats[0]["month"], "latest_month": latest["month"], "reports_used": len(stats),
        "mdls_in_series": len(hist), "mdls_in_latest": len(in_latest), "mdls_entered_during_series": len(born),
        "mdls_left_during_series": sum(1 for r in hist if not r["in_latest_report"]),
        "series": series,
        "fastest_growing_12m": [{"mdl": r["mdl"], "title": r["title"], "change_12m": r["change_12m"], "pct_change_12m": r["pct_change_12m"], "pending": r["pending"]} for r in movers[:15]],
        "fastest_declining_12m": [{"mdl": r["mdl"], "title": r["title"], "change_12m": r["change_12m"], "pct_change_12m": r["pct_change_12m"], "pending": r["pending"]} for r in movers[-15:][::-1]],
        "largest_peaks": [{"mdl": r["mdl"], "title": r["title"], "peak_pending": r["peak_pending"], "peak_month": r["peak_month"], "pending": r["pending"]} for r in sorted(hist, key=lambda r: -r["peak_pending"])[:20]],
        "born_in_series": [{"mdl": r["mdl"], "title": r["title"], "first_month": r["first_month"], "pending": r["pending"], "peak_pending": r["peak_pending"], "months_first_to_peak": r["months_first_to_peak"], "curve": [[p["month"], p["pending"]] for p in r["series"]]} for r in sorted(born, key=lambda r: -r["peak_pending"])],
        "excluded_reports": excluded,
        "inventory": inventory_rows,
        "district_court_matches": {code: c for code, c in sorted(courts.items())},
    }
    facts = [
        ["Report months used", f"{len(stats)} ({stats[0]['month']} to {latest['month']})"],
        ["MDL numbers seen", an.fmt(len(hist))], ["MDLs in latest report", an.fmt(len(in_latest))],
        ["MDLs first listed after the first report", an.fmt(len(born))],
        ["Excluded reports (failed printed-total checks)", str(len(excluded))],
        ["Top 10 share of pending actions, first → latest", f"{an.pct(stats[0]['top10_share_pct'], 2)} → {an.pct(latest['top10_share_pct'], 2)}"],
        ["District HHI, first → latest", f"{an.fmt(stats[0]['hhi_district_pending'])} → {an.fmt(latest['hhi_district_pending'])}"],
        ["Source", "JPML pending MDL reports archive and current-month page (official PDFs)"],
    ]
    return cw.record(
        DS_MONTHS, "summary:overview", "JPML pending-MDL history overview", source_url=ARCHIVE,
        subtitle=f"{len(stats)} monthly reports · {len(hist)} MDL numbers · {stats[0]['month']} to {latest['month']}",
        cells={"month": "summary", "mdls": an.fmt(latest["pending_mdls"]), "pending": an.fmt(latest["pending_actions"]), "total": an.fmt(latest["total_actions"]), "top10": an.pct(latest["top10_share_pct"], 1), "hhi_district": an.fmt(latest["hhi_district_pending"]), "districts": str(latest["districts"]), "judges": str(latest["judges"]), "pl_share": an.pct(latest["products_liability"]["actions_pct"], 1)},
        facts=facts, text="summary overview JPML pending MDL history", filters={"_listing": ["no"], "kind": ["summary"]},
        links=[{"url": ARCHIVE, "label": "JPML pending MDL reports archive"}, {"url": CURRENT, "label": "JPML pending MDLs (current month)"}] + ([{"url": "/records/jpml_statistics_extra/summary:overview", "label": "Fiscal-year statistics FY1992–FY2025 (long-run series)"}] if fy_link else []),
        extra={"kind": "summary", "overview": overview},
    )


FORMULAS = {
    "top_n_share_pct": "100 × (sum of the n largest 'Actions Now Pending' values) ÷ (sum over all MDLs in the report)",
    "hhi": "sum over units of (100 × unit pending ÷ total pending)^2, 0–10,000 scale; units are MDLs (hhi_mdl_pending) or transferee districts (hhi_district_pending); hhi_district_mdls uses MDL counts",
    "change_k": "pending(latest month) − pending(latest month − k calendar months); Not recorded when either month is missing",
    "pct_change_k": "100 × change_k ÷ pending(latest month − k); Not recorded when the base is 0 or missing",
    "left_pending_12m": "(total actions change over 12 months) − (pending change over 12 months): actions that stopped being pending (derived)",
    "months_first_to_peak": "calendar months from the first report listing the MDL to the first report holding its maximum pending count",
    "products_liability_share": "pending actions (or MDLs) typed 'Products Liability' in the same-date Docket Type Summary ÷ all pending; Not recorded unless every MDL in the pending report is typed",
    "age_months": "(report date − JPML 'Date Transferred') in days ÷ 30.4375",
    "percentages": "stored as 100 × part ÷ whole to 6 decimals (effectively unrounded) and rounded once, to the digits shown, when displayed",
    "growth": "same buckets as mdl_analytics on the unrounded 12-month change in pending: fast_growth >= 25%, growing >= 5%, stable above -5%, declining otherwise, insufficient_history when the month 12 earlier is not in the series",
    "district_carry": "a blank district cell repeats the row above (report suppresses repeated values); the District report of the same date is cross-checked",
}


def build():
    manifest = load_manifest()
    spine = json.loads((LOOKUPS / "court_spine_fd.json").read_text())["rows"]
    reps = inventory(manifest)
    months, excluded = assemble_months(reps)
    order = sorted(months)
    hist, courts = build_mdl_history(months, spine, closings_from(reps))
    stats = build_month_stats(months, hist, spine)
    for s in stats:
        for d in s["by_district"]:
            courts.setdefault(d["district"], d["court"])
    inv_rows = [{k: r[k] for k in ("url", "path", "sha256", "bytes", "listed_on", "link_text", "printed_title", "type", "type_agrees_with_url", "report_date", "file_date", "month", "filters_printed", "valid")} for r in reps]
    res = {"reports": reps, "months": months, "hist": hist, "stats": stats, "excluded": excluded, "courts": courts, "inventory": inv_rows, "manifest": manifest}
    rebuild_rows(res)
    return res


def rebuild_rows(res, fy=None, notes=None):
    """(Re)build the publish-ready rows. fy: mdl -> fiscal-year record from build_statistics_extra (adds the Sept 30
    history and lifetime curve to the MDL rows); notes: month -> cross-check sentences for the month rows."""
    order = sorted(res["months"])
    res["mdl_rows"] = mdl_rows(res["hist"], order[-1], order, fy=fy)
    res["month_rows"] = month_rows(res["stats"], order, res["excluded"], notes=notes) + district_rows(res["stats"], res["courts"]) + [overview_row(res["stats"], res["hist"], res["excluded"], res["inventory"], res["courts"], fy_link=bool(fy))]
    return res


def write(res):
    OUT.mkdir(parents=True, exist_ok=True)
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    used = sorted({r["url"] for r in res["reports"]})
    inputs = [{"url": u, "path": f"private/acq/jpml_history/{res['manifest'][u]['path']}", "sha256": res["manifest"][u]["sha256"]} for u in used]
    order = sorted(res["months"])
    matched = sum(1 for c in res["courts"].values() if c.get("court_id"))
    common = {"terms": TERMS, "reports_used": len(order), "first_month": order[0], "latest_month": order[-1], "excluded_reports": len(res["excluded"]), "formulas": FORMULAS, "source": ARCHIVE, "current_page": CURRENT, "district_court_match": f"{matched}/{len(res['courts'])} JPML district codes matched exactly to court_spine"}
    datasets = [
        (DS_MDLS, "JPML pending-MDL history by MDL (monthly reports)", res["mdl_rows"],
         cw.listing([("mdl", "MDL"), ("litigation", "Litigation"), ("type", "Type"), ("pending", "Pending"), ("peak", "Peak"), ("peak_month", "Peak month"), ("change_12m", "12-mo change"), ("first", "First report"), ("last", "Last report"), ("district", "District"), ("judge", "Judge")],
                    [("status", "Status", {"pending": "In latest report", "terminated": "Terminated (closing date printed)", "no_longer_listed": "No longer listed"}),
                     ("mass_tort", "Mass tort", {"yes": "Mass tort", "no": "Other"}),
                     ("growth", "12-month trend", GROWTH_LABELS)]),
         {**common, "rows": len(res["mdl_rows"]), "grain": "one row per MDL number seen in any valid monthly report"}),
        (DS_MONTHS, "JPML pending-MDL history by report month", res["month_rows"],
         cw.listing([("month", "Month"), ("mdls", "MDLs"), ("pending", "Pending actions"), ("total", "Total actions"), ("top10", "Top-10 share"), ("hhi_district", "District HHI"), ("districts", "Districts"), ("judges", "Judges"), ("pl_share", "Products liability share")],
                    [("year", "Year", {y: y for y in sorted({m[:4] for m in order})})]),
         {**common, "rows": len(res["month_rows"]), "grain": "one row per report month (listing); district:<code> rows and summary:overview are detail-only"}),
    ]
    for ds, label, rows, listing, summary in datasets:
        ids = [r["id"] for r in rows]
        assert len(ids) == len(set(ids)), f"duplicate ids in {ds}"
        (OUT / f"{ds}.json").write_text(json.dumps({"dataset": ds, "label": label, "listing_block": listing, "summary": summary, "rows": rows, "built_at": built, "inputs": inputs}, indent=1, sort_keys=False, default=list))
        print(json.dumps({"dataset": ds, "rows": len(rows)}))
    (OUT / "report_inventory.json").write_text(json.dumps({"built_at": built, "reports": res["inventory"], "excluded": res["excluded"]}, indent=1))
    (OUT / "validation.json").write_text(json.dumps([{k: r[k] for k in ("url", "type", "report_date", "valid", "checks", "warnings", "unparsed")} for r in res["reports"]], indent=1))


if __name__ == "__main__":
    write(build())
