# First frozen docket import — October 5, 2026

Run `216cd8bb-e850-4ca1-9a55-78251b79edcb` has imported the immutable 11:49 capture and projected its 2,200 selected docket entries. The run is now completed after all 16 matter summaries were corrected and independently reconciled. This is a bounded source packet, not completion of the 16 dockets or acquisition of their PDFs.

## Exact import and preserved originals

The frozen input contains 2,200 entry observations and 2,952 nested document-metadata observations. Its SHA-256 is `678a9a2116665540cafa5f214ef84e9290ffff9057bd28042742e6031a0b34e0`; the plan hash is `8483eafa20b9f7313a19f1b46fe11a73049d31ae82075bc119501ec867c4d0c3`. The actual predecessor was completed before the new run opened. All 16 scopes are partial in this packet, regardless of later collector progress.

A guarded transaction preserved 4,798 full current-entity before-images in the private cleanup ledger before import. Another 354 native identities were absent. Eight acknowledged intake batches wrote 5,152 observations and 476 new source versions, with zero held rows. The importer did not download PDFs or finalize the run.

Sixteen independent read-only SQL checks then verified every expected native identity, payload, source URL, retrieval timestamp, complete provenance fingerprint, version schema, canonical source-data fingerprint and stored-data checksum. All 5,152 current entity/version relationships matched; all 4,798 before-images matched their earlier source versions. The global check verified exact frozen run scope, entry/document counts, no duplicate or unexpected observations, and the Open US Law hold. The initial global SELECT had a missing table alias and made no writes; its corrected v2 passed. Both are retained.

## Public entry projection

All 2,200 selected public entries passed full row readback with zero mismatches. The global catalog increased from 63,973 to **64,135** entries: **162 new** and **2,038 existing** rows updated. The other **61,935** rows were retained. No other docket scope was replaced or declared complete.

The 2,038 public before-images have SHA-256 `1de7fcaa358480f71a2189221eea14082ae275fbbcdb2c6be518980a78bbda84`. The projected-row fingerprint is `33d469b9d303f3b2fbaaade26e06225c629df2667b91b87fc81e94c41a19ca01`. A separate authenticated REST read confirmed catalog counts, readiness, this run's provenance, the verified projection metadata and the preserved hold. Entry presentation retains the existing restricted/sealed-content exclusions and 500-character description limit.

Live production verification found Roundup's docket tab showing 140 entries while its matter summary still reported the predecessor's 20. The committed correction now makes both show 140. All 16 matter summaries use actual registered/public counts, preserve their previous records, separate the 2,200 frozen observations from older holdings, retain the exact per-docket capture times and keep provider totals unknown. Bard Port Catheter now shows 16,807 registered/public entries rather than 16,765. No membership, header, access or PDF availability fields were changed.

Private evidence is under `private/audit-2026-10-05/continuation-1145/`: `live-guarded-open-v3-result.json`, the eight-line import receipt under `import-snapshot/`, `extras-summary.json`, `independent-projection-readback.json`, `before-images/`, and the 16 `postimport-validation-chunks-v3/live-docket-*.json` results plus `live-global-summary-v2.json`. Browser execution preserved exact SQL fingerprints. Original local, source and database timestamps remain distinct.

The pre-update live count audit bound these exact master identities; each public count equaled its nonquarantined registered entry count. Older observations contribute to these totals, while this frozen pass alone contains 2,200 entries.

| MDL | Registered/public entries | Entries in this frozen pass |
| ---: | ---: | ---: |
| 2741 | 140 | 140 |
| 2789 | 1,264 | 140 |
| 2873 | 6,755 | 100 |
| 3014 | 4,794 | 140 |
| 3026 | 986 | 140 |
| 3047 | 4,035 | 140 |
| 3060 | 2,060 | 140 |
| 3080 | 1,391 | 140 |
| 3081 | 16,807 | 140 |
| 3094 | 1,036 | 140 |
| 3108 | 778 | 140 |
| 3113 | 496 | 140 |
| 3125 | 1,079 | 140 |
| 3144 | 465 | 160 |
| 3149 | 643 | 140 |
| 3166 | 532 | 120 |

## Committed closure and independent verification

The first rollback test failed before mutation because a PL/pgSQL variable shadowed a table alias. The additive v3 fix renamed that variable; failed variants remain preserved. The full v3 transaction then passed an explicit ROLLBACK test. A separate SELECT confirmed the run still running, zero new coverage-ledger rows, Roundup still at 20 and Open US Law held. Only then was the byte-identical transaction body committed. Executed commit SQL SHA-256: `d8dd0fb382c794f7ad44a6d00fbb6a351e24628ede48c234a48c6bcc0e7fc472`.

The committed transaction retained 16 full matter before-images and closed only this bounded run with 5,152 observations, 476 new source versions, 2,200 projected entries, 162 added entries, 2,038 updated entries, 16 partial scopes, zero complete scopes and zero downloaded PDFs. Independent SELECT-only readback returned `all_checks_pass: true`, with 16 exact evidence/replacement/coverage matches, 4,798 registry before-images and a 64,135-row public catalog. A separate REST read compared every field of all 16 public records: item/detail matched the intended replacements and every other field remained unchanged. Its full-response SHA-256 is `6f42cbb7e39072ce9c73c61b86f8ecec025382e64ccf17d0b8096a561a5ca32c`.

Receipts: `live-finalization-v3-rollback-test.json` is only an inside-rollback result; `live-finalization-rollback-independent-check.json` proves rollback; `live-finalization-v3-commit-result.json` and `live-finalization-independent-postcommit-v2.json` prove actual completion. The public before/after records and REST receipt are preserved separately. `live-roundup-corrected-summary.png` shows the live 140-entry summary. The successful global import-validation query is linked by `postimport-validation-chunks-v3/live-validation-manifest-v4.json`, preserving the failed original manifest reference.

## Remaining work

The later four frozen plans still require actual predecessor checks, private imports, independent validation and bounded public projection. The latest 2,500 captured entries are not packaged. The collector's separate traversal has 25,035 IDs, with five original cursors partial and eleven exhausted; none of that proves published member or PDF coverage. Preserve all existing holds, native-relationship requirements, source-access restrictions and quota reserves.

The same production check still shows Roundup archive reads as incomplete, with zero open and 24,762 held PDF source records; investigate the archive lookup/access evidence before changing those labels or releasing anything. The header also lists a 2017 termination date alongside current JPML pending status; reconcile the source meanings and reopening history rather than deleting or guessing a date. Neither issue was changed by the entry-count correction.
