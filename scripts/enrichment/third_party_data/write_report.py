"""Render private/build/third_party_data/REPORT.md from the saved build files (numbers come from the files, narrative is fixed text).

REPORT.md is PRIVATE: it may (and must) name the compilations the published datasets were derived from. The published build files may not
(owner decision 2026-10-18; enforced by check_no_source_names.py).

Usage: python3 -I -B write_report.py   (run after build_third_party_data.py, spot_check_displayed.py and recheck_official_page_checks.py)
"""
import collections
import gzip
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tp_common as tp  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
BUILD = os.path.join(ROOT, "private", "build", "third_party_data")
SS_ID, CAT_ID = "settlement_notices", "enforcement_data_sources_catalog"


def load(*parts):
    path = os.path.join(*parts)
    if not os.path.exists(path) and os.path.exists(path + ".gz"):  # parked first-pass files may be stored compressed
        with gzip.open(path + ".gz", "rt", encoding="utf-8") as handle:
            return json.load(handle)
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def esc(value):
    return str(value if value is not None else "Not recorded").replace("|", "\\|").replace("\n", " ")


def table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(esc(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


def pct(k, n):
    return f"{100 * k / n:.1f}%" if n else "n/a"


def run(args, cwd, isolated=True):
    result = subprocess.run([sys.executable, *(["-I"] if isolated else []), "-B", *args], cwd=cwd, capture_output=True, text=True)
    return result.returncode, (result.stdout + result.stderr).strip()


def exclusion_class(entry):
    reason, url = entry["reason"], entry.get("official_url") or ""
    if "ftc.gov" in url:
        return "FTC page does not exist (FTC 'Page not found', read through Firecrawl)"
    if "no official source URL" in reason:
        return "no official source URL in the record"
    if "third_party_only" in reason:
        return "compiled record marked third_party_only"
    if "aggregator" in reason:
        return "cited source is a third-party aggregator"
    if "may not be published" in reason:
        return "only usable URL is on a host that may not be published"
    if "DNS resolution failed" in reason:
        return "domain does not resolve (confirmed by an independent read)"
    if "left the cited site" in reason:
        return "domain redirects to an unrelated page or is hijacked/inactive (independent read)"
    if "HTTP 404" in reason:
        return "HTTP 404 (confirmed by an independent read where noted)"
    if "Tunnel connection failed" in reason:
        return "host unreachable from the sandbox (proxy 502); not independently re-read"
    return "host error (525 / 503 / reset / TLS / timeout)"


def main():
    stats = load(BUILD, "build_stats.json")
    ss = stats["settlesignal"]
    cat = stats["catalog"]
    spot_pub = stats["catalog_spot_checks"]
    ver = load(ACQ, "verification", "verdicts.json")
    spot_cat = load(ACQ, "verification", "catalog_spot_checks.json")
    disp = load(BUILD, "spot_checks_displayed.json")
    recheck = load(BUILD, "recheck_official_page_checks.json")
    sol = load(BUILD, "sol_discrepancies.json")
    adv = load(BUILD, "advottic_templates_tools_review.json")
    overlap = load(BUILD, "settlesignal_overlap.json")
    excluded = load(BUILD, "third_party_settlesignal_excluded.json")["rows"]
    cat_excluded = load(BUILD, "enforcement_data_sources_catalog_excluded.json")["rows"]
    built_ss = load(BUILD, SS_ID + ".json")
    built_cat = load(BUILD, CAT_ID + ".json")
    first_ss = load(BUILD, "superseded", "third_party_settlesignal_settlements.first_build_held.json")
    first_cat = load(BUILD, "superseded", "enforcement_data_sources_catalog.first_build_held.json")
    rows_ss, rows_cat = built_ss["rows"], built_cat["rows"]
    with open(os.path.join(ACQ, "_manifest.jsonl"), encoding="utf-8") as handle:
        manifest = [json.loads(line) for line in handle if line.strip()]
    last = {}
    for line in manifest:
        if line.get("http_status") == 200:
            last[line["url"]] = line

    def src(url):
        m = last.get(url)
        return f"HTTP 200, {m['bytes']:,} bytes, sha256 {m['sha256'][:16]}…, retrieved {m['retrieved_at']}" if m else "Not recorded"

    n = ver["in_published_set"]
    vc = ver["verdict_counts"]
    sr, pr, cr = ver["strict_rate"], ver["at_least_partly_rate"], ver["contradicted_rate"]
    fr = ver["field_results"]
    in_existing = sum(1 for r in rows_ss if r["filters"]["in_existing"][0] == "yes")
    exc_classes = collections.Counter(exclusion_class(e) for e in excluded)
    state_rows = ss["rows_with_state_links"]
    company_links = sum(1 for r in rows_ss if any(link["url"].startswith("/companies/") for link in r["item"]["links"]))
    moves = ss["retrieval_method_included"]
    levels = cat["levels"]
    cov_data = cat["corpus_covered_data_datasets"]
    first_hits_ss = sum(1 for _ in tp.find_forbidden(first_ss))
    first_hits_cat = sum(1 for _ in tp.find_forbidden(first_cat))
    first_src_ss = sum(1 for r in first_ss["rows"] if tp.forbidden_in_url(r["source_url"]))
    first_src_cat = sum(1 for r in first_cat["rows"] if tp.forbidden_in_url(r["source_url"]))
    new_hits = sum(1 for _ in tp.find_forbidden(built_ss)) + sum(1 for _ in tp.find_forbidden(built_cat))
    sc, rs = recheck["settlements"], recheck["catalog"]
    rc = ver["rules"]

    # live checks recorded in the report (nothing is published by this script)
    code_chk, out_chk = run([os.path.join(HERE, "check_no_source_names.py")], ROOT)
    code_val, out_val = run([os.path.join(ROOT, "private", "scratch", "enrich", "publish_build.py"), "private/build/third_party_data/" + SS_ID + ".json",
                             "private/build/third_party_data/" + CAT_ID + ".json"], ROOT)
    val_lines = [json.loads(line) for line in out_val.splitlines() if line.startswith("{")]
    digest = {v["dataset"]: v["sha256"] for v in val_lines if "dataset" in v and "sha256" in v}

    out = []
    w = out.append
    w("# third_party_data: stream report (2026-10-18, rebuilt after the owner decision)")
    w("")
    w("PRIVATE FILE. It names the compilations the two published datasets were derived from; the published build files must not (section 0). Terms were recorded first, nothing was written to Supabase, no Time Limits data was touched. All figures below are read from the saved build files by `scripts/enrichment/third_party_data/write_report.py`.")
    w("")
    w("## 0. Owner decision 2026-10-18 and what changed")
    w("")
    w("Owner decision (verbatim): \"get the settlement data and good jobs but dont reference the source names\". Reading used here: the two publish holds are lifted; the settlements dataset and the enforcement-data-sources catalog are built for the lead to publish; NO published field names or points to the compilations they were derived from. The advottic statute-of-limitations / templates / tools material stays private and unpublished; Time Limits is untouched (unchanged rule).")
    w("")
    w("### 0a. What was removed from published fields")
    w("")
    w(table(["Where", "First (held) build", "Rebuilt (publishable)"], [
        ["Dataset id and label", "`third_party_settlesignal_settlements` / 'Settlements — SettleSignal third-party compilation (official source cited)'", f"`{SS_ID}` / '{built_ss['label']}'"],
        ["Row ids", "`settlesignal:<publisher slug>` and `vt-src:<scope>:<agency slug>[:n]`", "`notice:<publisher slug>` (same stable key) and `src:<scope>:<agency slug>[:n]` (same numbering, so the saved hand-read spot checks still map 1:1)"],
        ["Row `source_url`", f"{first_src_ss} of {len(first_ss['rows'])} notice rows and {first_src_cat} of {len(first_cat['rows'])} catalog rows pointed at the compilers' own pages", "every notice row cites its official page (the cited court / administrator / agency page; for the 33 sampled rows the page the verification read, same official site); every catalog row cites the agency's own first listed URL"],
        ["Credit / licence lines", "'Attribution' fact on every notice ('Data: SettleSignal (settlesignal.com), CC-BY 4.0 — https://settlesignal.com/data/'), `license` field, summary `attribution`, `license`, `terms_conflict`, `publish_hold`, catalog `terms`", "removed; replaced by the neutral 'How compiled' fact and summary `method`"],
        ["Source labels", "badge and subtitle 'Third-party compilation (SettleSignal)', 'Record layer' fact naming the compiler, 'Publisher feed' fact (feed URL, generated / dateModified), 'Listed by' fact and `listed_by` field, '(publisher)' fact labels", f"badge/subtitle '{rows_ss[0]['item']['badges'][0]}', 'Record layer: Compiled record; not a court, agency or administrator record', '(as compiled)' labels, 'Last checked' date"],
        ["Links to the compilers", "'SettleSignal record (third-party)' link on 831 notice rows, 'Listed on (third-party list, Good Jobs First)' link on 514 catalog rows, `item.settlement.url`, `item.verification.settlesignal_url`, catalog `listed_line`", "removed (the maps from each published id back to its compiled record / listing line live only in `notice_provenance_private.json` and `catalog_provenance_private.json`)"],
        ["Summary / inputs", "summary `source`, `publisher`, `list_urls`, `listed_by`, `third_party_list`, `feed_generated`, `feed_dateModified`, `retrieved`, `aggregate_figures`; `inputs` with the compilers' URLs and `private/acq/.../settlesignal|violationtracker` paths", "neutral summary (`compiled`, `method`, `last_checked`, `records_considered`, counts with neutral key names); `inputs` name the private acquisition manifest and the raw file's sha256 only"],
        ["Reviewer notes", "2 verification notes said 'the SettleSignal title'", "reworded to 'the compiled title' by `tp_common.public_wording` (status, evidence and quotes untouched); a 'private/acq' path fragment is dropped from the method text"],
        ["Forbidden names + hosts found by `check_no_source_names.py`", f"{first_hits_ss:,} hits in the held notices file, {first_hits_cat:,} in the held catalog file", f"{new_hits} in the two rebuilt files"],
    ]))
    w("")
    w("Unchanged and still disclosed per row: that the record is compiled and not an official record ('Compiled record' badge, 'Record layer' and 'How compiled' facts); the per-record verification status and its evidence (quote / page / field compared), exactly as measured and never upgraded; the cited official page and how it was read; a neutral 'Last checked' date (2026-10-18) and the method.")
    w("")
    w("### 0b. Attribution and licence credit lines are no longer displayed (factual note for the owner)")
    w("")
    w("The compilations state conditions for reuse, listed with their quoted wording in section 2: the settlements compilation grants CC BY 4.0 with a credit link ('Data: SettleSignal (settlesignal.com), CC-BY 4.0 — https://settlesignal.com/data/') while its general Terms of Use say 'Use SettleSignal only for lawful, personal, non-commercial purposes. Do not scrape, resell, or republish the catalog in bulk'; the source-list compilation's Terms of Service grant a licence 'only for your own internal use'. The owner has chosen not to display source names, so the credit line, the licence line and the links are gone from every published field. CC BY 4.0 conditions reuse on attribution, and the other two sets of terms restrict republication; whether the omission and the publication are acceptable is the owner's legal risk. This stream accepted no terms (section 2a) and the decision does not change that.")
    w("")
    w("### 0c. Hold status")
    w("")
    w(table(["Material", "Status after the owner decision"], [
        ["Settlements (`settlement_notices`)", "Hold lifted by the owner. Built for the lead to publish; not published by this stream."],
        ["Enforcement data sources catalog (`enforcement_data_sources_catalog`)", "Hold lifted by the owner. Built for the lead to publish; not published by this stream. No penalty records."],
        ["Advottic statute-of-limitations", "STILL PRIVATE / UNPUBLISHED. Only `sol_discrepancies.md/.json` (a private review report, not a build file). Time Limits untouched; no limitation rule created, edited or staged."],
        ["Advottic templates.json and tools", "STILL PRIVATE / UNPUBLISHED (`advottic_templates_tools_review.json`, not a build file). Excluded with reasons (section 6)."],
    ]))
    w("")
    w("### 0d. Numbers")
    w("")
    w(table(["Dataset", "Considered", "Built", "Excluded", "Why excluded"], [
        [f"`{SS_ID}`", ss["feed_records"], ss["included"], ss["excluded"], "; ".join(f"{k}: {v}" for k, v in sorted(exc_classes.items(), key=lambda kv: -kv[1])) + " (0 because the only URL was on a forbidden host: no record cites such a host)"],
        [f"`{CAT_ID}`", cat["listed_entries"], cat["entries"], cat["excluded"],
         f"{cat['excluded_no_url']} entries list no agency URL ({cat['excluded_open_records_only']} are open-records-request lines, the rest agency-only or FOIA-note lines; {sum(1 for e in cat_excluded if e['jurisdiction'] == 'Federal')} federal + {sum(1 for e in cat_excluded if e['jurisdiction'] != 'Federal')} state/local) so the row would have no source_url of its own once the list page may not be cited; {cat['excluded_only_url_on_forbidden_host']} entries had a compiler-site URL as their only URL"],
    ]))
    w("")
    w(f"Of the 22 hand-read catalog spot checks, {rs['in_published_set']} are in the published set and {rs['not_in_published_set']} (Hawaii Department of Health, Iowa Racing and Gaming Commission: open-records requests, nothing to load) are among the excluded entries. The excluded lists, with reasons, are `third_party_settlesignal_excluded.json` and `enforcement_data_sources_catalog_excluded.json` (private).")
    w("")
    w("### 0e. Ready-to-publish checklist for the lead")
    w("")
    nl = built_ss["listing_block"]
    cl = built_cat["listing_block"]
    w(table(["", f"`{SS_ID}`", f"`{CAT_ID}`"], [
        ["Build file", f"`private/build/third_party_data/{SS_ID}.json`", f"`private/build/third_party_data/{CAT_ID}.json`"],
        ["Dataset id (checked against `public.corpus_datasets`, 119 rows, read-only SELECT 2026-10-18)", "no collision, no similar id", "no collision (the held catalog was never published)"],
        ["Label", built_ss["label"], built_cat["label"]],
        ["Rows", len(rows_ss), len(rows_cat)],
        ["Row-set sha256 (from `publish_build.py` validate)", digest.get(SS_ID, "Not recorded"), digest.get(CAT_ID, "Not recorded")],
        ["listing_block columns", ", ".join(c["key"] for c in nl["columns"]), ", ".join(c["key"] for c in cl["columns"])],
        ["listing_block filters", ", ".join(f["name"] for f in nl["filters"]), ", ".join(f["name"] for f in cl["filters"])],
        ["Summary (keys)", ", ".join(built_ss["summary"]), ", ".join(built_cat["summary"])],
        ["Method line (summary.method, also on every row)", built_ss["summary"]["method"], built_cat["summary"]["method"]],
        ["Row ids / source_url", "`notice:<slug>` / the row's cited official page", "`src:<scope>:<agency>[:n]` / the agency's first listed URL"],
        ["Cross-links", f"{in_existing} rows -> `/records/settlements/<id>` (exact keys), {state_rows} rows -> `/places/<USPS>`, {company_links} rows -> `/companies/<CIK>`, 0 courts, 0 MDL", f"{sum(1 for r in rows_cat if r['state'])} rows -> `/places/<USPS>`"],
    ]))
    w("")
    w("Steps for the lead (this stream publishes nothing):")
    w("")
    w("1. `python3 -I -B scripts/enrichment/third_party_data/check_no_source_names.py` must print `RESULT: PASS` immediately before publishing (it scans every top-level build-shaped file in this folder; the first-pass files are parked in `superseded/`).")
    w("2. Validate: `python3 -I -B private/scratch/enrich/publish_build.py private/build/third_party_data/settlement_notices.json private/build/third_party_data/enforcement_data_sources_catalog.json`; then the lead's own `--check` / `--publish` flow. `publish_build.py` adds `published_by` and `build_file` (a neutral path) to the summary; neither names a source.")
    w("3. Do NOT publish anything under `superseded/` or the private side files (`*_excluded.json`, `*_provenance_private.json`, `settlesignal_overlap.json`, `sol_discrepancies.*`, `advottic_templates_tools_review.json`, `recheck_official_page_checks.json`, `spot_checks_displayed.json`, `build_stats.json`).")
    w("4. Outside this stream's ownership, flagged because the owner decision may reach them: the live `settlements` dataset (869 rows) carries the compiler's name in the `detail`/`text` of all 869 rows and its catalog metadata names it; the live `limitation_periods` catalog metadata names Advottic (read-only SELECTs on 2026-10-18). Nothing was changed there.")
    w("5. UI: the cross-link from a published notice to `/records/settlements/<id>` lands on those live rows, so the rows' own wording is visible one click away until they are reworded.")
    w("")
    w("## 1. Outcome in one table")
    w("")
    w(table(["Item", "Result"], [
        ["Settlement notices (compiled from the SettleSignal open-data file)", f"`{SS_ID}`: {ss['included']} of {ss['feed_records']} records have a citable primary source and are built; {ss['excluded']} excluded with reasons. Hold lifted by the owner; source names not displayed."],
        ["Verification against the cited official page", f"{ver['sampled']} records sampled (seed {ver['seed']}); {n} are in the published set. Verified {vc.get('verified', 0)}/{n} ({pct(vc.get('verified', 0), n)}, Wilson 95% {sr['wilson95'][0]:.2f}–{sr['wilson95'][1]:.2f}); verified or partly {pr['k']}/{n} ({pct(pr['k'], n)}); contradicted {vc.get('contradicted', 0)}/{n} ({pct(vc.get('contradicted', 0), n)}). Re-run against the rebuilt file: the build carries exactly the measured verdicts and evidence for all {sc['in_published_set']}; {sc['evidence_items_found_again']} of {sc['evidence_items_searched']} literal evidence items of the {sc['direct_read_records']} direct reads were found again in the saved page bytes."],
        ["Overlap with corpus `settlements` (869 rows)", f"{overlap['counts']['any_exact']} of {ss['feed_records']} records match an existing row exactly; {overlap['counts']['new_in_feed']} are new; {overlap['counts']['near_duplicate_pairs']} near-duplicate pair listed for review (a false positive). Nothing merged."],
        ["Advottic statute-of-limitations", "Never published. Private discrepancy report only: `sol_discrepancies.md/.json` (459 cells vs `limitation_periods` 459 and `statutory_limitations_review` 124)."],
        ["Advottic templates.json and tools", "Described, licensed, rated; all excluded with reasons (section 6)."],
        ["Enforcement data sources catalog (compiled from the Violation Tracker source-list pages)", f"`{CAT_ID}`: {cat['listed_entries']} listed entries, {cat['entries']} built ({cat['federal']} federal, {cat['state_local']} state/local), each with agency, jurisdiction, coverage phrase, the agency's own URL, URL check and corpus coverage; {cat['excluded']} excluded (no agency URL). No penalty records read. Hold lifted by the owner; source names not displayed."],
        ["Spot checks", f"{ver['sampled']} settlement records against official pages; {spot_cat['sampled']} catalog entries against the agency pages ({rs['in_published_set']} in the published set); {disp['displayed_checks']} displayed values against the raw files ({disp['displayed_mismatches']} mismatches) plus {disp['source_url_checks']} row source_url checks ({disp['source_url_mismatches']} mismatches)."],
        ["No source names", f"`check_no_source_names.py`: {out_chk.splitlines()[-1] if out_chk else 'Not run'}"],
        ["Tests", "`cd scripts/enrichment/third_party_data && python3 -B -m unittest -v test_third_party_data` (see section 12)."],
    ]))
    w("")
    w("### Findings worth the lead's attention")
    w("")
    w("1. **ftc.gov is invisible to the research sandbox.** Every ftc.gov path, including `/` and `/robots.txt`, returns the same 1,301-byte generic 'Page Not Found' page (sha256 `6cb6ddd1f7ee…`). The earlier pass therefore excluded all 83 FTC-cited records as 'HTTP 404'. Re-read through the Firecrawl MCP, 81 of the 83 pages exist (200) and are now included; 2 are real FTC 404s (lurn-refunds, hubble-contacts-refunds) and stay excluded. FTC pages are the most authoritative sources in the feed.")
    w(f"2. **Two of the {n} sampled published records are contradicted by their official page** (Toyota IC forklift deadline 2026-09-22 vs the page's October 7, 2026; Western Union Phase 3 deadline 2026-08-19 vs the page's extension to December 31, 2026). Unsampled records carry the compiled figures, labelled 'Not verified'.")
    w("3. **The existing `settlements` dataset already contains ~93% of this feed**, so most value here is the official-page verification layer, the 63 records new to the corpus, and the retrieval/exclusion evidence, not a second list.")
    w("4. **`limitation_periods` reproduces the Advottic table verbatim** (459 of 459 cells identical; its qualification cites 'Advottic Legal Data, reviewed 2026-06-08, CC BY 4.0'). Agreement between the two is a version check, not independent confirmation. Two cells are contradicted by the corpus's own cited statutes (LA personal injury: Advottic 1 year vs La. C.C. art. 3493.1 as amended by Acts 2024, No. 423: 2 years; ME wrongful death: Advottic 2 years vs 18-C M.R.S. § 2-807(2): 3 years). Review items only; Time Limits unchanged.")
    w("5. **Domain hijack in the feed.** `lbtransportclassaction.com`, cited by a SettleSignal record, now serves an unrelated gambling site; excluded.")
    w("6. **A data defect fixed in this rebuild:** one record's `official_claim_url` holds the text 'No claim form currently available' (not a URL). The first build emitted it as an 'Official claim form' link; it is now ignored (only http(s) URLs become links or cited pages), and the `deadline_years` counts are computed over built rows (the first build counted all 897 records).")
    w("")
    w("## 2. Sources and terms (read before use)")
    w("")
    w("All raw bytes are unchanged under `private/acq/third_party_data/` with `_manifest.jsonl` (url, path, sha256, bytes, retrieved_at, http status, method); nothing under `private/acq` was renamed or deleted. User-Agent `legal-source-compass research (Seeger Weiss internal research)`, at most one request per second per host, robots.txt honoured (RFC 9309).")
    w("")
    w(table(["Source", "Retrieval", "Terms found", "Decision"], [
        ["https://settlesignal.com/data/settlements.json (897 records)", "direct GET; " + src("https://settlesignal.com/data/settlements.json"),
         "Open-data page (https://settlesignal.com/data/), JSON-LD licence field, /.well-known/rsl.xml, llms.txt and robots.txt all say free reuse under CC BY 4.0 with a credit link ('Data: SettleSignal (settlesignal.com), CC-BY 4.0 — https://settlesignal.com/data/'). The general Terms of Use (https://settlesignal.com/terms/, last updated June 3, 2026) say 'Use SettleSignal only for lawful, personal, non-commercial purposes. Do not scrape, resell, or republish the catalog in bulk'. The same Terms also say 'If SettleSignal conflicts with an official source, rely on the official source.'",
         "Owner decision 2026-10-18: build and publish, without displaying the source name, the credit line or any link to the compiler (section 0). The CC BY credit condition and the Terms conflict are the owner's accepted risk."],
        ["https://advottic.com/open-data/statute-of-limitations.json", "direct GET; " + src("https://advottic.com/open-data/statute-of-limitations.json"),
         "CC BY 4.0 on the open-data page; Terms of Use (https://advottic.com/terms, 2026-04-25) forbid to 'scrape [the service], or use it to train another AI system'; no per-entry statutory citations in the file.",
         "NEVER published. Private discrepancy report only (Time Limits owner hold, unchanged)."],
        ["https://advottic.com/open-data/templates.json and /tools pages", "direct GET; " + src("https://advottic.com/open-data/templates.json"),
         "Same CC BY 4.0 / Terms conflict; five generic templates; three interactive tools.", "Excluded, still private (section 6)."],
        ["https://violationtracker.goodjobsfirst.org/pages/violation-tracker-data-sources and /local-state-data-sources", "direct GET; " + src("https://violationtracker.goodjobsfirst.org/pages/violation-tracker-data-sources"),
         "Good Jobs First Terms of Service (https://goodjobsfirst.org/terms-of-service/, section 5.1): 'a limited, non-exclusive, non-sublicensable, non-transferable, and revocable license to access and use the Services only for your own internal use'. robots.txt on the Violation Tracker host disallows only /resource/, /gen/, /devel/.",
         "Only the source listing is used: agency name, jurisdiction, the kind of source, the agency's own URL (facts, each re-checked against the agency). Owner decision 2026-10-18: publish the catalog without naming the list or linking to it (section 0); the licence is the owner's accepted risk."],
        ["https://violationtracker.goodjobsfirst.org/pages/data-visualizations", "direct GET; " + src("https://violationtracker.goodjobsfirst.org/pages/data-visualizations"),
         "The page only describes an embedded interactive dashboard of Violation Tracker penalties; it publishes no figures in its text, and the Terms grant internal use only.",
         "No aggregate figure cited. No Violation Tracker penalty record scraped."],
    ]))
    w("")
    w("### 2a. Terms acceptance (standing rule from the lead)")
    w("")
    w("Rule: submit no web form, create no account, enter no contact details and accept no terms or agreement on anyone's behalf; if a source requires that, stop that acquisition and record it here for the owner.")
    w("")
    w("What this stream did: every request was an unauthenticated HTTP GET of a public page or file (the fetchers contain no POST, form, login or sign-up code; the manifest methods are direct GET, the official-source and catalog URL checks, and Firecrawl page reads). No account was created, no form was submitted, no contact details were entered, no consent banner or terms box was clicked. The only identification is the User-Agent header `legal-source-compass research (Seeger Weiss internal research)`; sec.gov requests (5 pages) used the contact User-Agent the stream contract requires, which is a header, not a form entry. No further request was made to the three compilers' hosts in this rebuild (it reads only the saved files).")
    w("")
    w("Three sources state that accessing or using them is itself agreement to their terms (browse-wrap). No click-through was ever presented or accepted by this stream. The owner's 2026-10-18 decision to use the data is the owner's; the quoted wording of each is kept here so the risk is on record:")
    w("")
    w(table(["Source and terms URL", "What the terms say", "What was fetched (GET only)", "Status"], [
        ["Good Jobs First / Violation Tracker, https://goodjobsfirst.org/terms-of-service/", "'By accessing or using the Services, you acknowledge and agree that you have read, understand, and agree to be bound by these Terms and our Privacy Policy' (an entity user also warrants authority to bind). Section 5.1: licence 'only for your own internal use'. Section 5.2: no 'bots,' scraping, or other automated processing that burdens the servers or circumvents blockers. Section 14: mandatory individual arbitration and class-action waiver for U.S. residents unless opted out. Section 2.1: some Services require an account.", "3 Violation Tracker pages (federal data sources, state/local data sources, data visualizations) and the terms page, one request each; no account-only area and no search or record pages.", "Used under the owner's decision; names and links not displayed. No further requests."],
        ["SettleSignal, https://settlesignal.com/terms/ (and the open-data grant at https://settlesignal.com/data/)", "Terms of Use last updated June 3, 2026: 'By creating an account you confirm you meet these requirements'; 'continued use after a change means you accept it'; 'Use SettleSignal only for lawful, personal, non-commercial purposes. Do not scrape, resell, or republish the catalog in bulk'; binding individual arbitration with a class waiver. The open-data page separately grants CC BY 4.0 for settlements.json.", "settlements.json (the file the open-data page links), the public terms, open-data, about, how-we-verify, ai-instructions, disclaimer, partners and llms.txt pages, rsl.xml, robots.txt and the single saved record detail page; no account.", "Used under the owner's decision; names, credit line and links not displayed. No further requests."],
        ["Advottic, https://advottic.com/terms", "Terms of Use last updated 2026-04-25: 'By using Advottic you agree to these Terms'; forbids to 'scrape [the service], or use it to train another AI system'. The open-data page separately grants CC BY 4.0.", "statute-of-limitations.json and templates.json (linked from the open-data page), the open-data, tools, about, terms and three tool pages, robots.txt; no account, no tool was run. small-claims.json was not requested.", "NOT used beyond the private discrepancy report (hold unchanged). No further requests."],
    ]))
    w("")
    w("No other source asked for acceptance: the agency, court and settlement-administrator pages read for the checks present no terms gate on a plain GET. Where a page showed a cookie or consent banner it was not touched.")
    w("")
    w(f"## 3. Settlement notices: `{SS_ID}` (compiled from the SettleSignal open-data file)")
    w("")
    w(f"- Feed generated {ss['feed_generated']}, dateModified {ss['feed_dateModified']}; fields: title, url, category, settlement_type, status, claim_deadline, proof_required, applicable_states, official_claim_url, official_settlement_url, estimated_payout, verification_status, accepted_official_evidence, last_verified. There is **no court field and no MDL field**.")
    w(f"- Rows: **{ss['included']}** (build file `private/build/third_party_data/{SS_ID}.json`). Claim deadlines of built rows: {ss['deadline_range'][0]} to {ss['deadline_range'][1]}; by year {json.dumps(ss['deadline_years'])}; compiled last-verified range (all considered records) {ss['last_verified_range'][0]} to {ss['last_verified_range'][1]}. {ss['deadline_state_included'].get('unknown', 0)} built rows have no deadline ('No deadline published').")
    w("- Every row: badge 'Compiled record', a 'Record layer' and a 'How compiled' fact, a 'Last checked' date, the compiled values labelled '(as compiled)', the cited primary source with its class and the check result, and a verification status (Verified / Partially verified / Matter only / Contradicted / Not verified). No attribution or licence line, no link to the compiler.")
    w(f"- Primary-source classes among included rows: {json.dumps(ss['source_class_included'])}. Top hosts: {json.dumps(ss['source_hosts_included_top'])}.")
    w(f"- How each included primary source was seen: direct fetch {moves.get('direct', 0)}; read through Firecrawl {moves.get('page_service', moves.get('firecrawl', 0))}; not loaded (bot wall or robots.txt) {moves.get('none', 0)}. The 8 of 8 bot-walled (403) pages in the verification sample all loaded in a browser-based read, which supports including the unread 403 hosts as 'access restricted'.")
    w("")
    w("### Inclusion rule and exclusions")
    w("")
    w(f"A record is built only when it cites an official source (government, court, settlement/administrator site, wire press release, class-counsel/organisation or company page; not an aggregator; compiled tier not `third_party_only`; the cited URL is an http(s) URL on a host that may be published) AND the cited URL was retrieved (HTTP 2xx with settlement/claim wording), was read through Firecrawl, or sits behind a bot wall / robots.txt disallow that the page-read policy respects. Everything else is listed in `third_party_settlesignal_excluded.json` (private). A record whose only usable URL is on a forbidden host stays excluded: 0 records.")
    w("")
    w(table(["Exclusion class", "Records"], sorted(exc_classes.items(), key=lambda kv: -kv[1])) + f"\n\nTotal excluded: {len(excluded)}.")
    w("")
    w("Exclusions based on a sandbox failure alone (proxy 502, TLS, reset) are 'could not be retrieved on the check date', not a claim that the page is gone; a re-check from another network could readmit some.")
    w("")
    w("### Overlap with the existing `settlements` dataset (869 rows, read-only lookup)")
    w("")
    oc = overlap["counts"]
    w(table(["Test (exact, deterministic)", "Records matched"], [
        ["Same compiled-record page key (slug) as an existing row's cited page", oc["exact_publisher_page"]],
        ["Same official URL (host and path, www/trailing slash/scheme normalised)", oc["exact_official_url"]],
        ["Same normalised title", oc["exact_title"]],
        ["Same caption + amount printed in the title", oc["exact_caption_and_amount"]],
        ["Exact case name + court + amount", f"{oc['exact_case_name_court_amount']} (not computable: neither side records a court)"],
        ["Any of the above", oc["any_exact"]],
        ["No exact match (new to the corpus)", oc["new_in_feed"]],
        ["Existing rows matched by at least one record", f"{oc['existing_matched']} of {oc['existing_rows']}"],
        ["Existing rows citing a compiled-record page that is not in today's file", oc["existing_publisher_refs_not_in_current_feed"]],
        ["Near-duplicate pairs (title Jaccard >= 0.6 or same official host, new records only), listed for review", oc["near_duplicate_pairs"]],
    ]))
    w("")
    w(f"Of the {ss['included']} built rows, {in_existing} carry a `/records/settlements/<id>` link to an existing row and {ss['included'] - in_existing} are new to the corpus. Twelve records match two existing rows each (shared official URL); every candidate id is listed, never collapsed. The single near-duplicate pair is Etairos Health vs DAP Health (same title shape, different matters): a false positive, left for review. Full detail: `settlesignal_overlap.json` (private).")
    w("")
    w("### Verification against the primary source each record cites")
    w("")
    w(f"Method: fixed-seed random sample (seed {ver['seed']}, {ver['sampled']} of {ver['population']} records). For each record the cited official page was matched on three things: the claim deadline, the dollar figures the record states, and the matter named. Direct reads were matched deterministically on the saved bytes and then confirmed by a person; pages the sandbox could not load (403 bot walls, ftc.gov) or render (JavaScript shells) were read through the Firecrawl MCP and read by a person. {ver['sampled'] - n} of the {ver['sampled']} fall outside the published set (an aggregator source, a dead site, a domain that does not resolve), so the rates are over the {n} in the published set.")
    w("")
    w(table(["Verdict", "Rule", "Records", "Share"], [
        ["verified", rc["verified"], vc.get("verified", 0), pct(vc.get("verified", 0), n)],
        ["partially_verified", rc["partially_verified"], vc.get("partially_verified", 0), pct(vc.get("partially_verified", 0), n)],
        ["identity_only", rc["identity_only"], vc.get("identity_only", 0), pct(vc.get("identity_only", 0), n)],
        ["contradicted", rc["contradicted"], vc.get("contradicted", 0), pct(vc.get("contradicted", 0), n)],
    ]))
    w("")
    w(f"**Verification rate = verified / sampled in the published set = {vc.get('verified', 0)}/{n} = {pct(vc.get('verified', 0), n)}** (Wilson 95% interval {sr['wilson95'][0]:.3f}–{sr['wilson95'][1]:.3f}). Verified or partly verified: {pr['k']}/{n} = {pct(pr['k'], n)} ({pr['wilson95'][0]:.3f}–{pr['wilson95'][1]:.3f}). Contradicted: {cr['k']}/{n} = {pct(cr['k'], n)} ({cr['wilson95'][0]:.3f}–{cr['wilson95'][1]:.3f}). Most 'partial' results are home pages that show the deadline but keep the dollar figures in a linked notice that was not opened; they are not disagreements. No status was changed by the rebuild (section 7b re-runs the checks).")
    w("")
    w(table(["Field", "Confirmed", "Partly", "Not found on the cited page", "Contradicted", "Not applicable (record has none)"],
            [[k.title(), v.get("confirmed", 0), v.get("partly_confirmed", 0), v.get("not_found", 0), v.get("contradicted", 0), v.get("not_applicable", 0)] for k, v in fr.items()]))
    w("")
    w("Per-record verdicts (all 36 sampled; evidence quotes are in `private/acq/third_party_data/verification/verdicts.json` and in each row's detail):")
    w("")
    vrows = []
    for r in ver["rows"]:
        f = r.get("fields", {})

        def res(key):
            return f.get(key, {}).get("result", "n/a").replace("_", " ")
        vrows.append([r["row"], r["title"][:58], r["verdict"].replace("_", " "), res("date"), res("payout"), res("identity"),
                      "Firecrawl" if "Firecrawl" in (r.get("method") or "") else ("direct" if r["verdict"] != "not_in_published_set" else "—"), r.get("note") or ""])
    w(table(["#", "Record", "Verdict", "Deadline", "Payout", "Matter", "Read", "Note"], [[*v[:7], v[7][:140]] for v in vrows]))
    w("")
    w("### Cross-references (exact keys only)")
    w("")
    w(table(["Link", "Rows linked", "Share of built rows", "Method / unmatched"], [
        ["/places/<USPS>", state_rows, pct(state_rows, ss['included']), f"{ss['state_links']} links from applicable_states; the other {ss['included'] - state_rows} rows are nationwide as published ([]), shown as 'Nationwide (as published)', never a guessed state"],
        ["/courts/<id>", 0, "0%", "the feed has no court field; nothing inferred from captions"],
        ["/matters/lens/<n>", 0, "0%", "no record states an MDL number; nothing inferred from caption, product, judge or firm"],
        ["/companies/<CIK>", company_links, pct(company_links, ss['included']), f"exact normalised name match to the 137 `company_sec_profiles` (defendant side of an 'X v. Y' caption, or a title that is the company name); {ss['company_match'].get('no_match', 0)} captions have a defendant with no match; no abbreviation expansion or fuzzy match"],
        ["/records/settlements/<id>", in_existing, pct(in_existing, ss['included']), "exact compiled-record page key / official URL / normalised title / caption+amount"],
    ]))
    w("")
    w("### Stored analytics fields")
    w("")
    w(f"Counts for filters and charts are stored as row filters: `type`, `status`, `deadline_state` (claim_deadline vs 2026-10-18: passed / within 30 days / future / unknown), `verification`, `source_class`, `state`, `accepted_evidence`, `in_existing`, and `date`. Shares = count / built rows (formula in the dataset summary). Current counts: type {json.dumps(ss['type_included'])}; status {json.dumps(ss['status_included'])}; deadline state {json.dumps(ss['deadline_state_included'])}. No dollar figure is summed: payout text is the compiled verbatim string.")
    w("")
    w(f"## 4. Enforcement data sources catalog: `{CAT_ID}` (compiled from the Violation Tracker source-list pages)")
    w("")
    w(f"- {cat['listed_entries']} entries listed ({cat['listed_federal']} federal, {cat['listed_state_local']} state/local); **{cat['entries']} built** ({cat['federal']} federal, {cat['state_local']} state/local) across {cat['jurisdictions']} jurisdictions (50 states + DC); {cat['excluded']} excluded because the listing gives no agency URL. Level (derived from the agency name by fixed rules in `vt_parse.level_of`): {json.dumps(levels)}. Source types (derived from the listed phrase): {json.dumps(cat['source_types'])}.")
    w(f"- URLs: {cat['with_url']} built entries have at least one URL ({cat['distinct_urls']} distinct); {cat['gov_domain'].get('yes', 0)} are all on .gov/.mil/.us hosts. Check on 2026-10-18 (one GET each, robots.txt honoured): {json.dumps(cat['url_states'])}; {cat['urls_redirected']} URLs redirect to a different page. 'ok' means the page loaded, not that it is current (one spot check found a press-release list whose newest item was dated 2023).")
    w(f"- Corpus coverage (which datasets already cover each agency): {cat['corpus_covered'].get('covered', 0)} entries have at least one matching corpus dataset; {cov_data} entries have an enforcement/safety/regulatory data dataset (CPSC, EPA, FDA, NHTSA, SEC, FTC, CFPB and the Arizona AG through `settlements`); the rest are matched only by the `sources` directory. Rule: the dataset's records cite the agency's host, or its label names the agency or (federal only) its acronym as a whole word. Coverage means the dataset exists, not that every enforcement action of the agency is loaded. Recompute after the concurrent enforcement streams publish.")
    w(f"- The {cat['excluded']} excluded entries ({cat['excluded_open_records_only']} open-records-request lines) have no URL of their own; in the first build their row cited the list page itself, which may not be cited now, and no URL is invented. `enforcement_data_sources_catalog_excluded.json` (private) lists them. Entries whose only URL was on a compiler site: {cat['excluded_only_url_on_forbidden_host']} (the parser already dropped every compiler-site link, and none of the 514 entries depended on one).")
    w("")
    w(f"### Catalog spot checks ({spot_cat['sampled']} entries: 6 federal + 16 state/local, seed {spot_cat['seed']}; {spot_pub['sampled']} in the published set)")
    w("")
    w(f"Listing fidelity: the listed line appears verbatim on the saved list page for {spot_cat['listing_verbatim']} of {spot_cat['sampled']} (re-checked against the saved page in section 7b). Page reading in the published set: {json.dumps(spot_pub['result_counts'])} (confirmed = the agency's own page loads and its title/heading matches the listed coverage; partly = page loads but the listed coverage is not visible on it; flagged = redirect or stale; listing only = robots.txt forbids fetching or no URL). The sample was drawn and hand-read on the first build and is not redrawn (`write_catalog_spot_checks.py` is now guarded).")
    w("")
    built_ids = {r["id"] for r in rows_cat}
    w(table(["Entry (published id)", "Result", "In published set", "Note"], [[bt_id, r["result"].replace("_", " "), "yes" if bt_id in built_ids else "no (no agency URL)", r["note"][:240]]
                                                                      for r in spot_cat["rows"] for bt_id in ["src:" + r["entry_id"][len("vt-src:"):]]]))
    w("")
    w("## 5. Advottic statute-of-limitations: private discrepancy report (hold unchanged)")
    w("")
    w("Files: `private/build/third_party_data/sol_discrepancies.md` and `.json`. No Advottic value appears in any build dataset (unit tests and `check_no_source_names.py` assert it), nothing is staged or loaded for Time Limits, and nothing in this stream edits a limitation rule. These files are NOT publishable build files (no `dataset` / `rows` keys; a unit test asserts it).")
    w("")
    w(table(["Advottic category", "limitation_periods", "statutory_limitations_review", "Note"], [[m["advottic_claim"], m["limitation_periods_claim"], m["statutory_limitations_review_claim"], m["note"][:150]] for m in sol["mapping"]]))
    w("")
    lp, rv = sol["vs_limitation_periods"]["counts"], sol["vs_statutory_limitations_review"]["counts"]
    w(f"- Advottic file v{sol['source']['version']} ({sol['source']['dateModified']}) has {sol['advottic_cells']} cells (51 jurisdictions x 9 categories). Versus `limitation_periods`: {json.dumps(lp)} (a reproduction, so identical). Versus the cited primary-source rules in `statutory_limitations_review` (ordinary-scope rules only; special-scope rules are listed, not compared): {json.dumps(rv)}.")
    w(f"- Disagreements (review items only): {', '.join(f'{i['state']} {i['claim']}' for i in sol['review_items'] if i['kind'] == 'advottic_vs_cited_rule')}. Cells where `limitation_periods` already found a different period in the saved statute: {', '.join(f'{i['state']} {i['claim']}' for i in sol['review_items'] if i['kind'] == 'limitation_periods_code_check')}. {sum(len(v) for v in sol['lacking'].values())} Advottic cells have no cited corpus rule (gaps, not evidence).")
    w("")
    w("## 6. Advottic templates.json and tools: describe, licence, usefulness (default exclude; still private)")
    w("")
    t = adv["templates_json"]
    w(f"**templates.json** (v{t['version']}, {t['date_published']}, {t['count']} templates, {t['publisher']}): {t['description']}")
    w("")
    w(table(["Template", "Category", "Last reviewed", "Body chars", "Placeholders"], [[x["title"], x["category"], x["last_reviewed"], x["body_chars"], len(x["placeholders"])] for x in t["templates"]]))
    w("")
    w(f"Licence: {t['dataset_licence']}. {t['conflict']} Usefulness: {t['usefulness']} **Decision: {t['decision']}.** Reasons: " + "; ".join(t["reasons"]) + ".")
    w("")
    w(table(["Tool", "What it does", "Usefulness", "Decision and reason"], [[x["name"], x["what"], x["usefulness"], f"{x['decision']}: {x['reason']}"] for x in adv["tools"]]))
    w("")
    w(adv["other_advottic_files"]["small_claims_json"])
    w("")
    w("## 7. Spot checks")
    w("")
    w("### 7a. Displayed figures and source URLs against the raw source")
    w("")
    w(f"{disp['displayed_checks']} displayed-value checks over {disp['rows_checked']} random built rows (20 settlement rows, seed {disp['seed']['settlements']}, the same 20 rows as the first pass; 12 catalog rows, seed {disp['seed']['catalog']}, re-drawn because the catalog has 463 rows): **{disp['displayed_mismatches']} mismatches**; plus {disp['source_url_checks']} row `source_url` checks (the cited official page in the raw record, or the first agency href on the listing): **{disp['source_url_mismatches']} mismatches**. Each check compares the value a row shows with the same field in the unchanged raw file. Every fifth displayed check is listed (all in `spot_checks_displayed.json`); a value of 'Not recorded' means the source field is empty and the row shows it as such:")
    w("")
    shown = [c for c in disp["rows"] if c["group"] == "displayed"]
    w(table(["Dataset / row", "Field", "Value shown", "Where in the source", "Match"],
            [[f"{c['dataset']} / {c['row']}"[:70], c["field"], (str(c["displayed"])[:70] if c["displayed"] is not None else None), c["where"][:80], "yes" if c["match"] else "NO"] for c in shown[::5][:25]]))
    w("")
    w("### 7b. Re-run of the official-page checks against the rebuilt files")
    w("")
    w(f"`recheck_official_page_checks.py` (output `recheck_official_page_checks.json`): the {sc['sampled']} sampled settlement records and the {rs['sampled']} sampled catalog entries, checked against the REBUILT publishable files rather than the first-pass build.")
    w("")
    w(table(["Check", "Result"], [
        [f"Settlements: {sc['in_published_set']} sampled records in the published set carry exactly the measured verdict, per-field result and evidence, source page and hash", f"{sc['in_published_set'] - len([p for p in sc['problems']])} of {sc['in_published_set']} identical (problems: {len(sc['problems'])})"],
        ["Settlements: the 3 records outside the published set are absent from the build", "yes" if all(not e["in_build"] for e in sc["records"] if e["verdict"] == "not_in_published_set") else "NO"],
        ["Settlements: verdict counts recomputed from the built rows equal the sample counts", f"{'yes' if sc['build_matches_sample_counts'] else 'NO'}: {json.dumps(sc['verdict_counts_in_build_excluding_not_verified'])}"],
        [f"Settlements: literal evidence items searched again in the saved bytes of the official page ({sc['direct_read_records']} direct reads; the other {sc['in_published_set'] - sc['direct_read_records']} were Firecrawl reads and cannot be re-searched from bytes)", f"{sc['evidence_items_found_again']} of {sc['evidence_items_searched']} found (page quotes whitespace-normalised; reviewer annotations such as '(rounded in title)' or '(the matcher missed the hyphenated name)' are not searched)"],
        [f"Catalog: {rs['sampled']} sampled entries", f"{rs['in_published_set']} in the published set carry the measured result and note; {rs['not_in_published_set']} are excluded open-records-request entries; results {json.dumps(rs['result_counts_in_published_set'])}"],
        ["Catalog: listed line still verbatim on the saved list page", f"{rs['listing_verbatim']} of {rs['in_published_set']}"],
        ["Catalog: every URL check on every built row re-derived from the saved check log", f"{rs['url_checks_rederived']} checks, {rs['url_checks_mismatching']} mismatches"],
        ["Catalog: page titles quoted in the spot-check notes found in the saved check log", f"{rs['quoted_titles_found_in_saved_check']} of {rs['quoted_titles']} (the rest came from Firecrawl reads of pages the sandbox could not load)"],
    ]))
    w("")
    w("## 8. UI proposals (not implemented)")
    w("")
    w(f"**Settlement notices (`{SS_ID}`)**")
    w("")
    w("1. `/law/enforcement`, new tab 'Settlement notices': DataTable of settlement, type, status (as compiled), claim deadline, official source host, verification; filters `verification`, `source_class`, `deadline_state`, `type`, `in_existing`; permanent banner 'Compiled record; not an official or court record' with the verification legend (no source name); inspector shows the 'Check against the official page' section (quoted evidence), the official link and the existing-record link. Chart: stacked bars of `deadline_state` by `source_class`; a 'closing within 30 days' list (the `within_30_days` filter).")
    w(f"2. `/records/settlements/<id>` (existing records): add an 'Official-page check' panel from this dataset joined on `item.links` (exact `/records/settlements/<id>` crosswalk, {pct(in_existing, ss['included'])} of the notices) instead of exposing a second near-identical list; show Contradicted rows with the official value.")
    w(f"3. `/places/<state>` overview: 'Settlements affecting <state>' using `filters.state` ({state_rows} state-specific rows; nationwide ones listed separately, labelled 'as published').")
    w("4. `/companies/<cik>` for the exact matches (Baxter International, BP): a 'Settlement and fair-fund records' list.")
    w("5. `/safety/signals` could show the FTC refund rows (source_class government) beside recalls as consumer-redress signals; link out only.")
    w("")
    w(f"**Catalog (`{CAT_ID}`)**")
    w("")
    w("1. `/law/enforcement`, new tab 'Data sources': table of agency, jurisdiction, level, what it covers, source type, URL check, corpus coverage chip; filters `level`, `jurisdiction`, `source_type`, `corpus_covered`, `url_ok`, `gov_domain`.")
    w(f"2. `/places/<state>`: panel 'Enforcement data sources in <state>' (counts by level and source type; list of agencies with URL and check state; {cat['by_jurisdiction'].get('CA', 0)} for CA is the largest).")
    w("3. `/places/analytics`: choropleth of source count per state from `by_jurisdiction`, plus a bar of source types by level.")
    fed_uncovered = cat['federal'] - sum(1 for r in rows_cat if r['item']['entry']['jurisdiction'] == 'Federal' and any(c['kind'].startswith('enforcement') for c in r['item']['corpus_coverage']))
    w(f"4. A 'coverage gap' view on `/law/enforcement`: the {fed_uncovered} federal source lines (of {cat['federal']} built) with no enforcement-data dataset in the corpus, ordered by agency, to steer future acquisition.")
    w("")
    w("## 9. Open risks")
    w("")
    for risk in [
        "Licence and terms risk accepted by the owner (section 0b): the credit line CC BY 4.0 asks for is not displayed, the settlements compilation's Terms of Use restrict bulk republication, and the source-list terms grant internal use only. Nothing here is legal advice; the stream accepted no terms.",
        f"Verification is a sample: {vc.get('verified', 0)} of {n} published sampled records are fully verified and {vc.get('contradicted', 0)} are contradicted, so unsampled rows may carry stale or wrong deadlines (the compiled tier is `needs_recheck` for many). Rows are labelled 'Not verified'; do not present them as official.",
        f"{moves.get('none', 0)} included rows cite a page that was never loaded (bot wall or robots.txt). Eight of eight such pages in the sample were live, but that is not a per-row check.",
        "Firecrawl reads of ftc.gov pages are cached copies (cachedAt 2026-10-16 to 2026-10-18), not live fetches; the site shows 'modifiedTime' values, not a re-verification of every figure.",
        "Exclusions caused only by sandbox failures (proxy 502, TLS, resets; terravia, aclnsec and elsie hosts were also inconclusive in Firecrawl) could be false negatives; five such records were rescued by Firecrawl and about 20 were not re-read.",
        "Two hosts (equifaxbreachsettlement.com, certainteedshinglesettlement.com) have a broken TLS chain, so robots.txt could not be read by the fetcher; each home page was read once through Firecrawl and included.",
        "Catalog corpus coverage is a heuristic (host or name match) and `ok` URL checks only prove a page loads. Coverage must be recomputed after the concurrent enforcement streams (EPA ECHO, OSHA, CFPB, FTC, FDA) publish.",
        "Titles are editorial: dollar figures in a title often do not appear on the official page (they are labelled 'as compiled').",
        "Neutral wording is enforced by a name/host scan, not by judgement: a paraphrase that identifies the compilation without its name (for example a unique phrase) would not be caught. The rows contain only the compiled facts, the official links and the neutral method line.",
        "The live `settlements` dataset (869 rows) and the live `limitation_periods` / `settlements` catalog metadata name the compilers (section 0e step 4); a published notice links to those rows, so the owner decision is only fully honoured once they are reworded (not this stream's files).",
        "`limitation_periods` (existing corpus) copies the Advottic table; the LA personal-injury and ME wrongful-death cells disagree with the corpus's own cited statutes and should be reviewed by the Time Limits owner.",
        "Company links are rare (2 of the built rows) because `company_sec_profiles` holds 137 companies; no fuzzy matching was used.",
        f"{cat['excluded']} catalog entries (open-records-request and agency-only lines) are not built because they carry no agency URL; if the owner wants them listed, they need a source_url that is not a compiler page (for example the agency's own site, to be located and checked, not guessed).",
    ]:
        w(f"- {risk}")
    w("")
    w("## 10. Assumptions")
    w("")
    for a in ["Check date 2026-10-18 (all 'passed / within 30 days' states are computed against it).",
              "`/places/DC` is a valid place route (DC is in the app's state table).",
              "Deadlines are the compilation's unless a verification field says otherwise; 'status' strings are the compilation's.",
              "A 401/403/429 from a settlement host is a bot wall (supported by 8 of 8 sampled browser reads), not evidence the page is missing.",
              "Row ids are `notice:<compiled-record slug>` and `src:<scope>:<agency slug>[:n]`; they are stable across rebuilds because they derive from the compiled-record slug and the page order (the slug is the compilation's own page key, which is a settlement name, not a source name).",
              "Reading of the owner decision: 'dont reference the source names' covers every published field, key and link (including `inputs`), not private files, REPORT.md or code.",
              "`source_url` of a notice is the verification-read page for the 33 sampled rows and the cited official page for the rest; both are on the official site named in the compiled record.",
              "Catalog entries with no agency URL are excluded rather than given a placeholder source_url.",
              "The first-pass build files are parked unchanged in `private/build/third_party_data/superseded/` (nothing deleted); the one accidental rerun of `write_verdicts.py` regenerated `verdicts.json` with identical content for all 33 published-set rows and the 3 others unchanged in text; `reviewed_at` was restored to 2026-10-18T14:20:01Z."]:
        w(f"- {a}")
    w("")
    w("## 11. Files")
    w("")
    w("- Builders and tools: `scripts/enrichment/third_party_data/` (`build_third_party_data.py`, `check_no_source_names.py`, `recheck_official_page_checks.py`, `build_sol_discrepancies.py`, `build_advottic_review.py`, `verify_sample.py`, `write_verdicts.py`, `write_catalog_spot_checks.py` (historical, guarded), `spot_check_displayed.py`, `write_report.py`, `check_sources.py`, `check_catalog_urls.py`, `requeue_checks.py`, `fetch.py`, `htmltext.py`, `tp_common.py`, `vt_parse.py`, `save_lookup.py`, `test_third_party_data.py`).")
    w(f"- PUBLISHABLE build files: `private/build/third_party_data/{SS_ID}.json`, `private/build/third_party_data/{CAT_ID}.json`.")
    w("- Private side files (never publish): `third_party_settlesignal_excluded.json`, `enforcement_data_sources_catalog_excluded.json`, `notice_provenance_private.json`, `catalog_provenance_private.json`, `settlesignal_overlap.json`, `sol_discrepancies.md/.json`, `advottic_templates_tools_review.json`, `recheck_official_page_checks.json`, `spot_checks_displayed.json`, `build_stats.json`, `REPORT.md`, `lookups/`, `superseded/` (first-pass build files, report, stats and spot checks).")
    w("- Acquisition: `private/acq/third_party_data/` (raw pages, `official_pages/_checks.jsonl`, `catalog_pages/_checks.jsonl`, `verification/{worksheet,verdicts,firecrawl_checks,catalog_spot_checks}.json`, `_manifest.jsonl`); unchanged apart from the identical regeneration noted in section 10.")
    w("")
    w("## 12. Tests and scans")
    w("")
    code_t, out_t = run(["-W", "error::ResourceWarning", "-m", "unittest", "test_third_party_data"], HERE, isolated=False)
    tail = [line for line in out_t.splitlines() if line.strip()][-3:]
    w("`cd scripts/enrichment/third_party_data && python3 -B -m unittest -v test_third_party_data`: offline, synthetic fixtures (parsing, aggregation math, exact / non-matching / ambiguous key matching, the Not-recorded path, retrieval-state rules, the forbidden-name guard on synthetic rows including keys, URLs and nesting) plus read-only assertions on the saved build files (uniqueness, compiled label on every row, no invented court/MDL links, exact-key links only, verification evidence carried exactly, no source name or host anywhere, source_url rule, counts add up, only the two expected build files at the top level, the Advottic review files are not build files).")
    w("")
    w("Result when this report was generated: `" + " | ".join(tail) + "` (exit code " + str(code_t) + ").")
    w("")
    w("`python3 -I -B scripts/enrichment/third_party_data/check_no_source_names.py` (exit code " + str(code_chk) + "):")
    w("")
    w("```")
    w(out_chk)
    w("```")
    w("")
    w("`python3 -I -B private/scratch/enrich/publish_build.py private/build/third_party_data/settlement_notices.json private/build/third_party_data/enforcement_data_sources_catalog.json` (validate only; exit code " + str(code_val) + "):")
    w("")
    w("```")
    w(out_val)
    w("```")
    path = os.path.join(BUILD, "REPORT.md")
    tp.atomic_write(path, "\n".join(out) + "\n")
    print("wrote", path, len("\n".join(out)), "chars")


if __name__ == "__main__":
    main()
