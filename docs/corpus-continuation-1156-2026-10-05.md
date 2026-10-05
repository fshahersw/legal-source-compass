# Priority continuation checkpoint — October 5, 11:56 UTC

The two resumed passes captured and audited **1,260 additional unique docket entries**: 620 from 11:30–11:35 and 640 from 11:44–11:49. Their respective nested RECAP-document reference counts are 713 and 717. Each new response, native entry identity, source association and record hash passed verification; all earlier capture pairs were preserved. These are metadata captures, not registered records or acquired PDFs.

Cumulative captures now contain 2,285 unique entry IDs: 2,200 belong to the 16 continuation targets and 85 belong to the previously completed MDL 3114 scope. The three post-refresh passes have added 1,880 locally new target entries since the registered 405-observation refresh. **All 16 target scopes remain incomplete.** The latest service processed 16 tasks with 32 successful calls and no failures, then exited with an empty task queue. Empty queue does not mean complete dockets; all 16 saved next cursors remain.

| MDL | CourtListener docket ID | Captured target entries |
| ---: | ---: | ---: |
| 2741 | 5981306 | 140 |
| 2789 | 6224301 | 140 |
| 2873 | 8408916 | 100 |
| 3014 | 60866823 | 140 |
| 3026 | 61690868 | 140 |
| 3047 | 65407433 | 140 |
| 3060 | 66801859 | 140 |
| 3080 | 67665081 | 140 |
| 3081 | 67678440 | 140 |
| 3094 | 68222905 | 140 |
| 3108 | 68837976 | 140 |
| 3113 | 68869775 | 140 |
| 3125 | 69255166 | 140 |
| 3144 | 69871659 | 160 |
| 3149 | 69912599 | 140 |
| 3166 | 72030009 | 120 |

## Frozen import packet

Use `private/audit-2026-10-05/continuation-1145/import-plan.json`, not the older 10:55 draft. New run **`216cd8bb-e850-4ca1-9a55-78251b79edcb`** is prepared but has not been opened. No database intake or projection was attempted. The previous prepared run `68fcc730-2104-4713-bb7e-cf323d66a119` was not executed and its files remain intact with a separate supersession note.

The new `import-snapshot/live-normalized/docket-entries.jsonl` contains only the 16 exact target scopes: 2,200 entry observations and 2,952 distinct nested document IDs, with no conflicting native entry/document relationships. Its byte length is **5,399,823** and SHA-256 is **`678a9a2116665540cafa5f214ef84e9290ffff9057bd28042742e6031a0b34e0`**. The importer dry run validated 5,152 envelopes in eight batches with zero held rows and zero writes. Its `sent` counter describes dry-run batch sizes, not database delivery.

The same folder contains the frozen full 2,285-row capture, manifest-after, 16 audited matter bundles, exact 2,200 native entry IDs, request/body inventory and the new-pass native entry/document map. The full capture is 5,602,823 bytes with SHA-256 `140526d08e1244ea37a808d6f7af240c24447eaa8e20799c5f8f491a150887f9`. The 11:30 frozen source remains separately preserved under `continuation-1130/`. Later acquisition may advance the collector folder without changing this pinned import cohort.

After SQL browser control recovers:

1. Verify the target project, frozen hashes and both prepared run IDs' actual database state. Neither run's absence was verified through SQL in this pass. Open only the new checksum-matching run transaction when absent; never reuse or reopen a completed run.
2. Run `members-import-cl.mjs` with the new run, **`--pass=private/audit-2026-10-05/continuation-1145/import-snapshot`**, `--types=docket-entries,recap-documents --max-rows=2000 --max-bytes=1500000`. Inspect all acknowledgements and any held rows. Do not use the changing `recent-entries` folder as this run's input.
3. Dry-run `members-project-extras.mjs` for the 16 MDLs with `--only=entries`, the new run, `--native-entry-ids-file=private/audit-2026-10-05/continuation-1145/native-entry-ids.json` and `--staging=private/audit-2026-10-05/continuation-1145`. Preserve and verify exact before-images before executing. Keep all remote-only rows and publication holds; do not pass `--ready=true`.
4. Reconcile actual public row deltas, filters, counts and source dates. Render a fresh guarded coverage transaction from the actual receipts. The old 405/63,973 assertions are historical and must not be replayed after a changed projection.
5. Review PDF eligibility and existing verified bytes independently. Native document references, the earlier 59 metadata candidates, and successful import envelopes are not acquired PDFs. Register every verified receipt before claiming document coverage.

At 11:54:48 UTC, the actual API reported **87/day, 195/hour and 25/minute remaining**, none blocked: 67 usable daily calls after the reserve at that instant. Quota was **not exhausted**. This is a completed bounded capture checkpoint. The collector is stopped, its lock is released, and further acquisition must use a fresh quota check, exact saved cursors and current/unblocked native headers. Keep the four blocked headers and invalid secondary MDL 3014 ID excluded.

## Calculator and state-law status

Commit `ce88c35` adds tested separate accrual/repose arithmetic, independent historical ranges and date-confirmation resets. Validation passed 648 tests with one existing skip, TypeScript, scoped ESLint and a production build. [The legal review](limitations-repose-review-2026-10-05.md) identifies the exact captured primary authorities and the limited meaning of those results. No NC or OR rule was activated.

The private NC candidate in `state-law-next/nc-candidate-review.json` is grounded in the current §1-52 text, the original October 1, 1979 effective date and pending-litigation savings, and reviewed later amendments. It excludes products, latent disease, groundwater, professional and other special claims. It still needs its separately versioned source/registry/bundle publication work after release .2. Do not copy this draft directly into active data. Oregon's currentness was checked against the official 2025 regular/special and 2026 regular-session tables, but original 1967 c.406 effective/transition evidence remains missing. New Jersey's current section was located through the official index, but direct primary retrieval timed out.

Prepared release **.2** remains frozen: 124 rule records, 85 conditional baselines in 44 jurisdictions, 39 research rules, 91 statutory captures covering 47 jurisdictions and 13 judicial references. The active manifest remains **.1**. Do not regenerate the prepared transaction or replace its manifest before its guarded database verification. Read [the release checkpoint](state-law-release-checkpoint-2026-10-05.md) for that sequence. One consolidated state entry for each of 50 states and DC is committed and locally verified; Lovable publication remains unverified.

After that prepared release, the remaining jurisdictions without a general computable baseline are **AR, GA, MS, NJ, NC, OR and TN**; primary statutory text is still pending for **AR, GA, MS and TN**. Existing baselines do not imply complete product, wrongful-death, tolling, historical or court-filing coverage.

The latest Chrome attempt still timed out, even after the user's reconnection. No SQL or Lovable publish action succeeded. At 11:56:14 UTC, direct target-pinned REST confirmed all 118 published rules match their exact preserved before-images, the live docket-entry catalog remains 63,973, Open US Law remains held with 2,968,623 rows, and both owner-deleted collections have no rows or catalog entries. Do not recreate financial disclosures or the URL directory. No storage object or publication hold changed in this continuation.

The continuation automation remains active. Publication and registration are blocked on working authenticated browser control; source capture can continue in later bounded passes. Preserve the existing unanswered browser-restart request rather than repeatedly asking the same question.
