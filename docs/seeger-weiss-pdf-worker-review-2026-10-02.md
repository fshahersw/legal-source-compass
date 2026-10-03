# Seeger Weiss PDF worker review — October 2, 2026

This review covers `scripts/ingest/backfill-pdfs-to-supabase.mjs`, the DocketBird queue generator and `database/contracts/corpus-pdf-assets-v1.sql`. Review operations were offline: no transfers, storage probes, database mutations or source-file deletions. Actual download/storage/registration counts belong to the worker and database receipts.

## Findings and changes

The original FileHandle write stream with `autoClose: false` completed the pipeline but hung at `handle.close()`. A local synthetic PDF-shaped byte stream reproduced this (`writableFinished: true`, `destroyed: false`). The replacement normal `createWriteStream(..., { flags: 'wx' })`, followed by reopening the file for `sync()`, completed immediately. Synthetic test bytes were not an acquired legal PDF.

The initial queue also allowed account-tracked matters without firm proof and silently collapsed duplicated CourtListener court/docket-number keys. Eight actual ambiguous source keys were found, including three opioid native IDs and the two distinct testosterone docket IDs. The reviewed V2 queue keeps account-only scope and ambiguous cross-provider references held rather than inferring a firm appearance or merging publisher identities.

Strict worker validation now requires `eligible === true`. Every source origin needs a 64-character native record SHA-256 and an observation time; an origin parent, when supplied, must equal the queue parent. The selected metadata version must be one retained origin. Restricted/unavailable provider flags, deceptive hosts, user-info URLs and mismatched native parent IDs are rejected. Source-native record hashes are metadata hashes, not PDF byte checksums.

The user authorized available PDFs in private storage. CourtListener `is_available: true` with explicit `is_sealed: null` therefore remains eligible **only as unknown-seal private quarantine**. Unknown is never changed to false; missing, string and malformed seal flags are rejected. The worker preserves native flags and records a separate `source_privacy_qualification`; all PDF assets remain private, including explicitly false seal flags. Absent case-blocking information is not invented as false.

The private registration SQL previously had a missing-value hole: `downloaded NOT IN (...)` returns SQL NULL when the field is absent, allowing the conditional to fall through. It now uses strict JSONB false/true/numeric-one comparisons. The SQL also checks exact origin hashes and parents, selected source version membership, timestamp casts, actual private storage object size and immutable byte/native association fields. It rejects PDF/download URL keys at any JSON depth, durable credential-bearing URLs and user-ID/token/signature query locators.

`pdf_asset_observations` preserves repeated queues and expanded origins append-only. Its SHA-256 codec is PostgreSQL JSONB text encoded as UTF-8; each observation has a composite foreign key to the immutable native-record/byte association. A repeat cannot silently replace a parent, provider flag or durable locator. Unknown-seal quarantine qualification is derived again by the server. All three tables have RLS and no public/anonymous/authenticated privileges; the fixed administrative RPC is service-only.

## Evidence

Five focused Node validation tests passed. A complete offline scan of the frozen DocketBird V2 queue reconciled **69,296 metadata rows: 23,887 private-download eligible and 45,409 held**; all eligible rows passed the tightened origin validator. These quantities are metadata eligibility, not PDF acquisition counts. Whitespace checks passed. This review runtime has no PostgreSQL parser; actual SQL creation and independent database reconciliation remain the root operator's verification step.

The server credential was checked locally without printing its value: the existing private preview configuration points to `xosqzzsnhxcyehcnirpa` and has the matching service role. No process environment credential is used. There was no pre-existing repository storage upload helper. For large or interruption-prone uploads, [Supabase's documented TUS flow](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) provides resumability; [bucket configuration](https://supabase.com/docs/guides/storage/buckets/creating-buckets) supports private access and upload limits. The worker must verify the full cloud object byte hash before unlinking its own temporary file, including after an unknown upload outcome.

Historical HTML-only research receipts remain unchanged. This worker review does not authorize a public PDF projection, claim a complete firm matter portfolio, declare every docket backfilled or verify legal outcomes.
