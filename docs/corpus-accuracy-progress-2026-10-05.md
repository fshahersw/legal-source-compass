# Accuracy and interface progress — October 5, 2026

**Latest connected checkpoint:** calculator release `2026-10-05.4` is published through Lovable and production bundle readback verifies all 13 changed files. It contains **124 rules, 87 conditional baselines across 46 jurisdictions, 37 research rules, 99 authorities (93 statutes and six supporting authorities), and 15 judicial references**. [Oregon's ordinary-negligence review](limitations-oregon-review-2026-10-05.md) now compares independently confirmed accrual and act/omission dates, with exact historical boundaries and exclusions. Independent SQL and all-124-row REST comparisons passed; private/public before-images remain retained. General baseline gaps remain **AR, GA, MS, NJ and TN**; full-code, special-claim and historical coverage remain incomplete.

The [docket PDF repair](docket-pdf-version-reconciliation-2026-10-05.md) registered **293 exact current native-document/source-version links** using whole-object-verified PDFs already stored, with zero source PDF requests, uploads or new objects. All 293 now resolve through the existing read-only app lookup. The frozen eligible scope has 889/909 exact current-version associations; **20 MDL 3166 byte-size conflicts remain held**. The [second frozen docket import](docket-second-frozen-import-2026-10-05.md) is completed: 12,450 observations, 1,830 new versions and 5,385 verified public entry rows; the catalog has **64,475 entries**, including 480 for Roundup. Three later frozen plans and the latest unpackaged 2,500 entries remain pending. The separate traversal has 25,035 IDs and five partial cursors. Do not replay completed runs.

[Texas](texas-intake-checkpoint-2026-10-05-1930.md) has all **5,023 objects / 165,260,936 bytes** registered privately with whole-object verification. One of 254 batches (500 records) is independently verified at the latest completed pass; the same pinned runner is actively refreshing and importing the remaining 253 batches. Inspect its live process/lock and latest result before resuming; do not start a second runner. It remains incomplete and unpublished. [Washington](washington-complete-title-continuation-2026-10-05.md) has **100 observed Complete Title PDFs**, three separate archived Title 43 chapter supplements and four current-code Title 25 chapter PDFs. These captures are verified; authority mapping, registration and publication remain open. The Title 25 archive mislink remains unresolved. [New Jersey](new-jersey-full-code-capture-2026-10-05.md) retains 56,331 section occurrences and all 20 observed later chapter laws through c.50, with legal reconciliation still open. Florida's 638 captured chapter bodies are not a complete current-law certification.

Authenticated Supabase/Lovable connections work. Preserve the Open US Law and legal-graph holds, the deleted judge-disclosure/URL-directory decisions, raw versions, before-images, source restrictions and quota safeguards. Captures, queued intake, excerpts and partial scopes are never completion by implication.

This checkpoint supersedes older preparation and count descriptions below.

## Shipped source corrections

The bounded CourtListener refresh checked 41 pinned native docket identities. Four access-blocked scopes remain blocked. The guarded public projection refreshed 34 existing master-docket records with source checks and retained before-images; 17 last-filing dates changed. Original selection dates remain separate from source-check dates. This does not establish complete or current member-case coverage.

Run `65881579-a4ad-462a-a4ca-70aa36063a62` retained 405 docket-entry observations and 896 nested RECAP document observations. Its public projection refreshed 405 rows (60 new), bringing the global entry catalog to 63,973 while preserving all other scopes and facets. Hash-verified before-images retain all 345 changed existing rows. The guarded coverage transaction refreshed 17 matter records and retained their previous snapshots in the audit ledger. MDL 3114 reached the final entry page; 16 other selected masters retain partial cursor coverage and do not claim a freshly checked provider total.

All 41 refreshed docket headers' assigned-judge strings match the matter registry. This comparison checks source strings, not independent judicial appointments or membership evidence.

The 896 observed document versions include 12 meeting the strict public-availability, unsealed-status and restricted-text rules. All 12 now have registered source-native associations matching the current provider SHA-1. One newly acquired PDF added 270,857 bytes after authenticated full readback. Three previously queued but unregistered associations were repaired against existing verified bytes, with zero repeat downloads. The other 884 observations remain outside this eligible denominator; this does not claim all docket PDFs are available.

## Interface and document identity

The app has four shorter navigation sections, a matter-oriented home map, stronger contrast, and court marks downloaded unmodified from official court sites. `public/court-marks/manifest.json` records image sources and checksums. Source details and historical document samples are disclosures instead of large default text blocks.

Verified PDFs are grouped only by complete SHA-256, preserving every provider/native-case/native-document occurrence. Filtering promotes a matching occurrence without losing aliases. Timeline joins use exact native entry identities; identical bytes alone never assign a file to another docket entry. Held documents remain separate. A claimed complete coverage flag is rejected when captured rows fall below the source total. Unknown native case IDs cannot merge cases.

GovInfo records now participate in document parsing and downloads. An actual GovInfo PDF request returned HTTP 206, the expected content hash, and `%PDF-1.6` through the app. Loaded raw source counts, rejected records, held records, and unique open PDFs have distinct meanings.

The member-case view now prominently distinguishes its bounded loaded sample from the full registry and links to the complete database search. Browser verification found native docket `3:21-05616`, positioned beyond the first 3,000 rows, through that full search. Exact metadata option labels replace raw enum values in generic tables. Documents initially show open PDFs; held records remain explicitly selectable.

## Validation and remaining limits

The full application suite passes: 68 files, 618 tests passed, one skipped. TypeScript and the production build pass. The generated legal contract check passes with LF-normalized hash inputs.

The separate database legal-deployment gate returns `passed: false` because a reviewed deployment baseline has not been established. This gate was not bypassed and no reviewed baseline was invented. Its detailed validation result is retained privately.

The storage audit verified all 21 registered archive manifests and their 1,496 chunk keys. All inventoried references resolve without size conflicts. It reduced apparent unreferenced storage from 9,542,053,304 bytes to 217,348,229 bytes across 2,612 objects, then traced every residual to private preservation ledgers. No residual was proven orphaned.

A separate audit verified the full bodies of 30 duplicate-path pairs. The completed consolidation removed 29 redundant copies (9,833,011 bytes), retained every canonical/bundle/archive object, and kept all 30 artifact routes, filenames and readiness flags intact. The one pair whose two keys both have immutable provenance references remains preserved. Exact REST before-images, database cleanup decisions, complete recovery copies and Storage API receipts support recovery. The one affected publicly available file still returns HTTP 200 and the identical whole-file hash through its original URL. See `storage-residual-review-2026-10-05.md`.

The checked UI through commit `85b0cd8` is synced through the connected Lovable project and was published to `firastest1.com`. Live browser verification shows the simplified navigation, official seal, updated source-check date, current entry counts, partial coverage label and open-PDF default for MDL 3047. This UI release does not approve or release the separate staged legal graph.

The user authorized automatic continuation in this chat. Hourly heartbeat `continue-legal-source-compass` is ACTIVE; it checks current quota before resuming the exact saved cursors. `corpus-continuation-checkpoint.md` records commands, remaining scopes and publication holds. Broad corpus completion is still in progress.

Raw evidence, private before-images, source payloads, and validation logs remain in the ignored `private/audit-2026-10-05/` directory. Credentials are outside the repository. Broad corpus completeness and nationwide legal currency are not claimed.

## First continuation heartbeat

The 08:56 UTC heartbeat left source acquisition deferred until the required 10:55 UTC threshold and made no CourtListener calls. Network-disabled validation confirmed all 21 saved response/provenance pairs and all 16 remaining cursors. No source counts, memberships, publication holds or storage objects changed.

The collector now verifies cached raw hashes and exact receipt identity, preserves immutable response versions and retrieval receipts before refreshing, and forces actual source requests for header refreshes. Relation scopes require a current unblocked header (at most 24 hours old); known holds stay held. Fresh checks with unchanged bytes survive service restarts, and header selection follows retrieval time instead of file order. Quota waits longer than 60 seconds defer the pass with its task and cursor intact. Thirty-five local regression tests passed, including archive readback failures, tampered evidence, stale headers, source stops and quota stops; this is mocked/local validation, not a new source acquisition.

The seven listing-total exceptions were reconciled against exact target-project row counts. Five counts use documented different record units; two are intentionally empty held collections with historical snapshot metadata. The dataset inventory now identifies imported record counts and labels held/unpublished collections. Unknown totals remain unrecorded, and source titles wrap on narrow displays. Exact read-only catalog before-images and validation evidence are retained privately under `heartbeat-0857`.

Commit `127b570` passed the production build, TypeScript and scoped ESLint checks, synced to Lovable, and is published on `firastest1.com/data`. Live verification shows 96 datasets, 6,080,731 imported rows and all 11 held badges; a narrow-display check showed no horizontal overflow. The held law collection still returns no published rows. Screenshot evidence is `private/audit-2026-10-05/heartbeat-0857/inventory-live.jpg`. No source acquisition occurred during this heartbeat; the continuation remains ACTIVE with all 16 cursors pending a fresh quota check after 10:55 UTC.
