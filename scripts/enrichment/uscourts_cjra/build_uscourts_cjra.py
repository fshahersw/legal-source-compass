"""Build the CJRA datasets (U.S. Courts Civil Justice Reform Act reports, March 2004 - March 2026) as corpus build files.

Reads only private/acq/uscourts_cjra (hash-checked against its manifest), the extraction cache built by extract_cjra.py and the
read-only corpus lookups saved in private/build/uscourts_cjra/lookups. Writes private/build/uscourts_cjra/<dataset>.json:
  {"dataset", "label", "listing_block", "summary", "rows", "built_at", "inputs": [{url, path, sha256}]}

Datasets
  court_cjra_districts  94 district courts: five delay measures at each of 45 semiannual report dates
  court_cjra_circuits   11 regional circuits + D.C. Circuit + national totals (Tables 1-4 of each report)
  court_cjra_judges     every judge or magistrate judge listed in Appendix A (one record per court and printed name)
  court_cjra_reports    one record per report with its files, national totals, internal checks and anomalies

Usage: python3 -I -B build_uscourts_cjra.py [--only dataset ...]
"""
import hashlib
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import corpus_writer as cw  # noqa: E402
import cjra_data as D  # noqa: E402
import cjra_judges as J  # noqa: E402
import cjra_parse as P  # noqa: E402
import cjra_sources as S  # noqa: E402

MEASURES = P.MEASURES
SHORT = {"civil_3y": "Civil 3+ yrs", "motions_6m": "Motions 6+ mo", "bench_trials_6m": "Bench trials 6+ mo", "bankruptcy_appeals_6m": "Bankr. appeals 6+ mo",
         "ss_appeals_6m": "Soc. Sec. appeals 6+ mo"}
CIRCUIT_ORDER = ["dc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]
CIRCUIT_ID = {"dc": "cadc", **{str(n): f"ca{n}" for n in range(1, 12)}}
NOT_RECORDED = "Not recorded"
INDEX_URL = "https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report"
MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MEASURE_DEFINITIONS = {
    "civil_3y": "Civil cases pending more than three years", "motions_6m": "Motions pending more than six months",
    "bench_trials_6m": "Bench trials submitted more than six months", "bankruptcy_appeals_6m": "Bankruptcy appeals pending more than six months",
    "ss_appeals_6m": "Social Security appeal cases pending more than six months",
}


# ------------------------------------------------------------------ small helpers
def label(period):
    y, m, d = period.split("-")
    return f"{MONTHS[int(m)]} {int(d)}, {y}"


def fmt(value, digits=0, suffix=""):
    if value is None:
        return NOT_RECORDED
    if digits:
        return f"{value:,.{digits}f}{suffix}"
    return f"{int(round(value)):,}{suffix}"


def pct_change(new, old):
    """(new - old) / old x 100 rounded to one decimal; None when either value is not recorded or old is zero."""
    if new is None or old is None or old == 0:
        return None
    return round((new - old) / old * 100, 1)


def competition_rank(values, reverse=True):
    """{key: rank} with ties sharing the best rank (1 = largest when reverse); keys with value None are not ranked."""
    items = {k: v for k, v in values.items() if v is not None}
    ordered = sorted(items.values(), reverse=reverse)
    return {k: ordered.index(v) + 1 for k, v in items.items()}


def sha(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()


def delta_text(new, old, pct):
    if new is None or old is None:
        return NOT_RECORDED
    sign = "+" if new - old > 0 else ""
    return f"{sign}{new - old:,}" + (f" ({'+' if pct and pct > 0 else ''}{pct}%)" if pct is not None else " (percent not computed: zero base)" if old == 0 else "")


def series_of(periods_data, periods, getter):
    out = []
    for p in periods:
        try:
            out.append(getter(periods_data[p]))
        except (KeyError, TypeError):
            out.append(None)
    return out


class Context:
    """Everything the record builders need, loaded once."""

    def __init__(self, lookup, periods_data, fjc_lookup, places, over3, manifest=None):
        self.lookup = lookup
        self.courts = lookup["courts"]
        self.data = periods_data
        self.periods = sorted(periods_data)
        self.latest = self.periods[-1]
        self.fjc = J.FjcIndex(fjc_lookup)
        self.places = set(places["ids"])
        self.over3 = over3
        self.manifest = S.manifest() if manifest is None else manifest

    def url(self, entry):
        return entry["url"]

    def period_page(self, period):
        entry = self.manifest.get(f"private/acq/uscourts_cjra/pages/period_{period}.html")
        return entry["url"] if entry else INDEX_URL

    def main_url(self, period):
        return self.data[period]["main_file"]["url"]

    def table_url(self, period, n):
        files = self.data[period]["table_files"]
        if len(files) == 1:
            return files[0]["url"]
        return next(f["url"] for f in files if f"cjra_{n}_" in f["url"])

    def appendix_url(self, period):
        return self.data[period]["main_file"]["url"]


# ------------------------------------------------------------------ districts
def national_district_totals(ctx):
    """{period: {measure: sum of recorded district values}}: the denominator of every district share."""
    out = {}
    for p in ctx.periods:
        vals = [d["values"] for d in ctx.data[p]["districts"].values() if d["values"] is not None]
        out[p] = {m: sum(v[m] for v in vals) for m in MEASURES}
    return out


def district_records(ctx):
    nat = national_district_totals(ctx)
    ids = sorted(ctx.courts)
    series = {cid: {m: series_of(ctx.data, ctx.periods, lambda d, cid=cid, m=m: None if d["districts"][cid]["values"] is None else d["districts"][cid]["values"][m]) for m in MEASURES} for cid in ids}
    latest = ctx.latest
    i_last = len(ctx.periods) - 1
    i_prev, i_year = i_last - 1, i_last - 2
    rank_civil = competition_rank({c: series[c]["civil_3y"][i_last] for c in ids})
    rank_motions = competition_rank({c: series[c]["motions_6m"][i_last] for c in ids})
    rows = []
    for cid in ids:
        name, st = ctx.courts[cid]
        title = f"U.S. {name}"
        s = series[cid]
        circuit_key = P.CIRCUIT_OF[cid]
        circuit_name = P.CIRCUIT_NAMES[circuit_key]
        share = [None if v is None or not nat[p]["civil_3y"] else round(v / nat[p]["civil_3y"] * 100, 2) for v, p in zip(s["civil_3y"], ctx.periods)]
        judges_listed = series_of(ctx.data, ctx.periods, lambda d, cid=cid: d["districts"][cid]["district_judges"] if d["districts"][cid]["rows"] else None)
        per_judge = [None if v is None or not j else round(v / j, 1) for v, j in zip(s["civil_3y"], judges_listed)]
        recorded = [v for v in s["civil_3y"] if v is not None]
        peak = max(recorded) if recorded else None
        peak_period = ctx.periods[s["civil_3y"].index(peak)] if recorded else None
        last5y = [v for v in s["civil_3y"][-10:] if v is not None]
        median10 = statistics.median(last5y) if last5y else None
        sources = [ctx.data[p]["districts"][cid]["source"] for p in ctx.periods]
        recon = {p: {"status": ctx.data[p]["districts"][cid]["reconciliation"]["status"], "difference": ctx.data[p]["districts"][cid]["reconciliation"]["difference"]}
                 for p in ctx.periods if ctx.data[p]["districts"][cid]["reconciliation"]["status"] not in ("reconciled",)}
        not_recorded = {p: ctx.data[p]["districts"][cid]["reason"] for p in ctx.periods if ctx.data[p]["districts"][cid]["values"] is None}
        notes = []
        for p in ctx.periods:
            for r in ctx.data[p]["districts"][cid]["rows"]:
                for n in r["notes"]:
                    notes.append({"period": p, "row": r["printed"], "measure": n["column"], "marker": n["marker"], "text": n["text"], "page": r["page"]})
        latest_notes = [n for n in notes if n["period"] == latest]
        mdl_note = any(n["text"] and "multidistrict" in n["text"].lower() for n in notes)
        pages = {p: ctx.data[p]["districts"][cid]["pages"] for p in ctx.periods if ctx.data[p]["districts"][cid]["pages"]}
        c6 = {str(y): v for y, v in zip(ctx.over3["years"], ctx.over3["pending_over_3y"].get(cid, []))}
        civil_last = s["civil_3y"][i_last]
        pc_prev = pct_change(civil_last, s["civil_3y"][i_prev])
        pc_year = pct_change(civil_last, s["civil_3y"][i_year])
        facts = [
            ["Court ID", cid], ["Circuit", circuit_name], ["Latest report", f"{label(latest)} (CJRA Appendix A)"],
            [MEASURE_DEFINITIONS["civil_3y"], fmt(civil_last)],
            ["Change from the previous report (six months earlier)", delta_text(civil_last, s["civil_3y"][i_prev], pc_prev)],
            ["Change from the report a year earlier", delta_text(civil_last, s["civil_3y"][i_year], pc_year)],
            ["Share of all civil cases pending 3+ years reported by the 94 districts", fmt(share[i_last], 2, "%") if share[i_last] is not None else NOT_RECORDED],
            ["Rank by civil cases pending 3+ years (1 = most of 94)", f"{rank_civil[cid]} of {len(rank_civil)}" if cid in rank_civil else NOT_RECORDED],
            [MEASURE_DEFINITIONS["motions_6m"], fmt(s["motions_6m"][i_last])], [MEASURE_DEFINITIONS["bench_trials_6m"], fmt(s["bench_trials_6m"][i_last])],
            [MEASURE_DEFINITIONS["bankruptcy_appeals_6m"], fmt(s["bankruptcy_appeals_6m"][i_last])], [MEASURE_DEFINITIONS["ss_appeals_6m"], fmt(s["ss_appeals_6m"][i_last])],
            ["District judges listed in the latest Appendix A", fmt(judges_listed[i_last])],
            ["Civil cases pending 3+ years per listed district judge", fmt(per_judge[i_last], 1)],
            ["Highest civil cases pending 3+ years in 45 reports", f"{fmt(peak)} ({label(peak_period)})" if peak_period else NOT_RECORDED],
            ["Median of the last ten reports", fmt(median10, 1) if median10 is not None else NOT_RECORDED],
            ["Reports with a printed district total", f"{sum(1 for x in sources if x == 'printed_total')} of {len(ctx.periods)}"],
            ["Reports where the judge rows do not add to the printed total", str(sum(1 for r in recon.values() if r['status'] == 'judge_rows_differ'))],
            ["Reports not recorded for this district", str(len(not_recorded))],
            ["Note", "Counts are copied from each report's Appendix A district total row. Measures are defined in the report (Appendix B in 2019 and later reports)."],
            ["Report dates", f"{label(ctx.periods[0])} - {label(latest)}"],
        ]
        cells = {"court": title, "circuit": circuit_name, "civil_3y": fmt(civil_last), "motions_6m": fmt(s["motions_6m"][i_last]), "bench_trials_6m": fmt(s["bench_trials_6m"][i_last]),
                 "bankruptcy_appeals_6m": fmt(s["bankruptcy_appeals_6m"][i_last]), "ss_appeals_6m": fmt(s["ss_appeals_6m"][i_last]),
                 "share": fmt(share[i_last], 2, "%") if share[i_last] is not None else NOT_RECORDED, "judges": fmt(judges_listed[i_last])}
        links = [{"url": f"/courts/{cid}", "label": "Court profile"}]
        if st in ctx.places:
            links.append({"url": f"/places/{st}", "label": f"{st} place profile"})
        links += [{"url": ctx.appendix_url(latest), "label": f"CJRA Appendix A, {label(latest)} (U.S. Courts PDF)"}, {"url": ctx.period_page(latest), "label": f"CJRA report page, {label(latest)}"}]
        rows.append(cw.record(
            "court_cjra_districts", cid, title, source_url=ctx.appendix_url(latest),
            subtitle=f"{label(latest)}: {fmt(civil_last)} civil cases pending 3+ years · {fmt(s['motions_6m'][i_last])} motions pending 6+ months · {circuit_name}",
            cells=cells, facts=facts, links=links,
            badges=(["Multidistrict litigation noted"] if mdl_note else []) + (["Source discrepancy"] if any(r["status"] == "judge_rows_differ" for r in recon.values()) else []),
            text=f"{name} {cid} {st} {circuit_name} Civil Justice Reform Act CJRA delay civil cases pending three years motions pending six months bench trials",
            state=st, filters={"court": [cid], "circuit": [CIRCUIT_ID[circuit_key]], "state": [st], "mdl_note": ["yes" if mdl_note else "no"],
                               "discrepancy": ["yes" if any(r["status"] == "judge_rows_differ" for r in recon.values()) else "no"]},
            extra={"kind": "district", "court_id": cid, "periods": ctx.periods, "series": s, "share_civil_3y_pct": share, "district_judges_listed": judges_listed,
                   "civil_3y_per_listed_district_judge": per_judge, "sources": sources, "reconciliation": recon, "not_recorded": not_recorded, "notes": notes[-80:],
                   "latest_notes": latest_notes, "pages": pages, "ranks": {"civil_3y": rank_civil.get(cid), "motions_6m": rank_motions.get(cid), "of": len(rank_civil), "period": latest},
                   "peak_civil_3y": {"value": peak, "period": peak_period}, "median_last_10_reports_civil_3y": median10, "change_civil_3y": {"previous_pct": pc_prev, "year_ago_pct": pc_year},
                   "table_c6_pending_3y_or_more_sep30": c6,
                   "comparison_note": "Table C-6 counts (court_stats_district_times, Sep 30) use a different definition than CJRA civil cases pending more than three years; they are shown for context, not as a check."},
        ))
    return rows


# ------------------------------------------------------------------ circuits and national
def circuit_records(ctx):
    nat_series = {m: series_of(ctx.data, ctx.periods, lambda d, m=m: d["national"]["table1"][m]["current"]) for m in MEASURES}
    i_last = len(ctx.periods) - 1
    rows = []
    last_vals = {k: ctx.data[ctx.latest]["circuits"][k]["table2"]["civil_3y"] if ctx.data[ctx.latest]["circuits"][k]["table2"] else None for k in CIRCUIT_ORDER}
    rank_civil = competition_rank(last_vals)
    district_totals = national_district_totals(ctx)
    for k in CIRCUIT_ORDER:
        s = {m: series_of(ctx.data, ctx.periods, lambda d, k=k, m=m: d["circuits"][k]["table2"][m]) for m in MEASURES}
        appendix_sum = {m: series_of(ctx.data, ctx.periods, lambda d, k=k, m=m: d["circuits"][k]["sum_of_districts"][m]) for m in MEASURES}
        printed = {m: series_of(ctx.data, ctx.periods, lambda d, k=k, m=m: d["circuits"][k]["printed"][m]) for m in MEASURES}
        avg_civil = series_of(ctx.data, ctx.periods, lambda d, k=k: d["circuits"][k]["table4"]["civil_3y_per_judge"])
        avg_mot = series_of(ctx.data, ctx.periods, lambda d, k=k: d["circuits"][k]["table4"]["motions_6m_per_judge"])
        pct_district = series_of(ctx.data, ctx.periods, lambda d, k=k: d["circuits"][k]["table2_shares"]["civil_3y_pct_district_judges"])
        adjusted = [p for p, a, b in zip(ctx.periods, s["civil_3y"], appendix_sum["civil_3y"]) if a is not None and b is not None and any(
            ctx.data[p]["circuits"][k]["table2"][m] != ctx.data[p]["circuits"][k]["sum_of_districts"][m] for m in MEASURES)]
        members = P.CIRCUITS[k]
        latest_members = [((ctx.data[ctx.latest]["districts"][c]["values"] or {}).get("civil_3y"), c) for c in members]
        top = [{"id": c, "name": ctx.courts[c][0], "civil_3y": v} for v, c in sorted(latest_members, key=lambda t: (-(t[0] if t[0] is not None else -1), t[1]))[:5]]
        cid = CIRCUIT_ID[k]
        name = P.CIRCUIT_NAMES[k]
        title = f"U.S. Court of Appeals for the {name}" if k != "dc" else "U.S. Court of Appeals for the D.C. Circuit"
        civil_last = s["civil_3y"][i_last]
        share_last = round(civil_last / nat_series["civil_3y"][i_last] * 100, 1) if civil_last is not None and nat_series["civil_3y"][i_last] else None
        facts = [["Circuit", name], ["Latest report", label(ctx.latest) + " (CJRA Tables 2 and 4)"], [MEASURE_DEFINITIONS["civil_3y"], fmt(civil_last)],
                 ["Share of national civil cases pending 3+ years", fmt(share_last, 1, "%") if share_last is not None else NOT_RECORDED],
                 ["Rank by civil cases pending 3+ years (1 = most of 12 circuits)", f"{rank_civil.get(k) or NOT_RECORDED} of {len(rank_civil)}"],
                 [MEASURE_DEFINITIONS["motions_6m"], fmt(s["motions_6m"][i_last])], [MEASURE_DEFINITIONS["bench_trials_6m"], fmt(s["bench_trials_6m"][i_last])],
                 [MEASURE_DEFINITIONS["bankruptcy_appeals_6m"], fmt(s["bankruptcy_appeals_6m"][i_last])], [MEASURE_DEFINITIONS["ss_appeals_6m"], fmt(s["ss_appeals_6m"][i_last])],
                 ["Average civil cases pending 3+ years per judge (printed, Table 4)", fmt(avg_civil[i_last], 1)], ["Average motions pending 6+ months per judge (printed, Table 4)", fmt(avg_mot[i_last], 1)],
                 ["Percent of the circuit's 3+ year civil cases held by district judges (Table 2)", fmt(pct_district[i_last], 1, "%") if pct_district[i_last] is not None else NOT_RECORDED],
                 ["Largest districts by civil cases pending 3+ years", "; ".join(f"{t['name']} {fmt(t['civil_3y'])}" for t in top[:3])],
                 ["Reports where Table 2 differs from the sum of the Appendix A district totals", str(len(adjusted))],
                 ["Report dates", f"{label(ctx.periods[0])} - {label(ctx.latest)}"]]
        rows.append(cw.record(
            "court_cjra_circuits", cid, title, source_url=ctx.table_url(ctx.latest, 2),
            subtitle=f"{label(ctx.latest)}: {fmt(civil_last)} civil cases pending 3+ years · {fmt(s['motions_6m'][i_last])} motions pending 6+ months",
            cells={"circuit": title, "civil_3y": fmt(civil_last), "motions_6m": fmt(s["motions_6m"][i_last]), "bench_trials_6m": fmt(s["bench_trials_6m"][i_last]),
                   "bankruptcy_appeals_6m": fmt(s["bankruptcy_appeals_6m"][i_last]), "ss_appeals_6m": fmt(s["ss_appeals_6m"][i_last]),
                   "avg_civil": fmt(avg_civil[i_last], 1), "avg_motions": fmt(avg_mot[i_last], 1), "share": fmt(share_last, 1, "%") if share_last is not None else NOT_RECORDED},
            facts=facts, links=[{"url": f"/courts/{cid}", "label": "Court profile"}, {"url": ctx.table_url(ctx.latest, 2), "label": f"CJRA Table 2, {label(ctx.latest)}"},
                                {"url": ctx.table_url(ctx.latest, 4), "label": f"CJRA Table 4, {label(ctx.latest)}"}],
            text=f"{name} circuit Civil Justice Reform Act CJRA civil cases pending three years motions pending six months",
            filters={"circuit": [cid], "kind": ["circuit"]},
            extra={"kind": "circuit", "circuit": k, "periods": ctx.periods, "series": s, "appendix_a_sum_of_districts": appendix_sum, "appendix_a_printed_total": printed,
                   "avg_civil_3y_per_judge": avg_civil, "avg_motions_6m_per_judge": avg_mot, "pct_civil_3y_district_judges": pct_district,
                   "periods_where_table2_differs_from_district_sum": adjusted, "districts": members, "top_districts_latest": top, "rank_civil_3y_latest": rank_civil.get(k)},
        ))
    # national record: Table 1 totals, judge-type split, district concentration
    nat = {m: nat_series[m] for m in MEASURES}
    previous = {m: series_of(ctx.data, ctx.periods, lambda d, m=m: d["national"]["table1"][m]["previous"]) for m in MEASURES}
    split = {m: {"district_judges": series_of(ctx.data, ctx.periods, lambda d, m=m: d["national"]["table1_judge_type"][m]["district"]["current"]),
                 "magistrate_judges": series_of(ctx.data, ctx.periods, lambda d, m=m: d["national"]["table1_judge_type"][m]["magistrate"]["current"])} for m in MEASURES}
    avg_civil = series_of(ctx.data, ctx.periods, lambda d: d["national"]["table4_total"]["civil_3y_per_judge"])
    avg_mot = series_of(ctx.data, ctx.periods, lambda d: d["national"]["table4_total"]["motions_6m_per_judge"])
    conc = []
    for p in ctx.periods:
        vals = sorted((d["values"]["civil_3y"] for d in ctx.data[p]["districts"].values() if d["values"] is not None), reverse=True)
        total = sum(vals)
        conc.append({"period": p, "districts": len(vals), "total": total, "top5_share_pct": round(sum(vals[:5]) / total * 100, 1) if total else None,
                     "hhi": round(sum((v / total * 100) ** 2 for v in vals), 1) if total else None})
    civil_last = nat["civil_3y"][i_last]
    facts = [["Scope", "Total of the 94 U.S. district courts (Table 1 of each CJRA report)"], ["Latest report", label(ctx.latest)],
             [MEASURE_DEFINITIONS["civil_3y"], fmt(civil_last)], ["Change from the previous report", delta_text(civil_last, nat["civil_3y"][i_last - 1], pct_change(civil_last, nat["civil_3y"][i_last - 1]))],
             ["Change from the report a year earlier", delta_text(civil_last, nat["civil_3y"][i_last - 2], pct_change(civil_last, nat["civil_3y"][i_last - 2]))],
             [MEASURE_DEFINITIONS["motions_6m"], fmt(nat["motions_6m"][i_last])], [MEASURE_DEFINITIONS["bench_trials_6m"], fmt(nat["bench_trials_6m"][i_last])],
             [MEASURE_DEFINITIONS["bankruptcy_appeals_6m"], fmt(nat["bankruptcy_appeals_6m"][i_last])], [MEASURE_DEFINITIONS["ss_appeals_6m"], fmt(nat["ss_appeals_6m"][i_last])],
             ["Average civil cases pending 3+ years per judge (printed, Table 4)", fmt(avg_civil[i_last], 1)], ["Average motions pending 6+ months per judge (printed, Table 4)", fmt(avg_mot[i_last], 1)],
             ["Five districts' share of civil cases pending 3+ years", fmt(conc[i_last]["top5_share_pct"], 1, "%")], ["Herfindahl-Hirschman index of district shares (0-10,000)", fmt(conc[i_last]["hhi"], 1)],
             ["Report dates", f"{label(ctx.periods[0])} - {label(ctx.latest)}"]]
    rows.append(cw.record(
        "court_cjra_circuits", "us", "United States district courts (national total)", source_url=ctx.table_url(ctx.latest, 1),
        subtitle=f"{label(ctx.latest)}: {fmt(civil_last)} civil cases pending 3+ years · {fmt(nat['motions_6m'][i_last])} motions pending 6+ months",
        cells={"circuit": "United States district courts (national total)", "civil_3y": fmt(civil_last), "motions_6m": fmt(nat["motions_6m"][i_last]), "bench_trials_6m": fmt(nat["bench_trials_6m"][i_last]),
               "bankruptcy_appeals_6m": fmt(nat["bankruptcy_appeals_6m"][i_last]), "ss_appeals_6m": fmt(nat["ss_appeals_6m"][i_last]), "avg_civil": fmt(avg_civil[i_last], 1),
               "avg_motions": fmt(avg_mot[i_last], 1), "share": "100.0%"},
        facts=facts, links=[{"url": ctx.table_url(ctx.latest, 1), "label": f"CJRA Table 1, {label(ctx.latest)}"}, {"url": "/courts/analytics", "label": "Federal court analytics"}],
        text="national total United States district courts Civil Justice Reform Act CJRA civil cases pending three years motions pending six months",
        filters={"circuit": ["us"], "kind": ["national"]},
        extra={"kind": "national", "periods": ctx.periods, "series": nat, "previous_period_value": previous, "by_judge_type": split, "avg_civil_3y_per_judge": avg_civil,
               "avg_motions_6m_per_judge": avg_mot, "district_concentration_civil_3y": conc,
               "sum_of_district_totals": {m: [district_totals[p][m] for p in ctx.periods] for m in MEASURES}}))
    return rows


# ------------------------------------------------------------------ judges
def judge_records(ctx):
    people = {}
    for p in ctx.periods:
        for cid, e in ctx.data[p]["districts"].items():
            for r in e["rows"]:
                if r["kind"] != "person":
                    continue
                key = J.identity_key(cid, r["name"]) or f"{cid}|raw|{' '.join(J.fold_words(r['printed']))}"
                rec = people.setdefault(key, {"court": cid, "name": r["name"], "printed": {}, "per": {}, "dup": False})
                rec["printed"][p] = r["printed"]
                if p in rec["per"]:
                    rec["dup"] = True
                    for m in MEASURES:
                        rec["per"][p]["values"][m] += r["values"][m]
                    rec["per"][p]["roles"].add(r["group"])
                else:
                    rec["per"][p] = {"values": dict(r["values"]), "roles": {r["group"]}, "designations": list((r["name"] or {}).get("designations", [])), "page": r["page"],
                                     "notes": [n for n in r["notes"] if n["text"]]}
    latest_idx = {p: i for i, p in enumerate(ctx.periods)}
    rows = []
    keys_sorted = sorted(people, key=lambda k: (-(len(people[k]["per"]) and latest_idx[max(people[k]["per"])]), -(people[k]["per"][max(people[k]["per"])]["values"]["civil_3y"]), k))
    used = set()
    for key in keys_sorted:
        rec = people[key]
        cid = rec["court"]
        name = rec["name"]
        last_p = max(rec["per"])
        first_p = min(rec["per"])
        match, status = ctx.fjc.match(cid, name, sorted(rec["per"])) if name and name.get("format") == "surname_first" else (None, "unparsed")
        profile, fjc_name = (match if match else (None, None))
        mixed_name = None
        for p in sorted(rec["printed"], reverse=True):
            if J.is_mixed_case(rec["printed"][p]):
                mixed_name = P.parse_name(rec["printed"][p])
                if mixed_name["format"] != "surname_first":
                    mixed_name = None
                break
        shown = J.display_name(name, mixed_name, fjc_name) if name and name.get("format") == "surname_first" else rec["printed"][last_p]
        rid = J.slug(key)
        if rid in used:  # two different identities with the same readable slug: keep both, told apart by a hash of the identity
            rid = f"{rid}-{hashlib.sha256(key.encode()).hexdigest()[:6]}"
        used.add(rid)
        court_title = f"U.S. {ctx.courts[cid][0]}"
        vals = {m: series_of(rec["per"], ctx.periods, lambda d, m=m: d["values"][m]) for m in MEASURES}
        listed = [p for p in ctx.periods if p in rec["per"]]
        roles = sorted({r for v in rec["per"].values() for r in v["roles"] if r})
        last_roles = sorted(r for r in rec["per"][last_p]["roles"] if r)
        last_role = last_roles[0] if last_roles else None
        role_text = {"district": "District judge", "magistrate": "Magistrate judge", None: "Not recorded"}.get(last_role, "Not recorded")
        peak = max(vals["civil_3y"][latest_idx[p]] for p in listed)
        active = last_p == ctx.latest
        lv = rec["per"][last_p]["values"]
        facts = [["Court", court_title], ["Role in the last report listing the judge", role_text], ["Printed in the last report as", rec["printed"][last_p]],
                 ["First report listing the judge", label(first_p)], ["Last report listing the judge", label(last_p)], ["Reports listing the judge", f"{len(listed)} of {len(ctx.periods)}"],
                 [f"{MEASURE_DEFINITIONS['civil_3y']} ({label(last_p)})", fmt(lv["civil_3y"])], [f"{MEASURE_DEFINITIONS['motions_6m']} ({label(last_p)})", fmt(lv["motions_6m"])],
                 [f"{MEASURE_DEFINITIONS['bench_trials_6m']} ({label(last_p)})", fmt(lv["bench_trials_6m"])],
                 [f"{MEASURE_DEFINITIONS['bankruptcy_appeals_6m']} ({label(last_p)})", fmt(lv["bankruptcy_appeals_6m"])],
                 [f"{MEASURE_DEFINITIONS['ss_appeals_6m']} ({label(last_p)})", fmt(lv["ss_appeals_6m"])],
                 ["Highest civil cases pending 3+ years in any listing", fmt(peak)],
                 ["Profile link", J.PROFILE_LINK_TEXT["unique" if profile else status]],
                 ["Note", "Counts are the judge's own assigned cases and motions as printed in CJRA Appendix A; a judge is one record per court and printed name (no merging of different spellings)."]]
        links = [{"url": f"/courts/{cid}", "label": "Court profile"}]
        if profile:
            links.append({"url": f"/judges/{profile}", "label": "Judge profile"})
        links.append({"url": ctx.appendix_url(last_p), "label": f"CJRA Appendix A, {label(last_p)} (U.S. Courts PDF)"})
        rows.append(cw.record(
            "court_cjra_judges", rid, shown, source_url=ctx.appendix_url(last_p),
            subtitle=f"{role_text} · {court_title} · last listed {label(last_p)}: {fmt(lv['civil_3y'])} civil cases pending 3+ years",
            cells={"judge": shown, "court": court_title, "role": role_text, "civil_3y": fmt(lv["civil_3y"]), "motions_6m": fmt(lv["motions_6m"]), "bench_trials_6m": fmt(lv["bench_trials_6m"]),
                   "bankruptcy_appeals_6m": fmt(lv["bankruptcy_appeals_6m"]), "ss_appeals_6m": fmt(lv["ss_appeals_6m"]), "reports": str(len(listed)), "last": label(last_p)},
            facts=facts, links=links, badges=(["Judge profile linked"] if profile else []) + (["Listed in latest report"] if active else []),
            text=f"{shown} {rec['printed'][last_p]} {court_title} {cid} judge Civil Justice Reform Act CJRA caseload delay",
            state=ctx.courts[cid][1],
            filters={"court": [cid], "circuit": [CIRCUIT_ID[P.CIRCUIT_OF[cid]]], "role": [last_role or "unknown"], "active": ["yes" if active else "no"], "profile": ["linked" if profile else "unlinked"],
                     **({"judge_profile": [profile]} if profile else {})},
            extra={"kind": "judge", "identity": key, "court_id": cid, "periods": ctx.periods, "series": vals, "roles": roles, "printed_names": sorted(set(rec["printed"].values())),
                   "printed_by_period": rec["printed"],
                   "designations": {p: v["designations"] for p, v in rec["per"].items() if v["designations"]}, "pages": {p: v["page"] for p, v in rec["per"].items()},
                   "match": {"status": status, "profile": profile}, "listed_more_than_once_in_a_report": rec["dup"],
                   "notes": [{"period": p, **n} for p, v in rec["per"].items() for n in v["notes"]][-12:]}))
    return rows


# ------------------------------------------------------------------ reports
def anomalies_of(ctx, p):
    d = ctx.data[p]
    out = []
    for cid, e in sorted(d["districts"].items()):
        rec = e["reconciliation"]
        if e["values"] is None:
            out.append({"kind": "district_not_recorded", "where": cid, "detail": e["reason"]})
        elif rec["status"] == "judge_rows_differ":
            out.append({"kind": "judge_rows_differ_from_printed_district_total", "where": cid, "detail": {"difference_printed_minus_rows": rec["difference"]}})
        elif e["source"] == "judge_rows_sum_matches_circuit_table":
            out.append({"kind": "district_total_row_not_printed", "where": cid, "detail": "value is the sum of the judge rows, confirmed by the report's own circuit table"})
    for k in CIRCUIT_ORDER:
        c = d["circuits"][k]
        if c["table2"] and c["sum_of_districts"] and c["table2"] != c["sum_of_districts"]:
            out.append({"kind": "table2_differs_from_sum_of_district_totals", "where": k, "detail": {"table2_minus_sum": D.diff(c["table2"], c["sum_of_districts"])}})
        if c["printed"] and c["table2"] and c["printed"] != c["table2"]:
            out.append({"kind": "appendix_a_circuit_total_differs_from_table2", "where": k, "detail": {"printed_minus_table2": D.diff(c["printed"], c["table2"])}})
    for name, flag in d["tables_ok"].items():
        if not flag["parsed"]:
            out.append({"kind": "table_not_read", "where": name, "detail": "table could not be read completely from the PDF text"})
        elif not flag["checks_ok"]:
            out.append({"kind": "table_arithmetic_not_consistent", "where": name, "detail": "a printed percent or share in the table does not follow from the printed counts"})
    return out


def report_records(ctx):
    rows = []
    for i, p in enumerate(ctx.periods):
        d = ctx.data[p]
        n = d["national"]
        t1 = n["table1"]
        anomalies = anomalies_of(ctx, p)
        files = [{"url": f["url"], "path": f["path"], "sha256": f["sha256"]} for f in ([d["main_file"]] + [f for f in d["table_files"] if f["path"] != d["main_file"]["path"]])]
        counts = defaultdict(int)
        for a in anomalies:
            counts[a["kind"]] += 1
        recorded = n["districts_listed"]
        persons = n["persons"]
        facts = [["Report date", label(p)], [MEASURE_DEFINITIONS["civil_3y"] + " (Table 1, all districts)", fmt(t1["civil_3y"]["current"])],
                 [MEASURE_DEFINITIONS["motions_6m"], fmt(t1["motions_6m"]["current"])], [MEASURE_DEFINITIONS["bench_trials_6m"], fmt(t1["bench_trials_6m"]["current"])],
                 [MEASURE_DEFINITIONS["bankruptcy_appeals_6m"], fmt(t1["bankruptcy_appeals_6m"]["current"])], [MEASURE_DEFINITIONS["ss_appeals_6m"], fmt(t1["ss_appeals_6m"]["current"])],
                 ["Districts with a recorded total", f"{recorded} of 94"], ["Named judges listed in Appendix A", fmt(persons)],
                 ["Anomalies found by the builder's checks", str(len(anomalies))],
                 ["Files", "; ".join(f["url"] for f in files)]]
        rows.append(cw.record(
            "court_cjra_reports", p, f"CJRA report, {label(p)}", source_url=ctx.period_page(p),
            subtitle=f"{fmt(t1['civil_3y']['current'])} civil cases pending 3+ years · {fmt(t1['motions_6m']['current'])} motions pending 6+ months · {recorded} districts",
            cells={"report": label(p), "civil_3y": fmt(t1["civil_3y"]["current"]), "motions_6m": fmt(t1["motions_6m"]["current"]), "bench_trials_6m": fmt(t1["bench_trials_6m"]["current"]),
                   "bankruptcy_appeals_6m": fmt(t1["bankruptcy_appeals_6m"]["current"]), "ss_appeals_6m": fmt(t1["ss_appeals_6m"]["current"]), "districts": str(recorded),
                   "anomalies": str(len(anomalies))},
            facts=facts, links=[{"url": ctx.period_page(p), "label": "U.S. Courts report page"}] + [{"url": f["url"], "label": "Report PDF"} for f in files[:5]],
            text=f"Civil Justice Reform Act report {label(p)} CJRA {p}", filters={"year": [p[:4]], "month": [p[5:7]], "anomalies": ["yes" if anomalies else "no"]},
            extra={"kind": "report", "period": p, "files": files, "table1": t1, "table1_by_judge_type": n["table1_judge_type"], "tables_checked": d["tables_ok"],
                   "extractor": d["extractor"], "anomaly_counts": dict(counts), "anomalies": anomalies, "shifted_rows": d["shifted_rows"], "incomplete_rows": d["incomplete"][:12]}))
    return rows


# ------------------------------------------------------------------ catalog entries
def listings():
    def c(*pairs):
        return list(pairs)

    return {
        "court_cjra_districts": (
            "U.S. district courts - Civil Justice Reform Act delay reports (March 2004 - March 2026)",
            cw.listing(c(("court", "Court"), ("circuit", "Circuit"), ("civil_3y", "Civil 3+ yrs"), ("motions_6m", "Motions 6+ mo"), ("bench_trials_6m", "Bench trials 6+ mo"),
                         ("bankruptcy_appeals_6m", "Bankr. appeals 6+ mo"), ("ss_appeals_6m", "Soc. Sec. 6+ mo"), ("share", "Share of national 3+ yr civil"), ("judges", "District judges listed")),
                       [("circuit", "Circuit", {f"ca{n}": f"{n}{'st' if n == 1 else 'nd' if n == 2 else 'rd' if n == 3 else 'th'} Circuit" for n in range(1, 12)} | {"cadc": "D.C. Circuit"}),
                        ("mdl_note", "Multidistrict litigation noted", {"yes": "Yes", "no": "No"}), ("discrepancy", "Source discrepancy", {"yes": "Yes", "no": "No"})])),
        "court_cjra_circuits": (
            "Civil Justice Reform Act delay reports - circuits and national totals (March 2004 - March 2026)",
            cw.listing(c(("circuit", "Circuit"), ("civil_3y", "Civil 3+ yrs"), ("motions_6m", "Motions 6+ mo"), ("bench_trials_6m", "Bench trials 6+ mo"), ("bankruptcy_appeals_6m", "Bankr. appeals 6+ mo"),
                         ("ss_appeals_6m", "Soc. Sec. 6+ mo"), ("avg_civil", "Avg civil 3+ yrs per judge"), ("avg_motions", "Avg motions 6+ mo per judge"), ("share", "Share of national 3+ yr civil")),
                       [("kind", "Kind", {"circuit": "Circuit", "national": "National total"})])),
        "court_cjra_judges": (
            "Judges and magistrate judges - Civil Justice Reform Act caseload delay counts (March 2004 - March 2026)",
            cw.listing(c(("judge", "Judge"), ("court", "Court"), ("role", "Role"), ("civil_3y", "Civil 3+ yrs"), ("motions_6m", "Motions 6+ mo"), ("bench_trials_6m", "Bench trials 6+ mo"),
                         ("bankruptcy_appeals_6m", "Bankr. appeals 6+ mo"), ("ss_appeals_6m", "Soc. Sec. 6+ mo"), ("reports", "Reports listed"), ("last", "Last listed")),
                       [("role", "Role", {"district": "District judge", "magistrate": "Magistrate judge", "unknown": "Not recorded"}), ("active", "Listed in latest report", {"yes": "Yes", "no": "No"}),
                        ("profile", "Judge profile", {"linked": "Linked", "unlinked": "Not linked"})])),
        "court_cjra_reports": (
            "Civil Justice Reform Act reports - one record per report (March 2004 - March 2026)",
            cw.listing(c(("report", "Report date"), ("civil_3y", "Civil 3+ yrs"), ("motions_6m", "Motions 6+ mo"), ("bench_trials_6m", "Bench trials 6+ mo"), ("bankruptcy_appeals_6m", "Bankr. appeals 6+ mo"),
                         ("ss_appeals_6m", "Soc. Sec. 6+ mo"), ("districts", "Districts recorded"), ("anomalies", "Anomalies")),
                       [("year", "Year", {str(y): str(y) for y in range(2004, 2027)}), ("anomalies", "Has anomalies", {"yes": "Yes", "no": "No"})])),
    }


def summaries(ctx, counts):
    common = {
        "source": "U.S. Courts, Civil Justice Reform Act (CJRA) semiannual reports of the Administrative Office of the U.S. Courts, " + INDEX_URL,
        "report_dates": [ctx.periods[0], ctx.latest], "reports": len(ctx.periods),
        "definitions": MEASURE_DEFINITIONS,
        "how_counts_are_read": "Counts are copied as printed from the PDF text of each report. District figures are the district total rows of Appendix A; circuit and national figures are Tables 1-4. "
                               "A value is shown as Not recorded when the report does not print it and the report's own tables cannot confirm it.",
        "checks": "Judge rows are added and compared with every printed total (type, district, circuit, national) and with Tables 1-3; differences are kept and labelled, never corrected.",
    }
    return {
        "court_cjra_districts": {**common, "records": counts["court_cjra_districts"], "formulas": {
            "share": "district civil cases pending 3+ years / sum of the recorded district values in the same report x 100",
            "per_listed_district_judge": "district civil cases pending 3+ years / number of named district judges (not unassigned or visiting-pool rows) listed with the district in the same report",
            "change": "(latest - earlier) / earlier x 100, one decimal; not computed when the earlier value is zero or not recorded",
            "rank": "competition ranking of the latest report's civil cases pending 3+ years among the 94 districts; ties share a rank"}},
        "court_cjra_circuits": {**common, "records": counts["court_cjra_circuits"], "formulas": {
            "circuit_values": "Table 2 of each report (current period); Appendix A district sums and printed circuit totals are stored beside them",
            "top5_share": "sum of the five largest district values / sum of all recorded district values x 100",
            "hhi": "sum over districts of (district share in percent) squared, range 0-10,000"}},
        "court_cjra_judges": {**common, "records": counts["court_cjra_judges"],
                              "identity": "one record per court and printed name (case, accents and punctuation folded); different spellings of a name are different records",
                              "profile_links": J.PROFILE_LINKS_SUMMARY},
        "court_cjra_reports": {**common, "records": counts["court_cjra_reports"]},
    }


# ------------------------------------------------------------------ main
def load_fjc_lookup(lk):
    """The FJC judge lookup. Preferred: snapshots of judge_profiles_fjc and judge_cl_crosswalk (lookups/fjc_profiles.json and
    lookups/crosswalk.json, the jsonb arrays of scripts/enrichment/judge_xwalk/snapshot_queries/*.sql), turned into the lookup by
    cjra_judges.lookup_from_snapshots (every FJC status, one profile per FJC nid). Fallback: a prepared lookups/judge_profiles_fjc.json."""
    snaps = (lk / "fjc_profiles.json", lk / "crosswalk.json")
    if all(p.exists() for p in snaps):
        return J.lookup_from_snapshots(json.loads(snaps[0].read_text(encoding="utf-8")), json.loads(snaps[1].read_text(encoding="utf-8")))
    return json.loads((lk / "judge_profiles_fjc.json").read_text())


def load_lookups():
    lk = S.BUILD / "lookups"
    return (json.loads((lk / "court_spine_districts.json").read_text()), load_fjc_lookup(lk),
            json.loads((lk / "places_states.json").read_text()), json.loads((lk / "court_stats_district_times_over3.json").read_text()))


def collect_inputs(ctx):
    seen = {}
    for p in ctx.periods:
        d = ctx.data[p]
        for f in [d["main_file"]] + d["table_files"]:
            seen[f["path"]] = {"url": f["url"], "path": f["path"], "sha256": f["sha256"]}
    return [seen[k] for k in sorted(seen)]


def main(argv):
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1:])
    lookup, judges_lookup, places, over3 = load_lookups()
    _, periods = D.build_all()
    ctx = Context(lookup, periods, judges_lookup, places, over3)
    builders = {"court_cjra_districts": district_records, "court_cjra_circuits": circuit_records, "court_cjra_judges": judge_records, "court_cjra_reports": report_records}
    built = {name: fn(ctx) for name, fn in builders.items() if not only or name in only}
    counts = {k: len(v) for k, v in built.items()}
    labels = listings()
    inputs = collect_inputs(ctx)
    built_at = max(e["retrieved_at"] for e in S.manifest().values() if e["path"] in {i["path"] for i in inputs})
    sums = summaries(ctx, counts)
    for name, rows in built.items():
        label_text, listing_block = labels[name]
        out = S.BUILD / f"{name}.json"
        out.write_text(json.dumps({"dataset": name, "label": label_text, "listing_block": listing_block, "summary": sums[name], "rows": rows, "built_at": built_at, "inputs": inputs},
                                  separators=(",", ":"), sort_keys=False))
        print(json.dumps({"dataset": name, "rows": len(rows), "file": str(out), "sha256": sha(rows)}))


if __name__ == "__main__":
    main(sys.argv[1:])
