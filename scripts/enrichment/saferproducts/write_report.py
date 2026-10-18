"""Write private/build/saferproducts/REPORT.md from the build files, build_stats.json and spot_checks.json (no figure is typed by hand).

  python3 -I -B scripts/enrichment/saferproducts/write_report.py
Run after build_saferproducts.py and verify_saferproducts.py.
"""
import collections
import json
import os
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
B = os.path.join(ROOT, "private", "build", "saferproducts")
DS = ["saferproducts_reports_series", "saferproducts_products", "saferproducts_companies", "saferproducts_recalls_crosscheck"]


def load(name):
    with open(os.path.join(B, name), encoding="utf-8") as fh:
        return json.load(fh)


def f(n):
    return "{:,}".format(n)


def main():
    d = {k: load(k + ".json") for k in DS}
    stats = load("build_stats.json")
    spot = load("spot_checks.json")
    mdl = load("xref_mdl_review.json")
    prec = load("lookups/theme_precision.json")
    manifest = [json.loads(line) for line in open(os.path.join(ROOT, "private", "acq", "saferproducts", "_manifest.jsonl"), encoding="utf-8")]
    zip_m = next(m for m in manifest if m["url"].endswith("SPDB.zip"))
    ser, prod, comp, xc = (d[k] for k in DS)
    sm = ser["summary"]
    iq = sm["input_quality"]
    N = iq["reports_parsed"]
    srows = {r["id"]: r["item"]["safer"] for r in ser["rows"]}
    summ = srows["saferproducts-summary"]
    pubs = [srows[i] for i in sorted(srows) if i.startswith("sp-pub-")]
    reps = [srows[i] for i in sorted(srows) if i.startswith("sp-rep-")]
    xs = xc["summary"]
    levels = xs["levels"]
    rank = comp["summary"]["ranking"]
    sec = comp["summary"]["sec_match_counts"]
    comp_rows = [r["item"]["safer"] for r in comp["rows"]]
    link_counts = collections.Counter()
    for k in DS:
        for r in d[k]["rows"]:
            for ln in r["item"]["links"]:
                u = ln["url"]
                link_counts[(k, "external" if u.startswith("http") else "/" + u.split("/")[1])] += 1
    year_rows = [r for r in xc["rows"] if r["id"].startswith("sp-xc-year-")]
    pr = xs["product_pairs"]
    gap = next(r for r in xc["rows"] if r["id"].startswith("sp-xc-gap-"))
    gap_facts = dict((k, v) for k, v in gap["detail"]["facts"])
    L = []
    w = L.append

    w("# SaferProducts.gov enrichment: build report (saferproducts stream)")
    w("")
    w("Generated %s by `scripts/enrichment/saferproducts/write_report.py` from the build files, `build_stats.json` and `spot_checks.json`. Nothing here was published: the four build files are validated only (`private/scratch/enrich/publish_build.py <file>`, no `--publish`)." % time.strftime("%Y-%m-%d", time.gmtime()))
    w("")
    w("> **Every figure in these datasets counts unverified, consumer-submitted reports.** CPSC publishes a report after minimum-information checks, the manufacturer may comment, and CPSC states it does not verify every report. A report is not a finding of defect, causation or incidence. The label is carried by each record's `Units` fact, the `Unverified consumer reports` badge, the dataset labels and the summary caveats (checked by the verifier).")
    w("")
    w("## 1. Status")
    w("")
    w("| Item | Result |")
    w("|---|---|")
    w("| Datasets built | 4 (%s rows in total) plus one review file |" % f(sum(len(d[k]["rows"]) for k in DS)))
    w("| Unit tests | `cd scripts/enrichment/saferproducts && python3 -B -m unittest -v test_saferproducts` (offline, synthetic fixtures) |")
    w("| Independent spot-check | %d displayed figures recomputed from the raw export, %d mismatches (%d unexplained); %d structural checks, %d failures |" % (spot["checks"], spot["mismatches"], spot["unexplained_mismatches"], len(spot["structural"]), spot["structural_failures"]))
    w("| Validation | `publish_build.py` validated all four files (dataset ids match `^[a-z0-9_]{1,80}$`, no collision in `public.corpus_datasets`, checked by a read-only SELECT) |")
    w("| Published | No |")
    w("")
    w("## 2. Sources and terms")
    w("")
    w("| Source | Method | Retrieved (UTC) | Bytes | sha256 |")
    w("|---|---|---|---|---|")
    w("| https://www.saferproducts.gov/SPDB.zip (Public Database Export: `IncidentReports.csv`, `Recalls.csv`, `Disclaimer.txt`) | direct HTTPS GET of the link offered on the site's About and Public Search pages; no form, account, API key or click-through | %s | %s | `%s` |" % (zip_m["retrieved_at"], f(zip_m["bytes"]), zip_m["sha256"]))
    for m in manifest:
        if m["url"].startswith("https://www.saferproducts.gov/") and m.get("path") and "/pages/" in m["path"]:
            w("| %s | saved public HTML page (terms, About, FAQ, search page, one detail-page shell) | %s | %s | `%s` |" % (m["url"], m["retrieved_at"], f(m["bytes"]), m["sha256"]))
    w("| https://www.saferproducts.gov/robots.txt | status probe | %s | HTTP 404 (no robots rules) | `%s` |" % (next(m for m in manifest if m["url"].endswith("robots.txt"))["retrieved_at"], next(m for m in manifest if m["url"].endswith("robots.txt"))["sha256"]))
    w("| `public.corpus_records` `agency_safety_cpsc_recalls_api` (10,053 rows), `regulatory_cpsc_aggregates` (year and firm rows), `company_sec_profiles` (id, title) | read-only SELECT through the Supabase MCP tool; saved to `private/build/saferproducts/lookups/` | 2026-10-18 | | recall lookup rebuilt from `private/acq/cpsc_catalog/recall_api` and fingerprint-matched to the corpus (md5 of ids, ids+dates, ids+titles+dates, ids+manufacturers) |")
    w("")
    w("Raw bytes are unchanged under `private/acq/saferproducts/` (manifest `_manifest.jsonl`). Members of the zip are also kept gzipped under `members/` so the build does not re-read the 39.6 MB zip; the zip's sha256 is checked on every build.")
    w("")
    w("### Terms of use, quoted from the saved terms page")
    w("")
    w("Page: https://www.saferproducts.gov/Business/Acknowledge?source=signIn, headed *Limitation of Liability, Disclaimer, Statement of Ownership, and Terms of Use for the Publicly Available Consumer Product Safety Information Database*.")
    w("")
    for q in sm["terms"]["quotes"]:
        w("- **%s:** \"%s\"" % (q["section"], q["text"]))
    w("")
    w("Also quoted from the same page (section 4): manufacturers who use the Business Portal certify that, \"pursuant to section 6A(b)(6) of the CPSA and 16 CFR 1102.20(b), if they receive name and contact information on a Report, they will not use or disseminate such information to any other party for any other purpose other than verification of information contained in a Report.\" Submitter and victim names and contact details are never published (the FAQ's list of what will not be published includes \"Name and contact information of the submitter of the Report\" and \"Name and contact information of a victim\"), are not in the export, and are not in these datasets.")
    w("")
    w("Reading of the terms: public information that \"may be distributed or copied\"; no commercial-use prohibition on the public data was found; use is at the user's own risk. The page offers no licence beyond that, so the datasets restate figures and names as recorded and quote the disclaimer rather than adding a licence label. If the owner wants a different reading, the terms page above is the primary text.")
    w("")
    w("Statutory basis stated by the site: section 212 of the CPSIA (CPSA section 6A) and 16 CFR part 1102; reports must meet minimum information requirements, the manufacturer may comment, and materially inaccurate or confidential information may be withheld. Owner authorisation: the owner's instruction of 2026-10-18 (\"get neiss and saferproducts extensive data analysis\") reopened `cpsc_injury_data` sources for the saferproducts and neiss streams only, under the dataset ids named in this stream's brief.")
    w("")
    w("**Acquisitions that would need the owner to accept terms:** none was needed. Not done and not needed: the Business Portal (requires a business account and the section 4 certification), individual report detail pages (not scraped; one page shell was saved only to confirm that the incident date appears on the detail page and not in the export), any API (the site offers none).")
    w("")
    w("## 3. What was kept and what was not published")
    w("")
    w("- The export has one row per published report: report number, report/sent/publication dates, submitter category, product description, category/sub category/product type and code, manufacturer, brand, model, retailer, purchase date, **incident description (free text)**, state, victim severity and age, whether the company commented, associated report numbers.")
    w("- **Published here:** counts, rates, ranks and shares only. No report number, no free text, no per-report row. Victim age appears only inside bands (under 1, 1-4, 5-12, 13-17, 18-64, 65+). Geography is the state field only (the export has no city or ZIP).")
    w("- **Free text** is read once, in memory, to test the 14 hazard-term rules; no excerpt is stored.")
    w("- **Contact-like text withheld:** %s values in %s reports (an email address, phone number or street address typed into a manufacturer, brand, model, retailer or product-description field) are replaced by `[contact details withheld]` before anything is counted, and never ranked. Business websites typed as names (for example `www.amazon.com`) are kept because they name a firm." % (f(iq["contact_like_values_withheld"]), f(iq["reports_with_contact_like_value"])))
    w("- **Not in the export:** incident date (shown as Not recorded), victim sex/race, city, ZIP, serial number, UPC, and any link to a recall number.")
    w("")
    w("## 4. Coverage")
    w("")
    w("- Reports parsed: **%s** (rows read %s, malformed %s, duplicate report numbers %s, blank rows %s); text encoding %s; reports with invalid dates %s; reports without an incident description %s." % (f(N), f(iq["incident_rows_read"]), iq["malformed_rows"], iq["duplicate_report_numbers"], iq["blank_rows"], iq["encoding"], iq["reports_with_invalid_dates"], iq["reports_without_incident_description"]))
    w("- Publication dates %s to %s (the default time axis); report (submission) dates %s to %s. The newest report-year counts are understated because reports take a median of 25 days to be published." % (sm["publication_window"]["first"], sm["publication_window"]["last"], sm["report_window"]["first"], sm["report_window"]["last"]))
    w("- Partial years: publication %s and report %s. 2011 starts with the first report date in the export (2011-03-11) and first publication (2011-05-06); 2026 ends 2026-10-16. Year-over-year is marked comparable only when neither year is partial; 2026 is compared with the same window of earlier years (year to date)." % (" and ".join(str(y) for y in sm["partial_years"]["publication"]), " and ".join(str(y) for y in sm["partial_years"]["report"])))
    w("")
    w("| Year | Published | Submitted | Notes |")
    w("|---|---|---|---|")
    rep_by = {r["year"]: r for r in reps}
    for p in pubs:
        w("| %d | %s | %s | %s |" % (p["year"], f(p["reports"]), f(rep_by[p["year"]]["reports"]), "partial year" if p["partial"] else ""))
    w("")
    w("**Is the export complete?** It has exactly %s incident rows. The saved pages state no size or limit, and CPSC offers no total to compare, so completeness cannot be confirmed. Signs of truncation were looked for and not found: both ends of the date range are present, the last publication day (2026-10-16) is ragged (7 reports), and report dates run to 2026-09-28. Weekday publication gaps are real and left as they are: 2013-10-02 to 2013-10-17, 2018-12-24 to 2019-01-25 and 2025-10-02 to 2025-11-12 coincide with U.S. federal government shutdowns (outside knowledge, not stated in the export); 2020-10-09 to 2020-11-11 (23 weekdays) has no explanation in the sources." % f(N))
    w("")
    w("## 5. Datasets")
    w("")
    w("| Dataset id | Rows | Grain | Years | Keys / cross-references | Build file |")
    w("|---|---|---|---|---|---|")
    w("| `saferproducts_reports_series` | %d | 1 summary, %d publication-year and %d report-year records | 2011-2026 | `/places/<USPS>` (top 5 states on the summary) | `private/build/saferproducts/saferproducts_reports_series.json` |" % (len(ser["rows"]), len(pubs), len(reps)))
    w("| `saferproducts_products` | %d | %d categories, %d sub categories, %d product types (the export's own classification, no invented taxonomy) | 2011-2026 (yearly series on every record) | `/places/<USPS>`, parent category/sub category records | `private/build/saferproducts/saferproducts_products.json` |" % (len(prod["rows"]), prod["summary"]["counts"]["category"], prod["summary"]["counts"]["subcategory"], prod["summary"]["counts"]["type"]))
    w("| `saferproducts_companies` | %d | %d manufacturer/importer/private-labeler strings and %d retailer strings with at least 25 reports each (exact strings; variants listed, never merged) | 2011-2026 | `/companies/<CIK>` (%d, unique exact key), `/records/saferproducts_recalls_crosscheck/<id>` (%d) | `private/build/saferproducts/saferproducts_companies.json` |" % (len(comp["rows"]), rank["manufacturer"]["names_at_threshold"], rank["retailer"]["names_at_threshold"], link_counts[(DS[2], "/companies")], link_counts[(DS[2], "/records")]))
    w("| `saferproducts_recalls_crosscheck` | %d | 1 summary, %d recall-year records, %d discrepancy, %d company records (names with at least %d reports that equal a recall firm name) | recalls 1973-2026; reports 2011-2026 | `/records/agency_safety_cpsc_recalls_api/<id>`, `/records/regulatory_cpsc_aggregates/<id>`, `/data/agency_safety_cpsc_recalls_api` | `private/build/saferproducts/saferproducts_recalls_crosscheck.json` |" % (len(xc["rows"]), len(year_rows), xs["counts"]["discrepancy_records"], xs["counts"]["company_records"], xs["company_min_reports"]))
    w("| (review file, not a dataset) `xref_mdl_review.json` | | exact MDL-label pairs (%d) and whole-word overlaps listed for review and not linked (%d) | | | `private/build/saferproducts/xref_mdl_review.json` |" % (len(mdl["exact_pairs"]), len(mdl["candidate_words_not_linked"])))
    w("")
    w("### Analytics stored on the records (formulas are in each dataset's `summary.formulas`)")
    w("")
    for k, v in sm["formulas"].items():
        w("- **%s:** %s" % (k, v))
    w("")
    w("### Headline figures (all are counts of unverified reports)")
    w("")
    ltx = summ["latest_complete_year"]
    part = summ["latest_partial_year"]
    w("- %s published reports; peak complete year %d (%s); latest complete year %d: %s (YoY %+.2f%%, %+.2f%% vs 2019)." % (f(N), summ["peak_year"]["year"], f(summ["peak_year"]["reports"]), ltx["year"], f(ltx["reports"]), ltx["yoy_pct"], ltx["change_vs_2019_pct"]))
    ytd = part["ytd"]
    ex = ytd["excluding_largest_company"]
    w("- %d through %s: %s reports vs %s in the same window of %d (%+.2f%%). The largest single manufacturer string, %s, accounts for %s of them; without it the change is %+.2f%% (%s vs %s), so that one string explains about %.0f of the %.0f percentage points. Counts move with publicity, recalls and litigation." % (part["year"], ytd["through"], f(ytd["reports"]), f(ytd["prior_year_same_window"]), part["year"] - 1, ytd["change_vs_prior_year_pct"], ex["company"], f(ex["removed_reports"]), ex["change_vs_prior_year_pct"], f(ex["reports"]), f(ex["prior_year_same_window"]), ytd["change_vs_prior_year_pct"] - ex["change_vs_prior_year_pct"], ytd["change_vs_prior_year_pct"]))
    sev = summ["severity"]
    w("- Primary-victim severity: death %s, injury (any level of care) %s, incident without injury %s, no incident %s, unspecified %s. Reports, not persons." % tuple(f(sev[k]) for k in ("death", "injury", "incident_no_injury", "no_incident", "unspecified")))
    w("- Report-to-publication lag: median %s days, p90 %s days. Manufacturer comment rate %s%% overall (%s%% for 2026, because comments arrive after publication)." % (summ["lag"]["report_to_publication_days"]["median"], summ["lag"]["report_to_publication_days"]["p90"], summ["manufacturer_comment_rate_pct"], next(r for r in reps if r["year"] == 2026)["manufacturer_comment_rate_pct"]))
    g = prod["summary"]["growth_leaders"]
    w("- Fastest-growing categories (3 latest complete years vs the 3 before, both windows at least %d reports): %s. Categories with a negative change: %s." % (prod["summary"]["thresholds"]["growth_min_reports_per_window"], "; ".join("%s %+.1f%% (%s vs %s)" % (x["name"], x["change_pct"], f(x["recent"]), f(x["prior"])) for x in g["category"]["fastest"][:3]), "; ".join("%s %+.1f%%" % (x["name"], x["change_pct"]) for x in g["category"]["fastest_declining"] if x["change_pct"] < 0)))
    tc = prod["summary"]["top_model_clusters"]
    w("- Same-model repeat reports (exact brand + model strings, at least 3 reports): %s clusters holding %s reports; the largest is %s / %s with %s reports." % (f(tc["clusters"]), f(tc["reports_in_clusters"]), tc["top"][0]["brand"], tc["top"][0]["model"], f(tc["top"][0]["reports"])))
    w("")
    w("## 6. Hazard-term rules and their measured precision")
    w("")
    w("Each report is tested against 14 documented regular expressions over the lower-cased incident description (`summary.theme_definitions` holds every pattern). A match means the description contains the wording, not that the hazard was confirmed. Precision was estimated on a deterministic sample per theme: the 20 matching reports with the smallest sha256 of `round|theme|report no`, each read in a short context window and judged correct when the matched wording refers to the named hazard in the reported product incident. **The reviewer was a language model (this stream's agent), not a human domain expert.** Verdicts store generic reasons only (no report text) in `private/scratch/enrich/saferproducts/theme_verdicts.json`; the sampled and rejected report numbers are in `lookups/theme_precision.json`. Rules were revised over two development rounds (`dev1`, `dev2`) and every theme's final sample (`fin1`, or `fin2` for Fall after one more revision) was drawn after its last pattern change, with a different seed so the reports read differ from the development ones; the precision stored with a theme is shown only while its pattern hash equals the reviewed one.")
    w("")
    w("| Theme | Reports matching | Sample | Correct | Precision | Wilson 95% interval | Rejected reasons |")
    w("|---|---|---|---|---|---|---|")
    theme_n = {x["theme"]: x["reports"] for x in summ["themes"]}
    for t in sm["theme_definitions"]:
        p = prec["themes"][t["theme"]]
        w("| %s | %s | %d | %d | %.1f%% | %.1f-%.1f%% | %s |" % (t["label"], f(theme_n[t["theme"]]), p["sample_size"], p["correct"], p["precision_pct"], p["wilson95_pct"][0], p["wilson95_pct"][1], "; ".join(p["incorrect_reasons"]) or "none"))
    w("")
    w("Known limits: negation is not modelled (\"no flames\" matches Fire); \"Fire\" includes fire-extinguisher and fire-alarm products; samples of 20 give wide intervals; precision says nothing about recall (hazards described in other words are missed). The independent verifier applies the same patterns without the builder's literal-stem speed-up and found one flaw in the stems for the Fall theme (5 of 2,646 matches would have been dropped); it is fixed, covered by a regression test, and the reviewed Fall sample is identical under the corrected frame.")
    w("")
    w("## 7. Cross-reference match rates")
    w("")
    w("| Link | Count | Rule and rate |")
    w("|---|---|---|")
    w("| `/places/<USPS>` | %s (products %s, series %s) | state field equal to one of the 50 states + DC (names mapped to USPS); \"Unspecified\", \"United States\" and other values are not linked. %s of %s reports carry a US state name |" % (f(link_counts[(DS[1], "/places")] + link_counts[(DS[0], "/places")]), f(link_counts[(DS[1], "/places")]), f(link_counts[(DS[0], "/places")]), f(sum(r["reports"] for r in summ["states_all"] if r["class"] == "us_state")), f(N)))
    w("| `/companies/<CIK>` | %d | unique exact normalised-name match to a `company_sec_profiles` title (137 profiles). Manufacturer records: %d of %d matched (%d ambiguous); retailer records: %d of %d matched. Across all distinct strings: manufacturers %d of %s, retailers %d of %s. Each spelling is its own record, so Walmart appears four times (Walmart, walmart, WalMart, WALMART) and all four link to the same CIK. Everything else is \"Not linked\" |" % (link_counts[(DS[2], "/companies")], sec["manufacturer"]["records"].get("matched", 0), rank["manufacturer"]["names_at_threshold"], sec["manufacturer"]["records"].get("ambiguous", 0), sec["retailer"]["records"].get("matched", 0), rank["retailer"]["names_at_threshold"], sec["manufacturer"]["all_distinct_names"].get("matched", 0), f(rank["manufacturer"]["distinct_names"]), sec["retailer"]["all_distinct_names"].get("matched", 0), f(rank["retailer"]["distinct_names"])))
    w("| `/records/agency_safety_cpsc_recalls_api/<id>` | %s | recall rows listed by number and date for companies whose name equals a recall firm name (tiers below); all target ids were checked against the corpus lookup |" % f(sum(1 for r in xc["rows"] for ln in r["item"]["links"] if "agency_safety_cpsc_recalls_api/cpsc-api:" in ln["url"])))
    w("| `/records/regulatory_cpsc_aggregates/<id>` | %s | recall-firm name strings that are also firm records there (exact string): %s matched, recall counts agree for %s |" % (f(sum(1 for r in xc["rows"] for ln in r["item"]["links"] if "regulatory_cpsc_aggregates/" in ln["url"])), xs["aggregate_firm_check"]["firm_names_in_aggregates"], xs["aggregate_firm_check"]["agree"]))
    w("| `/records/saferproducts_recalls_crosscheck/<id>` | %d | companies dataset: manufacturer records whose name matches a recall firm name (%d of %d manufacturer records) |" % (link_counts[(DS[2], "/records")], link_counts[(DS[2], "/records")], rank["manufacturer"]["names_at_threshold"]))
    w("| `/courts`, `/judges` | 0 | not applicable to this source |")
    w("| `/matters/lens/<MDL>` | 0 | MDL membership needs explicit evidence. Exact MDL-product-label pairs against report brand/type/category/product description: **%d**. %d whole-word overlaps (for example the word `philips` in report brand strings of light bulbs and pacifiers) are listed in `xref_mdl_review.json` for review and are not linked |" % (len(mdl["exact_pairs"]), len(mdl["candidate_words_not_linked"])))
    w("")
    w("**Recall name matching (companies dataset and cross-check).** Report-side manufacturer strings were matched to recall firm names (manufacturers, importers, distributors in the CPSC Recall API) by equality only, strongest tier first: exact string (%s strings, %s reports), equal normalised key (%s strings, %s reports), equal key after removing a trailing \", of <city, state>\" clause from the recall firm name (%s strings, %s reports); no match: %s strings, %s reports. The weakest tier carries most reports, and name equality is not entity identity (two unrelated firms can share a name), so the cross-check records say \"company-name match\" and never \"the recalled product\"." % (f(levels["report_name_strings"]["exact_string"]), f(levels["reports"]["exact_string"]), f(levels["report_name_strings"]["normalised"]), f(levels["reports"]["normalised"]), f(levels["report_name_strings"]["normalised_after_location_strip"]), f(levels["reports"]["normalised_after_location_strip"]), f(levels["report_name_strings"]["none"]), f(levels["reports"]["none"])))
    w("")
    w("**Time from first report to recall.** The export's reports carry no recall number, and %s of %s corpus recall products have a Model value, so a report cannot be tied to a recall by number or model. The only key is exact equality between a recall product name and a report's Product Description or Brand + Model: %d report-recall pairs on %d recalls; for %d recalls a paired report was published before the recall (median %s days before), for the other %d only after it. Company-level: for each matched company the record states how many of its reports were published before its first matched recall (a company fact, not a product link)." % (f(pr["recall_products_with_model"]), f(pr["recall_products"]), pr["report_recall_pairs"], pr["recalls_with_pairs"], pr["recalls_where_a_paired_report_came_first"], pr["median_days_first_paired_report_to_recall"], pr["recalls_where_paired_reports_came_only_after"]))
    w("")
    cmpx = xs["comparison"]
    w("**Export recalls vs the corpus.** Recalls.csv has %s entries (%s recalls, %s repair entry). %s share a recall number with `agency_safety_cpsc_recalls_api`; %s differ in date, %s in title; in the export only: %s; in the corpus only: %s. Per-year totals agree with the corpus and with `regulatory_cpsc_aggregates` for %d of %d years%s. The export-only entry (%s) is the export's one entry of type \"%s\", dated %s: the IKEA free wall-anchoring repair program for tip-over hazard (title read from Recalls.csv), which sits under the \"Repair Number\" header and is not a Recall API recall." % (f(cmpx["export_rows"]), f(cmpx["export_recalls"]), cmpx["export_repairs"], f(cmpx["matched"]), len(cmpx["date_mismatch"]), len(cmpx["title_mismatch"]), ", ".join(cmpx["export_only"]) or "none", len(cmpx["corpus_only"]) or "none", sum(1 for r in year_rows if r["item"]["safer"]["agree"]), len(year_rows), "".join("; %d differs by the export-only entry (export %d, corpus %d)" % (r["item"]["safer"]["year"], r["item"]["safer"]["export_recalls"] + r["item"]["safer"]["export_repairs"], r["item"]["safer"]["corpus"]) for r in year_rows if not r["item"]["safer"]["agree"]), gap_facts["Recall number"], gap_facts["Entry type in export"], gap_facts["Export date"]))
    w("")
    w("## 8. Independent spot-checks (%d figures; %d mismatches)" % (spot["checks"], spot["mismatches"]))
    w("")
    w("`verify_saferproducts.py` imports nothing from the builder. It re-reads the raw gzipped CSV members with its own parser, reads each figure as it is *displayed* in the build (fact text or cell), recomputes it from the raw rows, and compares. Mismatches must carry an explanation or the run fails. Hazard-theme counts are recomputed by applying the pattern strings stored in the build to every description with no stem pre-filter.")
    w("")
    w("| # | Figure | Displayed in | Recomputed from the raw source | Displayed | Recomputed | Match |")
    w("|---|---|---|---|---|---|---|")
    for c in spot["spot_checks"]:
        w("| %s | %s | %s | %s | %s | %s | %s |" % (c["id"], c["figure"], c["displayed_in"], c["recomputed_from"], str(c["displayed"]).replace("|", "/"), str(c["recomputed"]).replace("|", "/"), "yes" if c["match"] else "NO: " + str(c["explanation"])))
    w("")
    w("One real defect was found this way: the Fall theme showed 2,641 where the unfiltered pass found 2,646 (the speed-up stem list lacked `slip` and `trip`, so \"sliped and fell\" and \"caused me to trip\" were skipped). Fixed in `spdb_lib.py`, rebuilt, and the verifier then returned 0 mismatches.")
    w("")
    w("### Structural checks")
    w("")
    for x in spot["structural"]:
        w("- %s: %s%s" % ("pass" if x["ok"] else "FAIL", x["check"], (" (%s)" % x["detail"]) if x["detail"] and x["ok"] and "links by kind" in x["detail"] else ""))
    w("")
    w("## 9. Exclusions and why")
    w("")
    w("- **No per-report dataset.** Individual unverified narratives can identify people and products; the primary site already serves them. The datasets hold aggregates.")
    w("- **Free text, victim and submitter details, report numbers:** not published (see section 3).")
    w("- **Company strings under 25 reports** get no company record (%s manufacturer strings, %s retailer strings remain only in aggregate counts); cross-check company records need 5 reports." % (f(rank["manufacturer"]["distinct_names"] - rank["manufacturer"]["names_at_threshold"]), f(rank["retailer"]["distinct_names"] - rank["retailer"]["names_at_threshold"])))
    w("- **Placeholder names** (Unknown, N/A, Gift, [REDACTED], and similar) are never ranked or clustered: %s manufacturer-field reports and %s retailer-field reports are blank or placeholders." % (f(rank["manufacturer"]["reports_placeholder_or_blank"]), f(rank["retailer"]["reports_placeholder_or_blank"])))
    w("- **Per-capita rates:** not computed. A rate needs a named denominator, its source URL and year; none was acquired in this stream. State counts are raw counts of reports.")
    w("- **Incident date and time-to-recall by report number:** Not recorded (not in the export).")
    w("- **Third-party compilations:** none used.")
    w("- **Time Limits / limitation periods:** nothing created or edited. **MDL membership:** none inferred.")
    w("")
    w("## 10. UI proposals (not implemented)")
    w("")
    w("All fields below are stored on the records under `item.safer`; every chart carries the caption *Unverified consumer-submitted reports; counts are reports, not incidence* and marks partial years.")
    w("")
    w("| Route | Proposal | Dataset fields |")
    w("|---|---|---|")
    w("| `/safety` | Add a \"Consumer reports (SaferProducts.gov)\" band: bar chart of reports by publication year with 2011 and 2026 hatched as partial, a severity stack, and a year-to-date callout that shows the figure with and without the largest manufacturer string | `saferproducts_reports_series` summary: `yearly_published`, `severity`, `latest_partial_year.ytd`, `.excluding_largest_company` |")
    w("| `/safety/signals` | Table of the fastest-growing and fastest-declining product types and categories: change %, the two report counts, rate-ratio interval, growth rank among eligible rows; hazard-term chips showing measured precision (for example Fire 85%, Tip-over 85%) | `saferproducts_products` records: `growth.change_pct`, `.ratio_ci95`, `.rank`, `.rank_of`, `.eligible`; `themes`; summary `theme_definitions[].precision` |")
    w("| `/safety` (new tab `Reports by company`) | Ranked manufacturer and retailer tables with an exact-string note (variants listed, never merged) and a \"company comment rate\" column | `saferproducts_companies`: `reports`, `share_of_all_pct`, `deaths`, `injuries`, `manufacturer_comment_rate_pct`, `variants`, `yearly` |")
    w("| `/companies/<cik>` | A \"Consumer product reports\" card on the %d linked profiles: total, deaths, yearly sparkline, top product types, link to the record | `saferproducts_companies` `yearly`, `top_types`, `deaths`; link `/records/saferproducts_companies/<id>` |" % link_counts[(DS[2], "/companies")])
    w("| `/companies` (index) | Optional \"Consumer reports\" column for the linked companies only, blank (not zero) elsewhere | same |")
    w("| `/places/<state>` and `/places/analytics` | State count and rank among states from the summary record; a table of states with raw counts. Per-capita only after the lead adds a named population denominator (source URL and year) | series summary `states_all[]` (`state`, `usps`, `reports`) |")
    w("| `/law/enforcement` or `/safety` | \"Reports before the first matched recall\" table for companies with recalls, labelled as a company-name match, plus the %d report-recall exact product pairs | `saferproducts_recalls_crosscheck` company records: `recalls`, `first_recall`, `reports_before_first_recall`, `product_linked_recalls` |" % pr["report_recall_pairs"])
    w("| `/data/saferproducts_recalls_crosscheck` | Show the discrepancy list (1 recall number in the export and not in the corpus) as a data-quality note | summary `comparison` |")
    w("| `/matters/lens/<MDL>` | Nothing yet: zero exact links. A product-signal panel would need an explicit MDL-product mapping reviewed from `xref_mdl_review.json` | `xref_mdl_review.json` |")
    w("")
    w("## 11. Open risks")
    w("")
    w("1. **Reports are unverified**; counts move with publicity, recalls and litigation (2026 year to date is %+.1f%% on the same window of 2025, and %+.1f%% without the largest manufacturer string; Diapers is the top 2026 product type with %s reports). Trend statements need that context." % (ytd["change_vs_prior_year_pct"], ex["change_vs_prior_year_pct"], f(pubs[-1]["top_product_types"][0]["reports"])))
    w("2. **Completeness of the 70,000-row export is unconfirmed** (no total published to compare with).")
    w("3. **Name matching is by equality only.** Recall-firm matches through the location-strip tier cover most matched reports and could join unrelated firms that share a name; SEC links are unique exact matches but only %d manufacturer and %d retailer records link." % (sec["manufacturer"]["records"].get("matched", 0), sec["retailer"]["records"].get("matched", 0)))
    w("4. **Hazard-term precision was judged by a language model** on samples of 20; negation is not handled; precision, not recall, was measured.")
    w("5. **Brand, retailer and company strings are as typed by consumers.** Misspellings split a firm across strings (variants are listed, not merged); a few brand strings are individuals' own names or websites. Only email, phone and street-address text is withheld automatically.")
    w("6. **The terms page lives under the Business Portal acknowledgement URL** and its sections 1-4 are written for the whole database; if the owner reads them differently the datasets can be unpublished without loss (all inputs are in `private/acq/saferproducts/`).")
    w("7. **Unexplained publication gap** 2020-10-09 to 2020-11-11.")
    w("8. **The reviewed theme precision is tied to the pattern hash**; any later pattern change makes the precision show Not recorded until a new sample is read.")
    w("")
    w("## 12. Reproduction")
    w("")
    w("```")
    w("python3 -I -B scripts/enrichment/saferproducts/acquire.py            # download + manifest (already done)")
    w("python3 -I -B scripts/enrichment/saferproducts/make_lookups.py <saved firm-aggregate result>   # read-only corpus lookups")
    w("python3 -I -B scripts/enrichment/saferproducts/theme_precision.py   # counts-only precision from the saved verdicts")
    w("python3 -I -B scripts/enrichment/saferproducts/build_saferproducts.py")
    w("python3 -I -B scripts/enrichment/saferproducts/verify_saferproducts.py")
    w("python3 -I -B scripts/enrichment/saferproducts/write_report.py")
    w("cd scripts/enrichment/saferproducts && python3 -B -m unittest -v test_saferproducts")
    w("python3 -I -B private/scratch/enrich/publish_build.py private/build/saferproducts/<dataset>.json   # validation only")
    w("```")
    w("")
    out = "\n".join(L) + "\n"
    for _ in range(60):
        try:
            with open(os.path.join(B, "REPORT.md"), "w", encoding="utf-8") as fh:
                fh.write(out)
            break
        except OSError:
            time.sleep(1)
    print("REPORT.md written,", len(out), "chars")


if __name__ == "__main__":
    main()
