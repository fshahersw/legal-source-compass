# Semantic index refresh — runbook (wave 1025)

The search-by-meaning index (`semantic.chunks`, contract `database/contracts/semantic-v1.sql`) was built once by
`scripts/semantic/embed.py` + `load.py`: 892,561 passages in 8 collections. This adds a scheduled refresh so new, changed and
removed source records reach the index every night, within a hard token budget.

| Part | Where |
| --- | --- |
| SQL contract (queue, ledger, keys, cache, usage ledger, runs, RPCs, trigger, schedule) | `database/contracts/semantic-refresh-v1.sql` |
| Edge function (Deno) | `supabase/functions/semantic-refresh/` (`index.ts`, `serve.ts`, `refresh.ts`, `sources.ts`, `embed.ts`) |
| Exact TypeScript port of `chunking.py` | `src/lib/semantic/chunking.ts` |
| Golden parity fixtures (Python-generated) | `src/lib/semantic/fixtures/`, `scripts/semantic/make_chunk_fixtures.py` |
| Tests | `src/lib/semantic/chunking.test.ts`, `src/lib/semantic/semantic-refresh.test.ts`, `scripts/semantic/test_chunk_parity.py` (runs with `test_semantic`), `scripts/semantic/semantic-refresh-sql.test.mjs` |
| Operator tools | `scripts/semantic/refresh_seed.py`, `refresh_local.mjs`, `refresh_parity.mjs`, `bundle_refresh_function.mjs`, `refresh_smoke.mjs` |

## How it works

1. **Change capture.** Row triggers on `public.corpus_records` (filtered by dataset in the trigger's `WHEN`, so other
   datasets pay nothing) queue every insert, change of a field the builders read, and delete of the 7 corpus-backed
   collections; a `us_code_titles` change queues the sections of that title. A bounded nightly sweep (20,000 rows per run,
   rolling over the collections) compares each record's fingerprint with the ledger, as a safety net for writes the trigger
   did not see. `caselaw_scotus` is a dated snapshot (case-law reading store, 2026-09-30): only removals are detected (a case
   no longer in `caselaw.cases`); the 245 capped and the not-yet-embedded Supreme Court cases are not extended by the refresh.
2. **Rebuild.** For each queued record (oldest first) the database returns a pruned copy of the row — exactly the fields
   `scripts/semantic/sources.py` reads (`semantic.source_input`, mirrored by `refresh_rows.py`) — and the function rebuilds
   the document and passages with the TypeScript ports. Its fingerprint (sha256 of that pruned row) is the change test: a
   write that changes nothing the builders read is dropped in SQL without any work.
3. **Dedupe.** Every stored passage's embed key (sha256 of model, input type and the exact embed string, as `embed.py`
   computes it) is kept in `semantic.chunk_keys`, seeded from the batch build's shard metadata. Only passages whose key no
   stored passage and no cache entry has are sent to the embedding service, with the batch build's exact configuration
   (model constant in `embed.ts` only, 1,024 dimensions, input type `document`, float16 rounding and `.5g` text as
   `load.py`).
4. **Budget.** Before every request the function reserves an upper bound of its tokens (UTF-8 bytes + 8 per input) in
   `semantic.embedding_usage`; the database refuses a reservation that would pass the daily cap (default 250,000 per UTC day,
   refresh requests) or the global cap (400,000,000 over all embedding usage ever, the batch build included), and refuses
   everything until the ledger has its seed row. After the request the reservation settles to the billed tokens. A record is
   applied only when all of its passages have vectors; vectors embedded before a stop are cached
   (`semantic.vector_cache`), so the next night spends only what is missing. Zero-token work (unchanged records,
   metadata-only changes, removals) continues after a budget stop.
5. **Apply.** One transaction per batch: passages upserted (identical rows untouched, the same guard as `semantic_load_v1`),
   extra passages deleted, `semantic.corpora` records/chunks/capped recounted for every collection the call changed (keeps
   `semantic_status_v1` and the exact small-set path of `semantic.nearest_v1` right; HNSW is maintained by Postgres).
6. **Removal safety.** A record is removed only if its source row is still gone at apply time, has been missing for at
   least 20 hours (a `corpus_writer.publish` deletes and re-inserts a whole dataset), its collection has rows and
   `corpus_datasets.ready` is true, and the run stays within max(100, 2 % of the collection's records) removals. Removed and
   replaced passages keep their vectors in the cache for 30 days, so a record that comes back costs nothing.
7. **Guards.** Passages whose stored key is unknown are held, not re-embedded (`reembed_unseeded` off). Re-embedding only
   because a heading changed (same text, new embed key) is capped at 200 records per run (`drift_guard`).

## Evidence gathered (2026-10-23, read-only)

- Full parity, TypeScript rebuild vs the batch build's shard metadata, every passage field (offsets, text sha256, embed
  key, title, link, source URL, snippet): 723,720 passages of 7 collections, **0 mismatches**
  (`private/build/w1025_semantic/parity_big.json`, `parity_small.json`, `parity_usc.json`). U.S. Code, CRS, oversight,
  DOJ OIG and FTC rows were read live from `corpus_records` (`parity_usc.json`, `parity_live_small.json`); bills and eCFR
  from the published build files, whose aggregate hash equals the live corpus today (bills `a6792f98…`, eCFR `2c03ecbe…`,
  same as `private/build/semantic/source_verification.json`).
- Stored passages vs shard metadata (record, chunk, text sha256) for all 8 collections, 892,561 passages: equal
  (`private/build/w1025_semantic/shards_vs_production.json`). The key seed will match every passage.
- Smoke check (one request, 88 tokens, `private/build/w1025_semantic/smoke_usage.json`): the refresh rebuilt an FTC record
  from its live row, its embed key equals the batch build's, and the new vector against the stored one has cosine distance
  5.7e-7 (per-value differences of a few float16 steps: the service's run-to-run variation; the float16 rounding and text
  format are verified exact against numpy by the golden fixture). Reservation bound for that request: 335.

Expected baseline result: **0 tokens**; 539,540 queued records (530,245 corpus rows + 9,295 Supreme Court records) end in the
ledger as 502,016 `indexed` + 28,229 `no_doc` (18,717 eCFR and 9,512 U.S. Code records without operative text) + 9,295
Supreme Court `indexed`.

## RUNBOOK (lead)

All commands from the repository root. `. private/scratch/env.sh` only inside the command that needs it.

### 0. Before (record the numbers)

```sql
select k.dataset, k.records, k.chunks, (select count(*) from semantic.chunks c where c.dataset = k.dataset) as loaded
from semantic.corpora k order by 1;
```

Expected now: caselaw_scotus 9,295 / 168,841; congress_bills 173,457 / 186,864; crs_reports 14,197 / 14,197;
doj_oig_reports 3,163 / 3,163; ecfr_sections_full 222,370 / 386,022; ftc_publications_index 877 / 877;
oversight_reports 36,309 / 36,309; us_code_sections 51,643 / 96,288 (total 892,561 passages).

### 1. Apply the contract

Apply `database/contracts/semantic-refresh-v1.sql` as one file (idempotent; sections 8–9 run after the commit: the Vault
secret `semantic_refresh_cron_secret` is generated inside the database, and — pg_cron and pg_net are installed — two cron
jobs `semantic-refresh-a` (06:37, 06:47, 06:57 UTC) and `semantic-refresh-b` (07:07–07:47 UTC, every 10 minutes) are
created; they post only while `semantic.refresh_settings.enabled` is true, which it is not yet). The three triggers on
`public.corpus_records` start queueing changes of the 7 collections immediately (cheap; nothing is embedded yet).

```sql
select public.semantic_refresh_status_v1();   -- settings (enabled false), usage {seeded: false}, empty queue/ledger/keys
```

### 2. Seed the passage keys (no tokens)

```bash
python3 -I -B scripts/semantic/refresh_seed.py plan
. private/scratch/env.sh && python3 -I -B scripts/semantic/refresh_seed.py keys
```

Sends 892,561 rows (shard files verified against their manifest sha256 first) in calls of 5,000. Expected per dataset:
`matched = received`, `unmatched = 0`. About 10–20 minutes; no local disk; database growth about 280 MB
(`semantic.chunk_keys` and its key index). Rerunnable (progress in `private/build/w1025_semantic/seed_progress.json`).

### 3. Seed the usage ledger

```bash
python3 -I -B scripts/semantic/refresh_seed.py usage            # prints the total: 392,652,938 + 88 = 392,653,026
. private/scratch/env.sh && python3 -I -B scripts/semantic/refresh_seed.py usage --confirm
```

Global remaining after the seed: 400,000,000 − 392,653,026 = **7,346,974 tokens** (about 29 nights at the full daily cap).
If embed.py or any other embedding run spends tokens later, record it:
`select public.semantic_refresh_record_usage_v1('external', <tokens>, '<what>');`. The app's query embeddings
(`semantic.server.ts`, a few tokens each) are not counted by this ledger; lower `total_token_cap` if headroom is wanted.

### 4. Baseline (every indexed record confirmed once; expected 0 tokens)

```bash
. private/scratch/env.sh && node scripts/semantic/refresh_local.mjs enqueue --dataset all
. private/scratch/env.sh && node scripts/semantic/refresh_local.mjs dry-run --max-records 20000      # read-only sample
. private/scratch/env.sh && node scripts/semantic/refresh_local.mjs run                               # repeat until the queue is empty
. private/scratch/env.sh && node scripts/semantic/refresh_local.mjs status
```

`enqueue` queues 539,540 records. The dry run prints the plan counts (`unchanged`, `no_doc`, `index`/`add`, `remove`,
`hold`) and `unknownKeys`/`estimatedTokens`; expected `unknownKeys: 0`. `run` opens a run with trigger `local`, never embeds
(no `--embed`), and stops after 25 minutes; repeat it (each run continues where the last stopped) until `status` shows an
empty queue — about 3–6 runs. Anything that would need tokens stays queued for the nightly function (held with reason
`embedding_key_missing`). If the dry run shows `index` records with unknown keys, look at them before enabling (they are
real changes since the build, or a parity problem).

### 5. Deploy the function

`VOYAGE_API_KEY` is already a function secret (owner). From the repository root:

```bash
supabase functions deploy semantic-refresh --project-ref xosqzzsnhxcyehcnirpa --no-verify-jwt
# if the bundler refuses the import of src/lib/semantic/chunking.ts, deploy a self-contained copy:
node scripts/semantic/bundle_refresh_function.mjs /tmp/sr/supabase/functions
supabase functions deploy semantic-refresh --project-ref xosqzzsnhxcyehcnirpa --no-verify-jwt --workdir /tmp/sr
```

(The same six files, `index.ts`, `serve.ts`, `refresh.ts`, `sources.ts`, `embed.ts` and `_lib/chunking.ts` with entrypoint
`index.ts`, can be passed to the Supabase deploy tool instead, with JWT verification off.)

(`supabase/config.toml` names another project, hence `--project-ref`.) First run by hand, from SQL so the secret stays in
the database:

```sql
select net.http_post(url := 'https://xosqzzsnhxcyehcnirpa.supabase.co/functions/v1/semantic-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
    (select decrypted_secret from vault.decrypted_secrets where name = 'semantic_refresh_cron_secret')),
  body := jsonb_build_object('trigger', 'manual'), timeout_milliseconds := 10000);
-- a minute later:
select id, trigger, status, stop_reason, tokens, requests, inputs_embedded, detect, counts, error
from semantic.refresh_runs order by started_at desc limit 5;
```

### 6. Enable the schedule

```sql
update semantic.refresh_settings set enabled = true, updated_at = now() where id = 1;
select jobname, schedule, active from cron.job where jobname like 'semantic-refresh-%';
```

Settings (all in `semantic.refresh_settings`): `daily_token_cap` 250,000; `total_token_cap` 400,000,000;
`max_records_per_run` 600, `max_seconds_per_run` 110, `max_cpu_ms_per_run` 1,200 (edge limits); `page_records` 200;
`sweep_rows_per_run` 20,000; `prune_rows_per_run` 20,000; `removal_grace` 20 h; `removal_guard_min` 100,
`removal_guard_fraction` 0.02; `drift_guard` 200; `reembed_unseeded` false; `max_request_inputs` 64;
`max_request_reserve` 60,000; `datasets` (all 8). Pause: `set enabled = false`.

### 7. Verification

```sql
-- passage counts per collection: corpora must equal what is stored (before/after)
select k.dataset, k.records, k.chunks, (select count(*) from semantic.chunks c where c.dataset = k.dataset) as loaded,
       (select count(distinct c.record_id) from semantic.chunks c where c.dataset = k.dataset) as loaded_records
from semantic.corpora k order by 1;

-- budget: today and total against the caps (seeded must be true)
select public.semantic_refresh_status_v1() -> 'usage';

-- runs, queue and ledger
select id, trigger, status, stop_reason, tokens, inputs_embedded, counts from semantic.refresh_runs order by started_at desc limit 10;
select public.semantic_refresh_status_v1() -> 'queue', public.semantic_refresh_status_v1() -> 'ledger';

-- a new record is retrievable by meaning: its own passage as the query finds it first (distance about 0)
select r.record_id, r.refreshed_at from semantic.refresh_records r
where r.state = 'indexed' and r.run_id is not null and r.dataset = 'congress_bills' order by r.refreshed_at desc limit 5;
select public.semantic_search_v1((select embedding from semantic.chunks where dataset = 'congress_bills'
  and record_id = '<record_id from above>' and chunk_no = 0), array['congress_bills'], 5);
-- and in the app: search by meaning for words of that bill's title; the bill is among the first results

-- a removed record's passages are gone (0 rows, apart from records still inside the 20-hour grace: queue reason 'removed')
select c.dataset, c.record_id from semantic.chunks c
where c.dataset <> 'caselaw_scotus'
  and not exists (select 1 from public.corpus_records r where r.dataset = c.dataset and r.id = c.record_id)
  and not exists (select 1 from semantic.refresh_queue q where q.dataset = c.dataset and q.record_id = c.record_id)
limit 20;

-- every stored passage has a key for its current text (after step 2; refreshed passages get theirs on apply)
select k.dataset, count(*) filter (where ck.embed_sha256 is null) as without_key
from semantic.chunks k left join semantic.chunk_keys ck using (dataset, record_id, chunk_no) group by 1;
```

### 8. Operations notes

- Do not reload old shards with `load.py` once the refresh has written passages (it would put back the build's version of
  refreshed records). A full rebuild of a collection: purge it, load the new shards, then `refresh_seed.py keys --corpus ID`
  and `refresh_local.mjs enqueue --dataset ID` + `run` (re-baseline).
- A bulk republish of a collection by `corpus_writer.publish` queues every row; the prune drops the unchanged ones in SQL
  (20,000 per run) and the rest cost no tokens; removals wait for the grace period and stay within the guard.
- Stopping capture: `alter table public.corpus_records disable trigger semantic_refresh_enqueue_insert` (and `_update`,
  `_delete`); the sweep catches up later. Unschedule: `select cron.unschedule('semantic-refresh-a'), cron.unschedule('semantic-refresh-b');`.
- Disk and time: nothing is written locally except `seed_progress.json`; the baseline reads about 1 GB from the database
  over 1–2 hours of local runs; nightly runs take a few minutes.
