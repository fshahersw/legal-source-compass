# U.S. Courts statistical tables: coverage audit (2026-10-24)

Generated 2026-10-24T02:56:09+00:00 by `scripts/enrichment/uscourts_tables/coverage.py` from the listing of https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables (crawled 2026-10-23, the years 2025-2026 re-crawled on 2026-10-24: no table was added), the stream's file store and parse reports, and the built datasets. Each listing row is one table of one publication for one period.

Columns: **Listed** rows in the listing; **Acquired** file stored (here or by the stream that publishes that publication); **Parsed** read into a table (here or by that stream); **Published** in a dataset of this stream. Not published splits into **Held** (the edition fails its own printed totals), **Duplicate** (another publication prints the same table for the same period and that one is published), **Other dataset** (published by another stream's dataset) and **Gap**.

## Before and after

| | Listed | Acquired | Parsed | Published |
|---|---:|---:|---:|---:|
| Before (2026-10-23 build, as published) | 8360 | 5356 | not recorded | 2786 |
| After (this build) | 8360 | 7020 | 3874 | 3054 |

Before: the five uscourts_tables_* datasets as published on 2026-10-23 (their manifest hashes equal the local build files of that day), measured against today's listing (the earlier listing lacked the FCMS and CJRA rows); acquired counts this stream's file index of 2026-10-23 plus the other streams' stores. The parse report of that run was overwritten by the re-parse, so the earlier parsed count is not recorded.

## By publication

| Publication | Tables | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap | Published periods | Newest listed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| [Statistical Tables for the Federal Judiciary](https://www.uscourts.gov/data-news/reports/statistical-reports/statistical-tables-federal-judiciary) | 55 | 1690 | 1131 | 897 | 897 | 0 | 0 | 0 | 793 | 2001-06-30 to 2026-06-30 | 2026-06-30 |
| [Federal Judicial Caseload Statistics](https://www.uscourts.gov/data-news/reports/statistical-reports/federal-judicial-caseload-statistics) | 56 | 897 | 897 | 489 | 489 | 0 | 1 | 0 | 407 | 2001-03-31 to 2026-03-31 | 2026-03-31 |
| [Judicial Business of the United States Courts](https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-business-united-states-courts) | 154 | 3290 | 2509 | 1293 | 1291 | 2 | 0 | 0 | 1997 | 1997-09-30 to 2025-09-30 | 2025-09-30 |
| [Bankruptcy Filings](https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-filings-statistics) | 5 | 419 | 419 | 306 | 172 | 0 | 197 | 0 | 50 | 2009-06-30 to 2026-09-30 | 2026-09-30 |
| [Bankruptcy Abuse Prevention and Consumer Protection Act (BAPCPA) report](https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-abuse-prevention-and-consumer-protection-act-report) | 21 | 399 | 399 | 172 | 171 | 1 | 0 | 0 | 227 | 2007-12-31 to 2025-12-31 | 2025-12-31 |
| [Wiretap report](https://www.uscourts.gov/data-news/reports/statistical-reports/wiretap-reports) | 14 | 351 | 351 | 34 | 34 | 0 | 0 | 0 | 317 | 2018-12-31 to 2025-12-31 | 2025-12-31 |
| [Judicial Facts and Figures](https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-facts-and-figures) | 36 | 742 | 742 | 306 | 0 | 0 | 0 | 306 | 436 | none | 2025-09-30 |
| [Federal Court Management Statistics](https://www.uscourts.gov/data-news/reports/statistical-reports/federal-court-management-statistics) | 5 | 347 | 347 | 152 | 0 | 0 | 0 | 152 | 195 | none | 2026-06-30 |
| [Civil Justice Reform Act (CJRA) report](https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report) | 9 | 225 | 225 | 225 | 0 | 0 | 0 | 225 | 0 | none | 2026-03-31 |
| **All** | | 8360 | 7020 | 3874 | 3054 | 3 | 198 | 683 | 4422 | | |

## Held table-periods (fail their own printed totals)

| Publication | Table | Period | Failing tests | First failure (kind, row, column: printed vs sum of parts) | Period published from |
|---|---|---|---:|---|---|
| BAPCPA | BAPCPA 6 | 2019-12-31 | 1 | circuit, ca9, cases_refiled_after_dismissal_3: 2109 vs 2108 | gap |
| JB | M-4B | 2022-09-30 | 3 | coltotal, national, total: 42016 vs 42017 | gap |
| JB | V-1 | 2021-09-30 | 2 | national, national, services_provided_to_other_district_courts/civil_cases_terminated: 504 vs 472 | gap |

## Corrections and additions in this build

- Reconciliation: every table-period is tested against the totals it prints (reconcile.py); 3 editions that break their own totals are held (listed above). The roll-up check counted the D.C. row twice in tables that print it as a circuit and as a district (2023 on); that check error is fixed, and no data changed because of it.
- Units: 'Class A Misdemeanor' columns were typed as ratios (the word 'misdemeanor' contains 'mean'); they are counts.
- Percentages: 32 percent columns were stored as the fraction a percent-formatted cell holds (0.901 for 90.1%); every percent column now holds the printed percentage in every period. The court trend panel showed these as fractions.
- Labels: the 2nd Circuit row printed '2nd2' (footnote 2 in plain digits) in Judicial Business B-2, FY2018 was not read as a circuit; it is.
- New: BAPCPA report tables (2018-2025 workbooks) as uscourts_bapcpa; Wiretap jurisdiction Tables 2-6 (2018-2025) as uscourts_wiretap; uscourts_series_index; 69 more PDF-only court-table editions (H-1, H-7, H-13, E-2, E-3, J-1, J-2, BAPCPA 8) read under the PDF gates.
- Reachable but not table publications (not acquired): Crime Victims' Rights annual reports (18 PDFs), Delayed-Notice Search Warrant reports (9 report pages), Director's Report on the Foreign Intelligence Surveillance Courts (2 PDFs).

## Verification and cross-checks

Second code path (verify_uscourts_tables.py, no shared parser): 60 of 60 random court cells found again in the source workbook, 60 of 60 category-row cells, 15,230 district sums equal the printed Total (0 mismatches, 3,279 incomplete), 12 of 12 workbook editions agree with their own PDF row for row, 9,667 of 9,667 Wiretap groupings re-added from the stored figures, 11,791 of 15,735 PDF-read figures equal the next edition's prior-year column (the 3,944 others are figures the next edition revised, mostly bankruptcy cases pending; each period keeps its own edition's figure).

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

| Publication | Table-periods not stored |
|---|---:|
| Statistical Tables for the Federal Judiciary | 559 |
| Judicial Business of the United States Courts | 781 |

Judicial Business and Statistical Tables editions published only as PDF (mostly category tables, before 2017) were not downloaded once the volume's free space reached the 2.0 GB floor. The same command resumes them (stored copies are reused, one request per second): `python3 -I -B scripts/enrichment/uscourts_tables/acquire.py --pubs 77,78,79 --series ALL --pdf-only --min-free-gb 2.0`. Civil Justice Reform Act table files of older periods are held by that stream as one full report per period.


## Statistical Tables for the Federal Judiciary

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/statistical-tables-federal-judiciary

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B | 256 | 190 | 120 | 120 | 0 | 0 | 0 | 136 |
| C | 306 | 240 | 178 | 178 | 0 | 0 | 0 | 128 |
| D | 405 | 276 | 202 | 202 | 0 | 0 | 0 | 203 |
| E | 138 | 51 | 47 | 47 | 0 | 0 | 0 | 91 |
| F | 151 | 151 | 145 | 145 | 0 | 0 | 0 | 6 |
| H | 187 | 74 | 74 | 74 | 0 | 0 | 0 | 113 |
| J | 102 | 36 | 36 | 36 | 0 | 0 | 0 | 66 |
| JCI | 50 | 18 | 0 | 0 | 0 | 0 | 0 | 50 |
| M | 49 | 49 | 49 | 49 | 0 | 0 | 0 | 0 |
| T | 25 | 25 | 25 | 25 | 0 | 0 | 0 | 0 |
| V | 14 | 14 | 14 | 14 | 0 | 0 | 0 | 0 |
| X | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| B | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending | 51 | 51 | 50 | 50 | 0 | 0 | 0 | 1 | 2001-06-30 to 2026-06-30 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (1) |
| B-1 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending, by Nature of Proceeding | 51 | 51 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [13]) (21) |
| B-4 | U.S. Courts of Appeals - Median Times for Cases Terminated on the Merits | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |  | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (1) |
| B-5 | U.S. Courts of Appeals - Decisions in Cases Terminated on the Merits, by Nature of Proceed | 51 | 51 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [9]) (21) |
| B-7 | U.S. Courts of Appeals - Civil and Criminal Cases Filed, by Circuit and Nature of Suit or  | 51 | 18 | 16 | 16 | 0 | 0 | 0 | 35 | 2017-12-31 to 2026-06-30 | not acquired (33) |
| B-8 | U.S. Court of Appeals for the Federal Circuit - Cases Filed, Terminated, and Pending | 51 | 18 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | not acquired (33) |
| C | U.S. District Courts - Civil Cases Filed, Terminated, and Pending | 51 | 51 | 46 | 46 | 0 | 0 | 0 | 5 | 2001-06-30 to 2026-06-30 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca2')] extra [] (1) |
| C-1 | U.S. District Courts - Civil Cases Filed, Terminated, and Pending, by Jurisdiction | 51 | 51 | 46 | 46 | 0 | 0 | 0 | 5 | 2001-06-30 to 2026-06-30 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'moed')] extra [] (1) |
| C-2 | U.S. District Courts - Civil Cases Filed, by Jurisdiction and Nature of Suit | 51 | 18 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | not acquired (33) |
| C-3 | U.S. District Courts - Civil Cases Filed, by Jurisdiction, Nature of Suit, and District | 51 | 51 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | PDF text layer read but rejected by a gate: no rows with 17 figures (saw counts [16]) (20) |
| C-4 | U.S. District Courts - Civil Cases Terminated, by Nature of Suit and Action Taken | 51 | 18 | 0 | 0 | 0 | 0 | 0 | 51 |  | not acquired (33) |
| C-5 | U.S. District Courts - Median Time From Filing to Disposition of Civil Cases, by Action Ta | 51 | 51 | 50 | 50 | 0 | 0 | 0 | 1 | 2001-06-30 to 2026-06-30 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'cand')] extra [] (1) |
| D | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 51 | 51 | 48 | 48 | 0 | 0 | 0 | 3 | 2001-06-30 to 2026-06-30 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca6'), ('circuit', 'ca7')] extra [] (1) |
| D Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending (Including Transfers) | 51 | 51 | 46 | 46 | 0 | 0 | 0 | 5 | 2001-06-30 to 2026-06-30 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca11'), ('district', 'akd'), ('district', 'alsd'), ('district', 'arwd'), ('district', 'cand')] extra [] (1) |
| D-1 | U.S. District Courts - Criminal Fugitive Defendants Filed, Terminated, and Pending (Includ | 51 | 51 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | PDF text layer read but rejected by a gate: no rows with 22 figures (saw counts [11]) (28) |
| D-1 Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending, by Level of Offense | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 21 |  | not acquired (21) |
| D-1A | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-2 | U.S. District Courts - Criminal Defendants Filed, by Offense | 51 | 18 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | not acquired (33) |
| D-2 Cases | U.S. District Courts - Criminal Cases Filed, by Offense | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 21 |  | not acquired (21) |
| D-3 | U.S. District Courts - Criminal Defendants Filed, by Offense and District | 51 | 51 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [10]) (24) |
| D-3 Cases | U.S. District Courts - Criminal Cases Filed, by Offense and District | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 21 |  | not acquired (21) |
| D-3A | U.S. District Courts - Criminal Felony Defendants Filed, by Offense and District | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-4 | U.S. District Courts - Criminal Defendants Terminated, by Type of Disposition and Offense | 51 | 18 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | not acquired (33) |
| D-5 | U.S. District Courts - Criminal Defendants Sentenced After Conviction, by Type of Sentence | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-6 | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-6A | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 7 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 2023-06-30 to 2026-06-30 |  |
| D-14 | U.S. District Courts - Motions for Compassionate Release, or to Modify or Reduce Sentence, | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 2026-06-30 to 2026-06-30 |  |
| E-1 | Federal Probation System - Persons Received for and Removed From Post-Conviction Supervisi | 50 | 17 | 17 | 17 | 0 | 0 | 0 | 33 | 2017-12-31 to 2025-12-31 | not acquired (33) |
| E-2 | Federal Probation System - Persons Under Post-Conviction Supervision | 50 | 17 | 17 | 17 | 0 | 0 | 0 | 33 | 2017-12-31 to 2025-12-31 | not acquired (33) |
| E-7A | Federal Probation System - Post-Conviction Supervision Cases Terminated With and Without R | 38 | 17 | 13 | 13 | 0 | 0 | 0 | 25 | 2017-12-31 to 2025-12-31 | not acquired (21) |
| F | U.S. Bankruptcy Courts - Bankruptcy Cases Filed, Terminated, and Pending | 50 | 50 | 49 | 49 | 0 | 0 | 0 | 1 | 2001-06-30 to 2026-06-30 | PDF text layer read but rejected by a gate: no rows with 9 figures (saw counts [6]) (1) |
| F-2 | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 50 | 50 | 50 | 50 | 0 | 0 | 0 | 0 | 2001-06-30 to 2026-06-30 |  |
| F-8 | U.S. Bankruptcy Courts - Adversary Proceedings Filed, Terminated, and Pending | 51 | 51 | 46 | 46 | 0 | 0 | 0 | 5 | 2002-06-30 to 2026-06-30 | PDF text layer read but rejected by a gate: no rows with 9 figures (saw counts [4]) (2) |
| H-1 | Federal Pretrial Services - Cases Activated | 50 | 17 | 17 | 17 | 0 | 0 | 0 | 33 | 2017-12-31 to 2025-12-31 | not acquired (33) |
| H-2 | Federal Pretrial Services - Interviews and Types of Pretrial Services Reports | 50 | 17 | 17 | 17 | 0 | 0 | 0 | 33 | 2017-12-31 to 2025-12-31 | not acquired (33) |
| H-3 | Federal Pretrial Services - Recommendations Made for Initial Pretrial Release | 6 | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 2023-06-30 to 2025-12-31 |  |
| H-7 | Federal Pretrial Services - Defendants Received for and Under Pretrial Supervision | 40 | 17 | 17 | 17 | 0 | 0 | 0 | 23 | 2017-12-31 to 2025-12-31 | not acquired (23) |
| H-13 | Federal Pretrial Services - Cases Terminated, by Type of Disposition | 41 | 17 | 17 | 17 | 0 | 0 | 0 | 24 | 2017-12-31 to 2025-12-31 | not acquired (24) |
| J-1 | U.S. District Courts - Grand Juror Service | 51 | 18 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | not acquired (33) |
| J-2 | U.S. District Courts - Petit Juror Service on Days Jurors Were Selected for Trial | 51 | 18 | 18 | 18 | 0 | 0 | 0 | 33 | 2017-12-31 to 2026-06-30 | not acquired (33) |
| JCI | U.S. Federal Courts - Work of the Federal Judiciary | 50 | 18 | 0 | 0 | 0 | 0 | 0 | 50 |  | not acquired (32) |
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

- 559 table-periods: not acquired
- 28 table-periods: PDF text layer read but rejected by a gate: no rows with 22 figures (saw counts [11])
- 24 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [10])
- 21 table-periods: PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [9])
- 21 table-periods: PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [13])
- 20 table-periods: PDF text layer read but rejected by a gate: no rows with 17 figures (saw counts [16])
- 14 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('other', 'administrative_agency_appeals'), ('other', 'bankruptcy'), ('other', 'criminal'), ('other', 'original_proceedings_and_miscellaneous_applications'), ('other', 'other_private_civil'), ('other', 'other_u_s_civil')] extra []
- 14 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 27 labels repeat under the same parent with different figures, first actions_under_statutes/antitrust
- 13 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['actions']
- 7 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [9])
- 5 table-periods: PDF text layer read but rejected by a gate: no rows with 11 figures
- 5 table-periods: PDF text layer read but rejected by a gate: no rows with 14 figures
- 4 table-periods: PDF text layer read but rejected by a gate: no rows with 22 figures (saw counts [10, 11])
- 4 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 26 labels repeat under the same parent with different figures, first actions_under_statutes/antitrust
- 3 table-periods: spreadsheet rejected by a gate: 6/95 text cells
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [9, 10])
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 9 figures (saw counts [4])
- 2 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra []
- 2 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 20 labels repeat under the same parent with different figures, first all_other
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca2')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'wied')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'gasd'), ('national', 'national')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'mtd')] extra []
- 1 table-periods: spreadsheet rejected by a gate: title table C-2 != listing C
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'cand')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 9 figures (saw counts [6])
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('terminated/y0', 'ca9', 13975, 13988)
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca3')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'mnd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 22 figures (saw counts [11, 12])
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca11'), ('district', 'akd'), ('district', 'alsd'), ('district', 'arwd'), ('district', 'cand')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'alnd'), ('district', 'arwd'), ('district', 'cacd'), ('district', 'flsd'), ('district', 'gand')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca6'), ('circuit', 'ca7'), ('circuit', 'ca9'), ('district', 'akd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca5'), ('circuit', 'ca6'), ('circuit', 'ca7'), ('circuit', 'ca8'), ('district', 'ared'), ('district', 'arwd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'azd'), ('district', 'ctd'), ('district', 'iand'), ('district', 'iasd'), ('district', 'ilcd'), ('district', 'ilsd')] extra []
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
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca6'), ('circuit', 'ca7')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'gamd'), ('district', 'gasd'), ('district', 'tnwd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'alsd'), ('district', 'nmid')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'moed')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: column years printed [2009, 2008, 2009, 2008, 2009] but the reference columns carry [2008, 2009, 2008, 2009, 2008, 2009]
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'mied')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['december']
- 1 table-periods: PDF text layer read but rejected by a gate: 2 roll-up identity failures, first ('private_civil_cases/pending_december_31_y0', 'ca5', 9313, 49313)
- 1 table-periods: spreadsheet rejected by a gate: 7/95 text cells

## Federal Judicial Caseload Statistics

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/federal-judicial-caseload-statistics

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B | 130 | 130 | 58 | 58 | 0 | 0 | 0 | 72 |
| BAP | 36 | 36 | 9 | 9 | 0 | 0 | 0 | 27 |
| C | 156 | 156 | 95 | 95 | 0 | 0 | 0 | 61 |
| D | 206 | 206 | 96 | 96 | 0 | 0 | 0 | 110 |
| E | 70 | 70 | 27 | 27 | 0 | 0 | 0 | 43 |
| F | 78 | 78 | 74 | 74 | 0 | 1 | 0 | 3 |
| H | 95 | 95 | 60 | 60 | 0 | 0 | 0 | 35 |
| J | 52 | 52 | 22 | 22 | 0 | 0 | 0 | 30 |
| JCI | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 26 |
| M | 21 | 21 | 21 | 21 | 0 | 0 | 0 | 0 |
| T | 15 | 15 | 15 | 15 | 0 | 0 | 0 | 0 |
| V | 8 | 8 | 8 | 8 | 0 | 0 | 0 | 0 |
| X | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| B | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending | 26 | 26 | 24 | 24 | 0 | 0 | 0 | 2 | 2001-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca10')] extra [] (1) |
| B-1 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending, by Nature of Proceeding | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [13]) (11) |
| B-5 | U.S. Courts of Appeals - Decisions in Cases Terminated on the Merits, by Nature of Proceed | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [9]) (11) |
| B-7 | U.S. Courts of Appeals - Civil and Criminal Cases Filed, by Circuit and Nature of Suit or  | 26 | 26 | 7 | 7 | 0 | 0 | 0 | 19 | 2020-03-31 to 2026-03-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (17) |
| B-8 | U.S. Court of Appeals for the Federal Circuit - Cases Filed, Terminated, and Pending | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (17) |
| BAP-1 | U.S. Bankruptcy Appellate Panels - Cases Filed, Terminated, and Pending | 18 | 18 | 9 | 9 | 0 | 0 | 0 | 9 | 2018-03-31 to 2026-03-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (9) |
| BAP-2 | U.S. Bankruptcy Appellate Panels - Cases Filed, Terminated, and Pending, by Chapter of the | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 18 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (9) |
| C | U.S. District Courts - Civil Cases Filed, Terminated, and Pending | 26 | 26 | 25 | 25 | 0 | 0 | 0 | 1 | 2001-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'cod')] extra [] (1) |
| C-1 | U.S. District Courts - Civil Cases Filed, Terminated, and Pending, by Jurisdiction | 26 | 26 | 25 | 25 | 0 | 0 | 0 | 1 | 2001-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'innd')] extra [] (1) |
| C-2 | U.S. District Courts - Civil Cases Filed, by Jurisdiction and Nature of Suit | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (17) |
| C-3 | U.S. District Courts - Civil Cases Filed, by Jurisdiction, Nature of Suit, and District | 26 | 26 | 10 | 10 | 0 | 0 | 0 | 16 | 2011-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: no rows with 33 figures (saw counts [16]) (10) |
| C-4 | U.S. District Courts - Civil Cases Terminated, by Nature of Suit and Action Taken | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 26 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (17) |
| C-5 | U.S. District Courts - Median Time From Filing to Disposition of Civil Cases, by Action Ta | 26 | 26 | 26 | 26 | 0 | 0 | 0 | 0 | 2001-03-31 to 2026-03-31 |  |
| D | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 26 | 26 | 21 | 21 | 0 | 0 | 0 | 5 | 2004-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'utd')] extra [] (1) |
| D Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending (Including Transfers) | 26 | 26 | 22 | 22 | 0 | 0 | 0 | 4 | 2001-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'akd'), ('district', 'alsd'), ('district', 'cand'), ('district', 'casd'), ('district', 'flsd')] extra [] (1) |
| D-1 | U.S. District Courts - Criminal Fugitive Defendants Filed, Terminated, and Pending (Includ | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: no rows with 22 figures (saw counts [11]) (16) |
| D-1 Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending, by Level of Offense | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 11 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (11) |
| D-1A | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| D-2 | U.S. District Courts - Criminal Defendants Filed, by Offense | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (17) |
| D-2 Cases | U.S. District Courts - Criminal Cases Filed, by Offense | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 11 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (11) |
| D-3 | U.S. District Courts - Criminal Defendants Filed, by Offense and District | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [10]) (12) |
| D-3 Cases | U.S. District Courts - Criminal Cases Filed, by Offense and District | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 11 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (11) |
| D-3A | U.S. District Courts - Criminal Felony Defendants Filed, by Offense and District | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| D-4 | U.S. District Courts - Criminal Defendants Terminated, by Type of Disposition and Offense | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2018-03-31 to 2026-03-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (17) |
| D-5 | U.S. District Courts - Criminal Defendants Sentenced After Conviction, by Type of Sentence | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2023-03-31 to 2026-03-31 |  |
| D-6 | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| D-6A | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2024-03-31 to 2026-03-31 |  |
| D-14 | U.S. District Courts - Motions for Compassionate Release, or to Modify or Reduce Sentence, | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 2026-03-31 to 2026-03-31 |  |
| E-1 | Federal Probation System - Persons Received for and Removed From Post-Conviction Supervisi | 25 | 25 | 8 | 8 | 0 | 0 | 0 | 17 | 2018-03-31 to 2025-03-31 | PDF text layer read but rejected by a gate: no rows with 16 figures (saw counts [8]) (12) |
| E-2 | Federal Probation System - Persons Under Post-Conviction Supervision | 25 | 25 | 13 | 13 | 0 | 0 | 0 | 12 | 2006-03-31 to 2025-03-31 | PDF text layer read but rejected by a gate: no rows with 5 figures (saw counts [8]) (5) |
| E-7A | Federal Probation System - Post-Conviction Supervision Cases Terminated With and Without R | 20 | 20 | 6 | 6 | 0 | 0 | 0 | 14 | 2018-03-31 to 2025-03-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (12) |
| F | U.S. Bankruptcy Courts - Bankruptcy Cases Filed, Terminated, and Pending | 26 | 26 | 24 | 24 | 0 | 1 | 0 | 1 | 2001-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'mad')] extra [] (1) |
| F-2 | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 26 | 26 | 25 | 25 | 0 | 0 | 0 | 1 | 2001-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: header words not in the PDF: ['debt', 'nature', 'predominant'] (1) |
| F-8 | U.S. Bankruptcy Courts - Adversary Proceedings Filed, Terminated, and Pending | 26 | 26 | 25 | 25 | 0 | 0 | 0 | 1 | 2002-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: no rows with 9 figures (saw counts [4]) (1) |
| H-1 | Federal Pretrial Services - Cases Activated | 25 | 25 | 19 | 19 | 0 | 0 | 0 | 6 | 2006-03-31 to 2025-03-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [9]) (5) |
| H-2 | Federal Pretrial Services - Interviews and Types of Pretrial Services Reports | 25 | 25 | 8 | 8 | 0 | 0 | 0 | 17 | 2018-03-31 to 2025-03-31 | PDF text layer read but rejected by a gate: header words not in the PDF: ['pct'] (7) |
| H-3 | Federal Pretrial Services - Recommendations Made for Initial Pretrial Release | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-03-31 to 2025-03-31 |  |
| H-7 | Federal Pretrial Services - Defendants Received for and Under Pretrial Supervision | 20 | 20 | 18 | 18 | 0 | 0 | 0 | 2 | 2006-03-31 to 2025-03-31 | PDF text layer read but rejected by a gate: header words not in the PDF: ['april', 'defendents'] (1) |
| H-13 | Federal Pretrial Services - Cases Terminated, by Type of Disposition | 22 | 22 | 12 | 12 | 0 | 0 | 0 | 10 | 2013-03-31 to 2025-03-31 | PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [11]) (5) |
| J-1 | U.S. District Courts - Grand Juror Service | 26 | 26 | 11 | 11 | 0 | 0 | 0 | 15 | 2016-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: no rows with 7 figures (saw counts [6]) (15) |
| J-2 | U.S. District Courts - Petit Juror Service on Days Jurors Were Selected for Trial | 26 | 26 | 11 | 11 | 0 | 0 | 0 | 15 | 2016-03-31 to 2026-03-31 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (15) |
| JCI | U.S. Federal Courts - Work of the Federal Judiciary | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 26 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (17) |
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

- 182 table-periods: PDF only, and no spreadsheet edition of this table parses as a court table to name its columns
- 16 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra []
- 16 table-periods: PDF text layer read but rejected by a gate: no rows with 22 figures (saw counts [11])
- 15 table-periods: PDF text layer read but rejected by a gate: no rows with 7 figures (saw counts [6])
- 12 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [10])
- 12 table-periods: PDF text layer read but rejected by a gate: no rows with 16 figures (saw counts [8])
- 11 table-periods: PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [13])
- 11 table-periods: PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [9])
- 10 table-periods: PDF text layer read but rejected by a gate: no rows with 33 figures (saw counts [16])
- 8 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('other', 'administrative_agency_appeals'), ('other', 'bankruptcy'), ('other', 'criminal'), ('other', 'original_proceedings_and_miscellaneous_applications'), ('other', 'other_private_civil'), ('other', 'other_u_s_civil')] extra []
- 7 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 27 labels repeat under the same parent with different figures, first actions_under_statutes/antitrust
- 7 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['pct']
- 6 table-periods: PDF text layer read but rejected by a gate: no rows with 33 figures (saw counts [16, 17])
- 5 table-periods: PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [17])
- 5 table-periods: PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [11])
- 5 table-periods: PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [9])
- 5 table-periods: PDF text layer read but rejected by a gate: no rows with 5 figures (saw counts [8])
- 5 table-periods: PDF text layer read but rejected by a gate: no rows with 16 figures (saw counts [11])
- 4 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [9])
- 4 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 10 labels repeat under the same parent with different figures, first total_adversary
- 4 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['bop']
- 3 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 11 labels repeat under the same parent with different figures, first total_adversary
- 3 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['pct', 'report']
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 14 figures
- 2 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'cod')] extra []
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 11 figures
- 2 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 26 labels repeat under the same parent with different figures, first actions_under_statutes/antitrust
- 2 table-periods: spreadsheet rejected by a gate: 6/95 text cells
- 1 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 20 labels repeat under the same parent with different figures, first all_other
- 1 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 21 labels repeat under the same parent with different figures, first all_other
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'innd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 9 figures (saw counts [4])
- 1 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['debt', 'nature', 'predominant']
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca10')] extra []
- 1 table-periods: spreadsheet rejected by a gate: period in title 2009-03-31 differs from listing 2018-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2010-03-31 differs from listing 2019-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2011-03-31 differs from listing 2020-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2012-03-31 differs from listing 2021-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2013-03-31 differs from listing 2022-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2014-03-31 differs from listing 2023-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2015-03-31 differs from listing 2024-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2016-03-31 differs from listing 2025-03-31
- 1 table-periods: spreadsheet rejected by a gate: period in title 2017-03-31 differs from listing 2026-03-31
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'utd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nysd'), ('district', 'pamd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'akd'), ('district', 'alsd'), ('district', 'cacd'), ('district', 'cand'), ('district', 'casd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nyed')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'azd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'mad')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 22 figures (saw counts [10, 11])
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'akd'), ('district', 'alsd'), ('district', 'cand'), ('district', 'casd'), ('district', 'flsd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'iasd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'gasd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'tnwd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [9, 10])
- 1 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 12 labels repeat under the same parent with different figures, first total_adversary
- 1 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 9 labels repeat under the same parent with different figures, first total_adversary
- 1 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['april', 'defendents']
- 1 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['defendents']
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'akd'), ('district', 'arwd'), ('district', 'hid'), ('district', 'ilsd'), ('district', 'laed'), ('district', 'mdd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'akd'), ('district', 'arwd'), ('district', 'gasd'), ('district', 'gud'), ('district', 'hid'), ('district', 'idd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('cases_closed', 'national', 97608, 97578)
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('cases_closed', 'national', 101656, 101319)
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('cases_closed', 'national', 105905, 105410)
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'wyd')] extra []
- 1 table-periods: spreadsheet rejected by a gate: column 12 has figures but no heading
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'wvnd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'lamd'), ('district', 'msnd'), ('district', 'mssd'), ('district', 'ord')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'pamd')] extra []

## Judicial Business of the United States Courts

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-business-united-states-courts

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |
| B | 602 | 602 | 219 | 219 | 0 | 0 | 0 | 383 |
| BAP | 55 | 55 | 9 | 9 | 0 | 0 | 0 | 46 |
| C | 516 | 504 | 267 | 267 | 0 | 0 | 0 | 249 |
| D | 453 | 309 | 187 | 187 | 0 | 0 | 0 | 266 |
| E | 130 | 108 | 60 | 60 | 0 | 0 | 0 | 70 |
| F | 87 | 87 | 80 | 80 | 0 | 0 | 0 | 7 |
| G | 87 | 27 | 17 | 17 | 0 | 0 | 0 | 70 |
| H | 352 | 167 | 118 | 118 | 0 | 0 | 0 | 234 |
| J | 78 | 36 | 36 | 36 | 0 | 0 | 0 | 42 |
| JCI | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 6 |
| K | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 |
| M | 314 | 308 | 136 | 135 | 1 | 0 | 0 | 178 |
| P | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| S | 297 | 69 | 51 | 51 | 0 | 0 | 0 | 246 |
| T | 146 | 146 | 68 | 68 | 0 | 0 | 0 | 78 |
| V | 58 | 18 | 18 | 17 | 1 | 0 | 0 | 40 |
| X | 45 | 29 | 18 | 18 | 0 | 0 | 0 | 27 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| A-1 | Supreme Court of the United States - Cases on Docket, Disposed of, and Remaining on Docket | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| B | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending | 29 | 29 | 28 | 28 | 0 | 0 | 0 | 1 | 1997-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: duplicate court rows (1) |
| B-1 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending, by Nature of Proceeding | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [13]) (14) |
| B-1A | U.S. Courts of Appeals - Civil and Criminal Cases Filed, Terminated, and Pending, by Natur | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| B-2 | U.S. Courts of Appeals - Petitions for Review on Writ of Certiorari to the Supreme Court F | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (8) |
| B-3 | U.S. Courts of Appeals - Cases Filed, by Source | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('national', 'national'), ('other', '10th_circuit'), ('other', '11th_circuit'), ('other', '1st_circuit'), ('other', '2nd_circuit'), ('other', '3rd_circuit')] extra [] (16) |
| B-3A | U.S. Courts of Appeals - Sources of Civil and Criminal Cases from U.S. District Courts | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: header words not in the PDF: ['terminated'] (14) |
| B-4 | U.S. Courts of Appeals - Median Times for Cases Terminated on the Merits | 29 | 29 | 11 | 11 | 0 | 0 | 0 | 18 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [13]) (15) |
| B-4A | U.S. Courts of Appeals - Median Times for Civil and Criminal Cases Terminated on the Merit | 20 | 20 | 9 | 9 | 0 | 0 | 0 | 11 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [13]) (6) |
| B-4B | U.S. Courts of Appeals - Median Times for Bankruptcy Cases Terminated on the Merits | 20 | 20 | 12 | 12 | 0 | 0 | 0 | 8 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [13]) (6) |
| B-4C | U.S. Courts of Appeals - Median Times for Administrative Agency Cases Terminated on the Me | 20 | 20 | 12 | 12 | 0 | 0 | 0 | 8 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 12 figures (saw counts [11]) (6) |
| B-4D | U.S. Courts of Appeals - Median Times for Original Proceedings and Miscellaneous Applicati | 20 | 20 | 11 | 11 | 0 | 0 | 0 | 9 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [9]) (6) |
| B-5 | U.S. Courts of Appeals - Decisions in Cases Terminated on the Merits, by Nature of Proceed | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [9]) (15) |
| B-5A | U.S. Courts of Appeals - Cases Terminated on Procedural Grounds, by Nature of Proceeding | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| B-6 | U.S. Courts of Appeals - Cases Filed, Terminated, and Pending, by Nature of Proceeding, as | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (15) |
| B-7 | U.S. Courts of Appeals - Civil and Criminal Cases Filed, by Circuit and Nature of Suit or  | 29 | 29 | 8 | 8 | 0 | 0 | 0 | 21 | 2017-09-30 to 2025-09-30 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| B-8 | U.S. Court of Appeals for the Federal Circuit - Cases Filed, Terminated, and Pending | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| B-9 | U.S. Courts of Appeals - Pro Se Cases Filed and Terminated, by Nature of Proceeding | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (15) |
| B-10 | U.S. Courts of Appeals - Cases Teminated on the Merits After Oral Arguments or Submission  | 29 | 29 | 11 | 11 | 0 | 0 | 0 | 18 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table S-1 != listing B-10 (17) |
| B-11 | U.S. Courts of Appeals - Judge Participation in Cases Terminated on the Merits | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table S-2 != listing B-11 (17) |
| B-12 | U.S. Courts of Appeals - Type of Opinion or Order Filed in Cases Terminated on the Merits | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table S-3 != listing B-12 (17) |
| B-19 | U.S. Courts of Appeals - Pro Se Cases Filed, by Source | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| B-20 | U.S. Courts of Appeals - Cases Under Submission for More Than Three Months | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| BAP-1 | U.S. Bankruptcy Appellate Panels - Cases Filed, Terminated, and Pending | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| BAP-2 | U.S. Bankruptcy Appellate Panels - Cases Filed, Terminated and Pending, by Chapter of the  | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 26 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (17) |
| C | U.S. District Courts - Civil Cases Filed, Terminated, and Pending | 29 | 29 | 29 | 29 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| C-1 | U.S. District Courts - Civil Cases Filed, Terminated, and Pending, by Jurisdiction | 29 | 29 | 29 | 29 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| C-2 | U.S. District Courts - Civil Cases Filed, by Jurisdiction and Nature of Suit | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| C-2A | U.S. District Courts - Civil Cases Filed, by Nature of Suit | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| C-3 | U.S. District Courts - Civil Cases Filed by Jurisdiction, Nature of Suit, and District | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 17 figures (saw counts [16]) (13) |
| C-3A | U.S. District Courts - Civil Cases Pending by Jurisdiction, Nature of Suit, and District | 29 | 29 | 15 | 15 | 0 | 0 | 0 | 14 | 2011-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 17 figures (saw counts [16]) (12) |
| C-3B | U.S. District Courts - Civil Cases Terminated, by Jurisdiction, Nature of Suit, and Distri | 29 | 29 | 15 | 15 | 0 | 0 | 0 | 14 | 2011-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 17 figures (saw counts [16]) (14) |
| C-4 | U.S. District Courts - Civil Cases Terminated, by Nature of Suit and Action Taken | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| C-4A | U.S. District Courts - Civil Cases Terminated, by District and Action Taken | 28 | 28 | 28 | 28 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| C-5 | U.S. District Courts - Median Time From Filing to Disposition of Civil Cases, by Action Ta | 29 | 29 | 24 | 24 | 0 | 0 | 0 | 5 | 2000-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [20]) (3) |
| C-6 | U.S. District Courts - Civil Cases Pending, by Length of Time | 28 | 28 | 28 | 28 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| C-7 | U.S. District Courts - Intellectual Property Cases, Securities/Commodities/Exchange Cases, | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 21 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (12) |
| C-8 | U.S. District Courts - Civil Cases Filed, by Origin | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| C-9 | U.S. District Courts - Recovery of Overpayment and Enforcement of Judgment Cases Filed, by | 29 | 29 | 14 | 14 | 0 | 0 | 0 | 15 | 2011-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table S-8 != listing C-9 (14) |
| C-9 Retired | U.S. District Courts - Civil and Criminal Trials Terminated That Required 20 or More Days | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 12 |  | not acquired (12) |
| C-10 | U.S. District Courts - Social Security Cases Filed, by Nature of Suit | 29 | 29 | 14 | 14 | 0 | 0 | 0 | 15 | 2011-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table S-9 != listing C-10 (14) |
| C-11 | U.S. District Courts - Product Liability Cases Filed, by Nature of Suit | 29 | 29 | 11 | 11 | 0 | 0 | 0 | 18 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table S-10 != listing C-11 (14) |
| C-12 | U.S. District Courts - Civil Cases Pending Three Years or More, by Basis of Jurisdiction a | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (20) |
| C-13 | U.S. District Courts - Civil Pro Se and Non-Pro Se Filings | 21 | 21 | 15 | 15 | 0 | 0 | 0 | 6 | 2011-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table S-23 != listing C-13 (4) |
| D | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 29 | 29 | 27 | 27 | 0 | 0 | 0 | 2 | 1999-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nysd')] extra [] (1) |
| D Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending (Including Transfers) | 29 | 29 | 27 | 27 | 0 | 0 | 0 | 2 | 1999-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nysd')] extra [] (1) |
| D-1 | U.S. District Courts - Criminal Fugitive Defendants Filed, Terminated, and Pending (Includ | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [10]) (14) |
| D-1 Cases | U.S. District Courts - Criminal Cases Filed, Terminated, and Pending, by Level of Offense | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 15 |  | not acquired (15) |
| D-1A | U.S. District Courts - Criminal Defendants Filed, Terminated, and Pending (Including Trans | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| D-2 | U.S. District Courts - Criminal Defendants Filed, by Offense | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| D-2 Cases | U.S. District Courts - Criminal Cases Filed, by Offense | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 15 |  | not acquired (15) |
| D-3 | U.S. District Courts - Criminal Defendants Filed, by Offense and District | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [10]) (10) |
| D-3 Cases | U.S. District Courts - Criminal Cases Filed, by Offense and District | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 15 |  | not acquired (15) |
| D-3A | U.S. District Courts - Criminal Felony Defendants Filed, by Offense and District | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| D-4 | U.S. District Courts - Criminal Defendants Terminated, by Type of Disposition and Offense | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| D-5 | U.S. District Courts - Criminal Defendants Sentenced After Conviction, by Type of Sentence | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| D-6 | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 29 | 29 | 15 | 15 | 0 | 0 | 0 | 14 | 2011-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: header words not in the PDF: ['bench'] (14) |
| D-6A | U.S. District Courts - Median Time Intervals From Commencement to Termination for Criminal | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| D-7 | U.S. District Courts - Criminal Defendants Terminated, by Type of Disposition | 29 | 29 | 14 | 14 | 0 | 0 | 0 | 15 | 2012-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: header words not in the PDF: ['bench', 'supervision', 'trial'] (7) |
| D-8 | U.S. District Courts - Criminal Defendants Pending, by Offense | 28 | 28 | 9 | 9 | 0 | 0 | 0 | 19 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [10]) (12) |
| D-8 Cases | U.S. District Courts - Criminal Cases Pending, by Offense | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |  | not acquired (5) |
| D-9 | U.S. District Courts - Criminal Defendants Terminated, by Offense | 24 | 24 | 9 | 9 | 0 | 0 | 0 | 15 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [10]) (12) |
| D-10 | U.S. District Courts - Median Time From Commencement to Termination for Criminal Defendant | 24 | 9 | 9 | 9 | 0 | 0 | 0 | 15 | 2017-09-30 to 2025-09-30 | not acquired (15) |
| D-12 | U.S. District Courts - Median Time From Conviction to Sentencing for Criminal Defendants C | 29 | 29 | 14 | 14 | 0 | 0 | 0 | 15 | 2012-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 8 figures (saw counts [7]) (14) |
| D-13 | U.S. District Courts - Criminal Defendants Filed, by Type of Proceedings | 21 | 9 | 9 | 9 | 0 | 0 | 0 | 12 | 2017-09-30 to 2025-09-30 | not acquired (12) |
| D-13 Cases | U.S. District Courts - Criminal Cases Filed, by Type of Proceeding | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |  | not acquired (7) |
| E-1 | Federal Probation System - Persons Received for and Removed From Post-Conviction Supervisi | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 16 figures (saw counts [8]) (11) |
| E-2 | Federal Probation System - Persons Under Post-Conviction Supervision | 29 | 29 | 13 | 13 | 0 | 0 | 0 | 16 | 2006-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 5 figures (saw counts [8]) (9) |
| E-3 | Federal Probation System - Persons Under Post-Conviction Supervision, by Offense | 29 | 29 | 19 | 19 | 0 | 0 | 0 | 10 | 2006-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: header words not in the PDF: ['drugs', 'escape', 'firearms', 'immigration', 'obstruction', 'order'] (9) |
| E-4 | Federal Probation System - Persons Received From Judges for Post-Conviction Supervision, b | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |  | not acquired (2) |
| E-7 | Federal Probation System - Persons Removed From Post-Conviction Supervision With and Witho | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |  | not acquired (9) |
| E-7A | Federal Probation System - Post-Conviction Supervision Cases Terminated With and Without R | 20 | 9 | 7 | 7 | 0 | 0 | 0 | 13 | 2017-09-30 to 2025-09-30 | not acquired (11) |
| E-8 | Federal Probation System - Post-Conviction Supervision Cases Revoked and Closed | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| E-8A | Federal Probation System - Post-Conviction Supervision Cases Closed | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| E-10 | Federal Probation System - Presentence Investigations | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| F | U.S. Bankruptcy Courts - Bankruptcy Cases Filed, Terminated and Pending | 29 | 29 | 29 | 29 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| F-2 | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 29 | 29 | 29 | 29 | 0 | 0 | 0 | 0 | 1997-09-30 to 2025-09-30 |  |
| F-8 | U.S. Bankruptcy Courts - Adversary Proceedings Filed, Terminated, and Pending | 29 | 29 | 22 | 22 | 0 | 0 | 0 | 7 | 2002-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 9 figures (saw counts [4]) (5) |
| G-1 | U.S. Court of International Trade - Cases Filed, Terminated, and Pending | 29 | 9 | 8 | 8 | 0 | 0 | 0 | 21 | 2018-09-30 to 2025-09-30 | not acquired (20) |
| G-2A | U.S. Court of Federal Claims - Cases Filed, Terminated, and Pending, by Type of Case | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| G-2B | U.S. Court of Federal Claims - Judgment Amounts and Appeals to the U.S. Court of Appeals f | 29 | 9 | 0 | 0 | 0 | 0 | 0 | 29 |  | not acquired (20) |
| H-1 | Federal Pretrial Services - Cases Activated | 28 | 28 | 18 | 18 | 0 | 0 | 0 | 10 | 2006-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [9]) (8) |
| H-2 | Federal Pretrial Services - Interviews and Types of Pretrial Services Reports | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| H-3 | Federal Pretrial Services - Recommendations Made for Initial Pretrial Release | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| H-3A | Federal Pretrial Services - Recommendations Made for Initial Pretrial Release, Excluding I | 20 | 9 | 9 | 9 | 0 | 0 | 0 | 11 | 2017-09-30 to 2025-09-30 | not acquired (11) |
| H-3B | Federal Pretrial Services - Pretrial Services Recommendations Made For Initial Pretrial Re | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| H-4 | Federal Pretrial Services - Release and Detention Status at Initial Hearings | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |  | not acquired (9) |
| H-5 | Federal Pretrial Services - Initial Detention Hearings Held | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |  | not acquired (9) |
| H-6 | Federal Pretrial Services - Defendants Released on Bond, by Type | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| H-6A | Federal Pretrial Services - Conditions Imposed at Initial Hearings for Defendants Released | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | not acquired (1) |
| H-7 | Federal Pretrial Services - Defendants Received for and Under Pretrial Supervision | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| H-8 | Federal Pretrial Services - Defendants Released, by Conditions of Release | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| H-9A | Federal Pretrial Services - Pretrial Services Detention Summary: Days, Average and Median | 13 | 4 | 4 | 4 | 0 | 0 | 0 | 9 | 2022-09-30 to 2025-09-30 | not acquired (9) |
| H-10 | Federal Pretrial Services - Bail Review Hearings Held, by Type | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |  | not acquired (9) |
| H-11 | Federal Pretrial Services - Defendants With Bail Violations, by Type | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |  | not acquired (9) |
| H-11A | Federal Pretrial Services - Circumstances Involved in Technical Violations | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |  | not acquired (9) |
| H-12 | Federal Pretrial Services - Violations and Actions Taken by the Court | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |  | not acquired (9) |
| H-13 | Federal Pretrial Services - Cases Terminated, by Type of Disposition | 29 | 29 | 15 | 15 | 0 | 0 | 0 | 14 | 2008-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [11]) (9) |
| H-14 | Federal Pretrial Services - Defendants Released and Detained | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: header words not in the PDF: ['pct'] (11) |
| H-14A | Federal Pretrial Services - Defendants Released and Detained, Excluding Immigration Cases | 21 | 11 | 10 | 10 | 0 | 0 | 0 | 11 | 2017-09-30 to 2025-09-30 | not acquired (10) |
| H-14B | Federal Pretrial Services - Pretrial Services Release and Detention, Excluding Illegal Ali | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2022-09-30 to 2025-09-30 |  |
| H-15 | Federal Pretrial Services - Pretrial Services Violations Summary Report | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 4 |  | spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first pct~2 (4) |
| J-1 | U.S. District Courts - Grand Juror Service | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| J-2 | U.S. District Courts - Petit Juror Service on Days Jurors Were Selected for Trial | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| J-9 | U.S. District Courts - Grand Juror Service | 10 | 9 | 9 | 9 | 0 | 0 | 0 | 1 | 2017-09-30 to 2025-09-30 | not acquired (1) |
| J-10 | U.S. District Courts - Petit Juror Service | 10 | 9 | 9 | 9 | 0 | 0 | 0 | 1 | 2017-09-30 to 2025-09-30 | not acquired (1) |
| JCI | U.S. Federal Courts - Work of the Federal Judiciary | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 6 |  | spreadsheet rejected by a gate: period in title 2011-09-30 differs from listing 2020-09-30 (1) |
| K-1 | Federal Defender Organizations - Cases Filed, Terminated, and Pending, by Type of Represen | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| M-1 | U.S. District Courts - Class A Misdemeanor Defendants Terminated by U.S. Magistrate Judges | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: header words not in the PDF: ['drugs'] (18) |
| M-1A | U.S. District Courts - Class A Misdemeanor Defendants Terminated by U.S. Magistrate Judges | 24 | 24 | 14 | 14 | 0 | 0 | 0 | 10 | 2012-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: header words not in the PDF: ['bench', 'without'] (10) |
| M-2 | U.S. District Courts - Petty Offense Defendants Terminated by U.S. Magistrate Judges, by O | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nmid')] extra [] (8) |
| M-2A | U.S. District Courts - Petty Offense Defendants Terminated by U.S. Magistrate Judges, by T | 26 | 26 | 13 | 13 | 0 | 0 | 0 | 13 | 2013-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 7 figures (saw counts [5]) (13) |
| M-3 | U.S. District Courts - Felony Preliminary Proceedings Conducted by U.S. Magistrate Judges  | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2013-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nmid')] extra [] (8) |
| M-3A | U.S. District Courts - Miscellaneous Matters Conducted by U.S. Magistrate Judges | 26 | 26 | 9 | 9 | 0 | 0 | 0 | 17 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 13 figures (saw counts [12]) (17) |
| M-4 | U.S. District Courts - Criminal Pretrial Matters Conducted by U.S. Magistrate Judges Under | 26 | 26 | 13 | 13 | 0 | 0 | 0 | 13 | 2013-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [9]) (11) |
| M-4 Retired | U.S. District Courts - Matters Conducted by by U.S. Magistrate Judges Under 28 U.S.C. §§ 6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |  | not acquired (3) |
| M-4A | U.S. District Courts - Civil Pretrial Matters Conducted by U.S. Magistrate Judges Under 28 | 26 | 26 | 11 | 11 | 0 | 0 | 0 | 15 | 2014-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nmid')] extra [] (9) |
| M-4A Retired | U.S. District Courts - Proceedings and Cases Conducted by by U.S. Magistrate Judges Under  | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |  | not acquired (3) |
| M-4B | U.S. District Courts - Reports and Recommendations Issued by U.S. Magistrate Judges Under  | 26 | 26 | 9 | 8 | 1 | 0 | 0 | 17 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nmid')] extra [] (9) |
| M-4C | U.S. District Courts - Evidentiary Proceedings Conducted by U.S. Magistrate Judges Under 2 | 29 | 29 | 12 | 12 | 0 | 0 | 0 | 17 | 2013-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 6 figures (saw counts [5]) (13) |
| M-5 | U.S. District Courts - Civil Consent Cases Terminated by U.S. Magistrate Judges Under 28 U | 26 | 26 | 13 | 13 | 0 | 0 | 0 | 13 | 2013-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nmid')] extra [] (9) |
| M-7 | U.S. District Courts - Matters Disposed of by U.S. Magistrate Judges, by Matter Type | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| M-8 | U.S. District Courts - Civil Consent Case Matters by U.S. Magistrate Judges Under 28 U.S.C | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| M-9 | U.S. District Courts - Non-Consent Prisoner Litigation Matters by U.S. Magistrate Judges U | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| M-10 | U.S. District Courts - Non-Consent Social Security Matters by U.S. Magistrate Judges Under | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 2023-09-30 to 2025-09-30 |  |
| P-1 | U.S. District Courts - Passport Applications Processed and Aliens Administered Oath of All | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |  | not acquired (6) |
| S-6 Retired | U.S. Courts of Appeals - Criminal Cases Filed Under the Sentencing Guidelines | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 15 |  | not acquired (15) |
| S-12 | U.S. District Courts - Civil Cases Referred to Arbitration | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |  | not acquired (9) |
| S-13 | Federal Probation System - Offenders Receiving Judiciary-Funded Substance Abuse Treatment | 26 | 9 | 9 | 9 | 0 | 0 | 0 | 17 | 2017-09-30 to 2025-09-30 | not acquired (17) |
| S-13 Retired | U.S. District Courts - Criminal Defendants Whose Cases Were Dismissed Under 18 U.S.C. § 31 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |  | not acquired (2) |
| S-14 | Federal Pretrial Services - Defendants Receiving Judiciary-Funded Substance Abuse Treatmen | 26 | 9 | 9 | 9 | 0 | 0 | 0 | 17 | 2017-09-30 to 2025-09-30 | not acquired (17) |
| S-14 Retired | Federal Probation System - Persons Received for and Under Post-Conviction Supervision, by  | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |  | not acquired (3) |
| S-15 | U.S. District Courts - Petit Juror Service | 19 | 0 | 0 | 0 | 0 | 0 | 0 | 19 |  | not acquired (19) |
| S-15 Retired | Federal Probation System - Drug- and Alcohol-Dependent Recipients of Substance Abuse Servi | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |  | not acquired (3) |
| S-16 | U.S. District Courts - Grand Juror Service | 19 | 0 | 0 | 0 | 0 | 0 | 0 | 19 |  | not acquired (19) |
| S-17 | U.S. District Courts - Matters Conducted by U.S. Magistrate Judges | 26 | 6 | 0 | 0 | 0 | 0 | 0 | 26 |  | not acquired (20) |
| S-18 | U.S. District Courts - Three-Judge District Court Hearings, by Nature of Suit | 29 | 9 | 8 | 8 | 0 | 0 | 0 | 21 | 2017-09-30 to 2024-09-30 | not acquired (20) |
| S-19 | U.S. Judicial Panel on Multidistrict Litigation - Cases Transferred by Order of Judicial P | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| S-20 | U.S. Judicial Panel on Multidistrict Litigation - Cumulative Summary of Multidistrict Liti | 29 | 9 | 8 | 8 | 0 | 0 | 0 | 21 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| S-21 | Federal Defender Organizations - Cases Filed, Terminated, and Pending, by Type of Represen | 29 | 9 | 0 | 0 | 0 | 0 | 0 | 29 |  | not acquired (20) |
| S-22 | U.S. Federal Courts - Complaints Filed and Action Taken Under Under 28 U.S.C. §§ 351-364 | 31 | 9 | 8 | 8 | 0 | 0 | 0 | 23 | 2018-09-30 to 2025-09-30 | not acquired (22) |
| S-25 | U.S. District Courts - Criminal Cases Filed, by Offense and Year | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | not acquired (1) |
| S-26 | U.S. District Courts - Criminal Defendants Filed, by Offense and Year | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | not acquired (1) |
| T-1 | U.S. District Courts - Civil and Criminal Trials Completed | 43 | 43 | 15 | 15 | 0 | 0 | 0 | 28 | 2011-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: no rows with 7 figures (saw counts [10]) (18) |
| T-2 | U.S. District Courts - Lengths of Civil and Criminal Trials Completed | 38 | 38 | 20 | 20 | 0 | 0 | 0 | 18 | 1998-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table C-8 != listing T-2 (13) |
| T-3 | U.S. District Courts - Median Time From Filings To Trial For Civil Cases In Which Trials W | 29 | 29 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table C-10 != listing T-3 (14) |
| T-4 | U.S. District Courts - Civil and Criminal Trials Resulting in Verdicts or Judgments | 15 | 15 | 9 | 9 | 0 | 0 | 0 | 6 | 2017-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: header words not in the PDF: ['all', 'charge', 'hearings', 'injunctions', 'issue', 'jury'] (5) |
| T-5 | U.S. District Courts - Lengths of Civil and Criminal Trials Resulting in Verdicts or Judgm | 20 | 20 | 14 | 14 | 0 | 0 | 0 | 6 | 2011-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: title table T-2 != listing T-5 (5) |
| T-19 | U.S. District Courts - Supervision Hearings in Trials and Nontrials, by District | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 2025-09-30 to 2025-09-30 |  |
| V-1 | U.S. District Courts - Services Provided to and Received From Other District Courts | 29 | 9 | 9 | 8 | 1 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| V-2 | U.S. District Courts - Services Provided by Visiting Judges in Cases Terminated, by Circui | 29 | 9 | 9 | 9 | 0 | 0 | 0 | 20 | 2017-09-30 to 2025-09-30 | not acquired (20) |
| X-1A | U.S. District Courts - Weighted and Unweighted Filings per Authorized Judgeship | 29 | 29 | 18 | 18 | 0 | 0 | 0 | 11 | 2007-09-30 to 2025-09-30 | PDF text layer read but rejected by a gate: header words not in the PDF: ['supervision'] (5) |
| X-4 | U.S. District Courts - Class Action Civil Cases Pending, by Nature of Suit | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |  | not acquired (8) |
| X-5 | U.S. District Courts - Class Action Civil Cases Filed, by Jurisdiction and Nature of Suit | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |  | not acquired (8) |

Never parsed or not published, by reason:

- 781 table-periods: not acquired
- 289 table-periods: PDF only, and no spreadsheet edition of this table parses as a court table to name its columns
- 48 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [10])
- 44 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nmid')] extra []
- 41 table-periods: PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [13])
- 39 table-periods: PDF text layer read but rejected by a gate: no rows with 17 figures (saw counts [16])
- 38 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra []
- 18 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['drugs']
- 18 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'gud'), ('district', 'nmid')] extra []
- 18 table-periods: PDF text layer read but rejected by a gate: no rows with 7 figures (saw counts [10])
- 17 table-periods: PDF text layer read but rejected by a gate: title table S-1 != listing B-10
- 17 table-periods: PDF text layer read but rejected by a gate: title table S-3 != listing B-12
- 17 table-periods: PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [9])
- 17 table-periods: PDF text layer read but rejected by a gate: title table S-2 != listing B-11
- 17 table-periods: PDF text layer read but rejected by a gate: no rows with 13 figures (saw counts [12])
- 16 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('national', 'national'), ('other', '10th_circuit'), ('other', '11th_circuit'), ('other', '1st_circuit'), ('other', '2nd_circuit'), ('other', '3rd_circuit')] extra []
- 16 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [9])
- 15 table-periods: PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [9])
- 14 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['terminated']
- 14 table-periods: PDF text layer read but rejected by a gate: title table S-9 != listing C-10
- 14 table-periods: PDF text layer read but rejected by a gate: title table S-10 != listing C-11
- 14 table-periods: PDF text layer read but rejected by a gate: no rows with 8 figures (saw counts [7])
- 14 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['bench']
- 14 table-periods: PDF text layer read but rejected by a gate: title table C-10 != listing T-3
- 14 table-periods: PDF text layer read but rejected by a gate: title table S-8 != listing C-9
- 13 table-periods: PDF text layer read but rejected by a gate: no rows with 12 figures (saw counts [11])
- 13 table-periods: PDF text layer read but rejected by a gate: no rows with 7 figures (saw counts [5])
- 13 table-periods: PDF text layer read but rejected by a gate: no rows with 6 figures (saw counts [5])
- 13 table-periods: PDF text layer read but rejected by a gate: title table C-8 != listing T-2
- 11 table-periods: PDF text layer read but rejected by a gate: no rows with 16 figures (saw counts [8])
- 11 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('other', 'administrative_agency_appeals'), ('other', 'bankruptcy'), ('other', 'criminal'), ('other', 'original_proceedings_and_miscellaneous_applications'), ('other', 'other_private_civil'), ('other', 'other_u_s_civil')] extra []
- 11 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['pct']
- 10 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['bench', 'without']
- 10 table-periods: PDF text layer read but rejected by a gate: title table C-7 != listing T-1
- 9 table-periods: PDF text layer read but rejected by a gate: no rows with 16 figures (saw counts [11])
- 9 table-periods: PDF text layer read but rejected by a gate: no rows with 5 figures (saw counts [8])
- 9 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first total~2
- 9 table-periods: PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [11])
- 9 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['drugs', 'escape', 'firearms', 'immigration', 'obstruction', 'order']
- 9 table-periods: spreadsheet rejected by a gate: no sheets with data
- 9 table-periods: PDF text layer read but rejected by a gate: title table H-9 != listing H-14
- 9 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 3 labels repeat under the same parent with different figures, first filed
- 8 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('other', 'administrative_appeals'), ('other', 'criminal'), ('other', 'private_civil'), ('other', 'u_s_civil')] extra []
- 8 table-periods: PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [9])
- 8 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 3 labels repeat under the same parent with different figures, first closed
- 7 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 8 columns share a heading path with another column, first total~2
- 7 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 27 labels repeat under the same parent with different figures, first actions_under_statutes/antitrust
- 7 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['bench', 'supervision', 'trial']
- 6 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['bop']
- 6 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 19 labels repeat under the same parent with different figures, first all_other
- 6 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['actions']
- 6 table-periods: PDF text layer read but rejected by a gate: no rows with 7 figures (saw counts [6])
- 6 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 1 labels repeat under the same parent with different figures, first additional_duties/reentry_drug_court_proceedings_1/evidentiary_hearings
- 5 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('other', 'criminal_appeals'), ('other', 'other_civil_appeals'), ('other', 'prisoner_petitions')] extra []
- 5 table-periods: PDF text layer read but rejected by a gate: no rows with 9 figures (saw counts [4])
- 5 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['all', 'charge', 'hearings', 'injunctions', 'issue', 'jury']
- 5 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['supervision']
- 5 table-periods: PDF text layer read but rejected by a gate: title table T-2 != listing T-5
- 5 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['all', 'day', 'days', 'more', 'total']
- 4 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [11])
- 4 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 20 labels repeat under the same parent with different figures, first all_other
- 4 table-periods: PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [8])
- 4 table-periods: PDF text layer read but rejected by a gate: title table S-23 != listing C-13
- 4 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['alcohol', 'conduct']
- 4 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 10 labels repeat under the same parent with different figures, first total_adversary
- 4 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first pct~2
- 4 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['appeals', 'dispositive']
- 3 table-periods: PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [20])
- 3 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'sdd')] extra []
- 3 table-periods: PDF text layer read but rejected by a gate: no rows with 14 figures
- 3 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['real']
- 3 table-periods: PDF text layer read but rejected by a gate: title table M-1A != listing M-2
- 3 table-periods: PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [10])
- 3 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'akd'), ('district', 'almd'), ('district', 'alnd'), ('district', 'alsd'), ('district', 'ared'), ('district', 'arwd')] extra []
- 3 table-periods: PDF text layer read but rejected by a gate: title table M-5 != listing M-4C
- 2 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('other', '10th_circuit'), ('other', '11th_circuit'), ('other', '1st_circuit'), ('other', '2nd_circuit'), ('other', '3rd_circuit'), ('other', '4th_circuit')] extra []
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 11 figures
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [11, 12])
- 2 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nysd')] extra []
- 2 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 3 labels repeat under the same parent with different figures, first cases_disposed_of
- 2 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['appellee', 'argument', 'briefs', 'consolidation', 'date', 'docket']
- 2 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['consolidation', 'merits', 'terminated']
- 2 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 26 labels repeat under the same parent with different figures, first actions_under_statutes/antitrust
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 4 figures
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 6 figures
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [9, 10])
- 2 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('national', 'national'), ('other', 'administrative_appeals'), ('other', 'criminal'), ('other', 'private_civil'), ('other', 'u_s_civil')] extra []
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 17 figures (saw counts [15, 16])
- 2 table-periods: PDF text layer read but rejected by a gate: title table S-24 != listing C-13
- 2 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 12 labels repeat under the same parent with different figures, first total_adversary
- 2 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 11 labels repeat under the same parent with different figures, first total_adversary
- 1 table-periods: spreadsheet rejected by a gate: 7/95 text cells
- 1 table-periods: spreadsheet rejected by a gate: 6/95 text cells
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('national', 'national'), ('other', '10th_circuit'), ('other', '11th_circuit'), ('other', '1st_circuit'), ('other', '2nd_circuit'), ('other', '3rd_circuit')] extra [('district', 'ccd')]
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'ilcd'), ('district', 'ord'), ('other', '10th_circuit'), ('other', '11th_circuit'), ('other', '1st_circuit'), ('other', '2nd_circuit')] extra []
- 1 table-periods: spreadsheet rejected by a gate: period in title 2011-09-30 differs from listing 2020-09-30
- 1 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 3 labels repeat under the same parent with different figures, first cases_filed
- 1 table-periods: spreadsheet rejected by a gate: period in title 2013-09-30 differs from listing 2022-09-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2014-09-30 differs from listing 2023-09-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2015-09-30 differs from listing 2024-09-30
- 1 table-periods: spreadsheet rejected by a gate: period in title 2016-09-30 differs from listing 2025-09-30
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'dcd'), ('district', 'nhd'), ('district', 'nysd'), ('district', 'ord'), ('district', 'vawd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: duplicate court rows
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nywd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('district', 'dcd'), ('district', 'ded'), ('district', 'mad'), ('district', 'nhd'), ('district', 'njd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca10')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nyed')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'gud'), ('district', 'mtd'), ('district', 'nvd'), ('district', 'ord')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca7'), ('other', 'administrative_agency_appeals'), ('other', 'bankruptcy'), ('other', 'criminal'), ('other', 'original_proceedings_and_miscellaneous_applications'), ('other', 'other_private_civil')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['briefs', 'consolidation', 'merits', 'terminated']
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 14 figures (saw counts [6])
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [9, 10, 11])
- 1 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['argument', 'briefs', 'date', 'docket', 'last', 'merits']
- 1 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['merits', 'terminated']
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'cadc'), ('national', 'national')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('terminated/y0', 'ca9', 15337, 15346)
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'iand')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('other', 'administrative_appeals'), ('other', 'criminal'), ('other', 'private_civil'), ('other', 'u_s_civil')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca10'), ('other', 'administrative_appeals'), ('other', 'criminal'), ('other', 'private_civil'), ('other', 'u_s_civil')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('cases_closed', 'national', 98721, 98538)
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('cases_closed', 'national', 105107, 104663)
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('cases_closed', 'national', 108549, 108001)
- 1 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['consolidation', 'date', 'docket', 'merits', 'terminated']
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [10])
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'caed')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('rsi_6', 'ca3', 49, 69)
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('personal_injury_product_liability/other', 'ca7', 3219, 872)
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca3'), ('circuit', 'ca5'), ('circuit', 'ca6'), ('circuit', 'ca7'), ('district', 'akd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: 1 roll-up identity failures, first ('offenses/other6', 'ca5', 389, 329)
- 1 table-periods: PDF text layer read but rejected by a gate: header words not in the PDF: ['assault', 'drugs']
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'azd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'gud'), ('district', 'nmid'), ('district', 'oknd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nmid'), ('district', 'wiwd')] extra []
- 1 table-periods: spreadsheet rejected by a gate: ambiguous row labels: 9 labels repeat under the same parent with different figures, first total_adversary
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 20 figures (saw counts [8, 9])
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'gud'), ('district', 'nmid'), ('district', 'paed')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'nmid'), ('district', 'oked'), ('district', 'oknd'), ('district', 'okwd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'dcd'), ('national', 'national')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'ared')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: 5 roll-up identity failures, first ('total', 'ca9', 46100, 46086)
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'alnd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 9 figures (saw counts [10])
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 9 figures
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'gasd')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 8 figures (saw counts [4, 7])
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'ord')] extra []
- 1 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first col~2
- 1 table-periods: spreadsheet rejected by a gate: column 8 has figures but no heading
- 1 table-periods: PDF text layer read but rejected by a gate: 5 roll-up identity failures, first ('total', 'ca11', 324, 320)
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [] extra [('district', 'utd')]
- 1 table-periods: spreadsheet could not be opened: File is not a zip file
- 1 table-periods: PDF text layer read but rejected by a gate: column years printed [2014] but the reference columns carry []
- 1 table-periods: spreadsheet rejected by a gate: period in title 2021-09-30 differs from listing 2022-09-30
- 1 table-periods: spreadsheet rejected by a gate: ambiguous column headings: 1 columns share a heading path with another column, first 12_months_ending_sept_30_ym1~2

## Bankruptcy Filings

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-filings-statistics

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| F | 419 | 419 | 306 | 172 | 0 | 197 | 0 | 50 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| F | U.S. Bankruptcy Courts - Bankruptcy Cases Filed, Terminated, and Pending | 103 | 103 | 70 | 3 | 0 | 98 | 0 | 2 | 2012-03-31 to 2026-09-30 | spreadsheet rejected by a gate: legacy printout layout (dot-leader labels, stacked unmerged headings) is not parsed (2) |
| F-2 | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 103 | 103 | 70 | 3 | 0 | 99 | 0 | 1 | 2015-06-30 to 2026-09-30 | spreadsheet rejected by a gate: legacy printout layout (dot-leader labels, stacked unmerged headings) is not parsed (1) |
| F-2 (One Month) | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 55 | 55 | 55 | 55 | 0 | 0 | 0 | 0 | 2013-03-31 to 2026-09-30 |  |
| F-2 (Three Months) | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 103 | 103 | 70 | 70 | 0 | 0 | 0 | 33 | 2009-06-30 to 2026-09-30 | spreadsheet rejected by a gate: legacy printout layout (dot-leader labels, stacked unmerged headings) is not parsed (31) |
| F-5A | U.S. Bankruptcy Courts - Business and Nonbusiness Cases Filed, by Chapter of the Bankruptc | 55 | 55 | 41 | 41 | 0 | 0 | 0 | 14 | 2016-09-30 to 2026-09-30 | spreadsheet rejected by a gate: county table whose rows are not grouped under their reporting district is not parsed (14) |

Never parsed or not published, by reason:

- 34 table-periods: spreadsheet rejected by a gate: legacy printout layout (dot-leader labels, stacked unmerged headings) is not parsed
- 14 table-periods: spreadsheet rejected by a gate: county table whose rows are not grouped under their reporting district is not parsed
- 2 table-periods: PDF text layer read but rejected by a gate: no rows with 14 figures

## Bankruptcy Abuse Prevention and Consumer Protection Act (BAPCPA) report

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-abuse-prevention-and-consumer-protection-act-report

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 76 | 76 | 32 | 32 | 0 | 0 | 0 | 44 |
| 2 | 76 | 76 | 32 | 32 | 0 | 0 | 0 | 44 |
| 3 | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 |
| 4 | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 |
| 5 | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 |
| 6 | 19 | 19 | 8 | 7 | 1 | 0 | 0 | 11 |
| 7 | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 |
| 8 | 76 | 76 | 36 | 36 | 0 | 0 | 0 | 40 |
| 9 | 76 | 76 | 32 | 32 | 0 | 0 | 0 | 44 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| BAPCPA 1A | U.S. Bankruptcy Courts - Assets and Liabilities Reported in Chapter 7 Cases Filed | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4'), ('district', 'akd'), ('district', 'almd')] extra [] (7) |
| BAPCPA 1B | U.S. Bankruptcy Courts - Assets and Liabilities Reported in Chapter 11 Cases Filed | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra [] (5) |
| BAPCPA 1D | U.S. Bankruptcy Courts - Assets and Liabilities Reported in Chapter 13 Cases Filed | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4'), ('circuit', 'ca5')] extra [] (4) |
| BAPCPA 1X | U.S. Bankruptcy Courts - Assets and Liabilities Reported in Cases Filed | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4'), ('circuit', 'ca5'), ('circuit', 'ca6')] extra [] (4) |
| BAPCPA 2A | U.S. Bankruptcy Courts - Income and Expenses Reported in Chapter 7 Cases Filed | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 8 figures (saw counts [9]) (6) |
| BAPCPA 2B | U.S. Bankruptcy Courts - Income and Expenses Reported in Chapter 11 Cases Filed | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 8 figures (saw counts [9]) (8) |
| BAPCPA 2D | U.S. Bankruptcy Courts - Income and Expenses Reported in Chapter 13 Cases Filed | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 8 figures (saw counts [9]) (8) |
| BAPCPA 2X | U.S. Bankruptcy Courts - Income and Expenses Reported in Cases Filed | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 8 figures (saw counts [9]) (7) |
| BAPCPA 3 | U.S. Bankruptcy Courts - Time Intervals From Filing to Disposition of Cases Terminated, by | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 12 figures (saw counts [13]) (9) |
| BAPCPA 4 | U.S. Bankruptcy Courts - Reaffirmation Agreements in Chapter 7 Cases Terminated | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 5 figures (saw counts [6]) (7) |
| BAPCPA 5 | U.S. Bankruptcy Courts - Cases in Which Property Valuation Orders Were Entered in Chapter  | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 7 figures (saw counts [8]) (10) |
| BAPCPA 6 | U.S. Bankruptcy Courts - Chapter 13 Cases Terminated by Dismissal or Plan Completion | 19 | 19 | 8 | 7 | 1 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [12]) (7) |
| BAPCPA 7 | U.S. Bankruptcy Courts - Prior Filing Status Reported in Chapter 13 Cases Filed | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5]) (8) |
| BAPCPA 8A | U.S. Bankruptcy Courts - Creditor Misconduct in Chapter 7 Cases Terminated | 19 | 19 | 9 | 9 | 0 | 0 | 0 | 10 | 2007-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5]) (8) |
| BAPCPA 8B | U.S. Bankruptcy Courts - Creditor Misconduct in Chapter 11 Cases Terminated | 19 | 19 | 9 | 9 | 0 | 0 | 0 | 10 | 2007-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5]) (7) |
| BAPCPA 8D | U.S. Bankruptcy Courts - Creditor Misconduct in Chapter 13 Cases Terminated | 19 | 19 | 9 | 9 | 0 | 0 | 0 | 10 | 2007-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5]) (7) |
| BAPCPA 8X | U.S. Bankruptcy Courts - Creditor Misconduct in Cases Terminated | 19 | 19 | 9 | 9 | 0 | 0 | 0 | 10 | 2007-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5]) (6) |
| BAPCPA 9A | U.S. Bankruptcy Courts - FRBP 9011 Sanctions and Damages Imposed Against Debtors' Attorney | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5]) (6) |
| BAPCPA 9B | U.S. Bankruptcy Courts - FRBP 9011 Sanctions and Damages Imposed Against Debtors' Attorney | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5]) (7) |
| BAPCPA 9D | U.S. Bankruptcy Courts - FRBP 9011 Sanctions and Damages Imposed Against Debtors' Attorney | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5]) (8) |
| BAPCPA 9X | U.S. Bankruptcy Courts - FRBP 9011 Sanctions and Damages Imposed Against Debtors' Attorney | 19 | 19 | 8 | 8 | 0 | 0 | 0 | 11 | 2018-12-31 to 2025-12-31 | PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5]) (7) |

Never parsed or not published, by reason:

- 64 table-periods: PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [5])
- 35 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4')] extra []
- 29 table-periods: PDF text layer read but rejected by a gate: no rows with 8 figures (saw counts [9])
- 12 table-periods: PDF text layer read but rejected by a gate: no rows with 4 figures
- 10 table-periods: PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [11])
- 10 table-periods: PDF text layer read but rejected by a gate: no rows with 7 figures (saw counts [8])
- 9 table-periods: PDF text layer read but rejected by a gate: no rows with 12 figures (saw counts [13])
- 7 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4'), ('district', 'akd'), ('district', 'almd')] extra []
- 7 table-periods: PDF text layer read but rejected by a gate: no rows with 5 figures (saw counts [6])
- 7 table-periods: PDF text layer read but rejected by a gate: no rows with 11 figures (saw counts [12])
- 6 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4'), ('circuit', 'ca5'), ('circuit', 'ca6')] extra []
- 4 table-periods: PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [9])
- 4 table-periods: PDF text layer read but rejected by a gate: no rows with 10 figures
- 4 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca10'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4'), ('circuit', 'ca5')] extra []
- 4 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('circuit', 'ca1'), ('circuit', 'ca11'), ('circuit', 'ca2'), ('circuit', 'ca3'), ('circuit', 'ca4'), ('circuit', 'ca5')] extra []
- 4 table-periods: PDF text layer read but rejected by a gate: no rows with 8 figures (saw counts [7])
- 4 table-periods: PDF text layer read but rejected by a gate: no rows with 8 figures
- 4 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('district', 'arcomb')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 10 figures (saw counts [3, 11])
- 1 table-periods: PDF text layer read but rejected by a gate: court set differs: missing [('other', 'ar_4')] extra []
- 1 table-periods: PDF text layer read but rejected by a gate: no rows with 4 figures (saw counts [3, 5])

## Wiretap report

Publication page: https://www.uscourts.gov/data-news/reports/statistical-reports/wiretap-reports

By series:

| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Wire 1-10 | 263 | 263 | 34 | 34 | 0 | 0 | 0 | 229 |
| Wire A/B | 88 | 88 | 0 | 0 | 0 | 0 | 0 | 88 |

By table number:

| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Wire 1 | Wiretap - Jurisdictions with Statutes Authorizing the Interception of Wire, Oral, or Elect | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 2 | Wiretap - Intercept Orders Issued by Judges | 28 | 28 | 8 | 8 | 0 | 0 | 0 | 20 | 2018-12-31 to 2025-12-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (18) |
| Wire 3 | Wiretap - Major Offenses for Which Court-Authorized Intercepts Were Granted | 29 | 29 | 8 | 8 | 0 | 0 | 0 | 21 | 2018-12-31 to 2025-12-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 4 | Wiretap - Interceptions of Wire, Oral, or Electronic Communications | 29 | 29 | 7 | 7 | 0 | 0 | 0 | 22 | 2018-12-31 to 2025-12-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 5 | Wiretap - Average Cost per Order | 29 | 29 | 7 | 7 | 0 | 0 | 0 | 22 | 2018-12-31 to 2025-12-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 6 | Wiretap - Types of Surveillance Used, Arrests, and Convictions for Intercepts Installed | 29 | 29 | 4 | 4 | 0 | 0 | 0 | 25 | 2018-12-31 to 2025-12-31 | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 7 | Wiretap - Authorized Intercepts Granted | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 8 | Wiretap - Supplementary Data for Intercepts Terminated in Prior Years as Reported | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 9 | Wiretap - Arrests and Convictions Resulting from Intercepts Installed | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (19) |
| Wire 10 | Wiretap - Intercept Orders Issued by Federal Judges | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 3 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (3) |
| Wire A1 | Wiretap - Intercepts of Wire, Oral, or Electronic Communications Authorized by U.S. Distri | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (15) |
| Wire A2 | Wiretap - Detail of Supplementary Data for Intercepts Authorized by U.S. District Courts a | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 15 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (15) |
| Wire B1 | Wiretap - Intercepts of Wire, Oral, or Electronic Communications Authorized by State Court | 29 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (15) |
| Wire B2 | Wiretap - Detail of Supplementary Data for Intercepts Authorized by State Courts and Termi | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 15 |  | PDF only, and no spreadsheet edition of this table parses as a court table to name its columns (15) |

Never parsed or not published, by reason:

- 233 table-periods: PDF only, and no spreadsheet edition of this table parses as a court table to name its columns
- 68 table-periods: not a jurisdiction table (statutes, multi-year summary or order-by-order listing)
- 8 table-periods: jurisdiction table rejected by a gate: 'DOUGLAS' is printed twice with different figures
- 3 table-periods: jurisdiction table rejected by a gate: no count column without text cells (such as NP, no prosecutor's report) to read the grouping from
- 1 table-periods: jurisdiction table rejected by a gate: 'SCRANTON' opens a block in the state section but is not a state or territory name
- 1 table-periods: jurisdiction table rejected by a gate: 'SOMERSET' opens a block in the state section but is not a state or territory name
- 1 table-periods: jurisdiction table rejected by a gate: '8TH JUDICIAL DISTRICT (JACKSON LARIMER)' opens a block in the state section but is not a state or territory name
- 1 table-periods: jurisdiction table rejected by a gate: 'MIDDLESEX' opens a block in the state section but is not a state or territory name
- 1 table-periods: jurisdiction table rejected by a gate: 'INDIANA COUNTY' opens a block in the state section but is not a state or territory name

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

