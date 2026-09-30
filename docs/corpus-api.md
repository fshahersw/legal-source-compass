# Corpus Search API — for research agents

Read-only HTTP API over the legal source corpus (~5.3M records, 71 datasets).
Base URL: the published app origin. All endpoints require the header
`x-api-key: <CORPUS_API_KEY>` and answer JSON. CORS is open for GET.

## Endpoints

### GET /api/public/corpus/capabilities
Reports what the backend supports, including whether semantic (vector) search
columns were detected. Check this first; `semanticSearch.available` is
currently `false` (keyword search only).

### GET /api/public/corpus/datasets
Lists every dataset: `id`, `label`, `records` (null = too large to count),
`columns`, `filters` (facet definitions with option counts), `qualification`
(honest caveats about the data — always read and relay these), `aliases`.

### GET /api/public/corpus/search
Bounded, paginated search.

| Param | Meaning |
| --- | --- |
| `q` | Keyword query, 2–200 chars. Ranked by the database; nothing is re-scored. |
| `dataset` | Scope to one dataset id (from `/datasets`). Omit to search everything. |
| `limit` | 1–100, default 50. |
| `offset` | 0–1,000,000, default 0. |
| `filter.<key>` | Metadata filter, e.g. `filter.state=TX`. Discover keys per dataset via `/datasets`. |

Response: `{ items, total, totalCapped, limit, offset }`. `total: null` means
"too large to count" — never treat it as zero. Each item carries `id`,
`dataset`, `title`, `state`, `county`, `kind`, `source_url` plus
dataset-specific fields.

### GET /api/public/corpus/record/{id}?dataset=<id>
Full detail for one record: `facts` (label/value pairs), `links` (always
prefer the official `source_url` when citing), `sections`, `text` (with
`textTruncated` flag), `photo`, and the record's `qualification`.

## Rules for agents

- Always cite `source_url` when present; it is the original publisher.
- Always relay `qualification` text — it states what the data does NOT cover.
- `null` counts mean "not recorded / too large to count", never zero.
- 401 = bad key, 400 = bad params, 404 = record not found, 503 = not configured.

## Semantic search

Not yet available: the corpus has no embedding columns (verified read-only via
`/capabilities`). Adding it requires pgvector plus a one-time embedding
backfill in the external database — a database-side change outside this app.
