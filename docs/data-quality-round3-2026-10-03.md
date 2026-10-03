# Data-quality round 3 (2026-10-03)

Run `c490cdf1-b32e-46ae-95c5-788cdeba3f33` (continuation of `af6ac9c6-...`), branch `claude/data-quality-20261003`, not pushed.
Every change below has a before-image in `corpus_ingest.cleanup_decisions` (issue prefix `dq20261003r3_`, 61,939 audit rows), a SQL contract with an exact rollback in
`database/contracts/` and a verification in `database/contracts/verify-data-quality-round3-20261003-v1.sql` (virtual revert: the current row with only the changed fields
swapped back to the before-image hashes to the stored original md5). Largest statement 30,453 rows (guard 50,000); 61,673 `corpus_records` rows touched in total (of which 3 inserted),
93 court-map rows, 4 dataset-metadata rows. No deletes, no publication / ready / held flag change, no `pdf_*`, `sw_*` or `corpus_ingest.entities/relationships` object touched, no VACUUM FULL.

## 0. Decisions from the round-2 review

| Item | Decision | What was done |
|---|---|---|
| `corpus_query` relevance (R1/R2) | REJECTED (benchmark: `2885` 266 ms to 676 ms, `court` 3.0 s to 5.0 s) | Nothing applied. `PROPOSED-corpus-query-relevance-20261003-v1.sql` is marked REJECTED; the client-side parts (honorific stripping, judge boost, entity-dataset passes) are with ui-integration. Section 5 gives the data they can now use for the judge boost. |
| 1 invalid parsed years / non-CourtListener courts | approved | applied |
| 2 `mdl_docket_documents` titles | approved | applied |
| 3 `cl_master_entries` titles | approved | applied |
| 4 `cl_docket_metadata` titles (shared-title rows only) | approved | applied |
| 5 facet alternate abbreviations | approved | applied |
| Round 3 A `mdls` to the JPML 2026-10-01 report | requested | applied (section 2) |
| Round 3 B court and judge accuracy | requested | applied where deterministic, rest reported (sections 3, 4) |

## 1. Approved round-2 items (all applied, all verified)

| # | Dataset | Rows | Before | After | Contract |
|---|---|---|---|---|---|
| 1 | `citation_index` invalid facts | 536 | 66 parsed years outside 1750..2026 (e.g. `163 U.S. 662` year 5204, `116 F. 350` year 1180-81) and 470 parsed courts that are not CourtListener courts (`vaccappomattox` 460, `supctdc` 10); the year also sat in the card subtitle | 0 and 0 (60,616 rows scanned); wrong fact removed, year removed from the subtitle, text updated | `citation-index-invalid-year-court-r3-20261003-v1.sql` |
| 2 | `mdl_docket_documents` titles | 5,016 | 17 distinct titles (the docket label, largest group 645) | `<description> · entry <n>`: 4,884 distinct titles (4,995 distinct docket+title pairs); original label kept as `docket_label` in item and detail | `mdl-docket-documents-titles-r3-20261003-v1.sql` |
| 3 | `cl_master_entries` titles | 23,919 | `Docket entry N`: 13,694 distinct titles, 15,301 rows in shared-title groups | `Docket entry N · <docket number> (<court id>)`: 23,346 distinct, 1,146 rows in shared groups (573 pairs: two CourtListener docket-entry records with the same docket number, court, entry number and filing date) | `cl-master-entries-titles-r3-20261003-v1.sql` |
| 4 | `cl_docket_metadata` titles | 30,453 (only the rows in shared-title groups) | 12,931 distinct titles for the 30,453 rows | `<title> (<court id>)`: 30,438 distinct; dataset-wide 28 rows in 13 groups still share a title (one court and docket number held under two or three CourtListener docket ids) | `cl-docket-metadata-titles-r3-20261003-v1.sql` |
| 5 | `citation_index` reporter facet | 1,332 | 30 alternate spellings of 24 reporters (reporters-db variations) in the facet; distinct reporter values 549 | canonical reporters-db form, 527 distinct values, option list rebuilt (60 options, 0 count mismatches); originals in the before-images; 21 of the 1,353 flagged rows skipped because reporters-db cannot prove the mapping | `citation-index-reporter-facet-alt-r3-20261003-v1.sql` |

Verification (V1 to V4): virtual revert identical 536/536, 5,016/5,016, 23,919/23,919, 30,453/30,453, 1,332/1,332.

## 2. Round 3 A: `mdls` refreshed to the JPML October 1, 2026 reports (additive)

Sources (already in the cache directory, hashes recorded in `metadata.refresh_2026_10_01.sources`): Pending MDL Dockets by actions pending 2026-10-01 (`jpmldoc-9e1e4117add7291d`),
by MDL number 2026-10-01 (`jpmldoc-6d4bcb1ba600e011`), FY2025 Terminated Litigations Report 2025-09-30 (`jpmldoc-77c8837fd3c44a47`).

| | 2026-09-01 (before) | 2026-10-01 (after) |
|---|---|---|
| rows | 176 (166 pending, 10 terminated) | 179 (162 pending, 17 terminated) |
| sum of total actions, pending MDLs | 716,121 | 717,525 |
| sum of actions pending | 206,182 | 204,977 |
| MDLs on the active list | 166 | 162 listed on 2026-10-01 |
| new MDLs created since 2026-09-01 | | 0 |

* 162 MDLs carry the October 1 counts at the top level (`total_actions`, `actions_pending`, `as_of`, `counts_label`); the September values are kept in `detail.snapshots`
  (and the report documents in `detail.reports`). Of the 166 existing rows: pending count changed on 74 (37 up, 37 down), total on 51, judge title on 4 (2913, 3047, 3062, 3166).
* 4 MDLs left the active list (2358, 2775, 2938, 3134): recorded as terminated (September values kept, no termination date invented; the active-list report does not give one).
* 3 closed MDLs added from the FY2025 Terminated Litigations Report (the dated official source that lists them): 2545 Testosterone Replacement Therapy (8,133 actions historically, terminated 2023),
  2606 Benicar (Olmesartan) (2,311, 2020), 2800 Equifax Customer Data Security Breach (485, 2022). Only the fields the report states are filled.
* `metadata.listing.{as_of,counts_label,qualification,results}`, `filter_index`, `source_id_aliases`, `expected_records` and the `refresh_2026_10_01` record are regenerated; `registry_summary`, `summary` and
  `manifest_sha256` describe the September build and are left as recorded. Facets (`court`, `circuit`, `litigation_type`, `judge_resolved`) are unchanged and exact (0 mismatches).
* Verified (V5): refresh chain virtual revert 166/166 (both passes), 3 inserted rows equal their replacement, `detail.summary == item` 179/179.

Follow-through caused by the refresh: the court directory quotes per-court MDL counts. Four courts were stale and all 51 court rows cited the 2026-09-01 report (section 3.4).

## 3. Round 3 B: court accuracy (`court_spine` + `corpus_workspace_court_map`)

The map is a byte-copy projection of the directory (title, state, facts: 0 differences on 5,411 rows), so every fix is made in the directory and re-synced to the map.
Comparison basis: the CourtListener courts snapshot we hold (`cl_courts`, 3,359 courts, source_as_of 2026-09-30) and courts-db 0.10.27 (2,504 of the 3,359 ids exist there). 2,052 map rows are
Kentucky/Texas county rows from another source (no CourtListener counterpart).

### 3.1 Applied (93 directory rows, 93 map rows)

| Defect | Before | After | Evidence |
|---|---|---|---|
| Misspelled court names | 10 courts + 27 dependents (child courts' parent-name facts, search links): Califonia, Pennylvania, Mongtomery, Illnois (x2), Coloardo, Wycoming, Onieda, Fransisco, Coporation | 0; the CourtListener spelling stays as fact "Name as recorded by CourtListener" (13 rows) | the same family spells it right (21 child courts "California Justice Court, <county>", sibling `circtdil`, `vacorpct`'s own short_name) and courts-db |
| Truncated names `texctyct70/71/72` ("... Criminal Court at Law No.") | 3 identical titles | "... No. 3", "No. 4", "No. 11" | the same row's own short_name carries the number; "City" (CourtListener's word for a Texas county court) is not rewritten |
| `superctguam` in-use flag | no | yes (fact "In-use flag source": snapshot 2026-09-30) | the only in-use flag out of 3,359 that differs between the 2026-06-30 and 2026-09-30 CourtListener snapshots |
| `ohctapp1` (Ohio Court of Appeals, First District) | no parent, system "Unknown", no state, `court_type` the literal string `[]` | parent `ohioctapp`, system State, state OH, court_type NULL (CourtListener type stays "Not recorded"); the facet counts follow (system `unknown` option removed, state OH 483 to 484) | 11 of 11 sibling districts have parent `ohioctapp`/state OH; its own child `ohctapp1hamilto` points to it; courts-db agrees; name prints "Ohio" |
| Per-court MDL counts | 4 courts stale (njd 13, mad 6, mdd 2, ded 2 pending); 51 rows cite the 2026-09-01 report | njd 12, mad 5, mdd 1, ded 1; "MDLs listed" fact added to njd, mad, mdd; 51 rows cite 2026-10-01; dataset qualification updated | derived from `mdls` (pending = status pending, listed = all rows with that `cl_court_id`); 0 mismatches afterwards |

Verification (V6): spine 93/93 at replacement and virtual revert identical, map 93/93, map vs directory 0 differences, map vs `cl_courts` in-use differences 1 to 0 (end_date 0 to 0),
dangling parents 0, facet option mismatches 0, search vectors current.

Side effect to know about: two of the corrected names are now exact duplicates of another CourtListener court, which shows that CourtListener lists those courts twice:
`pactcomplwycomi` = `pactcomplwyomin` (Pennsylvania Court of Common Pleas, Wyoming County) and `paorphctmongto` = `paorphctmontgo` (Pennsylvania Orphans' Court, Montgomery County).
Duplicate-title groups among CourtListener courts: 2 (5 rows) before, 3 (6 rows) after: massland/masslandct (older), the two new pairs; the `texctyct70-72` triple is resolved.

### 3.2 Checked and clean

Parent ids: 0 dangling, 0 cycles, 0 self-parents, every "Parent court" fact equals `parent_id` and the parent's title; no state conflict between child and parent. Dates: 0 malformed, 0 end before start,
0 after the snapshot. Map vs CourtListener snapshot: names, parents, jurisdictions, FJC and PACER ids, citation strings, start and end dates: 0 differences apart from 4 whitespace-only ones (trimmed in the map) and the in-use flag fixed above.
State where both exist: courts-db location equals the directory state on 2,042 of 2,042 courts.

### 3.3 Reported, not changed

* In-use vs dates: 28 courts have `in_use = yes` and an end date (e.g. `bta`, `cc`, `ccpa`, `kingsbench`). That is CourtListener's meaning ("the court has data in CourtListener"), and the page already says
  "not a statement that the court currently sits"; no change.
* CourtListener vs courts-db: end dates differ on 297 courts (206 only courts-db has an end date, 77 only CourtListener, 14 both with different values, e.g. `ald` 1824-03-10 vs 1824-03-09;
  courts-db's own range for `flaindcommn` ends before it starts); system differs on 28 (11 territories listed as `state` by courts-db, 3 `international`, ...); parent differs on 68 (65 are CourtListener
  pseudo-parents `usdistct` 57, `uscirct` 4, `ag` 3, `njcirct` 1 that courts-db does not have; 3 are parents only courts-db has: `ohctapp1` fixed above, `mdcirctctbalt` and `mdorphanctbalt` point to
  `mdcirctct`/`mdorphanct`, which are not CourtListener courts, so a link would dangle). 27 titles differ from courts-db by one word or punctuation: 2 were CourtListener typos (fixed above), 1 is a
  courts-db typo (`paadmct`, "Admirality"), 24 are plural/singular, apostrophe or article variants ("Court" vs "Courts", "Special Session" vs "Sessions"). Not deterministic, not changed.
* Empty State: 627 directory rows before, 626 after (`ohctapp1`). 277 print no state name (national, circuit, tribal bodies: correct), 3 print more than one, 346 print exactly one but are suppressed by
  design (the State column is labelled "State (only where explicit)": a printed state followed by County/City can be a county, e.g. "Washington County Court" in Florida, "Delaware Circuit Court" in Ohio).
  Courts-db `location` is not usable to fill them in general (it gives the seat of `ca9` as California).
  **Proposal, not applied (needs a decision):** fill 223 state-system rows where the printed state agrees with a second independent signal (courts-db location 63, CourtListener id prefix 160): 157 Texas
  county courts "Texas City Court, <X> City ..." plus their parent `texctyct` (CourtListener prints "City" for "County" throughout), 58 New York county courts plus `nycountyct` and `nycityct`, and 5 state-level
  courts (`colctyct`, `flactyct`, `ohctinsolv`, `ohiocountyct`, `orcc`); 6 homonym traps stay empty (`flactyct67`, `nyfamctdel`, `nyjustctportwa`, `ohcirctdelaware`, `reg-ST-vi_state`, `washterr`).
  Effect: those courts appear under the state filter and the court page highlights the state (`CourtContext` uses the map state, and an empty string defeats its fallback).
  Sizing script: `data-quality-tools/state_fill_proposal.py`.
* The 157 Texas rows (and `texctyct`) say "City" for what are Texas county courts at law ("Bexar City Court at Law No. 2"); a rewrite to "County" is a judgement on CourtListener's published name, left to you.
* Housekeeping: `court_spine.metadata.ready` is `false` while the dataset column `ready` is true (not changed, flag rule); `metadata.listing.total` and `expected_records` in the metadata still say 5,413
  (the two testing courts quarantined on 2026-10-02) while the table has 5,411 rows.

### 3.4 MDL counts in the directory and elsewhere

`mdl_case_inventory` (4,159 rows) quotes the September report on purpose ("Against the JPML report dated 2026-09-01 the sample is small: MDL 2789: 219 of 11404 actions pending ...").
That is a dated statement and stays true; the October numbers are in `mdls.detail.snapshots`. Not touched.

## 4. Round 3 B: judge accuracy (`judges`, `judge_entities`, `people`, `cl_people`, MDL transferee judges)

### 4.1 Measured (before)

| Link | Result |
|---|---|
| MDL printed judge name to a judge profile by the app's rule (exactly one profile with the same normalized name; `MdlJudges`) | 176 MDLs print a judge: **80 link**, **9 do not** (two profiles share the name), **87 have no exact-name profile** ("Michael A. Shipp" vs "Michael Andre Shipp": registry match kinds middle_initial 76, first_initial 7, middle_omitted 8, native bridge 8) |
| MDL to judge profile by the registry key `judge_entity_id` = `judges.item.entity_id` | 172 of 172 keyed MDLs match exactly one profile (0 ambiguous, 0 missing) |
| MDL to CourtListener person id (`cl_assigned_to_id`, the docket's assigned_to id) | 17 of 176 |
| Judge profile to its MDLs (`detail.mdls`, rendered as "MDL appearances") | total 0 on **10,698 of 10,698** profiles, although 145 judge entities preside over 172 MDLs |
| Judge profile to CourtListener person (native bridge FJC nid to jid == `cl_people.fjc_id`) | 3,701 profiles; all 3,701 exist in `cl_people` with the same jid, none is an alias, none repeats; 364 profiles have FJC ids but no CourtListener person with that jid (recent appointees), 9 withheld for review |
| `people` vs `cl_people` | same 16,191 persons keyed by the CourtListener person id (`people.id` = `cl_people` native id, 16,191 of 16,191); every judge profile with a CourtListener id has its `people` record |
| Shared normalized names | `judges`/`judge_entities`: 320 groups, 655 profiles (6.1%); `people`/`cl_people`: 149 groups, 305 records (1.9%) |
| Why the 9 MDL names are ambiguous | 76 of the 320 judge groups are one FJC-backed profile plus a name-only Trellis-directory stub (same name, same court); all 9 MDLs are such pairs (McCafferty, Bartle, Adelman, Calabrese, Noreika, Brimmer, Bates, Kollar-Kotelly, Gilstrap). 240 groups (495 profiles) have no FJC-backed profile (237 of them within one state: the same state judge listed more than once in the directory); 4 groups (8 profiles) have several FJC-backed profiles with different nids |

### 4.2 Applied (mdls 179 rows, judges 145 rows, mdls dataset metadata)

* `mdls` item and `detail.summary`: `judge_profile_id` (exact judges profile id; 172), `judge_cl_person_id` (143) and `judge_cl_person_basis`. Sources of the CourtListener id, in order: the judge profile's native
  bridge (140 profiles; 125 MDLs gained an id from it), the docket's assigned_to id (17 MDLs; 15 of them also have the bridge id and **agree 15 of 15**, 0 conflicts; 2 have no bridge id: MDLs 3060 Rowland and 3094 Marston),
  and the same judge entity's docket id (1: MDL 3163 shares Marston with 3094). `filters.cl_person_id` is set to it (it was empty on 159 rows). `cl_assigned_to_id` keeps its meaning.
* `mdls detail.judge_links[]`: `links = [#judge/<profile id>]`, so the existing table on the matter page links each judge (172 rows) with no new visible column.
* `judges detail.mdls` on the 145 profiles: as of 2026-10-01, `total`, `pending_total`, `results` (id, title, status, subtitle, court, counts, link `#mdl/<n>`) from the `mdls` directory; the generic page already
  renders this block as "MDL appearances". 23 judges preside over more than one MDL (max 3). Symmetry check: 172 of 172 MDLs appear in their judge's profile with the same title and status.

| Metric | Before | After |
|---|---|---|
| MDLs with an exact judge profile link available | 80 (name rule) | 172 (key) |
| MDLs with a CourtListener person id | 17 of 176 (9.7%) | 143 of 176 (81.3%); of the remaining 33, 29 are linked judges without a CourtListener person (28 whose FJC jid is not in CourtListener's people table, 1 withheld for review) and 4 are unresolved judges |
| Judge profiles that list their MDLs | 0 | 145 (172 appearances) |
| Docket id vs bridge id conflicts | | 0 |

### 4.3 Reported, not changed

* Unresolved judge (no entity): 2358 Wolson (D. Del., FJC judge sits in E.D. Pa.), 2695 Shelby (D.N.M., FJC judge sits in D. Utah), 2879 Bailey (D. Md., FJC judge sits in N.D. W.Va.), 3015 Singhal
  (printed "Raag Singhal", FJC "Anuraag Hari Singhal" at S.D. Fla.). The first three are judges sitting by designation (the registry correctly withholds a name-only link across courts); CourtListener's master dockets
  name the same persons as strings without a person link (`assigned_to` is null), so no native proof exists. 3 terminated additions (2545, 2606, 2800) print no judge.
* 29 MDLs whose judge is linked have no CourtListener person id (28 judges whose FJC jid is not in CourtListener's people table yet, 1 `withheld_for_review`): not invented.
* 76 FJC-backed-plus-stub groups (152 profiles) are the same person listed twice: no merge, but the app should prefer the profile with `structured.ids` (or use `mdls.item.judge_profile_id`).
* CourtListener docket for the master dockets: JPML writes `3:16-md-2738`, CourtListener `3:16-md-02738`. With the zero-padded number 142 of 176 MDL master dockets match a CourtListener docket entity
  (court id + docket number): 139 exactly one, 3 with two or three candidates, 34 none, against 18 `cl_docket_id` values today. Proposal for mdl-members: fill `cl_docket_id` for the 139 exact single matches.

## 5. For the other agents

* ui-integration: judge boost and judge links can use `mdls.item.judge_profile_id` / `judge_cl_person_id` / `filters.cl_person_id` (143 ids) instead of name matching; `MdlJudges` can link by `judge_profile_id`
  (9 + 87 MDLs gain a link). The round-2 note "176 ids in `mdls.filters.cl_person_id`" was wrong: it was 17 and is now 143.
* mdl-members: see `_work/contracts/data-quality-mdls-oct1-refresh-20261003.md` (what changed in `mdls`, what not to re-apply, the master-docket proposal).

## 6. Not applied / needs a decision

1. State fill for 223 suppressed state-court rows (section 3.3). 2. "City" to "County" for the 158 Texas rows. 3. `cl_docket_id` for exact master-docket matches (142 MDLs). 4. Merge or flag the 76 judge stub duplicates.
5. The corpus_query relevance change stays rejected.

## 7. Tools

`data-quality-tools/`: `compare_map_cl.py`, `courts_db_check.py`, `courts_integrity.py`, `name_typos.py`, `rare_tokens.py`, `analyze_state_gaps.py`, `state_fill_proposal.py` (court analysis over the exported JSONL),
`parse_jpml.py`, `build_mdls_refresh.py`, `build_mdls_contract.py` (JPML parsing and the generated refresh contract). The read-only exporter uses the project read key from a private file (not committed).
