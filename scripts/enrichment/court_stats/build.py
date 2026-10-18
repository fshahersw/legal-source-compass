"""Publish federal court statistics datasets from normalized.json (see extract.py).

Datasets (all values copied from official U.S. Courts Judicial Business tables, fiscal years ending September 30):
  court_stats_district_nos    one record per district (94) + summary:matrix (compact per-district series for pages)
  court_stats_district_times  one record per district: median months filing -> disposition (C-5), pending age (C-6)
  court_stats_circuits        one record per regional circuit (12): appeals (B, B-4, B-7) + district roll-ups
  court_stats_national        one record per fiscal year + summary:national (series, sources, checks, rules)

Derived values are arithmetic on published values of the same table year only (shares, per-judgeship rates,
medians of published series); every rule used to flag a district is written into the summary record.
Usage: python3 build.py [--dry-run]
"""
import json
import statistics
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import corpus_writer as cw  # noqa: E402

ROOT = HERE.parents[2]
NORMALIZED = ROOT / "private" / "acq" / "court-stats" / "normalized.json"
LISTING_URL = "https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-business-united-states-courts"
PL_PARTS = [("contract", "contract_195", "Contract product liability (NOS 195)"), ("real_property", "real_property_245", "Real property tort product liability (NOS 245)"),
            ("property_damage", "property_damage_385", "Property damage product liability (NOS 385)"), ("airplane", "airplane_315", "Airplane product liability (NOS 315)"),
            ("marine", "marine_345", "Marine product liability (NOS 345)"), ("motor_vehicle", "motor_vehicle_355", "Motor vehicle product liability (NOS 355)"),
            ("asbestos", "asbestos_368", "Asbestos personal injury product liability (NOS 368)"), ("other_pi", "other_pi_365_367", "Other personal injury product liability, incl. health care/pharmaceutical (NOS 365, 367)")]
C3_GROUPS = ["contract", "real_property", "fela", "marine_pi", "motor_vehicle_pi", "other_pi", "other_tort", "us_tort", "civil_rights", "prisoner", "forfeiture", "labor", "social_security", "ip", "all_other"]
C3_LABELS = {"contract": "Contract", "real_property": "Real property", "fela": "FELA", "marine_pi": "Marine personal injury", "motor_vehicle_pi": "Motor vehicle personal injury",
             "other_pi": "Other personal injury (incl. product liability)", "other_tort": "Other private tort", "us_tort": "U.S. tort actions", "civil_rights": "Civil rights",
             "prisoner": "Prisoner petitions", "forfeiture": "Forfeiture and penalty", "labor": "Labor", "social_security": "Social Security", "ip": "Intellectual property", "all_other": "All other"}
CIRCUIT_NAMES = {"cadc": "D.C. Circuit", "ca1": "First Circuit", "ca2": "Second Circuit", "ca3": "Third Circuit", "ca4": "Fourth Circuit", "ca5": "Fifth Circuit", "ca6": "Sixth Circuit",
                 "ca7": "Seventh Circuit", "ca8": "Eighth Circuit", "ca9": "Ninth Circuit", "ca10": "Tenth Circuit", "ca11": "Eleventh Circuit"}
RULES = {
    "pl_surge": "Product liability filings in the fiscal year are more than 2x the district's median of the previous five fiscal years, with at least 100 filings (Table C-11).",
    "pl_decline": "Product liability filings in the fiscal year are below half the district's median of the previous five fiscal years, where that median is at least 250 (Table C-11).",
    "pl_concentration": "The district received at least 10% of all federal product liability filings in the fiscal year (Table C-11).",
    "pl_share_cluster": "Product liability filings are at least 3x the national product liability share of civil filings, with at least 100 filings (Tables C-11 and C).",
    "slow_disposition": "Median months from filing to disposition is at least 1.5x the national median in the same fiscal year, with at least 100 civil terminations (Table C-5).",
    "aging_backlog": "Share of pending civil cases three years or older is at least 2x the national share, with at least 500 such cases (Table C-6).",
}
TODAY = date.today().isoformat()


def nz(v):
    return v or 0


def pct(part, whole, digits=1):
    if part is None or not whole:
        return None
    return round(100 * part / whole, digits)


def ratio(part, whole, digits=1):
    if part is None or not whole:
        return None
    return round(part / whole, digits)


def series(entity, years, block, key):
    return [((entity.get(str(y)) or {}).get(block) or {}).get(key) for y in years]


def baseline_median(values, i, window=5):
    """Median of the previous `window` published values before index i; None unless all are published."""
    if i < window:
        return None
    prior = values[i - window:i]
    if any(v is None for v in prior):
        return None
    return statistics.median(prior)


def pl_flags(years, pl, national_pl, civil, national_civil):
    flags = []
    nat_share = [pct(p, c, 3) for p, c in zip(national_pl, national_civil)]
    for i, year in enumerate(years):
        value = pl[i]
        if value is None:
            continue
        base = baseline_median(pl, i)
        if base is not None and value >= 100 and value > 2 * base:
            flags.append({"year": year, "rule": "pl_surge", "value": value, "baseline": base, "ratio": round(value / base, 1) if base else None})
        if base is not None and base >= 250 and value < 0.5 * base:
            flags.append({"year": year, "rule": "pl_decline", "value": value, "baseline": base, "ratio": round(value / base, 2)})
        share = pct(value, national_pl[i])
        if share is not None and share >= 10:
            flags.append({"year": year, "rule": "pl_concentration", "value": value, "share_pct": share})
        own = pct(value, civil[i], 3)
        if own is not None and nat_share[i] and value >= 100 and own >= 3 * nat_share[i]:
            flags.append({"year": year, "rule": "pl_share_cluster", "value": value, "share_pct": round(own, 1), "national_share_pct": round(nat_share[i], 1)})
    return flags


def time_flags(years, median_total, n_total, national_median, over3_pct, over3, national_over3_pct):
    flags = []
    for i, year in enumerate(years):
        m, n, nm = median_total[i], n_total[i], national_median[i]
        if m is not None and nm and nz(n) >= 100 and m >= 1.5 * nm:
            flags.append({"year": year, "rule": "slow_disposition", "value": m, "national": nm})
        p, c, npct = over3_pct[i], over3[i], national_over3_pct[i]
        if p is not None and npct and nz(c) >= 500 and p >= 2 * npct:
            flags.append({"year": year, "rule": "aging_backlog", "value": p, "national": npct, "count": c})
    return flags


def ranks(values_by_id, higher_first=True):
    present = [(k, v) for k, v in values_by_id.items() if v is not None]
    present.sort(key=lambda kv: -kv[1] if higher_first else kv[1])
    out, last, rank = {}, None, 0
    for i, (k, v) in enumerate(present, 1):
        if v != last:
            rank, last = i, v
        out[k] = rank
    return out


def spearman(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < 5:
        return None, len(pairs)

    def rank(vals):
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        r = [0.0] * len(vals)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r

    rx, ry = rank([p[0] for p in pairs]), rank([p[1] for p in pairs])
    mx, my = statistics.mean(rx), statistics.mean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return (round(num / den, 3) if den else None), len(pairs)


def fmt(v, digits=0, suffix=""):
    if v is None:
        return "Not recorded"
    return (f"{v:,.{digits}f}" if digits else f"{int(round(v)):,}") + suffix


def short_name(title, cid):
    if not title:
        return cid
    for prefix in ("District Court, ", "Court of Appeals for the "):
        if title.startswith(prefix):
            return title[len(prefix):]
    return title


def source_map(sources):
    out = {}
    for s in sources:
        out.setdefault(s["table"], {})[str(s["fiscal_year"])] = {"page": s["page"], "url": s["url"], "format": s["format"], "sha256": s["sha256"], "retrieved_at": s["retrieved_at"]}
    return out


def main(dry_run=False):
    data = json.loads(NORMALIZED.read_text())
    years = data["years"]
    member = data["membership"]
    nat = data["national"]
    smap = source_map(data["sources"])
    latest = years[-1]
    ly = str(latest)

    def src(table, year=latest):
        return smap.get(table, {}).get(str(year), {})

    spine = {r["id"]: r for r in cw.fetch_all("court_spine", select="id,title,state")}
    analytics = {r["id"]: r["item"] for r in cw.fetch_all("court_analytics", select="id,item:item->analytics")}

    national_pl = [((nat.get(str(y)) or {}).get("c11") or {}).get("total") for y in years]
    national_civil = [((nat.get(str(y)) or {}).get("c") or {}).get("filed") for y in years]
    national_median = [((nat.get(str(y)) or {}).get("c5") or {}).get("median_total") for y in years]
    national_over3_pct = [((nat.get(str(y)) or {}).get("c6") or {}).get("over_3y_pct") for y in years]

    district_ids = sorted(data["districts"])
    nos_rows, time_rows, matrix = [], [], []
    stats_by_id = {}
    for did in district_ids:
        ent = data["districts"][did]
        name = short_name((spine.get(did) or {}).get("title"), did)
        circuit = member.get(did)
        pl = series(ent, years, "c11", "total")
        parts = {out_key: series(ent, years, "c11", key) for key, out_key, _ in PL_PARTS}
        withheld = [y for y in years if ((ent.get(str(y)) or {}).get("c11") or {}).get("components_withheld")]
        civil = series(ent, years, "c", "filed")
        judgeships = series(ent, years, "x1a", "judgeships")
        composition = {g: series(ent, years, "c3", g) for g in C3_GROUPS}
        c3_total = series(ent, years, "c3", "total")
        a = analytics.get(did) or {}
        mdls = a.get("mdls") or []
        pl_mdls = [m for m in mdls if (m.get("type") or "").lower().startswith("products liability")]
        stats = {
            "court_id": did, "name": name, "circuit": circuit, "circuit_name": CIRCUIT_NAMES.get(circuit), "years": years,
            "civil_filed": civil, "civil_terminated": series(ent, years, "c", "terminated"), "civil_pending": series(ent, years, "c", "pending"),
            "pl_total": pl, "pl_parts": parts, "pl_components_withheld_years": withheld,
            "pl_share_pct": [pct(p, c) for p, c in zip(pl, civil)],
            "pl_national_share_pct": [pct(p, n) for p, n in zip(pl, national_pl)],
            "judgeships": judgeships,
            "pl_per_judgeship": [ratio(p, j) for p, j in zip(pl, judgeships)],
            "civil_per_judgeship_unweighted": series(ent, years, "x1a", "unweighted_civil"),
            "filings_per_judgeship_unweighted": series(ent, years, "x1a", "unweighted_total"),
            "filings_per_judgeship_weighted": series(ent, years, "x1a", "weighted_total"),
            "composition": composition, "composition_total": c3_total,
            "pl_5y_median": statistics.median([v for v in pl[-5:] if v is not None]) if all(v is not None for v in pl[-5:]) else None,
            "mdl": {"pending_dockets": len(mdls), "pending_actions": a.get("mdl_actions"), "pl_dockets": len(pl_mdls), "pl_actions": sum(nz(m.get("pending")) for m in pl_mdls),
                    "as_of": a.get("mdl_as_of"), "source": "JPML pending MDL dockets report (dataset court_analytics)"} if a else None,
        }
        stats["flags"] = pl_flags(years, pl, national_pl, civil, national_civil)
        stats_by_id[did] = stats

        median_total = series(ent, years, "c5", "median_total")
        n_total = series(ent, years, "c5", "n_total")
        over3_pct = series(ent, years, "c6", "over_3y_pct")
        over3 = series(ent, years, "c6", "over_3y")
        times = {
            "court_id": did, "name": name, "circuit": circuit, "years": years,
            "terminations_measured": n_total, "median_total": median_total,
            "median_no_action": series(ent, years, "c5", "median_no_action"), "n_no_action": series(ent, years, "c5", "n_no_action"),
            "median_before_pretrial": series(ent, years, "c5", "median_before_pretrial"), "n_before_pretrial": series(ent, years, "c5", "n_before_pretrial"),
            "median_after_pretrial": series(ent, years, "c5", "median_after_pretrial"), "n_after_pretrial": series(ent, years, "c5", "n_after_pretrial"),
            "median_trial": series(ent, years, "c5", "median_trial"), "n_trial": series(ent, years, "c5", "n_trial"),
            "pending": series(ent, years, "c6", "pending"), "pending_under_1y": series(ent, years, "c6", "under_1y"), "pending_1_2y": series(ent, years, "c6", "y1_2"),
            "pending_2_3y": series(ent, years, "c6", "y2_3"), "pending_over_3y": over3, "pending_over_3y_pct": over3_pct,
            "national_median_total": national_median, "national_over_3y_pct": national_over3_pct,
        }
        times["flags"] = time_flags(years, median_total, n_total, national_median, over3_pct, over3, national_over3_pct)
        stats["time_flags"] = times["flags"]
        time_rows.append(times)

    # ranks for the latest fiscal year
    rank_pl = ranks({d: s["pl_total"][-1] for d, s in stats_by_id.items()})
    rank_civil = ranks({d: s["civil_filed"][-1] for d, s in stats_by_id.items()})
    rank_share = ranks({d: s["pl_share_pct"][-1] for d, s in stats_by_id.items()})
    rank_pj = ranks({d: s["pl_per_judgeship"][-1] for d, s in stats_by_id.items()})
    times_by_id = {t["court_id"]: t for t in time_rows}
    rank_median = ranks({d: t["median_total"][-1] for d, t in times_by_id.items()}, higher_first=False)
    for did, s in stats_by_id.items():
        s["ranks"] = {"pl_total": rank_pl.get(did), "civil_filed": rank_civil.get(did), "pl_share_pct": rank_share.get(did), "pl_per_judgeship": rank_pj.get(did), "of": len(stats_by_id), "year": latest}
        times_by_id[did]["ranks"] = {"median_total_fastest": rank_median.get(did), "of": len(times_by_id), "year": latest}

    # MDL correlation (exact court-id join; different as-of dates are stated)
    xs = [stats_by_id[d]["pl_total"][-1] for d in district_ids]
    ys = [(stats_by_id[d]["mdl"] or {}).get("pl_actions") for d in district_ids]
    rho, n_pairs = spearman(xs, ys)

    c11_sources = src("C-11")
    time_records = []
    for did in district_ids:
        s = stats_by_id[did]
        t = times_by_id[did]
        last = lambda arr: arr[-1]  # noqa: E731
        title = f"U.S. District Court, {s['name']}"
        links = [{"url": f"/courts/{did}", "label": "Court profile"}, {"url": c11_sources.get("page"), "label": f"Table C-11, FY{latest} (U.S. Courts)"},
                 {"url": src("C").get("page"), "label": f"Table C, FY{latest} (U.S. Courts)"}, {"url": src("X-1A").get("page"), "label": f"Table X-1A, FY{latest} (U.S. Courts)"}]
        flags_latest = [f for f in s["flags"] + s["time_flags"] if f["year"] == latest]
        facts = [["Court ID", did], ["Circuit", s["circuit_name"] or "Not recorded"], ["Fiscal year", f"FY{latest} (12 months ending September 30, {latest})"],
                 ["Product liability filings", fmt(last(s["pl_total"]))], ["Civil filings", fmt(last(s["civil_filed"]))],
                 ["Product liability share of civil filings", fmt(last(s["pl_share_pct"]), 1, "%")], ["Share of national product liability filings", fmt(last(s["pl_national_share_pct"]), 1, "%")],
                 ["Authorized judgeships", fmt(last(s["judgeships"]))], ["Product liability filings per judgeship", fmt(last(s["pl_per_judgeship"]), 1)],
                 ["Five-year median PL filings (FY%d-FY%d)" % (latest - 4, latest), fmt(s["pl_5y_median"])],
                 ["Tables", "C-11 (product liability by nature of suit), C (filed/terminated/pending), C-3 (nature of suit), X-1A (judgeships)"],
                 ["Fiscal years", f"FY{years[0]}-FY{latest}"], ["Retrieved", (c11_sources.get("retrieved_at") or TODAY)[:10]]]
        cells = {"court": title, "circuit": s["circuit_name"] or "", "pl": fmt(last(s["pl_total"])), "civil": fmt(last(s["civil_filed"])), "share": fmt(last(s["pl_share_pct"]), 1, "%"),
                 "judgeships": fmt(last(s["judgeships"])), "per_judgeship": fmt(last(s["pl_per_judgeship"]), 1), "flags": str(len(flags_latest))}
        nos_rows.append(cw.record(
            "court_stats_district_nos", did, title, source_url=c11_sources.get("url") or LISTING_URL,
            subtitle=f"FY{latest}: {fmt(last(s['pl_total']))} product liability of {fmt(last(s['civil_filed']))} civil filings · {s['circuit_name'] or ''}",
            cells=cells, facts=facts, links=[l for l in links if l["url"]], badges=[RULES_SHORT[f["rule"]] for f in flags_latest],
            text=f"{s['name']} {did} federal district court product liability nature of suit caseload statistics", state="",
            filters={"court": [did], "circuit": [s["circuit"] or ""], "flagged": ["yes" if flags_latest else "no"]},
            extra={"kind": "district", "stats": s},
        ))
        time_cells = {"court": title, "circuit": s["circuit_name"] or "", "median": fmt(last(t["median_total"]), 1), "trial": fmt(last(t["median_trial"]), 1),
                      "over3": fmt(last(t["pending_over_3y_pct"]), 1, "%"), "pending": fmt(last(t["pending"]))}
        time_facts = [["Court ID", did], ["Fiscal year", f"FY{latest}"], ["Median months, filing to disposition (all civil terminations measured)", fmt(last(t["median_total"]), 1)],
                      ["Median months, cases terminated during or after trial", fmt(last(t["median_trial"]), 1)], ["Civil cases pending", fmt(last(t["pending"]))],
                      ["Pending three years or more", f"{fmt(last(t['pending_over_3y']))} ({fmt(last(t['pending_over_3y_pct']), 1, '%')})"],
                      ["Tables", "C-5 (median time intervals by method of disposition), C-6 (civil cases pending by length of time)"],
                      ["Note", "Medians are not computed by the source when fewer than 10 cases are reported; C-5 excludes land condemnations, prisoner petitions, deportation reviews, recovery of overpayments and enforcement of judgments."]]
        time_rows_record = cw.record(
            "court_stats_district_times", did, title, source_url=src("C-5").get("url") or LISTING_URL,
            subtitle=f"FY{latest}: median {fmt(last(t['median_total']), 1)} months filing to disposition · {fmt(last(t['pending_over_3y_pct']), 1, '%')} pending 3+ years",
            cells=time_cells, facts=time_facts, links=[l for l in [{"url": f"/courts/{did}", "label": "Court profile"}, {"url": src("C-5").get("page"), "label": f"Table C-5, FY{latest}"}, {"url": src("C-6").get("page"), "label": f"Table C-6, FY{latest}"}] if l["url"]],
            badges=[RULES_SHORT[f["rule"]] for f in t["flags"] if f["year"] == latest], text=f"{s['name']} {did} median time to disposition civil pending three years",
            filters={"court": [did], "circuit": [s["circuit"] or ""]}, extra={"kind": "district", "times": t},
        )
        time_records.append(time_rows_record)
        matrix.append({"id": did, "name": s["name"], "circuit": s["circuit"], "pl": s["pl_total"], "civil": s["civil_filed"], "share": s["pl_share_pct"], "nat_share": s["pl_national_share_pct"],
                       "judgeships": s["judgeships"], "pl_per_j": s["pl_per_judgeship"], "civil_per_j": s["civil_per_judgeship_unweighted"], "median": t["median_total"], "trial": t["median_trial"],
                       "over3": t["pending_over_3y_pct"], "pending": t["pending"], "oth_pi": s["composition"]["other_pi"], "pl5": s["pl_5y_median"], "parts": {k: v[-1] for k, v in s["pl_parts"].items()},
                       "mdl": s["mdl"], "flags": s["flags"] + s["time_flags"], "ranks": s["ranks"]})

    # ---------------- circuits
    circuit_rows = []
    circuit_summ = []
    for cid in ["cadc", "ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11"]:
        ent = data["circuits"].get(cid, {})
        members = sorted(d for d, c in member.items() if c == cid)
        comp = {}
        for g in C3_GROUPS:
            vals = []
            for y in years:
                parts = [((data["districts"][d].get(str(y)) or {}).get("c3") or {}).get(g) for d in members]
                vals.append(sum(parts) if parts and all(p is not None for p in parts) else None)
            comp[g] = vals
        c = {
            "circuit_id": cid, "name": CIRCUIT_NAMES[cid], "years": years, "districts": members,
            "appeals_filed": series(ent, years, "b", "filed"), "appeals_terminated": series(ent, years, "b", "terminated"), "appeals_pending": series(ent, years, "b", "pending"),
            "merits_terminations": series(ent, years, "b4", "merits_terminations"), "median_notice_to_final": series(ent, years, "b4", "median_notice_to_final"),
            "median_lower_court_to_final": series(ent, years, "b4", "median_lower_court_to_final"),
            "civil_appeals": [((ent.get(str(y)) or {}).get("b7") or {}).get("civil") for y in years], "private_civil_appeals": [((ent.get(str(y)) or {}).get("b7") or {}).get("private") for y in years],
            "diversity_appeals": [((ent.get(str(y)) or {}).get("b7") or {}).get("diversity") for y in years], "diversity_pi_pl_appeals": [((ent.get(str(y)) or {}).get("b7") or {}).get("diversity_pi_pl") for y in years],
            "district_civil_filed": series(ent, years, "c", "filed"), "district_pl_total": series(ent, years, "c11", "total"),
            "district_median_total": series(ent, years, "c5", "median_total"), "district_over_3y_pct": series(ent, years, "c6", "over_3y_pct"),
            "district_composition": comp,
        }
        # Table X-1A lists Article III districts only (not Guam, the Northern Mariana Islands or the Virgin Islands):
        # circuit judgeships and the per-judgeship rate use the same set of districts on both sides of the ratio.
        judged = [d for d in members if any(v is not None for v in stats_by_id[d]["judgeships"])]
        c["judgeship_districts"] = judged
        c["district_judgeships"] = [sum(stats_by_id[d]["judgeships"][i] for d in judged) if all(stats_by_id[d]["judgeships"][i] is not None for d in judged) else None for i in range(len(years))]
        judged_pl = [sum(stats_by_id[d]["pl_total"][i] for d in judged) if all(stats_by_id[d]["pl_total"][i] is not None for d in judged) else None for i in range(len(years))]
        c["district_pl_share_pct"] = [pct(p, f) for p, f in zip(c["district_pl_total"], c["district_civil_filed"])]
        c["district_pl_per_judgeship"] = [ratio(p, j) for p, j in zip(judged_pl, c["district_judgeships"])]
        c["top_districts"] = sorted(({"id": d, "name": stats_by_id[d]["name"], "pl": stats_by_id[d]["pl_total"][-1]} for d in members), key=lambda r: -(r["pl"] or 0))[:5]
        title = f"U.S. Court of Appeals for the {CIRCUIT_NAMES[cid]}"
        last = lambda arr: arr[-1]  # noqa: E731
        circuit_rows.append(cw.record(
            "court_stats_circuits", cid, title, source_url=src("B").get("url") or LISTING_URL,
            subtitle=f"FY{latest}: {fmt(last(c['appeals_filed']))} appeals filed · districts: {fmt(last(c['district_civil_filed']))} civil, {fmt(last(c['district_pl_total']))} product liability filings",
            cells={"circuit": title, "appeals": fmt(last(c["appeals_filed"])), "median": fmt(last(c["median_notice_to_final"]), 1), "civil": fmt(last(c["district_civil_filed"])), "pl": fmt(last(c["district_pl_total"])), "share": fmt(last(c["district_pl_share_pct"]), 1, "%")},
            facts=[["Circuit", CIRCUIT_NAMES[cid]], ["Fiscal year", f"FY{latest}"], ["Appeals filed (Table B)", fmt(last(c["appeals_filed"]))], ["Appeals pending (Table B)", fmt(last(c["appeals_pending"]))],
                   ["Median months, notice of appeal to final disposition, merits terminations (Table B-4)", fmt(last(c["median_notice_to_final"]), 1)],
                   ["Diversity personal injury/product liability appeals filed (Table B-7)", fmt(last(c["diversity_pi_pl_appeals"]))],
                   ["District civil filings in the circuit (Table C)", fmt(last(c["district_civil_filed"]))], ["District product liability filings in the circuit (Table C-11)", fmt(last(c["district_pl_total"]))],
                   ["Districts", ", ".join(members)]],
            links=[l for l in [{"url": f"/courts/{cid}", "label": "Court profile"}, {"url": src("B").get("page"), "label": f"Table B, FY{latest}"}, {"url": src("B-4").get("page"), "label": f"Table B-4, FY{latest}"}, {"url": src("B-7").get("page"), "label": f"Table B-7, FY{latest}"}] if l["url"]],
            text=f"{CIRCUIT_NAMES[cid]} court of appeals statistics appeals median time", filters={"court": [cid]}, extra={"kind": "circuit", "circuit": c},
        ))
        circuit_summ.append(c)

    # ---------------- national
    national_rows = []
    nat_series = {"civil_filed": national_civil, "civil_terminated": [((nat.get(str(y)) or {}).get("c") or {}).get("terminated") for y in years],
                  "civil_pending": [((nat.get(str(y)) or {}).get("c") or {}).get("pending") for y in years], "pl_total": national_pl,
                  "pl_parts": {out_key: [((nat.get(str(y)) or {}).get("c11") or {}).get(key) for y in years] for key, out_key, _ in PL_PARTS},
                  "nos": {k: [((nat.get(str(y)) or {}).get("c2a") or {}).get(k) for y in years] for k in ["total", "tort_total", "pi_total", "pi_pl_total", "pl_airplane_315", "pl_marine_345", "pl_motor_vehicle_355", "pl_asbestos_368", "pl_health_care_pharma_367", "pl_other_365", "other_pi_total", "pi_medical_malpractice", "property_damage_total", "torts_to_land_240_245", "civil_rights_total", "prisoner_total", "contract_total", "insurance", "ip_total", "labor_total", "social_security_total", "securities_total", "antitrust", "consumer_credit", "rico", "environmental"]},
                  "nos_edition": [(nat.get(str(y)) or {}).get("c2a_edition") for y in years],
                  "median_total": national_median, "median_trial": [((nat.get(str(y)) or {}).get("c5") or {}).get("median_trial") for y in years],
                  "median_after_pretrial": [((nat.get(str(y)) or {}).get("c5") or {}).get("median_after_pretrial") for y in years],
                  "pending_over_3y": [((nat.get(str(y)) or {}).get("c6") or {}).get("over_3y") for y in years], "pending_over_3y_pct": national_over3_pct,
                  "judgeships": [((nat.get(str(y)) or {}).get("x1a") or {}).get("judgeships") for y in years],
                  "filings_per_judgeship_weighted": [((nat.get(str(y)) or {}).get("x1a") or {}).get("weighted_total") for y in years],
                  "civil_per_judgeship_unweighted": [((nat.get(str(y)) or {}).get("x1a") or {}).get("unweighted_civil") for y in years],
                  "appeals_filed": [((nat.get(str(y)) or {}).get("b") or {}).get("filed") for y in years], "appeals_pending": [((nat.get(str(y)) or {}).get("b") or {}).get("pending") for y in years],
                  "appeals_median_notice_to_final": [((nat.get(str(y)) or {}).get("b4") or {}).get("median_notice_to_final") for y in years],
                  "diversity_pi_pl_appeals": [((nat.get(str(y)) or {}).get("b7") or {}).get("diversity_pi_pl") for y in years]}
    nat_series["pl_share_pct"] = [pct(p, c) for p, c in zip(national_pl, national_civil)]
    nat_series["composition"] = {g: [((nat.get(str(y)) or {}).get("c3") or {}).get(g) for y in years] for g in C3_GROUPS}
    # concentration: share of national PL filings in the top 5 districts each year
    top5 = []
    hhi = []
    for i, y in enumerate(years):
        vals = sorted((stats_by_id[d]["pl_total"][i] for d in district_ids if stats_by_id[d]["pl_total"][i] is not None), reverse=True)
        total = national_pl[i]
        top5.append(pct(sum(vals[:5]), total))
        hhi.append(round(sum((100 * v / total) ** 2 for v in vals)) if total else None)
    nat_series["pl_top5_share_pct"] = top5
    nat_series["pl_hhi"] = hhi
    checks = data["checks"]
    failed = [c for c in checks if not c["ok"]]
    flags_all = [{"court_id": d, "name": stats_by_id[d]["name"], **f} for d in district_ids for f in stats_by_id[d]["flags"] + stats_by_id[d]["time_flags"]]
    summary = {
        "years": years, "latest": latest, "series": nat_series, "rules": RULES, "rules_short": RULES_SHORT, "flags": flags_all,
        "pl_parts_labels": {out_key: label for _, out_key, label in PL_PARTS}, "composition_labels": C3_LABELS,
        "mdl_correlation": {"spearman_rho": rho, "n": n_pairs, "x": f"District product liability filings, FY{latest} (Table C-11)",
                            "y": "Pending actions in products liability MDLs, JPML report", "as_of": next((stats_by_id[d]["mdl"]["as_of"] for d in district_ids if stats_by_id[d]["mdl"]), None)},
        "sources": smap, "listing": LISTING_URL,
        "checks": {"total": len(checks), "passed": len(checks) - len(failed), "failed": failed},
        "notes": [
            "Fiscal years are the 12-month periods ending September 30 published in Judicial Business of the United States Courts.",
            "Filings include cases filed directly in, or transferred to, MDL transferee districts; large product liability counts in a district usually reflect MDL dockets assigned there.",
            "Table C-11 groups NOS 365 and 367 as 'Other' personal injury product liability; the national split between 365 and 367 comes from Table C-2A.",
            "FY2014-FY2016 values are read from the published PDF editions; FY2017-FY2025 from the Excel editions. Rows whose printed arithmetic does not reconcile are withheld (Not recorded).",
            "Judgeships are authorized judgeships from Table X-1A (territorial courts are not included in that table).",
            "Two published cells do not reconcile and are withheld: FY2015 Table C-11 prints a truncated 'Other' cell for N.D. Illinois ('2,60'), so that row's product liability components are withheld while its total (2,690) is confirmed by the FY2016 edition's prior-year column; FY2017 Table C-3 leaves the Eighth Circuit private 'All Other' cell blank, so that circuit row is withheld and circuit composition is summed from its districts.",
            "Courts of appeals: Table B-7 diversity personal injury/product liability appeals are read from the Excel editions (FY2017-FY2025); FY2014-FY2016 are Not recorded.",
        ],
        "retrieved_at": min((s.get("retrieved_at") or TODAY) for s in data["sources"])[:10],
    }
    national_rows.append(cw.record(
        "court_stats_national", "summary:national", "U.S. district courts and courts of appeals — national caseload statistics", source_url=LISTING_URL,
        subtitle=f"FY{years[0]}-FY{latest} · Judicial Business of the United States Courts", cells={"year": f"FY{years[0]}-FY{latest}", "civil": fmt(national_civil[-1]), "pl": fmt(national_pl[-1]), "share": fmt(nat_series['pl_share_pct'][-1], 1, '%'), "median": fmt(national_median[-1], 1), "appeals": fmt(nat_series['appeals_filed'][-1])},
        facts=[["Fiscal years", f"FY{years[0]}-FY{latest}"], ["Validation checks", f"{summary['checks']['passed']} of {summary['checks']['total']} passed"], ["Source", LISTING_URL]],
        links=[{"url": LISTING_URL, "label": "Judicial Business of the United States Courts"}, {"url": "/courts/analytics", "label": "Federal court analytics"}],
        text="national federal court caseload statistics product liability", filters={"_listing": ["no"], "kind": ["summary"]}, extra={"kind": "summary", "summary": summary},
    ))
    for i, y in enumerate(years):
        block = nat.get(str(y)) or {}
        c11 = block.get("c11") or {}
        c2a = block.get("c2a") or {}
        national_rows.append(cw.record(
            "court_stats_national", f"fy{y}", f"Federal courts, FY{y}", source_url=src("C-11", y).get("url") or LISTING_URL,
            subtitle=f"{fmt(national_civil[i])} civil filings · {fmt(national_pl[i])} product liability · {fmt(nat_series['appeals_filed'][i])} appeals",
            cells={"year": f"FY{y}", "civil": fmt(national_civil[i]), "pl": fmt(national_pl[i]), "share": fmt(nat_series["pl_share_pct"][i], 1, "%"), "median": fmt(national_median[i], 1), "appeals": fmt(nat_series["appeals_filed"][i])},
            facts=[["Fiscal year", f"FY{y} (12 months ending September 30, {y})"], ["Civil filings (Table C)", fmt(national_civil[i])], ["Product liability filings (Table C-11)", fmt(national_pl[i])],
                   ["Health care/pharmaceutical PI product liability, NOS 367 (Table C-2A)", fmt(c2a.get("pl_health_care_pharma_367"))], ["Other PI product liability, NOS 365 (Table C-2A)", fmt(c2a.get("pl_other_365"))],
                   ["Asbestos, NOS 368 (Table C-2A)", fmt(c2a.get("pl_asbestos_368"))], ["Median months filing to disposition (Table C-5)", fmt(national_median[i], 1)],
                   ["Appeals filed (Table B)", fmt(nat_series["appeals_filed"][i])], ["C-2A edition used", f"FY{block.get('c2a_edition')}" if block.get("c2a_edition") else "Not recorded"]],
            links=[l for l in [{"url": src("C-11", y).get("page"), "label": f"Table C-11, FY{y}"}, {"url": src("C", y).get("page"), "label": f"Table C, FY{y}"}, {"url": src("C-2A", block.get("c2a_edition") or y).get("page"), "label": "Table C-2A"}] if l["url"]],
            text=f"FY{y} federal courts national caseload", filters={"year": [str(y)]}, extra={"kind": "year", "year": y, "national": {k: block.get(k) for k in ("c", "c11", "c2a", "c3", "c5", "c6", "x1a", "b", "b4", "b7")}},
        ))
    # compact matrix record for pages
    nos_rows.append(cw.record(
        "court_stats_district_nos", "summary:matrix", "Federal district courts — product liability and caseload matrix", source_url=LISTING_URL,
        subtitle=f"{len(matrix)} districts · FY{years[0]}-FY{latest}", cells={"court": "All districts", "circuit": "", "pl": fmt(national_pl[-1]), "civil": fmt(national_civil[-1]), "share": fmt(nat_series['pl_share_pct'][-1], 1, '%'), "judgeships": fmt(nat_series['judgeships'][-1]), "per_judgeship": fmt(ratio(national_pl[-1], nat_series['judgeships'][-1]), 1), "flags": str(len([f for f in flags_all if f['year'] == latest]))},
        facts=[["Districts", str(len(matrix))], ["Fiscal years", f"FY{years[0]}-FY{latest}"]], links=[{"url": "/courts/analytics", "label": "Federal court analytics"}],
        text="district matrix", filters={"_listing": ["no"], "kind": ["summary"]}, extra={"kind": "matrix", "years": years, "rows": matrix},
    ))
    report = {"district_nos": len(nos_rows), "district_times": len(time_records), "circuits": len(circuit_rows), "national": len(national_rows),
              "flags_latest": len([f for f in flags_all if f["year"] == latest]), "spearman": rho, "checks_failed": len(failed)}
    print(json.dumps(report))
    if dry_run:
        out = ROOT / "private" / "scratch" / "court-stats" / "dry_run.json"
        out.write_text(json.dumps({"nos": nos_rows[:3] + nos_rows[-1:], "times": time_records[:2], "circuits": circuit_rows[:2], "national": national_rows[:2], "sizes": {
            "nos_bytes": len(json.dumps(nos_rows)), "times_bytes": len(json.dumps(time_records)), "matrix_bytes": len(json.dumps(nos_rows[-1])), "summary_bytes": len(json.dumps(national_rows[0]))}}, indent=1))
        return report
    period = f"FY{years[0]}-FY{latest}"
    common = {"source": LISTING_URL, "fiscal_years": period, "retrieved_at": summary["retrieved_at"], "checks_passed": summary["checks"]["passed"], "checks_total": summary["checks"]["total"]}
    cw.publish("court_stats_district_nos", f"Federal district courts — product liability and civil filings by district ({period})", nos_rows,
               listing_block=cw.listing([("court", "Court"), ("circuit", "Circuit"), ("pl", f"PL filings FY{latest}"), ("civil", f"Civil filings FY{latest}"), ("share", "PL share"), ("judgeships", "Judgeships"), ("per_judgeship", "PL per judgeship"), ("flags", "Flags")],
                                        [("flagged", f"Flagged in FY{latest}", {"yes": "Flagged", "no": "Not flagged"}), ("circuit", "Circuit", {k: v for k, v in CIRCUIT_NAMES.items()})]),
               summary={**common, "tables": ["C-11", "C", "C-3", "X-1A"], "districts": len(district_ids)})
    cw.publish("court_stats_district_times", f"Federal district courts — median time to disposition and pending age ({period})", time_records,
               listing_block=cw.listing([("court", "Court"), ("circuit", "Circuit"), ("median", "Median months to disposition"), ("trial", "Median months, trial dispositions"), ("over3", "Pending 3+ years"), ("pending", "Pending")],
                                        [("circuit", "Circuit", {k: v for k, v in CIRCUIT_NAMES.items()})]),
               summary={**common, "tables": ["C-5", "C-6"], "districts": len(district_ids)})
    cw.publish("court_stats_circuits", f"U.S. courts of appeals — appeals and district roll-ups by circuit ({period})", circuit_rows,
               listing_block=cw.listing([("circuit", "Circuit"), ("appeals", f"Appeals filed FY{latest}"), ("median", "Median months, notice to final"), ("civil", "District civil filings"), ("pl", "District PL filings"), ("share", "PL share")]),
               summary={**common, "tables": ["B", "B-4", "B-7", "C", "C-11", "C-5", "C-6"], "circuits": len(circuit_rows)})
    cw.publish("court_stats_national", f"Federal courts — national caseload statistics by fiscal year ({period})", national_rows,
               listing_block=cw.listing([("year", "Fiscal year"), ("civil", "Civil filings"), ("pl", "PL filings"), ("share", "PL share"), ("median", "Median months to disposition"), ("appeals", "Appeals filed")]),
               summary={**common, "tables": ["C", "C-2A", "C-3", "C-5", "C-6", "C-11", "X-1A", "B", "B-4", "B-7"]})
    return report


RULES_SHORT = {"pl_surge": "Product liability surge", "pl_decline": "Product liability drop", "pl_concentration": "National PL concentration", "pl_share_cluster": "PL-heavy civil docket",
               "slow_disposition": "Slow civil disposition", "aging_backlog": "Aging civil backlog"}


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
