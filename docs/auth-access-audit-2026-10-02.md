# Atlas P0 access boundary — October 2, 2026

The local implementation now admits any provider-verified, non-anonymous application account with a confirmed email, matching the user's latest choice. Corpus server functions, artifact delivery, cached snapshots, and data providers remain unavailable without that verified account. Production has not been changed by this review.

## Confirmed findings

| Finding | Evidence and impact | Local change |
| --- | --- | --- |
| Unauthenticated database reads | `src/start.ts` attached browser tokens but had no server authorization. None of the 24 external read server functions used the generated `requireSupabaseAuth` middleware. Anonymous HTTP callers could reach the server's external corpus credentials. | Global HTTP and direct-function account guards in `src/start.ts` and `src/lib/auth/access.middleware.ts`. Denial occurs before dispatch/database reads, including direct calls during SSR. |
| Unauthenticated private artifact proxy | `src/routes/api/files.ts` looked up ready artifacts and streamed private storage without an identity check. A private bucket alone did not protect the app proxy. | The route calls the same verified account guard before artifact lookup. Responses prohibit shared caching. Existing ready-only artifact lookup remains intact. |
| Public dataset distribution | Initial inventory: 324 files, 148,175,952 bytes under `public/data`; the atlas bundle alone was 6,539,722 bytes. Static serving does not invoke React or server-function authorization. | Root owns the separate verified relocation to `private/data`, build exclusions, authenticated snapshot-page API, and client adapters. An auth screen alone is insufficient. |
| Whole-directory HTTP exports | `directory.functions.ts` returned entire court/judge directories, aggregating backend pages inside one HTTP response. | Two validated 500-row server functions now expose explicit continuation offsets. Browser wrappers preserve existing folder-view arrays. Safety-cap exhaustion throws rather than presenting a truncated whole-directory count. |
| Unrestricted provider startup | Atlas and Corpus providers mounted before any verified access decision. | `CorpusAccessGate` mounts providers only after the server verifies the account. Data SSR is disabled, and all HTTP/direct reads still have independent server guards. |
| Retired static URLs fell through to the shell | Removed `/data/atlas-import-bundle.json` initially returned HTML200 instead of a missing-asset response. | Global middleware now returns 404/private no-store for obsolete data-file extensions and encoded/malformed variants, while preserving real `/data`, `/data/$dataset`, and `/data/tables/$table` browser routes. |

All findings are high-confidence traces of reachable code. No credential, publisher document, private database record, or authenticated user session was exported during this review.

## Authorization and session rules

- `requireCorpusAccess(request)` calls Supabase `auth.getUser(token)`. It does not trust a decoded JWT, browser session object, email typed into a form, `user_metadata`, or an anonymous Supabase identity.
- Any account with an auth-provider-confirmed email can enter. Anonymous identities, missing email, and unconfirmed email are rejected. There is no invitation configuration or browser-metadata authorization.
- The existing Supabase client/auth attacher/generated middleware files are unchanged. The new guard is separately maintained and globally registered.
- An explicit bearer header takes precedence over cookies; malformed bearer credentials cannot fall back to a valid cookie.
- After verification, the session function establishes a five-minute HttpOnly, SameSite=Lax, Secure host cookie. HTTP loopback development alone uses a separate non-Secure local cookie. Cookies carry no user-controlled authorization decision. Every protected request revalidates its credential and confirmed account with Supabase.
- Same-origin POST `/api/auth/logout` clears the cookie even after the JWT expires. Cross-origin/missing-origin requests cannot clear it. The sign-in UI requests a magic link with `shouldCreateUser:true`, supporting both sign-in and new confirmed-email accounts.
- Function/artifact responses use `Cache-Control: private, no-store` and vary by Authorization/Cookie. Denials return generic 401/403/503 messages without provider errors or configuration values. Auth-provider failures and rate limits fail closed.
- Per-request verification is shared only for that exact Request object; there is no global account or token authorization cache.

## Configuration required before release

1. Use the same application auth project for `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` and browser `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. These publishable credentials authenticate users; external corpus credentials remain separate and server-only.
2. Enable the application's email auth provider and confirm working magic-link delivery. The user selected account access; no owner invitation/allowlist is required.
3. Configure an allowed auth callback origin, including the final production domain. Do not commit user identities, session tokens, or private keys.
4. Complete a real signup/email-confirmation/sign-in test using an authorized account. Confirm anonymous and unconfirmed-account requests remain denied.

Local environment inspection emitted only variable names and project references: both application auth URLs identify `nxhoiincomzahugvwwbb`; the external corpus is `xosqzzsnhxcyehcnirpa`. Root's connected tool was denied read-only auth-user access to the application project.

**Concrete release blocker:** root's read-only `/auth/v1/settings` check on the actual application project returned `disable_signup=false`, `mailer_autoconfirm=false`, `external.email=false`, `external.anonymous_users=false`, and all external providers disabled. Signup is not disabled, but email authentication currently is; the magic-link UI cannot work until the email provider and redirect/delivery configuration are enabled. This agent did not mutate auth settings or claim an end-to-end login passed.

Root separately reported a read-only external corpus audit at 17:36:05 UTC: no anon/authenticated-executable corpus functions, no browser-granted unprotected relations, and a private corpus-originals bucket. Those database results are root-provided evidence; this agent made no database calls or RLS changes. The application-level proxy/static gaps still required the changes above.

## Validation

103 focused offline tests pass across the account/auth, obsolete-asset middleware, directory paging/grouping, artifact route, and private snapshot reader suites. Coverage includes anonymous/forged/unconfirmed identities, account access without an invitation list, provider outages, request-local caching, cookie precedence, same-origin logout, denial before artifact/database dispatch, encoded obsolete assets, fixed page limits, oversized provider pages, and truthful folder-view truncation handling.

The independent private-reader tests also check authorization before cached bytes, path traversal/unlisted-file rejection, SHA-pinned continuation pages, page-range errors, private error headers, complete original byte/hash verification, and the 256KiB response limit. They use synthetic in-memory snapshot bodies and a mocked storage transport. Root owns the snapshot publisher/client/reader implementation. Cross-worker auth/rate stop propagation and serialized durable receipt writes were identified in review and are now present in root's publisher.

Runtime checks on the actual local dev server at port 4174: a compiled getEntity server-function URL with the browser Origin header returned 401, JSON sign-in denial, `private, no-store`, and Authorization/Cookie Vary. Old atlas JSON and encoded registry JSONL URLs returned 404/private no-store; `/data/mdls` remained a valid HTML200 browser route. Root separately confirmed anonymous bundle/artifact requests returned 401 and development `/@fs/.../private/data` returned 403.

Independent final account-mode production-build audit at 18:06:55 UTC: 111 public files / 1,807,231 bytes, no data directory, JSON/JSONL files, or source maps. All 324 private file SHA256 hashes and exact manifest storage keys were compared against every public asset with zero matches. A separate sample of 804 long embedded source markers across 227 parseable private JSON/JSONL sources also had zero matches. No private manifest schema, external corpus project/secret variable, service-role variable, opaque secret-key, Firecrawl/Tavily-key, or JWT patterns matched. The expected publishable client auth key appeared twice in one SDK asset in the initial build; its value was not printed. Final public asset-set SHA256: `d55f58770b31eadb7736701080cce37240be06a29a0c4db8420bcc8d58fe3c5a`. This is a scoped build-content check, not a complete proof against arbitrary embedded strings or a legal license determination.

The direct installed compiler command is `node node_modules/typescript/bin/tsc --noEmit --pretty false`, run from the compass repository. Its final run passed after the shared fixture corrections. Root also reported the full suite passed 352 tests with one skip and the latest production build passed. Tests use synthetic offline identities and mocked providers; they do not impersonate actual users or prove a production login. No production deployment, auth-account mutation, database mutation, or filesystem deletion was performed by this agent.
