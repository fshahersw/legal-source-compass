# Third CourtListener metadata continuation — prepared checkpoint

This checkpoint is prepared offline, not imported or published by its preparer. It extends the retained entry collection without changing the published 15,053-source timeline artifact, the 14,947-entry projection receipt, or the v1 SQL contracts. No PDF bytes, PACER fetches or new party/attorney requests were made in this pass.

The private cache is `C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T112700Z`. Its new intake run is `ba13564a-e8f6-4c56-b4f0-c39aeded6fff`, scoped to Supabase project `xosqzzsnhxcyehcnirpa`. Existing database environment variables must not substitute another project.

## Original source and intake evidence

The rolling request ledger records 450 reservations. Exactly 449 unique response captures returned HTTP 200; the remaining reservation failed with a timeout for native docket `6102388`. Every capture's bytes, SHA-256, request URL, response provenance and native result payload were verified offline. Six explicitly source-unblocked docket scopes received new pages. Docket `14916674` was skipped because the publisher's native header was blocked. No 403/429 response or PDF retrieval occurred in this pass.

The original manifest remains unchanged, including its inherited `current_pass_reserved_requests=514` counter. New derived v3 receipts use the actual 450 reservations and cumulative distinct source-native IDs; inherited counters are not evidence of current-pass acquisition.

| Private type | Observations / distinct native IDs | Completed JSONL SHA-256 | Intake batches |
| --- | ---: | --- | ---: |
| `docket-entries` | 8,980 / 8,980 | `df69981a1985edccc7400351d5ad57e913244930774577e37ba8edc25ad163ff` | 25 |
| `recap-documents` | 10,824 / 10,824 | `3686319abd4c3cb49cf6e0b747f0789d13e82b89575f1a66706caa3852958f92` | 24 |

The documents are exact nested metadata observations with containing native entry and docket IDs; document URLs were not independently fetched. All source versions and actual field-array indexes remain private. The prepared 11 graph batches contain 41,452 explicit field-path relationships. Their sorted edge signature is `29f24c89850122724ce0dac6bf6d90a03fc648115fe7bea9bc6fb4298927a092`; they do not infer member-case, disposition or MDL role relationships.

`prepared-intake-receipt.json` indexes the source receipts, validation files, batch manifests and independent verification contract. After intake and graph execution, `private-verification.sql` must match `private-verification-expected.json`: every entity/provenance signature must agree, and native identity, storage hash, source-field relationship, inferred-edge and target-presence mismatch counts must be zero. Prepared files are not database receipts.

## Expanded public metadata and timelines

The retained three-pass collection contains 24,033 distinct native entry IDs: 14,453 in seven source-pagination-complete scopes and 9,580 in eight partial scopes. It remains a dated source-selected collection, not complete PACER coverage, current MDL membership or current case counts.

The v3 privacy policy permits 23,919 minimal entry metadata rows. It excludes 40 entries in a source-blocked docket and 74 entries containing an explicitly sealed document. Public document arrays/counts include only actual JSON boolean `is_sealed=false`; unknown or true flags are omitted. The 3,263 explicit-unsealed document associations are not a total-document or availability count. No descriptions, captions, party names, contacts or PDF locators enter this projection.

Prepared contracts live in `database/contracts/master-entries-2026-10-02-v3`. The dataset remains `cl_master_entries`. V3 registration deliberately holds readiness and permits transition only from the exact prior v1 version/count/source checksum, or the same held v3 checksum. Run bounded projection and independent full-field comparisons, then complete source, whole-row, ordinal and facet reconciliation before publication. Preserve the v1 contracts/receipt unchanged.

The v3 source signature is `3908b6e5b2a216e87acc3fde4f44127f6d5bfaa93c49e4cbc2f4733925f14ba9`. The prepared facets cover all 23,919 eligible entries and independently sum to 3,263 explicit-unsealed associations. Zero means no **source-explicit unsealed IDs** in the public projection; unknown seal flags must not be labeled as zero total documents.

The private artifact `courtlistener-entry-analysis-2026-10-02-v3.prepared.json` has SHA-256 `d5a54ae938d5f6e2ddfe5f223d6d015582133470c6e75644a570ea272d2b12ab`. Its 23,919 eligible filing dates are strictly valid civil dates, with zero missing, invalid or after-capture dates. Court mapping uses exact native resource IDs and the SHA-verified dated court reference export. It includes no excluded-row timeline dates or inferred legal outcomes, likelihoods, causation or choice of governing law.

`master-entry-projection-v3-plan.json` and `expanded-timeline-v3-plan.json` index the prepared contracts and route handoff. Promote the new artifact under a new public filename and update the analysis loader/types/tests only after `cl_master_entries` is ready with the v3 schema, matching source signature and 23,919 reconciled rows. Retain the old artifact. The route remains on the old verified snapshot until that publication succeeds. A fourth acquisition is separate and must not silently enter this frozen v3 checkpoint.
