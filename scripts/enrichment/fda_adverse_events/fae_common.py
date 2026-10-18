"""Shared, pure helpers for the fda_adverse_events stream: openFDA query plan, URL encoding, response parsing,
yearly aggregation, demographic buckets, MedDRA term case merging and exact company-name matching.

No network and no file writes here, so every function is unit-testable offline.
"""
import re
import urllib.parse
from collections import OrderedDict

API = "https://api.fda.gov/"
USER_AGENT = "legal-source-compass research (Seeger Weiss internal research)"
FIRST_YEAR = 2004  # FAERS (2004 Q1 onward) is the openFDA drug/event coverage start; earlier receive dates are legacy.
# "Latest three years" = the three most recent complete calendar years before the data cut-off (openFDA FAERS data are
# current through 2026-06-30 at retrieval; CAERS through 2026-03-31): 2023, 2024 and 2025.
RECENT_FROM, RECENT_TO = "20230101", "20251231"
RECENT_LABEL = "2023–2025"
TOP_N = 15
TERM_FETCH_LIMIT = 50  # fetch 50 terms, merge case variants, keep the top 15
CAERS_TOP_INDUSTRIES = 10
CAERS_TOP_BRANDS = 10
# CAERS brand-name placeholders that are not product names: "EXEMPTION 4" marks a name withheld under FOIA
# Exemption 4 (confidential commercial information). They stay in the full ranking but never get a product row.
CAERS_NON_PRODUCT_BRANDS = ("EXEMPTION 4",)
CAERS_ALWAYS_INDUSTRIES = ("Cosmetics",)  # the AEMS Cosmetics dashboard counterpart, kept even outside the top 10

DASHBOARDS = {
    "faers": {
        "title": "FDA Adverse Event Reporting System (FAERS) Public Dashboard for Drugs and Biologics",
        "url": "https://fis.fda.gov/sense/app/95239e26-e0be-42d9-a960-9a5f7f1c25ee/sheet/7a47a261-d58b-4203-a8aa-6d3021737452/state/analysis",
    },
    "cosmetics": {
        "title": "FDA Adverse Event Monitoring System (AEMS) Public Dashboard for Cosmetic Products",
        "url": "https://fis.fda.gov/sense/app/556fa804-28bf-4ec4-97f3-aab9eba283d4/sheet/7a47a261-d58b-4203-a8aa-6d3021737452/state/analysis",
    },
    "vaccines": {
        "title": "FDA Adverse Event Monitoring System (AEMS) Public Dashboard for Vaccines",
        "url": "https://fis.fda.gov/sense/app/5ab20f1f-ce63-4b9f-9314-1142f9bb28fd/sheet/f0cc6f7a-c97d-4804-a51f-1f0c7efb216f/state/analysis",
    },
}
DOCS = {
    "drug": "https://open.fda.gov/apis/drug/event/",
    "device": "https://open.fda.gov/apis/device/event/",
    "food": "https://open.fda.gov/apis/food/event/",
}
# Vaccines are licensed biologics whose adverse events are reported mainly to VAERS (the AEMS Vaccines dashboard),
# which openFDA does not carry; FAERS holds only the reports submitted there. Explicit list, not inferred from names.
VACCINE_MDLS = frozenset({2848, 3036})

QUALIFICATION = OrderedDict([(1, "Physician"), (2, "Pharmacist"), (3, "Other health professional"), (4, "Lawyer"),
                             (5, "Consumer or non-health professional")])
SEX = OrderedDict([(1, "Male"), (2, "Female"), (0, "Unknown (coded 0)")])
AGE_GROUP = OrderedDict([(1, "Neonate"), (2, "Infant"), (3, "Child"), (4, "Adolescent"), (5, "Adult"), (6, "Elderly")])
# Age buckets for ages recorded in years (unit 801), aligned with the FAERS dashboard groups where years allow:
# the dashboard splits 0-1 month and 2 months-2 years, which year-unit ages cannot, so they are one bucket here.
AGE_BUCKETS = [("0–2 years", 0, 3), ("3–11 years", 3, 12), ("12–17 years", 12, 18), ("18–64 years", 18, 65),
               ("65–85 years", 65, 86), ("86–120 years", 86, 121), ("Over 120 (as recorded; implausible)", 121, None)]
MAUDE_EVENT_TYPES = ("Death", "Injury", "Malfunction")
# openFDA refuses count limits above 100 without an API key (HTTP 403 API_KEY_MISSING for limit=1000), and the
# onset-age unit field cannot be counted at all ("Nothing to count"), so ages are counted in two value ranges.
AGE_TERM_LIMIT = 100
AGE_RANGES = (("lt65", "0", "64.999"), ("ge65", "65", "99999"))
# Alternate openFDA searches, used ONLY where the search recorded in mass_tort_products.json matches no report at all.
# openFDA fills patient.drug.openfda.* by harmonising drug names to Drugs@FDA/NDC records; reports for some biologics
# (here Tepezza, a BLA) are never harmonised, so the recorded generic_name search answers "No matches found!" even
# though reports exist under the reported drug name. The alternate is labelled in every row that uses it and never
# replaces a recorded search that returns reports.
ALT_FAERS = {
    3079: {"key": "3079alt", "faers": 'patient.drug.medicinalproduct:("TEPEZZA"+"TEPROTUMUMAB")',
           "why": "the recorded search (openFDA harmonised generic name) matches no reports because openFDA does not harmonise this biologic's drug names"},
}
# A company link is added to a device row only if the exactly matched manufacturer names carry at least this share of the
# product's reports; smaller matches stay in the row's manufacturer list (with the CIK / record id) but are not row-level
# links, because a few reports under a coincidentally shared brand name say nothing about who made the product (for
# example 66 of 5,121 LFIT V40 reports, 1.3%, name Ethicon). 5% is a stated judgement, not a measured optimum.
COMPANY_LINK_MIN_SHARE = 0.05

# FDA's FIS dashboards (AEMS) publish near-real-time figures; openFDA lags them, so a dashboard is a related view, not a copy of these counts.
DASHBOARD_CAVEAT = " (current AEMS figures: they run ahead of and will differ from this openFDA snapshot)"

# Rows whose label is narrower than the inherited openFDA search (verifier finding): what the search really matches, by system and MDL.
SEARCH_SCOPE = {
    "faers": {
        3163: "Matches any MedDRA reaction term containing \"optic\": ischaemic optic neuropathy (the NAION term, 798 reports) but also optic neuritis, optic neuropathy, optic nerve disorder, optic nerve injury, optic atrophy and optic disc oedema. The count is not NAION alone.",
    },
    "maude": {
        3014: "The brand token TRILOGY also matches other makers' devices (St. Jude Medical CRM, Zimmer and others): at least 1.9% of the matching reports name a manufacturer other than Philips. The count is not Philips CPAP alone.",
    },
    "caers": {
        3060: "The brand-name token RELAXER also matches muscle-relaxer supplements, so the count is not hair-relaxer reports alone.",
        3026: "Matches every SIMILAC or ENFAMIL brand name (and industries other than infant formula), not preterm-infant formula alone.",
        3037: "Matches every Similac Alimentum and EleCare report, not the recalled lots alone.",
    },
}


# ---------------------------------------------------------------- URLs and the query plan

def enc_expr(expr):
    """An openFDA search expression from mass_tort_products.json, kept term-for-term: '+' stays the openFDA separator,
    only spaces and double quotes are percent-encoded so the URL is a valid, clickable link."""
    return expr.replace(" ", "%20").replace('"', "%22")


def phrase(text):
    """A literal value (industry or brand name) as an exact-match quoted phrase, fully percent-encoded."""
    return "%22" + urllib.parse.quote(text, safe="") + "%22"


def build_url(endpoint, search=None, count=None, limit=None):
    parts = []
    if search:
        parts.append("search=" + search)
    if count:
        parts.append("count=" + count)
    if limit:
        parts.append(f"limit={limit}")
    return API + endpoint + "?" + "&".join(parts)


def _and(base, clause):
    return f"{base}+AND+{clause}" if base else clause


def slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "blank"


def spec(key, group, purpose, endpoint, search=None, count=None, limit=None):
    return {"key": key, "group": group, "purpose": purpose, "url": build_url(endpoint, search, count, limit)}


def faers_product_specs(entry, kid=None, search=None):
    """Query specs for one drug product. `kid`/`search` override the key id and search expression (alternate searches)."""
    m, s = kid or entry["mdl"], enc_expr(search or entry["faers"])
    ep, g = "drug/event.json", f"faers:{m}"
    recent = f"receivedate:[{RECENT_FROM}+TO+{RECENT_TO}]"
    return [
        spec(f"faers_{m}_year_all", g, "reports by FDA receive date", ep, s, "receivedate"),
        spec(f"faers_{m}_year_serious", g, "serious reports by receive date", ep, _and(s, "serious:1"), "receivedate"),
        spec(f"faers_{m}_year_death", g, "death-outcome reports by receive date", ep, _and(s, "seriousnessdeath:1"), "receivedate"),
        spec(f"faers_{m}_year_lawyer", g, "lawyer-reported reports by receive date", ep, _and(s, "primarysource.qualification:4"), "receivedate"),
        spec(f"faers_{m}_pt_all", g, "reactions (MedDRA PT), all years", ep, s, "patient.reaction.reactionmeddrapt.exact", TERM_FETCH_LIMIT),
        spec(f"faers_{m}_pt_recent", g, f"reactions (MedDRA PT), received {RECENT_LABEL}", ep, _and(s, recent), "patient.reaction.reactionmeddrapt.exact", TERM_FETCH_LIMIT),
        spec(f"faers_{m}_qual", g, "reporter qualification", ep, s, "primarysource.qualification"),
        spec(f"faers_{m}_sex", g, "patient sex", ep, s, "patient.patientsex"),
        spec(f"faers_{m}_agegroup", g, "patient age group (coded field)", ep, s, "patient.patientagegroup"),
    ] + [
        # Onset age in years, split at 65 so each count stays under openFDA's 100-term limit without a key; a range is
        # complete only if fewer than AGE_TERM_LIMIT distinct values come back (checked in the builder).
        spec(f"faers_{m}_age_years_{name}", g, f"patient onset age in years, {lo}–{hi}", ep,
             _and(_and(s, "patient.patientonsetageunit:801"), f"patient.patientonsetage:[{lo}+TO+{hi}]"),
             "patient.patientonsetage", AGE_TERM_LIMIT)
        for name, lo, hi in AGE_RANGES
    ]


def faers_national_specs():
    ep, g = "drug/event.json", "faers:national"
    out = [
        spec("faers_nat_year_all", g, "all reports by receive date", ep, None, "receivedate"),
        spec("faers_nat_year_serious", g, "serious reports by receive date", ep, "serious:1", "receivedate"),
        spec("faers_nat_year_death", g, "death-outcome reports by receive date", ep, "seriousnessdeath:1", "receivedate"),
    ]
    for code in QUALIFICATION:
        out.append(spec(f"faers_nat_year_q{code}", g, f"reports by receive date, reporter = {QUALIFICATION[code]}", ep,
                        f"primarysource.qualification:{code}", "receivedate"))
    out.append(spec("faers_nat_sex", g, "patient sex, all reports", ep, None, "patient.patientsex"))
    return out


def maude_product_specs(entry):
    m, s = entry["mdl"], enc_expr(entry["maude"])
    ep, g = "device/event.json", f"maude:{m}"
    recent = f"date_received:[{RECENT_FROM}+TO+{RECENT_TO}]"
    out = [spec(f"maude_{m}_year_all", g, "reports by date received", ep, s, "date_received")]
    for et in MAUDE_EVENT_TYPES:
        out.append(spec(f"maude_{m}_year_{et.lower()}", g, f"event type {et} by date received", ep, _and(s, f"event_type:{et}"), "date_received"))
    out += [
        spec(f"maude_{m}_event_type", g, "event type, all years", ep, s, "event_type.exact"),
        spec(f"maude_{m}_problems_all", g, "device product problems, all years", ep, s, "product_problems.exact", TERM_FETCH_LIMIT),
        spec(f"maude_{m}_problems_recent", g, f"device product problems, received {RECENT_LABEL}", ep, _and(s, recent), "product_problems.exact", TERM_FETCH_LIMIT),
        spec(f"maude_{m}_manufacturers", g, "device manufacturer names on matching reports", ep, s, "device.manufacturer_d_name.exact", 100),
    ]
    return out


def maude_national_specs():
    ep, g = "device/event.json", "maude:national"
    out = [spec("maude_nat_year_all", g, "all reports by date received", ep, None, "date_received")]
    for et in MAUDE_EVENT_TYPES:
        out.append(spec(f"maude_nat_year_{et.lower()}", g, f"event type {et} by date received", ep, f"event_type:{et}", "date_received"))
    out.append(spec("maude_nat_event_type", g, "event type, all years", ep, None, "event_type.exact"))
    return out


def caers_national_specs():
    ep, g = "food/event.json", "caers:national"
    return [
        spec("caers_nat_year_all", g, "all reports by date created", ep, None, "date_created"),
        spec("caers_nat_year_death", g, "reports with outcome Death by date created", ep, "outcomes.exact:%22Death%22", "date_created"),
        spec("caers_nat_outcomes", g, "report outcomes, all years", ep, None, "outcomes.exact"),
        spec("caers_nat_industry", g, "product industry, all years", ep, None, "products.industry_name.exact", 100),
        spec("caers_nat_brand", g, "product brand name, all years", ep, None, "products.name_brand.exact", 100),
    ]


def caers_product_specs(entry):
    m, s = entry["mdl"], enc_expr(entry["caers"])
    ep, g = "food/event.json", f"caers:{m}"
    return [
        spec(f"caers_{m}_year_all", g, "reports by date created", ep, s, "date_created"),
        spec(f"caers_{m}_outcomes", g, "report outcomes", ep, s, "outcomes.exact"),
        spec(f"caers_{m}_reactions", g, "reactions (MedDRA PT)", ep, s, "reactions.exact", TERM_FETCH_LIMIT),
        spec(f"caers_{m}_industry", g, "product industry", ep, s, "products.industry_name.exact", 100),
        spec(f"caers_{m}_brands", g, "product brand names", ep, s, "products.name_brand.exact", 25),
    ]


def caers_ranked_specs(industries, brands):
    """Phase 2: yearly series for the top industries and top named brands, chosen from the national rankings."""
    ep = "food/event.json"
    out = []
    for name in industries:
        out.append(spec(f"caers_ind_{slug(name)}_year_all", "caers:industry", f"reports by date created, industry = {name}", ep,
                        "products.industry_name.exact:" + phrase(name), "date_created"))
    for name in brands:
        out.append(spec(f"caers_brand_{slug(name)}_year_all", "caers:brand", f"reports by date created, brand = {name}", ep,
                        "products.name_brand.exact:" + phrase(name), "date_created"))
    return out


def phase1_specs(products):
    out = faers_national_specs() + maude_national_specs() + caers_national_specs()
    for e in products:
        if e.get("kind") == "drug" and e.get("faers"):
            out += faers_product_specs(e)
            alt = ALT_FAERS.get(e["mdl"])
            if alt:
                out += faers_product_specs(e, alt["key"], alt["faers"])
        elif e.get("kind") == "device" and e.get("maude"):
            out += maude_product_specs(e)
        elif e.get("kind") in ("food", "cosmetic") and e.get("caers"):
            out += caers_product_specs(e)
    keys = [s["key"] for s in out]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate query keys")
    return out


def choose_caers_ranked(industry_terms, brand_terms):
    """Top industries (plus the always-kept Cosmetics) and top named brands from the national ranking terms."""
    industries = [t["term"] for t in industry_terms[:CAERS_TOP_INDUSTRIES]]
    for name in CAERS_ALWAYS_INDUSTRIES:
        if name not in industries and any(t["term"] == name for t in industry_terms):
            industries.append(name)
    brands = [t["term"] for t in brand_terms if t["term"] not in CAERS_NON_PRODUCT_BRANDS][:CAERS_TOP_BRANDS]
    slugs = [slug(x) for x in industries] + [slug(x) for x in brands]
    if len(slugs) != len(set(slugs)):
        raise ValueError("CAERS ranked names collide after slugging")
    return industries, brands


# ---------------------------------------------------------------- response parsing

class NotRecorded(Exception):
    """The query has no usable answer (openFDA error other than 'No matches found!')."""


def results_of(status, payload):
    """openFDA answers 404 NOT_FOUND 'No matches found!' for an empty result: that is a true zero. Every other error
    (including 404 'Nothing to count', which means the field cannot be counted) raises NotRecorded."""
    err = (payload.get("error") or {}) if isinstance(payload, dict) else {}
    if status == 404 and err.get("code") == "NOT_FOUND" and err.get("message") == "No matches found!":
        return []
    if status != 200 or not isinstance(payload, dict) or "results" not in payload:
        detail = (payload.get("error") or {}).get("message") if isinstance(payload, dict) else None
        raise NotRecorded(f"openFDA HTTP {status}" + (f": {detail}" if detail else ""))
    return payload["results"]


def daily_to_years(results):
    """openFDA date counts ({time: YYYYMMDD, count}) summed per calendar year; returns {year:int -> count}."""
    years = {}
    for r in results:
        t = str(r["time"])
        if not re.fullmatch(r"\d{8}", t):
            raise ValueError(f"unexpected date term {t!r}")
        y = int(t[:4])
        years[y] = years.get(y, 0) + int(r["count"])
    return dict(sorted(years.items()))


def max_date(results):
    return max((str(r["time"]) for r in results), default=None)


def year_series(years_map, first, last):
    """Dense list of (year, count) for first..last; a year with no reports is 0 (openFDA omits empty days)."""
    return [(y, years_map.get(y, 0)) for y in range(first, last + 1)]


def before(years_map, first):
    return sum(n for y, n in years_map.items() if y < first)


def term_counts(results):
    return [{"term": r["term"], "count": int(r["count"])} for r in results]


def coded_mix(results, labels, total):
    """Mix of a coded field: every label in order with count and share of `total`, plus Not recorded = total - sum.
    Codes outside the documented code list are kept as 'Other code <x>'."""
    counts = {}
    for r in results:
        try:
            code = int(r["term"])
        except (TypeError, ValueError):
            code = r["term"]
        counts[code] = counts.get(code, 0) + int(r["count"])
    out = []
    for code, label in labels.items():
        n = counts.pop(code, 0)
        out.append({"code": code, "label": label, "count": n, "share": share(n, total)})
    for code in sorted(counts, key=str):
        out.append({"code": code, "label": f"Other code {code}", "count": counts[code], "share": share(counts[code], total)})
    recorded = sum(x["count"] for x in out)
    missing = total - recorded if total is not None else None
    if missing is not None and missing < 0:
        raise ValueError("coded counts exceed the total")
    out.append({"code": None, "label": "Not recorded", "count": missing, "share": share(missing, total)})
    return out


def age_buckets(results):
    """Ages recorded in years (unit 801) into AGE_BUCKETS; returns [{label, count}] and the recorded total."""
    counts = [0] * len(AGE_BUCKETS)
    total = 0
    for r in results:
        age = float(r["term"])
        n = int(r["count"])
        total += n
        for i, (_, lo, hi) in enumerate(AGE_BUCKETS):
            if age >= lo and (hi is None or age < hi):
                counts[i] += n
                break
        else:
            raise ValueError(f"age {age} outside every bucket")
    return [{"label": b[0], "count": c} for b, c in zip(AGE_BUCKETS, counts)], total


def share(n, d):
    if n is None or not d:
        return None
    return round(n / d, 6)


def yoy(cur, prev):
    if cur is None or not prev:
        return None
    return round((cur - prev) / prev, 6)


def pct(x, digits=1):
    return "Not recorded" if x is None else f"{x * 100:.{digits}f}%"


def num(n):
    return "Not recorded" if n is None else f"{n:,}"


def merge_case_variants(terms):
    """Sum terms that differ only in letter case ("Diarrhoea" / "DIARRHOEA"), label with the most reported spelling
    (ties: first seen), keep every spelling in `variants`, re-sort by count (ties: first seen). Same rule as
    merge_case_variants in scripts/enrichment/build_mass_tort_signals.py and mergeTermCase in the app."""
    groups = {}
    for t in terms or []:
        term = (t.get("term") or "").strip() if isinstance(t, dict) and isinstance(t.get("term"), str) else ""
        count = t.get("count") if isinstance(t, dict) else None
        if not term or not isinstance(count, (int, float)) or isinstance(count, bool) or count < 0:
            continue
        key = term.lower()
        g = groups.setdefault(key, {"order": len(groups), "total": 0, "spellings": {}})
        g["total"] += count
        g["spellings"][term] = g["spellings"].get(term, 0) + count
    out = []
    for g in sorted(groups.values(), key=lambda g: (-g["total"], g["order"])):
        best = max(g["spellings"].items(), key=lambda kv: kv[1])[0]
        out.append({"term": best, "count": g["total"], "variants": list(g["spellings"])})
    return out


def top_terms(results, total, n=TOP_N):
    """Top-n merged terms with each term's share of all reports in the query (a report can list many terms)."""
    merged = merge_case_variants(term_counts(results))[:n]
    for i, t in enumerate(merged, 1):
        t["rank"] = i
        t["share_of_reports"] = share(t["count"], total)
    return merged


# ---------------------------------------------------------------- exact company-name matching

_LEGAL = {"CORPORATION": "CORP", "INCORPORATED": "INC", "COMPANY": "CO", "LIMITED": "LTD"}
_SEC_SUFFIX = re.compile(r"\s*/[A-Z]{2,3}/?\s*$|\s*/NEW/?\s*$")


def normalize_company(name):
    """Deterministic normalisation for exact matching: upper case; SEC conformed-name state suffix ('/DE', '/PA/',
    '/NEW/') removed; '&' -> 'AND'; the punctuation . , ' " ( ) removed; whitespace collapsed; whole-word legal forms
    CORPORATION/INCORPORATED/COMPANY/LIMITED written CORP/INC/CO/LTD. Legal forms are never dropped, so 'ACME' and
    'ACME INC' stay different names."""
    s = (name or "").upper().strip()
    s = _SEC_SUFFIX.sub("", s)
    s = s.replace("&", " AND ")
    s = re.sub(r"[.,'\"()]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return " ".join(_LEGAL.get(w, w) for w in s.split(" ")) if s else ""


def company_index(profiles):
    """profiles: [(cik, name)] -> {normalized name: [cik, ...]} (more than one CIK means ambiguous)."""
    idx = {}
    for cik, name in profiles:
        key = normalize_company(name)
        if key:
            idx.setdefault(key, [])
            if cik not in idx[key]:
                idx[key].append(cik)
    return idx


def match_company(name, idx):
    """('matched', cik) on a unique exact normalized match; ('ambiguous', [ciks]); ('unmatched', None)."""
    ciks = idx.get(normalize_company(name), [])
    if len(ciks) == 1:
        return "matched", ciks[0]
    if len(ciks) > 1:
        return "ambiguous", sorted(ciks)
    return "unmatched", None


def record_source(record_id):
    """company_adverse_manufacturers ids: 'maude-sec-<CIK>' (SEC registrant) or 'maude-<n>' (CMS Open Payments entity)."""
    return "sec" if record_id.startswith("maude-sec-") else "open_payments"


def manufacturer_record_index(rows):
    """rows: [(record_id, title)] of company_adverse_manufacturers -> {normalized title: {source: [record ids]}}.
    Only rows whose own match status is 'Exact-name match' belong here (the caller filters)."""
    idx = {}
    for rid, title in rows:
        key = normalize_company(title)
        if key:
            ids = idx.setdefault(key, {}).setdefault(record_source(rid), [])
            if rid not in ids:
                ids.append(rid)
    return idx


def match_manufacturer_records(name, idx):
    """Records of company_adverse_manufacturers whose title equals `name` after normalisation, one per source and only
    where that source has exactly one such record: ([record ids], [ambiguous sources])."""
    by_source = idx.get(normalize_company(name), {})
    linked = [ids[0] for _, ids in sorted(by_source.items()) if len(ids) == 1]
    ambiguous = sorted(src for src, ids in by_source.items() if len(ids) > 1)
    return linked, ambiguous
