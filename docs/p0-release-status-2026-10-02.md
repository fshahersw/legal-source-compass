# Atlas P0 implementation and release status — October 2, 2026

The application changes are implemented locally and have not been deployed. The TopVerdict quarantine has been executed and independently verified in the connected corpus database. P0 is not complete while production exposure, authentication configuration, repository history, domain selection and the remaining provenance review are unresolved.

## Completed implementation

- Account access follows the user's latest choice: any provider-verified, non-anonymous account with confirmed email. The server validates sessions for every server function, snapshot page and artifact request. Browser profile fields do not grant access. Sign-in permits account creation; there is no invitation requirement.
- All 324 former static snapshots were moved byte-for-byte out of `public/data`. They represent 148,175,952 file-occurrence bytes and 314 unique objects / 121,484,393 bytes. Every private cloud object was downloaded back and verified against its SHA-256 and byte count. Originals are retained locally under ignored `private/data`.
- `/api/bundles` serves bounded 256 KiB pages from an exact server-side manifest, verifies the immutable whole-object checksum, and requires authentication even for cached objects. The browser verifies the assembled bytes. Court/judge directory requests are capped at 500 rows per page. All snapshot loaders and download links use the protected transport.
- The public build contains no copied snapshots or private object keys. Old `/data` asset URLs return 404/no-store. Legitimate `/data` dataset-browser routes remain available behind the account screen. Vite denies filesystem access to the private directory and refuses a build if `public/data` reappears.
- `/sources` redirects to `/sources/library`; the browser reaches the sign-in page rather than a broken route.
- Search now derives descriptive regulation titles, preserves different toxicology chapter URLs, groups only exact duplicate source identities/payloads, and prioritizes matching litigation records. A real database query retrieves talc MDL 2738. Its missing Daubert records mean the full requested benchmark remains incomplete.
- Court-location derivation fills 869 of 968 previously unresolved case state tags (89.8%) using exact native court IDs. The saved snapshot now maps 518 New Jersey rows; 99 remain unresolved. Recorded source fields are preserved. Court location is not treated as governing law. National/multi-state source rows are not assigned arbitrary state tags.

## Live database change

The original TopVerdict source explicitly states `export_allowed=false` and `publisher_terms_prohibit_reuse_local_research_only`. The exact 3,312 rows were archived with their original fields and search vectors, along with the dataset and two context snapshots, in an RLS-protected administrator-only table. The queryable rows were removed and readiness disabled. Verification found zero remaining public projection rows, zero archive hash mismatches, and no browser-role archive SELECT permission. Private PDFs and unrelated paid DocketBird intake were unchanged. Recovery SQL preserves the hold until reuse rights are separately established.

The public corpus schema audit found no unprotected relation with browser-role SELECT and no corpus RPC executable by `anon` or `authenticated`. The `corpus-originals` bucket is private. This does not substitute for auditing the distinct application-auth project.

## Validation and reproducibility

The full local suite passes 352 tests with one existing skip across 43 suites. The final application build and direct TypeScript check pass. Separate runtime requests verified anonymous 401/no-store for protected bundle/file/database-function requests and 404/no-store for obsolete data asset URLs. The local browser verified the source-route redirect and sign-in screen. A real confirmed-email login has not been completed.

Public build checks compare every asset against all 324 source checksums and private object keys; none is present. Account-access changes subsequently rebuilt successfully; final static verification is recorded with the release evidence.

Private snapshot tests intentionally require the original protected data, not copied public fixtures. For a fresh authorized checkout, set `EXTERNAL_SUPABASE_URL` and `EXTERNAL_SUPABASE_KEY` in the local process environment, then run `node --use-system-ca scripts/admin/restore-private-test-snapshots.mjs`. It restores only manifest-pinned objects into ignored local storage, refuses changed existing files, and verifies sizes/hashes. It verified all 324 existing files during this run. Do not put the server key in tracked `.env` or a browser variable. Production builds read the server manifest and cloud objects; they do not require local source snapshots.

## Outstanding release work

1. Enable the email provider and approved redirect URLs in the application's Lovable-managed auth project. Read-only settings returned signups allowed, email auto-confirm off and all sign-in providers disabled; Lovable's Users screen independently shows “No sign-in methods are enabled yet.” The connected corpus Supabase MCP cannot administer that separate app project. The initial owner-invitation question is superseded by the user's account-access choice.
2. Complete a real confirmed-email sign-in and protected data read, then publish and repeat the anonymous-access checks on the production domain. The currently deployed site still serves the previous version and previously exposed snapshots.
3. Resolve GitHub exposure. The repository is public and its history contains the old bundles. `/private/` is now ignored and no private source files are tracked. This prevents new accidental commits but does not remove historical copies. The user has been asked whether to make the repository private; no visibility change or history rewrite has occurred.
4. The final domain name is still awaiting the user's choice; no domain was purchased or changed.
5. Finish source-by-source licensing and semantic privacy review. The audit cannot certify absence of confidential/client material throughout every database table and PDF. Exact lineage was established for 528 named party/counsel/caption rows, but missing upstream privacy/rights fields are not permission for public redistribution. The two XLSX bodies and private PDF corpus have not received a complete content review. Existing account access does not establish reuse rights.

Related reports: `auth-access-audit-2026-10-02.md`, `p0-provenance-hygiene-review-2026-10-02.md`, and `p0-search-state-accuracy-2026-10-02.md`. Private execution receipts, immutable source inventory and upload/readback checks are stored under the administrator's corpus cache and are not published in the browser bundle.
