# First frozen docket import — October 5, 2026

Run `216cd8bb-e850-4ca1-9a55-78251b79edcb` has imported the immutable 11:49 capture and projected its 2,200 selected docket entries. Final run closure and the 16 matter-summary updates remain pending at this checkpoint. This is a bounded source packet, not completion of the 16 dockets or acquisition of their PDFs.

## Exact import and preserved originals

The frozen input contains 2,200 entry observations and 2,952 nested document-metadata observations. Its SHA-256 is `678a9a2116665540cafa5f214ef84e9290ffff9057bd28042742e6031a0b34e0`; the plan hash is `8483eafa20b9f7313a19f1b46fe11a73049d31ae82075bc119501ec867c4d0c3`. The actual predecessor was completed before the new run opened. All 16 scopes are partial in this packet, regardless of later collector progress.

A guarded transaction preserved 4,798 full current-entity before-images in the private cleanup ledger before import. Another 354 native identities were absent. Eight acknowledged intake batches wrote 5,152 observations and 476 new source versions, with zero held rows. The importer did not download PDFs or finalize the run.

Sixteen independent read-only SQL checks then verified every expected native identity, payload, source URL, retrieval timestamp, complete provenance fingerprint, version schema, canonical source-data fingerprint and stored-data checksum. All 5,152 current entity/version relationships matched; all 4,798 before-images matched their earlier source versions. The global check verified exact frozen run scope, entry/document counts, no duplicate or unexpected observations, and the Open US Law hold. The initial global SELECT had a missing table alias and made no writes; its corrected v2 passed. Both are retained.

## Public entry projection

All 2,200 selected public entries passed full row readback with zero mismatches. The global catalog increased from 63,973 to **64,135** entries: **162 new** and **2,038 existing** rows updated. The other **61,935** rows were retained. No other docket scope was replaced or declared complete.

The 2,038 public before-images have SHA-256 `1de7fcaa358480f71a2189221eea14082ae275fbbcdb2c6be518980a78bbda84`. The projected-row fingerprint is `33d469b9d303f3b2fbaaade26e06225c629df2667b91b87fc81e94c41a19ca01`. A separate authenticated REST read confirmed catalog counts, readiness, this run's provenance, the verified projection metadata and the preserved hold. Entry presentation retains the existing restricted/sealed-content exclusions and 500-character description limit.

Live production verification found Roundup's docket tab showing 140 entries while its matter summary still reported the predecessor's 20. The 16 matter coverage summaries must therefore be reconciled against actual registered and public counts, with their previous records retained, before this run is closed.

Private evidence is under `private/audit-2026-10-05/continuation-1145/`: `live-guarded-open-v3-result.json`, the eight-line import receipt under `import-snapshot/`, `extras-summary.json`, `independent-projection-readback.json`, `before-images/`, and the 16 `postimport-validation-chunks-v3/live-docket-*.json` results plus `live-global-summary-v2.json`. Browser execution preserved exact SQL fingerprints. Original local, source and database timestamps remain distinct.

## Remaining work

The later four frozen plans still require actual predecessor checks, private imports, independent validation and bounded public projection. The latest 2,500 captured entries are not packaged. The collector's separate traversal has 25,035 IDs, with five original cursors partial and eleven exhausted; none of that proves published member or PDF coverage. Preserve all existing holds, native-relationship requirements, source-access restrictions and quota reserves.
