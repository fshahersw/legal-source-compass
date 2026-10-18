"""Build the CFPB consumer-finance datasets for legal-source-compass (build files only; the lead publishes).

Inputs (unchanged raw files under private/acq/cfpb/, listed in _manifest.jsonl):
  bulk/complaints.csv.zip           https://files.consumerfinance.gov/ccdb/complaints.csv.zip (streamed from the zip)
  census/NST-EST2025-ALLDATA.csv    Census Vintage 2025 state population estimates (2020-2025)
  census/nst-est2020-alldata.csv    Census Vintage 2020 state population estimates (2010-2020; 2012-2019 used)
  reports/page-NNN.html             CFPB research-report catalog list pages
  context/*.html                    CFPB definitions pages (database, process, data use, field reference, release notes)
Read-only corpus lookups (saved earlier): private/build/cfpb/lookups/company_sec_profiles_titles.json, corpus_dataset_ids.json

Writes private/build/cfpb/<dataset>.json with {dataset, label, listing_block, summary, rows, built_at, inputs} for
  cfpb_complaints_national, cfpb_complaints_states, cfpb_complaints_companies, cfpb_research_reports

Usage: python3 -I -B scripts/enrichment/cfpb/build_cfpb.py
"""
import collections
import glob
import hashlib
import json
import os
import re
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import corpus_writer as writer  # noqa: E402
import aggregate  # noqa: E402
from cfpb_lib import (  # noqa: E402
    NOT_RECORDED, SEP, build_name_index, cagr_pct, census_population, fmt_pct, growth_pct, hhi, is_credit_reporting, label,
    match_name, month_range, month_runs, normalize_name, pct, per_100k, response_rates, share_shift, slugify, sum_counters,
    sum_days, timely_exact, timely_rate, year_complete, year_months_recorded,
)
from reports import parse_page, slug_from_url  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "cfpb")
OUT = os.path.join(ROOT, "private", "build", "cfpb")
LOOKUPS = os.path.join(OUT, "lookups")

CSV_URL = "https://files.consumerfinance.gov/ccdb/complaints.csv.zip"
DB_URL = "https://www.consumerfinance.gov/data-research/consumer-complaints/"
SEARCH_URL = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/"
API_URL = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/"
WINDOW_URL = ("https://www.consumerfinance.gov/data-research/consumer-complaints/search/?dateRange=3y"
              "&date_received_max=2026-10-18&date_received_min=2023-10-18&page=1&searchField=all&size=25&sort=created_date_desc")
FIELDS_URL = "https://cfpb.github.io/api/ccdb/fields.html"
RELEASES_URL = "https://cfpb.github.io/api/ccdb/release-notes.html"
PROCESS_URL = "https://www.consumerfinance.gov/complaint/"
DATA_USE_URL = "https://www.consumerfinance.gov/complaint/data-use/"
REPORTS_URL = "https://www.consumerfinance.gov/data-research/research-reports/"
CENSUS_2025_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv"
CENSUS_2020_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2010-2020/state/totals/nst-est2020-alldata.csv"
CENSUS_2025_PAGE = "https://www.census.gov/data/datasets/time-series/demo/popest/2020s-state-total.html"
POLICY_URL = "https://www.consumerfinance.gov/privacy/website-privacy-policy/"
POLICY_QUOTE = ("Information created by the CFPB is in the public domain and you may reproduce, publish, or otherwise use it without the "
                "Bureau\u2019s permission. Please consider appropriate citation to the Bureau as the source.")

WINDOW = aggregate.WINDOW
PRIOR_WINDOW = aggregate.PRIOR_WINDOW
TOP_COMPANIES = 250
SHIFT_YEARS = ("2024", "2025")  # both complete years under the complaint form in use since August 2023
RISE_YEARS = ("2022", "2025")   # state per-capita rise: 3-year change between complete years with Vintage 2025 denominators

NOT_VERIFIED = ("A complaint records what a consumer (or someone on their behalf) submitted and how the company responded; "
                "it is not a verified finding of wrongdoing. The CFPB states that its Consumer Complaint Database “is not a "
                "statistical sample of consumers’ experiences in the marketplace and these complaints are not necessarily "
                "representative of all consumers’ experiences with a financial product or company”, and that complaints are "
                "not “information” for purposes of the Information Quality Act.")
PUBLICATION_RULE = ("Only complaints sent to companies for response are published, after the company responds (confirming a "
                    "commercial relationship) or after 15 days, whichever comes first; complaints referred to other regulators "
                    "(e.g. about depository institutions with less than $10 billion in assets) are not published. The most recent "
                    "weeks are therefore incomplete.")
DISPUTED = {
    "status": NOT_RECORDED,
    "reason": ("The 'Consumer disputed?' field is not in the current bulk CSV or search API: the CFPB discontinued the consumer "
               "dispute option on April 24, 2017 and removed the field from the export in Release 22 (June 2026). A live probe "
               "of the API with consumer_disputed=Yes returned the unfiltered total (18,504,768), i.e. the filter is ignored."),
    "historical_scope": "Recorded by the CFPB only for complaints received before April 24, 2017 (no longer published).",
    "sources": [RELEASES_URL],
}
TAXONOMY_NOTE = ("Products, sub-products, issues and sub-issues are shown exactly as recorded: the CFPB keeps each complaint's "
                 "original selections from the complaint form in use when it was submitted (form changes in December 2013, "
                 "April 2017 and August 2023), so names change across years.")

NO_TAG = "No tag"                           # blank Tags: none of the CFPB tags (e.g. Older American, Servicemember) applies
NO_PUBLIC_RESPONSE = "No public response"   # blank Company public response: the company published none (the field is optional)
RESPONDED = ("responded complaints = every company response except 'In progress' and blank "
             "(so it includes 'Closed', 'Closed without relief' and 'Untimely response')")
YTD_CAVEAT = ("the current-year span is not yet matured: complaints are published after the company responds or after 15 days, "
              "so the most recent weeks are incomplete and the change is understated")
NAME_CHANGE_NOTE = ("Not recorded: the product name was not recorded in every calendar month of both periods "
                    "(names change with the complaint-form revisions of April 2017 and August 2023), so the counts are not like-for-like")

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "DC": "11", "FL": "12",
    "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22", "ME": "23",
    "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44",
    "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55",
    "WY": "56", "PR": "72",
}
OTHER_CODES = {
    "PR": ("Puerto Rico", "territory"), "VI": ("U.S. Virgin Islands", "territory"), "GU": ("Guam", "territory"),
    "AS": ("American Samoa", "territory"), "MP": ("Northern Mariana Islands", "territory"),
    "UM": ("U.S. Minor Outlying Islands", "territory"),
    "FM": ("Federated States of Micronesia", "freely associated state"), "MH": ("Marshall Islands", "freely associated state"),
    "PW": ("Palau", "freely associated state"),
    "AA": ("Armed Forces Americas (military mail)", "military"), "AE": ("Armed Forces Europe/Africa/Middle East (military mail)", "military"),
    "AP": ("Armed Forces Pacific (military mail)", "military"),
}


# ----------------------------------------------------------------------------------------------------------------------
# small utilities

def facts_pairs(facts):
    return [[f[0], NOT_RECORDED if f[1] in (None, "") else str(f[1])] for f in facts]


def rec(dataset, rid, title, *, facts, **kwargs):
    """corpus_writer.record with facts given as (label, value) tuples; the entity view reads [label, value] pairs."""
    return writer.record(dataset, rid, title, facts=facts_pairs(facts), **kwargs)


def num(n):
    return "Not recorded" if n is None else f"{n:,}"


def num2(x):
    return NOT_RECORDED if x is None else f"{x:,.2f}"


def pct_label(x):
    """Percentage with 2 decimals, or more when 2 would show a non-zero remainder as 0.00% or 100.00%."""
    return fmt_pct(x)


def load_manifest():
    entries = {}
    with open(os.path.join(ACQ, "_manifest.jsonl"), encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                entry = json.loads(line)
                entries[entry["path"]] = entry  # latest retrieval of each path wins
    return entries


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parsed(agg, name):
    return [(tuple(k.split(SEP)), n) for k, n in agg[name].items()]


def tally(rows, keyfn, where=None):
    out = collections.Counter()
    for parts, n in rows:
        if where is None or where(parts):
            out[keyfn(parts)] += n
    return out


def series(rows, valuefn, yearfn, where=None):
    """{value: Counter(year -> n)}"""
    out = collections.defaultdict(collections.Counter)
    for parts, n in rows:
        if where is None or where(parts):
            out[valuefn(parts)][yearfn(parts)] += n
    return out


def breakdown(counts, years=None, limit=None, total=None, blank_label=None):
    """Sorted list of {value, complaints, share_pct[, years]} from {recorded value: n}.

    A blank recorded value is shown as Not recorded, or as blank_label for fields where blank has a defined meaning
    (Tags: no tag applies; Company public response: the company published none).
    """
    total = sum(counts.values()) if total is None else total
    items = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    if limit:
        items = items[:limit]
    out = []
    for value, n in items:
        row = {"value": (blank_label if (blank_label and value == "") else label(value)), "complaints": n, "share_pct": pct(n, total)}
        if years is not None:
            row["years"] = {y: c for y, c in sorted(years.get(value, {}).items())}
        out.append(row)
    return out


def in_window(w):
    return w == "2"


def used_options(rows, name, options):
    """Keep only the listing-filter options that at least one row carries (an option matching no rows is dropped)."""
    present = {v for r in rows for v in r["filters"].get(name, [])}
    return {k: v for k, v in options.items() if k in present}


# ----------------------------------------------------------------------------------------------------------------------
# population

def populations():
    fips_to_usps = {fips: usps for usps, fips in STATE_FIPS.items()}
    v2025 = census_population(os.path.join(ACQ, "census", "NST-EST2025-ALLDATA.csv"), [str(y) for y in range(2020, 2026)], fips_to_usps)
    v2020 = census_population(os.path.join(ACQ, "census", "nst-est2020-alldata.csv"), [str(y) for y in range(2012, 2020)], fips_to_usps)
    out = collections.defaultdict(dict)
    for usps, years in v2020.items():
        for year, value in years.items():
            out[usps][year] = {"population": value, "vintage": "Vintage 2020", "source": CENSUS_2020_URL}
    for usps, years in v2025.items():
        for year, value in years.items():
            out[usps][year] = {"population": value, "vintage": "Vintage 2025", "source": CENSUS_2025_URL}
    return dict(out)


# ----------------------------------------------------------------------------------------------------------------------
# national

def national_rows(agg, ctx):
    ds = "cfpb_complaints_national"
    day = agg["day"]
    meta = agg["meta"]
    min_day, max_day = meta["min_day"], meta["max_day"]
    nat, natx, natm, co, st = ctx["nat"], ctx["natx"], ctx["natm"], ctx["co"], ctx["st"]
    year_tot = collections.Counter()
    first_last = {}
    for d, n in day.items():
        year_tot[d[:4]] += n
        lo, hi = first_last.get(d[:4], (d, d))
        first_last[d[:4]] = (min(lo, d), max(hi, d))
    years = sorted(year_tot)
    complete = {y: year_complete(y, min_day, max_day) for y in years}
    months = collections.Counter()
    for d, n in day.items():
        months[d[:7]] += n
    total = sum(year_tot.values())

    prod_years = series(nat, lambda p: p[2], lambda p: p[0])
    prod_tot = {p: sum(v.values()) for p, v in prod_years.items()}
    prod_months = collections.defaultdict(dict)
    for (ym, product), n in natm:
        prod_months[product][ym] = prod_months[product].get(ym, 0) + n
    issue_years = series(nat, lambda p: SEP.join((p[2], p[4])), lambda p: p[0])
    via_years = series(natx, lambda p: p[3], lambda p: p[0])
    resp_years = series(natx, lambda p: p[4], lambda p: p[0])
    timely_years = series(natx, lambda p: p[5], lambda p: p[0])
    tag_years = series(natx, lambda p: p[6], lambda p: p[0])
    public_years = series(natx, lambda p: p[7], lambda p: p[0])
    company_year = series(co, lambda p: p[0], lambda p: p[1])

    def year_resp(y):
        return {r: v.get(y, 0) for r, v in resp_years.items() if v.get(y, 0)}

    def year_timely(y):
        return {t: v.get(y, 0) for t, v in timely_years.items() if v.get(y, 0)}

    # concentration per year
    per_year_company = collections.defaultdict(collections.Counter)
    for company, ys in company_year.items():
        for y, n in ys.items():
            per_year_company[y][company] += n
    concentration = []
    for y in years:
        counts = per_year_company[y]
        top3 = counts.most_common(3)
        concentration.append({"year": y, "complete": complete[y], "companies": len(counts),
                              "top3": [{"company": label(c), "complaints": n} for c, n in top3],
                              "top3_share_pct": pct(sum(n for _, n in top3), year_tot[y]), "hhi": hhi(counts)})

    year_rows = []
    for y in years:
        prev = str(int(y) - 1)
        rates = response_rates(year_resp(y))
        cr = sum(n for p, v in prod_years.items() if is_credit_reporting(p) for yy, n in v.items() if yy == y)
        top_product = max(((p, v.get(y, 0)) for p, v in prod_years.items()), key=lambda kv: (kv[1], kv[0]))
        year_rows.append({
            "year": y, "complaints": year_tot[y], "complete": complete[y], "first_day": first_last[y][0], "last_day": first_last[y][1],
            "yoy_pct": growth_pct(year_tot[y], year_tot.get(prev)) if (complete[y] and complete.get(prev)) else None,
            "timely_rate": timely_rate(year_timely(y))["rate"], "relief_rate": rates["relief_rate"],
            "monetary_relief_rate": rates["monetary_relief_rate"], "in_progress": rates["in_progress"],
            "credit_reporting_complaints": cr, "credit_reporting_share_pct": pct(cr, year_tot[y]),
            "top_product": label(top_product[0]), "top_product_complaints": top_product[1],
        })
    full_years = [y for y in years if complete[y]]
    last_full = full_years[-1]
    cur_year = max_day[:4]
    ytd_prev_end = f"{int(cur_year) - 1}{max_day[4:]}"
    ytd = {
        "current": {"from": f"{cur_year}-01-01", "to": max_day, "complaints": sum_days(day, f"{cur_year}-01-01", max_day)},
        "previous": {"from": f"{int(cur_year) - 1}-01-01", "to": ytd_prev_end, "complaints": sum_days(day, f"{int(cur_year) - 1}-01-01", ytd_prev_end)},
    }
    ytd["change_pct"] = growth_pct(ytd["current"]["complaints"], ytd["previous"]["complaints"])
    ytd["note"] = YTD_CAVEAT[0].upper() + YTD_CAVEAT[1:]

    shift_a = {p: v.get(SHIFT_YEARS[0], 0) for p, v in prod_years.items() if v.get(SHIFT_YEARS[0], 0)}
    shift_b = {p: v.get(SHIFT_YEARS[1], 0) for p, v in prod_years.items() if v.get(SHIFT_YEARS[1], 0)}
    win_prod = tally(nat, lambda p: p[2], lambda p: p[1] == "2")
    prior_prod = tally(nat, lambda p: p[2], lambda p: p[1] == "1")

    def shift_rows(a, b, la, lb):
        return [{"product": label(r["name"]), f"complaints_{la}": r["n_a"], f"complaints_{lb}": r["n_b"],
                 f"share_{la}_pct": r["share_a"], f"share_{lb}_pct": r["share_b"], "shift_pp": r["shift_pp"]}
                for r in share_shift(a, b)]

    resp_all = {r: sum(v.values()) for r, v in resp_years.items()}
    timely_all = {t: sum(v.values()) for t, v in timely_years.items()}
    analytics = {
        "yoy": [{"year": r["year"], "complaints": r["complaints"], "yoy_pct": r["yoy_pct"]} for r in year_rows if r["yoy_pct"] is not None],
        "cagr": [
            {"from": "2012", "to": last_full, "years": int(last_full) - 2012, "pct": cagr_pct(year_tot[last_full], year_tot["2012"], int(last_full) - 2012)},
            {"from": "2020", "to": last_full, "years": int(last_full) - 2020, "pct": cagr_pct(year_tot[last_full], year_tot["2020"], int(last_full) - 2020)},
        ],
        "ytd": ytd,
        "product_share_shift": {"from": SHIFT_YEARS[0], "to": SHIFT_YEARS[1], "rows": shift_rows(shift_a, shift_b, SHIFT_YEARS[0], SHIFT_YEARS[1])},
        "product_share_shift_windows": {"from": f"{PRIOR_WINDOW[0]}..{PRIOR_WINDOW[1]}", "to": f"{WINDOW[0]}..{WINDOW[1]}",
                                        "note": "Spans the August 2023 form change, so renamed products appear as a drop in one name and a rise in another.",
                                        "rows": shift_rows(prior_prod, win_prod, "prior_window", "window")},
        "concentration": concentration,
    }

    top_issues = sorted(((k, sum(v.values())) for k, v in issue_years.items()), key=lambda kv: (-kv[1], kv[0]))[:40]
    national = {
        "scope": "all", "period": {"from": min_day, "to": max_day}, "complaints": total, "csv_rows": meta["rows"],
        "companies": len(company_year), "states_recorded": len({p[0] for p, _ in st if p[0] != ""}),
        "state_not_recorded_complaints": sum(n for p, n in st if p[0] == ""),
        "timely": timely_rate(timely_all), "responses": response_rates(resp_all),
        "years": year_rows,
        "months": [{"month": m, "complaints": months[m]} for m in sorted(months)],
        "products": [{**row, "first_month": min(prod_months[p]) if prod_months.get(p) else None,
                      "last_month": max(prod_months[p]) if prod_months.get(p) else None}
                     for row, p in ((r, r["value"] if r["value"] != NOT_RECORDED else "") for r in breakdown(prod_tot, prod_years))],
        "product_months": {label(p): sorted(m.items()) for p, m in sorted(prod_months.items())},
        "top_issues": [{"product": label(k.split(SEP)[0]), "issue": label(k.split(SEP)[1]), "complaints": n,
                        "share_pct": pct(n, total), "years": dict(sorted(issue_years[k].items()))} for k, n in top_issues],
        "submitted_via": breakdown({k: sum(v.values()) for k, v in via_years.items()}, via_years),
        "company_response": breakdown(resp_all, resp_years),
        "timely_response": breakdown(timely_all, timely_years),
        "tags": breakdown({k: sum(v.values()) for k, v in tag_years.items()}, tag_years, blank_label=NO_TAG),
        "company_public_response": breakdown({k: sum(v.values()) for k, v in public_years.items()}, public_years, blank_label=NO_PUBLIC_RESPONSE),
        "consumer_disputed": DISPUTED,
        "analytics": analytics,
    }
    src_facts = [("Source", "CFPB Consumer Complaint Database bulk CSV (complaints.csv.zip)"),
                 ("Retrieved", ctx["retrieved"]), ("CSV file date", ctx["zip_info"]["member_date"]),
                 ("Coverage", f"Date received {min_day} to {max_day}"), ("Units", "Complaints (one row per complaint ID)")]
    rows = []
    rows.append(rec(
        ds, "cfpb-national:all", "Consumer complaints — all history (national)", source_url=CSV_URL,
        subtitle=f"{total:,} complaints received {min_day} to {max_day} · timely response {pct_label(national['timely']['rate'])}",
        cells={"scope": "All history", "period": f"{min_day} – {max_day}", "complaints": total, "change": None,
               "timely_rate": national["timely"]["rate"], "relief_rate": national["responses"]["relief_rate"],
               "top_product": national["products"][0]["value"]},
        facts=src_facts + [
            ("Complaints", num(total)), ("Companies named", num(national["companies"])),
            ("Timely response rate", f"{pct_label(national['timely']['rate'])} (Yes / (Yes + No))"),
            ("Relief rate (responded complaints)", pct_label(national["responses"]["relief_rate"])),
            (f"Year-over-year {last_full}", pct_label(next(r["yoy_pct"] for r in year_rows if r["year"] == last_full))),
            (f"{cur_year} to date vs same period {int(cur_year) - 1}", f"{num(ytd['current']['complaints'])} vs {num(ytd['previous']['complaints'])} ({pct_label(ytd['change_pct'])}); {YTD_CAVEAT}"),
            ("Consumer disputed", f"{NOT_RECORDED} — {DISPUTED['reason']}"),
            ("Not findings of wrongdoing", NOT_VERIFIED), ("Publication rule", PUBLICATION_RULE), ("Product names", TAXONOMY_NOTE),
        ],
        text="CFPB consumer complaints national " + " ".join(r["value"] for r in national["products"]),
        filters={"kind": ["all"]}, badges=["All history", "National"],
        links=[{"label": "Consumer Complaint Database", "url": DB_URL}, {"label": "Bulk CSV (ZIP)", "url": CSV_URL},
               {"label": "Field reference", "url": FIELDS_URL}, {"label": "Release notes", "url": RELEASES_URL}],
        extra={"national": national},
    ))

    # ---- 3-year window of the search URL
    w_total = sum(n for (_, w, *_rest), n in nat if w == "2")
    p_total = sum(n for (_, w, *_rest), n in nat if w == "1")
    w_end = min(WINDOW[1], max_day)
    w_months = collections.Counter()
    for d, n in day.items():
        if WINDOW[0] <= d <= WINDOW[1]:
            w_months[d[:7]] += n
    w_sub = tally(nat, lambda p: SEP.join((p[2], p[3])), lambda p: p[1] == "2")
    w_iss = tally(nat, lambda p: SEP.join((p[2], p[4])), lambda p: p[1] == "2")
    w_via = tally(natx, lambda p: p[3], lambda p: p[1] == "2")
    w_resp = tally(natx, lambda p: p[4], lambda p: p[1] == "2")
    w_timely = tally(natx, lambda p: p[5], lambda p: p[1] == "2")
    w_tags = tally(natx, lambda p: p[6], lambda p: p[1] == "2")
    w_public = tally(natx, lambda p: p[7], lambda p: p[1] == "2")
    w_comp = tally(co, lambda p: p[0], lambda p: p[2] == "2")
    w_state = tally(st, lambda p: p[0], lambda p: p[2] == "2")
    p_comp = tally(co, lambda p: p[0], lambda p: p[2] == "1")

    def nested(prod_counts, child_counts, limit_children=None):
        out = []
        for row in breakdown(prod_counts, total=w_total):
            raw = "" if row["value"] == NOT_RECORDED else row["value"]
            kids = {k.split(SEP)[1]: n for k, n in child_counts.items() if k.split(SEP)[0] == raw}
            out.append({**row, "children": breakdown(kids, limit=limit_children, total=row["complaints"])})
        return out

    window = {
        "scope": "window", "from": WINDOW[0], "to": WINDOW[1], "data_through": w_end, "search_url": WINDOW_URL,
        "bounds": "Both bounds inclusive by Date received (the search API's date_received_min/max semantics, verified by a one-day probe).",
        "complaints": w_total, "share_of_all_pct": pct(w_total, total),
        "prior_window": {"from": PRIOR_WINDOW[0], "to": PRIOR_WINDOW[1], "complaints": p_total},
        "change_vs_prior_pct": growth_pct(w_total, p_total),
        "months": [{"month": m, "complaints": w_months[m], "partial": m in (WINDOW[0][:7], w_end[:7])} for m in sorted(w_months)],
        "products": nested(win_prod, w_sub),
        "issues": nested(win_prod, w_iss, limit_children=25),
        "submitted_via": breakdown(w_via), "company_response": breakdown(w_resp), "responses": response_rates(w_resp),
        "timely_response": breakdown(w_timely), "timely": timely_rate(w_timely), "tags": breakdown(w_tags, blank_label=NO_TAG),
        "company_public_response": breakdown(w_public, blank_label=NO_PUBLIC_RESPONSE),
        "top_companies": [{**row, "prior_window": p_comp.get("" if row["value"] == NOT_RECORDED else row["value"], 0),
                           "change_vs_prior_pct": growth_pct(row["complaints"], p_comp.get("" if row["value"] == NOT_RECORDED else row["value"], 0))}
                          for row in breakdown(w_comp, limit=50)],
        "companies": len(w_comp),
        "states": breakdown(w_state),
        "product_share_shift_vs_prior": analytics["product_share_shift_windows"],
        "consumer_disputed": DISPUTED,
    }
    rows.append(rec(
        ds, "cfpb-national:window-2023-10-18-2026-10-18", "Consumer complaints — 3-year window 2023-10-18 to 2026-10-18",
        source_url=WINDOW_URL,
        subtitle=f"{w_total:,} complaints ({pct_label(window['share_of_all_pct'])} of all history) · {pct_label(window['change_vs_prior_pct'])} vs preceding 3 years",
        cells={"scope": "3-year window", "period": f"{WINDOW[0]} – {WINDOW[1]}", "complaints": w_total, "change": window["change_vs_prior_pct"],
               "timely_rate": window["timely"]["rate"], "relief_rate": window["responses"]["relief_rate"], "top_product": window["products"][0]["value"]},
        facts=[("Source", "CFPB Consumer Complaint Database bulk CSV, filtered to the search URL's date range"),
               ("Retrieved", ctx["retrieved"]), ("Window", f"Date received {WINDOW[0]} to {WINDOW[1]} (inclusive); data through {w_end}"),
               ("Units", "Complaints"), ("Complaints", num(w_total)),
               ("Preceding window", f"{PRIOR_WINDOW[0]} to {PRIOR_WINDOW[1]}: {num(p_total)} complaints"),
               ("Change vs preceding window", f"{pct_label(window['change_vs_prior_pct'])} ((window − prior) / prior × 100)"),
               ("Companies named", num(len(w_comp))), ("Timely response rate", pct_label(window["timely"]["rate"])),
               ("Not findings of wrongdoing", NOT_VERIFIED), ("Publication rule", PUBLICATION_RULE)],
        text="CFPB consumer complaints last three years window " + " ".join(r["value"] for r in window["products"]),
        filters={"kind": ["window"]}, badges=["3-year window", "National"],
        links=[{"label": "Search (same date range)", "url": WINDOW_URL}, {"label": "Bulk CSV (ZIP)", "url": CSV_URL}],
        extra={"window": window},
    ))

    # ---- per year
    for r in year_rows:
        y = r["year"]
        y_sub = tally(nat, lambda p: SEP.join((p[2], p[3])), lambda p: p[0] == y)
        y_iss = tally(nat, lambda p: SEP.join((p[2], p[4])), lambda p: p[0] == y)
        y_prod = tally(nat, lambda p: p[2], lambda p: p[0] == y)
        y_comp = per_year_company[y]
        y_state = tally(st, lambda p: p[0], lambda p: p[1] == y)
        prev = str(int(y) - 1)
        prev_comp = per_year_company.get(prev, {})

        def kids(counts, product):
            return {k.split(SEP)[1]: n for k, n in counts.items() if k.split(SEP)[0] == product}

        detail = {
            **r,
            "months": [{"month": m, "complaints": months[m]} for m in sorted(months) if m.startswith(y)],
            "products": [{**row, "sub_products": breakdown(kids(y_sub, "" if row["value"] == NOT_RECORDED else row["value"]), total=row["complaints"]),
                          "issues": breakdown(kids(y_iss, "" if row["value"] == NOT_RECORDED else row["value"]), total=row["complaints"])}
                         for row in breakdown(y_prod)],
            "submitted_via": breakdown({k: v.get(y, 0) for k, v in via_years.items() if v.get(y, 0)}),
            "company_response": breakdown(year_resp(y)), "responses": response_rates(year_resp(y)),
            "timely_response": breakdown(year_timely(y)),
            "tags": breakdown({k: v.get(y, 0) for k, v in tag_years.items() if v.get(y, 0)}, blank_label=NO_TAG),
            "company_public_response": breakdown({k: v.get(y, 0) for k, v in public_years.items() if v.get(y, 0)}, blank_label=NO_PUBLIC_RESPONSE),
            "top_companies": [{**row, "previous_year": prev_comp.get(row["value"], 0) if prev in per_year_company else None,  # None: year outside coverage
                               "yoy_pct": growth_pct(row["complaints"], prev_comp.get(row["value"], 0)) if (complete[y] and complete.get(prev)) else None}
                              for row in breakdown(y_comp, limit=25)],
            "companies": len(y_comp),
            "states": breakdown(y_state, limit=60),
            "concentration": next(c for c in concentration if c["year"] == y),
        }
        coverage = "complete calendar year" if r["complete"] else f"partial year: {r['first_day']} to {r['last_day']}"
        rows.append(rec(
            ds, f"cfpb-national:year:{y}", f"Consumer complaints — {y} (national)", source_url=CSV_URL,
            subtitle=f"{r['complaints']:,} complaints · {coverage}" + (f" · {pct_label(r['yoy_pct'])} vs {prev}" if r["yoy_pct"] is not None else ""),
            cells={"scope": f"Year {y}", "period": f"{r['first_day']} – {r['last_day']}", "complaints": r["complaints"], "change": r["yoy_pct"],
                   "timely_rate": r["timely_rate"], "relief_rate": r["relief_rate"], "top_product": r["top_product"]},
            facts=src_facts[:3] + [("Period", f"{r['first_day']} to {r['last_day']} ({coverage})"), ("Units", "Complaints"),
                                   ("Complaints", num(r["complaints"])),
                                   ("Year-over-year change", pct_label(r["yoy_pct"]) if r["yoy_pct"] is not None else "Not recorded (needs two complete years)"),
                                   ("Timely response rate", pct_label(r["timely_rate"])), ("Relief rate (responded)", pct_label(r["relief_rate"])),
                                   ("Credit reporting share", pct_label(r["credit_reporting_share_pct"])),
                                   ("Top-3 company share", pct_label(detail["concentration"]["top3_share_pct"])),
                                   ("Not findings of wrongdoing", NOT_VERIFIED)],
            text=f"CFPB consumer complaints {y} " + " ".join(row["value"] for row in detail["products"]),
            filters={"kind": ["year"], "year": [y], "complete": ["yes" if r["complete"] else "no"]},
            badges=[f"Year {y}"] + ([] if r["complete"] else ["Partial year"]),
            links=[{"label": "Bulk CSV (ZIP)", "url": CSV_URL}, {"label": "Consumer Complaint Database", "url": DB_URL}],
            extra={"year": detail},
        ))

    # ---- per product
    prod_sub = series(nat, lambda p: SEP.join((p[2], p[3])), lambda p: p[0])
    prod_resp = series(natx, lambda p: SEP.join((p[2], p[4])), lambda p: p[0])
    prod_timely = series(natx, lambda p: SEP.join((p[2], p[5])), lambda p: p[0])
    prod_via = series(natx, lambda p: SEP.join((p[2], p[3])), lambda p: p[0])
    prod_comp = series(co, lambda p: p[3], lambda p: p[0])   # {product: Counter(company -> n)}
    prod_state = series(st, lambda p: p[3], lambda p: p[0])  # {product: Counter(state -> n)}
    used = set()
    # a change between two periods is like-for-like only when the product name was recorded in every calendar month of both
    window_months = month_range(*PRIOR_WINDOW) + month_range(*WINDOW)
    for product, n in sorted(prod_tot.items(), key=lambda kv: (-kv[1], kv[0])):
        slug = slugify(product or "not-recorded")
        if slug in used:
            slug = slug + "-" + hashlib.sha1(product.encode()).hexdigest()[:6]
        used.add(slug)

        def children(series_map):
            sub = {}
            years_map = {}
            for key, ys in series_map.items():
                pr, child = key.split(SEP)
                if pr == product:
                    sub[child] = sum(ys.values())
                    years_map[child] = ys
            return sub, years_map

        subs, subs_y = children(prod_sub)
        iss, iss_y = children(issue_years)
        rsp, rsp_y = children(prod_resp)
        tml, _ = children(prod_timely)
        via, via_y = children(prod_via)
        comps = prod_comp.get(product, {})
        states = prod_state.get(product, {})
        w_n, p_n = win_prod.get(product, 0), prior_prod.get(product, 0)
        ys = prod_years[product]
        pm = prod_months.get(product, {})
        runs = month_runs(pm)
        window_comparable = all(m in pm for m in window_months)

        def product_year(y, ys=ys, pm=pm):
            prev = str(int(y) - 1)
            recorded, recorded_prev = year_months_recorded(pm, y), year_months_recorded(pm, prev)
            if not (complete[y] and complete.get(prev)):
                yoy, note = None, "Not recorded: needs two complete calendar years"
            elif recorded < 12 or recorded_prev < 12:
                yoy, note = None, f"Not recorded: the product name was recorded in {recorded} of 12 months of {y} and {recorded_prev} of 12 months of {prev}"
            else:
                yoy, note = growth_pct(ys.get(y, 0), ys.get(prev, 0)), None
            return {"year": y, "complaints": ys.get(y, 0), "share_of_year_pct": pct(ys.get(y, 0), year_tot[y]),
                    "months_recorded": recorded, "yoy_pct": yoy, "yoy_note": note}

        detail = {
            "product": label(product), "complaints": n, "share_of_all_pct": pct(n, total),
            "first_month": min(pm) if pm else None,
            "last_month": max(pm) if pm else None,
            "name_runs": [{"from": a, "to": b} for a, b in runs],
            "years": [product_year(y) for y in years if ys.get(y, 0)],  # years with complaints only (no all-zero rows)
            "months": sorted(pm.items()),
            "sub_products": breakdown(subs, subs_y, total=n), "issues": breakdown(iss, iss_y, total=n),
            "company_response": breakdown(rsp, rsp_y, total=n), "responses": response_rates(rsp), "timely": timely_rate(tml),
            "submitted_via": breakdown(via, via_y, total=n),
            "top_companies": breakdown(dict(comps), limit=25, total=n),
            "top_states": breakdown(dict(states), limit=15, total=n),
            "window": {"complaints": w_n, "prior_window": p_n, "comparable": window_comparable,
                       "change_pct": growth_pct(w_n, p_n) if window_comparable else None,
                       "note": None if window_comparable else NAME_CHANGE_NOTE},
        }
        name_runs = "; ".join(f"{a} to {b}" for a, b in runs)
        rows.append(rec(
            ds, f"cfpb-national:product:{slug}", f"Consumer complaints — {label(product)}", source_url=CSV_URL,
            subtitle=f"{n:,} complaints · {name_runs} · {pct_label(detail['share_of_all_pct'])} of all",
            cells={"scope": "Product", "period": name_runs.replace(" to ", " – "), "complaints": n, "change": detail["window"]["change_pct"],
                   "timely_rate": detail["timely"]["rate"], "relief_rate": detail["responses"]["relief_rate"], "top_product": label(product)},
            facts=src_facts + [("Product (as recorded)", label(product)), ("Complaints", num(n)),
                               ("Name recorded in", f"{name_runs} (months with complaints under this exact product name; a gap of more than 12 empty months starts a new run)"),
                               ("3-year window vs preceding", f"{num(w_n)} vs {num(p_n)} ({pct_label(detail['window']['change_pct']) if window_comparable else NAME_CHANGE_NOTE})"),
                               ("Timely response rate", pct_label(detail["timely"]["rate"])), ("Relief rate (responded)", pct_label(detail["responses"]["relief_rate"])),
                               ("Product names", TAXONOMY_NOTE), ("Not findings of wrongdoing", NOT_VERIFIED)],
            text=f"CFPB consumer complaints product {label(product)} " + " ".join(r["value"] for r in detail["sub_products"][:20]),
            filters={"kind": ["product"]}, badges=["Product"],
            links=[{"label": "Bulk CSV (ZIP)", "url": CSV_URL}, {"label": "Past product and issue changes", "url": DB_URL}],
            extra={"product": detail},
        ))
    return rows, national, window, year_rows


# ----------------------------------------------------------------------------------------------------------------------
# states

def state_kind(code):
    if code == "":
        return NOT_RECORDED, "unrecorded"
    if code == "DC":
        return STATE_NAMES[code], "district"
    if code in STATE_NAMES:
        return STATE_NAMES[code], "state"
    if code in OTHER_CODES:
        return OTHER_CODES[code]
    return f"{code} (as recorded)", "other"


def state_rows(agg, ctx, national_total, pops=None):
    ds = "cfpb_complaints_states"
    st, stx, sti, cos = ctx["st"], ctx["stx"], ctx["sti"], ctx["cos"]
    meta = agg["meta"]
    min_day, max_day = meta["min_day"], meta["max_day"]
    pops = populations() if pops is None else pops
    by_state_year_prod = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    by_state_timely = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    win = collections.defaultdict(collections.Counter)
    prior = collections.defaultdict(collections.Counter)
    for (code, year, w, product, timely), n in st:
        by_state_year_prod[code][year][product] += n
        by_state_timely[code][year][timely] += n
        if w == "2":
            win[code][product] += n
        elif w == "1":
            prior[code][product] += n
    resp = collections.defaultdict(collections.Counter)
    for (code, year, w, response), n in stx:
        resp[code][response] += n
    issues_w = collections.defaultdict(collections.Counter)
    for (code, w, product, issue), n in sti:
        if w == "2":
            issues_w[code][SEP.join((product, issue))] += n
    comp_all = collections.defaultdict(collections.Counter)
    comp_w = collections.defaultdict(collections.Counter)
    for (company, code, w), n in cos:
        comp_all[code][company] += n
        if w == "2":
            comp_w[code][company] += n

    years = sorted({y for code in by_state_year_prod for y in by_state_year_prod[code]})
    complete = {y: year_complete(y, min_day, max_day) for y in years}
    profiles = {}
    for code in sorted(by_state_year_prod):
        name, kind = state_kind(code)
        yp = by_state_year_prod[code]
        total = sum(sum(c.values()) for c in yp.values())
        prod_tot = collections.Counter()
        prod_years = collections.defaultdict(dict)
        for y, c in yp.items():
            for p, n in c.items():
                prod_tot[p] += n
                prod_years[p][y] = n
        year_rows = []
        for y in years:
            n = sum(yp.get(y, {}).values())
            excl = sum(v for p, v in yp.get(y, {}).items() if not is_credit_reporting(p))
            pop = pops.get(code, {}).get(y) if complete[y] else None
            prev = str(int(y) - 1)
            n_prev = sum(yp.get(prev, {}).values())
            year_rows.append({
                "year": y, "complaints": n, "complete": complete[y],
                "yoy_pct": growth_pct(n, n_prev) if (complete[y] and complete.get(prev)) else None,
                "excluding_credit_reporting": excl,
                "population": pop["population"] if pop else None, "population_vintage": pop["vintage"] if pop else None,
                "per_100k": per_100k(n, pop["population"]) if pop else None,
                "excl_credit_reporting_per_100k": per_100k(excl, pop["population"]) if pop else None,
                "timely_rate": timely_rate(by_state_timely[code].get(y, {}))["rate"],
            })
        w_total, p_total = sum(win[code].values()), sum(prior[code].values())
        profiles[code] = {
            "code": code if code else "NR", "recorded_value": code, "name": name, "kind": kind,
            "complaints": total, "share_of_national_pct": pct(total, national_total),
            "years": year_rows,
            "products": breakdown(prod_tot, prod_years, total=total),
            "company_response": breakdown(resp[code], total=total), "responses": response_rates(resp[code]),
            "timely": timely_rate(sum_counters(by_state_timely[code].values())),  # all years added together
            "top_companies": breakdown(comp_all[code], limit=15, total=total),
            "window": {"from": WINDOW[0], "to": WINDOW[1], "complaints": w_total, "prior_window": p_total,
                       "change_vs_prior_pct": growth_pct(w_total, p_total),
                       "products": breakdown(win[code], total=w_total),
                       "top_issues": [{"product": label(r["value"].split(SEP)[0]) if SEP in r["value"] else r["value"],
                                       "issue": label(r["value"].split(SEP)[1]) if SEP in r["value"] else NOT_RECORDED,
                                       "complaints": r["complaints"], "share_pct": r["share_pct"]}
                                      for r in breakdown(issues_w[code], limit=15, total=w_total)],
                       "top_companies": breakdown(comp_w[code], limit=15, total=w_total)},
            "analytics": {},
        }

    # analytics: per-capita levels and rises for the 50 states + DC
    a, b = RISE_YEARS
    ranked = [p for c, p in profiles.items() if p["kind"] in ("state", "district")]

    def yr(p, y, field):
        return next((r[field] for r in p["years"] if r["year"] == y), None)

    for p in ranked:
        ra, rb = yr(p, a, "per_100k"), yr(p, b, "per_100k")
        ea, eb = yr(p, a, "excl_credit_reporting_per_100k"), yr(p, b, "excl_credit_reporting_per_100k")
        r24 = yr(p, "2024", "per_100k")
        p["analytics"] = {
            f"per_100k_{a}": ra, f"per_100k_{b}": rb,
            "rate_change_pct": growth_pct(rb, ra), "rate_change_points": round(rb - ra, 2) if (ra is not None and rb is not None) else None,
            f"excl_credit_reporting_per_100k_{a}": ea, f"excl_credit_reporting_per_100k_{b}": eb,
            "excl_credit_reporting_rate_change_pct": growth_pct(eb, ea),
            "rate_change_pct_2024_2025": growth_pct(rb, r24),
        }

    def assign(field, rank_field, reverse=True):
        order = sorted((p for p in ranked if p["analytics"].get(field) is not None),
                       key=lambda p: ((-p["analytics"][field]) if reverse else p["analytics"][field], p["code"]))
        for pos, p in enumerate(order, 1):
            p["analytics"][rank_field] = pos
        return [{"code": p["code"], "name": p["name"], "value": p["analytics"][field], "rank": p["analytics"][rank_field]} for p in order]

    def national_cr_share(y):
        total_y = sum(yr(pr, y, "complaints") or 0 for pr in profiles.values())
        excl_y = sum(yr(pr, y, "excluding_credit_reporting") or 0 for pr in profiles.values())
        return pct(total_y - excl_y, total_y)

    cr_share = {a: national_cr_share(a), b: national_cr_share(b)}
    rankings = {
        f"per_100k_{b}": assign(f"per_100k_{b}", f"rank_per_100k_{b}"),
        "rate_change_pct": assign("rate_change_pct", "rank_rate_rise"),
        "rate_change_pct_2024_2025": assign("rate_change_pct_2024_2025", "rank_rate_rise_2024_2025"),
        f"excl_credit_reporting_per_100k_{b}": assign(f"excl_credit_reporting_per_100k_{b}", f"rank_excl_credit_reporting_per_100k_{b}"),
        "excl_credit_reporting_rate_change_pct": assign("excl_credit_reporting_rate_change_pct", "rank_excl_credit_reporting_rate_rise"),
    }

    rows = []
    for code, p in sorted(profiles.items(), key=lambda kv: (kv[1]["kind"] not in ("state", "district"), kv[1]["code"])):
        link = [{"label": f"{p['name']} place profile", "url": f"/places/{code}"}] if p["kind"] in ("state", "district") else []
        pop_b = next((r for r in p["years"] if r["year"] == b), {})
        a_rate = pop_b.get("per_100k")
        src_b = CENSUS_2025_URL if pop_b.get("population_vintage") == "Vintage 2025" else CENSUS_2020_URL
        facts = [("Source", "CFPB Consumer Complaint Database bulk CSV (State = state of the consumer's mailing address)"),
                 ("Retrieved", ctx["retrieved"]), ("Coverage", f"Date received {min_day} to {max_day}"), ("Units", "Complaints"),
                 ("State value as recorded", p["recorded_value"] or "(blank)"), ("Complaints", num(p["complaints"])),
                 ("Share of national complaints", pct_label(p["share_of_national_pct"])),
                 (f"3-year window {WINDOW[0]} to {WINDOW[1]}", f"{num(p['window']['complaints'])} ({pct_label(p['window']['change_vs_prior_pct'])} vs preceding 3 years)"),
                 ("Timely response rate", f"{pct_label(p['timely']['rate'])} (all years; Yes / (Yes + No) = {num(p['timely']['yes'])} / {num(p['timely']['yes'] + p['timely']['no'])}; {num(p['timely']['no'])} untimely)")]
        if a_rate is not None:
            facts.append((f"Complaints per 100,000 residents ({b})", f"{a_rate:,.2f} (complaints received in {b} / Census {pop_b.get('population_vintage')} July 1, {b} resident population estimate {num(pop_b.get('population'))} × 100,000; {src_b})"))
            if p["analytics"]:
                facts.append((f"Change in rate {a}–{b}", f"{pct_label(p['analytics']['rate_change_pct'])} (rank {p['analytics'].get('rank_rate_rise')} of {len(rankings['rate_change_pct'])} by fastest rise; 50 states + DC). "
                              f"Excluding credit-reporting products: {pct_label(p['analytics']['excl_credit_reporting_rate_change_pct'])} (rank {p['analytics'].get('rank_excl_credit_reporting_rate_rise')} of {len(rankings['excl_credit_reporting_rate_change_pct'])}); "
                              f"credit reporting was {pct_label(cr_share[a])} of national complaints in {a} and {pct_label(cr_share[b])} in {b}"))
            else:
                facts.append(("Rankings", "Not ranked (rankings cover the 50 states and DC)"))
        else:
            facts.append(("Complaints per 100,000 residents", "Not recorded (no Census state population estimate for this code)"))
        facts.append(("Not findings of wrongdoing", NOT_VERIFIED))
        rows.append(rec(
            ds, f"cfpb-state:{p['code'] if re.fullmatch(r'[A-Z]{2}', p['code']) else slugify(p['code'])}",
            f"{p['name']} — consumer complaints", source_url=CSV_URL,
            subtitle=f"{p['complaints']:,} complaints · {pct_label(p['share_of_national_pct'])} of national" + (f" · {a_rate:,.2f} per 100k residents in {b}" if a_rate is not None else ""),
            state=code if p["kind"] in ("state", "district") else "",
            cells={"state": p["name"], "kind": p["kind"], "complaints": p["complaints"], "window": p["window"]["complaints"],
                   f"per_100k_{b}": a_rate, "rate_change_pct": p["analytics"].get("rate_change_pct"), "timely_rate": p["timely"]["rate"]},
            facts=facts,
            text=" ".join([p["name"], p["code"], "consumer complaints CFPB"] + [r["value"] for r in p["top_companies"][:10]]),
            filters={"kind": [p["kind"]]}, badges=[p["kind"].capitalize()],
            links=link + [{"label": "Bulk CSV (ZIP)", "url": CSV_URL}] + ([{"label": "Census Vintage 2025 state population", "url": CENSUS_2025_URL},
                                                                           {"label": "Census Vintage 2020 state population", "url": CENSUS_2020_URL}] if a_rate is not None else []),
            extra={"state_profile": p},
        ))
    def median_of(field):
        values = [p["analytics"][field] for p in ranked if p["analytics"].get(field) is not None]
        return round(statistics.median(values), 2) if values else None

    medians = {f"per_100k_{b}": median_of(f"per_100k_{b}"), "rate_change_pct": median_of("rate_change_pct"),
               f"excl_credit_reporting_per_100k_{b}": median_of(f"excl_credit_reporting_per_100k_{b}"),
               "excl_credit_reporting_rate_change_pct": median_of("excl_credit_reporting_rate_change_pct"), "jurisdictions": len(ranked)}
    rows.append(rec(
        ds, "cfpb-states:analytics", "State complaint-rate rankings", source_url=CSV_URL,
        subtitle=f"Complaints per 100,000 residents {b} and fastest-rising rates {a}–{b}, 50 states and DC",
        cells={"state": "Rankings (50 states + DC)", "kind": "analytics", "complaints": sum(p["complaints"] for p in ranked), "window": sum(p["window"]["complaints"] for p in ranked),
               f"per_100k_{b}": None, "rate_change_pct": None, "timely_rate": None},
        facts=[("Source", "CFPB Consumer Complaint Database bulk CSV; Census state population estimates"), ("Retrieved", ctx["retrieved"]),
               ("Coverage", f"Date received {min_day} to {max_day}; rates use complete calendar years {a} and {b}"),
               ("Units", "Complaints; per-100k = complaints per 100,000 residents"),
               ("Rate formula", "complaints received in year Y / Census July 1 resident population estimate for Y × 100,000"),
               ("Rise formula", f"(rate {b} − rate {a}) / rate {a} × 100"),
               ("Denominators", f"Vintage 2025 ({CENSUS_2025_URL}) for 2020–2025; Vintage 2020 ({CENSUS_2020_URL}) for 2012–2019"),
               ("Fastest rise", "; ".join(f"{r['rank']}. {r['name']} {r['value']:+.2f}%" for r in rankings["rate_change_pct"][:5])),
               ("Fastest rise excluding credit reporting", "; ".join(f"{r['rank']}. {r['name']} {r['value']:+.2f}%" for r in rankings["excl_credit_reporting_rate_change_pct"][:5])),
               ("Highest rate", "; ".join(f"{r['rank']}. {r['name']} {r['value']:,.2f}" for r in rankings[f"per_100k_{b}"][:5])),
               ("Medians (50 states + DC)", f"per-100k {b}: {num2(medians[f'per_100k_{b}'])}; rate change {a}–{b}: {pct_label(medians['rate_change_pct'])}; "
                                           f"excluding credit reporting: per-100k {b} {num2(medians[f'excl_credit_reporting_per_100k_{b}'])}, change {pct_label(medians['excl_credit_reporting_rate_change_pct'])}"),
               ("Credit-reporting caveat", f"Credit-reporting products (recorded Product starting 'Credit reporting') were {pct_label(cr_share[a])} of national complaints in {a} and {pct_label(cr_share[b])} in {b}; "
                                           "the rise rankings are shown with and without them"),
               ("Not findings of wrongdoing", NOT_VERIFIED)],
        text="state complaint rate ranking per capita fastest rising",
        filters={"kind": ["analytics"]}, badges=["Analytics"],
        links=[{"label": "Census Vintage 2025 state population", "url": CENSUS_2025_URL}],
        extra={"rankings": rankings, "years": [a, b], "medians": medians, "credit_reporting_share_pct": cr_share},
    ))
    return rows, profiles, rankings


# ----------------------------------------------------------------------------------------------------------------------
# companies

def company_rows(agg, ctx, national_total, sec_rows=None):
    ds = "cfpb_complaints_companies"
    co, cox, cov, cos, coi = ctx["co"], ctx["cox"], ctx["cov"], ctx["cos"], ctx["coi"]
    meta = agg["meta"]
    min_day, max_day = meta["min_day"], meta["max_day"]
    totals = collections.Counter()
    years = collections.defaultdict(collections.Counter)
    prods = collections.defaultdict(collections.Counter)
    prods_w = collections.defaultdict(collections.Counter)
    win = collections.Counter()
    prior = collections.Counter()
    for (company, year, w, product), n in co:
        totals[company] += n
        years[company][year] += n
        prods[company][product] += n
        if w == "2":
            win[company] += n
            prods_w[company][product] += n
        elif w == "1":
            prior[company] += n
    resp = collections.defaultdict(collections.Counter)
    timely = collections.defaultdict(collections.Counter)
    timely_y = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    for (company, year, w, response, t), n in cox:
        resp[company][response] += n
        timely[company][t] += n
        timely_y[company][year][t] += n
    via = collections.defaultdict(collections.Counter)
    for (company, v), n in cov:
        via[company][v] += n
    states = collections.defaultdict(collections.Counter)
    for (company, code, w), n in cos:
        states[company][code] += n
    issues = collections.defaultdict(collections.Counter)
    for (company, w, product, issue), n in coi:
        issues[company][SEP.join((product, issue))] += n

    all_years = sorted({y for c in years.values() for y in c})
    complete = {y: year_complete(y, min_day, max_day) for y in all_years}
    spellings = collections.defaultdict(list)
    for name, n_name in totals.items():
        spellings[normalize_name(name)].append((name, n_name))
    ordered = sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))
    top = ordered[:TOP_COMPANIES]
    window_rank = {c: i for i, (c, _) in enumerate(sorted(win.items(), key=lambda kv: (-kv[1], kv[0])), 1)}
    if sec_rows is None:
        with open(os.path.join(LOOKUPS, "company_sec_profiles_titles.json"), encoding="utf-8") as handle:
            sec_rows = json.load(handle)["rows"]
    index = build_name_index(sec_rows)
    match_counts = collections.Counter()
    profiles = []
    for pos, (company, n) in enumerate(top, 1):
        status, cik = match_name(company, index)
        match_counts[status] += 1
        rates = response_rates(resp[company])
        tr = timely_rate(timely[company])
        yrows = []
        for y in all_years:
            if not years[company].get(y) and not years[company].get(str(int(y) - 1)):
                continue
            prev = str(int(y) - 1)
            yrows.append({"year": y, "complaints": years[company].get(y, 0), "complete": complete[y],
                          "yoy_pct": growth_pct(years[company].get(y, 0), years[company].get(prev, 0)) if (complete[y] and complete.get(prev)) else None,
                          "timely_rate": timely_rate(timely_y[company].get(y, {}))["rate"]})
        profiles.append({
            "name": company, "display_name": label(company), "rank": pos, "complaints": n, "share_of_all_pct": pct(n, national_total),
            "window": {"from": WINDOW[0], "to": WINDOW[1], "complaints": win.get(company, 0), "rank": window_rank.get(company),
                       "prior_window": prior.get(company, 0), "change_vs_prior_pct": growth_pct(win.get(company, 0), prior.get(company, 0)),
                       "products": breakdown(prods_w[company], total=win.get(company, 0))},
            "first_year": min(years[company]), "last_year": max(years[company]),
            "years": yrows,
            "products": breakdown(prods[company], total=n),
            "top_issues": [{"product": label(r_value.split(SEP)[0]), "issue": label(r_value.split(SEP)[1]), "complaints": c, "share_pct": pct(c, n)}
                           for r_value, c in sorted(issues[company].items(), key=lambda kv: (-kv[1], kv[0]))[:12]],
            "company_response": breakdown(resp[company], total=n), "responses": rates, "timely": tr,
            "submitted_via": breakdown(via[company], total=n),
            "top_states": breakdown(states[company], limit=12, total=n),
            "sec_match": {"status": status, "cik": cik, "method": "exact match of case-folded, whitespace-collapsed name to company_sec_profiles titles"},
            "other_spellings": [{"name": other, "complaints": c} for other, c in sorted(spellings[normalize_name(company)], key=lambda kv: (-kv[1], kv[0])) if other != company],
            "analytics": {},
        })

    def assign(field_fn, rank_field, reverse=True, sort_fn=None, extra_fn=None):
        """Rank on sort_fn (default field_fn); the stored value is field_fn, so a rounded display value never decides the order."""
        key_fn = sort_fn or field_fn
        order = sorted((p for p in profiles if key_fn(p) is not None),
                       key=lambda p: ((-key_fn(p)) if reverse else key_fn(p), -p["complaints"], p["name"]))
        for i, p in enumerate(order, 1):
            p["analytics"][rank_field] = i
        return [{"company": p["display_name"], "complaints": p["complaints"], "value": field_fn(p), "rank": p["analytics"][rank_field],
                 **(extra_fn(p) if extra_fn else {})} for p in order]

    rankings = {
        "timely_rate": assign(lambda p: p["timely"]["rate"], "rank_timely_rate", sort_fn=lambda p: timely_exact(p["timely"]),
                              extra_fn=lambda p: {"yes": p["timely"]["yes"], "no": p["timely"]["no"]}),
        "relief_rate": assign(lambda p: p["responses"]["relief_rate"], "rank_relief_rate"),
        "monetary_relief_rate": assign(lambda p: p["responses"]["monetary_relief_rate"], "rank_monetary_relief_rate"),
        "untimely_response_share": assign(lambda p: p["responses"]["untimely_response_share"], "rank_untimely_response_share"),
        "window_change_vs_prior_pct": assign(lambda p: p["window"]["change_vs_prior_pct"] if p["window"]["prior_window"] >= 100 else None, "rank_window_growth"),
    }
    rows = []
    used = set()
    for p in profiles:
        slug = slugify(p["name"] or "not-recorded")
        if slug in used:
            slug = f"{slug}-{hashlib.sha1(p['name'].encode()).hexdigest()[:6]}"
        used.add(slug)
        links = ([{"label": "SEC company profile", "url": f"/companies/{p['sec_match']['cik']}"}] if p["sec_match"]["status"] == "matched" else [])
        rows.append(rec(
            ds, f"cfpb-company:{slug}", p["display_name"], source_url=CSV_URL,
            subtitle=f"#{p['rank']} by complaints · {p['complaints']:,} complaints {p['first_year']}–{p['last_year']} · timely {pct_label(p['timely']['rate'])}",
            cells={"rank": p["rank"], "company": p["display_name"], "complaints": p["complaints"], "window": p["window"]["complaints"],
                   "window_change": p["window"]["change_vs_prior_pct"], "top_product": p["products"][0]["value"] if p["products"] else None,
                   "timely_rate": p["timely"]["rate"], "relief_rate": p["responses"]["relief_rate"]},
            facts=[("Source", "CFPB Consumer Complaint Database bulk CSV (Company = company named in the complaint, exact recorded name)"),
                   ("Retrieved", ctx["retrieved"]), ("Coverage", f"Date received {min_day} to {max_day}"), ("Units", "Complaints"),
                   ("Company (as recorded)", p["display_name"]), ("Rank by complaints", f"{p['rank']} of {len(totals):,} companies"),
                   ("Complaints", num(p["complaints"])), ("Share of all complaints", pct_label(p["share_of_all_pct"])),
                   (f"3-year window {WINDOW[0]} to {WINDOW[1]}", f"{num(p['window']['complaints'])} (rank {p['window']['rank'] or 'Not recorded'}; {pct_label(p['window']['change_vs_prior_pct'])} vs preceding 3 years)"),
                   ("Top product", p["products"][0]["value"] if p["products"] else NOT_RECORDED),
                   ("Timely response rate", f"{pct_label(p['timely']['rate'])} (Yes / (Yes + No) = {num(p['timely']['yes'])} / {num(p['timely']['yes'] + p['timely']['no'])}; {num(p['timely']['no'])} untimely; "
                                            f"rank {p['analytics'].get('rank_timely_rate')} of {len(rankings['timely_rate'])} on the unrounded ratio)"),
                   ("Relief rate", f"{pct_label(p['responses']['relief_rate'])} (monetary + non-monetary relief / {RESPONDED})"),
                   ("Monetary relief rate", pct_label(p["responses"]["monetary_relief_rate"])),
                   ("SEC profile link", f"/companies/{p['sec_match']['cik']}" if p["sec_match"]["status"] == "matched" else f"None ({p['sec_match']['status']} by exact name)"),
                   ("Other recorded spellings (not merged)",
                    "; ".join(f"{o['name']} ({o['complaints']:,} complaint{'' if o['complaints'] == 1 else 's'})" for o in p["other_spellings"]) or "None recorded (no other spelling differs only by case or spacing)"),
                   ("Not findings of wrongdoing", NOT_VERIFIED)],
            text=" ".join([p["display_name"], "CFPB consumer complaints"] + [r["value"] for r in p["products"][:6]]),
            filters={"top_product": [p["products"][0]["value"] if p["products"] else NOT_RECORDED], "sec_link": ["yes" if links else "no"]},
            badges=[f"#{p['rank']}"] + (["SEC profile"] if links else []),
            links=links + [{"label": "Bulk CSV (ZIP)", "url": CSV_URL}, {"label": "Consumer Complaint Database", "url": DB_URL}],
            extra={"company": p},
        ))
    covered = sum(p["complaints"] for p in profiles)

    def median_field(fn):
        values = [fn(p) for p in profiles if fn(p) is not None]
        return round(statistics.median(values), 2) if values else None

    medians = {"complaints": median_field(lambda p: p["complaints"]), "timely_rate": median_field(lambda p: p["timely"]["rate"]),
               "relief_rate": median_field(lambda p: p["responses"]["relief_rate"]), "companies": len(profiles)}
    rows.append(rec(
        ds, "cfpb-companies:analytics", "Company complaint and response-rate rankings", source_url=CSV_URL,
        subtitle=f"Top {len(profiles)} companies by complaints cover {pct_label(pct(covered, national_total))} of all complaints",
        cells={"rank": None, "company": "Rankings (top 250)", "complaints": covered, "window": sum(p["window"]["complaints"] for p in profiles),
               "window_change": None, "top_product": None, "timely_rate": None, "relief_rate": None},
        facts=[("Source", "CFPB Consumer Complaint Database bulk CSV"), ("Retrieved", ctx["retrieved"]),
               ("Coverage", f"Date received {min_day} to {max_day} (all history); 3-year window {WINDOW[0]} to {WINDOW[1]}"),
               ("Units", "Complaints (one row per complaint ID); rates in percent"),
               ("Companies in the data", num(len(totals))), ("Top 250 coverage", pct_label(pct(covered, national_total))),
               ("Timely rate", "Yes / (Yes + No) × 100 on 'Timely response?'; ranked on the unrounded ratio, so a company with any 'No' never ties with one that has none"),
               ("Relief rate", "(Closed with monetary relief + Closed with non-monetary relief + Closed with relief) / responded complaints × 100; "
                               "responded = all responses except 'In progress' and blank (includes 'Closed', 'Closed without relief' and 'Untimely response')"),
               ("Medians (top 250)", f"complaints {num(medians['complaints'])}; timely rate {pct_label(medians['timely_rate'])}; relief rate {pct_label(medians['relief_rate'])}"),
               ("Window growth", f"(complaints {WINDOW[0]}..{WINDOW[1]} − complaints {PRIOR_WINDOW[0]}..{PRIOR_WINDOW[1]}) / prior × 100; companies with < 100 prior-window complaints unranked"),
               ("SEC profile links", f"{match_counts['matched']} matched, {match_counts['ambiguous']} ambiguous, {match_counts['unmatched']} unmatched (exact normalized name)"),
               ("Not findings of wrongdoing", NOT_VERIFIED)],
        text="company complaint ranking timely response relief rate",
        filters={"top_product": ["analytics"], "sec_link": ["no"]}, badges=["Analytics"],
        links=[{"label": "Bulk CSV (ZIP)", "url": CSV_URL}],
        extra={"rankings": rankings, "sec_match_counts": dict(match_counts), "medians": medians},
    ))
    return rows, profiles, rankings, match_counts, len(totals)


# ----------------------------------------------------------------------------------------------------------------------
# research reports

def report_rows(ctx):
    ds = "cfpb_research_reports"
    pages = sorted(glob.glob(os.path.join(ACQ, "reports", "page-*.html")))
    entries = []
    declared = set()
    for page_path in pages:
        page_no = int(re.search(r"page-(\d+)\.html$", page_path).group(1))
        with open(page_path, encoding="utf-8") as handle:
            items, total, n_pages = parse_page(handle.read())
        declared.add((total, n_pages))
        for position, item in enumerate(items, 1):
            entries.append({**item, "catalog_page": page_no, "position": position})
    if len(declared) != 1:
        raise ValueError(f"catalog pages disagree on totals: {declared}")
    total_declared, pages_declared = declared.pop()
    if len(entries) != total_declared or len(pages) != pages_declared:
        raise ValueError(f"parsed {len(entries)} entries from {len(pages)} pages; catalog declares {total_declared} on {pages_declared}")
    rows = []
    seen = set()
    manifest = ctx["manifest"]
    for e in entries:
        slug = slug_from_url(e["url"])
        rid = f"cfpb-report:{slug}"
        if rid in seen:
            raise ValueError(f"duplicate report id {rid}")
        seen.add(rid)
        page_rel = f"private/acq/cfpb/reports/page-{e['catalog_page']:03d}.html"
        page_entry = manifest[page_rel]
        truncated = bool(e["description"]) and (e["description"].endswith("...") or e["description"].endswith("…"))
        report = {**e, "summary": e["description"], "summary_truncated_in_listing": truncated, "slug": slug,
                  "catalog_url": page_entry["url"], "retrieved": page_entry["retrieved_at"]}
        del report["description"]
        cats = e["categories"] or [NOT_RECORDED]
        rows.append(rec(
            ds, rid, e["title"] or NOT_RECORDED, source_url=e["url"],
            subtitle=f"{e['date']} · {', '.join(cats)}",
            cells={"date": e["date"], "title": e["title"], "category": ", ".join(cats), "topics": ", ".join(t["label"] for t in e["topics"]) or NOT_RECORDED},
            facts=[("Source", "CFPB research-report catalog (consumerfinance.gov/data-research/research-reports/)"),
                   ("Catalog page", f"{page_entry['url']} (position {e['position']}), retrieved {page_entry['retrieved_at']}"),
                   ("Published", e["date"]), ("Category", ", ".join(cats)),
                   ("Topics", ", ".join(t["label"] for t in e["topics"]) or NOT_RECORDED),
                   ("Summary (as published in the catalog)", e["description"] or NOT_RECORDED)]
                  + ([("Summary note", "The catalog shows this summary truncated with an ellipsis; it is reproduced as published.")] if truncated else []),
            text=" ".join([e["title"] or "", e["description"] or "", " ".join(cats), " ".join(t["label"] for t in e["topics"])]),
            filters={"category": [slugify(c) for c in cats], "year": [e["date"][:4]], "topic": [t["slug"] for t in e["topics"]] or ["none"]},
            badges=cats,
            links=[{"label": "Report page", "url": e["url"]}, {"label": "Research-report catalog", "url": REPORTS_URL}],
            extra={"report": report},
        ))
    return rows, entries


# ----------------------------------------------------------------------------------------------------------------------

def inputs_for(manifest, rels):
    out = []
    for rel in rels:
        entry = manifest[rel]
        out.append({"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"], "retrieved_at": entry["retrieved_at"]})
    return out


def lookup_input(name, url):
    path = os.path.join(LOOKUPS, name)
    return {"url": url, "path": os.path.relpath(path, ROOT), "sha256": sha256_file(path)}


def write_build(dataset, label_text, rows, listing_block, summary, inputs):
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{dataset}: duplicate ids")
    if not re.fullmatch(r"[a-z0-9_]{1,80}", dataset):
        raise ValueError(dataset)
    out = {"dataset": dataset, "label": label_text, "listing_block": listing_block, "summary": summary, "rows": rows,
           "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "inputs": inputs}
    path = os.path.join(OUT, f"{dataset}.json")
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(out, handle, ensure_ascii=False, sort_keys=False)
    os.replace(tmp, path)
    print(json.dumps({"dataset": dataset, "rows": len(rows), "bytes": os.path.getsize(path)}))


def main():
    manifest = load_manifest()
    with open(os.path.join(LOOKUPS, "corpus_dataset_ids.json"), encoding="utf-8") as handle:
        existing = set(json.load(handle)["ids"].split(","))
    datasets = ("cfpb_complaints_national", "cfpb_complaints_states", "cfpb_complaints_companies", "cfpb_research_reports")
    clash = [d for d in datasets if d in existing]
    if clash:
        raise SystemExit(f"dataset ids already exist in corpus_datasets: {clash}")
    zip_rel = "private/acq/cfpb/bulk/complaints.csv.zip"
    if sha256_file(os.path.join(ROOT, zip_rel)) != manifest[zip_rel]["sha256"]:
        raise SystemExit("complaints.csv.zip does not match its manifest sha256")
    agg = aggregate.aggregate_zip(os.path.join(ROOT, zip_rel))
    ctx = {name: parsed(agg, name) for name in ("nat", "natx", "natm", "st", "stx", "sti", "co", "cox", "cov", "cos", "coi")}
    ctx.update({"retrieved": manifest[zip_rel]["retrieved_at"], "zip_info": agg["meta"]["zip"], "manifest": manifest})
    meta = agg["meta"]
    total = meta["rows"] - meta["bad_dates"]

    nat_rows, national, window, year_rows = national_rows(agg, ctx)
    st_rows, st_profiles, st_rank = state_rows(agg, ctx, total)
    co_rows, co_profiles, co_rank, match_counts, n_companies = company_rows(agg, ctx, total)
    rp_rows, rp_entries = report_rows(ctx)

    def retrieved_of(rel):
        return manifest[rel]["retrieved_at"] if rel in manifest else None

    terms = {
        "statement": POLICY_QUOTE, "url": POLICY_URL, "section": "Copyright and trademark",
        "retrieved": retrieved_of("private/acq/cfpb/context/website-privacy-policy.html"),
        "note": "Copyrighted materials created by entities outside the Bureau may also appear on the site; the figures here are computed from CFPB-published complaint data.",
    }
    robots = {
        "www.consumerfinance.gov": {"url": "https://www.consumerfinance.gov/robots.txt", "retrieved": retrieved_of("private/acq/cfpb/context/robots-consumerfinance.txt"),
                                     "result": "read; its Disallow rules do not cover /data-research/, /complaint/ or the search API"},
        "files.consumerfinance.gov": {"url": "https://files.consumerfinance.gov/robots.txt", "result": "HTTP 404 (no robots.txt); the bulk file is the documented download"},
        "www2.census.gov": {"url": "https://www2.census.gov/robots.txt", "retrieved": retrieved_of("private/acq/cfpb/census/robots-www2-census.txt"),
                            "result": "read; no Disallow rule applies to this research user agent"},
        "www.census.gov": {"url": "https://www.census.gov/robots.txt", "result": "HTTP 404 (no robots.txt)"},
    }
    common = {
        "terms": terms, "robots": robots,
        "publisher": "Consumer Financial Protection Bureau (CFPB)", "source": CSV_URL, "database": DB_URL, "api": API_URL,
        "api_note": "base endpoint of the documented search API; queried with parameters, the responses are saved unchanged under private/acq/cfpb/api/",
        "field_reference": FIELDS_URL, "release_notes": RELEASES_URL, "license": "CC0 (search API _meta.license); U.S. Government work",
        "retrieved": ctx["retrieved"], "csv_member": meta["zip"], "csv_rows": meta["rows"], "coverage": {"from": meta["min_day"], "to": meta["max_day"]},
        "not_findings_of_wrongdoing": NOT_VERIFIED, "publication_rule": PUBLICATION_RULE, "product_names": TAXONOMY_NOTE,
        "consumer_disputed": DISPUTED, "blank_values": "Blank recorded values are shown as 'Not recorded'.",
        "data_quality": {"blank_counts": meta["blank"], "untrimmed_values": meta["untrimmed"], "bad_dates": meta["bad_dates"],
                         "duplicate_complaint_ids": meta["duplicate_ids"], "non_numeric_ids": meta["bad_ids"]},
    }
    csv_inputs = inputs_for(manifest, [zip_rel])
    policy_inputs = inputs_for(manifest, [r for r in ("private/acq/cfpb/context/website-privacy-policy.html", "private/acq/cfpb/context/robots-consumerfinance.txt") if r in manifest])
    ctx_inputs = policy_inputs + inputs_for(manifest, [r for r in ("private/acq/cfpb/context/consumer-complaints.html", "private/acq/cfpb/context/complaint.html",
                                                                    "private/acq/cfpb/context/complaint-data-use.html", "private/acq/cfpb/context/ccdb-fields.html",
                                                                    "private/acq/cfpb/context/ccdb-release-notes.html") if r in manifest])
    census_inputs = inputs_for(manifest, [r for r in ("private/acq/cfpb/census/NST-EST2025-ALLDATA.csv", "private/acq/cfpb/census/nst-est2020-alldata.csv",
                                                       "private/acq/cfpb/census/popest-2020s-state-total.html", "private/acq/cfpb/census/robots-www2-census.txt") if r in manifest])

    write_build(
        "cfpb_complaints_national", "CFPB consumer complaints: national series", nat_rows,
        writer.listing([("scope", "Scope"), ("period", "Period"), ("complaints", "Complaints"), ("change", "Change (%)"),
                        ("timely_rate", "Timely response (%)"), ("relief_rate", "Relief rate (%)"), ("top_product", "Top product")],
                       [("kind", "Kind", used_options(nat_rows, "kind", {"all": "All history", "window": "3-year window", "year": "Year", "product": "Product"}))]),
        {**common, "grain": "one record for all history, one for the 3-year window of the search URL (2023-10-18..2026-10-18), one per calendar year received, one per product as recorded",
         "window": {"from": WINDOW[0], "to": WINDOW[1], "url": WINDOW_URL, "complaints": window["complaints"], "prior_window": window["prior_window"]},
         "formulas": {
             "yoy_pct": "(complaints in year Y − complaints in Y−1) / complaints in Y−1 × 100; only when both are complete calendar years. "
                        "For a product, also only when the exact product name recorded complaints in all 12 months of both years (otherwise Not recorded)",
             "cagr_pct": "((complaints in end year / complaints in start year) ^ (1 / years) − 1) × 100",
             "ytd_change_pct": "(complaints Jan 1..last data day of the current year − same span of the previous year) / previous × 100; "
                               "the current span is not yet matured (recent weeks are incomplete), so the change is understated",
             "share_pct": "complaints in the category / all complaints in the period × 100",
             "shift_pp": f"share in later period − share in earlier period (percentage points); primary comparison {SHIFT_YEARS[0]} vs {SHIFT_YEARS[1]} (same complaint form)",
             "timely_rate": "Timely response? Yes / (Yes + No) × 100; a value below 100 is never rounded up to 100 (extra decimals are shown)",
             "relief_rate": "(Closed with monetary relief + Closed with non-monetary relief + Closed with relief) / (all responses except 'In progress' and blank) × 100",
             "states_recorded": "distinct non-blank State values (the blank State group is reported separately as state_not_recorded_complaints)",
             "top3_share_pct": "complaints naming the three most-named companies in the year / all complaints in the year × 100",
             "hhi": "sum over companies of (company share of the year's complaints in %)^2 (0–10,000)",
             "window_change_pct": "(complaints in window − complaints in preceding window) / preceding × 100. "
                                  "For a product, only when the exact product name recorded complaints in every calendar month lying wholly inside either window "
                                  "(2020-11..2023-09 and 2023-11..2026-09); otherwise Not recorded, because names change with the April 2017 and August 2023 form revisions",
             "responded": RESPONDED[0].upper() + RESPONDED[1:] + "; this is the denominator of relief_rate (key 'closed' in the stored responses objects)",
         },
         "headline": {"complaints": national["complaints"], "companies": national["companies"],
                      "cagr": national["analytics"]["cagr"], "ytd": national["analytics"]["ytd"]}},
        csv_inputs + ctx_inputs,
    )
    write_build(
        "cfpb_complaints_states", "CFPB consumer complaints by state", st_rows,
        writer.listing([("state", "State"), ("kind", "Kind"), ("complaints", "Complaints"), ("window", "3-year window"),
                        (f"per_100k_{RISE_YEARS[1]}", f"Per 100k residents ({RISE_YEARS[1]})"), ("rate_change_pct", f"Rate change {RISE_YEARS[0]}–{RISE_YEARS[1]} (%)"),
                        ("timely_rate", "Timely response (%)")],
                       [("kind", "Kind", used_options(st_rows, "kind", {"state": "State", "district": "District", "territory": "Territory", "freely associated state": "Freely associated state",
                                                                         "military": "Military mail", "other": "Other value", "unrecorded": "Not recorded", "analytics": "Rankings"}))]),
        {**common, "grain": "one record per recorded State value (consumer mailing-address state), a 'Not recorded' record for blanks, and a rankings record",
         "attribution": "State is the state of the mailing address the consumer provided; each complaint counts once.",
         "population": {"Vintage 2025": {"url": CENSUS_2025_URL, "page": CENSUS_2025_PAGE, "years": "2020–2025"},
                        "Vintage 2020": {"url": CENSUS_2020_URL, "years": "2012–2019"},
                        "note": "Per-capita figures only for complete calendar years 2012–2025 and only for codes with a Census state estimate (50 states, DC, Puerto Rico)."},
         "formulas": {
             "per_100k": "complaints received in year Y / Census July 1 resident population estimate for year Y × 100,000",
             "timely_rate": "Yes / (Yes + No) × 100 on 'Timely response?'; the all-history state value adds the Yes and No counts of every year received (the per-year values are in years[])",
             "medians": "median over the 50 states and DC of per-100k, rate change, and the same excluding credit reporting",
             "rate_change_pct": f"(per_100k {RISE_YEARS[1]} − per_100k {RISE_YEARS[0]}) / per_100k {RISE_YEARS[0]} × 100 (fastest-rising ranking, 50 states + DC)",
             "rate_change_pct_2024_2025": "(per_100k 2025 − per_100k 2024) / per_100k 2024 × 100",
             "excl_credit_reporting": "complaints whose recorded Product does not start with 'Credit reporting'",
             "yoy_pct": "(complaints Y − complaints Y−1) / complaints Y−1 × 100, complete years only",
             "window_change_pct": "(complaints 2023-10-18..2026-10-18 − complaints 2020-10-18..2023-10-17) / prior × 100",
         },
         "rankings_preview": {"fastest_rising": st_rank["rate_change_pct"][:10], "fastest_rising_excl_credit_reporting": st_rank["excl_credit_reporting_rate_change_pct"][:10],
                              f"highest_per_100k_{RISE_YEARS[1]}": st_rank[f"per_100k_{RISE_YEARS[1]}"][:10]},
         "links": "item.links /places/<USPS> for the 50 states and DC only (codes in the app's STATES list)"},
        csv_inputs + census_inputs,
    )
    write_build(
        "cfpb_complaints_companies", f"CFPB consumer complaints: top {TOP_COMPANIES} companies", co_rows,
        writer.listing([("rank", "Rank"), ("company", "Company (as recorded)"), ("complaints", "Complaints"), ("window", "3-year window"),
                        ("window_change", "Window change (%)"), ("top_product", "Top product"), ("timely_rate", "Timely (%)"), ("relief_rate", "Relief rate (%)")],
                       [("sec_link", "SEC profile link", used_options(co_rows, "sec_link", {"yes": "Linked", "no": "Not linked"}))]),
        {**common, "grain": f"one record per company among the {TOP_COMPANIES} most-named companies (all history), exact recorded names, plus a rankings record",
         "companies_in_data": n_companies,
         "formulas": {
             "timely_rate": "Yes / (Yes + No) × 100 on 'Timely response?' (blanks excluded and reported); a value below 100 is never rounded up to 100 (extra decimals are shown), and the ranking sorts on the unrounded ratio",
             "relief_rate": "(Closed with monetary relief + Closed with non-monetary relief + Closed with relief) / responded complaints × 100; responded = all responses except 'In progress' and blank",
             "monetary_relief_rate": "Closed with monetary relief / responded complaints × 100",
             "untimely_response_share": "'Untimely response' / all complaints × 100",
             "window_change_pct": "(complaints 2023-10-18..2026-10-18 − complaints 2020-10-18..2023-10-17) / prior × 100 (ranked only with ≥ 100 prior complaints)",
             "yoy_pct": "(complaints Y − complaints Y−1) / complaints Y−1 × 100, complete years only",
         },
         "sec_links": {"method": "exact match after case-folding and collapsing whitespace against company_sec_profiles titles (read-only lookup)",
                       "matched": match_counts["matched"], "ambiguous": match_counts["ambiguous"], "unmatched": match_counts["unmatched"]},
         "rankings_preview": {k: v[:10] for k, v in co_rank.items()}},
        csv_inputs + policy_inputs + [lookup_input("company_sec_profiles_titles.json", "corpus:company_sec_profiles (read-only SELECT id, title)")],
    )
    cat_counts = collections.Counter(c for e in rp_entries for c in (e["categories"] or [NOT_RECORDED]))
    write_build(
        "cfpb_research_reports", "CFPB research reports catalog", rp_rows,
        writer.listing([("date", "Published"), ("title", "Title"), ("category", "Category"), ("topics", "Topics")],
                       [("category", "Category", {slugify(c): c for c in sorted(cat_counts)})]),
        {"publisher": "Consumer Financial Protection Bureau (CFPB)", "source": REPORTS_URL, "terms": terms, "robots": robots,
         "retrieved": min(manifest[p]["retrieved_at"] for p in manifest if re.fullmatch(r"private/acq/cfpb/reports/page-\d+\.html", p)),
         "license": "Information created by the CFPB is in the public domain (website policy, Copyright and trademark); see terms",
         "links_note": "report URLs are the links published in the catalog list pages; only the catalog pages (and one report page as a sample) were fetched, not each report page",
         "grain": "one record per catalog entry (title, published date, category, topics, URL, summary as published in the catalog list)",
         "reports": len(rp_rows), "categories": dict(cat_counts.most_common()),
         "years": dict(sorted(collections.Counter(e["date"][:4] for e in rp_entries).items())),
         "summary_note": "Summaries are the catalog's own preview text; some are truncated with an ellipsis by the CFPB and are kept as published.",
         "no_category": sum(1 for e in rp_entries if not e["categories"]),
         "category_count_basis": "each report counts once per distinct category; a catalog entry that lists the same category tag twice is counted once",
         "duplicate_category_tags_collapsed": sum(e["category_tags_repeated"] for e in rp_entries)},
        policy_inputs + inputs_for(manifest, sorted(p for p in manifest if re.fullmatch(r"private/acq/cfpb/reports/page-\d+\.html", p))),
    )


if __name__ == "__main__":
    main()
