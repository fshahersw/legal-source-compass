"""Build ftc_dnc_reported_calls: Do Not Call reported calls counted by month, state, subject and robocall flag.

Inputs (private/acq/ftc_data/): the FTC's daily CSV files (files/DNC_Complaint_Numbers_*.csv, stored unchanged), the daily
aggregates read from api.ftc.gov (dnc/days/*.json, written by fetch_dnc.py), optional API record counts per month
(dnc/month_counts.json), and the FTC dashboard's own monthly comparison (tableau/DoNotCallComplaints__MonthlyComparison.csv).
Every count is made from the records themselves by dnc_agg; nothing is estimated. A day that has no source is a gap.
Per-100,000 figures divide a month's count by the Census resident population of July 1, 2025 (Population Estimates, vintage 2025).
"""
import calendar
import csv
import glob
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bcommon as B  # noqa: E402
import dnc_agg  # noqa: E402
import dnc_csv  # noqa: E402

DATA_PAGE = "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data"
API_DOCS = "https://www.ftc.gov/developer/api/v0/endpoints/do-not-call-dnc-reported-calls-data-api"
CSV_URL = "https://www.ftc.gov/sites/default/files/{name}"
TABLEAU_VIEW = "https://public.tableau.com/app/profile/federal.trade.commission/viz/DoNotCallComplaints/MonthlyComparison"
TABLEAU_CSV = "https://public.tableau.com/views/DoNotCallComplaints/MonthlyComparison.csv?:showVizHome=no"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
NON_TOPICS = ("Other", "No Subject Provided")
RECALL = "A reported call is a consumer's report to the FTC, not a verified violation. The FTC states that none of the information in these records is verified."

FORMULAS = {
    "robocall_share_pct": "calls reported as a recorded message or robocall (flag Y) / calls with a Y or N flag * 100; calls with no flag are left out of both and counted separately",
    "per100k": "calls reported in the month by consumers whose reported state is the state / Census resident population of July 1, 2025 (Population Estimates, vintage 2025) * 100,000",
    "rank_per100k": "rank of per100k among the 50 states, DC and Puerto Rico in the same month (1 = most calls per resident)",
    "days_covered": "calendar days of the month for which the counts have a source (an FTC daily file or a day read from the API)",
}


def month_label(key):
    y, m = key.split("-")
    return f"{MONTHS[int(m) - 1]} {y}"


def days_in_month(key):
    y, m = key.split("-")
    return calendar.monthrange(int(y), int(m))[1]


def load_csv_days(files_dir=None):
    """{day: {"agg", "quality", "source": "csv", "files": [names]}} and the per-file facts, from the FTC daily CSV files."""
    days, per_file = {}, []
    pattern = os.path.join(files_dir or os.path.join(B.ACQ, "files"), "DNC_Complaint_Numbers_*.csv")
    for path in sorted(glob.glob(pattern)):
        raw = open(path, "rb").read()
        res = dnc_csv.aggregate_file(raw)
        name = os.path.basename(path)
        per_file.append({"name": name, "rows": res["rows"], "malformed_rows": res["malformed_rows"], "header_ok": res["header_ok"], "sha256": res["sha256"], "created_days": sorted(d for d in res["days"] if d != dnc_csv.UNDATED), "undated_rows": sum(dnc_agg_total(res["days"].get(dnc_csv.UNDATED))) if dnc_csv.UNDATED in res["days"] else 0})
        for day, b in res["days"].items():
            if day == dnc_csv.UNDATED:
                continue
            cur = days.setdefault(day, {"agg": {}, "quality": dnc_agg.new_quality(), "source": "csv", "files": []})
            for k, n in b["agg"].items():
                cur["agg"][k] = cur["agg"].get(k, 0) + n
            dnc_agg.merge_quality(cur["quality"], b["quality"])
            cur["files"].append(name)
    return days, per_file


def dnc_agg_total(bucket):
    return [sum(bucket["agg"].values())] if bucket else [0]


def load_api_days(days_dir=None):
    out = {}
    for path in sorted(glob.glob(os.path.join(days_dir or os.path.join(B.ACQ, "dnc", "days"), "*.json"))):
        with open(path, encoding="utf-8") as handle:
            d = json.load(handle)
        out[d["day"]] = {"agg": d["agg"], "quality": d["quality"], "source": "api", "meta": {k: d[k] for k in ("pages", "distinct_records", "duplicates_dropped", "first_page_sha256", "page_hash_chain_sha256", "fetched_at")}}
    return out


def combine_days(csv_days, api_days):
    """One source per day: the FTC's daily file when there is one, else the API. Returns (days, overlap) where overlap lists
    days both sources cover with whether their aggregates are identical."""
    days = dict(api_days)
    overlap = []
    for day, d in csv_days.items():
        if day in api_days:
            overlap.append({"day": day, "records_csv": sum(d["agg"].values()), "records_api": sum(api_days[day]["agg"].values()), "identical": d["agg"] == api_days[day]["agg"]})
        days[day] = d
    return days, overlap


def month_groups(days):
    out = {}
    for day in sorted(days):
        out.setdefault(day[:7], []).append(day)
    return out


def summarize_month(day_list, days):
    """Totals for the days listed: {total, robo, subjects, by_state, quality}."""
    agg = dnc_agg.sum_agg(days[d]["agg"] for d in day_list)
    quality = dnc_agg.new_quality()
    for d in day_list:
        dnc_agg.merge_quality(quality, days[d]["quality"])
    robo = {"Y": 0, "N": 0, "": 0}
    other_robo = 0
    subjects, by_state, unassigned = {}, {}, {}
    total = 0
    for k, n in agg.items():
        state, subject, flag = dnc_agg.split_key(k)
        total += n
        if flag in robo:
            robo[flag] += n
        else:
            other_robo += n
        subjects[subject or "Not recorded"] = subjects.get(subject or "Not recorded", 0) + n
        usps = dnc_agg.state_code(state)
        if usps:
            st = by_state.setdefault(usps, {"total": 0, "Y": 0, "N": 0, "": 0, "subjects": {}})
            st["total"] += n
            st[flag if flag in ("Y", "N") else ""] += n
            st["subjects"][subject or "Not recorded"] = st["subjects"].get(subject or "Not recorded", 0) + n
        else:
            unassigned[state or "Not recorded"] = unassigned.get(state or "Not recorded", 0) + n
    return {"total": total, "robo_y": robo["Y"], "robo_n": robo["N"], "robo_blank": robo[""] + other_robo, "subjects": subjects, "by_state": by_state, "unassigned_state": unassigned, "quality": quality}


def named_subjects(subjects):
    """Subjects by count, largest first, without the FTC's catch-all buckets ('Other', 'No Subject Provided')."""
    return sorted(((k, v) for k, v in subjects.items() if k not in NON_TOPICS), key=lambda kv: (-kv[1], kv[0]))


def robocall_share(y, n):
    return B.share_pct(y, (y + n) if (y is not None and n is not None) else None)


def official_monthly(entries=None):
    """The FTC dashboard's monthly comparison: [{month 'YYYY-MM', live, robocall, total}] for the months it shows."""
    path = os.path.join(B.ACQ, "tableau", "DoNotCallComplaints__MonthlyComparison.csv")
    if not os.path.exists(path):
        return []
    rows = list(csv.DictReader(io.StringIO(open(path, encoding="utf-8").read())))
    by_month = {}
    for r in rows:
        m = re.match(r"^([A-Za-z]+) (\d{4})$", (r.get("Month of CY Date (from FY)") or "").strip())
        if not m or m.group(1) not in MONTHS:
            continue
        key = f"{m.group(2)}-{MONTHS.index(m.group(1)) + 1:02d}"
        kind = {"Live Caller": "live", "Robocall": "robocall"}.get((r.get("Call Type") or "").strip())
        n = B.C.fmt_int  # noqa: F841 (formatting helper imported for symmetry)
        val = int((r.get("Main Reference Num") or "").replace(",", "")) if (r.get("Main Reference Num") or "").replace(",", "").isdigit() else None
        tot = int((r.get("Main Reference Num Total") or "").replace(",", "")) if (r.get("Main Reference Num Total") or "").replace(",", "").isdigit() else None
        if not kind or val is None:
            continue
        cur = by_month.setdefault(key, {"month": key, "live": None, "robocall": None, "total": tot})
        cur[kind] = val
    out = []
    for key, v in sorted(by_month.items()):
        v["parts_sum_equals_total"] = v["live"] is not None and v["robocall"] is not None and v["live"] + v["robocall"] == v["total"]
        out.append(v)
    return out


def build(days=None, overlap=None, per_file=None, month_counts=None, official=None, population=None, entries=None):
    entries = entries if entries is not None else B.current_entries()
    if days is None:
        csv_days, per_file = load_csv_days()
        api_days = load_api_days()
        days, overlap = combine_days(csv_days, api_days)
    overlap = overlap or []
    per_file = per_file or []
    month_counts = month_counts if month_counts is not None else {}
    official = official if official is not None else official_monthly()
    if population is None:
        with open(os.path.join(B.LOOKUPS, "census_pop_state.json"), encoding="utf-8") as handle:
            pop_doc = json.load(handle)
    else:
        pop_doc = population
    pop = pop_doc["population"]
    pop_year = pop_doc["year"]
    groups = month_groups(days)
    rows = []
    months_meta = {}
    prev_total = {}
    for key in sorted(set(groups) | set(month_counts)):
        in_days = groups.get(key, [])
        n_days = days_in_month(key)
        complete = len(in_days) == n_days
        if in_days:
            s = summarize_month(in_days, days)
            sources = sorted({days[d]["source"] for d in in_days})
            method = "records"
        else:
            c = month_counts[key]
            s = {"total": c["total"], "robo_y": c.get("robo_y"), "robo_n": c.get("robo_n"), "robo_blank": None, "subjects": {}, "by_state": {}, "unassigned_state": {}, "quality": None}
            sources, method, complete = ["api_count"], "count", True
        share = robocall_share(s["robo_y"], s["robo_n"])
        first_day, last_day = (in_days[0], in_days[-1]) if in_days else (None, None)
        months_meta[key] = {"method": method, "days_covered": len(in_days) if in_days else n_days, "days_in_month": n_days, "complete": complete, "sources": sources, "total": s["total"], "first_day": first_day, "last_day": last_day}
        top = named_subjects(s["subjects"])
        facts = [
            ("Month", month_label(key) + ("" if complete else f" (partial: {first_day} to {last_day})")),
            ("Calls reported to the FTC", B.fmt_int(s["total"])),
            ("Reported as a recorded message or robocall", B.fmt_int(s["robo_y"])),
            ("Reported as not a recording", B.fmt_int(s["robo_n"])),
            ("No answer recorded for the robocall question", B.fmt_int(s["robo_blank"])),
            ("Robocall share of calls with an answer", B.fmt_pct(share, 1) + " (derived)" if share is not None else None),
            ("Most reported named subject (not counting Other and No Subject Provided)", f"{top[0][0]} ({B.fmt_int(top[0][1])})" if top else None),
            ("Days with a source", f"{len(in_days) if in_days else n_days} of {n_days}"),
            ("Method", "Every record counted by the day it was created" if method == "records" else "Records returned by the FTC API for the month's created dates, counted by paging; subjects and states were not read"),
            ("Caveat", RECALL),
        ]
        rows.append(
            B.record(
                "ftc_dnc_reported_calls", f"US-{key}", f"Do Not Call reported calls, {month_label(key)}",
                source_url=DATA_PAGE if "csv" in sources else API_DOCS, subtitle="United States" + ("" if complete else ", partial month"),
                cells={"month": month_label(key), "scope": "United States", "calls": B.fmt_int(s["total"]), "robocalls": B.fmt_int(s["robo_y"]), "robocall_share": B.fmt_pct(share, 1), "top_subject": top[0][0] if top else B.NOT_RECORDED},
                facts=facts, links=[{"url": DATA_PAGE, "label": "FTC Do Not Call reported calls data"}],
                text="Do Not Call reported calls robocalls telemarketing unwanted calls month United States",
                filters={"kind": ["national"], "month": [key], "year": [key[:4]], "complete": ["yes" if complete else "no"]},
                extra={
                    "kind": "national", "month": key, "complete": complete, "method": method, "sources": sources, "first_day": first_day, "last_day": last_day, "days_covered": months_meta[key]["days_covered"],
                    "days_in_month": n_days, "metrics": {"calls": s["total"], "robocalls": s["robo_y"], "not_robocalls": s["robo_n"], "no_flag": s["robo_blank"]},
                    "analytics": {"robocall_share_pct": share}, "subjects": s["subjects"], "unassigned_state": s["unassigned_state"], "quality": s["quality"],
                },
            )
        )
        if method != "records":
            continue
        ranked = []
        for usps, st in s["by_state"].items():
            p = pop.get(usps)
            ranked.append((usps, st["total"] / p * 100000 if p else None))
        order = sorted((x for x in ranked if x[1] is not None), key=lambda x: (-x[1], x[0]))
        rank = {u: i + 1 for i, (u, _) in enumerate(order)}
        for usps, st in sorted(s["by_state"].items()):
            p = pop.get(usps)
            per100k = round(st["total"] / p * 100000, 1) if p else None
            sshare = robocall_share(st["Y"], st["N"])
            name = dnc_agg.STATE_NAMES[usps]
            stop = named_subjects(st["subjects"])
            rows.append(
                B.record(
                    "ftc_dnc_reported_calls", f"{usps}-{key}", f"{name}: Do Not Call reported calls, {month_label(key)}",
                    source_url=DATA_PAGE if "csv" in sources else API_DOCS, subtitle=name + ("" if complete else ", partial month"),
                    cells={"month": month_label(key), "scope": name, "calls": B.fmt_int(st["total"]), "robocalls": B.fmt_int(st["Y"]), "robocall_share": B.fmt_pct(sshare, 1), "top_subject": stop[0][0] if stop else B.NOT_RECORDED},
                    facts=[
                        ("State", f"{name} ({usps}): the state the consumer reported"), ("Month", month_label(key) + ("" if complete else f" (partial: {first_day} to {last_day})")),
                        ("Calls reported", B.fmt_int(st["total"])), ("Per 100,000 residents", f"{per100k:,.1f}; denominator: Census resident population of July 1, {pop_year} (Population Estimates, vintage {pop_doc['vintage']})" if per100k is not None else None),
                        ("Rank by calls per resident", f"{rank[usps]} of {len(rank)} (50 states, DC and Puerto Rico)" if usps in rank else None),
                        ("Reported as a recorded message or robocall", B.fmt_int(st["Y"])), ("Robocall share of calls with an answer", B.fmt_pct(sshare, 1) + " (derived)" if sshare is not None else None),
                        ("Most reported named subject (not counting Other and No Subject Provided)", f"{stop[0][0]} ({B.fmt_int(stop[0][1])})" if stop else None), ("Caveat", RECALL),
                    ],
                    state=usps, links=B.places(usps, name) + [{"url": DATA_PAGE, "label": "FTC Do Not Call reported calls data"}],
                    text=f"Do Not Call reported calls robocalls {name} {usps} {month_label(key)}",
                    filters={"kind": ["state"], "month": [key], "year": [key[:4]], "complete": ["yes" if complete else "no"]},
                    extra={
                        "kind": "state", "month": key, "complete": complete, "usps": usps, "first_day": first_day, "last_day": last_day,
                        "metrics": {"calls": st["total"], "robocalls": st["Y"], "not_robocalls": st["N"], "no_flag": st[""], "population": p, "population_year": pop_year},
                        "analytics": {"per100k": per100k, "rank_per100k": rank.get(usps), "ranked_of": len(rank), "robocall_share_pct": sshare}, "subjects": st["subjects"],
                    },
                )
            )
    for o in official:
        key = o["month"]
        rows.append(
            B.record(
                "ftc_dnc_reported_calls", f"official-{key}", f"Do Not Call complaints, {month_label(key)} (FTC dashboard)",
                source_url=TABLEAU_VIEW, subtitle="As shown on the FTC's Do Not Call Complaints dashboard",
                cells={"month": month_label(key), "scope": "United States (FTC dashboard)", "calls": B.fmt_int(o["total"]), "robocalls": B.fmt_int(o["robocall"]), "robocall_share": B.fmt_pct(robocall_share(o["robocall"], o["live"]), 1), "top_subject": B.NOT_RECORDED},
                facts=[("Month", month_label(key)), ("Complaints", B.fmt_int(o["total"])), ("Robocall", B.fmt_int(o["robocall"])), ("Live caller", B.fmt_int(o["live"])),
                       ("Source", f"Data download of the 'Monthly Comparison' view of the FTC's Do Not Call Complaints dashboard on Tableau Public ({TABLEAU_VIEW}); the view shows only April to June of each year"),
                       ("Robocall share of the two call types (derived)", B.fmt_pct(robocall_share(o["robocall"], o["live"]), 1))],
                links=[{"url": TABLEAU_VIEW, "label": "FTC Do Not Call Complaints dashboard"}],
                text="Do Not Call complaints FTC dashboard monthly comparison robocall live caller",
                filters={"kind": ["official"], "month": [key], "year": [key[:4]], "complete": ["yes"]},
                extra={"kind": "official", "month": key, "complete": True, "metrics": {"calls": o["total"], "robocalls": o["robocall"], "live_callers": o["live"]}, "analytics": {"robocall_share_pct": robocall_share(o["robocall"], o["live"])}, "parts_sum_equals_total": o["parts_sum_equals_total"]},
            )
        )
    return rows, months_meta, overlap, per_file, official, pop_doc


def dnc_listing():
    return B.writer.listing(
        [("month", "Month"), ("scope", "Scope"), ("calls", "Calls reported"), ("robocalls", "Robocalls"), ("robocall_share", "Robocall share"), ("top_subject", "Most reported subject")],
        [("kind", "Rows", {"national": "United States by month", "state": "States by month", "official": "FTC dashboard months"}), ("year", "Year", {str(y): str(y) for y in range(2026, 2019, -1)})],
    )


def crosscheck_official(months_meta, official):
    out = []
    for o in official:
        meta = months_meta.get(o["month"])
        if not meta:
            out.append({"month": o["month"], "official_total": o["total"], "ours": None, "status": "no matching month in this build"})
        else:
            out.append({"month": o["month"], "official_total": o["total"], "ours": meta["total"], "complete": meta["complete"], "equal": meta["total"] == o["total"], "status": "equal" if meta["total"] == o["total"] else "differs"})
    return out


def build_summary(rows, months_meta, overlap, per_file, official, pop_doc):
    complete = [k for k, m in months_meta.items() if m["complete"]]
    partial = [k for k, m in months_meta.items() if not m["complete"]]
    nat = [r for r in rows if r["item"].get("kind") == "national"]
    totals = dnc_agg.new_quality()
    for r in nat:
        q = r["item"].get("quality")
        if q:
            dnc_agg.merge_quality(totals, q)
    subjects = {}
    for r in nat:
        if r["item"]["method"] != "records":
            continue
        for s, n in r["item"]["subjects"].items():
            subjects[s] = subjects.get(s, 0) + n
    csv_days = sorted(d for f in per_file for d in f["created_days"])
    return {
        "label": "FTC Do Not Call reported calls by month, state and subject", "rows": len(rows), "terms": B.GOV_TERMS + " " + B.API_TERMS + " The FTC states that none of the information in the Do Not Call reported-call data is verified.",
        "coverage": {
            "complete_months": complete, "partial_months": [{"month": k, "first_day": months_meta[k]["first_day"], "last_day": months_meta[k]["last_day"], "days_covered": months_meta[k]["days_covered"]} for k in partial],
            "csv_created_days": [csv_days[0], csv_days[-1]] if csv_days else None, "csv_files": len(per_file),
            "months_by_method": {k: m["method"] for k, m in months_meta.items()},
        },
        "sources": {"daily_csv_files": [{"name": f["name"], "url": CSV_URL.format(name=f["name"]), "rows": f["rows"], "sha256": f["sha256"], "created_days": f["created_days"]} for f in per_file], "api_documentation": API_DOCS, "data_page": DATA_PAGE, "dashboard_view": TABLEAU_VIEW},
        "validation": {"csv_vs_api_days": overlap, "official_dashboard_months": crosscheck_official(months_meta, official), "csv_malformed_rows": sum(f["malformed_rows"] for f in per_file)},
        "quality_of_published_records": totals, "subjects_in_records_months": dict(sorted(subjects.items(), key=lambda kv: (-kv[1], kv[0]))),
        "population_denominator": {"source": pop_doc["source"], "url": pop_doc["source_url"], "year": pop_doc["year"]},
        "formulas": FORMULAS,
        "caveats": [
            RECALL,
            "The state is the state the consumer reported; calls reported with no state, or a Canadian province, a territory other than Puerto Rico or a military post, are in the national count only.",
            "A call's robocall answer is the consumer's: about one in sixteen reports carry none, and those are left out of the robocall share.",
            "Violation dates are later than creation dates in some records; the build counts by creation date and reports the number in quality_of_published_records.",
            "Months before the earliest covered day are not counted here; the Data Book dataset (ftc_dnc_states) has annual state figures for fiscal years 2021 to 2025.",
        ],
        "built_at": B.now_utc(),
    }
