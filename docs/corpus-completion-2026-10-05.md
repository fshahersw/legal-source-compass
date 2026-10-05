# Corpus improvement checkpoint — October 5, 2026

Target: Legal Source Compass, Lovable project `0eaa0e9a-7dcd-41f1-a5ef-3a5305288c1c`, repository `fshahersw/legal-source-compass`, external corpus `xosqzzsnhxcyehcnirpa`.

Starting commit: `4fb7b8d`. The owner requested accuracy in matters, MDLs, dockets, members and documents; simpler navigation and stronger visual identity; missing data acquisition; and space reclamation without losing valuable source records.

## Verified baseline

- The specified Supabase project is accessible through its existing private server credentials and dashboard. The shell's unrelated default `SUPABASE_URL` is not used for this work.
- The supplied CourtListener key matches the existing private ingestion credential. The usage API returned 86 requests remaining in the 1,400-request daily window, with additional 25/minute and 300/hour limits. New collection must remain bounded and checkpointed.
- Read-only database size inspection: `public.corpus_records` occupies approximately 60 GB including indexes and TOAST, far larger than any individual ingestion table. This is a measurement, not a finding that its data is disposable.
- The PDF transfer pipeline already uses content hashes, verified object readback and source-native associations. Display deduplication needs to preserve all docket occurrences and citations even where bytes match.

## Work in progress

1. Simplify the four-section navigation and increase contrast.
2. Group verified duplicate PDF bytes while preserving every provider/native-document/docket association.
3. Measure dataset and storage usage; distinguish held collections, useful originals and true redundant copies before any cleanup.
4. Check current priority docket metadata against CourtListener with a bounded request budget; retain source responses and provenance.
5. Run relevant tests, TypeScript and the production build; verify the resulting UI; commit and push checkpoints to the Lovable-connected branch.

Private audit outputs are in ignored `private/audit-2026-10-05/`. Credentials and raw corpus records must remain out of Git. A saved or imported record is not automatically a complete or current docket.

## Verified docket refresh

Run `b11bce32-fa58-4c07-a4ac-7cf830f44da0` completed on October 5 at 07:24 UTC. All 41 frozen priority master-docket IDs matched the expected full court/office/year/type/sequence key. Four source-blocked headers remain excluded from public refreshes. The native registry saved 41 observations and six new source versions.

The bounded SQL contract in `database/contracts/priority-docket-metadata-refresh-20261005.sql` refreshed dates and checked-at provenance on exactly 34 already-public, unblocked metadata rows. All 34 resulting records match their audited replacement fields. Full before-images remain in `corpus_ingest.cleanup_decisions`, with a guarded rollback documented in the contract. The update does not change captions, party records, membership evidence, PDF availability, or historical selection provenance. Fresh headers do not establish a current full-docket or member census.

Validation so far: full Vitest suite passed (613 passed, one skipped before the final additional regressions); TypeScript passed; production Vite build passed. Private test snapshots were restored from the existing hash-verified private bundle manifest. The byte-sensitive entry-analysis fixture is now protected against Windows newline conversion through `.gitattributes`.
