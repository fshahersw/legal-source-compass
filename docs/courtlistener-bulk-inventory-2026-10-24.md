# CourtListener bulk-data inventory — October 24, 2026

Complete listing of the public bucket [bulk-data/](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/list.html?prefix=bulk-data/) through the S3 ListObjectsV2 API (`https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&prefix=bulk-data/`), paginated until `IsTruncated=false`: **1,111 objects** in 2 pages, listed 2026-10-24T01:29:32Z. The raw XML pages are kept unchanged (gzip, sha256 in `private/acq/clb_1026/listing/_manifest.jsonl`).

Total listed size: 1,781.62 GB across 46 snapshot dates (first 2022-08-01, latest 2026-09-30). The latest snapshot (2026-09-30) has 35 objects, 65.09 GB. Sizes are compressed object sizes from the listing, not row counts.

Status: **used** = read by a published dataset; **new** = first read into a dataset in wave 1026 (or read in full for the first time); **partly** = some columns or rows read, the rest open; **empty** = no data rows; **not used** = with the reason.

## Tables (latest snapshot)

| Table | Status | Latest size | Snapshots | First | Total, all snapshots | Read by |
|---|---|---:|---:|---|---:|---|
| [opinions](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinions-2026-09-30.csv.bz2) | used | 55.25 GB | 37 | 2022-08-02 | 1,513.77 GB | clb_judge_dockets (authorship), clb_court_flows and clb_top_cited (opinion to cluster); case-law search pipeline (text) |
| [dockets](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-2026-09-30.csv.bz2) | used | 5.14 GB | 37 | 2022-08-02 | 151.98 GB | clb_court_profiles, clb_docket_master, clb_judge_dockets, clb_court_flows (appeal edges), clb_oral_arguments and clb_bankruptcy_courts (docket joins), matter cross-analysis; 25 of 54 columns read (text fields reduced to lengths) |
| [opinion-clusters](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinion-clusters-2026-09-30.csv.bz2) | used | 2.47 GB | 37 | 2022-08-02 | 71.15 GB | clb_court_profiles, clb_top_cited, clb_court_flows, clb_docket_master; case-law search pipeline |
| [randoms/bankruptcy-dockets](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/randoms/bankruptcy-dockets-2022-09-19.csv.bz2) | used | 1.35 GB | 1 | 2022-09-19 | 1.35 GB | clb_bankruptcy_courts |
| [oral-arguments](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/oral-arguments-2026-09-30.csv.bz2) | partly | 691.9 MB | 37 | 2022-08-03 | 12.75 GB | clb_oral_arguments and clb_court_profiles (counts, durations, named judges); recording-level metadata and transcripts are not published |
| [citation-map](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/citation-map-2026-09-30.csv.bz2) | used | 533.1 MB | 37 | 2022-08-03 | 9.98 GB | clb_court_flows, clb_top_cited; case-law search pipeline (cited-by) |
| [parentheticals](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/parentheticals-2026-09-30.csv.bz2) | partly | 292.5 MB | 38 | 2022-08-01 | 4.20 GB | clb_top_cited_parentheticals (the 1,000 most-cited clusters only) and clb_court_profiles (counts); parentheticals of all other opinions are not published |
| [fjc-integrated-database](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2) | used | 279.6 MB | 35 | 2022-09-30 | 9.51 GB | clb_court_profiles, clb_docket_master, clb_district_crossview, clb_judge_dockets, clb_court_flows (FJC IDB fields via CourtListener; the FJC files themselves feed fjc_idb_*) |
| [unmatched-citations](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/unmatched-citations-2026-09-30.csv.bz2) | used | 222.4 MB | 2 | 2026-06-30 | 438.1 MB | clb_unmatched_citations |
| [citations](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/citations-2026-09-30.csv.bz2) | used | 127.5 MB | 28 | 2023-04-30 | 2.95 GB | clb_court_profiles (reporters), clb_unmatched_citations; case-law search pipeline |
| [financial-disclosure-investments](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosure-investments-2026-09-30.csv.bz2) | new | 36.6 MB | 35 | 2022-09-30 | 1.24 GB | counted before (clb_disclosure_coverage, clb_judge_disclosures); new: clb_judge_disclosure_items (per judge and year by printed value, income and transaction codes) |
| [originating-court-information](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/originating-court-information-2026-09-30.csv.bz2) | partly | 22.5 MB | 24 | 2023-12-04 | 87.4 MB | clb_appellate_timing (appellate courts with 100+ appeals); lower-court-level views need the full docket table |
| [financial-disclosures](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-2026-09-30.csv.bz2) | used | 5.6 MB | 35 | 2022-09-30 | 185.7 MB | clb_disclosure_coverage, clb_judge_disclosures; new: clb_judge_disclosure_items (report types decoded) |
| [search_opinioncluster_panel](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/search_opinioncluster_panel-2026-09-30.csv.bz2) | used | 5.0 MB | 20 | 2024-08-13 | 98.9 MB | clb_appellate_panels; case-law search pipeline |
| [financial-disclosures-reimbursements](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-reimbursements-2026-09-30.csv.bz2) | used | 1.1 MB | 35 | 2022-09-30 | 38.8 MB | clb_judge_disclosures (listed), clb_disclosure_coverage |
| [people-db-positions](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people-db-positions-2026-09-30.csv.bz2) | used | 1.0 MB | 37 | 2022-08-03 | 37.5 MB | clb_court_benches, clb_bench_cohorts, clb_judge_dockets, clb_judge_disclosures (court), judge_cl_crosswalk; new: clb_judge_people (every position with nomination, hearing, confirmation, votes, selection, termination) |
| [financial-disclosures-positions](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-positions-2026-09-30.csv.bz2) | new | 915.4 KB | 35 | 2022-09-30 | 31.1 MB | counted before; new: clb_judge_disclosure_items (outside positions listed as filed) |
| [schema](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/schema-2026-09-30.sql) | used | 555.3 KB | 37 | 2022-08-03 | 12.2 MB | clb_bulk_schema (138 tables) |
| [financial-disclosures-spousal-income](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-spousal-income-2026-09-30.csv.bz2) | new | 515.6 KB | 35 | 2022-09-30 | 17.5 MB | counted before; new: clb_judge_disclosure_items (listed as filed) |
| [people-db-people](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people-db-people-2026-09-30.csv.bz2) | used | 456.0 KB | 37 | 2022-08-03 | 16.3 MB | clb_court_benches, clb_bench_cohorts, clb_judge_dockets, judge_cl_crosswalk; new: clb_judge_people |
| [financial-disclosures-non-investment-income](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-non-investment-income-2026-09-30.csv.bz2) | new | 441.2 KB | 35 | 2022-09-30 | 15.0 MB | counted before; new: clb_judge_disclosure_items (listed with the amount as filed) |
| [financial-disclosures-debts](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-debts-2026-09-30.csv.bz2) | new | 393.4 KB | 35 | 2022-09-30 | 13.4 MB | counted before; new: clb_judge_disclosure_items (by printed value code, listed as filed) |
| [financial-disclosures-agreements](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-agreements-2026-09-30.csv.bz2) | used | 318.1 KB | 35 | 2022-09-30 | 10.8 MB | clb_judge_disclosures (listed), clb_disclosure_coverage |
| [people-db-educations](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people-db-educations-2026-09-30.csv.bz2) | new | 213.3 KB | 37 | 2022-08-03 | 7.7 MB | clb_bench_cohorts (law-school cohorts); new: clb_judge_people (every degree per judge) |
| [people-db-political-affiliations](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people-db-political-affiliations-2026-09-30.csv.bz2) | new | 130.6 KB | 37 | 2022-08-03 | 4.7 MB | clb_bench_cohorts (counts); new: clb_judge_people (each affiliation with its recorded source and dates) |
| [courts](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/courts-2026-09-30.csv.bz2) | used | 81.2 KB | 38 | 2022-08-02 | 2.7 MB | every clb_* dataset (court names, levels, parents); clb_court_profiles; case-law search pipeline (court levels) |
| [financial-disclosures-gifts](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-gifts-2026-09-30.csv.bz2) | used | 68.2 KB | 35 | 2022-09-30 | 2.3 MB | clb_judge_disclosures (listed), clb_disclosure_coverage |
| [people-db-schools](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people-db-schools-2026-09-30.csv.bz2) | new | 66.0 KB | 37 | 2022-08-03 | 2.3 MB | clb_bench_cohorts; new: clb_judge_people (school names and aliases) |
| [people-db-races](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people-db-races-2026-09-30.csv.bz2) | used | 25.7 KB | 25 | 2023-10-31 | 616.3 KB | clb_bench_cohorts (counts only; not published per person) |
| [load-bulk-data](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/load-bulk-data-2026-09-30.sh) | used | 18.6 KB | 23 | 2023-12-05 | 408.7 KB | clb_bulk_schema (which tables have a bulk file) |
| [courthouses](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/courthouses-2026-09-30.csv.bz2) | used | 17.3 KB | 24 | 2023-12-04 | 390.9 KB | judge_cl_crosswalk builder (court seats); case-law search pipeline (court locations) |
| [search_opinion_joined_by](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/search_opinion_joined_by-2026-09-30.csv.bz2) | used | 6.2 KB | 20 | 2024-08-13 | 123.8 KB | clb_appellate_panels, clb_court_profiles |
| [court-appeals-to](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/court-appeals-to-2026-09-30.csv.bz2) | new | 118 B | 24 | 2023-12-04 | 2.3 KB | new: clb_court_appeals_to (all 8 rows) |
| [people-db-retention-events](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people-db-retention-events-2026-09-30.csv.bz2) | empty | 118 B | 37 | 2022-08-03 | 4.2 KB | header only: CourtListener records no retention events (the REST endpoint also reported a count of 0 on 2026-10-24) |
| [people_db_race](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people_db_race-2026-09-30.csv.bz2) | used | 83 B | 20 | 2024-08-13 | 1.6 KB | clb_bench_cohorts (the race code table) |
| [search_opinioncluster_non_participating_judges](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/search_opinioncluster_non_participating_judges-2026-09-30.csv.bz2) | empty | 65 B | 20 | 2024-08-13 | 1.3 KB | header only: no rows in any snapshot listed |

Latest-snapshot bytes by status: empty 183 B; new 39.3 MB; partly 1.01 GB; used 64.04 GB.

## Other objects

| Object | Size | Last modified | Decision |
|---|---:|---|---|
| [eyecite/tests/one-percent-1975-2023-random-order.csv.bz2](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/eyecite/tests/one-percent-1975-2023-random-order.csv.bz2) | 184.4 MB | 2025-07-28 | not used: a test sample of opinion texts for the citation extractor (the full opinions table is the source) |
| [eyecite/tests/one-percent-1975-2023.csv.bz2](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/eyecite/tests/one-percent-1975-2023.csv.bz2) | 176.9 MB | 2025-07-28 | not used: a test sample of opinion texts for the citation extractor (the full opinions table is the source) |
| [eyecite/tests/one-percent.csv.bz2](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/eyecite/tests/one-percent.csv.bz2) | 2.1 MB | 2022-08-04 | not used: a test sample of opinion texts for the citation extractor (the full opinions table is the source) |
| [eyecite/tests/ten-percent.csv.bz2](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/eyecite/tests/ten-percent.csv.bz2) | 21.9 MB | 2025-07-28 | not used: a test sample of opinion texts for the citation extractor (the full opinions table is the source) |
| [randoms/all-csv-pull-3.zip](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/randoms/all-csv-pull-3.zip) | 17.7 MB | 2025-07-28 | not used: a later pull of the nine bankruptcy courts' creditor mailing matrices, personal data |
| [randoms/all-csv.zip](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/randoms/all-csv.zip) | 19.8 MB | 2025-07-28 | not used: nine bankruptcy courts' creditor mailing matrices (names and addresses of private debtors' creditors), personal data |
| [randoms/nywb-petitions-2.zip](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/randoms/nywb-petitions-2.zip) | 571.4 MB | 2025-07-28 | not used: 1,029 more individual bankruptcy petitions (PDFs) of private persons, personal financial documents |
| [randoms/nywb-petitions.zip](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/randoms/nywb-petitions.zip) | 484.9 MB | 2025-07-28 | not used: 968 individual bankruptcy petitions (PDFs) of private persons, personal financial documents |
| [randoms/scotus_caption_data.csv](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/randoms/scotus_caption_data.csv) | 243.9 MB | 2025-07-28 | not used: an older Supreme Court opinion/cluster/docket extract; the 2026-09-30 tables supersede it |
| [randoms/scotus_network.csv](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/randoms/scotus_network.csv) | 7.0 MB | 2024-04-04 | not used: an older Supreme Court citation extract; the 2026-09-30 citation map supersedes it |

## Snapshots

Older snapshots are earlier full copies of the same tables. Only the latest is read; the earlier ones are listed so a change between snapshots can be measured later. Snapshot dates and object counts:

| Snapshot | Objects | Size |
|---|---:|---:|
| 2026-09-30 | 35 | 65.09 GB |
| 2026-06-30 | 35 | 64.23 GB |
| 2026-03-31 | 34 | 63.58 GB |
| 2025-12-31 | 34 | 62.94 GB |
| 2025-12-02 | 34 | 62.78 GB |
| 2025-10-31 | 34 | 62.71 GB |
| 2025-10-09 | 34 | 62.55 GB |
| 2025-09-05 | 2 | 424.1 KB |
| 2025-09-04 | 32 | 62.94 GB |
| 2025-07-02 | 34 | 62.20 GB |
| 2025-04-30 | 34 | 54.72 GB |
| 2025-03-31 | 34 | 54.25 GB |
| 2025-02-28 | 34 | 53.52 GB |
| 2025-01-31 | 34 | 53.03 GB |
| 2024-12-31 | 34 | 52.88 GB |
| 2024-11-30 | 34 | 52.70 GB |
| 2024-10-31 | 34 | 52.02 GB |
| 2024-09-30 | 34 | 51.66 GB |
| 2024-08-31 | 34 | 51.41 GB |
| 2024-08-15 | 34 | 51.00 GB |
| 2024-08-13 | 33 | 50.97 GB |
| 2024-05-07 | 2 | 322.4 KB |
| 2024-05-06 | 28 | 47.24 GB |
| 2024-03-12 | 2 | 322.1 KB |
| 2024-03-11 | 28 | 47.10 GB |
| 2024-03-01 | 30 | 16.5 KB |
| 2023-12-05 | 2 | 322.6 KB |
| 2023-12-04 | 28 | 46.67 GB |
| 2023-10-31 | 1 | 25.6 KB |
| 2023-08-31 | 25 | 44.38 GB |
| 2023-07-31 | 25 | 39.29 GB |
| 2023-06-05 | 1 | 14 B |
| 2023-05-31 | 25 | 38.48 GB |
| 2023-04-30 | 25 | 38.42 GB |
| 2023-03-31 | 24 | 38.29 GB |
| 2023-02-28 | 24 | 38.21 GB |
| 2023-01-31 | 24 | 38.15 GB |
| 2022-12-31 | 24 | 38.11 GB |
| 2022-11-30 | 24 | 37.93 GB |
| 2022-10-31 | 24 | 35.80 GB |
| 2022-09-30 | 24 | 35.46 GB |
| 2022-09-19 | 1 | 1.35 GB |
| 2022-08-31 | 14 | 33.92 GB |
| 2022-08-03 | 10 | 64.3 MB |
| 2022-08-02 | 4 | 33.79 GB |
| 2022-08-01 | 1 | 55.0 MB |

## Data that has no bulk file

- ABA ratings (2,426 rows) and person source notes (20,430 rows) are tables of the people database without a bulk file. ABA ratings were read through the REST API (`/api/rest/v4/aba-ratings/`, 122 pages of 20 rows) into clb_judge_people. Source notes were not read: 1,022 requests at 20 rows per page exceed this stream's request budget.
- Retention events: the bulk file has a header and no rows, and the API count is 0; CourtListener records none.
- Parties, attorneys, docket entries and RECAP documents have no bulk file (see docs/courtlistener-bulk-acquisition-gaps-2026-10-02.md).

## Search-count statistics (REST search API)

clb_search_counts records result counts of CourtListener's search engine for exact advanced queries (phrases, a boolean group, a proximity search, fielded court and date-range filters): counts the bulk files cannot give without reading the 55 GB opinions table. Every row carries its query, request URL and retrieval time. See the dataset summary for the full query list.

Generated by `scripts/enrichment/clb_1026/gen_inventory_doc.py` from the listing file named above.
