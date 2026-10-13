# Regulatory evidence and browser-local work product

The public monitor reads source evidence through
`src/lib/external/regulatory.functions.ts`. Administrative acquisition runs
separately in `scripts/ingest/regulatory`. App requests cannot open, capture,
ingest, finalize or enroll members. The owner chose an ungated, browser-local
workflow: investigations, notes, watchlists and briefs stay in IndexedDB.

Install `database/contracts/corpus-regulatory-monitor-v1.sql` after
`corpus-ingest-v1.sql` and `canonical-integer-jsonb-v1.sql`, then install
`corpus-regulatory-evidence-read-v1.sql`. The additive contract creates a bounded
read-only source snapshot RPC and disables the unconfigured manufacturer-
communications adapter. Existing collections, graph holds and deletion
decisions remain unchanged. RPCs are service-role only, `SECURITY DEFINER` with
an empty search path; tables also use RLS without browser-role policies.
Install `corpus-regulatory-run-read-v1.sql` for administrative recovery: it reads
one exact run beyond the overview's last-100 history limit and has no website
entry point. Durable packet/raw readback must precede opening a collection.

Run `node --test src/lib/regulatory/contract.test.mjs` with the existing pinned
PGlite runtime (`PUBLISHER_CODE_PGLITE` can identify it). Tests never contact the
live corpus. `core.test.ts` and `localWorkspace.test.ts` use ordinary Vitest.

## Evidence and coverage

The registry excludes `open_us_law` and `cpsc_injury_data`. CPSC recalls are a
separate approved source. Payloads use the exact `regulatory-record/1` keys in
`types.ts`; hashes use `corpus_ingest.canonical_integer_jsonb_sha256_v1`.
Capture URLs, retrieval times and extraction pointers are provenance rather
than source-content hash fields, so pagination changes do not create revisions.

An open collection leases its source. Originals go in private `corpus-originals`
at `regulatory/<first-two-hash-characters>/<sha256>.raw`. The collector verifies
complete readback hashes. Capture registration checks the matching receipt,
private bucket, object key and byte length. The database cannot itself fetch
storage bytes: complete readback remains a collector obligation, covered by
transport tests and the retained creation/readback journal.

Intake retains immutable versions/observations in `corpus_ingest`, in new
`regulatory:<source>` namespaces. Only a completed collection with reconciled
expected/distinct-native counts creates public records/events. Failed/partial
collections remain visible as coverage limitations; their staged versions are
excluded from public detail. Later transitions have separate run-bound
identities, including A→B→A→B. Same-run replay is idempotent. Older dated
backfills never overwrite newer source revisions.

Coverage dates are extrema of completed declared collection windows, not proof
of continuous coverage. Overview returns recent exact run scopes/counts/status.
Counts describe retained source records or source-version events, never
injuries, unique products, claimants or risk. Published-date and detected-date
trends are explicit alternatives. Missing publisher dates are not invented.
Zero means no stored matching events, not proven zero real-world activity.

## Browser-local workspace

`localWorkspace.ts` stores an atomic, versioned IndexedDB document. There is no
account, organization membership, server write or sign-in requirement.
Transactions serialize edits across tabs. Each successful change increments
the revision; mutable investigations/watchlists retain before-images;
reviews/briefs are immutable records. Quota/storage failures are visible, never
reported as successful saves. Work is scoped to this browser profile and
origin. Clearing site data, private browsing, a new device or a different
domain can make it unavailable. Export backups regularly.

Saving a review/brief reads selected existing event IDs from the source server.
Only event IDs and public search filters are sent; private titles, notes and
investigation IDs stay local. The response pins source payloads, raw hashes,
capture URLs/pointers, parser identity, exact collection scopes/counts,
qualifications and current payload hashes. The browser checks the manifest and
every source payload hash. Integrity checks do not establish current law,
causation, liability or continuously current source status.
An explicit source recheck compares up to 100 saved event identities in small
sequential requests. A later version flags reconsideration while preserving
the original review note, status, event and payload hash. Check metadata has
its own revision evidence. An unavailable check retains the last successful
timestamp and is labeled unavailable; saved results never imply continuous
source verification.

Exports contain the full workspace, revision history, retained source manifests
and a canonical checksum. Import validates format, sizes, identities,
relationships, hashes and capture bindings before one atomic merge/replace.
A conflicting merge leaves existing work unchanged. Imported reviews/briefs
are marked `imported_unverified` even when checksums match: a checksum is not a
server signature. Creating a fresh source-backed review/brief checks the
selected evidence again. No imported work product creates corpus source rows.
The workspace is capped at 32 MB; compact backup envelopes allow up to 40 MB so
a valid saved workspace can be restored without exceeding its import cap.

The initial base migration also contains isolated server work-product tables
and membership RPCs. These are unused by the chosen local workflow and have no
website entry points. Browser roles have no grants and RLS remains enabled.
Do not enroll users or enable another mode by implication. The website's
external corpus transport remains read-only.
