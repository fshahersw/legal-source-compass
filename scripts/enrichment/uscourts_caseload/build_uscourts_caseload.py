"""Build the U.S. Courts caseload datasets (Judicial Business tables FY2005-FY2025 and Judicial Facts and Figures) as corpus build files.

Reads only private/acq/uscourts_caseload (hash-checked against its manifest), the parse cache written by extract_jb.py and the read-only
corpus lookups saved in private/build/uscourts_caseload/lookups. Writes private/build/uscourts_caseload/<dataset>.json:
  {"dataset", "label", "listing_block", "summary", "rows", "built_at", "inputs": [{url, path, sha256}]}

Datasets
  court_jb_districts    94 district courts: civil terminations by action taken (Table C-4A), trials completed (T-1), MDL transfers (S-19)
  court_jb_bankruptcy   bankruptcy courts: filings by chapter, business and nonbusiness (Table F-2)
  court_jb_circuits     12 circuits + national totals across those tables, plus national civil terminations by jurisdiction (C-4) and MDL (S-20)
  court_jb_civil_nos    national civil terminations by nature of suit and action taken (C-4), FY2011-FY2025
  court_jff_series      Judicial Facts and Figures year-row tables, merged across editions with source cell addresses

Usage: python3 -I -B build_uscourts_caseload.py [--only dataset ...]
"""
import hashlib
import json
import re
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import corpus_writer as cw  # noqa: E402
import uc_common as U  # noqa: E402
import uc_jff as F  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "uscourts_caseload"
BUILD = ROOT / "private" / "build" / "uscourts_caseload"
CACHE = BUILD / "extracted"
NOT_RECORDED = "Not recorded"
YEARS = list(range(2005, 2026))
CIRCUITS = ["cadc"] + [f"ca{n}" for n in range(1, 12)]
CIRCUIT_TITLES = {"cadc": "U.S. Court of Appeals for the D.C. Circuit", **{f"ca{n}": f"U.S. Court of Appeals for the {U.CIRCUIT_NAMES[f'ca{n}']}" for n in range(1, 12)}}
LISTING_PAGE = "https://www.uscourts.gov/data-news/data-tables"
TABLE_TITLES = {
    "C-4A": "Table C-4A: U.S. District Courts - Civil Cases Terminated, by District and Action Taken",
    "C-4": "Table C-4: U.S. District Courts - Civil Cases Terminated, by Nature of Suit and Action Taken",
    "T-1": "Table T-1: U.S. District Courts - Trials Completed, by District",
    "S-19": "Table S-19: Multidistrict Litigation Transfers, by District",
    "S-20": "Table S-20: Multidistrict Litigation Actions Transferred and Terminated (national)",
    "F-2": "Table F-2: U.S. Bankruptcy Courts - Cases Filed, by Chapter of the Bankruptcy Code",
}
FIELD_LABELS = {
    "total": "Civil cases terminated", "no_action": "Terminated with no court action", "court_total": "Terminated with court action",
    "before_pretrial": "Terminated before pretrial", "during_after_pretrial": "Terminated during or after pretrial", "trial_total": "Terminated during or after trial",
    "trial_nonjury": "Terminated after nonjury trial", "trial_jury": "Terminated after jury trial", "pct_trial": "Percent reaching trial (as printed)",
    "all_trials": "Trials completed (civil and criminal)", "civil_total": "Civil trials completed", "civil_nonjury": "Civil nonjury trials", "civil_jury": "Civil jury trials",
    "criminal_total": "Criminal trials completed", "criminal_nonjury": "Criminal nonjury trials", "criminal_jury": "Criminal jury trials",
    "in_12m": "MDL actions transferred in (12 months)", "out_12m": "MDL actions transferred out (12 months)", "in_cum": "MDL actions transferred in (cumulative)",
    "out_cum": "MDL actions transferred out (cumulative)", "pending": "MDL actions pending",
    "ch7": "Chapter 7", "ch11": "Chapter 11", "ch13": "Chapter 13", "ch12": "Chapter 12", "ch9": "Chapter 9", "ch15": "Chapter 15", "bus_total": "Business filings",
    "nonbus_total": "Nonbusiness filings", "bus_ch7": "Business Chapter 7", "bus_ch11": "Business Chapter 11", "bus_ch13": "Business Chapter 13",
    "nonbus_ch7": "Nonbusiness Chapter 7", "nonbus_ch11": "Nonbusiness Chapter 11", "nonbus_ch13": "Nonbusiness Chapter 13",
}
C4A_FIELDS = ["total", "no_action", "court_total", "before_pretrial", "during_after_pretrial", "trial_total", "trial_nonjury", "trial_jury", "pct_trial"]
T1_FIELDS = ["all_trials", "civil_total", "civil_nonjury", "civil_jury", "criminal_total", "criminal_nonjury", "criminal_jury"]
S19_FIELDS = ["in_12m", "out_12m", "in_cum", "out_cum", "pending"]
F2_FIELDS = ["total", "ch7", "ch11", "ch13", "ch12", "ch9", "ch15", "bus_total", "bus_ch7", "bus_ch11", "bus_ch13", "nonbus_total", "nonbus_ch7", "nonbus_ch11", "nonbus_ch13"]


# ------------------------------------------------------------------ helpers
DASH_SHOWN = "\u2013"


def display_series(series, dash, years=YEARS):
    """Copy of the series for display: a year the source printed as a dash shows the dash (nothing was reported), not Not recorded."""
    out = {}
    for name, values in series.items():
        dy = set(dash.get(name, ()))
        out[name] = [DASH_SHOWN if (y in dy and v is None) else v for v, y in zip(values, years)] if dy else values
    return out


def fmt(value, digits=0, suffix=""):
    if value == DASH_SHOWN:
        return DASH_SHOWN
    if value is None:
        return NOT_RECORDED
    return (f"{value:,.{digits}f}" if digits else f"{int(round(value)):,}") + suffix


def pct_change(new, old):
    if new is None or old is None or old == 0:
        return None
    return round((new - old) / old * 100, 1)


def ratio_pct(part, whole, digits=2):
    if part is None or whole in (None, 0):
        return None
    return round(part / whole * 100, digits)


def competition_rank(values, reverse=True):
    items = {k: v for k, v in values.items() if v is not None}
    ordered = sorted(items.values(), reverse=reverse)
    return {k: ordered.index(v) + 1 for k, v in items.items()}


def sha(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "none").lower()).strip("-")


def value_of(raw):
    """Cached cell -> (number or None, printed_dash). A printed dash is stored as None and listed in the record's dash map."""
    if raw == U.DASH:
        return None, True
    if isinstance(raw, bool):
        return None, False
    return raw, False


class JB:
    """The parse cache of the Judicial Business tables."""

    def __init__(self, cache=CACHE):
        self.tables = {}
        for path in sorted(cache.glob("jb_*.json")):
            payload = json.loads(path.read_text())
            self.tables[(payload["table"], payload["year"])] = payload

    def years(self, table):
        return sorted(y for t, y in self.tables if t == table)

    def payload(self, table, year):
        return self.tables.get((table, year))

    def rows(self, table, year, kind):
        p = self.payload(table, year)
        return [] if not p else [r for r in p["rows"] if r.get("kind") == kind]

    def series(self, table, key, field, kind="district", key_field="court_id", years=YEARS):
        """([value per year], [dash years], [unreconciled years]) for one row key and field."""
        values, dashes, flagged = [], [], []
        for y in years:
            row = next((r for r in self.rows(table, y, kind) if r.get(key_field) == key), None)
            if row is None or field not in row["fields"]:
                values.append(None)
                continue
            v, is_dash = value_of(row["fields"][field])
            values.append(v)
            if is_dash:
                dashes.append(y)
            if field in (row.get("unreconciled") or []):
                flagged.append(y)
        return values, dashes, flagged

    def total_series(self, table, field, years=YEARS):
        values, dashes = [], []
        for y in years:
            rows = self.rows(table, y, "total")
            if not rows or field not in rows[0]["fields"]:
                values.append(None)
                continue
            v, d = value_of(rows[0]["fields"][field])
            values.append(v)
            if d:
                dashes.append(y)
        return values, dashes

    def failed_checks(self, table):
        out = {}
        for (t, y), p in self.tables.items():
            if t == table:
                bad = [c for c in p["checks"] if not c["ok"]]
                if bad:
                    out[y] = [{"check": c["check"], "detail": c["detail"]} for c in bad]
        return dict(sorted(out.items()))

    def source(self, table, year):
        p = self.payload(table, year)
        return {"url": p["url"], "page_url": p["page_url"], "path": p["path"], "sha256": p["sha256"], "retrieved_at": p["retrieved_at"], "format": p["format"]} if p else None


class Context:
    def __init__(self, jb, spine, circuits, places, jff_index, over=None):
        self.jb = jb
        self.districts = spine["districts"]
        self.bankruptcy = spine["bankruptcy"]
        self.circuit_titles = circuits["circuits"]
        self.places = set(places["ids"])
        self.jff_index = jff_index
        self.latest = max(y for t, y in jb.tables if t == "C-4A")


def district_ids(ctx):
    return sorted(ctx.districts)


def bankruptcy_id(district, bankruptcy, districts=None):
    """Bankruptcy court id (court_spine) of a district label's court: the district id with the final d replaced by b, or a documented
    exception (Arizona 'arb', Nebraska 'nebraskab'). None when the spine has no such court."""
    if districts is not None and district not in districts:   # a label that is not one court's district (the combined Arkansas row) has no bankruptcy court
        return None
    exceptions = {"azd": "arb", "ned": "nebraskab"}
    cand = exceptions.get(district) or (district[:-1] + "b" if district.endswith("d") else None)
    return cand if cand in bankruptcy else None


# ------------------------------------------------------------------ districts
def district_records(ctx):
    jb = ctx.jb
    ids = district_ids(ctx)
    latest = ctx.latest
    i = YEARS.index(latest)
    nat = {f: jb.total_series("C-4A", f)[0] for f in C4A_FIELDS}
    nat_s19 = {f: jb.total_series("S-19", f)[0] for f in S19_FIELDS}
    data = {}
    for cid in ids:
        d = {"series": {}, "dash": {}, "flags": {}}
        for table, fields, prefix in (("C-4A", C4A_FIELDS, "terminated_"), ("T-1", T1_FIELDS, "trials_"), ("S-19", S19_FIELDS, "mdl_")):
            for f in fields:
                name = f"{prefix}{f}"
                values, dashes, flagged = jb.series(table, cid, f)
                d["series"][name] = values
                if dashes:
                    d["dash"][name] = dashes
                if flagged:
                    d["flags"][name] = flagged
        d["series"]["trial_rate_pct"] = [ratio_pct(a, b) for a, b in zip(d["series"]["terminated_trial_total"], d["series"]["terminated_total"])]
        d["series"]["share_of_national_terminations_pct"] = [ratio_pct(a, b) for a, b in zip(d["series"]["terminated_total"], nat["total"])]
        d["series"]["mdl_pending_share_of_national_pct"] = [ratio_pct(a, b) for a, b in zip(d["series"]["mdl_pending"], nat_s19["pending"])]
        data[cid] = d
    rank_term = competition_rank({c: data[c]["series"]["terminated_total"][i] for c in ids})
    rank_rate = competition_rank({c: data[c]["series"]["trial_rate_pct"][i] for c in ids if (data[c]["series"]["terminated_total"][i] or 0) >= 500})
    rank_mdl = competition_rank({c: data[c]["series"]["mdl_pending"][i] for c in ids})
    rank_trials = competition_rank({c: data[c]["series"]["trials_all_trials"][i] for c in ids})
    rows = []
    c4a_src, t1_src, s19_src = (jb.source(t, latest) for t in ("C-4A", "T-1", "S-19"))
    for cid in ids:
        name, st = ctx.districts[cid]
        s = data[cid]["series"]
        ds = display_series(s, data[cid]["dash"])
        title = f"U.S. {name}"
        circuit = next((r["circuit"] for r in jb.rows("C-4A", latest, "district") if r["court_id"] == cid), None)
        term, prev = s["terminated_total"][i], s["terminated_total"][i - 1]
        facts = [
            ["Court ID", cid], ["Circuit", U.CIRCUIT_NAMES.get(circuit, NOT_RECORDED)], ["Fiscal year", f"FY{latest} (12 months ending September 30, {latest})"],
            ["Civil cases terminated (C-4A)", fmt(ds["terminated_total"][i])], ["Change from FY%d" % (latest - 1), fmt(pct_change(term, prev), 1, "%") if pct_change(term, prev) is not None else NOT_RECORDED],
            ["Share of all civil terminations in the 94 districts", fmt(ds["share_of_national_terminations_pct"][i], 2, "%") if s["share_of_national_terminations_pct"][i] is not None else NOT_RECORDED],
            ["Terminated with no court action", fmt(ds["terminated_no_action"][i])], ["Terminated before pretrial", fmt(ds["terminated_before_pretrial"][i])],
            ["Terminated during or after pretrial", fmt(ds["terminated_during_after_pretrial"][i])], ["Terminated during or after trial", fmt(ds["terminated_trial_total"][i])],
            ["Trial rate (terminated during or after trial / civil cases terminated)", fmt(ds["trial_rate_pct"][i], 2, "%") if s["trial_rate_pct"][i] is not None else NOT_RECORDED],
            ["Trials completed, civil and criminal (T-1)", fmt(ds["trials_all_trials"][i])], ["Civil trials completed (T-1)", fmt(ds["trials_civil_total"][i])],
            ["MDL actions pending in the district (S-19)", fmt(ds["mdl_pending"][i])],
            ["Share of all MDL actions pending", fmt(ds["mdl_pending_share_of_national_pct"][i], 2, "%") if s["mdl_pending_share_of_national_pct"][i] is not None else NOT_RECORDED],
            ["Rank by civil cases terminated (1 = most of 94)", f"{rank_term.get(cid, NOT_RECORDED)} of {len(rank_term)}"],
            ["Rank by trial rate (districts with 500+ terminations)", f"{rank_rate[cid]} of {len(rank_rate)}" if cid in rank_rate else NOT_RECORDED],
            ["Tables", "C-4A (terminations), T-1 (trials; FY2014 onward), S-19 (MDL transfers)"], ["Fiscal years", f"FY{YEARS[0]}-FY{latest}"],
        ]
        links = [{"url": f"/courts/{cid}", "label": "Court profile"}]
        if st in ctx.places:
            links.append({"url": f"/places/{st}", "label": f"{st} place profile"})
        links += [{"url": c4a_src["page_url"], "label": f"Table C-4A, FY{latest}"}, {"url": t1_src["page_url"], "label": f"Table T-1, FY{latest}"}, {"url": s19_src["page_url"], "label": f"Table S-19, FY{latest}"}]
        cells = {"court": title, "circuit": U.CIRCUIT_NAMES.get(circuit, ""), "terminated": fmt(ds["terminated_total"][i]), "trial_rate": fmt(ds["trial_rate_pct"][i], 2, "%") if s["trial_rate_pct"][i] is not None else NOT_RECORDED,
                 "trials": fmt(ds["trials_all_trials"][i]), "mdl_pending": fmt(ds["mdl_pending"][i]), "share": fmt(ds["share_of_national_terminations_pct"][i], 2, "%") if s["share_of_national_terminations_pct"][i] is not None else NOT_RECORDED}
        flagged = bool(data[cid]["flags"])
        rows.append(cw.record(
            "court_jb_districts", cid, title, source_url=c4a_src["url"],
            subtitle=f"FY{latest}: {fmt(ds['terminated_total'][i])} civil cases terminated · {fmt(ds['terminated_trial_total'][i])} during or after trial · {fmt(ds['mdl_pending'][i])} MDL actions pending",
            cells=cells, facts=facts, links=links, badges=["Source total mismatch"] if flagged else [],
            text=f"{name} {cid} {st} federal district court Judicial Business civil cases terminated action taken trials completed multidistrict litigation transfers",
            state=st, filters={"court": [cid], "circuit": [circuit or ""], "state": [st], "flagged": ["yes" if flagged else "no"]},
            extra={"kind": "district", "court_id": cid, "years": YEARS, "series": s, "dash": data[cid]["dash"], "unreconciled_years": data[cid]["flags"],
                   "ranks": {"terminated_total": rank_term.get(cid), "trial_rate_pct": rank_rate.get(cid), "mdl_pending": rank_mdl.get(cid), "trials": rank_trials.get(cid), "of": len(rank_term), "year": latest}}))
    return rows


# ------------------------------------------------------------------ bankruptcy
def bankruptcy_records(ctx):
    jb = ctx.jb
    latest = max(jb.years("F-2"))
    i = YEARS.index(latest)
    labels = {}
    for y in YEARS:
        for r in jb.rows("F-2", y, "district"):
            labels[r["label"]] = r
    entries = {}  # bankruptcy court id -> (title, state, district label rows key)
    unmapped = []
    for label, r in sorted(labels.items()):
        did = r["court_id"]
        bid = bankruptcy_id(did, ctx.bankruptcy, ctx.districts)
        if bid is None:
            unmapped.append(label)
            continue
        entries[bid] = {"key": did, "label": label}
    nat_total = jb.total_series("F-2", "total")[0]
    data = {}
    for bid, ent in entries.items():
        d = {"series": {}, "dash": {}}
        for f in F2_FIELDS:
            values, dashes, _ = jb.series("F-2", ent["key"], f)
            d["series"][f] = values
            if dashes:
                d["dash"][f] = dashes
        d["series"]["business_share_pct"] = [ratio_pct(a, b, 1) for a, b in zip(d["series"]["bus_total"], d["series"]["total"])]
        d["series"]["chapter_13_share_pct"] = [ratio_pct(a, b, 1) for a, b in zip(d["series"]["ch13"], d["series"]["total"])]
        d["series"]["share_of_national_filings_pct"] = [ratio_pct(a, b) for a, b in zip(d["series"]["total"], nat_total)]
        data[bid] = d
    # Arkansas: one combined row from FY2018 (label AR) next to the two courts' rows before it
    combined = {}
    for y in YEARS:
        for r in jb.rows("F-2", y, "district"):
            if r["label"] == "AR":
                combined[y] = r
    rank = competition_rank({b: data[b]["series"]["total"][i] for b in data})
    rows = []
    src = jb.source("F-2", latest)
    for bid in sorted(data):
        title, st = ctx.bankruptcy[bid]
        s = data[bid]["series"]
        ds = display_series(s, data[bid]["dash"])
        cur, prev = s["total"][i], s["total"][i - 1]
        facts = [["Court ID", bid], ["Fiscal year", f"FY{latest} (12 months ending September 30, {latest})"], ["Bankruptcy cases filed", fmt(ds["total"][i])],
                 ["Change from FY%d" % (latest - 1), fmt(pct_change(cur, prev), 1, "%") if pct_change(cur, prev) is not None else NOT_RECORDED],
                 ["Share of all bankruptcy cases filed", fmt(ds["share_of_national_filings_pct"][i], 2, "%") if s["share_of_national_filings_pct"][i] is not None else NOT_RECORDED],
                 ["Chapter 7", fmt(ds["ch7"][i])], ["Chapter 11", fmt(ds["ch11"][i])], ["Chapter 13", fmt(ds["ch13"][i])], ["Chapter 12", fmt(ds["ch12"][i])], ["Chapter 9", fmt(ds["ch9"][i])],
                 ["Chapter 15", fmt(ds["ch15"][i])], ["Business filings", fmt(ds["bus_total"][i])], ["Nonbusiness filings", fmt(ds["nonbus_total"][i])],
                 ["Business share of filings", fmt(ds["business_share_pct"][i], 1, "%") if s["business_share_pct"][i] is not None else NOT_RECORDED],
                 ["Rank by cases filed (1 = most)", f"{rank.get(bid, NOT_RECORDED)} of {len(rank)}"], ["Table", "F-2 (bankruptcy cases filed by chapter, 12 months ending September 30)"],
                 ["Fiscal years", f"FY{YEARS[0]}-FY{latest}"]]
        if bid in ("areb", "arwb"):
            facts.append(["Note", "The Arkansas bankruptcy courts are reported together (label AR) from FY2018; this record has values through FY2017 only."])
        links = [{"url": f"/courts/{bid}", "label": "Court profile"}]
        if st in ctx.places:
            links.append({"url": f"/places/{st}", "label": f"{st} place profile"})
        links.append({"url": src["page_url"], "label": f"Table F-2, FY{latest}"})
        rows.append(cw.record(
            "court_jb_bankruptcy", bid, title, source_url=src["url"], subtitle=f"FY{latest}: {fmt(ds['total'][i])} bankruptcy cases filed · Chapter 7 {fmt(ds['ch7'][i])} · Chapter 13 {fmt(ds['ch13'][i])}",
            cells={"court": title, "filed": fmt(ds["total"][i]), "ch7": fmt(ds["ch7"][i]), "ch11": fmt(ds["ch11"][i]), "ch13": fmt(ds["ch13"][i]), "business": fmt(ds["bus_total"][i]),
                   "business_share": fmt(ds["business_share_pct"][i], 1, "%") if s["business_share_pct"][i] is not None else NOT_RECORDED, "share": fmt(ds["share_of_national_filings_pct"][i], 2, "%") if s["share_of_national_filings_pct"][i] is not None else NOT_RECORDED},
            facts=facts, links=links, text=f"{title} {bid} {st} bankruptcy court cases filed chapter 7 11 13 business nonbusiness Judicial Business Table F-2",
            state=st, filters={"court": [bid], "state": [st]},
            extra={"kind": "bankruptcy_court", "court_id": bid, "district_label": entries[bid]["label"], "years": YEARS, "series": s, "dash": data[bid]["dash"], "of": len(rank), "rank_filed": rank.get(bid)}))
    if combined:
        ys = sorted(combined)
        values = {f: [value_of(combined[y]["fields"].get(f))[0] if y in combined else None for y in YEARS] for f in F2_FIELDS}
        dash = {f: [y for y in ys if value_of(combined[y]["fields"].get(f))[1]] for f in F2_FIELDS}
        dash = {f: v for f, v in dash.items() if v}
        title = "United States Bankruptcy Courts, E.D. and W.D. Arkansas (reported together from FY2018)"
        cur = values["total"][i]
        ds = display_series(values, dash)   # this record has its own series: never reuse the display copy of the previous court
        rows.append(cw.record(
            "court_jb_bankruptcy", "arkansas-combined", title, source_url=src["url"], subtitle=f"FY{latest}: {fmt(ds['total'][i])} bankruptcy cases filed (both Arkansas courts)",
            cells={"court": title, "filed": fmt(ds["total"][i]), "ch7": fmt(ds["ch7"][i]), "ch11": fmt(ds["ch11"][i]), "ch13": fmt(ds["ch13"][i]), "business": fmt(ds["bus_total"][i]),
                   "business_share": fmt(ratio_pct(values["bus_total"][i], cur, 1), 1, "%") if ratio_pct(values["bus_total"][i], cur, 1) is not None else NOT_RECORDED, "share": fmt(ratio_pct(cur, nat_total[i]), 2, "%")},
            facts=[["Fiscal year", f"FY{latest}"], ["Bankruptcy cases filed (both courts)", fmt(ds["total"][i])], ["Reported together in", f"FY{ys[0]}-FY{ys[-1]}"],
                   ["Note", "Table F-2 prints one row (label AR) for the Eastern and Western Districts of Arkansas from FY2018; the earlier years are on the records of the two courts."],
                   ["Table", "F-2"]],
            links=[{"url": "/courts/areb", "label": "E.D. Arkansas bankruptcy court"}, {"url": "/courts/arwb", "label": "W.D. Arkansas bankruptcy court"}, {"url": src['page_url'], "label": f"Table F-2, FY{latest}"}],
            text="Arkansas bankruptcy courts combined Eastern Western Table F-2 cases filed", state="AR", filters={"court": ["areb", "arwb"], "state": ["AR"]},
            extra={"kind": "bankruptcy_court_combined", "years": YEARS, "series": values, "dash": dash}))
    return rows, unmapped


# ------------------------------------------------------------------ circuits and national
def circuit_series(jb, table, circuit, field):
    if circuit == "cadc":
        return jb.series(table, "dcd", field)
    return jb.series(table, circuit, field, kind="circuit", key_field="circuit")


def s20_series(jb):
    names = ["actions_subjected", "actions_transferred", "actions_originally_filed", "terminations_total", "terminated_by_transferee", "remanded_by_panel"]
    out = {n: [] for n in names}
    out["pending"] = []
    revisions = []
    for y in YEARS:
        p = jb.payload("S-20", y)
        rows = p["rows"] if p else {}
        for n in names:
            out[n].append((rows.get(n) or {}).get("m12"))
        out["pending"].append((rows.get("pending") or {}).get("cum"))
        prev = jb.payload("S-20", y - 1)
        if p and prev:
            for n in names:
                a, b = (rows.get(n) or {}).get("m12_prev"), (prev["rows"].get(n) or {}).get("m12")
                if a is not None and b is not None and a != b:
                    revisions.append({"year": y - 1, "line": n, "earlier": b, "earlier_year_file": y - 1, "later": a, "later_year_file": y})
    return out, revisions


def circuit_records(ctx):
    jb = ctx.jb
    latest = ctx.latest
    i = YEARS.index(latest)
    rows = []
    nat_total = jb.total_series("C-4A", "total")[0]
    term_rank = competition_rank({c: circuit_series(jb, "C-4A", c, "total")[0][i] for c in CIRCUITS})
    c4a_src = jb.source("C-4A", latest)
    for c in CIRCUITS:
        s, dash, flags = {}, {}, {}
        for table, fields, prefix in (("C-4A", C4A_FIELDS, "terminated_"), ("T-1", T1_FIELDS, "trials_"), ("S-19", S19_FIELDS, "mdl_"), ("F-2", F2_FIELDS[:8], "bankruptcy_")):
            for f in fields:
                values, dashes, flagged = circuit_series(jb, table, c, f)
                s[f"{prefix}{f}"] = values
                if dashes:
                    dash[f"{prefix}{f}"] = dashes
                if flagged:
                    flags[f"{prefix}{f}"] = flagged
        s["trial_rate_pct"] = [ratio_pct(a, b) for a, b in zip(s["terminated_trial_total"], s["terminated_total"])]
        s["share_of_national_terminations_pct"] = [ratio_pct(a, b) for a, b in zip(s["terminated_total"], nat_total)]
        ds = display_series(s, dash)
        districts = sorted(d for d in ctx.districts if next((r["circuit"] for r in jb.rows("C-4A", latest, "district") if r["court_id"] == d), None) == c)
        term = s["terminated_total"][i]
        facts = [["Circuit", U.CIRCUIT_NAMES[c]], ["Fiscal year", f"FY{latest}"], ["Civil cases terminated in the circuit's districts (C-4A)", fmt(ds["terminated_total"][i])],
                 ["Share of all civil terminations", fmt(ds["share_of_national_terminations_pct"][i], 2, "%") if s["share_of_national_terminations_pct"][i] is not None else NOT_RECORDED],
                 ["Rank by civil cases terminated (1 = most of 12)", f"{term_rank.get(c, NOT_RECORDED)} of {len(term_rank)}"],
                 ["Terminated during or after trial", fmt(ds["terminated_trial_total"][i])], ["Trial rate", fmt(ds["trial_rate_pct"][i], 2, "%") if s["trial_rate_pct"][i] is not None else NOT_RECORDED],
                 ["Trials completed (T-1)", fmt(ds["trials_all_trials"][i])], ["MDL actions pending (S-19)", fmt(ds["mdl_pending"][i])],
                 ["Bankruptcy cases filed (F-2)", fmt(ds["bankruptcy_total"][i])], ["Districts", ", ".join(districts)], ["Fiscal years", f"FY{YEARS[0]}-FY{latest}"]]
        rows.append(cw.record(
            "court_jb_circuits", c, CIRCUIT_TITLES[c], source_url=c4a_src["url"], subtitle=f"FY{latest}: {fmt(ds['terminated_total'][i])} civil cases terminated · {fmt(ds['trials_all_trials'][i])} trials completed · {fmt(ds['bankruptcy_total'][i])} bankruptcy filings",
            cells={"circuit": CIRCUIT_TITLES[c], "terminated": fmt(ds["terminated_total"][i]), "trial_rate": fmt(ds["trial_rate_pct"][i], 2, "%") if s["trial_rate_pct"][i] is not None else NOT_RECORDED, "trials": fmt(ds["trials_all_trials"][i]),
                   "mdl_pending": fmt(ds["mdl_pending"][i]), "bankruptcy": fmt(ds["bankruptcy_total"][i]), "share": fmt(ds["share_of_national_terminations_pct"][i], 2, "%") if s["share_of_national_terminations_pct"][i] is not None else NOT_RECORDED},
            facts=facts, links=[{"url": f"/courts/{c}", "label": "Court profile"}, {"url": c4a_src["page_url"], "label": f"Table C-4A, FY{latest}"}],
            text=f"{U.CIRCUIT_NAMES[c]} circuit Judicial Business civil cases terminated trials completed multidistrict bankruptcy filings", filters={"circuit": [c], "kind": ["circuit"]},
            extra={"kind": "circuit", "circuit": c, "years": YEARS, "series": s, "dash": dash, "unreconciled_years": flags, "districts": districts, "rank_terminated": term_rank.get(c)}))
    # national
    s, dash = {}, {}
    for table, fields, prefix in (("C-4A", C4A_FIELDS, "terminated_"), ("T-1", T1_FIELDS, "trials_"), ("S-19", S19_FIELDS, "mdl_"), ("F-2", F2_FIELDS[:8], "bankruptcy_")):
        for f in fields:
            values, dashes = jb.total_series(table, f)
            s[f"{prefix}{f}"] = values
            if dashes:
                dash[f"{prefix}{f}"] = dashes
    s["trial_rate_pct"] = [ratio_pct(a, b) for a, b in zip(s["terminated_trial_total"], s["terminated_total"])]
    ds = display_series(s, dash)
    jurisdictions = {}
    for y in YEARS:
        for r in jb.rows("C-4", y, "jurisdiction"):
            jurisdictions.setdefault(r["jurisdiction"], {f: [None] * len(YEARS) for f in C4A_FIELDS})
            for f in C4A_FIELDS:
                if f in r["fields"]:
                    jurisdictions[r["jurisdiction"]][f][YEARS.index(y)] = value_of(r["fields"][f])[0]
    s20, s20_revisions = s20_series(jb)
    term = s["terminated_total"][i]
    facts = [["Scope", "All U.S. district courts (civil terminations, trials, MDL) and all bankruptcy courts"], ["Fiscal year", f"FY{latest}"], ["Civil cases terminated (C-4A)", fmt(ds["terminated_total"][i])],
             ["Terminated during or after trial", fmt(ds["terminated_trial_total"][i])], ["Trial rate", fmt(ds["trial_rate_pct"][i], 2, "%") if s["trial_rate_pct"][i] is not None else NOT_RECORDED],
             ["Trials completed (T-1)", fmt(ds["trials_all_trials"][i])], ["MDL actions pending (S-19)", fmt(ds["mdl_pending"][i])],
             ["MDL actions transferred in the year (S-20)", fmt(s20["actions_transferred"][i])], ["MDL actions pending, cumulative (S-20)", fmt(s20["pending"][i])],
             ["Bankruptcy cases filed (F-2)", fmt(ds["bankruptcy_total"][i])], ["Fiscal years", f"FY{YEARS[0]}-FY{latest}"]]
    rows.append(cw.record(
        "court_jb_circuits", "us", "United States courts (national total)", source_url=c4a_src["url"],
        subtitle=f"FY{latest}: {fmt(ds['terminated_total'][i])} civil cases terminated · {fmt(ds['trials_all_trials'][i])} trials completed · {fmt(ds['bankruptcy_total'][i])} bankruptcy filings",
        cells={"circuit": "United States courts (national total)", "terminated": fmt(ds["terminated_total"][i]), "trial_rate": fmt(ds["trial_rate_pct"][i], 2, "%") if s["trial_rate_pct"][i] is not None else NOT_RECORDED,
               "trials": fmt(ds["trials_all_trials"][i]), "mdl_pending": fmt(ds["mdl_pending"][i]), "bankruptcy": fmt(ds["bankruptcy_total"][i]), "share": "100.00%"},
        facts=facts, links=[{"url": c4a_src['page_url'], "label": f"Table C-4A, FY{latest}"}, {"url": jb.source("S-20", latest)["page_url"], "label": f"Table S-20, FY{latest}"}, {"url": "/courts/analytics", "label": "Federal court analytics"}],
        text="national total Judicial Business civil cases terminated trials completed multidistrict litigation bankruptcy filings", filters={"circuit": ["us"], "kind": ["national"]},
        extra={"kind": "national", "years": YEARS, "series": s, "dash": dash, "civil_terminations_by_jurisdiction": jurisdictions, "mdl_national": s20, "mdl_national_revisions": s20_revisions}))
    return rows


# ------------------------------------------------------------------ civil nature of suit (C-4)
NOS_YEARS = list(range(2011, 2026))


def nos_records(ctx):
    jb = ctx.jb
    keys = {}
    repeated = set()
    for y in YEARS:
        seen = {}
        for r in jb.rows("C-4", y, "nos"):
            k = (r["jurisdiction"], r["category"], r["label"], r.get("occurrence", 1))
            keys.setdefault(k, set()).add(y)
            seen[k[:3]] = seen.get(k[:3], 0) + 1
        repeated.update(k for k, n in seen.items() if n > 1)   # a label printed twice in one group (memo lines beside a #MULTIVALUE subtotal) is ambiguous in that year
    stable = sorted((k for k, ys in keys.items() if ys == set(NOS_YEARS) and k[:3] not in repeated), key=lambda k: tuple(str(x) for x in k))
    total_by_year = {y: (jb.rows("C-4", y, "total") or [{"fields": {}}])[0]["fields"].get("total") for y in NOS_YEARS}
    jur_names = {"us": "United States cases", "federal_question": "Federal question", "diversity": "Diversity of citizenship", "local": "Local jurisdiction"}
    rows = []
    src = jb.source("C-4", ctx.latest)
    for key in stable:
        jur, category, label, occ = key
        category_text = category or "Not grouped"
        s, dash = {}, {}
        for f in C4A_FIELDS:
            vals, ds = [], []
            for y in NOS_YEARS:
                r = next((r for r in jb.rows("C-4", y, "nos") if (r["jurisdiction"], r["category"], r["label"], r.get("occurrence", 1)) == key), None)
                v, d = (None, False) if r is None or f not in r["fields"] else value_of(r["fields"][f])
                vals.append(v)
                if d:
                    ds.append(y)
            s[f] = vals
            if ds:
                dash[f] = ds
        s["trial_rate_pct"] = [ratio_pct(a, b) for a, b in zip(s["trial_total"], s["total"])]
        s["share_of_all_terminations_pct"] = [ratio_pct(a, total_by_year[y]) for a, y in zip(s["total"], NOS_YEARS)]
        ds = display_series(s, dash, NOS_YEARS)
        rid = f"nos-{slug(jur)}-{slug(category)}-{slug(label)}" + (f"-{occ}" if occ and occ > 1 else "")
        j = len(NOS_YEARS) - 1
        title = f"{label} ({category_text}; {jur_names.get(jur, jur)})"
        facts = [["Nature of suit group", category_text], ["Jurisdiction group", jur_names.get(jur, jur)], ["Fiscal year", f"FY{NOS_YEARS[-1]}"], ["Civil cases terminated", fmt(ds["total"][j])],
                 ["Terminated with no court action", fmt(ds["no_action"][j])], ["Terminated before pretrial", fmt(ds["before_pretrial"][j])], ["Terminated during or after pretrial", fmt(ds["during_after_pretrial"][j])],
                 ["Terminated during or after trial", fmt(ds["trial_total"][j])], ["Trial rate", fmt(ds["trial_rate_pct"][j], 2, "%") if s["trial_rate_pct"][j] is not None else NOT_RECORDED],
                 ["Share of all civil terminations", fmt(ds["share_of_all_terminations_pct"][j], 2, "%") if s["share_of_all_terminations_pct"][j] is not None else NOT_RECORDED],
                 ["Fiscal years", f"FY{NOS_YEARS[0]}-FY{NOS_YEARS[-1]}"], ["Table", "C-4; earlier years use a different nature-of-suit scheme and are not joined"]]
        rows.append(cw.record(
            "court_jb_civil_nos", rid, title, source_url=src["url"], subtitle=f"FY{NOS_YEARS[-1]}: {fmt(ds['total'][j])} terminated · trial rate {fmt(ds['trial_rate_pct'][j], 2, '%') if s['trial_rate_pct'][j] is not None else NOT_RECORDED}",
            cells={"nos": label, "group": category_text, "jurisdiction": jur_names.get(jur, jur), "terminated": fmt(ds["total"][j]), "trial_rate": fmt(ds["trial_rate_pct"][j], 2, "%") if s["trial_rate_pct"][j] is not None else NOT_RECORDED,
                   "no_action": fmt(ds["no_action"][j]), "share": fmt(ds["share_of_all_terminations_pct"][j], 2, "%") if s["share_of_all_terminations_pct"][j] is not None else NOT_RECORDED},
            facts=facts, links=[{"url": src['page_url'], "label": f"Table C-4, FY{ctx.latest}"}, {"url": "/courts/analytics", "label": "Federal court analytics"}],
            text=f"{label} {category_text} nature of suit civil cases terminated action taken trial rate Judicial Business Table C-4", filters={"group": [category_text], "jurisdiction": [jur]},
            extra={"kind": "civil_nos", "jurisdiction": jur, "category": category, "label": label, "years": NOS_YEARS, "series": s, "dash": dash}))
    return rows, {"stable_keys": len(stable), "all_keys": len(keys), "excluded_repeated_labels": len(repeated)}


# ------------------------------------------------------------------ Judicial Facts and Figures
def jff_tables(ctx):
    by = {}
    for e in ctx.jff_index:
        if (e.get("path") or "").endswith(".xlsx") and e.get("status") == 200:
            by.setdefault(str(e["number"]), []).append(e)
    out = {}
    for number, entries in by.items():
        parsed = []
        for e in sorted(entries, key=lambda e: e["edition"]):
            sheet = F.read_sheet(ROOT / e["path"])
            if sheet:
                parsed.append((e["edition"], e, sheet))
        if parsed:
            out[number] = (parsed, F.merge_editions(parsed))
    return out


def jff_records(ctx):
    rows = []
    for number, (parsed, merged) in sorted(jff_tables(ctx).items(), key=lambda kv: tuple(int(x) for x in kv[0].split("."))):
        latest_entry = parsed[-1][1]
        title = re.sub(r"\s+", " ", latest_entry["title"]).strip()
        years = merged["years"]
        last_year = years[-1]
        first_col = merged["columns"][0]["label"]
        sources = [{"edition": ed, "url": e["url"], "page": e["page"], "path": e["path"], "sha256": e["sha256"]} for ed, e, _ in parsed]
        facts = [["Table", f"Judicial Facts and Figures Table {number}"], ["Title", title], ["Years", f"{years[0]}-{years[-1]} ({len(years)} years listed)"],
                 ["Columns", str(len(merged['columns']))], ["Editions merged", ", ".join(str(ed) for ed, _, _ in parsed)], ["Values revised between editions", str(len(merged["revisions"]))],
                 ["Latest year", f"{last_year}: " + "; ".join(f"{c['label']} {fmt(merged['values'][c['label']][-1], 2) if isinstance(merged['values'][c['label']][-1], float) and not float(merged['values'][c['label']][-1]).is_integer() else fmt(merged['values'][c['label']][-1])}" for c in merged["columns"][:3])],
                 ["Note", "Fiscal years end September 30 from 2013 (earlier years: see the table notes); each value comes from the latest edition that lists the year and keeps the address of its source cell."]]
        rows.append(cw.record(
            "court_jff_series", f"jff-{number.replace('.', '-')}", f"Table {number}: {title}", source_url=latest_entry["url"],
            subtitle=f"Judicial Facts and Figures · {years[0]}-{years[-1]} · {len(merged['columns'])} columns · {len(merged['revisions'])} revised values",
            cells={"table": number, "title": title, "years": f"{years[0]}-{years[-1]}", "latest": str(last_year), "columns": str(len(merged["columns"])), "revisions": str(len(merged["revisions"]))},
            facts=facts, links=[{"url": latest_entry['page'], "label": f"Table {number} (U.S. Courts)"}, {"url": "/courts/analytics", "label": "Federal court analytics"}],
            text=f"Judicial Facts and Figures table {number} {title} national federal courts statistics time series",
            filters={"chapter": [number.split(".")[0]]},
            extra={"kind": "jff_table", "table": number, "table_title": title, "columns": merged["columns"], "years": years, "values": merged["values"], "dash": merged["dash"], "footnote_marks": {k: {str(y): m for y, m in v.items()} for k, v in merged["marks"].items()}, "source_cells": {str(y): v for y, v in merged["cells"].items()},
                   "year_edition": {str(y): e for y, e in merged["year_edition"].items()}, "revisions": merged["revisions"][:200], "skipped_columns": merged["skipped"], "notes": merged["notes"][:12], "sources": sources}))
    return rows


# ------------------------------------------------------------------ catalog
def listings():
    chapter_names = {"1": "Judicial officers", "2": "Courts of appeals", "3": "Agency appeals", "4": "District courts - civil", "5": "District courts - criminal", "6": "District courts - combined", "7": "Bankruptcy courts"}
    return {
        "court_jb_districts": ("U.S. district courts - civil terminations by action taken, trials completed and MDL transfers (Judicial Business, FY2005-FY2025)",
                               cw.listing([("court", "Court"), ("circuit", "Circuit"), ("terminated", "Civil cases terminated"), ("trial_rate", "Trial rate"), ("trials", "Trials completed"),
                                           ("mdl_pending", "MDL actions pending"), ("share", "Share of national terminations")],
                                          [("circuit", "Circuit", {f"ca{n}": U.CIRCUIT_NAMES[f"ca{n}"] for n in range(1, 12)} | {"cadc": "D.C. Circuit"}), ("flagged", "Source total mismatch", {"yes": "Yes", "no": "No"})])),
        "court_jb_bankruptcy": ("U.S. bankruptcy courts - cases filed by chapter, business and nonbusiness (Judicial Business Table F-2, FY2005-FY2025)",
                                cw.listing([("court", "Court"), ("filed", "Cases filed"), ("ch7", "Chapter 7"), ("ch11", "Chapter 11"), ("ch13", "Chapter 13"), ("business", "Business filings"),
                                            ("business_share", "Business share"), ("share", "Share of national filings")], [])),
        "court_jb_circuits": ("Judicial Business - circuits and national totals: civil terminations, trials, MDL and bankruptcy filings (FY2005-FY2025)",
                              cw.listing([("circuit", "Circuit"), ("terminated", "Civil cases terminated"), ("trial_rate", "Trial rate"), ("trials", "Trials completed"), ("mdl_pending", "MDL actions pending"),
                                          ("bankruptcy", "Bankruptcy filings"), ("share", "Share of national terminations")], [("kind", "Kind", {"circuit": "Circuit", "national": "National total"})])),
        "court_jb_civil_nos": ("Federal civil cases terminated by nature of suit and action taken (Judicial Business Table C-4, FY2011-FY2025)",
                               cw.listing([("nos", "Nature of suit"), ("group", "Group"), ("jurisdiction", "Jurisdiction"), ("terminated", "Terminated"), ("trial_rate", "Trial rate"), ("no_action", "No court action"), ("share", "Share of all terminations")],
                                          [("jurisdiction", "Jurisdiction", {"us": "United States cases", "federal_question": "Federal question", "diversity": "Diversity of citizenship", "local": "Local jurisdiction"})])),
        "court_jff_series": ("Judicial Facts and Figures - federal courts statistical tables, merged across editions (1990-2025)",
                             cw.listing([("table", "Table"), ("title", "Title"), ("years", "Years"), ("latest", "Latest year"), ("columns", "Columns"), ("revisions", "Revised values")],
                                        [("chapter", "Chapter", chapter_names)])),
    }


def source_files(jb, tables):
    out = {}
    for t in tables:
        out[t] = {str(y): {"url": jb.source(t, y)["url"], "sha256": jb.source(t, y)["sha256"], "format": jb.source(t, y)["format"]} for y in jb.years(t)}
    return out


def build_summaries(ctx, counts, extras):
    jb = ctx.jb
    base = {"source": "U.S. Courts, Judicial Business of the United States Courts data tables and Judicial Facts and Figures, " + LISTING_PAGE,
            "fiscal_years": f"FY{YEARS[0]}-FY{ctx.latest} (12 months ending September 30)",
            "values": "Values are copied as published. A printed dash is shown as a dash and stored as no value (listed under dash); an unreadable or absent cell is Not recorded. Nothing is imputed.",
            "checks": "Every table is re-added (rows to circuits to total) when parsed; differences are kept in the record (unreconciled_years) and in REPORT.md, never corrected."}
    return {
        "court_jb_districts": {**base, "records": counts.get("court_jb_districts", 0), "tables": source_files(jb, ["C-4A", "T-1", "S-19"]), "failed_source_checks": {t: jb.failed_checks(t) for t in ("C-4A", "T-1", "S-19")},
                               "formulas": {"trial_rate_pct": "civil cases terminated during or after trial / civil cases terminated x 100 (Table C-4A)", "share_of_national_terminations_pct": "district terminations / sum of the 94 districts' terminations x 100 (the printed total row)",
                                            "mdl_pending_share_of_national_pct": "district MDL actions pending / printed national total x 100 (Table S-19)", "rank": "competition ranking; trial-rate rank only among districts with 500 or more terminations"}},
        "court_jb_bankruptcy": {**base, "records": counts.get("court_jb_bankruptcy", 0), "tables": source_files(jb, ["F-2"]), "failed_source_checks": {"F-2": jb.failed_checks("F-2")}, "unmapped_labels": extras.get("unmapped_bankruptcy", []),
                                "formulas": {"business_share_pct": "business filings / total filings x 100", "chapter_13_share_pct": "Chapter 13 filings / total filings x 100", "share_of_national_filings_pct": "court filings / printed national total x 100"},
                                "court_ids": "bankruptcy court id = district id with the final d replaced by b (court_spine), exceptions arb (Arizona) and nebraskab (Nebraska)"},
        "court_jb_circuits": {**base, "records": counts.get("court_jb_circuits", 0), "tables": source_files(jb, ["C-4A", "T-1", "S-19", "F-2", "C-4", "S-20"]),
                              "formulas": {"trial_rate_pct": "terminated during or after trial / civil cases terminated x 100", "dc_circuit": "the D.C. Circuit row is the District of Columbia district row (it is the circuit's only district)"}},
        "court_jb_civil_nos": {**base, "records": counts.get("court_jb_civil_nos", 0), "tables": source_files(jb, ["C-4"]), "nos_keys": extras.get("nos"),
                               "scope": "FY2011-FY2025 only: the nature-of-suit labels of Table C-4 form one stable scheme in those 15 years; the 2005-2010 editions use another and are not joined",
                               "formulas": {"trial_rate_pct": "terminated during or after trial / civil cases terminated x 100", "share_of_all_terminations_pct": "nature-of-suit terminations / printed Total Cases x 100"}},
        "court_jff_series": {**base, "records": counts.get("court_jff_series", 0), "scope": "year-row tables of Judicial Facts and Figures (xlsx editions 2014 and 2016-2025); tables whose rows are categories (4.2, 4.4, 4.9, 5.2, 5.3) are not included",
                             "merge_rule": "each year's value comes from the latest edition that lists it; earlier different values are kept as revisions; every figure keeps its source cell address"},
    }


def collect_inputs(ctx, datasets):
    seen = {}
    jb = ctx.jb
    wanted = {"court_jb_districts": ["C-4A", "T-1", "S-19"], "court_jb_bankruptcy": ["F-2"], "court_jb_circuits": ["C-4A", "T-1", "S-19", "F-2", "C-4", "S-20"], "court_jb_civil_nos": ["C-4"]}
    for ds in datasets:
        for t in wanted.get(ds, []):
            for y in jb.years(t):
                s = jb.source(t, y)
                seen[s["path"]] = {"url": s["url"], "path": s["path"], "sha256": s["sha256"], "retrieved_at": s["retrieved_at"]}
        if ds == "court_jff_series":
            for e in ctx.jff_index:
                if (e.get("path") or "").endswith(".xlsx") and e.get("status") == 200:
                    seen[e["path"]] = {"url": e["url"], "path": e["path"], "sha256": e["sha256"], "retrieved_at": e.get("retrieved_at") or ""}
    return [seen[k] for k in sorted(seen)]


def load_context():
    lk = BUILD / "lookups"
    spine = json.loads((lk / "court_spine_federal_courts.json").read_text())
    circuits = json.loads((lk / "court_spine_circuits.json").read_text())
    places = json.loads((lk / "places_states.json").read_text())
    jff_index = json.loads((ACQ / "jff_index.json").read_text())
    return Context(JB(), spine, circuits, places, jff_index)


def manifest_times():
    out = {}
    for line in (ACQ / "_manifest.jsonl").read_text().splitlines():
        if line.strip():
            e = json.loads(line)
            if e.get("path") and e.get("status") == 200:
                out[e["path"]] = e["retrieved_at"]
    return out


def main(argv):
    only = set(argv[argv.index("--only") + 1:]) if "--only" in argv else None
    ctx = load_context()
    extras = {}
    built = {}
    plan = ["court_jb_districts", "court_jb_bankruptcy", "court_jb_circuits", "court_jb_civil_nos", "court_jff_series"]
    for name in plan:
        if only and name not in only:
            continue
        if name == "court_jb_districts":
            built[name] = district_records(ctx)
        elif name == "court_jb_bankruptcy":
            built[name], extras["unmapped_bankruptcy"] = bankruptcy_records(ctx)
        elif name == "court_jb_circuits":
            built[name] = circuit_records(ctx)
        elif name == "court_jb_civil_nos":
            built[name], extras["nos"] = nos_records(ctx)
        else:
            built[name] = jff_records(ctx)
    counts = {k: len(v) for k, v in built.items()}
    labels = listings()
    summaries = build_summaries(ctx, counts, extras)
    times = manifest_times()
    for name, rows in built.items():
        inputs = collect_inputs(ctx, [name])
        for i in inputs:
            i["retrieved_at"] = i.get("retrieved_at") or times.get(i["path"], "")
        built_at = max(i["retrieved_at"] for i in inputs if i["retrieved_at"])
        label_text, listing_block = labels[name]
        out = BUILD / f"{name}.json"
        out.write_text(json.dumps({"dataset": name, "label": label_text, "listing_block": listing_block, "summary": summaries[name], "rows": rows, "built_at": built_at,
                                   "inputs": [{"url": i["url"], "path": i["path"], "sha256": i["sha256"]} for i in inputs]}, separators=(",", ":")))
        print(json.dumps({"dataset": name, "rows": len(rows), "file": str(out), "sha256": sha(rows)}))


if __name__ == "__main__":
    main(sys.argv[1:])
