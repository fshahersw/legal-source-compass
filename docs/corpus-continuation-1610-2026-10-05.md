# Corpus continuation checkpoint — 2026-10-05 16:28 UTC

## CourtListener capture

The bounded continuation ran from 16:12:03.561Z to 16:24:51.499Z and stopped at its configured 150-request reservation cap. The request log contains 149 HTTP 200 responses and one HTTP 502. The 502 was retried at the same cursor; the client reached its pass cap before making the next request. This was a request-budget stop, not quota exhaustion. Client pacing and rolling-window reserves remained in force.

The frozen canonical entry file grew from 17,335 to 20,315 unique native entry IDs: **2,980 new entries**. Their embedded docket-entry responses contain **3,732 unique nested document IDs** (3,732 occurrences). Five tasks completed; docket `8408916` remains queued at the saved cursor. Its 480-row addition comprises 24 successful pages; the failed response did not advance the cursor. No collector process or lock remains.

Six scopes remain partial:

| Docket ID | Records / pages | New entries | Next cursor |
|---|---:|---:|---|
| 5981306 | 1,940 / 97 | 500 | Preserved |
| 8408916 | 1,880 / 94 | 480 | Preserved after 502 and pass cap |
| 60866823 | 1,940 / 97 | 500 | Preserved |
| 65407433 | 1,940 / 97 | 500 | Preserved |
| 66801859 | 1,940 / 97 | 500 | Preserved |
| 67678440 | 1,920 / 96 | 500 | Preserved |

Ten other continuation scopes are exhausted (`complete=true`, `next=null`): `61690868`, `6224301`, `67665081`, `68222905`, `68837976`, `68869775`, `69255166`, `69871659`, `69912599`, and `72030009`. The manifest also contains complete scope `68936135` outside this ten-scope set; overall it has 17 scopes, six partial and eleven complete.

The independent offline audit passed the planned-scope, cursor, row-preservation, source-body/receipt, and predecessor-plan checks. The request log includes the 502 response; as expected, that unsuccessful response has no archived raw body or receipt. All 20,315 canonical rows resolve to matching source payloads and receipts: 20,070 through content-addressed raw bodies and 245 older rows through URL-cache bodies after verifying their provenance sidecars and body hashes.

## Frozen artifacts and pending intake

The audit outcome is `integrity_checks_passed_with_partial_source_traversal_and_502_budget_stop`.

| Artifact | SHA-256 |
|---|---|
| `continuation-1610/capture-audit.json` | `4e539b1958e7a4304986965e92447465a408d9f05dcab57077423190542b8472` |
| `continuation-1610/frozen-docket-entries.jsonl` | `bf5e4ce05cdfdeec95dd0c2e1c22f4325c5eb17ff965a15bfa89c28ad76982a3` |
| `continuation-1610/manifest-after.json` | `fb744df0e4de47d49620425a7eb1e743484b7b5f96f0878dbea29973aff17b5a` |
| `continuation-1610/request-log-after.jsonl` | `a699732bf5b7ace592294f8b4145dbd6f4bb9d4f7cedd2e912711bc8c96bf0fa` |
| `continuation-1610/capture-plan.json` | `7a7ca201c2e52fc96f665ea7b145ac37a9aa40d83387f49c29cbf8f7a06a03b7` |

All four previously prepared import plans remained byte-for-byte unchanged and outside this capture:

| Import plan | SHA-256 |
|---|---|
| `continuation-1145/import-plan.json` | `8483eafa20b9f7313a19f1b46fe11a73049d31ae82075bc119501ec867c4d0c3` |
| `continuation-1252/post-1145/import-plan.json` | `b0a43279ed47daaf4f3f02ded1765a7a41e30d6453c492bb01ffe236f4d0673a` |
| `continuation-1403/post-1252/import-plan.json` | `cbf2e40a10a65c2d87f8388a0b678aa0d283189b2d02535b387171638a5dbbfc` |
| `continuation-1500/post-1403/import-plan.json` | `81b10fec7475f7891faaa0769d3f71c9f25ee4becf8d4f32e9cda56fa4363c6e` |

The **1,395 entries** captured in continuation-1540 and these **2,980 entries** remain unpackaged beyond those four plans. This checkpoint does not create another intake packet. No PDFs were acquired, no database writes or publication occurred, and no docket membership is inferred.

## Read-only live preflight and tool availability

The post-parser-corrections read-only preflight at `2026-10-05T16:24:19.176Z` observed 94 datasets, 11 held. `open_us_law` remains `ready=false` with 2,968,623 imported records; this is held/not published, not a count of publicly available or searchable statutes. `sw_docket_entries_v1` was ready with 63,973 imported records; `statutory_limitations_review` was ready with 118; `limitation_periods` was ready with 459. `judge_disclosures` and `url_directory` were absent. The preflight file SHA-256 is `78db86c5b50ad00c2eae9e40ce0a479973d3ee629e68e8079fe79766a195b38d`.

Although the owner reports Supabase and Lovable are connected, this task's callable tool catalog exposed no tool names matching either service. That is a tool-surface availability observation only. No browser or login workaround was attempted, and no live write is claimed.

For the separate state-code acquisition and parse checkpoint, see [full-state-code-acquisition-2026-10-05.md](full-state-code-acquisition-2026-10-05.md); this continuation note does not restate or revise its inventory counts.

## Audit records

- [Continuation 1610 audit](../private/audit-2026-10-05/continuation-1610/capture-audit.md)
- [Continuation 1610 machine-readable audit](../private/audit-2026-10-05/continuation-1610/capture-audit.json)
- [Read-only post-correction preflight](../private/audit-2026-10-05/live-preflight-after-parser-corrections.json)
