"""Build scac_statistics and scac_trend_alignment from the public Stanford Securities Class Action Clearinghouse pages.

Inputs (raw bytes and manifest under private/acq/scac/, fetched logged-out by fetch.py): filings by year (charts.html), by circuit,
sector, industry, historical trend and litigation status (heat-map lists), key statistics (stats.html), top-ten tables
(top-ten.html filters), current-trend sections with their public filing rows (current-trends.html); FRED VIXCLS and NASDAQCOM daily
CSVs; Fama/French annual factors; the FJC IDB civil series for nature of suit 850 and all civil cases (corpus, read-only lookup);
CourtListener's federal court names (exact short-name match only); the published firm_profiles dataset (exact firm key only).

    python3 -I -B scripts/enrichment/scac/build_scac.py
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "courtlistener"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "firm_intel"))

import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import firm_lib  # noqa: E402
import scac_lib as sl  # noqa: E402

ACQ = os.path.join(ROOT, "private", "acq", "scac")
RAW = os.path.join(ACQ, "raw")
LOOK = os.path.join(ROOT, "private", "build", "scac", "lookups")
OUT = os.path.join(ROOT, "private", "build", "scac")
SITE = "https://securities.stanford.edu/"
THROUGH = "2025-07-28"
LAST_FULL_YEAR = 2024
CREDIT = ("Stanford Law School Securities Class Action Clearinghouse, in cooperation with Cornerstone Research; "
          "used with permission reported by the site owner")
AS_OF = f"SCAC is restructuring; its data run through {THROUGH} (6,879 filings since 1996) and no newer filings are published"
CIRCUITS = {"1st": "ca1", "2nd": "ca2", "3rd": "ca3", "4th": "ca4", "5th": "ca5", "6th": "ca6", "7th": "ca7", "8th": "ca8",
            "9th": "ca9", "10th": "ca10", "11th": "ca11", "D.C.": "cadc"}
FILES = {
    "charts": ("securities.stanford.edu/charts.html", SITE + "charts.html"),
    "stats": ("securities.stanford.edu/stats.html", SITE + "stats.html"),
    "circuits": ("securities.stanford.edu/circuits.html", SITE + "circuits.html"),
    "sector": ("securities.stanford.edu/sector.html", SITE + "sector.html"),
    "industry": ("securities.stanford.edu/industry.html", SITE + "industry.html"),
    "historical": ("securities.stanford.edu/historical.html", SITE + "historical.html"),
    "status": ("securities.stanford.edu/litigation.html", SITE + "litigation.html"),
    "settlement": ("securities.stanford.edu/top-ten.html__q_e366813119.bin", SITE + "top-ten.html?filter=settlement"),
    "longest": ("securities.stanford.edu/top-ten.html__q_8eb33de952.bin", SITE + "top-ten.html?filter=longest_lawsuit"),
    "firms": ("securities.stanford.edu/top-ten.html__q_b74694f80f.bin", SITE + "top-ten.html?filter=plaintiff_firm"),
    "trends": ("securities.stanford.edu/current-trends.html", SITE + "current-trends.html"),
    "vix": ("fred.stlouisfed.org/graph__fredgraph.csv__q_df68d320aa.bin", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS"),
    "nasdaq": ("fred.stlouisfed.org/graph__fredgraph.csv__q_650a63dc0b.bin", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=NASDAQCOM"),
    "ff": ("mba.tuck.dartmouth.edu/pages__faculty__ken.french__ftp__F-F_Research_Data_Factors_CSV.zip",
           "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip"),
}
SERIES_SOURCE = {
    "vix": "CBOE Volatility Index (VIXCLS) via FRED, Federal Reserve Bank of St. Louis",
    "nasdaq": "NASDAQ Composite Index (NASDAQCOM) via FRED, Federal Reserve Bank of St. Louis",
    "ff": "Kenneth R. French Data Library, Fama/French 3 factors (annual, January-December)",
    "fjc": "Federal Judicial Center Integrated Database, civil cases by fiscal year (October-September)",
}


def raw(key: str, binary: bool = False):
    path = os.path.join(RAW, FILES[key][0])
    data = open(path, "rb").read()
    return data if binary else data.decode("utf-8", errors="replace")


def slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:80]


def court_index():
    rows = json.load(open(os.path.join(LOOK, "cl_courts_federal.json")))["rows"]
    by = {}
    for r in rows:
        if r["jurisdiction"] == "FD":
            by.setdefault(r["short_name"], []).append(r["id"])
    return {k: v[0] for k, v in by.items() if len(v) == 1}


def firm_index():
    path = os.path.join(ROOT, "private", "build", "firm_intel", "firm_profiles.json")
    if not os.path.exists(path):
        return {}
    return {r["item"]["profile"]["key"]: (r["id"], r["item"]["profile"]) for r in json.load(open(path))["rows"]}


def nasdaq_years(series):
    """Calendar-year return (last close vs previous year's last close) and maximum drawdown within the year (percent)."""
    by = {}
    for d, v in series:
        by.setdefault(d.year, []).append((d, v))
    out = {}
    prev_last = None
    for y in sorted(by):
        obs = sorted(by[y])
        peak, dd = obs[0][1], 0.0
        for _, v in obs:
            peak = max(peak, v)
            dd = min(dd, v / peak - 1.0)
        last = obs[-1][1]
        out[y] = {"return_pct": round(100.0 * (last / prev_last - 1.0), 2) if prev_last else None, "max_drawdown_pct": round(100.0 * dd, 2),
                  "last": last, "n": len(obs)}
        prev_last = last
    return out


def main():
    t0 = time.time()
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    checks = {}
    years = sl.year_chart(raw("charts"))
    lists = {k: sl.heat_list(raw(k)) for k in ("circuits", "sector", "industry", "historical", "status")}
    totals = {k: sl.total_filings(raw(k)) for k in lists}
    keys = sl.key_stats(raw("stats"))
    tops = {k: sl.accordions(raw(k)) for k in ("settlement", "longest", "firms")}
    trends = sl.current_trends(raw("trends"))
    total = sum(n for _, n in years)
    for k, v in {"years": years, "keys": keys, "trends": trends, **lists, **tops}.items():
        if not v:
            raise SystemExit(f"parse failed: {k}")
    checks["sum of yearly filings equals the 6,879 shown"] = total == 6879 == totals["circuits"]
    checks["circuits sum to the total"] = sum(n for _, n in lists["circuits"]) == total
    checks["litigation status sums to the total"] = sum(n for _, n in lists["status"]) == total
    checks["sector counts (filings with a recorded sector)"] = sum(n for _, n in lists["sector"])
    checks["industry counts (filings with a recorded industry)"] = sum(n for _, n in lists["industry"])
    checks["each current trend lists as many filings as its heading states"] = all(len(t["rows"]) == t["filings"] for t in trends)
    checks["top-ten tables have ten entries"] = all(len(v) == 10 for v in tops.values())
    if not all(v for k, v in checks.items() if isinstance(v, bool)):
        raise SystemExit(f"checks failed: {checks}")
    courts = court_index()
    firms = firm_index()
    fjc = json.load(open(os.path.join(LOOK, "fjc_series.json")))
    nos850 = {r["fy"]: r for r in fjc["nos850"]}
    national = {r["fy"]: r for r in fjc["national"]}
    vix = sl.yearly(sl.fred_csv(raw("vix", True)))
    nasdaq = nasdaq_years(sl.fred_csv(raw("nasdaq", True)))
    ff = sl.ff_annual(raw("ff", True))
    rows_s = []
    page = {k: v[1] for k, v in FILES.items()}

    def rec(rid, title, url, *, subtitle, cells, facts, profile, badges=None, links=None, kind):
        rows_s.append(writer.record(
            "scac_statistics", rid, title, source_url=url, subtitle=subtitle, cells={"kind": kind, **cells},
            badges=(badges or []) + ["Stanford SCAC"], links=links or [],
            facts=[[k, "Not recorded" if v is None else str(v)] for k, v in facts] + [["Source", CREDIT], ["As of", AS_OF]],
            text=f"securities class action {title}", filters={"kind": [kind]}, extra={"profile": {"kind": kind, **profile}}))

    # ---- overview
    key_map = dict(keys)
    rec("overview:all", "Federal securities class action filings since 1996 (Stanford SCAC)", page["stats"], kind="overview",
        subtitle=f"{total:,} filings 1996–{THROUGH[:4]} · {key_map['Number of Filings Settled']} settled · {key_map['Number of Filings Dismissed']} dismissed · "
                 f"{key_map['Number of Filings Still Ongoing']} ongoing",
        cells={"title": "Overview", "filings": total},
        facts=[(k, v) for k, v in keys] + [("Filings by year, 1996–2025", f"{total:,} (2025 runs only to {THROUGH})"),
                                          ("Filings with a recorded sector", f"{checks['sector counts (filings with a recorded sector)']:,} of {total:,}")],
        profile={"key_stats": [{"label": k, "value": v} for k, v in keys], "total": total, "through": THROUGH, "checks": checks,
                 "status": [{"label": k.title(), "filings": n, "share_pct": cc.share(n, total)} for k, n in lists["status"]],
                 "settlements_total_usd": sl.money(key_map["Total $ Amount of All Settlements"])})

    # ---- years
    prev = None
    for y, n in years:
        f850 = nos850.get(y)
        nat = national.get(y)
        partial = y > LAST_FULL_YEAR
        rec(f"year:{y}", f"Securities class action filings in {y}", page["charts"], kind="year",
            subtitle=f"{n:,} filings{' (to ' + THROUGH + ')' if partial else ''}" + (f" · {n - prev:+,} vs {y - 1}" if prev is not None and not partial else ""),
            cells={"title": str(y), "year": y, "filings": n, "share_pct": cc.share(n, total), "partial": partial,
                   "fjc_nos850_class_actions": f850["class_action"] if f850 else None},
            facts=[("Calendar year", y), ("SCAC filings", f"{n:,}" + (f" (partial year, data to {THROUGH})" if partial else "")),
                   ("Share of all filings since 1996", f"{cc.share(n, total)}%"),
                   ("Change from the previous year", f"{n - prev:+,}" if prev is not None and not partial else None),
                   (f"FJC IDB securities (NOS 850) civil cases filed, FY{y}", f"{f850['filings']:,}" if f850 else None),
                   (f"FJC IDB NOS 850 cases marked class action, FY{y}", f"{f850['class_action']:,}" if f850 else None),
                   (f"FJC IDB all federal civil class actions, FY{y}", f"{nat['class_action']:,}" if nat else None),
                   ("Reading", "SCAC counts one 'filing' per underlying event and may group several complaints; FJC counts cases by federal fiscal year (October–September). The two are context for each other, not the same measure.")],
            profile={"year": y, "filings": n, "partial": partial, "fjc_nos850": f850, "fjc_national": nat})
        prev = n

    # ---- circuits, status, sector, industry, historical trends
    for label, n in lists["circuits"]:
        cid = CIRCUITS.get(label)
        rec(f"circuit:{slug(label)}", f"Securities class action filings in the {label} Circuit" if label != "D.C." else "Securities class action filings in the D.C. Circuit",
            page["circuits"], kind="circuit", subtitle=f"{n:,} filings since 1996 · {cc.share(n, total)}% of all",
            cells={"title": f"{label} Circuit", "filings": n, "share_pct": cc.share(n, total), "court_id": cid},
            facts=[("Circuit", label), ("Filings, 1996 to " + THROUGH, f"{n:,}"), ("Share of all filings", f"{cc.share(n, total)}%")],
            links=[{"label": "Court page", "url": f"/courts/{cid}"}] if cid else [], profile={"label": label, "filings": n, "court_id": cid})
    for kind, url_key, noun in (("status", "status", "Litigation status"), ("sector", "sector", "Sector"), ("industry", "industry", "Industry"),
                                ("historical_trend", "historical", "Historical trend")):
        base = sum(n for _, n in lists[url_key]) if kind in ("sector", "industry") else total
        for rank, (label, n) in enumerate(lists[url_key], 1):
            shown = label.title() if kind == "status" else label
            rec(f"{kind}:{slug(label)}", f"{noun}: {shown}", page[url_key], kind=kind,
                subtitle=f"{n:,} filings · {cc.share(n, base)}% of {'filings with a recorded ' + noun.lower() if base != total else 'all filings'}",
                cells={"title": shown, "filings": n, "share_pct": cc.share(n, base), "rank": rank},
                facts=[(noun, shown), ("Filings", f"{n:,}"), ("Share", f"{cc.share(n, base)}% of {base:,}"), ("Rank", rank)],
                profile={"label": shown, "filings": n, "rank": rank, "base": base})

    # ---- current trends with public filing rows
    for t in trends:
        by_year = Counter(r["filed"][:4] for r in t["rows"] if r["filed"])
        by_court = Counter(r["court"] for r in t["rows"])
        by_sector = Counter(r["sector"] for r in t["rows"])
        rows = [{**r, "court_id": courts.get(r["court"]), "court_link": f"/courts/{courts[r['court']]}" if r["court"] in courts else None,
                 "case_page": f"{SITE}filings-case.html?id={r['case_id']}"} for r in t["rows"]]
        rec(f"current_trend:{slug(t['name'])}", f"Current trend: {t['name']}", page["trends"], kind="current_trend",
            subtitle=f"{t['filings']} filings · first {t['first']} · last {t['last']}",
            cells={"title": t["name"], "filings": t["filings"], "first": t["first"], "last": t["last"]},
            facts=[("Trend", t["name"]), ("Filings", t["filings"]), ("First filing", t["first"]), ("Last filing", t["last"]),
                   ("Most common district", "; ".join(f"{c} {n}" for c, n in by_court.most_common(3))),
                   ("Most common sector", "; ".join(f"{c} {n}" for c, n in by_sector.most_common(3))),
                   ("Case pages", "Each SCAC case page requires a logged-in SCAC account; the rows here are those the public trend page lists.")],
            profile={"name": t["name"], "filings": t["filings"], "first": t["first"], "last": t["last"],
                     "by_year": [{"year": int(y), "filings": n} for y, n in sorted(by_year.items())],
                     "by_court": [{"court": c, "filings": n, "court_id": courts.get(c), "link": f"/courts/{courts[c]}" if c in courts else None} for c, n in by_court.most_common()],
                     "by_sector": [{"sector": c, "filings": n} for c, n in by_sector.most_common()], "rows": rows})
    unmatched = sorted({r["court"] for t in trends for r in t["rows"] if r["court"] not in courts})
    checks["trend districts without an exact CourtListener short-name match"] = unmatched

    # ---- top-ten tables
    for rank, a in enumerate(tops["settlement"], 1):
        amt, fees = sl.money(a["figure"]), sl.money(a["details"].get("Fees & Expenses", ""))
        rec(f"top_settlement:{rank}", f"Largest settlement #{rank}: {a['entity']}", page["settlement"], kind="top_settlement",
            subtitle=f"${amt:,} · fees and expenses ${fees:,}" if amt and fees else a["figure"],
            cells={"title": a["entity"], "rank": rank, "amount_usd": amt, "fees_usd": fees, "fees_pct": cc.share(fees, amt) if amt and fees else None},
            facts=[("Rank", rank), ("Case", a["entity"]), ("Settlement", f"${amt:,}" if amt else None), ("Fees and expenses", f"${fees:,}" if fees else None),
                   ("Fees as a share of the settlement", f"{cc.share(fees, amt)}%" if amt and fees else None), ("Stage", a["stage"]),
                   ("Settlement ruling pending", a["details"].get("Settlement Ruling Pending"))],
            profile={**a, "rank": rank, "amount_usd": amt, "fees_usd": fees, "settled_on": sl.us_date(a["stage"] or "")})
    for rank, a in enumerate(tops["longest"], 1):
        days = int(re.sub(r"\D", "", a["figure"])) if re.search(r"\d", a["figure"]) else None
        rec(f"top_duration:{rank}", f"Longest lawsuit #{rank}: {a['entity']}", page["longest"], kind="top_duration",
            subtitle=f"{days:,} days ({round(days / 365.25, 1)} years)" if days else a["figure"],
            cells={"title": a["entity"], "rank": rank, "days": days, "filed": sl.us_date(a["details"].get("Filing Date", "")),
                   "last_stage": sl.us_date(a["details"].get("Last Stage of Litigation Recorded Date", ""))},
            facts=[("Rank", rank), ("Case", a["entity"]), ("Days", f"{days:,}" if days else None), ("Filed", a["details"].get("Filing Date")),
                   ("Last stage recorded", a["details"].get("Last Stage of Litigation Recorded Date")), ("Stage", a["stage"])],
            profile={**a, "rank": rank, "days": days})
    for rank, a in enumerate(tops["firms"], 1):
        n = int(a["figure"].replace(",", "")) if a["figure"].replace(",", "").isdigit() else None
        key = firm_lib.firm_key(a["entity"])
        hit = firms.get(key)
        rec(f"top_plaintiff_firm:{rank}", f"Most frequent plaintiff firm #{rank}: {a['entity']}", page["firms"], kind="top_plaintiff_firm",
            subtitle=f"{n:,} filings as lead or operative-complaint counsel"
                     + (f" · same name on {hit[1]['mdls']} MDL master docket{'s' if hit[1]['mdls'] != 1 else ''}" if hit else ""),
            cells={"title": a["entity"], "rank": rank, "filings": n, "mdl_profile": hit[0] if hit else None},
            facts=[("Rank", rank), ("Firm", a["entity"]), ("Filings", f"{n:,}" if n else None),
                   ("Counting (SCAC)", "Cases where the firm was appointed lead counsel or, without a court-appointed lead, filed the latest operative complaint."),
                   ("Same firm on MDL master dockets (exact name match after documented normalisation)",
                    f"{hit[1]['name']}: {hit[1]['appearances']:,} appearances in {hit[1]['mdls']} MDLs" if hit else "No exact match in the MDL firm profiles")],
            links=[{"label": "MDL firm profile", "url": f"/records/firm_profiles/{hit[0]}"}] if hit else [],
            profile={**a, "rank": rank, "filings": n, "firm_key": key, "mdl_profile": hit[0] if hit else None,
                     "mdl": {"appearances": hit[1]["appearances"], "mdls": hit[1]["mdls"], "main_side": hit[1]["main_side"]} if hit else None})

    # ---- trend alignment
    rows_a = []
    span = [y for y, _ in years]
    series = {}
    for y in span:
        series[y] = {"filings": dict(years)[y], "partial": y > LAST_FULL_YEAR,
                     "vix_mean": round(vix[y]["mean"], 2) if y in vix else None, "vix_max": round(vix[y]["max"], 2) if y in vix else None,
                     "nasdaq_return_pct": nasdaq.get(y, {}).get("return_pct"), "nasdaq_max_drawdown_pct": nasdaq.get(y, {}).get("max_drawdown_pct"),
                     "market_return_pct": round(ff[y]["Mkt-RF"] + ff[y]["RF"], 2) if y in ff else None,
                     "fjc_nos850_filings": nos850.get(y, {}).get("filings"), "fjc_nos850_class_actions": nos850.get(y, {}).get("class_action"),
                     "fjc_civil_class_actions": national.get(y, {}).get("class_action")}
    full = [y for y in span if y <= LAST_FULL_YEAR]
    for y in span:
        s = series[y]
        rows_a.append(writer.record(
            "scac_trend_alignment", f"year:{y}", f"{y}: securities class action filings beside market and court series", source_url=page["charts"],
            subtitle=f"{s['filings']:,} filings · VIX mean {s['vix_mean']} · NASDAQ {s['nasdaq_return_pct']:+}%" if s["nasdaq_return_pct"] is not None and s["vix_mean"] is not None else f"{s['filings']:,} filings",
            cells={"kind": "year", "year": y, **{k: v for k, v in s.items()}}, badges=["Stanford SCAC", "FRED", "FJC IDB"],
            facts=[[k, "Not recorded" if v is None else str(v)] for k, v in [
                ("SCAC filings (calendar year)", f"{s['filings']:,}" + (f" (to {THROUGH})" if s["partial"] else "")),
                ("VIX, mean / maximum daily close", f"{s['vix_mean']} / {s['vix_max']}" if s["vix_mean"] is not None else None),
                ("NASDAQ Composite, calendar-year return", f"{s['nasdaq_return_pct']:+}%" if s["nasdaq_return_pct"] is not None else None),
                ("NASDAQ Composite, largest fall from a high within the year", f"{s['nasdaq_max_drawdown_pct']}%" if s["nasdaq_max_drawdown_pct"] is not None else None),
                ("U.S. market return (Fama/French Mkt-RF + RF)", f"{s['market_return_pct']:+}%" if s["market_return_pct"] is not None else None),
                (f"FJC NOS 850 civil cases / marked class action, FY{y}", f"{s['fjc_nos850_filings']:,} / {s['fjc_nos850_class_actions']:,}" if s["fjc_nos850_filings"] else None),
                ("Sources", "; ".join([CREDIT, SERIES_SOURCE["vix"], SERIES_SOURCE["nasdaq"], SERIES_SOURCE["ff"], SERIES_SOURCE["fjc"]]))]],
            text=f"securities class action filings {y} market volatility", filters={"kind": ["year"]}, links=[],
            extra={"profile": {"year": y, **s}}))
    pairs = [
        ("vix_mean", 0, "VIX annual mean, same year"), ("vix_mean", 1, "VIX annual mean, previous year"),
        ("nasdaq_return_pct", 0, "NASDAQ calendar-year return, same year"), ("nasdaq_return_pct", 1, "NASDAQ calendar-year return, previous year"),
        ("nasdaq_max_drawdown_pct", 0, "NASDAQ largest fall within the year, same year"), ("nasdaq_max_drawdown_pct", 1, "NASDAQ largest fall within the year, previous year"),
        ("market_return_pct", 1, "U.S. market return (Fama/French), previous year"),
        ("fjc_nos850_filings", 0, "FJC securities (NOS 850) civil cases, same-numbered fiscal year"),
        ("fjc_nos850_class_actions", 0, "FJC NOS 850 cases marked class action, same-numbered fiscal year"),
        ("fjc_civil_class_actions", 0, "FJC all federal civil class actions, same-numbered fiscal year"),
    ]
    corr = []
    for var, lag, label in pairs:
        pts = [(y, series[y]["filings"], series.get(y - lag, {}).get(var)) for y in full]
        rho, n = cc.spearman([p[1] for p in pts], [p[2] for p in pts])
        ci = cc.fisher_ci(rho, n) if rho is not None else None
        corr.append((var, lag, label, rho, n, ci, pts))
    # first differences guard against two series that merely share a long trend
    diff_pts = [(y, series[y]["filings"] - series[y - 1]["filings"], (series[y]["vix_mean"] - series[y - 1]["vix_mean"])
                 if series[y]["vix_mean"] is not None and series.get(y - 1, {}).get("vix_mean") is not None else None) for y in full if y - 1 in series]
    rho, n = cc.spearman([p[1] for p in diff_pts], [p[2] for p in diff_pts])
    corr.append(("vix_mean_change", 0, "Year-over-year change in filings vs change in VIX annual mean", rho, n, cc.fisher_ci(rho, n) if rho is not None else None, diff_pts))
    for var, lag, label, rho, n, ci, pts in corr:
        rid = f"corr:{var}:lag{lag}"
        rows_a.append(writer.record(
            "scac_trend_alignment", rid, f"SCAC filings and {label} (Spearman, {full[0]}–{full[-1]})", source_url=page["charts"],
            subtitle=(f"rho {rho:+.2f} · 95% interval {ci[0]:+.2f} to {ci[1]:+.2f} · n = {n} years · {cc.strength(rho)}" if rho is not None and ci else f"n = {n}"),
            cells={"kind": "correlation", "title": label, "rho": round(rho, 3) if rho is not None else None, "n": n, "lag": lag,
                   "ci_low": round(ci[0], 3) if ci else None, "ci_high": round(ci[1], 3) if ci else None},
            badges=["Association, not cause"],
            facts=[["Compared", f"SCAC filings per calendar year with {label}"], ["Years", f"{full[0]}–{full[-1]} (2025 left out: partial year)"],
                   ["Spearman rho", f"{rho:+.3f}" if rho is not None else "Not recorded"], ["95% interval (Fisher z)", f"{ci[0]:+.3f} to {ci[1]:+.3f}" if ci else "Not recorded"],
                   ["n", str(n)], ["Strength", cc.strength(rho) if rho is not None else "Not recorded"],
                   ["Reading", "An association across years; it does not show that one causes the other. Single-year spikes such as 2001 (498 filings, the series high) weigh heavily on a comparison over this many years."]],
            text=f"securities class action filings correlation {label}", filters={"kind": ["correlation"]}, links=[],
            extra={"profile": {"var": var, "lag": lag, "label": label, "rho": rho, "n": n, "ci": list(ci) if ci else None,
                               "strength": cc.strength(rho) if rho is not None else None, "points": [{"year": y, "x": x, "y": v} for y, x, v in pts]}}))

    inputs = []
    for key, (rel, url) in sorted(FILES.items()):
        inputs.append({"url": url, "path": f"private/acq/scac/raw/{rel}", "sha256": hashlib.sha256(open(os.path.join(RAW, rel), "rb").read()).hexdigest()})
    for name in ("fjc_series.json", "cl_courts_federal.json"):
        inputs.append({"url": "corpus:fjc_civil_nos,fjc_civil_national" if name.startswith("fjc") else "courtlistener:courts",
                       "path": f"private/build/scac/lookups/{name}", "sha256": hashlib.sha256(open(os.path.join(LOOK, name), "rb").read()).hexdigest()})
    summary = {"source": CREDIT, "as_of": AS_OF, "checks": checks,
               "public_vs_login": {"public": ["filings by year", "by circuit, sector, industry, historical trend and litigation status", "key statistics",
                                              "top-ten settlements, longest lawsuits and plaintiff firms", "current-trend filing rows (name, date, district, exchange, ticker, sector)",
                                              "first page of the filings list"],
                                   "login_only": ["filings list beyond page 1", "advanced search", "per-case pages (class period, judge, docket number, plaintiff firms, status history, settlement)"]},
               "series": SERIES_SOURCE}
    specs = {
        "scac_statistics": {"label": "Federal securities class action filings 1996–2025: years, circuits, sectors, status, trends and top tens (Stanford SCAC)", "rows": rows_s,
                            "listing": writer.listing([("kind", "Type"), ("title", "Item"), ("filings", "Filings"), ("share_pct", "Share %"), ("rank", "Rank")],
                                                      [("kind", "Type", {"overview": "Overview", "year": "Year", "circuit": "Circuit", "status": "Litigation status",
                                                                         "sector": "Sector", "industry": "Industry", "historical_trend": "Historical trend",
                                                                         "current_trend": "Current trend", "top_settlement": "Largest settlements",
                                                                         "top_duration": "Longest lawsuits", "top_plaintiff_firm": "Plaintiff firms"})])},
        "scac_trend_alignment": {"label": "Securities class action filings beside market volatility, returns and federal court series, 1996–2025", "rows": rows_a,
                                 "listing": writer.listing([("kind", "Type"), ("year", "Year"), ("title", "Measure"), ("filings", "Filings"), ("vix_mean", "VIX mean"),
                                                            ("nasdaq_return_pct", "NASDAQ return %"), ("rho", "rho"), ("n", "n")],
                                                           [("kind", "Type", {"year": "Year", "correlation": "Association"})])},
    }
    os.makedirs(OUT, exist_ok=True)
    for ds, s in specs.items():
        spec = {"dataset": ds, "label": s["label"], "listing_block": s["listing"], "summary": {**summary, "totals": {"records": len(s["rows"])}},
                "rows": s["rows"], "built_at": built_at, "inputs": inputs}
        path = os.path.join(OUT, ds + ".json")
        with open(path + ".tmp", "w") as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(ds, len(s["rows"]), "rows", os.path.getsize(path) // 1024, "KB")
    print(json.dumps(checks, default=str))
    for var, lag, label, rho, n, ci, _ in corr:
        print(f"  {label:70s} rho={rho:+.3f} n={n} ci={ci[0]:+.2f}..{ci[1]:+.2f}" if rho is not None and ci else f"  {label} n={n}")
    print(f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
