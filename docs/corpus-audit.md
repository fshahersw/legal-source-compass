# Corpus audit — review ledger classification

Read-only classification and **plan-only** cleanup notes for `corpus_ingest.cleanup_decisions` and `court_documents` same-file groups. **No storage deletes.** Record removal batches below are **not executed** unless explicitly authorized.

**Project:** `xosqzzsnhxcyehcnirpa`  
**Last updated:** 2026-10-06 (UTC)  
**Total `review` ledger rows:** **16,712** (after **18** non-regression identical-file title applies on 2026-10-06; apply run `42eeb605-8023-49a5-b93c-207bda86477b`)

## Summary by disposition bucket

These three buckets partition all 16,730 rows. They describe **what each ledger row is for**, not an instruction to auto-apply cleanup.

| Bucket | Rows | Share | Meaning |
| --- | ---: | ---: | --- |
| **Must stay** | **16,672** | 99.7% | Reversible before-images, rejected data-quality edits, or explicit retain-until-reviewed decisions. Applying them would drop audit evidence or mutate live rows the coordinator already declined to change. |
| **Exact-duplicate context (held / partial apply)** | **28** | 0.2% | Title proposals for **byte-identical** court-document files; **18** non-regression titles applied (`label_override`); **10** regression rows remain `review`. **0** approved native-ID merge / `3_dedupe` survivors in `review`. |
| **Taxonomy / catalog noise** | **30** | 0.2% | `corpus_datasets` **counter-alignment** snapshots only (`imported_records` before/after). Not `corpus_records` bodies; not category-map or display-group drops. |

## By dataset

| Dataset | Review rows | Primary issues |
| --- | ---: | --- |
| `courtlistener` | 16,316 | `pre_import_before_image:*` (2 import plans) |
| `court_documents` | 226 | Data-quality title passes (r6/r7) |
| `saved_pages` | 140 | `dq20261003r6_saved_pages_titles` |
| `public.corpus_datasets` | 30 | `cleanup_20261006_counter` (+ 4 carry counters) |
| `sw_matter_regulatory_links_v1` | 12 | Regulatory-links pilot / restrict / flip before-images |
| `sw_matter_regulatory_links_v1_staged` | 4 | Staged dataset creation before-image |
| `agency_safety_openfda_device_enforcement` | 1 | `blank_native_title` |
| `agency_safety_openfda_crl` | 1 | `blank_native_title` |

## By dataset and issue (full breakdown)

| Dataset | Issue | Rows | Bucket |
| --- | --- | ---: | --- |
| `courtlistener` | `pre_import_before_image:487f0d04-d694-4ba3-a7bf-6e679040e4f7` | 11,518 | Must stay |
| `courtlistener` | `pre_import_before_image:216cd8bb-e850-4ca1-9a55-78251b79edcb` | 4,798 | Must stay |
| `saved_pages` | `dq20261003r6_saved_pages_titles` | 140 | Must stay |
| `court_documents` | `dq20261003r6_court_documents_titles` | 139 | Must stay |
| `court_documents` | `dq20261003r7_court_documents_titles_weak_first_page` | 59 | Must stay |
| `court_documents` | `dq20261003r7_court_documents_titles_identical_file` | 28 | Exact-duplicate context |
| `public.corpus_datasets` | `cleanup_20261006_counter` | 26 | Taxonomy / catalog noise |
| `sw_matter_regulatory_links_v1` | `dq20261003r6_regulatory_links_restrict` | 4 | Must stay |
| `sw_matter_regulatory_links_v1` | `dq20261003r5_regulatory_links_pilot` | 4 | Must stay |
| `sw_matter_regulatory_links_v1` | `dq20261003r6_regulatory_links_flip` | 4 | Must stay |
| `sw_matter_regulatory_links_v1_staged` | `dq20261003r6_regulatory_links_staged` | 4 | Must stay |
| `public.corpus_datasets` | `cleanup_20261006_carry_county_enrichment_20260928_counter` | 1 | Taxonomy / catalog noise |
| `public.corpus_datasets` | `cleanup_20261006_carry_gap_enrichment_20260927_counter` | 1 | Taxonomy / catalog noise |
| `public.corpus_datasets` | `cleanup_20261006_carry_cl_reporter_citations_counter` | 1 | Taxonomy / catalog noise |
| `public.corpus_datasets` | `cleanup_20261006_carry_pending_publication_counter` | 1 | Taxonomy / catalog noise |
| `agency_safety_openfda_device_enforcement` | `blank_native_title` | 1 | Must stay |
| `agency_safety_openfda_crl` | `blank_native_title` | 1 | Must stay |

## Bucket notes (read-only)

### Must stay (16,672)

- **16,316** CourtListener `pre_import_before_image` rows: full `corpus_ingest.entities` before-images for frozen delta/continuation imports; reversibility only; no public projection or hold release.
- **366** court-document and saved-page title reviews: coordinator **did not apply** the proposed title change; live `corpus_records` titles unchanged.
- **16** regulatory-links dataset before-images: pilot, restriction, flip, and staged-dataset creation audit trail.
- **2** OpenFDA rows: blank native title retained pending record-level review (not treated as garbage).

### Exact-duplicate context (28)

- `dq20261003r7_court_documents_titles_identical_file`: documents sharing a **byte-identical** file with a sibling row (typically `seeger`); title pass rejected after read-back. Not the same as an approved `corpus-cleanup/1` `3_dedupe` merge (none in `review`).

### Taxonomy / catalog noise (30)

- Counter-alignment ledger on `public.corpus_datasets` after cleanup or carry operations (including **26** rows at `imported_records = 0` after verified collection removals). Safe to treat as catalog metadata evidence, not as duplicate record bodies.

## Related gates

| Gate | Status |
| --- | --- |
| October 5 `storage-plan-v1` pin on agent VM | **Absent** — no Storage API deletes |
| `cleanup_decisions` `review` rows | **16,712** — held (incl. **10** identical-file title rows) |
| Title apply (18 rows) | **Executed** 2026-10-06 — see below |
| Record-removal blocker | **Accepted** — see below |
| Same-file `court_documents` dedupe plan | **Empty** — see below |

---

## Record-removal blocker (accepted, 2026-10-06)

No ledgered **`corpus_records` delete or merge** batch is named for execution while storage deletion stays paused and review rows stay held.

| Candidate | Live evidence | Named batch? |
| --- | --- | --- |
| **`corpus-cleanup/1` phase `3_dedupe`** (exact `filters.native_id` within one dataset) | **0** duplicate `(mdl, native_id)` groups in `sw_matters_v1`, `sw_matter_dockets_v1`, `sw_matter_parties_v1`, `cl_docket_metadata`, `sw_docket_entries_v1` | **No** — plan would insert **0** rows |
| **Phase `2` empty shells** | **203,356** already removed (`cleanup_20261006_delete_empty_record`); spot checks on large datasets show **0** shells; full-corpus recount not pinned | **No** — no new candidate list |
| **`delete_superseded_record`** | **0** rows | **No** |
| **Orphan docket links** | **0** | **No** |
| **`cleanup_removal_candidates` collections** | All **22** listed collections at **0** live rows (owner removals + merge sources already ledgered) | **Already done** |
| **`cleanup_plan` queue** | **`planned` = 0** | **Nothing queued** |
| **`court_documents` SHA-256 same-file groups** | **510** groups / **~713** extra rows (manifest hash in `detail.facts`) | **Not without new survivor/provenance contract** — overlaps held title review; see same-file plan section |
| **October 5 `corpus-originals` eligible inventory** | **53,882** objects; pin absent | **Out of scope** (storage) |

**Next step to unblock record removal (not done here):** either run a pinned offline empty-shell candidate scan (`2_useless_rows:shells` with explicit `candidates`), or author a **new** SHA-group contract that merges provenance (source URLs) onto a survivor before delete — not `corpus-cleanup/1` `3_dedupe` as deployed.

---

## Same-file `court_documents` dedupe plan (read-only; **0** rows in plan)

**Status:** Plan only. **Do not execute.** No `corpus_records` deletes, no storage API, no changes to `disposition = 'review'` rows (including the **10** skipped identical-file title rows).

### Inclusion rules

1. **Group key:** `SHA-256 (at manifest build time)` from `detail.facts` (same byte file).
2. **Exclude entire group** if **any** member `record_id` has `corpus_ingest.cleanup_decisions.disposition = 'review'` for `dataset = 'court_documents'` (**208** held title rows: r6/r7/identical-file, including the **10** skipped identical-file rows).
3. **Survivor pick (when proving):** highest `corpus_ingest.cleanup_score_v1`, then `ordinal`, then `id`.
4. **Include extra row only if proved safe:** for each non-survivor member, show the survivor already has every **artifact** and **citation route** the extra has:
   - **Artifact:** `corpus_artifacts` route `/supplement-files/court_documents/{record_id}` — extra must not point at a different `object_key` / `sha256` than survivor (**707 / 707** pairs pass this).
   - **Provenance route:** extra’s `source_url` must equal survivor’s `source_url` or appear in survivor’s `item.links` / `detail.links` (**0 / 707** pairs pass this).
5. If any extra in a group fails proof, **omit the whole group** from the plan.

### Scan results (2026-10-06)

| Metric | Count |
| --- | ---: |
| Same-file groups (all `court_documents`) | **510** |
| Extra rows (would-be deletes) | **713** |
| Groups with **no** held-`review` member | **506** |
| Extra rows in those groups | **707** |
| Groups with **all** members sharing one `source_url` | **0** |
| Groups with a survivor covering every member `source_url` | **0** |
| **Rows admitted to plan** | **0** |

### Why every group was omitted (representative examples)

Same bytes, different court-published URLs — survivor does not list the extra URL in links, so the extra carries a **unique provenance route** the survivor lacks.

| SHA-256 (prefix) | Survivor `record_id` | Extra `record_id` | Survivor `source_url` (truncated) | Extra-only `source_url` (truncated) |
| --- | --- | --- | --- | --- |
| `00bae0ee…` | `court-expansion-artifact:e06ca74dac4ca149858fb779` | `court-expansion-artifact:d66b0a2d73b2ff874acd5a79` | `…/form_4100r_0.pdf` | `…/form_b4100r_0.pdf` |
| `01c4cdd2…` | `court-expansion-artifact:3853b1d99b92ecff1349adef` | `court-expansion-artifact:194fc6c9b15a8f48b025a9db` | `…/LTS_StandingOrderReDefaultPO.pdf` | `…/LTS%20Standing%20Order%20re%20Default%20PO.pdf` |

**Artifact note:** For all **707** extra/survivor pairs checked, both sides have `corpus_artifacts` rows with the **same** content-addressed `object_key` (storage bytes are shared). Removal would still drop a **distinct** supplement route (`/supplement-files/court_documents/{id}`) and the **distinct** `source_url` unless a future contract merges those fields onto the survivor first.

### Planned removals

*None.* Re-run this section after held title review closes or after a provenance-merge rule is approved.

### URL-normalization-only extras (subset of the 707)

**Named count: URL-normalization-only extras — 42** (of **707** extra rows in review-clear same-file groups). All **665** other extras differ by a **non-equivalent path or host** under the rule below and stay **out of this slice**.

**Rule (classification):** survivor and extra `source_url` strings differ, but after normalization they refer to the **same court host and same resource path**:

- Host: lowercased, leading `www.` removed  
- Path: percent-decoded, duplicate slashes collapsed, trailing slash stripped, path segments lowercased  
- **Ignored for equivalence:** `http` vs `https`, query string, fragment  

**Applied 2026-10-07 (UTC):** all **42** extra `corpus_records` rows removed; **42** survivors kept. **No storage** deletes; **665** other same-file extras, **16,712** `review` rows, and the October 5 storage batch untouched.

| Field | Value |
| --- | --- |
| `run_id` | `8e60bbfb-c7eb-4e03-851b-ca8af2e1f426` |
| `issue` | `cleanup_20261007_court_documents_url_norm_extra` |
| Ledger `disposition` | `quarantine` (full row in `original_record`; `replacement.survivor_id` + `deleted: true`) |
| Rollback | `corpus_ingest.cleanup_restore_row_v1('public.corpus_records'::regclass, original_record)` per ledger row |
| Read-back | **0** of 42 extra ids still in `public.corpus_records`; **42** / **42** distinct survivors present; **42** ledger rows |

| # | Extra `record_id` | Survivor `record_id` | Survivor `source_url` | Extra `source_url` | Normalization note |
| ---: | --- | --- | --- | --- | --- |
| 1 | `state-court-artifact:1e7770f22bc1267140a2acc1` | `court-expansion-artifact:4f76d148ef4450ffbd0ff4d5` | `https://www.vacourts.gov/static/courts/gd/chesapeake/elecdevicepolicy.pdf` | `https://www.vacourts.gov/static/courts/gd/Chesapeake/elecdevicepolicy.pdf` | Same host + path; path segment casing only |
| 2 | `state-court-artifact:0a5e218591fb6efe1a314951` | `state-court-artifact:d1f3e9b5dfbef767fa51b386` | `https://www.pacourts.us/assets/opinions/Supreme/out/482EAL2025%20-%20106891933370489533.pdf` | `https://www.pacourts.us/assets/opinions/Supreme/out/482EAL2025%20-%20106891933370489533.pdf?cb=1` | Same host + path; cache-buster query on extra only |
| 3 | `state-court-artifact:2426e6db0fa2b15eab4b82b4` | `state-court-artifact:2691fd6bdc4246e4085e8b95` | `https://www.azcourts.gov/Portals/0/22/admorder/Orders23/2023-163.pdf?ver=` | `https://www.azcourts.gov/Portals/0/22/admorder/Orders23/2023-163.pdf?ver=FQ1QedMJvvhmex-zOe5YAA%3D%3D` | Same host + path; portal `ver` query token differs |

---

## Reversible apply plan — 28 byte-identical file title proposals only

**Status:** **18 of 28** non-regression rows **applied** 2026-10-06 (`applied_run_id` `42eeb605-8023-49a5-b93c-207bda86477b`); **10** regression rows remain `review`. Does **not** cover other `review` rows, storage deletes, or record dedupe/deletes.

### Scope

| Field | Value |
| --- | --- |
| Ledger issue | `dq20261003r7_court_documents_titles_identical_file` |
| Dataset | `court_documents` |
| Disposition (current) | `review` |
| Row count | **28** |
| Source run | `run_id = 58de47f5-03fd-4356-9c4c-1ff10997e359` |
| Mutation target | `public.corpus_records.title` only (no `item`/`detail`, no storage, no deletes) |

Each row’s `evidence.sha256` is the content hash of the shared file; `evidence.siblings` points at the byte-identical sibling (usually `seeger`). Applying titles does not merge or remove sibling rows.

### Preconditions (apply gate)

1. **Storage:** No `corpus-originals` or other storage API changes as part of this plan.
2. **Row filter:** Only the 28 `record_id` values in the table below; no other `cleanup_decisions` rows.
3. **Live title check:** For each row, `public.corpus_records.title` must equal **Title before (live, 2026-10-06)** in the table. If it differs, **skip that row** and record the actual title in the apply run evidence (do not blindly use ledger `original_record.title`, which still says `(title not yet extracted)` on many rows).
4. **Regression check:** Ten rows are flagged **⚠ regress** — live title is already a human-readable court title, while the proposed title is filename-like or link text. Default **skip** unless the owner explicitly wants the proposed string for that `record_id`.
5. **Ledger:** Capture a new apply `run_id` and, per row, store `title_before_apply` in apply evidence before updating.

### Apply procedure (when authorized)

For each row that passes preconditions:

```sql
-- Example single row (parameterize :record_id, :title_after)
UPDATE public.corpus_records r
SET title = :title_after
WHERE r.dataset = 'court_documents'
  AND r.id = :record_id
  AND r.title = :title_before_apply;  -- must match 1 row
```

After all successful updates for this issue:

```sql
-- Optional ledger closure (disposition naming per corpus_ingest convention)
UPDATE corpus_ingest.cleanup_decisions cd
SET disposition = 'applied',
    replacement = cd.replacement || jsonb_build_object(
      'title_before_apply', :title_before_apply,
      'title_after_applied', :title_after,
      'applied_at', now(),
      'applied_run_id', :apply_run_id
    ),
    reviewed_at = now()
WHERE cd.dataset = 'court_documents'
  AND cd.issue = 'dq20261003r7_court_documents_titles_identical_file'
  AND cd.record_id = :record_id
  AND cd.disposition = 'review';
```

Verify: `count(*)` of rows still in `review` for this issue should decrease only for applied `record_id`s; remaining **16,730 − n** review rows elsewhere unchanged.

### Rollback procedure

Rollback is **per row** or **full batch**, using the `title_before_apply` captured at apply time (not the proposed `title_after`).

```sql
UPDATE public.corpus_records r
SET title = cd.replacement->>'title_before_apply'
FROM corpus_ingest.cleanup_decisions cd
WHERE cd.dataset = 'court_documents'
  AND cd.issue = 'dq20261003r7_court_documents_titles_identical_file'
  AND cd.record_id = r.id
  AND r.dataset = 'court_documents'
  AND cd.disposition = 'applied'
  AND cd.replacement->>'applied_run_id' = :apply_run_id
  AND r.title = cd.replacement->>'title_after_applied';  -- guard: only if still at applied state
```

Restore ledger disposition:

```sql
UPDATE corpus_ingest.cleanup_decisions cd
SET disposition = 'review',
    replacement = cd.replacement - 'title_before_apply' - 'title_after_applied' - 'applied_at' - 'applied_run_id',
    reviewed_at = now()
WHERE cd.dataset = 'court_documents'
  AND cd.issue = 'dq20261003r7_court_documents_titles_identical_file'
  AND cd.disposition = 'applied'
  AND cd.replacement->>'applied_run_id' = :apply_run_id;
```

If a title was manually edited after apply, rollback guards will not match — restore from `replacement->>'title_before_apply'` only after confirming the current title equals `title_after_applied`.

### Per-row before / after / rollback

**Title before (live, 2026-10-06)** is what rollback restores. **Title after (proposed)** comes from ledger `replacement.title` (round-7 identical-file pass). **Ledger snapshot** is `original_record.title` at review time.

| # | `record_id` | SHA-256 (prefix) | Title before (live, 2026-10-06) | Title after (proposed) | Rollback title | Notes |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `court-expansion-artifact:01f6f83182843d9a16cdaaec` | `e1d184c6…` | Facilities-2 Access-Badge Request January 2024 Agencies.pdf (title not recorded) | Facilities-2 Access-Badge Request January 2024 Agencies | same as before | |
| 2 | `court-expansion-artifact:06574979beac9f0d5a24a581` | `63dc7c0d…` | Application-to-File-Certain-Docs-Conventionally.doc (title not recorded) | Application-to-File-Certain-Docs-Conventionally | same as before | |
| 3 | `court-expansion-artifact:132f29ba595faffbcb338c56` | `a4e7a524…` | Civ_MGM_May2026.pdf (title not recorded) | View Civil Procedures | same as before | ⚠ regress (link text proposal) |
| 4 | `court-expansion-artifact:171b59aba5d3b0f16336c235` | `840ab837…` | Rule26f-report-patent_cases.docx (title not recorded) | Rule26f-report-patent Cases | same as before | |
| 5 | `court-expansion-artifact:17e79e725755769997ac422e` | `d4c07993…` | MISC012MS.pdf (title not recorded) | MISC012MS Doc Order Staying Wage Garnishments and Directing Turnover of Property to Chapter 13 Trustee Combined with Notice of the Entry Thereof (Cruseturner) | same as before | |
| 6 | `court-expansion-artifact:1ce333eec4322d2f7dd86761` | `a931dafc…` | NOTICE: BEWARE OF JURY SERVICE SCAMS | Click Here for More Information | same as before | ⚠ regress |
| 7 | `court-expansion-artifact:26a8a0eea21203b6e986a350` | `9827156e…` | MISC018F.pdf (title not recorded) | MISC018F Doc Change of Employer Form for Chapter 13 Debtor | same as before | |
| 8 | `court-expansion-artifact:26ddcd6b75dda10ec4a63b33` | `c00c9354…` | MISC035.pdf (title not recorded) | MISC035 Doc Debtor/creditor Change of Address Form | same as before | |
| 9 | `court-expansion-artifact:5d708d7e35b9c37558b95568` | `bfb48a63…` | Civil_Procedures_2026.pdf (title not recorded) | View Civil Procedures | same as before | ⚠ regress |
| 10 | `court-expansion-artifact:60b35744ad0a9bbe88a73e30` | `a88ce46e…` | Student-Practice-Form.docx (title not recorded) | Student-Practice-Form | same as before | |
| 11 | `court-expansion-artifact:61e5f5dc2d2b38d9c3d376e1` | `e7dd207a…` | F_Rodriguez_Civil_Local_Rules.pdf (title not recorded) | View Civil Procedures | same as before | ⚠ regress |
| 12 | `court-expansion-artifact:6b1d87cc5b7a2d0b535c31a8` | `d71611d0…` | GENERAL ORDER NO. 479 | Adoption of Revised Civil Local Rules 2026 -Aug 4644 | same as before | ⚠ regress |
| 13 | `court-expansion-artifact:6dc78df3b1f8d2c803b64e1f` | `2d09aad7…` | Certificate_report_of_conference102720.doc (title not recorded) | Certificate Report of conference102720 | same as before | |
| 14 | `court-expansion-artifact:71c28f05499e0fcf4c62e146` | `a931dafc…` | NOTICE: BEWARE OF JURY SERVICE SCAMS | Click Here for More Information | same as before | ⚠ regress (same file as #6) |
| 15 | `court-expansion-artifact:7a3d9b7a56d1ae4deb57609e` | `34a6a4be…` | Application-to-File-Certain-Documents-Conventionally_Instructions.pdf (title not recorded) | Application-to-File-Certain-Documents-Conventionally Instructions | same as before | |
| 16 | `court-expansion-artifact:88585316d0a3a819c2bf4da9` | `70549fca…` | rules_governing_section_2254_and_2255_cases_in_the_u.s._district_courts_-_dec_1_2019.pdf (title not recorded) | Rules Governing Section 2254 and Section 2255 Proceedings 181.78 Kb | same as before | |
| 17 | `court-expansion-artifact:8a79d846297561421651fe65` | `ce9d0379…` | Conventional-Filing-Placeholder_Instructions.pdf (title not recorded) | Conventional-Filing-Placeholder Instructions | same as before | |
| 18 | `court-expansion-artifact:91b3905b61ac9ab523214969` | `6b1f5c80…` | Print Reset Form UNITED STATES BANKRUPTCY COURT NORTHERN DISTRICT OF CALIFORNIA | Certificate Report of conference102720 | same as before | ⚠ regress |
| 19 | `court-expansion-artifact:9f318b0bd546bd12e7ca4b3f` | `b1925fd1…` | RULE 26(f) REPORT AND PROPOSED SCHEDULING ORDER (Patent Cases) | Rule26f-report-patent Cases | same as before | ⚠ regress |
| 20 | `court-expansion-artifact:bac1ecc85d8c9546c5e635e6` | `541df677…` | Rule26f-report-non_patent.docx (title not recorded) | Rule26f-report-non Patent | same as before | |
| 21 | `court-expansion-artifact:d11961818906a437e900981a` | `f2227b0e…` | EARLY SETTLEMENT CONFERENCE PROJECT PRO SE LITGANT INFORMATION | ESCP-Pro-Se-Litigant-Information 0 | same as before | ⚠ regress |
| 22 | `court-expansion-artifact:df00d43cf45b1d8bc766446b` | `4c4c9964…` | Expungement Commitment Records Research Guide.pdf (title not recorded) | Expungement of Involuntary Commitment Court Records Expungement of Involuntary Commitment Court Records | same as before | |
| 23 | `court-expansion-artifact:eb2f152fb5bf049768599f70` | `409b8579…` | STUDENT PRACTICE CERTIFICATION AND NOTICE OF APPEARANCE OF STUDENT ATTORNEY | Student-Practice-Form - District of Minnesota | same as before | ⚠ regress |
| 24 | `court-expansion-artifact:ee69d42ac7b50e41c486606e` | `c17acaa3…` | AOB1320.pdf (title not recorded) | AOB1320 Doc Application for of Bankruptcy Records | same as before | |
| 25 | `court-expansion-artifact:f9b9be2b7e04abd15aa675a5` | `e78659c1…` | federal-rules-of-bankruptcy-procedure-dec-1-2024_0.pdf (title not recorded) | Federal Rules of Bankruptcy Procedure 592.26 Kb | same as before | |
| 26 | `court-expansion-artifact:fa8eb14c6c997bafece11a40` | `3ea2b7f0…` | SBRA ND Cal Form Plan Instructions 2 3 26.pdf (title not recorded) | Sbra Nd Cal Form Plan Instructions 2 3 26 | same as before | |
| 27 | `court-expansion-artifact:fe985e6d45aa1315ae2eacac` | `84ca9778…` | Pro-se_Motion_for_Compassionate_Release_0.docx (title not recorded) | Pro-se Motion for Compassionate Release 0 | same as before | |
| 28 | `state-court-artifact:dcf8a9f4a9736851c85a1303` | `ec528be1…` | form-appellate-9-1.docx (title not recorded) | 9-1. Notice of Appeal 9-1. Notice of Appeal | same as before | |

### Machine-readable rollback map (JSON)

Store alongside the apply `run_id` for scripted rollback:

```json
[
  {"record_id":"court-expansion-artifact:01f6f83182843d9a16cdaaec","title_before":"Facilities-2 Access-Badge Request January 2024 Agencies.pdf (title not recorded)","title_after":"Facilities-2 Access-Badge Request January 2024 Agencies"},
  {"record_id":"court-expansion-artifact:06574979beac9f0d5a24a581","title_before":"Application-to-File-Certain-Docs-Conventionally.doc (title not recorded)","title_after":"Application-to-File-Certain-Docs-Conventionally"},
  {"record_id":"court-expansion-artifact:132f29ba595faffbcb338c56","title_before":"Civ_MGM_May2026.pdf (title not recorded)","title_after":"View Civil Procedures"},
  {"record_id":"court-expansion-artifact:171b59aba5d3b0f16336c235","title_before":"Rule26f-report-patent_cases.docx (title not recorded)","title_after":"Rule26f-report-patent Cases"},
  {"record_id":"court-expansion-artifact:17e79e725755769997ac422e","title_before":"MISC012MS.pdf (title not recorded)","title_after":"MISC012MS Doc Order Staying Wage Garnishments and Directing Turnover of Property to Chapter 13 Trustee Combined with Notice of the Entry Thereof (Cruseturner)"},
  {"record_id":"court-expansion-artifact:1ce333eec4322d2f7dd86761","title_before":"NOTICE: BEWARE OF JURY SERVICE SCAMS","title_after":"Click Here for More Information"},
  {"record_id":"court-expansion-artifact:26a8a0eea21203b6e986a350","title_before":"MISC018F.pdf (title not recorded)","title_after":"MISC018F Doc Change of Employer Form for Chapter 13 Debtor"},
  {"record_id":"court-expansion-artifact:26ddcd6b75dda10ec4a63b33","title_before":"MISC035.pdf (title not recorded)","title_after":"MISC035 Doc Debtor/creditor Change of Address Form"},
  {"record_id":"court-expansion-artifact:5d708d7e35b9c37558b95568","title_before":"Civil_Procedures_2026.pdf (title not recorded)","title_after":"View Civil Procedures"},
  {"record_id":"court-expansion-artifact:60b35744ad0a9bbe88a73e30","title_before":"Student-Practice-Form.docx (title not recorded)","title_after":"Student-Practice-Form"},
  {"record_id":"court-expansion-artifact:61e5f5dc2d2b38d9c3d376e1","title_before":"F_Rodriguez_Civil_Local_Rules.pdf (title not recorded)","title_after":"View Civil Procedures"},
  {"record_id":"court-expansion-artifact:6b1d87cc5b7a2d0b535c31a8","title_before":"GENERAL ORDER NO. 479","title_after":"Adoption of Revised Civil Local Rules 2026 -Aug 4644"},
  {"record_id":"court-expansion-artifact:6dc78df3b1f8d2c803b64e1f","title_before":"Certificate_report_of_conference102720.doc (title not recorded)","title_after":"Certificate Report of conference102720"},
  {"record_id":"court-expansion-artifact:71c28f05499e0fcf4c62e146","title_before":"NOTICE: BEWARE OF JURY SERVICE SCAMS","title_after":"Click Here for More Information"},
  {"record_id":"court-expansion-artifact:7a3d9b7a56d1ae4deb57609e","title_before":"Application-to-File-Certain-Documents-Conventionally_Instructions.pdf (title not recorded)","title_after":"Application-to-File-Certain-Documents-Conventionally Instructions"},
  {"record_id":"court-expansion-artifact:88585316d0a3a819c2bf4da9","title_before":"rules_governing_section_2254_and_2255_cases_in_the_u.s._district_courts_-_dec_1_2019.pdf (title not recorded)","title_after":"Rules Governing Section 2254 and Section 2255 Proceedings 181.78 Kb"},
  {"record_id":"court-expansion-artifact:8a79d846297561421651fe65","title_before":"Conventional-Filing-Placeholder_Instructions.pdf (title not recorded)","title_after":"Conventional-Filing-Placeholder Instructions"},
  {"record_id":"court-expansion-artifact:91b3905b61ac9ab523214969","title_before":"Print Reset Form UNITED STATES BANKRUPTCY COURT NORTHERN DISTRICT OF CALIFORNIA","title_after":"Certificate Report of conference102720"},
  {"record_id":"court-expansion-artifact:9f318b0bd546bd12e7ca4b3f","title_before":"RULE 26(f) REPORT AND PROPOSED SCHEDULING ORDER (Patent Cases)","title_after":"Rule26f-report-patent Cases"},
  {"record_id":"court-expansion-artifact:bac1ecc85d8c9546c5e635e6","title_before":"Rule26f-report-non_patent.docx (title not recorded)","title_after":"Rule26f-report-non Patent"},
  {"record_id":"court-expansion-artifact:d11961818906a437e900981a","title_before":"EARLY SETTLEMENT CONFERENCE PROJECT PRO SE LITGANT INFORMATION","title_after":"ESCP-Pro-Se-Litigant-Information 0"},
  {"record_id":"court-expansion-artifact:df00d43cf45b1d8bc766446b","title_before":"Expungement Commitment Records Research Guide.pdf (title not recorded)","title_after":"Expungement of Involuntary Commitment Court Records Expungement of Involuntary Commitment Court Records"},
  {"record_id":"court-expansion-artifact:eb2f152fb5bf049768599f70","title_before":"STUDENT PRACTICE CERTIFICATION AND NOTICE OF APPEARANCE OF STUDENT ATTORNEY","title_after":"Student-Practice-Form - District of Minnesota"},
  {"record_id":"court-expansion-artifact:ee69d42ac7b50e41c486606e","title_before":"AOB1320.pdf (title not recorded)","title_after":"AOB1320 Doc Application for of Bankruptcy Records"},
  {"record_id":"court-expansion-artifact:f9b9be2b7e04abd15aa675a5","title_before":"federal-rules-of-bankruptcy-procedure-dec-1-2024_0.pdf (title not recorded)","title_after":"Federal Rules of Bankruptcy Procedure 592.26 Kb"},
  {"record_id":"court-expansion-artifact:fa8eb14c6c997bafece11a40","title_before":"SBRA ND Cal Form Plan Instructions 2 3 26.pdf (title not recorded)","title_after":"Sbra Nd Cal Form Plan Instructions 2 3 26"},
  {"record_id":"court-expansion-artifact:fe985e6d45aa1315ae2eacac","title_before":"Pro-se_Motion_for_Compassionate_Release_0.docx (title not recorded)","title_after":"Pro-se Motion for Compassionate Release 0"},
  {"record_id":"state-court-artifact:dcf8a9f4a9736851c85a1303","title_before":"form-appellate-9-1.docx (title not recorded)","title_after":"9-1. Notice of Appeal 9-1. Notice of Appeal"}
]
```

### Suggested apply subset (non-regression only)

If the owner wants **filename cleanup only** and to keep improved live titles, apply **18** rows (exclude all **⚠ regress** rows: #3, #6, #9, #11, #12, #14, #18, #19, #21, #23). That subset still requires the live-title precondition on each row.

---

*Sections above are plan-only except the documented 18-title apply. No record deletes or storage operations.*
