# Backfill gaps, polish the UI, and expose the corpus as a search API for research agents

## Part 1 — Backfill & UI polish (small, verified steps)

Known open gaps, in priority order:

1. **Rule/law pages**: add the "Title · Part · Subpart" line and "Dates & sources" tab (already in the roadmap; fields exist in the database, shown as "Not recorded" when absent).
2. **Coverage page**: the "Database records" column exists; extend it with per-collection breakdowns where the database can count them without timing out (verified per query, never guessed).
3. **UI polish pass** (kept small, no redesign):
   - Consistent empty/loading states across entity pages ("Not recorded" everywhere instead of blank cells).
   - Detail drawers: consistent section order and fact-table styling.
   - Map pages: clearer selected-state and hover feedback.
   - Anything you point at specifically — tell me what feels off and I'll fix that first.
4. **Backfill from the external corpus**: the corpus is read-only from this app, so "backfill" means surfacing more of what's already there — datasets not yet linked into pages (e.g. more linking tables on county/court pages). If you mean adding *new* data into the corpus itself, that has to happen in your external database, and I can give you exact import specs.

## Part 2 — The corpus as a programmatic search API for research agents

**Short answer: yes, largely.** The external corpus already behaves like one — this app is proof. It has:

- **Metadata filters**: every dataset exposes typed filter facets (state, county, kind, category…) via its listing metadata, and the `corpus_query_bounded` RPC applies them server-side.
- **Fast keyword search**: `corpus_query` / `corpus_query_bounded` are indexed SQL functions returning ranked, paginated results in well under a second across ~5.3M records.
- **Structured detail**: `corpus_detail` returns facts, links, sections and text for any record — exactly what an agent needs to cite sources.

What I'd build to make it a proper agent-facing tool:

1. **A public read-only API** under `/api/public/corpus/*` in this app (or directly against your external database's PostgREST — it's already there):
   - `GET /api/public/corpus/datasets` — dataset catalogue with filters and counts.
   - `GET /api/public/corpus/search?q=&dataset=&state=&…` — bounded, paginated search.
   - `GET /api/public/corpus/record/:id` — full detail with text and source URLs.
   - Secured with an API key header, rate-limited, CORS-restricted to your agents.
2. **Semantic search — the one real gap.** The corpus currently does keyword (ilike/full-text) matching, not vector similarity. True semantic search needs:
   - an embeddings column (pgvector) in your external database, and
   - a one-time backfill job embedding record titles/text (e.g. via a small embedding model).
   - First step is a read-only check: does your external database have pgvector enabled and any embedding columns already? If yes, this is cheap. If no, it's a database-side migration + backfill job I'd spec for you (it writes to *your* external DB, so you'd run it or approve it).
3. **Agent ergonomics**: an OpenAPI/JSON schema description of the endpoints plus a `SKILL.md`-style usage doc so research agents (Claude, GPT, custom scripts) can discover filters and cite `source_url`s correctly.

## What I need from you

- Priority order: backfill/UI first, or the API first?
- For semantic search: may I run a read-only check on your external database for pgvector/embedding columns?
- For the API: key-protected public endpoint in this app, or do your agents talk to the external database directly?

## Technical details

- API routes live under `src/routes/api/public/corpus/` as TanStack server routes reusing `src/lib/external/rest.server.ts` (read-only, secrets stay server-side).
- Auth: `x-api-key` header checked against a stored secret; constant-time compare; no user data exposed.
- All endpoints bounded (max page size, count caps) — same discipline as `corpus_query_bounded`.
- UI polish touches only presentation components; no data-logic changes; all 120 existing tests must still pass.
