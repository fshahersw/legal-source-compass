# CourtListener continuation checkpoint — 2026-10-05 17:08 UTC

## Capture result

The bounded continuation resumed the six saved, exact docket-entry cursors using the existing `CourtListenerClient` and its rolling-window safeguards. Fresh preflight at 16:51:40Z reported 284/day, 147/hour, and 25/minute remaining. The pass budget was `min(150, 284−25, 147−35) = 112`; the minute window governed pacing, not the pass cap. The client retained its five-request minute reserve and two-second request spacing.

The collector ran from 16:53:15.796Z to 17:03:07.641Z (PID 17660), made 111 requests, and exited normally with six tasks done, zero failed or pending, no stop reason, and no lock. All 111 responses were HTTP 200. This was a successful bounded pass, not quota exhaustion. No request went outside the six approved docket IDs, and the 8408916 queue task was used unchanged at its saved 25-page budget.

The canonical observation file grew from 20,315 to 22,535 unique native entry IDs: **2,220 additions** and **2,426 embedded document occurrences / unique native document IDs**. Prior rows and payloads were preserved, with no out-of-scope entries. One scope reached the end of observed CourtListener pagination; five remain partial with their next cursors preserved. API pagination is not a claim of full PACER or court-record coverage.

| Docket ID | New entries | Pages in this pass | Observed scope after pass | Next cursor |
|---|---:|---:|---|---|
| 5981306 | 400 | 20 | Partial | Preserved |
| 8408916 | 500 | 25 | Partial | Preserved |
| 60866823 | 400 | 20 | Partial | Preserved |
| 65407433 | 400 | 20 | Partial | Preserved |
| 66801859 | 120 | 6 | Complete API traversal | None |
| 67678440 | 400 | 20 | Partial | Preserved |

## Independent integrity audit

The offline audit checked the saved before snapshots against the capture plan, final copies against the stopped live files, all six saved header states, all successful raw response bodies and retrieval receipts, entry/native-ID payload correspondence, cursor continuity, unchanged prior rows, and all four earlier import-plan hashes. It found no receipt/body, payload, record-hash, or cursor discrepancies. All six saved headers were current and unblocked at preflight. Capture is not import, publication, PDF acquisition, or MDL-membership evidence.

| Frozen artifact | SHA-256 |
|---|---|
| Before entries (20,315 rows) | `bf5e4ce05cdfdeec95dd0c2e1c22f4325c5eb17ff965a15bfa89c28ad76982a3` |
| After entries (22,535 rows) | `578291df952ac71d150331804c3f2a35e726aa1e7f243fa4086133494c1b295f` |
| Manifest after | `781140b4fde1615d79cc5d87c77c7614251054f2495bcbbc0fdaebea3bae648b` |
| Request log after | `95acc9e98880bbd3d96dfa5ed065034be9032f901dbc65bed561f47d7b6057e5` |
| Capture plan | `c1fdf4a8f571cf8635863c76975cde0f1094a83c5f7f60d08d0cac412bca0bb6` |
| Capture audit JSON | `dc8b0a45c38ba3b855db67f14c9f1ca65d7aa2dcbf21fe32635770e95a8f3ea3` |

The audit details are in [capture-audit.json](../private/audit-2026-10-05/continuation-1650/capture-audit.json) and [capture-audit.md](../private/audit-2026-10-05/continuation-1650/capture-audit.md). The original task and immutable before/after snapshots, response log, manifest, rate ledger, and task completion receipts remain under `private/audit-2026-10-05/continuation-1650/`.

All four previously prepared import plans remain unchanged: `continuation-1145` `8483eafa…`, `continuation-1252` `b0a43279…`, `continuation-1403` `cbf2e40a…`, and `continuation-1500/post-1403` `81b10fec…`. No PDFs were acquired, no database writes or publication occurred, and no entry membership was inferred.

## Conditional successor intake packet (prepared; execution blocked)

The next packet should contain only the unpackaged, native-ID delta after the frozen 15:00 corpus snapshot, not another copy of the already-prepared `continuation-1500/post-1403` packet. The 15:52, 16:28, and 17:07 audited captures add 1,395 + 2,980 + 2,220 = **6,595 unique entry IDs** after the 15:00 baseline. Cross-checking the 1650 final snapshot against the 15:00 baseline and the existing 1500 packet’s 3,162 selected IDs found no overlap between this 6,595-ID delta and the existing packet. Of those 3,162 already-prepared IDs, 3,161 are in the 15:00 traversal snapshot; the remaining ID is the separately captured first-page sample `480472511` for docket `61690868`.

The frozen 1650 traversal contains **22,535 unique entries**. The separate sample `480472511` is confirmed absent from both the 15:00 and 1650 traversal snapshots, so traversal plus that sample describes 22,536 distinct observed entry IDs. The two packet inputs instead select 3,162 + 6,595 = **9,757 entry IDs**; these counts describe selected inputs, not total destination-table rows. Across the three later capture deltas there are **8,247 nested document metadata IDs**, unique across their union. These are metadata references, not downloaded PDFs.

Before opening or importing the prepared successor, or projecting its entries:

1. Keep the existing `continuation-1500/post-1403/import-plan.json` hash pinned at `81b10fec7475f7891faaa0769d3f71c9f25ee4becf8d4f32e9cda56fa4363c6e`, preserve its exact snapshot/bundle inputs, and independently verify its actual intake/projection completion. Its packet currently says `prepared_not_opened_or_imported`; that label is not evidence that the named run completed.
2. If that predecessor completes, verify the actual completed run ID and bind the candidate `aeb822fe-ad83-46c2-b5a7-f28d19312bf9` to the authorized project `xosqzzsnhxcyehcnirpa`; do not mark any predecessor complete to satisfy a guard.
3. The prepared packet already fixes the exact native-ID set by differencing the frozen 1650 final corpus (`578291df…`) against the frozen 1500 baseline (`8f86a0ee…`): 6,595 IDs, zero overlap with the 1500 packet’s 3,162 IDs, zero changed historical versions, and verified source-body/receipt provenance from all three captures. Keep the 61690868 first-page sample separate.
4. Before any execution, recheck all hashes, source headers, actual run status, current public before-images, hold/readiness state, and restriction policy. The saved guarded SQL has not been executed, and no projection is prepared. Never set a held collection ready by implication.

The successor packet is prepared conditionally at [continuation-1713/post-1500](../private/audit-2026-10-05/continuation-1713/post-1500/). It includes 6,595 entry IDs across eight exact native docket IDs and 8,247 nested document metadata IDs; the local dry-intake check counted 14,842 envelopes in 21 batches with zero held rows or writes. The packet copies and verifies 331 raw source pages and their retrieval receipts. Plan SHA-256 is `79f030311ade32d617afe3fed1a46c03ac88dee60f6ddc559f8aa3a08dedf69f`; independent audit SHA-256 is `3d809b5bc407ef71285a5301bfbc09e47488a5d466b20b3db6e2f76b46b95d06`. The main agent independently rehashed all ten packet files listed in that audit. See the [independent packet audit](../private/audit-2026-10-05/continuation-1713/post-1500/packet-audit.md) and [dry-intake summary](../private/audit-2026-10-05/continuation-1713/post-1500/dry-intake-summary.json).

The packet’s proposed candidate UUID is `aeb822fe-ad83-46c2-b5a7-f28d19312bf9`; it is not claimed to exist in the database. It is conditionally bound to expected predecessor `36428917-b1fc-4b2c-a525-9e28cab83edb` and existing predecessor-plan SHA-256 `81b10fec7475f7891faaa0769d3f71c9f25ee4becf8d4f32e9cda56fa4363c6e`. The saved predecessor packet still says `prepared_not_opened_or_imported`; no database status was queried, so completion remains unverified and the guarded SQL was not executed. No import or public projection is claimed ready. For the separate state-code inventory, see [full-state-code-acquisition-2026-10-05.md](full-state-code-acquisition-2026-10-05.md).
