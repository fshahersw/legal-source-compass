# Owner-requested corpus removal

The owner stopped corpus development and requested removal of Open US Law, CPSC injury data, and files in all three audited storage-availability groups. The owner then explicitly directed preservation of working app dependencies. Matter PDFs are excluded from deletion.

## Scope and protection baseline

Only Supabase project `xosqzzsnhxcyehcnirpa`, private bucket `corpus-originals`, is in scope. The previous corpus continuation goal and automation remain paused.

- Named record collections: `open_us_law` (2,968,623 records) and `cpsc_injury_data` (479,534 records).
- Storage baseline: 274,105 objects / 144,770,591,610 bytes.
- Exact protected set: 220,223 objects / 113,595,529,636 bytes.
- Exact eligible set: 53,882 objects / 31,175,061,974 bytes.
- Protection includes all 153,995 registered matter PDFs (95,041,193,387 bytes), same-hash aliases, court/MDL PDFs, unresolved opaque PDFs, 5,482 current app-manifest keys, every ready download dependency, and active state-code/authority evidence.
- There are no missing protected dependencies in the baseline. The additional 322 unclassified PDFs are preserved conservatively.

These are unique-object measurements, not sums of overlapping route references. The file scope also covers separate held bulk-law files and a CPSC recalls CSV; it does not authorize deletion of their other database collections.

## Execution status

Superseded for the Open US Law records, derived rows and catalog entry by the completion note at the end of this file (October 6, 2026). Original status as of October 5, 2026: in progress. CPSC removal is complete: all 479,534 records and its catalog entry are independently verified absent. Its complete raw/gzip recovery export remains local. All 818,617 Open US Law outline segments, 196,458 nodes, 224 collection entries, and the dedicated `law_outline` context are independently verified absent. Three additional contexts belonging exclusively to the deleted collections were removed and verified absent; mixed coverage/federal contexts remain preserved.

The Open US Law record export is continuing through four concurrent readers over exact native-ID partitions. The guarded Storage job is running; object-removal completion is not yet claimed.

Private inventories, raw/gzip row backups, protected/eligible file manifests, and deletion intent/receipt journals are under `private/audit-2026-10-05/owner-removal-openus-cpsc/` and are excluded from Git. Storage inventory metadata is a before-image of object identities and versions; it is not a claim that every deleted binary has a local recovery copy.

Deletion tools require explicit execute flags and pinned manifest hashes, target only this project, stop on unknown write outcomes, and verify identities and absence. Storage bytes are deleted through the Storage API, never by deleting `storage.objects` rows in SQL. Row deletion releases database space for reuse; it does not itself guarantee a lower allocated database-disk size.

Final completion counts and post-deletion verification will replace this in-progress status after execution.

## Completion note: Open US Law records removed (October 6, 2026)

The Open US Law database removal ordered on October 5 is complete. Storage-object removal is **not** part of this note and is not claimed.

- **Recovery export (precondition):** private bucket `corpus-exports`, path `open-us-law-removal-2026-10-06/manifest.json`, manifest SHA-256 `bf672ee098f2ad56baa397e63a3119702b5a9e09e2a7ecfa2efc2b6f7d1111d7`. 307 JSON Lines gzip chunks, 5,697,420,039 bytes compressed (29,275,940,220 bytes of JSON): 2,968,623 `open_us_law` records, 17,808 derived `coverage_topics` rows and 445 derived context rows (2,986,876 rows in total). Every chunk was SHA-256 verified after upload and again in a full second pass (307 of 307). Per-partition counts equal the live exact counts. `search_vector` is not exported; it is recomputed on restore. The manifest lists every chunk with first/last id, byte counts and hashes, and the restore steps.
- **Gates:** the batch deletion refused to run until `open_us_law_export_verified` (evidence: the manifest hash, storage path and row count 2,968,623), `open_us_law_dependents_clear` and the link gates were released by the owner; it also refuses to delete more rows than the export holds.
- **Dependents repointed first (so nothing dangles):** 12,490 CFR section links and 703 CFR citation links repointed to official eCFR text; 2,361 U.S. Code citation links dropped (citation rows kept as "Citation only"); 144 limitation-period links (31 repointed to the matching primary-source rule review, 113 dropped); 2,649 `generic:extra` context links stripped and 98 `related:blocks` record ids set to null. The dependents re-check (`corpus_open_us_law_dependents_v1`) returned `ok` with 0 blocking references before any deletion, and again afterwards.
- **Execution (run `b2213925-5827-4fd8-ba3e-c62ea4ae89c4`, corpus-cleanup/1):** 444 derived contexts, 17,808 `coverage_topics` rows and 77 `large_text_assets` rows (ids `large-text:oul:<hash>`) removed through the ledger (one context was applied earlier by a probe; 445 contexts in total), then **2,968,623 `open_us_law` records deleted in 597 batches** (batch numbers 1 to 597, 1,000 to 5,000 rows each, every batch with a receipt in `corpus_ingest.cleanup_batches` and a running count in `corpus_ingest.cleanup_counts`; longest batch under 7 seconds), then the catalog entry. Final: `open_us_law` rows 0 (before 2,968,623), catalog entry removed, `imported_records` set to 0 before removal, counters of every remaining collection equal to their exact row counts.
- **Verification:** counter mismatches 0, applied plan rows without a ledger entry 0, orphaned docket links 0; dependents check `ok` with `blocking_total` 0.
- **Reversibility:** the derived rows and contexts are archived verbatim in `corpus_ingest.cleanup_decisions` (rollback `cleanup_rollback_v1`, phase `4_open_us_law`); the 2,968,623 records are recoverable only from the verified export above (restore as described in the manifest). The ledger holds the batch id ranges and per-batch id checksums.
- **Not done here:** the 77 `corpus_artifacts` rows (all not ready) and the Open US Law bulk files in storage are untouched; Storage removal remains the guarded, pinned-manifest procedure described above. The CPSC and outline removals recorded earlier stand.

