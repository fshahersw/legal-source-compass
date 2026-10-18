"""Build the SaferProducts.gov analysis datasets for the corpus (build files only; nothing is published here).

  python3 -I -B scripts/enrichment/saferproducts/build_saferproducts.py

Reads only private/acq/saferproducts/ (SPDB.zip members + saved public pages) and the read-only corpus lookups saved in
private/build/saferproducts/lookups/. Writes private/build/saferproducts/<dataset_id>.json for:
  saferproducts_reports_series, saferproducts_products, saferproducts_companies, saferproducts_recalls_crosscheck
and private/build/saferproducts/build_stats.json (counts used by REPORT.md and the verifier).

Published rows are AGGREGATES: no report text, no victim details (age appears only inside bands), no free-text descriptions.
"""
import collections
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import analysis as A  # noqa: E402
import corpus_writer as cw  # noqa: E402
import crosscheck as X  # noqa: E402
import spdb_lib as L  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "saferproducts")
BUILD = os.path.join(ROOT, "private", "build", "saferproducts")
LOOK = os.path.join(BUILD, "lookups")
SOURCE_URL = "https://www.saferproducts.gov/SPDB.zip"
TERMS_URL = "https://www.saferproducts.gov/Business/Acknowledge?source=signIn"
DS_SERIES, DS_PRODUCTS, DS_COMPANIES, DS_XCHECK = "saferproducts_reports_series", "saferproducts_products", "saferproducts_companies", "saferproducts_recalls_crosscheck"
RECALL_DS = "agency_safety_cpsc_recalls_api"
XC_MIN_REPORTS = 5  # cross-check company records: minimum reports for one exact name string
NR = "Not recorded"
UNV = "Unverified consumer reports"

UNITS = ("Reports: unverified consumer-submitted reports of harm or risk of harm that CPSC published on SaferProducts.gov after minimum-information checks. "
         "Counts are reports, not incidents or incidence; a report is not a finding of defect or causation; victim counts are reports whose primary victim has the stated severity, not persons.")

FORMULAS = {
    "share": "Share % = reports in the group / all published reports in the export x 100",
    "yoy": "YoY % = (reports in year y - reports in year y-1) / reports in year y-1 x 100; comparable only when neither year is partial",
    "ytd": "Year-to-date: reports whose date is on or before the export's latest publication month-day, compared with the same window of the prior year (and of 2019)",
    "change_2019": "Change since 2019 % = (reports in year y - reports in 2019) / reports in 2019 x 100, complete years only",
    "comment_rate": "Manufacturer comment rate % = reports with a non-empty 'Company Comments' entry / reports x 100 (comments may be added after publication, so recent cohorts are understated)",
    "lag": "Lag days = Publication Date - Report Date; median and p90 (nearest rank: the ceil(0.9 n)-th smallest). Report Date is the export's submission date, not the incident date",
    "severity": "Severity groups map '(Primary) Victim Severity': Death; Injury = any of six 'Injury, ...' levels; Incident, No Injury; No Incident, No Injury; Unspecified",
    "age": "Age bands on whole years of '(Primary) Victim's Age (years)': under 1, 1-4, 5-12, 13-17, 18-64, 65+ (the site's own filter); blank = Not recorded",
    "growth": "Growth % = (reports published in the 3 latest complete years - reports in the 3 years before) / reports in the 3 years before x 100; ranked only when both windows have at least 30 reports; ratio interval = exp(ln(ratio) +/- 1.96 sqrt(1/recent + 1/prior))",
    "cluster": "Same-model cluster = at least 3 reports sharing an exact Brand string and an exact Model string (whitespace collapsed, case-sensitive, no fuzzy merge; placeholders such as Unknown or N/A excluded)",
    "themes": "Hazard themes = documented regular expressions over the Incident Description (lower-cased); a report can match several themes; counts are reports whose description matches, not confirmed hazards",
}


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fmt(n):
    return NR if n is None else "{:,}".format(n)


def pctf(x, digits=2):
    return NR if x is None else ("%." + str(digits) + "f%%") % x


def signed(x):
    return NR if x is None else ("%+.2f%%" % x)


def numf(x):
    """Whole numbers without a trailing .0; others with one decimal."""
    if x is None:
        return NR
    return str(int(x)) if float(x).is_integer() else "%.1f" % x


def cell(x):
    return NR if x is None else x


def link(label, url):
    return {"label": label, "url": url}


SRC_LINK = link("SaferProducts.gov public database export (SPDB.zip)", SOURCE_URL)


class Source:
    """Everything read from disk, plus the counts that describe it."""

    def __init__(self):
        manifest = [json.loads(line) for line in open(os.path.join(ACQ, "_manifest.jsonl"), encoding="utf-8")]
        zip_entry = next(m for m in manifest if m["url"] == SOURCE_URL)
        self.manifest = manifest
        self.zip_entry = zip_entry
        self.retrieved = zip_entry["retrieved_at"]
        self.zip_sha = sha256_file(os.path.join(ROOT, zip_entry["path"]))
        if self.zip_sha != zip_entry["sha256"]:
            raise SystemExit("SPDB.zip does not match its manifest sha256")
        raw = L.read_member(ACQ, "IncidentReports.csv")
        text, self.encoding = L.decode_export(raw)
        self.parsed = L.parse_incident_csv(text)
        self.reports = self.parsed["reports"]
        raw_recalls = L.read_member(ACQ, "Recalls.csv")
        rtext, self.recalls_encoding = L.decode_export(raw_recalls)
        self.recalls = L.parse_recalls_csv(rtext)
        self.disclaimer = self.parsed["disclaimer"]
        self.ctx = A.Ctx(self.reports)
        lookups = X.load_json(os.path.join(LOOK, "corpus_recalls_api.json"))
        self.corpus_recalls = lookups["rows"]
        self.corpus_fingerprints = lookups["fingerprints"]
        self.agg_years = X.read_psv(os.path.join(LOOK, "regulatory_cpsc_aggregates_years.psv"))
        self.agg_firms = X.load_json(os.path.join(LOOK, "regulatory_cpsc_aggregates_firms.json"))["rows"]
        self.sec_lines = X.read_psv(os.path.join(LOOK, "company_sec_profiles.psv"))
        self.precision = X.load_json(os.path.join(LOOK, "theme_precision.json"))
        self.mdl = X.load_json(os.path.join(os.path.dirname(HERE), "mass_tort_products.json"))["mdls"]

    def inputs(self):
        rows = [{"url": SOURCE_URL, "path": self.zip_entry["path"], "sha256": self.zip_sha}]
        seen = {(SOURCE_URL, self.zip_sha)}
        for m in self.manifest:
            if m["url"].startswith(SOURCE_URL + "#") and m.get("path") and (m["url"], m["sha256"]) not in seen:
                seen.add((m["url"], m["sha256"]))
                rows.append({"url": m["url"], "path": m["path"], "sha256": m["sha256"]})
        for m in self.manifest:
            if m["url"].startswith("https://www.saferproducts.gov/") and m.get("path") and "/pages/" in m["path"]:
                rows.append({"url": m["url"], "path": m["path"], "sha256": m["sha256"]})
        for m in self.manifest:
            if m["url"].endswith("/robots.txt"):
                rows.append({"url": m["url"], "path": None, "sha256": m["sha256"], "http_status": m["http_status"], "note": "status probe only; body not kept"})
        for name, url in (
            ("company_sec_profiles.psv", "supabase:public.corpus_records?dataset=eq.company_sec_profiles (read-only SELECT id,title)"),
            ("corpus_recalls_api.json", "supabase:public.corpus_records?dataset=eq.agency_safety_cpsc_recalls_api (fingerprints match; rebuilt from private/acq/cpsc_catalog/recall_api)"),
            ("regulatory_cpsc_aggregates_years.psv", "supabase:public.corpus_records?dataset=eq.regulatory_cpsc_aggregates (read-only SELECT, kind=year)"),
            ("regulatory_cpsc_aggregates_firms.json", "supabase:public.corpus_records?dataset=eq.regulatory_cpsc_aggregates (read-only SELECT, kind=firm)"),
            ("theme_precision.json", "local:hand review of hash-ordered samples (counts only)"),
        ):
            path = os.path.join(LOOK, name)
            rows.append({"url": url, "path": os.path.relpath(path, ROOT), "sha256": sha256_file(path)})
        return rows


def common_facts(src, period):
    return [
        ["Source", "CPSC SaferProducts.gov public database export (SPDB.zip, member IncidentReports.csv), retrieved %s; the export's own disclaimer: CPSC does not guarantee its accuracy, completeness or adequacy" % src.retrieved],
        ["Period", period],
        ["Units", UNITS],
    ]


def sev_text(sev):
    return " · ".join("%s %s" % (label, fmt(sev.get(key, 0))) for key, label in (
        ("death", "Death"), ("injury", "Injury"), ("incident_no_injury", "Incident, no injury"), ("no_incident", "No incident"), ("unspecified", "Unspecified")))


def age_text(b):
    parts = ["%s %s" % (label, fmt(b["age_bands"][key])) for key, label in L.AGE_BANDS]
    parts.append("Not recorded %s" % fmt(b["age_not_recorded"]))
    return " · ".join(parts)


def top_text(items, key, limit=5):
    return " · ".join("%s %s" % (i[key], fmt(i["reports"])) for i in items[:limit]) or NR


def theme_entries(counts, total, precision):
    out = []
    for tid, (label, _rx, _stems) in L.THEMES.items():
        p = precision.get(tid)
        out.append({
            "theme": tid, "label": label, "reports": counts.get(tid, 0), "share_pct": L.pct(counts.get(tid, 0), total),
            "precision_pct": p["precision_pct"] if p else None,
        })
    return out


def precision_map(src):
    """Per-theme precision, only while the regex is the one that was reviewed (hash check); else Not recorded."""
    out = {}
    for tid, row in src.precision["themes"].items():
        current = hashlib.sha256(L.THEMES[tid][1].pattern.encode("utf-8")).hexdigest()
        if current == row["pattern_sha256"]:
            out[tid] = row
    return out


def theme_definitions(src, prec):
    out = []
    for tid, (label, rx, _stems) in L.THEMES.items():
        p = prec.get(tid)
        out.append({
            "theme": tid, "label": label, "regex": rx.pattern,
            "precision": ({"sample_size": p["sample_size"], "correct": p["correct"], "precision_pct": p["precision_pct"], "wilson95_pct": p["wilson95_pct"], "round": p["round"],
                           "matches_in_export_at_review": p["matches_in_export_at_review"]} if p else NR),
        })
    return out


def write_json(path, payload):
    for _ in range(120):
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
            return
        except OSError:
            time.sleep(1)
    raise SystemExit("could not write %s (disk full?)" % path)


def build_file(dataset, label, listing_block, summary, rows, src):
    return {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows, "built_at": now(), "inputs": src.inputs()}


def common_summary(src, extra):
    st = src.parsed["stats"]
    base = {
        "publisher": "U.S. Consumer Product Safety Commission (CPSC), SaferProducts.gov",
        "source": SOURCE_URL,
        "source_file": "IncidentReports.csv inside SPDB.zip (retrieved %s, %s bytes, sha256 %s)" % (src.retrieved, "{:,}".format(src.zip_entry["bytes"]), src.zip_sha),
        "disclaimer_in_export": src.disclaimer,
        "terms": {
            "quotes": [
                {"section": "3. Ownership", "text": "Information publicly posted on Saferproducts.gov is considered public information and may be distributed or copied. This does not include personally identifiable information."},
                {"section": "1. Limitation of Liability", "text": "The CPSC does not guarantee the accuracy, completeness, or adequacy of the contents of SaferProducts.gov, particularly with respect to information submitted by persons outside of the CPSC."},
                {"section": "1. Limitation of Liability", "text": "The CPSC does not have the resources to conduct an in-depth investigation or verify the accuracy of every Report or comment submitted for inclusion on SaferProducts.gov."},
                {"section": "1. Limitation of Liability", "text": "SaferProducts.gov users choosing to search, review, print, or download information, [...] or otherwise utilize information contained on SaferProducts.gov, do so at their own risk."},
            ],
            "statement": "Quoted from the terms page (see quotes): publicly posted information 'is considered public information and may be distributed or copied' (not personally identifiable information); CPSC does not guarantee its accuracy, completeness or adequacy and does not verify every report; users use it at their own risk.",
            "url": TERMS_URL, "section": "Limitation of Liability, Disclaimer, Statement of Ownership, and Terms of Use (sections 1-4)",
            "retrieved": src.retrieved,
            "restrictions": "No commercial-use prohibition on the public data was found. Section 6A(b)(6) of the CPSA / 16 CFR 1102.20(b) bars manufacturers who receive submitter or victim names and contact details through the Business Portal from using them beyond verification; "
                            "those details are never published and are not in the export or in these datasets.",
            "statutory_basis": "Section 212 of the CPSIA (15 U.S.C. 2055a, CPSA section 6A) and 16 CFR part 1102: reports must meet minimum information requirements; the manufacturer may comment; materially inaccurate information may be withheld",
            "robots": "www.saferproducts.gov/robots.txt returned HTTP 404 (no robots rules); the export is the file the site's search page and About page offer for download",
        },
        "owner_authorisation": "Owner instruction of 2026-10-18 ('get neiss and saferproducts extensive data analysis') authorises this acquisition for the saferproducts stream; no web form, account or API-key registration was used",
        "input_quality": {
            "incident_rows_read": st.get("rows_read"), "reports_parsed": len(src.reports), "malformed_rows": st.get("malformed", 0), "duplicate_report_numbers": st.get("duplicates", 0),
            "blank_rows": st.get("blank_rows", 0), "encoding": src.encoding,
            "contact_like_values_withheld": st.get("contact_like_values_withheld", 0), "reports_with_contact_like_value": st.get("reports_with_contact_like_value", 0), "reports_with_invalid_dates": sum(1 for r in src.reports if not r.dates_ok),
            "reports_without_incident_description": sum(1 for r in src.reports if not r.has_description),
        },
        "publication_window": {"first": src.ctx.pub_min.isoformat(), "last": src.ctx.pub_max.isoformat()},
        "report_window": {"first": src.ctx.rep_min.isoformat(), "last": src.ctx.rep_max.isoformat()},
        "date_note": "Incident date is not a column of the export (Not recorded). Publication Date (when CPSC posted the report) is the default time axis; Report Date (when the report was submitted) is shown beside it. The newest report-year counts are understated because reports take a median of about 25 days to be published.",
        "caveats": [
            "Reports are unverified consumer submissions; CPSC published them after minimum-information checks, and the manufacturer may comment. A report is not a finding of defect or causation.",
            "Counts are reports, not incidence; they are affected by publicity, litigation and recalls, so trends need that context.",
            "The export has exactly 70,000 incident rows; no cap evidence was found (see REPORT.md) but completeness against a CPSC total could not be checked.",
            "Free-text descriptions, submitter and victim details, city, ZIP, serial numbers and UPCs in the export are not published here.",
        ],
        "retrieved": src.retrieved,
        "built_from": "scripts/enrichment/saferproducts/build_saferproducts.py",
    }
    base.update(extra)
    return base


# ================================================================== dataset 1: reports series

def build_series(src):
    reports, ctx = src.reports, src.ctx
    total = len(reports)
    prec = precision_map(src)
    rows_by_axis = A.series_rows(reports, ctx)
    pub_rows, rep_rows = rows_by_axis["published"], rows_by_axis["reported"]
    peak = A.peak_year(pub_rows)
    whole = A.block(reports, "full")
    by_year_total = {r["year"]: r["reports"] for r in pub_rows}
    last = pub_rows[-1]
    y2019 = by_year_total.get(A.BASE_YEAR)
    latest_complete = next(r for r in reversed(pub_rows) if not r["partial"])
    state_counter = collections.Counter(r.state for r in reports)
    records = []

    # ---- summary record
    period = "%d–%d" % (ctx.pub_years[0], ctx.pub_years[-1])
    s_payload = {
        "kind": "summary", "reports": total, "publication_years": [ctx.pub_years[0], ctx.pub_years[-1]], "peak_year": peak,
        "severity": whole["severity"], "injury_levels": whole["injury_levels"], "deaths": whole["deaths"], "injuries": whole["injuries"],
        "age_bands": whole["age_bands"], "age_not_recorded": whole["age_not_recorded"], "submitter": whole["submitter"],
        "product_categories": whole["product_categories"], "states": whole["states"],
        "states_all": [{"state": n, "reports": c, "usps": A.US_STATES.get(n), "class": A.state_class(n)} for n, c in sorted(state_counter.items(), key=lambda kv: (-kv[1], kv[0]))],
        "manufacturer_comment_rate_pct": whole["manufacturer_comment_rate_pct"], "with_manufacturer_comment": whole["with_manufacturer_comment"],
        "lag": whole["lag"], "model_nonblank_pct": whole["model_nonblank_pct"], "model_informative_pct": whole["model_informative_pct"],
        "purchase_date_recorded_pct": whole["purchase_date_recorded_pct"], "linked_reports": whole["linked_reports"],
        "latest_complete_year": {"year": latest_complete["year"], "reports": latest_complete["reports"], "yoy_pct": latest_complete["yoy_pct"], "change_vs_2019_pct": latest_complete["change_vs_2019_pct"]},
        "latest_partial_year": ({"year": last["year"], "reports": last["reports"], "ytd": last.get("ytd")} if last["partial"] else None),
        "reports_2019": y2019, "themes": theme_entries(whole["themes"], total, prec),
        "monthly_publications": A.monthly(reports), "yearly_published": [{"year": r["year"], "reports": r["reports"], "partial": r["partial"], "yoy_pct": r["yoy_pct"]} for r in pub_rows],
        "yearly_reported": [{"year": r["year"], "reports": r["reports"], "partial": r["partial"]} for r in rep_rows],
        "incident_date": NR,
    }
    ytd = last.get("ytd") or {}
    facts = common_facts(src, "Reports published %s to %s (Publication Date); report dates %s to %s" % (ctx.pub_min.isoformat(), ctx.pub_max.isoformat(), ctx.rep_min.isoformat(), ctx.rep_max.isoformat())) + [
        ["Reports in the export", "%s (one row per published report; %s malformed rows, %s duplicate report numbers)" % (fmt(total), fmt(src.parsed["stats"].get("malformed", 0)), fmt(src.parsed["stats"].get("duplicates", 0)))],
        ["Peak publication year (complete years)", "%d with %s reports; counting the partial %d, %d has %s" % (peak["year"], fmt(peak["reports"]), ctx.pub_years[-1], peak["including_partial_year"], fmt(peak["including_partial_reports"]))],
        ["Latest complete year", "%d: %s reports (YoY %s, change vs 2019 %s)" % (latest_complete["year"], fmt(latest_complete["reports"]), signed(latest_complete["yoy_pct"]), signed(latest_complete["change_vs_2019_pct"]))],
        ["Latest partial year", ("%d through %s: %s reports vs %s in the same window of %d (%s); vs %s in 2019 same window (%s)" % (last["year"], ytd["through"], fmt(ytd["reports"]), fmt(ytd["prior_year_same_window"]), last["year"] - 1, signed(ytd["change_vs_prior_year_pct"]), fmt(ytd["base_year_same_window"]), signed(ytd["change_vs_2019_pct"]))) if ytd else NR],
        ["Severity (primary victim)", sev_text(whole["severity"])],
        ["Deaths", "%s reports (%s of all) have a primary victim with severity Death; reports, not persons" % (fmt(whole["deaths"]), pctf(L.pct(whole["deaths"], total)))],
        ["Injuries", "%s reports (%s) have an Injury severity of any level of care" % (fmt(whole["injuries"]), pctf(L.pct(whole["injuries"], total)))],
        ["Victim age bands", age_text(whole)],
        ["Category of submitter", " · ".join("%s %s" % (k, fmt(v)) for k, v in whole["submitter"].items())],
        ["Product categories", " · ".join("%s %s" % (k, fmt(v)) for k, v in whole["product_categories"].items())],
        ["Top states", top_text([{"name": s["state"], "reports": s["reports"]} for s in whole["states"]["top"]], "name", 10)],
        ["Manufacturer comment rate", "%s (%s of %s reports have a Company Comments entry)" % (pctf(whole["manufacturer_comment_rate_pct"]), fmt(whole["with_manufacturer_comment"]), fmt(total))],
        ["Report to publication lag", "median %s days, p90 %s days (n = %s; Publication Date minus Report Date, not incident date)" % (numf(whole["lag"]["report_to_publication_days"]["median"]), numf(whole["lag"]["report_to_publication_days"]["p90"]), fmt(whole["lag"]["report_to_publication_days"]["n"]))],
        ["Report to sent-to-manufacturer lag", "median %s days (n = %s; %s reports have no sent date, %s of them published in 2011; %s reports show a sent date after the publication date and are left out of the sent-to-publication lag)" % (numf(whole["lag"]["report_to_sent_days"]["median"]), fmt(whole["lag"]["report_to_sent_days"]["n"]), fmt(whole["lag"]["no_sent_date"]), fmt(sum(1 for r in reports if not r.sent_date and r.pub_date and r.pub_date.year == 2011)), fmt(whole["lag"]["sent_after_publication"]))],
        ["Sent to publication lag", "median %s days, p90 %s days (n = %s)" % (numf(whole["lag"]["sent_to_publication_days"]["median"]), numf(whole["lag"]["sent_to_publication_days"]["p90"]), fmt(whole["lag"]["sent_to_publication_days"]["n"]))],
        ["Hazard-term counts (regex over incident description)", " · ".join("%s %s" % (L.THEMES[t][0], fmt(c)) for t, c in sorted(whole["themes"].items(), key=lambda kv: -kv[1]))],
        ["Model number and purchase date", "model non-blank %s, informative (not Unknown/N/A) %s; purchase date recorded %s" % (pctf(whole["model_nonblank_pct"]), pctf(whole["model_informative_pct"]), pctf(whole["purchase_date_recorded_pct"]))],
        ["Incident date", "Not recorded: the export has no incident-date column (the public detail page shows one, the export does not)"],
        ["Formulas", " | ".join(FORMULAS[k] for k in ("share", "yoy", "ytd", "change_2019", "comment_rate", "lag", "severity", "age"))],
    ]
    top_links = [link("Places: %s" % s["state"], "/places/%s" % s["usps"]) for s in whole["states"]["top"] if s["usps"]][:5]
    records.append(cw.record(
        DS_SERIES, "saferproducts-summary", "SaferProducts.gov consumer reports %s: summary" % period, source_url=SOURCE_URL,
        subtitle="%s published reports · %s deaths · peak %d" % (fmt(total), fmt(whole["deaths"]), peak["year"]),
        cells={"period": period, "basis": "Summary", "reports": total, "yoy_pct": cell(latest_complete["yoy_pct"]), "ytd_change_pct": cell(ytd.get("change_vs_prior_year_pct")), "deaths": whole["deaths"], "injuries": whole["injuries"],
               "comment_rate_pct": cell(whole["manufacturer_comment_rate_pct"]), "lag_median_days": cell(whole["lag"]["report_to_publication_days"]["median"])},
        facts=facts, text="SaferProducts consumer product safety incident reports summary severity age submitter state product category", filters={"basis": ["summary"]},
        badges=["Unverified consumer reports"], links=[SRC_LINK, link("SaferProducts.gov search", "https://www.saferproducts.gov/PublicSearch")] + top_links, extra={"safer": s_payload}))

    # ---- per-year records
    for axis, rows, label_basis in (("published", pub_rows, "Publication year"), ("reported", rep_rows, "Report year")):
        for b in rows:
            y = b["year"]
            partial = b["partial"]
            if axis == "published":
                window = "%s to %s" % ((ctx.pub_min if y == ctx.pub_years[0] else dt.date(y, 1, 1)).isoformat(), (ctx.pub_max if y == ctx.pub_years[-1] else dt.date(y, 12, 31)).isoformat())
                period_text = "Reports first published in %d (Publication Date), %s%s" % (y, window, "; PARTIAL year" if partial else "")
            else:
                window = "%s to %s" % ((ctx.rep_min if y == ctx.rep_years[0] else dt.date(y, 1, 1)).isoformat(), (ctx.rep_max if y == ctx.rep_years[-1] else dt.date(y, 12, 31)).isoformat())
                period_text = "Reports submitted in %d (Report Date), %s%s" % (y, window, "; PARTIAL year" if partial else "")
            lag = b.get("lag")
            payload = {"kind": axis, "year": y, "partial": partial, **{k: v for k, v in b.items() if k not in ("year", "partial")}}
            fy = [
                ["Reports", "%s %s (YoY %s%s)" % (fmt(b["reports"]), "published" if axis == "published" else "submitted", signed(b["yoy_pct"]), "; comparable" if b["yoy_comparable"] else "; not comparable (a partial or first year is involved)")],
                ["Severity (primary victim)", sev_text(b["severity"])],
                ["Deaths and injuries", "%s death reports, %s injury reports (reports, not persons)" % (fmt(b["deaths"]), fmt(b["injuries"]))],
                ["Victim age bands", age_text(b)],
                ["Manufacturer comment rate", "%s (%s of %s)" % (pctf(b["manufacturer_comment_rate_pct"]), fmt(b["with_manufacturer_comment"]), fmt(b["reports"]))],
                ["Change since 2019", signed(b["change_vs_2019_pct"]) if b["change_vs_2019_pct"] is not None else ("Not applicable: 2019 is the base year" if y == A.BASE_YEAR else "Not applicable: before the 2019 base year" if y < A.BASE_YEAR else "Not comparable for a partial year; see year to date")],
                ["Concentration", "%s distinct manufacturer name strings; the top 5 hold %s of the year's reports: %s; company name missing or a placeholder in %s reports" % (fmt(b["distinct_company_strings"]), pctf(b["top5_company_share_pct"], 1), top_text(b["top_companies"], "company", 5), fmt(b["company_not_recorded"]))],
                ["Top product types", top_text(b["top_product_types"], "type", 5)],
            ]
            if b.get("ytd"):
                t = b["ytd"]
                fy.append(["Year to date", "%s through %s vs %s same window %d (%s); vs %s in 2019 (%s)" % (fmt(t["reports"]), t["through"], fmt(t["prior_year_same_window"]), y - 1, signed(t["change_vs_prior_year_pct"]), fmt(t["base_year_same_window"]), signed(t["change_vs_2019_pct"]))])
                e = t["excluding_largest_company"]
                fy.append(["Year to date without the largest manufacturer string", "Excluding %s (%s reports this year): %s vs %s in the same window of %d (%s). Counts move with publicity, recalls and litigation, so a single product can drive a year" % (e["company"], fmt(e["removed_reports"]), fmt(e["reports"]), fmt(e["prior_year_same_window"]), y - 1, signed(e["change_vs_prior_year_pct"]))])
            if lag:
                fy += [
                    ["Submitter category", " · ".join("%s %s" % (k, fmt(v)) for k, v in b["submitter"].items())],
                    ["Top states", top_text([{"name": s["state"], "reports": s["reports"]} for s in b["states"]["top"]], "name", 8)],
                    ["Product categories", " · ".join("%s %s" % (k, fmt(v)) for k, v in list(b["product_categories"].items())[:8])],
                    ["Report to publication lag", "median %s days, p90 %s days (n = %s)" % (numf(lag["report_to_publication_days"]["median"]), numf(lag["report_to_publication_days"]["p90"]), fmt(lag["report_to_publication_days"]["n"]))],
                    ["Model number and purchase date", "model informative %s; purchase date recorded %s" % (pctf(b["model_informative_pct"]), pctf(b["purchase_date_recorded_pct"]))],
                    ["Hazard-term counts (regex over incident description)", " · ".join("%s %s" % (L.THEMES[t][0], fmt(c)) for t, c in sorted(b["themes"].items(), key=lambda kv: -kv[1]) if c)],
                ]
            fy.append(["Incident date", "Not recorded (not a column of the export)"])
            fy.append(["Formulas", " | ".join(FORMULAS[k] for k in ("yoy", "change_2019", "comment_rate", "lag"))])
            rec_id = "sp-%s-%d" % ("pub" if axis == "published" else "rep", y)
            title = "SaferProducts.gov reports %s %d" % ("published in" if axis == "published" else "submitted in", y)
            cells = {"period": str(y) + (" (partial)" if partial else ""), "basis": label_basis, "reports": b["reports"], "yoy_pct": cell(b["yoy_pct"] if b["yoy_comparable"] else None),
                     "ytd_change_pct": cell((b.get("ytd") or {}).get("change_vs_prior_year_pct")),
                     "deaths": b["deaths"], "injuries": b["injuries"], "comment_rate_pct": cell(b["manufacturer_comment_rate_pct"]),
                     "lag_median_days": cell(lag["report_to_publication_days"]["median"]) if lag else NR}
            records.append(cw.record(
                DS_SERIES, rec_id, title, source_url=SOURCE_URL, subtitle="%s reports · %s deaths%s" % (fmt(b["reports"]), fmt(b["deaths"]), " · partial year" if partial else ""),
                cells=cells, facts=common_facts(src, period_text) + fy, text="SaferProducts reports %s %d" % (label_basis, y),
                filters={"basis": ["publication" if axis == "published" else "report"], "year": [str(y)], "partial": ["yes" if partial else "no"]},
                badges=[UNV] + (["Partial year"] if partial else []), links=[SRC_LINK], extra={"safer": payload}))

    listing = cw.listing(
        [("period", "Period"), ("basis", "Basis"), ("reports", "Reports"), ("yoy_pct", "YoY (%)"), ("ytd_change_pct", "Same-window change (%)"), ("deaths", "Death reports"), ("injuries", "Injury reports"), ("comment_rate_pct", "Manufacturer comment (%)"), ("lag_median_days", "Median days to publish")],
        [("basis", "Basis", {"summary": "Summary", "publication": "By publication year", "report": "By report year"}), ("partial", "Year coverage", {"yes": "Partial year", "no": "Complete year"})])
    summary = common_summary(src, {
        "grain": "one record per publication year, one per report year, and one overall summary record",
        "formulas": FORMULAS, "theme_definitions": theme_definitions(src, prec),
        "counts": {"records": len(records), "publication_year_records": len(pub_rows), "report_year_records": len(rep_rows)},
        "partial_years": {"publication": [r["year"] for r in pub_rows if r["partial"]], "report": [r["year"] for r in rep_rows if r["partial"]]},
        "coverage_by_publication_year": [{"year": r["year"], "reports": r["reports"], "partial": r["partial"]} for r in pub_rows],
    })
    return build_file(DS_SERIES, "SaferProducts.gov unverified consumer product reports: yearly series (2011–%d)" % ctx.pub_years[-1], listing, summary, records, src), {"peak": peak, "whole": whole, "pub_rows": pub_rows, "rep_rows": rep_rows}


# ================================================================== dataset 2: products

def build_products(src, mdl_pairs):
    reports, ctx = src.reports, src.ctx
    total = len(reports)
    prec = precision_map(src)
    by_cat = collections.defaultdict(list)
    by_sub = collections.defaultdict(list)
    by_type = collections.defaultdict(list)
    type_info = {}
    for r in reports:
        by_cat[r.category].append(r)
        by_sub[(r.category, r.subcategory)].append(r)
        by_type[r.pcode].append(r)
        type_info.setdefault(r.pcode, (r.category, r.subcategory, r.ptype))
    recs = []
    for cat, rs in by_cat.items():
        recs.append(("sp-cat-%s" % L.slug(cat), A.scope_record("category", cat, rs, ctx, total, {"category": cat}), rs))
    for (cat, sub), rs in by_sub.items():
        recs.append(("sp-sub-%s--%s" % (L.slug(cat, 40), L.slug(sub, 40)), A.scope_record("subcategory", "%s · %s" % (cat, sub), rs, ctx, total, {"category": cat, "subcategory": sub}), rs))
    for code, rs in by_type.items():
        cat, sub, ptype = type_info[code]
        recs.append(("sp-type-%s" % L.slug(code, 60), A.scope_record("type", ptype, rs, ctx, total, {"category": cat, "subcategory": sub, "code": code}), rs))
    ids = [i for i, _r, _rs in recs]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate product record ids")
    A.rank_growth([r for _i, r, _rs in recs])
    id_of = {}
    for rid, rec, _rs in recs:
        if rec["kind"] == "category":
            id_of[("category", rec["category"])] = rid
        elif rec["kind"] == "subcategory":
            id_of[("subcategory", rec["category"], rec["subcategory"])] = rid
    cat_options = {L.slug(c): c for c in sorted(by_cat)}
    pair_by_field = collections.defaultdict(list)
    for p in mdl_pairs:
        pair_by_field[(p["field"], p["matched_name"])].append(p)
    rows = []
    for rid, rec, rs in sorted(recs, key=lambda t: (("category", "subcategory", "type").index(t[1]["kind"]), -t[1]["reports"], t[0])):
        g = rec["growth"]
        kind_label = {"category": "Category", "subcategory": "Sub category", "type": "Product type"}[rec["kind"]]
        parents = []
        if rec["kind"] == "subcategory":
            parents = [link("Category: %s" % rec["category"], "/records/%s/%s" % (DS_PRODUCTS, id_of[("category", rec["category"])]))]
        elif rec["kind"] == "type":
            parents = [link("Category: %s" % rec["category"], "/records/%s/%s" % (DS_PRODUCTS, id_of[("category", rec["category"])])),
                       link("Sub category: %s" % rec["subcategory"], "/records/%s/%s" % (DS_PRODUCTS, id_of[("subcategory", rec["category"], rec["subcategory"])]))]
        state_links = [link("Places: %s" % s["state"], "/places/%s" % s["usps"]) for s in rec["states"]["top"] if s["usps"]][:3]
        mdl_links = []
        rec["mdl_xref"] = []
        field, key = {"type": ("product_type", X.text_key(re.sub(r"\s*\(\d+\)\s*$", "", rec["name"]))), "subcategory": ("sub_category", X.text_key(rec.get("subcategory"))), "category": ("category", X.text_key(rec["name"]))}[rec["kind"]]
        for p in pair_by_field.get((field, key), []):
            rec["mdl_xref"].append({"mdl": p["mdl"], "mdl_product": p["product"], "matched_field": field, "basis": "MDL product label equals this classification name; no MDL membership is implied for any report"})
            mdl_links.append(link("MDL %s lens: %s" % (p["mdl"], p["product"]), "/matters/lens/%s" % p["mdl"]))
        ctl = rec["themes"]
        facts = common_facts(src, "Reports first published %s to %s (Publication Date); yearly series use publication years" % (ctx.pub_min.isoformat(), ctx.pub_max.isoformat())) + [
            ["Classification", "%s as classified by the export (Product Category > Sub Category > Product Type with its Product Code); no invented taxonomy%s" % (kind_label, "; code %s" % rec["code"] if rec.get("code") else "")],
            ["Reports", "%s (%s of all %s reports)" % (fmt(rec["reports"]), pctf(rec["share_of_all_pct"], 3), fmt(total))],
            ["Deaths and injuries", "%s death reports, %s injury reports (reports whose primary victim has that severity)" % (fmt(rec["deaths"]), fmt(rec["injuries"]))],
            ["Severity (primary victim)", sev_text(rec["severity"])],
            ["Victim age bands", age_text(rec)],
            ["Change, recent vs prior 3 complete years", ("%s (%s: %s reports vs %s: %s reports; rate ratio %s, 95%% interval %s–%s; rank %s of %s eligible)" % (signed(g["change_pct"]), g["recent_window"], fmt(g["recent_reports"]), g["prior_window"], fmt(g["prior_reports"]), g["ratio"], g["ratio_ci95"][0], g["ratio_ci95"][1], g["rank"], g["rank_of"])) if g["eligible"] else ("%s (%s: %s reports vs %s: %s reports) - not ranked: below the minimum of %d reports in a window" % (signed(g["change_pct"]), g["recent_window"], fmt(g["recent_reports"]), g["prior_window"], fmt(g["prior_reports"]), A.MIN_VOLUME))],
            ["Top brands (exact strings as recorded)", top_text(rec["top_brands"], "brand", 8) + ("; brand missing or placeholder in %s reports" % fmt(rec["brand_not_recorded"]))],
            ["Top companies (exact strings as recorded)", top_text(rec["top_companies"], "company", 8) + "; company name missing or a placeholder in %s reports" % fmt(rec["company_not_recorded"])],
            ["Top states", top_text([{"name": s["state"], "reports": s["reports"]} for s in rec["states"]["top"]], "name", 8) + "; %d US states with reports; top 5 hold %s" % (rec["states"]["us_states_with_reports"], pctf(rec["states"]["top5_share_pct"], 1))],
            ["Manufacturer comment rate", pctf(rec["manufacturer_comment_rate_pct"])],
            ["Same-model repeat reports", ("%s clusters of at least %d reports sharing an exact brand and model string, holding %s reports; largest: %s" % (fmt(rec["model_clusters"]["clusters"]), A.CLUSTER_MIN, fmt(rec["model_clusters"]["reports_in_clusters"]), "; ".join("%s / %s %s" % (c["brand"], c["model"], fmt(c["reports"])) for c in rec["model_clusters"]["top"][:3]))) if rec["model_clusters"]["clusters"] else "No cluster of %d or more reports with an exact brand and model" % A.CLUSTER_MIN],
            ["Hazard-term counts (regex over incident description)", " · ".join("%s %s" % (L.THEMES[t][0], fmt(c)) for t, c in sorted(ctl.items(), key=lambda kv: -kv[1]) if c)[:600] or "No theme matches"],
            ["Formulas", " | ".join(FORMULAS[k] for k in ("share", "growth", "cluster", "themes"))],
        ]
        if rec["mdl_xref"]:
            facts.append(["MDL cross-reference (exact product label)", "; ".join("MDL %s: %s" % (x["mdl"], x["mdl_product"]) for x in rec["mdl_xref"]) + ". " + rec["mdl_xref"][0]["basis"]])
        cells = {"name": rec["name"], "level": kind_label, "category": rec["category"] if rec["kind"] != "category" else rec["name"], "reports": rec["reports"], "share_pct": cell(rec["share_of_all_pct"]),
                 "deaths": rec["deaths"], "injuries": rec["injuries"], "change_pct": cell(g["change_pct"] if g["eligible"] else None), "growth_rank": cell(g["rank"])}
        sub = {"category": "%s · %s reports" % (kind_label, fmt(rec["reports"])), "subcategory": "%s in %s · %s reports" % (kind_label, rec["category"], fmt(rec["reports"])),
               "type": "%s in %s › %s · %s reports" % (kind_label, rec["category"], rec["subcategory"] if rec["kind"] == "type" else "", fmt(rec["reports"]))}[rec["kind"]]
        text = " ".join([rec["name"], rec["category"], rec.get("subcategory", "")] + [b["brand"] for b in rec["top_brands"][:5]])
        rows.append(cw.record(
            DS_PRODUCTS, rid, rec["name"], source_url=SOURCE_URL, subtitle=sub, cells=cells, facts=facts, text=text,
            filters={"level": [rec["kind"]], "category": [L.slug(rec["category"])], "growth": ["eligible" if g["eligible"] else "not_eligible"], "deaths": ["yes" if rec["deaths"] else "no"]},
            badges=[UNV] + (["#%s fastest-growing" % g["rank"]] if g["rank"] and g["rank"] <= 10 else []), links=[SRC_LINK] + parents + state_links + mdl_links, extra={"safer": rec}))
    listing = cw.listing(
        [("name", "Product classification"), ("level", "Level"), ("category", "Category"), ("reports", "Reports"), ("share_pct", "Share of all (%)"), ("deaths", "Death reports"), ("injuries", "Injury reports"), ("change_pct", "Recent vs prior 3 yrs (%)"), ("growth_rank", "Growth rank")],
        [("level", "Level", {"category": "Category", "subcategory": "Sub category", "type": "Product type"}), ("category", "Category", cat_options),
         ("growth", "Growth ranking", {"eligible": "Ranked (minimum volume met)", "not_eligible": "Not ranked"}), ("deaths", "Death reports", {"yes": "Has death reports", "no": "No death reports"})])
    leaders = {}
    for kind in ("category", "subcategory", "type"):
        elig = sorted((r for _i, r, _rs in recs if r["kind"] == kind and r["growth"]["eligible"]), key=lambda r: r["growth"]["rank"])
        leaders[kind] = {"fastest": [{"name": r["name"], "change_pct": r["growth"]["change_pct"], "recent": r["growth"]["recent_reports"], "prior": r["growth"]["prior_reports"]} for r in elig[:10]],
                         "fastest_declining": [{"name": r["name"], "change_pct": r["growth"]["change_pct"], "recent": r["growth"]["recent_reports"], "prior": r["growth"]["prior_reports"]} for r in elig[-5:][::-1]],
                         "eligible": len(elig), "total": sum(1 for _i, r, _rs in recs if r["kind"] == kind)}
    global_clusters = A.model_clusters(reports, top=25)
    summary = common_summary(src, {
        "grain": "one record per product classification as the export gives it: 15 categories, sub categories (category + sub category pairs) and product types (by Product Code)",
        "formulas": FORMULAS, "theme_definitions": theme_definitions(src, prec),
        "thresholds": {"growth_min_reports_per_window": A.MIN_VOLUME, "cluster_min_reports": A.CLUSTER_MIN,
                       "growth_windows": {"recent": "%d–%d" % ctx.recent, "prior": "%d–%d" % ctx.prior}},
        "growth_leaders": leaders, "top_model_clusters": global_clusters,
        "mdl_exact_pairs": mdl_pairs,
        "mdl_review": {"mdl_products_checked": len(src.mdl), "exact_pairs_linked": len(mdl_pairs),
                       "rule": "an MDL product label (scripts/enrichment/mass_tort_products.json) is linked only when it equals a report Brand, Product Type, Sub Category, Category or Product Description after case/punctuation folding; MDL membership of reports is never inferred",
                       "candidates_file": "private/build/saferproducts/xref_mdl_review.json (whole-word overlaps with Brand or manufacturer strings, reviewed and not linked)"},
        "counts": {"records": len(rows), **{k: v["total"] for k, v in leaders.items()}},
        "placeholder_rule": "Brand, model, retailer and company values that are blank or placeholders (Unknown, N/A, none, I don't know, [REDACTED], gift, ...) are never ranked or clustered",
    })
    return build_file(DS_PRODUCTS, "SaferProducts.gov unverified consumer product reports by product classification", listing, summary, rows, src), {"records": {rid: rec for rid, rec, _rs in recs}}


# ================================================================== dataset 3: companies

def build_companies(src, xc_levels):
    reports, ctx = src.reports, src.ctx
    total = len(reports)
    sec = A.sec_index(src.sec_lines)
    roles = (("manufacturer", "Manufacturer / importer / private labeler", lambda r: r.mfr), ("retailer", "Retailer named by the submitter", lambda r: r.retailer))
    rows, rank_stats, match_stats = [], {}, {}
    for role, role_label, getter in roles:
        groups = collections.defaultdict(list)
        placeholder_reports = 0
        for r in reports:
            name = getter(r)
            if L.is_placeholder(name):
                placeholder_reports += 1
                continue
            groups[name].append(r)
        key_groups = collections.defaultdict(dict)
        for name, rs in groups.items():
            key_groups[L.company_key(name)][name] = len(rs)
        eligible = sorted(((n, rs) for n, rs in groups.items() if len(rs) >= A.MIN_COMPANY_REPORTS), key=lambda kv: (-len(kv[1]), kv[0]))
        status = collections.Counter()
        status_all = collections.Counter()
        for name in groups:
            status_all[A.sec_match(name, sec)[0]] += 1
        for rank, (name, rs) in enumerate(eligible, 1):
            rec = A.company_record(role, name, rs, ctx, total, rank)
            state, cik, title = A.sec_match(name, sec)
            status[state] += 1
            key = L.company_key(name)
            rec["variants"] = A.variants_for(name, groups, key_groups)
            rec["name_key"] = key
            rec["sec_match"] = {"status": state, "rule": "unique exact match of the normalised name key (case-folded, '&'->and, punctuation and legal-form words such as Inc/LLC/Corp/Co removed) to a company_sec_profiles title; no fuzzy matching"}
            links = [SRC_LINK]
            if state == "matched":
                rec["sec_match"].update({"cik": cik, "title": title})
                links.insert(0, link("Company intelligence (SEC profile): %s" % title, "/companies/%s" % cik))
            elif state == "ambiguous":
                rec["sec_match"].update({"ciks": cik, "titles": title})
            xc = xc_levels.get(name) if role == "manufacturer" else None
            if xc:
                rec["recall_match"] = xc
                links.append(link("Recall cross-check: exact-name recalls", "/records/%s/%s" % (DS_XCHECK, xc["record_id"])))
            share = rec["share_of_all_pct"]
            facts = common_facts(src, "Reports first published %s to %s (Publication Date)" % (rec["first_published"], rec["last_published"])) + [
                ["Name as recorded", "%s (exact string from the export field '%s'; whitespace collapsed; spellings are never merged)" % (name, "Manufacturer / Importer / Private Labeler Name" if role == "manufacturer" else "Retailer")],
                ["Role", role_label + ("" if role == "manufacturer" else " (place of purchase named in the report; not a finding that the retailer is responsible)")],
                ["Reports", "%s (rank %d among %s names with at least %d reports; %s of all %s reports)" % (fmt(rec["reports"]), rank, fmt(len(eligible)), A.MIN_COMPANY_REPORTS, pctf(share, 3), fmt(total))],
                ["Deaths and injuries", "%s death reports, %s injury reports" % (fmt(rec["deaths"]), fmt(rec["injuries"]))],
                ["Severity (primary victim)", sev_text(rec["severity"])],
                ["Reports by publication year", " · ".join("%d%s %s" % (y["year"], "*" if y["partial"] else "", fmt(y["reports"])) for y in rec["yearly"]) + " (* partial year)"],
                ["Top product categories", top_text(rec["top_categories"], "category")],
                ["Top product types", top_text(rec["top_types"], "type")],
                ["Top brands (exact strings)", top_text(rec["top_brands"], "brand")],
            ]
            if role == "manufacturer":
                facts.append(["Manufacturer comment rate", "%s (%s of %s reports have a Company Comments entry)" % (pctf(rec["manufacturer_comment_rate_pct"]), fmt(rec["with_manufacturer_comment"]), fmt(rec["reports"]))])
            facts.append(["Other recorded spellings (listed only, not included in the counts above)", ("; ".join("%s (%s)" % (v["name"], fmt(v["reports"])) for v in rec["variants"]["names"]) + (" and %d more" % (rec["variants"]["count"] - len(rec["variants"]["names"])) if rec["variants"]["count"] > len(rec["variants"]["names"]) else "") + "; %s reports under other spellings" % fmt(rec["variants"]["reports_not_included"])) if rec["variants"]["count"] else "None with the same normalised key"])
            facts.append(["SEC company profile match", ("Matched: %s (CIK %s)" % (title, cik)) if state == "matched" else ("Ambiguous: %d profiles share this key (%s)" % (len(cik), "; ".join(title))) if state == "ambiguous" else "Unmatched: no company_sec_profiles title has the same normalised key"])
            if xc:
                facts.append(["Recalls with an exact company-name match", "%s recalls in %s (%s match; first %s, latest %s); %s of these reports were published before the first such recall. A name match is not a statement that the reports concern the recalled products" % (fmt(xc["recalls"]), RECALL_DS, xc["level"].replace("_", " "), xc["first_recall"], xc["last_recall"], fmt(xc["reports_before_first_recall"]))])
            facts.append(["Formulas", " | ".join(FORMULAS[k] for k in ("share", "comment_rate", "severity", "themes"))])
            slug_id = "sp-%s-%s-%s" % ("mfr" if role == "manufacturer" else "ret", L.slug(name, 40), A.short_hash(role + "|" + name))
            cells = {"rank": rank, "name": name, "role": "Manufacturer" if role == "manufacturer" else "Retailer", "reports": rec["reports"], "share_pct": cell(share),
                     "deaths": rec["deaths"], "injuries": rec["injuries"], "comment_rate_pct": cell(rec.get("manufacturer_comment_rate_pct")) if role == "manufacturer" else "n/a", "sec_link": {"matched": "Linked", "ambiguous": "Ambiguous", "unmatched": "Not linked"}[state]}
            rows.append(cw.record(
                DS_COMPANIES, slug_id, name, source_url=SOURCE_URL, subtitle="#%d %s by reports · %s reports · %s deaths" % (rank, role, fmt(rec["reports"]), fmt(rec["deaths"])),
                cells=cells, facts=facts, text=" ".join([name, role_label] + [v["name"] for v in rec["variants"]["names"][:4]] + [b["brand"] for b in rec["top_brands"]]),
                filters={"role": [role], "sec_link": [state], "recall_match": ["yes" if xc else "no"]}, badges=[UNV] + (["#%d" % rank] if rank <= 10 else []), links=links, extra={"safer": rec}))
        rank_stats[role] = {"distinct_names": len(groups), "names_at_threshold": len(eligible), "reports_at_threshold": sum(len(rs) for _n, rs in eligible), "reports_placeholder_or_blank": placeholder_reports,
                            "reports_with_name": sum(len(rs) for rs in groups.values())}
        match_stats[role] = {"records": dict(status), "all_distinct_names": dict(status_all)}
    listing = cw.listing(
        [("rank", "Rank"), ("name", "Name as recorded"), ("role", "Role"), ("reports", "Reports"), ("share_pct", "Share of all (%)"), ("deaths", "Death reports"), ("injuries", "Injury reports"), ("comment_rate_pct", "Manufacturer comment (%)"), ("sec_link", "SEC profile link")],
        [("role", "Role", {"manufacturer": "Manufacturer / importer / private labeler", "retailer": "Retailer"}), ("sec_link", "SEC profile link", {"matched": "Linked", "ambiguous": "Ambiguous", "unmatched": "Not linked"}), ("recall_match", "Exact-name recall match", {"yes": "Has recall match", "no": "No recall match"})])
    prec = precision_map(src)
    summary = common_summary(src, {
        "grain": "one record per exact company-name string (manufacturer / importer / private labeler, and retailer) with at least %d reports; variants of a name are listed on the record and never merged" % A.MIN_COMPANY_REPORTS,
        "formulas": FORMULAS, "threshold": {"min_reports_per_name": A.MIN_COMPANY_REPORTS, "why": "names below the threshold have too few reports for a stable series; 303 manufacturer strings at 25+ cover 69% of reports"},
        "name_normalisation": "key = NFKC, case-folded, '&'->and, apostrophes and periods removed, other punctuation to spaces, SEC state markers (/DE) dropped, leading 'the' dropped, trailing legal-form words (inc, llc, corp, co, ltd, company, plc, ...) dropped; used only to find variants and to match SEC profiles",
        "sec_match_rule": "link /companies/<10-digit CIK> only when exactly one company_sec_profiles title (137 profiles) has the same key; several = ambiguous (no link); none = unmatched",
        "ranking": rank_stats, "sec_match_counts": match_stats, "theme_definitions": theme_definitions(src, prec),
        "counts": {"records": len(rows)}, "placeholder_rule": "blank or placeholder names (Unknown, Gift, N/A, I don't know, [REDACTED], ...) are not companies and are excluded from ranking",
    })
    return build_file(DS_COMPANIES, "SaferProducts.gov unverified consumer product reports by manufacturer and retailer (names as recorded)", listing, summary, rows, src), {"rank_stats": rank_stats, "match_stats": match_stats}


# ================================================================== dataset 4: recall cross-check

def build_xcheck(src):
    reports = src.reports
    corpus = src.corpus_recalls
    by_number = {r["recall_number"]: r for r in corpus}
    cmp_ = X.compare_recalls(src.recalls["rows"], corpus, src.agg_years)
    exact, norm, strip = X.recall_name_maps(corpus)
    by_mfr = collections.defaultdict(list)
    for r in reports:
        by_mfr[r.mfr].append(r)
    level_counts = collections.Counter()
    level_reports = collections.Counter()
    companies = []
    xc_levels = {}
    pair_total = 0
    pair_recalls = []
    agg_by_name = {a["name"]: a for a in src.agg_firms}
    agg_stats = collections.Counter()
    for name, rs in by_mfr.items():
        level, firms = X.match_company(name, exact, norm, strip)
        if not level:
            level_counts["none"] += 1
            level_reports["none"] += len(rs)
            continue
        level_counts[level] += 1
        level_reports[level] += len(rs)
        if len(rs) < XC_MIN_REPORTS:
            continue
        nums = sorted({n for ns in firms.values() for n in ns})
        rows_ = sorted((by_number[n] for n in nums), key=lambda x: (x["date"], x["recall_number"]))
        first_recall, last_recall = rows_[0]["date"], rows_[-1]["date"]
        pub_dates = [r.pub_date for r in rs if r.pub_date]
        before = sum(1 for d in pub_dates if d.isoformat() < first_recall)
        pairs = X.product_pairs(rs, by_number, nums)
        pair_total += len(pairs)
        by_recall = collections.defaultdict(list)
        for pr, num in pairs:
            by_recall[num].append(pr)
        linked = []
        for num, prs in sorted(by_recall.items()):
            first_pub = min(pr.pub_date for pr in prs)
            days = (dt.date.fromisoformat(by_number[num]["date"]) - first_pub).days
            linked.append({"recall_number": num, "recall_date": by_number[num]["date"], "paired_reports": len(prs), "first_paired_report_published": first_pub.isoformat(),
                           "days_first_paired_report_to_recall": days, "link": "/records/%s/%s" % (RECALL_DS, "cpsc-api:" + num)})
        pair_recalls.extend(linked)
        agg_rows = []
        for fname, nums_set in sorted(firms.items()):
            a = agg_by_name.get(fname)
            if a:
                agrees = a["recalls"] == len(nums_set)
                agg_rows.append({"id": a["id"], "name": a["name"], "aggregate_recalls": a["recalls"], "recalls_in_lookup": len(nums_set), "agree": agrees})
                agg_stats["firm_names_in_aggregates"] += 1
                agg_stats["agree"] += 1 if agrees else 0
        rid = "sp-xc-co-%s-%s" % (L.slug(name, 40), A.short_hash(name))
        xc_levels[name] = {"record_id": rid, "level": level, "recalls": len(nums), "first_recall": first_recall, "last_recall": last_recall, "reports_before_first_recall": before}
        companies.append((rid, name, rs, level, firms, rows_, before, pairs, linked, agg_rows))
    companies.sort(key=lambda c: (-len(c[2]), c[1]))
    rows = []
    st = {"export_only": len(cmp_["export_only"]), "corpus_only": len(cmp_["corpus_only"])}

    # summary
    positive = [p["days_first_paired_report_to_recall"] for p in pair_recalls if p["days_first_paired_report_to_recall"] > 0]
    models = sum(1 for r in corpus for p in r.get("products") or [] if p.get("model"))
    pair_stats = {"report_recall_pairs": pair_total, "recalls_with_pairs": len(pair_recalls), "recalls_where_a_paired_report_came_first": len(positive),
                  "recalls_where_paired_reports_came_only_after": len(pair_recalls) - len(positive), "median_days_first_paired_report_to_recall": L.median(positive),
                  "recall_products": sum(len(r.get("products") or []) for r in corpus), "recall_products_with_model": models}
    lag_note = ("Time from first report to recall is computed only for an exact recall number or an exact product + company key. The export's reports carry no recall number, and %s of %s corpus recall products have a Model value, "
                "so the only available key is an exact (company, product text) equality between a recall product name and a report's Product Description or Brand + Model. It links %s reports to %s recalls (%s companies); "
                "for %s of those recalls the paired reports were published before the recall date (median %s days from the first paired report to the recall), for the other %s only after it."
                % (fmt(models), fmt(pair_stats["recall_products"]), fmt(pair_total), fmt(len(pair_recalls)), fmt(sum(1 for c in companies if c[8])), fmt(len(positive)), numf(pair_stats["median_days_first_paired_report_to_recall"]), fmt(pair_stats["recalls_where_paired_reports_came_only_after"])))
    s_payload = {"kind": "summary", "comparison": {k: v for k, v in cmp_.items() if k not in ("years", "matched_numbers")}, "levels": {"report_name_strings": dict(level_counts), "reports": dict(level_reports)},
                 "company_records": len(companies), "product_pairs": pair_stats, "aggregate_firm_check": dict(agg_stats), "lag_note": lag_note, "corpus_fingerprints": src.corpus_fingerprints}
    facts = common_facts(src, "Recalls and repairs listed in the export (Recalls.csv, %s to %s) compared with the corpus datasets %s and regulatory_cpsc_aggregates" % (min(r["date"] for r in src.recalls["rows"]).isoformat(), max(r["date"] for r in src.recalls["rows"]).isoformat(), RECALL_DS)) + [
        ["Export recall entries", "%s rows in Recalls.csv: %s recalls (under the 'Recall Number' header) and %s repair entry (under the 'Repair Number' header)" % (fmt(cmp_["export_rows"]), fmt(cmp_["export_recalls"]), fmt(cmp_["export_repairs"]))],
        ["Corpus recall rows", "%s rows in %s (CPSC Recall REST API, retrieved 2026-10-17)" % (fmt(cmp_["corpus_rows"]), RECALL_DS)],
        ["Exact recall-number matches", "%s of the %s export entries share an exact recall number with a corpus row" % (fmt(cmp_["matched"]), fmt(cmp_["export_rows"]))],
        ["In the export only", "%s: %s" % (fmt(st["export_only"]), ", ".join(cmp_["export_only"][:20]) or "none")],
        ["In the corpus only", "%s: %s" % (fmt(st["corpus_only"]), ", ".join(cmp_["corpus_only"][:20]) or "none")],
        ["Matched rows that differ", "%s differ in date, %s differ in title (after whitespace and case folding)" % (fmt(len(cmp_["date_mismatch"])), fmt(len(cmp_["title_mismatch"])))],
        ["Companies with reports and recalls", "%s exact report-side name strings match a recall firm name (exact string %s, normalised key %s, key after location strip %s); %s have at least %d reports and are listed" % (fmt(sum(v for k, v in level_counts.items() if k != "none")), fmt(level_counts["exact_string"]), fmt(level_counts["normalised"]), fmt(level_counts["normalised_after_location_strip"]), fmt(len(companies)), XC_MIN_REPORTS)],
        ["Recall firm aggregates (regulatory_cpsc_aggregates)", "%s matched recall firm name strings are also firm records in regulatory_cpsc_aggregates (exact string); recall counts agree for %s of them" % (fmt(agg_stats["firm_names_in_aggregates"]), fmt(agg_stats["agree"]))],
        ["Time from first report to recall", lag_note],
        ["Matching rule", "Company names: exact string first, then equal normalised key (spdb_lib.company_key), then equal key after removing a trailing ', of <city, state>' clause from the recall firm name; recall numbers: exact string equality; no fuzzy matching"],
    ]
    rows.append(cw.record(DS_XCHECK, "sp-xc-summary", "SaferProducts.gov export recalls vs corpus recall data: summary", source_url=SOURCE_URL,
                          subtitle="%s export entries · %s exact matches · %s export-only · %s corpus-only" % (fmt(cmp_["export_rows"]), fmt(cmp_["matched"]), fmt(st["export_only"]), fmt(st["corpus_only"])),
                          cells={"kind": "Summary", "name": "All recalls and repairs", "reports": len(reports), "recalls": cmp_["export_rows"], "detail": "%s exact matches" % fmt(cmp_["matched"])},
                          facts=facts, text="SaferProducts export recalls repairs cross-check corpus CPSC recall API", filters={"kind": ["summary"]},
                          badges=[UNV], links=[SRC_LINK, link("Corpus recall dataset", "/data/%s" % RECALL_DS)], extra={"safer": s_payload}))
    for y in cmp_["years"]:
        yr = y["year"]
        rows.append(cw.record(DS_XCHECK, "sp-xc-year-%d" % yr, "Recalls dated %d: export vs corpus" % yr, source_url=SOURCE_URL,
                              subtitle="export %s · corpus %s · aggregates %s · %s" % (fmt(y["export_recalls"] + y["export_repairs"]), fmt(y["corpus"]), fmt(y["aggregates"]) if y["aggregates"] is not None else NR, "agree" if y["agree"] else "differ"),
                              cells={"kind": "Year", "name": str(yr), "reports": NR, "recalls": y["export_recalls"] + y["export_repairs"], "detail": "corpus %s · aggregates %s" % (fmt(y["corpus"]), fmt(y["aggregates"]) if y["aggregates"] is not None else NR)},
                              facts=common_facts(src, "Recall date year %d" % yr) + [
                                  ["Export entries (Recalls.csv)", "%s recalls, %s repairs" % (fmt(y["export_recalls"]), fmt(y["export_repairs"]))],
                                  ["Corpus rows (%s)" % RECALL_DS, fmt(y["corpus"])],
                                  ["regulatory_cpsc_aggregates year record", fmt(y["aggregates"]) if y["aggregates"] is not None else NR],
                                  ["Agreement", "yes" if y["agree"] else "no: counts differ"]],
                              text="recalls %d" % yr, filters={"kind": ["year"], "agree": ["yes" if y["agree"] else "no"]}, links=[SRC_LINK], extra={"safer": {"kind": "year", **y}}))
    gaps = [("export_only", n) for n in cmp_["export_only"]] + [("corpus_only", n) for n in cmp_["corpus_only"]] + [("date_mismatch", n) for n in cmp_["date_mismatch"]] + [("title_mismatch", n) for n in cmp_["title_mismatch"]]
    exp_by = {r["number"]: r for r in src.recalls["rows"]}
    for kind, num in gaps:
        e, c = exp_by.get(num), by_number.get(num)
        label = {"export_only": "in the export only", "corpus_only": "in the corpus only", "date_mismatch": "date differs", "title_mismatch": "title differs"}[kind]
        lk = [SRC_LINK]
        if c:
            lk.append(link("Corpus recall row", "/records/%s/%s" % (RECALL_DS, "cpsc-api:" + num)))
        rows.append(cw.record(DS_XCHECK, "sp-xc-gap-%s-%s" % (kind, L.slug(num, 20)), "Recall %s: %s" % (num, label), source_url=SOURCE_URL,
                              subtitle="export %s · corpus %s" % (e["date"].isoformat() if e else NR, c["date"] if c else NR),
                              cells={"kind": "Discrepancy", "name": "Recall %s (%s)" % (num, label), "reports": NR, "recalls": 1, "detail": "export %s · corpus %s" % (e["date"].isoformat() if e else NR, c["date"] if c else NR)},
                              facts=common_facts(src, "Recall number %s" % num) + [["Recall number", num], ["Difference", label], ["Export date", e["date"].isoformat() if e else NR], ["Corpus date", c["date"] if c else NR], ["Entry type in export", e["kind"] if e else NR]],
                              text="recall discrepancy %s" % num, filters={"kind": ["discrepancy"], "gap": [kind]}, links=lk, extra={"safer": {"kind": "discrepancy", "recall_number": num, "difference": kind}}))
    for rid, name, rs, level, firms, rows_, before, pairs, linked, agg_rows in companies:
        recent = rows_[-8:][::-1]
        payload = {
            "kind": "company", "name": name, "reports": len(rs), "match_level": level, "recall_firm_names": [{"name": n, "recalls": len(v)} for n, v in sorted(firms.items(), key=lambda kv: (-len(kv[1]), kv[0]))][:8],
            "recalls": len(rows_), "first_recall": rows_[0]["date"], "last_recall": rows_[-1]["date"],
            "first_report_published": min(r.pub_date for r in rs).isoformat(), "last_report_published": max(r.pub_date for r in rs).isoformat(),
            "reports_before_first_recall": before, "reports_on_or_after_first_recall": len(rs) - before, "deaths": sum(1 for r in rs if r.severity == "death"), "injuries": sum(1 for r in rs if r.severity == "injury"),
            "recent_recalls": [{"recall_number": x["recall_number"], "date": x["date"], "link": "/records/%s/%s" % (RECALL_DS, "cpsc-api:" + x["recall_number"])} for x in recent],
            "product_linked_pairs": len(pairs), "product_linked_recalls": linked[:10], "aggregate_firm_records": agg_rows[:8],
            "report_to_recall_days_note": "Not recorded: no exact recall number or exact product + company key links a specific report to a recall" if not pairs else None,
        }
        lk = [SRC_LINK] + [link("Recall %s (%s)" % (x["recall_number"], x["date"]), x["link"]) for x in payload["recent_recalls"][:5]] + [link("CPSC recall firm aggregate: %s" % a["name"], "/records/regulatory_cpsc_aggregates/%s" % a["id"]) for a in agg_rows[:3]]
        rows.append(cw.record(DS_XCHECK, rid, name, source_url=SOURCE_URL,
                              subtitle="%s reports · %s recalls with an exact company-name match · %s reports published before the first such recall" % (fmt(len(rs)), fmt(len(rows_)), fmt(before)),
                              cells={"kind": "Company", "name": name, "reports": len(rs), "recalls": len(rows_), "detail": "%s match; first recall %s" % (level.replace("_", " "), rows_[0]["date"])},
                              facts=common_facts(src, "Reports published %s to %s; recalls dated %s to %s" % (payload["first_report_published"], payload["last_report_published"], rows_[0]["date"], rows_[-1]["date"])) + [
                                  ["Name as recorded in reports", name], ["Reports", "%s (%s death reports, %s injury reports)" % (fmt(len(rs)), fmt(payload["deaths"]), fmt(payload["injuries"]))],
                                  ["Recalls with an exact company-name match", "%s recalls in %s; match level: %s" % (fmt(len(rows_)), RECALL_DS, level.replace("_", " "))],
                                  ["Recall firm name strings matched", "; ".join("%s (%s)" % (f["name"], fmt(f["recalls"])) for f in payload["recall_firm_names"])],
                                  ["Recall firm aggregate records (regulatory_cpsc_aggregates, exact firm-name string)", ("; ".join("%s: aggregate %s recalls vs %s counted here (%s)" % (a["name"], fmt(a["aggregate_recalls"]), fmt(a["recalls_in_lookup"]), "agree" if a["agree"] else "differ") for a in agg_rows[:4])) if agg_rows else "No exact firm-name string in the aggregates (they list firms with at least 3 recalls)"],
                                  ["Reports published before the first matched recall", "%s of %s (publication date earlier than %s); a company-level fact, not a product link" % (fmt(before), fmt(len(rs)), rows_[0]["date"])],
                                  ["Time from report to recall", payload["report_to_recall_days_note"] or ("%s exact product-text pairs on %s recalls: %s" % (fmt(len(pairs)), fmt(len(linked)), "; ".join("recall %s dated %s, first paired report published %s (%s days %s the recall)" % (x["recall_number"], x["recall_date"], x["first_paired_report_published"], fmt(abs(x["days_first_paired_report_to_recall"])), "before" if x["days_first_paired_report_to_recall"] > 0 else "after" if x["days_first_paired_report_to_recall"] < 0 else "on the day of") for x in linked[:4])))],
                                  ["Caveat", "A matching company name does not mean the reports concern the recalled products; recalls are listed by number and date only (the recall records themselves are not duplicated)"]],
                              text=" ".join([name] + [f["name"] for f in payload["recall_firm_names"]]), filters={"kind": ["company"], "level": [level]}, badges=[UNV], links=lk, extra={"safer": payload}))
    listing = cw.listing(
        [("kind", "Kind"), ("name", "Name"), ("reports", "Reports"), ("recalls", "Recalls / entries"), ("detail", "Detail")],
        [("kind", "Kind", {"summary": "Summary", "year": "Recall year", "discrepancy": "Discrepancy", "company": "Company with reports and recalls"}), ("level", "Company match level", {"exact_string": "Exact string", "normalised": "Normalised name", "normalised_after_location_strip": "Normalised after location strip"}),
         ("gap", "Discrepancy", {"export_only": "In export only", "corpus_only": "In corpus only", "date_mismatch": "Date differs", "title_mismatch": "Title differs"}), ("agree", "Year totals", {"yes": "Agree", "no": "Differ"})])
    summary = common_summary(src, {
        "grain": "analytical comparison records: one summary, one per recall year, one per discrepancy, one per exact report-side company name (at least %d reports) that matches a recall firm name; recall records themselves are not duplicated" % XC_MIN_REPORTS,
        "comparison": {k: v for k, v in cmp_.items() if k not in ("years", "matched_numbers")}, "levels": {"report_name_strings": dict(level_counts), "reports": dict(level_reports)},
        "company_min_reports": XC_MIN_REPORTS, "product_pairs": pair_stats, "aggregate_firm_check": dict(agg_stats), "lag_note": lag_note, "corpus_fingerprints": src.corpus_fingerprints,
        "recall_source": "Recalls.csv inside SPDB.zip (no company, product or hazard fields: title, date, summary and number only)",
        "counts": {"records": len(rows), "company_records": len(companies), "discrepancy_records": len(gaps)},
        "formulas": {"match": "recall number equality is exact string equality; company equality is exact string, then equal normalised key, then equal key after location strip (strongest level wins)"},
    })
    return build_file(DS_XCHECK, "SaferProducts.gov export vs CPSC recall data: cross-check", listing, summary, rows, src), {"cmp": cmp_, "levels": dict(level_counts), "level_reports": dict(level_reports), "companies": len(companies), "pairs": pair_stats, "xc_levels": xc_levels}


# ================================================================== main

def main():
    t0 = time.time()
    src = Source()
    print("parsed", len(src.reports), "reports in %.1fs" % (time.time() - t0), flush=True)
    mdl_pairs = X.mdl_exact_pairs(src.mdl, src.reports)
    mdl_cand = X.mdl_candidates(src.mdl, src.reports)
    write_json(os.path.join(BUILD, "xref_mdl_review.json"), {"exact_pairs": mdl_pairs, "candidate_words_not_linked": mdl_cand,
                                                           "rule": "link only when an MDL product label equals a report Brand / Product Type / Sub Category / Category / Product Description after text_key normalisation; candidates are whole-word overlaps with a Brand or manufacturer string, listed for review and never linked"})
    xc_build, xc_stats = build_xcheck(src)
    series_build, series_stats = build_series(src)
    products_build, product_stats = build_products(src, mdl_pairs)
    companies_build, company_stats = build_companies(src, xc_stats["xc_levels"])
    outputs = [(DS_SERIES, series_build), (DS_PRODUCTS, products_build), (DS_COMPANIES, companies_build), (DS_XCHECK, xc_build)]
    for ds, build in outputs:
        write_json(os.path.join(BUILD, ds + ".json"), build)
        print(ds, len(build["rows"]), "rows", flush=True)
    stats = {
        "built_at": now(), "reports": len(src.reports), "encoding": src.encoding, "parse_stats": src.parsed["stats"],
        "rows": {ds: len(b["rows"]) for ds, b in outputs}, "mdl_exact_pairs": len(mdl_pairs), "mdl_candidate_words": len(mdl_cand),
        "xcheck": {k: v for k, v in xc_stats.items() if k not in ("cmp", "xc_levels")}, "company": company_stats, "peak": series_stats["peak"],
        "recalls_stats": src.recalls["stats"], "elapsed_s": round(time.time() - t0, 1),
    }
    write_json(os.path.join(BUILD, "build_stats.json"), stats)
    print(json.dumps({k: stats[k] for k in ("rows", "mdl_exact_pairs", "elapsed_s")}))


if __name__ == "__main__":
    main()
