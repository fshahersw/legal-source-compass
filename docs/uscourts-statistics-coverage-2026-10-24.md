# U.S. Courts statistical tables: coverage audit (2026-10-24)

Generated 2026-10-24T06:23:18+00:00 by `scripts/enrichment/uscourts_tables/coverage.py` from the listing of https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables (crawled 2026-10-23, the years 2025-2026 re-crawled on 2026-10-24: no table was added), the stream's file store and parse reports, and the built datasets. Each listing row is one table of one publication for one period.

Columns: **Listed** rows in the listing; **Acquired** file stored (here or by the stream that publishes that publication); **Parsed** read into a table (here or by that stream); **Published** in a dataset of this stream. Not published splits into **Held** (the edition fails its own printed totals), **Duplicate** (another publication prints the same table for the same period and that one is published), **Other dataset** (published by another stream's dataset) and **Gap**.

## By publication

| Publication | Tables | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap | Published periods | Newest listed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| [Statistical Tables for the Federal Judiciary](https://www.uscourts.gov/data-news/reports/statistical-reports/statistical-tables-federal-judiciary) | 55 | 1690 | 1690 | 1210 | 1210 | 0 | 0 | 0 | 480 | 2001-06-30 to 2026-06-30 | 2026-06-30 |
| [Federal Judicial Caseload Statistics](https://www.uscourts.gov/data-news/reports/statistical-reports/federal-judicial-caseload-statistics) | 56 | 897 | 897 | 641 | 641 | 0 | 3 | 0 | 253 | 2001-03-31 to 2026-03-31 | 2026-03-31 |
| [Judicial Business of the United States Courts](https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-business-united-states-courts) | 154 | 3290 | 3290 | 1892 | 1888 | 4 | 0 | 0 | 1398 | 1997-09-30 to 2025-09-30 | 2025-09-30 |
| [Bankruptcy Filings](https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-filings-statistics) | 5 | 419 | 419 | 417 | 221 | 0 | 198 | 0 | 0 | 2001-03-31 to 2026-09-30 | 2026-09-30 |
| [Bankruptcy Abuse Prevention and Consumer Protection Act (BAPCPA) report](https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-abuse-prevention-and-consumer-protection-act-report) | 21 | 399 | 399 | 271 | 270 | 1 | 0 | 0 | 128 | 2007-12-31 to 2025-12-31 | 2025-12-31 |
| [Wiretap report](https://www.uscourts.gov/data-news/reports/statistical-reports/wiretap-reports) | 14 | 351 | 351 | 80 | 80 | 0 | 0 | 0 | 271 | 1997-12-31 to 2025-12-31 | 2025-12-31 |
| [Judicial Facts and Figures](https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-facts-and-figures) | 36 | 742 | 742 | 306 | 0 | 0 | 0 | 306 | 436 | none | 2025-09-30 |
| [Federal Court Management Statistics](https://www.uscourts.gov/data-news/reports/statistical-reports/federal-court-management-statistics) | 5 | 347 | 347 | 152 | 0 | 0 | 0 | 152 | 195 | none | 2026-06-30 |
| [Civil Justice Reform Act (CJRA) report](https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report) | 9 | 225 | 225 | 225 | 0 | 0 | 0 | 225 | 0 | none | 2026-03-31 |
| [Delayed-Notice Search Warrant report](https://www.uscourts.gov/data-news/reports/statistical-reports/delayed-notice-search-warrant-report) | 2 | 38 | 38 | 31 | 31 | 4 | 0 | 0 | 3 | 2006-09-30 to 2024-09-30 | 2024-09-30 |
| [Director's Report on the Foreign Intelligence Surveillance Courts' Activities](https://www.uscourts.gov/data-news/reports/statistical-reports/directors-report-foreign-intelligence-surveillance-courts-activities) | 1 | 11 | 11 | 11 | 11 | 0 | 0 | 0 | 0 | 2015-12-31 to 2025-12-31 | 2025-12-31 |
| [Crime Victims' Rights report (no tables; counts stated in each report)](https://www.uscourts.gov/data-news/reports/statistical-reports/crime-victims-rights-report) | 1 | 18 | 18 | 18 | 18 | 0 | 0 | 0 | 0 | 2005-12-31 to 2024-12-31 | 2024-12-31 |
| **All** | | 8427 | 8427 | 5254 | 4370 | 9 | 201 | 683 | 3164 | | |

## Held table-periods (fail their own printed totals)

| Publication | Table | Period | Failing tests | First failure (kind, row, column: printed vs sum of parts) | Period published from |
|---|---|---|---:|---|---|
| JB | B-1A | 2015-09-30 | 1 | coltotal, health_care, terminated/total: 102 vs 103 | gap |
| JB | B-2 | 2012-09-30 | 5 | national, national, filed: 10958 vs 5479 | gap |
| BAPCPA | BAPCPA 6 | 2019-12-31 | 1 | circuit, ca9, cases_refiled_after_dismissal_3: 2109 vs 2108 | gap |
| JB | M-4B | 2022-09-30 | 3 | coltotal, national, total: 42016 vs 42017 | gap |
| JB | V-1 | 2021-09-30 | 2 | national, national, services_provided_to_other_district_courts/civil_cases_terminated: 504 vs 472 | gap |

Report tables (reports.py) that fail their own printed totals, not published:

| Publication | Table | File | Failures (first) |
|---|---|---|---|
| DNSW | DNSW 2 (2014) | https://www.uscourts.gov/file/18430/download | Other: all applications 87 != warrants 67 + extensions 21; Kidnapping: all applications 22 != warrants 21 + extensions 0 |
| DNSW | DNSW 1 (2015) | https://www.uscourts.gov/file/20408/download | ca5 all_applications: printed 1924, courts add to 1923; ca9 all_applications: printed 3237, courts add to 3229; ca5 warrants/total: printed 1350, courts add to 1349; ca9 warrants/total: printed 1928, courts add to 1920;  |
| DNSW | DNSW 2 (2016) | https://www.uscourts.gov/file/24077/download | Total warrants/number 9191 != offense rows 9099; Total extensions/number 6050 != offense rows 6021; Other: all applications 188 != warrants 62 + extensions 5 |
| DNSW | DNSW 2 (2017) | https://www.uscourts.gov/sites/default/files/2017_Table_DNSW-2_v.1.xlsx | Total all_applications/number 22085 != offense rows 22083; Total warrants/number 14280 != offense rows 14279; Total extensions/number 7805 != offense rows 7804 |

## Before and after, by publication

Before: the audit generated 2026-10-24T03:00:43+00:00 (the previous build of this stream). After: this build.

| Publication | Listed | Acquired before | Acquired after | Parsed before | Parsed after | Published before | Published after | Held before | Held after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Statistical Tables for the Federal Judiciary | 1690 | 1131 | 1690 | 897 | 1210 | 897 | 1210 | 0 | 0 |
| Federal Judicial Caseload Statistics | 897 | 897 | 897 | 489 | 641 | 489 | 641 | 0 | 0 |
| Judicial Business of the United States Courts | 3290 | 2509 | 3290 | 1293 | 1892 | 1291 | 1888 | 2 | 4 |
| Bankruptcy Filings | 419 | 419 | 419 | 306 | 417 | 172 | 221 | 0 | 0 |
| Bankruptcy Abuse Prevention and Consumer Protection Act (BAPCPA) report | 399 | 399 | 399 | 172 | 271 | 171 | 270 | 1 | 1 |
| Wiretap report | 351 | 351 | 351 | 34 | 80 | 34 | 80 | 0 | 0 |
| Judicial Facts and Figures | 742 | 742 | 742 | 306 | 306 | 0 | 0 | 0 | 0 |
| Federal Court Management Statistics | 347 | 347 | 347 | 152 | 152 | 0 | 0 | 0 | 0 |
| Civil Justice Reform Act (CJRA) report | 225 | 225 | 225 | 225 | 225 | 0 | 0 | 0 | 0 |
| Delayed-Notice Search Warrant report | 38 | 0 | 38 | 0 | 31 | 0 | 31 | 0 | 4 |
| Director's Report on the Foreign Intelligence Surveillance Courts' Activities | 11 | 0 | 11 | 0 | 11 | 0 | 11 | 0 | 0 |
| Crime Victims' Rights report (no tables; counts stated in each report) | 18 | 0 | 18 | 0 | 18 | 0 | 18 | 0 | 0 |
| **All** | 8427 | 7020 | 8427 | 3874 | 5254 | 3054 | 4370 | 3 | 9 |

The report publications (Delayed-Notice Search Warrant, FISA courts, Crime Victims' Rights) are new rows: they are not in the caseload listing, so their 'listed' rows are the tables the reports print (one per table and period), or one per report.


## Corrections and additions in this build

- Acquired: the 559 Statistical Tables and 781 Judicial Business editions published only as PDF, with `acquire.py --pubs 77,78,79 --series ALL --pdf-only --min-free-gb 2.0` (one request per second, gzip, sha256 manifest).
- Read: PDF-only editions by the word-position reader (pdf_grid.py, pdf_align.py, pdf_grid_ingest.py: court and category tables, tables printed in halves, BAPCPA sort-code columns, editions printed under an earlier table number); the Bankruptcy Filings printouts of 2001-2008 (bf_legacy.py, Tables F and F-2); category tables whose rows the workbook does not indent (C-4, BAP-2, B-1A, A-1 and others) from their own printed sums (hierarchy.py). Every such period is reconciled against its own printed totals as before, and a second path re-reads a sample of figures with another text extraction (verify_readers.py).
- Courts: 'IL,E' is the former Eastern District of Illinois (illinoised); 'AK,E', 'AK,W' and 'AR' in Judicial Business S-19 for FY2017 name no court and stay unmatched; the combined Arkansas bankruptcy row is its own record (arcomb), and the E.D. and W.D. records say from which period they are printed only in it.
- Not read here: Federal Court Management Statistics, Judicial Facts and Figures and Civil Justice Reform Act files, which the streams that own them publish (an intermediate run of this stream had parsed 39 FCMS workbooks; they are not published).
- New publications outside the caseload listing (acquire_reports.py, reports.py): the Delayed-Notice Search Warrant tables (uscourts_dnsw), Table 1 of the Director's reports on the FISA courts (uscourts_fisc) and the counts stated in the Crime Victims' Rights reports, which print no table (uscourts_cvra).
- Wiretap: the jurisdiction Tables 2-6 published only as PDF (1997-2015) are read where their columns match the workbook editions (rotated headings by their letters, column by column) and the Total equals FEDERAL plus every jurisdiction in every count column; the 2016 and 2017 workbooks, which print the local jurisdictions without their state rows, are not read (a county named like a state would take the state's series); Table 1 (statutes), Tables 7-10 (multi-year summaries) and A-1/B-1 (one row per order) are not jurisdiction tables and are not read.

## Verification and cross-checks

Second code path (verify_uscourts_tables.py, no shared parser): 39 of 40 random court cells found again in the source workbook, 40 of 40 category-row cells, 18,469 district sums equal the printed Total (0 mismatches, 4,318 incomplete), 8 of 10 workbook editions agree with their own PDF row for row, 4,109 of 4,114 Wiretap groupings re-added from the stored figures, 18,353 of 25,101 PDF-read figures equal the next edition's prior-year column (the 6,748 others are figures the next edition revised, mostly bankruptcy cases pending; each period keeps its own edition's figure).

Readers added on 2026-10-24 (verify_readers.py, a second text extraction and the other publications): 79 of 80 random figures read by word positions found again at the same place by pdftotext -layout; 64,145 of 64,145 figures read by the new readers equal the same table, period, row and column in another publication (0 differ); 6,572 printout rows re-added from the stored figures (0 failures). The report tables (Delayed-Notice Search Warrant, FISA courts) are checked inside reports.py: every PDF figure is found again with the other text extraction, every spreadsheet figure is read again with openpyxl directly. The Wiretap groupings that do not re-add are the periods where a jurisdiction printed twice in one state with different figures is left out (its figures are in the printed Total).

Independent reads of the publisher's own files: the PDF text layer (pdftotext -layout) of the edition a held workbook belongs to, and a page-to-text conversion of two PDFs, compared figure by figure with the built datasets. The original file's text layer is authoritative; a conversion is a cross-check only.

| Check | Method | Compared | Match |
|---|---|---:|---:|
| [Table F-2 (Three Months), quarter ending September 30, 2026: Total All Chapters for every court](https://www.uscourts.gov/sites/default/files/document/bf_f2.3_0930.2026.pdf) | page-to-text conversion | 93 | 93 |
| [Table F-2 (Three Months), quarter ending September 30, 2026: national Total row (all chapters, chapters 7, 11, 13, other chapters, business and nonbusiness all chapters)](https://www.uscourts.gov/sites/default/files/document/bf_f2.3_0930.2026.pdf) | page-to-text conversion | 7 | 7 |
| [Judicial Business Table H-1, FY2010 (an edition published only as PDF, read from its text layer): Total Pretrial Services Cases Activated for every row](https://www.uscourts.gov/sites/default/files/statistics_import_dir/H01Sep10.pdf) | page-to-text conversion | 105 | 105 |
| [Held: Judicial Business M-4B, FY2022 - the PDF of the same edition prints Total 42,016 while its printed parts add up to 42,017](https://www.uscourts.gov/sites/default/files/data_tables/jb_m4b_0930.2022.pdf) | PDF text layer | 1 | 1 |
| [Held: Judicial Business V-1, FY2021 - the PDF prints an unlabelled 'Active 1 32 20' row twice (once with zeros, once with dashes) beside the court rows; the Total 504 is not the sum of the labelled courts](https://www.uscourts.gov/sites/default/files/data_tables/jb_v1_0930.2021.pdf) | PDF text layer | 1 | 1 |
| [Held: BAPCPA Table 6, 2019 - the PDF prints the 9th Circuit's 'cases refiled after dismissal' as 2,109 while its districts add up to 2,108](https://www.uscourts.gov/sites/default/files/data_tables/bapcpa_6_1231.2019.pdf) | PDF text layer | 1 | 1 |


## Not acquired

Every listed table-period is stored. Report publications: the Crime Victims' Rights reports for 2008 and 2011 are not linked from the publisher's report page; the 2008 Delayed-Notice Search Warrant report (https://www.uscourts.gov/file/18402/download) is a scanned file with no text layer, so its figures are not read.


## Statistical Tables for the Federal Judiciary

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/statistical-tables-federal-judiciary

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B | 256 | 256 | 157 | 157 | 0 | 0 | 0 | 99 |
| C | 306 | 306 | 219 | 219 | 0 | 0 | 0 | 87 |
| D | 405 | 405 | 259 | 259 | 0 | 0 | 0 | 146 |
| E | 138 | 138 | 104 | 104 | 0 | 0 | 0 | 34 |
| F | 151 | 151 | 146 | 146 | 0 | 0 | 0 | 5 |
| H | 187 | 187 | 137 | 137 | 0 | 0 | 0 | 50 |
| J | 102 | 102 | 93 | 93 | 0 | 0 | 0 | 9 |
| JCI | 50 | 50 | 0 | 0 | 0 | 0 | 0 | 50 |
| M | 49 | 49 | 49 | 49 | 0 | 0 | 0 | 0 |
| T | 25 | 25 | 25 | 25 | 0 | 0 | 0 | 0 |
| V | 14 | 14 | 14 | 14 | 0 | 0 | 0 | 0 |
| X | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| B | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending | 51 | 51 | 51 | 51 | 0 | 0 | 0 | 0 | 2001-06-30 to 2026-06-30 |  |
| B-1 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending, by Nature of Proceeding | 51 | 51 | 25 | 25 | 0 | 0 | 0 | 26 | 2014-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (21) |
| B-4 | U.S. Courts of Appeals - Median Times for Cases Terminated on the Merits | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |  | PDF read by word positions but rejected by a gate: group heading 'Terminated on the Merits' is not printed over its columns (missing ['merit']) (1) |
| B-5 | U.S. Courts of Appeals - Decisions in Cases Terminated on the Merits, by Nature of Proceed | 51 | 51 | 41 | 41 | 0 | 0 | 0 | 10 | 2001-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (8) |
| B-7 | U.S. Courts of Appeals - Civil and Criminal Cases Filed, by Circuit and Nature of Suit or  | 51 | 51 | 22 | 22 | 0 | 0 | 0 | 29 | 2015-12-31 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (27) |
| B-8 | U.S. Court of Appeals for the Federal Circuit - Cases Filed, Terminated, and Pending | 51 | 51 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (32) |
| C | U.S. District Courts - Civil Cases Filed, Terminated, and Pending | 51 | 51 | 46 | 46 | 0 | 0 | 0 | 5 | 2001-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca2')] extra [] (1) |
| C-1 | U.S. District Courts - Civil Cases Filed, Terminated, and Pending, by Jurisdiction | 51 | 51 | 46 | 46 | 0 | 0 | 0 | 5 | 2001-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (3) |
| C-2 | U.S. District Courts - Civil Cases Filed, by Jurisdiction and Nature of Suit | 51 | 51 | 41 | 41 | 0 | 0 | 0 | 10 | 2001-12-31 to 2026-06-30 | PDF read by word positions but rejected by a gate: 11 row totals smaller than the rows under them, first real_property_actions_total y0/total: 7296 vs 304557 (1) |
| C-3 | U.S. District Courts - Civil Cases Filed, by Jurisdiction, Nature of Suit, and District | 51 | 51 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (27) |
| C-4 | U.S. District Courts - Civil Cases Terminated, by Nature of Suit and Action Taken | 51 | 51 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (33) |
| C-5 | U.S. District Courts - Median Time From Filing to Disposition of Civil Cases, by Action Ta | 51 | 51 | 50 | 50 | 0 | 0 | 0 | 1 | 2001-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: group heading 'During Trial' is not printed over its columns (missing ['during']) (1) |
| D | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 51 | 51 | 48 | 48 | 0 | 0 | 0 | 3 | 2001-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: a line prints 11 figures where the page has 10 columns: 1ST 2,042 1,900 - 7.0 2,000 1,860 - 7.0 2,499 2,539 1.6 (1) |
| D Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending (Including Transfers) | 51 | 51 | 46 | 46 | 0 | 0 | 0 | 5 | 2001-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: a line prints 12 figures where the page has 9 columns: 1ST 1,645 1,394 - 15.3 1,943 1,445 - 25.6 1,558 1,507 - 3.3 (1) |
| D-1 | U.S. District Courts - Criminal Fugitive Defendants Filed, Terminated, and Pending (Includ | 51 | 51 | 23 | 23 | 0 | 0 | 0 | 28 | 2012-12-31 to 2026-06-30 | PDF read by word positions but rejected by a gate: group heading 'Not Terminated as of December 31, 2016' is not printed over its columns (missing ['december', 'not', 'terminated']) (10) |
| D-1 Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending, by Level of Offense | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 21 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (20) |
| D-1A | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-2 | U.S. District Courts - Criminal Defendants Filed, by Offense | 51 | 51 | 45 | 45 | 0 | 0 | 0 | 6 | 2001-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: rows with an empty cell: ['VETERANS AND ALLOTMENTS'] (1) |
| D-2 Cases | U.S. District Courts - Criminal Cases Filed, by Offense | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 21 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (20) |
| D-3 | U.S. District Courts - Criminal Defendants Filed, by Offense and District | 51 | 51 | 38 | 38 | 0 | 0 | 0 | 13 | 2005-12-31 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (10) |
| D-3 Cases | U.S. District Courts - Criminal Cases Filed, by Offense and District | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 21 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (21) |
| D-3A | U.S. District Courts - Criminal Felony Defendants Filed, by Offense and District | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-4 | U.S. District Courts - Criminal Defendants Terminated, by Type of Disposition and Offense | 51 | 51 | 23 | 23 | 0 | 0 | 0 | 28 | 2010-12-31 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (19) |
| D-5 | U.S. District Courts - Criminal Defendants Sentenced After Conviction, by Type of Sentence | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-6 | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-6A | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-14 | U.S. District Courts - Motions for Compassionate Release, or to Modify or Reduce Sentence, | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 2026-06-30 to 2026-06-30 |  |
| E-1 | Federal Probation System - Persons Received for and Removed From Post-Conviction Supervisi | 50 | 50 | 35 | 35 | 0 | 0 | 0 | 15 | 2005-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| E-2 | Federal Probation System - Persons Under Post-Conviction Supervision | 50 | 50 | 41 | 41 | 0 | 0 | 0 | 9 | 2005-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| E-7A | Federal Probation System - Post-Conviction Supervision Cases Terminated With and Without R | 38 | 38 | 28 | 28 | 0 | 0 | 0 | 10 | 2010-06-30 to 2025-12-31 | spreadsheet rejected by a gate: 6/95 text cells (3) |
| F | U.S. Bankruptcy Courts - Bankruptcy Cases Filed, Terminated, and Pending | 50 | 50 | 50 | 50 | 0 | 0 | 0 | 0 | 2001-06-30 to 2026-06-30 |  |
| F-2 | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 50 | 50 | 50 | 50 | 0 | 0 | 0 | 0 | 2001-06-30 to 2026-06-30 |  |
| F-8 | U.S. Bankruptcy Courts - Adversary Proceedings Filed, Terminated, and Pending | 51 | 51 | 46 | 46 | 0 | 0 | 0 | 5 | 2002-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (2) |
| H-1 | Federal Pretrial Services - Cases Activated | 50 | 50 | 36 | 36 | 0 | 0 | 0 | 14 | 2005-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| H-2 | Federal Pretrial Services - Interviews and Types of Pretrial Services Reports | 50 | 50 | 30 | 30 | 0 | 0 | 0 | 20 | 2005-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| H-3 | Federal Pretrial Services - Recommendations Made for Initial Pretrial Release | 6 | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 2023-06-30 to 2025-12-31 |  |
| H-7 | Federal Pretrial Services - Defendants Received for and Under Pretrial Supervision | 40 | 40 | 38 | 38 | 0 | 0 | 0 | 2 | 2006-06-30 to 2025-12-31 | PDF read by word positions but rejected by a gate: court set differs: missing [('national', 'national')] extra [] (1) |
| H-13 | Federal Pretrial Services - Cases Terminated, by Type of Disposition | 41 | 41 | 27 | 27 | 0 | 0 | 0 | 14 | 2005-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (14) |
| J-1 | U.S. District Courts - Grand Juror Service | 51 | 51 | 47 | 47 | 0 | 0 | 0 | 4 | 2001-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (3) |
| J-2 | U.S. District Courts - Petit Juror Service on Days Jurors Were Selected for Trial | 51 | 51 | 46 | 46 | 0 | 0 | 0 | 5 | 2001-06-30 to 2026-06-30 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (3) |
| JCI | U.S. Federal Courts - Work of the Federal Judiciary | 50 | 50 | 0 | 0 | 0 | 0 | 0 | 50 |  | PDF read by word positions but rejected by a gate: no period in the title (12) |
| M-1 | U.S. District Courts - Class A Misdemeanor Defendants Disposed of by U.S. Magistrate Judge | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| M-2 | U.S. District Courts - Petty Offense Defendants Disposed of by U.S. Magistrate Judges, by  | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| M-3 | U.S. District Courts - Felony Preliminary Proceedings Handled by U.S. Magistrate Judges Un | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| M-4 | U.S. District Courts - Criminal Pretrial Matters Handled by U.S. Magistrate Judges Under 2 | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| M-5 | U.S. District Courts - Civil Consent Cases Terminated by U.S. Magistrate Judges Under 28 U | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| M-7 | U.S. District Courts - Matters Disposed of by U.S. Magistrate Judges, by Matter Type | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| M-8 | U.S. District Courts - Civil Consent Case Matters by U.S. Magistrate Judges Under 28 U.S.C | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| T-1 | U.S. District Courts - Civil and Criminal Trials Completed | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| T-2 | U.S. District Courts - Lengths of Civil and Criminal Trials Completed | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| T-3 | U.S. District Courts - Median Time From Filings To Trial For Civil Cases In Which Trials W | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| T-19 | - U.S. District Courts—Supervision Hearings in Trials and Nontrials, by District | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2023-12-31 to 2025-06-30 |  |
| V-1 | U.S. District Courts - Services Provided to and Received From Other District Courts | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| V-2 | U.S. District Courts - Services Provided by Visiting Judges in Cases Terminated, by Circui | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| X-1A | U.S. District Courts - Weighted and Unweighted Filings per Authorized Judgeship | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |

Never parsed or not published, by reason:

- 242 table-periods: PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns
- 61 table-periods: PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns
- 14 table-periods: PDF read by word positions but rejected by a gate: no period in the title
- 10 table-periods: PDF read by word positions but rejected by a gate: group heading 'Not Terminated as of December 31, 2016' is not printed over its columns (missing ['december', 'not', 'terminated'])
- 7 table-periods: PDF read by word positions but rejected by a gate: group heading 'Not Interviewed1' is not printed over its columns (missing ['not'])
- 6 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra []
- 6 table-periods: PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows
- 6 table-periods: PDF read by word positions but rejected by a gate: group heading 'Not Terminated as of December 31, 2016' is not printed over its columns (missing ['december'])
- 5 table-periods: PDF read by word positions but rejected by a gate: group heading 'Prisoner Petitions' is not printed over its columns (missing ['prisoner'])
- 5 table-periods: PDF read by word positions but rejected by a gate: group heading 'On Procedural Grounds' is not printed over its columns (missing ['ground'])
- 3 table-periods: spreadsheet rejected by a gate: 6/95 text cells
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca2')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca7', 22235, 19772)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca11', 31001, 29923)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca9', 47716, 47077)
- 1 table-periods: spreadsheet rejected by a gate: title table C-2 != listing C
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('total_juries_selected_civil_and_criminal', 'national', 4680, 4684)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 8 figures where the page has 7 columns: WY 578 31.3 32.2 36.5 35.8 0 .7 16
- 1 table-periods: PDF read by word positions but rejected by a gate: group heading 'During Trial' is not printed over its columns (missing ['during'])
- 1 table-periods: PDF read by word positions but rejected by a gate: 11 row totals smaller than the rows under them, first real_property_actions_total y0/total: 7296 vs 304557
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 row totals smaller than the rows under them, first personal_injury_total y0/total: 44731 vs 54116
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 row totals smaller than the rows under them, first tort_actions_total y0/total: 53809 vs 82349
- 1 table-periods: PDF read by word positions but rejected by a gate: 6 row totals smaller than the rows under them, first tort_actions_total y0/total: 70204 vs 79946
- 1 table-periods: PDF read by word positions but rejected by a gate: 4 row totals smaller than the rows under them, first intellectual_property_rights_total y0/total: 13473 vs 14534
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 row totals smaller than the rows under them, first personal_injury_total y0/total: 77443 vs 126490
- 1 table-periods: PDF read by word positions but rejected by a gate: 4 row totals smaller than the rows under them, first intellectual_property_rights_total y0/total: 13199 vs 14183
- 1 table-periods: PDF read by word positions but rejected by a gate: 6 row totals smaller than the rows under them, first personal_injury_total y0/total: 62318 vs 419261
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 row totals smaller than the rows under them, first contract_actions_total/recovery_of_overpayments_and_enforcement_of_judgments y0/total: 1670 vs 13836
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Federal Employers Liability Act 3 13']
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 9 columns: FL,M 40 86 3 3 9 56 103 8 - 26
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 16 columns: 31 31
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Labor']
- 1 table-periods: PDF read by word positions but rejected by a gate: 25 row totals smaller than the rows under them, first embezzlement_total total_defendants: 504 vs 13049
- 1 table-periods: PDF read by word positions but rejected by a gate: 35 row totals smaller than the rows under them, first embezzlement_total total_defendants: 480 vs 12250
- 1 table-periods: PDF read by word positions but rejected by a gate: 14 row totals smaller than the rows under them, first property_offenses_total/embezzlement_total total_defendants: 518 vs 12262
- 1 table-periods: PDF read by word positions but rejected by a gate: 17 row totals smaller than the rows under them, first embezzlement_total total_defendants: 398 vs 11106
- 1 table-periods: PDF read by word positions but rejected by a gate: 16 row totals smaller than the rows under them, first embezzlement_total total_defendants: 398 vs 10455
- 1 table-periods: PDF read by word positions but rejected by a gate: 25 row totals smaller than the rows under them, first property_offenses_total/larceny_and_theft_total total_defendants: 2336 vs 3120
- 1 table-periods: PDF read by word positions but rejected by a gate: 9 row totals smaller than the rows under them, first national total_defendants: 76891 vs 77356
- 1 table-periods: PDF read by word positions but rejected by a gate: 17 row totals smaller than the rows under them, first embezzlement_total total_defendants: 365 vs 8715
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('terminated/y0', 'ca9', 13975, 13988)
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['3RD']
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca8', 3523, 2256)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 12 figures where the page has 11 columns: 2ND 4,569 4,527 4,280 225 22 14 28 1 0,135 9,327 739 69
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 11 columns: Page 6 of 6
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 7 columns: - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 12 figures where the page has 11 columns: Other Private Civil 1,560 327 42.8 667 548 20 93 6 - - 1 3.9
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['VETERANS AND ALLOTMENTS']
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['OTHER ROBBERY OFFENSES', 'TERRORISM', 'OTHER VIOLENT OFFENSES']
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 6 figures where the page has 5 columns: TRAFFIC OFFENSES, TOTAL 5,254 4,755 4,143 3,672 4,362 18.8
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 12 figures where the page has 6 columns: PROPERTY BURGLARY OFFENSES, TOTAL 15,625 82 15,355 67 15,536 71 15,901 50 16,216 58 16.0 2
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first national y0: 102096 vs 132478
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 12 figures where the page has 9 columns: 1ST 1,645 1,394 - 15.3 1,943 1,445 - 25.6 1,558 1,507 - 3.3
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 12 figures where the page has 9 columns: 1ST 1,442 1,360 - 5.7 1,497 1,399 - 6.5 1,528 1,489 - 2.6
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 9 columns: MA 429 394 - 8.2 356 367 3.1 752 779 3.6
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca5'), ('circuit', 'ca6'), ('circuit', 'ca7'), ('circuit', 'ca8'), ('district', 'ared'), ('district', 'arwd')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: 15 roll-up identity failures, first ('filed/y0', 'ca1', 1526, 953)
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1993-06-30 differs from listing 2002-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1994-06-30 differs from listing 2003-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1996-06-30 differs from listing 2005-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1996-12-31 differs from listing 2005-12-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1997-06-30 differs from listing 2006-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1997-12-31 differs from listing 2006-12-31
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 8 columns: Cases Terminated 260,763 264,166 264,734 249,960 - 4.1 - 5.4 - 5.6
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1998-12-31 differs from listing 2007-12-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1999-06-30 differs from listing 2008-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1999-12-30 differs from listing 2008-12-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2000-06-30 differs from listing 2009-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2000-12-31 differs from listing 2009-12-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2002-12-31 differs from listing 2011-12-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2004-12-31 differs from listing 2013-12-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2005-06-30 differs from listing 2014-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2006-06-30 differs from listing 2015-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2006-12-31 differs from listing 2015-12-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2007-06-30 differs from listing 2016-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2007-12-31 differs from listing 2016-12-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2008-06-30 differs from listing 2017-06-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2008-12-31 differs from listing 2017-12-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2009-06-30 differs from listing 2018-06-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2009-12-31 differs from listing 2018-12-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2010-06-30 differs from listing 2019-06-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2010-12-31 differs from listing 2019-12-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2011-06-30 differs from listing 2020-06-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2011-12-31 differs from listing 2020-12-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2012-06-30 differs from listing 2021-06-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2012-12-31 differs from listing 2021-12-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2013-06-30 differs from listing 2022-06-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2013-12-31 differs from listing 2022-12-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2014-06-30 differs from listing 2023-06-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2014-12-31 differs from listing 2023-12-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2015-06-30 differs from listing 2024-06-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2015-12-31 differs from listing 2024-12-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2016-06-30 differs from listing 2025-06-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2016-12-31 differs from listing 2025-12-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2017-06-30 differs from listing 2026-06-30
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 11 figures where the page has 10 columns: 1ST 2,042 1,900 - 7.0 2,000 1,860 - 7.0 2,499 2,539 1.6
- 1 table-periods: PDF read by word positions but rejected by a gate: 6 roll-up identity failures, first ('filed/y0', 'ca6', 6296, 5584)
- 1 table-periods: PDF read by word positions but rejected by a gate: a court is printed twice with different figures
- 1 table-periods: PDF read by word positions but rejected by a gate: a count column prints figures with decimals: RI total_hours_in_session 20.1, HI total_hours_in_session 20.7, ID total_hours_in_session 20.9
- 1 table-periods: PDF read by word positions but rejected by a gate: 12 roll-up identity failures, first ('total_civil_cases/pending_december_31_ym1', 'ca8', 12081, 9847)
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 roll-up identity failures, first ('private_civil_cases/pending_december_31_y0', 'ca5', 9313, 49313)
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['General Location Jurisdiction', 'Other General Offenses']
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['General Location Jurisdiction']
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody without_revocations/early_term/total: 6 vs 220
- 1 table-periods: PDF read by word positions but rejected by a gate: 7 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 804 vs 1225
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 634 vs 1169
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 611 vs 958
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 543 vs 894
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 481 vs 845
- 1 table-periods: spreadsheet rejected by a gate: 7/95 text cells
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca5'), ('circuit', 'ca9'), ('district', 'akd'), ('district', 'laed'), ('national', 'national')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca7'), ('district', 'scd'), ('district', 'vawd')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 4 figures where the page has 2 columns: O K , N 2 93 2 63
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total_pretrial_services_cases_activated', 'ca8', 5499, 5009)
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 roll-up identity failures, first ('total_pretrial_services_cases_activated', 'ca4', 5641, 1822)
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['NY,N']
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['MD']
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca5'), ('district', 'laed')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['ME', 'NJ', 'LA,M']
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['MO,W']
- 1 table-periods: PDF read by word positions but rejected by a gate: 12 roll-up identity failures, first ('received_for_post_conviction_supervision/total_received', 'national', 67461, 64692)
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('national', 'national')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: 6 roll-up identity failures, first ('defendents_under_supervision_as_of_january_1_y0', 'ca9', 4871, 4794)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 6 columns: CUSTOMS80 77 77 59 53 -10.2
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 12 figures where the page has 11 columns: 4TH 7,822 7,764 4,703 2,522 539 27 31 1 1,902 5,235 6,369 298
- 1 table-periods: PDF read by word positions but rejected by a gate: group heading 'Terminated on the Merits' is not printed over its columns (missing ['merit'])

## Federal Judicial Caseload Statistics

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/federal-judicial-caseload-statistics

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B | 130 | 130 | 79 | 79 | 0 | 0 | 0 | 51 |
| BAP | 36 | 36 | 36 | 36 | 0 | 0 | 0 | 0 |
| C | 156 | 156 | 115 | 115 | 0 | 0 | 0 | 41 |
| D | 206 | 206 | 128 | 128 | 0 | 0 | 0 | 78 |
| E | 70 | 70 | 46 | 46 | 0 | 0 | 0 | 24 |
| F | 78 | 78 | 74 | 74 | 0 | 3 | 0 | 1 |
| H | 95 | 95 | 67 | 67 | 0 | 0 | 0 | 28 |
| J | 52 | 52 | 48 | 48 | 0 | 0 | 0 | 4 |
| JCI | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 26 |
| M | 21 | 21 | 21 | 21 | 0 | 0 | 0 | 0 |
| T | 15 | 15 | 15 | 15 | 0 | 0 | 0 | 0 |
| V | 8 | 8 | 8 | 8 | 0 | 0 | 0 | 0 |
| X | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| B | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending | 26 | 26 | 25 | 25 | 0 | 0 | 0 | 1 | 2001-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca10')] extra [] (1) |
| B-1 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending, by Nature of Proceeding | 26 | 26 | 13 | 13 | 0 | 0 | 0 | 13 | 2014-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (11) |
| B-5 | U.S. Courts of Appeals - Decisions in Cases Terminated on the Merits, by Nature of Proceed | 26 | 26 | 21 | 21 | 0 | 0 | 0 | 5 | 2001-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (4) |
| B-7 | U.S. Courts of Appeals - Civil and Criminal Cases Filed, by Circuit and Nature of Suit or  | 26 | 26 | 11 | 11 | 0 | 0 | 0 | 15 | 2015-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (13) |
| B-8 | U.S. Court of Appeals for the Federal Circuit - Cases Filed, Terminated, and Pending | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (17) |
| BAP-1 | U.S. Bankruptcy Appellate Panels - Cases Filed, Terminated, and Pending | 18 | 18 | 18 | 18 | 0 | 0 | 0 | 0 | 2009-03-31 to 2026-03-31 |  |
| BAP-2 | U.S. Bankruptcy Appellate Panels - Cases Filed, Terminated, and Pending, by Chapter of the | 18 | 18 | 18 | 18 | 0 | 0 | 0 | 0 | 2009-03-31 to 2026-03-31 |  |
| C | U.S. District Courts - Civil Cases Filed, Terminated, and Pending | 26 | 26 | 25 | 25 | 0 | 0 | 0 | 1 | 2001-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca10', 10154, 7321) (1) |
| C-1 | U.S. District Courts - Civil Cases Filed, Terminated, and Pending, by Jurisdiction | 26 | 26 | 25 | 25 | 0 | 0 | 0 | 1 | 2001-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: 12 roll-up identity failures, first ('total_civil_cases/pending_march_31_ym1', 'ca7', 32132, 29062) (1) |
| C-2 | U.S. District Courts - Civil Cases Filed, by Jurisdiction and Nature of Suit | 26 | 26 | 20 | 20 | 0 | 0 | 0 | 6 | 2002-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: 12 row totals smaller than the rows under them, first real_property_actions_total y0/total: 6901 vs 315692 (1) |
| C-3 | U.S. District Courts - Civil Cases Filed, by Jurisdiction, Nature of Suit, and District | 26 | 26 | 10 | 10 | 0 | 0 | 0 | 16 | 2011-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (13) |
| C-4 | U.S. District Courts - Civil Cases Terminated, by Nature of Suit and Action Taken | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (16) |
| C-5 | U.S. District Courts - Median Time From Filing to Disposition of Civil Cases, by Action Ta | 26 | 26 | 26 | 26 | 0 | 0 | 0 | 0 | 2001-03-31 to 2026-03-31 |  |
| D | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 26 | 26 | 21 | 21 | 0 | 0 | 0 | 5 | 2004-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 9 columns: UT 700 694 - .9 685 548 -20.0 394 540 37.1 (1) |
| D Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending (Including Transfers) | 26 | 26 | 22 | 22 | 0 | 0 | 0 | 4 | 2001-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: a line prints 12 figures where the page has 9 columns: 1ST 1,668 1,351 - 19.0 1,671 1,462 - 12.5 1,526 1,415 - 7.3 (1) |
| D-1 | U.S. District Courts - Criminal Fugitive Defendants Filed, Terminated, and Pending (Includ | 26 | 26 | 13 | 13 | 0 | 0 | 0 | 13 | 2013-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: group heading 'Not Terminated as of March 31, 2017' is not printed over its columns (missing ['march', 'not', 'terminated']) (10) |
| D-1 Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending, by Level of Offense | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 11 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (11) |
| D-1A | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| D-2 | U.S. District Courts - Criminal Defendants Filed, by Offense | 26 | 26 | 26 | 26 | 0 | 0 | 0 | 0 | 2001-03-31 to 2026-03-31 |  |
| D-2 Cases | U.S. District Courts - Criminal Cases Filed, by Offense | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 11 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (11) |
| D-3 | U.S. District Courts - Criminal Defendants Filed, by Offense and District | 26 | 26 | 18 | 18 | 0 | 0 | 0 | 8 | 2007-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (5) |
| D-3 Cases | U.S. District Courts - Criminal Cases Filed, by Offense and District | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 11 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (11) |
| D-3A | U.S. District Courts - Criminal Felony Defendants Filed, by Offense and District | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| D-4 | U.S. District Courts - Criminal Defendants Terminated, by Type of Disposition and Offense | 26 | 26 | 11 | 11 | 0 | 0 | 0 | 15 | 2011-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (10) |
| D-5 | U.S. District Courts - Criminal Defendants Sentenced After Conviction, by Type of Sentence | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2023-03-31 to 2026-03-31 |  |
| D-6 | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| D-6A | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| D-14 | U.S. District Courts - Motions for Compassionate Release, or to Modify or Reduce Sentence, | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 2026-03-31 to 2026-03-31 |  |
| E-1 | Federal Probation System - Persons Received for and Removed From Post-Conviction Supervisi | 25 | 25 | 17 | 17 | 0 | 0 | 0 | 8 | 2007-03-31 to 2025-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (5) |
| E-2 | Federal Probation System - Persons Under Post-Conviction Supervision | 25 | 25 | 17 | 17 | 0 | 0 | 0 | 8 | 2006-03-31 to 2025-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (5) |
| E-7A | Federal Probation System - Post-Conviction Supervision Cases Terminated With and Without R | 20 | 20 | 12 | 12 | 0 | 0 | 0 | 8 | 2010-03-31 to 2025-03-31 | PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 488 vs 887 (2) |
| F | U.S. Bankruptcy Courts - Bankruptcy Cases Filed, Terminated, and Pending | 26 | 26 | 24 | 24 | 0 | 2 | 0 | 0 | 2001-03-31 to 2026-03-31 |  |
| F-2 | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 26 | 26 | 25 | 25 | 0 | 1 | 0 | 0 | 2001-03-31 to 2026-03-31 |  |
| F-8 | U.S. Bankruptcy Courts - Adversary Proceedings Filed, Terminated, and Pending | 26 | 26 | 25 | 25 | 0 | 0 | 0 | 1 | 2002-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (1) |
| H-1 | Federal Pretrial Services - Cases Activated | 25 | 25 | 19 | 19 | 0 | 0 | 0 | 6 | 2006-03-31 to 2025-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (5) |
| H-2 | Federal Pretrial Services - Interviews and Types of Pretrial Services Reports | 25 | 25 | 13 | 13 | 0 | 0 | 0 | 12 | 2006-03-31 to 2025-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (5) |
| H-3 | Federal Pretrial Services - Recommendations Made for Initial Pretrial Release | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-03-31 to 2025-03-31 |  |
| H-7 | Federal Pretrial Services - Defendants Received for and Under Pretrial Supervision | 20 | 20 | 20 | 20 | 0 | 0 | 0 | 0 | 2006-03-31 to 2025-03-31 |  |
| H-13 | Federal Pretrial Services - Cases Terminated, by Type of Disposition | 22 | 22 | 12 | 12 | 0 | 0 | 0 | 10 | 2013-03-31 to 2025-03-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| J-1 | U.S. District Courts - Grand Juror Service | 26 | 26 | 22 | 22 | 0 | 0 | 0 | 4 | 2003-03-31 to 2026-03-31 | PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total_sessions_convened', 'national', 10158, 10134) (1) |
| J-2 | U.S. District Courts - Petit Juror Service on Days Jurors Were Selected for Trial | 26 | 26 | 26 | 26 | 0 | 0 | 0 | 0 | 2001-03-31 to 2026-03-31 |  |
| JCI | U.S. Federal Courts - Work of the Federal Judiciary | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 26 |  | PDF read by word positions but rejected by a gate: no period in the title (7) |
| M-1 | U.S. District Courts - Class A Misdemeanor Defendants Disposed of by U.S. Magistrate Judge | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| M-2 | U.S. District Courts - Petty Offense Defendants Disposed of by U.S. Magistrate Judges, by  | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| M-3 | U.S. District Courts - Felony Preliminary Proceedings Handled by U.S. Magistrate Judges Un | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| M-4 | U.S. District Courts - Criminal Pretrial Matters Handled by U.S. Magistrate Judges Under 2 | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| M-5 | U.S. District Courts - Civil Consent Cases Terminated by U.S. Magistrate Judges Under 28 U | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| M-7 | U.S. District Courts - Matters Disposed of by U.S. Magistrate Judges, by Matter Type | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| M-8 | U.S. District Courts - Civil Consent Case Matters by U.S. Magistrate Judges Under 28 U.S.C | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| T-1 | U.S. District Courts - Civil and Criminal Trials Completed | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2023-03-31 to 2026-03-31 |  |
| T-2 | U.S. District Courts - Lengths of Civil and Criminal Trials Completed | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2023-03-31 to 2026-03-31 |  |
| T-3 | U.S. District Courts - Median Time From Filings To Trial For Civil Cases In Which Trials W | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2023-03-31 to 2026-03-31 |  |
| T-19 | U.S. District Courts - Supervision Hearings in Trials and Nontrials | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| V-1 | U.S. District Courts - Services Provided to and Received From Other District Courts | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2023-03-31 to 2026-03-31 |  |
| V-2 | U.S. District Courts - Services Provided by Visiting Judges in Cases Terminated, by Circui | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2023-03-31 to 2026-03-31 |  |
| X-1A | U.S. District Courts - Weighted and Unweighted Filings per Authorized Judgeship | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2023-03-31 to 2026-03-31 |  |

Never parsed or not published, by reason:

- 119 table-periods: PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns
- 33 table-periods: PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns
- 10 table-periods: PDF read by word positions but rejected by a gate: group heading 'Not Terminated as of March 31, 2017' is not printed over its columns (missing ['march', 'not', 'terminated'])
- 7 table-periods: PDF read by word positions but rejected by a gate: no period in the title
- 6 table-periods: PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows
- 4 table-periods: PDF read by word positions but rejected by a gate: group heading 'Not Interviewed1' is not printed over its columns (missing ['not'])
- 3 table-periods: PDF read by word positions but rejected by a gate: group heading 'Prisoner Petitions' is not printed over its columns (missing ['prisoner'])
- 2 table-periods: PDF read by word positions but rejected by a gate: group heading 'On Procedural Grounds' is not printed over its columns (missing ['ground'])
- 2 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 488 vs 887
- 2 table-periods: spreadsheet rejected by a gate: 6/95 text cells
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 14 figures where the page has 13 columns: TOTAL CRIMINAL CASES 11,116 83 510 818 563 956 2,111 887 542 58 5 1,947 505 1,609
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['']
- 1 table-periods: PDF read by word positions but rejected by a gate: 12 roll-up identity failures, first ('total_civil_cases/pending_march_31_ym1', 'ca7', 32132, 29062)
- 1 table-periods: PDF read by word positions but rejected by a gate: 12 row totals smaller than the rows under them, first real_property_actions_total y0/total: 6901 vs 315692
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['STATE REAPPORTIONMENT SUITS9']
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 row totals smaller than the rows under them, first personal_injury_total y0/total: 46077 vs 57594
- 1 table-periods: PDF read by word positions but rejected by a gate: 6 row totals smaller than the rows under them, first tort_actions_total y0/total: 83570 vs 100070
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 row totals smaller than the rows under them, first tort_actions_total y0/total: 49395 vs 61889
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 row totals smaller than the rows under them, first personal_injury_total y0/total: 56509 vs 80278
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca10')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca10', 10154, 7321)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 7 columns: - -
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1993-03-31 differs from listing 2002-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1994-03-31 differs from listing 2003-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1997-03-31 differs from listing 2006-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 9 figures where the page has 8 columns: Cases Filed 1,423,128 1,611,268 1,794,795 695,575 - 51.1 -56.8 - 61.2
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1999-03-31 differs from listing 2008-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2000-03-31 differs from listing 2009-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2005-03-31 differs from listing 2014-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2006-03-31 differs from listing 2015-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2007-03-31 differs from listing 2016-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2008-03-31 differs from listing 2017-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2009-03-31 differs from listing 2018-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2010-03-31 differs from listing 2019-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2011-03-31 differs from listing 2020-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2012-03-31 differs from listing 2021-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2013-03-31 differs from listing 2022-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2014-03-31 differs from listing 2023-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2015-03-31 differs from listing 2024-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2016-03-31 differs from listing 2025-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2017-03-31 differs from listing 2026-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 9 columns: UT 700 694 - .9 685 548 -20.0 394 540 37.1
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 9 columns: NY,S 1,824 1,812 - .7 1,848 1,529 -17.3 4,514 4,797 6.3
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 11 figures where the page has 9 columns: 1ST 2,517 2,040 - 19.0 2,503 2,604 4.0 2,966 2,402 - 19.0
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca2', 5298, 4084)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca9', 17073, 10539)
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Identification Documents and Information']
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first firearms_and_explosives_offenses_total/firearms_total total_defendants: 8463 vs 8796
- 1 table-periods: PDF read by word positions but rejected by a gate: 35 row totals smaller than the rows under them, first embezzlement_total total_defendants: 439 vs 11286
- 1 table-periods: PDF read by word positions but rejected by a gate: 9 row totals smaller than the rows under them, first regulatory_offenses_total total_defendants: 1644 vs 4998
- 1 table-periods: PDF read by word positions but rejected by a gate: 24 row totals smaller than the rows under them, first embezzlement_total total_defendants: 370 vs 8748
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total_sessions_convened', 'national', 10158, 10134)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total_sessions_convened', 'national', 9879, 9860)
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [('district', 'unmatched:VA')]
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: group heading 'Not Terminated as of March 31, 2017' is not printed over its columns (missing ['march'])
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['ME']
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 12 figures where the page has 9 columns: 1ST 1,668 1,351 - 19.0 1,671 1,462 - 12.5 1,526 1,415 - 7.3
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca8', 4084, 3784)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca11', 6416, 5587)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca6', 4042, 3614)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 9 columns: Tort Actions -
- 1 table-periods: PDF read by word positions but rejected by a gate: a count column prints figures with decimals: AK types_of_pretrial_services_report/no_reports_made/total 0.5
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['ME', 'NH', 'LA,E']
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1')] extra []
- 1 table-periods: spreadsheet rejected by a gate: column 12 has figures but no heading
- 1 table-periods: PDF read by word positions but rejected by a gate: 4 roll-up identity failures, first ('total_pretrial_services_cases_activated', 'ca10', 6982, 6250)
- 1 table-periods: PDF read by word positions but rejected by a gate: 7 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 1060 vs 1224
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 629 vs 1046
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Bureau of Prisons Custody']
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2015-03-15 differs from listing 2015-03-31
- 1 table-periods: PDF read by word positions but rejected by a gate: 4 roll-up identity failures, first ('persons_under_supervision', 'ca4', 15900, 15233)
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 roll-up identity failures, first ('persons_under_supervision', 'ca5', 20384, 18565)
- 1 table-periods: PDF read by word positions but rejected by a gate: 4 roll-up identity failures, first ('persons_under_supervision', 'ca3', 7561, 6801)
- 1 table-periods: PDF read by word positions but rejected by a gate: 13 roll-up identity failures, first ('received_for_post_conviction_supervision/total_received', 'national', 66874, 64092)

## Judicial Business of the United States Courts

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-business-united-states-courts

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |
| B | 602 | 602 | 335 | 333 | 2 | 0 | 0 | 267 |
| BAP | 55 | 55 | 48 | 48 | 0 | 0 | 0 | 7 |
| C | 516 | 516 | 339 | 339 | 0 | 0 | 0 | 177 |
| D | 453 | 453 | 256 | 256 | 0 | 0 | 0 | 197 |
| E | 130 | 130 | 82 | 82 | 0 | 0 | 0 | 48 |
| F | 87 | 87 | 80 | 80 | 0 | 0 | 0 | 7 |
| G | 87 | 87 | 33 | 33 | 0 | 0 | 0 | 54 |
| H | 352 | 352 | 179 | 179 | 0 | 0 | 0 | 173 |
| J | 78 | 78 | 68 | 68 | 0 | 0 | 0 | 10 |
| JCI | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 6 |
| K | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 |
| M | 314 | 314 | 215 | 214 | 1 | 0 | 0 | 99 |
| P | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 6 |
| S | 297 | 297 | 103 | 103 | 0 | 0 | 0 | 194 |
| T | 146 | 146 | 109 | 109 | 0 | 0 | 0 | 37 |
| V | 58 | 58 | 18 | 17 | 1 | 0 | 0 | 40 |
| X | 45 | 45 | 18 | 18 | 0 | 0 | 0 | 27 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| A-1 | Supreme Court of the United States - Cases on Docket, Disposed of, and Remaining on Docket | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | spreadsheet rejected by a gate: ambiguous column headings: 8 columns share a heading path with another column, first total~2 (7) |
| B | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending | 29 | 29 | 28 | 28 | 0 | 0 | 0 | 1 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (1) |
| B-1 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending, by Nature of Proceeding | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2014-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (14) |
| B-1A | U.S. Courts of Appeals - Civil and Criminal Cases Filed, Terminated, and Pending, by Natur | 29 | 29 | 11 | 10 | 1 | 0 | 0 | 18 | 2016-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (14) |
| B-2 | U.S. Courts of Appeals - Petitions for Review on Writ of Certiorari to the Supreme Court F | 29 | 29 | 26 | 25 | 1 | 0 | 0 | 3 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: court rows with an empty cell: ['1ST'] (1) |
| B-3 | U.S. Courts of Appeals - Cases Filed, by Source | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: court set differs: missing [('national', 'national')] extra [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] (16) |
| B-3A | U.S. Courts of Appeals - Sources of Civil and Criminal Cases from U.S. District Courts | 29 | 29 | 25 | 25 | 0 | 0 | 0 | 4 | 1998-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: 6 roll-up identity failures, first ('filed/total', 'ca2', 4225, 3090) (1) |
| B-4 | U.S. Courts of Appeals - Median Times for Cases Terminated on the Merits | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2014-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Terminated on the Merits' is not printed over its columns (missing ['merit']) (13) |
| B-4A | U.S. Courts of Appeals - Median Times for Civil and Criminal Cases Terminated on the Merit | 20 | 20 | 9 | 9 | 0 | 0 | 0 | 11 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (7) |
| B-4B | U.S. Courts of Appeals - Median Times for Bankruptcy Cases Terminated on the Merits | 20 | 20 | 12 | 12 | 0 | 0 | 0 | 8 | 2014-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Median Time Intervals From' is not printed over its columns (missing ['median', 'time']) (8) |
| B-4C | U.S. Courts of Appeals - Median Times for Administrative Agency Cases Terminated on the Me | 20 | 20 | 12 | 12 | 0 | 0 | 0 | 8 | 2014-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (8) |
| B-4D | U.S. Courts of Appeals - Median Times for Original Proceedings and Miscellaneous Applicati | 20 | 20 | 11 | 11 | 0 | 0 | 0 | 9 | 2014-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Median Time Intervals From' is not printed over its columns (missing ['median', 'time']) (8) |
| B-5 | U.S. Courts of Appeals - Decisions in Cases Terminated on the Merits, by Nature of Proceed | 29 | 29 | 25 | 25 | 0 | 0 | 0 | 4 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (3) |
| B-5A | U.S. Courts of Appeals - Cases Terminated on Procedural Grounds, by Nature of Proceeding | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (19) |
| B-6 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending, by Nature of Proceeding, as | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (20) |
| B-7 | U.S. Courts of Appeals - Civil and Criminal Cases Filed, by Circuit and Nature of Suit or  | 29 | 29 | 10 | 10 | 0 | 0 | 0 | 19 | 2016-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (16) |
| B-8 | U.S. Court of Appeals for the Federal Circuit - Cases Filed, Terminated, and Pending | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (20) |
| B-9 | U.S. Courts of Appeals - Pro Se Cases Filed and Terminated, by Nature of Proceeding | 29 | 29 | 28 | 28 | 0 | 0 | 0 | 1 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca7')] extra [] (1) |
| B-10 | U.S. Courts of Appeals - Cases Teminated on the Merits After Oral Arguments or Submission  | 29 | 29 | 27 | 27 | 0 | 0 | 0 | 2 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (2) |
| B-11 | U.S. Courts of Appeals - Judge Participation in Cases Terminated on the Merits | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2014-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Terminated on the Merits' is not printed over its columns (missing ['merit', 'terminated']) (14) |
| B-12 | U.S. Courts of Appeals - Type of Opinion or Order Filed in Cases Terminated on the Merits | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2014-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Last Opinion or Final Order' is not printed over its columns (missing ['final', 'last', 'opinion']) (16) |
| B-19 | U.S. Courts of Appeals - Pro Se Cases Filed, by Source | 29 | 29 | 27 | 27 | 0 | 0 | 0 | 2 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no period in the title (2) |
| B-20 | U.S. Courts of Appeals - Cases Under Submission for More Than Three Months | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: title table S-5 != listing B-20 (17) |
| BAP-1 | U.S. Bankruptcy Appellate Panels - Cases Filed, Terminated, and Pending | 29 | 29 | 28 | 28 | 0 | 0 | 0 | 1 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (1) |
| BAP-2 | U.S. Bankruptcy Appellate Panels - Cases Filed, Terminated and Pending, by Chapter of the  | 26 | 26 | 20 | 20 | 0 | 0 | 0 | 6 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Terminations on the Merits' is not printed over its columns (missing ['merit']) (4) |
| C | U.S. District Courts - Civil Cases Filed, Terminated, and Pending | 29 | 29 | 29 | 29 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| C-1 | U.S. District Courts - Civil Cases Filed, Terminated, and Pending, by Jurisdiction | 29 | 29 | 29 | 29 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| C-2 | U.S. District Courts - Civil Cases Filed, by Jurisdiction and Nature of Suit | 29 | 29 | 26 | 26 | 0 | 0 | 0 | 3 | 1998-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: rows with an empty cell: ['DOME-STIC RELATIONS', 'PROBA-TE'] (1) |
| C-2A | U.S. District Courts - Civil Cases Filed, by Nature of Suit | 29 | 29 | 22 | 22 | 0 | 0 | 0 | 7 | 1998-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first personal_injury_total y0: 53940 vs 107880 (1) |
| C-3 | U.S. District Courts - Civil Cases Filed by Jurisdiction, Nature of Suit, and District | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (17) |
| C-3A | U.S. District Courts - Civil Cases Pending by Jurisdiction, Nature of Suit, and District | 29 | 29 | 15 | 15 | 0 | 0 | 0 | 14 | 2011-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (13) |
| C-3B | U.S. District Courts - Civil Cases Terminated, by Jurisdiction, Nature of Suit, and Distri | 29 | 29 | 15 | 15 | 0 | 0 | 0 | 14 | 2011-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (11) |
| C-4 | U.S. District Courts - Civil Cases Terminated, by Nature of Suit and Action Taken | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (18) |
| C-4A | U.S. District Courts - Civil Cases Terminated, by District and Action Taken | 28 | 28 | 28 | 28 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| C-5 | U.S. District Courts - Median Time From Filing to Disposition of Civil Cases, by Action Ta | 29 | 29 | 24 | 24 | 0 | 0 | 0 | 5 | 2000-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (3) |
| C-6 | U.S. District Courts - Civil Cases Pending, by Length of Time | 28 | 28 | 28 | 28 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| C-7 | U.S. District Courts - Intellectual Property Cases, Securities/Commodities/Exchange Cases, | 21 | 21 | 15 | 15 | 0 | 0 | 0 | 6 | 2005-09-30 to 2025-09-30 | spreadsheet rejected by a gate: ambiguous row labels: 3 labels repeat under the same parent with different figures, first filed (5) |
| C-8 | U.S. District Courts - Civil Cases Filed, by Origin | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (14) |
| C-9 | U.S. District Courts - Recovery of Overpayment and Enforcement of Judgment Cases Filed, by | 29 | 29 | 27 | 27 | 0 | 0 | 0 | 2 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: 5 roll-up identity failures, first ('total', 'ca1', 67, 60) (1) |
| C-9 Retired | U.S. District Courts - Civil and Criminal Trials Terminated That Required 20 or More Days | 12 | 12 | 0 | 0 | 0 | 0 | 0 | 12 |  | PDF read by word positions but rejected by a gate: no table rows found in the text layer (12) |
| C-10 | U.S. District Courts - Social Security Cases Filed, by Nature of Suit | 29 | 29 | 14 | 14 | 0 | 0 | 0 | 15 | 2011-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (13) |
| C-11 | U.S. District Courts - Product Liability Cases Filed, by Nature of Suit | 29 | 29 | 11 | 11 | 0 | 0 | 0 | 18 | 2014-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Personal Injury Product Liability' is not printed over its columns (missing ['liability', 'product']) (17) |
| C-12 | U.S. District Courts - Civil Cases Pending Three Years or More, by Basis of Jurisdiction a | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: title table S-11 != listing C-12 (13) |
| C-13 | U.S. District Courts - Civil Pro Se and Non-Pro Se Filings | 21 | 21 | 20 | 20 | 0 | 0 | 0 | 1 | 2005-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: 16 roll-up identity failures, first ('pro_se_cases', 'ca9', 15176, 15169) (1) |
| D | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 29 | 29 | 28 | 28 | 0 | 0 | 0 | 1 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 9 columns: DC 807 671 -16.9 710 562 - 20.8 778 887 14.0 (1) |
| D Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending (Including Transfers) | 29 | 29 | 28 | 28 | 0 | 0 | 0 | 1 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: a line prints 11 figures where the page has 9 columns: DC 662 501 - 24.3 562 463 - 17.6 629 667 6.0 (1) |
| D-1 | U.S. District Courts - Criminal Fugitive Defendants Filed, Terminated, and Pending (Includ | 29 | 29 | 13 | 13 | 0 | 0 | 0 | 16 | 2012-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Not Terminated as of September 30, 2016' is not printed over its columns (missing ['not', 'september', 'terminated']) (7) |
| D-1 Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending, by Level of Offense | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 15 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (15) |
| D-1A | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| D-2 | U.S. District Courts - Criminal Defendants Filed, by Offense | 29 | 29 | 27 | 27 | 0 | 0 | 0 | 2 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no period in the title (1) |
| D-2 Cases | U.S. District Courts - Criminal Cases Filed, by Offense | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 15 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (14) |
| D-3 | U.S. District Courts - Criminal Defendants Filed, by Offense and District | 29 | 29 | 18 | 18 | 0 | 0 | 0 | 11 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| D-3 Cases | U.S. District Courts - Criminal Cases Filed, by Offense and District | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 15 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (15) |
| D-3A | U.S. District Courts - Criminal Felony Defendants Filed, by Offense and District | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| D-4 | U.S. District Courts - Criminal Defendants Terminated, by Type of Disposition and Offense | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2011-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (14) |
| D-5 | U.S. District Courts - Criminal Defendants Sentenced After Conviction, by Type of Sentence | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (17) |
| D-6 | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 29 | 29 | 15 | 15 | 0 | 0 | 0 | 14 | 2011-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Bench Trial' is not printed over its columns (missing ['bench']) (13) |
| D-6A | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| D-7 | U.S. District Courts - Criminal Defendants Terminated, by Type of Disposition | 29 | 29 | 14 | 14 | 0 | 0 | 0 | 15 | 2012-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (15) |
| D-8 | U.S. District Courts - Criminal Defendants Pending, by Offense | 28 | 28 | 19 | 19 | 0 | 0 | 0 | 9 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (7) |
| D-8 Cases | U.S. District Courts - Criminal Cases Pending, by Offense | 5 | 5 | 0 | 0 | 0 | 0 | 0 | 5 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (3) |
| D-9 | U.S. District Courts - Criminal Defendants Terminated, by Offense | 24 | 24 | 9 | 9 | 0 | 0 | 0 | 15 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Other Violent Offenses' is not printed over its columns (missing ['other']) (11) |
| D-10 | U.S. District Courts - Median Time From Commencement to Termination for Criminal Defendant | 24 | 24 | 11 | 11 | 0 | 0 | 0 | 13 | 2011-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Bench Trial' is not printed over its columns (missing ['bench']) (9) |
| D-12 | U.S. District Courts - Median Time From Conviction to Sentencing for Criminal Defendants C | 29 | 29 | 25 | 25 | 0 | 0 | 0 | 4 | 1998-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (3) |
| D-13 | U.S. District Courts - Criminal Defendants Filed, by Type of Proceedings | 21 | 21 | 19 | 19 | 0 | 0 | 0 | 2 | 2005-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 6 columns: 266 1 (1) |
| D-13 Cases | U.S. District Courts - Criminal Cases Filed, by Type of Proceeding | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 7 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (7) |
| E-1 | Federal Probation System - Persons Received for and Removed From Post-Conviction Supervisi | 29 | 29 | 18 | 18 | 0 | 0 | 0 | 11 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| E-2 | Federal Probation System - Persons Under Post-Conviction Supervision | 29 | 29 | 19 | 19 | 0 | 0 | 0 | 10 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| E-3 | Federal Probation System - Persons Under Post-Conviction Supervision, by Offense | 29 | 29 | 19 | 19 | 0 | 0 | 0 | 10 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| E-4 | Federal Probation System - Persons Received From Judges for Post-Conviction Supervision, b | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (2) |
| E-7 | Federal Probation System - Persons Removed From Post-Conviction Supervision With and Witho | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (9) |
| E-7A | Federal Probation System - Post-Conviction Supervision Cases Terminated With and Without R | 20 | 20 | 14 | 14 | 0 | 0 | 0 | 6 | 2010-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: 5 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody without_revocations/early_term/total: 8 vs 240 (1) |
| E-8 | Federal Probation System - Post-Conviction Supervision Cases Revoked and Closed | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| E-8A | Federal Probation System - Post-Conviction Supervision Cases Closed | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| E-10 | Federal Probation System - Presentence Investigations | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| F | U.S. Bankruptcy Courts - Bankruptcy Cases Filed, Terminated and Pending | 29 | 29 | 29 | 29 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| F-2 | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 29 | 29 | 29 | 29 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| F-8 | U.S. Bankruptcy Courts - Adversary Proceedings Filed, Terminated, and Pending | 29 | 29 | 22 | 22 | 0 | 0 | 0 | 7 | 2002-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (5) |
| G-1 | U.S. Court of International Trade - Cases Filed, Terminated, and Pending | 29 | 29 | 24 | 24 | 0 | 0 | 0 | 5 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: rows with an empty cell: ['After trial, hearing, or submission 223*', 'statement of facts 222*'] (1) |
| G-2A | U.S. Court of Federal Claims - Cases Filed, Terminated, and Pending, by Type of Case | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (19) |
| G-2B | U.S. Court of Federal Claims - Judgment Amounts and Appeals to the U.S. Court of Appeals f | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF read by word positions but rejected by a gate: no table rows found in the text layer (20) |
| H-1 | Federal Pretrial Services - Cases Activated | 28 | 28 | 18 | 18 | 0 | 0 | 0 | 10 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| H-2 | Federal Pretrial Services - Interviews and Types of Pretrial Services Reports | 29 | 29 | 14 | 14 | 0 | 0 | 0 | 15 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| H-3 | Federal Pretrial Services - Recommendations Made for Initial Pretrial Release | 29 | 29 | 17 | 17 | 0 | 0 | 0 | 12 | 2008-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (10) |
| H-3A | Federal Pretrial Services - Recommendations Made for Initial Pretrial Release, Excluding I | 20 | 20 | 18 | 18 | 0 | 0 | 0 | 2 | 2008-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (2) |
| H-3B | Federal Pretrial Services - Pretrial Services Recommendations Made For Initial Pretrial Re | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| H-4 | Federal Pretrial Services - Release and Detention Status at Initial Hearings | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (9) |
| H-5 | Federal Pretrial Services - Initial Detention Hearings Held | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (8) |
| H-6 | Federal Pretrial Services - Defendants Released on Bond, by Type | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Types of Bond' is not printed over its columns (missing ['bond', 'type']) (11) |
| H-6A | Federal Pretrial Services - Conditions Imposed at Initial Hearings for Defendants Released | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (1) |
| H-7 | Federal Pretrial Services - Defendants Received for and Under Pretrial Supervision | 29 | 29 | 27 | 27 | 0 | 0 | 0 | 2 | 1998-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (1) |
| H-8 | Federal Pretrial Services - Defendants Released, by Conditions of Release | 29 | 29 | 16 | 16 | 0 | 0 | 0 | 13 | 2010-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| H-9A | Federal Pretrial Services - Pretrial Services Detention Summary: Days, Average and Median | 13 | 13 | 4 | 4 | 0 | 0 | 0 | 9 | 2022-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| H-10 | Federal Pretrial Services - Bail Review Hearings Held, by Type | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (9) |
| H-11 | Federal Pretrial Services - Defendants With Bail Violations, by Type | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (9) |
| H-11A | Federal Pretrial Services - Circumstances Involved in Technical Violations | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (9) |
| H-12 | Federal Pretrial Services - Violations and Actions Taken by the Court | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (9) |
| H-13 | Federal Pretrial Services - Cases Terminated, by Type of Disposition | 29 | 29 | 15 | 15 | 0 | 0 | 0 | 14 | 2008-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (13) |
| H-14 | Federal Pretrial Services - Defendants Released and Detained | 29 | 29 | 13 | 13 | 0 | 0 | 0 | 16 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (9) |
| H-14A | Federal Pretrial Services - Defendants Released and Detained, Excluding Immigration Cases | 21 | 21 | 20 | 20 | 0 | 0 | 0 | 1 | 2007-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('cases1', 'ca10', 3777, 3435) (1) |
| H-14B | Federal Pretrial Services - Pretrial Services Release and Detention, Excluding Illegal Ali | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| H-15 | Federal Pretrial Services - Pretrial Services Violations Summary Report | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 4 |  | spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first pct~2 (4) |
| J-1 | U.S. District Courts - Grand Juror Service | 29 | 29 | 24 | 24 | 0 | 0 | 0 | 5 | 1999-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (3) |
| J-2 | U.S. District Courts - Petit Juror Service on Days Jurors Were Selected for Trial | 29 | 29 | 25 | 25 | 0 | 0 | 0 | 4 | 2000-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (2) |
| J-9 | U.S. District Courts - Grand Juror Service | 10 | 10 | 9 | 9 | 0 | 0 | 0 | 1 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no table rows found in the text layer (1) |
| J-10 | U.S. District Courts - Petit Juror Service | 10 | 10 | 10 | 10 | 0 | 0 | 0 | 0 | 2016-09-30 to 2025-09-30 |  |
| JCI | U.S. Federal Courts - Work of the Federal Judiciary | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 6 |  | spreadsheet rejected by a gate: period in title 2011-09-30 differs from listing 2020-09-30 (1) |
| K-1 | Federal Defender Organizations - Cases Filed, Terminated, and Pending, by Type of Represen | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (19) |
| M-1 | U.S. District Courts - Class A Misdemeanor Defendants Terminated by U.S. Magistrate Judges | 29 | 29 | 27 | 27 | 0 | 0 | 0 | 2 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no period in the title (1) |
| M-1A | U.S. District Courts - Class A Misdemeanor Defendants Terminated by U.S. Magistrate Judges | 24 | 24 | 14 | 14 | 0 | 0 | 0 | 10 | 2012-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (10) |
| M-2 | U.S. District Courts - Petty Offense Defendants Terminated by U.S. Magistrate Judges, by O | 29 | 29 | 22 | 22 | 0 | 0 | 0 | 7 | 2000-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (3) |
| M-2A | U.S. District Courts - Petty Offense Defendants Terminated by U.S. Magistrate Judges, by T | 26 | 26 | 22 | 22 | 0 | 0 | 0 | 4 | 2000-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: 4 roll-up identity failures, first ('not_convicted/total', 'ca3', 2292, 2226) (1) |
| M-3 | U.S. District Courts - Felony Preliminary Proceedings Conducted by U.S. Magistrate Judges  | 29 | 29 | 13 | 13 | 0 | 0 | 0 | 16 | 2013-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (15) |
| M-3A | U.S. District Courts - Miscellaneous Matters Conducted by U.S. Magistrate Judges | 26 | 26 | 22 | 22 | 0 | 0 | 0 | 4 | 2000-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 12 columns: 3 2 (1) |
| M-4 | U.S. District Courts - Criminal Pretrial Matters Conducted by U.S. Magistrate Judges Under | 26 | 26 | 14 | 14 | 0 | 0 | 0 | 12 | 2000-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (10) |
| M-4 Retired | U.S. District Courts - Matters Conducted by by U.S. Magistrate Judges Under 28 U.S.C. §§ 6 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 3 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (3) |
| M-4A | U.S. District Courts - Civil Pretrial Matters Conducted by U.S. Magistrate Judges Under 28 | 26 | 26 | 11 | 11 | 0 | 0 | 0 | 15 | 2014-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (13) |
| M-4A Retired | U.S. District Courts - Proceedings and Cases Conducted by by U.S. Magistrate Judges Under  | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 3 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (3) |
| M-4B | U.S. District Courts - Reports and Recommendations Issued by U.S. Magistrate Judges Under  | 26 | 26 | 9 | 8 | 1 | 0 | 0 | 17 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (16) |
| M-4C | U.S. District Courts - Evidentiary Proceedings Conducted by U.S. Magistrate Judges Under 2 | 29 | 29 | 23 | 23 | 0 | 0 | 0 | 6 | 2000-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (3) |
| M-5 | U.S. District Courts - Civil Consent Cases Terminated by U.S. Magistrate Judges Under 28 U | 26 | 26 | 26 | 26 | 0 | 0 | 0 | 0 | 2000-09-30 to 2025-09-30 |  |
| M-7 | U.S. District Courts - Matters Disposed of by U.S. Magistrate Judges, by Matter Type | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| M-8 | U.S. District Courts - Civil Consent Case Matters by U.S. Magistrate Judges Under 28 U.S.C | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| M-9 | U.S. District Courts - Non-Consent Prisoner Litigation Matters by U.S. Magistrate Judges U | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| M-10 | U.S. District Courts - Non-Consent Social Security Matters by U.S. Magistrate Judges Under | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| P-1 | U.S. District Courts - Passport Applications Processed and Aliens Administered Oath of All | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 6 |  | PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 2 columns: ME No 89 (1) |
| S-6 Retired | U.S. Courts of Appeals - Criminal Cases Filed Under the Sentencing Guidelines | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 15 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (13) |
| S-12 | U.S. District Courts - Civil Cases Referred to Arbitration | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 9 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (8) |
| S-13 | Federal Probation System - Offenders Receiving Judiciary-Funded Substance Abuse Treatment | 26 | 26 | 19 | 19 | 0 | 0 | 0 | 7 | 2005-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (4) |
| S-13 Retired | U.S. District Courts - Criminal Defendants Whose Cases Were Dismissed Under 18 U.S.C. § 31 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |  | PDF read by word positions but rejected by a gate: no period in the title (2) |
| S-14 | Federal Pretrial Services - Defendants Receiving Judiciary-Funded Substance Abuse Treatmen | 26 | 26 | 20 | 20 | 0 | 0 | 0 | 6 | 2005-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Federal Judiciary Substance Abuse Treatment Expenditures2' is not printed over its columns (missing ['judiciary', 'treatment']) (3) |
| S-14 Retired | Federal Probation System - Persons Received for and Under Post-Conviction Supervision, by  | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 3 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (1) |
| S-15 | U.S. District Courts - Petit Juror Service | 19 | 19 | 0 | 0 | 0 | 0 | 0 | 19 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (19) |
| S-15 Retired | Federal Probation System - Drug- and Alcohol-Dependent Recipients of Substance Abuse Servi | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 3 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (3) |
| S-16 | U.S. District Courts - Grand Juror Service | 19 | 19 | 0 | 0 | 0 | 0 | 0 | 19 |  | PDF read by word positions but rejected by a gate: no table rows found in the text layer (18) |
| S-17 | U.S. District Courts - Matters Conducted by U.S. Magistrate Judges | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2014-09-30 to 2022-09-30 | PDF read by word positions but rejected by a gate: period in title 1987-06-30 differs from listing 1997-09-30 (1) |
| S-18 | U.S. District Courts - Three-Judge District Court Hearings, by Nature of Suit | 29 | 29 | 23 | 23 | 0 | 0 | 0 | 6 | 1997-09-30 to 2024-09-30 | PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first national y0: 20 vs 29 (1) |
| S-19 | U.S. Judicial Panel on Multidistrict Litigation - Cases Transferred by Order of Judicial P | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading '12 Months Ending September 30, 2017' is not printed over its columns (missing ['12', 'ending', 'month']) (13) |
| S-20 | U.S. Judicial Panel on Multidistrict Litigation - Cumulative Summary of Multidistrict Liti | 29 | 29 | 8 | 8 | 0 | 0 | 0 | 21 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (20) |
| S-21 | Federal Defender Organizations - Cases Filed, Terminated, and Pending, by Type of Represen | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (14) |
| S-22 | U.S. Federal Courts - Complaints Filed and Action Taken Under Under 28 U.S.C. §§ 351-364 | 31 | 31 | 15 | 15 | 0 | 0 | 0 | 16 | 1998-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: rows with an empty cell: ['Conference'] (2) |
| S-25 | U.S. District Courts - Criminal Cases Filed, by Offense and Year | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |  | PDF read by word positions but rejected by a gate: period in title 2000-09-30 differs from listing 2005-09-30 (1) |
| S-26 | U.S. District Courts - Criminal Defendants Filed, by Offense and Year | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |  | PDF read by word positions but rejected by a gate: period in title 2000-09-30 differs from listing 2005-09-30 (1) |
| T-1 | U.S. District Courts - Civil and Criminal Trials Completed | 43 | 43 | 23 | 23 | 0 | 0 | 0 | 20 | 1998-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (18) |
| T-2 | U.S. District Courts - Lengths of Civil and Criminal Trials Completed | 38 | 38 | 35 | 35 | 0 | 0 | 0 | 3 | 1997-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: 6 roll-up identity failures, first ('total_all_trials', 'ca3', 856, 624) (2) |
| T-3 | U.S. District Courts - Median Time From Filings To Trial For Civil Cases In Which Trials W | 29 | 29 | 18 | 18 | 0 | 0 | 0 | 11 | 2003-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (4) |
| T-4 | U.S. District Courts - Civil and Criminal Trials Resulting in Verdicts or Judgments | 15 | 15 | 14 | 14 | 0 | 0 | 0 | 1 | 2012-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: 9 roll-up identity failures, first ('total_all_trials', 'ca8', 1574, 1430) (1) |
| T-5 | U.S. District Courts - Lengths of Civil and Criminal Trials Resulting in Verdicts or Judgm | 20 | 20 | 18 | 18 | 0 | 0 | 0 | 2 | 2006-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: court rows with an empty cell: ['PA,E'] (1) |
| T-19 | U.S. District Courts - Supervision Hearings in Trials and Nontrials, by District | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 2025-09-30 to 2025-09-30 |  |
| V-1 | U.S. District Courts - Services Provided to and Received From Other District Courts | 29 | 29 | 9 | 8 | 1 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: group heading 'Services Provided to Other District Courts' is not printed over its columns (missing ['court', 'district', 'other']) (18) |
| V-2 | U.S. District Courts - Services Provided by Visiting Judges in Cases Terminated, by Circui | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 2 43 39 2 2 - - - - - (1) |
| X-1A | U.S. District Courts - Weighted and Unweighted Filings per Authorized Judgeship | 29 | 29 | 18 | 18 | 0 | 0 | 0 | 11 | 2007-09-30 to 2025-09-30 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (6) |
| X-4 | U.S. District Courts - Class Action Civil Cases Pending, by Nature of Suit | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 8 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (8) |
| X-5 | U.S. District Courts - Class Action Civil Cases Filed, by Jurisdiction and Nature of Suit | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 8 |  | PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns (8) |

Never parsed or not published, by reason:

- 544 table-periods: PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns
- 218 table-periods: PDF read by word positions but rejected by a gate: no workbook edition of this table to name the columns
- 54 table-periods: PDF read by word positions but rejected by a gate: no table rows found in the text layer
- 53 table-periods: PDF read by word positions but rejected by a gate: no period in the title
- 22 table-periods: PDF read by word positions but rejected by a gate: group heading 'Bench Trial' is not printed over its columns (missing ['bench'])
- 19 table-periods: PDF read by word positions but rejected by a gate: group heading 'Median Time Intervals From' is not printed over its columns (missing ['median', 'time'])
- 18 table-periods: PDF read by word positions but rejected by a gate: group heading 'Services Provided to Other District Courts' is not printed over its columns (missing ['court', 'district', 'other'])
- 17 table-periods: PDF read by word positions but rejected by a gate: title table S-5 != listing B-20
- 17 table-periods: PDF read by word positions but rejected by a gate: group heading 'Personal Injury Product Liability' is not printed over its columns (missing ['liability', 'product'])
- 16 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('national', 'national')] extra [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')]
- 16 table-periods: PDF read by word positions but rejected by a gate: group heading 'Last Opinion or Final Order' is not printed over its columns (missing ['final', 'last', 'opinion'])
- 14 table-periods: PDF read by word positions but rejected by a gate: group heading 'Terminated on the Merits' is not printed over its columns (missing ['merit'])
- 14 table-periods: PDF read by word positions but rejected by a gate: group heading 'Terminated on the Merits' is not printed over its columns (missing ['merit', 'terminated'])
- 13 table-periods: PDF read by word positions but rejected by a gate: title table S-11 != listing C-12
- 13 table-periods: PDF read by word positions but rejected by a gate: group heading '12 Months Ending September 30, 2017' is not printed over its columns (missing ['12', 'ending', 'month'])
- 11 table-periods: PDF read by word positions but rejected by a gate: group heading 'Other Violent Offenses' is not printed over its columns (missing ['other'])
- 11 table-periods: PDF read by word positions but rejected by a gate: group heading 'Types of Bond' is not printed over its columns (missing ['bond', 'type'])
- 9 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first total~2
- 9 table-periods: spreadsheet rejected by a gate: no sheets with data
- 8 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 3 labels repeat under the same parent with different figures, first closed
- 7 table-periods: PDF read by word positions but rejected by a gate: group heading 'Not Terminated as of September 30, 2016' is not printed over its columns (missing ['not', 'september', 'terminated'])
- 7 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 8 columns share a heading path with another column, first total~2
- 6 table-periods: PDF read by word positions but rejected by a gate: group heading 'Prisoner Petitions' is not printed over its columns (missing ['prisoner'])
- 6 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra []
- 5 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 3 labels repeat under the same parent with different figures, first filed
- 4 table-periods: PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows
- 4 table-periods: PDF read by word positions but rejected by a gate: group heading 'On Procedural Grounds' is not printed over its columns (missing ['ground'])
- 4 table-periods: PDF read by word positions but rejected by a gate: group heading 'Substance Abuse Testing' is not printed over its columns (missing ['substance'])
- 4 table-periods: PDF read by word positions but rejected by a gate: group heading 'Terminations on the Merits' is not printed over its columns (missing ['merit'])
- 4 table-periods: PDF read by word positions but rejected by a gate: group heading 'Not Interviewed1' is not printed over its columns (missing ['not'])
- 4 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first pct~2
- 3 table-periods: PDF read by word positions but rejected by a gate: a court is printed twice with different figures
- 3 table-periods: PDF read by word positions but rejected by a gate: group heading 'Unweighted Filings per Judgeship' is not printed over its columns (missing ['unweighted'])
- 3 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['NMI']
- 3 table-periods: PDF read by word positions but rejected by a gate: group heading 'Federal Judiciary Substance Abuse Treatment Expenditures2' is not printed over its columns (missing ['judiciary', 'treatment'])
- 2 table-periods: PDF read by word positions but rejected by a gate: group heading 'Not Terminated as of September 30, 2016' is not printed over its columns (missing ['september'])
- 2 table-periods: PDF read by word positions but rejected by a gate: group heading 'During Trial' is not printed over its columns (missing ['during'])
- 2 table-periods: spreadsheet rejected by a gate: column 2 has figures but no heading
- 2 table-periods: PDF read by word positions but rejected by a gate: the PDF could not be read: No /Root object! - Is this really a PDF?
- 2 table-periods: PDF read by word positions but rejected by a gate: title table C-7 != listing T-1
- 2 table-periods: PDF read by word positions but rejected by a gate: group heading 'Federal Judiciary Substance Abuse Treatment Expenditures2' is not printed over its columns (missing ['judiciary'])
- 2 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Conference']
- 2 table-periods: PDF read by word positions but rejected by a gate: title table S-22A != listing S-22
- 2 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['', 'Judicial Council Proceedings']
- 2 table-periods: PDF read by word positions but rejected by a gate: title table S-23 != listing S-21
- 2 table-periods: PDF read by word positions but rejected by a gate: 6 roll-up identity failures, first ('total_all_trials', 'ca3', 856, 624)
- 2 table-periods: PDF read by word positions but rejected by a gate: period in title 2000-09-30 differs from listing 2005-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first national y0: 97529 vs 98769
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody without_revocations/early_term/total: 8 vs 240
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 679 vs 1212
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 567 vs 936
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first from_institutions/bureau_of_prisons_custody total_closed: 484 vs 780
- 1 table-periods: spreadsheet rejected by a gate: 7/95 text cells
- 1 table-periods: spreadsheet rejected by a gate: 6/95 text cells
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('received_for_post_conviction_supervision/received_by_transfer', 'ca10', 212, 202)
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('national', 'national')] extra [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca5')]
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('district', 'azd'), ('district', 'ilcd'), ('district', 'ord')] extra [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')]
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('district', 'azd')] extra [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')]
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [] extra [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')]
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 11 figures where the page has 9 columns: BA N K RU P T C Y 6 - - - - - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 roll-up identity failures, first ('not_terminated_as_of_september_30_y0/fugitive', 'ca3', 58, 580)
- 1 table-periods: spreadsheet rejected by a gate: period in title 2011-09-30 differs from listing 2020-09-30
- 1 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 3 labels repeat under the same parent with different figures, first cases_filed
- 1 table-periods: spreadsheet rejected by a gate: period in title 2013-09-30 differs from listing 2022-09-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2014-09-30 differs from listing 2023-09-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2015-09-30 differs from listing 2024-09-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2016-09-30 differs from listing 2025-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 13 columns: 1 RICO = RACkETEER INFLUENCED AND CORRUPT ORGANIzATIONS. 127
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Postal', 'Theft, U.S. Property']
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['General Location Jurisdiction', 'Bank', 'Other Sex Offenses `137']
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 15 figures where the page has 14 columns: TOTAL 10,812 267 1,799 7.5 1,799 4.6 645 2.0 9,900 0 .2 10,545 6.6 10,545 25.4
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 11 figures where the page has 9 columns: DC 662 501 - 24.3 562 463 - 17.6 629 667 6.0
- 1 table-periods: PDF read by word positions but rejected by a gate: 4 roll-up identity failures, first ('persons_under_supervision', 'ca2', 9864, 8677)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 14 figures where the page has 13 columns: Administrative Agency Appeals 378 180 11 21 12 1 - - 8 1 48 109 1 38
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 9 columns: DC 807 671 -16.9 710 562 - 20.8 778 887 14.0
- 1 table-periods: PDF read by word positions but rejected by a gate: 13 row totals smaller than the rows under them, first total_criminal_appeals pending_oct_1_ym1: 10101 vs 11492
- 1 table-periods: PDF read by word positions but rejected by a gate: 6 roll-up identity failures, first ('filed/total', 'ca2', 4225, 3090)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 7 figures where the page has 6 columns: SD 105 53 52 130 78 52 103
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 7 figures where the page has 6 columns: SD 110 51 59 113 49 64 101
- 1 table-periods: PDF read by word positions but rejected by a gate: 6 roll-up identity failures, first ('filed/total', 'ca9', 7760, 6580)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 1992 1993 1994 1995 1996
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Argued during term 99 94 90 90 96
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 4 columns: Cases 1994 1995 1996 1997** 1998
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 4 columns: Cases 1995 1996 1997** 1998 1999
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 3 figures where the page has 4 columns: Cases 1996 1997** 1998 1999 2000
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Argued during term 96 90 83 86 88
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Argued during term 90 83 86 88 84
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 1999 2000 2001 2002 2003
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2000 2001 2002 2003 2004
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2001 2002 2003 2004 2005
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2002 2003 2004 2005 2006
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2003 2004 2005 2006 2007
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2004 2005 2006 2007 2008
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2005 2006 2007 2008 2009
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 4 columns: 58 2009
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2007 2008 2009 2010 2011
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2008 2009 2010 2011 2012
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2009 2010 2011 2012 2013
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2010 2011 2012 2013 2014
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: Cases 2011 2012 2013 2014 2015
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 9 figures where the page has 8 columns: SUPPLEMENTAL SECURITY INCOME 6,230 1,047 5,183 5,153 29 1 1 - 0.0
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca7')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: group heading 'Last Opinion or Final Order' is not printed over its columns (missing ['final', 'last'])
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['DOME-STIC RELATIONS', 'PROBA-TE']
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 7 columns: 1 2
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 row totals smaller than the rows under them, first tort_actions_total/personal_injury_total y0/total: 47364 vs 59074
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 roll-up identity failures, first ('defendents_under_supervision_as_of_october_1_ym1', 'ca8', 1853, 1438)
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'cadc'), ('national', 'national')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('terminated/y0', 'ca9', 15337, 15346)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('filed/y0', 'ca8', 2579, 2396)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 13 columns: o 2
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['1ST']
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca10')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('type_of_ausa2_recommendation_made3/ausa_recommendation/total', 'ca4', 5196, 4996)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total_sessions_convened', 'national', 10042, 9999)
- 1 table-periods: PDF read by word positions but rejected by a gate: 4 roll-up identity failures, first ('total_pretrial_services_cases_activated', 'ca9', 24912, 23618)
- 1 table-periods: PDF read by word positions but rejected by a gate: 8 row totals smaller than the rows under them, first firearms_and_explosives_offenses_total/firearms_total total_defendants: 8439 vs 8576
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Labor']
- 1 table-periods: PDF read by word positions but rejected by a gate: 17 row totals smaller than the rows under them, first embezzlement_total total_defendants: 383 vs 10749
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 6 columns: . U 1
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 7 figures where the page has 6 columns: SD 38 - - 18 19 1 53
- 1 table-periods: PDF read by word positions but rejected by a gate: the PDF could not be read: min() iterable argument is empty
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('offenses/other6', 'ca5', 389, 329)
- 1 table-periods: PDF read by word positions but rejected by a gate: 9 row totals smaller than the rows under them, first property_offenses_total total/number: 14551 vs 14696
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Telegraph, Telephone, and Radiograph']
- 1 table-periods: PDF read by word positions but rejected by a gate: 11 row totals smaller than the rows under them, first drug_offenses_total total/number: 25269 vs 25666
- 1 table-periods: PDF read by word positions but rejected by a gate: 10 row totals smaller than the rows under them, first drug_offenses_total/marijuana_total/import_export total/number: 585 vs 2093
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first personal_injury_total y0: 53940 vs 107880
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first tort_actions_total y0: 45054 vs 79126
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first tort_actions_total y0: 55023 vs 101188
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first tort_actions_total y0: 51335 vs 94728
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 row totals smaller than the rows under them, first tort_actions_total y0: 68804 vs 84808
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Insurance I12,697']
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Marine ,258']
- 1 table-periods: PDF read by word positions but rejected by a gate: 16 roll-up identity failures, first ('pro_se_cases', 'ca9', 15176, 15169)
- 1 table-periods: PDF read by word positions but rejected by a gate: 4 roll-up identity failures, first ('not_convicted/total', 'ca3', 2292, 2226)
- 1 table-periods: PDF read by word positions but rejected by a gate: 4 roll-up identity failures, first ('not_convicted/total', 'ca2', 1070, 1071)
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('not_convicted/after_trial', 'national', 802, 804)
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('not_convicted/total', 'ca5', 36864, 36814)
- 1 table-periods: PDF read by word positions but rejected by a gate: 10 roll-up identity failures, first ('total', 'ca9', 1746, 1139)
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['OK,N']
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['WI,W']
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('other_traffic', 'ca4', 18025, 17993)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 3 figures where the page has 7 columns: 2010 - 2011
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 3 figures where the page has 7 columns: 2011 - 2012
- 1 table-periods: PDF read by word positions but rejected by a gate: a count column prints figures with decimals: Percent Change 2013 - 2014 total_filings 3.8, Percent Change 2013 - 2014 original_filings 3.2, Percent Change 2013 - 2014 remands_from_courts_of_appeals 9.1
- 1 table-periods: PDF read by word positions but rejected by a gate: a count column prints figures with decimals: Percent Change 2014 - 2015 total_filings -5.5, Percent Change 2014 - 2015 original_filings -10.6, Percent Change 2014 - 2015 remands_from_courts_of_appeals 1.8
- 1 table-periods: PDF read by word positions but rejected by a gate: a count column prints figures with decimals: Percent Change 2016/2015 total_filings 4.6, Percent Change 2016/2015 original_filings 10.9, Percent Change 2016/2015 remands_from_courts_of_appeals 4.6
- 1 table-periods: PDF read by word positions but rejected by a gate: title table B-11 != listing BAP-2
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 15 figures where the page has 14 columns: CHAPTER 13 - - - - - - - - - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['ME', 'IL,S']
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['RI', 'NJ', 'VA,W']
- 1 table-periods: PDF read by word positions but rejected by a gate: 9 roll-up identity failures, first ('total_all_trials', 'ca8', 1574, 1430)
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 roll-up identity failures, first ('total', 'ca9', 46100, 46086)
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 roll-up identity failures, first ('total', 'ca11', 39480, 37589)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 2 43 39 2 2 - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 1 3 3 - - 2 2 2 - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 4 40 19 21 - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 2 31 16 15 - 5 12 - 3 9
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC - - - - - 9 15 - 3 12
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 4 42 25 17 - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 5 61 38 23 - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 5 79 44 34 1 3 3 - 3 -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 4 45 28 17 - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 2 83 26 46 11 3 3 - 3 -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 4 81 34 32 15 - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 5 90 34 35 21 3 15 - 15 -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 4 33 25 6 2 - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 3 32 22 10 - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 5 columns: DC 3 25 18 7 - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 14 figures where the page has 7 columns: DC 6 33 24 6 3 - - - - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 14 figures where the page has 7 columns: DC 6 55 29 2 6 18 - - - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 14 figures where the page has 7 columns: DC 2 24 14 8 2 - - - - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 15 figures where the page has 7 columns: DC 5 9 90 56 19 14 1 - - - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 15 figures where the page has 7 columns: DC 4 10 49 32 12 4 1 - - - - - - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('district', 'akd'), ('district', 'almd'), ('district', 'alnd'), ('district', 'alsd'), ('district', 'ared'), ('district', 'arwd')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['PA,E']
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total_all_trials', 'ca9', 1048, 1013)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 6 columns: 266 1
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['FILED']
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 8 figures where the page has 11 columns: 141 4 41 35 58 26.8 3 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 20 figures where the page has 19 columns: to Defraud 1,200 1,032 55 75 344 269 127 53 36.0 - - 109 1 68 16 83 60 36.0 9 -
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 20 figures where the page has 19 columns: Drug Offenses, Total 23,117 21,627 2,183 1,057 4,560 5,996 4,409 2,049 51.0 50 - 1,323 1,4
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 roll-up identity failures, first ('nonjury_trials/number_of_trials', 'ca8', 95, 105)
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['GUAM']
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total_trials/number_of_trials', 'ca8', 166, 143)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total_trials/number_of_trials', 'ca11', 351, 341)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 7 figures where the page has 4 columns: N Y , N 28 5 52 2 517 29 0
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['After trial, hearing, or submission 223*', 'statement of facts 222*']
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['After dispositive order 73 32*']
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 4 figures where the page has 3 columns: Total Cases Terminated 9,446 592 ** -8,854
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 4 figures where the page has 3 columns: Total Cases Filed 511 477 * -34
- 1 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first col~2
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first national y0: 20 vs 29
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first national y0: 35 vs 51
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first national y0: 6 vs 10
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Education', 'Employment']
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first civil_rights y0: 1 vs 3
- 1 table-periods: spreadsheet rejected by a gate: column 8 has figures but no heading
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 roll-up identity failures, first ('total', 'ca1', 67, 60)
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 roll-up identity failures, first ('total', 'ca11', 324, 320)
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('cases1', 'ca10', 3777, 3435)
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first national federal_judiciary_substance_abuse_treatment_expenditures2/total_expenditures: 8134944 vs 8134945
- 1 table-periods: PDF read by word positions but rejected by a gate: 26 row totals smaller than the rows under them, first complaints_concluded total: 482 vs 694
- 1 table-periods: PDF read by word positions but rejected by a gate: 28 row totals smaller than the rows under them, first complaints_concluded total: 752 vs 1100
- 1 table-periods: PDF read by word positions but rejected by a gate: 15 row totals smaller than the rows under them, first actions_by_chief_judges/complaint_dismissed_in_whole_or_in_part total: 1277 vs 2530
- 1 table-periods: PDF read by word positions but rejected by a gate: 15 row totals smaller than the rows under them, first actions_by_circuit_chief_judge/complaint_dismissed_in_whole_or_in_part total: 1540 vs 2942
- 1 table-periods: PDF read by word positions but rejected by a gate: 13 row totals smaller than the rows under them, first complaint_dismissed_in_whole_or_in_part total: 1265 vs 2340
- 1 table-periods: PDF read by word positions but rejected by a gate: 17 row totals smaller than the rows under them, first complaint_dismissed_in_whole_or_in_part total: 1147 vs 2010
- 1 table-periods: PDF read by word positions but rejected by a gate: 14 row totals smaller than the rows under them, first complaint_dismissed_in_whole_or_in_part total: 1480 vs 2596
- 1 table-periods: PDF read by word positions but rejected by a gate: 15 row totals smaller than the rows under them, first complaint_dismissed_in_whole_or_in_part total: 1384 vs 2593
- 1 table-periods: PDF read by word positions but rejected by a gate: rows with an empty cell: ['Conflict of Interest (Including Refusal to Recuse) 144']
- 1 table-periods: spreadsheet could not be opened: File is not a zip file
- 1 table-periods: PDF read by word positions but rejected by a gate: 2 roll-up identity failures, first ('total', 'national', 3510, 3506)
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total', 'ca8', 570, 511)
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('national', 'national')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: title table S-22 != listing S-21
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 7 figures where the page has 6 columns: Pending September 30 24,459 * 26,463 28,219 29,685 31,375 5.7
- 1 table-periods: spreadsheet rejected by a gate: period in title 2021-09-30 differs from listing 2022-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 12 columns: 3 2
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('total', 'national', 52014, 52913)
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 roll-up identity failures, first ('total', 'ca8', 1798, 1703)
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca6')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: 3 roll-up identity failures, first ('total_all_trials', 'ca5', 1791, 1628)
- 1 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first 12_months_ending_sept_30_ym1~2
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('supervised_release_revocation_hearings', 'national', 3570, 736)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 4 columns: I L , N A c t i v e 1 1
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 3 figures where the page has 4 columns: Senior - - -
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1987-06-30 differs from listing 1997-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1988-06-30 differs from listing 1998-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1989-06-30 differs from listing 1999-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1990-06-30 differs from listing 2000-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1991-06-30 differs from listing 2001-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1992-06-30 differs from listing 2002-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 1999-09-30 differs from listing 2003-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2000-09-30 differs from listing 2004-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2001-09-30 differs from listing 2005-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2002-09-30 differs from listing 2006-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2003-09-30 differs from listing 2007-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2004-09-30 differs from listing 2008-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2005-09-30 differs from listing 2009-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2006-09-30 differs from listing 2010-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2007-09-30 differs from listing 2011-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2008-09-30 differs from listing 2012-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: period in title 2009-09-30 differs from listing 2013-09-30
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 4 columns: . U 2
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first national federal_judiciary_substance_abuse_treatment_expenditures2/total_expenditures: 29008560 vs 29008561
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 row totals smaller than the rows under them, first national federal_judiciary_substance_abuse_treatment_expenditures2/total_expenditures: 19352723 vs 19352724
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 10 figures where the page has 2 columns: 1996 1,160 10,121 199,844 19.7 52,911 5.2 26,728 45,267 4.47
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 6 columns: . U 2
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 2 columns: ME No 89
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 2 columns: ME No 96
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 2 columns: ME No 59
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 2 columns: NY,S No 9,862
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 2 columns: NY,S No 11,854
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 1 figures where the page has 2 columns: NY,S No 10,933
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 9 figures where the page has 6 columns: Received by Transfer 6,073 5,661 -6.8 N/A ** N/A ** N/A **
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 9 figures where the page has 6 columns: Received by Transfer 5,661 5,102 -9.87 N/A ** N/A ** N/A **

## Bankruptcy Filings

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-filings-statistics

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| F | 419 | 419 | 417 | 221 | 0 | 198 | 0 | 0 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| F | U.S. Bankruptcy Courts - Bankruptcy Cases Filed, Terminated, and Pending | 103 | 103 | 101 | 4 | 0 | 99 | 0 | 0 | 2006-03-31 to 2026-09-30 |  |
| F-2 | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 103 | 103 | 103 | 4 | 0 | 99 | 0 | 0 | 2003-03-31 to 2026-09-30 |  |
| F-2 (One Month) | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 55 | 55 | 55 | 55 | 0 | 0 | 0 | 0 | 2013-03-31 to 2026-09-30 |  |
| F-2 (Three Months) | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 103 | 103 | 103 | 103 | 0 | 0 | 0 | 0 | 2001-03-31 to 2026-09-30 |  |
| F-5A | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 55 | 55 | 55 | 55 | 0 | 0 | 0 | 0 | 2013-03-31 to 2026-09-30 |  |

## Bankruptcy Abuse Prevention and Consumer Protection Act (BAPCPA) report

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-abuse-prevention-and-consumer-protection-act-report

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 76 | 76 | 52 | 52 | 0 | 0 | 0 | 24 |
| 2 | 76 | 76 | 52 | 52 | 0 | 0 | 0 | 24 |
| 3 | 19 | 19 | 14 | 14 | 0 | 0 | 0 | 5 |
| 4 | 19 | 19 | 17 | 17 | 0 | 0 | 0 | 2 |
| 5 | 19 | 19 | 16 | 16 | 0 | 0 | 0 | 3 |
| 6 | 19 | 19 | 8 | 7 | 1 | 0 | 0 | 11 |
| 7 | 19 | 19 | 16 | 16 | 0 | 0 | 0 | 3 |
| 8 | 76 | 76 | 59 | 59 | 0 | 0 | 0 | 17 |
| 9 | 76 | 76 | 37 | 37 | 0 | 0 | 0 | 39 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| BAPCPA 1A | U.S. Bankruptcy Courts - Assets and Liabilities Reported in Chapter 7 Cases Filed | 19 | 19 | 14 | 14 | 0 | 0 | 0 | 5 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (2) |
| BAPCPA 1B | U.S. Bankruptcy Courts - Assets and Liabilities Reported in Chapter 11 Cases Filed | 19 | 19 | 14 | 14 | 0 | 0 | 0 | 5 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (3) |
| BAPCPA 1D | U.S. Bankruptcy Courts - Assets and Liabilities Reported in Chapter 13 Cases Filed | 19 | 19 | 15 | 15 | 0 | 0 | 0 | 4 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (3) |
| BAPCPA 1X | U.S. Bankruptcy Courts - Assets and Liabilities Reported in Cases Filed | 19 | 19 | 9 | 9 | 0 | 0 | 0 | 10 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (5) |
| BAPCPA 2A | U.S. Bankruptcy Courts - Income and Expenses Reported in Chapter 7 Cases Filed | 19 | 19 | 14 | 14 | 0 | 0 | 0 | 5 | 2009-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (3) |
| BAPCPA 2B | U.S. Bankruptcy Courts - Income and Expenses Reported in Chapter 11 Cases Filed | 19 | 19 | 15 | 15 | 0 | 0 | 0 | 4 | 2010-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (1) |
| BAPCPA 2D | U.S. Bankruptcy Courts - Income and Expenses Reported in Chapter 13 Cases Filed | 19 | 19 | 11 | 11 | 0 | 0 | 0 | 8 | 2009-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (5) |
| BAPCPA 2X | U.S. Bankruptcy Courts - Income and Expenses Reported in Cases Filed | 19 | 19 | 12 | 12 | 0 | 0 | 0 | 7 | 2009-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (4) |
| BAPCPA 3 | U.S. Bankruptcy Courts - Time Intervals From Filing to Disposition of Cases Terminated, by | 19 | 19 | 14 | 14 | 0 | 0 | 0 | 5 | 2008-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (3) |
| BAPCPA 4 | U.S. Bankruptcy Courts - Reaffirmation Agreements in Chapter 7 Cases Terminated | 19 | 19 | 17 | 17 | 0 | 0 | 0 | 2 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (2) |
| BAPCPA 5 | U.S. Bankruptcy Courts - Cases in Which Property Valuation Orders Were Entered in Chapter  | 19 | 19 | 16 | 16 | 0 | 0 | 0 | 3 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (2) |
| BAPCPA 6 | U.S. Bankruptcy Courts - Chapter 13 Cases Terminated by Dismissal or Plan Completion | 19 | 19 | 8 | 7 | 1 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (10) |
| BAPCPA 7 | U.S. Bankruptcy Courts - Prior Filing Status Reported in Chapter 13 Cases Filed | 19 | 19 | 16 | 16 | 0 | 0 | 0 | 3 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca9'), ('district', 'akd'), ('district', 'almd'), ('district', 'alnd'), ('district', 'alsd'), ('district', 'arcomb')] extra [('district', 'ared'), ('district', 'arwd')] (2) |
| BAPCPA 8A | U.S. Bankruptcy Courts - Creditor Misconduct in Chapter 7 Cases Terminated | 19 | 19 | 13 | 13 | 0 | 0 | 0 | 6 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (2) |
| BAPCPA 8B | U.S. Bankruptcy Courts - Creditor Misconduct in Chapter 11 Cases Terminated | 19 | 19 | 16 | 16 | 0 | 0 | 0 | 3 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no table rows found in the text layer (1) |
| BAPCPA 8D | U.S. Bankruptcy Courts - Creditor Misconduct in Chapter 13 Cases Terminated | 19 | 19 | 14 | 14 | 0 | 0 | 0 | 5 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (2) |
| BAPCPA 8X | U.S. Bankruptcy Courts - Creditor Misconduct in Cases Terminated | 19 | 19 | 16 | 16 | 0 | 0 | 0 | 3 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no table rows found in the text layer (1) |
| BAPCPA 9A | U.S. Bankruptcy Courts - FRBP 9011 Sanctions and Damages Imposed Against Debtors' Attorney | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'arcomb'), ('district', 'dcd'), ('national', 'national')] extra [('district', 'ared'), ('district', 'arwd')] (4) |
| BAPCPA 9B | U.S. Bankruptcy Courts - FRBP 9011 Sanctions and Damages Imposed Against Debtors' Attorney | 19 | 19 | 9 | 9 | 0 | 0 | 0 | 10 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'arcomb'), ('district', 'dcd'), ('national', 'national')] extra [('district', 'ared'), ('district', 'arwd')] (4) |
| BAPCPA 9D | U.S. Bankruptcy Courts - FRBP 9011 Sanctions and Damages Imposed Against Debtors' Attorney | 19 | 19 | 9 | 9 | 0 | 0 | 0 | 10 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'arcomb'), ('district', 'dcd'), ('national', 'national')] extra [('district', 'ared'), ('district', 'arwd')] (2) |
| BAPCPA 9X | U.S. Bankruptcy Courts - FRBP 9011 Sanctions and Damages Imposed Against Debtors' Attorney | 19 | 19 | 11 | 11 | 0 | 0 | 0 | 8 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows (7) |

Never parsed or not published, by reason:

- 48 table-periods: PDF read by word positions but rejected by a gate: the halves of the table do not list the same rows
- 16 table-periods: PDF read by word positions but rejected by a gate: no table rows found in the text layer
- 14 table-periods: PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns
- 10 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'arcomb'), ('district', 'dcd'), ('national', 'national')] extra [('district', 'ared'), ('district', 'arwd')]
- 3 table-periods: PDF read by word positions but rejected by a gate: court set differs (missing ['akd', 'arcomb', 'azd', 'cacd', 'caed', 'cand'], extra ['ared', 'arwd']) and no circuit roll-up checks ['akd', 'azd', 'cacd', 'caed', 'cand', 'casd']
- 3 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca5'), ('district', 'akd'), ('district', 'almd'), ('district', 'alnd'), ('district', 'alsd'), ('district', 'arcomb')] extra [('district', 'ared'), ('district', 'arwd')]
- 2 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca11'), ('circuit', 'ca5'), ('circuit', 'ca8'), ('district', 'arcomb'), ('district', 'dcd')] extra [('district', 'ared'), ('district', 'arwd')]
- 2 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca9'), ('district', 'akd'), ('district', 'almd'), ('district', 'alnd'), ('district', 'alsd'), ('district', 'arcomb')] extra [('district', 'ared'), ('district', 'arwd')]
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['ME']
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['NMI']
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('circuit', 'ca10'), ('circuit', 'ca8'), ('circuit', 'ca9'), ('district', 'akd'), ('district', 'arcomb'), ('district', 'azd')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: court set differs: missing [('national', 'national')] extra []
- 1 table-periods: PDF read by word positions but rejected by a gate: court rows with an empty cell: ['10TH']
- 1 table-periods: PDF read by word positions but rejected by a gate: 5 roll-up identity failures, first ('total_cases_1', 'ca8', 2337, 1650)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 53,094 7 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 34,024 3 1 3 1
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 32,346 3 0 0 1
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 7TH 40 0 0 0 0
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 7TH 26 0 0 0 0
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 7TH 36,827 1 0 0 0
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 7TH 32,961 3 0 0 0
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 7TH 101,662 3 0 0 0
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 7TH 92,301 8 0 0 0
- 1 table-periods: PDF read by word positions but rejected by a gate: 1 roll-up identity failures, first ('cases/total', 'ca6', 61972, 52887)
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 46,081 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 38,507 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 34,024 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 32,346 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 19 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 17 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 23 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 16 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 14,410 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 14,469 2 1 15 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 14,600 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 14,549 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 5 figures where the page has 4 columns: 10TH 13,781 0 0 0 10
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 8 figures where the page has 7 columns: 2ND 8,127 482 306 37 553 354 39 02

## Wiretap report

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/wiretap-reports

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Wire 1-10 | 263 | 263 | 80 | 80 | 0 | 0 | 0 | 183 |
| Wire A/B | 88 | 88 | 0 | 0 | 0 | 0 | 0 | 88 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Wire 1 | Wiretap - Jurisdictions with Statutes Authorizing the Interception of Wire, Oral, or Elect | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 2 | Wiretap - Intercept Orders Issued by Judges | 28 | 28 | 8 | 8 | 0 | 0 | 0 | 20 | 2018-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (the letters over the columns are not those of the workbook headings) (14) |
| Wire 3 | Wiretap - Major Offenses for Which Court-Authorized Intercepts Were Granted | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2007-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (the letters over the columns are not those of the workbook headings) (8) |
| Wire 4 | Wiretap - Interceptions of Wire, Oral, or Electronic Communications | 29 | 29 | 19 | 19 | 0 | 0 | 0 | 10 | 1997-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the heading 'NY ORGANIZED CRIME' is not a state or territory name (2) |
| Wire 5 | Wiretap - Average Cost per Order | 29 | 29 | 23 | 23 | 0 | 0 | 0 | 6 | 1997-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: the heading 'NY ORGANIZED CRIME' is not a state or territory name (2) |
| Wire 6 | Wiretap - Types of Surveillance Used, Arrests, and Convictions for Intercepts Installed | 29 | 29 | 18 | 18 | 0 | 0 | 0 | 11 | 2004-12-31 to 2025-12-31 | PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (the letters over the columns are not those of the workbook headings) (3) |
| Wire 7 | Wiretap - Authorized Intercepts Granted | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 8 | Wiretap - Supplementary Data for Intercepts Terminated in Prior Years as Reported | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 9 | Wiretap - Arrests and Convictions Resulting from Intercepts Installed | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 10 | Wiretap - Intercept Orders Issued by Federal Judges | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 3 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (3) |
| Wire A1 | Wiretap - Intercepts of Wire, Oral, or Electronic Communications Authorized by U.S. Distri | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (15) |
| Wire A2 | Wiretap - Detail of Supplementary Data for Intercepts Authorized by U.S. District Courts a | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 15 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (15) |
| Wire B1 | Wiretap - Intercepts of Wire, Oral, or Electronic Communications Authorized by State Court | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (15) |
| Wire B2 | Wiretap - Detail of Supplementary Data for Intercepts Authorized by State Courts and Termi | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 15 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (15) |

Never parsed or not published, by reason:

- 139 table-periods: PDF only, and no spreadsheet edition of this table parses as a court table to name its columns
- 68 table-periods: not a jurisdiction table (statutes, multi-year summary or order-by-order listing)
- 25 table-periods: PDF read by word positions but rejected by a gate: no match of the PDF's column headings to the reference columns (the letters over the columns are not those of the workbook headings)
- 7 table-periods: PDF read by word positions but rejected by a gate: no table rows found in the text layer
- 5 table-periods: PDF read by word positions but rejected by a gate: the heading 'NY ORGANIZED CRIME' is not a state or territory name
- 5 table-periods: jurisdiction table rejected by a gate: this edition prints the local jurisdictions without their state rows ('MARICOPA' follows the federal districts), so a county named like a state cannot be told from the state rows of the other editions
- 5 table-periods: jurisdiction table rejected by a gate: this edition prints the local jurisdictions without their state rows ('3rd Judicial District' follows the federal districts), so a county named like a state cannot be told from the state rows of the other editions
- 4 table-periods: PDF read by word positions but rejected by a gate: no period in the title
- 2 table-periods: PDF read by word positions but rejected by a gate: the heading '16TH CIRCUIT COURT' is not a state or territory name
- 2 table-periods: PDF read by word positions but rejected by a gate: the heading 'FORCE' is not a state or territory name
- 2 table-periods: PDF read by word positions but rejected by a gate: the heading 'TASK FORCE' is not a state or territory name
- 1 table-periods: PDF read by word positions but rejected by a gate: Total number_authorized 1710 != FEDERAL plus the local jurisdictions 1702
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 11 figures where the page has 10 columns: NYC SPECIAL NARCOTICS BUREAU 11 1 - - - - - - 111 - -
- 1 table-periods: PDF read by word positions but rejected by a gate: Total other 96 != FEDERAL plus the local jurisdictions 93
- 1 table-periods: PDF read by word positions but rejected by a gate: Total total 3395 != FEDERAL plus the local jurisdictions 3329
- 1 table-periods: PDF read by word positions but rejected by a gate: Total other 93 != FEDERAL plus the local jurisdictions 92
- 1 table-periods: PDF read by word positions but rejected by a gate: Total other 191 != FEDERAL plus the local jurisdictions 188
- 1 table-periods: PDF read by word positions but rejected by a gate: a line prints 2 figures where the page has 7 columns: 2 7

## Judicial Facts and Figures

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-facts-and-figures

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |
| 2 | 147 | 147 | 74 | 0 | 0 | 0 | 74 | 73 |
| 3 | 42 | 42 | 20 | 0 | 0 | 0 | 20 | 22 |
| 4 | 251 | 251 | 90 | 0 | 0 | 0 | 90 | 161 |
| 5 | 92 | 92 | 20 | 0 | 0 | 0 | 20 | 72 |
| 6 | 126 | 126 | 60 | 0 | 0 | 0 | 60 | 66 |
| 7 | 63 | 63 | 32 | 0 | 0 | 0 | 32 | 31 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1.1 | U.S. Federal Courts - Judicial Officers in the U.S. Courts of Appeals, District Courts, an | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 2.1 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending (Summary) | 21 | 21 | 11 | 0 | 0 | 0 | 11 | 10 |  | no reader in this stream (another stream publishes this publication) (9) |
| 2.2 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending (Details) | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 2.3 | U.S. Courts of Appeals - Cases Filed, by Nature of Proceeding | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 2.4 | U.S. Courts of Appeals - Pro Se Cases Filed, by Nature of Proceeding | 21 | 21 | 11 | 0 | 0 | 0 | 11 | 10 |  | no reader in this stream (another stream publishes this publication) (9) |
| 2.5 | U.S. Courts of Appeals - Type of Opinion or Order Filed in Cases Terminated on the Merits | 21 | 21 | 11 | 0 | 0 | 0 | 11 | 10 |  | no reader in this stream (another stream publishes this publication) (9) |
| 2.6 | U.S. Courts of Appeals - Judge Participation in Cases Terminated on the Merits | 21 | 21 | 11 | 0 | 0 | 0 | 11 | 10 |  | no reader in this stream (another stream publishes this publication) (9) |
| 2.7 | U.S. Courts of Appeals - Petitions for Rehearing and Applications for Interlocutory Appeal | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 3.1 | U.S. Court of Appeals for the Federal Circuit - Cases Filed, Terminated, and Pending | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 3.2 | U.S. Court of Appeals for the Federal Circuit - Cases Filed, by Source | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 4.1 | U.S. District Courts - Civil Cases Filed, Terminated, and Pending | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 4.2 | U.S. District Courts - Civil Cases Filed, by District | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 21 |  | no reader in this stream (another stream publishes this publication) (20) |
| 4.3 | U.S. District Courts - Civil Cases Filed, by Origin | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 4.4 | U.S. District Courts - Civil Cases Filed, by Nature of Suit | 20 | 20 | 0 | 0 | 0 | 0 | 0 | 20 |  | no reader in this stream (another stream publishes this publication) (19) |
| 4.5 | U.S. District Courts - Product Liability Cases Filed, by Nature of Suit | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 4.6 | U.S. District Courts - Prisoner Petitions Filed, by Jurisdiction and Nature of Suit | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 4.7 | U.S. District Courts - Copyright, Patent, and Trademark Cases Filed, by Jurisdiction | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 4.8 | U.S. District Courts - Civil Cases Filed, by Jurisdiction | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 4.9 | U.S. District Courts - Diversity of Citizenship Cases Filed, by Nature of Suit | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 21 |  | no reader in this stream (another stream publishes this publication) (20) |
| 4.10 | U.S. District Courts - Civil Cases Terminated, by Action Taken | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 4.11 | U.S. District Courts - Civil Cases Pending, by Length of Time | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 4.12 | U.S. District Courts - Civil Consent Cases Terminated by U.S. Magistrate Judges Under 28 U | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 5.1 | U.S. District Courts - Criminal Cases and Defendants Filed, Terminated, and Pending (Inclu | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 5.2 | U.S. District Courts - Criminal Cases Filed, by District (Including Transfers) | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 21 |  | no reader in this stream (another stream publishes this publication) (20) |
| 5.3 | U.S. District Courts - Criminal Defendants Filed, by Offense | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 21 |  | no reader in this stream (another stream publishes this publication) (20) |
| 5.3 Retired | U.S. District Courts - Criminal Cases Filed, by Offense | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 8 |  | no reader in this stream (another stream publishes this publication) (8) |
| 5.4 | U.S. District Courts - Criminal Defendants Terminated, by Type of Disposition | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 6.1 | U.S. District Courts - Total Civil and Criminal Cases Filed, Terminated, and Pending (Incl | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 6.2 | U.S. District Courts - Weighted and Unweighted Filings per Authorized Judgeship | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 6.3 | U.S. District Courts - Median Time From Filing to Termination for Civil Cases and Criminal | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 6.4 | U.S. District Courts - Civil and Criminal Trials Completed | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 6.5 | U.S. District Courts - Lengths of Civil and Criminal Trials Completed | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 6.6 | U.S. District Courts - Civil Cases and Criminal Defendants Terminated by Senior, Visiting, | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 7.1 | U.S. Bankruptcy Courts - Bankruptcy Cases Filed, Terminated, and Pending | 21 | 21 | 10 | 0 | 0 | 0 | 10 | 11 |  | no reader in this stream (another stream publishes this publication) (10) |
| 7.2 | U.S. Bankruptcy Courts - Voluntary and Involuntary Cases Filed, by Chapter of the Bankrupt | 21 | 21 | 11 | 0 | 0 | 0 | 11 | 10 |  | no reader in this stream (another stream publishes this publication) (9) |
| 7.3 | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 21 | 21 | 11 | 0 | 0 | 0 | 11 | 10 |  | no reader in this stream (another stream publishes this publication) (9) |

Never parsed or not published, by reason:

- 401 table-periods: no reader in this stream (another stream publishes this publication)
- 35 table-periods: no reader for this document

## Federal Court Management Statistics

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/federal-court-management-statistics

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| APPEALS-PARTICIPATIONS | 59 | 59 | 0 | 0 | 0 | 0 | 0 | 59 |
| APPEALS-PROFILES | 84 | 84 | 76 | 0 | 0 | 0 | 76 | 8 |
| APPEALS-SUMMARY | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 60 |
| DISTRICT-COMPARISON | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 60 |
| DISTRICT-PROFILES | 84 | 84 | 76 | 0 | 0 | 0 | 76 | 8 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| FCMS-APPEALS-PARTICIPATIONS | U.S. Courts of Appeals - Federal Court Management Statistics–Case Participations | 59 | 59 | 0 | 0 | 0 | 0 | 0 | 59 |  | no reader for this document (59) |
| FCMS-APPEALS-PROFILES | U.S. Courts of Appeals - Federal Court Management Statistics–Profiles | 84 | 84 | 76 | 0 | 0 | 0 | 76 | 8 |  | no reader in this stream (another stream publishes this publication) (8) |
| FCMS-APPEALS-SUMMARY | U.S. Courts of Appeals - Federal Court Management Statistics–Summary | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 60 |  | no reader for this document (60) |
| FCMS-DISTRICT-COMPARISON | U.S. District Courts - Federal Court Management Statistics–Comparison Within Circuit | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 60 |  | no reader for this document (60) |
| FCMS-DISTRICT-PROFILES | U.S. District Courts - Federal Court Management Statistics–Profiles | 84 | 84 | 76 | 0 | 0 | 0 | 76 | 8 |  | no reader in this stream (another stream publishes this publication) (8) |

Never parsed or not published, by reason:

- 179 table-periods: no reader for this document
- 16 table-periods: no reader in this stream (another stream publishes this publication)

## Civil Justice Reform Act (CJRA) report

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 15 | 15 | 15 | 0 | 0 | 0 | 15 | 0 |
| 2 | 15 | 15 | 15 | 0 | 0 | 0 | 15 | 0 |
| 3 | 15 | 15 | 15 | 0 | 0 | 0 | 15 | 0 |
| 4 | 15 | 15 | 15 | 0 | 0 | 0 | 15 | 0 |
| 7 | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |
| 8 | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |
| 9 | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |
| 10 | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |
| 11 | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| CJRA 1 | U.S. District Courts - Total Matters Pending, by Type of Matter and Type of Judge | 15 | 15 | 15 | 0 | 0 | 0 | 15 | 0 |  |  |
| CJRA 2 | U.S. District Courts - Total Pending Matters, by Type of Matter and Circuit | 15 | 15 | 15 | 0 | 0 | 0 | 15 | 0 |  |  |
| CJRA 3 | U.S. District Courts - Total Matters Pending, by Type of Matter and Circuit | 15 | 15 | 15 | 0 | 0 | 0 | 15 | 0 |  |  |
| CJRA 4 | U.S. District Courts - Average Number of Cases and Motions Pending, by Circuit | 15 | 15 | 15 | 0 | 0 | 0 | 15 | 0 |  |  |
| CJRA 7 | U.S. District Courts - Civil Cases Pending More Than Three Years | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |  |  |
| CJRA 8 | U.S. District Courts - Motions Pending More Than Six Months | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |  |  |
| CJRA 9 | U.S. District Courts - Bench Trials Submitted More Than Six Months | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |  |  |
| CJRA 10 | U.S. District Courts - Bankruptcy Appeals Pending More Than Six Months | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |  |  |
| CJRA 11 | U.S. District Courts - Social Security Appeals Pending More Than Six Months | 33 | 33 | 33 | 0 | 0 | 0 | 33 | 0 |  |  |

## Delayed-Notice Search Warrant report

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/delayed-notice-search-warrant-report

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| DNSW | 38 | 38 | 31 | 31 | 4 | 0 | 0 | 3 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| DNSW 1 |  | 19 | 19 | 17 | 17 | 1 | 0 | 0 | 1 | 2006-09-30 to 2024-09-30 | the PDF has no text layer (a scanned report); its figures cannot be read exactly (1) |
| DNSW 2 |  | 19 | 19 | 14 | 14 | 3 | 0 | 0 | 2 | 2006-09-30 to 2024-09-30 | the PDF has no text layer (a scanned report); its figures cannot be read exactly (1) |

Never parsed or not published, by reason:

- 2 table-periods: the PDF has no text layer (a scanned report); its figures cannot be read exactly
- 1 table-periods: figures printed in a row without a label (sheet row 29); that row cannot be stored, so the period's rows would not add up to its Total and the period is not used

## Director's Report on the Foreign Intelligence Surveillance Courts' Activities

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/directors-report-foreign-intelligence-surveillance-courts-activities

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| FISC | 11 | 11 | 11 | 11 | 0 | 0 | 0 | 0 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| FISC 1 |  | 11 | 11 | 11 | 11 | 0 | 0 | 0 | 0 | 2015-12-31 to 2025-12-31 |  |

## Crime Victims' Rights report (no tables; counts stated in each report)

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/crime-victims-rights-report

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Report | 18 | 18 | 18 | 18 | 0 | 0 | 0 | 0 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Report | Annual report to Congress (counts stated in its opening paragraph) | 18 | 18 | 18 | 18 | 0 | 0 | 0 | 0 | 2005-12-31 to 2024-12-31 |  |

