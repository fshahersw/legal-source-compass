# Owner priority corrections — October 5, 2026

State-law coverage, calculator accuracy and incomplete matter dockets take priority over peripheral acquisitions and cosmetic work.

## Completed removals

The owner explicitly instructed removal of judge financial disclosures and the URL directory. At 10:28:26 UTC, target-pinned verification confirmed:

| Dataset | Records removed | Remaining records |
| --- | ---: | ---: |
| `judge_disclosures` | 21,832 | 0 |
| `url_directory` | 131,743 | 0 |

Both catalog entries are removed; 94 datasets remain. Every other catalog row is byte-for-byte equivalent as parsed JSON to its before-image. All 11 publication holds, raw provenance and stored originals remain unchanged. No Storage objects were deleted. Do not acquire replacement financial-disclosure exports or recreate either removed collection without a new owner instruction.

Private evidence: `private/audit-2026-10-05/remove-peripheral-datasets/`. This includes all record fields, catalog/context before-images, per-page hashes, exact mutation intents and receipts, and `completion-verification.json`. The recoverable export is 955,159,371 serialized bytes; that is **not** a measurement of reclaimed database disk space. PostgreSQL physical reclamation was not measured.

The committed recovery/removal tool is `scripts/admin/remove-peripheral-datasets-20261005.mjs`. Do not rerun removal or restore during ordinary continuation. Restore is an exceptional owner-directed action using preserved before-images and exact guards.

## Why the state-code browser lost coverage

The `open_us_law` rows were not deleted: 2,968,623 remain stored. Commit `6c0709a` enforced the existing publication gate on the law outline. With that collection held, the browser derived its state choices only from independently published code datasets: Indiana and South Dakota. That coupled state-source navigation to the readiness of one bulk collection.

The October 5 audit found 1,942,637 state/territory/DC statute rows plus 54,853 federal statute rows, reconciling to 1,997,490 statute rows. Georgia and North Carolina have no rows in that category. There are 265,261 empty source URLs. Arkansas, Mississippi, New Mexico and Tennessee account for 262,772 of them. The 1,624,428 rows marked `in_force` with a nonempty URL form a **review queue**, not a verified current-law corpus. Sampled rows lack source-as-of and effective dates, and the earlier Westlaw provenance issue remains unresolved.

Keep the bulk hold while repairing access to independently recorded official sources and reviewed statutes. Do not represent official links, queued source work or selected captured sections as a complete stored state code.

## Work still required

- Expand calculator rules only from identified primary authority, with correct claim scope, accrual, version transitions, repose and tolling treatment.
- Restore one state entry per jurisdiction with official-source access and available captured statutes.
- Resume the 16 saved CourtListener cursors only at or after 10:55 UTC and after a fresh actual quota check. Preserve all lock, reserve, blocked-source and native-identity safeguards in `corpus-continuation-checkpoint.md`.
- Keep the staged legal graph held and reconcile every bounded projection before describing it as published.
