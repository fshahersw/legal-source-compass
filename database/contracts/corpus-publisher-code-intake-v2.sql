-- publisher-code-intake/2 — one generic, data-driven private intake for every state's full code.
-- Prepared additive contract; the release owner applies it once. Requires corpus-ingest-v1 and
-- canonical-integer-jsonb-v1 (deployed) and Supabase's private Storage catalog. The Texas contract
-- (publisher-code-intake/1) is untouched and keeps serving its open run.
--
-- What is data, not code: every publisher's parser manifest (publisher, official source URL patterns,
-- structure levels, currency rule, section-identity scheme, parser name/version) is registered as a
-- JSONB document hashed with canonical-integer-jsonb/1. A run pins one manifest; intake validates each
-- row against that manifest (URL patterns, section-id regex, hierarchy levels, parser, source system).
--
-- Identity: a section is <JURISDICTION>:<official citation path> (e.g. FL:95.11, NY:PEN:120.00).
-- A source unit (the retained publisher page / archive member / export file a parser cut sections
-- from) is <JURISDICTION>:unit:<unit key>. Both carry the publisher's currency statement verbatim,
-- the stated through-date when the publisher gives one, and the edition label.
--
-- Provenance, like the Texas adapter: every row names its original (sha256 of the retrieved bytes,
-- registered in corpus-originals with an authenticated whole-object readback receipt), source URL,
-- retrieval timestamp and method (proxied fetches are recorded as such), parser, canonical payload
-- hash and manifest hash. Section text is retained inline and hash-verified in SQL.
--
-- Gates: every row carries public_projection_allowed=false, current_law_verified=false and
-- calculation_activation_allowed=false. A per-state review_status and public_projection_allowed flag
-- live in publisher_code_states_v2 and change only through the review RPC. Nothing here writes a
-- public collection, a law tree or a calculator rule.
begin;

-- ---------------------------------------------------------------------------------------------
-- Tables (private schema, RLS on, service_role read-only; writes go through the RPCs below)
-- ---------------------------------------------------------------------------------------------
create table corpus_ingest.publisher_code_manifests_v2 (
  manifest_sha256 text primary key check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}$'),
  publisher text not null check (length(publisher) between 3 and 200),
  source_system text not null check (source_system ~ '^[a-z]{2}-[a-z0-9-]{3,60}$'),
  parser text not null check (parser ~ '^[a-z][a-z0-9-]{2,60}/[1-9][0-9]{0,3}$'),
  manifest jsonb not null,
  registered_at timestamptz not null default now(),
  unique (source_system, parser)
);
comment on table corpus_ingest.publisher_code_manifests_v2 is
  'Reviewed per-publisher parser manifests (publisher-code-manifest/2), registered as data and pinned by runs. Immutable per hash.';

create table corpus_ingest.publisher_code_states_v2 (
  jurisdiction text primary key check (jurisdiction ~ '^[A-Z]{2}$'),
  review_status text not null default 'manifest_registered'
    check (review_status in ('manifest_registered','acquiring','landed','reviewed','held')),
  public_projection_allowed boolean not null default false,
  publisher text,
  source_system text,
  current_manifest_sha256 text references corpus_ingest.publisher_code_manifests_v2(manifest_sha256),
  sections bigint not null default 0,
  units bigint not null default 0,
  currency jsonb not null default '{}'::jsonb,
  last_run uuid references corpus_ingest.runs(id),
  last_run_status text,
  last_run_finished_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  check (not public_projection_allowed or review_status = 'reviewed')
);
comment on table corpus_ingest.publisher_code_states_v2 is
  'Per-jurisdiction review status, projection gate and landed summary. public_projection_allowed can only be true once review_status is reviewed.';

create table corpus_ingest.publisher_code_objects_v2 (
  sha256 text primary key check (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint not null check (bytes > 0),
  kind text not null check (kind in ('publisher_original','unit_text_derivative')),
  bucket text not null check (bucket = 'corpus-originals'),
  object_key text not null unique,
  check (object_key = 'state-codes/sha256/' || left(sha256, 2) || '/' || sha256),
  code_points bigint check (kind <> 'unit_text_derivative' or code_points > 0),
  first_run uuid not null references corpus_ingest.runs(id),
  verified_at timestamptz not null,
  readback_receipt jsonb not null
);
create table corpus_ingest.publisher_code_object_sources_v2 (
  sha256 text not null references corpus_ingest.publisher_code_objects_v2(sha256),
  source_url text not null check (source_url ~ '^https://'),
  retrieved_at timestamptz not null,
  http_status integer not null check (http_status = 200),
  retrieval_method text not null check (retrieval_method in
    ('publisher_bulk_download','publisher_page','publisher_zip_member','publisher_api','proxied_fetch')),
  proxy text check (proxy is null or proxy in ('firecrawl','tavily')),
  check ((retrieval_method = 'proxied_fetch') = (proxy is not null)),
  run_id uuid not null references corpus_ingest.runs(id),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}$'),
  primary key (sha256, source_url, retrieved_at)
);
create table corpus_ingest.publisher_code_batches_v2 (
  run_id uuid not null references corpus_ingest.runs(id),
  batch_sha256 text not null check (batch_sha256 ~ '^[a-f0-9]{64}$'),
  batch_index integer not null check (batch_index >= 0),
  records integer not null check (records between 1 and 500),
  result jsonb not null,
  imported_at timestamptz not null default now(),
  primary key (run_id, batch_sha256),
  unique (run_id, batch_index)
);

alter table corpus_ingest.publisher_code_manifests_v2 enable row level security;
alter table corpus_ingest.publisher_code_states_v2 enable row level security;
alter table corpus_ingest.publisher_code_objects_v2 enable row level security;
alter table corpus_ingest.publisher_code_object_sources_v2 enable row level security;
alter table corpus_ingest.publisher_code_batches_v2 enable row level security;
revoke all on corpus_ingest.publisher_code_manifests_v2, corpus_ingest.publisher_code_states_v2,
  corpus_ingest.publisher_code_objects_v2, corpus_ingest.publisher_code_object_sources_v2,
  corpus_ingest.publisher_code_batches_v2 from public, anon, authenticated, service_role;
grant select on corpus_ingest.publisher_code_manifests_v2, corpus_ingest.publisher_code_states_v2,
  corpus_ingest.publisher_code_objects_v2, corpus_ingest.publisher_code_object_sources_v2,
  corpus_ingest.publisher_code_batches_v2 to service_role;

-- ---------------------------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_ingest.publisher_code_regex_ok_v2(p_pattern text)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  if p_pattern is null or length(p_pattern) not between 1 and 2000 then return false; end if;
  perform 'probe' ~ p_pattern;
  return true;
exception when invalid_regular_expression then return false;
end $$;

-- Manifest validation: shape, regex compilation, consistency, no terms gate.
create or replace function corpus_ingest.publisher_code_check_manifest_v2(m jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare p text; lvl jsonb;
begin
  if jsonb_typeof(m) is distinct from 'object'
    or m->>'schema_version' is distinct from 'publisher-code-manifest/2'
    or coalesce(m->>'jurisdiction','') !~ '^[A-Z]{2}$'
    or length(coalesce(m->>'publisher','')) not between 3 and 200
    or coalesce(m->>'publisher_url','') !~ '^https://'
    or coalesce(m->>'source_system','') !~ ('^' || lower(m->>'jurisdiction') || '-[a-z0-9-]{3,60}$')
    or length(coalesce(m->>'code_title','')) not between 3 and 200
    or jsonb_typeof(m->'parser') is distinct from 'object'
    or coalesce(m->'parser'->>'name','') !~ '^[a-z][a-z0-9-]{2,60}$'
    or coalesce(m->'parser'->>'version','') !~ '^[1-9][0-9]{0,3}$'
    or jsonb_typeof(m->'retrieval') is distinct from 'object'
    or jsonb_typeof(m->'retrieval'->'methods') is distinct from 'array'
    or jsonb_array_length(m->'retrieval'->'methods') not between 1 and 5
    or exists (select 1 from jsonb_array_elements_text(m->'retrieval'->'methods') x
               where x not in ('publisher_bulk_download','publisher_page','publisher_zip_member','publisher_api','proxied_fetch'))
    or jsonb_typeof(m->'retrieval'->'source_url_patterns') is distinct from 'array'
    or jsonb_array_length(m->'retrieval'->'source_url_patterns') not between 1 and 50
    or m->'retrieval'->'terms_gate' is distinct from 'false'::jsonb
    or m->'retrieval'->'official_source' is distinct from 'true'::jsonb
    or coalesce(m->'retrieval'->>'rate_limit_ms','') !~ '^[0-9]{3,6}$'
    or jsonb_typeof(m->'structure') is distinct from 'object'
    or jsonb_typeof(m->'structure'->'levels') is distinct from 'array'
    or jsonb_array_length(m->'structure'->'levels') not between 1 and 12
    or length(coalesce(m->'structure'->>'unit','')) not between 3 and 200
    or jsonb_typeof(m->'section_id') is distinct from 'object'
    or m->'section_id'->>'scheme' is distinct from 'official_citation_path'
    or not corpus_ingest.publisher_code_regex_ok_v2(m->'section_id'->>'regex')
    or length(coalesce(m->'section_id'->>'example','')) not between 1 and 200
    or (m->'section_id'->>'example') !~ (m->'section_id'->>'regex')
    or length(coalesce(m->'section_id'->>'citation_format','')) not between 3 and 200
    or jsonb_typeof(m->'currency') is distinct from 'object'
    or coalesce(m->'currency'->>'basis','') not in ('publisher_statement','publisher_metadata','archive_date')
    or length(coalesce(m->'currency'->>'location','')) not between 3 and 500
    or jsonb_typeof(m->'review') is distinct from 'object'
    or length(coalesce(m->'review'->>'reviewed_by','')) not between 3 and 200
    or coalesce(m->'review'->>'reviewed_at','') !~ '^\d{4}-\d{2}-\d{2}' then
    raise exception 'Invalid publisher-code manifest (shape, identity, gate or review fields)' using errcode='22023';
  end if;
  for p in select x from jsonb_array_elements_text(m->'retrieval'->'source_url_patterns') x loop
    if p !~ '^\^https://' or not corpus_ingest.publisher_code_regex_ok_v2(p) then
      raise exception 'Every source URL pattern must be an anchored https regex' using errcode='22023';
    end if;
  end loop;
  for lvl in select x from jsonb_array_elements(m->'structure'->'levels') x loop
    if jsonb_typeof(lvl) is distinct from 'string' or (lvl #>> '{}') !~ '^[a-z][a-z_]{1,40}$' then
      raise exception 'Structure levels must be lowercase identifiers' using errcode='22023';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements_text(m->'structure'->'levels') x group by x having count(*) > 1)
    or not (m->'structure'->'levels') @> '["section"]'::jsonb then
    raise exception 'Structure levels must be distinct and include section' using errcode='22023';
  end if;
end $$;

-- Open-run guard: returns the run scope; raises unless the run is open under this contract.
create or replace function corpus_ingest.publisher_code_open_run_v2(p_run uuid)
returns jsonb language plpgsql set search_path='' as $$
declare s jsonb;
begin
  select scope into s from corpus_ingest.runs
    where id = p_run and status in ('running','partial') for update;
  if s is null or s->>'contract' is distinct from 'publisher-code-intake/2'
    or coalesce(s->>'jurisdiction','') !~ '^[A-Z]{2}$'
    or coalesce(s->>'manifest_sha256','') !~ '^[a-f0-9]{64}$'
    or s->'private_only' is distinct from 'true'::jsonb
    or s->'public_projection_allowed' is distinct from 'false'::jsonb
    or s->'calculation_activation_allowed' is distinct from 'false'::jsonb
    or not exists (select 1 from corpus_ingest.publisher_code_manifests_v2 x
                   where x.manifest_sha256 = s->>'manifest_sha256' and x.jurisdiction = s->>'jurisdiction'
                     and x.source_system = s->>'source_system') then
    raise exception 'Exact open publisher-code-intake/2 run required' using errcode='22023';
  end if;
  return s;
end $$;

-- Recompute a state's landed summary from retained entities (one scan of that state's rows).
create or replace function corpus_ingest.publisher_code_summarize_state_v2(p_jurisdiction text)
returns jsonb language plpgsql set search_path='' as $$
declare v_source text; n_sections bigint; n_units bigint; cur jsonb;
begin
  select source_system into v_source from corpus_ingest.publisher_code_states_v2 where jurisdiction = p_jurisdiction;
  if v_source is null then return null; end if;
  select count(*) into n_sections from corpus_ingest.entities
    where source_system = v_source and entity_type = 'code-section' and review_status <> 'quarantined';
  select count(*) into n_units from corpus_ingest.entities
    where source_system = v_source and entity_type = 'code-source-unit' and review_status <> 'quarantined';
  select jsonb_build_object(
      'through_min', min(nullif(data->'currency'->>'through_date','')),
      'through_max', max(nullif(data->'currency'->>'through_date','')),
      'sections_with_through_date', count(*) filter (where nullif(data->'currency'->>'through_date','') is not null),
      'editions', coalesce((select jsonb_agg(distinct e) from (select data->'currency'->>'edition' e from corpus_ingest.entities
          where source_system = v_source and entity_type = 'code-section' and data->'currency'->>'edition' is not null) z), '[]'::jsonb),
      'bases', coalesce((select jsonb_agg(distinct b) from (select data->'currency'->>'basis' b from corpus_ingest.entities
          where source_system = v_source and entity_type = 'code-section') z), '[]'::jsonb),
      'summarized_at', now())
    into cur
    from corpus_ingest.entities where source_system = v_source and entity_type = 'code-section' and review_status <> 'quarantined';
  update corpus_ingest.publisher_code_states_v2
     set sections = n_sections, units = n_units, currency = coalesce(cur, '{}'::jsonb), updated_at = now()
   where jurisdiction = p_jurisdiction;
  return jsonb_build_object('jurisdiction', p_jurisdiction, 'sections', n_sections, 'units', n_units, 'currency', cur);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public RPCs (service_role only, SECURITY DEFINER, empty search_path)
-- ---------------------------------------------------------------------------------------------

-- 1. Register a reviewed manifest. Idempotent per hash; a new parser version is a new manifest.
create or replace function public.corpus_publisher_code_register_manifest_v2(p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h text; v_parser text; existing corpus_ingest.publisher_code_manifests_v2;
begin
  perform corpus_ingest.publisher_code_check_manifest_v2(p_manifest);
  if octet_length(p_manifest::text) > 262144 then raise exception 'Manifest exceeds 256 KiB' using errcode='22023'; end if;
  h := corpus_ingest.canonical_integer_jsonb_sha256_v1(p_manifest);
  v_parser := (p_manifest->'parser'->>'name') || '/' || (p_manifest->'parser'->>'version');
  select * into existing from corpus_ingest.publisher_code_manifests_v2 where manifest_sha256 = h;
  if found then
    return jsonb_build_object('manifest_sha256', h, 'jurisdiction', existing.jurisdiction, 'parser', existing.parser, 'registered', false, 'replayed', true);
  end if;
  if exists (select 1 from corpus_ingest.publisher_code_manifests_v2
             where source_system = p_manifest->>'source_system' and parser = v_parser) then
    raise exception 'A different manifest is already registered for this source system and parser version; bump the parser version' using errcode='22023';
  end if;
  if exists (select 1 from corpus_ingest.publisher_code_manifests_v2
             where jurisdiction = p_manifest->>'jurisdiction' and source_system <> p_manifest->>'source_system') then
    raise exception 'A jurisdiction keeps one source system across manifests' using errcode='22023';
  end if;
  if exists (select 1 from corpus_ingest.runs r where r.status in ('running','partial')
             and r.scope->>'contract' = 'publisher-code-intake/2' and r.scope->>'jurisdiction' = p_manifest->>'jurisdiction'
             and r.scope->>'manifest_sha256' is distinct from h) then
    raise exception 'An open run is pinned to a different manifest; finish it before registering a new parser version' using errcode='22023';
  end if;
  insert into corpus_ingest.publisher_code_manifests_v2(manifest_sha256, jurisdiction, publisher, source_system, parser, manifest)
    values (h, p_manifest->>'jurisdiction', p_manifest->>'publisher', p_manifest->>'source_system', v_parser, p_manifest);
  insert into corpus_ingest.publisher_code_states_v2(jurisdiction, publisher, source_system, current_manifest_sha256)
    values (p_manifest->>'jurisdiction', p_manifest->>'publisher', p_manifest->>'source_system', h)
    on conflict (jurisdiction) do update
      set publisher = excluded.publisher, source_system = excluded.source_system,
          current_manifest_sha256 = excluded.current_manifest_sha256, updated_at = now();
  return jsonb_build_object('manifest_sha256', h, 'jurisdiction', p_manifest->>'jurisdiction', 'parser', v_parser, 'registered', true, 'replayed', false);
end $$;

-- 2. Open a run pinned to a manifest. One open run per jurisdiction. Held states cannot open.
create or replace function public.corpus_publisher_code_open_run_v2(p_run uuid, p_manifest_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m corpus_ingest.publisher_code_manifests_v2; st corpus_ingest.publisher_code_states_v2; s jsonb; existing jsonb;
begin
  if p_run is null then raise exception 'Run id required' using errcode='22023'; end if;
  select * into m from corpus_ingest.publisher_code_manifests_v2 where manifest_sha256 = p_manifest_sha256;
  if not found then raise exception 'Unknown manifest' using errcode='22023'; end if;
  select * into st from corpus_ingest.publisher_code_states_v2 where jurisdiction = m.jurisdiction for update;
  if st.review_status = 'held' then raise exception 'Jurisdiction is held; no new run' using errcode='22023'; end if;
  s := jsonb_build_object('contract', 'publisher-code-intake/2', 'jurisdiction', m.jurisdiction,
         'source_system', m.source_system, 'publisher', m.publisher, 'parser', m.parser,
         'manifest_sha256', m.manifest_sha256, 'private_only', true,
         'public_projection_allowed', false, 'calculation_activation_allowed', false);
  select scope into existing from corpus_ingest.runs where id = p_run;
  if existing is not null then
    if existing is distinct from s then raise exception 'Run exists with a different scope' using errcode='22023'; end if;
  else
    if exists (select 1 from corpus_ingest.runs r where r.status in ('running','partial')
               and r.scope->>'contract' = 'publisher-code-intake/2' and r.scope->>'jurisdiction' = m.jurisdiction) then
      raise exception 'Another run is open for this jurisdiction; finish it first' using errcode='22023';
    end if;
    insert into corpus_ingest.runs(id, status, scope) values (p_run, 'running', s);
    update corpus_ingest.publisher_code_states_v2
       set review_status = case when review_status in ('manifest_registered','landed') then 'acquiring' else review_status end,
           current_manifest_sha256 = m.manifest_sha256, last_run = p_run, last_run_status = 'running',
           last_run_finished_at = null, updated_at = now()
     where jurisdiction = m.jurisdiction;
  end if;
  return (select jsonb_build_object('run_id', r.id, 'status', r.status, 'scope', r.scope) from corpus_ingest.runs r where r.id = p_run);
end $$;

-- 3. Register content-addressed originals and text derivatives with their whole-object readback
--    receipts and source references. SQL checks receipt consistency and the private catalog row;
--    it cannot hash remote bytes. Idempotent; a hash with different bytes/kind is rejected.
create or replace function public.corpus_publisher_code_register_objects_v2(p_run uuid, p_objects jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; o jsonb; v jsonb; src jsonb; old corpus_ingest.publisher_code_objects_v2;
        n_objects integer := 0; n_sources integer := 0; total bigint := 0;
begin
  s := corpus_ingest.publisher_code_open_run_v2(p_run);
  if jsonb_typeof(p_objects) is distinct from 'array' or jsonb_array_length(p_objects) not between 1 and 2000
    or octet_length(p_objects::text) > 8388608 then
    raise exception 'Bounded object list required' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_objects) x group by x->>'sha256' having count(*) <> 1) then
    raise exception 'Duplicate object hashes in one registration' using errcode='22023';
  end if;
  for o in select value from jsonb_array_elements(p_objects) loop
    v := o->'readback';
    if coalesce(o->>'sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(o->>'bytes','') !~ '^[1-9][0-9]{0,10}$'
      or coalesce(o->>'kind','') not in ('publisher_original','unit_text_derivative')
      or jsonb_typeof(v) is distinct from 'object'
      or v->'bytes' is distinct from o->'bytes'
      or v->>'bucket' is distinct from 'corpus-originals'
      or v->>'object_key' is distinct from 'state-codes/sha256/' || left(o->>'sha256', 2) || '/' || (o->>'sha256')
      or v->>'readback_sha256' is distinct from o->>'sha256'
      or v->'readback_bytes' is distinct from o->'bytes'
      or v->>'verification_method' is distinct from 'authenticated-whole-object-get-sha256'
      or v->'http_status' is distinct from '200'::jsonb
      or coalesce(v->>'verified_at','') = ''
      or (o->>'kind' = 'unit_text_derivative' and (
            v->>'readback_text_encoding' is distinct from 'utf-8'
            or coalesce(v->>'readback_text_code_points','') !~ '^[1-9][0-9]{0,8}$'
            or (v->>'readback_text_code_points')::bigint > (o->>'bytes')::bigint))
      or jsonb_typeof(o->'sources') is distinct from 'array'
      or jsonb_array_length(o->'sources') not between 1 and 50
      or not exists (select 1 from storage.objects so join storage.buckets b on b.id = so.bucket_id
                     where b.id = 'corpus-originals' and b.public is false and so.name = v->>'object_key'
                       and so.metadata->>'size' = o->>'bytes') then
      raise exception 'Verified private object with whole-body readback receipt required (%)', left(coalesce(o->>'sha256','?'), 12) using errcode='22023';
    end if;
    select * into old from corpus_ingest.publisher_code_objects_v2 where sha256 = o->>'sha256';
    if found and (old.bytes <> (o->>'bytes')::bigint or old.kind <> o->>'kind'
                  or old.code_points is distinct from nullif(v->>'readback_text_code_points','')::bigint) then
      raise exception 'Stored object identity conflicts with retained bytes (%)', left(o->>'sha256', 12) using errcode='22023';
    end if;
    insert into corpus_ingest.publisher_code_objects_v2(sha256, bytes, kind, bucket, object_key, code_points, first_run, verified_at, readback_receipt)
      values (o->>'sha256', (o->>'bytes')::bigint, o->>'kind', 'corpus-originals', v->>'object_key',
              nullif(v->>'readback_text_code_points','')::bigint, p_run, (v->>'verified_at')::timestamptz, v)
      on conflict do nothing;
    if found then n_objects := n_objects + 1; total := total + (o->>'bytes')::bigint; end if;
    for src in select value from jsonb_array_elements(o->'sources') loop
      if coalesce(src->>'source_url','') !~ '^https://'
        or not exists (select 1 from corpus_ingest.publisher_code_manifests_v2 mm, jsonb_array_elements_text(mm.manifest->'retrieval'->'source_url_patterns') pat
                       where mm.manifest_sha256 = s->>'manifest_sha256' and (src->>'source_url') ~ pat)
        or coalesce(src->>'retrieved_at','') = ''
        or src->'http_status' is distinct from '200'::jsonb
        or coalesce(src->>'retrieval_method','') not in ('publisher_bulk_download','publisher_page','publisher_zip_member','publisher_api','proxied_fetch')
        or not exists (select 1 from corpus_ingest.publisher_code_manifests_v2 mm
                       where mm.manifest_sha256 = s->>'manifest_sha256' and mm.manifest->'retrieval'->'methods' @> jsonb_build_array(src->>'retrieval_method'))
        or ((src->>'retrieval_method' = 'proxied_fetch') <> (src->>'proxy' is not null))
        or (src->>'proxy' is not null and src->>'proxy' not in ('firecrawl','tavily')) then
        raise exception 'Source reference must match the manifest URL patterns and retrieval methods (%)', left(o->>'sha256', 12) using errcode='22023';
      end if;
      insert into corpus_ingest.publisher_code_object_sources_v2(sha256, source_url, retrieved_at, http_status, retrieval_method, proxy, run_id, jurisdiction)
        values (o->>'sha256', src->>'source_url', (src->>'retrieved_at')::timestamptz, 200, src->>'retrieval_method', src->>'proxy', p_run, s->>'jurisdiction')
        on conflict do nothing;
      if found then n_sources := n_sources + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('run_id', p_run, 'objects_received', jsonb_array_length(p_objects), 'objects_new', n_objects,
                            'bytes_new', total, 'sources_new', n_sources, 'published', false);
end $$;

-- 4. Intake one bounded batch of publisher-code-evidence/2 rows (units first, then sections).
create or replace function public.corpus_publisher_code_intake_v2(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; m jsonb; r jsonb; d jsonb; p jsonb; cur jsonb; h text; prior jsonb; result jsonb; next_index integer;
        v_jur text; v_source text; v_parser text; unit_cp bigint; parent jsonb; lvl jsonb; rec record; pos bigint;
begin
  s := corpus_ingest.publisher_code_open_run_v2(p_run);
  v_jur := s->>'jurisdiction'; v_source := s->>'source_system'; v_parser := s->>'parser';
  select manifest into m from corpus_ingest.publisher_code_manifests_v2 where manifest_sha256 = s->>'manifest_sha256';
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500
    or octet_length(p_rows::text) > 8388608 then
    raise exception 'Bounded batch required (1..500 rows, 8 MiB)' using errcode='22023';
  end if;
  h := corpus_ingest.canonical_integer_jsonb_sha256_v1(p_rows);
  select b.result into prior from corpus_ingest.publisher_code_batches_v2 b where b.run_id = p_run and b.batch_sha256 = h;
  if prior is not null then return prior || jsonb_build_object('replayed', true); end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x group by x->>'entity_type', x->>'native_id' having count(*) <> 1) then
    raise exception 'Duplicate identities in batch' using errcode='22023';
  end if;
  for rec in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    r := rec.value; pos := rec.ordinality;
    d := r->'data'; p := r->'provenance'; cur := d->'currency';
    -- Envelope, gates, provenance common to both entity types.
    if r->>'source_system' is distinct from v_source or r->>'schema_version' is distinct from 'publisher-code-evidence/2'
      or coalesce(r->>'entity_type','') not in ('code-source-unit','code-section')
      or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(p) is distinct from 'object'
      or length(coalesce(r->>'native_id','')) not between 4 and 512 or octet_length(r::text) > 2097152 then
      raise exception 'Invalid record envelope (%)', left(coalesce(r->>'native_id','?'), 80) using errcode='22023';
    end if;
    if d->>'jurisdiction' is distinct from v_jur
      or d->'publisher_native_entity' is distinct from 'false'::jsonb
      or d->'public_projection_allowed' is distinct from 'false'::jsonb
      or d->'current_law_verified' is distinct from 'false'::jsonb
      or d->'calculation_activation_allowed' is distinct from 'false'::jsonb then
      raise exception 'Private-only gates must all be false (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    if p->>'record_hash_codec' is distinct from 'canonical-integer-jsonb/1'
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(d) is distinct from p->>'record_sha256' then
      raise exception 'Canonical payload hash mismatch (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    if p->>'parser' is distinct from v_parser or p->>'manifest_sha256' is distinct from s->>'manifest_sha256'
      or coalesce(p->>'retrieved_at','') = '' or coalesce(p->>'source_sha256','') !~ '^[a-f0-9]{64}$' then
      raise exception 'Parser, manifest or retrieval provenance mismatch (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    if not exists (select 1 from corpus_ingest.publisher_code_object_sources_v2 os
                   join corpus_ingest.publisher_code_objects_v2 ob on ob.sha256 = os.sha256
                   where os.sha256 = p->>'source_sha256' and os.source_url = p->>'source_url'
                     and os.retrieved_at = (p->>'retrieved_at')::timestamptz
                     and os.retrieval_method = p->>'retrieval_method'
                     and os.proxy is not distinct from p->>'proxy'
                     and ob.kind = 'publisher_original') then
      raise exception 'Source bytes are not registered for this run (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    -- Currency: verbatim statement, stated through-date (or null), edition, basis.
    if jsonb_typeof(cur) is distinct from 'object'
      or coalesce(cur->>'basis','') not in ('publisher_statement','publisher_metadata','archive_date','none')
      or jsonb_typeof(cur->'statement') is distinct from 'string'
      or (cur->>'basis' <> 'none' and length(cur->>'statement') < 1)
      or (cur->>'basis' = 'none' and (cur->>'statement' <> '' or cur->'through_date' is distinct from 'null'::jsonb))
      or not (cur->'through_date' = 'null'::jsonb or coalesce(cur->>'through_date','') ~ '^\d{4}-\d{2}-\d{2}$')
      or not (cur->'edition' = 'null'::jsonb or jsonb_typeof(cur->'edition') = 'string')
      or p->'source_as_of' is distinct from cur->'through_date' then
      raise exception 'Currency statement/through-date/edition/basis invalid (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    if r->>'entity_type' = 'code-source-unit' then
      if d->>'identity_kind' is distinct from 'publisher_source_unit'
        or length(coalesce(d->>'unit_key','')) not between 1 and 300
        or r->>'native_id' is distinct from v_jur || ':unit:' || (d->>'unit_key')
        or length(coalesce(d->>'unit_kind','')) not between 2 and 40
        or jsonb_typeof(d->'heading') not in ('string','null')
        or d->>'original_sha256' is distinct from p->>'source_sha256'
        or not (d->'publisher_member' = 'null'::jsonb or jsonb_typeof(d->'publisher_member') = 'string')
        or not (d->'raw_member_sha256' = 'null'::jsonb or coalesce(d->>'raw_member_sha256','') ~ '^[a-f0-9]{64}$')
        or ((d->'publisher_member' = 'null'::jsonb) <> (d->'raw_member_sha256' = 'null'::jsonb))
        or coalesce(d->>'text_sha256','') !~ '^[a-f0-9]{64}$'
        or coalesce(d->>'text_code_points','') !~ '^[1-9][0-9]{0,8}$'
        or not exists (select 1 from corpus_ingest.publisher_code_objects_v2 ob
                       where ob.sha256 = d->>'text_sha256' and ob.kind = 'unit_text_derivative'
                         and ob.code_points = (d->>'text_code_points')::bigint)
        or not (d->'sections_expected' = 'null'::jsonb or coalesce(d->>'sections_expected','') ~ '^[0-9]{1,7}$') then
        raise exception 'Source unit identity, original or text derivative binding invalid (%)', left(r->>'native_id', 80) using errcode='22023';
      end if;
    else
      if d->>'identity_kind' is distinct from 'official_citation_path'
        or length(coalesce(d->>'citation_path','')) not between 1 and 300
        or (d->>'citation_path') !~ (m->'section_id'->>'regex')
        or r->>'native_id' is distinct from v_jur || ':' || (d->>'citation_path')
        or length(coalesce(d->>'citation','')) not between 3 and 400
        or jsonb_typeof(d->'heading') not in ('string','null')
        or jsonb_typeof(d->'text') is distinct from 'string'
        or length(d->>'text') < 1
        or encode(sha256(convert_to(d->>'text', 'UTF8')), 'hex') is distinct from d->>'text_sha256'
        or to_jsonb(length(d->>'text')) is distinct from d->'text_code_points'
        or jsonb_typeof(d->'hierarchy') is distinct from 'array'
        or jsonb_array_length(d->'hierarchy') not between 1 and 12
        or not (d->'history' = 'null'::jsonb or jsonb_typeof(d->'history') = 'string')
        or not (d->'status_note' = 'null'::jsonb or jsonb_typeof(d->'status_note') = 'string')
        or length(coalesce(d->>'unit_id','')) < 6
        or coalesce(d->>'unit_text_sha256','') !~ '^[a-f0-9]{64}$' then
        raise exception 'Section identity, text hash, hierarchy or unit reference invalid (%)', left(r->>'native_id', 80) using errcode='22023';
      end if;
      for lvl in select value from jsonb_array_elements(d->'hierarchy') loop
        if jsonb_typeof(lvl) is distinct from 'object'
          or not (m->'structure'->'levels') @> jsonb_build_array(lvl->>'level')
          or jsonb_typeof(lvl->'number') not in ('string','null')
          or jsonb_typeof(lvl->'heading') not in ('string','null') then
          raise exception 'Hierarchy level not declared by the manifest (%)', left(r->>'native_id', 80) using errcode='22023';
        end if;
      end loop;
      if (d->'hierarchy'->(jsonb_array_length(d->'hierarchy') - 1))->>'level' is distinct from 'section' then
        raise exception 'Hierarchy must end at the section (%)', left(r->>'native_id', 80) using errcode='22023';
      end if;
      -- The parent unit must be retained, or appear earlier in this batch, with the same text and original.
      select v.data into parent from corpus_ingest.entity_versions v
        where v.source_system = v_source and v.entity_type = 'code-source-unit' and v.native_id = d->>'unit_id'
          and v.data->>'text_sha256' = d->>'unit_text_sha256' and v.data->>'original_sha256' = p->>'source_sha256'
        order by 1 limit 1;
      if parent is null then
        select x.value->'data' into parent from jsonb_array_elements(p_rows) with ordinality x(value, ordinality)
          where x.ordinality < pos and x.value->>'entity_type' = 'code-source-unit' and x.value->>'native_id' = d->>'unit_id'
            and x.value->'data'->>'text_sha256' = d->>'unit_text_sha256'
            and x.value->'data'->>'original_sha256' = p->>'source_sha256'
          limit 1;
      end if;
      if parent is null then
        raise exception 'Parent source unit not retained for this original (%)', left(r->>'native_id', 80) using errcode='22023';
      end if;
      select code_points into unit_cp from corpus_ingest.publisher_code_objects_v2 where sha256 = d->>'unit_text_sha256';
      if d->'span' is distinct from 'null'::jsonb then
        if jsonb_typeof(d->'span') is distinct from 'object'
          or d->'span'->>'unit' is distinct from 'unicode_code_points'
          or coalesce(d->'span'->>'start','') !~ '^[0-9]{1,9}$' or coalesce(d->'span'->>'end','') !~ '^[0-9]{1,9}$'
          or (d->'span'->>'end')::bigint <= (d->'span'->>'start')::bigint
          or (d->'span'->>'end')::bigint > unit_cp
          or (d->'span'->>'end')::bigint - (d->'span'->>'start')::bigint <> (d->>'text_code_points')::bigint then
          raise exception 'Section span is outside its unit text or disagrees with the text length (%)', left(r->>'native_id', 80) using errcode='22023';
        end if;
      end if;
    end if;
    if exists (select 1 from corpus_ingest.observations o where o.run_id = p_run and o.source_system = v_source
               and o.entity_type = r->>'entity_type' and o.native_id = r->>'native_id') then
      raise exception 'Identity already observed in this run (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
  end loop;
  result := corpus_ingest.ingest_entities(p_run, p_rows);
  select coalesce(max(batch_index) + 1, 0) into next_index from corpus_ingest.publisher_code_batches_v2 where run_id = p_run;
  insert into corpus_ingest.publisher_code_batches_v2(run_id, batch_sha256, batch_index, records, result)
    values (p_run, h, next_index, jsonb_array_length(p_rows), result || jsonb_build_object('batch_sha256', h, 'batch_index', next_index));
  return result || jsonb_build_object('batch_sha256', h, 'batch_index', next_index, 'replayed', false, 'published', false);
end $$;

-- 5. Read-only exact proof for a batch: each row's version, payload, schema and this run's observation.
create or replace function public.corpus_publisher_code_verify_batch_v2(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h text; expected bigint; matched bigint; conflicts bigint; receipt corpus_ingest.publisher_code_batches_v2;
begin
  if not exists (select 1 from corpus_ingest.runs where id = p_run and scope->>'contract' = 'publisher-code-intake/2')
    or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Known publisher-code-intake/2 run and bounded rows required' using errcode='22023';
  end if;
  h := corpus_ingest.canonical_integer_jsonb_sha256_v1(p_rows);
  expected := jsonb_array_length(p_rows);
  select * into receipt from corpus_ingest.publisher_code_batches_v2 where run_id = p_run and batch_sha256 = h;
  select count(*) into matched from jsonb_array_elements(p_rows) r
    where exists (select 1 from corpus_ingest.observations o join corpus_ingest.entity_versions v
      on v.source_system = o.source_system and v.entity_type = o.entity_type and v.native_id = o.native_id and v.payload_sha256 = o.payload_sha256
      where o.run_id = p_run and o.source_system = r->>'source_system' and o.entity_type = r->>'entity_type'
        and o.native_id = r->>'native_id' and o.payload_sha256 = r->'provenance'->>'record_sha256'
        and o.source_url = r->'provenance'->>'source_url' and o.source_sha256 = r->'provenance'->>'source_sha256'
        and o.retrieved_at = (r->'provenance'->>'retrieved_at')::timestamptz and o.provenance = r->'provenance'
        and v.schema_version = r->>'schema_version' and v.data = r->'data'
        and v.storage_sha256 = encode(sha256(convert_to(v.data::text, 'UTF8')), 'hex'));
  select count(*) into conflicts from jsonb_array_elements(p_rows) r
    where exists (select 1 from corpus_ingest.entity_versions v
      where v.source_system = r->>'source_system' and v.entity_type = r->>'entity_type' and v.native_id = r->>'native_id'
        and v.payload_sha256 = r->'provenance'->>'record_sha256'
        and (v.data is distinct from r->'data' or v.schema_version is distinct from r->>'schema_version'));
  return jsonb_build_object('contract', 'publisher-code-intake/2', 'run_id', p_run, 'batch_sha256', h, 'expected', expected,
    'matched', matched, 'conflicts', conflicts, 'receipt_present', receipt.run_id is not null,
    'receipt_matches', coalesce(receipt.records = expected, false),
    'verified', receipt.run_id is not null and receipt.records = expected and matched = expected and conflicts = 0,
    'private_only', true, 'published', false);
end $$;

-- 6. Close a run and refresh the state's landed summary. A run never stays running after the worker ends.
create or replace function public.corpus_publisher_code_finish_run_v2(p_run uuid, p_status text, p_counts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; summary jsonb; n_batches bigint; n_obs jsonb;
begin
  s := corpus_ingest.publisher_code_open_run_v2(p_run);
  if p_status not in ('completed','partial','failed') or jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'Invalid run closure' using errcode='22023';
  end if;
  select count(*) into n_batches from corpus_ingest.publisher_code_batches_v2 where run_id = p_run;
  select coalesce(jsonb_object_agg(entity_type, n), '{}'::jsonb) into n_obs
    from (select entity_type, count(*) n from corpus_ingest.observations where run_id = p_run group by entity_type) c;
  update corpus_ingest.runs set status = p_status, finished_at = now(),
         counts = p_counts || jsonb_build_object('batches', n_batches, 'observations', n_obs)
   where id = p_run;
  summary := corpus_ingest.publisher_code_summarize_state_v2(s->>'jurisdiction');
  update corpus_ingest.publisher_code_states_v2
     set review_status = case when p_status = 'completed' and review_status = 'acquiring' then 'landed' else review_status end,
         last_run = p_run, last_run_status = p_status, last_run_finished_at = now(), updated_at = now()
   where jurisdiction = s->>'jurisdiction';
  return jsonb_build_object('run_id', p_run, 'status', p_status, 'batches', n_batches, 'observations', n_obs, 'state', summary);
end $$;

-- 7. Owner/coordinator review. The only way public_projection_allowed changes.
create or replace function public.corpus_publisher_code_review_v2(p_jurisdiction text, p_review_status text, p_public_projection_allowed boolean, p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(p_jurisdiction,'') !~ '^[A-Z]{2}$' or p_review_status not in ('manifest_registered','acquiring','landed','reviewed','held')
    or p_public_projection_allowed is null or length(coalesce(p_notes,'')) not between 3 and 4000 then
    raise exception 'Jurisdiction, status, projection flag and a note are required' using errcode='22023';
  end if;
  if p_public_projection_allowed and p_review_status <> 'reviewed' then
    raise exception 'Projection can only be allowed for a reviewed state' using errcode='22023';
  end if;
  update corpus_ingest.publisher_code_states_v2
     set review_status = p_review_status, public_projection_allowed = p_public_projection_allowed,
         notes = p_notes, updated_at = now()
   where jurisdiction = p_jurisdiction;
  if not found then raise exception 'Unknown jurisdiction; register a manifest first' using errcode='22023'; end if;
  return (select to_jsonb(x) - 'currency' from corpus_ingest.publisher_code_states_v2 x where x.jurisdiction = p_jurisdiction);
end $$;

-- 8. Coverage per state (read-only unless p_recount): sections, units, currency, review, last run.
--    Texas (publisher-code-intake/1) is reported from its own tables for one combined view.
create or replace function public.corpus_publisher_code_coverage_v2(p_recount boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j text; rows_v2 jsonb; tx jsonb; tx_run corpus_ingest.runs;
begin
  if p_recount then
    for j in select jurisdiction from corpus_ingest.publisher_code_states_v2 loop
      perform corpus_ingest.publisher_code_summarize_state_v2(j);
    end loop;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'jurisdiction', st.jurisdiction, 'contract', 'publisher-code-intake/2', 'publisher', st.publisher,
      'source_system', st.source_system, 'manifest_sha256', st.current_manifest_sha256,
      'parser', (select parser from corpus_ingest.publisher_code_manifests_v2 mm where mm.manifest_sha256 = st.current_manifest_sha256),
      'review_status', st.review_status, 'public_projection_allowed', st.public_projection_allowed,
      'sections', st.sections, 'units', st.units, 'currency', st.currency,
      'last_run', st.last_run, 'last_run_status', coalesce((select r.status from corpus_ingest.runs r where r.id = st.last_run), st.last_run_status),
      'last_run_finished_at', st.last_run_finished_at,
      'open_run', (select r.id from corpus_ingest.runs r where r.status in ('running','partial')
                   and r.scope->>'contract' = 'publisher-code-intake/2' and r.scope->>'jurisdiction' = st.jurisdiction limit 1),
      'batches', (select count(*) from corpus_ingest.publisher_code_batches_v2 b join corpus_ingest.runs r on r.id = b.run_id
                  where r.scope->>'jurisdiction' = st.jurisdiction),
      'objects', (select count(distinct sha256) from corpus_ingest.publisher_code_object_sources_v2 os where os.jurisdiction = st.jurisdiction),
      'notes', st.notes, 'updated_at', st.updated_at) order by st.jurisdiction), '[]'::jsonb)
    into rows_v2 from corpus_ingest.publisher_code_states_v2 st;
  select * into tx_run from corpus_ingest.runs where scope->>'contract' = 'publisher-code-intake/1' order by started_at desc limit 1;
  if found then
    select jsonb_build_object('jurisdiction', 'TX', 'contract', 'publisher-code-intake/1', 'publisher', 'Texas Legislature (statutes.capitol.texas.gov)',
        'source_system', 'texas-legislature-code', 'manifest_sha256', tx_run.scope->>'packet_manifest_sha256', 'parser', 'texas-publisher-html/5',
        'review_status', case when tx_run.status = 'completed' then 'landed' else 'acquiring' end, 'public_projection_allowed', false,
        'sections', (select count(*) from corpus_ingest.entities where source_system = 'texas-legislature-code' and entity_type = 'code-section-occurrence'),
        'units', (select count(*) from corpus_ingest.entities where source_system = 'texas-legislature-code' and entity_type = 'code-chapter-document'),
        'currency', jsonb_build_object('basis', 'publisher_statement', 'note', 'recorded per packet; not summarized by this contract'),
        'last_run', tx_run.id, 'last_run_status', tx_run.status, 'last_run_finished_at', tx_run.finished_at,
        'open_run', case when tx_run.status in ('running','partial') then tx_run.id end,
        'batches', (select count(*) from corpus_ingest.publisher_code_batch_receipts_v1 where run_id = tx_run.id),
        'objects', (select count(*) from corpus_ingest.publisher_code_packet_objects_v1 where run_id = tx_run.id),
        'notes', 'Texas lands through publisher-code-intake/1; shown here for one combined view', 'updated_at', now())
      into tx;
  end if;
  return jsonb_build_object('contract', 'publisher-code-intake/2', 'generated_at', now(),
    'states', case when tx is null then rows_v2 else rows_v2 || jsonb_build_array(tx) end, 'private_only', true, 'published', false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke all on function corpus_ingest.publisher_code_regex_ok_v2(text) from public, anon, authenticated, service_role;
revoke all on function corpus_ingest.publisher_code_check_manifest_v2(jsonb) from public, anon, authenticated, service_role;
revoke all on function corpus_ingest.publisher_code_open_run_v2(uuid) from public, anon, authenticated, service_role;
revoke all on function corpus_ingest.publisher_code_summarize_state_v2(text) from public, anon, authenticated, service_role;
revoke all on function public.corpus_publisher_code_register_manifest_v2(jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_open_run_v2(uuid, text) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_register_objects_v2(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_intake_v2(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_verify_batch_v2(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_finish_run_v2(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_review_v2(text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_coverage_v2(boolean) from public, anon, authenticated;
grant execute on function public.corpus_publisher_code_register_manifest_v2(jsonb) to service_role;
grant execute on function public.corpus_publisher_code_open_run_v2(uuid, text) to service_role;
grant execute on function public.corpus_publisher_code_register_objects_v2(uuid, jsonb) to service_role;
grant execute on function public.corpus_publisher_code_intake_v2(uuid, jsonb) to service_role;
grant execute on function public.corpus_publisher_code_verify_batch_v2(uuid, jsonb) to service_role;
grant execute on function public.corpus_publisher_code_finish_run_v2(uuid, text, jsonb) to service_role;
grant execute on function public.corpus_publisher_code_review_v2(text, text, boolean, text) to service_role;
grant execute on function public.corpus_publisher_code_coverage_v2(boolean) to service_role;

comment on function public.corpus_publisher_code_intake_v2(uuid, jsonb) is
  'Server-role-only generic full-state-code intake (publisher-code-evidence/2) validated against the run''s registered parser manifest. Private; no public projection; no calculator activation.';
comment on function public.corpus_publisher_code_coverage_v2(boolean) is
  'Read-only per-state coverage: sections, units, currency range and editions, review status, projection gate, last and open runs. Includes Texas from publisher-code-intake/1.';

notify pgrst, 'reload schema';
commit;
