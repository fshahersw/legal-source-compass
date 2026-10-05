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
