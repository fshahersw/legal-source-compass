"""Build recall_patterns: problem themes, repeat-recall firms, multi-firm clusters, named suppliers and anomalous months across recalls.

Inputs (read-only extracts by extract.py): openFDA drug, device and food enforcement reports (the agency's fields as published),
CPSC Recall API records and NHTSA recall campaigns already in the corpus. Unit of analysis for FDA is the recall event (openFDA
event_id; one firm, one reason, one or more products); product rows are counted separately. CPSC counts recalls; NHTSA campaigns.

- Themes: this builder's keyword rules over the agency's reason text (FDA reason_for_recall), CPSC hazard categories (the stored
  keyword classification) and NHTSA component groups. Labelled as such; a recall may have several themes or none.
- Firms: the recalling firm (FDA), manufacturer (NHTSA) or manufacturer/importer/retailer as listed (CPSC), merged only by case,
  punctuation and corporate suffix.
- Clusters (foods): recall events by at least three different firms that cite the same pathogen or contaminant theme and the same
  commodity term and began within 90 days of the group's first event. This shows co-occurrence; a shared source is stated only
  where a reason names one.
- Suppliers: company names a reason text states as the supplier or as the firm whose recall prompted the recall, as written.
- Anomalies: months whose count is at least three times the trailing 24-month median, exceeds it by a minimum, and has a robust
  z-score of 4 or more; each is attributed to the firms and themes that make it up.

    python3 -I -B scripts/enrichment/recall_patterns/build_recall_patterns.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402
import recall_lib as lib  # noqa: E402

LOOK = os.path.join(ROOT, "private", "build", "recall_patterns", "lookups")
OUT = os.path.join(ROOT, "private", "build", "recall_patterns")
DATASET = "recall_patterns"
DOMAIN_LABEL = {"fda_drug": "FDA drugs", "fda_device": "FDA medical devices", "fda_food": "FDA foods, supplements and cosmetics",
                "cpsc": "CPSC consumer products", "nhtsa": "NHTSA vehicles and equipment"}
SOURCE_URL = {"fda_drug": "https://open.fda.gov/apis/drug/enforcement/", "fda_device": "https://open.fda.gov/apis/device/enforcement/",
              "fda_food": "https://open.fda.gov/apis/food/enforcement/", "cpsc": "https://www.cpsc.gov/Recalls",
              "nhtsa": "https://www.nhtsa.gov/recalls"}
SEVERITY = {"Class I": 1, "Class II": 2, "Class III": 3}
FIRM_MIN_EVENTS = 4
FIRMS_PER_DOMAIN = 80
SAMPLES = 8


def iso(value) -> str | None:
    if not isinstance(value, str):
        return None
    v = value.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", v):
        return v
    if re.match(r"^\d{8}$", v):
        return f"{v[:4]}-{v[4:6]}-{v[6:]}"
    return None


def days_between(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    da, db = date.fromisoformat(a), date.fromisoformat(b)
    return (db - da).days


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:60] + "-" + hashlib.sha1(text.encode()).hexdigest()[:6] if len(s) > 60 else s


def snippet(text: str | None, n=240) -> str:
    t = re.sub(r"\s+", " ", text or "").strip()
    return t if len(t) <= n else t[: n - 1].rsplit(" ", 1)[0] + "…"


def load(name):
    with open(os.path.join(LOOK, f"{name}.jsonl")) as h:
        return [json.loads(line) for line in h]


# ---------------------------------------------------------------- FDA events
def fda_events(domain: str) -> list[dict]:
    groups = defaultdict(list)
    for row in load(domain):
        f = row.get("f") or {}
        key = str(f.get("event_id") or f.get("recall_number") or row["id"])
        groups[key].append(f)
    events = []
    for eid, rows in groups.items():
        firm = next((r.get("recalling_firm") for r in rows if r.get("recalling_firm")), None) or "Not recorded"
        reasons = sorted({(r.get("reason_for_recall") or "").strip() for r in rows if (r.get("reason_for_recall") or "").strip()})
        reason_text = " ".join(reasons)
        reports = sorted(d for d in (iso(r.get("report_date")) for r in rows) if d)
        starts = sorted(d for d in (iso(r.get("recall_initiation_date")) for r in rows) if d)
        classified = sorted(d for d in (iso(r.get("center_classification_date")) for r in rows) if d)
        terminated = sorted(d for d in (iso(r.get("termination_date")) for r in rows) if d)
        classes = [r.get("classification") for r in rows if r.get("classification") in SEVERITY]
        products = [snippet(r.get("product_description"), 160) for r in rows if r.get("product_description")]
        dist = " ".join(sorted({(r.get("distribution_pattern") or "") for r in rows}))
        events.append({
            "id": eid, "domain": domain, "firm": firm, "firm_key": lib.firm_key(firm) or firm.lower(),
            "recall_numbers": sorted({r.get("recall_number") for r in rows if r.get("recall_number")}),
            "rows": len(rows), "reasons": reasons, "reason": snippet(reasons[0] if reasons else "", 400),
            "themes": lib.themes_for(domain, reason_text),
            "commodities": lib.commodities(reason_text + " " + " ".join(products)) if domain == "fda_food" else [],
            "suppliers": [s for r in reasons for s in lib.suppliers(r, firm)],
            "start": starts[0] if starts else (reports[0] if reports else None),
            "report": reports[0] if reports else None,
            "classified": classified[0] if classified else None,
            "terminated": terminated[-1] if terminated and len(terminated) == len(rows) else None,
            "classification": min(classes, key=lambda c: SEVERITY[c]) if classes else "Not recorded",
            "status": Counter(r.get("status") for r in rows).most_common(1)[0][0] or "Not recorded",
            "voluntary": Counter(r.get("voluntary_mandated") for r in rows).most_common(1)[0][0] or "Not recorded",
            "nationwide": bool(re.search(r"nationwide|nation wide|all states|throughout the (us|u\.s|united states)|worldwide|international", dist, re.I)),
            "state": next((r.get("state") for r in rows if r.get("state")), None),
            "country": next((r.get("country") for r in rows if r.get("country")), None),
            "products": sorted(set(products))[:6], "product_count": len({p.lower() for p in products}),
        })
    return events


# ---------------------------------------------------------------- CPSC / NHTSA events
CPSC_PLACE = re.compile(r",?\s+(?:of|in)\s+[A-Z][A-Za-z .'-]+(?:,\s*[A-Z][A-Za-z .'-]+)*\.?$")


def cpsc_firm(name: str) -> str:
    """CPSC writes firms with their home town ("Target Corp., of Minneapolis, Minn."); the place is dropped from the name."""
    s = re.sub(r"\s+", " ", name).strip()
    cut = CPSC_PLACE.sub("", s).strip(" ,")
    return cut if len(cut) >= 2 else s


def cpsc_events() -> list[dict]:
    out = []
    for row in load("cpsc"):
        r = row.get("r") or {}
        d = iso(r.get("date"))
        firms = []
        for role, key in (("manufacturer", "manufacturers"), ("importer", "importers"), ("distributor", "distributors"), ("retailer", "retailers")):
            for name in r.get(key) or []:
                if isinstance(name, str) and name.strip():
                    firms.append((role, cpsc_firm(name)))
        hazards = [h for h in (r.get("hazard_categories") or []) if isinstance(h, str)]
        out.append({
            "id": str(r.get("recall_number") or row["id"]), "domain": "cpsc", "title": r.get("title") or row.get("title"),
            "firms": firms, "firm": firms[0][1] if firms else "Not recorded", "firm_key": lib.firm_key(firms[0][1]) if firms else "",
            "themes": hazards or ["other"], "start": d, "report": d, "url": r.get("url"),
            "countries": [c for c in (r.get("countries") or []) if isinstance(c, str)],
            "product_types": sorted({p.get("type") for p in (r.get("products") or []) if isinstance(p, dict) and p.get("type")}),
            "death": bool(r.get("mentions_death")), "injury": bool(r.get("mentions_injury")), "units": r.get("units"),
            "reason": snippet(" ".join(h for h in (r.get("hazards") or []) if isinstance(h, str)) or r.get("title"), 240),
            "suppliers": [], "classification": None,
        })
    return out


def nhtsa_events() -> list[dict]:
    out = []
    for row in load("nhtsa"):
        item = row.get("i") or {}
        rec = item.get("recall") or {}
        cells = item.get("cells") or {}
        comps = [c for c in (rec.get("components") or []) if isinstance(c, str)]
        groups = sorted({c.split(":")[0].strip() for c in comps})
        mfr = cells.get("manufacturer") or rec.get("manufacturer") or "Not recorded"
        units = rec.get("potentially_affected")
        try:
            units = int(str(units).replace(",", "")) if units not in (None, "") else None
        except ValueError:
            units = None
        defect = rec.get("defect") or ""
        out.append({
            "id": str(rec.get("campaign") or row["id"]), "domain": "nhtsa", "firm": mfr, "firm_key": lib.firm_key(mfr),
            "themes": groups or ["NOT RECORDED"], "start": iso(rec.get("report_date") or cells.get("date")),
            "report": iso(rec.get("report_date") or cells.get("date")), "units": units, "type": rec.get("type") or cells.get("type"),
            "reason": snippet(defect, 300), "consequence": snippet(rec.get("consequence"), 200),
            "suppliers": lib.suppliers(defect, mfr), "classification": None,
            "influenced_by": rec.get("influenced_by"),
        })
    return out


def theme_label(domain: str, tid: str) -> str:
    if domain == "cpsc":
        return lib.CPSC_LABELS.get(tid, tid.replace("_", " ").capitalize())
    if domain == "nhtsa":
        return lib.NHTSA_GROUPS.get(tid, tid.title())
    return lib.theme_label(domain, tid)


def year_series(events, key=lambda e: e.get("report")) -> dict[str, int]:
    c = Counter((key(e) or "")[:4] for e in events if key(e))
    return dict(sorted(c.items()))


def growth(series: dict[str, int], last_full: int) -> dict | None:
    recent = sum(series.get(str(y), 0) for y in range(last_full - 2, last_full + 1))
    prior = sum(series.get(str(y), 0) for y in range(last_full - 5, last_full - 2))
    if recent + prior < 10:
        return None
    return {"recent_years": f"{last_full - 2}–{last_full}", "recent": recent, "prior_years": f"{last_full - 5}–{last_full - 3}",
            "prior": prior, "change_pct": None if prior == 0 else round(100 * (recent - prior) / prior, 1)}


def sample(events, n=SAMPLES):
    out = []
    for e in sorted(events, key=lambda e: (e.get("report") or "", e["id"]), reverse=True)[:n]:
        out.append({"id": e["id"], "firm": e.get("firm"), "date": e.get("report"), "classification": e.get("classification"),
                    "recall_numbers": (e.get("recall_numbers") or [])[:4], "reason": e.get("reason"), "url": e.get("url")})
    return out


MEASURES = {
    # measure: (label, weight, ratio, robust z, minimum excess over the trailing median)
    "recalls": ("Recalls (events)", lambda e: 1, 1.8, 3.0, 12),
    "product_rows": ("Products recalled (rows)", lambda e: e.get("rows", 1), 3.0, 4.0, 100),
    "units": ("Units potentially affected", lambda e: e.get("units") or 0, 5.0, 5.0, 500_000),
}


def monthly(events, weight=lambda e: 1) -> tuple[dict[str, int], list[str]]:
    series: Counter = Counter()
    for e in events:
        m = lib.month(e.get("report"))
        if m:
            series[m] += weight(e)
    if not series:
        return {}, []
    months = lib.month_range(min(series), max(series))
    return dict(series), months


def attribute(events, month_id, domain, weight=lambda e: 1):
    inside = [e for e in events if lib.month(e.get("report")) == month_id]
    total = sum(weight(e) for e in inside)
    firms: Counter = Counter()
    for e in inside:
        firms[e.get("firm")] += weight(e)
    themes = Counter(t for e in inside for t in e.get("themes", []))
    top_n = firms.most_common(1)[0][1] if firms else 0
    share = top_n / total if total else 0
    return {"firms": len(firms), "top_firms": [{"firm": f, "amount": n} for f, n in firms.most_common(5)],
            "top_firm_share": round(100 * share, 1) if total else None,
            "top_themes": [{"theme": t, "label": theme_label(domain, t), "events": n} for t, n in themes.most_common(4)],
            "pattern": "one firm" if share >= 0.6 else "several firms" if len(firms) >= 5 else "few firms"}


def find_anomalies(events, domain, measures=("recalls",), *, theme_level=False):
    out = []
    for measure in measures:
        label, weight, ratio, z_min, min_excess = MEASURES[measure]
        if theme_level and measure == "recalls":
            ratio, z_min, min_excess = 3.0, 4.0, 8
        series, months = monthly(events, weight)
        flags = lib.anomalies(series, months, ratio=ratio, z_min=z_min, min_excess=min_excess) if months else []
        out += [{**f, "measure": measure, "measure_label": label, **attribute(events, f["month"], domain, weight)} for f in flags]
    return sorted(out, key=lambda a: (a["month"], a["measure"]))


# ---------------------------------------------------------------- record builders
def record(rid, title, domain, kind, *, subtitle, cells, facts, profile, text, links=(), state=""):
    return writer.record(
        DATASET, rid, title, source_url=SOURCE_URL.get(domain, SOURCE_URL["fda_food"]), subtitle=subtitle, cells=cells,
        facts=[[k, lib_nr(v)] for k, v in facts], text=text, filters={"kind": [kind], "domain": [domain]},
        badges=[DOMAIN_LABEL.get(domain, domain), kind.capitalize()], links=list(links), state=state,
        extra={"profile": {"kind": kind, "domain": domain, "domain_label": DOMAIN_LABEL.get(domain, domain), **profile}})


def lib_nr(v):
    return "Not recorded" if v in (None, "", []) else str(v)


def build_domain(domain, events, last_full):
    rows = []
    n_events = len(events)
    themed = defaultdict(list)
    for e in events:
        for t in e["themes"]:
            themed[t].append(e)
    measures = ("recalls", "product_rows") if domain.startswith("fda") else ("recalls", "units") if domain == "nhtsa" else ("recalls",)
    anomalies = find_anomalies(events, domain, measures)
    years = year_series(events)
    classes = Counter(e.get("classification") for e in events if e.get("classification"))
    class1_by_year = year_series([e for e in events if e.get("classification") == "Class I"])
    to_class = defaultdict(list)
    durations = []
    for e in events:
        d = days_between(e.get("start"), e.get("classified"))
        if d is not None and 0 <= d <= 3650:
            to_class[(e.get("report") or "")[:4]].append(d)
        t = days_between(e.get("start"), e.get("terminated"))
        if t is not None and 0 <= t <= 7300:
            durations.append(t)
    firm_events = defaultdict(list)
    if domain == "cpsc":
        for e in events:
            for role, name in e["firms"]:
                firm_events[(lib.firm_key(name), role)].append((name, e))
    else:
        for e in events:
            firm_events[(e["firm_key"], None)].append((e["firm"], e))
    theme_rank = sorted(themed, key=lambda t: -len(themed[t]))
    theme_summ = []
    for t in theme_rank:
        ys = year_series(themed[t])
        theme_summ.append({"theme": t, "label": theme_label(domain, t), "events": len(themed[t]),
                           "firms": len({e["firm_key"] for e in themed[t]}), "growth": growth(ys, last_full),
                           "class1_share": round(100 * sum(e.get("classification") == "Class I" for e in themed[t]) / len(themed[t]), 1)
                           if domain.startswith("fda") else None})
    rising = sorted([s for s in theme_summ if s["growth"] and s["growth"]["change_pct"] is not None and s["growth"]["recent"] >= 15],
                    key=lambda s: -s["growth"]["change_pct"])[:6]
    top_firms = sorted(firm_events.items(), key=lambda kv: -len({e["id"] for _, e in kv[1]}))[:10]
    overview = {
        "events": n_events, "product_rows": sum(e.get("rows", 1) for e in events), "firms": len({k for k, _ in firm_events}),
        "first": min((e["report"] for e in events if e.get("report")), default=None),
        "last": max((e["report"] for e in events if e.get("report")), default=None),
        "by_year": years, "class_mix": dict(classes), "class1_by_year": class1_by_year,
        "median_days_to_classification_by_year": {y: statistics.median(v) for y, v in sorted(to_class.items()) if y and len(v) >= 10},
        "median_days_to_termination": statistics.median(durations) if durations else None, "terminated_events": len(durations),
        "nationwide_share": round(100 * sum(e.get("nationwide", False) for e in events) / n_events, 1) if domain.startswith("fda") else None,
        "voluntary_mix": dict(Counter(e.get("voluntary") for e in events if e.get("voluntary"))) if domain.startswith("fda") else None,
        "themes": theme_summ, "rising_themes": rising, "anomalies": anomalies,
        "untagged_events": sum(1 for e in events if not e["themes"]),
        "top_firms": [{"firm": Counter(n for n, _ in v).most_common(1)[0][0], "role": k[1], "events": len({e["id"] for _, e in v}),
                       "id": f"{domain}:firm:{slug(k[0] + (k[1] or ''))}"} for k, v in top_firms],
        "last_full_year": last_full,
    }
    if domain == "cpsc":
        country_year = defaultdict(Counter)
        for e in events:
            for c in set(e["countries"]):
                country_year[(e["report"] or "")[:4]][c] += 1
        overview["countries"] = dict(Counter(c for e in events for c in set(e["countries"])).most_common(12))
        overview["china_share_by_year"] = {y: round(100 * c.get("China", 0) / max(1, sum(1 for e in events if (e["report"] or "")[:4] == y)), 1)
                                           for y, c in sorted(country_year.items()) if y}
        overview["death_mentions"] = sum(e["death"] for e in events)
        overview["product_types"] = dict(Counter(p for e in events for p in e["product_types"]).most_common(15))
    if domain == "nhtsa":
        overview["units_by_year"] = {y: sum(e["units"] or 0 for e in events if (e["report"] or "")[:4] == y) for y in years}
        overview["types"] = dict(Counter(e.get("type") for e in events if e.get("type")))
    rows.append(record(f"{domain}:overview", f"{DOMAIN_LABEL[domain]}: recall patterns", domain, "overview",
                       subtitle=f"{n_events:,} recalls · {len(theme_summ)} themes · {len(anomalies)} anomalous months",
                       cells={"domain": DOMAIN_LABEL[domain], "kind": "overview", "events": n_events, "themes": len(theme_summ), "anomalies": len(anomalies)},
                       facts=[("Recalls", n_events), ("First report", overview["first"]), ("Latest report", overview["last"]),
                              ("Anomalous months", len(anomalies)), ("Recalls with no keyword theme", overview["untagged_events"]),
                              ("Method", __doc__.split("\n\n")[1].strip())],
                       profile=overview, text=f"{DOMAIN_LABEL[domain]} recall patterns overview"))
    # themes
    for s in theme_summ:
        t = s["theme"]
        evs = themed[t]
        firms = Counter(e["firm"] for e in evs)
        comm = Counter(c for e in evs for c in e.get("commodities", []))
        profile = {**s, "by_year": year_series(evs), "class_mix": dict(Counter(e.get("classification") for e in evs if e.get("classification"))),
                   "top_firms": [{"firm": f, "events": n} for f, n in firms.most_common(12)], "commodities": dict(comm.most_common(12)),
                   "first": min((e["report"] for e in evs if e.get("report")), default=None),
                   "last": max((e["report"] for e in evs if e.get("report")), default=None),
                   "anomalies": find_anomalies(evs, domain, theme_level=True), "recent": sample(evs),
                   "product_types": dict(Counter(p for e in evs for p in e.get("product_types", [])).most_common(10)) if domain == "cpsc" else None,
                   "units": sum(e.get("units") or 0 for e in evs) if domain == "nhtsa" else None}
        rows.append(record(f"{domain}:theme:{slug(t)}", f"{DOMAIN_LABEL[domain]}: {s['label']}", domain, "theme",
                           subtitle=f"{s['events']:,} recalls by {s['firms']:,} firms",
                           cells={"domain": DOMAIN_LABEL[domain], "kind": "theme", "theme": s["label"], "events": s["events"], "firms": s["firms"]},
                           facts=[("Theme", s["label"]), ("Recalls", s["events"]), ("Firms", s["firms"]), ("First", profile["first"]), ("Latest", profile["last"]),
                                  ("Classification", "Keyword rule of this builder over the agency's reason text, not an agency category")],
                           profile=profile, text=f"{s['label']} recalls " + " ".join(f for f, _ in firms.most_common(20))))
    # firms
    ranked = sorted(firm_events.items(), key=lambda kv: -len({e["id"] for _, e in kv[1]}))
    kept = [kv for kv in ranked if len({e["id"] for _, e in kv[1]}) >= FIRM_MIN_EVENTS][:FIRMS_PER_DOMAIN]
    for (fkey, role), pairs in kept:
        evs = list({e["id"]: e for _, e in pairs}.values())
        names = Counter(n for n, _ in pairs)
        name = names.most_common(1)[0][0]
        dates = sorted(e["report"] for e in evs if e.get("report"))
        gaps = [days_between(a, b) for a, b in zip(dates, dates[1:])]
        themes = Counter(t for e in evs for t in e["themes"])
        repeat = [{"theme": t, "label": theme_label(domain, t), "events": n} for t, n in themes.most_common() if n >= 3]
        profile = {"firm": name, "firm_key": fkey, "role": role, "spellings": [n for n, _ in names.most_common(6)], "events": len(evs),
                   "product_rows": sum(e.get("rows", 1) for e in evs), "distinct_products": sum(e.get("product_count", 0) for e in evs) or None,
                   "by_year": year_series(evs), "themes": [{"theme": t, "label": theme_label(domain, t), "events": n} for t, n in themes.most_common(10)],
                   "repeat_themes": repeat, "class_mix": dict(Counter(e.get("classification") for e in evs if e.get("classification"))),
                   "first": dates[0] if dates else None, "last": dates[-1] if dates else None,
                   "median_gap_days": statistics.median(gaps) if gaps else None, "recent": sample(evs),
                   "states": dict(Counter(e.get("state") for e in evs if e.get("state")).most_common(5)) if domain.startswith("fda") else None,
                   "units": sum(e.get("units") or 0 for e in evs) if domain == "nhtsa" else None,
                   "suppliers_named": sorted({s for e in evs for s in e.get("suppliers", [])})[:10]}
        rid = f"{domain}:firm:{slug(fkey + (role or ''))}"
        rows.append(record(rid, f"{name}: recall history ({DOMAIN_LABEL[domain]})", domain, "firm",
                           subtitle=f"{len(evs):,} recalls {profile['first'][:4] if profile['first'] else ''}–{profile['last'][:4] if profile['last'] else ''}"
                                    + (f" · repeated theme: {repeat[0]['label']}" if repeat else ""),
                           cells={"domain": DOMAIN_LABEL[domain], "kind": "firm", "firm": name, "role": role, "events": len(evs), "themes": len(themes)},
                           facts=[("Firm", name), ("Role", role), ("Recalls", len(evs)), ("Spellings merged", "; ".join(profile["spellings"])),
                                  ("First", profile["first"]), ("Latest", profile["last"]),
                                  ("Merging", "Names merged only by case, punctuation and corporate suffix; related companies are not merged")],
                           profile=profile, text=f"{name} recalls " + " ".join(profile["spellings"])))
    return rows


def build_clusters(domain, events):
    rows = []
    groups = lib.clusters([e for e in events if e["themes"] and e.get("commodities")], days=90, min_firms=3)
    for t, c, g in groups[:80]:
        firms = Counter(e["firm"] for e in g)
        sups = Counter(s for e in g for s in e.get("suppliers", []))
        span = days_between(g[0]["start"], g[-1]["start"])
        profile = {"theme": t, "theme_label": theme_label(domain, t), "commodity": c, "firms": len(firms), "events": len(g),
                   "product_rows": sum(e.get("rows", 1) for e in g), "start": g[0]["start"], "end": g[-1]["start"], "span_days": span,
                   "class1_events": sum(e.get("classification") == "Class I" for e in g),
                   "suppliers_named": [{"supplier": s, "events": n} for s, n in sups.most_common(6)],
                   "members": [{"id": e["id"], "firm": e["firm"], "start": e["start"], "classification": e.get("classification"),
                                "recall_numbers": e.get("recall_numbers", [])[:3], "reason": snippet(e.get("reason"), 200)} for e in g[:60]],
                   "members_total": len(g),
                   "reading": "Recalls by different firms citing the same hazard and commodity, begun within 90 days of the first. "
                              "A shared source is established only where a reason text names one (listed under suppliers named)."}
        rows.append(record(f"{domain}:cluster:{g[0]['start']}-{slug(t + '-' + c)}", f"{theme_label(domain, t)} · {c}: {len(firms)} firms from {g[0]['start']}",
                           domain, "cluster", subtitle=f"{len(g)} recalls by {len(firms)} firms over {span} days" + (f" · supplier named: {sups.most_common(1)[0][0]}" if sups else ""),
                           cells={"domain": DOMAIN_LABEL[domain], "kind": "cluster", "theme": theme_label(domain, t), "commodity": c, "firms": len(firms), "events": len(g), "start": g[0]["start"]},
                           facts=[("Hazard theme", theme_label(domain, t)), ("Commodity term", c), ("Firms", len(firms)), ("Recalls", len(g)),
                                  ("Began", g[0]["start"]), ("Last began", g[-1]["start"]), ("Reading", profile["reading"])],
                           profile=profile, text=f"{c} {theme_label(domain, t)} " + " ".join(firms)))
    return rows, len(groups)


def build_suppliers(all_events):
    rows = []
    by_key = defaultdict(list)
    for e in all_events:
        for s in e.get("suppliers", []):
            by_key[lib.firm_key(s)].append((s, e))
    for key, pairs in sorted(by_key.items()):
        evs = list({(e["domain"], e["id"]): e for _, e in pairs}.values())
        firms = Counter(e["firm"] for e in evs)
        if len(firms) < 2 and len(evs) < 3:
            continue
        name = Counter(s for s, _ in pairs).most_common(1)[0][0]
        dates = sorted(e["report"] for e in evs if e.get("report"))
        domains = sorted({e["domain"] for e in evs})
        profile = {"supplier": name, "spellings": [s for s, _ in Counter(s for s, _ in pairs).most_common(5)], "recalling_firms": len(firms),
                   "events": len(evs), "domains": [DOMAIN_LABEL[d] for d in domains], "first": dates[0] if dates else None, "last": dates[-1] if dates else None,
                   "firms": [{"firm": f, "events": n} for f, n in firms.most_common(30)],
                   "members": [{"id": e["id"], "domain": DOMAIN_LABEL[e["domain"]], "firm": e["firm"], "date": e.get("report"), "classification": e.get("classification"),
                                "recall_numbers": e.get("recall_numbers", [])[:3], "reason": snippet(e.get("reason"), 240)}
                               for e in sorted(evs, key=lambda e: e.get("report") or "")[:60]],
                   "reading": "The supplier name is quoted from the recall reason text, where the recalling firm states it as its supplier or as the firm whose recall prompted its own."}
        rows.append(record(f"supplier:{slug(key)}", f"{name}: named as supplier in {len(evs)} recalls", domains[0], "supplier",
                           subtitle=f"{len(firms)} recalling firms · {dates[0][:4] if dates else ''}–{dates[-1][:4] if dates else ''}",
                           cells={"domain": ", ".join(DOMAIN_LABEL[d] for d in domains), "kind": "supplier", "supplier": name, "firms": len(firms), "events": len(evs)},
                           facts=[("Supplier as written", name), ("Recalling firms", len(firms)), ("Recalls", len(evs)), ("Reading", profile["reading"])],
                           profile=profile, text=f"{name} supplier " + " ".join(firms)))
    return rows


def main():
    t0 = time.time()
    domains = {d: fda_events(d) for d in ("fda_drug", "fda_device", "fda_food")}
    domains["cpsc"] = cpsc_events()
    domains["nhtsa"] = nhtsa_events()
    last_full = int(time.strftime("%Y")) - 1
    rows, counts = [], {}
    for domain, events in domains.items():
        part = build_domain(domain, events, last_full)
        cluster_rows, n_groups = build_clusters(domain, events) if domain == "fda_food" else ([], 0)
        rows += part + cluster_rows
        counts[domain] = {"events": len(events), "records": len(part) + len(cluster_rows), "clusters_found": n_groups}
    supplier_rows = build_suppliers([e for evs in domains.values() for e in evs])
    rows += supplier_rows
    counts["suppliers"] = len(supplier_rows)
    manifest = json.load(open(os.path.join(LOOK, "_manifest.json")))
    spec = {"dataset": DATASET, "label": "Recall patterns: themes, repeat firms, clusters, named suppliers and anomalous months", "rows": rows,
            "listing_block": writer.listing([("domain", "Domain"), ("kind", "Kind"), ("events", "Recalls"), ("firms", "Firms")],
                                            [("kind", "Kind", {"overview": "Overview", "theme": "Theme", "firm": "Firm", "cluster": "Cluster", "supplier": "Supplier"}),
                                             ("domain", "Domain", DOMAIN_LABEL)]),
            "summary": {"source": "openFDA enforcement reports (drug, device, food), CPSC Recall API and NHTSA recall campaigns as published in the corpus",
                        "method": __doc__.split("\n\n")[1].strip(), "coverage": counts, "totals": {"records": len(rows)}},
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "inputs": [{"url": f"corpus:{v['dataset']}", "path": f"private/build/recall_patterns/lookups/{k}.jsonl", "sha256": v["sha256"]} for k, v in manifest.items()]}
    path = os.path.join(OUT, "recall_patterns.json")
    with open(path + ".tmp", "w") as h:
        json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
    os.replace(path + ".tmp", path)
    print(DATASET, len(rows), "rows", os.path.getsize(path) // 1024, "KB", json.dumps(counts), f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
