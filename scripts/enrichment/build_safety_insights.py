"""Automated safety intelligence: deterministic trend and anomaly detectors over the published safety datasets.

Every insight is computed from records already in the corpus and carries the record ids it rests on, the
windows and baselines it compared, and the method used, so each flag can be traced back to its evidence.

Detectors
  firm_cluster      FDA drug/device/food recall events by firm, last 180 days vs the firm's prior 3-year rate
  hazard_surge      FDA recall reasons and CPSC hazards grouped into themes, last 12 months vs prior 3 years
  class_i_spike     FDA Class I (most serious) recall events per center, last 90 days vs prior 2 years
  complaint_accel   NHTSA complaints by make and component, latest year vs the prior year (annualized)
  recall_surge      NHTSA recall campaigns by manufacturer, last 12 months vs prior 3 years
  open_probe        NHTSA open investigations opened in the last 24 months on a make with rising complaints
  litigation        Products-liability MDL growth next to the product's adverse-event or complaint trend
  shortage_wave     FDA drug shortage postings in the last 90 days by firm
  crl_cluster       FDA complete response letters in the last 12 months vs prior 3 years
  warning_theme     FDA warning letter subjects grouped into themes, last 12 months vs prior 3 years

Usage: python build_safety_insights.py [--cache=DIR] [--dry-run]
  --cache=DIR reads <DIR>/<dataset>.json snapshots instead of the live corpus (offline runs and tests).
"""
import collections
import datetime as dt
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import corpus_writer as writer  # noqa: E402

DATASET = "agency_safety_insights"
FDA_SELECT = "id,title,filters,snippet:item->>snippet,firm:item->>firm,cls:item->>classification,dates:item->dates,status:item->>status"
SOURCES = {
    "agency_safety_openfda_drug_enforcement": FDA_SELECT,
    "agency_safety_openfda_device_enforcement": FDA_SELECT,
    "agency_safety_openfda_food_enforcement": FDA_SELECT,
    "agency_safety_fda_warning_letters": FDA_SELECT,
    "agency_safety_cpsc_recalls_local": FDA_SELECT,
    "agency_safety_openfda_drug_shortages": FDA_SELECT,
    "agency_safety_openfda_crl": FDA_SELECT,
    "agency_safety_nhtsa_recalls": "id,title,item",
    "agency_safety_nhtsa_investigations": "id,title,item",
    "agency_safety_nhtsa_complaint_trends": "id,title,item",
    "agency_safety_mass_tort_signals": "id,title,item",
    # Cross-dataset sources (absent datasets are skipped).
    "court_stats_national": "id,summary:item->summary",
    "company_sec_profiles": "id,summary:item->summary",
    "regulatory_epa_state_profiles": "id,profile:item->profile",
    "regulatory_federal_register_activity": "id,activity:item->activity",
}
CENTER = {
    "agency_safety_openfda_drug_enforcement": "Drugs",
    "agency_safety_openfda_device_enforcement": "Devices",
    "agency_safety_openfda_food_enforcement": "Food",
}

FDA_THEMES = {
    "Listeria": r"listeria",
    "Salmonella": r"salmonell",
    "E. coli": r"\be\.?\s?coli\b|stec\b|o157",
    "Undeclared allergen": r"undeclared|allergen|peanut|tree nut|milk|soy|sesame|wheat|egg\b",
    "Foreign material": r"foreign (?:object|material|matter)|metal (?:fragment|piece)|plastic (?:fragment|piece)|glass",
    "Microbial / sterility": r"steril|microbial|contaminat|bacteria|fung|mold|yeast|endotoxin",
    "CGMP deviations": r"cgmp|good manufacturing|gmp deviation",
    "Potency / dissolution": r"subpotent|superpotent|potency|dissolution|assay|out of specification|oos\b",
    "Nitrosamine / benzene": r"nitrosamine|ndma|ndea|nitroso|benzene",
    "Labeling / mix-up": r"label|mislabel|mix[- ]?up|wrong (?:drug|product|strength)",
    "Software / firmware": r"software|firmware|algorithm|cyber",
    "Device failure": r"fail|malfunction|crack|break|fractur|leak|occlu|detach|disconnect|short circuit|overheat",
    "Lead / heavy metals": r"\blead\b|arsenic|cadmium|mercury|heavy metal",
}
CPSC_THEMES = {
    "Fire / burn": r"fire|burn|overheat|flame|thermal",
    "Tip-over": r"tip[- ]?over|tipover|furniture instability",
    "Choking": r"chok|aspirat|small part",
    "Battery / magnet ingestion": r"button batter|coin batter|magnet|ingest",
    "Drowning": r"drown",
    "Mandatory-standard violation": r"violat\w* (?:the )?(?:federal )?mandatory|violates? .{0,40}(?:standard|ban)",
    "Online marketplace sellers": r"sold (?:exclusively )?(?:on|at|by) .{0,40}(?:amazon|temu|aliexpress|shein|walmart\.com|ebay|tiktok)",
    "Fall / collapse": r"fall hazard|falls?\b|collapse",
    "Strangulation": r"strangul|entangle|cord",
    "Laceration": r"lacerat|cut hazard|sharp",
    "Carbon monoxide": r"carbon monoxide|\bco poisoning",
    "Lead / chemical": r"\blead\b|phthalate|chemical|poison",
    "Electrical shock": r"shock|electrocut",
    "Infant sleep": r"infant|sleeper|bassinet|crib|inclined",
}
# Reported deaths, not the "risk of serious injury or death" boilerplate in CPSC hazard statements.
DEATH = re.compile(
    r"\b(?:died|deaths? (?:have been |were |was )?reported|reports? of (?:\w+ )?deaths?|\d+ deaths?"
    r"|(?:one|two|three|four|five|six|seven|eight|nine|ten) deaths?|death of|fatalit(?:y|ies)|fatal (?:incident|injur))",
    re.I,
)

WARNING_THEMES = {
    "CGMP / adulteration": r"cgmp|adulterat|good manufacturing",
    "Unapproved new drug": r"unapproved|new drug|misbranded",
    "Tobacco / vapor": r"tobacco|vape|vapor|e-liquid|nicotine",
    "Compounding": r"compound|outsourcing|503",
    "Medical device QS": r"quality system|medical device|510\(k\)|premarket",
    "Food safety / HACCP": r"haccp|seafood|juice|food|fsvp|sanitary",
    "Clinical research": r"clinical investigat|bioresearch|irb|sponsor",
    "Online / marketing claims": r"internet|online|covid|claims|cbd|kratom",
}


def parse_date(value):
    if not value or not isinstance(value, str):
        return None
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", value)
    if not match:
        return None
    try:
        return dt.date(int(match[1]), int(match[2]), int(match[3]))
    except ValueError:
        return None


def poisson_surprise(observed, expected):
    """-log10 P(X >= observed) for X ~ Poisson(expected); a larger value is a less likely count."""
    if observed <= 0:
        return 0.0
    lam = max(expected, 0.25)
    if observed <= lam:
        return 0.0
    log_terms = [-lam + k * math.log(lam) - math.lgamma(k + 1) for k in range(observed, observed + 400)]
    peak = max(log_terms)
    log_tail = peak + math.log(sum(math.exp(t - peak) for t in log_terms))
    return min(-log_tail / math.log(10), 50.0)


def severity_of(score, serious):
    if score >= 70 or (serious and score >= 50):
        return "high"
    if score >= 40:
        return "elevated"
    return "watch"


def monthly(dates, end, months=24):
    counts = collections.Counter((d.year, d.month) for d in dates if d)
    out, year, month = [], end.year, end.month
    keys = []
    for _ in range(months):
        keys.append((year, month))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    for year, month in reversed(keys):
        out.append({"period": f"{year:04d}-{month:02d}", "count": counts.get((year, month), 0)})
    return out


def yearly_series(years):
    return [{"period": str(year), "count": int(count)} for year, count in sorted(years.items())]


def evidence(dataset, rows, limit=8):
    seen, out = set(), []
    for row in rows:
        if row["id"] in seen:
            continue
        seen.add(row["id"])
        out.append({"dataset": dataset, "id": row["id"], "title": (row.get("title") or "")[:180], "date": row.get("date") or None, "note": (row.get("note") or "")[:200] or None})
        if len(out) >= limit:
            break
    return out


SMALL = {"of", "and", "the", "for", "to", "in", "on", "at", "or", "due", "a", "an", "with", "by", "after", "post"}
COMMON3 = {"air", "bag", "oil", "gas", "fan", "cap", "hub", "arm", "car", "low", "may", "not", "all", "lap", "top", "end", "rim", "sun", "box", "kit"}


def headline_case(text):
    """Title-case an all-caps NHTSA subject while keeping short acronyms (FSD, AEB, DTN) intact."""
    words = []
    for i, word in enumerate((text or "").split()):
        lower = word.lower()
        if i and lower in SMALL:
            words.append(lower)
        elif len(word) <= 3 and word.isupper() and lower not in COMMON3:
            words.append(word)
        else:
            words.append(word[:1].upper() + word[1:].lower())
    return " ".join(words)


def slug(*parts):
    return re.sub(r"[^a-z0-9]+", "-", "-".join(str(p) for p in parts).lower()).strip("-")[:120]


class Builder:
    def __init__(self, data):
        self.data = data
        self.insights = []

    def add(self, *, kind, agency, entity, headline, summary, score, serious, metric, series, evidence_rows, method, as_of, tags=()):
        score = round(100 * (1 - math.exp(-max(score, 0.0) / 70)), 1)
        self.insights.append({
            "id": slug(kind, agency, entity),
            "kind": kind,
            "agency": agency,
            "entity": entity,
            "headline": headline,
            "summary": summary,
            "score": score,
            "severity": severity_of(score, serious),
            "serious": bool(serious),
            "metric": metric,
            "series": series,
            "evidence": evidence_rows,
            "method": method,
            "as_of": as_of.isoformat(),
            "tags": list(tags),
        })

    # FDA enforcement --------------------------------------------------------------------------------------------
    def fda_events(self, dataset):
        """Collapse product-level enforcement rows into recall events (same firm, initiation date and reason)."""
        events = {}
        for row in self.data.get(dataset, []):
            dates = row.get("dates") or {}
            when = parse_date(dates.get("report_date")) or parse_date((row.get("filters") or {}).get("sort_date"))
            if not when:
                continue
            firm = (row.get("filters") or {}).get("firm_norm") or (row.get("firm") or "").upper()
            reason = (row.get("snippet") or "").strip()
            key = (firm, dates.get("recall_initiation_date") or when.isoformat(), reason[:80].lower())
            event = events.setdefault(key, {"firm": row.get("firm") or firm.title(), "firm_norm": firm, "date": when, "reason": reason, "class": row.get("cls") or "", "rows": []})
            event["rows"].append({"id": row["id"], "title": row.get("title"), "date": when.isoformat(), "note": reason})
            if (row.get("cls") or "") == "Class I":
                event["class"] = "Class I"
        return list(events.values())

    def fda(self):
        for dataset, center in CENTER.items():
            events = self.fda_events(dataset)
            if not events:
                continue
            end = max(e["date"] for e in events)
            self.firm_clusters(dataset, center, events, end)
            self.class_i(dataset, center, events, end)
            self.themes(dataset, f"FDA {center.lower()}", events, end, FDA_THEMES, lambda e: e["reason"], agency="FDA")

    def firm_clusters(self, dataset, center, events, end):
        recent_start = end - dt.timedelta(days=180)
        base_start = recent_start - dt.timedelta(days=3 * 365)
        by_firm = collections.defaultdict(list)
        for event in events:
            if event["firm_norm"]:
                by_firm[event["firm_norm"]].append(event)
        for firm, items in by_firm.items():
            recent = [e for e in items if e["date"] > recent_start]
            if len(recent) < 4:
                continue
            baseline = [e for e in items if base_start < e["date"] <= recent_start]
            expected = len(baseline) / (3 * 365 / 180)
            surprise = poisson_surprise(len(recent), expected)
            class_i = sum(1 for e in recent if e["class"] == "Class I")
            score = surprise * 6 + class_i * 4 + min(len(recent), 20)
            if surprise < 2:
                continue
            name = recent[-1]["firm"] or firm.title()
            ratio = round(len(recent) / expected, 1) if expected else None
            reasons = collections.Counter(e["reason"][:90] for e in recent if e["reason"]).most_common(3)
            rows = [r for e in sorted(recent, key=lambda e: (e["class"] != "Class I", -e["date"].toordinal())) for r in e["rows"][:1]]
            self.add(
                kind="firm_cluster", agency="FDA", entity=name,
                headline=f"{name}: {len(recent)} {center.lower()} recall events in 180 days",
                summary=(f"{len(recent)} recall events since {recent_start.isoformat()} against an expected {expected:.1f} from the prior three years"
                         + (f"; {class_i} Class I" if class_i else "") + (f". Most common reason: {reasons[0][0]}" if reasons else "") + "."),
                score=score, serious=class_i > 0,
                metric={"recent": len(recent), "baseline": round(expected, 2), "ratio": ratio, "window": "180 days", "unit": "recall events", "class_i": class_i},
                series=monthly([e["date"] for e in items], end, 24), evidence_rows=evidence(dataset, rows),
                method="Product rows collapsed to events by firm, initiation date and reason; Poisson tail of the 180-day count against the firm's prior 3-year rate.",
                as_of=end, tags=[center, "Recall cluster"] + (["Class I"] if class_i else []),
            )

    def class_i(self, dataset, center, events, end):
        recent_start = end - dt.timedelta(days=90)
        base_start = recent_start - dt.timedelta(days=730)
        serious = [e for e in events if e["class"] == "Class I"]
        recent = [e for e in serious if e["date"] > recent_start]
        baseline = [e for e in serious if base_start < e["date"] <= recent_start]
        expected = len(baseline) / (730 / 90)
        surprise = poisson_surprise(len(recent), expected)
        if surprise < 1.3 or len(recent) < 3:
            return
        rows = [r for e in sorted(recent, key=lambda e: -e["date"].toordinal()) for r in e["rows"][:1]]
        self.add(
            kind="class_i_spike", agency="FDA", entity=f"{center} Class I",
            headline=f"Class I {center.lower()} recalls up: {len(recent)} events in 90 days",
            summary=f"{len(recent)} Class I recall events in the 90 days to {end.isoformat()}, against {expected:.1f} expected from the prior two years. Class I covers products with a reasonable probability of serious harm or death.",
            score=surprise * 8 + 20, serious=True,
            metric={"recent": len(recent), "baseline": round(expected, 2), "ratio": round(len(recent) / expected, 1) if expected else None, "window": "90 days", "unit": "Class I events"},
            series=monthly([e["date"] for e in serious], end, 24), evidence_rows=evidence(dataset, rows),
            method="Class I events per FDA center; Poisson tail of the 90-day count against the prior 2-year rate.",
            as_of=end, tags=[center, "Class I"],
        )

    def themes(self, dataset, label, events, end, themes, text_of, *, agency, unit="recall events"):
        recent_start = end - dt.timedelta(days=365)
        base_start = recent_start - dt.timedelta(days=3 * 365)
        compiled = {name: re.compile(pattern, re.I) for name, pattern in themes.items()}
        for name, pattern in compiled.items():
            matched = [e for e in events if pattern.search(text_of(e) or "")]
            recent = [e for e in matched if e["date"] > recent_start]
            baseline = [e for e in matched if base_start < e["date"] <= recent_start]
            expected = len(baseline) / 3
            if len(recent) < 6:
                continue
            surprise = poisson_surprise(len(recent), expected)
            ratio = len(recent) / expected if expected else None
            if surprise < 2 or (ratio is not None and ratio < 1.4):
                continue
            rows = [r for e in sorted(recent, key=lambda e: -e["date"].toordinal()) for r in e["rows"][:1]]
            serious = any(e.get("class") == "Class I" for e in recent) or any(DEATH.search(text_of(e) or "") for e in recent)
            self.add(
                kind="hazard_surge", agency=agency, entity=f"{label} · {name}",
                headline=f"{name} {unit} rising in {label}: {len(recent)} in 12 months",
                summary=f"{len(recent)} {unit} citing {name.lower()} in the 12 months to {end.isoformat()}, against an annual average of {expected:.1f} over the prior three years" + (f" ({ratio:.1f}×)." if ratio else "."),
                score=surprise * 5 + min(len(recent), 40) * 0.5, serious=serious,
                metric={"recent": len(recent), "baseline": round(expected, 2), "ratio": round(ratio, 2) if ratio else None, "window": "12 months", "unit": unit},
                series=monthly([e["date"] for e in matched], end, 24), evidence_rows=evidence(dataset, rows),
                method=f"Keyword theme match on the stated reason; Poisson tail of the 12-month count against the prior 3-year annual rate.",
                as_of=end, tags=[label, name],
            )

    # CPSC, warning letters, CRLs, shortages ---------------------------------------------------------------------
    def simple_events(self, dataset, text_key="title"):
        out = []
        for row in self.data.get(dataset, []):
            filters = row.get("filters") or {}
            when = parse_date(filters.get("sort_date") or filters.get("date"))
            if not when:
                continue
            text = " ".join(filter(None, [row.get("title"), row.get("snippet")])) if text_key == "both" else (row.get(text_key) or "")
            out.append({"date": when, "text": text, "firm": row.get("firm") or (filters.get("firm_norm") or "").title(), "firm_norm": filters.get("firm_norm") or "", "class": "", "status": row.get("status"),
                        "rows": [{"id": row["id"], "title": row.get("title"), "date": when.isoformat(), "note": (row.get("snippet") or "")[:200]}]})
        return out

    def cpsc(self):
        dataset = "agency_safety_cpsc_recalls_local"
        events = self.simple_events(dataset, "both")
        if not events:
            return
        end = max(e["date"] for e in events)
        self.themes(dataset, "CPSC consumer products", events, end, CPSC_THEMES, lambda e: e["text"], agency="CPSC", unit="recalls")
        recent = [e for e in events if e["date"] > end - dt.timedelta(days=365) and DEATH.search(e["text"])]
        if len(recent) >= 3:
            self.add(
                kind="hazard_surge", agency="CPSC", entity="CPSC fatality-linked recalls",
                headline=f"{len(recent)} CPSC recalls in 12 months report deaths",
                summary=f"{len(recent)} recall notices published in the 12 months to {end.isoformat()} report deaths, as distinct from the standard risk-of-death hazard wording.",
                score=45 + len(recent), serious=True,
                metric={"recent": len(recent), "baseline": None, "ratio": None, "window": "12 months", "unit": "recalls citing deaths"},
                series=monthly([e["date"] for e in events if DEATH.search(e["text"])], end, 24),
                evidence_rows=evidence(dataset, [e["rows"][0] for e in sorted(recent, key=lambda e: -e["date"].toordinal())]),
                method="Recall notices whose title or text reports deaths or a person who died; the generic risk-of-death hazard phrase is excluded.",
                as_of=end, tags=["Fatality"],
            )

    def warning_letters(self):
        dataset = "agency_safety_fda_warning_letters"
        events = self.simple_events(dataset, "both")
        if events:
            end = max(e["date"] for e in events)
            self.themes(dataset, "FDA warning letters", events, end, WARNING_THEMES, lambda e: e["text"], agency="FDA", unit="warning letters")

    def crl(self):
        dataset = "agency_safety_openfda_crl"
        events = self.simple_events(dataset, "both")
        if not events:
            return
        end = max(e["date"] for e in events)
        recent = [e for e in events if e["date"] > end - dt.timedelta(days=365)]
        baseline = [e for e in events if end - dt.timedelta(days=4 * 365) < e["date"] <= end - dt.timedelta(days=365)]
        expected = len(baseline) / 3
        surprise = poisson_surprise(len(recent), expected)
        if len(recent) >= 10 and surprise >= 1.3:
            self.add(
                kind="crl_cluster", agency="FDA", entity="Complete response letters",
                headline=f"FDA complete response letters: {len(recent)} in 12 months",
                summary=f"{len(recent)} published complete response letters (applications not approved as submitted) in the 12 months to {end.isoformat()}, against {expected:.1f} a year over the prior three years.",
                score=surprise * 6 + 15, serious=False,
                metric={"recent": len(recent), "baseline": round(expected, 2), "ratio": round(len(recent) / expected, 2) if expected else None, "window": "12 months", "unit": "letters"},
                series=monthly([e["date"] for e in events], end, 24),
                evidence_rows=evidence(dataset, [e["rows"][0] for e in sorted(recent, key=lambda e: -e["date"].toordinal())]),
                method="Count of published complete response letters by letter date; Poisson tail against the prior 3-year annual rate.",
                as_of=end, tags=["Approvals"],
            )

    def shortages(self):
        dataset = "agency_safety_openfda_drug_shortages"
        rows = self.data.get(dataset, [])
        posted = []
        for row in rows:
            dates = row.get("dates") or {}
            when = parse_date(dates.get("initial_posting_date"))
            if when:
                posted.append((when, row))
        if not posted:
            return
        end = max(parse_date((r.get("dates") or {}).get("update_date")) or w for w, r in posted)
        recent = [(w, r) for w, r in posted if w > end - dt.timedelta(days=90)]
        by_firm = collections.defaultdict(list)
        for when, row in recent:
            by_firm[row.get("firm") or "Unknown firm"].append((when, row))
        for firm, items in by_firm.items():
            if len(items) < 5:
                continue
            products = sorted({re.split(r",", r.get("title") or "")[0] for _, r in items})
            self.add(
                kind="shortage_wave", agency="FDA", entity=firm,
                headline=f"{firm}: {len(items)} new drug shortage postings in 90 days",
                summary=f"{len(items)} shortage or discontinuation postings first published in the 90 days to {end.isoformat()}, covering {', '.join(products[:4])}{'…' if len(products) > 4 else ''}.",
                score=30 + len(items) * 2, serious=False,
                metric={"recent": len(items), "baseline": None, "ratio": None, "window": "90 days", "unit": "postings"},
                series=monthly([w for w, r in posted if (r.get("firm") or "Unknown firm") == firm], end, 12),
                evidence_rows=evidence(dataset, [{"id": r["id"], "title": r.get("title"), "date": w.isoformat(), "note": r.get("snippet")} for w, r in sorted(items, key=lambda x: -x[0].toordinal())]),
                method="Shortage records grouped by firm on their initial posting date.",
                as_of=end, tags=["Supply"],
            )

    # NHTSA --------------------------------------------------------------------------------------------------------
    def nhtsa(self):
        trends = self.data.get("agency_safety_nhtsa_complaint_trends", [])
        recalls = self.data.get("agency_safety_nhtsa_recalls", [])
        probes = self.data.get("agency_safety_nhtsa_investigations", [])
        recall_dates = [parse_date((r["item"].get("cells") or {}).get("date")) for r in recalls]
        end = max((d for d in recall_dates if d), default=dt.date.today())
        fraction = (end - dt.date(end.year, 1, 1)).days / 365 or 1
        rising = {}
        for row in trends:
            trend = row["item"].get("trend") or {}
            years = {int(k): v for k, v in (trend.get("years") or {}).items() if str(k).isdigit()}
            if end.year not in years or end.year - 1 not in years:
                continue
            current = years[end.year] / max(fraction, 0.25)
            prior = years[end.year - 1]
            earlier = years.get(end.year - 2, 0)
            if prior < 150 or current < 200 or (trend.get("component") or "").upper() == "UNKNOWN OR OTHER":
                continue
            growth = current / prior - 1
            two_year = prior / earlier - 1 if earlier else None
            make, component = trend.get("make") or "", trend.get("component") or ""
            if growth >= 0.25 or (two_year is not None and two_year >= 0.4 and growth >= 0.1):
                rising.setdefault(make.upper(), []).append(row)
                deaths, fires, crashes = trend.get("deaths") or 0, trend.get("fire") or 0, trend.get("crash") or 0
                surprise = poisson_surprise(int(current), prior)
                score = min(surprise, 30) * 1.2 + growth * 30 + min(deaths, 10) * 3 + min(fires, 100) * 0.1 + min(crashes, 300) * 0.03
                models = ", ".join(m for m, _ in (trend.get("models") or [])[:3])
                self.add(
                    kind="complaint_accel", agency="NHTSA", entity=f"{make} {component}",
                    headline=f"{make.title()} {component.lower()} complaints up {round(growth * 100)}% (annualized)",
                    summary=f"{years[end.year]:,} complaints so far in {end.year} (about {round(current):,} annualized) against {prior:,} in {end.year - 1}"
                            + (f"; {deaths} deaths, {fires} fires and {crashes} crashes reported across 2020–{end.year}" if deaths or fires or crashes else "")
                            + (f". Most-cited models: {models}." if models else "."),
                    score=score, serious=deaths > 0 or fires >= 20,
                    metric={"recent": round(current), "baseline": prior, "ratio": round(current / prior, 2), "window": f"{end.year} annualized vs {end.year - 1}", "unit": "complaints", "deaths": deaths, "fires": fires, "crashes": crashes},
                    series=yearly_series(years),
                    evidence_rows=evidence("agency_safety_nhtsa_complaint_trends", [{"id": row["id"], "title": row.get("title"), "date": None, "note": row["item"].get("subtitle")}]),
                    method=f"Year-to-date complaints annualized by elapsed share of {end.year} ({fraction:.0%}) and compared with the prior full year.",
                    as_of=end, tags=["Vehicles", component.title()] + (["Deaths reported"] if deaths else []),
                )

        by_maker = collections.defaultdict(list)
        for row, when in zip(recalls, recall_dates):
            if when:
                by_maker[((row["item"].get("cells") or {}).get("manufacturer") or "").strip()].append((when, row))
        recent_start = end - dt.timedelta(days=365)
        base_start = recent_start - dt.timedelta(days=3 * 365)
        for maker, items in by_maker.items():
            if not maker:
                continue
            recent = [(w, r) for w, r in items if w > recent_start]
            baseline = [(w, r) for w, r in items if base_start < w <= recent_start]
            expected = len(baseline) / 3
            if len(recent) < 8:
                continue
            surprise = poisson_surprise(len(recent), expected)
            if surprise < 2.5:
                continue
            units = sum(int(re.sub(r"\D", "", (r["item"].get("cells") or {}).get("units") or "0") or 0) for _, r in recent)
            components = collections.Counter(((r["item"].get("cells") or {}).get("component") or "").split(":")[0] for _, r in recent).most_common(3)
            self.add(
                kind="recall_surge", agency="NHTSA", entity=maker,
                headline=f"{maker.title()}: {len(recent)} recall campaigns in 12 months",
                summary=f"{len(recent)} campaigns in the 12 months to {end.isoformat()} against {expected:.1f} a year over the prior three years, covering about {units:,} units. Leading components: {', '.join(c.title() for c, _ in components if c)}.",
                score=surprise * 4 + min(len(recent), 40) * 0.6 + min(units / 100000, 20), serious=False,
                metric={"recent": len(recent), "baseline": round(expected, 2), "ratio": round(len(recent) / expected, 2) if expected else None, "window": "12 months", "unit": "campaigns", "units": units},
                series=monthly([w for w, _ in items], end, 24),
                evidence_rows=evidence("agency_safety_nhtsa_recalls", [{"id": r["id"], "title": r.get("title"), "date": w.isoformat(), "note": ((r["item"].get("recall") or {}).get("defect") or "")[:200]} for w, r in sorted(recent, key=lambda x: -x[0].toordinal())]),
                method="Campaigns per manufacturer by report date; Poisson tail of the 12-month count against the prior 3-year annual rate.",
                as_of=end, tags=["Vehicles", "Recall surge"],
            )

        for row in probes:
            cells = row["item"].get("cells") or {}
            info = row["item"].get("investigation") or {}
            opened = parse_date(cells.get("opened"))
            if not opened or info.get("closed") or cells.get("closed") not in ("Open", None, "", "—"):
                continue
            if opened < end - dt.timedelta(days=730):
                continue
            makes = [m.upper() for m in info.get("makes") or []]
            linked = [t for m in makes for t in rising.get(m, [])]
            kind_label = cells.get("type") or "Investigation"
            escalated = kind_label in ("Engineering analysis", "Recall query")
            score = 35 + (20 if escalated else 0) + (15 if linked else 0)
            vehicles = info.get("vehicles") or []
            self.add(
                kind="open_probe", agency="NHTSA", entity=f"{cells.get('action')}",
                headline=f"Open {kind_label.lower()} {cells.get('action')}: {headline_case(info.get('subject') or row.get('title') or '')}",
                summary=(f"Opened {opened.isoformat()} on {', '.join(m.title() for m in makes) or 'an unnamed manufacturer'}"
                         + (f" ({', '.join(v for v in vehicles[:3] if v)})" if any(vehicles) else "")
                         + (". Complaints for this make are rising in " + ", ".join(t["item"]["trend"]["component"].title() for t in linked[:3]) if linked else "")
                         + (". An engineering analysis or recall query is the stage that most often precedes a recall." if escalated else ".")),
                score=score, serious=escalated,
                metric={"recent": None, "baseline": None, "ratio": None, "window": "open", "unit": kind_label, "opened": opened.isoformat()},
                series=[],
                evidence_rows=evidence("agency_safety_nhtsa_investigations", [{"id": row["id"], "title": row.get("title"), "date": opened.isoformat(), "note": (info.get("summary") or "")[:200]}])
                + evidence("agency_safety_nhtsa_complaint_trends", [{"id": t["id"], "title": t.get("title"), "date": None, "note": t["item"].get("subtitle")} for t in linked], 3),
                method="Investigations still open and opened in the last 24 months; linked to complaint trends flagged as rising for the same make.",
                as_of=end, tags=["Vehicles", kind_label] + (["Rising complaints"] if linked else []),
            )

    # Litigation -------------------------------------------------------------------------------------------------
    def litigation(self):
        for row in self.data.get("agency_safety_mass_tort_signals", []):
            signal = row["item"].get("signal") or {}
            lit = row["item"].get("litigation") or {}
            pending, change = lit.get("pending") or 0, None
            series = lit.get("series") or []
            if len(series) >= 13 and series[-13].get("pending"):
                change = (series[-1]["pending"] - series[-13]["pending"]) / series[-13]["pending"]
            added = (series[-1]["pending"] - series[-13]["pending"]) if len(series) >= 13 else None
            years = {int(k): v for k, v in (signal.get("events_by_year") or {}).items() if str(k).isdigit()}
            latest = max((y for y in years if y < dt.date.today().year), default=None)
            report_growth = None
            if latest and years.get(latest - 1):
                report_growth = years[latest] / years[latest - 1] - 1
            if pending < 50 or change is None:
                continue
            if change < 0.15 and not (report_growth and report_growth > 0.25):
                continue
            end = parse_date((lit.get("series") or [{}])[-1].get("date")) or dt.date.today()
            score = min(change, 3) * 30 + math.log10(max(pending, 1)) * 10 + (max(report_growth, 0) * 20 if report_growth else 0)
            product = signal.get("product") or row.get("title")
            self.add(
                kind="litigation", agency="JPML", entity=f"MDL {lit.get('mdl')}",
                headline=f"MDL {lit.get('mdl')} {product}: pending actions {'+' if change >= 0 else ''}{round(change * 100)}% in 12 months",
                summary=f"{pending:,} pending actions before {lit.get('judge') or 'the transferee judge'}" + (f", {added:+,} over 12 months" if added is not None else "")
                        + (f"; {signal.get('source', 'agency')} reports {'+' if report_growth >= 0 else ''}{round(report_growth * 100)}% in {latest} vs {latest - 1}" if report_growth is not None else "")
                        + ". " + (signal.get("caveat") or ""),
                score=score, serious=change >= 0.5,
                metric={"recent": pending, "baseline": series[-13]["pending"] if len(series) >= 13 else None, "ratio": round(1 + change, 2), "window": "12 months", "unit": "pending actions", "report_growth": round(report_growth, 3) if report_growth is not None else None},
                series=[{"period": p["date"][:7], "count": p.get("pending") or 0} for p in (lit.get("series") or [])[-24:]],
                evidence_rows=evidence("agency_safety_mass_tort_signals", [{"id": row["id"], "title": row.get("title"), "date": end.isoformat(), "note": None}])
                + [{"dataset": "mdl_analytics", "id": str(lit.get("mdl")), "title": lit.get("title") or "", "date": end.isoformat(), "note": None}],
                method="Pending-action change over the last 12 JPML monthly reports, weighted by docket size and the year-over-year change in agency reports for the product.",
                as_of=end, tags=["Mass tort", signal.get("product_kind", "").title()],
            )

    # Cross-dataset detectors -------------------------------------------------------------------------------------
    COURT_RULE = {
        "pl_surge": "Product-liability surge",
        "pl_concentration": "Product-liability concentration",
        "pl_share_cluster": "Product-liability share cluster",
        "aging_backlog": "Aging civil backlog",
        "slow_disposition": "Slow civil disposition",
        "pl_decline": "Product-liability decline",
    }

    def courts(self):
        """District flags from U.S. Courts Judicial Business tables (court_stats_national), latest fiscal year only."""
        rows = self.data.get("court_stats_national", [])
        summary = next((r.get("summary") for r in rows if r.get("id") == "summary:national"), None)
        if not summary:
            return
        latest = summary.get("latest")
        rules = summary.get("rules") or {}
        end = dt.date(int(latest), 9, 30) if isinstance(latest, int) else dt.date.today()
        for flag in summary.get("flags") or []:
            if flag.get("year") != latest or flag.get("rule") not in self.COURT_RULE:
                continue
            rule, name, court = flag["rule"], flag.get("name") or flag.get("court_id"), flag.get("court_id")
            value, ratio, baseline = flag.get("value"), flag.get("ratio"), flag.get("baseline")
            share = flag.get("sharePct", flag.get("share_pct"))
            if rule == "pl_surge" and ratio:
                headline = f"{name}: product-liability filings {ratio:.1f}× the five-year median (FY{latest})"
                score = 40 + 12 * math.log2(max(ratio, 1)) + 4 * math.log10(max(value or 1, 1))
            elif rule == "pl_concentration":
                headline = f"{name} received {share:.1f}% of all federal product-liability filings (FY{latest})" if share is not None else f"{name}: product-liability concentration (FY{latest})"
                score = 45 + (share or 0)
            elif rule == "pl_share_cluster":
                headline = f"{name}: product-liability share of civil filings {ratio:.1f}× the national share (FY{latest})" if ratio else f"{name}: product-liability share cluster (FY{latest})"
                score = 35 + 6 * math.log2(max(ratio or 1, 1))
            elif rule == "aging_backlog":
                headline = f"{name}: civil cases pending 3+ years at {ratio:.1f}× the national share (FY{latest})" if ratio else f"{name}: aging civil backlog (FY{latest})"
                score = 32 + 5 * math.log2(max(ratio or 1, 1))
            elif rule == "slow_disposition":
                headline = f"{name}: median civil disposition {value} months vs {flag.get('national')} nationally (FY{latest})"
                score = 28
            else:
                headline = f"{name}: product-liability filings fell below half the five-year median (FY{latest})"
                score = 22
            self.add(
                kind="court_signal", agency="COURTS", entity=f"{court} {rule}",
                headline=headline,
                summary=(rules.get(rule) or self.COURT_RULE[rule]) + " Large counts usually reflect MDL actions transferred to or filed in the court.",
                score=score, serious=False,
                metric={"recent": value, "baseline": baseline, "ratio": ratio, "window": f"FY{latest}", "unit": "filings" if rule.startswith("pl") else "measure"},
                series=[], evidence_rows=[{"dataset": "court_stats_district_nos", "id": court, "title": f"{name} caseload statistics", "date": end.isoformat(), "note": self.COURT_RULE[rule]}],
                method="Flag published with the U.S. Courts Judicial Business tables (C-3, C-5, C-6, C-11) for the latest fiscal year; see /courts/analytics.",
                as_of=end, tags=["Courts", self.COURT_RULE[rule]],
            )

    COMPANY_FLAG = {
        "accrual_surge": "Litigation accrual surge",
        "accrual_heavy": "Accrual-heavy balance sheet",
        "expense_spike": "Litigation expense spike",
        "docket_growth": "Linked MDL docket growth",
        "multi_mdl": "Named in 3+ pending MDLs",
    }

    def companies(self):
        """SEC registrants whose own filings name MDLs, flagged by the company-intelligence rules."""
        for row in self.data.get("company_sec_profiles", []):
            summary = row.get("summary") or {}
            flags = [f for f in summary.get("flags") or [] if f in self.COMPANY_FLAG]
            if not flags or not str(row.get("id", "")).isdigit():
                continue
            company = summary.get("company") or {}
            name = company.get("name") if isinstance(company, dict) else None
            name = name or row["id"]
            exposure = summary.get("exposure") or {}
            pending = exposure.get("pending_actions")
            pct = summary.get("accrual_pct_revenue")
            change = exposure.get("pending_change_pct")
            mdls = [m for m in summary.get("mdls") or [] if m.get("counts_toward_exposure") and m.get("mdl_status") == "pending"]
            serious = "accrual_surge" in flags or "expense_spike" in flags or (pct or 0) >= 10
            score = 30 + 8 * len(flags) + 6 * math.log10(max(pending or 1, 1)) + min(pct or 0, 30) + (min(change, 100) / 5 if change and change > 0 else 0)
            parts = [self.COMPANY_FLAG[f] for f in flags]
            detail = []
            if pending:
                detail.append(f"{pending:,} pending actions across {exposure.get('pending_mdls')} linked MDLs" + (f" ({change:+.0f}% in 12 months)" if change is not None else ""))
            if pct is not None:
                detail.append(f"company-wide litigation accrual {pct:.1f}% of revenue")
            self.add(
                kind="company_exposure", agency="SEC", entity=row["id"],
                headline=f"{name}: {', '.join(parts).lower()}",
                summary=("; ".join(detail) + ". " if detail else "") + f"Links rest on the company's own SEC filings (strongest evidence tier {exposure.get('strongest_tier') or 'not recorded'}); accruals are company-wide, not MDL-specific.",
                score=score, serious=serious,
                metric={"recent": pending, "baseline": None, "ratio": None, "window": "latest fiscal year / 12 months", "unit": "pending actions in linked MDLs"},
                series=[{"period": p.get("date", "")[:7], "count": p.get("pending", 0)} for p in (summary.get("pending_series") or [])[-24:] if isinstance(p, dict)],
                evidence_rows=[{"dataset": "company_sec_profiles", "id": row["id"], "title": f"{name} — SEC company profile", "date": None, "note": ", ".join(parts)}]
                + [{"dataset": "mdl_analytics", "id": str(m["mdl"]), "title": m.get("mdl_title") or f"MDL {m['mdl']}", "date": None, "note": f"tier {m.get('tier')} · {m.get('pending', 0):,} pending"} for m in sorted(mdls, key=lambda m: -(m.get("pending") or 0))[:4]],
                method="Company-intelligence flag rules on SEC XBRL financials and JPML counts for MDLs the company's own filings name; see /companies.",
                as_of=dt.date.today(), tags=["Companies"] + parts,
            )

    def epa(self):
        """EPA federal enforcement: a state's latest complete fiscal year against its own five prior years."""
        all_rows = self.data.get("regulatory_epa_state_profiles", [])
        rows = [r for r in all_rows if (r.get("profile") or {}).get("kind") == "state"]
        national = next((r["profile"] for r in all_rows if (r.get("profile") or {}).get("code") == "US"), None)
        if not rows:
            return
        latest_fy = max((y.get("fy") for r in rows for y in r["profile"].get("years") or [] if y.get("cases")), default=None)
        if latest_fy is None:
            return
        # The current federal fiscal year is incomplete until September 30.
        today = dt.date.today()
        complete = today.year if today >= dt.date(today.year, 9, 30) else today.year - 1
        fy = min(latest_fy, complete)

        def ratio_of(profile):
            years = {y.get("fy"): y for y in profile.get("years") or []}
            latest = (years.get(fy) or {}).get("cases") or 0
            base = sum((years.get(fy - k) or {}).get("cases") or 0 for k in range(1, 6)) / 5
            return latest, base, (latest / base if base else None), years

        # A nationwide rise lifts every state; a state is flagged only when it outpaces the national ratio.
        national_ratio = 1.0
        if national:
            n_latest, n_base, n_ratio, n_years = ratio_of(national)
            national_ratio = max(1.0, n_ratio or 1.0)
            if n_ratio and n_ratio >= 1.25:
                self.add(
                    kind="enforcement_surge", agency="EPA", entity="US",
                    headline=f"EPA federal enforcement cases nationwide: {n_latest:,} in FY{fy}, {n_ratio:.2f}× the five-year mean",
                    summary=f"{n_latest:,} EPA-lead federal cases in FY{fy} against a mean of {n_base:,.0f} over FY{fy - 5}–FY{fy - 1}; the rise is almost entirely administrative cases ({(n_years.get(fy) or {}).get('administrative', 0):,}). State surges below are measured against this national ratio.",
                    score=40 + 20 * (n_ratio - 1), serious=False,
                    metric={"recent": n_latest, "baseline": round(n_base, 1), "ratio": round(n_ratio, 2), "window": f"FY{fy}", "unit": "EPA cases"},
                    series=[{"period": str(y), "count": (n_years.get(y) or {}).get("cases") or 0} for y in range(fy - 11, fy + 1)],
                    evidence_rows=[{"dataset": "regulatory_epa_state_profiles", "id": "epa-profile:US", "title": "United States — EPA enforcement profile", "date": None, "note": None}],
                    method="EPA ECHO federal enforcement case counts by fiscal year, latest complete year against the prior five-year mean.",
                    as_of=dt.date(fy, 9, 30), tags=["Enforcement", "EPA", "National"],
                )
        for row in rows:
            p = row["profile"]
            years = {y.get("fy"): y for y in p.get("years") or []}
            latest = (years.get(fy) or {}).get("cases") or 0
            prior = [(years.get(fy - k) or {}).get("cases") or 0 for k in range(1, 6)]
            baseline = sum(prior) / 5
            if latest < 10 or latest < 1.5 * national_ratio * baseline or latest - baseline < 10:
                continue
            penalty = (years.get(fy) or {}).get("fed_penalty") or 0
            surprise = poisson_surprise(int(latest), baseline)
            self.add(
                kind="enforcement_surge", agency="EPA", entity=p.get("code") or row["id"],
                headline=f"EPA enforcement in {p.get('name')}: {latest:,} cases in FY{fy}, {latest / baseline:.1f}× its five-year mean" if baseline else f"EPA enforcement in {p.get('name')}: {latest:,} cases in FY{fy}",
                summary=f"{latest:,} federal enforcement cases opened with a facility in {p.get('name')} in FY{fy} (federal penalties entered in FY{fy}: ${penalty:,.0f}) against a mean of {baseline:.1f} over FY{fy - 5}–FY{fy - 1}, outpacing the national rise ({national_ratio:.2f}×). Cases are assigned to every state where a recorded facility sits.",
                score=min(surprise, 30) * 2 + 20, serious=False,
                metric={"recent": latest, "baseline": round(baseline, 1), "ratio": round(latest / baseline, 2) if baseline else None, "window": f"FY{fy}", "unit": "EPA cases"},
                series=[{"period": str(y), "count": (years.get(y) or {}).get("cases") or 0} for y in range(fy - 11, fy + 1)],
                evidence_rows=[{"dataset": "regulatory_epa_state_profiles", "id": row["id"], "title": f"{p.get('name')} — EPA enforcement profile", "date": None, "note": None}],
                method="EPA ECHO federal enforcement cases by facility state and fiscal year; flag when the latest complete year is at least 1.5× the state's five-year mean times the national ratio, and at least 10 cases above the mean.",
                as_of=dt.date(fy, 9, 30), tags=["Enforcement", "EPA"],
            )

    RULEMAKING_AGENCIES = {"FDA", "CPSC", "NHTSA", "EPA", "FTC", "OSHA", "CMS", "DEA", "FAA", "CFPB", "SEC", "PHMSA"}
    DOC_LABEL = {"RULE": "final rules", "PRORULE": "proposed rules", "NOTICE": "notices"}

    def rulemaking(self):
        """Federal Register publication shifts per agency (regulatory_federal_register_activity)."""
        for row in self.data.get("regulatory_federal_register_activity", []):
            a = row.get("activity") or {}
            short = a.get("short")
            if short not in self.RULEMAKING_AGENCIES:
                continue
            for doc_type, f in (a.get("flags") or {}).items():
                if not f or not f.get("flag") or doc_type not in self.DOC_LABEL:
                    continue
                surge = f["flag"] == "surge"
                ratio = f.get("ratio")
                self.add(
                    kind="rulemaking_shift", agency=short, entity=f"{short} {doc_type}",
                    headline=f"{short} {self.DOC_LABEL[doc_type]} {'up' if surge else 'down'}: {f.get('recent')} in 12 months vs {f.get('baselineAnnual')}/yr" + (f" ({ratio:.2f}×)" if ratio else ""),
                    summary=f"{a.get('name')} published {f.get('recent')} {self.DOC_LABEL[doc_type]} in {f.get('window')} against {f.get('baselineAnnual')} a year in {f.get('baselineWindow')} (Federal Register).",
                    score=(25 + min(f.get("surprise") or 0, 25) * 1.5) if surge else 24, serious=False,
                    metric={"recent": f.get("recent"), "baseline": f.get("baselineAnnual"), "ratio": ratio, "window": "last 12 months", "unit": self.DOC_LABEL[doc_type]},
                    series=[{"period": k, "count": v} for k, v in sorted((a.get("monthly") or {}).get(doc_type, {}).items())[-24:]],
                    evidence_rows=[{"dataset": "regulatory_federal_register_activity", "id": row["id"], "title": f"{a.get('name')} — Federal Register activity", "date": None, "note": None}],
                    method="Federal Register API monthly counts; last 12 complete months against the prior 36 months' rate (Poisson tail; surge ≥1.25×, slowdown ≤0.6×).",
                    as_of=dt.date.today(), tags=["Rulemaking", short],
                )

    def build(self):
        self.fda()
        self.cpsc()
        self.warning_letters()
        self.crl()
        self.shortages()
        self.nhtsa()
        self.litigation()
        self.courts()
        self.companies()
        self.epa()
        self.rulemaking()
        seen, unique = set(), []
        for insight in sorted(self.insights, key=lambda x: -x["score"]):
            if insight["id"] in seen:
                continue
            seen.add(insight["id"])
            unique.append(insight)
        return unique


KIND_LABEL = {
    "firm_cluster": "Recall cluster", "hazard_surge": "Hazard surge", "class_i_spike": "Class I spike",
    "complaint_accel": "Complaint acceleration", "recall_surge": "Recall surge", "open_probe": "Open probe",
    "litigation": "Litigation momentum", "shortage_wave": "Shortage wave", "crl_cluster": "Approval setbacks",
    "court_signal": "Court caseload signal", "company_exposure": "Company exposure",
    "enforcement_surge": "Enforcement surge", "rulemaking_shift": "Rulemaking shift",
}


def to_rows(insights, generated):
    rows = []
    for rank, insight in enumerate(insights, 1):
        insight["rank"] = rank
        insight["generated_at"] = generated
        first = insight["evidence"][0] if insight["evidence"] else None
        rows.append(writer.record(
            DATASET, insight["id"], insight["headline"],
            source_url=f"/records/{first['dataset']}/{first['id']}" if first else "",
            subtitle=f"{KIND_LABEL.get(insight['kind'], insight['kind'])} · {insight['agency']} · score {insight['score']:.0f}",
            cells={"rank": str(rank), "severity": insight["severity"].title(), "kind": KIND_LABEL.get(insight["kind"], insight["kind"]), "agency": insight["agency"], "score": f"{insight['score']:.0f}", "as_of": insight["as_of"]},
            facts=[{"label": "Summary", "value": insight["summary"]}, {"label": "Method", "value": insight["method"]}, {"label": "As of", "value": insight["as_of"]}],
            text=" ".join([insight["summary"], " ".join(insight["tags"])]),
            filters={"severity": [insight["severity"]], "kind": [insight["kind"]], "agency": [insight["agency"].lower()]},
            badges=[insight["severity"].title(), KIND_LABEL.get(insight["kind"], insight["kind"])],
            links=[{"url": f"/records/{e['dataset']}/{e['id']}", "label": (e["title"] or e["id"])[:80]} for e in insight["evidence"][:4]],
            extra={"kind": "insight", "insight": insight},
        ))
    return rows


def load(cache):
    if cache:
        return {ds: json.load(open(os.path.join(cache, f"{ds}.json"))) for ds in SOURCES if os.path.exists(os.path.join(cache, f"{ds}.json"))}
    return {ds: writer.fetch_all(ds, select=select) for ds, select in SOURCES.items()}


def main(argv):
    cache = next((a.split("=", 1)[1] for a in argv if a.startswith("--cache=")), None)
    data = load(cache)
    insights = Builder(data).build()
    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    counts = collections.Counter(i["kind"] for i in insights)
    severities = collections.Counter(i["severity"] for i in insights)
    print(json.dumps({"insights": len(insights), "kinds": counts, "severity": severities}, default=dict))
    if "--dry-run" in argv:
        for insight in insights[:40]:
            print(f"{insight['score']:5.1f} {insight['severity']:8} {insight['kind']:16} {insight['headline']}")
        return
    rows = to_rows(insights, generated)
    writer.publish(
        DATASET, "Safety intelligence · automated flags", rows,
        listing_block=writer.listing(
            [("rank", "Rank"), ("severity", "Severity"), ("kind", "Signal"), ("agency", "Agency"), ("score", "Score"), ("as_of", "As of")],
            [("severity", "Severity", {"high": "High", "elevated": "Elevated", "watch": "Watch"}),
             ("kind", "Signal", KIND_LABEL),
             ("agency", "Agency", {a.lower(): a for a in ["FDA", "CPSC", "NHTSA", "JPML", "COURTS", "SEC", "EPA", "FTC", "OSHA", "CMS", "DEA", "FAA", "CFPB", "PHMSA"]})],
        ),
        summary={"generated_at": generated, "insights": len(insights), "kinds": dict(counts), "severity": dict(severities),
                 "sources": sorted(data), "method": "Deterministic detectors over published safety datasets; see scripts/enrichment/build_safety_insights.py."},
    )


if __name__ == "__main__":
    main(sys.argv[1:])
