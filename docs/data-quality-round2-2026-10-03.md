# Data-quality round 2 - 2026-10-03

Run `af6ac9c6-b834-497d-bd19-17970d4857d3` (status in `corpus_ingest.runs`; continuation of round 1, run `664a081e-b5a6-4ab0-af5a-41c260b0d09b`, report `docs/data-quality-pass-2026-10-03.md`).
Branch `claude/data-quality-20261003`, not pushed. Every change has a before-image in `corpus_ingest.cleanup_decisions` (issue prefix `dq20261003r2_`), a contract under
`database/contracts/` with an exact rollback, and was verified by `database/contracts/verify-data-quality-round2-20261003-v1.sql`
(virtual revert: swap only the changed fields back to the before-image and recompute the derived search vector - the original whole-row md5 must come back).
Rules kept: no deletes beyond the 2 approved court-map rows, no publication / ready / held flag changed, no `corpus_ingest` entity or relationship written, no `pdf_*` or matter-registry object touched, <= 6,300 rows per statement, cost guard (100k rows) never approached.

## 1. Before / after

| Metric | Before | After |
|---|---|---|
| `corpus_workspace_court_map` rows vs `court_spine` rows (testing courts `test`, `psc`) | 5,413 vs 5,411, 2 stale | 5,411 = 5,411, 0 dangling |
| Undated MDL docket-activity links (`corpus_workspace_docket_links.event_date`) | 2,442 | 1,780; 662 filled from exact native CourtListener filing dates, `date_basis = 'native filing date (CourtListener)'`; 18 ambiguous left undated |
| Titles starting with `*` in `seeger` (coordinator note) | 2 | 0 (13 rows in 4 datasets) |
| Citation index titles with a stray trailing comma | 282 | 32 (collide with a separate row, flagged) |
| Citation index reporter filter: distinct values / reporters split over several options | 673 / 94 | 549 / 5 |
| Seeger Weiss MDL-number queries that return the MDL first (`3140`, `MDL 3047`, `MDL 2738`, `2738`, `MDL 2741`, `MDL 3094`, `MDL 3081`, `MDL 3140`, `3:25-md-3140`) | 0 of 9 | 9 of 9 |
| The ten requested Seeger Weiss queries with the right result first | 7 of 10 (`3140` and `MDL 3047` not in the top 10 at all, `Judge Rodgers` 4th) | 9 of 10 (`Judge Rodgers`: ranking proposal below) |
| `mdls` rows whose search vector holds the MDL number and docket | 0 of 176 | 176 of 176 |
| Litigation / court-form titles with dot leaders, edge whitespace or repeated segments | 12 | 0 |
| Dangling `corpus_ingest.relationships` edges | 64,002 reported earlier; 69,737 now (mdl-members keeps writing) | unchanged (read-only); 1,640 of them are stale flags, see section 5 |

## 2. Applied changes (receipts in `_work/agents/data-quality/receipts/08..11`)

| Contract | Rows | What |
|---|---|---|
| `court-map-quarantined-testing-courts-r2-20261003-v1.sql` | 2 deleted (approved) | `test` and `psc` projection rows whose source rows were quarantined; full rows kept in `cleanup_decisions` |
| `docket-link-native-filing-date-r2-20261003-v1.sql` | 662 | `event_date` + explicit `date_basis` from the exact native filing date; cross-checked against the private docket-entries entity; only exact + unique matches |
| `markdown-lone-marker-cleanup-r2-20261003-v3.sql` | 13 | lone opening `***` and balanced `**x**` markers removed (`seeger`, `url_directory`, `docsupload_coverage`, `court_documents`); trailing-only `**`, mixed `***x***text` and 16 page snippets with literal backslash-newlines left as captured |
| `citation-index-trailing-comma-r2-20261003-v1.sql` | 250 | see `docs/data-quality-citations-2026-10-03.md` |
| `citation-index-reporter-facet-r2-20261003-v1.sql` | 6,223 + 1 option list | see `docs/data-quality-citations-2026-10-03.md` |
| `mdls-searchable-identifiers-r2-20261003-v1.sql` | 176 | section 3 |
| `litigation-title-defects-r2-20261003-v1.sql` | 12 | section 4 |

Distinct `corpus_records` rows rewritten: 6,668 (about 33 MB all-in at the measured ~5 KB per rewritten row); audit rows written: 7,339.

## 3. Work item B - search accuracy for the Seeger Weiss queries

### How the app searches (read from `src/lib/external`, reproduced faithfully in `_work/agents/data-quality/search/search_harness.mjs`)

`searchPublishedCorpus` calls the RPC `corpus_query(p_sort = NULL, p_limit = 500)` over every ready dataset, plus two 250-row priority passes
for `mdls` and `expert_rulings`, then re-ranks those candidates in the browser by **title only** (`exact*100 + prefix*70 + allWords 200 + phrase 200 + dataset priority`, `mdls` = 350).
Two consequences measured below: (1) with `p_sort = NULL` the RPC orders by `(ordinal, id)` only, so the 500 candidates are the 500 *lowest-ordinal* matches, not the best 500;
(2) a record is findable only through words that are in its **title or text**.

### Top results, baseline vs after the data fix (full top-10 lists: `_work/agents/data-quality/search/runs/*.json`)

| Query | Matches | Baseline top 3 | After top 3 |
|---|---|---|---|
| Depo-Provera | 71 | 1. mdls:3140 MDL 3140 - Depo-Provera ... / 2. Depo-Provera Cases (JCCP 5375) / 3. DEPO-PROVERA (FDA Orange Book) | same - correct first |
| 3140 | 677 | 1-2. Docket entry 3140 / 3. eCFR section 3140.1 (MDL 3140 absent from the pool) | 1. **mdls:3140 MDL 3140 - Depo-Provera** / 2-3. Docket entry 3140 |
| MDL 3047 | 2,982 | 1. JPML court master reference / 2. judge page reference / 3. motion index (MDL card absent) | 1. **mdls:3047 MDL 3047 - Social Media Adolescent Addiction** / 2-3. JPML references |
| social media adolescent addiction | 2,383 | 1. mdls:3047 / 2-3. expert rulings in the MDL | same - correct first |
| GLP-1 | 1,459 | 1. mdls:3094 / 2. mdls:3163 (NAION) / 3. expert rulings | same - correct first |
| Roundup | 157 | 1. mdls:2741 / 2-3. NJ MCL and JCCP Roundup | same - correct first |
| talc | 3,172 | 1. mdls:2738 / 2-3. NJ MCL Talc-Powder, JCCP J&J Talcum | same - correct first |
| Bard port catheter | 1,506 | 1. mdls:3081 / 2-3. docket documents of 2:23-md-03081 | same - correct first |
| Judge Rodgers | 730 | 1. saved page "People v. Rodgers" / 2. Carlos Rodgers / 3. Henry Lee Rodgers - **the Depo-Provera transferee judge (M. Casey Rodgers = Margaret Catharine Rodgers, `people:2755`) is 4th** | unchanged (needs the ranking proposal; with it: `people:2755` 1st) |
| Seeger Weiss | 2,299 | 1. counsel_directory firm Seeger Weiss LLP / 2. mdl_counsel firm / 3. Christopher A Seeger appearances | same - correct first |

Extended MDL-number queries, baseline -> after (first result): `MDL 2738` Talc-Powder state page -> mdls:2738; `2738` same -> mdls:2738; `MDL 2741` -> mdls:2741; `MDL 3094` docket entry 714 -> mdls:3094;
`MDL 3081` an unrelated Blue Cross docket -> mdls:3081; `MDL 3140` a member docket -> mdls:3140; `3:25-md-3140` JPML CM/ECF page -> mdls:3140.

### Root causes found

1. **Empty `text` on all 176 `mdls` rows** (data) - the search vector held only the caption, so MDL number, master docket and every docket form were unsearchable; the `mdls` priority pass returned 0 rows for every number query. **Fixed** (`mdls-searchable-identifiers-r2-20261003-v1.sql`): `text` = `MDL <n>` + master docket as printed + 5-digit padded form + compact form (e.g. `MDL 3140 3:25-md-3140 3:25-md-03140 3:25md3140`), taken only from the row's own `item`. Judge, court, status words were deliberately not added (they would make every MDL match `pending`, `Ninth Circuit` or `Judge Rodgers`). The column is empty before, so the UI shows a one-line identifier string in any "Record text" block for an MDL.
2. **No relevance order in `corpus_query`** (RPC) - candidate pool = lowest 500 ordinals; 7 of the 10 queries have more than 500 matches. Proposal R1 below.
3. **Honorific `judge` required in the text and absent from every title** (RPC + client) - kills the all-words / phrase bonuses for every judge record and forces a four-way tie at score 100 broken alphabetically. Proposal R2 + client scoring below.
4. Checked and clean: no null or stale `search_vector` in any litigation, judge, counsel or court dataset (176 / 6 / 59 / 10,698 / 16,191 / 4,585 / 6,940 / 2,035 / 1,432 / 4,159 rows ... 0 stale); `category` values of the litigation datasets are consistent (`people` / `cl_people` are labelled `historical_biography` even for sitting judges - a label for the UI to reword, not changed).

### Proposals (NOT applied)

* `database/contracts/PROPOSED-corpus-query-relevance-20261003-v1.sql` - full `CREATE OR REPLACE FUNCTION corpus_query` with two marked changes: R1 title-hit tier first when `p_sort IS NULL` and a text query is present; R2 honorific words dropped from the prefix query when other words remain. Original definition saved for rollback in `_work/agents/data-quality/search/corpus_query.original.sql`. Run `EXPLAIN ANALYZE` on `2885` (105k matches) before applying.
* Client (`src/lib/external/searchQuality.ts`, prototyped read-only): in `score()` ignore honorific query words for the title comparison and, when the query had one, add +250 for judge datasets (`judges`, `people`, `cl_people`, `judge_entities`, `judge_enrichment`) and +250 when the record's CourtListener person id is an MDL transferee judge (`mdls.filters.cl_person_id`, 176 ids). Prototype for `Judge Rodgers`: `people:2755` 1000, Henry Lee Rodgers 750, People v. Rodgers 500, Carlos Rodgers 500.

## 4. Work item C - litigation title quality

Profile of `mdls` (176), `mdl_case_inventory` (4,159), `mdl_docket_activity` (26,549), `mdl_docket_documents` (5,016), `court_documents` (20,861), `cl_master_entries` (23,919), `cl_docket_metadata` (186,923), `saved_pages` (19,066):
0 empty titles, 0 raw ids, 0 entity-encoded titles; the six litigation datasets (all but `court_documents`, `saved_pages`) have none of the defect classes.

Fixed (12 rows, deterministic): 6 PDF form dot leaders in `court_documents` (`... Court File No. ........` -> `... Court File No.`), 3 edge-whitespace titles and 3 exactly repeated segments (`Kentucky Court of Justice - Kentucky Court of Justice`, `Common Pleas Judges | Common Pleas Judges | ...`) in `saved_pages`.

Judgment items (not changed):

| Item | Rows | Note |
|---|---|---|
| `mdl_docket_documents` titles are the docket label, so a docket's documents are indistinguishable | 5,016 rows, 17 distinct titles (largest group 645) | row cells hold `description` and the id holds the entry number: `description + entry` would give 4,995 distinct titles (proposal, ~25 MB) |
| `cl_master_entries` titles are `Docket entry N` | 23,919 rows, 13,694 distinct | every row joins to its docket in `cl_docket_metadata` (23,919 of 23,919): adding docket number + court gives 23,346 distinct (proposal, ~120 MB) |
| `cl_docket_metadata` titles are `Docket <number>` without court | 17,522 rows share a title with another docket | appending `(court_id)` to the 30,453 rows in shared groups (~150 MB) |
| `saved_pages` titled `(untitled)` | 1,578 | the app already derives a source-file label for these cards |
| Replacement characters / control characters in titles (`Pe��on`, `PREA � Audit`) | 3 `court_documents`, 43 `saved_pages` | the lost character is not recoverable deterministically |
| Body text captured as a title, Markdown links in NELIS listing titles, titles cut by the source ("... | United States Department ") | ~10 | needs source re-capture |
| Trailing `**` (could be a PDF footnote mark) | 2 `court_documents` | left as captured |
| Whitespace runs in titles (display collapse deferred to the UI by the coordinator) | `saved_pages` 10,009, `court_documents` 41 | UI |

## 5. Work item D - dangling `corpus_ingest.relationships` edges (read-only)

Total edges 1,543,885; target present 1,474,148; **dangling 69,737** (the 64,002 quoted earlier has grown: mdl-members is still writing parties / attorneys). No row was written.

| from_type . field | to_type | Edges | Dangling | Distinct missing targets | Cause / alternate id form |
|---|---|---|---|---|---|
| attorneys . parties_represented[].party | parties | 59,174 | 44,998 | 16,316 | party entities are a docket-scoped sample (4,160 imported). 158 of the targets exist now (**347 stale flags**). No other id form: the public read model keeps counsel under hashed ids (`mdl_counsel`, `mdl_appearances`); 30 party ids equal attorney ids numerically (collision, not identity) |
| parties . attorneys[].attorney | attorneys | 28,641 | 15,411 | 4,898 | attorney entities scoped (1,868 imported). 171 targets exist now (**1,293 stale flags**) |
| parties . attorneys[].docket | dockets | 28,641 | 5,427 | 767 | docket not imported |
| parties . party_types[].docket | dockets | 6,359 | 1,639 | 1,011 | same; 7 of the 1,021 distinct missing dockets exist in the public read model as `mdl_case_inventory` `cl_docket:<id>` (0 in `cl_docket_metadata`) |
| dockets . idb_data_id | fjc-integrated-database | 185,881 | 662 | 662 | the IDB snapshot holds ids 23,255,272-26,368,313; 243 missing ids are below that window and 215 belong to dockets filed before 2009; no zero-padding or prefix variant matches |
| 7 opinion edges (search_opinion_joined_by, opinions-cited x2, unmatched-citations, parentheticals x2, clusters.sub_opinions) | opinions | 1,600 | 1,600 | 1,022 | no `opinions` entities exist at all (scoped snapshot); the 12 citing opinions of `opinions-cited` are reachable through `clusters.sub_opinions` URLs; no opinion id equals a cluster or edge id |

Action for the owner (mdl-members; not run by this agent): the bounded `corpus-native-target-presence/2` refresh (`database/contracts/refresh-native-target-presence-v2-20261002.sql`) would flip **1,640** stale `target_present=false` flags to true (68,097 dangling remain). The rest are intentional gaps of a scoped snapshot; the UI should show them as "not in the saved snapshot" rather than as broken links.

## 6. Decisions on the round-2 proposals (coordinator review, applied in round 3; see `data-quality-round3-2026-10-03.md`)

| Proposal | Rows proposed | Decision | Round 3 result |
|---|---|---|---|
| Apply the `corpus_query` relevance proposal (function replacement, no rows) and the client scoring change | 0 | **REJECTED** (benchmark: `2885` 266 to 676 ms, `court` 3.0 to 5.0 s); routed to ui-integration as client-side honorific stripping, judge boost and targeted entity-dataset passes, no database change | not applied |
| Remove the unparseable parsed year (not in 1750-2026) from subtitle + "Year as parsed" fact of citation rows | 64 | approved | applied: 66 rows matched the stated rule at apply time |
| Remove the "Court as parsed" fact when the court id is not a CourtListener court (`vaccappomattox` 460, `supctdc` 10) | 470 | approved | applied: 470 |
| Distinguishing titles for `mdl_docket_documents` (description + entry) | 5,016 | approved (original docket label kept as `docket_label`) | applied: 5,016 |
| Docket number + court in `cl_master_entries` titles | 23,919 | approved | applied: 23,919 |
| `(court_id)` on ambiguous `cl_docket_metadata` titles | 30,453 | approved (shared-title rows only) | applied: 30,453 |
| Facet alternate-abbreviation mapping (`Fed. Reg.`/`FR`, `Fed. Appx.`/`F. App'x` ...) | 1,353 | approved (canonical form from reporters-db, originals in the before-images) | applied: 1,332 (21 not provable by reporters-db were skipped) |

Year proposal shape (not run): for `citation_index` rows whose `detail.facts` entry `Year as parsed from the text` is not a four-digit number in 1750-2026, drop that fact and remove the trailing ` · <year>` from `item.subtitle` / `detail.subtitle`; before-image into `cleanup_decisions`.

## 7. Rollback and verification

Each contract header carries the exact rollback. `verify-data-quality-round2-20261003-v1.sql` reconciles all of them (read-only): title fixes 275 / 275 identical on virtual revert (250 comma + 12 litigation + 13 markers; 6 comma rows were later also facet-normalized and are reverted with their facet before-image), facets 6,223 / 6,223, mdls 176 / 176, docket-link dates 662 / 662, option counts 0 mismatches, court map 5,411 = 5,411, orphan rows 0.

## 8. Security / performance advisories

No DDL, grant or policy was changed in round 2, so the round-1 advisor findings stand unchanged (see `docs/data-quality-pass-2026-10-03.md`). `corpus_query` is `STABLE` with `search_path` pinned; the proposal keeps both.
