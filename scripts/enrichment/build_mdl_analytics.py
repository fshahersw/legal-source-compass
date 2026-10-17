"""Build MDL and mass-tort analytics from JPML monthly reports and publish them to the corpus.

Inputs (private/acq/jpml): actions_series.json (parse_actions.py), mdl_meta.json (parse_meta.py).
Outputs: datasets mdl_analytics (per MDL + portfolio summaries) and mdl_terminated_history.
"""
import json
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import corpus_writer as cw  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ACQ = ROOT / "private" / "acq" / "jpml"
JPML_STATS = "https://www.jpml.uscourts.gov/statistics-info"
JPML_ARCHIVE = "https://www.jpml.uscourts.gov/pending-mdl-reports-archive"
MASS_TORT_TYPES = {"Products Liability", "Common Disaster", "Air Disaster"}


def months_between(start: str, end: str) -> float:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return (b - a).days / 30.4375


def point_at_or_before(points: dict, target: str):
    keys = sorted(k for k in points if k <= target)
    return (keys[-1], points[keys[-1]]) if keys else (None, None)


def shift(iso: str, months: int) -> str:
    d = date.fromisoformat(iso)
    month = d.month - months
    year = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    return date(year, month, min(d.day, 28)).isoformat()


def fmt(n):
    return f"{n:,}" if isinstance(n, int) else ("Not recorded" if n is None else str(n))


def signed(n):
    return "Not recorded" if n is None else (f"+{n:,}" if n > 0 else f"{n:,}")


def growth_bucket(change, base):
    if change is None or not base:
        return "insufficient_history"
    pct = change / base
    if pct >= 0.25:
        return "fast_growth"
    if pct >= 0.05:
        return "growing"
    if pct > -0.05:
        return "stable"
    return "declining"


GROWTH_LABELS = {
    "fast_growth": "Growing 25%+ in 12 months",
    "growing": "Growing 5–25%",
    "stable": "Stable (±5%)",
    "declining": "Declining 5%+",
    "insufficient_history": "Less than 12 months of reports",
}


def build():
    series = json.loads((ACQ / "actions_series.json").read_text())
    meta = json.loads((ACQ / "mdl_meta.json").read_text())
    report_dates = sorted(r["date"] for r in series["reports"])
    latest = report_dates[-1]
    typed = {r["mdl"]: r for r in meta["active_by_type"]}
    listing = {r["mdl"]: r for r in meta["active_listing"]}
    terminated = {r["mdl"]: r for r in meta["recently_terminated"]}

    rows, per_mdl = [], []
    for entry in series["mdls"]:
        mdl = entry["mdl"]
        points = entry["points"]
        last_date = max(points)
        last = points[last_date]
        info = listing.get(mdl) or terminated.get(mdl) or {}
        mdl_type = (typed.get(mdl) or {}).get("mdl_type")
        closed = (terminated.get(mdl) or {}).get("date_closed")
        status = "pending" if last_date == latest else ("terminated" if closed else "no_longer_listed")
        def change(months):
            past_date, past = point_at_or_before(points, shift(last_date, months))
            if not past or months_between(past_date, last_date) < months - 0.6:
                return None, None, None
            return last["pending"] - past["pending"], last["total"] - past["total"], past["pending"]
        d1, _, _ = change(1)
        d3, _, _ = change(3)
        d12, new12, base12 = change(12)
        resolved12 = None if new12 is None else new12 - d12
        transferred = info.get("date_transferred")
        age_years = round(months_between(transferred, latest) / 12, 1) if transferred else None
        bucket = growth_bucket(d12, base12)
        mass_tort = mdl_type in MASS_TORT_TYPES
        title = entry["title"]
        ordered = [{"date": k, "pending": points[k]["pending"], "total": points[k]["total"]} for k in sorted(points)]
        peak = max(ordered, key=lambda p: p["pending"])
        rec = {
            "mdl": mdl, "title": title, "type": mdl_type, "mass_tort": mass_tort, "status": status,
            "district": last["district"], "judge": last["judge"], "judge_title": last["judge_title"],
            "pending": last["pending"], "total": last["total"], "as_of": last_date,
            "change_1m": d1, "change_3m": d3, "change_12m": d12, "new_12m": new12, "resolved_12m": resolved12,
            "date_filed": info.get("date_filed"), "date_transferred": transferred, "date_closed": closed,
            "master_docket": info.get("master_docket"), "age_years": age_years, "growth": bucket,
            "peak_pending": peak["pending"], "peak_date": peak["date"], "series": ordered,
        }
        per_mdl.append(rec)

    ranked = sorted((r for r in per_mdl if r["status"] == "pending"), key=lambda r: -r["pending"])
    rank = {r["mdl"]: i + 1 for i, r in enumerate(ranked)}
    total_pending = sum(r["pending"] for r in ranked)

    for r in per_mdl:
        share = round(100 * r["pending"] / total_pending, 2) if r["status"] == "pending" and total_pending else None
        facts = [
            ["MDL number", str(r["mdl"])],
            ["Litigation type (JPML)", r["type"] or "Not recorded"],
            ["Status", {"pending": f"Pending as of {latest}", "terminated": f"Terminated {r['date_closed']}", "no_longer_listed": f"Last listed {r['as_of']}"}[r["status"]]],
            ["Transferee district", r["district"] or "Not recorded"],
            ["Transferee judge", f"{r['judge']} ({r['judge_title']})" if r["judge_title"] else (r["judge"] or "Not recorded")],
            ["Actions now pending", fmt(r["pending"])],
            ["Total actions (historical)", fmt(r["total"])],
            ["Change in pending, 1 month", signed(r["change_1m"])],
            ["Change in pending, 3 months", signed(r["change_3m"])],
            ["Change in pending, 12 months", signed(r["change_12m"])],
            ["New actions, 12 months", fmt(r["new_12m"])],
            ["Actions resolved, 12 months", fmt(r["resolved_12m"])],
            ["Peak pending in series", f"{fmt(r['peak_pending'])} on {r['peak_date']}"],
            ["Share of all pending MDL actions", f"{share}%" if share is not None else "Not applicable"],
            ["Rank by pending actions", str(rank[r["mdl"]]) if r["mdl"] in rank else "Not ranked"],
            ["Date filed", r["date_filed"] or "Not recorded"],
            ["Date transferred", r["date_transferred"] or "Not recorded"],
            ["Years since transfer", str(r["age_years"]) if r["age_years"] is not None else "Not recorded"],
            ["Master docket", r["master_docket"] or "Not recorded"],
            ["Monthly reports in series", f"{len(r['series'])} ({r['series'][0]['date']} to {r['series'][-1]['date']})"],
            ["Source", "JPML MDL Statistics Reports, Distribution of Pending MDL Dockets by Actions Pending (monthly)"],
        ]
        cells = {
            "mdl": str(r["mdl"]), "litigation": r["title"], "type": r["type"] or "Not recorded",
            "pending": fmt(r["pending"]), "change_12m": signed(r["change_12m"]), "new_12m": fmt(r["new_12m"]),
            "district": r["district"] or "—", "judge": r["judge"] or "—",
            "status": r["status"].replace("_", " "),
        }
        badges = [b for b in [
            "Mass tort" if r["mass_tort"] else None,
            GROWTH_LABELS[r["growth"]] if r["growth"] != "insufficient_history" else None,
            f"#{rank[r['mdl']]} by pending" if r["mdl"] in rank and rank[r["mdl"]] <= 25 else None,
        ] if b]
        rows.append(cw.record(
            "mdl_analytics", str(r["mdl"]), r["title"],
            source_url=JPML_ARCHIVE,
            subtitle=f"MDL {r['mdl']} · {r['type'] or 'Type not recorded'} · {r['district'] or ''} · {fmt(r['pending'])} pending",
            cells=cells, facts=facts, badges=badges,
            links=[{"url": f"/records/mdls/{r['mdl']}", "label": "MDL record"}, {"url": JPML_ARCHIVE, "label": "JPML monthly reports"}],
            text=f"{r['type']} {r['judge']} {r['district']} {r['master_docket']}",
            filters={
                "type": [(r["type"] or "not_recorded").lower()], "mass_tort": ["yes" if r["mass_tort"] else "no"],
                "status": [r["status"]], "growth": [r["growth"]], "district": [r["district"] or ""],
                "date": r["as_of"],
            },
            extra={"kind": "mdl", "analytics": {k: v for k, v in r.items() if k != "title"}, "rank": rank.get(r["mdl"]), "share_pct": share},
        ))

    rows.extend(summaries(per_mdl, report_dates, series, latest))
    return rows, per_mdl


def summaries(per_mdl, report_dates, series, latest):
    out = []
    portfolio = []
    for d in report_dates:
        all_p = mass = 0
        n = n_mass = 0
        for r in per_mdl:
            p = next((s for s in r["series"] if s["date"] == d), None)
            if p:
                all_p += p["pending"]; n += 1
                if r["mass_tort"]:
                    mass += p["pending"]; n_mass += 1
        portfolio.append({"date": d, "pending": all_p, "mdls": n, "mass_tort_pending": mass, "mass_tort_mdls": n_mass})
    pending = [r for r in per_mdl if r["status"] == "pending"]

    def group(key):
        groups = defaultdict(list)
        for r in pending:
            groups[r[key] or "Not recorded"].append(r)
        return sorted(
            [{"key": k, "mdls": len(v), "pending": sum(x["pending"] for x in v), "total": sum(x["total"] for x in v),
              "change_12m": sum(x["change_12m"] or 0 for x in v), "top": [{"mdl": x["mdl"], "title": x["title"], "pending": x["pending"]} for x in sorted(v, key=lambda x: -x["pending"])[:5]]}
             for k, v in groups.items()],
            key=lambda g: -g["pending"],
        )

    by_type, by_district, by_judge = group("type"), group("district"), group("judge")
    mass = [r for r in pending if r["mass_tort"]]
    ages = [r["age_years"] for r in pending if r["age_years"] is not None]
    movers = sorted((r for r in pending if r["change_12m"] is not None), key=lambda r: -r["change_12m"])
    overview = {
        "as_of": latest, "reports": len(report_dates), "first_report": report_dates[0],
        "pending_mdls": len(pending), "pending_actions": sum(r["pending"] for r in pending),
        "mass_tort_mdls": len(mass), "mass_tort_actions": sum(r["pending"] for r in mass),
        "median_age_years": round(statistics.median(ages), 1) if ages else None,
        "top10_share_pct": round(100 * sum(r["pending"] for r in sorted(pending, key=lambda r: -r["pending"])[:10]) / max(1, sum(r["pending"] for r in pending)), 1),
        "new_mdls_in_series": sum(1 for r in per_mdl if r["series"][0]["date"] > report_dates[0]),
        "left_series": sum(1 for r in per_mdl if r["status"] != "pending"),
        "portfolio": portfolio,
        "by_type": by_type, "by_district": by_district[:40], "by_judge": by_judge[:60],
        "fastest_growing": [{"mdl": r["mdl"], "title": r["title"], "change_12m": r["change_12m"], "pending": r["pending"]} for r in movers[:15]],
        "fastest_declining": [{"mdl": r["mdl"], "title": r["title"], "change_12m": r["change_12m"], "pending": r["pending"]} for r in movers[-15:][::-1]],
    }
    facts = [
        ["As of", latest],
        ["Pending MDLs", fmt(overview["pending_mdls"])],
        ["Pending actions", fmt(overview["pending_actions"])],
        ["Mass-tort MDLs (products liability, common and air disaster)", fmt(overview["mass_tort_mdls"])],
        ["Mass-tort pending actions", fmt(overview["mass_tort_actions"])],
        ["Top 10 MDLs' share of pending actions", f"{overview['top10_share_pct']}%"],
        ["Median years since transfer (pending MDLs)", str(overview["median_age_years"])],
        ["Monthly reports analysed", f"{len(report_dates)} ({report_dates[0]} to {latest})"],
    ]
    out.append(cw.record(
        "mdl_analytics", "summary:overview", "MDL portfolio overview",
        source_url=JPML_ARCHIVE, subtitle=f"{fmt(overview['pending_mdls'])} pending MDLs · {fmt(overview['pending_actions'])} actions · as of {latest}",
        cells={"mdl": "—", "litigation": "MDL portfolio overview", "type": "Summary", "pending": fmt(overview["pending_actions"]), "change_12m": "—", "new_12m": "—", "district": "—", "judge": "—", "status": "summary"},
        facts=facts, text="summary overview portfolio", filters={"_listing": ["no"], "kind": ["summary"]},
        extra={"kind": "summary", "overview": overview},
    ))
    return out


def terminated_history():
    meta = json.loads((ACQ / "mdl_meta.json").read_text())
    rows = []
    seen = defaultdict(int)
    for r in meta["terminated_through_fy2025"]:
        seen[(r["mdl"], r["district_code"])] += 1
        rid = f"{r['mdl']}:{r['district_code']}" + (f":{seen[(r['mdl'], r['district_code'])]}" if seen[(r["mdl"], r["district_code"])] > 1 else "")
        total = r["actions_closed"] + r["actions_remanded"]
        remand = round(100 * r["actions_remanded"] / total, 1) if total else None
        rows.append(cw.record(
            "mdl_terminated_history", rid, r["caption"],
            source_url="https://www.jpml.uscourts.gov/sites/jpml/files/JPML_Fiscal_Year_2025_Terminated_Litigations_Report_0.pdf",
            subtitle=f"MDL {r['mdl']} · {r['district_name']} · terminated {r['termination_year']}",
            cells={"mdl": str(r["mdl"]), "caption": r["caption"], "district": r["district_name"], "circuit": r["circuit"] or "—",
                   "judge": r["transferee_judge"], "transferred": fmt(r["actions_transferred"]), "closed": fmt(r["actions_closed"]),
                   "remanded": fmt(r["actions_remanded"]), "year": str(r["termination_year"])},
            facts=[
                ["MDL number", str(r["mdl"])], ["Caption (as printed)", r["caption"]], ["Circuit", r["circuit"] or "Not recorded"],
                ["Transferee district", f"{r['district_name']} (code {r['district_code']})"], ["Transferee judge", r["transferee_judge"]],
                ["Actions transferred", fmt(r["actions_transferred"])], ["Actions filed in transferee court", fmt(r["actions_filed_in_transferee"])],
                ["Actions closed", fmt(r["actions_closed"])], ["Actions remanded", fmt(r["actions_remanded"])],
                ["Remand share of terminated actions", f"{remand}%" if remand is not None else "Not applicable"],
                ["Year of termination", str(r["termination_year"])],
                ["Source", "JPML, Multidistrict Litigations Terminated Through September 30, 2025"],
            ],
            text=f"{r['transferee_judge']} {r['district_name']} {r['circuit']}",
            filters={"circuit": [(r["circuit"] or "").lower()], "decade": [f"{r['termination_year'] // 10 * 10}s"], "date": f"{r['termination_year']}-01-01"},
            extra={"kind": "terminated", "history": r, "remand_pct": remand},
        ))
    return rows


def main():
    rows, per_mdl = build()
    types = sorted({r["type"] for r in per_mdl if r["type"]})
    cw.publish(
        "mdl_analytics", "MDL and mass-tort analytics (JPML monthly reports)", rows,
        listing_block=cw.listing(
            [("mdl", "MDL"), ("litigation", "Litigation"), ("type", "Type"), ("pending", "Pending"), ("change_12m", "12-mo change"), ("new_12m", "New (12 mo)"), ("district", "District"), ("judge", "Judge"), ("status", "Status")],
            [("type", "Type", {t.lower(): t for t in types}), ("mass_tort", "Mass tort", {"yes": "Mass tort", "no": "Other"}),
             ("growth", "12-month trend", GROWTH_LABELS), ("status", "Status", {"pending": "Pending", "terminated": "Terminated", "no_longer_listed": "No longer listed"})],
        ),
        summary={"source": JPML_STATS, "reports": "monthly 2024-10 to 2026-10", "per_mdl": len(per_mdl)},
    )
    history = terminated_history()
    cw.publish(
        "mdl_terminated_history", "Terminated MDLs 1968–2025 (JPML)", history,
        listing_block=cw.listing(
            [("mdl", "MDL"), ("caption", "Caption"), ("district", "District"), ("judge", "Judge"), ("transferred", "Transferred"), ("closed", "Closed"), ("remanded", "Remanded"), ("year", "Terminated")],
            [("decade", "Decade terminated", {f"{d}s": f"{d}s" for d in range(1960, 2030, 10)})],
        ),
        summary={"source": "JPML FY2025 terminated litigations report", "rows": len(history)},
    )


if __name__ == "__main__":
    main()
