"""Build the fda_adverse_events datasets from raw openFDA count aggregates (private/acq/fda_adverse_events/).

Datasets (written to private/build/fda_adverse_events/<dataset>.json for the lead to publish unchanged):
  fda_faers_product_series   FAERS reports for each drug/biologic product in mass_tort_products.json
  fda_faers_national_series  FAERS national yearly totals (all, serious, death) and reporter mix: denominators
  fda_device_event_series    MAUDE reports for each device product, by event type, plus the national series
  fda_caers_series           CAERS food / supplement / cosmetic reports: yearly totals, top industries and products

Usage: python3 -I -B scripts/enrichment/fda_adverse_events/build_fda_adverse_events.py
Reads only private/acq/fda_adverse_events/ (raw responses + _manifest.jsonl) and the read-only lookups saved in
private/build/fda_adverse_events/lookups/. Deterministic: the same inputs give the same rows. No network, no remote writes.
"""
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import fae_common as fc  # noqa: E402
import corpus_writer as cw  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "fda_adverse_events"
RAW = ACQ / "openfda"
MANIFEST = ACQ / "_manifest.jsonl"
BUILD = ROOT / "private" / "build" / "fda_adverse_events"
LOOKUPS = BUILD / "lookups"

D_PRODUCT, D_NATIONAL, D_DEVICE, D_CAERS = ("fda_faers_product_series", "fda_faers_national_series",
                                            "fda_device_event_series", "fda_caers_series")
LABELS = {
    D_PRODUCT: "FAERS adverse-event reports for mass-tort drugs and biologics (openFDA)",
    D_NATIONAL: "FAERS national adverse-event report totals by year (openFDA)",
    D_DEVICE: "MAUDE device adverse-event reports for mass-tort devices, by event type (openFDA)",
    D_CAERS: "CAERS food, supplement and cosmetic adverse-event reports (openFDA)",
}
CAVEAT = ("FAERS, MAUDE and CAERS counts are reports, not incidence: a report says a product was mentioned with an "
          "adverse event, not that the product caused it, and counts cannot be turned into rates without exposure data. "
          "Reporting rises with publicity and litigation (claimants' lawyers file reports and manufacturers forward "
          "reports they learn of through lawsuits), so counts and lawyer-reported shares are affected by "
          "litigation-driven reporting. Counts change as FDA adds, deduplicates or revises reports.")
CAVEAT_SHORT = "Reports, not incidence; affected by litigation-driven reporting."
INPUT_PREFIX = {  # raw query keys each dataset's figures come from (products use the national denominators)
    D_NATIONAL: lambda k: k.startswith("faers_nat_"),
    D_PRODUCT: lambda k: k.startswith("faers_"),
    D_DEVICE: lambda k: k.startswith("maude_"),
    D_CAERS: lambda k: k.startswith("caers_"),
}
DEVICE_FIRST_YEAR = 1992  # first full year in openFDA MAUDE (1991 has 15 reports; one report is dated 1900)
LAWYER_BANDS = [(0.25, "25% or more"), (0.10, "10–25%"), (0.01, "1–10%"), (0.0, "Under 1%")]


# ---------------------------------------------------------------- inputs

class Store:
    """Raw responses addressed by query key, verified against the manifest sha256; records every input used."""

    def __init__(self, raw_dir=RAW, manifest=MANIFEST, root=ROOT):
        self.raw_dir, self.root = raw_dir, root
        self.manifest = {}
        for line in manifest.read_text().splitlines() if manifest.exists() else []:
            if line.strip():
                rec = json.loads(line)
                self.manifest[rec["key"]] = rec  # last entry per key wins (a refetch supersedes)
        self.used = {}

    def _load(self, key):
        rec = self.manifest.get(key)
        path = self.raw_dir / f"{key}.json"
        if rec is None or not path.exists():
            raise fc.NotRecorded(f"query {key} was not retrieved")
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != rec["sha256"]:
            raise RuntimeError(f"{path}: bytes differ from the manifest sha256")
        self.used[key] = {"url": rec["url"], "path": rec["path"], "sha256": rec["sha256"]}
        return rec, json.loads(body)

    def results(self, key):
        rec, payload = self._load(key)
        return fc.results_of(rec["status"], payload)

    def meta(self, key):
        return self._load(key)[1].get("meta", {})

    def url(self, key):
        rec = self.manifest.get(key)
        return rec["url"] if rec else None

    def retrieved(self, key):
        rec = self.manifest.get(key)
        return rec["retrieved_at"] if rec else None


def attempt(fn, gaps, label):
    try:
        return fn()
    except fc.NotRecorded as exc:
        gaps.append(f"{label}: {exc}")
        return None


def years_of(store, key, gaps):
    res = attempt(lambda: store.results(key), gaps, key)
    return None if res is None else fc.daily_to_years(res)


def through(store, key):
    res = store.results(key)
    d = fc.max_date(res)
    return d, int(d[:4]), d < f"{d[:4]}1231"


def iso(d):
    return f"{d[:4]}-{d[4:6]}-{d[6:]}"


def load_lookups(lookups=LOOKUPS):
    products = json.loads((lookups / "mass_tort_products.json").read_text())["mdls"]
    titles = {}
    for line in (lookups / "mdl_analytics_titles.txt").read_text().splitlines():
        mdl, title = line.split("|", 1)
        titles[int(mdl)] = title
    profiles = []
    for line in (lookups / "company_sec_profiles.txt").read_text().splitlines():
        cik, name = line.split("|", 1)
        if cik.isdigit() and len(cik) == 10:
            profiles.append((cik, name))
    return products, titles, profiles


def load_manufacturer_records(lookups=LOOKUPS):
    """company_adverse_manufacturers rows (id|title|match status); only 'Exact-name match' rows can be linked to."""
    rows = []
    path = lookups / "company_adverse_manufacturers.txt"
    for line in path.read_text().splitlines() if path.exists() else []:
        rid, title, status = line.split("|", 2)
        if status == "Exact-name match":
            rows.append((rid, title))
    return rows


def lookup_inputs(lookups=LOOKUPS):
    out = []
    for name, url in (("mass_tort_products.json", "scripts/enrichment/mass_tort_products.json (snapshot)"),
                      ("mdl_analytics_titles.txt", "corpus dataset mdl_analytics (read-only SELECT: id, item.title)"),
                      ("company_sec_profiles.txt", "corpus dataset company_sec_profiles (read-only SELECT: id, title)"),
                      ("company_adverse_manufacturers.txt", "corpus dataset company_adverse_manufacturers (read-only SELECT: id, title, cells.matched)")):
        p = lookups / name
        out.append({"url": url, "path": str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p),
                    "sha256": hashlib.sha256(p.read_bytes()).hexdigest()})
    return out


# ---------------------------------------------------------------- shared formatting

def mix_text(mix, top=None):
    items = [m for m in mix if m["count"]] if top is None else mix[:top]
    return "; ".join(f"{m['label']} {fc.num(m['count'])} ({fc.pct(m['share'])})" for m in items) or "Not recorded"


def terms_text(terms, n=8):
    return "; ".join(f"{t['term']} ({t['count']:,})" for t in (terms or [])[:n]) or "Not recorded"


def series_years_text(series, field="reports", n=None):
    pts = [(p["year"], p[field]) for p in series if p.get(field) is not None]
    return ", ".join(f"{y}: {v:,}" for y, v in (pts[-n:] if n else pts))


def lawyer_band(x):
    if x is None:
        return "Not recorded"
    for lo, label in LAWYER_BANDS:
        if x >= lo:
            return label
    return "Not recorded"


def peak(series, last_complete):
    pts = [(p["year"], p["reports"]) for p in series if p["year"] <= last_complete and p["reports"]]
    return max(pts, key=lambda kv: (kv[1], -kv[0])) if pts else (None, None)


def mk(dataset, rid, title, *, source_url, cells, facts, text, filters, subtitle="", badges=(), links=(), extra=None,
       qualification=CAVEAT):
    row = cw.record(dataset, rid, title, source_url=source_url, cells=cells, facts=facts, text=text, filters=filters,
                    subtitle=subtitle, badges=badges, links=links, extra={**(extra or {}), "qualification": qualification})
    row["detail"]["qualification"] = qualification
    return row


def lens_link(mdl, titles):
    """/matters/lens/<n> only because mass_tort_products.json records the MDL number explicitly for the product."""
    return {"url": f"/matters/lens/{mdl}", "label": f"MDL {mdl} lens" + (f": {titles[mdl]}" if mdl in titles else "")}


def query_links(store, keys, labels):
    return [{"url": store.url(k), "label": f"openFDA query: {labels[k]}"} for k in keys if store.url(k)]


# ---------------------------------------------------------------- FAERS national

def faers_national(store, gaps):
    end, last, partial = through(store, "faers_nat_year_all")
    last_complete = last - 1 if partial else last
    data_through = iso(end)
    all_y = years_of(store, "faers_nat_year_all", gaps)
    ser = years_of(store, "faers_nat_year_serious", gaps)
    dea = years_of(store, "faers_nat_year_death", gaps)
    qual = {c: years_of(store, f"faers_nat_year_q{c}", gaps) for c in fc.QUALIFICATION}
    series = []
    prev = None
    for y, n in fc.year_series(all_y, fc.FIRST_YEAR, last):
        p = {"year": y, "reports": n, "serious": ser.get(y, 0) if ser is not None else None,
             "deaths": dea.get(y, 0) if dea is not None else None, "partial": y == last and partial}
        p["serious_share"] = fc.share(p["serious"], n)
        p["death_share"] = fc.share(p["deaths"], n)
        p["reporters"] = {fc.QUALIFICATION[c]: (qual[c].get(y, 0) if qual[c] is not None else None) for c in fc.QUALIFICATION}
        known = [v for v in p["reporters"].values() if v is not None]
        p["reporter_not_recorded"] = n - sum(known) if len(known) == len(fc.QUALIFICATION) else None
        p["lawyer"] = p["reporters"]["Lawyer"]
        p["lawyer_share"] = fc.share(p["lawyer"], n)
        p["yoy"] = None if p["partial"] or prev is None else fc.yoy(n, prev)
        prev = n
        series.append(p)
    totals = {"reports": sum(all_y.values()), "before_2004": fc.before(all_y, fc.FIRST_YEAR),
              "serious": sum(ser.values()) if ser is not None else None, "deaths": sum(dea.values()) if dea is not None else None}
    sex_res = attempt(lambda: store.results("faers_nat_sex"), gaps, "faers_nat_sex")
    sex = fc.coded_mix(sex_res, fc.SEX, totals["reports"]) if sex_res is not None else None
    reporters_all = []
    for c, label in fc.QUALIFICATION.items():
        n = sum(qual[c].values()) if qual[c] is not None else None
        reporters_all.append({"code": c, "label": label, "count": n, "share": fc.share(n, totals["reports"])})
    known = [r["count"] for r in reporters_all if r["count"] is not None]
    nr = totals["reports"] - sum(known) if len(known) == len(reporters_all) else None
    reporters_all.append({"code": None, "label": "Not recorded", "count": nr, "share": fc.share(nr, totals["reports"])})
    return {"series": series, "by_year": {p["year"]: p for p in series}, "totals": totals, "sex": sex,
            "reporters": reporters_all, "through": data_through, "last": last, "partial": partial,
            "last_complete": last_complete, "last_updated": store.meta("faers_nat_year_all").get("last_updated"),
            "retrieved": store.retrieved("faers_nat_year_all")}


NAT_LABELS = {"faers_nat_year_all": "all reports by receive date", "faers_nat_year_serious": "serious reports by receive date",
              "faers_nat_year_death": "death-outcome reports by receive date", "faers_nat_sex": "patient sex",
              **{f"faers_nat_year_q{c}": f"reporter = {l}" for c, l in fc.QUALIFICATION.items()}}


def faers_national_rows(store, nat):
    dash = fc.DASHBOARDS["faers"]
    links_q = query_links(store, list(NAT_LABELS), NAT_LABELS)
    base_links = [{"url": dash["url"], "label": dash["title"]}, {"url": fc.DOCS["drug"], "label": "openFDA drug adverse events (FAERS)"}]
    rows = []
    for p in nat["series"]:
        y = p["year"]
        period = f"{y} (partial: received through {nat['through']})" if p["partial"] else str(y)
        facts = [
            ["Source", "FDA Adverse Event Reporting System (FAERS), public data via openFDA drug/event (count aggregates)"],
            ["Related FDA dashboard", dash["title"] + fc.DASHBOARD_CAVEAT],
            ["Period", f"Reports first received by FDA in {period}"],
            ["Units", "Reports (cases; openFDA keeps the latest version of each case)"],
            ["Reports received", fc.num(p["reports"])],
            ["Serious reports", f"{fc.num(p['serious'])} ({fc.pct(p['serious_share'])} of reports; computed)"],
            ["Death-outcome reports", f"{fc.num(p['deaths'])} ({fc.pct(p['death_share'])} of reports; computed)"],
            ["Change from previous year", "Not applicable (partial year)" if p["partial"] else fc.pct(p["yoy"]) + " (computed)" if p["yoy"] is not None else "Not recorded"],
            ["Reporter qualification", "; ".join(f"{k} {fc.num(v)}" for k, v in p["reporters"].items()) + f"; Not recorded {fc.num(p['reporter_not_recorded'])}"],
            ["Lawyer-reported share", f"{fc.pct(p['lawyer_share'])} (computed: lawyer-reported / all reports)"],
            ["Data through", f"{nat['through']} (openFDA last updated {nat['last_updated']})"],
            ["Caveat", CAVEAT],
        ]
        rows.append(mk(
            D_NATIONAL, str(y), f"FAERS reports received in {y}" + (" (partial year)" if p["partial"] else ""),
            source_url=store.url("faers_nat_year_all"),
            subtitle=f"{fc.num(p['reports'])} reports · {fc.num(p['serious'])} serious · {fc.num(p['deaths'])} with death outcome",
            cells={"year": str(y), "reports": fc.num(p["reports"]), "serious": fc.num(p["serious"]), "deaths": fc.num(p["deaths"]),
                   "serious_pct": fc.pct(p["serious_share"]), "lawyer_pct": fc.pct(p["lawyer_share"]),
                   "yoy": "Partial year" if p["partial"] else fc.pct(p["yoy"])},
            facts=facts, text=f"FAERS national {y} adverse event reports serious death lawyer",
            filters={"completeness": ["partial" if p["partial"] else "complete"], "decade": [f"{y // 10 * 10}s"]},
            badges=["Partial year"] if p["partial"] else [], links=base_links + links_q,
            extra={"kind": "faers_national_year", "year": y, "point": p, "data_through": nat["through"]},
        ))
    # One record with the whole series, the denominator every product row points at.
    t = nat["totals"]
    facts = [
        ["Source", "FDA Adverse Event Reporting System (FAERS), public data via openFDA drug/event (count aggregates)"],
        ["Related FDA dashboard", dash["title"] + fc.DASHBOARD_CAVEAT],
        ["Period", f"Reports first received {fc.FIRST_YEAR}–{nat['last']} ({nat['last']} partial, through {nat['through']}); {fc.num(t['before_2004'])} legacy reports carry earlier receive dates"],
        ["Units", "Reports (cases; latest version of each case)"],
        ["Reports, all receive dates", fc.num(t["reports"])],
        ["Serious reports", f"{fc.num(t['serious'])} ({fc.pct(fc.share(t['serious'], t['reports']))}; computed)"],
        ["Death-outcome reports", f"{fc.num(t['deaths'])} ({fc.pct(fc.share(t['deaths'], t['reports']))}; computed)"],
        ["Reporter qualification, all years", mix_text(nat["reporters"])],
        ["Patient sex, all years", mix_text(nat["sex"]) if nat["sex"] else "Not recorded"],
        ["Reports by year", series_years_text(nat["series"])],
        ["Data through", f"{nat['through']} (openFDA last updated {nat['last_updated']})"],
        ["Caveat", CAVEAT],
    ]
    rows.append(mk(
        D_NATIONAL, "all_years", f"FAERS national reports by year, {fc.FIRST_YEAR}–{nat['last']}",
        source_url=store.url("faers_nat_year_all"),
        subtitle=f"{fc.num(t['reports'])} reports · denominators for product shares",
        cells={"year": f"{fc.FIRST_YEAR}–{nat['last']}", "reports": fc.num(t["reports"]), "serious": fc.num(t["serious"]),
               "deaths": fc.num(t["deaths"]), "serious_pct": fc.pct(fc.share(t["serious"], t["reports"])),
               "lawyer_pct": fc.pct(nat["reporters"][3]["share"]), "yoy": "—"},
        facts=facts, text="FAERS national series all years adverse event reports denominator",
        filters={"completeness": ["series"], "decade": ["all"]}, badges=["Series"], links=base_links + links_q,
        extra={"kind": "faers_national_series", "series": nat["series"], "totals": t, "reporters": nat["reporters"],
               "sex": nat["sex"], "data_through": nat["through"], "last_updated": nat["last_updated"]},
    ))
    return rows


# ---------------------------------------------------------------- FAERS products

FAERS_LABELS = {"year_all": "reports by receive date", "year_serious": "serious reports by receive date",
                "year_death": "death-outcome reports by receive date", "year_lawyer": "lawyer-reported reports by receive date",
                "pt_all": "top reactions, all years", "pt_recent": f"top reactions, received {fc.RECENT_LABEL}",
                "qual": "reporter qualification", "sex": "patient sex", "agegroup": "patient age group",
                **{f"age_years_{name}": f"onset age in years {lo}–{hi}" for name, lo, hi in fc.AGE_RANGES}}


def age_in_years(store, m, gaps):
    """Onset ages recorded in years, from the two range counts. A range answer with AGE_TERM_LIMIT values may be cut
    off by openFDA, so the whole age block is then Not recorded rather than an undercount."""
    results = []
    for name, _, _ in fc.AGE_RANGES:
        key = f"faers_{m}_age_years_{name}"
        res = attempt(lambda: store.results(key), gaps, key)
        if res is None:
            return None, None
        if len(res) >= fc.AGE_TERM_LIMIT:
            gaps.append(f"{key}: {len(res)} distinct ages returned (openFDA limit without a key), range may be incomplete")
            return None, None
        results += res
    buckets, total = fc.age_buckets(results)
    for b in buckets:
        b["share_of_age_in_years"] = fc.share(b["count"], total)
    return buckets, total


def pick_alt(store, entry):
    """The alternate search for a drug product, only if the recorded search matches no reports (a true 0: openFDA answered
    'No matches found!') and the alternate does match some; otherwise None and the recorded search stands."""
    alt = fc.ALT_FAERS.get(entry["mdl"])
    if not alt:
        return None
    recorded = years_of(store, f"faers_{entry['mdl']}_year_all", [])
    alternate = years_of(store, f"faers_{alt['key']}_year_all", [])
    if recorded is not None and sum(recorded.values()) == 0 and alternate and sum(alternate.values()) > 0:
        return alt
    return None


def faers_product(store, entry, nat, titles, alt=None):
    """One FAERS product row. `alt` ({key, faers, why}) swaps in an alternate search whose queries are stored under
    faers_<alt key>_*; the caller passes it only when the recorded search matched no reports."""
    m = entry["mdl"]
    kid = alt["key"] if alt else m
    search = alt["faers"] if alt else entry["faers"]
    k = lambda s: f"faers_{kid}_{s}"  # noqa: E731
    gaps = []
    all_y = years_of(store, k("year_all"), gaps)
    if all_y is None:
        raise RuntimeError(f"MDL {m}: the main FAERS series is missing; rerun the fetcher")
    ser, dea, law = (years_of(store, k(s), gaps) for s in ("year_serious", "year_death", "year_lawyer"))
    total = sum(all_y.values())
    last, last_complete = nat["last"], nat["last_complete"]
    series = []
    for y, n in fc.year_series(all_y, fc.FIRST_YEAR, last):
        natp = nat["by_year"][y]
        p = {"year": y, "reports": n, "serious": ser.get(y, 0) if ser is not None else None,
             "deaths": dea.get(y, 0) if dea is not None else None, "lawyer": law.get(y, 0) if law is not None else None,
             "national_reports": natp["reports"], "partial": natp["partial"]}
        p["share_of_national"] = fc.share(n, natp["reports"])
        p["serious_share"] = fc.share(p["serious"], n)
        p["death_share"] = fc.share(p["deaths"], n)
        p["lawyer_share"] = fc.share(p["lawyer"], n)
        series.append(p)
    by = {p["year"]: p for p in series}
    totals = {"reports": total, "before_2004": fc.before(all_y, fc.FIRST_YEAR),
              "serious": sum(ser.values()) if ser is not None else None,
              "deaths": sum(dea.values()) if dea is not None else None,
              "lawyer": sum(law.values()) if law is not None else None}
    recent_total = sum(all_y.get(y, 0) for y in range(int(fc.RECENT_FROM[:4]), int(fc.RECENT_TO[:4]) + 1))
    pt_all = attempt(lambda: fc.top_terms(store.results(k("pt_all")), total), gaps, k("pt_all"))
    pt_recent = attempt(lambda: fc.top_terms(store.results(k("pt_recent")), recent_total), gaps, k("pt_recent"))
    qual = attempt(lambda: fc.coded_mix(store.results(k("qual")), fc.QUALIFICATION, total), gaps, k("qual"))
    sex = attempt(lambda: fc.coded_mix(store.results(k("sex")), fc.SEX, total), gaps, k("sex"))
    agegroup = attempt(lambda: fc.coded_mix(store.results(k("agegroup")), fc.AGE_GROUP, total), gaps, k("agegroup"))
    age_years, age_years_total = age_in_years(store, kid, gaps)
    age_not_in_years = total - age_years_total if age_years_total is not None else None
    pk_year, pk_n = peak(series, last_complete)
    lc = by[last_complete]
    prev = by.get(last_complete - 1)
    yoy = fc.yoy(lc["reports"], prev["reports"]) if prev else None
    lawyer_share = fc.share(totals["lawyer"], total)
    law_pts = [(p["year"], p["lawyer"]) for p in series if p["lawyer"]]
    law_peak = max(law_pts, key=lambda kv: (kv[1], -kv[0])) if law_pts else (None, None)
    vaccine = m in fc.VACCINE_MDLS
    dash = fc.DASHBOARDS["vaccines" if vaccine else "faers"]
    period = f"{fc.FIRST_YEAR}–{last} ({last} partial, received through {nat['through']})"
    facts = [
        ["MDL", f"{m} — {titles.get(m, 'Not recorded')}"],
        ["Product", entry["product"]],
        ["Source", "FDA Adverse Event Reporting System (FAERS), public data via openFDA drug/event (count aggregates)"],
        ["openFDA search (from mass_tort_products.json)", entry["faers"]],
        ["Related FDA dashboard", dash["title"] + fc.DASHBOARD_CAVEAT],
        ["Period", f"Reports first received by FDA, {period}"],
        ["Units", "Reports (cases, latest version) mentioning the product as any listed drug"],
        ["Reports, all receive dates", fc.num(total) + (f" ({totals['before_2004']:,} received before {fc.FIRST_YEAR})" if totals["before_2004"] else "")],
        ["Serious reports", f"{fc.num(totals['serious'])} ({fc.pct(fc.share(totals['serious'], total))}; computed)"],
        ["Death-outcome reports", f"{fc.num(totals['deaths'])} ({fc.pct(fc.share(totals['deaths'], total))}; computed)"],
        ["Peak complete year", f"{pk_year} ({pk_n:,})" if pk_year else "Not recorded"],
        [f"Reports {last_complete} and change from {last_complete - 1}", f"{fc.num(lc['reports'])} ({fc.pct(yoy)} computed)" if yoy is not None else fc.num(lc["reports"])],
        [f"Share of all FAERS reports, {last_complete}", f"{fc.pct(lc['share_of_national'], 3)} (computed: product reports / all FAERS reports received {last_complete})"],
        ["Lawyer-reported share, all years", f"{fc.pct(lawyer_share)} (computed); peak lawyer-reported year {law_peak[0]} ({law_peak[1]:,})" if law_peak[0] else fc.pct(lawyer_share)],
        ["Reporter qualification", mix_text(qual) if qual else "Not recorded"],
        ["Patient sex", mix_text(sex) if sex else "Not recorded"],
        ["Patient onset age (recorded in years)", "; ".join(f"{b['label']} {b['count']:,}" for b in age_years if b["count"])
         + f" — {fc.num(age_years_total)} reports give an onset age in years; {fc.num(age_not_in_years)} give none or another unit" if age_years and age_years_total else "Not recorded"],
        ["Patient age group (coded field)", mix_text(agegroup) if agegroup else "Not recorded"],
        ["Top reactions, all years (MedDRA PT)", terms_text(pt_all)],
        [f"Top reactions, received {fc.RECENT_LABEL}", terms_text(pt_recent)],
        ["Reports by year", series_years_text(series)],
        ["Data through", f"{nat['through']} (openFDA last updated {nat['last_updated']})"],
        ["Caveat", CAVEAT],
    ]
    if vaccine:
        facts.insert(5, ["Reporting system note", "Vaccine adverse events are reported mainly to VAERS (the AEMS Vaccines dashboard), "
                         "which openFDA does not carry; VAERS bulk files sit behind a CAPTCHA and were not acquired. "
                         "These figures cover only reports in FAERS."])
    if alt:
        facts.insert(4, ["Search used for these figures", f"{search} — an alternate search added by this stream, not the search recorded in mass_tort_products.json"])
        facts.insert(5, ["Why an alternate search", f"{alt['why']}. The recorded search matched 0 reports; this alternate matches reports that name the product (any listed drug) under the reported drug name. Requires review before it replaces the recorded search."])
    if gaps:
        facts.append(["Not recorded", "; ".join(gaps)])
    keys = [k(s) for s in FAERS_LABELS]
    labels = {k(s): l for s, l in FAERS_LABELS.items()}
    links = [lens_link(m, titles), {"url": f"/records/agency_safety_mass_tort_signals/{m}", "label": "Mass-tort product signal"},
             {"url": f"/records/{D_NATIONAL}/all_years", "label": "FAERS national totals (denominators)"},
             {"url": dash["url"], "label": dash["title"]}, {"url": fc.DOCS["drug"], "label": "openFDA drug adverse events (FAERS)"}]
    links += query_links(store, keys, labels)
    if alt:
        links.append({"url": store.url(f"faers_{m}_year_all"), "label": "openFDA query: search recorded in mass_tort_products.json (matches no reports)"})
    badges = [b for b in ["Vaccine: FAERS subset" if vaccine else None, "Alternate search" if alt else None,
                          "Requires review" if total == 0 or alt else None,
                          f"{fc.pct(lawyer_share)} lawyer-reported" if lawyer_share else None] if b]
    scope = fc.SEARCH_SCOPE["faers"].get(m)
    if scope:
        facts.insert(4, ["Search scope", scope])
        badges.append("Broad search")
    return mk(
        D_PRODUCT, str(m), f"{entry['product']} — FAERS reports (MDL {m})", source_url=store.url(k("year_all")),
        subtitle=f"{fc.num(total)} FAERS reports · {fc.num(totals['serious'])} serious · {fc.num(totals['deaths'])} death outcome · {CAVEAT_SHORT}",
        cells={"mdl": str(m), "product": entry["product"], "reports": fc.num(total), "serious": fc.num(totals["serious"]),
               "deaths": fc.num(totals["deaths"]), "reports_latest": fc.num(lc["reports"]),
               "share_latest": fc.pct(lc["share_of_national"], 3), "lawyer_share": fc.pct(lawyer_share),
               "peak_year": str(pk_year) if pk_year else "Not recorded"},
        facts=facts, text=f"{entry['product']} {titles.get(m, '')} FAERS {' '.join(t['term'] for t in (pt_all or []))}",
        filters={"product_type": ["vaccine" if vaccine else "drug"], "mdl": [str(m)], "lawyer_band": [lawyer_band(lawyer_share)]},
        badges=badges, links=links,
        extra={"kind": "faers_product", "mdl": m, "product": entry["product"], "search": entry["faers"],
               "search_used": search, "search_basis": "alternate" if alt else "recorded",
               "recorded_search_reports": 0 if alt else total, "alternate_search_reason": alt["why"] if alt else None, "series": series,
               "totals": totals, "top_reactions_all": pt_all, "top_reactions_recent": pt_recent, "recent_period": fc.RECENT_LABEL,
               "recent_reports": recent_total, "reporters": qual, "sex": sex, "age_group": agegroup,
               "age_years": age_years, "age_years_total": age_years_total, "age_not_in_years": age_not_in_years,
               "peak": {"year": pk_year, "reports": pk_n},
               "yoy_latest_complete": yoy, "latest_complete_year": last_complete, "lawyer_share": lawyer_share,
               "data_through": nat["through"], "dashboard": dash,
               "not_recorded": gaps, "companies": {"linked": [], "method": "Not attempted: FAERS public data have no manufacturer field attributable to the queried product (openfda.manufacturer_name describes every drug in a report)."}},
    )


# ---------------------------------------------------------------- MAUDE devices

def maude_years(store, prefix, gaps):
    out = {"all": years_of(store, f"{prefix}_year_all", gaps)}
    for et in fc.MAUDE_EVENT_TYPES:
        out[et] = years_of(store, f"{prefix}_year_{et.lower()}", gaps)
    return out


def event_mix(results, total):
    labels = {"": "Blank (not recorded)"}
    mix = [{"label": labels.get(r["term"], r["term"]), "count": int(r["count"]), "share": fc.share(int(r["count"]), total)} for r in results]
    missing = total - sum(x["count"] for x in mix)
    if missing:
        mix.append({"label": "Field absent", "count": missing, "share": fc.share(missing, total)})
    return mix


def device_series(ys, first, last, partial_year, nat_by=None):
    series = []
    for y, n in fc.year_series(ys["all"], first, last):
        p = {"year": y, "reports": n, "partial": y == partial_year}
        for et in fc.MAUDE_EVENT_TYPES:
            p[et.lower()] = ys[et].get(y, 0) if ys[et] is not None else None
        parts = [p[et.lower()] for et in fc.MAUDE_EVENT_TYPES]
        p["other_or_unclassified"] = n - sum(parts) if None not in parts else None
        if nat_by is not None:
            p["national_reports"] = nat_by[y]["reports"]
            p["share_of_national"] = fc.share(n, nat_by[y]["reports"])
        series.append(p)
    return series


DEVICE_LABELS = {"year_all": "reports by date received", "year_death": "event type Death", "year_injury": "event type Injury",
                 "year_malfunction": "event type Malfunction", "event_type": "event type, all years",
                 "problems_all": "top device problems, all years", "problems_recent": f"top device problems, {fc.RECENT_LABEL}",
                 "manufacturers": "manufacturer names on matching reports"}


def maude_national(store, gaps):
    end, last, partial = through(store, "maude_nat_year_all")
    ys = maude_years(store, "maude_nat", gaps)
    series = device_series(ys, DEVICE_FIRST_YEAR, last, last if partial else None)
    prev = None
    for p in series:
        p["yoy"] = None if p["partial"] or prev is None else fc.yoy(p["reports"], prev)
        prev = p["reports"]
    total = sum(ys["all"].values())
    mix = attempt(lambda: event_mix(store.results("maude_nat_event_type"), total), gaps, "maude_nat_event_type")
    return {"series": series, "by_year": {p["year"]: p for p in series}, "total": total, "before": fc.before(ys["all"], DEVICE_FIRST_YEAR),
            "event_mix": mix, "through": iso(end), "last": last, "partial": partial, "last_complete": last - 1 if partial else last,
            "last_updated": store.meta("maude_nat_year_all").get("last_updated")}


def maude_national_row(store, nat, gaps):
    keys = ["maude_nat_year_all"] + [f"maude_nat_year_{et.lower()}" for et in fc.MAUDE_EVENT_TYPES] + ["maude_nat_event_type"]
    labels = dict(zip(keys, ["all reports by date received"] + [f"event type {et}" for et in fc.MAUDE_EVENT_TYPES] + ["event type, all years"]))
    lc = nat["by_year"][nat["last_complete"]]
    facts = [
        ["Source", "FDA MAUDE (Manufacturer and User Facility Device Experience) via openFDA device/event (count aggregates)"],
        ["Related FDA dashboard", "None of the three FIS dashboards covers devices; MAUDE is searchable at accessdata.fda.gov"],
        ["Period", f"Reports received {DEVICE_FIRST_YEAR}–{nat['last']} ({nat['last']} partial, through {nat['through']}); {nat['before']:,} reports carry earlier dates as recorded"],
        ["Units", "Medical device reports (MDRs)"],
        ["Reports, all dates", fc.num(nat["total"])],
        ["Event type, all years", mix_text(nat["event_mix"]) if nat["event_mix"] else "Not recorded"],
        [f"Reports {nat['last_complete']}", f"{fc.num(lc['reports'])}: death {fc.num(lc['death'])}, injury {fc.num(lc['injury'])}, malfunction {fc.num(lc['malfunction'])}"],
        ["Reports by year", series_years_text(nat["series"])],
        ["Data through", f"{nat['through']} (openFDA last updated {nat['last_updated']})"],
        ["Caveat", CAVEAT],
    ] + ([["Not recorded", "; ".join(gaps)]] if gaps else [])
    return mk(
        D_DEVICE, "national", f"MAUDE national reports by year and event type, {DEVICE_FIRST_YEAR}–{nat['last']}",
        source_url=store.url("maude_nat_year_all"), subtitle=f"{fc.num(nat['total'])} reports · denominators for product shares",
        cells={"mdl": "—", "product": "All devices (national)", "reports": fc.num(nat["total"]),
               "deaths": fc.num(sum(p["death"] or 0 for p in nat["series"])), "injuries": fc.num(sum(p["injury"] or 0 for p in nat["series"])),
               "malfunctions": fc.num(sum(p["malfunction"] or 0 for p in nat["series"])), "reports_latest": fc.num(lc["reports"]),
               "share_latest": "100%", "top_problem": "—"},
        facts=facts, text="MAUDE national device adverse event reports death injury malfunction",
        filters={"row_kind": ["national"], "mdl": ["none"]}, badges=["Series"],
        links=[{"url": fc.DOCS["device"], "label": "openFDA device adverse events (MAUDE)"}] + query_links(store, keys, labels),
        extra={"kind": "maude_national", "series": nat["series"], "event_mix": nat["event_mix"], "total": nat["total"],
               "data_through": nat["through"], "last_updated": nat["last_updated"]},
    )


def device_product(store, entry, nat, titles, cidx, ridx=None):
    """One MAUDE product row. cidx: SEC profile name index; ridx: company_adverse_manufacturers title index (optional)."""
    ridx = ridx or {}
    m = entry["mdl"]
    k = lambda s: f"maude_{m}_{s}"  # noqa: E731
    gaps = []
    ys = maude_years(store, f"maude_{m}", gaps)
    if ys["all"] is None:
        raise RuntimeError(f"MDL {m}: the main MAUDE series is missing; rerun the fetcher")
    total = sum(ys["all"].values())
    in_range = [y for y, n in ys["all"].items() if n and y >= DEVICE_FIRST_YEAR]
    first = min(in_range) if in_range else nat["last"]
    series = device_series(ys, first, nat["last"], nat["last"] if nat["partial"] else None, nat["by_year"])
    by = {p["year"]: p for p in series}
    recent_total = sum(ys["all"].get(y, 0) for y in range(int(fc.RECENT_FROM[:4]), int(fc.RECENT_TO[:4]) + 1))
    mix = attempt(lambda: event_mix(store.results(k("event_type")), total), gaps, k("event_type"))
    probs = attempt(lambda: fc.top_terms(store.results(k("problems_all")), total), gaps, k("problems_all"))
    probs_recent = attempt(lambda: fc.top_terms(store.results(k("problems_recent")), recent_total), gaps, k("problems_recent"))
    mres = attempt(lambda: fc.term_counts(store.results(k("manufacturers"))), gaps, k("manufacturers")) or []
    manufacturers, stats = [], {"names": len(mres), "matched": 0, "ambiguous": 0, "unmatched": 0, "matched_reports": 0,
                                "name_reports": sum(t["count"] for t in mres), "record_matched": 0, "record_ambiguous": 0}
    by_cik, by_record = {}, {}  # exactly matched reports per SEC registrant / per company_adverse_manufacturers record
    for t in mres:
        status, val = fc.match_company(t["term"], cidx)
        stats[status] += 1
        rec = {"name": t["term"], "reports": t["count"], "match": status}
        if status == "matched":
            rec["cik"] = val
            stats["matched_reports"] += t["count"]
            g = by_cik.setdefault(val, {"reports": 0, "names": []})
            g["reports"] += t["count"]
            g["names"].append(t["term"])
        elif status == "ambiguous":
            rec["candidates"] = val
        recs, amb = fc.match_manufacturer_records(t["term"], ridx)
        if recs:
            rec["company_adverse_manufacturers"] = recs
            stats["record_matched"] += 1
            for rid in recs:
                g = by_record.setdefault(rid, {"reports": 0, "names": []})
                g["reports"] += t["count"]
                g["names"].append(t["term"])
        if amb:
            rec["company_adverse_manufacturers_ambiguous_sources"] = amb
            stats["record_ambiguous"] += 1
        manufacturers.append(rec)
    # Row-level links only where the exactly matched names carry a real share of the product's reports (see COMPANY_LINK_MIN_SHARE).
    links_co, withheld = [], []
    for kind, groups in (("cik", by_cik), ("record", by_record)):
        for key, g in groups.items():
            share_ = fc.share(g["reports"], total)
            url = f"/companies/{key}" if kind == "cik" else f"/records/company_adverse_manufacturers/{key}"
            what = f"SEC registrant {key}" if kind == "cik" else f"company_adverse_manufacturers record {key}"
            names = ", ".join(f"“{n}”" for n in g["names"][:3]) + (" …" if len(g["names"]) > 3 else "")
            note = f"{what}: exact normalized name match to MAUDE manufacturer name(s) {names}, {g['reports']:,} of {total:,} reports on this product ({fc.pct(share_, 2)})"
            if share_ is not None and share_ >= fc.COMPANY_LINK_MIN_SHARE:
                links_co.append({"url": url, "label": note})
            else:
                withheld.append({"url": url, "reports": g["reports"], "share": share_, "names": g["names"]})
    # A name match below the threshold is not evidence that the company makes the product: take its identifiers off the manufacturer list too.
    kept = {l["url"].rsplit("/", 1)[-1] for l in links_co}
    for rec in manufacturers:
        dropped = []
        if "cik" in rec and rec["cik"] not in kept:
            dropped.append(rec.pop("cik"))
        if rec.get("company_adverse_manufacturers"):
            ids = rec["company_adverse_manufacturers"]
            dropped += [i for i in ids if i not in kept]
            if any(i in kept for i in ids):
                rec["company_adverse_manufacturers"] = [i for i in ids if i in kept]
            else:
                rec.pop("company_adverse_manufacturers")
        if dropped:
            rec["links_withheld"] = (f"exact name match to {', '.join(dropped)} not used as a link: the matched names carry under {fc.pct(fc.COMPANY_LINK_MIN_SHARE, 0)} "
                                     "of this product's reports, and a name match is not evidence that the company makes the product")
    stats["linked_companies"] = sum(1 for l in links_co if l["url"].startswith("/companies/"))
    stats["linked_records"] = len(links_co) - stats["linked_companies"]
    stats["withheld_below_min_share"] = len(withheld)
    pk_year, pk_n = peak(series, nat["last_complete"])
    lc = by.get(nat["last_complete"])
    prev = by.get(nat["last_complete"] - 1)
    yoy = fc.yoy(lc["reports"], prev["reports"]) if lc and prev else None
    deaths = sum(ys["Death"].values()) if ys["Death"] is not None else None
    injuries = sum(ys["Injury"].values()) if ys["Injury"] is not None else None
    malfunctions = sum(ys["Malfunction"].values()) if ys["Malfunction"] is not None else None
    facts = [
        ["MDL", f"{m} — {titles.get(m, 'Not recorded')}"],
        ["Product", entry["product"]],
        ["Source", "FDA MAUDE via openFDA device/event (count aggregates)"],
        ["openFDA search (from mass_tort_products.json)", entry["maude"]],
        ["Related FDA dashboard", "None of the three FIS dashboards covers devices"],
        ["Period", f"Reports received {first}–{nat['last']} ({nat['last']} partial, through {nat['through']})"],
        ["Units", "Medical device reports (MDRs) matching the search"],
        ["Reports, all dates", fc.num(total)],
        ["Event type, all years", mix_text(mix) if mix else "Not recorded"],
        ["Peak complete year", f"{pk_year} ({pk_n:,})" if pk_year else "Not recorded"],
        [f"Reports {nat['last_complete']} and change from {nat['last_complete'] - 1}",
         (f"{fc.num(lc['reports'])} ({fc.pct(yoy)} computed)" if yoy is not None else fc.num(lc["reports"])) if lc else "Not recorded"],
        [f"Share of all MAUDE reports, {nat['last_complete']}", f"{fc.pct(lc['share_of_national'], 3)} (computed: product reports / all MAUDE reports received {nat['last_complete']})" if lc else "Not recorded"],
        ["Top device problems, all years", terms_text(probs)],
        [f"Top device problems, {fc.RECENT_LABEL}", terms_text(probs_recent)],
        ["Manufacturer names on matching reports", "; ".join(f"{x['name']} ({x['reports']:,})" for x in manufacturers[:8]) or "Not recorded"],
        ["Company match", f"{stats['matched']} of {stats['names']} manufacturer names matched an SEC registrant exactly (unique, normalized); {stats['ambiguous']} ambiguous; {stats['unmatched']} unmatched. "
                          f"{stats['record_matched']} names equal the title of a company_adverse_manufacturers record. "
                          f"Row-level company links are added only when the exactly matched names carry at least {fc.pct(fc.COMPANY_LINK_MIN_SHARE, 0)} of this product's reports: "
                          f"{stats['linked_companies']} SEC and {stats['linked_records']} company_adverse_manufacturers links added, {stats['withheld_below_min_share']} withheld (smaller share; kept in the manufacturer list)"],
        ["Reports by year", series_years_text(series)],
        ["Data through", f"{nat['through']} (openFDA last updated {nat['last_updated']})"],
        ["Caveat", CAVEAT],
    ] + ([["Not recorded", "; ".join(gaps)]] if gaps else [])
    scope = fc.SEARCH_SCOPE["maude"].get(m)
    if scope:
        facts.insert(4, ["Search scope", scope])
    keys = [k(s) for s in DEVICE_LABELS]
    labels = {k(s): l for s, l in DEVICE_LABELS.items()}
    links = [lens_link(m, titles), {"url": f"/records/agency_safety_mass_tort_signals/{m}", "label": "Mass-tort product signal"},
             {"url": f"/records/{D_DEVICE}/national", "label": "MAUDE national totals (denominators)"}] + links_co
    links += [{"url": fc.DOCS["device"], "label": "openFDA device adverse events (MAUDE)"}] + query_links(store, keys, labels)
    return mk(
        D_DEVICE, str(m), f"{entry['product']} — MAUDE reports (MDL {m})", source_url=store.url(k("year_all")),
        subtitle=f"{fc.num(total)} MAUDE reports · {fc.num(deaths)} death · {fc.num(injuries)} injury · {fc.num(malfunctions)} malfunction · {CAVEAT_SHORT}",
        cells={"mdl": str(m), "product": entry["product"], "reports": fc.num(total), "deaths": fc.num(deaths),
               "injuries": fc.num(injuries), "malfunctions": fc.num(malfunctions),
               "reports_latest": fc.num(lc["reports"]) if lc else "Not recorded",
               "share_latest": fc.pct(lc["share_of_national"], 3) if lc else "Not recorded",
               "top_problem": probs[0]["term"] if probs else "Not recorded"},
        facts=facts, text=f"{entry['product']} {titles.get(m, '')} MAUDE {' '.join(t['term'] for t in (probs or []))} {' '.join(x['name'] for x in manufacturers[:10])}",
        filters={"row_kind": ["product"], "mdl": [str(m)], "company_linked": ["yes" if links_co else "no"]},
        badges=[b for b in ["Company linked" if links_co else None, "Broad search" if scope else None] if b], links=links,
        extra={"kind": "maude_product", "mdl": m, "product": entry["product"], "search": entry["maude"], "series": series,
               "totals": {"reports": total, "death": deaths, "injury": injuries, "malfunction": malfunctions},
               "event_mix": mix, "top_problems_all": probs, "top_problems_recent": probs_recent, "recent_period": fc.RECENT_LABEL,
               "recent_reports": recent_total, "manufacturers": manufacturers, "company_match": stats,
               "company_links_withheld": withheld, "company_link_min_share": fc.COMPANY_LINK_MIN_SHARE,
               "peak": {"year": pk_year, "reports": pk_n}, "yoy_latest_complete": yoy, "latest_complete_year": nat["last_complete"],
               "data_through": nat["through"], "not_recorded": gaps},
    ), stats


# ---------------------------------------------------------------- CAERS

def caers_national(store, gaps):
    end, last, partial = through(store, "caers_nat_year_all")
    all_y = years_of(store, "caers_nat_year_all", gaps)
    dea = years_of(store, "caers_nat_year_death", gaps)
    series, prev = [], None
    for y, n in fc.year_series(all_y, fc.FIRST_YEAR, last):
        p = {"year": y, "reports": n, "deaths": dea.get(y, 0) if dea is not None else None, "partial": y == last and partial}
        p["death_share"] = fc.share(p["deaths"], n)
        p["yoy"] = None if p["partial"] or prev is None else fc.yoy(n, prev)
        prev = n
        series.append(p)
    total = sum(all_y.values())
    outcomes = attempt(lambda: [dict(t, share=fc.share(t["count"], total)) for t in fc.term_counts(store.results("caers_nat_outcomes"))], gaps, "caers_nat_outcomes")
    industries = attempt(lambda: fc.term_counts(store.results("caers_nat_industry")), gaps, "caers_nat_industry") or []
    brands = attempt(lambda: fc.term_counts(store.results("caers_nat_brand")), gaps, "caers_nat_brand") or []
    for rank, t in enumerate(industries, 1):
        t.update(rank=rank, share=fc.share(t["count"], total))
    for rank, t in enumerate(brands, 1):
        t.update(rank=rank, share=fc.share(t["count"], total), placeholder=t["term"] in fc.CAERS_NON_PRODUCT_BRANDS)
    return {"series": series, "by_year": {p["year"]: p for p in series}, "total": total, "before": fc.before(all_y, fc.FIRST_YEAR),
            "outcomes": outcomes, "industries": industries, "brands": brands, "through": iso(end), "last": last,
            "partial": partial, "last_complete": last - 1 if partial else last,
            "last_updated": store.meta("caers_nat_year_all").get("last_updated")}


def caers_cells(label, row_kind, reports, latest, deaths, share_latest, rank="—"):
    return {"name": label, "row_kind": row_kind, "reports": reports, "reports_latest": latest, "deaths": deaths,
            "share_latest": share_latest, "rank": rank}


CAERS_SOURCE = "FDA CFSAN Adverse Event Reporting System (CAERS) via openFDA food/event (count aggregates)"
CAERS_UNITS = "Reports (a report can name several products and industries, so product and industry counts overlap)"


def caers_rows(store, nat, products, titles, gaps):
    rows = []
    cos = fc.DASHBOARDS["cosmetics"]
    base = [{"url": fc.DOCS["food"], "label": "openFDA food, supplement and cosmetic adverse events (CAERS)"}]
    nat_keys = {"caers_nat_year_all": "all reports by date created", "caers_nat_year_death": "reports with outcome Death",
                "caers_nat_outcomes": "outcomes", "caers_nat_industry": "industries", "caers_nat_brand": "brand names"}
    lcy = nat["last_complete"]
    for p in nat["series"]:
        y = p["year"]
        facts = [["Source", CAERS_SOURCE], ["Period", f"Reports created {y}" + (f" (partial, through {nat['through']})" if p["partial"] else "")],
                 ["Units", "Reports"], ["Reports", fc.num(p["reports"])],
                 ["Reports with outcome Death", f"{fc.num(p['deaths'])} ({fc.pct(p['death_share'])}; computed)"],
                 ["Change from previous year", "Not applicable (partial year)" if p["partial"] else (fc.pct(p["yoy"]) + " (computed)" if p["yoy"] is not None else "Not recorded")],
                 ["Data through", f"{nat['through']} (openFDA last updated {nat['last_updated']})"], ["Caveat", CAVEAT]]
        rows.append(mk(D_CAERS, f"year-{y}", f"CAERS reports created in {y}" + (" (partial year)" if p["partial"] else ""),
                       source_url=store.url("caers_nat_year_all"), subtitle=f"{fc.num(p['reports'])} reports · {fc.num(p['deaths'])} with outcome Death",
                       cells=caers_cells(str(y), "year", fc.num(p["reports"]), fc.num(p["reports"]), fc.num(p["deaths"]), "100%"),
                       facts=facts, text=f"CAERS {y} food supplement cosmetic adverse event reports",
                       filters={"row_kind": ["year"], "completeness": ["partial" if p["partial"] else "complete"]},
                       badges=["Partial year"] if p["partial"] else [], links=base + query_links(store, ["caers_nat_year_all", "caers_nat_year_death"], nat_keys),
                       extra={"kind": "caers_year", "year": y, "point": p, "data_through": nat["through"]}))
    # Whole-series summary row with the rankings.
    named = [b for b in nat["brands"] if not b["placeholder"]]
    withheld = next((b for b in nat["brands"] if b["placeholder"]), None)
    facts = [["Source", CAERS_SOURCE], ["Related FDA dashboard", f"{cos['title']} (cosmetics subset){fc.DASHBOARD_CAVEAT}; foods and supplements have no dashboard among the three"],
             ["Period", f"Reports created {fc.FIRST_YEAR}–{nat['last']} ({nat['last']} partial, through {nat['through']}); {nat['before']:,} reports carry earlier dates"],
             ["Units", CAERS_UNITS], ["Reports, all dates", fc.num(nat["total"])],
             ["Outcomes, all years", "; ".join(f"{o['term']} {o['count']:,}" for o in nat["outcomes"] or []) or "Not recorded"],
             ["Top industries", "; ".join(f"{t['term']} {t['count']:,}" for t in nat["industries"][:10]) or "Not recorded"],
             ["Top named products (brand)", "; ".join(f"{t['term']} {t['count']:,}" for t in named[:10]) or "Not recorded"],
             ["Brand name withheld", f"“EXEMPTION 4” (name withheld under FOIA Exemption 4) appears on {withheld['count']:,} reports; excluded from product rankings" if withheld else "Not recorded"],
             ["Reports by year", series_years_text(nat["series"])],
             ["Data through", f"{nat['through']} (openFDA last updated {nat['last_updated']})"], ["Caveat", CAVEAT]]
    rows.append(mk(D_CAERS, "all_years", f"CAERS reports by year, industry and product, {fc.FIRST_YEAR}–{nat['last']}",
                   source_url=store.url("caers_nat_year_all"), subtitle=f"{fc.num(nat['total'])} reports · denominators and rankings",
                   cells=caers_cells("All CAERS reports", "series", fc.num(nat["total"]), fc.num(nat["by_year"][lcy]["reports"]),
                                     fc.num(sum(p["deaths"] or 0 for p in nat["series"])), "100%"),
                   facts=facts, text="CAERS national series industries products foods dietary supplements cosmetics",
                   filters={"row_kind": ["series"], "completeness": ["series"]}, badges=["Series"],
                   links=base + [{"url": cos["url"], "label": cos["title"]}] + query_links(store, list(nat_keys), nat_keys),
                   extra={"kind": "caers_series", "series": nat["series"], "outcomes": nat["outcomes"], "industries": nat["industries"],
                          "brands": nat["brands"], "total": nat["total"], "data_through": nat["through"], "last_updated": nat["last_updated"]}))
    # Ranked industry and brand rows with yearly series.
    ind_names, brand_names = fc.choose_caers_ranked(nat["industries"], nat["brands"])
    for kind, names, ranking in (("industry", ind_names, nat["industries"]), ("product", brand_names, nat["brands"])):
        for name in names:
            key = f"caers_{'ind' if kind == 'industry' else 'brand'}_{fc.slug(name)}_year_all"
            g = []
            ys = years_of(store, key, g)
            rk = next(t for t in ranking if t["term"] == name)
            series = []
            if ys is not None:
                for y, n in fc.year_series(ys, fc.FIRST_YEAR, nat["last"]):
                    series.append({"year": y, "reports": n, "partial": nat["by_year"][y]["partial"],
                                   "share_of_national": fc.share(n, nat["by_year"][y]["reports"])})
            lc = next((p for p in series if p["year"] == lcy), None)
            is_cos = kind == "industry" and name == "Cosmetics"
            facts = [["Source", CAERS_SOURCE], ["openFDA search", f"products.{'industry_name' if kind == 'industry' else 'name_brand'}.exact:\"{name}\""],
                     ["Related FDA dashboard", (cos["title"] + fc.DASHBOARD_CAVEAT) if is_cos else "None among the three FIS dashboards"],
                     ["Period", f"Reports created {fc.FIRST_YEAR}–{nat['last']} ({nat['last']} partial, through {nat['through']})"],
                     ["Units", CAERS_UNITS], [f"Reports naming this {kind}", f"{rk['count']:,} (rank {rk['rank']} of {len(ranking)} listed)"],
                     ["Share of all CAERS reports", f"{fc.pct(rk['share'])} (computed; overlapping categories)"],
                     [f"Reports {lcy}", fc.num(lc["reports"]) if lc else "Not recorded"],
                     ["Reports by year", series_years_text(series) or "Not recorded"],
                     ["Data through", f"{nat['through']} (openFDA last updated {nat['last_updated']})"], ["Caveat", CAVEAT]]
            if g:
                facts.append(["Not recorded", "; ".join(g)])
            rows.append(mk(D_CAERS, f"{kind}-{fc.slug(name)}", f"{name} — CAERS reports by year ({kind})",
                           source_url=store.url(key) or store.url("caers_nat_industry" if kind == "industry" else "caers_nat_brand"),
                           subtitle=f"{rk['count']:,} reports · rank {rk['rank']} · {CAVEAT_SHORT}",
                           cells=caers_cells(name, kind, f"{rk['count']:,}", fc.num(lc["reports"]) if lc else "Not recorded", "—",
                                             fc.pct(lc["share_of_national"]) if lc else "Not recorded", str(rk["rank"])),
                           facts=facts, text=f"CAERS {kind} {name}", filters={"row_kind": [kind], "completeness": ["series"]},
                           badges=[b for b in ["AEMS cosmetics" if is_cos else None] if b],
                           links=base + ([{"url": cos["url"], "label": cos["title"]}] if is_cos else []) + [{"url": f"/records/{D_CAERS}/all_years", "label": "CAERS national totals"}]
                           + query_links(store, [key], {key: f"{kind} {name} by date created"}),
                           extra={"kind": f"caers_{kind}", "name": name, "rank": rk["rank"], "reports": rk["count"], "series": series,
                                  "data_through": nat["through"], "not_recorded": g}))
    # MDL product rows (food / cosmetic entries of mass_tort_products.json).
    for e in products:
        if e.get("kind") not in ("food", "cosmetic"):
            continue
        rows.append(caers_mdl_row(store, e, nat, titles, base))
    return rows


CAERS_LABELS = {"year_all": "reports by date created", "outcomes": "outcomes", "reactions": "top reactions",
                "industry": "industries", "brands": "brand names"}


def caers_mdl_row(store, e, nat, titles, base):
    m = e["mdl"]
    cos = fc.DASHBOARDS["cosmetics"]
    dash_title = cos["title"] if e["kind"] == "cosmetic" else "None among the three FIS dashboards (foods)"
    links = [lens_link(m, titles), {"url": f"/records/agency_safety_mass_tort_signals/{m}", "label": "Mass-tort product signal"},
             {"url": f"/records/{D_CAERS}/all_years", "label": "CAERS national totals (denominators)"}] + base
    if e["kind"] == "cosmetic":
        links.append({"url": cos["url"], "label": cos["title"]})
    if not e.get("caers"):
        facts = [["MDL", f"{m} — {titles.get(m, 'Not recorded')}"], ["Product", e["product"]], ["Source", CAERS_SOURCE],
                 ["openFDA search", "Not recorded: mass_tort_products.json records no CAERS search for this MDL"],
                 ["Period", "Not recorded (no search, so no series)"], ["Units", CAERS_UNITS],
                 ["Reports", "Not recorded"], ["Caveat", CAVEAT]]
        return mk(D_CAERS, f"mdl-{m}", f"{e['product']} — CAERS reports (MDL {m})", source_url=fc.DOCS["food"],
                  subtitle="No CAERS search recorded for this product", cells=caers_cells(e["product"], "mdl", "Not recorded", "Not recorded", "Not recorded", "Not recorded"),
                  facts=facts, text=f"{e['product']} {titles.get(m, '')} CAERS", filters={"row_kind": ["mdl"], "completeness": ["not_recorded"]},
                  badges=["No search recorded"], links=links,
                  extra={"kind": "caers_mdl", "mdl": m, "product": e["product"], "search": None, "series": [], "data_through": nat["through"]})
    k = lambda s: f"caers_{m}_{s}"  # noqa: E731
    gaps = []
    ys = years_of(store, k("year_all"), gaps)
    if ys is None:
        raise RuntimeError(f"MDL {m}: the CAERS series is missing; rerun the fetcher")
    total = sum(ys.values())
    series = []
    for y, n in fc.year_series(ys, fc.FIRST_YEAR, nat["last"]):
        series.append({"year": y, "reports": n, "partial": nat["by_year"][y]["partial"], "share_of_national": fc.share(n, nat["by_year"][y]["reports"])})
    outcomes = attempt(lambda: [dict(t, share=fc.share(t["count"], total)) for t in fc.term_counts(store.results(k("outcomes")))], gaps, k("outcomes"))
    reactions = attempt(lambda: fc.top_terms(store.results(k("reactions")), total), gaps, k("reactions"))
    industries = attempt(lambda: fc.term_counts(store.results(k("industry"))), gaps, k("industry"))
    brands = attempt(lambda: fc.term_counts(store.results(k("brands"))), gaps, k("brands"))
    deaths = next((o["count"] for o in outcomes or [] if o["term"] == "Death"), 0) if outcomes is not None else None
    lcy = nat["last_complete"]
    lc = next((p for p in series if p["year"] == lcy), None)
    pk_year, pk_n = peak(series, lcy)
    facts = [["MDL", f"{m} — {titles.get(m, 'Not recorded')}"], ["Product", e["product"]], ["Source", CAERS_SOURCE],
             ["openFDA search (from mass_tort_products.json)", e["caers"]], ["Related FDA dashboard", dash_title + (fc.DASHBOARD_CAVEAT if e["kind"] == "cosmetic" else "")],
             ["Period", f"Reports created {fc.FIRST_YEAR}–{nat['last']} ({nat['last']} partial, through {nat['through']})"],
             ["Units", CAERS_UNITS], ["Reports, all dates", fc.num(total)],
             ["Reports with outcome Death", fc.num(deaths)],
             ["Outcomes", "; ".join(f"{o['term']} {o['count']:,}" for o in outcomes or []) or "Not recorded"],
             ["Peak complete year", f"{pk_year} ({pk_n:,})" if pk_year else "Not recorded"],
             [f"Share of all CAERS reports, {lcy}", f"{fc.pct(lc['share_of_national'], 3)} (computed)" if lc else "Not recorded"],
             ["Top reactions (MedDRA PT)", terms_text(reactions)],
             ["Industries on matching reports", "; ".join(f"{t['term']} {t['count']:,}" for t in industries or []) or "Not recorded"],
             ["Brand names on matching reports", "; ".join(f"{t['term']} {t['count']:,}" for t in (brands or [])[:10]) or "Not recorded"],
             ["Reports by year", series_years_text(series)],
             ["Data through", f"{nat['through']} (openFDA last updated {nat['last_updated']})"], ["Caveat", CAVEAT]]
    if gaps:
        facts.append(["Not recorded", "; ".join(gaps)])
    scope = fc.SEARCH_SCOPE["caers"].get(m)
    if scope:
        facts.insert(4, ["Search scope", scope])
    keys = [k(s) for s in CAERS_LABELS]
    links += query_links(store, keys, {k(s): l for s, l in CAERS_LABELS.items()})
    return mk(D_CAERS, f"mdl-{m}", f"{e['product']} — CAERS reports (MDL {m})", source_url=store.url(k("year_all")),
              subtitle=f"{fc.num(total)} CAERS reports · {fc.num(deaths)} with outcome Death · {CAVEAT_SHORT}",
              cells=caers_cells(e["product"], "mdl", fc.num(total), fc.num(lc["reports"]) if lc else "Not recorded", fc.num(deaths),
                                fc.pct(lc["share_of_national"], 3) if lc else "Not recorded"),
              facts=facts, text=f"{e['product']} {titles.get(m, '')} CAERS {' '.join(t['term'] for t in reactions or [])}",
              filters={"row_kind": ["mdl"], "completeness": ["series"]}, badges=[e["kind"].title()] + (["Broad search"] if scope else []), links=links,
              extra={"kind": "caers_mdl", "mdl": m, "product": e["product"], "product_kind": e["kind"], "search": e["caers"],
                     "series": series, "total": total, "deaths": deaths, "outcomes": outcomes, "top_reactions": reactions,
                     "industries": industries, "brands": brands, "peak": {"year": pk_year, "reports": pk_n},
                     "data_through": nat["through"], "dashboard": dash_title, "not_recorded": gaps})


# ---------------------------------------------------------------- assembly

MATCH_KEYS = ("names", "matched", "ambiguous", "unmatched", "matched_reports", "name_reports", "record_matched",
              "record_ambiguous", "linked_companies", "linked_records", "withheld_below_min_share")


def build(store, products, titles, profiles, mfr_records=()):
    gaps = {D_NATIONAL: [], D_PRODUCT: [], D_DEVICE: [], D_CAERS: []}
    nat = faers_national(store, gaps[D_NATIONAL])
    out = {D_NATIONAL: faers_national_rows(store, nat)}
    out[D_PRODUCT] = [faers_product(store, e, nat, titles, pick_alt(store, e)) for e in products if e.get("kind") == "drug" and e.get("faers")]
    mnat = maude_national(store, gaps[D_DEVICE])
    cidx = fc.company_index(profiles)
    ridx = fc.manufacturer_record_index(mfr_records)
    dev_rows, match_totals = [maude_national_row(store, mnat, list(gaps[D_DEVICE]))], {kk: 0 for kk in MATCH_KEYS}
    for e in products:
        if e.get("kind") == "device" and e.get("maude"):
            row, stats = device_product(store, e, mnat, titles, cidx, ridx)
            dev_rows.append(row)
            for kk in match_totals:
                match_totals[kk] += stats[kk]
    out[D_DEVICE] = dev_rows
    cnat = caers_national(store, gaps[D_CAERS])
    out[D_CAERS] = caers_rows(store, cnat, products, titles, gaps[D_CAERS])
    return out, {"faers": nat, "maude": mnat, "caers": cnat, "company_match": match_totals, "gaps": gaps}


def summaries(ctx, out):
    nat, mnat, cnat = ctx["faers"], ctx["maude"], ctx["caers"]
    sources = {"faers": {"name": "FAERS public data via openFDA drug/event", "url": fc.DOCS["drug"], "data_through": nat["through"], "last_updated": nat["last_updated"]},
               "maude": {"name": "MAUDE via openFDA device/event", "url": fc.DOCS["device"], "data_through": mnat["through"], "last_updated": mnat["last_updated"]},
               "caers": {"name": "CAERS via openFDA food/event", "url": fc.DOCS["food"], "data_through": cnat["through"], "last_updated": cnat["last_updated"]}}
    terms = {"terms": "https://open.fda.gov/terms/", "license": "https://open.fda.gov/license/ (CC0 1.0; no endorsement implied)",
             "rate_limit": "openFDA without a key: 240 requests/minute and 1,000/day per IP"}
    common = {"caveat": CAVEAT, "terms": terms, "dashboards": fc.DASHBOARDS,
              "retrieval": "openFDA count aggregates fetched directly (no key, <= 2 requests/second); raw responses kept unchanged with sha256 in private/acq/fda_adverse_events/_manifest.jsonl"}
    return {
        D_NATIONAL: {**common, "source": sources["faers"], "rows": len(out[D_NATIONAL]),
                     "formulas": {"serious_share": "serious reports / all reports received that year",
                                  "death_share": "death-outcome reports (seriousnessdeath = 1) / all reports that year",
                                  "lawyer_share": "reports whose primary reporter qualification is 4 (Lawyer) / all reports that year",
                                  "yoy": "(reports in year - reports in previous year) / reports in previous year; not computed for the partial year",
                                  "reporter_not_recorded": "all reports - sum of the five qualification counts"},
                     "period": f"{fc.FIRST_YEAR}–{nat['last']} by FDA receive date (receivedate = first version received); {nat['last']} partial through {nat['through']}",
                     "dashboard": fc.DASHBOARDS["faers"], "not_recorded": ctx["gaps"][D_NATIONAL]},
        D_PRODUCT: {**common, "source": sources["faers"], "rows": len(out[D_PRODUCT]),
                    "formulas": {"share_of_national": "product reports received in year / all FAERS reports received in year (fda_faers_national_series)",
                                 "serious_share": "product serious reports / product reports", "death_share": "product death-outcome reports / product reports",
                                 "lawyer_share": "product reports with reporter qualification Lawyer / product reports",
                                 "top_reactions": f"openFDA count of patient.reaction.reactionmeddrapt.exact (top {fc.TERM_FETCH_LIMIT}), spellings differing only in case summed, top {fc.TOP_N} kept; share_of_reports = term count / product reports in the period (a report lists several terms)",
                                 "recent": f"latest three complete calendar years: {fc.RECENT_LABEL}",
                                 "age_years": "onset age where the unit is years (801), counted in two value ranges (0–64.999, 65+) and bucketed 0–2, 3–11, 12–17, 18–64, 65–85, 86–120, over 120 (implausible, as recorded); age_not_in_years = reports - reports with an onset age in years (no age, or age in decades/months/weeks/days/hours)",
                                 "not_recorded": "total reports - sum of coded values for qualification, sex and age group",
                                 "yoy_latest_complete": "(reports in the latest complete year - reports in the year before) / reports in the year before; the partial year is never used",
                                 "peak": "the complete calendar year with the most reports (the earlier year on a tie); the partial year is excluded",
                                 "lawyer_band": "the product's all-years lawyer-reported share (reports with primary reporter qualification Lawyer / all product reports) in bands: 25% or more, 10-25%, 1-10%, under 1%",
                                 "mix_shares": "reporter, sex and age-group shares = reports in the category / all product reports (the remainder is shown as Not recorded); age_years[].share_of_age_in_years = reports in the age bucket / reports with an onset age in years"},
                    "search_terms": "Exact openFDA search expressions from scripts/enrichment/mass_tort_products.json; each query URL is stored in the row links. "
                                    "Exception: where the recorded search matches no report at all and an alternate search on the reported drug name does (Tepezza, MDL 3079), the row uses the alternate, says so in its facts, badges and search_basis field, and links the recorded query that matched nothing",
                    "vaccines": "Zostavax (MDL 2848) and Gardasil (MDL 3036) are vaccines: their main reporting system is VAERS (AEMS Vaccines dashboard), not in openFDA; VAERS bulk downloads are CAPTCHA-gated and were not acquired, so these rows show the FAERS subset only",
                    "companies": "No company links: FAERS public data have no manufacturer field attributable to the queried product",
                    "matters": "Every row links /matters/lens/<MDL> because mass_tort_products.json records the MDL number explicitly; all 42 product MDLs exist in mdl_analytics",
                    "dashboard": fc.DASHBOARDS["faers"], "period": f"{fc.FIRST_YEAR}–{nat['last']} ({nat['last']} partial through {nat['through']})"},
        D_DEVICE: {**common, "source": sources["maude"], "rows": len(out[D_DEVICE]),
                   "formulas": {"share_of_national": "product reports received in year / all MAUDE reports received in year (row 'national')",
                                "other_or_unclassified": "reports - (Death + Injury + Malfunction): event type Other, No answer provided, blank or absent",
                                "top_problems": f"openFDA count of product_problems.exact (top {fc.TERM_FETCH_LIMIT}), case variants summed, top {fc.TOP_N}; share_of_reports = problem count / product reports in the period",
                                "recent": f"{fc.RECENT_LABEL}",
                                "yoy_latest_complete": "(reports in the latest complete year - reports in the year before) / reports in the year before; the partial year is never used",
                                "peak": "the complete calendar year with the most reports (the earlier year on a tie); the partial year is excluded",
                                "event_mix": "reports with event type Death, Injury, Malfunction / all product reports; the rest is Other, No answer provided, blank or absent"},
                   "company_match": {"rule": "MAUDE device.manufacturer_d_name (top 100 names on matching reports) linked to /companies/<CIK> only on a unique exact match to a company_sec_profiles name after normalisation: upper case, SEC state suffix (/DE, /PA/, /NEW/) removed, & -> AND, punctuation . , ' \" ( ) replaced by a space, whitespace collapsed, CORPORATION/INCORPORATED/COMPANY/LIMITED -> CORP/INC/CO/LTD (legal forms never dropped). Subsidiaries and divisions are not merged. "
                                     "The same normalisation links a name to /records/company_adverse_manufacturers/<id> when it equals the title of exactly one 'Exact-name match' record per source (SEC registrant or CMS Open Payments entity). "
                                     f"A row-level link is added only when the exactly matched names carry at least {fc.pct(fc.COMPANY_LINK_MIN_SHARE, 0)} of the product's reports (a few reports under a shared brand name, e.g. TRILOGY, do not show who made the product); smaller matches stay in item.manufacturers by name only (links_withheld records the identifier that was not used); a CIK or record id is never kept where the link is withheld.",
                                     "min_share": fc.COMPANY_LINK_MIN_SHARE, **ctx["company_match"]},
                   "dashboard": "None of the three FIS dashboards covers devices", "period": f"{DEVICE_FIRST_YEAR}–{mnat['last']} ({mnat['last']} partial through {mnat['through']})"},
        D_CAERS: {**common, "source": sources["caers"], "rows": len(out[D_CAERS]),
                  "formulas": {"share": "reports naming the industry/brand / all CAERS reports (categories overlap: a report can name several products)",
                               "death_share": "reports with outcome Death / all reports that year", "yoy": "(year - previous) / previous; not for the partial year"},
                  "rankings": f"Industry rows: top {fc.CAERS_TOP_INDUSTRIES} industries plus Cosmetics; product rows: top {fc.CAERS_TOP_BRANDS} brand names excluding the placeholder 'EXEMPTION 4' (name withheld under FOIA Exemption 4)",
                  "dashboard": fc.DASHBOARDS["cosmetics"], "period": f"{fc.FIRST_YEAR}–{cnat['last']} ({cnat['last']} partial through {cnat['through']})",
                  "companies": "No company links: openFDA CAERS records carry brand and industry names, not manufacturers"},
    }


def listings(ctx):
    nat, mnat, cnat = ctx["faers"], ctx["maude"], ctx["caers"]
    return {
        D_NATIONAL: cw.listing([("year", "Year"), ("reports", "Reports"), ("serious", "Serious"), ("deaths", "Death outcome"),
                                ("serious_pct", "Serious %"), ("lawyer_pct", "Lawyer-reported %"), ("yoy", "Change")],
                               [("completeness", "Period", {"complete": "Complete year", "partial": "Partial year", "series": "Whole series"})]),
        D_PRODUCT: cw.listing([("mdl", "MDL"), ("product", "Product"), ("reports", "Reports"), ("serious", "Serious"), ("deaths", "Death outcome"),
                               ("reports_latest", f"Reports {nat['last_complete']}"), ("share_latest", f"Share of FAERS {nat['last_complete']}"),
                               ("lawyer_share", "Lawyer-reported"), ("peak_year", "Peak year")],
                              [("product_type", "Product type", {"drug": "Drug or biologic", "vaccine": "Vaccine (FAERS subset)"}),
                               ("lawyer_band", "Lawyer-reported share", {label: label for _, label in LAWYER_BANDS})]),
        D_DEVICE: cw.listing([("mdl", "MDL"), ("product", "Product"), ("reports", "Reports"), ("deaths", "Death"), ("injuries", "Injury"),
                              ("malfunctions", "Malfunction"), ("reports_latest", f"Reports {mnat['last_complete']}"),
                              ("share_latest", f"Share of MAUDE {mnat['last_complete']}"), ("top_problem", "Top device problem")],
                             [("row_kind", "Row", {"product": "Product", "national": "National series"}),
                              ("company_linked", "Company link", {"yes": "Linked to a company record (SEC registrant or Open Payments entity)", "no": "No link (no exact name match, or under the 5% share rule)"})]),
        D_CAERS: cw.listing([("name", "Name"), ("row_kind", "Row"), ("reports", "Reports"), ("reports_latest", f"Reports {cnat['last_complete']}"),
                             ("deaths", "Death outcome"), ("share_latest", f"Share {cnat['last_complete']}"), ("rank", "Rank")],
                            [("row_kind", "Row", {"year": "Year", "series": "Whole series", "industry": "Industry", "product": "Product (brand)", "mdl": "MDL product"})]),
    }


def main():
    store = Store()
    products, titles, profiles = load_lookups()
    out, ctx = build(store, products, titles, profiles, load_manufacturer_records())
    sums, lists = summaries(ctx, out), listings(ctx)
    BUILD.mkdir(parents=True, exist_ok=True)
    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report = {}
    for ds, rows in out.items():
        ids = [r["id"] for r in rows]
        if len(ids) != len(set(ids)):
            raise ValueError(f"{ds}: duplicate ids")
        inputs_raw = [store.used[k] for k in sorted(store.used) if INPUT_PREFIX[ds](k)]
        payload = {"dataset": ds, "label": LABELS[ds], "listing_block": lists[ds], "summary": sums[ds], "rows": rows,
                   "built_at": built_at, "inputs": inputs_raw + lookup_inputs()}
        (BUILD / f"{ds}.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False))
        report[ds] = {"rows": len(rows), "inputs": len(inputs_raw),
                      "sha256_rows": hashlib.sha256("\n".join(json.dumps(r, sort_keys=True) for r in rows).encode()).hexdigest()}
    report["company_match"] = ctx["company_match"]
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
