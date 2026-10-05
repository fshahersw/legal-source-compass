# Fix: bundled data missing on the published site (firastest1.com)

## Diagnosis (confirmed from live logs)

The published site's server logs show every `/api/bundles` request failing with
503 "Private snapshot is temporarily unavailable" (catalog-matters.json,
mdl-documents/master-dockets.json, matter-registry/*.jsonl, etc.), while live
database lookups (MDL pages, datasets) return 200. The dev preview works.

Root cause: `src/lib/private-data/snapshot.server.ts` reads
`process.env.EXTERNAL_SUPABASE_URL` / `EXTERNAL_SUPABASE_KEY` inside the request
handler and throws "Private snapshot storage is not configured" when they are
absent. Those variables exist as project secrets, but they are not injected into
the published server environment — only into the dev sandbox. So on
firastest1.com every bundled-data page (map insights, source catalog, matter
registry, MDL docket documents, registry V2.2, state court links) renders empty
or error states, while pages served from the external database still work.

## Fix

1. Re-publish the two existing secrets (`EXTERNAL_SUPABASE_URL`,
   `EXTERNAL_SUPABASE_KEY`) so they are injected into the published server
   environment (secrets--set_secret with the same values; no new secrets, no
   code changes, credentials never leave the server).
2. Verify on the live site:
   - `GET /api/bundles?file=corpus/insights.json&page=0` returns 200 (not 503).
   - Published worker logs show no new "Private snapshot" 503s.
   - Spot-check one affected page class (e.g. an MDL page's docket documents,
     the source catalog) renders data on firastest1.com.
3. If the secrets route cannot inject them into the published worker, fall back
   to a code change: read the values through the existing server-env mechanism
   used by `src/lib/external/rest.server.ts` (which already works on published),
   keeping the exact URL guard and checksum verification unchanged.

## Out of scope

- No change to the auth gate (`CORPUS_REQUIRE_AUTH` stays off).
- No change to snapshot format, storage keys, or client code.
