# Corpus continuation — 14:28 UTC, October 5, 2026

The frozen traversal now has **15,940 distinct entry IDs**, up by **3,161** this continuation. A separate first-page check found one more ID, **480472511**, filed October 5 in native docket **61690868**. The fourth prepared import contains **3,162 additional captured entry IDs** and **4,818 nested document IDs**. These observations are **not registered/public rows or downloaded PDFs**. No database or Storage mutations were made this continuation.

## Captured evidence and remaining cursors

All three passes exited cleanly. Independent audits verified raw bodies, archived receipts, identities, unchanged prior rows, cursor chains, page budgets, source holds and request-ledger pairs.

| Private pass | Source requests | Added traversal IDs | Nested document IDs | Frozen total | Original scopes still partial |
| --- | ---: | ---: | ---: | ---: | ---: |
| `continuation-1429` | 32 | 640 | 839 | 13,419 | 11 |
| `continuation-1450` | 42 | 826 | 1,280 | 14,245 | 10 |
| `continuation-1500` | 85 | 1,695 | 2,698 | 15,940 | 8 |

The separate MDL 3026 sample adds one nested document to these totals: native **496179034**, marked `is_available=false`; no PDF was fetched. It returned 19 unchanged entries and one new entry. Fresh header/first-page samples for MDLs 3094 and 3125 each returned 20 unchanged entries and no new or changed IDs. All three samples remain separate from the unchanged canonical traversal and are limited to their first page.

Eight original API traversals are exhausted: **3026/61690868 (986 traversal entries, plus the separate new entry), 3094/68222905 (1,036), 3108/68837976 (778), 3113/68869775 (496), 3125/69255166 (1,079), 3144/69871659 (465), 3149/69912599 (643), and 3166/72030009 (532)**. This does not establish full current court, PACER, membership or PDF coverage. The older completed MDL 3114 scope with 85 entries is outside the original sixteen but included in the canonical total.

Resume only these eight retained `next` cursors:

| MDL | Native docket ID | Traversal entries |
| ---: | ---: | ---: |
| 2741 | 5981306 | 1,240 |
| 2789 | 6224301 | 1,240 |
| 2873 | 8408916 | 1,200 |
| 3014 | 60866823 | 1,240 |
| 3047 | 65407433 | 1,240 |
| 3060 | 66801859 | 1,240 |
| 3080 | 67665081 | 1,220 |
| 3081 | 67678440 | 1,220 |

The final frozen file is **41,132,975 bytes**, SHA-256 `8f86a0ee5f357c2002f8699383cfe9cb659749502910152ab41ab81fc60b57e1`; final manifest SHA-256 is `e66f7cd5351e6d9f9cc2feb055514102fcd6c1c16f242bdb44e6123c07ba0ff3`. Evidence is under `private/audit-2026-10-05/continuation-{1429,1450,1500}/`.

At **15:22:37 UTC**, actual CourtListener limits showed **321/day, 125/hour and 25/minute remaining**, with no blocked window. That leaves 95 calls above configured day/hour reserves, or **90 with the additional five-call cushion** used here. Capacity was not exhausted: acquisition paused at the bounded cohort boundary for audit and import preparation. Recheck actual quota, header eligibility and collector locks before another pass. The accounting review found three unallocated usage increments in an earlier pass; it did not prove whether another consumer or usage probes caused them. Rolling reset markers never guarantee a full reset.

## Fourth frozen import packet

Path: `private/audit-2026-10-05/continuation-1500/post-1403/`.

- Run **`36428917-b1fc-4b2c-a525-9e28cab83edb`** is prepared, **not opened or applied**.
- It depends on actual reconciled completion of **`c56969c3-0058-4ced-9ad4-e33a83060236`**. The three earlier packets and dependencies are unchanged; apply in order. Never mark a predecessor complete just to satisfy a guard.
- Input: **8,382,578 bytes**, SHA-256 `b84b60f631cfecfe213be27cfa06d520fa5482abae247845d21fe9ef41ee152a`.
- Plan SHA-256: `81b10fec7475f7891faaa0769d3f71c9f25ee4becf8d4f32e9cda56fa4363c6e`.
- Open-run SQL: **2,156 bytes**, SHA-256 `fa4010126931cf10f199fd71e0a84085306066e2dff9cc00556f6bfcabcf2572`. Pglast parsed five statements and one PL/pgSQL guard; syntax validation is not database execution.
- Actual dry intake validated **7,980 envelopes in 12 batches**, with zero held rows, skipped batches or writes. Stdout, summary and the empty acknowledgment receipt are retained.
- The independent `import-readiness-audit.json/.md` passed preparation integrity, including all 3,161 traversal-row matches to the 159 captured raw responses and separate freshness evidence. Actual predecessor completion and public before-images remain execution prerequisites.
- All sixteen projection bundles match the predecessor. The native-entry filter selects only this cohort. Earlier metadata-version updates remain in the preceding packet.

Before execution, verify actual run state, current native header eligibility and exact public before-images. Use the frozen intake, then the entry-only projection dry run with its exact native-ID filter. Preserve all holds and before-images; never set `ready=true`. Reconcile actual rows, dates, restricted content and PDF receipts separately. Captured new IDs may exist in an earlier public source projection; do not infer a public row-count increase from this cohort size.

## Live backend and publication

The read-only **14:54:46 UTC** target-pinned check found **118** calculator rules exactly matching the preserved before-image, **63,973** docket entries matching their catalog, **94** datasets, and the same **11** holds. `open_us_law` retained 2,968,623 rows with `ready=false`. Judge disclosures and the URL directory had zero records and zero catalog rows. Registry run state was not queried by that public-table check.

Authenticated browser control timed out again early in the continuation. No Supabase SQL or Lovable publication ran. Public HTTP reads at **14:56–14:58 UTC** fetched the published limitations route and its referenced assets; the index contained the older tolling label and lacked the pushed replacement. This confirms the new copy was not served there at that time, not editor synchronization or interactive behavior.

## State law and calculator

The existing tolling checklist now includes **alleged crimes and emergency orders**, alongside concealment, agreements, class actions and bankruptcy. This prompts review before charges are necessarily filed; it grants no automatic extension. Selecting unresolved tolling still withholds a date. After the final wording change, all **46** focused engine/repose/guidance tests, TypeScript, scoped ESLint and the production build passed. The first checkpoint was pushed as `a05d78c`; final wording and this checkpoint are committed separately.

Release **.1** remains active; prepared/uploaded **.2** and **NC .3** remain unregistered and unpublished. Use only NC's corrected v2 transaction after actual .2 reconciliation. Do not activate the manifest ahead of backend evidence.

The [state-law source review](state-law-source-review-2026-10-05.md) records twelve Georgia official PDFs covering disability/crime-related tolling and emergency orders, New Jersey digest evidence through 2026 c.97 with unresolved intervening-law/current-text capture, and the newly located Oregon enrolled SB134 text. The Oregon copy has blank chapter/approval fields and no express transition clause; historical application remains unresolved. These research results activate no unsupported rule.

## Next continuation

Prioritize authenticated administration/publication recovery, the eight retained docket cursors and remaining state-authority gaps. Apply the four frozen docket packets only after actual predecessor and before-image checks, then verify live counts. Preserve the separate MDL 3026 addition and all freshness evidence. PDF acquisition still requires fresh eligibility, verified stored-byte deduplication, whole-object readback hashes and registered receipts.

The automation was confirmed **ACTIVE**. Keep it active: gaps remain. Do not recreate removed collections, release Open US Law or staged graph holds, infer membership, or turn exhausted API pagination into a completeness claim.
