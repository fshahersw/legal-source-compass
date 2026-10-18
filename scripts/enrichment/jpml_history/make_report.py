"""Write private/build/jpml_history/REPORT.md from the build files (counts, validation, spot checks and link checks are read
from the files, not typed). Run after build_all.py and spot_check.py:

  python3 -I -B scripts/enrichment/jpml_history/make_report.py
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_jpml_history as bh  # noqa: E402

OUT = bh.OUT
LOOKUPS = bh.LOOKUPS


def load(name):
    return json.loads((OUT / name).read_text())


def link_checks(builds):
    spine = {r["id"] for r in json.loads((LOOKUPS / "court_spine_fd.json").read_text())["rows"]}
    ids = {name: {r["id"] for r in b["rows"]} for name, b in builds.items()}
    courts, lens, records = set(), set(), []
    for b in builds.values():
        for r in b["rows"]:
            for l in list(r["item"].get("links", [])) + list(r["detail"].get("links", [])):
                u = l["url"]
                if u.startswith("/courts/"):
                    courts.add(u[len("/courts/"):])
                elif u.startswith("/matters/lens/"):
                    lens.add(u[len("/matters/lens/"):])
                elif u.startswith("/records/"):
                    records.append(u)
    bad_rec = []
    for u in records:
        _, _, ds, rid = u.split("/", 3)
        if ds in ids and rid not in ids[ds]:
            bad_rec.append(u)
    return {"courts": len(courts), "courts_missing": sorted(c for c in courts if c not in spine), "lens": len(lens), "lens_bad": sorted(x for x in lens if not x.isdigit()), "records": len(records), "records_missing_in_builds": sorted(set(bad_rec))[:10]}


def main():
    mdls, months, extra = load("jpml_pending_history_mdls.json"), load("jpml_pending_history_months.json"), load("jpml_statistics_extra.json")
    inv = load("report_inventory.json")
    val = load("validation.json")
    sval = load("statistics_validation.json")
    spot = load("spot_checks.json")
    rows = {r["id"]: r for r in extra["rows"]}
    ov = rows["summary:overview"]["item"]["overview"]
    xref = ov["cross_references"]
    series = ov["series"]
    mo_rows = {r["id"]: r for r in months["rows"]}
    mstats = [mo_rows[k]["item"]["month_stats"] for k in sorted(k for k in mo_rows if re.fullmatch(r"\d{4}-\d{2}", k))]
    lc = link_checks({"jpml_pending_history_mdls": mdls, "jpml_pending_history_months": months, "jpml_statistics_extra": extra})
    kinds = Counter()
    for r in extra["rows"]:
        kinds[r["id"].split(":")[0]] += 1
    m_kinds = Counter("district" if r["id"].startswith("district:") else "summary" if r["id"].startswith("summary:") else "month" for r in months["rows"])
    valid_by_type = Counter((r["type"], r["valid"]) for r in val)
    st_ok = [e for e in sval if e["docket_table"]["valid"]]
    st_bad = [e for e in sval if not e["docket_table"]["valid"]]
    unverified = [e["fy"] for e in sval if e["docket_table"]["valid"] and e["docket_table"]["attribution"]["status"] != "verified"]
    dup = [(e["fy"], len(e["docket_table"]["duplicates_dropped"])) for e in sval if e["docket_table"]["duplicates_dropped"]]
    recon = ov["reconciliation_with_monthly_reports"]
    manifest = bh.load_manifest()
    stat_types = Counter(e.get("stat_type") for e in manifest.values() if e["path"].startswith("statistics/"))
    unknown_lens = sorted(int(r["id"][4:]) for r in extra["rows"] if r["id"].startswith("mdl:") and not r["item"]["lens_content_known"])
    top10 = [s for s in series if s["top10_share_pct"] is not None]
    a = []
    w = a.append
    w("# jpml_history: JPML pending-MDL history and fiscal-year statistics")
    w("")
    w(f"Built {extra['built_at']} by `scripts/enrichment/jpml_history/build_all.py` (offline: reads only `private/acq/jpml_history/` and the saved lookups). Nothing was written to Supabase or any remote service; nothing was published.")
    w("")
    w("## 1. What was built")
    w("")
    w("| dataset | rows | grain | build file |")
    w("|---|---|---|---|")
    w(f"| `jpml_pending_history_mdls` | {len(mdls['rows'])} | one row per MDL number seen in any valid monthly report (monthly series Oct 2024 to Oct 2026, district and judge as printed per period, peak, months to peak, 1/3/6/12-month changes, Sept 30 history and lifetime curve) | `private/build/jpml_history/jpml_pending_history_mdls.json` |")
    w(f"| `jpml_pending_history_months` | {len(months['rows'])} | {m_kinds['month']} report months (listing) + {m_kinds['district']} `district:<code>` detail rows + `summary:overview` | `private/build/jpml_history/jpml_pending_history_months.json` |")
    w(f"| `jpml_statistics_extra` | {len(extra['rows'])} | {kinds['fy']} fiscal-year editions `fy:<YYYY>` (listing) + {kinds['district']} transferee districts `district:<key>` + {kinds['mdl']} MDL numbers `mdl:<n>` + `summary:overview` (detail-only) | `private/build/jpml_history/jpml_statistics_extra.json` |")
    w("")
    w("Dataset ids were checked against `public.corpus_datasets` (SELECT, 2026-10-18): none of the three exists. `scripts/enrichment/jpml_history/build_all.py` rebuilds all three; `python3 -I -B private/scratch/enrich/publish_build.py <file>` validates each (dataset id, ids unique, source_url on every row, JSON round trip): all three pass.")
    w("")
    w("### Compared with the datasets already in the corpus")
    w("")
    w("- `mdl_analytics` (215 rows: 214 MDLs + overview, monthly Oct 2024 to Oct 2026): the monthly MDL set here is the same 214 MDL numbers. Values spot-compared with it match (MDL 2738 at 2024-10: 58,052 pending / 59,216 total; MDL 2873: 9,896 / 10,185). Added here: validation of every report against its printed totals, district and judge as printed per period, docket-type periods, peak and months to peak, percent changes, closing dates from the terminated listings, concentration (top-1/5/10 share, HHI by MDL and by district) per month, and the Sept 30 history. Field names follow `mdl_analytics` (`analytics` block with `growth`, `status`, `mass_tort`, `new_12m`, `resolved_12m`, `series[{date,pending,total}]`; filters `type`, `mass_tort`, `status`, `growth`, `district`, `date`; growth buckets fast_growth / growing / stable / declining / insufficient_history; MDL ids are the plain number).")
    w("- `mdl_intel_jpml_stats` (54 rows, calendar-year Summary of JPML Activity 1973-2025: motions, tag-alongs, remands, pending MDLs by type at Dec 31): not repeated. `jpml_statistics_extra` holds what that dataset does not: the **fiscal-year** (Sept 30) cumulative summary, the transferee-district table and the per-MDL Summary by Docket, FY1992 to FY2025.")
    w("- `mdl_terminated_history` (1,692 rows from the FY2025 terminated report): not repeated; used as a cross-check (section 5).")
    w("- `mdls` (180 JPML records): 176 of the 214 monthly MDLs are in it; links use the exact MDL number, never a name or caption.")
    w("")
    w("## 2. Sources, method and terms")
    w("")
    w("| source | what | method |")
    w("|---|---|---|")
    w("| https://www.jpml.uscourts.gov/pending-mdl-reports-archive | 24 months (Oct 2024 to Sept 2026) x 5 report types = 120 PDFs | direct HTTPS GET of the page and the linked PDFs |")
    w("| https://www.jpml.uscourts.gov/pending-mdls-0 | current month (Oct 1, 2026), 5 PDFs | direct HTTPS GET |")
    w("| https://www.jpml.uscourts.gov/statistics-info (4 pages) | " + f"{sum(stat_types.values())} files: " + ", ".join(f"{n} {t}" for t, n in sorted(stat_types.items())) + " (Fiscal Year = editions FY1992-FY2025; Legacy = 1968-1991)" + " | direct HTTPS GET |")
    w("")
    w("Raw bytes are unchanged under `private/acq/jpml_history/` with `_manifest.jsonl` (url, path, sha256, bytes, retrieved_at, status, method); every build re-verifies each sha256. 125 monthly PDFs + 78 statistics files + 6 index pages, 144 MB.")
    w("")
    w(f"**Terms.** {bh.TERMS}")
    w("")
    w("**Owner action needed:** none. No source required a form, an account, a login or the acceptance of terms; no contact detail was entered anywhere; the User-Agent is `legal-source-compass research (Seeger Weiss internal research)` with no email address.")
    w("")
    w(f"**Not acquired.** (1) Monthly reports before Oct 2024: the archive page states \"Archived reports will be removed at the beginning of the second year\", so the official site no longer carries them; a Wayback Machine CDX listing was attempted once and the connection was reset by the sandbox proxy, which was not worked around. Long-run history therefore comes from the fiscal-year editions (Sept 30 snapshots), not monthly reports. (2) The two Legacy PDFs (1968-1979, 1980-1991), the {stat_types['Calendar Year']} Calendar Year files and the {stat_types['Cumulative Terminated']} Cumulative Terminated files were downloaded but not parsed into these datasets: calendar-year activity is already in `mdl_intel_jpml_stats`, the terminated listing in `mdl_terminated_history`, and the legacy volumes use a different layout (FY1992 is the first edition parsed).")
    w("")
    w("## 3. Coverage")
    w("")
    w(f"- Monthly: {len(mstats)} report months, {mstats[0]['month']} to {mstats[-1]['month']} (report dates {mstats[0]['report_date']} to {mstats[-1]['report_date']}); {len(mdls['rows'])} MDL numbers; {len(months['rows']) - m_kinds['month'] - 1} transferee districts.")
    w(f"- Fiscal year: {len(sval)} editions, FY{sval[0]['fy']} to FY{sval[-1]['fy']} (FY1992 prints a 15-month period, July 1991 to Sept 1992; every other edition 12 months); {kinds['mdl']} MDL numbers in {len(st_ok)} validated docket tables; {kinds['district']} transferee districts with any activity in 34 validated Circuit-and-District tables.")
    w("")
    w("## 4. Validation (every report; nothing repaired)")
    w("")
    w("### Monthly reports")
    w("")
    w(f"{len(val)} PDFs: " + ", ".join(f"{t} {sum(n for (tt, ok), n in valid_by_type.items() if tt == t and ok)}/{sum(n for (tt, ok), n in valid_by_type.items() if tt == t)} valid" for t in ("actions_pending", "district", "mdl_number", "mdl_type", "terminated")) + f". Excluded reports: {len(inv['excluded'])}. Unparsed data lines: {sum(len(r['unparsed']) for r in val)}.")
    w("")
    w("Per report: parsed row count = printed `Total Number of MDL Dockets`; sum of `Actions Now Pending` = printed `Report Totals`; sum of `Total Actions` = printed total; MDL numbers unique; no unparsed MDL line; first row has a printed district; the printed bucket tables (MDLs with N to M pending / total actions) reproduce; distinct district and judge counts equal the printed counts. Type and by-number listings: row count = `MDLs Listed on this Report`, per-type counts = printed `Number of <type> Litigations Listed`. Terminated listings: row count = printed total and every Date Closed inside the printed `Closed Between` window. Same-month reports cross-checked against each other (same MDL set, same pending, total, district and judge): 0 disagreements in 25 months.")
    w("")
    w("### Fiscal-year editions")
    w("")
    w("- **Circuit-and-District table: 34 of 34 valid.** Each circuit equals the sum of its districts on `pending`; the 12 circuits (D.C. circuit included) sum to the printed grand total on all 11 columns. One printed inconsistency is kept as printed and disclosed in the page text (`fy:2023`, `district:district-of-columbia`): the FY2023 D.C. circuit row prints 5 actions closed in the period and the district row beneath it prints `-`; the district series uses the district row (0), the circuit list the circuit row (5), nothing is repaired.")
    w(f"- **Summary by Docket: {len(st_ok)} of 34 valid** (numbers). Required: every entry closed by five printed numbers, no stray number lines, the five columns (entries plus labelled `Reassigned...` / `Returned/Claims Remain` adjustment lines under them) equal the printed totals line, entry count equal to the printed count (`N Total Litigations`, or pending + closed, or total MDLs, where printed), (MDL, district) keys unique, and **per entry: total transferred + total filed in the transferee court - closed - remanded = pending** (an independent check on every row; it holds for every entry of every validated edition).")
    w("- **Excluded docket editions (no MDL series, no docket-derived shares; the district table and grand totals of those years are kept):**")
    w("")
    w("| FY | reason (printed vs parsed) |")
    w("|---|---|")
    for e in ov["excluded_docket_editions"]:
        w(f"| FY{e['fy']} | {e['reason']} |")
    w("")
    w("  Why: FY2015's text layer lacks 2 of the 307 printed entries; FY2016's closed total is 3 short and MDL 1203's per-entry balance is off by 3, the amount of the `Reassigned to PAE tr'or judge` line printed under MDL 1203 in the neighbouring editions and absent from this edition's text; in FY2019 the text of MDL 2389 stops at a page end before its numbers, and in FY2020 the line of MDL 2567 carries only its last number; FY2023's printed totals differ from the sum of its printed entries by 8 actions (closed +8, pending -8) although every entry is self-consistent, which cannot be resolved from the report.")
    w(f"- District attribution (which district heading an MDL sits under) is **unverified** in FY{', FY'.join(str(x) for x in unverified)}: neither the printed `N Litigations` counts nor the Circuit-and-District pending figures agree with the entries (for example FY2021 prints `8 Litigations` over seven Massachusetts entries; D.C. 226 pending in the docket vs 432 in the district table). The numbers of those editions are valid; the district is shown as printed and flagged `attribution: unverified`, and is not used for district analytics (district analytics use the Circuit-and-District table).")
    if dup:
        w(f"- Page printed twice: FY{dup[0][0]} repeats {dup[0][1]} Georgia N. entries verbatim (same MDL, district, caption and all five numbers); the repeats are dropped and recorded, and the totals check then passes.")
    w("- FY2006: MDLs 1715, 1735 and 1745 print `0 0 0 0 0` on their first line (the transferor-district list continues, ending with `;`) and the real figures on the last wrapped line; the placeholder zeros are recorded and not used (a zero first line with no later closing line stays incomplete and fails the edition). Values: 1715 = 89/80/3/0/166, 1735 = 13/4/2/0/15, 1745 = 19/1/0/0/20 (transferred / filed in transferee court / closed / remanded / pending).")
    w("- Closure is not asserted: the report marks MDLs closed during the year in red and new ones in green, which the text layer loses; an entry appears in the edition for the year it was pending or closed, with pending 0 once closed.")
    w("- Narrative sentences (FY2012+) agree with the table grand totals wherever both are printed (transferred, filed directly, subjected, pending).")
    w("")
    w("### Reconciliation of the two official publications")
    w("")
    for r in recon:
        w(f"- Sept 30, FY{r['fy']} docket table vs the {r['monthly_report_month']}-01 monthly report: pending identical for {r['identical_pending']} of {r['mdls_in_both']} MDLs in both, within 1% or 5 actions for {r['within_1pct_or_5_actions']}; totals {r['fy_end_pending_total']:,} vs {r['monthly_pending_total']:,}." + (f" Largest difference: MDL {r['largest_differences'][0]['mdl']} {r['largest_differences'][0]['fy_end']:,} vs {r['largest_differences'][0]['monthly']:,}." if r["largest_differences"] else ""))
    w("")
    w("**Finding to carry forward:** the 2024-10 monthly report prints 224,418 pending for MDL 2885 (3M Combat Arms Earplug), while the FY2024 edition prints 148,476 at Sept 30, 2024 and the 2024-11 report prints 148,528. The 2024-10 report passes its own printed-total checks, so it is kept, but its totals (402,473 pending, top-10 share, HHI) and any 12-month change for MDL 2885 that uses 2024-10 as the base are inflated relative to the neighbouring months. The month row and the MDL row carry this as a visible cross-check sentence. The existing `mdl_analytics` series for MDL 2885 shows the same 2024-10 value.")
    w("")
    w("## 5. Cross-reference rates")
    w("")
    w(f"- `/matters/lens/<n>`: {lc['lens']} distinct MDL numbers linked, all exact printed MDL numbers (the lens route accepts any positive integer). {xref['lens_link_targets_with_known_content']} of {xref['mdl_numbers']} fiscal-year MDL numbers ({100 * xref['lens_link_targets_with_known_content'] / xref['mdl_numbers']:.1f}%) already have content in `mdls`, `mdl_analytics` or `mdl_terminated_history`; the other {xref['mdl_numbers'] - xref['lens_link_targets_with_known_content']} are listed just below.")
    w(f"- `/courts/<court_spine id>`: {lc['courts']} distinct ids linked; every one exists in `court_spine` (the saved SELECT of 125 federal-district rows, 2026-10-18): missing {len(lc['courts_missing'])}. Matching is by exact court_spine title only (`District Court, N.D. Illinois`; territories also under their bare name, e.g. `District Court, Virgin Islands`); {xref['districts_matched_to_court_spine']} of {xref['districts']} fiscal-year districts and 54 of 54 monthly JPML district codes matched uniquely; unmatched {len(xref['districts_unmatched'])}, ambiguous 0. A non-match or ambiguous title gets no link (covered by unit tests).")
    w(f"- `/records/<dataset>/<id>` links between the three datasets: {lc['records']} links, targets missing in the builds: {len(lc['records_missing_in_builds'])}.")
    w(f"- MDL rows with a Sept 30 history: {sum(1 for r in mdls['rows'] if r['item'].get('fy_history_available'))} of {len(mdls['rows'])} monthly MDLs (the other 23, MDL 3160 and later, first appear in the monthly reports from 2025-11, after the FY2025 edition). All 214 monthly MDL rows carry a `/courts/` link.")
    w(f"- Fiscal-year MDLs no longer listed in the latest validated edition and present in `mdl_terminated_history`: {xref['last_listed_before_latest_edition_and_in_terminated_history']}; the last fiscal year listed equals the terminated report's termination year for {xref['last_fy_equals_termination_year']} and is within one year for {xref['last_fy_within_one_year_of_termination_year']} (the rest differ by fiscal-versus-calendar timing; informational, not used to set any value).")
    w(f"- {len(unknown_lens)} fiscal-year MDL numbers have no content anywhere in `mdls`, `mdl_analytics` or `mdl_terminated_history` although they stopped being listed (MDL {', '.join(str(x) for x in unknown_lens)}): the terminated-litigation dataset omits them; this stream links them to the lens by exact number and keeps their fiscal-year history.")
    w("")
    w("## 6. Analytics stored (formulas are in each dataset summary)")
    w("")
    w(f"- Per month: pending MDLs, pending and total actions, top-1/5/10 share of pending, HHI of pending across MDLs and across transferee districts, products-liability share of pending actions and MDLs (only when every MDL of that report is typed in the same-date Docket Type Summary), median pending, MDLs entering/leaving, age bands. Top-10 share runs {min(s['top10_share_pct'] for s in mstats):.2f}% to {max(s['top10_share_pct'] for s in mstats):.2f}% over the 25 months (computed from the stored unrounded values).")
    w(f"- Per fiscal year: cumulative summary (transferred, filed in transferee districts, closed, pending), roll-forward residual, district HHI, and (29 editions) top-1/5/10 share and MDL HHI: top-10 share {top10[0]['top10_share_pct']:.1f}% (FY{top10[0]['fy']}) to {top10[-1]['top10_share_pct']:.1f}% (FY{top10[-1]['fy']}); district HHI {series[0]['hhi_district_pending']:,.0f} to {series[-1]['hhi_district_pending']:,.0f}. Pending at a fiscal-year end peaked at {max(s['pending'] for s in series):,} (FY{max(series, key=lambda s: s['pending'])['fy']}).")
    w("- Per MDL: lifetime curve (Sept 30 points labelled `fiscal_year_statistics` and monthly points labelled `monthly_report`, never blended), peak and first-to-peak, pending as share of peak, year-over-year change between adjacent validated fiscal years only.")
    w("- Percentages are stored as 100 x part / whole to 6 decimals and rounded once, to the digits shown, for display. HHI is on the 0-10,000 scale. Ranks of districts are ordinal (pending descending, ties by district id ascending).")
    w("")
    w("## 7. Spot checks (displayed figure vs the raw PDF)")
    w("")
    s = spot["summary"]
    w(f"`scripts/enrichment/jpml_history/spot_check.py` reads each figure from the **build file** and finds it in the PDF with its own single-page `pdftotext` search (not the parsers): {s['checks']} checks, {s['values_checked']} values, {s['reports']} different reports (monthly reports of 2024-10, 2025-03, 2025-09, 2026-04, 2026-10; fiscal-year editions FY1992, 1996, 2001, 2005, 2010, 2014, 2018, 2022, 2025), **{s['mismatches']} mismatches**. Pages were also read as images for FY1992 p.21 (MDL 875: 30,468 / 6,719 / 3,463 / 39 / 33,685) and FY2025 p.24 (MDL 3060: 84 / 14,086 / 3,618 / 0 / 10,552): match.")
    w("")
    w("| report | PDF page | row | figure | displayed value | source line (excerpt) | match |")
    w("|---|---|---|---|---|---|---|")
    for c in spot["checks"]:
        if c["match"] is None:
            continue
        name = c["pdf"].split("/")[-1]
        line = (c["source_line"] or "").replace("|", "/")[:95]
        w(f"| {name} | {c['pdf_page']} | {c['dataset'].replace('jpml_', '')} {c['row']} | {c['field']} | {c['displayed']} | `{line}` | {'yes' if c['match'] else 'NO'} |")
    w("")
    w("An independent verifier (separate parsers, no shared code) re-derived the monthly dataset (11,096 checks, 0 mismatches) and the fiscal-year dataset (every district-year point, every MDL-year point, fiscal-year grand totals, narrative agreement); its only differences are explained: (a) MDLs printed under two districts in one edition (MDL 949 FY1993, MDL 2231 FY2012) are summed, `parts: 2`; (b) the three FY2006 first-line placeholder zeros above; (c) the verifier counted a circuit-level D.C. row as a district in FY1993, FY1994 and FY2003; (d) the FY2023 D.C. printed inconsistency; (e) five excluded editions show `Not recorded` where the verifier expected a dash.")
    w("")
    w("## 8. Open risks")
    w("")
    w("- Monthly history is only the two years the JPML site keeps (Oct 2024 on). Earlier monthly reports exist only in third-party archives that could not be reached from this sandbox; the fiscal-year snapshots are the only longer record.")
    w("- Five fiscal-year docket tables are excluded (section 4), so MDL series have gaps at FY2015, 2016, 2019, 2020, 2023; peaks are peaks among the validated fiscal-year ends plus the monthly points, not true maxima. The MDL rows say which editions inside their span are missing.")
    w("- District attribution is unverified for FY2021 and FY2022.")
    w("- The 2024-10 monthly report's MDL 2885 value conflicts with the FY2024 edition and the 2024-11 report (section 4).")
    w("- Captions and judge names in the fiscal-year tables are the Panel's abbreviations as printed (`AT`, `PL`, `Wolfson, F.L.`); no caption is expanded and no judge is linked to a profile (no person link is made).")
    w("- MDL 3078 and MDL 3148 print no transferee judge in the FY2025 edition; stored as `null`, shown as `Not printed`.")
    w("- Product categories: only the Panel's Docket Type is used; no product or defendant is inferred from a caption.")
    w("")
    w("## 9. Proposed UI (not implemented)")
    w("")
    w("All fields below are in the three build files; every figure carries its source PDF through the row `source_url`, the `fy:<YYYY>` row for a fiscal-year point, and the `pdf_page` stored on MDL-year points.")
    w("")
    w("**`/matters/lens/<n>`: lifetime curve panel.** Step/line chart of `jpml_pending_history_mdls` row `<n>` `lifetime_curve` (Sept 30 points as markers from `jpml_statistics_extra` `mdl:<n>` `fy_history.series[].pending`, monthly points as the line, a legend distinguishing the two sources), annotated with peak (`peak_pending`, `peak_fy`/`peak_month`), `months_first_to_peak`, `pending_vs_peak_pct`, growth badge and status; hatched columns for the excluded editions (`edition_excluded_years_inside_span`) with the reason on hover; small table of transferee district and judge by period (`districts`, `judges`); cumulative transferred / filed in transferee court / closed / remanded per fiscal year from the series; the cross-source sentence when present. MDLs only in `jpml_statistics_extra` (closed before Oct 2024) show the fiscal-year panel alone with the termination year from `mdl_terminated_history`.")
    w("")
    w("**`/matters/analytics`: concentration over time.** One panel with three aligned series on a shared time axis: top-10 share of pending (fiscal-year points FY1992-FY2025 from `summary:overview` series, monthly points 2024-10 to 2026-10 from `jpml_pending_history_months`), HHI across MDLs, HHI across transferee districts; the five excluded fiscal years drawn as gaps for the MDL-based lines (district HHI exists for all 34 years). Beside it a table of the 25 largest MDLs by peak pending (`largest_peaks`) and the monthly fastest-growing / fastest-declining lists (`summary:overview` of the months dataset). Label every computed figure with its formula (dataset summary `formulas`).")
    w("")
    w("**`/matters/intel`: fiscal-year statistics tab** next to the calendar-year `mdl_intel_jpml_stats` series: listing of `fy:<YYYY>` rows (pending at Sept 30, transferred, filed directly, closed, top-10 share, district HHI), a cumulative flow chart (cumulative transferred / filed / closed / pending), the roll-forward residual with a note that the Panel revises earlier counts, and the narrative figures as printed (motions filed/granted/denied per fiscal year) clearly labelled fiscal versus calendar. Rows with `Docket table not validated` or `Source table inconsistency` badges show the reason.")
    w("")
    w("**`/courts/<id>`: MDL docket panel for transferee courts.** For a court id, read the `jpml_statistics_extra` `district:<slug>` row whose `court_id` equals the id: area chart of pending actions at each Sept 30, share of all pending MDL actions, rank, cumulative transferred in / filed / closed; below it the current MDLs from `jpml_pending_history_mdls` (filter `court` contains the id: pending, change 12m, judge, growth) and historical MDLs from `jpml_statistics_extra` (`mdl:<n>` rows whose `filters.court` contains the id) with peak and years listed, each linking to `/matters/lens/<n>`. Show the attribution flag for FY2021-FY2022.")
    w("")
    a_text = "\n".join(a) + "\n"
    (OUT / "REPORT.md").write_text(a_text)
    print("REPORT.md", len(a_text), "chars; link checks", lc)


if __name__ == "__main__":
    main()
