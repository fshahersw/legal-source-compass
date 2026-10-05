# Docket PDF source-version reconciliation — October 5, 2026

At 21:21 UTC, independent Supabase SQL verification confirmed **293 new exact native-document/source-version associations**, each backed by an existing private PDF and a new whole-object verification receipt. No source PDF requests, uploads or new stored objects were needed. The verified objects total **152,946,562 bytes**. All 293 asset identities, object hashes and registration observations matched; none was rejected.

The frozen 12:52 docket packet contains 909 documents that explicitly report available and unsealed status, have a stored PDF hash match, and pass the restricted-description check. Before this repair, 596 had an association to their exact current native source version; **889 now do**. Current registered native versions and docket-header eligibility were independently reconciled for all 909. This is a bounded metadata scope, not a fresh CourtListener acquisition or a claim that every matter document is present.

| CourtListener docket | MDL | Qualified candidates | Exact current-version assets after repair |
| --- | ---: | ---: | ---: |
| 60866823 | 3014 | 22 | 22 |
| 65407433 | 3047 | 560 | 560 |
| 68869775 | 3113 | 2 | 2 |
| 69871659 | 3144 | 34 | 34 |
| 72030009 | 3166 | 291 | 271 |

The remaining **20 MDL 3166 records have conflicting publisher/stored byte counts**. Their SHA-1 metadata matches existing objects, but this pass held them for reconciliation instead of silently accepting the size conflict. Existing locator associations and original receipts remain intact. No sealed, unknown-seal-status, restricted-description or blocked-docket candidate was added.

Preparation verified 23 original source-response files by SHA-256, compared each selected entry with its raw response, reconstructed exact native document records using the original importer contract, and checked for changed newer retained source versions. Every selected PDF was then fetched from the existing private bucket and checked for complete byte length, PDF signature, SHA-1 and SHA-256 before registration. Source requests and stored-byte uploads stayed at zero.

Private evidence: `private/audit-2026-10-05/continuation-1252/post-1145/pdf-eligibility-2105/`. The queue SHA-256 is `205b82e9f18a16523b3fe56d1fbf589f61cc0aeb0a28302d5ecff9371bba40a0`; `verified-reuse/` contains fresh readback receipts, `registration/` the acknowledged registration batches, and `live-exact-registration-verification.json` the independent result. `reuse-queue-manifest.json` lists all 20 held identities and both size claims. The wider cursor, member-case, source-unavailable and later-packet gaps remain open.
