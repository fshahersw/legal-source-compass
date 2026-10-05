# State-law restoration release checkpoint — October 5, 2026

## Status at 10:52 UTC

The owner-ordered financial-disclosure and URL-directory removals are complete; see `owner-priority-corrections-2026-10-05.md`. State-source navigation is repaired in code. The expanded calculator release is prepared and tested, **not registered or published**. The active application manifest still points to release `2026-10-05.1` (37 jurisdictions with conditional baselines).

The browser connection repeatedly timed out, including an inventory request. No Supabase SQL or Lovable publishing action was attempted after those failures. The user was asked asynchronously to reconnect the extension. Direct target-pinned REST access and private Storage access remain functional, so docket continuation can proceed independently when quota permits. Do not call Git push proof of Lovable sync or production publication.

At 11:17 UTC, an independent audit reconfirmed the exact frozen SQL checksum, all 14 uploaded-file receipts, all rule/source/coverage references, and all 91 statutory plus 13 judicial text-file hashes. The user reconnected Chrome, but commands still time out; SQL registration and publication remain pending. A local preview verified 51 unique state choices and a source-text response against the active manifest. The state list was further simplified to names only and misleading “full code not stored” copy was removed. TypeScript, scoped ESLint and the production build passed after that final copy/layout change. See `corpus-continuation-1055-2026-10-05.md` for the 620 newly captured docket entries and their separate pending-registration status.

## Prepared calculator release

| Measure | Published .1 | Prepared .2 |
| --- | ---: | ---: |
| Rule records | 118 | 124 |
| Conditional baselines | 73 | 85 |
| Jurisdictions with a baseline | 37 | 44 |
| Research-only rules | 45 | 39 |
| Statutory captures | 81 | 91 |
| Jurisdictions with statutory text | 46 | 47 |
| Judicial references used by the app | 13 | 13 |

Ordinary personal-injury coverage was prepared for KY, LA, DC, MO, NE, UT and WY. Separate wrongful-death periods were prepared for DC, MO, NE, UT and WY. Current Louisiana wrongful death was captured but remains uncomputed: Article 2315.2(B) uses the longer of one year after death and two years after injury, and medical malpractice has a separate subsection. The 2025 transition remains unresolved.

Kentucky's current captured section is effective July 15, 2026; the branch withholds earlier dates pending historical review and excludes Motor Vehicle Reparations Act claims. Louisiana's ordinary two-year branch requires an action arising after July 1, 2024 and withholds that boundary day and earlier dates. Wyoming representative-appointment tolling remains an explicit unresolved-issue gate. No special product/mass-tort branch was inferred from these ordinary-injury rules.

Primary statutory text gaps remain AR, GA, MS and TN. GA has an enacted 2015 source but an unreconciled 2016–2024 amendment interval; proposed/dead bills in other states are not operative authority. NJ has captured enacted text but current codification retrieval failed. NC and OR require additional accrual/repose inputs and legal mapping. These seven jurisdictions have no active general baseline in the prepared release. State-specific product and death coverage is narrower than the jurisdiction total.

The Open US Law hold remains unchanged. The navigation repair exposes all 50 states and DC once, linking to recorded official sources and available saved statutory text. It does not claim that full state codes are stored or current. Official-source browsing also remains available when the separate stored-corpus service fails.

## Publication evidence and exact next steps

All private files are under `private/audit-2026-10-05/state-law-restoration/`:

- `before/`: exact published 118 rules/catalog, protected bundle before-images and active manifest.
- `captures/`, `source-review-receipts.json`, `storage-receipts/`: ten newly captured statutory originals and whole-object cloud SHA-256 readback receipts.
- `intake.jsonl`: 29 private `corpus-legal-review` entity envelopes, including 10 sources, 12 changed/new rules and 7 coverage rows.
- `apply-reviewed-coverage.sql`: guarded transaction, run **`2ff88e16-2fdd-4672-bbf3-d65795542271`**, 201,605 bytes, SHA-256 **`3ac1fdb06b2f9d5fff3364ee108c645dab798aecae4a0985de73cd59676a6139`**. It preserves before-images, ingests versions, records source/coverage native edges, projects rules, reconciles facets and verifies exact counts. It has no DDL, grant or deletion. Earlier drafts are retained and must not be executed.
- `import-manifest.json`: the final transaction checksum and `prepared_not_applied` status.
- `manifest-candidate.json`: the full application manifest to activate **only after** the transaction is verified.
- `manifest-upload.json` and `bundle-upload-receipt.jsonl.complete.json`: 14 changed protected files (492,165 bytes) uploaded with complete SHA-256 readback. The active manifest was not changed.
- `opinion-captures/`: official Utah/Nebraska opinion PDFs and a blocked DC capture, retained as private supporting research. These are not additional published judicial-reference rows.
- `ar-ga-ms-tn-discovery/`: exact source and access-block evidence; no additional calculator activation.

When browser access returns, first independently verify the run is absent/not applied and published rules still match the preserved before-image. In the existing target Supabase project, run only the checksum-matching final SQL transaction. Verify the completed run and all 124 public rule payloads/citations/facets through target-pinned REST, with zero mismatches and `projection_validation.passed=true`. Only then replace `src/lib/private-data/manifest.server.json` with the candidate, recheck bundle hashes, commit/push and publish through Lovable. Verify the actual live calculator and state browser, including KY/LA boundaries, distinct injury/death periods, citation links, unique state choices and source-text downloads. Keep raw versions and all unrelated publication holds.

Do not rerun preparation/export scripts blindly: they intentionally use exclusive creates, and the final SQL includes an extra coverage-to-rule edge statement added after the first draft. The checksum in this document identifies the final reviewed transaction.

Validation: TypeScript and scoped ESLint passed. Full Vitest passed 638 tests with one existing skip. Production build passed. Live/browser visual verification is still pending because the browser connection is unavailable.
