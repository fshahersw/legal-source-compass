# JPML statistics coverage audit — October 24, 2026

Scope: every report the Judicial Panel on Multidistrict Litigation (JPML) publishes on its four statistics pages, compared with what the corpus held before this wave and what the wave-1026 build adds.

- [Pending MDLs](https://www.jpml.uscourts.gov/pending-mdls-0) (current month)
- [Pending MDL Reports Archive](https://www.jpml.uscourts.gov/pending-mdl-reports-archive)
- [MDL Quarterly Caseload Summary](https://www.jpml.uscourts.gov/mdl-quarterly-caseload-summary)
- [Statistical Information](https://www.jpml.uscourts.gov/statistics-info) (four pager pages)

All four pages and every linked file were read on 2026-10-24 (robots.txt `Crawl-delay: 10` honoured; one request at a time). Every file is kept unchanged (gzipped) with the sha256 of its original bytes in `private/acq/jpml_reports/_manifest.jsonl`. Files already held from the 2026-10-18 acquisition (`private/acq/jpml_history/`) were re-verified by sha256 and reused, not fetched again.

## 1. What the four pages list

| Page | Report family | Files | Report dates / period |
|---|---|---:|---|
| Pending MDLs | Pending MDLs by District, by MDL Number, by Docket Type, by Actions Pending, MDLs Terminated | 5 | as of October 1, 2026 |
| Pending MDL Reports Archive | the same five reports per month | 120 | October 2024 to September 2026 (24 months) |
| MDL Quarterly Caseload Summary | Distribution of Pending MDL Dockets by Circuit | 3 | March 31, June 30 and September 30, 2026 (December 2026 listed, not yet linked) |
| Statistical Information | Calendar Year statistics | 20 | CY2006 to CY2025 editions |
| | Fiscal Year statistical analysis (docket information: Summary by Docket, Circuit-and-District table) | 34 | FY1992 to FY2025 |
| | Cumulative Terminated litigations | 22 | 2004 to 2025 editions |
| | Legacy statistical reports | 2 | 1968–1979, 1980–1991 |
| **Total** | | **206** | |

The archive page states: "Archived reports will be removed at the beginning of the second year." The current page states: "Beginning January 1, 2024, the Pending MDL Reports will be uploaded on the first business day of each month" (before 2024 the reports are dated mid-month).

### Official reports no longer linked

Site search of jpml.uscourts.gov found 83 older official report files (July 2012 to June 2024) that the archive page no longer links but the JPML server still serves. Each was fetched directly from jpml.uscourts.gov (HTTP 200 for all 83; list and discovery note in `private/acq/jpml_reports/discovered_urls.json`). No URL was guessed: only URLs the search returned were requested. These files are what extends the monthly series back to 2012.

## 2. Coverage before and after

| Report family | Before this wave (live datasets) | After (this build) |
|---|---|---|
| Monthly pending reports (district / actions pending) | 25 report dates, 2024-10-01 to 2026-10-01, in `jpml_pending_history_months` and `jpml_pending_history_mdls` (214 MDLs) | **89 report dates, 2012-07-10 to 2026-10-01**, in `jpml_pending_snapshots` (national) and `jpml_mdl_pending_series` (704 MDL numbers); the 25 recent dates are identical to the published datasets (verified) |
| Docket Summary Listing and Docket Type Summary | 25 dates each (types, master docket, filed and transfer dates) | unchanged; 3 older listings held (below) |
| Recently terminated MDLs (monthly) | 25 listings | unchanged |
| MDL Quarterly Caseload Summary (by circuit) | none | **3 of 3** quarter-end reports, in `jpml_quarterly_caseload` (12 circuits, printed Circuit Summary lines) |
| Transferee district view over time | 54 JPML district codes, 25 months (`district:` rows of `jpml_pending_history_months`); fiscal-year districts in `jpml_statistics_extra` | **72 district codes over 89 reports**, `jpml_transferee_series` (`district:<code>`), all matched exactly to court records |
| Transferee judge view over time | judge per MDL per month only | **578 judge names exactly as printed**, series of MDLs and pending actions per report (`judge:<id>`), no merging |
| Fiscal-year statistical analysis | 34 editions in `jpml_statistics_extra` (Circuit-and-District table 34/34, Summary by Docket 29/34 validated) | unchanged; indexed as a series (`national.pending_actions.fiscal_year`, FY1992–FY2025 points inline) |
| Calendar-year statistics | 1973–2025 from all 20 editions in `mdl_intel_jpml_stats` | unchanged; indexed |
| Cumulative terminated litigations | latest edition (FY2025, 1,692 rows) in `mdl_terminated_history` | unchanged; the 21 earlier editions are superseded (each edition is cumulative) and indexed as not parsed |
| Legacy 1968–1991 | not parsed | not parsed (reason below) |
| Series index | none | **`jpml_series_index`**: 16 series (what is counted, unit, period, dataset, record, field, coverage, gaps) and 289 report files with their status |

Fields per report date and MDL (as printed): MDL number, litigation title, transferee district (blank district cells carry the row above, as the report prints them), transferee judge(s) with printed title, actions now pending, total actions (historical). Per report: the printed national totals (dockets, pending, total, districts, judges, judge-title breakdown, docket-size buckets) and the printed report filters. Per quarter: the printed Circuit Summary figures (districts, MDLs, pending, total) and the national totals.

### Monthly series by year (held, validated report dates)

2012: 1 · 2014: 3 · 2015: 3 · 2016: 5 · 2017: 7 · 2018: 7 · 2019: 7 · 2020: 5 · 2021: 7 · 2022: 6 · 2023: 8 · 2024: 8 · 2025: 12 · 2026: 10.

Months with no held report are gaps (31 gaps, the longest 20 months between July 2012 and April 2014, 10 months between August 2014 and July 2015, 6 months between August 2022 and March 2023). They are drawn as gaps and never filled.

## 3. Validation

Every report is checked against its own printed totals and held if any check fails:

- Monthly and quarterly row reports: parsed row count = printed `Total Number of MDL Dockets`; sums of actions pending and total actions = printed `Report Totals`; MDL numbers unique; no unparsed MDL line; first row prints its district.
- By-circuit reports, in addition: per circuit, row count = printed MDLs, distinct districts = printed Districts, pending and total sums = printed Circuit Summary; circuit figures sum to the report totals; each district in one circuit only. All 3 quarterly reports pass all 75 checks each.
- Same-date reports cross-checked (actions pending against district): 36 dates, all agree except 2020-08-17, where MDL 2885 prints 142,504 pending / 143,190 total in the actions-pending report and 142,527 / 143,213 in the district report (report totals 262,228 / 622,728 and 262,251 / 622,751). Both reports pass their own totals; the actions-pending report is the primary for that date and the difference is shown on the snapshot.
- Report filters: every held report prints `Status: Transferred; Limited to Active Litigations` except 2014-07-15, which prints only `Limited to Active Litigations`; that snapshot is flagged.

Independent verification (`scripts/enrichment/jpml_history/verify_series.py`, a second text extraction and separate matching code): 92 report totals, 17,948 MDL rows, 36 circuit summaries, 239 equalities with the published 2024–2026 datasets, 182 derived-metric recomputations and 20 page-located spot checks — 0 failures. A page-to-text conversion of the 2017-09-15 report agreed on the report totals and on 19 of 21 sampled MDL rows; the 2 differences are the conversion pairing D.C. rows with the wrong numbers (the text layer prints MDL 2656 at 105 / 107 and MDL 1668 at 1 / 18); the text layer is authoritative.

## 4. Held reports

| File | Why |
|---|---|
| Pending_MDL_Dockets_By_District-September-15-2022.pdf, -October-14-2022, -November-15-2022, -December-15-2022, -January-17-2023 | The text layer uses Type 3 fonts with a custom encoding and no Unicode map: neither the title, the report date nor any figure can be read from it. No figure is taken from these five reports. |
| Pending_MDL_Dockets_by_MDL_Number-November-18-2013.pdf | Older listing layout; no rows parse (used only for transfer dates; nothing taken). |
| Pending_MDL_Dockets_By_Type-January-17-2017.pdf | Older layout; 0 of 241 printed rows parse. |
| Pending_MDL_Dockets _by_MDL_Number-August-15-2019.pdf | 193 of 196 printed rows parse; held. |

## 5. Not parsed and not acquired

- **Legacy statistical reports 1968–1979 and 1980–1991** (79 and 460 pages): scanned annual reports whose text layer is an OCR rendering with recognition errors (for example "trapsfer", "assigrnnent"); mostly narrative. Tables cannot be checked against printed totals from that layer, so no figure is taken.
- **Cumulative terminated editions 2004–2024** (21 files): each edition is cumulative; every MDL they list is in the FY2025 edition parsed into `mdl_terminated_history`.
- **Monthly reports before July 2012, and months in the gaps above:** not linked from the JPML pages and not returned by site search. Third-party web archives are not an official publisher and were not used.
- **December 2026 quarterly report:** listed on the quarterly page without a file yet.

## 6. Derived metrics (deterministic, unit-tested in `test_jpml_series.py`)

- Months since transfer: completed calendar months from the printed Date Transferred (Docket Summary Listing) to the report date (214 MDLs; Not recorded for the others).
- Months listed: completed calendar months from the first to the last held report listing the MDL (left-censored at July 2012).
- Peak actions pending: largest printed pending value among held reports; earliest date wins ties.
- Actions added between consecutive reports: change in printed Total Actions (Historical) for an MDL listed in both reports; summed only over reports of consecutive calendar months. A fall in the printed total is kept and flagged, not counted as added.
- National flows: MDLs first listed / no longer listed between consecutive reports; actions added to continuing MDLs.
- Transferee-district and circuit concentration: HHI (0–10,000) of pending actions, largest district and its share, top-5 share, per report.

## 7. Files

- Acquisition: `scripts/enrichment/jpml_history/acquire_jpml_reports.py`; raw files `private/acq/jpml_reports/` (9.4 MB, gzipped).
- Parsing and build: `parse_quarterly.py`, `series_metrics.py`, `build_jpml_series.py` (rebuilds the 2026-10-18 datasets in memory unchanged and verifies they still equal the published rows).
- Build files: `private/build/jpml_reports/` (five datasets, validation, inventory, cross-checks, verification).
