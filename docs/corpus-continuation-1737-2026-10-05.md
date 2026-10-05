# CourtListener continuation checkpoint — 2026-10-05 17:50 UTC

## Bounded capture

Before launch, the shared collector was exited (previous PID 17660) and `api-collector.lock` was absent. A fresh quota response at 17:38:25.504Z showed 170 requests/day, 186/hour, and 25/minute remaining; all scopes were unblocked. With 25/day and 35/hour margins, the pass ceiling was 145. Minute quota governed pacing, not the total pass. The existing client enforced its 20/day, 30/hour, 5/minute reserves and 2-second minimum gap. The service ran as PID 2992 from 17:40:48.620Z to 17:49:49.996Z.

The pass used only the five saved exact partial docket-entry cursors from continuation 1650: 5981306, 8408916, 60866823, 65407433, and 67678440. Each task was capped at 25 pages and requested `page_size=100`; CourtListener returned 20 entries in each of the 125 verified response bodies. The client made 125 requests; all were HTTP 200, five tasks completed, none failed or remained pending, there was no stop reason, and the lock was released. No requests left the five native docket scopes.

The traversal grew from 22,535 to **25,035 unique native docket entries**, adding **2,500** (500 from each scope). The captured rows contain **2,844 nested document occurrences, all 2,844 IDs unique**. All five scopes remain partial and their next cursors are preserved; this is observed API pagination, not a claim of complete PACER or court-record coverage.

| Native docket ID | Entries before | Entries after | New entries | Pages | Scope after pass |
|---|---:|---:|---:|---:|---|
| 5981306 | 2,340 | 2,840 | 500 | 25 | Partial; cursor retained |
| 8408916 | 2,380 | 2,880 | 500 | 25 | Partial; cursor retained |
| 60866823 | 2,340 | 2,840 | 500 | 25 | Partial; cursor retained |
| 65407433 | 2,340 | 2,840 | 500 | 25 | Partial; cursor retained |
| 67678440 | 2,320 | 2,820 | 500 | 25 | Partial; cursor retained |

## Integrity and preserved intake plans

The offline audit found no changed prior entries, duplicate IDs, out-of-scope entries, source-payload mismatches, record-hash mismatches, cursor discontinuities, failed responses, or raw-body/receipt mismatches. It verified and copied all 125 successful response bodies and exact retrieval receipts, saved before/after header snapshots, and checked the final live copies against the frozen files. The response provenance uses the CourtListener REST schema recorded by the existing client.

All five existing intake-plan files remain byte-identical to their pinned hashes:

| Intake plan | SHA-256 |
|---|---|
| `continuation-1145/import-plan.json` | `8483eafa20b9f7313a19f1b46fe11a73049d31ae82075bc119501ec867c4d0c3` |
| `continuation-1252/post-1145/import-plan.json` | `b0a43279ed47daaf4f3f02ded1765a7a41e30d6453c492bb01ffe236f4d0673a` |
| `continuation-1403/post-1252/import-plan.json` | `cbf2e40a10a65c2d87f8388a0b678aa0d283189b2d02535b387171638a5dbbfc` |
| `continuation-1500/post-1403/import-plan.json` | `81b10fec7475f7891faaa0769d3f71c9f25ee4becf8d4f32e9cda56fa4363c6e` |
| finalized `continuation-1713` plan | `a478f1699e90d23d0b6fa08e7a87f75405c2384d1a2696ea4dd814720673b25a` |

Capture plan SHA-256: `5e39fbe2428d7ef9952c8e3435688680d8efe8f02102817e414412cceeac2bd9`. Independent capture audit SHA-256: `818127dd9215d3c542299fcd64475379f4bab2709268b2d521993115f07c6982`. The audit details, including frozen artifact hashes and source receipt links, are in [capture-audit.json](../private/audit-2026-10-05/continuation-1737/capture-audit.json) and [capture-audit.md](../private/audit-2026-10-05/continuation-1737/capture-audit.md). Raw pages and their matching receipts are retained in that private directory.

This was source capture only. No PDFs were downloaded, no intake packet was prepared, no run was opened, and no database writes or publication occurred. No MDL membership was inferred.
