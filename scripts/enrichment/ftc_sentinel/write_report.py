"""Compose private/build/ftc_sentinel/REPORT.md from the build files, build_log.json, spot_checks.json and the manifest.

Every figure in the report is read from those files. The only typed-in text is (a) prose, (b) quotations from the captured
FTC press releases (private/acq/ftc_sentinel/firecrawl/press_*_databook.json) used for the cross-check table, and (c) the console
results of the independent verifier's scripts in VERIFIER_RUNS, which were copied by hand from the runs made after the final rebuild.

Usage: python3 -I -B scripts/enrichment/ftc_sentinel/write_report.py
"""
import collections
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ftc_common as C  # noqa: E402

VERIFIER_RUNS = [
    ("vf_dnc.py", "table checks 1540, mismatches 0 (5 fiscal years x 2 tables x 52 rows read from the PDFs against the build); 20 build cells are null: the DC and PR rank cells of both tables in 5 years, where the PDFs print no rank"),
    ("vf_dnc2.py", "analytics checks 1076, mismatches 0, derivable-from-the-PDFs-but-absent 0; state-page checks (Firecrawl state pages against the build) TOTAL 2106, mismatches 0; unparsed or unknown pages 0"),
    ("vf_display.py", "display checks 4564, mismatches 0"),
    ("vf_cells.py", "cell and value checks 1090, mismatches 0"),
    ("vf_refunds.py", "checks 228, differences 3, all one explained cause (see below)"),
    ("vf_refstates.py", "checks 630, differences 1, explained (see below); printed Total Sent against the build's parts: 2022 equal, 2023 +7, 2024 -3, as recorded in the build"),
    ("vf_prog1.py", "checks 362, differences 2, one explained cause (see below)"),
    ("vf_states.py", "TOTAL checks 4160, mismatches 0 (every published state-ranking and Appendix C figure, 416 rows)"),
    ("vf_states2.py", "analytics checks 4888, mismatches 0"),
    ("vf_statepages.py", "state-page checks 3684, mismatches 0 (top-ten category and identity theft type names and shares, printed totals, median loss and ranks of 416 state pages); the 8 state-years the verifier reports as unreadable are the 8 the build withheld"),
    ("vf_national.py", "checks 793, failed 3, one explained cause (see below)"),
    ("vf_national2.py", "history and type table checks 727, mismatches 0"),
    ("vf_national3.py", "subtypes 238, military 93, contact shares 58: checks 389, failed 0"),
    ("vf_integrity.py", "total rows 2991 (all verifier-checked builds), problems 0"),
    ("vf_manifest.py", "ftc manifest entries 53, problems 0"),
    ("vf_xmatch.py", "distinct case names 172, build matched 26, matched pairs whose normalised names differ: none; rows of matched names lacking the program link: 0; rows of unmatched names still carrying a program link: 0; unmatched names that normalise to a program title: MyScore LLC, Ring LLC, Zurixx LLC, Next-Gen, Inc., I Works, Inc. (left unlinked by rule)"),
]

PRESS = [
    (2024, "consumers reported losing more than $12.5 billion to fraud in 2024, a 25% increase over the prior year"),
    (2024, "27% of people who reported a fraud said they lost money in 2023, 38% in 2024"),
    (2024, "investment scams $5.7 billion, a 24% increase over 2023; imposter scams $2.95 billion"),
    (2023, "more than $10 billion lost to fraud in 2023, a 14% increase over 2022"),
    (2023, "investment scams more than $4.6 billion, a 21% increase over 2022; imposter scams nearly $2.7 billion"),
    (2022, "nearly $8.8 billion lost to fraud in 2022, an increase of more than 30 percent over the previous year"),
    (2022, "investment scams more than $3.8 billion (more than doubles 2021); imposter scams $2.6 billion, up from $2.4 billion in 2021"),
]


def load(name):
    with open(os.path.join(C.BUILD, name), encoding="utf-8") as handle:
        return json.load(handle)


def table(header, rows):
    out = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    out += ["| " + " | ".join(str(c).replace("|", "/").replace("\n", " ") for c in r) + " |" for r in rows]
    return "\n".join(out)


def money(n):
    return "${:,}".format(int(n))


def pct(v):
    return "%+.1f%%" % v if isinstance(v, (int, float)) else str(v)


def main():
    names = ("ftc_sentinel_states", "ftc_sentinel_national", "ftc_refunds", "ftc_refund_programs", "ftc_dnc_states")
    builds = {n: load(f"{n}.json") for n in names}
    log = load("build_log.json")
    spot = load("spot_checks.json")
    manifest = C.load_manifest()
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    rows = {n: b["rows"] for n, b in builds.items()}
    refunds = rows["ftc_refunds"]
    case_rows = [r for r in refunds if r["filters"]["kind"] == ["case"]]
    state_ref = [r for r in refunds if r["filters"]["kind"] == ["state"]]
    by_year = collections.Counter(r["item"]["cells"]["report_year"] for r in case_rows)
    by_stage = collections.Counter((r["item"]["cells"]["report_year"], r["filters"]["stage"][0]) for r in case_rows)

    def place_links(rs):
        return sum(1 for r in rs if any(link["url"].startswith("/places/") for link in r["item"]["links"]))

    def pr_rows(rs):
        return sum(1 for r in rs if r["state"] == "PR")

    cross = log["refund_cross_references"]
    prog = cross["refund_program_pages"]
    comp = cross["company_profiles"]
    n_case_names = cross["distinct_case_names"]
    linked_case_rows = sum(1 for r in case_rows if any(link["url"].startswith("https://www.ftc.gov/enforcement/refunds/") for link in r["item"]["links"]))
    sibling_rows = sum(1 for r in case_rows if any(link["url"].startswith("/records/ftc_refunds/") for link in r["item"]["links"]))
    xc = log["dnc_crosscheck_vs_pdf"]
    withheld = {y: d["state_pages_withheld"] for y, d in log["databooks"].items() if d["state_pages_withheld"]}
    n_withheld = sum(len(v) for v in withheld.values())
    nat = {r["id"]: r["item"] for r in rows["ftc_sentinel_national"]}
    series = nat["US-series"]
    ana = series["analytics"]
    n_probe = sum(1 for e in manifest.values() if "/_probe/" in e["path"])
    n_fc = sum(1 for e in manifest.values() if (e.get("method") or "").startswith("Firecrawl MCP firecrawl_scrape"))
    n_read = sum(1 for e in manifest.values() if "/verify/" in e["path"])
    n_pdf = sum(1 for e in manifest.values() if e["path"].endswith(".pdf"))
    lines = []
    w = lines.append

    w("# FTC Consumer Sentinel, refunds and Do Not Call: build report (`ftc_sentinel`)")
    w("")
    w(f"Generated {now} by `scripts/enrichment/ftc_sentinel/write_report.py` from the build files in this folder. Nothing was published and nothing was written to Supabase. Every build file passes `python3 -I -B private/scratch/enrich/publish_build.py <file>` (validate only).")
    w("")
    w("## 1. Datasets")
    w("")
    w(table(["Dataset id", "Label", "Rows", "Row keys / years", "Build file"], [
        ["ftc_sentinel_states", builds["ftc_sentinel_states"]["label"], len(rows["ftc_sentinel_states"]), "`<USPS>-<year>`: 52 jurisdictions (50 states, DC, PR) x Data Book years 2017-2024; `state` = USPS code", "ftc_sentinel_states.json"],
        ["ftc_sentinel_national", builds["ftc_sentinel_national"]["label"], len(rows["ftc_sentinel_national"]), "`US-<year>` for 2017-2024 and `US-series` (report counts by type 2001-2024, fraud-loss series 2017-2024, growth analytics)", "ftc_sentinel_national.json"],
        ["ftc_refunds", builds["ftc_refunds"]["label"], len(refunds), f"`<year>-<stage>-<case>`: {len(case_rows)} case rows (2022: {by_year['2022']}, 2023: {by_year['2023']}, 2024: {by_year['2024']}); `<year>-state-<USPS>`: {len(state_ref)}; `<year>-summary`: {len(refunds) - len(case_rows) - len(state_ref)} (2018-2024)", "ftc_refunds.json"],
        ["ftc_refund_programs", builds["ftc_refund_programs"]["label"], len(rows["ftc_refund_programs"]), "page slug of each active refund program on the ftc.gov list at retrieval", "ftc_refund_programs.json"],
        ["ftc_dnc_states", builds["ftc_dnc_states"]["label"], len(rows["ftc_dnc_states"]), "`<USPS>-FY<year>`: 52 jurisdictions x fiscal years 2021-2025", "ftc_dnc_states.json"],
    ]))
    w("")
    w("All files are in `private/build/ftc_sentinel/`. `ftc_refund_programs` and `ftc_dnc_states` are the extra consumer-protection datasets (active refund programs with hotlines and administrators; Do Not Call complaints and registrations by state).")
    w("")
    w("Case-level refund tables exist only in the 2022, 2023 and 2024 report PDFs, so the case rows and the per-state mailed rows cover those three years; the share-of-funds summaries (2018-2024) come from the snapshot tables of the same three reports. The 2020 and 2021 reports and earlier were not loaded.")
    w("")
    w("## 2. Sources, retrieval and terms")
    w("")
    w("Starting page: https://www.ftc.gov/news-events/data-visualizations (Consumer Sentinel Network, refunds and Do Not Call dashboards). The dashboards are Tableau Public workbooks. The Tableau Public workbook JSON and view HTML answered (kept under `private/acq/ftc_sentinel/_probe/`), but the CSV export endpoints answered 404 and the vizql session API was not scraped. Figures therefore come from the Data Book and report PDFs that the same FTC pages publish; each row's `source_url` is the PDF or page its figures were read from.")
    w("")
    w("Byte provenance, in order of authority:")
    w("")
    w("1. **Official PDFs** (`private/acq/ftc_sentinel/pdf/`): 8 Consumer Sentinel Data Books (2017-2024), 5 Do Not Call Data Books (FY2021-FY2025), 3 refund reports (2022-2024). ftc.gov answers this sandbox with an Akamai bot wall, so these are the independent verifier's downloads of 2026-10-18, copied byte-identical; `import_official_pdfs.py` refuses a copy whose SHA-256 differs from the verifier's `_download_log.json`. The Do Not Call ranking tables are read from these PDFs' word layer; all other datasets are spot-checked and cross-checked against them (sections 6 and 7).")
    w("2. **Firecrawl captures** (`private/acq/ftc_sentinel/firecrawl/`): the Firecrawl MCP `firecrawl_scrape` tool-result JSON of the same PDFs and of the HTML pages (refunds data page, refund programs list, three Data Book press releases), stored unchanged. This is a text extraction (letters spaced apart, digits lost in some cells, rows dropped), so every figure passes the validation rules in section 4. The contract names HTML pages for the Firecrawl route; the PDFs were also read through it because the sandbox cannot fetch ftc.gov directly (a deviation, flagged here). No login, CAPTCHA or paywall was involved.")
    w("3. **Independent text readings** (`private/acq/ftc_sentinel/verify/read01-read11`): Tavily `tavily_extract` readings of the same official PDFs, transcribed by the agent. Used only as cross-checks, never as the source of a published figure.")
    w("")
    w("Terms: " + builds["ftc_sentinel_states"]["summary"]["terms"] + " The excerpt is stored as `private/acq/ftc_sentinel/firecrawl/ftc_website_policy_copyright_excerpt.txt`. ftc.gov's robots.txt could not be read from this sandbox (the bot wall returns an error page); the Tableau Public robots.txt was fetched (`_probe/tableau_robots.txt`).")
    w("")
    w("Hash labels (the first build mixed them): in every `summary.sources[*]` and `item.provenance`, **`capture_sha256` is the hash of the Firecrawl tool-result JSON (a text extraction)** and **`official_pdf_sha256` is the hash of the official PDF bytes as served by ftc.gov**. Each record carries a note saying which is which, and `inputs` lists both files.")
    w("")
    src_rows = []
    for _, e in sorted(manifest.items(), key=lambda kv: kv[1]["url"]):
        if e["path"].endswith(".pdf"):
            src_rows.append([e["url"].replace("https://www.ftc.gov/system/files/", ".../"), e["sha256"], f"{e['bytes']:,}", e["retrieved_at"]])
    w(table(["Official PDF", "SHA-256 of the PDF", "Bytes", "Retrieved (verifier)"], src_rows))
    w("")
    w(f"`private/acq/ftc_sentinel/_manifest.jsonl` has {len(manifest)} entries ({n_probe} Tableau probes, {n_fc} Firecrawl captures, the terms excerpt, {n_read} independent readings, {n_pdf} official PDFs), each with url, path, sha256, bytes, retrieved_at, status and method.")
    w("")
    w("## 3. Coverage and counts")
    w("")
    w(table(["Dataset", "Entities", "Years", "Rows"], [
        ["ftc_sentinel_states", "50 states + DC + PR", "2017-2024", len(rows["ftc_sentinel_states"])],
        ["ftc_sentinel_national", "United States", "2017-2024; report-count history 2001-2024", len(rows["ftc_sentinel_national"])],
        ["ftc_refunds", f"{len(case_rows)} case rows ({n_case_names} distinct case names); 52 state/territory rows per year ({len(state_ref)} rows)", "2022-2024 (cases, states); 2018-2024 (summaries)", len(refunds)],
        ["ftc_refund_programs", f"{len(rows['ftc_refund_programs'])} active programs", "snapshot at retrieval", len(rows["ftc_refund_programs"])],
        ["ftc_dnc_states", "50 states + DC + PR", "FY2021-FY2025", len(rows["ftc_dnc_states"])],
    ]))
    w("")
    w(table(["Refund report", "First distribution", "Additional distribution", "Closed"], [[y, by_stage[(y, "first_distribution")], by_stage[(y, "additional_distribution")], by_stage[(y, "closed")]] for y in ("2022", "2023", "2024")]))
    w("")
    n_cat = sum(1 for r in rows["ftc_sentinel_states"] if r["item"]["top_categories"])
    n_idt = sum(1 for r in rows["ftc_sentinel_states"] if r["item"]["identity_theft_types"])
    w(f"State top-ten category tables are recorded for {n_cat} of {len(rows['ftc_sentinel_states'])} state-years and identity theft type tables for {n_idt}; the other state-years are 'Not recorded' with the reason on the row ({n_withheld} state-years withheld: " + "; ".join(f"{y}: {', '.join(sorted(v))}" for y, v in sorted(withheld.items())) + ").")
    w("")
    w("Do Not Call cells recorded, per fiscal year (of 52 jurisdictions; the FTC ranks 50, DC and PR are listed but unranked):")
    w("")
    dnc_cov = builds["ftc_dnc_states"]["summary"]["coverage"]
    w(table(["FY", "complaints", "per 100K", "rank", "registrations", "per 100K", "rank"], [[fy, c["complaints_count"], c["complaints_per100k"], c["complaints_rank"], c["registrations_count"], c["registrations_per100k"], c["registrations_rank"]] for fy, c in dnc_cov.items()]))
    w("")
    w("## 4. Method and validation")
    w("")
    w("Modules: `ftc_parse.py` (numbers, state names tolerant of spaced letters, tables), `ftc_states.py`, `ftc_national.py`, `ftc_dnc_pdf.py` and `ftc_dnc.py`, `ftc_refunds.py`, `ftc_supplement.py`, `ftc_common.py`; builder `build_ftc_sentinel.py`. A figure that fails a rule is **Not recorded** (never repaired, rounded or imputed) and the reason is stored on the row and in `build_log.json`.")
    w("")
    for n in ("ftc_sentinel_states", "ftc_refunds", "ftc_dnc_states"):
        w(f"- **{n}**: {builds[n]['summary']['validation']}")
    w("- **ftc_sentinel_national**: history tables must satisfy total <= sum of types <= 1.03 x total (some subcategories count as both fraud and other); the fraud summary must agree with the by-type table; category counts must lie between 70% and 100% of the total (ranked categories leave out 'Other Misc.').")
    d22 = log["refund_tables"]["2022"]["additional_distribution"]["total_differences"][0]
    sv = {y: next(r for r in refunds if r["id"] == f"{y}-summary")["item"]["values"] for y in (2022, 2023, 2024)}
    w(f"- **Printed totals that disagree with their own parts are shown, not hidden.** Case tables: 2022 additional distributions (consumers in the most recent distribution: rows {d22['rows_sum']:,}, printed {d22['printed_total']:,}, difference 43,392 = BlueHippo 2,222 + SLAC 6,079 + Mile High Madison 35,091; cashed rows differ by 1) and 2023 closed cases (cashed column rows 1,864,786, printed 1,840,395, difference 24,391 = LeanSpa's cashed count); every row of an affected table carries a note. State tables ('Total Sent' against states + military bases + Virgin Islands where listed + electronic and international payments): 2022 {money(sv[2022]['parts_sum_usd'])} against printed {money(sv[2022]['total_sent_usd'])}, equal only because the table's Virgin Islands row ($1,833, printed in 2022 only) is counted; 2023 parts {money(sv[2023]['parts_sum_usd'])} against printed {money(sv[2023]['total_sent_usd'])} (printed $7 higher); 2024 parts {money(sv[2024]['parts_sum_usd'])} against printed {money(sv[2024]['total_sent_usd'])} (printed $3 lower). The summary rows carry 'Printed total against the listed parts'.")
    w("- **Case names** are checked against the official PDF text (`pdftotext`); one extraction misreading was found and corrected (section 9, D4).")
    w("")
    w("### Analytics: formulas")
    w("")
    w(table(["Field", "Formula"], [
        ["`*_yoy_pct`", "(value in year t / value in year t-1 - 1) x 100 from the two editions' printed values; Not recorded when either is missing"],
        ["`*_rank_change`", "rank in t-1 minus rank in t; positive = moved toward rank 1 (more reports per capita); Not recorded for unranked DC and PR"],
        ["`total_loss_cagr_pct_since_2017`", "((loss in t / loss in 2017) ^ (1 / (t - 2017)) - 1) x 100"],
        ["`loss_share_of_state_sum_pct`", "state total loss / sum of the 52 jurisdictions' losses in the same edition x 100"],
        ["`avg_loss_per_fraud_report_usd`", "total loss / all fraud reports (including those with no loss)"],
        ["`total_loss_rank_derived`", "rank by total fraud loss among the 52 jurisdictions (derived, not published by the FTC)"],
        ["national report-count growth and CAGR", "both years from ONE edition's history table (the 2024 edition for 2001-2024)"],
        ["`total_loss_yoy_pct_cross_edition`", "each edition prints a loss for its own year only, so growth compares two editions' printed totals (different vintages)"],
        ["`fastest_rising_fraud_category_loss`", "among categories in the FTC top ten of both editions under exactly the same printed name: (loss later / loss earlier - 1) x 100, sorted descending; windows 2023-24, 2021-24, 2019-24; each lists the FTC definition notices for the window"],
        ["Do Not Call `complaints_yoy_pct`, `registrations_yoy_pct`, `*_rank_change`", "same formulas on fiscal years"],
        ["refund `share_of_listed_states_pct`, `yoy_pct`", "state dollars mailed / sum of the state table x 100; (mailed in year t / mailed in year t-1 - 1) x 100"],
    ]))
    w("")
    w("Per-100K figures are the FTC's own columns. The denominator is the FTC's stated Census estimate (Data Books, population year by edition: " + ", ".join(f"{y}: {d['population_basis_year']}" for y, d in log["databooks"].items()) + "; Do Not Call: " + ", ".join(f"FY{k}: {v}" for k, v in log["dnc_population_basis"].items()) + "). The population is not published by the FTC and is not reconstructed; implied population (count / per-100K) is used only as a validity check on Do Not Call cells.")
    w("")
    w("### Analytics: headline results (read from the build files)")
    w("")
    nat_rows = []
    for y in range(2017, 2025):
        it = nat[f"US-{y}"]
        c = it["cells"]
        nat_rows.append([y, c["total_reports"], c["fraud_reports"], c["identity_theft_reports"], c["total_loss"], c["median_loss"], c["pct_reporting_loss"], pct(it["analytics"]["total_loss_yoy_pct_cross_edition"]) if y > 2017 else "n/a"])
    w(table(["Year (own edition)", "All reports", "Fraud", "Identity theft", "Fraud loss", "Median loss", "Share with loss", "Loss YoY (cross-edition)"], nat_rows))
    w("")
    w(f"- All-report count CAGR 2019-2024 {pct(ana['total_reports_cagr_pct_2019_to_2024'])} a year; 2001-2024 {pct(ana['total_reports_cagr_pct_2001_to_2024'])} a year (2024 edition history table).")
    w(f"- Fraud loss CAGR 2017-2024 {pct(ana['fraud_loss_cagr_pct_2017_to_2024'])} a year ({money(series['fraud_loss_by_year']['2017']['total_loss_usd'])} to {money(series['fraud_loss_by_year']['2024']['total_loss_usd'])}); median loss change 2017-2024 {pct(ana['median_loss_change_2017_to_2024_pct'])}. Cross-edition: see the vintage caveat below.")
    for window in ("2023_to_2024", "2021_to_2024"):
        rising = ana["fastest_rising_fraud_category_loss"][window]
        top = rising["rising"][:5]
        w(f"- Fastest-rising fraud categories by reported loss, {window.replace('_to_', ' to ')} (same printed name in both top tens): " + "; ".join(f"{t['name']} {pct(t['change_pct'])} ({money(t['from'])} to {money(t['to'])})" for t in top) + ". Definition notices attached: " + " | ".join(rising["definition_notices"]) + " A jump here can be the FTC's re-sorting of categories, not consumer experience.")
    sr = [r for r in rows["ftc_sentinel_states"] if r["id"].endswith("-2024")]
    movers = sorted(((r["item"]["analytics"].get("fraud_other_rank_change"), r["item"]["cells"]["state"]) for r in sr if isinstance(r["item"]["analytics"].get("fraud_other_rank_change"), int)), key=lambda t: (-t[0], t[1]))
    w("- State rank changes in reports per 100K, 2023 edition to 2024 edition (positive = toward rank 1): up " + ", ".join(f"{n} {d:+d}" for d, n in movers[:5]) + "; down " + ", ".join(f"{n} {d:+d}" for d, n in movers[-5:][::-1]) + ".")
    cagr = sorted(((r["item"]["analytics"].get("total_loss_cagr_pct_since_2017"), r["item"]["cells"]["state"]) for r in sr if isinstance(r["item"]["analytics"].get("total_loss_cagr_pct_since_2017"), (int, float))), key=lambda t: -t[0])
    w("- Highest state fraud-loss CAGR 2017-2024: " + ", ".join(f"{n} {pct(v)}" for v, n in cagr[:5]) + ".")
    dr = [r for r in rows["ftc_dnc_states"] if r["id"].endswith("FY2025")]
    dm = sorted(((r["item"]["analytics"].get("complaints_rank_change"), r["item"]["cells"]["state"]) for r in dr if isinstance(r["item"]["analytics"].get("complaints_rank_change"), int)), key=lambda t: (-t[0], t[1]))
    w("- Do Not Call, complaints per 100K rank change FY2024 to FY2025: up " + ", ".join(f"{n} {d:+d}" for d, n in dm[:5]) + "; down " + ", ".join(f"{n} {d:+d}" for d, n in dm[-5:][::-1]) + ".")
    w("")
    rev = log["national_revisions_as_printed_vs_latest_edition"]["2022"]["fraud"]
    w(f"**Vintage caveat for losses.** The FTC revises earlier years in later editions. Example, from `revision_vs_latest_edition`: 2022 fraud reports are {rev[0]:,} in the 2022 edition and {rev[1]:,} in the 2024 edition. Report-count growth therefore uses one edition's history table; loss growth uses each edition's own printed total and says so in the field name.")
    w("")
    w("### Cross-check of headline figures against the FTC press releases")
    w("")
    w("The three press releases captured with the Data Books (`firecrawl/press_2022_databook.json`, `press_2023_databook.json`, `press_2024_databook.json`) state headline figures. Compared with the build:")
    w("")
    inv = {}
    imp = {}
    for y in (2021, 2022, 2023, 2024):
        for c in nat[f"US-{y}"]["top_fraud_categories"]:
            if c["category"] == "Investment Related":
                inv[y] = c["total_loss_usd"]
            if c["category"] == "Imposter Scams":
                imp[y] = c["total_loss_usd"]
    loss = {y: nat[f"US-{y}"]["fraud_summary"]["total_loss_usd"] for y in range(2017, 2025)}
    pctloss = {y: nat[f"US-{y}"]["fraud_summary"]["pct_reporting_loss"] for y in range(2017, 2025)}
    yoy = ana["fraud_loss_yoy_pct"]
    press_rows = [
        [PRESS[0][0], PRESS[0][1], f"{money(loss[2024])}; {pct(yoy['2024'])} vs the 2023 edition", "agrees"],
        [PRESS[1][0], PRESS[1][1], f"{pctloss[2023]}% (2023 edition), {pctloss[2024]}% (2024 edition)", "agrees"],
        [PRESS[2][0], PRESS[2][1], f"investment {money(inv[2024])} ({pct(100 * (inv[2024] / inv[2023] - 1))} vs {money(inv[2023])}); imposter {money(imp[2024])}", "amounts agree; growth differs (build +22.7% from the printed millions, press 24%, apparently from the rounded $4.6 billion base); not reconciled"],
        [PRESS[3][0], PRESS[3][1], f"{money(loss[2023])}; {pct(yoy['2023'])}", "agrees"],
        [PRESS[4][0], PRESS[4][1], f"investment {money(inv[2023])} ({pct(100 * (inv[2023] / inv[2022] - 1))}); imposter {money(imp[2023])}", "agrees"],
        [PRESS[5][0], PRESS[5][1], f"{money(loss[2022])}; {pct(yoy['2022'])} vs the 2021 edition's {money(loss[2021])}", "amount agrees; growth DIFFERS: the 2022 Data Book text says 'an increase of nearly $2.6 billion over 2021', implying a restated 2021 base near $6.2 billion rather than the $5.89 billion printed in the 2021 edition; the build keeps both editions' printed totals and does not restate"],
        [PRESS[6][0], PRESS[6][1], f"investment {money(inv[2022])} ({inv[2022] / inv[2021]:.2f} x the 2021 edition's {money(inv[2021])}); imposter {money(imp[2022])} (2021 edition: {money(imp[2021])})", "agrees to rounding; the press release's $2.4 billion 2021 imposter base differs from the 2021 edition's printed figure (restated base)"],
    ]
    w(table(["Edition", "Press release says", "Build says", "Result"], press_rows))
    w("")
    w("## 5. Cross-reference match rates")
    w("")
    w(table(["Link", "Rule", "Result"], [
        ["`/places/<USPS>`", "exact USPS code, only for jurisdictions that `src/lib/corpus/geo.ts` resolves (50 states + DC; read at build time)", f"states {place_links(rows['ftc_sentinel_states'])} of {len(rows['ftc_sentinel_states'])} rows; Do Not Call {place_links(rows['ftc_dnc_states'])} of {len(rows['ftc_dnc_states'])}; refund state rows {place_links(state_ref)} of {len(state_ref)}. Puerto Rico rows ({pr_rows(rows['ftc_sentinel_states'])} + {pr_rows(rows['ftc_dnc_states'])} + {pr_rows(state_ref)}) keep their figures but carry no /places link because the app cannot route /places/PR"],
        ["FTC refund program page", "case name equals the program title after lower-casing and dropping non-alphanumerics, with ONE trailing 'Refunds'/'Refund'/'Settlement' word removed from the program title only; unique targets only", f"{prog['matched']} of {n_case_names} distinct case names ({100 * prog['matched'] / n_case_names:.1f}%); {linked_case_rows} of {len(case_rows)} case rows; ambiguous {prog['ambiguous']}; unmatched {prog['unmatched']}"],
        ["`/companies/<CIK>`", "exact unique match of the case name to a `company_sec_profiles` title after the same normalisation, no suffix stripping", f"{comp['matched']} of {n_case_names} (0.0%); ambiguous {comp['ambiguous']}; lookup of {comp['company_titles_in_lookup']} titles saved in `lookups/company_sec_profiles.json`"],
        ["`/records/ftc_refunds/<id>`", "identical published case name in another table or year", f"{sibling_rows} of {len(case_rows)} case rows link to a sibling row"],
    ]))
    w("")
    w("Five case names normalise to an existing program page only after a corporate-form word is ignored. Under the documented exact-name rule they are **left unlinked** (the corporate form is part of the published name): " + "; ".join(f"{m['case_name']} vs {m['program_title']}" for m in prog["near_misses_not_linked"]) + ". They are listed in `build_log.json` and in the dataset summary (`cross_references.refund_program_pages.near_misses_not_linked`).")
    w("")
    w("## 6. Spot checks against the official PDFs")
    w("")
    bl = spot["by_level"]
    w(f"`verify_ftc_sentinel.py` draws a seeded sample (seed 20261018) of displayed figures from all five datasets and requires each displayed string on the official PDF's own text row (pdfplumber words; independent of the Firecrawl captures and of the builder's parsers). Result: **{spot['checks']} checks, {spot['matches']} matches, {spot['mismatches']} mismatches**. {bl.get('line', 0)} checks matched on the same PDF row as the state or case label, {bl.get('wrapped-name', 0)} on the row where a long case name wraps onto the adjacent rows (all words of the name found within one row above or below), {bl.get('page', 0)} at page level only. The full list is `spot_checks.json`. A selection, one figure per record:")
    w("")
    picked = []
    per_dataset = collections.defaultdict(set)
    for c in spot["detail"]:
        if c["id"] in per_dataset[c["dataset"]] or len(per_dataset[c["dataset"]]) >= 10:
            continue
        per_dataset[c["dataset"]].add(c["id"])
        picked.append([c["dataset"], c["id"], c["field"], c["displayed"], c["pdf_page"], c["level"], (c["where"] or "")[:96], "yes" if c["match"] else "NO"])
    w(table(["Dataset", "Record", "Field", "Displayed", "PDF page", "Level", "Where on the PDF page (row text)", "Match"], picked))
    w("")
    w(f"Further independent checks of the Do Not Call tables: Tavily's separate extraction agrees with the PDF-derived values on {xc['tavily_text_vs_pdf']['agree']} cells and differs on {len(xc['tavily_text_vs_pdf']['differ'])}; the Firecrawl text agrees on {xc['firecrawl_text_vs_pdf']['agree']} cells, is missing {xc['firecrawl_text_vs_pdf']['missing_in_firecrawl']} and differs on {len(xc['firecrawl_text_vs_pdf']['differ'])}, all in FY2022 where the extraction dropped a leading digit (for example Delaware complaints per 100K: Firecrawl 537, PDF 1,537). The PDF values are published.")
    w("")
    w("## 7. Independent verifier scripts, re-run after the final rebuild")
    w("")
    w("The verifier's scripts (`private/scratch/enrich/verify_jpml_ftc/vf_*.py`, not edited) were run against the final build files:")
    w("")
    w(table(["Script", "Result"], [[a, b] for a, b in VERIFIER_RUNS]))
    w("")
    w("`vf_refunds.py` differences (3 lines, one cause): the 2023 closed-case row for **Position Gurus** is printed in the official PDF as `$1,588,708 $1,527,663 $49,670 $11,375 $0 $3,053 2,575 84.3%`, with a stray dollar sign in front of the consumers count `3,053` (pdftotext line 328 of the 2023 report). The verifier's PDF row pattern requires a plain integer there, so it counts 20 closed rows where the build has 21; the multiset of tuples differs by exactly this row and nothing else. The build keeps `3,053` as the count and records the note 'consumers_sent_payment printed with a dollar sign in the report' on the row. This is an explained difference, not a data difference. The id `2022-closed-genius` no longer exists (renamed, D4), so scripts that hard-code it, such as `vf_ref2.py`, report it missing.")
    w("")
    w("`vf_national.py` failures (3 lines, one cause): the 2017, 2018 and 2019 payment-method row 'Telephone Bill'. In those three PDFs the label and the count are printed with no gap, so the PDF word layer returns `Telephone Bill1,124 $1M` (2017, page 13), `Telephone Bill1,106 $5M` (2018, page 12) and `Telephone Bill956 $2M` (2019, page 12); the verifier's whole-token pattern cannot match `Bill1,124`. The build rows are Telephone Bill 1,124 reports and $1,000,000 (2017), 1,106 and $5,000,000 (2018), 956 and $2,000,000 (2019), which are exactly the printed figures. Explained difference, not a data difference.")
    w("")
    w("`vf_refstates.py` difference (1 line): '2022 summary military_bases_usd', verifier value None, build 114,493. In the 2022 report the label 'Military Bases' wraps over two rows with the amount between them (pdftotext lines 60-62: `Military` / `MT $1,568,766 ... $114,493` / `Bases`), so the verifier's one-row pattern finds no amount. The build value $114,493 is printed in the PDF. The same script's printed-total line for 2022 adds neither the military bases (the wrapped label again) nor the Virgin Islands row, which is why it prints a difference of 116,326 (= 114,493 + 1,833) where the build's parts equal the printed total.")
    w("")
    w("`vf_prog1.py` differences (2 lines, one cause): the Next-Gen Refunds row, whose contact cell is `1-833-721-2728 or +1-612-509-2644` then `Rust Consulting, Inc.`. The verifier classifies a line as a hotline only if it consists of digits and punctuation, so the line containing the word 'or' is taken as the administrator. The build keeps the two numbers as the hotline and Rust Consulting, Inc. as the administrator, as printed.")
    w("")
    w("## 8. Exclusions")
    w("")
    for t in [
        "Tableau dashboard downloads (the CSV export endpoints answered 404; the vizql session API was not scraped).",
        "Metropolitan-area tables (where an edition prints them) and the category-definition appendices of the Data Books: not stored as rows (the three FTC definition-change notices of 2020, 2023 and 2024 are encoded as notices on the category comparisons).",
        "County, topic and call-type charts of the Do Not Call state pages, and national Do Not Call yearly totals for FY2023-FY2025 (chart-only in the PDFs).",
        "Refund reports before 2022 (summary-only; not loaded). Case rows are therefore 2022-2024 only.",
        f"{len(rows['ftc_sentinel_states']) - n_cat} state-years of top-ten category tables and {len(rows['ftc_sentinel_states']) - n_idt} of identity theft type tables whose extraction was damaged (section 3); no other published figure is withheld: every Do Not Call cell the PDFs print is recorded.",
        "Imputed or estimated values: none. Unknowns are the string 'Not recorded' with a reason.",
    ]:
        w("- " + t)
    w("")
    w("## 9. Verifier findings fixed in this revision")
    w("")
    w(table(["Id", "Finding", "Fix"], [
        ["D2", "displayed percentage double-rounded (66.55% shown as 66.5%)", "percentages are shown verbatim as printed (`pct_cashed_printed`, and the printed spelling of the snapshot shares, for example 93.0%, 91%, 66.55%); the stored float is kept for arithmetic only"],
        ["D3", "rows linked to `/places/PR`, which the app cannot resolve", "`/places` links only for jurisdictions listed in `src/lib/corpus/geo.ts` (50 states + DC, read at build time); PR rows keep their figures without the link"],
        ["D4", "`2022-closed-genius` titled 'Genius'; the PDF prints 'Geniux'", "explicit correction `NAME_CORRECTIONS[(2022, 'closed', 'Genius')] = 'Geniux'` verified against the official PDF text; id and slug are now `2022-closed-geniux`; every case name is checked against the PDF text and the build fails on a name that is absent; the original reading is kept in `name_corrected_from`"],
        ["D5", "40 Do Not Call cells 'Not recorded' that the PDFs print", "ranking tables are read from the official PDF word layer (y_tolerance 0.3): all 52 jurisdictions in both tables of all five editions; every cell is recorded except the 20 DC and PR rank cells the FTC leaves blank; the 18 dependent YoY and rank-change values were recomputed; coverage statement updated"],
        ["(a)", "hashes pointed at the Firecrawl capture only", "`capture_sha256` and `official_pdf_sha256` side by side with notes saying which is which, in `summary.sources` and in every row's provenance"],
        ["(b)", "five refund names normalise to a program page but are unlinked", "kept unlinked under the documented exact-normalised-name rule; named in section 5"],
        ["E1 (found while re-running the verifier)", "the state-mailed tables' extra lines were recorded for 2023 only: the 2022 table's Virgin Islands row ($1,833) and the total, electronic and international amounts of 2022 and 2024 were missing, so those years' printed totals were never compared with their parts", "the parser now reads all three layouts (2022 split amounts row, 2023 one-cell label, 2024 bold text); every year's summary row records military bases, Virgin Islands (2022), international and electronic amounts, the printed total, the sum of the parts and a 'Printed total against the listed parts' note; two new parser unit tests and one build-file test; the spot-check script now also checks these figures against the PDFs (11 checks)"],
    ]))
    w("")
    w("## 10. Open risks")
    w("")
    for t in [
        "Data Book figures other than Do Not Call were read from the Firecrawl text extraction and checked against the PDFs by the sample in section 6 and by the verifier's full-table comparisons; a transposed digit outside the sample, the validation rules and the verifier's checks would not be caught by this build alone.",
        "The FTC revises history between editions (2022 fraud reports: 2,369,527 in the 2022 edition, 2,572,424 in the 2024 edition). Loss growth across editions mixes vintages and can differ from the FTC's own growth statements (2022: build +48.8%, press release 'more than 30 percent'; section 4).",
        "FTC-documented category changes in 2020, 2023 and 2024 make some category growth rates (for example Health Care +370.6% from 2023 to 2024) re-sorting rather than consumer experience; each window carries the notices.",
        "Per-100K ranks and changes mix Census vintages between editions (each row states the year).",
        "The FTC's printed Totals rows are internally inconsistent in three refund tables (section 4); rows are published as printed with the differences shown.",
        "Puerto Rico cannot be routed on `/places` until `geo.ts` includes it; its rows exist (`state = PR`).",
        "`ftc_refund_programs` is a snapshot of an active list (retrieved 2026-10-18); programs leave the list when they close. The 90 program pages themselves were not re-fetched for this report (`vf_links.py` was not run).",
        "ftc.gov is behind a bot wall: re-acquisition needs the verifier's download route or a Firecrawl scrape. The Tavily readings are hand transcriptions; they agree with the PDF on all 233 Do Not Call cells compared (0 differences) and were not compared programmatically elsewhere.",
        "0 of 172 refund case names link to a company profile: the lookup covers 137 `company_sec_profiles` titles and none matches exactly.",
    ]:
        w("- " + t)
    w("")
    w("## 11. UI proposals (not implemented)")
    w("")
    w("**`/places/<state>`: 'Consumer protection' section** (50 states + DC; PR once `geo.ts` includes it). Sources: `ftc_sentinel_states` filtered by `state`, `ftc_dnc_states` by `state`, `ftc_refunds` rows `<year>-state-<USPS>`.")
    w("- Latest-year strip: reports per 100K (`metrics.fraud_other_per100k`) with rank 'x of 50' and the change marker (`analytics.fraud_other_rank_change`); identity theft per 100K and rank; total fraud loss and median loss with `analytics.total_loss_yoy_pct`. Each number links to its Data Book page (`source_url`) and shows its population-basis year.")
    w("- Small multiples 2017-2024: reports per 100K, total loss, median loss on a shared axis; dashed markers at editions with a population-basis change or an FTC definition notice; no interpolation across a missing point.")
    w("- Top-ten categories for a selectable year (`top_categories`) beside the identity theft type shares; a plain 'Not recorded: extraction damaged' row where the table was withheld.")
    w("- Do Not Call panel FY2021-FY2025 (complaints and registrations per 100K with ranks) and refunds mailed 2022-2024 with the caption 'dollars mailed, not consumers'.")
    w("")
    w("**`/places/analytics`: 'Consumer protection' tab.** Source: `ftc_sentinel_states` for one year.")
    w("- Choropleth with a selectable measure (reports per 100K, identity theft per 100K, total loss, median loss, loss share, Do Not Call complaints per 100K) and a year control; DC as a marker, PR in the table only.")
    w("- Sortable 'Rank movers' table from `analytics.*_rank_change` and `*_yoy_pct`, showing 'Unranked' and 'Not recorded' plainly.")
    w("- Scatter of reports per 100K against median loss with point size = total loss, separating high-volume low-loss states from high-loss states.")
    w("")
    w("**Consumer-protection view** (a new route under `/law/enforcement`, for example `/law/enforcement/consumer`). Sources: `ftc_sentinel_national`, `ftc_refunds`, `ftc_refund_programs`.")
    w("- National series: stacked area of reports by type 2001-2024 (`US-series`), fraud-loss columns 2017-2024 with YoY labels and the median line, and an edition-revision band from `revision_vs_latest_edition`.")
    w("- 'Where losses are rising': ranked bars from `fastest_rising_fraud_category_loss` for the 1, 3 and 5 year windows, each with its definition-notice badge; payment-method and contact-method bars (`payment_method_loss_changes`, `contact_method_loss_changes`); age-group table (`age_groups`).")
    w("- Refunds: share-of-funds bars 2018-2024 (`<year>-summary`), the case table (filters report year and stage) with the Totals-row difference notes, and the active programs list with administrator and hotline (`ftc_refund_programs`); the program link only for the exactly matched names. A `/companies/<CIK>` 'FTC refund cases' panel stays empty until a case name matches a company profile exactly (none today).")
    w("")
    w("## 12. Reproduce")
    w("")
    w("```")
    w("python3 -I -B scripts/enrichment/ftc_sentinel/build_ftc_sentinel.py")
    w("python3 -I -B scripts/enrichment/ftc_sentinel/verify_ftc_sentinel.py")
    w("python3 -I -B scripts/enrichment/ftc_sentinel/write_report.py")
    w("cd scripts/enrichment/ftc_sentinel && python3 -B -m unittest -v test_ftc_sentinel")
    w("python3 -I -B private/scratch/enrich/publish_build.py private/build/ftc_sentinel/<dataset>.json   # validate only")
    w("```")
    with open(os.path.join(C.BUILD, "REPORT.md"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print("REPORT.md written,", len(lines), "lines")


if __name__ == "__main__":
    main()
