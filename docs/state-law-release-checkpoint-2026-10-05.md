# State-law restoration release checkpoint — October 5, 2026

**Published update:** `.3` is now verified on `firastest1.com` after Lovable synchronized commit `35f14ab` and reported successful publication. All four public snapshot bodies and NC source text match the candidate hashes. Live NC/KY/LA boundary checks and 51 distinct state-law links passed; see [the connected release evidence](connected-release-2026-10-05.md). This supersedes publication-pending language in the earlier checkpoint below.

## Current status — October 5, 2026, 18:38 UTC

Releases `.2` and `.3` are committed in the corpus and independently reconciled against all 124 public rule payloads and citation links. `.2` uses run `2ff88e16-2fdd-4672-bbf3-d65795542271` and review version `2026-10-05.2`; `.3` uses run `0547dd04-0941-43e1-aed7-811d3d42c5b4` and review version `2026-10-05.3`. Both projection checks passed with zero mismatches. `.2` has 85 conditional baselines across 44 jurisdictions, 39 research-only rules, 91 statutory sources and 13 judicial references. `.3` adds the narrowly scoped NC baseline: 86 baselines across 45 jurisdictions, 38 research-only rules, 92 statutory sources and 14 judicial references. Both retain 47 primary-text jurisdictions.

The original `.2` SQL failed with `42P01` because CRLF slicing removed its filter-refresh CTE; that attempt was rolled back and its file is preserved. The corrected 198,724-byte transaction, SHA-256 `61dd0dec4fd4f6f28bb455b48fc925a711c19a35280929129040377805ead4de`, changed only that malformed refresh block. It passed an explicit-rollback runtime test before the corrected transaction was committed. Do not rerun the failed original SQL. `.3` ran unchanged transaction v2, SHA-256 `342c79e65bdb343d24044aff7e839136b72231abe45b8ecc41e4ec3b9e18b026`, after `.2` and passed its preconditions.

Evidence is in `private/audit-2026-10-05/state-law-restoration/live-rollback-*`, `live-commit-result-v2.json` and `live-independent-projection-v2.json`, with corresponding `.3` files under `private/audit-2026-10-05/state-law-next/release-3/`. Independent REST payload and citation-link checks are under `private/audit-2026-10-05/live-law-release-2-2026-10-05T183502953Z/` and `live-law-release-3-2026-10-05T183659644Z/`.

The local application manifest now selects `.3`, SHA-256 `b3bb3c19dc4f5b73dea1d256ef7b510b909651006d0afea7f6a66e868d4b1834`. Lovable synchronization and site publication are still pending; no live-site publication is claimed. Validation passed 47 release tests plus 18 NC boundary cases and `tsc --noEmit`. Historical source captures remain identified by their capture dates and do not imply current law beyond the reviewed scope. Six jurisdictions still have no general baseline: AR, GA, MS, NJ, OR and TN. Open US Law remains held.

The [state-law source review](state-law-source-review-2026-10-05.md) supersedes older GA/NJ/AR/MS/OR/TN descriptions below; historical captures and bounded amendment searches do not by themselves activate calculations.

## Earlier status — 10:52 UTC (superseded)

The owner-ordered financial-disclosure and URL-directory removals are complete; see `owner-priority-corrections-2026-10-05.md`. State-source navigation is repaired in code. The expanded calculator release is prepared and tested, **not registered or published**. The active application manifest still points to release `2026-10-05.1` (37 jurisdictions with conditional baselines).

The browser connection repeatedly timed out, including an inventory request. No Supabase SQL or Lovable publishing action was attempted after those failures. The user was asked asynchronously to reconnect the extension. Direct target-pinned REST access and private Storage access remain functional, so docket continuation can proceed independently when quota permits. Do not call Git push proof of Lovable sync or production publication.

At 11:17 UTC, an independent audit reconfirmed the exact frozen SQL checksum, all 14 uploaded-file receipts, all rule/source/coverage references, and all 91 statutory plus 13 judicial text-file hashes. The user reconnected Chrome, but commands still time out; SQL registration and publication remain pending. A local preview verified 51 unique state choices and a source-text response against the active manifest. The state list was further simplified to names only and misleading “full code not stored” copy was removed. TypeScript, scoped ESLint and the production build passed after that final copy/layout change. See `corpus-continuation-1055-2026-10-05.md` for the 620 newly captured docket entries and their separate pending-registration status.

## Release counts and legal scope

| Measure | Earlier .1 | Committed .2 | Committed .3 |
| --- | ---: | ---: | ---: |
| Rule records | 118 | 124 | 124 |
| Conditional baselines | 73 | 85 | 86 |
| Jurisdictions with a baseline | 37 | 44 | 45 |
| Research-only rules | 45 | 39 | 38 |
| Statutory captures | 81 | 91 | 92 |
| Jurisdictions with statutory text | 46 | 47 | 47 |
| Judicial references used by the app | 13 | 13 | 14 |

Committed `.2` includes ordinary personal-injury coverage for KY, LA, DC, MO, NE, UT and WY; separate wrongful-death periods are included for DC, MO, NE, UT and WY. `.3` adds the narrow NC ordinary-negligence accrual/repose branch described in the [NC checkpoint](limitations-nc-candidate-2026-10-05.md). Current Louisiana wrongful death was captured but remains uncomputed: Article 2315.2(B) uses the longer of one year after death and two years after injury, and medical malpractice has a separate subsection. The 2025 transition remains unresolved.

Kentucky's current captured section is effective July 15, 2026; the branch withholds earlier dates pending historical review and excludes Motor Vehicle Reparations Act claims. Louisiana's ordinary two-year branch requires an action arising after July 1, 2024 and withholds that boundary day and earlier dates. Wyoming representative-appointment tolling remains an explicit unresolved-issue gate. No special product/mass-tort branch was inferred from these ordinary-injury rules.

Primary statutory text gaps remain AR, GA, MS and TN. GA has an enacted 2015 source but an unreconciled 2016–2024 amendment interval; proposed/dead bills in other states are not operative authority. NJ has captured enacted text but current codification retrieval failed. OR still requires source/currentness and legal mapping work. The six jurisdictions AR, GA, MS, NJ, OR and TN have no active general baseline. State-specific product and death coverage is narrower than the jurisdiction total.

The Open US Law hold remains unchanged. The navigation repair exposes all 50 states and DC once, linking to recorded official sources and available saved statutory text. It does not claim that full state codes are stored or current. Official-source browsing also remains available when the separate stored-corpus service fails.

## Release evidence and remaining publication step

All private files are under `private/audit-2026-10-05/state-law-restoration/`:

- `before/`: exact published 118 rules/catalog, protected bundle before-images and active manifest.
- `captures/`, `source-review-receipts.json`, `storage-receipts/`: ten newly captured statutory originals and whole-object cloud SHA-256 readback receipts.
- `intake.jsonl`: 29 private `corpus-legal-review` entity envelopes, including 10 sources, 12 changed/new rules and 7 coverage rows.
- `apply-reviewed-coverage.sql`: preserved original 201,605-byte draft, SHA-256 **`3ac1fdb06b2f9d5fff3364ee108c645dab798aecae4a0985de73cd59676a6139`**. It failed with `42P01` in the filter-refresh CTE and was rolled back; **never execute it again**.
- `apply-reviewed-coverage-v2.sql`: corrected `.2` transaction, run **`2ff88e16-2fdd-4672-bbf3-d65795542271`**, 198,724 bytes, SHA-256 **`61dd0dec4fd4f6f28bb455b48fc925a711c19a35280929129040377805ead4de`**. It changed only the malformed refresh block, passed explicit-rollback runtime validation, then committed.
- `import-manifest.json`: preserved preparation-time manifest; its `prepared_not_applied` status is historical and does not describe the now-completed run.
- `manifest-candidate.json`: `.2` bundle manifest. The application now locally selects the `.3` manifest; its hash and publication state are recorded above.
- `manifest-upload.json` and `bundle-upload-receipt.jsonl.complete.json`: `.2`'s 14 changed protected files (492,165 bytes) uploaded with complete SHA-256 readback. `.3` has its own verified packet and receipts in the release-3 directory.
- `opinion-captures/`: official Utah/Nebraska opinion PDFs and a blocked DC capture, retained as private supporting research. These are not additional published judicial-reference rows.
- `ar-ga-ms-tn-discovery/`: exact source and access-block evidence; no additional calculator activation.

Both transactions and the independent 124-row REST/citation-link reconciliations are complete. The `.3` manifest is locally activated and its SHA-256 is recorded above. Remaining work is to verify Lovable synchronization and publish the site, then check the live calculator and state browser, including KY/LA boundaries, distinct injury/death periods, citation links, unique state choices and source-text downloads. Keep raw versions and all unrelated publication holds.

Do not rerun preparation/export scripts blindly: they intentionally use exclusive creates. The original `.2` SQL checksum above identifies a failed, rolled-back draft; the corrected checksum identifies the committed `.2` transaction. The `.3` transaction checksum is in the NC candidate checkpoint.

Earlier validation: TypeScript and scoped ESLint passed; full Vitest passed 638 tests with one existing skip, and the production build passed. Latest release validation is 47 release tests plus 18 NC boundary cases and `tsc --noEmit`. Live-site/browser verification remains pending until Lovable publication.
