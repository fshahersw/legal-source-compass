# Supabase data audit — October 5, 2026

Project: **xosqzzsnhxcyehcnirpa**. Live read-only measurements: **23:04–23:09 UTC / 6:04–6:09 PM CDT**. Development, acquisition and hourly continuation are paused at the owner's request. No corpus data, publication gate, permissions or Storage objects were changed by this audit.

## Project totals

| Measure | Total |
|---|---:|
| PostgreSQL physical database size | 87.855 GB (87,854,607,507 bytes) |
| Private object storage | 144.771 GB (144,770,591,610 bytes; 274,105 objects) |
| Combined measured database + object bytes | 232.625 GB |
| Catalog collections | 94: 83 available, 11 held |
| Actual public corpus records | 5,927,664 |
| Record datum bytes, all columns | 43.026 GB |
| Available record datum bytes | 16.651 GB; 2,930,616 rows |
| Held record datum bytes | 26.376 GB; 2,997,048 rows |

**Meaning of sizes:** GB/MB are decimal. Per-collection bytes sum PostgreSQL pg_column_size for every corpus_records column, including search vectors. They exclude shared table/index overhead and cannot be treated as independently reclaimable physical disk. Public corpus_records physically occupies 64.043 GB, including 9.026 GB of indexes. Storage totals use actual object metadata sizes, deduplicated by object key; all file bodies were not re-downloaded during this audit. The combined total is not a billing statement and excludes off-platform local downloads, provider backups and unmeasured services.

**Meaning of used/unused:** available means an identified application browse/search/download path permits access. It does not prove that a person accessed it, that every record is linked to a matter, or that legal currency/identity review is complete. Held means unavailable through the audited app paths. Source preservation and ingestion history have internal uses even when not shown in the app. No access analytics were measured; no universal "safe to delete" figure has been established.

## Database groups

| Group | Collections (available / held) | Actual rows | Record data | Available data | Held data |
|---|---:|---:|---:|---:|---:|
| Law | 22 (21 / 1) | 4,419,389 | 32.481 GB | 6.173 GB | 26.308 GB |
| Science and product safety | 15 (15 / 0) | 736,916 | 5.595 GB | 5.595 GB | 0 B |
| Matters and dockets | 22 (18 / 4) | 504,415 | 2.569 GB | 2.569 GB | 347.39 KB |
| Sources and captured pages | 11 (7 / 4) | 82,657 | 1.412 GB | 1.346 GB | 66.65 MB |
| Judges and people | 10 (9 / 1) | 135,756 | 621.52 MB | 621.52 MB | 0 B |
| Courts and court resources | 14 (13 / 1) | 48,531 | 347.98 MB | 347.15 MB | 827.97 KB |

All 94 catalog IDs map to a group; none currently falls into the top-level Other dataset group. Separately, the source library retains 3,648 uncategorized URL entries in mixed catalog bundles. The complete 9,348-entry catalog is 5.99 MB; no separate physical size exists for just that subset.

## File storage: available, held, preservation

| Status | Unique objects | Bytes | Share |
|---|---:|---:|---:|
| available through an identified app read path | 77,553 | 28.489 GB | 19.7% |
| held or private; no identified available app read path | 185,984 | 103.709 GB | 71.6% |
| archive/source/metadata preservation; availability not established | 10,568 | 12.572 GB | 8.7% |

Availability combines generic ready artifact routes, selected native-document PDF download rules, and all 5,482 current app bundle manifest keys. Every active bundle key exists. Categories are mutually exclusive and reconcile to the complete object-store total. The original generic-artifact-only test would have understated app use because matter PDFs and bundles use separate readers.

| File family | Status | Unique objects | Size |
|---|---|---:|---:|
| Matter PDFs | held or private; no identified available app read path | 117,489 | 73.202 GB |
| Matter PDFs | available through an identified app read path | 36,506 | 21.839 GB |
| Science originals | held or private; no identified available app read path | 6,576 | 9.765 GB |
| Legal graph source archives | archive/source/metadata preservation; availability not established | 1,517 | 9.325 GB |
| Court document supplement files | held or private; no identified available app read path | 19,249 | 8.863 GB |
| Other registered source files | held or private; no identified available app read path | 42,434 | 7.678 GB |
| Other registered source files | available through an identified app read path | 34,658 | 6.039 GB |
| Open US Law bulk files | held or private; no identified available app read path | 223 | 4.047 GB |
| Matter metadata and preservation | archive/source/metadata preservation; availability not established | 8,954 | 2.583 GB |
| Other registered source files | archive/source/metadata preservation; availability not established | 22 | 614.76 MB |
| Court document supplement files | available through an identified app read path | 889 | 268.55 MB |
| App snapshot bundles | available through an identified app read path | 490 | 215.99 MB |
| Agency safety exports | held or private; no identified available app read path | 12 | 153.40 MB |
| State-code originals and text | available through an identified app read path | 4,992 | 123.64 MB |
| State-code originals and text | archive/source/metadata preservation; availability not established | 31 | 41.63 MB |
| Legal authority raw sources | archive/source/metadata preservation; availability not established | 25 | 6.26 MB |
| Science originals | available through an identified app read path | 18 | 3.31 MB |
| App snapshot bundles | archive/source/metadata preservation; availability not established | 19 | 1.70 MB |
| Matter metadata and preservation | held or private; no identified available app read path | 1 | 470.97 KB |

File-family assignment is exclusive: matter PDF paths take precedence, then OpenUS, science, safety, court supplements and other preservation families. A shared object appears once. Consequently these family totals can differ slightly from overlapping route-specific subtotals.

## Largest unavailable areas

- **Matter PDF registry:** 95.041 GB across 153,995 unique stored PDFs. 21.839 GB / 36,506 objects qualify through the selected open native-document lookup; 73.080 GB / 117,190 are selected held documents; 121.93 MB / 299 are private or historical objects. The actual availability function checks withheld_by_policy first, then source-specific availability and restriction flags. Held is not synonymous with irrelevant or duplicate.
- **Open US Law:** 26.308 GB record data and 4.047 GB original bulk files; the U.S. law collection is the same dataset, not a second copy. Its 2,968,623 rows contain 1,997,490 statutes, 885,121 regulations, 44,547 court rules, 28,083 guidance records and 13,382 constitution records. Whole-collection publication remains held for unfinished snapshot lineage, provenance, quality and publication review. The [publisher dataset card](https://huggingface.co/datasets/vaquill/open-us-law), captured earlier today, states that older snapshots retain CC BY 4.0; the newest compilation restriction must not be applied retrospectively. The hold does not establish that every older record is unusable.
- **Science and safety:** 5.595 GB of available database records. Separately, science originals plus safety export files total 9.922 GB by their source routes, whose dedicated download routes are held. Nineteen science objects have an available artifact route elsewhere; the mutually exclusive table accounts for sharing.
- **Court supplement files:** 8.863 GB has no available path in the combined read-path audit; 0.269 GB has an available path elsewhere. These are separate from the matter PDF registry.
- **Staged legal graph and archives:** the legal_atlas schema physically occupies 7.061 GB, including 4.052 GB staging and 2.758 GB records. Its source archives occupy another 9.325 GB of object storage. These are retained internal/staged assets; app publication is held.


The additional 23:08:57 UTC read-only hold-reason query found the following selected native-document associations (these counts overlap by byte hash and must not be added as unique files):

| Source / recorded gating reason | Native documents |
|---|---:|
| courtlistener-public-locator: public locator provenance; not approved as open source | 86,258 |
| courtlistener: CourtListener availability/seal requirements not satisfied | 17,919 |
| docketbird: DocketBird restriction/download requirements not satisfied | 13,432 |
| official-court: explicit withheld_by_policy | 1 |

A failed availability/seal predicate does not establish that every file is actually sealed: missing or unverified flags also fail it. The largest category is a provenance classification, not a finding that all its source documents are unavailable to the public.

## Physical database allocation

| Schema | Tables | Physical table + index bytes | Index portion | Role |
|---|---:|---:|---:|---|
| public | 12 | 64.603 GB | 9.188 GB | Application corpus and registries |
| corpus_ingest | 26 | 15.671 GB | 3.287 GB | Private intake, source versions, relationships, OCR, receipts and before-images |
| legal_atlas | 13 | 7.061 GB | 449.99 MB | Retained/staged legal graph |
| storage | 8 | 504.84 MB | 328.00 MB | Object metadata (file bodies are counted separately) |
| auth | 27 | 1.30 MB | 1.07 MB | Authentication metadata |
| supabase_migrations | 1 | 360.45 KB | 32.77 KB | Service metadata |
| cron | 2 | 81.92 KB | 49.15 KB | Service metadata |
| realtime | 3 | 57.34 KB | 40.96 KB | Service metadata |
| vault | 1 | 24.58 KB | 16.38 KB | Service metadata |

Schema relation totals do not sum exactly to pg_database_size because system catalogs and other database allocation remain. Estimated live/dead tuple counts in the raw report are statistics, not exact counts or a measurement of reclaimable bytes.

## Every catalog collection

| Collection | Exact ID | Group | Rows | Record data | App status |
|---|---|---|---:|---:|---|
| U.S. law collection | open_us_law | Law | 2,968,623 | 26.308 GB | Held |
| Federal Register history | federal_register_history | Law | 1,006,725 | 3.871 GB | Available |
| CPSC injury data | cpsc_injury_data | Science and product safety | 479,534 | 3.137 GB | Available |
| Dated national eCFR hierarchy — September 30, 2026 | ecfr_hierarchy | Law | 274,752 | 1.096 GB | Available |
| FDA device enforcement reports (openFDA) | agency_safety_openfda_device_enforcement | Science and product safety | 39,949 | 798.43 MB | Available |
| Focused state and county legal-source captures | focused | Sources and captured pages | 16,450 | 741.43 MB | Available |
| Seeger Weiss matter registry — dockets in matters | sw_matter_dockets_v1 | Matters and dockets | 146,010 | 725.85 MB | Available |
| CourtListener docket metadata — native FJC MDL associations | cl_docket_metadata | Matters and dockets | 186,923 | 686.51 MB | Available |
| Indiana Code | indiana_code | Law | 83,148 | 667.88 MB | Available |
| Agency science documents | agency_science_documents | Science and product safety | 6,606 | 504.41 MB | Available |
| Saved source pages | saved_pages | Sources and captured pages | 19,066 | 457.59 MB | Available |
| FDA device PMA approvals (openFDA) | agency_safety_openfda_device_pma | Science and product safety | 57,101 | 361.95 MB | Available |
| MDL docket activity | mdl_docket_activity | Matters and dockets | 26,549 | 314.24 MB | Available |
| Citation index | citation_index | Law | 60,616 | 304.75 MB | Available |
| Seeger Weiss matter registry — docket entries of master dockets | sw_docket_entries_v1 | Matters and dockets | 64,475 | 287.84 MB | Available |
| Saved court forms, court rules and statutory provisions | seeger | Matters and dockets | 18,357 | 274.72 MB | Available |
| CourtListener positions and employment records — September 2026 snapshot | cl_positions | Judges and people | 51,291 | 214.34 MB | Available |
| FDA food enforcement reports (openFDA) | agency_safety_openfda_food_enforcement | Science and product safety | 29,406 | 179.61 MB | Available |
| FDA Orange Book (openFDA) | agency_safety_openfda_orangebook | Science and product safety | 48,761 | 171.21 MB | Available |
| Drugs@FDA approvals (openFDA) | agency_safety_openfda_drugsfda | Science and product safety | 29,335 | 167.94 MB | Available |
| CFR sections | federal_regulations_sections | Law | 12,622 | 151.90 MB | Available |
| Court documents | court_documents | Courts and court resources | 20,861 | 145.53 MB | Available |
| FDA drug enforcement reports (openFDA) | agency_safety_openfda_drug_enforcement | Science and product safety | 17,965 | 114.64 MB | Available |
| Consolidated judge profiles | judge_entities | Judges and people | 10,669 | 97.02 MB | Available |
| Judge profile source observations | judge_enrichment | Judges and people | 11,926 | 96.68 MB | Available |
| Source-native docket entries — metadata only | cl_master_entries | Matters and dockets | 23,919 | 78.92 MB | Available |
| Judge directory | judges | Judges and people | 10,698 | 66.56 MB | Available |
| Document coverage | docsupload_coverage | Sources and captured pages | 11,451 | 63.90 MB | Available |
| CourtListener people and explicit aliases — September 2026 snapshot | cl_people | Judges and people | 16,191 | 56.43 MB | Available |
| CPSC product recalls | agency_safety_cpsc_recalls_local | Science and product safety | 9,970 | 55.12 MB | Available |
| Court Forms (2026-09-12 expansion) | court_forms_expansion_20260912 | Courts and court resources | 4,475 | 54.62 MB | Available |
| County litigation resources | county_litigation | Courts and court resources | 3,311 | 51.37 MB | Available |
| Seeger Weiss matter registry — parties and counsel of master dockets | sw_matter_parties_v1 | Matters and dockets | 11,825 | 44.18 MB | Available |
| Historical biographies | people | Judges and people | 16,191 | 41.07 MB | Available |
| U.S. Courts pages | uscourts_pages | Courts and court resources | 1,404 | 40.86 MB | Available |
| FDA device classification (openFDA) | agency_safety_openfda_device_classification | Science and product safety | 7,093 | 39.49 MB | Available |
| MDL counsel and parties | mdl_counsel | Matters and dockets | 6,940 | 39.12 MB | Available |
| Coverage topics | coverage_topics | Sources and captured pages | 17,942 | 38.83 MB | Held |
| FDA device category metadata — October 2, 2026 | agency_safety_openfda_device_classification_20261002 | Science and product safety | 7,094 | 37.98 MB | Available |
| MDL case inventory | mdl_case_inventory | Matters and dockets | 4,159 | 36.87 MB | Available |
| Source documents | source_documents | Sources and captured pages | 612 | 35.17 MB | Available |
| CourtListener education records — September 2026 snapshot | cl_educations | Judges and people | 12,777 | 33.90 MB | Available |
| Coverage labels | coverage_labels | Sources and captured pages | 10,013 | 27.42 MB | Held |
| Counsel directory | counsel_directory | Matters and dockets | 4,585 | 24.46 MB | Available |
| Federal Register — August 21–October 2, 2026 metadata | regulatory_backfill | Law | 3,139 | 21.95 MB | Available |
| Court directory | court_spine | Courts and court resources | 5,411 | 19.56 MB | Available |
| Legal source directory | sources | Sources and captured pages | 5,700 | 18.71 MB | Available |
| CFR source documents | federal_regulations_documents | Law | 2,259 | 18.31 MB | Available |
| MDL docket documents | mdl_docket_documents | Matters and dockets | 5,016 | 16.77 MB | Available |
| Law and court-rule captures pending publication | pending_publication | Sources and captured pages | 301 | 16.19 MB | Available |
| CourtListener schools and explicit aliases — September 2026 snapshot | cl_schools | Judges and people | 6,011 | 15.43 MB | Available |
| Public laws | public_laws | Law | 2,155 | 14.41 MB | Available |
| Dated source additions and evidence connections | gap_enrichment_20260927 | Sources and captured pages | 966 | 12.73 MB | Available |
| Expert-admissibility docket entries (keyword scan) | expert_rulings | Matters and dockets | 2,035 | 12.16 MB | Available |
| CourtListener courts — September 2026 snapshot | cl_courts | Courts and court resources | 3,359 | 11.92 MB | Available |
| FDA complete response letters (openFDA) | agency_safety_openfda_crl | Science and product safety | 458 | 11.46 MB | Available |
| State proceedings | state_proceedings | Matters and dockets | 1,432 | 10.89 MB | Available |
| FDA drug shortages (openFDA) | agency_safety_openfda_drug_shortages | Science and product safety | 1,603 | 8.86 MB | Available |
| CourtListener courthouse records — September 2026 snapshot | cl_courthouses | Courts and court resources | 3,361 | 8.59 MB | Available |
| Settlements | settlements | Matters and dockets | 869 | 7.90 MB | Available |
| Citation reference | citation_reference | Law | 2,433 | 7.00 MB | Available |
| CFR parts | federal_regulations_parts | Law | 1,302 | 6.23 MB | Available |
| MDL counsel appearances | mdl_appearances | Matters and dockets | 878 | 5.66 MB | Available |
| South Dakota Codified Laws | sd_statutes | Law | 71 | 5.61 MB | Available |
| County directory | counties | Courts and court resources | 3,144 | 4.85 MB | Available |
| Trellis connector receipts | trellis_receipts | Courts and court resources | 2,550 | 4.71 MB | Available |
| Court statistics | court_statistics | Courts and court resources | 374 | 3.79 MB | Available |
| FDA warning letters | agency_safety_fda_warning_letters | Science and product safety | 1,000 | 3.37 MB | Available |
| FDA press-release recalls | agency_safety_fda_press_recalls | Science and product safety | 1,041 | 3.32 MB | Available |
| Federal court websites and legal reference resources | federal | Law | 577 | 3.01 MB | Available |
| Limitation periods | limitation_periods | Law | 459 | 1.98 MB | Available |
| JPML multidistrict litigation | mdls | Matters and dockets | 179 | 1.52 MB | Available |
| County court rules and orders — September 28 additions | county_enrichment_20260928 | Courts and court resources | 14 | 1.27 MB | Available |
| Seeger Weiss matter registry — regulatory evidence links (topical associations, 6 MDLs) | sw_matter_regulatory_links_v1 | Matters and dockets | 165 | 1.06 MB | Available |
| Court profiles & seals | court_reference | Courts and court resources | 253 | 827.97 KB | Held |
| Cited U.S. limitations rules — October 2026 review | statutory_limitations_review | Law | 124 | 827.24 KB | Available |
| Selected eCFR authority and source notes | ecfr_authority_notes | Law | 36 | 680.26 KB | Available |
| Official JPML and court HTML references — October 2026 | jpml_html_reference | Law | 93 | 573.91 KB | Available |
| Complete large reader-text downloads | large_text_assets | Sources and captured pages | 155 | 405.78 KB | Held |
| CourtListener directed citation mentions — scoped September 2026 snapshot | cl_citation_edges | Law | 201 | 403.01 KB | Available |
| MDL crosswalk | mdl_crosswalk | Matters and dockets | 59 | 338.64 KB | Held |
| Seeger Weiss matter registry — MDL matters | sw_matters_v1 | Matters and dockets | 38 | 325.69 KB | Available |
| Selected mass-tort authorities and statutory access gaps — October 2026 | mass_tort_authority_evidence | Law | 25 | 204.49 KB | Available |
| Judge vendor analysis previews | judge_vendor | Judges and people | 2 | 87.04 KB | Available |
| Trellis county coverage pages | trellis_browser_counties | Courts and court resources | 6 | 57.23 KB | Available |
| CourtListener reporter citations — scoped September 2026 snapshot | cl_reporter_citations | Law | 26 | 46.85 KB | Available |
| CourtListener recorded appeals-to relationships | cl_court_appeals_to | Courts and court resources | 8 | 17.40 KB | Available |
| Provider laws | provider_laws | Law | 1 | 11.68 KB | Available |
| Seeger Weiss matter registry — dockets in matters (superseded rows, not served) | sw_matter_dockets_v1_superseded | Matters and dockets | 2 | 8.75 KB | Held |
| State codes | state_codes | Law | 2 | 5.89 KB | Available |
| Library files | library_assets | Sources and captured pages | 1 | 336 B | Held |
| Judge portraits | judge_portraits | Judges and people | 0 | 0 B | Held |
| Seeger Weiss matter registry — regulatory evidence links, staged extension (not published) | sw_matter_regulatory_links_v1_staged | Matters and dockets | 0 | 0 B | Held |
| Verdict reports | verdict_reports | Matters and dockets | 0 | 0 B | Held |

Two available version families retain earlier rows: people (prior to cl_people), and the earlier FDA device-classification snapshot (prior to the 20261002 dataset). The normal section/search family view favors the current dataset; prior versions remain selectable through inventory/detail access. They are not proven redundant byte copies.

## Deletions and duplicates

Judge financial disclosures and the deleted URL directory are absent from the live catalog. Their prior removal retained raw/recovery evidence; original Storage files were not removed as part of that dataset deletion. No new deletion was performed. The prior whole-byte duplicate cleanup reclaimed 9,833,011 bytes from 29 redundant paths. One proven duplicate pair of 161,217 bytes per copy remains because both paths have immutable provenance references. Earlier apparent orphan objects were traced to preservation ledgers. That full-reference reconciliation predates the current inventory by 5,215 objects / 258,176,133 bytes, so its old residual count is not a current result. This audit measures current paths and eligibility but does not rerun every historical provenance ledger; no current orphan/deletion amount is claimed.

## Evidence

All evidence is private under private/audit-2026-10-05/owner-requested-full-audit/: live-inventory.sql/json, live-dataset-sizes.sql/json, pdf-gates.sql/json, storage-usage.sql/json, grouped-collection-audit.json, collection-audit.csv, audit-summary.json. Prior detailed science/OpenUS route evidence is in ../requested-dataset-sizes/. Actual row counts equal every catalog imported_records count in this snapshot. Query/readiness logic was checked against the live PDF function definitions and local application readers. No collection is declared legally accurate/current or complete merely because its ready flag is true.
