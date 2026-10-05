# Accuracy and interface progress — October 5, 2026

**Latest connected checkpoint:** calculator release `.3` remains published (124 rules; 86 conditional baselines across 45 jurisdictions), with one state/DC entry per jurisdiction. The [second frozen docket import](docket-second-frozen-import-2026-10-05.md) has imported 12,450 observations, retained 1,830 new source versions and verified all 5,385 public entry rows by full readback. The catalog has **64,475 entries**; Roundup now holds 480. All 16 matter summaries and the completed bounded run passed independent SQL and full-record REST verification; prior records remain recoverable. Three later frozen plans and the latest unpackaged 2,500-entry capture remain open; the separate traversal has 25,035 IDs and five partial cursors. See [the published exact-document lookup](timeline-document-resolution-2026-10-05.md) for the fix beyond the broad archive cap and preserved held status.

State-code work remains incomplete: [Texas intake](texas-intake-checkpoint-2026-10-05-1930.md) has **2,724 verified object receipts, zero registered record batches**, and exited normally at the latest 1,000-object pass cap. Its remaining 2,299 assets are unattempted; all three historical unknown uploads now have matching whole-object receipts. The intake remains incomplete and unpublished. [Washington](full-state-code-acquisition-2026-10-05.md) has **58 captured Complete Title PDFs and 42 missing bodies** (three failed requests, 39 never attempted), plus its separate unresolved Title 25 mapping. [New Jersey](new-jersey-full-code-capture-2026-10-05.md) has three verified bulk archives, parser v5 with 56,331 section occurrences, and all 20 observed later chapter laws through c.50; authority, currentness, registration and publication review remain open. Florida's 638 chapter bodies are captured, not certified as a complete current-law release. General calculator baseline gaps remain AR, GA, MS, NJ, OR and TN, with special-claim and member/PDF coverage also unfinished. Authenticated Supabase/Lovable browser access works; use callable plugin connectors when available, without asking for another reconnection. Preserve holds, raw versions, before-images, deleted-collection decisions and all source/quota safeguards.

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
