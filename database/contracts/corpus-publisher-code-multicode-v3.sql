-- publisher-code-intake/2, multi-code extension (migration "v3"). PREPARED, NOT APPLIED.
--
-- Why: publisher_code_states_v2 holds one row per jurisdiction, and register_manifest_v2 refuses a second source
-- system for a jurisdiction ("A jurisdiction keeps one source system across manifests"). Louisiana publishes the
-- Revised Statutes, the Civil Code, the Code of Civil Procedure and others as separate codes under one jurisdiction.
-- This migration lets one jurisdiction hold several codes (one source system each) with review and projection
-- tracked per code.
--
-- What it does NOT change: no v2 table, function, grant or row is altered. publisher_code_states_v2 stays the
-- authoritative record of each jurisdiction's FIRST registered code (its "primary" code). Every existing v2 RPC,
-- every v2 projection RPC, and every existing state's review_status and public_projection_allowed behave exactly as
-- before. A code registered later under an existing jurisdiction (a "secondary" code) lives only in the new
-- table, so it is invisible to every v2 projection RPC until it has its own review.
--
-- How the two layers fit:
--   * publisher_code_codes_v3 has one row per (jurisdiction, source_system). It is backfilled from states_v2 and kept
--     in step by an AFTER INSERT/UPDATE trigger on states_v2, so a primary code's v3 row always mirrors v2.
--   * The v3 RPCs delegate to the v2 RPC when the code is the jurisdiction's primary code, and otherwise work on the
--     codes_v3 row alone. Intake, object registration and batch verification are not replaced: they already read
--     the run's own scope (jurisdiction, source_system, manifest), which a secondary run carries.
--   * Review and the projection gate are per code. A secondary code is public only when its own row is reviewed
--     with public_projection_allowed. The v3 projection RPCs take the source system; the v2 RPCs are unchanged.
--
-- Rules kept: one open run per jurisdiction (any code), service_role only, SECURITY DEFINER with search_path = '',
-- every intake row still carries public_projection_allowed=false (the per-code flag is the only gate).
-- Apply after corpus-publisher-code-intake-v2.sql and corpus-publisher-code-projection-v2.sql. Texas stays on v1.
begin;

create table corpus_ingest.publisher_code_codes_v3 (
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}$'),
  source_system text not null check (source_system ~ '^[a-z]{2}-[a-z0-9-]{3,60}$'),
  primary_code boolean not null default false,
  review_status text not null default 'manifest_registered'
    check (review_status in ('manifest_registered','acquiring','landed','reviewed','held')),
  public_projection_allowed boolean not null default false,
  publisher text,
  current_manifest_sha256 text references corpus_ingest.publisher_code_manifests_v2(manifest_sha256),
  sections bigint not null default 0,
  units bigint not null default 0,
  currency jsonb not null default '{}'::jsonb,
  last_run uuid references corpus_ingest.runs(id),
  last_run_status text,
  last_run_finished_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (jurisdiction, source_system),
  check (starts_with(source_system, lower(jurisdiction) || '-')),
  check (not public_projection_allowed or review_status = 'reviewed')
);
create unique index publisher_code_codes_v3_one_primary on corpus_ingest.publisher_code_codes_v3 (jurisdiction) where primary_code;
comment on table corpus_ingest.publisher_code_codes_v3 is
  'Per-code review status, projection gate and landed summary. One row per (jurisdiction, source system). The jurisdiction''s first code mirrors publisher_code_states_v2; later codes live only here.';

alter table corpus_ingest.publisher_code_codes_v3 enable row level security;
revoke all on corpus_ingest.publisher_code_codes_v3 from public, anon, authenticated, service_role;
grant select on corpus_ingest.publisher_code_codes_v3 to service_role;

-- Backfill: every existing state is the primary code of its jurisdiction.
insert into corpus_ingest.publisher_code_codes_v3 (jurisdiction, source_system, primary_code, review_status, public_projection_allowed,
  publisher, current_manifest_sha256, sections, units, currency, last_run, last_run_status, last_run_finished_at, notes, updated_at)
select jurisdiction, source_system, true, review_status, public_projection_allowed, publisher, current_manifest_sha256,
       sections, units, currency, last_run, last_run_status, last_run_finished_at, notes, updated_at
from corpus_ingest.publisher_code_states_v2 where source_system is not null;

-- Keep a primary code's v3 row identical to its v2 state row. Writes to states_v2 still happen only in v2 functions.
create or replace function corpus_ingest.publisher_code_mirror_primary_v3()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_system is null then return new; end if;
  insert into corpus_ingest.publisher_code_codes_v3 (jurisdiction, source_system, primary_code, review_status, public_projection_allowed,
    publisher, current_manifest_sha256, sections, units, currency, last_run, last_run_status, last_run_finished_at, notes, updated_at)
  values (new.jurisdiction, new.source_system, true, new.review_status, new.public_projection_allowed, new.publisher,
    new.current_manifest_sha256, new.sections, new.units, new.currency, new.last_run, new.last_run_status,
    new.last_run_finished_at, new.notes, new.updated_at)
  on conflict (jurisdiction, source_system) do update set
    primary_code = true, review_status = excluded.review_status, public_projection_allowed = excluded.public_projection_allowed,
    publisher = excluded.publisher, current_manifest_sha256 = excluded.current_manifest_sha256, sections = excluded.sections,
    units = excluded.units, currency = excluded.currency, last_run = excluded.last_run, last_run_status = excluded.last_run_status,
    last_run_finished_at = excluded.last_run_finished_at, notes = excluded.notes, updated_at = excluded.updated_at;
  return new;
end $$;
create trigger publisher_code_states_v2_mirror_v3
  after insert or update on corpus_ingest.publisher_code_states_v2
  for each row execute function corpus_ingest.publisher_code_mirror_primary_v3();

-- Recompute one code's landed summary. A primary code is summarized by the v2 function (which updates states_v2).
create or replace function corpus_ingest.publisher_code_summarize_code_v3(p_jurisdiction text, p_source_system text)
returns jsonb language plpgsql set search_path = '' as $$
declare n_sections bigint; n_units bigint; cur jsonb; is_primary boolean;
begin
  select primary_code into is_primary from corpus_ingest.publisher_code_codes_v3
   where jurisdiction = p_jurisdiction and source_system = p_source_system;
  if is_primary is null then return null; end if;
  if is_primary then return corpus_ingest.publisher_code_summarize_state_v2(p_jurisdiction); end if;
  select count(*) into n_sections from corpus_ingest.entities
    where source_system = p_source_system and entity_type = 'code-section' and review_status <> 'quarantined';
  select count(*) into n_units from corpus_ingest.entities
    where source_system = p_source_system and entity_type = 'code-source-unit' and review_status <> 'quarantined';
  select jsonb_build_object(
      'through_min', min(nullif(data->'currency'->>'through_date','')),
      'through_max', max(nullif(data->'currency'->>'through_date','')),
      'sections_with_through_date', count(*) filter (where nullif(data->'currency'->>'through_date','') is not null),
      'editions', coalesce((select jsonb_agg(distinct e) from (select data->'currency'->>'edition' e from corpus_ingest.entities
          where source_system = p_source_system and entity_type = 'code-section' and data->'currency'->>'edition' is not null) z), '[]'::jsonb),
      'bases', coalesce((select jsonb_agg(distinct b) from (select data->'currency'->>'basis' b from corpus_ingest.entities
          where source_system = p_source_system and entity_type = 'code-section') z), '[]'::jsonb),
      'summarized_at', now())
    into cur
    from corpus_ingest.entities where source_system = p_source_system and entity_type = 'code-section' and review_status <> 'quarantined';
  update corpus_ingest.publisher_code_codes_v3
     set sections = n_sections, units = n_units, currency = coalesce(cur, '{}'::jsonb), updated_at = now()
   where jurisdiction = p_jurisdiction and source_system = p_source_system;
  return jsonb_build_object('jurisdiction', p_jurisdiction, 'source_system', p_source_system, 'sections', n_sections, 'units', n_units, 'currency', cur);
end $$;

-- 1. Register a manifest. The first code of a jurisdiction (or any manifest for its primary code) goes through v2
--    unchanged. A manifest for another source system registers a secondary code and never touches states_v2.
create or replace function public.corpus_publisher_code_register_manifest_v3(p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; v_parser text; v_j text; v_src text; existing corpus_ingest.publisher_code_manifests_v2; st corpus_ingest.publisher_code_states_v2;
begin
  perform corpus_ingest.publisher_code_check_manifest_v2(p_manifest);
  if octet_length(p_manifest::text) > 262144 then raise exception 'Manifest exceeds 256 KiB' using errcode='22023'; end if;
  v_j := p_manifest->>'jurisdiction'; v_src := p_manifest->>'source_system';
  select * into st from corpus_ingest.publisher_code_states_v2 where jurisdiction = v_j;
  if not found or st.source_system is not distinct from v_src then
    return public.corpus_publisher_code_register_manifest_v2(p_manifest);
  end if;
  h := corpus_ingest.canonical_integer_jsonb_sha256_v1(p_manifest);
  v_parser := (p_manifest->'parser'->>'name') || '/' || (p_manifest->'parser'->>'version');
  select * into existing from corpus_ingest.publisher_code_manifests_v2 where manifest_sha256 = h;
  if found then
    return jsonb_build_object('manifest_sha256', h, 'jurisdiction', existing.jurisdiction, 'source_system', existing.source_system,
                              'parser', existing.parser, 'registered', false, 'replayed', true, 'primary_code', false);
  end if;
  if exists (select 1 from corpus_ingest.publisher_code_manifests_v2 where source_system = v_src and parser = v_parser) then
    raise exception 'A different manifest is already registered for this source system and parser version; bump the parser version' using errcode='22023';
  end if;
  if exists (select 1 from corpus_ingest.runs r where r.status in ('running','partial')
             and r.scope->>'contract' = 'publisher-code-intake/2' and r.scope->>'jurisdiction' = v_j
             and r.scope->>'source_system' = v_src and r.scope->>'manifest_sha256' is distinct from h) then
    raise exception 'An open run is pinned to a different manifest for this code; finish it before registering a new parser version' using errcode='22023';
  end if;
  insert into corpus_ingest.publisher_code_manifests_v2(manifest_sha256, jurisdiction, publisher, source_system, parser, manifest)
    values (h, v_j, p_manifest->>'publisher', v_src, v_parser, p_manifest);
  insert into corpus_ingest.publisher_code_codes_v3(jurisdiction, source_system, primary_code, publisher, current_manifest_sha256)
    values (v_j, v_src, false, p_manifest->>'publisher', h)
    on conflict (jurisdiction, source_system) do update
      set publisher = excluded.publisher, current_manifest_sha256 = excluded.current_manifest_sha256, updated_at = now();
  return jsonb_build_object('manifest_sha256', h, 'jurisdiction', v_j, 'source_system', v_src, 'parser', v_parser,
                            'registered', true, 'replayed', false, 'primary_code', false);
end $$;

-- 2. Open a run for a code. Primary code: v2. Secondary code: same scope, held check and one-open-run-per-jurisdiction
--    rule, recorded on the code's own row.
create or replace function public.corpus_publisher_code_open_run_v3(p_run uuid, p_manifest_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m corpus_ingest.publisher_code_manifests_v2; st corpus_ingest.publisher_code_states_v2; cd corpus_ingest.publisher_code_codes_v3;
        s jsonb; existing jsonb;
begin
  if p_run is null then raise exception 'Run id required' using errcode='22023'; end if;
  select * into m from corpus_ingest.publisher_code_manifests_v2 where manifest_sha256 = p_manifest_sha256;
  if not found then raise exception 'Unknown manifest' using errcode='22023'; end if;
  select * into st from corpus_ingest.publisher_code_states_v2 where jurisdiction = m.jurisdiction;
  if found and st.source_system is not distinct from m.source_system then
    return public.corpus_publisher_code_open_run_v2(p_run, p_manifest_sha256);
  end if;
  select * into cd from corpus_ingest.publisher_code_codes_v3
   where jurisdiction = m.jurisdiction and source_system = m.source_system for update;
  if not found then raise exception 'Unknown code; register its manifest first' using errcode='22023'; end if;
  if cd.review_status = 'held' then raise exception 'Code is held; no new run' using errcode='22023'; end if;
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
    update corpus_ingest.publisher_code_codes_v3
       set review_status = case when review_status in ('manifest_registered','landed') then 'acquiring' else review_status end,
           current_manifest_sha256 = m.manifest_sha256, last_run = p_run, last_run_status = 'running',
           last_run_finished_at = null, updated_at = now()
     where jurisdiction = m.jurisdiction and source_system = m.source_system;
  end if;
  return (select jsonb_build_object('run_id', r.id, 'status', r.status, 'scope', r.scope) from corpus_ingest.runs r where r.id = p_run);
end $$;

-- 3. Close a run. Primary code: v2. Secondary code: same closure, summary and status written to the code's own row.
create or replace function public.corpus_publisher_code_finish_run_v3(p_run uuid, p_status text, p_counts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s jsonb; st corpus_ingest.publisher_code_states_v2; summary jsonb; n_batches bigint; n_obs jsonb;
begin
  s := corpus_ingest.publisher_code_open_run_v2(p_run);
  select * into st from corpus_ingest.publisher_code_states_v2 where jurisdiction = s->>'jurisdiction';
  if found and st.source_system is not distinct from s->>'source_system' then
    return public.corpus_publisher_code_finish_run_v2(p_run, p_status, p_counts);
  end if;
  if p_status not in ('completed','partial','failed') or jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'Invalid run closure' using errcode='22023';
  end if;
  select count(*) into n_batches from corpus_ingest.publisher_code_batches_v2 where run_id = p_run;
  select coalesce(jsonb_object_agg(entity_type, n), '{}'::jsonb) into n_obs
    from (select entity_type, count(*) n from corpus_ingest.observations where run_id = p_run group by entity_type) c;
  update corpus_ingest.runs set status = p_status, finished_at = now(),
         counts = p_counts || jsonb_build_object('batches', n_batches, 'observations', n_obs)
   where id = p_run;
  summary := corpus_ingest.publisher_code_summarize_code_v3(s->>'jurisdiction', s->>'source_system');
  update corpus_ingest.publisher_code_codes_v3
     set review_status = case when p_status = 'completed' and review_status = 'acquiring' then 'landed' else review_status end,
         last_run = p_run, last_run_status = p_status, last_run_finished_at = now(), updated_at = now()
   where jurisdiction = s->>'jurisdiction' and source_system = s->>'source_system';
  return jsonb_build_object('run_id', p_run, 'status', p_status, 'batches', n_batches, 'observations', n_obs,
                            'source_system', s->>'source_system', 'code', summary);
end $$;

-- 4. Review one code. The only way a code's public_projection_allowed changes. Primary code: v2 (and the trigger mirrors it).
create or replace function public.corpus_publisher_code_review_v3(p_jurisdiction text, p_source_system text, p_review_status text,
                                                                 p_public_projection_allowed boolean, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cd corpus_ingest.publisher_code_codes_v3;
begin
  if coalesce(p_jurisdiction,'') !~ '^[A-Z]{2}$' or coalesce(p_source_system,'') !~ '^[a-z]{2}-[a-z0-9-]{3,60}$'
    or p_review_status not in ('manifest_registered','acquiring','landed','reviewed','held')
    or p_public_projection_allowed is null or length(coalesce(p_notes,'')) not between 3 and 4000 then
    raise exception 'Jurisdiction, source system, status, projection flag and a note are required' using errcode='22023';
  end if;
  if p_public_projection_allowed and p_review_status <> 'reviewed' then
    raise exception 'Projection can only be allowed for a reviewed code' using errcode='22023';
  end if;
  select * into cd from corpus_ingest.publisher_code_codes_v3
   where jurisdiction = p_jurisdiction and source_system = p_source_system for update;
  if not found then raise exception 'Unknown code; register its manifest first' using errcode='22023'; end if;
  if cd.primary_code then
    perform public.corpus_publisher_code_review_v2(p_jurisdiction, p_review_status, p_public_projection_allowed, p_notes);
  else
    update corpus_ingest.publisher_code_codes_v3
       set review_status = p_review_status, public_projection_allowed = p_public_projection_allowed,
           notes = p_notes, updated_at = now()
     where jurisdiction = p_jurisdiction and source_system = p_source_system;
  end if;
  return (select to_jsonb(x) - 'currency' from corpus_ingest.publisher_code_codes_v3 x
           where x.jurisdiction = p_jurisdiction and x.source_system = p_source_system);
end $$;

-- 5. Coverage per code (read-only unless p_recount). v2 coverage is unchanged and still reports one row per jurisdiction plus Texas.
create or replace function public.corpus_publisher_code_coverage_v3(p_recount boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; rows_v3 jsonb;
begin
  if p_recount then
    for c in select jurisdiction, source_system from corpus_ingest.publisher_code_codes_v3 loop
      perform corpus_ingest.publisher_code_summarize_code_v3(c.jurisdiction, c.source_system);
    end loop;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'jurisdiction', cd.jurisdiction, 'source_system', cd.source_system, 'primary_code', cd.primary_code,
      'contract', 'publisher-code-intake/2', 'publisher', cd.publisher, 'manifest_sha256', cd.current_manifest_sha256,
      'parser', (select parser from corpus_ingest.publisher_code_manifests_v2 mm where mm.manifest_sha256 = cd.current_manifest_sha256),
      'review_status', cd.review_status, 'public_projection_allowed', cd.public_projection_allowed,
      'sections', cd.sections, 'units', cd.units, 'currency', cd.currency,
      'last_run', cd.last_run, 'last_run_status', coalesce((select r.status from corpus_ingest.runs r where r.id = cd.last_run), cd.last_run_status),
      'last_run_finished_at', cd.last_run_finished_at,
      'open_run', (select r.id from corpus_ingest.runs r where r.status in ('running','partial')
                   and r.scope->>'contract' = 'publisher-code-intake/2' and r.scope->>'jurisdiction' = cd.jurisdiction
                   and r.scope->>'source_system' = cd.source_system limit 1),
      'batches', (select count(*) from corpus_ingest.publisher_code_batches_v2 b join corpus_ingest.runs r on r.id = b.run_id
                  where r.scope->>'jurisdiction' = cd.jurisdiction and r.scope->>'source_system' = cd.source_system),
      'objects', (select count(distinct os.sha256) from corpus_ingest.publisher_code_object_sources_v2 os
                  join corpus_ingest.runs r on r.id = os.run_id
                  where r.scope->>'jurisdiction' = cd.jurisdiction and r.scope->>'source_system' = cd.source_system),
      'notes', cd.notes, 'updated_at', cd.updated_at) order by cd.jurisdiction, cd.primary_code desc, cd.source_system), '[]'::jsonb)
    into rows_v3 from corpus_ingest.publisher_code_codes_v3 cd;
  return jsonb_build_object('contract', 'publisher-code-intake/2', 'generated_at', now(), 'codes', rows_v3,
                            'private_only', true, 'published', false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Per-code projection (publisher-code-projection/2 extended). The v2 projection RPCs are unchanged and keep reading only
-- each jurisdiction's primary code.
-- ---------------------------------------------------------------------------------------------
-- Per-code projection gate: the code's own review flag, never the jurisdiction's.
create or replace function corpus_ingest.publisher_code_projected_gate_v3(p_jurisdiction text, p_source_system text)
returns table (
  jurisdiction text,
  publisher text,
  source_system text,
  sections bigint,
  units bigint,
  currency jsonb,
  manifest jsonb
)
language sql stable security definer set search_path = '' as $$
  select cd.jurisdiction, cd.publisher, cd.source_system, cd.sections, cd.units, cd.currency, mm.manifest
  from corpus_ingest.publisher_code_codes_v3 cd
  join corpus_ingest.publisher_code_manifests_v2 mm on mm.manifest_sha256 = cd.current_manifest_sha256
  where cd.jurisdiction = p_jurisdiction
    and cd.source_system = p_source_system
    and cd.public_projection_allowed
    and cd.review_status = 'reviewed';
$$;

-- Codes whose own review flag is on, one row per code (a jurisdiction may list several).
create or replace function public.corpus_publisher_code_projected_codes_v3()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jurisdiction', cd.jurisdiction,
    'source_system', cd.source_system,
    'primary_code', cd.primary_code,
    'code_title', mm.manifest->>'code_title',
    'publisher', cd.publisher,
    'publisher_url', mm.manifest->>'publisher_url',
    'sections', cd.sections,
    'units', cd.units,
    'currency', cd.currency,
    'structure_levels', mm.manifest->'structure'->'levels'
  ) order by cd.jurisdiction, cd.primary_code desc, cd.source_system), '[]'::jsonb)
  from corpus_ingest.publisher_code_codes_v3 cd
  join corpus_ingest.publisher_code_manifests_v2 mm on mm.manifest_sha256 = cd.current_manifest_sha256
  where cd.public_projection_allowed
    and cd.review_status = 'reviewed';
$$;

-- Next hierarchy level under a recorded path for one code, or its sections once the path reaches "section".
create or replace function public.corpus_publisher_code_projected_outline_v3(
  p_jurisdiction text,
  p_source_system text,
  p_path jsonb default '[]'::jsonb
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare gate record; levels jsonb; depth integer; next_level text; total bigint; direct_total bigint;
begin
  if coalesce(p_jurisdiction, '') !~ '^[A-Z]{2}$'
    or coalesce(p_source_system, '') !~ '^[a-z]{2}-[a-z0-9-]{3,60}$'
    or jsonb_typeof(p_path) is distinct from 'array'
    or jsonb_array_length(p_path) > 12 then
    raise exception 'Jurisdiction and a hierarchy path are required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_path) elem
    where jsonb_typeof(elem) is distinct from 'object'
      or coalesce(elem->>'level', '') !~ '^[a-z][a-z_]{1,40}$'
      or jsonb_typeof(elem->'number') not in ('string', 'null')
  ) then
    raise exception 'Hierarchy path entries must be a level and a number' using errcode = '22023';
  end if;
  select * into gate from corpus_ingest.publisher_code_projected_gate_v3(p_jurisdiction, p_source_system);
  if gate.jurisdiction is null then
    return jsonb_build_object('available', false);
  end if;
  levels := gate.manifest->'structure'->'levels';
  depth := jsonb_array_length(p_path);
  if depth >= jsonb_array_length(levels) then
    raise exception 'Hierarchy path is longer than this code declares' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_path) with ordinality as t(elem, ord)
    where (levels->>((t.ord - 1)::integer)) is distinct from (t.elem->>'level')
  ) then
    raise exception 'Hierarchy path does not follow this code''s declared levels' using errcode = '22023';
  end if;
  next_level := levels->>depth;

  if next_level = 'section' then
    select count(*) into total from corpus_ingest.entities e
    where e.source_system = gate.source_system
      and e.entity_type = 'code-section'
      and e.review_status <> 'quarantined'
      and e.schema_version = 'publisher-code-evidence/2'
      and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path);
    return jsonb_build_object(
      'available', true, 'kind', 'sections', 'level', 'section', 'total', total,
      'truncated', total > 5000,
      'sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'native_id', s.native_id,
          'citation', s.data->>'citation',
          'heading', s.data->>'heading',
          'status_note', s.data->>'status_note'
        ) order by s.native_id)
        from (
          select e.native_id, e.data from corpus_ingest.entities e
          where e.source_system = gate.source_system
            and e.entity_type = 'code-section'
            and e.review_status <> 'quarantined'
            and e.schema_version = 'publisher-code-evidence/2'
            and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
          order by e.native_id
          limit 5000
        ) s
      ), '[]'::jsonb));
  end if;

  -- A declared level is optional. Sections that sit here, with no part/article/division
  -- between them and the path, are listed instead of an empty group menu.
  select count(*) into direct_total from corpus_ingest.entities e
  where e.source_system = gate.source_system
    and e.entity_type = 'code-section'
    and e.review_status <> 'quarantined'
    and e.schema_version = 'publisher-code-evidence/2'
    and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
    and e.data->'hierarchy'->depth->>'level' = 'section';
  select count(*) into total from (
    select 1 from corpus_ingest.entities e
    where e.source_system = gate.source_system
      and e.entity_type = 'code-section'
      and e.review_status <> 'quarantined'
      and e.schema_version = 'publisher-code-evidence/2'
      and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
      and e.data->'hierarchy'->depth->>'level' = next_level
    group by e.data->'hierarchy'->depth->>'number', e.data->'hierarchy'->depth->>'heading'
  ) g;
  if total = 0 and direct_total > 0 then
    return jsonb_build_object(
      'available', true, 'kind', 'sections', 'level', 'section', 'total', direct_total,
      'truncated', direct_total > 5000,
      'sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'native_id', s.native_id,
          'citation', s.data->>'citation',
          'heading', s.data->>'heading',
          'status_note', s.data->>'status_note'
        ) order by s.native_id)
        from (
          select e.native_id, e.data from corpus_ingest.entities e
          where e.source_system = gate.source_system
            and e.entity_type = 'code-section'
            and e.review_status <> 'quarantined'
            and e.schema_version = 'publisher-code-evidence/2'
            and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
            and e.data->'hierarchy'->depth->>'level' = 'section'
          order by e.native_id
          limit 5000
        ) s
      ), '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'available', true, 'kind', 'groups', 'level', next_level, 'total', total,
    'truncated', total > 2000,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', g.number, 'heading', g.heading, 'count', g.n
      ) order by g.number, g.heading)
      from (
        select e.data->'hierarchy'->depth->>'number' as number,
               e.data->'hierarchy'->depth->>'heading' as heading,
               count(*) as n
        from corpus_ingest.entities e
        where e.source_system = gate.source_system
          and e.entity_type = 'code-section'
          and e.review_status <> 'quarantined'
          and e.schema_version = 'publisher-code-evidence/2'
          and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
          and e.data->'hierarchy'->depth->>'level' = next_level
        group by 1, 2
        order by 1, 2
        limit 2000
      ) g
    ), '[]'::jsonb),
    'direct_total', direct_total,
    'direct_truncated', direct_total > 5000,
    'direct_sections', case when direct_total = 0 then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'native_id', s.native_id,
        'citation', s.data->>'citation',
        'heading', s.data->>'heading',
        'status_note', s.data->>'status_note'
      ) order by s.native_id)
      from (
        select e.native_id, e.data from corpus_ingest.entities e
        where e.source_system = gate.source_system
          and e.entity_type = 'code-section'
          and e.review_status <> 'quarantined'
          and e.schema_version = 'publisher-code-evidence/2'
          and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
          and e.data->'hierarchy'->depth->>'level' = 'section'
        order by e.native_id
        limit 5000
      ) s
    ), '[]'::jsonb) end);
end $$;

-- One published section of one code.
create or replace function public.corpus_publisher_code_projected_section_v3(p_jurisdiction text, p_source_system text, p_native_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare gate record; row corpus_ingest.entities; source text;
begin
  if coalesce(p_jurisdiction, '') !~ '^[A-Z]{2}$' or coalesce(p_source_system, '') !~ '^[a-z]{2}-[a-z0-9-]{3,60}$' or length(coalesce(p_native_id, '')) not between 4 and 512 then
    raise exception 'Jurisdiction and section id are required' using errcode = '22023';
  end if;
  select * into gate from corpus_ingest.publisher_code_projected_gate_v3(p_jurisdiction, p_source_system);
  if gate.jurisdiction is null then return null; end if;
  select * into row from corpus_ingest.entities e
  where e.source_system = gate.source_system
    and e.entity_type = 'code-section'
    and e.native_id = p_native_id
    and e.review_status <> 'quarantined'
    and e.schema_version = 'publisher-code-evidence/2';
  if not found then return null; end if;
  source := row.provenance->>'source_url';
  if source is null or source !~ '^https://' then source := null; end if;
  return jsonb_build_object(
    'native_id', row.native_id,
    'jurisdiction', p_jurisdiction,
    'source_system', p_source_system,
    'citation', row.data->>'citation',
    'citation_path', row.data->>'citation_path',
    'heading', row.data->>'heading',
    'text', row.data->>'text',
    'history', row.data->'history',
    'status_note', row.data->'status_note',
    'hierarchy', row.data->'hierarchy',
    'currency', row.data->'currency',
    'source_url', source
  );
end $$;

-- Citation or heading search across one projected code, one jurisdiction's projected codes, or every projected code.
create or replace function public.corpus_publisher_code_projected_search_v3(
  p_q text,
  p_jurisdiction text default null,
  p_source_system text default null,
  p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare needle text; pattern text; total bigint;
begin
  needle := trim(coalesce(p_q, ''));
  if length(needle) < 2 or length(needle) > 120 or (p_jurisdiction is not null and p_jurisdiction !~ '^[A-Z]{2}$') or (p_source_system is not null and p_source_system !~ '^[a-z]{2}-[a-z0-9-]{3,60}$')
    or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'A citation or heading query is required' using errcode = '22023';
  end if;
  pattern := '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select count(*) into total
  from corpus_ingest.entities e
  join corpus_ingest.publisher_code_codes_v3 st on st.source_system = e.source_system
  where st.public_projection_allowed
    and st.review_status = 'reviewed'
    and (p_jurisdiction is null or st.jurisdiction = p_jurisdiction)
    and (p_source_system is null or st.source_system = p_source_system)
    and e.entity_type = 'code-section'
    and e.review_status <> 'quarantined'
    and e.schema_version = 'publisher-code-evidence/2'
    and (
      coalesce(e.data->>'citation', '') ilike pattern escape '\'
      or coalesce(e.data->>'heading', '') ilike pattern escape '\'
    );
  return jsonb_build_object('total', total, 'hits', coalesce((
    select jsonb_agg(jsonb_build_object(
      'jurisdiction', h.jurisdiction,
      'source_system', h.source_system,
      'native_id', h.native_id,
      'citation', h.citation,
      'heading', h.heading
    ) order by h.jurisdiction, h.source_system, h.native_id)
    from (
      select st.jurisdiction, st.source_system, e.native_id, e.data->>'citation' as citation, e.data->>'heading' as heading
      from corpus_ingest.entities e
      join corpus_ingest.publisher_code_codes_v3 st on st.source_system = e.source_system
      where st.public_projection_allowed
        and st.review_status = 'reviewed'
        and (p_jurisdiction is null or st.jurisdiction = p_jurisdiction)
    and (p_source_system is null or st.source_system = p_source_system)
        and e.entity_type = 'code-section'
        and e.review_status <> 'quarantined'
        and e.schema_version = 'publisher-code-evidence/2'
        and (
          coalesce(e.data->>'citation', '') ilike pattern escape '\'
          or coalesce(e.data->>'heading', '') ilike pattern escape '\'
        )
      order by st.jurisdiction, st.source_system, e.native_id
      limit p_limit
    ) h
  ), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke all on function corpus_ingest.publisher_code_mirror_primary_v3() from public, anon, authenticated, service_role;
revoke all on function corpus_ingest.publisher_code_summarize_code_v3(text, text) from public, anon, authenticated, service_role;
revoke all on function corpus_ingest.publisher_code_projected_gate_v3(text, text) from public, anon, authenticated, service_role;
revoke all on function public.corpus_publisher_code_register_manifest_v3(jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_open_run_v3(uuid, text) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_finish_run_v3(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_review_v3(text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_coverage_v3(boolean) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_projected_codes_v3() from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_projected_outline_v3(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_projected_section_v3(text, text, text) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_projected_search_v3(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.corpus_publisher_code_register_manifest_v3(jsonb) to service_role;
grant execute on function public.corpus_publisher_code_open_run_v3(uuid, text) to service_role;
grant execute on function public.corpus_publisher_code_finish_run_v3(uuid, text, jsonb) to service_role;
grant execute on function public.corpus_publisher_code_review_v3(text, text, text, boolean, text) to service_role;
grant execute on function public.corpus_publisher_code_coverage_v3(boolean) to service_role;
grant execute on function public.corpus_publisher_code_projected_codes_v3() to service_role;
grant execute on function public.corpus_publisher_code_projected_outline_v3(text, text, jsonb) to service_role;
grant execute on function public.corpus_publisher_code_projected_section_v3(text, text, text) to service_role;
grant execute on function public.corpus_publisher_code_projected_search_v3(text, text, text, integer) to service_role;

comment on function public.corpus_publisher_code_register_manifest_v3(jsonb) is
  'Registers a manifest. The first code of a jurisdiction, or a new parser version of its primary code, goes through v2; another source system registers a secondary code in publisher_code_codes_v3 only.';
comment on function public.corpus_publisher_code_review_v3(text, text, text, boolean, text) is
  'Per-code review. The only way a code''s public_projection_allowed changes. A primary code is reviewed through v2 and mirrored.';
comment on function public.corpus_publisher_code_projected_codes_v3() is
  'Service-role read of every code whose own review flag is on, one row per code, with its source system.';

notify pgrst, 'reload schema';
commit;
