# Data-quality round 4 (2026-10-03)

Run `c41d48ea-d3fb-4362-bda3-a959b127a4cb` (continuation of `c490cdf1-...`), branch `claude/data-quality-20261003`, not pushed.
Every change below has a before-image in `corpus_ingest.cleanup_decisions` (issue prefix `dq20261003r4_`, 812 audit rows), a SQL contract with an exact rollback in `database/contracts/` and a verification
in `database/contracts/verify-data-quality-round4-20261003-v1.sql` (virtual revert: the current row with only the changed fields swapped back to the before-image hashes to the stored original md5).
Largest statement 223 rows (guard 50,000). Touched: 463 `corpus_records` rows (223 court_spine, 131 mdls, 72 judges, 21 mdl_appearances, 16 counsel_directory), 223 court-map rows, 73 `corpus_research_names` rows,
45 `corpus_datasets` metadata rows (53 audit rows). No deletes, no publication / ready / held column changed, no `pdf_*`, `sw_*`, matter-registry object or `corpus_ingest.entities/relationships` touched, no VACUUM FULL.

## 0. Decisions from the round-3 review

| Item | Decision | What was done |
|---|---|---|
| 1 State for the suppressed state-court rows | approved (223 rows where both signals agree, 6 homonym traps excluded) | applied: 223 spine rows + 223 map rows, State facet recounted (section 1) |
| 2 "City" to "County" in Texas court names | declined; keep CourtListener's published names; an official source that differs becomes an "Also known as" fact with its URL | nothing renamed; no official-source evidence was gathered, so no "Also known as" fact was added (the 158 rows are still listed in the round-3 doc, section 3.3) |
| 3 `mdls.cl_docket_id` | approved with coordination (registry id where resolved, never ambiguous) | applied: 131 ids (section 2); registry file `_work/contracts/registry-master-ids.md` read first |
| 4 76 judge stub profiles | flag only, no merge | applied: 72 flagged, 4 not (section 3) |
| metadata inconsistencies (court_spine ready, listing total) | fix if derived | applied (section 5) |
| Round 4 A Seeger Weiss counsel/firm accuracy | requested | inventory, coverage, 2 defect classes fixed in scope, systemic findings proposed (section 4) |
| Round 4 B metrics | requested | surveyed all ready datasets, 3 classes fixed (section 5) |

## 1. State fill (decision 1)

| | Before | After |
|---|---|---|
| state-system directory rows without a State | 385 | 162 |
| rows filled | | 223 (158 Texas county courts incl. `texctyct`, 60 New York incl. `nycountyct` and `nycityct`, 5 state-level courts: `colctyct`, `flactyct`, `ohctinsolv`, `ohiocountyct`, `orcc`) |
| signal 2 | | courts-db 0.10.27 location agrees: 63; CourtListener id prefix shared by at least 5 courts that all have this State: 160 |

Per row: `court_spine.state`, `item.cells.state`, `filters.state`, a "State" fact after "System" (text and detail), the same in `corpus_workspace_court_map` (byte copy), the State facet counts. Names unchanged.
Not filled: the 6 homonym traps (`flactyct67`, `nyfamctdel`, `nyjustctportwa`, `ohcirctdelaware`, `reg-ST-vi_state`, `washterr`) and the rows with fewer than two agreeing signals. Verification V2: 223/223 virtual revert identical for spine and map, map = spine for all 5,411, State facet options 0 off.
Contract `court-spine-state-fill-r4-20261003-v1.sql`.

## 2. `mdls.cl_docket_id` (decision 3)

Rule: zero-pad the last number of the printed master docket to 5 digits (`4:22-md-3047` to `4:22-md-03047`) and look up court id + number in the CourtListener docket headers saved in `corpus_ingest.entities` (187,900 dockets).
Registry (`registry-master-ids.md`, owner mdl-members): fill only when exactly one id is listed and it is not blocked.

| | MDLs |
|---|---|
| had an id (September connector search) | 18 |
| without an id | 161 (158 print a master docket and a CourtListener court) |
| exactly one saved header | 132 |
| two or more headers (left empty) | 4: 2804 (three), 3143 (three), 3014 (two), 3010 (two) |
| no header saved (left empty) | 22 |
| filled | 131 (109 header only, 21 header + registry agree, 1 registry only: 2606, which prints no master docket) |
| excluded although the header matches exactly | 2885 (14916674) and 2921 (16684846): blocked at source in the registry |
| other empty by the registry contract | 2545 (ambiguous: 4261857, 18704765), 3014 (conflict), 2800 (blocked, no master docket printed); 2738 keeps its September id (6245245, blocked) |

After: 149 of 179 MDLs carry `item.cl_docket_id` (plus `cl_docket_id_basis`, hidden from the page). All 31 registry rows (exact, not blocked) have the registry's id, 0 disagreements. The judge cross-check (docket assigned_to against the MDL's CourtListener
person id) agreed 21 of 21 where both exist. `detail.summary` still equals `item` (179/179); `listing.results` and `filter_index` copies regenerated (179/179 equal live). Contract `mdls-cl-docket-id-fill-r4-20261003-v1.sql`.
One option for the coordinator: 3014's registry resolved one exact id (60866823) with the firm-crosswalk id excluded; it stays empty because decision 3 names it as an ambiguous case.

## 3. Directory-stub flags (decision 4)

72 of the 76 stub/FJC pairs are flagged (`profile_role = directory_stub`, `primary_profile_id`, a link to `#judge/<primary id>`); nothing merged or removed. Rule: exact normalized name AND at least one identical court string.
Not flagged: Edward L. Artau (stub court is a Florida state court of appeal), James Rodney Gilstrap and John Gayle (stub records no court), David Alan Ezra (Hawai'i vs Hawaii). `corpus_research_names.summary` (a copy of the item) was stale for exactly these 72 rows and is synced.
Intended UI use: in `makeJudgeMatcher` drop a `directory_stub` whose `primary_profile_id` exists before counting candidates for a name. Contract `judges-directory-stub-flags-r4-20261003-v1.sql`; verification V1 72/72.

## 4. Round 4 A: Seeger Weiss counsel and firm accuracy

Scope: the exact variants `Seeger Weiss LLP` (492 printed), `SEEGER WEISS LLP` (121), `Seeger Weiss Llp` (65), `Seeger Weiss LLP (Newark)` (20), `Seeger Weiss, LLP` (10), `Seeger Weiss` (2), `Seeger Weiss LLC` (1).
Names stay as published (5 spellings of the lead partner, `Jeffrey S. Grand` and `Jeffrey Scott Grand`, ...); nothing is merged by name.

### 4.1 Inventory
`counsel_directory`: 1 firm record (`firm:3f24b0b7635a81a8`, 77 saved dockets, 126 attorneys, 13 MDLs), 126 attorney records (55 CourtListener ids, 71 AWS release ids) and 1 Philadelphia liaison record (J&J talc co-liaison in a Philadelphia state-court program, so it carries no MDL link);
`mdl_appearances` 478 rows (38 matters, 7 printed variants); `mdl_counsel` 6 rows (3 firm variants, 3 attorney rows); `corpus_research_names` 1 firm row (+ 57 attorney labels containing "Seeger", most are the lead partner's records); 12 `mdls` pages name the firm.

### 4.2 Coverage by MDL
Seeger tracks 24 MDLs (`sw_matters_v1`). Counsel records exist for 6 of them: 2738 (3 firm appearances, 3 `mdl_counsel` rows, no attorney record), 2846 (18 attorney records, 66 appearances, 32 AWS rows), 2873 (4, 239, 119), 3060 (2, 5, 1), 3081 (8, 18, 9), 3094 (6, 6, 3).
None for 18: 2741, 2804, 3014, 3026, 3043, 3047, 3080, 3108, 3113, 3114, 3125, 3140, 3144, 3149, 3163, 3166, 3180, 3185 (the AWS release tracked 12 firms across 62 matters; the Tier-1 registry tables are the way to fill these).
Seven MDLs outside the tracked list are present: 2151, 2570, 2592, 2672, 2789, 2885, 2973. In `mdl_appearances` 217 of the 478 firm rows are not linked to an MDL; 195 of them are the master docket 1:14-cv-01748 (N.D. Ill.) of MDL 2545
(Testosterone Replacement Therapy). The registry lists two CourtListener dockets for that number (ambiguous), so no link was added; once mdl-members resolves it the 195 rows (and the same pattern for other firms) can be linked.

### 4.3 Defects fixed (Seeger Weiss scope)
1. **Role labels shifted by the source build.** CourtListener's role codes are 1 attorney to be noticed, 2 lead attorney, 4 PRO HAC VICE, 6 TERMINATED, 8 INACTIVE, 10 unknown (`cl/people_db/models.py`). The build printed code 4 as "terminated", 6 as "inactive", 8 as "unknown" and left 10 as "10".
   Evidence: in a live CourtListener parties result role 6 carries a termination date in 103 of 103 attachments, role 4 in 0 of 134; the same build normalises its numeric strings "4" and "6" correctly; a join of 834 attorneys between the saved party attachments and `counsel_directory` is one-to-one
   (`{1,4}` with `[attorney_to_be_noticed, terminated]` 51x, `{6}` with `[inactive]` 18x, `{4,6}` with `[inactive, terminated]` 4x). Seeger Weiss attorneys are pro hac vice in the Cook IVC, Xarelto, Bard hernia mesh and Bard port dockets, not terminated.
   Applied: 12 attorney records, the firm roll-up, 19 appearances now say Pro hac vice (raw value kept, a "Role label correction" fact explains it). Role facet: counsel_directory Terminated 295 to 282, Pro hac vice 6 to 19; mdl_appearances Terminated 20 to 1 (the dated text `TERMINATED: 06/29/2010`), Pro hac vice 43 to 62.
2. **Docket attribution.** The firm record showed a defendant side ("mixed", "defendant" in the Side facet). Cause: CourtListener attorney 979464 (Christopher A. Seeger) is attached to docket 4264193 (3:10-cv-20375, S.D. Ill.), but `counsel_directory` and two `mdl_appearances` rows
   (both "defendant") place him on docket 4264289 (3:12-cv-20047), where CourtListener lists a Seeger Weiss attorney only on the plaintiff side (1310563). The source build read each party's attorney list without the attachment's `docket_id`, and the Bayer parties sit on more than 80 dockets.
   All 55 Seeger Weiss CourtListener ids were checked against CourtListener: 53 match their saved docket, 2 do not (979464; 651829 saved on 4580886, CourtListener 4518139). Nothing is re-pointed (that needs the rebuild below); a visible "Docket attribution check" fact was added to 5 records (3 + 2), no value changed.
3. **Firm record headings.** "Attorneys (100, ...)" and "Dockets (40 saved)" counted the listed rows, not the totals; now "100 shown of 126" and "40 shown of 77 saved". 11 other firm records are truncated the same way (3 attorney lists, 10 docket lists, 12 firms).
4. **Derived data.** `corpus_research_names.summary` synced for the firm row; the Role facet counts of both datasets recomputed (0 options off).

### 4.4 Systemic findings, not applied (decision needed)
* **Role shift in the rest of `counsel_directory`:** 213 attorney records (raw "terminated" outside Seeger Weiss) should read Pro hac vice and 261 ("inactive") Terminated; 23 records have both, 451 pass all guards; 5 records "unknown" (probably code 8, Inactive) and 1 `mdl_appearances` row need a per-row check first.
  126 of 165 firm roll-ups satisfy the roll-up invariant and would change; 39 do not and need a source check. A caveat sentence now sits in the dataset's "About this data". Ready to run: `PROPOSED-counsel-role-labels-all-firms-20261003-v1.sql` (dry-run counts only, statements not executed).
* **Docket attribution in the rest of `counsel_directory`:** 1,890 of 2,170 CourtListener-id attorney records hang on three dockets (4264289: 820, 4125863: 804, 4580886: 266, all shared-party mega dockets); only 19 of the 2,170 (attorney, docket) pairs are supported by the saved party attachments,
  815 attorneys are known there on other dockets and 1,336 are not in the saved set (spot checks against CourtListener: `cl:1001972` saved 4264289, CourtListener 4294847; `cl:1007276` saved 4264289, CourtListener 4502076). The fix is a rebuild of the attorney-docket links from `attorneys.parties_represented`
  filtered by docket id (about 2,150 records, their firm roll-ups and the per-MDL blocks of `mdls`); it needs the source build, not a label change, so it is proposed, not applied.
* The "Appearances" counts per MDL in `counsel_directory` (e.g. 2873: 239) are higher than the AWS rows (119) because three sources are summed; reported, not changed.

## 5. Round 4 B: metrics

Surveyed for all ready datasets (82 at survey time, 84 now; the extra ones are mdl-members'):
* `imported_records` = `expected_records` = live rows: all equal. The five chunked `corpus_context` dataset-meta rows (counties 3,144, county_litigation 3,311, judges 10,698, people 16,191, sources 5,700) re-assembled: `expected_records` equal; `agency:datasets` 12 of 12 equal.
* Listing totals: equal for 81 of 82. The four multi-mode datasets show the default mode in `listing.total` and every mode total equals its live count; the modes add up to the dataset size. `court_statistics` lists 92 of 374 on purpose. Only `court_spine` was off.
* Facet option counts: equal for every ready dataset under 100,000 rows (the five larger ones were not re-counted, no change since the earlier facet review).

Applied: `metadata.ready` aligned to the published column for the 44 ready datasets that said false (the column is untouched); `court_spine` `listing.total`, `listing_modes.default.total` and `metadata.expected_records` 5413 to 5411 (`exported_records` 5413 and `summary.*` stay as the export receipt;
the two quarantined rows are explained by `quarantined_records` / `source_records_before_quarantine`); "About this data" corrected for `court_documents` ("Index of 50940" to "Index of 20,861 of the 50,940 downloaded court documents ... 30,079 uncategorized rows are not published"),
`mdl_docket_activity` ("36 of 176" to "36 of the 176 JPML-registry MDLs of the 2026-09-01 report (the MDL directory lists 179)"), `mdls` (131 added ids described) and `counsel_directory` (role caveat).
Verified correct, not changed: `mdl_appearances` (878, 62 matters, 12 firms, 192 / 3 MDLs, 607 / 14 MDLs), `mdl_case_inventory` 4159, `mdl_docket_activity` 26,549, `court_statistics` 92 files.
Left alone: `metadata.summary.*` and `export_jsonl_sha256` (receipts of the export they hash, e.g. `mdls` summary.records 176). Advisory: the `settlements` text says 848 aggregator references, the live rows naming the aggregator are 861 (+ 8 phrase-search rows = 869).
Contract `metrics-alignment-r4-20261003-v1.sql`; verification V5: 0 mismatches in every check.

## 6. For the other agents

* mdl-members: 131 `mdls.cl_docket_id` filled from your registry file and the saved headers (31 registry rows all agree); 3014 left empty (your call), 2545 ambiguous, blocked ones empty. For MDL 2545 two CourtListener dockets share court and number; the 195 Seeger Weiss `mdl_appearances` rows on 1:14-cv-01748 are not MDL-linked.
* ui-integration: `judges` stubs carry `profile_role = directory_stub` + `primary_profile_id` (drop them from the exact-name count when the primary is in the list); `mdls.item.cl_docket_id` is available for 149 MDLs; Role facet values changed for Seeger Weiss only (Pro hac vice).

## 7. Tools

`data-quality-tools/` gains `state_fill_values.py`, `build_state_fill_contract.py` (State fill values and contract), `cl_parties_for_attorney.py`, `cl_parties_attorney_any_docket.py`, `cl_docket_attorneys.py`, `cl_role_code_evidence.py` (read a saved CourtListener
`parties` result: attorney attachments, role codes with and without termination dates). The CourtListener calls themselves went through the CourtListener MCP connector (no key in the repository).
