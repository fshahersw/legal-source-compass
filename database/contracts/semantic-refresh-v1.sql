-- semantic-refresh/1 — the semantic index (semantic-v1.sql) updates itself.
--
-- What it adds:
--   * a change queue fed by a trigger on public.corpus_records (insert, change, removal of a record of an indexed
--     collection; a us_code_titles change queues the sections of that title), plus a bounded nightly sweep that compares
--     every record's fingerprint with the ledger over a rolling key range, as a safety net for writes the trigger missed;
--   * a record ledger (semantic.refresh_records): per record, the fingerprint of the fields the builders read (sha256 of
--     semantic.source_input, the database's copy of scripts/semantic/refresh_rows.py), and what the index holds for it;
--   * passage keys (semantic.chunk_keys): the embed key (sha256 of model, input type and the exact embedded string, as
--     scripts/semantic/embed.py computes it) of every stored passage, seeded from the batch build's shard metadata
--     (scripts/semantic/refresh_seed.py) and kept by the refresh, so a passage whose embed string is already stored is never
--     sent to the embedding service again (its stored vector is copied);
--   * a vector cache (semantic.vector_cache): vectors embedded by a run that stopped before applying their record (budget,
--     time), and vectors of passages a change or removal took out of the index, kept 30 days, so partial progress resumes
--     and a record that comes back costs nothing;
--   * an embedding usage ledger (semantic.embedding_usage) with a hard daily cap and a global cap (semantic.refresh_settings):
--     every request reserves an upper bound of its tokens (UTF-8 bytes + 8 per input) before it is sent and settles to the
--     billed count after; a reservation that would pass either cap is refused; nothing is embedded until the ledger is
--     seeded with the batch build's usage (kind 'seed');
--   * a run ledger (semantic.refresh_runs) and the RPCs the scheduled edge function supabase/functions/semantic-refresh
--     calls (open, detect, pending, known keys, reserve, settle, cache vectors, apply, finish), the baseline enqueue, the key
--     seed, usage recording and status; the pg_cron + pg_net schedule (section 9).
--
-- Invariants:
--   * A record's passages are replaced only as a whole (apply, one transaction): every vector is resolved before anything
--     changes (stored passage with the same key, or the cache); a missing vector rolls the call back. Passages are written
--     with the same upsert as semantic_load_v1 (identical rows untouched), extra passages deleted, and semantic.corpora
--     records/chunks/capped_records recounted for every collection the call changed, so semantic_status_v1 and the exact
--     small-set path of semantic.nearest_v1 stay right; the HNSW index is maintained by Postgres on every insert and delete.
--   * Removal is never inferred from absence alone: a record is removed only when its source row is gone at apply time, was
--     already missing at least removal_grace earlier (a dataset republish deletes and re-inserts), its source collection still
--     has rows and is ready, and the run's removals of that collection stay within max(removal_guard_min,
--     removal_guard_fraction x records). A record whose builder now yields no document counts as a removal too.
--   * Queue entries are applied only if unchanged since they were read (seq); a record changed meanwhile is read again.
--   * The model is not named anywhere in this schema: embed keys are hashes; index_version stays the opaque label.
--
-- Every public function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Idempotent (create if not exists / create or replace / on conflict / create or replace trigger). Needs semantic-v1.sql.
-- Offline test: scripts/semantic/semantic-refresh-sql.test.mjs (pglite, vector type shimmed as in semantic-sql.test.mjs).
-- Runbook: docs/semantic-refresh-2026-10-25.md.

begin;

-- ------------------------------------------------------------------------------------------------ 1. tables
create sequence if not exists semantic.refresh_queue_seq;

create table if not exists semantic.refresh_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,                         -- scheduled runs only; manual and local runs work while off
  daily_token_cap bigint not null default 250000 check (daily_token_cap >= 0),          -- per UTC day, refresh requests
  total_token_cap bigint not null default 400000000 check (total_token_cap >= 0),       -- all embedding usage ever (seed included)
  max_records_per_run integer not null default 600 check (max_records_per_run between 1 and 1000000),
  max_seconds_per_run integer not null default 110 check (max_seconds_per_run between 10 and 86400),
  max_cpu_ms_per_run integer not null default 1200 check (max_cpu_ms_per_run between 100 and 86400000),
  page_records integer not null default 200 check (page_records between 1 and 1000),
  sweep_rows_per_run integer not null default 20000 check (sweep_rows_per_run between 0 and 200000),
  prune_rows_per_run integer not null default 20000 check (prune_rows_per_run between 0 and 200000),
  removal_grace interval not null default interval '20 hours' check (removal_grace >= interval '0'),
  removal_guard_min integer not null default 100 check (removal_guard_min >= 0),
  removal_guard_fraction numeric not null default 0.02 check (removal_guard_fraction between 0 and 1),
  drift_guard integer not null default 200 check (drift_guard >= 0),   -- records per run re-embedded only for a new heading
  reembed_unseeded boolean not null default false,                      -- re-embed passages whose stored key is not known
  max_request_inputs integer not null default 64 check (max_request_inputs between 1 and 128),
  max_request_reserve integer not null default 60000 check (max_request_reserve between 4000 and 110000),
  datasets text[] not null default array['us_code_sections', 'ecfr_sections_full', 'crs_reports', 'congress_bills',
    'oversight_reports', 'doj_oig_reports', 'ftc_publications_index', 'caselaw_scotus']
    check (datasets <@ array['us_code_sections', 'ecfr_sections_full', 'crs_reports', 'congress_bills',
    'oversight_reports', 'doj_oig_reports', 'ftc_publications_index', 'caselaw_scotus']),
  sweep_cursor jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into semantic.refresh_settings (id) values (1) on conflict (id) do nothing;

create table if not exists semantic.refresh_queue (
  dataset text not null check (dataset ~ '^[a-z][a-z0-9_]{1,80}$'),
  record_id text not null check (length(record_id) between 1 and 300),
  reason text not null check (reason in ('changed', 'removed', 'baseline', 'sweep', 'manual', 'title_changed')),
  first_seen_at timestamptz not null default now(),             -- kept when a queued record changes again (oldest first)
  seq bigint not null default nextval('semantic.refresh_queue_seq'),
  missing_since timestamptz,                                     -- source row seen missing (removal grace starts here)
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  last_error text,
  not_before timestamptz,                                        -- held for the budget or a setting: not read before this
  primary key (dataset, record_id)
);
alter table semantic.refresh_queue add column if not exists not_before timestamptz;
create index if not exists refresh_queue_order on semantic.refresh_queue (((attempts >= 3)), first_seen_at, dataset, record_id);

create table if not exists semantic.refresh_records (
  dataset text not null check (dataset ~ '^[a-z][a-z0-9_]{1,80}$'),
  record_id text not null check (length(record_id) between 1 and 300),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('indexed', 'no_doc')),
  doc_sha256 text check (doc_sha256 is null or doc_sha256 ~ '^[a-f0-9]{64}$'),
  chunks integer not null default 0 check (chunks >= 0),
  refreshed_at timestamptz not null default now(),
  run_id uuid,
  primary key (dataset, record_id)
);

create table if not exists semantic.chunk_keys (
  dataset text not null,
  record_id text not null,
  chunk_no integer not null,
  text_sha256 text not null check (text_sha256 ~ '^[a-f0-9]{64}$'),      -- the passage text the key was computed for
  embed_sha256 text not null check (embed_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (dataset, record_id, chunk_no),
  foreign key (dataset, record_id, chunk_no) references semantic.chunks (dataset, record_id, chunk_no) on delete cascade
);
create index if not exists chunk_keys_embed on semantic.chunk_keys (embed_sha256);

create table if not exists semantic.vector_cache (
  embed_sha256 text primary key check (embed_sha256 ~ '^[a-f0-9]{64}$'),
  embedding extensions.halfvec(1024) not null,
  source text not null check (source in ('embedded', 'retired')),
  created_at timestamptz not null default now(),
  run_id uuid
);
create index if not exists vector_cache_created on semantic.vector_cache (created_at);

create table if not exists semantic.refresh_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('schedule', 'manual', 'local')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  stop_reason text,
  detect jsonb,
  counts jsonb not null default '{}',          -- {dataset: {unchanged, indexed, removed, no_doc, deferred, held, errors, ...}}
  tokens bigint not null default 0 check (tokens >= 0),
  requests integer not null default 0 check (requests >= 0),
  inputs_embedded integer not null default 0 check (inputs_embedded >= 0),
  error text,
  notes jsonb not null default '{}',
  constraint refresh_runs_finished check ((status = 'running') = (finished_at is null))
);
create index if not exists refresh_runs_started on semantic.refresh_runs (started_at desc);
create unique index if not exists refresh_runs_one_running on semantic.refresh_runs (status) where status = 'running';

create table if not exists semantic.embedding_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('seed', 'external', 'reservation')),
  run_id uuid references semantic.refresh_runs (id),
  dataset text,
  reserved bigint not null default 0 check (reserved >= 0),
  tokens bigint check (tokens is null or tokens >= 0),           -- billed; null while a reservation is open
  inputs integer not null default 0 check (inputs >= 0),
  settled_at timestamptz,
  note text
);
create unique index if not exists embedding_usage_one_seed on semantic.embedding_usage (kind) where kind = 'seed';
create index if not exists embedding_usage_at on semantic.embedding_usage (at);

alter table semantic.refresh_settings enable row level security;
alter table semantic.refresh_queue enable row level security;
alter table semantic.refresh_records enable row level security;
alter table semantic.chunk_keys enable row level security;
alter table semantic.vector_cache enable row level security;
alter table semantic.refresh_runs enable row level security;
alter table semantic.embedding_usage enable row level security;
revoke all on all tables in schema semantic from public, anon, authenticated;
revoke all on sequence semantic.refresh_queue_seq from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ 2. helpers
-- The fields each builder of scripts/semantic/sources.py reads (refresh_rows.SPECS; true = keep the value as it is; an
-- object descends into the value when it is an object and keeps any other value as it is).
create or replace function semantic.source_spec(p_dataset text) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_dataset
    when 'us_code_sections' then '{"id": true, "title": true, "source_url": true, "text": true,
      "detail": {"usc": {"title": true, "key": true, "citation": true, "heading": true, "path": true}}}'::jsonb
    when 'ecfr_sections_full' then '{"id": true, "title": true, "source_url": true, "text": true,
      "detail": {"reserved": true, "title_number": true, "identifier": true, "subtitle": true, "ecfr_url": true},
      "item": {"subtitle": true}}'::jsonb
    when 'crs_reports' then '{"id": true, "title": true, "source_url": true,
      "detail": {"crs": {"title": true, "topics": true, "contentType": true}}, "item": {"cells": {"title": true}}}'::jsonb
    when 'congress_bills' then '{"id": true, "title": true, "source_url": true,
      "detail": {"bill": {"titles": {"display": true, "official": true}, "display": true, "subjects": true,
        "policyArea": true, "summary": true, "type": true, "number": true, "congress": true}},
      "item": {"cells": {"citation": true}}}'::jsonb
    when 'oversight_reports' then '{"id": true, "title": true, "source_url": true,
      "item": {"oversight": {"description": true, "oig": true, "agency_reviewed": true, "type": true}}}'::jsonb
    when 'doj_oig_reports' then '{"id": true, "title": true, "source_url": true,
      "item": {"dojoig": {"components": true, "type": true, "entity": true, "location": true, "description": true}}}'::jsonb
    when 'ftc_publications_index' then '{"id": true, "title": true, "source_url": true,
      "item": {"summary": true, "page_url": true, "cells": {"series": true}}}'::jsonb
  end
$$;

create or replace function semantic.pick(p_value jsonb, p_spec jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_spec) is distinct from 'object' or jsonb_typeof(p_value) is distinct from 'object' then p_value
    else (select jsonb_object_agg(s.key, semantic.pick(p_value -> s.key, s.value)) from jsonb_each(p_spec) s) end
$$;

-- The pruned row the refresh builds a record's document from (refresh_rows.prune). p_title_names: for a U.S. Code section,
-- [number, name] of the us_code_titles rows whose number matches the section's title (semantic.usc_title_names()).
create or replace function semantic.source_input(p_dataset text, p_id text, p_title text, p_source_url text, p_text text,
  p_item jsonb, p_detail jsonb, p_title_names jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select (select jsonb_object_agg(s.key, case s.key
            when 'id' then to_jsonb(p_id) when 'title' then to_jsonb(p_title) when 'source_url' then to_jsonb(p_source_url)
            when 'text' then to_jsonb(p_text) when 'item' then semantic.pick(p_item, s.value)
            when 'detail' then semantic.pick(p_detail, s.value) end)
          from jsonb_each(semantic.source_spec(p_dataset)) s)
    || case when p_dataset = 'us_code_sections' then jsonb_build_object('_title_names', coalesce(p_title_names, '[]'::jsonb))
       else '{}'::jsonb end
$$;

create or replace function semantic.fingerprint(p_input jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_input::text, 'UTF8')), 'hex')
$$;

-- {title number (as JSON text): [[number, name], ...] in ordinal order} over the us_code_titles rows.
create or replace function semantic.usc_title_map() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(t.num, t.names), '{}'::jsonb) from (
    select c.detail -> 'usc_title' ->> 'number' as num,
           jsonb_agg(jsonb_build_array(c.detail -> 'usc_title' -> 'number', c.detail -> 'usc_title' -> 'name') order by c.ordinal, c.id) as names
    from public.corpus_records c
    where c.dataset = 'us_code_titles' and jsonb_typeof(c.detail -> 'usc_title') = 'object'
      and c.detail -> 'usc_title' ->> 'number' is not null
    group by 1) t
$$;

create or replace function semantic.source_datasets() returns text[]
language sql immutable set search_path = '' as $$
  select array['us_code_sections', 'ecfr_sections_full', 'crs_reports', 'congress_bills', 'oversight_reports',
               'doj_oig_reports', 'ftc_publications_index']
$$;

-- Whether a record's source still exists: a corpus_records row, or for caselaw_scotus a Supreme Court case in the
-- case-law store (null when that store is not installed or holds no Supreme Court case: unknown, never "gone").
create or replace function semantic.source_present(p_dataset text, p_record_id text) returns boolean
language plpgsql stable set search_path = '' as $$
declare v boolean;
begin
  if p_dataset = any (semantic.source_datasets()) then
    return exists (select 1 from public.corpus_records c where c.dataset = p_dataset and c.id = p_record_id);
  end if;
  if p_dataset = 'caselaw_scotus' then
    if to_regclass('caselaw.cases') is null then return null; end if;
    execute 'select case when not exists (select 1 from caselaw.cases where court_id = ''scotus'') then null
                 else exists (select 1 from caselaw.cases k where k.court_id = ''scotus''
                   and k.cluster_id = case when $1 ~ ''^[0-9]{1,18}$'' then $1::bigint end) end'
      into v using p_record_id;
    return v;
  end if;
  return null;
end $$;

-- Whether a collection's source can be trusted for removals now: it has rows and its catalog entry is ready.
create or replace function semantic.source_ready(p_dataset text) returns boolean
language plpgsql stable set search_path = '' as $$
declare v boolean;
begin
  if p_dataset = any (semantic.source_datasets()) then
    return exists (select 1 from public.corpus_records c where c.dataset = p_dataset)
       and coalesce((select d.ready from public.corpus_datasets d where d.id = p_dataset), false);
  end if;
  if p_dataset = 'caselaw_scotus' and to_regclass('caselaw.cases') is not null then
    execute 'select exists (select 1 from caselaw.cases where court_id = ''scotus'')' into v;
    return v;
  end if;
  return false;
end $$;

create or replace function semantic.clean_error(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(regexp_replace(regexp_replace(coalesce(p, ''),
    '(bearer\s+)[A-Za-z0-9._~+/=-]+', '\1[removed]', 'gi'),
    '((api[_-]?key|apikey|access_token|token|key)=)[^&[:space:]"'']*', '\1[removed]', 'gi'), 500), '')
$$;

create or replace function semantic.usage_state() returns jsonb
language sql stable set search_path = '' as $$
  with s as (select * from semantic.refresh_settings where id = 1),
  u as (select coalesce(sum(coalesce(e.tokens, e.reserved)), 0)::bigint as total,
               coalesce(sum(coalesce(e.tokens, e.reserved)) filter (
                 where e.kind = 'reservation' and e.at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')), 0)::bigint as today,
               bool_or(e.kind = 'seed') as seeded
        from semantic.embedding_usage e)
  select jsonb_build_object('today', u.today, 'total', u.total, 'daily_cap', s.daily_token_cap, 'total_cap', s.total_token_cap,
    'daily_remaining', greatest(s.daily_token_cap - u.today, 0), 'total_remaining', greatest(s.total_token_cap - u.total, 0),
    'seeded', coalesce(u.seeded, false))
  from s, u
$$;

-- Whether the index holds what the ledger says for a record (passages purged or loaded behind the refresh's back make it
-- false, and the record is rebuilt instead of being taken as unchanged).
create or replace function semantic.ledger_holds(p_dataset text, p_record_id text, p_state text, p_chunks integer) returns boolean
language sql stable set search_path = '' as $$
  select (select count(*) from semantic.chunks c where c.dataset = p_dataset and c.record_id = p_record_id)
         = case when p_state = 'indexed' then coalesce(p_chunks, -1) else 0 end
$$;

-- Removals one run may make in a collection.
create or replace function semantic.removal_limit(p_dataset text) returns integer
language sql stable set search_path = '' as $$
  select greatest(s.removal_guard_min, ceil(coalesce((select k.records from semantic.corpora k where k.dataset = p_dataset), 0)
         * s.removal_guard_fraction)::integer)
  from semantic.refresh_settings s where s.id = 1
$$;

-- The stored vector of an embed key: a live passage whose key was computed for its current text, else the cache.
create or replace function semantic.embedding_for(p_key text) returns extensions.halfvec
language sql stable set search_path = '' as $$
  select coalesce(
    (select c.embedding from semantic.chunk_keys k
       join semantic.chunks c on c.dataset = k.dataset and c.record_id = k.record_id and c.chunk_no = k.chunk_no
      where k.embed_sha256 = p_key and c.text_sha256 = k.text_sha256 limit 1),
    (select v.embedding from semantic.vector_cache v where v.embed_sha256 = p_key))
$$;

-- Keep the vectors of a record's passages that are about to leave the index (keys not in p_keep) in the cache.
create or replace function semantic.retire_record(p_dataset text, p_record_id text, p_keep text[], p_run uuid) returns integer
language sql set search_path = '' as $$
  with ins as (
    insert into semantic.vector_cache (embed_sha256, embedding, source, run_id)
    select distinct on (k.embed_sha256) k.embed_sha256, c.embedding, 'retired', p_run
    from semantic.chunks c
    join semantic.chunk_keys k on k.dataset = c.dataset and k.record_id = c.record_id and k.chunk_no = c.chunk_no
    where c.dataset = p_dataset and c.record_id = p_record_id and k.text_sha256 = c.text_sha256
      and not (k.embed_sha256 = any (coalesce(p_keep, '{}')))
    order by k.embed_sha256
    on conflict (embed_sha256) do nothing
    returning 1)
  select count(*)::integer from ins
$$;

create or replace function semantic.delete_passages(p_dataset text, p_record_id text, p_from integer) returns integer
language sql set search_path = '' as $$
  with del as (delete from semantic.chunks c where c.dataset = p_dataset and c.record_id = p_record_id and c.chunk_no >= p_from returning 1)
  select count(*)::integer from del
$$;

create or replace function semantic.forget_record(p_dataset text, p_record_id text) returns integer
language sql set search_path = '' as $$
  with del as (delete from semantic.refresh_records l where l.dataset = p_dataset and l.record_id = p_record_id returning 1)
  select count(*)::integer from del
$$;

create or replace function semantic.dequeue(p_dataset text, p_record_id text) returns integer
language sql set search_path = '' as $$
  with del as (delete from semantic.refresh_queue q where q.dataset = p_dataset and q.record_id = p_record_id returning 1)
  select count(*)::integer from del
$$;

create or replace function semantic.bump(p_counts jsonb, p_dataset text, p_key text, p_n bigint) returns jsonb
language sql immutable set search_path = '' as $$
  select case when coalesce(p_n, 0) = 0 then coalesce(p_counts, '{}') else
    jsonb_set(coalesce(p_counts, '{}'), array[p_dataset], coalesce(p_counts -> p_dataset, '{}')
      || jsonb_build_object(p_key, coalesce((p_counts -> p_dataset ->> p_key)::bigint, 0) + p_n)) end
$$;

-- Sum two {dataset: {key: n}} count objects.
create or replace function semantic.merge_counts(p_a jsonb, p_b jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare out jsonb := coalesce(p_a, '{}'); d text; k text; n bigint;
begin
  for d in select jsonb_object_keys(coalesce(p_b, '{}')) loop
    for k, n in select key, value::bigint from jsonb_each_text(p_b -> d) loop
      out := semantic.bump(out, d, k, n);
    end loop;
  end loop;
  return out;
end $$;

-- ------------------------------------------------------------------------------------------------ 3. change capture
-- Queue one changed record (a us_code_titles change queues a marker keyed by the title number; detect expands it).
create or replace function semantic.enqueue_one(p_dataset text, p_id text, p_reason text, p_detail jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id text := p_id; v_reason text := p_reason;
begin
  if p_dataset = 'us_code_titles' then
    v_id := p_detail -> 'usc_title' ->> 'number';
    v_reason := 'title_changed';
    if v_id is null or length(v_id) not between 1 and 300 then return; end if;
  elsif not (p_dataset = any (semantic.source_datasets())) then
    return;
  end if;
  insert into semantic.refresh_queue as q (dataset, record_id, reason, missing_since)
  values (p_dataset, v_id, v_reason, case when v_reason = 'removed' then now() end)
  on conflict (dataset, record_id) do update set
    reason = excluded.reason,
    seq = nextval('semantic.refresh_queue_seq'),
    missing_since = case when excluded.reason = 'removed' then coalesce(q.missing_since, now()) end,
    attempts = 0, last_error = null, not_before = null;
end $$;

create or replace function semantic.enqueue_corpus_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and (old.dataset, old.id) is distinct from (new.dataset, new.id)) then
    perform semantic.enqueue_one(old.dataset, old.id, 'removed', old.detail);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform semantic.enqueue_one(new.dataset, new.id, 'changed', new.detail);
  end if;
  return null;
end $$;

create or replace trigger semantic_refresh_enqueue_insert after insert on public.corpus_records for each row
  when (new.dataset in ('us_code_sections', 'ecfr_sections_full', 'crs_reports', 'congress_bills', 'oversight_reports',
                        'doj_oig_reports', 'ftc_publications_index', 'us_code_titles'))
  execute function semantic.enqueue_corpus_change();
create or replace trigger semantic_refresh_enqueue_update after update on public.corpus_records for each row
  when ((old.dataset in ('us_code_sections', 'ecfr_sections_full', 'crs_reports', 'congress_bills', 'oversight_reports',
                         'doj_oig_reports', 'ftc_publications_index', 'us_code_titles')
         or new.dataset in ('us_code_sections', 'ecfr_sections_full', 'crs_reports', 'congress_bills', 'oversight_reports',
                            'doj_oig_reports', 'ftc_publications_index', 'us_code_titles'))
        and (old.dataset, old.id, old.title, old.source_url, old.text, old.item, old.detail)
            is distinct from (new.dataset, new.id, new.title, new.source_url, new.text, new.item, new.detail))
  execute function semantic.enqueue_corpus_change();
create or replace trigger semantic_refresh_enqueue_delete after delete on public.corpus_records for each row
  when (old.dataset in ('us_code_sections', 'ecfr_sections_full', 'crs_reports', 'congress_bills', 'oversight_reports',
                        'doj_oig_reports', 'ftc_publications_index', 'us_code_titles'))
  execute function semantic.enqueue_corpus_change();

-- ------------------------------------------------------------------------------------------------ 4. run lifecycle
create or replace function public.semantic_refresh_check_trigger_v1(p_token text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_token is null or length(p_token) < 32 or to_regclass('vault.decrypted_secrets') is null then return false; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using 'semantic_refresh_cron_secret';
  return v is not null and sha256(convert_to(v, 'UTF8')) = sha256(convert_to(p_token, 'UTF8'));
end $$;

-- Open a run. A scheduled run needs the refresh enabled; manual and local runs do not. A run left open (10 minutes for an
-- edge run, 40 for a local one) is closed as failed first; one open run at a time.
create or replace function public.semantic_refresh_open_run_v1(p_trigger text default 'schedule') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s semantic.refresh_settings; v_run uuid; v_limits jsonb;
begin
  if p_trigger not in ('schedule', 'manual', 'local') then raise exception 'trigger must be schedule, manual or local' using errcode = '22023'; end if;
  select * into s from semantic.refresh_settings where id = 1;
  if p_trigger = 'schedule' and not s.enabled then return jsonb_build_object('skipped', 'disabled'); end if;
  -- an edge run is bounded to a few minutes (and is stopped by the platform at its CPU or wall-clock limit); a local run
  -- to 25 minutes by default: a run left open past that is closed as failed (its open reservations stay counted in full)
  update semantic.refresh_runs set status = 'failed', finished_at = now(),
    error = 'abandoned: the run did not finish within ' || case when trigger = 'local' then '40' else '10' end || ' minutes'
    where status = 'running' and started_at < now() - case when trigger = 'local' then interval '40 minutes' else interval '10 minutes' end;
  if exists (select 1 from semantic.refresh_runs where status = 'running') then return jsonb_build_object('skipped', 'busy'); end if;
  insert into semantic.refresh_runs (trigger) values (p_trigger) returning id into v_run;
  select coalesce(jsonb_object_agg(d, semantic.removal_limit(d)), '{}') into v_limits from unnest(s.datasets) d;
  return jsonb_build_object('run_id', v_run, 'usage', semantic.usage_state(), 'removal_limits', v_limits,
    'settings', jsonb_build_object(
      'datasets', to_jsonb(s.datasets), 'daily_token_cap', s.daily_token_cap, 'total_token_cap', s.total_token_cap,
      'max_records_per_run', s.max_records_per_run, 'max_seconds_per_run', s.max_seconds_per_run,
      'max_cpu_ms_per_run', s.max_cpu_ms_per_run, 'page_records', s.page_records,
      'removal_grace_seconds', extract(epoch from s.removal_grace)::bigint, 'drift_guard', s.drift_guard,
      'reembed_unseeded', s.reembed_unseeded, 'max_request_inputs', s.max_request_inputs,
      'max_request_reserve', s.max_request_reserve));
end $$;

-- Detection, bounded: (1) U.S. Code title markers -> their sections; (2) Supreme Court records whose case left the store;
-- (3) the sweep: the next sweep_rows_per_run corpus rows (rolling over the collections by id) whose fingerprint differs from
-- the ledger (or whose stored passages no longer match the ledger), ledger records in that range whose row is gone, indexed
-- records in that range with no ledger row; (4) the prune: queued records whose fingerprint equals the ledger's and whose
-- passages are what the ledger says (a write that changed nothing the builders read).
create or replace function public.semantic_refresh_detect_v1(p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r semantic.refresh_runs; s semantic.refresh_settings;
  v_titles integer := 0; v_scotus integer := 0; v_swept integer := 0; v_sweep_enq integer := 0; v_sweep_gone integer := 0;
  v_sweep_unledgered integer := 0; v_pruned integer := 0; v_n integer; v_k integer; v_g integer; v_u integer;
  v_list text[]; v_idx integer; v_after text; v_last text; v_ds text; v_budget integer; v_steps integer := 0;
  v_tn jsonb; v_result jsonb;
begin
  select * into r from semantic.refresh_runs where id = p_run for update;
  if not found or r.status <> 'running' then raise exception 'run is not open' using errcode = '22023'; end if;
  select * into s from semantic.refresh_settings where id = 1 for update;
  perform pg_advisory_xact_lock(hashtextextended('semantic:refresh', 0));

  -- (1) title markers
  if 'us_code_sections' = any (s.datasets) and exists (select 1 from semantic.refresh_queue q where q.dataset = 'us_code_titles') then
    with markers as (delete from semantic.refresh_queue q where q.dataset = 'us_code_titles' returning q.record_id),
    ins as (insert into semantic.refresh_queue (dataset, record_id, reason)
            select 'us_code_sections', c.id, 'title_changed' from public.corpus_records c
            where c.dataset = 'us_code_sections' and c.detail -> 'usc' ->> 'title' in (select m.record_id from markers m)
            on conflict (dataset, record_id) do nothing returning 1)
    select count(*) into v_titles from ins;
  end if;

  -- (2) Supreme Court cases no longer in the case-law store
  if 'caselaw_scotus' = any (s.datasets) and semantic.source_ready('caselaw_scotus') then
    execute $q$
      with gone as (
        select x.record_id from (select distinct c.record_id from semantic.chunks c where c.dataset = 'caselaw_scotus') x
        where not exists (select 1 from caselaw.cases k where k.court_id = 'scotus'
                            and k.cluster_id = case when x.record_id ~ '^[0-9]{1,18}$' then x.record_id::bigint end)),
      ins as (insert into semantic.refresh_queue as q (dataset, record_id, reason, missing_since)
              select 'caselaw_scotus', g.record_id, 'removed', now() from gone g
              on conflict (dataset, record_id) do update set missing_since = coalesce(q.missing_since, now())
                where q.missing_since is null
              returning 1)
      select count(*) from ins $q$ into v_scotus;
  end if;

  -- (3) sweep
  v_budget := s.sweep_rows_per_run;
  v_list := array(select d from unnest(s.datasets) d where d = any (semantic.source_datasets()) order by d);
  if v_budget > 0 and cardinality(v_list) > 0 then
    v_tn := semantic.usc_title_map();
    v_idx := array_position(v_list, s.sweep_cursor ->> 'dataset');
    v_after := case when v_idx is null then '' else coalesce(s.sweep_cursor ->> 'after', '') end;
    v_idx := coalesce(v_idx, 1);
    while v_budget > 0 and v_steps < cardinality(v_list) + 1 loop
      v_steps := v_steps + 1;
      v_ds := v_list[v_idx];
      with page as (
        select c.id, semantic.fingerprint(semantic.source_input(c.dataset, c.id, c.title, c.source_url, c.text, c.item, c.detail,
                 v_tn -> (c.detail -> 'usc' ->> 'title'))) as fp
        from public.corpus_records c where c.dataset = v_ds and c.id > v_after order by c.id limit v_budget),
      diff as (select p.id from page p left join semantic.refresh_records l on l.dataset = v_ds and l.record_id = p.id
               where l.fingerprint is distinct from p.fp or not semantic.ledger_holds(v_ds, p.id, l.state, l.chunks)),
      ins as (insert into semantic.refresh_queue (dataset, record_id, reason) select v_ds, d.id, 'sweep' from diff d
              on conflict (dataset, record_id) do nothing returning 1)
      select (select count(*) from page), (select max(p.id) from page p), (select count(*) from ins) into v_n, v_last, v_k;
      v_swept := v_swept + v_n;
      v_sweep_enq := v_sweep_enq + v_k;
      if semantic.source_ready(v_ds) then
        -- ledger records in the swept range whose source row is gone
        with gone as (
          select l.record_id from semantic.refresh_records l
          where l.dataset = v_ds and l.record_id > v_after and (v_n < v_budget or l.record_id <= v_last)
            and not exists (select 1 from public.corpus_records c where c.dataset = v_ds and c.id = l.record_id)),
        ins as (insert into semantic.refresh_queue as q (dataset, record_id, reason, missing_since)
                select v_ds, g.record_id, 'removed', now() from gone g
                on conflict (dataset, record_id) do update set missing_since = coalesce(q.missing_since, now())
                  where q.missing_since is null
                returning 1)
        select count(*) into v_g from ins;
        v_sweep_gone := v_sweep_gone + v_g;
        -- indexed records in the swept range that the ledger does not know yet
        with unl as (
          select distinct c.record_id from semantic.chunks c
          where c.dataset = v_ds and c.record_id > v_after and (v_n < v_budget or c.record_id <= v_last)
            and not exists (select 1 from semantic.refresh_records l where l.dataset = v_ds and l.record_id = c.record_id)),
        ins as (insert into semantic.refresh_queue (dataset, record_id, reason)
                select v_ds, u.record_id, 'sweep' from unl u on conflict (dataset, record_id) do nothing returning 1)
        select count(*) into v_u from ins;
        v_sweep_unledgered := v_sweep_unledgered + v_u;
      end if;
      v_budget := v_budget - v_n;
      if v_budget > 0 then   -- this collection is done: continue with the next one from its start
        v_idx := v_idx % cardinality(v_list) + 1;
        v_after := '';
      else
        v_after := v_last;
      end if;
    end loop;
    update semantic.refresh_settings set sweep_cursor = jsonb_build_object('dataset', v_list[v_idx], 'after', v_after) where id = 1;
  end if;

  -- (4) prune queued records whose fingerprint equals the ledger's
  if s.prune_rows_per_run > 0 then
    v_tn := coalesce(v_tn, semantic.usc_title_map());
    with cand as (
      select q.dataset, q.record_id, q.seq from semantic.refresh_queue q
      where q.dataset = any (s.datasets) and q.dataset = any (semantic.source_datasets()) and q.reason <> 'manual'
      order by q.first_seen_at, q.dataset, q.record_id limit s.prune_rows_per_run),
    cur as (
      select cand.dataset, cand.record_id, cand.seq,
             semantic.fingerprint(semantic.source_input(c.dataset, c.id, c.title, c.source_url, c.text, c.item, c.detail,
               v_tn -> (c.detail -> 'usc' ->> 'title'))) as fp
      from cand join public.corpus_records c on c.dataset = cand.dataset and c.id = cand.record_id),
    del as (
      delete from semantic.refresh_queue q using cur, semantic.refresh_records l
      where q.dataset = cur.dataset and q.record_id = cur.record_id and q.seq = cur.seq
        and l.dataset = cur.dataset and l.record_id = cur.record_id and l.fingerprint = cur.fp
        and semantic.ledger_holds(l.dataset, l.record_id, l.state, l.chunks)
      returning 1)
    select count(*) into v_pruned from del;
  end if;

  v_result := jsonb_build_object('title_sections_queued', v_titles, 'scotus_missing_queued', v_scotus, 'swept_rows', v_swept,
    'sweep_queued', v_sweep_enq, 'sweep_gone_queued', v_sweep_gone, 'sweep_unledgered_queued', v_sweep_unledgered,
    'pruned_unchanged', v_pruned, 'queue', (select count(*) from semantic.refresh_queue q where q.dataset = any (s.datasets)));
  update semantic.refresh_runs set detect = v_result where id = p_run;
  return v_result;
end $$;

-- The oldest queued records (records failing three times go last), with what the refresh needs to decide: the pruned source
-- row and its fingerprint (null when the source is gone), the ledger entry, the stored passages (offsets, hashes, metadata
-- and the embed key known for the current text; never the vectors), and whether the source collection can be trusted for
-- removals. A record whose fingerprint equals the ledger's comes back as {same: true} only. Read-only. Keyset paging:
-- pass the returned `next` as p_after.
create or replace function public.semantic_refresh_pending_v1(p_after jsonb default null, p_limit integer default 200,
  p_max_bytes integer default 6000000, p_datasets text[] default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s semantic.refresh_settings;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_max bigint := least(greatest(coalesce(p_max_bytes, 6000000), 100000), 30000000);
  v_datasets text[];
  v_items jsonb := '[]'; v_bytes bigint := 0; v_n integer := 0; v_more boolean := false; v_next jsonb := null;
  v_late boolean; v_first timestamptz; v_ds text; v_id text;
  q semantic.refresh_queue; l semantic.refresh_records; v_src jsonb; v_fp text; v_stored jsonb; v_item jsonb; v_present boolean;
  v_tn jsonb; v_ready jsonb := '{}';
begin
  select * into s from semantic.refresh_settings where id = 1;
  v_datasets := array(select d from unnest(coalesce(p_datasets, s.datasets)) d where d = any (s.datasets));
  if p_after is not null then
    v_late := coalesce((p_after ->> 'late')::boolean, false);
    v_first := (p_after ->> 'first_seen_at')::timestamptz;
    v_ds := p_after ->> 'dataset';
    v_id := p_after ->> 'record_id';
  end if;
  v_tn := semantic.usc_title_map();
  for q in
    select * from semantic.refresh_queue x
    where x.dataset = any (v_datasets)
      and (x.not_before is null or x.not_before <= now())
      and (p_after is null or ((x.attempts >= 3), x.first_seen_at, x.dataset, x.record_id) > (v_late, v_first, v_ds, v_id))
    order by (x.attempts >= 3), x.first_seen_at, x.dataset, x.record_id
    limit v_limit + 1
  loop
    if v_n >= v_limit or (v_n > 0 and v_bytes >= v_max) then v_more := true; exit; end if;
    if not (v_ready ? q.dataset) then
      v_ready := v_ready || jsonb_build_object(q.dataset, coalesce(semantic.source_ready(q.dataset), false));
    end if;
    select * into l from semantic.refresh_records x where x.dataset = q.dataset and x.record_id = q.record_id;
    if q.dataset = 'caselaw_scotus' then
      v_present := semantic.source_present(q.dataset, q.record_id);
      v_src := case when v_present then jsonb_build_object('present', true) end;
      v_fp := case when v_present then semantic.fingerprint(v_src) end;
    else
      select semantic.source_input(c.dataset, c.id, c.title, c.source_url, c.text, c.item, c.detail, v_tn -> (c.detail -> 'usc' ->> 'title'))
        into v_src from public.corpus_records c where c.dataset = q.dataset and c.id = q.record_id;
      v_fp := case when v_src is not null then semantic.fingerprint(v_src) end;
    end if;
    if v_fp is not null and l.fingerprint is not null and l.fingerprint = v_fp
       and semantic.ledger_holds(q.dataset, q.record_id, l.state, l.chunks) then
      v_item := jsonb_build_object('dataset', q.dataset, 'record_id', q.record_id, 'seq', q.seq, 'same', true, 'fingerprint', v_fp,
        'ledger', jsonb_build_object('state', l.state, 'doc_sha256', l.doc_sha256, 'chunks', l.chunks));
    else
      select coalesce(jsonb_agg(jsonb_build_object('chunk_no', c.chunk_no, 'chunk_total', c.chunk_total, 'char_start', c.char_start,
               'char_end', c.char_end, 'text_sha256', c.text_sha256, 'title', c.title, 'href', c.href, 'source_url', c.source_url,
               'snippet', c.snippet, 'embed_sha256', case when k.text_sha256 = c.text_sha256 then k.embed_sha256 end)
               order by c.chunk_no), '[]'::jsonb)
        into v_stored
        from semantic.chunks c
        left join semantic.chunk_keys k on k.dataset = c.dataset and k.record_id = c.record_id and k.chunk_no = c.chunk_no
        where c.dataset = q.dataset and c.record_id = q.record_id;
      v_item := jsonb_build_object('dataset', q.dataset, 'record_id', q.record_id, 'seq', q.seq, 'same', false,
        'reason', q.reason, 'first_seen_at', q.first_seen_at, 'missing_since', q.missing_since, 'attempts', q.attempts,
        'source', v_src, 'fingerprint', v_fp, 'source_ready', v_ready -> q.dataset,
        'ledger', case when l.dataset is null then null else jsonb_build_object('state', l.state, 'doc_sha256', l.doc_sha256,
          'chunks', l.chunks, 'fingerprint', l.fingerprint) end,
        'stored', case when q.dataset = 'caselaw_scotus' then '[]'::jsonb else v_stored end,
        'stored_count', case when q.dataset = 'caselaw_scotus'
          then (select count(*) from semantic.chunks c where c.dataset = q.dataset and c.record_id = q.record_id)
          else jsonb_array_length(v_stored) end);
    end if;
    v_items := v_items || jsonb_build_array(v_item);
    v_bytes := v_bytes + octet_length(v_item::text);
    v_n := v_n + 1;
    v_next := jsonb_build_object('late', q.attempts >= 3, 'first_seen_at', q.first_seen_at, 'dataset', q.dataset, 'record_id', q.record_id);
    l := null;
  end loop;
  return jsonb_build_object('items', v_items, 'next', v_next, 'more', v_more);
end $$;

-- Which of these embed keys the index can supply a vector for without a request (a live passage or the cache).
create or replace function public.semantic_refresh_known_keys_v1(p_keys text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_keys is null or cardinality(p_keys) > 5000 then raise exception 'pass 0 to 5000 keys' using errcode = '22023'; end if;
  return coalesce((
    select array_agg(distinct k order by k) from unnest(p_keys) k
    where exists (select 1 from semantic.chunk_keys ck
                    join semantic.chunks c on c.dataset = ck.dataset and c.record_id = ck.record_id and c.chunk_no = ck.chunk_no
                   where ck.embed_sha256 = k and c.text_sha256 = ck.text_sha256)
       or exists (select 1 from semantic.vector_cache v where v.embed_sha256 = k)), '{}');
end $$;

-- Reserve an upper bound of a request's tokens before sending it. Refused (ok=false) when it would pass today's cap or the
-- global cap, when the usage ledger has not been seeded, or when the run is not open. p_reserve = 0 only reports the state.
create or replace function public.semantic_refresh_reserve_v1(p_run uuid, p_dataset text, p_reserve bigint, p_inputs integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r semantic.refresh_runs; u jsonb; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('semantic:embedding_usage', 0));
  select * into r from semantic.refresh_runs where id = p_run;
  if not found or r.status <> 'running' then return jsonb_build_object('ok', false, 'reason', 'run_not_open'); end if;
  u := semantic.usage_state();
  if coalesce(p_reserve, 0) <= 0 then return u || jsonb_build_object('ok', true, 'reservation_id', null); end if;
  if p_inputs is null or p_inputs not between 1 and 128 then raise exception 'inputs must be 1 to 128' using errcode = '22023'; end if;
  if not (u ->> 'seeded')::boolean then return u || jsonb_build_object('ok', false, 'reason', 'usage_not_seeded'); end if;
  if p_reserve > (u ->> 'total_remaining')::bigint then return u || jsonb_build_object('ok', false, 'reason', 'total_cap'); end if;
  if p_reserve > (u ->> 'daily_remaining')::bigint then return u || jsonb_build_object('ok', false, 'reason', 'daily_cap'); end if;
  insert into semantic.embedding_usage (kind, run_id, dataset, reserved, inputs) values ('reservation', p_run, p_dataset, p_reserve, p_inputs)
    returning id into v_id;
  return semantic.usage_state() || jsonb_build_object('ok', true, 'reservation_id', v_id);
end $$;

-- Settle a reservation with the tokens the service billed (null: no answer, the reservation stays counted in full).
create or replace function public.semantic_refresh_settle_v1(p_reservation bigint, p_tokens bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e semantic.embedding_usage; v_tokens bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('semantic:embedding_usage', 0));
  select * into e from semantic.embedding_usage where id = p_reservation and kind = 'reservation' for update;
  if not found then raise exception 'unknown reservation' using errcode = '22023'; end if;
  if e.settled_at is not null then raise exception 'reservation already settled' using errcode = '22023'; end if;
  if p_tokens is not null and p_tokens < 0 then raise exception 'tokens must not be negative' using errcode = '22023'; end if;
  v_tokens := coalesce(p_tokens, e.reserved);
  update semantic.embedding_usage set tokens = v_tokens, settled_at = now(),
    note = case when p_tokens is null then 'no answer: counted at the reservation'
                when p_tokens > e.reserved then 'billed more than reserved' end
    where id = e.id;
  update semantic.refresh_runs set tokens = tokens + v_tokens, requests = requests + 1,
    inputs_embedded = inputs_embedded + case when p_tokens is null then 0 else e.inputs end
    where id = e.run_id;
  return semantic.usage_state() || jsonb_build_object('tokens', v_tokens, 'overrun', coalesce(p_tokens > e.reserved, false));
end $$;

-- Keep vectors a run embedded (at most 128), so its records can be applied now or by a later run.
create or replace function public.semantic_refresh_cache_vectors_v1(p_run uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare r semantic.refresh_runs; v_n integer;
begin
  select * into r from semantic.refresh_runs where id = p_run;
  if not found or r.status <> 'running' then raise exception 'run is not open' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 128 then
    raise exception 'pass 1 to 128 vectors' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where (x ->> 'k') !~ '^[a-f0-9]{64}$' or jsonb_typeof(x -> 'v') <> 'string') then
    raise exception 'each vector needs a key and a vector text' using errcode = '22023'; end if;
  with ins as (
    insert into semantic.vector_cache (embed_sha256, embedding, source, run_id)
    select x ->> 'k', (x ->> 'v')::extensions.halfvec(1024), 'embedded', p_run from jsonb_array_elements(p_rows) x
    on conflict (embed_sha256) do nothing returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- Apply decisions for at most 300 records (4,000 passages) in one transaction. Actions:
--   unchanged  ledger only (fingerprint, state, document hash)
--   index      replace the record's passages: rows = every kept passage (chunk_no 0..n-1) with its embed key; vectors come
--              from stored passages or the cache, never from the caller
--   no_doc     the builder yields no document: passages deleted (a removal for the guard), ledger state no_doc
--   remove     the source is gone: passages and ledger deleted (grace, readiness and guard checked here)
--   defer      the source is missing but not for long enough: missing_since kept
--   hold       left queued with a reason (budget, guard, unseeded keys); attempts unchanged
--   error      left queued, attempts + 1
-- A record whose queue entry changed since it was read (seq) is skipped as stale.
create or replace function public.semantic_refresh_apply_v1(p_run uuid, p_records jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r semantic.refresh_runs; s semantic.refresh_settings; q semantic.refresh_queue;
  e jsonb; x jsonb; v_ds text; v_id text; v_action text; v_rows jsonb; v_n integer; i integer; v_total_rows integer;
  v_keys text[]; v_vecs extensions.halfvec[]; v_vec extensions.halfvec; v_key text; v_present boolean;
  v_b_n integer; v_b_total integer; v_a_n integer; v_a_total integer; v_written integer := 0; v_w integer; v_del integer;
  v_counts jsonb := '{}'; v_delta jsonb := '{}'; v_skipped jsonb := '[]'; v_removals bigint; d text;
begin
  select * into r from semantic.refresh_runs where id = p_run for update;
  if not found or r.status <> 'running' then raise exception 'run is not open' using errcode = '22023'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 300 then
    raise exception 'pass 1 to 300 records' using errcode = '22023'; end if;
  select coalesce(sum(case when jsonb_typeof(y -> 'rows') = 'array' then jsonb_array_length(y -> 'rows') else 0 end), 0)
    into v_total_rows from jsonb_array_elements(p_records) y;
  if v_total_rows > 4000 then raise exception 'at most 4000 passages per call' using errcode = '22023'; end if;
  select * into s from semantic.refresh_settings where id = 1;
  perform pg_advisory_xact_lock(hashtextextended('semantic:refresh', 0));

  for e in select value from jsonb_array_elements(p_records) loop
    v_ds := e ->> 'dataset'; v_id := e ->> 'record_id'; v_action := e ->> 'action';
    if v_ds is null or not (v_ds = any (s.datasets)) then raise exception 'dataset is not refreshed: %', left(coalesce(v_ds, ''), 60) using errcode = '22023'; end if;
    if v_id is null or length(v_id) not between 1 and 300 then raise exception 'invalid record id' using errcode = '22023'; end if;
    if v_action is null or v_action not in ('unchanged', 'index', 'no_doc', 'remove', 'defer', 'hold', 'error') then
      raise exception 'invalid action' using errcode = '22023'; end if;
    if v_action in ('unchanged', 'index', 'no_doc') and coalesce(e ->> 'fingerprint', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'a fingerprint is required' using errcode = '22023'; end if;
    select * into q from semantic.refresh_queue where dataset = v_ds and record_id = v_id for update;
    if not found or q.seq is distinct from (e ->> 'seq')::bigint then
      v_counts := semantic.bump(v_counts, v_ds, 'stale', 1);
      continue;
    end if;
    if v_action = 'defer' then
      update semantic.refresh_queue set missing_since = coalesce(missing_since, now()), last_attempt_at = now()
        where dataset = v_ds and record_id = v_id;
      v_counts := semantic.bump(v_counts, v_ds, 'deferred', 1);
      continue;
    elsif v_action = 'hold' then
      -- a hold for the budget or a setting may set a time before which the record is not read again (zero-token work
      -- queued behind it goes on; the record keeps its place for the next day)
      update semantic.refresh_queue set last_error = semantic.clean_error(coalesce(e ->> 'reason', 'held')), last_attempt_at = now(),
        not_before = case when coalesce((e ->> 'not_before_seconds')::integer, 0) > 0
                          then now() + make_interval(secs => least((e ->> 'not_before_seconds')::integer, 172800)) end
        where dataset = v_ds and record_id = v_id;
      v_counts := semantic.bump(v_counts, v_ds, 'held', 1);
      continue;
    elsif v_action = 'error' then
      update semantic.refresh_queue set attempts = attempts + 1, last_error = semantic.clean_error(coalesce(e ->> 'reason', 'error')),
        last_attempt_at = now() where dataset = v_ds and record_id = v_id;
      v_counts := semantic.bump(v_counts, v_ds, 'errors', 1);
      continue;
    end if;

    select count(*), coalesce(max(c.chunk_total), 0) into v_b_n, v_b_total from semantic.chunks c where c.dataset = v_ds and c.record_id = v_id;
    v_present := semantic.source_present(v_ds, v_id);
    v_removals := coalesce((r.counts -> v_ds ->> 'removals')::bigint, 0) + coalesce((v_counts -> v_ds ->> 'removals')::bigint, 0);

    if v_action = 'remove' then
      if v_present is distinct from false then
        v_skipped := v_skipped || jsonb_build_object('dataset', v_ds, 'record_id', v_id, 'why', 'source_present_or_unknown');
        v_counts := semantic.bump(v_counts, v_ds, 'skipped', 1);
        continue;
      end if;
      if not coalesce(semantic.source_ready(v_ds), false) or q.missing_since is null or q.missing_since > now() - s.removal_grace then
        v_skipped := v_skipped || jsonb_build_object('dataset', v_ds, 'record_id', v_id, 'why', 'grace_or_source_not_ready');
        v_counts := semantic.bump(v_counts, v_ds, 'skipped', 1);
        continue;
      end if;
      if v_b_n > 0 and v_removals >= semantic.removal_limit(v_ds) then
        v_skipped := v_skipped || jsonb_build_object('dataset', v_ds, 'record_id', v_id, 'why', 'removal_guard');
        v_counts := semantic.bump(v_counts, v_ds, 'removal_guard', 1);
        continue;
      end if;
      perform semantic.retire_record(v_ds, v_id, '{}', p_run);
      perform semantic.delete_passages(v_ds, v_id, 0);
      perform semantic.forget_record(v_ds, v_id);
      perform semantic.dequeue(v_ds, v_id);
      v_counts := semantic.bump(semantic.bump(v_counts, v_ds, 'removed', 1), v_ds, 'removals', (v_b_n > 0)::integer);
      v_counts := semantic.bump(v_counts, v_ds, 'chunks_deleted', v_b_n);

    elsif v_action = 'no_doc' then
      if v_present is distinct from true then
        v_skipped := v_skipped || jsonb_build_object('dataset', v_ds, 'record_id', v_id, 'why', 'source_gone');
        v_counts := semantic.bump(v_counts, v_ds, 'skipped', 1);
        continue;
      end if;
      if v_b_n > 0 and v_removals >= semantic.removal_limit(v_ds) then
        v_skipped := v_skipped || jsonb_build_object('dataset', v_ds, 'record_id', v_id, 'why', 'removal_guard');
        v_counts := semantic.bump(v_counts, v_ds, 'removal_guard', 1);
        continue;
      end if;
      perform semantic.retire_record(v_ds, v_id, '{}', p_run);
      perform semantic.delete_passages(v_ds, v_id, 0);
      insert into semantic.refresh_records as l (dataset, record_id, fingerprint, state, doc_sha256, chunks, refreshed_at, run_id)
        values (v_ds, v_id, e ->> 'fingerprint', 'no_doc', null, 0, now(), p_run)
        on conflict (dataset, record_id) do update set fingerprint = excluded.fingerprint, state = excluded.state,
          doc_sha256 = excluded.doc_sha256, chunks = excluded.chunks, refreshed_at = excluded.refreshed_at, run_id = excluded.run_id;
      perform semantic.dequeue(v_ds, v_id);
      v_counts := semantic.bump(semantic.bump(v_counts, v_ds, 'no_doc', 1), v_ds, 'removals', (v_b_n > 0)::integer);
      v_counts := semantic.bump(v_counts, v_ds, 'chunks_deleted', v_b_n);

    elsif v_action = 'unchanged' then
      if coalesce(e ->> 'state', '') not in ('indexed', 'no_doc') then raise exception 'state must be indexed or no_doc' using errcode = '22023'; end if;
      insert into semantic.refresh_records as l (dataset, record_id, fingerprint, state, doc_sha256, chunks, refreshed_at, run_id)
        values (v_ds, v_id, e ->> 'fingerprint', e ->> 'state', nullif(e ->> 'doc_sha256', ''), v_b_n, now(), p_run)
        on conflict (dataset, record_id) do update set fingerprint = excluded.fingerprint, state = excluded.state,
          doc_sha256 = excluded.doc_sha256, chunks = excluded.chunks, refreshed_at = excluded.refreshed_at, run_id = excluded.run_id;
      perform semantic.dequeue(v_ds, v_id);
      v_counts := semantic.bump(v_counts, v_ds, 'unchanged', 1);

    else -- index
      if v_present is distinct from true then
        v_skipped := v_skipped || jsonb_build_object('dataset', v_ds, 'record_id', v_id, 'why', 'source_gone');
        v_counts := semantic.bump(v_counts, v_ds, 'skipped', 1);
        continue;
      end if;
      v_rows := e -> 'rows';
      if jsonb_typeof(v_rows) is distinct from 'array' or jsonb_array_length(v_rows) not between 1 and 200 then
        raise exception 'index needs 1 to 200 passages' using errcode = '22023'; end if;
      v_n := jsonb_array_length(v_rows);
      if exists (select 1 from jsonb_array_elements(v_rows) with ordinality y(v, o)
                 where (y.v ->> 'chunk_no')::integer is distinct from (y.o - 1)::integer
                    or coalesce(y.v ->> 'embed_sha256', '') !~ '^[a-f0-9]{64}$'
                    or coalesce(y.v ->> 'text_sha256', '') !~ '^[a-f0-9]{64}$'
                    or (y.v ->> 'chunk_total')::integer < v_n) then
        raise exception 'passages must be numbered 0..n-1 in order, with keys and text hashes' using errcode = '22023'; end if;
      -- resolve every vector before anything changes
      v_keys := array(select y.v ->> 'embed_sha256' from jsonb_array_elements(v_rows) with ordinality y(v, o) order by y.o);
      v_vecs := array[]::extensions.halfvec[];
      foreach v_key in array v_keys loop
        v_vec := semantic.embedding_for(v_key);
        if v_vec is null then
          raise exception 'no stored vector for passage key %', left(v_key, 16) using errcode = '22023';
        end if;
        v_vecs := v_vecs || v_vec;
      end loop;
      perform semantic.retire_record(v_ds, v_id, v_keys, p_run);
      i := 0;
      v_written := 0;
      for x in select y.v from jsonb_array_elements(v_rows) with ordinality y(v, o) order by y.o loop
        i := i + 1;
        with ins as (
          insert into semantic.chunks as t (dataset, record_id, chunk_no, chunk_total, char_start, char_end, text_sha256, title, href,
                                            source_url, snippet, embedding)
          values (v_ds, v_id, (x ->> 'chunk_no')::integer, (x ->> 'chunk_total')::integer, (x ->> 'char_start')::integer,
                  (x ->> 'char_end')::integer, x ->> 'text_sha256', x ->> 'title', x ->> 'href', nullif(x ->> 'source_url', ''),
                  x ->> 'snippet', v_vecs[i])
          on conflict (dataset, record_id, chunk_no) do update set chunk_total = excluded.chunk_total, char_start = excluded.char_start,
            char_end = excluded.char_end, text_sha256 = excluded.text_sha256, title = excluded.title, href = excluded.href,
            source_url = excluded.source_url, snippet = excluded.snippet, embedding = excluded.embedding
            where (t.chunk_total, t.char_start, t.char_end, t.text_sha256, t.title, t.href, t.source_url, t.snippet)
                    is distinct from (excluded.chunk_total, excluded.char_start, excluded.char_end, excluded.text_sha256, excluded.title,
                                      excluded.href, excluded.source_url, excluded.snippet)
               or t.embedding operator(extensions.<>) excluded.embedding
          returning 1)
        select count(*) into v_w from ins;
        v_written := v_written + v_w;
        insert into semantic.chunk_keys as k (dataset, record_id, chunk_no, text_sha256, embed_sha256)
          values (v_ds, v_id, (x ->> 'chunk_no')::integer, x ->> 'text_sha256', x ->> 'embed_sha256')
          on conflict (dataset, record_id, chunk_no) do update set text_sha256 = excluded.text_sha256, embed_sha256 = excluded.embed_sha256
          where (k.text_sha256, k.embed_sha256) is distinct from (excluded.text_sha256, excluded.embed_sha256);
      end loop;
      v_del := semantic.delete_passages(v_ds, v_id, v_n);
      insert into semantic.refresh_records as l (dataset, record_id, fingerprint, state, doc_sha256, chunks, refreshed_at, run_id)
        values (v_ds, v_id, e ->> 'fingerprint', 'indexed', nullif(e ->> 'doc_sha256', ''), v_n, now(), p_run)
        on conflict (dataset, record_id) do update set fingerprint = excluded.fingerprint, state = excluded.state,
          doc_sha256 = excluded.doc_sha256, chunks = excluded.chunks, refreshed_at = excluded.refreshed_at, run_id = excluded.run_id;
      perform semantic.dequeue(v_ds, v_id);
      v_counts := semantic.bump(v_counts, v_ds, case when v_b_n = 0 then 'added' else 'indexed' end, 1);
      v_counts := semantic.bump(semantic.bump(v_counts, v_ds, 'chunks_written', v_written), v_ds, 'chunks_deleted', v_del);
    end if;

    select count(*), coalesce(max(c.chunk_total), 0) into v_a_n, v_a_total from semantic.chunks c where c.dataset = v_ds and c.record_id = v_id;
    v_delta := semantic.bump(v_delta, v_ds, 'records', (v_a_n > 0)::integer - (v_b_n > 0)::integer);
    v_delta := semantic.bump(v_delta, v_ds, 'chunks', v_a_n - v_b_n);
    v_delta := semantic.bump(v_delta, v_ds, 'capped', (v_a_n > 0 and v_a_total > v_a_n)::integer - (v_b_n > 0 and v_b_total > v_b_n)::integer);
  end loop;

  -- corpora counts: recounted exactly for every collection whose passages this call changed (so a purge or load done
  -- outside the refresh is corrected too); unchanged collections are not touched
  for d in select x.key from jsonb_each(v_delta) x
           where coalesce((x.value ->> 'records')::integer, 0) <> 0 or coalesce((x.value ->> 'chunks')::integer, 0) <> 0
              or coalesce((x.value ->> 'capped')::integer, 0) <> 0 loop
    update semantic.corpora k set
      records = (select count(*) from (select distinct c.record_id from semantic.chunks c where c.dataset = d) t),
      chunks = (select count(*) from semantic.chunks c where c.dataset = d),
      capped_records = (select count(*) from (select c.record_id from semantic.chunks c where c.dataset = d
                          group by c.record_id having max(c.chunk_total) > count(*)) t),
      loaded_at = now()
    where k.dataset = d;
  end loop;
  update semantic.refresh_runs set counts = semantic.merge_counts(counts, v_counts) where id = p_run;
  return jsonb_build_object('counts', v_counts, 'skipped', v_skipped);
end $$;

-- Close a run, expire cache entries older than 30 days and settle reservations left open for a day (counted in full).
create or replace function public.semantic_refresh_finish_run_v1(p_run uuid, p_status text, p_stop_reason text, p_notes jsonb,
  p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r semantic.refresh_runs; v_cache integer; v_stale integer;
begin
  if p_status not in ('ok', 'partial', 'failed') then raise exception 'status must be ok, partial or failed' using errcode = '22023'; end if;
  select * into r from semantic.refresh_runs where id = p_run for update;
  if not found then raise exception 'unknown run' using errcode = '22023'; end if;
  if r.status <> 'running' then raise exception 'run is already %', r.status using errcode = '22023'; end if;
  if p_notes is not null and (jsonb_typeof(p_notes) <> 'object' or octet_length(p_notes::text) > 20000) then
    raise exception 'notes must be an object of at most 20000 bytes' using errcode = '22023'; end if;
  with del as (delete from semantic.vector_cache v where v.embed_sha256 in (
      select v2.embed_sha256 from semantic.vector_cache v2 where v2.created_at < now() - interval '30 days' limit 5000) returning 1)
  select count(*) into v_cache from del;
  with st as (update semantic.embedding_usage set tokens = reserved, settled_at = now(), note = 'left open: counted at the reservation'
              where kind = 'reservation' and settled_at is null and at < now() - interval '1 day' returning 1)
  select count(*) into v_stale from st;
  update semantic.refresh_runs set status = p_status, finished_at = now(), stop_reason = left(p_stop_reason, 60),
    error = semantic.clean_error(p_error),
    notes = notes || coalesce(p_notes, '{}') || jsonb_build_object('cache_expired', v_cache, 'stale_reservations_settled', v_stale)
    where id = p_run returning * into r;
  return jsonb_build_object('run_id', r.id, 'status', r.status, 'stop_reason', r.stop_reason, 'tokens', r.tokens,
    'requests', r.requests, 'inputs_embedded', r.inputs_embedded, 'counts', r.counts, 'usage', semantic.usage_state());
end $$;

-- ------------------------------------------------------------------------------------------------ 5. setup and operations
-- Queue every record of one collection (the baseline), at most p_limit corpus rows per call by id; call again with the
-- returned last_id until done. When the corpus rows are done, indexed records with no corpus row are queued as removed.
-- caselaw_scotus queues its indexed records (presence is checked against the case-law store).
create or replace function public.semantic_refresh_enqueue_v1(p_dataset text, p_after text default null, p_limit integer default 50000,
  p_reason text default 'baseline') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 50000), 1), 200000); v_n integer; v_k integer; v_last text; v_gone integer := 0;
begin
  if p_reason not in ('baseline', 'manual') then raise exception 'reason must be baseline or manual' using errcode = '22023'; end if;
  if p_dataset = 'caselaw_scotus' then
    with page as (select distinct c.record_id from semantic.chunks c where c.dataset = p_dataset and c.record_id > coalesce(p_after, '')
                  order by c.record_id limit v_limit),
    ins as (insert into semantic.refresh_queue (dataset, record_id, reason) select p_dataset, p.record_id, p_reason from page p
            on conflict (dataset, record_id) do nothing returning 1)
    select (select count(*) from page), (select max(p.record_id) from page p), (select count(*) from ins) into v_n, v_last, v_k;
  elsif p_dataset = any (semantic.source_datasets()) then
    with page as (select c.id from public.corpus_records c where c.dataset = p_dataset and c.id > coalesce(p_after, '')
                  order by c.id limit v_limit),
    ins as (insert into semantic.refresh_queue (dataset, record_id, reason) select p_dataset, p.id, p_reason from page p
            on conflict (dataset, record_id) do nothing returning 1)
    select (select count(*) from page), (select max(p.id) from page p), (select count(*) from ins) into v_n, v_last, v_k;
    if v_n < v_limit and semantic.source_ready(p_dataset) then
      with gone as (select distinct c.record_id from semantic.chunks c where c.dataset = p_dataset
                      and not exists (select 1 from public.corpus_records r where r.dataset = p_dataset and r.id = c.record_id)),
      ins as (insert into semantic.refresh_queue as q (dataset, record_id, reason, missing_since)
              select p_dataset, g.record_id, 'removed', now() from gone g
              on conflict (dataset, record_id) do update set missing_since = coalesce(q.missing_since, now()) where q.missing_since is null
              returning 1)
      select count(*) into v_gone from ins;
    end if;
  else
    raise exception 'not a refreshed dataset' using errcode = '22023';
  end if;
  return jsonb_build_object('dataset', p_dataset, 'rows', v_n, 'queued', v_k, 'last_id', v_last, 'done', v_n < v_limit,
    'gone_queued', v_gone);
end $$;

-- Seed the embed keys of stored passages from the batch build's shard metadata (scripts/semantic/refresh_seed.py): rows
-- [{"r": record_id, "n": chunk_no, "t": text_sha256, "k": embed_sha256}], at most 10,000. A key is kept only where the
-- stored passage has that text hash (a reload with other shards needs a new seed).
create or replace function public.semantic_refresh_seed_keys_v1(p_dataset text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_match integer; v_written integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 10000 then
    raise exception 'pass 1 to 10000 rows' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where coalesce(x ->> 'k', '') !~ '^[a-f0-9]{64}$'
             or coalesce(x ->> 't', '') !~ '^[a-f0-9]{64}$' or jsonb_typeof(x -> 'n') <> 'number' or jsonb_typeof(x -> 'r') <> 'string') then
    raise exception 'rows need r, n, t and k' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_rows);
  with src as (select x ->> 'r' as r, (x ->> 'n')::integer as n, x ->> 't' as t, x ->> 'k' as k from jsonb_array_elements(p_rows) x),
  ok as (select s2.* from src s2 join semantic.chunks c on c.dataset = p_dataset and c.record_id = s2.r and c.chunk_no = s2.n and c.text_sha256 = s2.t),
  ins as (insert into semantic.chunk_keys as k (dataset, record_id, chunk_no, text_sha256, embed_sha256)
          select p_dataset, ok.r, ok.n, ok.t, ok.k from ok
          on conflict (dataset, record_id, chunk_no) do update set text_sha256 = excluded.text_sha256, embed_sha256 = excluded.embed_sha256
          where (k.text_sha256, k.embed_sha256) is distinct from (excluded.text_sha256, excluded.embed_sha256)
          returning 1)
  select (select count(*) from ok), (select count(*) from ins) into v_match, v_written;
  return jsonb_build_object('received', v_n, 'matched', v_match, 'written', v_written, 'unmatched', v_n - v_match);
end $$;

-- Record embedding usage outside the scheduled refresh: kind 'seed' (one row: the batch build's total, replaced on a new
-- call) or 'external' (another embedding run, e.g. embed.py, added to the total).
create or replace function public.semantic_refresh_record_usage_v1(p_kind text, p_tokens bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('seed', 'external') then raise exception 'kind must be seed or external' using errcode = '22023'; end if;
  if p_tokens is null or p_tokens < 0 then raise exception 'tokens must be a non-negative number' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('semantic:embedding_usage', 0));
  if p_kind = 'seed' then
    insert into semantic.embedding_usage as u (kind, reserved, tokens, settled_at, note) values ('seed', p_tokens, p_tokens, now(), left(p_note, 500))
      on conflict (kind) where kind = 'seed' do update set reserved = excluded.reserved, tokens = excluded.tokens,
        settled_at = excluded.settled_at, note = excluded.note, at = now();
  else
    insert into semantic.embedding_usage (kind, reserved, tokens, settled_at, note) values ('external', p_tokens, p_tokens, now(), left(p_note, 500));
  end if;
  return semantic.usage_state();
end $$;

create or replace function public.semantic_refresh_status_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'sweep_cursor' from semantic.refresh_settings s where s.id = 1),
    'usage', semantic.usage_state(),
    'queue', coalesce((select jsonb_agg(jsonb_build_object('dataset', t.dataset, 'reason', t.reason, 'records', t.n, 'oldest', t.oldest,
                 'failing', t.failing, 'deferred', t.deferred) order by t.dataset, t.reason)
               from (select q.dataset, q.reason, count(*) as n, min(q.first_seen_at) as oldest, count(*) filter (where q.attempts >= 3) as failing,
                            count(*) filter (where q.not_before > now()) as deferred
                     from semantic.refresh_queue q group by 1, 2) t), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('dataset', t.dataset, 'state', t.state, 'records', t.n) order by t.dataset, t.state)
               from (select l.dataset, l.state, count(*) as n from semantic.refresh_records l group by 1, 2) t), '[]'::jsonb),
    'keys', coalesce((select jsonb_object_agg(t.dataset, t.n) from (select k.dataset, count(*) as n from semantic.chunk_keys k group by 1) t), '{}'::jsonb),
    'cache', (select jsonb_build_object('vectors', count(*), 'oldest', min(v.created_at)) from semantic.vector_cache v),
    'runs', coalesce((select jsonb_agg(to_jsonb(x) - 'counts' order by x.started_at desc) from (
               select r.id, r.trigger, r.started_at, r.finished_at, r.status, r.stop_reason, r.tokens, r.requests, r.inputs_embedded,
                      r.error, r.counts from semantic.refresh_runs r order by r.started_at desc limit 10) x), '[]'::jsonb))
$$;

-- ------------------------------------------------------------------------------------------------ 6. grants
do $grants$
declare f text;
begin
  foreach f in array array[
    'public.semantic_refresh_check_trigger_v1(text)', 'public.semantic_refresh_open_run_v1(text)',
    'public.semantic_refresh_detect_v1(uuid)', 'public.semantic_refresh_pending_v1(jsonb,integer,integer,text[])',
    'public.semantic_refresh_known_keys_v1(text[])', 'public.semantic_refresh_reserve_v1(uuid,text,bigint,integer)',
    'public.semantic_refresh_settle_v1(bigint,bigint)', 'public.semantic_refresh_cache_vectors_v1(uuid,jsonb)',
    'public.semantic_refresh_apply_v1(uuid,jsonb)', 'public.semantic_refresh_finish_run_v1(uuid,text,text,jsonb,text)',
    'public.semantic_refresh_enqueue_v1(text,text,integer,text)', 'public.semantic_refresh_seed_keys_v1(text,jsonb)',
    'public.semantic_refresh_record_usage_v1(text,bigint,text)', 'public.semantic_refresh_status_v1()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'semantic.source_spec(text)', 'semantic.pick(jsonb,jsonb)',
    'semantic.source_input(text,text,text,text,text,jsonb,jsonb,jsonb)', 'semantic.fingerprint(jsonb)', 'semantic.usc_title_map()',
    'semantic.source_datasets()', 'semantic.source_present(text,text)', 'semantic.source_ready(text)', 'semantic.clean_error(text)',
    'semantic.usage_state()', 'semantic.removal_limit(text)', 'semantic.embedding_for(text)',
    'semantic.ledger_holds(text,text,text,integer)',
    'semantic.retire_record(text,text,text[],uuid)', 'semantic.bump(jsonb,text,text,bigint)',
    'semantic.delete_passages(text,text,integer)', 'semantic.forget_record(text,text)', 'semantic.dequeue(text,text)', 'semantic.merge_counts(jsonb,jsonb)',
    'semantic.enqueue_one(text,text,text,jsonb)', 'semantic.enqueue_corpus_change()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $grants$;

comment on table semantic.refresh_queue is 'Semantic refresh: records of the indexed collections that changed, appeared or disappeared and are not processed yet (semantic-refresh-v1.sql).';
comment on table semantic.embedding_usage is 'Semantic refresh: embedding token ledger (seed = the batch build; reservations = refresh requests) behind the daily and global caps.';

commit;

-- ------------------------------------------------------------------------------------------------ 8. trigger secret
-- Generated once, inside the database, where Vault is installed (64 hex characters); never printed; re-applying keeps it.
do $secret$
begin
  if to_regclass('vault.secrets') is null then
    raise notice 'semantic refresh trigger secret not created: Vault is not installed';
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'semantic_refresh_cron_secret') then
    perform vault.create_secret(
      encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'),
      'semantic_refresh_cron_secret',
      'Bearer token the semantic refresh cron jobs send to the semantic-refresh edge function (semantic-refresh-v1.sql)');
  end if;
end $secret$;

-- ------------------------------------------------------------------------------------------------ 9. schedule (LEAD)
-- After the nightly source refreshes and the insights refresh (06:23 UTC): eight posts from 06:37 to 07:47 UTC, ten minutes
-- apart; each run continues the oldest pending records within its time and CPU bounds (one run at a time). A post is sent
-- only while semantic.refresh_settings.enabled is true. Re-running this block updates the jobs in place.
do $schedule$
declare v_cmd text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'semantic refresh schedule not installed: pg_cron and pg_net must both be enabled';
    return;
  end if;
  v_cmd := $cmd$
select net.http_post(
  url := 'https://xosqzzsnhxcyehcnirpa.supabase.co/functions/v1/semantic-refresh',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'semantic_refresh_cron_secret')),
  body := jsonb_build_object('trigger', 'schedule'),
  timeout_milliseconds := 10000)
where exists (select 1 from semantic.refresh_settings where id = 1 and enabled)$cmd$;
  perform cron.schedule('semantic-refresh-a', '37,47,57 6 * * *', v_cmd);
  perform cron.schedule('semantic-refresh-b', '7,17,27,37,47 7 * * *', v_cmd);
end $schedule$;
