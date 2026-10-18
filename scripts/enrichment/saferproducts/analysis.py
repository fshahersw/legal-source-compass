"""Aggregation functions for the SaferProducts.gov enrichment (pure functions over lists of spdb_lib.Report).

Every figure is a count of REPORTS (unverified consumer submissions that CPSC published after minimum-information checks),
never incidence, and never a finding of defect or causation. Dates used:
  * publication year: year of 'Publication Date' (the date CPSC posted the report)  -> the default time axis
  * report year:      year of 'Report Date'      (the export's submission date)    -> shown beside it
  * incident date:    NOT a column of the export -> 'Not recorded'
"""
import collections
import datetime as dt
import hashlib

import spdb_lib as L

SEV_KEYS = ("death", "injury", "incident_no_injury", "no_incident", "unspecified")
BASE_YEAR = 2019  # 'change since 2019' reference year
MIN_VOLUME = 30  # growth ranking: minimum reports in BOTH comparison windows
CLUSTER_MIN = 3  # same-model cluster: minimum reports sharing an exact brand + model string
MIN_COMPANY_REPORTS = 25  # company records: minimum reports for one exact name string

US_STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT",
    "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT",
    "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
    "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}
US_TERRITORIES = {"Puerto Rico", "Virgin Islands", "U.S. Virgin Islands", "Guam", "American Samoa", "Northern Mariana Islands", "United States Minor Outlying Islands"}


def state_class(name):
    """us_state | us_territory | united_states_unspecified | unspecified | other_country_or_region (as recorded)."""
    if name in US_STATES:
        return "us_state"
    if name in US_TERRITORIES:
        return "us_territory"
    if name == "United States":
        return "united_states_unspecified"
    if name in ("Unspecified", "Not recorded", ""):
        return "unspecified"
    return "other_country_or_region"


def short_hash(text, size=8):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:size]


# ------------------------------------------------------------------ time context

class Ctx:
    """Time axis facts derived from the data (never assumed)."""

    def __init__(self, reports):
        pubs = [r.pub_date for r in reports if r.pub_date]
        reps = [r.report_date for r in reports if r.report_date]
        self.pub_min, self.pub_max = min(pubs), max(pubs)
        self.rep_min, self.rep_max = min(reps), max(reps)
        self.pub_years = list(range(self.pub_min.year, self.pub_max.year + 1))
        self.rep_years = list(range(self.rep_min.year, self.rep_max.year + 1))
        self.pub_first_partial = (self.pub_min.month, self.pub_min.day) != (1, 1)
        self.pub_last_partial = (self.pub_max.month, self.pub_max.day) != (12, 31)
        self.rep_first_partial = (self.rep_min.month, self.rep_min.day) != (1, 1)
        self.rep_last_partial = (self.rep_max.month, self.rep_max.day) != (12, 31)
        self.cutoff = (self.pub_max.month, self.pub_max.day)
        self.last_complete = self.pub_max.year - 1 if self.pub_last_partial else self.pub_max.year
        self.recent = (self.last_complete - 2, self.last_complete)
        self.prior = (self.last_complete - 5, self.last_complete - 3)

    def pub_partial(self, year):
        return (year == self.pub_years[0] and self.pub_first_partial) or (year == self.pub_years[-1] and self.pub_last_partial)

    def rep_partial(self, year):
        return (year == self.rep_years[0] and self.rep_first_partial) or (year == self.rep_years[-1] and self.rep_last_partial)


# ------------------------------------------------------------------ small helpers

def top_items(counter, k, label="name"):
    items = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:k]
    return [{label: name, "reports": count} for name, count in items]


def states_block(reports, top=10):
    counter = collections.Counter(r.state for r in reports)
    rows = []
    for name, count in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:top]:
        rows.append({"state": name, "reports": count, "usps": US_STATES.get(name), "class": state_class(name)})
    classes = collections.Counter()
    for name, count in counter.items():
        classes[state_class(name)] += count
    named = [n for n in counter if state_class(n) == "us_state"]
    top5 = sum(c for _n, c in sorted(counter.items(), key=lambda kv: -kv[1])[:5])
    return {
        "top": rows,
        "classes": dict(classes),
        "us_states_with_reports": len(named),
        "top5_share_pct": L.pct(top5, len(reports)),
    }


def lag_block(reports):
    """Day lags between the dates in the export (all computed): report -> publication, report -> sent to manufacturer,
    sent -> publication. Rows whose dates are out of order are excluded from that lag and counted."""
    pub = [(r.pub_date - r.report_date).days for r in reports if r.pub_date and r.report_date and r.pub_date >= r.report_date]
    sent_rows = [r for r in reports if r.sent_date and r.report_date and r.pub_date]
    to_sent = [(r.sent_date - r.report_date).days for r in sent_rows if r.sent_date >= r.report_date]
    sent_pub = [(r.pub_date - r.sent_date).days for r in sent_rows if r.pub_date >= r.sent_date]
    return {
        "report_to_publication_days": {
            "n": len(pub), "median": L.median(pub), "p90": L.percentile_nearest_rank(pub, 90), "max": max(pub) if pub else None,
            "within_30_days_pct": L.pct(sum(1 for d in pub if d <= 30), len(pub)),
        },
        "report_to_sent_days": {"n": len(to_sent), "median": L.median(to_sent), "p90": L.percentile_nearest_rank(to_sent, 90)},
        "sent_to_publication_days": {"n": len(sent_pub), "median": L.median(sent_pub), "p90": L.percentile_nearest_rank(sent_pub, 90)},
        "no_sent_date": sum(1 for r in reports if not r.sent_date),
        "sent_after_publication": sum(1 for r in sent_rows if r.sent_date > r.pub_date),
    }


def theme_counts(reports):
    counter = collections.Counter()
    for r in reports:
        counter.update(r.themes)
    return {tid: counter.get(tid, 0) for tid in L.THEMES}


def block(reports, level="full"):
    """Standard cohort block. level 'full' adds submitter, injury levels, states, categories, lags, record shares."""
    n = len(reports)
    sev = collections.Counter(r.severity for r in reports)
    age = collections.Counter(r.band for r in reports)
    out = {
        "reports": n,
        "severity": {key: sev.get(key, 0) for key in SEV_KEYS},
        "deaths": sev.get("death", 0),
        "injuries": sev.get("injury", 0),
        "age_bands": {key: age.get(key, 0) for key, _label in L.AGE_BANDS},
        "age_not_recorded": age.get("not_recorded", 0),
        "with_manufacturer_comment": sum(1 for r in reports if r.has_comment),
        "themes": theme_counts(reports),
    }
    for extra in ("not_recorded", "unmapped"):
        if sev.get(extra):
            out["severity"][extra] = sev[extra]
    out["manufacturer_comment_rate_pct"] = L.pct(out["with_manufacturer_comment"], n)
    if level == "full":
        out["submitter"] = dict(sorted(collections.Counter(r.submitter for r in reports).items(), key=lambda kv: (-kv[1], kv[0])))
        out["injury_levels"] = dict(sorted(collections.Counter(r.severity_raw or "Not recorded" for r in reports).items(), key=lambda kv: (-kv[1], kv[0])))
        out["product_categories"] = dict(sorted(collections.Counter(r.category for r in reports).items(), key=lambda kv: (-kv[1], kv[0])))
        out["states"] = states_block(reports)
        out["lag"] = lag_block(reports)
        out["model_nonblank_pct"] = L.pct(sum(1 for r in reports if r.model), n)
        out["model_informative_pct"] = L.pct(sum(1 for r in reports if not L.is_placeholder(r.model)), n)
        out["purchase_date_recorded_pct"] = L.pct(sum(1 for r in reports if r.purchase_date), n)
        out["brand_informative_pct"] = L.pct(sum(1 for r in reports if not L.is_placeholder(r.brand)), n)
        out["linked_reports"] = sum(1 for r in reports if r.assoc)
    return out


def yearly(reports, years, attr="pub_date"):
    counter = collections.Counter(getattr(r, attr).year for r in reports if getattr(r, attr))
    return [counter.get(y, 0) for y in years]


# ------------------------------------------------------------------ time series (dataset 1)

def series_rows(reports, ctx):
    """Per-year cohorts on both date axes, with YoY, YTD and change-since-2019 fields."""
    out = {"published": [], "reported": []}
    for axis, years, attr, partial in (("published", ctx.pub_years, "pub_date", ctx.pub_partial), ("reported", ctx.rep_years, "report_date", ctx.rep_partial)):
        counts = dict(zip(years, yearly(reports, years, attr)))
        for y in years:
            cohort = [r for r in reports if getattr(r, attr) and getattr(r, attr).year == y]
            b = block(cohort, "full" if axis == "published" else "lite")
            mfr_counts = collections.Counter(r.mfr for r in cohort if not L.is_placeholder(r.mfr))
            b["top_companies"] = top_items(mfr_counts, 5, "company")
            b["top5_company_share_pct"] = L.pct(sum(c for _n, c in sorted(mfr_counts.items(), key=lambda kv: (-kv[1], kv[0]))[:5]), len(cohort))
            b["distinct_company_strings"] = len(mfr_counts)
            b["company_not_recorded"] = sum(1 for r in cohort if L.is_placeholder(r.mfr))
            b["top_product_types"] = top_items(collections.Counter(r.ptype for r in cohort), 5, "type")
            prev = counts.get(y - 1)
            b["year"] = y
            b["partial"] = bool(partial(y))
            b["yoy_pct"] = L.change_pct(counts[y], prev) if prev else None
            b["yoy_comparable"] = bool(prev) and not partial(y) and not partial(y - 1)
            base = counts.get(BASE_YEAR)
            b["change_vs_2019_pct"] = L.change_pct(counts[y], base) if (y > BASE_YEAR and base and not partial(y)) else None
            if partial(y) and y == years[-1]:
                same = lambda d, yr: d is not None and d.year == yr and (d.month, d.day) <= ctx.cutoff  # noqa: E731
                prior_ytd = sum(1 for r in reports if same(getattr(r, attr), y - 1))
                base_ytd = sum(1 for r in reports if same(getattr(r, attr), BASE_YEAR))
                b["ytd"] = {
                    "through": "%02d-%02d" % ctx.cutoff,
                    "reports": counts[y],
                    "prior_year_same_window": prior_ytd,
                    "change_vs_prior_year_pct": L.change_pct(counts[y], prior_ytd),
                    "base_year_same_window": base_ytd,
                    "change_vs_2019_pct": L.change_pct(counts[y], base_ytd) if y > BASE_YEAR else None,
                }
                top_name, top_n = sorted(mfr_counts.items(), key=lambda kv: (-kv[1], kv[0]))[0]
                prior_without = sum(1 for r in reports if same(getattr(r, attr), y - 1) and r.mfr != top_name)
                b["ytd"]["excluding_largest_company"] = {
                    "company": top_name, "removed_reports": top_n, "reports": counts[y] - top_n,
                    "prior_year_same_window": prior_without, "change_vs_prior_year_pct": L.change_pct(counts[y] - top_n, prior_without),
                }
            out[axis].append(b)
    return out


def peak_year(rows, partial_key="partial"):
    """Peak among complete years (first max wins); also the peak counting partial years."""
    complete = [r for r in rows if not r[partial_key]]
    best = max(complete, key=lambda r: (r["reports"], -r["year"]))
    best_all = max(rows, key=lambda r: (r["reports"], -r["year"]))
    return {"year": best["year"], "reports": best["reports"], "including_partial_year": best_all["year"], "including_partial_reports": best_all["reports"]}


def monthly(reports):
    counter = collections.Counter((r.pub_date.year, r.pub_date.month) for r in reports if r.pub_date)
    return [{"month": "%04d-%02d" % ym, "reports": c} for ym, c in sorted(counter.items())]


# ------------------------------------------------------------------ products (dataset 2)

def model_clusters(reports, min_n=CLUSTER_MIN, top=5):
    """Same-model repeat reports: reports sharing an EXACT brand string and an EXACT model string (whitespace collapsed,
    case-sensitive, no fuzzy merge); placeholder values ('Unknown', 'N/A', ...) never form a cluster."""
    groups = collections.defaultdict(list)
    for r in reports:
        if L.is_placeholder(r.brand) or L.is_placeholder(r.model):
            continue
        groups[(r.brand, r.model)].append(r)
    clusters = []
    for (brand, model), rs in groups.items():
        if len(rs) < min_n:
            continue
        years = [r.pub_date.year for r in rs if r.pub_date]
        clusters.append({
            "brand": brand, "model": model, "reports": len(rs),
            "first_year": min(years) if years else None, "last_year": max(years) if years else None,
            "deaths": sum(1 for r in rs if r.severity == "death"), "injuries": sum(1 for r in rs if r.severity == "injury"),
            "manufacturer_strings": len({r.mfr for r in rs}),
        })
    clusters.sort(key=lambda c: (-c["reports"], c["brand"], c["model"]))
    return {
        "min_reports": min_n,
        "clusters": len(clusters),
        "reports_in_clusters": sum(c["reports"] for c in clusters),
        "top": clusters[:top],
    }


def growth_block(counts_by_year, ctx):
    """Recent 3 complete publication years vs the 3 before. Eligible only when BOTH windows have >= MIN_VOLUME reports."""
    recent = sum(counts_by_year.get(y, 0) for y in range(ctx.recent[0], ctx.recent[1] + 1))
    prior = sum(counts_by_year.get(y, 0) for y in range(ctx.prior[0], ctx.prior[1] + 1))
    eligible = recent >= MIN_VOLUME and prior >= MIN_VOLUME
    ratio = L.ratio_ci95(recent, prior)
    return {
        "recent_window": "%d–%d" % ctx.recent, "recent_reports": recent,
        "prior_window": "%d–%d" % ctx.prior, "prior_reports": prior,
        "change_pct": L.change_pct(recent, prior),
        "eligible": eligible,
        "ratio": ratio[0] if ratio else None,
        "ratio_ci95": [ratio[1], ratio[2]] if ratio else None,
        "ytd_reports": counts_by_year.get(ctx.pub_years[-1], 0) if ctx.pub_last_partial else None,
    }


def rank_growth(records, kind_key="kind"):
    """Add growth_rank (1 = fastest growing) among eligible records of the same kind."""
    by_kind = collections.defaultdict(list)
    for rec in records:
        if rec["growth"]["eligible"]:
            by_kind[rec[kind_key]].append(rec)
    for recs in by_kind.values():
        recs.sort(key=lambda r: (-r["growth"]["change_pct"], r["name"]))
        for i, rec in enumerate(recs, 1):
            rec["growth"]["rank"] = i
            rec["growth"]["rank_of"] = len(recs)
    for rec in records:
        rec["growth"].setdefault("rank", None)
        rec["growth"].setdefault("rank_of", None)


def scope_record(kind, name, reports, ctx, total, extra=None):
    """One product-classification record body (category, subcategory or type)."""
    b = block(reports, "lite")
    counts = dict(zip(ctx.pub_years, yearly(reports, ctx.pub_years)))
    brand_c = collections.Counter(r.brand for r in reports if not L.is_placeholder(r.brand))
    mfr_c = collections.Counter(r.mfr for r in reports if not L.is_placeholder(r.mfr))
    rec = {
        "kind": kind, "name": name, **(extra or {}),
        "reports": b["reports"], "share_of_all_pct": L.pct(b["reports"], total, 3),
        "severity": b["severity"], "deaths": b["deaths"], "injuries": b["injuries"],
        "age_bands": b["age_bands"], "age_not_recorded": b["age_not_recorded"],
        "yearly": [{"year": y, "reports": counts.get(y, 0), "partial": bool(ctx.pub_partial(y))} for y in ctx.pub_years],
        "top_brands": top_items(brand_c, 10, "brand"), "brand_not_recorded": sum(1 for r in reports if L.is_placeholder(r.brand)),
        "top_companies": top_items(mfr_c, 10, "company"), "distinct_company_strings": len(mfr_c),
        "company_not_recorded": sum(1 for r in reports if L.is_placeholder(r.mfr)),
        "states": states_block(reports, 10),
        "manufacturer_comment_rate_pct": b["manufacturer_comment_rate_pct"],
        "themes": b["themes"],
        "growth": growth_block(counts, ctx),
        "model_clusters": model_clusters(reports, top=5 if kind != "category" else 10),
    }
    return rec


# ------------------------------------------------------------------ companies (dataset 3)

def sec_index(lines):
    """company_key -> [(cik, title)] from 'cik|title' lines (the saved company_sec_profiles lookup)."""
    index = collections.defaultdict(list)
    for line in lines:
        line = line.rstrip("\n")
        if not line.strip():
            continue
        cik, title = line.split("|", 1)
        index[L.company_key(title)].append((cik, title))
    return index


def sec_match(name, index):
    """('matched', cik, title) only when exactly one SEC profile title has the same normalised key; ('ambiguous', ciks, titles)
    when several do; ('unmatched', None, None) otherwise. Match key and rule are recorded by the caller."""
    key = L.company_key(name)
    hits = index.get(key, []) if key else []
    if len(hits) == 1:
        return "matched", hits[0][0], hits[0][1]
    if len(hits) > 1:
        return "ambiguous", [h[0] for h in hits], [h[1] for h in hits]
    return "unmatched", None, None


def variants_for(name, role_counter, key_groups, limit=8):
    """Other recorded spellings of the same normalised key (listed as variants only; never added to the record's counts)."""
    key = L.company_key(name)
    others = [(s, c) for s, c in key_groups.get(key, {}).items() if s != name]
    others.sort(key=lambda kv: (-kv[1], kv[0]))
    return {"names": [{"name": s, "reports": c} for s, c in others[:limit]], "count": len(others), "reports_not_included": sum(c for _s, c in others)}


def company_record(role, name, reports, ctx, total, rank):
    b = block(reports, "lite")
    counts = dict(zip(ctx.pub_years, yearly(reports, ctx.pub_years)))
    cat_c = collections.Counter(r.category for r in reports)
    type_c = collections.Counter(r.ptype for r in reports)
    brand_c = collections.Counter(r.brand for r in reports if not L.is_placeholder(r.brand))
    dates = [r.pub_date for r in reports if r.pub_date]
    rec = {
        "role": role, "name": name, "rank": rank, "reports": b["reports"], "share_of_all_pct": L.pct(b["reports"], total, 3),
        "severity": b["severity"], "deaths": b["deaths"], "injuries": b["injuries"],
        "yearly": [{"year": y, "reports": counts.get(y, 0), "partial": bool(ctx.pub_partial(y))} for y in ctx.pub_years],
        "first_published": min(dates).isoformat() if dates else None, "last_published": max(dates).isoformat() if dates else None,
        "top_categories": top_items(cat_c, 5, "category"), "top_types": top_items(type_c, 5, "type"), "top_brands": top_items(brand_c, 5, "brand"),
        "themes": b["themes"],
    }
    if role == "manufacturer":
        rec["with_manufacturer_comment"] = b["with_manufacturer_comment"]
        rec["manufacturer_comment_rate_pct"] = b["manufacturer_comment_rate_pct"]
    return rec
