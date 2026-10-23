-- ingest/1 — self-updating sources: source registry, run ledger and cursors, the upsert RPC the scheduled edge functions
-- call, insights_freshness_v1 (shape: Freshness in src/lib/insights/contract.ts) and the pg_cron + pg_net schedule.
--
-- Owner decision 2026-10-23 (evening): high-change official sources are fetched on a schedule by Supabase edge functions
-- (supabase/functions/ingest-*, shared logic in src/lib/ingest/**); new and changed records land in the same corpus
-- datasets the site already reads, in the same record shape and with the same provenance as the original builders; every
-- run is recorded in ingest.runs; the insights layer refreshes the affected metrics (insights.refresh_for_datasets).
--
-- Invariants:
--   * Rows are written only through public.ingest_upsert_v1 by an open run of the source that owns the dataset. Every row
--     is checked (dataset, keys, types, category, id pattern, no credentials in URLs) before anything is written; one
--     invalid row rolls the whole batch back.
--   * Upsert by (dataset, id): an identical row is left untouched (no write); a changed row keeps its ordinal; an
--     insert-only source never rewrites a held row. Nothing is deleted.
--   * Ordinals follow the builder's order: 'prepend' datasets (newest first, e.g. federal_register_history) give new rows
--     ordinals below the current minimum, 'append' datasets (oldest first) above the current maximum.
--   * The catalog never claims a count it does not hold: in the same transaction as the writes, expected_records,
--     imported_records, metadata.listing.total (and listing_modes.*.total, configured summary counts) are set from a
--     count(*) of the stored rows; counted filter options move by exactly the filter values written; metadata.manifest
--     marks the dataset as a rolling update with the run id (manifest_sha256 keeps the base full build's digest).
--
-- Every public function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to
-- service_role. Idempotent (create if not exists / create or replace / on conflict). Section 9 (cron) is a guarded block
-- that does nothing until pg_cron and pg_net are both installed: apply this file again after enabling pg_net.
-- Offline test: src/lib/ingest/contract.test.mjs (pglite).
--
-- Deployment (lead; project xosqzzsnhxcyehcnirpa — supabase/config.toml names another project, so pass --project-ref):
--   1. create extension if not exists pg_net;                    (pg_cron is already installed)
--   2. apply this file (safe to re-apply; sources stay disabled until step 7).
--   3. function secrets, by name: INGEST_CRON_SECRET (a new random value) and DATA_GOV_API_KEY (ingest-ftc-hsr);
--      the same INGEST_CRON_SECRET value in Vault: select vault.create_secret('<value>', 'ingest_cron_secret');
--   4. from the repository root: supabase functions deploy <name> --project-ref xosqzzsnhxcyehcnirpa --no-verify-jwt
--      for ingest-federal-register, ingest-openfda-enforcement, ingest-cpsc-recalls, ingest-ftc-hsr (each imports
--      src/lib/ingest; if the bundler refuses that, deploy the copies from node scripts/ingest/bundle_functions.mjs <dir>).
--   5. first run of each source, one at a time: POST https://xosqzzsnhxcyehcnirpa.supabase.co/functions/v1/<name> with
--      Authorization: Bearer <INGEST_CRON_SECRET> and body {"source": "<id>", "trigger": "manual", "wait": true}.
--   6. check: select source, status, fetched, inserted, updated, unchanged, held, error, notes from ingest.runs
--      order by started_at desc limit 20;   and   select public.insights_freshness_v1();
--   7. update ingest.sources set enabled = true where id in (...); then apply this file again (section 9 schedules).
--   The manual continuation scripts/ingest/federal-register/run.mjs must not run once ingest-federal-register is enabled.

begin;

create schema if not exists ingest;
revoke all on schema ingest from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ 1. tables
create table if not exists ingest.sources (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,62}$'),
  dataset text not null unique check (dataset ~ '^[a-z0-9_]{1,80}$'),
  label text not null,
  publisher text not null,
  source_url text not null check (source_url ~ '^https://'),
  function_name text not null check (function_name ~ '^ingest-[a-z0-9-]{1,60}$'),
  schedule text not null check (schedule ~ '^[0-9*,/-]+( [0-9*,/-]+){4}$'),   -- cron, UTC (section 9)
  enabled boolean not null default false,          -- scheduled runs only; a manual run works while disabled
  stale_after interval not null,                   -- freshness: no successful run for this long = stale
  mode text not null check (mode in ('insert_only', 'upsert')),
  ordinal_policy text not null check (ordinal_policy in ('prepend', 'append')),
  category text not null check (category not in ('', 'unknown', 'uncategorized')),
  id_pattern text not null,                        -- every row id must match (anchored regex)
  catalog jsonb not null default '{}',             -- {"counted_filters": [..], "extend_filters": [..], "summary_counts": {key: offset}}
  terms_note text not null,
  rate_note text not null,
  updated_at timestamptz not null default now()
);

create table if not exists ingest.runs (
  id uuid primary key default gen_random_uuid(),
  source text not null references ingest.sources (id),
  dataset text not null,
  trigger text not null default 'schedule' check (trigger in ('schedule', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'failed', 'partial')),
  fetched integer not null default 0 check (fetched >= 0),     -- source records read (as reported by the function)
  inserted integer not null default 0 check (inserted >= 0),   -- counted by ingest_upsert_v1, never by the caller
  updated integer not null default 0 check (updated >= 0),
  unchanged integer not null default 0 check (unchanged >= 0),
  held integer not null default 0 check (held >= 0),           -- read but not applied by rule (see notes)
  error text,
  cursor_before jsonb,
  cursor_after jsonb,
  ordinal_min_at_open bigint,
  ordinal_max_at_open bigint,
  records_before bigint,
  records_after bigint,
  requests jsonb not null default '[]',   -- [{url (never a key), status, bytes, sha256, retrieved_at}]
  notes jsonb not null default '{}',
  insights_refresh jsonb,
  constraint runs_finished_when_done check ((status = 'running') = (finished_at is null))
);
create index if not exists runs_source_started on ingest.runs (source, started_at desc);
create unique index if not exists runs_one_running on ingest.runs (source) where status = 'running';

create table if not exists ingest.cursors (
  source text primary key references ingest.sources (id),
  cursor jsonb not null,
  run_id uuid references ingest.runs (id),
  updated_at timestamptz not null default now()
);

alter table ingest.sources enable row level security;
alter table ingest.runs enable row level security;
alter table ingest.cursors enable row level security;
revoke all on all tables in schema ingest from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ 2. sources
-- Re-applying this file updates the configuration but never changes `enabled` (the lead turns sources on).
insert into ingest.sources as s (id, dataset, label, publisher, source_url, function_name, schedule, stale_after, mode,
  ordinal_policy, category, id_pattern, catalog, terms_note, rate_note)
values
  ('federal_register', 'federal_register_history', 'Federal Register documents', 'Office of the Federal Register (NARA) and GPO',
   'https://www.federalregister.gov/developers/documentation/api/v1', 'ingest-federal-register', '23 14,21 * * 1-5',
   interval '4 days', 'insert_only', 'prepend', 'federal_register_history', '^[0-9]{1,9}$',
   '{"counted_filters": ["type", "year", "agency", "cfr_title"], "extend_filters": ["year"], "summary_counts": {"records": 0, "listing_records": 0, "native_default_records": 0}, "notes": true}',
   'FederalRegister.gov API v1, no key; Federal Register documents are U.S. government works (17 U.S.C. 105).',
   'No published request limit; one request at a time, at least 1 s apart, at most 10 publication days and 30 pages per run.'),
  ('openfda_drug_enforcement', 'agency_safety_openfda_drug_enforcement', 'FDA drug enforcement reports', 'U.S. Food and Drug Administration (openFDA)',
   'https://open.fda.gov/apis/drug/enforcement/', 'ingest-openfda-enforcement', '41 9 * * *',
   interval '3 days', 'upsert', 'prepend', 'agency_safety', '^openfda:drug/enforcement:[A-Za-z0-9-]{1,40}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {}}',
   'openFDA data: CC0 public domain (https://open.fda.gov/license/); terms https://open.fda.gov/terms/; "Do not rely on openFDA to make decisions regarding medical care".',
   'Without a key: 240 requests per minute and 1,000 per day per IP (https://open.fda.gov/apis/authentication/); requests at least 1 s apart, at most 12 per run.'),
  ('openfda_device_enforcement', 'agency_safety_openfda_device_enforcement', 'FDA device enforcement reports', 'U.S. Food and Drug Administration (openFDA)',
   'https://open.fda.gov/apis/device/enforcement/', 'ingest-openfda-enforcement', '7 10 * * *',
   interval '3 days', 'upsert', 'prepend', 'agency_safety', '^openfda:device/enforcement:[A-Za-z0-9-]{1,40}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {}}',
   'openFDA data: CC0 public domain (https://open.fda.gov/license/); terms https://open.fda.gov/terms/; "Do not rely on openFDA to make decisions regarding medical care".',
   'Without a key: 240 requests per minute and 1,000 per day per IP (https://open.fda.gov/apis/authentication/); requests at least 1 s apart, at most 12 per run.'),
  ('openfda_food_enforcement', 'agency_safety_openfda_food_enforcement', 'FDA food enforcement reports', 'U.S. Food and Drug Administration (openFDA)',
   'https://open.fda.gov/apis/food/enforcement/', 'ingest-openfda-enforcement', '29 10 * * *',
   interval '3 days', 'upsert', 'prepend', 'agency_safety', '^openfda:food/enforcement:[A-Za-z0-9-]{1,40}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {}}',
   'openFDA data: CC0 public domain (https://open.fda.gov/license/); terms https://open.fda.gov/terms/; "Do not rely on openFDA to make decisions regarding medical care".',
   'Without a key: 240 requests per minute and 1,000 per day per IP (https://open.fda.gov/apis/authentication/); requests at least 1 s apart, at most 12 per run.'),
  ('cpsc_recalls', 'agency_safety_cpsc_recalls_api', 'CPSC recalls', 'U.S. Consumer Product Safety Commission',
   'https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information', 'ingest-cpsc-recalls', '52 15 * * *',
   interval '3 days', 'upsert', 'append', 'agency_safety_cpsc_recalls_api', '^cpsc-api:[A-Za-z0-9-]{1,20}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {}}',
   'CPSC Recall REST API (SaferProducts.gov), no key; CPSC recall notices are U.S. government works (17 U.S.C. 105).',
   'No published request limit; requests at least 2 s apart, at most 6 per run (one window of recent publication dates).'),
  ('ftc_hsr', 'ftc_hsr_early_terminations', 'FTC HSR early termination notices', 'U.S. Federal Trade Commission',
   'https://www.ftc.gov/developer/api/v0/endpoints/hsr-early-termination-notices', 'ingest-ftc-hsr', '11 16 * * 1-5',
   interval '4 days', 'upsert', 'append', 'ftc_hsr_early_terminations', '^([0-9]{8}(-[0-9]{1,3})?|api-[0-9a-f-]{1,8}|series-by-year)$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0, "notices": -1}}',
   'FTC API (api.ftc.gov), read-only with an api.data.gov key sent in a header (never in a recorded URL); FTC material is a U.S. government work (FTC Website Policy).',
   'api.data.gov limits each key per hour and the key is shared with other jobs: requests 2 s apart, at most 4 pages of 50 notices per run.')
on conflict (id) do update set
  dataset = excluded.dataset, label = excluded.label, publisher = excluded.publisher, source_url = excluded.source_url,
  function_name = excluded.function_name, schedule = excluded.schedule, stale_after = excluded.stale_after,
  mode = excluded.mode, ordinal_policy = excluded.ordinal_policy, category = excluded.category,
  id_pattern = excluded.id_pattern, catalog = excluded.catalog, terms_note = excluded.terms_note,
  rate_note = excluded.rate_note, updated_at = now()
where (s.dataset, s.label, s.publisher, s.source_url, s.function_name, s.schedule, s.stale_after, s.mode, s.ordinal_policy,
       s.category, s.id_pattern, s.catalog, s.terms_note, s.rate_note)
  is distinct from (excluded.dataset, excluded.label, excluded.publisher, excluded.source_url, excluded.function_name,
       excluded.schedule, excluded.stale_after, excluded.mode, excluded.ordinal_policy, excluded.category,
       excluded.id_pattern, excluded.catalog, excluded.terms_note, excluded.rate_note);

-- ------------------------------------------------------------------------------------------------ 3. helpers
-- Why a row cannot be written (null when it can). Same column set as corpus_writer.record + an optional ordinal.
create or replace function ingest.row_problem(p_row jsonb, p_dataset text, p_category text, p_id_pattern text) returns text
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if jsonb_typeof(p_row) is distinct from 'object' then return 'row is not an object'; end if;
  for k in select jsonb_object_keys(p_row) loop
    if k not in ('dataset', 'id', 'category', 'state', 'county_geoids', 'title', 'source_url', 'ordinal', 'item', 'detail', 'text', 'filters') then
      return 'unexpected key ' || left(k, 40);
    end if;
  end loop;
  if p_row->>'dataset' is distinct from p_dataset then return 'dataset differs from the run''s dataset'; end if;
  if jsonb_typeof(p_row->'id') is distinct from 'string' or (p_row->>'id') !~ p_id_pattern then return 'id does not match the source pattern'; end if;
  if p_row->>'category' is distinct from p_category then return 'category differs from the source category'; end if;
  if jsonb_typeof(p_row->'title') is distinct from 'string' or length(p_row->>'title') > 4000 then return 'title missing or longer than 4000 characters'; end if;
  if jsonb_typeof(p_row->'text') is distinct from 'string' then return 'text missing'; end if;
  if jsonb_typeof(p_row->'source_url') is distinct from 'string' then return 'source_url missing'; end if;
  if (p_row->>'source_url') <> '' and (p_row->>'source_url') !~ '^https?://[^\s]+$' then return 'source_url is not an http(s) URL'; end if;
  if p_row ? 'state' and jsonb_typeof(p_row->'state') not in ('string', 'null') then return 'state is not text'; end if;
  if p_row ? 'county_geoids' and (jsonb_typeof(p_row->'county_geoids') <> 'array'
      or exists (select 1 from jsonb_array_elements(p_row->'county_geoids') g where jsonb_typeof(g) <> 'string')) then
    return 'county_geoids is not an array of text';
  end if;
  if p_row ? 'ordinal' and jsonb_typeof(p_row->'ordinal') <> 'number' then return 'ordinal is not a number'; end if;
  if jsonb_typeof(p_row->'item') is distinct from 'object' or p_row->'item'->>'id' is distinct from p_row->>'id' then return 'item missing or item.id differs from id'; end if;
  if jsonb_typeof(p_row->'detail') is distinct from 'object' then return 'detail is not an object'; end if;
  if jsonb_typeof(p_row->'filters') is distinct from 'object' then return 'filters is not an object'; end if;
  if octet_length(p_row::text) > 1000000 then return 'row larger than 1 MB'; end if;
  -- a recorded URL never carries a credential
  if p_row::text ~* '[?&](api[_-]?key|apikey|access_token|token|key)=' then return 'row contains a credential-like URL parameter'; end if;
  return null;
end $$;

-- Values of one filter of a row as text (array elements or a scalar); empty when absent.
create or replace function ingest.filter_values(p_filters jsonb, p_name text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(case jsonb_typeof(p_filters->p_name)
    when 'array' then (select array_agg(distinct v) from jsonb_array_elements_text(p_filters->p_name) v)
    when 'string' then array[p_filters->>p_name]
    when 'number' then array[p_filters->>p_name]
    else null end, '{}')
$$;

-- Add {value: delta} counts of one filter to a list of filter definitions; extend = add an option for a new value.
create or replace function ingest.bump_filter_list(p_filters jsonb, p_bumps jsonb, p_extend text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  out jsonb := '[]';
  f jsonb; opts jsonb; o jsonb; name text; v text; d bigint; seen text[]; added jsonb;
begin
  if jsonb_typeof(p_filters) is distinct from 'array' then return p_filters; end if;
  for f in select x from jsonb_array_elements(p_filters) x loop
    name := f->>'name';
    if p_bumps ? name and jsonb_typeof(f->'options') = 'array' then
      opts := '[]'; seen := '{}';
      for o in select x from jsonb_array_elements(f->'options') x loop
        v := o->>'value';
        if jsonb_typeof(o->'count') = 'number' and p_bumps->name ? v then
          o := jsonb_set(o, '{count}', to_jsonb((o->>'count')::bigint + (p_bumps->name->>v)::bigint));
        end if;
        seen := seen || v;
        opts := opts || jsonb_build_array(o);
      end loop;
      if name = any (p_extend) then
        added := '[]';
        for v, d in select key, value::bigint from jsonb_each_text(p_bumps->name) order by key desc loop
          if not (v = any (seen)) and d > 0 then
            added := added || jsonb_build_array(jsonb_build_object('label', v, 'value', v, 'count', d));
          end if;
        end loop;
        opts := added || opts;
      end if;
      f := jsonb_set(f, '{options}', opts);
    end if;
    out := out || jsonb_build_array(f);
  end loop;
  return out;
end $$;

-- The catalog metadata after a batch: totals from the stored count, counted filters moved by the written values, and the
-- rolling-update marker. Pure: tested offline.
create or replace function ingest.catalog_metadata(p_meta jsonb, p_count bigint, p_catalog jsonb, p_bumps jsonb,
  p_source text, p_run uuid, p_base_sha256 text, p_inserted integer, p_updated integer, p_at timestamptz) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  m jsonb := coalesce(p_meta, '{}');
  extend text[] := array(select jsonb_array_elements_text(coalesce(p_catalog->'extend_filters', '[]')));
  k text; off bigint; prev jsonb;
begin
  if jsonb_typeof(m->'listing') = 'object' then
    m := jsonb_set(m, '{listing,total}', to_jsonb(p_count));
    if p_bumps <> '{}' then m := jsonb_set(m, '{listing,filters}', ingest.bump_filter_list(m->'listing'->'filters', p_bumps, extend)); end if;
  end if;
  if jsonb_typeof(m->'listing_modes') = 'object' then
    for k in select jsonb_object_keys(m->'listing_modes') loop
      if jsonb_typeof(m->'listing_modes'->k) = 'object' then
        m := jsonb_set(m, array['listing_modes', k, 'total'], to_jsonb(p_count));
        if p_bumps <> '{}' and jsonb_typeof(m->'listing_modes'->k->'filters') = 'array' then
          m := jsonb_set(m, array['listing_modes', k, 'filters'], ingest.bump_filter_list(m->'listing_modes'->k->'filters', p_bumps, extend));
        end if;
      end if;
    end loop;
  end if;
  if jsonb_typeof(m->'summary') = 'object' then
    for k, off in select key, value::bigint from jsonb_each_text(coalesce(p_catalog->'summary_counts', '{}')) loop
      if jsonb_typeof(m->'summary'->k) = 'number' then m := jsonb_set(m, array['summary', k], to_jsonb(p_count + off)); end if;
    end loop;
  end if;
  prev := case when jsonb_typeof(m->'manifest') = 'object' and m->'manifest'->>'kind' = 'rolling_update' then m->'manifest' else null end;
  m := jsonb_set(m, '{manifest}', jsonb_build_object(
    'kind', 'rolling_update',
    'note', 'Rows were added or changed after the full build by the scheduled source runs listed in ingest.runs; manifest_sha256 is the digest of the base full build, records is the stored count.',
    'source', p_source,
    'base_manifest_sha256', coalesce(prev->>'base_manifest_sha256', p_base_sha256),
    'last_run_id', p_run,
    'last_applied_at', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'runs_applied', coalesce((prev->>'runs_applied')::integer, 0) + case when prev->>'last_run_id' = p_run::text then 0 else 1 end,
    'records_inserted_since_base', coalesce((prev->>'records_inserted_since_base')::bigint, 0) + p_inserted,
    'records_updated_since_base', coalesce((prev->>'records_updated_since_base')::bigint, 0) + p_updated,
    'records', p_count));
  return m;
end $$;

-- Error text for the ledger: never a credential, at most 1,000 characters.
create or replace function ingest.clean_error(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(regexp_replace(coalesce(p, ''), '(^|[?&[:space:]])((api[_-]?key|apikey|access_token|token|key)=)[^&[:space:]"'']*', '\1\2[removed]', 'gi'), 1000), '')
$$;

-- ------------------------------------------------------------------------------------------------ 4. run lifecycle
-- Open a run. A scheduled run needs the source enabled; a manual run (first run, catch-up) does not. A run left open for
-- more than 20 minutes (the function's limit is far shorter) is closed as failed first. One open run per source.
create or replace function public.ingest_open_run_v1(p_source text, p_trigger text default 'schedule') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s ingest.sources;
  v_run uuid;
  v_min bigint; v_max bigint; v_count bigint;
  v_cursor jsonb;
begin
  if p_trigger not in ('schedule', 'manual') then raise exception 'trigger must be schedule or manual'; end if;
  select * into s from ingest.sources where id = p_source;
  if not found then raise exception 'unknown ingest source %', left(coalesce(p_source, ''), 64); end if;
  if p_trigger = 'schedule' and not s.enabled then return jsonb_build_object('skipped', 'disabled', 'source', s.id); end if;
  update ingest.runs set status = 'failed', finished_at = now(), error = 'abandoned: the run did not finish within 20 minutes'
    where source = s.id and status = 'running' and started_at < now() - interval '20 minutes';
  if exists (select 1 from ingest.runs where source = s.id and status = 'running') then
    return jsonb_build_object('skipped', 'busy', 'source', s.id);
  end if;
  if not exists (select 1 from public.corpus_datasets where id = s.dataset) then
    raise exception 'dataset % is not in the catalog; publish the full build first', s.dataset;
  end if;
  select min(ordinal), max(ordinal), count(*) into v_min, v_max, v_count from public.corpus_records where dataset = s.dataset;
  select cursor into v_cursor from ingest.cursors where source = s.id;
  insert into ingest.runs (source, dataset, trigger, cursor_before, ordinal_min_at_open, ordinal_max_at_open, records_before)
    values (s.id, s.dataset, p_trigger, v_cursor, v_min, v_max, v_count)
    returning id into v_run;
  return jsonb_build_object('run_id', v_run, 'source', s.id, 'dataset', s.dataset, 'mode', s.mode,
    'ordinal_policy', s.ordinal_policy, 'cursor', v_cursor, 'records', v_count, 'ordinal_min', v_min, 'ordinal_max', v_max);
end $$;

-- Write one batch (at most 500 rows) of an open run. Rows are applied in the given order; for a 'prepend' dataset give
-- each batch newest first and send older batches first, for an 'append' dataset oldest first. A row may carry an
-- explicit ordinal (federal_register_history derives its ids from ordinals); it must be unused and beyond the dataset's
-- range when the run opened. Inserted and updated rows are counted here, never taken from the caller.
create or replace function public.ingest_upsert_v1(p_run uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r ingest.runs;
  s ingest.sources;
  d public.corpus_datasets;
  e jsonb; problem text; i integer := 0;
  cur public.corpus_records;
  v_new integer; v_next bigint; v_ord bigint; v_count bigint;
  n_ins integer := 0; n_upd integer := 0; n_same integer := 0; n_held integer := 0;
  held_ids text[] := '{}';
  bumps jsonb := '{}';
  counted text[];
  f text; v text;
  v_geo text[];
begin
  select * into r from ingest.runs where id = p_run for update;
  if not found then raise exception 'unknown run'; end if;
  if r.status <> 'running' then raise exception 'run is %, not running', r.status; end if;
  select * into s from ingest.sources where id = r.source;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'p_rows must be an array of 1 to 500 rows';
  end if;
  for e in select x from jsonb_array_elements(p_rows) x loop
    i := i + 1;
    problem := ingest.row_problem(e, s.dataset, s.category, s.id_pattern);
    if problem is not null then raise exception 'row % rejected: %', i, problem; end if;
  end loop;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_rows) x) <> jsonb_array_length(p_rows) then
    raise exception 'duplicate ids in the batch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ingest:' || s.dataset, 0));
  select * into d from public.corpus_datasets where id = s.dataset for update;
  if not found then raise exception 'dataset % is not in the catalog', s.dataset; end if;
  counted := array(select jsonb_array_elements_text(coalesce(s.catalog->'counted_filters', '[]')));

  select count(*) into v_new from jsonb_array_elements(p_rows) x
    where not exists (select 1 from public.corpus_records c where c.dataset = s.dataset and c.id = x->>'id');
  if s.ordinal_policy = 'prepend' then
    select coalesce(min(ordinal), 0) - v_new into v_next from public.corpus_records where dataset = s.dataset;
  else
    select coalesce(max(ordinal), -1) + 1 into v_next from public.corpus_records where dataset = s.dataset;
  end if;

  for e in select x from jsonb_array_elements(p_rows) x loop
    v_geo := coalesce(array(select jsonb_array_elements_text(e->'county_geoids')), '{}');
    select * into cur from public.corpus_records where dataset = s.dataset and id = e->>'id' for update;
    if not found then
      if e ? 'ordinal' then
        v_ord := (e->>'ordinal')::bigint;
        if exists (select 1 from public.corpus_records where dataset = s.dataset and ordinal = v_ord) then
          raise exception 'ordinal % is already used in %', v_ord, s.dataset;
        end if;
        if s.ordinal_policy = 'prepend' and r.ordinal_min_at_open is not null and v_ord >= r.ordinal_min_at_open then
          raise exception 'ordinal % is not below the dataset''s first ordinal %', v_ord, r.ordinal_min_at_open;
        end if;
        if s.ordinal_policy = 'append' and r.ordinal_max_at_open is not null and v_ord <= r.ordinal_max_at_open then
          raise exception 'ordinal % is not above the dataset''s last ordinal %', v_ord, r.ordinal_max_at_open;
        end if;
      else
        v_ord := v_next;
        v_next := v_next + 1;
      end if;
      insert into public.corpus_records (dataset, id, category, state, county_geoids, title, source_url, ordinal, item, detail, text, filters)
        values (s.dataset, e->>'id', e->>'category', coalesce(e->>'state', ''), v_geo, e->>'title', e->>'source_url', v_ord,
                e->'item', e->'detail', e->>'text', e->'filters');
      n_ins := n_ins + 1;
      foreach f in array counted loop
        foreach v in array ingest.filter_values(e->'filters', f) loop
          bumps := jsonb_set(bumps, array[f], coalesce(bumps->f, '{}') || jsonb_build_object(v, coalesce((bumps->f->>v)::bigint, 0) + 1));
        end loop;
      end loop;
    elsif (cur.category, coalesce(cur.state, ''), cur.county_geoids, cur.title, coalesce(cur.source_url, ''), cur.item, cur.detail, cur.text, cur.filters)
          is not distinct from (e->>'category', coalesce(e->>'state', ''), v_geo, e->>'title', e->>'source_url', e->'item', e->'detail', e->>'text', e->'filters') then
      n_same := n_same + 1;
    elsif s.mode = 'insert_only' then
      n_held := n_held + 1;
      if cardinality(held_ids) < 50 then held_ids := held_ids || (e->>'id'); end if;
    else
      update public.corpus_records set category = e->>'category', state = coalesce(e->>'state', ''), county_geoids = v_geo,
        title = e->>'title', source_url = e->>'source_url', item = e->'item', detail = e->'detail', text = e->>'text', filters = e->'filters'
        where dataset = s.dataset and id = e->>'id';
      n_upd := n_upd + 1;
      foreach f in array counted loop
        foreach v in array ingest.filter_values(cur.filters, f) loop
          bumps := jsonb_set(bumps, array[f], coalesce(bumps->f, '{}') || jsonb_build_object(v, coalesce((bumps->f->>v)::bigint, 0) - 1));
        end loop;
        foreach v in array ingest.filter_values(e->'filters', f) loop
          bumps := jsonb_set(bumps, array[f], coalesce(bumps->f, '{}') || jsonb_build_object(v, coalesce((bumps->f->>v)::bigint, 0) + 1));
        end loop;
      end loop;
    end if;
  end loop;

  if n_ins + n_upd > 0 then
    select count(*) into v_count from public.corpus_records where dataset = s.dataset;
    update public.corpus_datasets set expected_records = v_count, imported_records = v_count,
      metadata = ingest.catalog_metadata(d.metadata, v_count, s.catalog, bumps, s.id, r.id, d.manifest_sha256, n_ins, n_upd, now()),
      updated_at = now()
      where id = s.dataset;
  end if;
  update ingest.runs set inserted = inserted + n_ins, updated = updated + n_upd, unchanged = unchanged + n_same, held = held + n_held,
    notes = case when cardinality(held_ids) = 0 then notes
      else jsonb_set(notes, '{held_existing_ids}', coalesce(notes->'held_existing_ids', '[]') || to_jsonb(held_ids)) end
    where id = r.id;
  return jsonb_build_object('received', jsonb_array_length(p_rows), 'inserted', n_ins, 'updated', n_upd, 'unchanged', n_same, 'held', n_held);
end $$;

-- Close a run. ok/partial store cursor_after as the source's cursor (partial = resumable progress); failed keeps it.
-- p_unchanged: source records the function compared with the stored row, found identical and did not send (inserted and
-- updated are only ever counted by ingest_upsert_v1); p_held: records held back by a source rule (listed in p_notes).
create or replace function public.ingest_finish_run_v1(p_run uuid, p_status text, p_fetched integer, p_held integer,
  p_unchanged integer, p_cursor_after jsonb, p_error text, p_requests jsonb, p_notes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r ingest.runs; v_count bigint;
begin
  if p_status not in ('ok', 'failed', 'partial') then raise exception 'status must be ok, failed or partial'; end if;
  select * into r from ingest.runs where id = p_run for update;
  if not found then raise exception 'unknown run'; end if;
  if r.status <> 'running' then raise exception 'run is already %', r.status; end if;
  if coalesce(p_fetched, 0) < 0 or coalesce(p_held, 0) < 0 or coalesce(p_unchanged, 0) < 0 then raise exception 'counts must not be negative'; end if;
  if p_requests is not null and (jsonb_typeof(p_requests) <> 'array' or p_requests::text ~* '[?&](api[_-]?key|apikey|access_token|token|key)=') then
    raise exception 'requests must be an array of request records without credentials';
  end if;
  select count(*) into v_count from public.corpus_records where dataset = r.dataset;
  update ingest.runs set status = p_status, finished_at = now(), fetched = coalesce(p_fetched, 0), held = held + coalesce(p_held, 0),
    unchanged = unchanged + coalesce(p_unchanged, 0),
    cursor_after = case when p_status = 'failed' then r.cursor_before else p_cursor_after end,
    error = ingest.clean_error(p_error), requests = coalesce(p_requests, '[]'),
    notes = notes || coalesce(case when jsonb_typeof(p_notes) = 'object' then p_notes end, '{}'), records_after = v_count
    where id = r.id returning * into r;
  if p_status in ('ok', 'partial') and p_cursor_after is not null then
    insert into ingest.cursors (source, cursor, run_id, updated_at) values (r.source, p_cursor_after, r.id, now())
      on conflict (source) do update set cursor = excluded.cursor, run_id = excluded.run_id, updated_at = excluded.updated_at;
  end if;
  return jsonb_build_object('run_id', r.id, 'source', r.source, 'dataset', r.dataset, 'status', r.status, 'fetched', r.fetched,
    'inserted', r.inserted, 'updated', r.updated, 'unchanged', r.unchanged, 'held', r.held,
    'records_before', r.records_before, 'records_after', r.records_after);
end $$;

-- Catalog text a source restates after adding rows (federal_register_history: the listing qualification with the new
-- coverage end and a continuations entry, as scripts/ingest/federal-register/run.mjs wrote them). Only for sources whose
-- catalog config has "notes": true, only after this run inserted rows, once per run; records_added and runs are set here
-- from the run itself.
create or replace function public.ingest_catalog_note_v1(p_run uuid, p_note jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r ingest.runs; s ingest.sources; m jsonb; k text; c jsonb;
begin
  select * into r from ingest.runs where id = p_run for update;
  if not found then raise exception 'unknown run'; end if;
  if r.status <> 'running' then raise exception 'run is %, not running', r.status; end if;
  select * into s from ingest.sources where id = r.source;
  if coalesce((s.catalog->>'notes')::boolean, false) is not true then raise exception 'source % does not write catalog notes', s.id; end if;
  if r.notes ? 'catalog_note_applied' then raise exception 'this run already wrote its catalog note'; end if;
  if jsonb_typeof(p_note) is distinct from 'object' or exists (select 1 from jsonb_object_keys(p_note) x where x not in ('qualification', 'continuation')) then
    raise exception 'note keys are qualification and continuation';
  end if;
  if p_note ? 'qualification' and (jsonb_typeof(p_note->'qualification') <> 'string' or length(p_note->>'qualification') > 2000) then
    raise exception 'qualification must be text of at most 2000 characters';
  end if;
  if p_note ? 'continuation' and (jsonb_typeof(p_note->'continuation') <> 'object' or octet_length((p_note->'continuation')::text) > 4000) then
    raise exception 'continuation must be an object of at most 4000 bytes';
  end if;
  if r.inserted = 0 then return jsonb_build_object('applied', false, 'reason', 'no rows inserted by this run'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ingest:' || s.dataset, 0));
  select metadata into m from public.corpus_datasets where id = s.dataset for update;
  if p_note ? 'qualification' then
    if jsonb_typeof(m->'listing') = 'object' then m := jsonb_set(m, '{listing,qualification}', p_note->'qualification'); end if;
    if jsonb_typeof(m->'listing_modes') = 'object' then
      for k in select jsonb_object_keys(m->'listing_modes') loop
        if jsonb_typeof(m->'listing_modes'->k) = 'object' then m := jsonb_set(m, array['listing_modes', k, 'qualification'], p_note->'qualification'); end if;
      end loop;
    end if;
  end if;
  if p_note ? 'continuation' then
    c := (p_note->'continuation') || jsonb_build_object('records_added', r.inserted, 'runs', jsonb_build_array(r.id));
    m := jsonb_set(m, '{continuations}', coalesce(case when jsonb_typeof(m->'continuations') = 'array' then m->'continuations' end, '[]') || jsonb_build_array(c));
  end if;
  update public.corpus_datasets set metadata = m, updated_at = now() where id = s.dataset;
  update ingest.runs set notes = notes || jsonb_build_object('catalog_note_applied', true) where id = r.id;
  return jsonb_build_object('applied', true, 'records_added', r.inserted);
end $$;

-- Refresh the insights metrics that read the run's dataset (W2: insights.refresh_for_datasets(text[])). Called after the
-- run is closed, so a slow or failing refresh never changes the run's own outcome; the result is kept on the run.
create or replace function public.ingest_refresh_insights_v1(p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r ingest.runs; result jsonb; v text;
begin
  select * into r from ingest.runs where id = p_run;
  if not found then raise exception 'unknown run'; end if;
  if r.status = 'running' then raise exception 'run is still open'; end if;
  if r.inserted + r.updated = 0 then
    result := jsonb_build_object('status', 'skipped', 'reason', 'no rows written');
  elsif to_regprocedure('insights.refresh_for_datasets(text[])') is null then
    result := jsonb_build_object('status', 'not_installed');
  else
    begin
      execute 'select insights.refresh_for_datasets($1)::text' into v using array[r.dataset];
      result := jsonb_build_object('status', 'ok', 'result', left(coalesce(v, ''), 2000));
    exception when others then
      result := jsonb_build_object('status', 'failed', 'error', ingest.clean_error(sqlerrm));
    end;
  end if;
  result := result || jsonb_build_object('at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'datasets', jsonb_build_array(r.dataset));
  update ingest.runs set insights_refresh = result where id = r.id;
  return result;
end $$;

-- Distinct text values at a path of item (array elements or a scalar) across a source dataset. Used where a builder rule
-- depends on values over the whole dataset (CPSC: the set of standalone manufacturer-country strings).
create or replace function public.ingest_distinct_text_v1(p_dataset text, p_path text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from ingest.sources where dataset = p_dataset) then raise exception 'not an ingest dataset'; end if;
  if cardinality(p_path) not between 1 and 4 then raise exception 'path must have 1 to 4 keys'; end if;
  return coalesce((
    select array_agg(distinct v order by v) from (
      select jsonb_array_elements_text(c.item #> p_path) v from public.corpus_records c
        where c.dataset = p_dataset and jsonb_typeof(c.item #> p_path) = 'array'
      union all
      select c.item #>> p_path from public.corpus_records c
        where c.dataset = p_dataset and jsonb_typeof(c.item #> p_path) = 'string') t
    where v is not null), '{}');
end $$;

-- ------------------------------------------------------------------------------------------------ 5. freshness (insights/1)
-- Freshness[] (src/lib/insights/contract.ts): one entry per configured source.
--   lastRunAt      start of the latest run (any status)
--   lastSuccessAt  end of the latest ok or partial run (a partial run wrote what it read, then stopped at its page bound)
--   newRecords     rows inserted by that run
--   status         never_run (no finished successful run yet), failed (the latest finished run failed),
--                  stale (no successful run within the source's stale_after), else ok
create or replace function public.insights_freshness_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'source'), '[]') from (
    select jsonb_build_object(
      'source', s.id,
      'dataset', s.dataset,
      'lastRunAt', to_char(latest.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'lastSuccessAt', to_char(success.finished_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'newRecords', success.inserted,
      'status', case
        when latest.id is null then 'never_run'
        when finished.status = 'failed' then 'failed'
        when success.id is null then 'never_run'
        when success.finished_at < now() - s.stale_after then 'stale'
        else 'ok' end,
      'message', case
        when latest.id is null then case when s.enabled then 'Scheduled; no run yet' else 'Not scheduled yet' end
        when finished.status = 'failed' then 'Last run failed: ' || coalesce(left(finished.error, 300), 'no error recorded')
        when success.id is null then 'First run in progress'
        when success.finished_at < now() - s.stale_after then 'No successful run since ' || to_char(success.finished_at at time zone 'UTC', 'YYYY-MM-DD')
        when success.status = 'partial' then 'Last run stopped at its page limit; the next run continues'
        else null end
    ) x
    from ingest.sources s
    left join lateral (select * from ingest.runs r where r.source = s.id order by r.started_at desc limit 1) latest on true
    left join lateral (select * from ingest.runs r where r.source = s.id and r.status <> 'running' order by r.finished_at desc limit 1) finished on true
    left join lateral (select * from ingest.runs r where r.source = s.id and r.status in ('ok', 'partial') order by r.finished_at desc limit 1) success on true
  ) t
$$;

-- ------------------------------------------------------------------------------------------------ 6. grants
do $grants$
declare f text;
begin
  foreach f in array array[
    'public.ingest_open_run_v1(text,text)', 'public.ingest_upsert_v1(uuid,jsonb)', 'public.ingest_catalog_note_v1(uuid,jsonb)',
    'public.ingest_finish_run_v1(uuid,text,integer,integer,integer,jsonb,text,jsonb,jsonb)', 'public.ingest_refresh_insights_v1(uuid)',
    'public.ingest_distinct_text_v1(text,text[])', 'public.insights_freshness_v1()',
    'ingest.row_problem(jsonb,text,text,text)', 'ingest.filter_values(jsonb,text)', 'ingest.bump_filter_list(jsonb,jsonb,text[])',
    'ingest.catalog_metadata(jsonb,bigint,jsonb,jsonb,text,uuid,text,integer,integer,timestamptz)', 'ingest.clean_error(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

comment on schema ingest is 'Self-updating sources (ingest/1): source registry, run ledger, cursors. Rows reach corpus_records only through public.ingest_upsert_v1.';

commit;

-- ------------------------------------------------------------------------------------------------ 9. schedule (LEAD)
-- LEAD: applies only when pg_cron AND pg_net are installed (enable pg_net first: create extension if not exists pg_net;).
-- Before the first scheduled run, store the shared trigger secret in Vault under the name ingest_cron_secret (the same
-- value as the edge-function secret INGEST_CRON_SECRET); the secret is read by name at run time and never written here.
-- One job per source (ingest-<source id>), jittered minutes, UTC; a job posts only while its source is enabled. Re-running
-- this block updates the jobs in place (cron.schedule replaces a job of the same name).
do $schedule$
declare s record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'ingest schedule not installed: pg_cron and pg_net must both be enabled; apply this file again afterwards';
    return;
  end if;
  for s in select id, function_name, schedule from ingest.sources order by id loop
    perform cron.schedule('ingest-' || replace(s.id, '_', '-'), s.schedule, format($cmd$
select net.http_post(
  url := 'https://xosqzzsnhxcyehcnirpa.supabase.co/functions/v1/%1$s',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_cron_secret')),
  body := jsonb_build_object('source', %2$L, 'trigger', 'schedule'),
  timeout_milliseconds := 10000)
where exists (select 1 from ingest.sources where id = %2$L and enabled)$cmd$, s.function_name, s.id));
  end loop;
end $schedule$;
