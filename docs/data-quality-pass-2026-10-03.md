# Data-quality pass - 2026-10-03

External corpus project `xosqzzsnhxcyehcnirpa`, audit run `664a081e-b5a6-4ab0-af5a-41c260b0d09b` (`corpus_ingest.runs`, status completed 11:20 UTC). Scope: accuracy of the public read model that the app reads through `corpus_datasets`, `corpus_query[_bounded]`, `corpus_detail` and direct REST (labels, titles, categories, facets, links, counts). Every change is a reversible UPDATE with a before-image in `corpus_ingest.cleanup_decisions` (issue prefix `dq20261003_`). No record was deleted, no ready/held flag or count changed, and no `pdf_*`, matter-registry or storage object was touched.

## Before and after

| Metric | Before | After |
| --- | ---: | ---: |
| Datasets whose label is the raw id (`seeger`, `focused`, `federal`, `trellis_receipts`, ...) | 14 | 0 |
| Datasets whose label is a title-cased id (`Mdl Case Inventory`) | 47 | 2 (`indiana_code`, `settlements` already read correctly) |
| Curated dataset labels | 28 | 87 |
| NJ statute titles repeating the citation (`2A:4-30.124 — 2A:4-30.124 Short title.`) | 5,856 of 6,695 | 0 |
| Library display-group titles repeating the citation | 5,856 | 0 |
| Titles wrapped in Markdown bold (`**Escrow Agreement**`, `**Summons in a Civil Action**(AO 440)`) | 161 | 0 |
| Titles with undecoded XML/HTML entities (`FD&amp;C Blue No. 1.`, `Debtor&#039;s`) | 131 | 0 |
| Facet option counts that did not equal the rows the filter returns | 21 (+1 dead option) | 0 |
| `corpus_law_collections` rows visible to planner / `list_tables` | 0 (stale stats) | 224 |
| Rows, datasets, ready datasets, `sum(imported_records)` | 5,858,715 / 89 / 80 / 5,858,715 | unchanged |
| Records deleted, publication flags changed, PDFs downloaded | - | 0 / 0 / 0 |

Cost: 6,148 `corpus_records` rows rewritten (0.10%), 5,896 display-group rows, 59 dataset rows; heap +9 MB, indexes +3 MB, audit +12 MB (about 5 KB per rewritten row all-in, which is the figure to use for the 100k-row guard). `corpus_records` stays 52 GB.

## Applied changes

| # | Contract (SQL in `database/contracts/`) | Change | Rows | Receipt (under `_work/agents/data-quality/receipts/`) |
| --- | --- | --- | ---: | --- |
| 1 | `dataset-label-review-20261003-v1.sql` | Raw-id and title-cased-id labels replaced by evidence-based labels (product vocabulary in `domainRegistry.LABELS`, `metadata.summary.native_dataset`, record-kind distributions) | 59 | `01-dataset-label-review.json` |
| 2 | `dataset-facet-count-review-20261003-v1.sql` | Option counts of `counsel_directory`, `mdl_counsel`, `court_spine` recomputed from live `filters` with the same containment semantics as `corpus_query_bounded`; dead `court_spine` option `T` (quarantined testing courts) removed | 3 datasets | `02-dataset-facet-count-review.json` |
| 3 | `seeger-nj-statute-title-dedupe-20261003-v1.sql` | Dataset `seeger`, New Jersey statutes: `^(\S+) — \1\.?\s+(\S.*)$ -> \1 — \2`, whitespace collapsed; title, `item.title`, `detail.title`, and the display-group title | 5,856 | `03-seeger-nj-statute-title-dedupe.json` |
| 4 | `markdown-wrapped-title-cleanup-20261003-v1.sql` | Whole-title `**...**` removed (seeger 29, url_directory 59, docsupload_coverage 29, court_forms 16, court_documents 1) | 134 | `04-markdown-wrapped-title-cleanup.json` |
| 4b | `markdown-form-title-cleanup-20261003-v2.sql` | `**Form name**(AO 440)` -> `Form name (AO 440)` and `**Mortgage** — ...` -> `Mortgage — ...` | 27 | `07-final-verification.json` |
| 5 | `html-entity-title-decode-20261003-v1.sql` | Entities decoded once, `&amp;` last (CFR sections 122, URL directory 9) | 131 | `05-html-entity-title-decode.json` |
| 6 | `dataset-label-accuracy-addendum-20261003-v1.sql` | `expert_rulings` relabelled to `Expert-admissibility docket entries (keyword scan)`: only 810 of 2,035 rows are orders, the rest are motions, oppositions, replies and exhibits | 1 | `06-label-accuracy-addendum-and-analyze.json` |
| 7 | maintenance | `ANALYZE public.corpus_law_collections` (`n_live_tup` 0 -> 224) | - | `06-...json` |

Why these are safe and deterministic:
* NJ titles: for all 5,856 rows the whitespace-collapsed old title equals the first line of the record's own `text` (the published heading already starts with the citation), `item.title` and `detail.title` equal `title`, and the other 839 statutory rows already use the house form `9 U.S.C. § 1 — Heading`.
* A 100-row canary was reverted in place and every row's whole-row md5 (search vector included) matched the stored original 100/100 before the full block was applied.
* `database/contracts/verify-data-quality-pass-20261003-v1.sql` recomputes each original row md5 from the current row with only the changed fields swapped back (and the derived search vector recomputed): 5,856, 134, 27 and 131 of 5,856, 134, 27 and 131 are identical, so nothing but the intended fields changed. Facet recount mismatches: 0 in all three datasets.
* Titles in native projection datasets reconciled by full-field SHA (`ecfr_hierarchy`, `cl_*`, `jpml_html_reference`, `regulatory_backfill`, ...) were deliberately not edited.

Each contract header contains its exact rollback statement.

## Corrections to earlier statements

* `corpus_law_collections` is not empty: 224 rows over 53 jurisdictions; `provisions` sums to 2,968,623 (the `open_us_law` row count), `headings` to 196,458 (the `corpus_law_nodes` row count) and every (state, kind) pair equals its node totals. `list_tables` showed 0 because `pg_stat` had never been analysed. The `corpus_law_outline` RPC still answers `available:false` while `law_outline.ready` and `open_us_law.ready` are false, but the UI's direct REST reads of `corpus_law_collections` / `corpus_law_nodes` / `corpus_law_provision_rows` are not gated by that flag.
* The Oct-2 audit figures (71 datasets, 5,272,705 rows) are superseded: 89 datasets, 5,858,715 rows (ready 2,861,669, held 2,997,046). Catalog, imported and actual counts agree for every dataset; the only expected-vs-actual difference is held `verdict_reports`.

## Hand-offs

ui-integration:
* `domainRegistry.LABELS` contradicts the data: `mdl_appearances` ("Judge MDL appearances") holds attorney/firm/role/side appearances per matter; `judge_entities` ("Judge relationships") holds consolidated judge profiles; `expert_rulings` ("Expert rulings") holds keyword-matched docket entries. DB labels now follow the content.
* State pages count `state=eq.<full name>`, but 259,727 rows (url_directory 57k, openFDA 135k, court_documents, saved_pages, court_spine 4,784, cl_courthouses, ...) store USPS codes, so name-based counts under-count (e.g. CA 40,988 vs California 171,663). Query `state=in.(<Name>,<CODE>)`; ignore `US` (1,633 rows, a country).
* Decode entities in `normalizeItem.scalar` (remaining: `ecfr_hierarchy` 215 titles, three `corpus_context` CFR-part blocks).
* `listing_modes` (`counsel_directory`, `mdl_counsel`) is ignored; top-level facet counts are now exact across all kinds.
* `mdl_appearances` (96 groups of identical cards, 714 excess rows of 878) and `counsel_directory` (299 groups, 704 excess rows) show indistinguishable cards (e.g. 140 identical entries for one attorney). They are distinct matter-level appearances and distinct native attorney ids, so they must not be merged; show the matter id (`detail` fact "Matter id (AWS release)").
* `judge_disclosures`: 19,165 of 21,832 `source_url` values contain spaces; percent-encode at render, keep the raw provenance.

mdl-members (coverage, not accuracy):
* Closed MDLs absent from `mdls`: 2545, 2606, 2800. `mdls` is the JPML snapshot of 2026-09-01.
* Only 18 of 176 MDLs carry a `cl_docket_id`; `mdl_case_inventory` has 4,159 cases of which 3,258 are not tied to an MDL, and 117 MDLs (109 pending) have no inventory case.
* Transferee judge unresolved for MDLs 2358, 2695, 2879, 3015; `total_actions` null for 10 terminated MDLs.
* 64,002 relationship edges point at targets not imported (attorneys->parties 39,441; parties->attorneys 15,233; parties->dockets 7,066; dockets->FJC IDB 662; opinion edges 1,600). The flag is honest and fully consistent (0 stale of 1,427,847); 516 `inferred` edges are all judge-position links.
* 2,442 `mdl_docket_activity` links have no `event_date` ("no docket text recorded"); 680 of them have an exact native docket-id + entry-number match in `cl_master_entries` with a filing date.

## Proposed larger changes (not applied; need approval)

| # | Proposal | Rows | Notes |
| --- | --- | ---: | --- |
| P1 | Prefer the query-layer state fix above. If a data rewrite is wanted: map USPS codes to names | 258,094 mappable rows (230,143 in ready datasets + 27,951 in held coverage_topics 17,942 / coverage_labels 10,009); 1,633 `US` rows in `sources` are a country and stay. Largest ready: url_directory 57,019; openFDA PMA 54,209; device enforcement 36,214; food enforcement 28,962; drug enforcement 16,878; court_documents 8,168; saved_pages 8,065; court_spine 4,784; court_forms 4,227; sources 3,849; cl_courthouses 3,353; county_litigation 2,784 | ~1.3 GB growth; every USPS code maps unambiguously; the facet `filters.state` values would also need changing |
| P2 | Whitespace normalisation of titles | about 114k ready rows (openFDA enforcement 44.7k, CPSC 29.9k, indiana_code 11.0k, saved_pages 10.0k, cl_people 5.2k, url_directory 3.4k, people 2.3k, focused 1.8k) | display layer already collapses; person names (7,475) are the only cheap, useful slice |
| P3 | Remove the 2 stale `corpus_workspace_court_map` rows for quarantined testing courts `test`, `psc` | 2 | a DELETE, so held back; before-image to be stored in `cleanup_decisions` |
| P4 | Fill 680 undated activity links from exact native filing dates with `date_basis='native_master_entry_filing_date'` | 680 | mixes entered and filed dates; owner decision |
| P5 | Decode entities in `ecfr_hierarchy` | 215 | native projection with full-field SHA; needs re-projection and re-reconciliation, display-layer decode preferred |
| P6 | Same NJ duplicate-citation fix for held `coverage_topics` | 117 | wait for release decision |
| P7 | `trellis_receipts` titles equal ids | 2,550 | requires authored text (tool + arguments); low value |
| P8 | Reconcile 4 `corpus_context` blocks that embed old strings | 4 | carry `source_sha256`; report only |

## Not changed on purpose

* All-caps titles (128k ready rows): native source forms (Orange Book, Drugs@FDA, CourtListener captions, firm names, Utah judge profiles). Only 2 rows have a proper-case counterpart in the same record.
* `U+FFFD` characters (CPSC ~1,300, `cl_positions` 25, 11 `state` values): the original byte is already lost.
* openFDA/CPSC asterisks and entities: part of FDA/CPSC label text. Partial or unbalanced Markdown markers (34 rows in the five cleaned datasets, e.g. `***UPDATE***Notice...`, `Divorce Procedure **Read First**`, page titles with embedded newlines) are ambiguous and were left as captured.
* Strict payload duplicates (`counsel_directory`, `mdl_appearances`): distinct native identities.
* Dataset `metadata.summary` counts of `court_spine` (5,413): the pre-quarantine export figure, retained next to `source_records_before_quarantine`.

## Advisories

Security (Supabase advisor): 45 x `rls_enabled_no_policy` (INFO) on `public`, `corpus_ingest` and `legal_atlas` tables is the intended service-role-only design (verified: no table in `public` is SELECT-able by `anon` or `authenticated`, and no function in the three schemas is executable by them); 1 x `auth_leaked_password_protection` (WARN) is a project Auth setting outside this task and left unchanged. Nothing was weakened.

Performance: 20 unindexed foreign keys on private ingest tables, 4 unused small indexes and the Auth connection strategy are INFO only. All ten `corpus_records` indexes are in use, per-state count probes take 28 ms, and `corpus_query_bounded` averages 27 ms over 7,107 calls, so no index change was made. Every title UPDATE fires `corpus_records_search_vector_trg` (tsvector from title + up to 1 MB of text) and rewrites eight indexes, which is why bulk rewrites above 100k rows are gated.

## Reproduce

Run `database/contracts/verify-data-quality-pass-20261003-v1.sql` (read-only). The baseline numbers are in `_work/agents/data-quality/baseline.json` and `baseline.md`.
