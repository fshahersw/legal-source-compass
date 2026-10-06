-- ecfr-section-text/1 — official eCFR section text, private ingest + reversible projection.
-- Prepared migration; the release owner applies it (PostgREST exposes only `public`).
-- Requires: corpus-ingest-v1.sql, canonical-integer-jsonb-v1.sql. Idempotent (create if not exists / create or replace).
--
-- Flow (all operations are fixed RPCs; none accepts SQL text):
--   1. setup file opens the run (scope.contract = 'ecfr-section-text/1') and registers the not-ready dataset.
--   2. corpus_ecfr_text_intake_v1      — validated batches into corpus_ingest.entities/entity_versions/observations.
--   3. corpus_ecfr_text_status_v1 / readback_v1 — aggregate + per-row readback proof.
--   4. corpus_ecfr_text_publish_v1     — project entities into public.corpus_records (dataset ecfr_section_text, ready=false)
--      corpus_ecfr_text_verify_v1      — paged full-field verification of the projected rows (receipts);
--      corpus_ecfr_text_finalize_v1    — requires clean receipts for every entity, then ready=true.
--   5. corpus_ecfr_text_plan_v1        — stage links to repoint (md5 recorded per row).
--      corpus_ecfr_text_apply_v1       — md5-guarded, ledgered, dry-run capable repoint (refuses before dataset ready).
--      corpus_ecfr_text_rollback_v1    — restores exactly the ledgered originals (only while the row still equals what was applied).
--   6. corpus_ecfr_text_recheck_v1     — remaining `oul:` links across federal_regulations_sections and citation_index.
-- Every function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.

begin;

create table if not exists corpus_ingest.ecfr_text_plan_v1 (
  run_id uuid not null references corpus_ingest.runs(id),
  seq bigint generated always as identity,
  kind text not null check (kind in ('section_row','citation_row')),
  dataset text not null check (dataset in ('federal_regulations_sections','citation_index')),
  record_id text not null,
  oul_ids text[] not null check (cardinality(oul_ids) between 1 and 8),
  native_id text,
  unavailable_reason text check (unavailable_reason is null or unavailable_reason in
    ('part_not_in_ecfr','section_not_in_ecfr','reserved_in_ecfr','title_unavailable')),
  row_md5 text not null,
  status text not null default 'planned' check (status in ('planned','applied','skipped','reverted')),
  status_note text,
  new_md5 text,
  planned_at timestamptz not null default now(),
  applied_at timestamptz,
  reverted_at timestamptz,
  primary key (run_id, dataset, record_id),
  check ((native_id is null) = (unavailable_reason is not null)),
  check ((kind = 'section_row') = (dataset = 'federal_regulations_sections'))
);
create index if not exists ecfr_text_plan_status on corpus_ingest.ecfr_text_plan_v1(run_id, status, seq);

create table if not exists corpus_ingest.ecfr_text_ledger_v1 (
  run_id uuid not null references corpus_ingest.runs(id),
  dataset text not null,
  record_id text not null,
  original_record jsonb not null,
  original_row_md5 text not null,
  applied_md5 text not null,
  replacement jsonb not null,
  applied_at timestamptz not null default now(),
  primary key (run_id, dataset, record_id)
);

create table if not exists corpus_ingest.ecfr_text_verify_v1 (
  run_id uuid not null references corpus_ingest.runs(id),
  first_native text not null,
  last_native text not null,
  entities bigint not null,
  missing bigint not null,
  mismatched bigint not null,
  verified_at timestamptz not null default now(),
  primary key (run_id, first_native, last_native)
);

alter table corpus_ingest.ecfr_text_verify_v1 enable row level security;
alter table corpus_ingest.ecfr_text_plan_v1 enable row level security;
alter table corpus_ingest.ecfr_text_ledger_v1 enable row level security;
revoke all on corpus_ingest.ecfr_text_plan_v1, corpus_ingest.ecfr_text_ledger_v1, corpus_ingest.ecfr_text_verify_v1 from public, anon, authenticated;
grant all on corpus_ingest.ecfr_text_plan_v1, corpus_ingest.ecfr_text_ledger_v1, corpus_ingest.ecfr_text_verify_v1 to service_role;

-- ------------------------------------------------------------------------------------------------ helpers
create or replace function corpus_ingest.ecfr_text_run_v1(p_run uuid, p_open boolean default true)
returns jsonb language plpgsql stable set search_path = '' as $$
declare s jsonb;
begin
  select r.scope into s from corpus_ingest.runs r where r.id = p_run
    and (not p_open or r.status in ('running','partial'));
  if s is null or s->>'contract' is distinct from 'ecfr-section-text/1' or s->>'source_system' is distinct from 'ecfr'
     or s->>'entity_type' is distinct from 'section-text' then
    raise exception 'Exact ecfr-section-text/1 run required' using errcode = '22023';
  end if;
  return s;
end $$;

create or replace function corpus_ingest.ecfr_text_token_v1(p_id text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(p_id, '%', '%25'), '/', '%2F'), ':', '%3A'), ' ', '%20')
$$;

create or replace function corpus_ingest.ecfr_text_norm_v1(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))
$$;

create or replace function corpus_ingest.ecfr_text_record_v1(p_native text, p_data jsonb, p_retrieved timestamptz, p_source_url text, p_hierarchy_present boolean)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  rid text := 'ecfr:section-text:' || p_native;
  heading text := p_data->>'heading';
  links jsonb := jsonb_build_array(jsonb_build_object('url', p_data->>'ecfr_url', 'label', 'Open on ecfr.gov (current)'));
  facts jsonb;
begin
  if p_hierarchy_present and p_data->>'hierarchy_native_id' is not null then
    links := links || jsonb_build_array(jsonb_build_object(
      'url', '#record/ecfr_hierarchy/' || corpus_ingest.ecfr_text_token_v1('ecfr:node:' || (p_data->>'hierarchy_native_id')),
      'label', 'Open in the eCFR hierarchy'));
  end if;
  facts := jsonb_build_array(
    jsonb_build_array('CFR title', p_data->>'title_number'),
    jsonb_build_array('Part', p_data->>'part_number'),
    jsonb_build_array('Section', p_data->>'section_number'),
    jsonb_build_array('Text as of', p_data->>'as_of'),
    jsonb_build_array('Title last amended', coalesce(p_data->>'title_latest_amended_on', 'Not recorded')),
    jsonb_build_array('Reserved', case when (p_data->>'reserved')::boolean then 'Yes' else 'No' end),
    jsonb_build_array('Source response basis (SHA-256)', p_data->>'raw_response_sha256'));
  if p_data->>'source_note' is not null then
    facts := facts || jsonb_build_array(jsonb_build_array('Source note as printed', p_data->>'source_note'));
  end if;
  return jsonb_build_object(
    'id', rid,
    'category', 'regulations',
    'state', '',
    'title', heading,
    'source_url', p_source_url,
    'text', coalesce(p_data->>'text', ''),
    'filters', jsonb_build_object('_listing', 'true', 'native_id', p_native, 'title_number', p_data->>'title_number',
      'part_number', p_data->>'part_number', 'section_number', p_data->>'section_number',
      'reserved', case when (p_data->>'reserved')::boolean then 'true' else 'false' end, 'as_of', p_data->>'as_of'),
    'item', jsonb_build_object('id', rid,
      'cells', jsonb_build_object('title_number', p_data->>'title_number', 'part_number', p_data->>'part_number',
        'section_number', p_data->>'section_number', 'as_of', p_data->>'as_of',
        'reserved', coalesce((p_data->>'reserved')::boolean, false)),
      'links', links, 'title', heading,
      'badges', jsonb_build_array('section', 'Official eCFR text'),
      'subtitle', 'Title ' || (p_data->>'title_number') || ' · Part ' || (p_data->>'part_number') || ' · as of ' || (p_data->>'as_of')),
    'detail', jsonb_build_object('id', rid, 'title', heading,
      'qualification', 'Plain text of the eCFR section as served by the public eCFR Versioner API for the stated point-in-time date. The eCFR is authoritative but unofficial; the official legal edition is the annual CFR. The date is the title currency date requested from the API, not a legal effective date. Tables and images are not reproduced when the source marks them as non-text. Text does not establish applicability to any claim.',
      'facts', facts, 'links', links)
  );
end $$;

-- Section row after the repoint: the unverified Open US Law text entry is replaced by the official eCFR text entry.
create or replace function corpus_ingest.ecfr_text_section_row_v1(p_row jsonb, p_native text, p_ent jsonb, p_retrieved timestamptz, p_reason text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  detail jsonb := p_row->'detail';
  item jsonb := p_row->'item';
  filt jsonb := coalesce(p_row->'filters', '{}'::jsonb);
  gpo jsonb; has_gpo boolean; gpo_text text; official jsonb; texts jsonb; recon jsonb; sources jsonb;
  cmp text; cat text; new_text text; dts jsonb; token text; as_of_txt text;
begin
  select coalesce(jsonb_agg(x.t order by x.o), '[]'::jsonb) into gpo
    from jsonb_array_elements(coalesce(detail->'texts', '[]'::jsonb)) with ordinality x(t, o)
   where x.t->>'source' is distinct from 'open_us_law';
  has_gpo := jsonb_array_length(gpo) > 0;
  select string_agg(x.t->>'text', E'\n' order by x.o) into gpo_text
    from jsonb_array_elements(gpo) with ordinality x(t, o) where x.t->>'text' is not null;

  if p_ent is not null then
    token := corpus_ingest.ecfr_text_token_v1('ecfr:section-text:' || p_native);
    official := jsonb_build_object(
      'role', 'official_text', 'source', 'ecfr_api',
      'label', 'eCFR Versioner API (public eCFR full-text service; authoritative but unofficial, the official edition is the annual CFR)',
      'native_id', p_native, 'record_id', 'ecfr:section-text:' || p_native,
      'text', p_ent->>'text', 'text_length', p_ent->'text_length', 'text_sha256', p_ent->>'text_sha256',
      'text_hash_verified', encode(sha256(convert_to(p_ent->>'text', 'UTF8')), 'hex') = p_ent->>'text_sha256',
      'heading_as_printed', p_ent->>'heading', 'source_note_as_printed', p_ent->>'source_note',
      'authority_note_as_printed', p_ent->>'authority_note',
      'as_of', p_ent->>'as_of', 'title_latest_amended_on', p_ent->>'title_latest_amended_on',
      'raw_response_sha256', p_ent->>'raw_response_sha256', 'unavailable_reason', null,
      'temporal', jsonb_build_object(
        'captured_at', to_char(p_retrieved at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'source_as_of', p_ent->>'as_of', 'effective_from', null, 'effective_to', null, 'published_at', null,
        'captured_at_basis', 'eCFR Versioner API HTTP receipt',
        'source_as_of_basis', 'eCFR point-in-time date requested from the API (title currency date); not a legal effective date or annual-edition date',
        'effective_from_basis', 'not stated by the source; never inferred from an amendment, publication, issue, marker or snapshot date',
        'effective_to_basis', 'not stated by the source; never inferred from an amendment, publication, issue, marker or snapshot date',
        'published_at_basis', null));
    texts := jsonb_build_array(official) || gpo;
  else
    texts := gpo;
  end if;

  cmp := case when p_ent is null or not has_gpo then null
              when corpus_ingest.ecfr_text_norm_v1(gpo_text) = corpus_ingest.ecfr_text_norm_v1(p_ent->>'text') then 'identical'
              else 'text_differs' end;
  cat := case when p_ent is not null and has_gpo then cmp when p_ent is not null then 'ecfr_api_only'
              when has_gpo then 'gpo_only' else 'structure_only' end;
  recon := jsonb_build_object(
    'basis', 'comparison of the GPO eCFR XML bulk text with the eCFR API text (whitespace-normalised)',
    'in_gpo', has_gpo, 'in_ecfr_api', p_ent is not null, 'category', cat, 'text_comparison', cmp,
    'gpo_text_length', case when has_gpo then length(gpo_text) end,
    'ecfr_api_text_length', case when p_ent is not null then length(p_ent->>'text') end,
    'ecfr_api_unavailable_reason', p_reason,
    'in_ecfr_structure', coalesce(detail->'reconciliation'->'in_ecfr_structure', 'false'::jsonb));

  select coalesce(jsonb_agg(v), '[]'::jsonb) into sources from (
    select 'gpo_ecfr_xml' v where has_gpo union all select 'ecfr_api' where p_ent is not null) s;

  detail := jsonb_set(jsonb_set(jsonb_set(detail, '{texts}', texts), '{reconciliation}', recon), '{text_sources_available}', sources);
  item := jsonb_set(item, '{text_sources_available}', sources);
  if p_ent is not null then
    detail := detail || jsonb_build_object('links', jsonb_build_array(jsonb_build_object(
      'url', '#record/ecfr_section_text/' || token, 'label', 'Official eCFR text (as of ' || (p_ent->>'as_of') || ')')));
  end if;

  filt := filt - 'oul_snapshot_date';
  if filt ? 'date_types' or p_ent is not null then
    select coalesce(jsonb_agg(v), '[]'::jsonb) into dts from (
      select v from jsonb_array_elements_text(coalesce(filt->'date_types', '[]'::jsonb)) v where v <> 'oul_snapshot_date'
      union all select 'ecfr_text_as_of' where p_ent is not null
        and not (coalesce(filt->'date_types', '[]'::jsonb) ? 'ecfr_text_as_of')) d;
    filt := jsonb_set(filt, '{date_types}', dts);
  end if;
  if p_ent is not null then
    filt := filt || jsonb_build_object('ecfr_text_as_of', jsonb_build_array(p_ent->>'as_of'));
  end if;

  if p_ent is null then
    select max(e.data->>'as_of') into as_of_txt from corpus_ingest.entities e
     where e.source_system = 'ecfr' and e.entity_type = 'section-text' and e.data->>'title_number' = p_row->'item'->>'title';
    detail := jsonb_set(detail, '{facts}', coalesce(detail->'facts', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_array('Official eCFR text', 'Not recorded'),
      jsonb_build_array('Why the official text is not recorded', case coalesce(p_reason, '')
        when 'section_not_in_ecfr' then 'This section is not in the current eCFR as of ' || coalesce(as_of_txt, 'the acquisition date')
        when 'part_not_in_ecfr' then 'This part is not in the current eCFR as of ' || coalesce(as_of_txt, 'the acquisition date')
        when 'title_unavailable' then 'This title is not available in the eCFR as of ' || coalesce(as_of_txt, 'the acquisition date')
        else 'The eCFR did not return official text for this section' end)));
  end if;
  new_text := case when p_ent is not null then p_ent->>'text' else coalesce(gpo_text, '') end;
  return jsonb_build_object('item', item, 'detail', detail, 'filters', filt, 'text', new_text);
end $$;

create or replace function corpus_ingest.ecfr_text_citation_row_v1(p_row jsonb, p_oul text, p_native text, p_ent jsonb, p_reason text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  item jsonb := p_row->'item'; detail jsonb := p_row->'detail';
  old_url text := '#record/' || p_oul;
  new_link jsonb; label text; facts jsonb; txt text := coalesce(p_row->>'text', '');
  where_old text := 'Saved law text'; where_new text;
begin
  if p_ent is not null then
    label := 'Open ' || coalesce(item->'cells'->>'citation', p_row->>'title') || ' in the official eCFR text (as of ' || (p_ent->>'as_of') || ')';
    new_link := jsonb_build_object('url', '#record/ecfr_section_text/' || corpus_ingest.ecfr_text_token_v1('ecfr:section-text:' || p_native), 'label', label);
    where_new := 'Official eCFR text';
    item := jsonb_set(item, '{links}', coalesce((
      select jsonb_agg(case when l->>'url' = old_url then new_link else l end order by o)
        from jsonb_array_elements(item->'links') with ordinality x(l, o)), '[]'::jsonb));
    detail := jsonb_set(detail, '{links}', coalesce((
      select jsonb_agg(case when l->>'url' = old_url then new_link else l end order by o)
        from jsonb_array_elements(detail->'links') with ordinality x(l, o)), '[]'::jsonb));
  else
    where_new := 'Not recorded';
    item := jsonb_set(item, '{links}', coalesce((
      select jsonb_agg(l order by o) from jsonb_array_elements(item->'links') with ordinality x(l, o) where l->>'url' <> old_url), '[]'::jsonb));
    detail := jsonb_set(detail, '{links}', coalesce((
      select jsonb_agg(l order by o) from jsonb_array_elements(detail->'links') with ordinality x(l, o) where l->>'url' <> old_url), '[]'::jsonb));
  end if;
  if item->'cells'->>'where' = where_old then
    item := jsonb_set(item, '{cells,where}', to_jsonb(where_new));
  end if;
  select coalesce(jsonb_agg(case
      when f->>0 = 'In this library' and f->>1 = where_old then jsonb_build_array('In this library', where_new)
      when f->>0 = 'Match to the saved text' then jsonb_build_array('Match to the official text', f->1)
      else f end order by o), '[]'::jsonb) into facts
    from jsonb_array_elements(coalesce(detail->'facts', '[]'::jsonb)) with ordinality x(f, o);
  detail := jsonb_set(detail, '{facts}', facts);
  txt := replace(replace(txt, 'In this library ' || where_old, 'In this library ' || where_new), 'Match to the saved text', 'Match to the official text');
  return jsonb_build_object('item', item, 'detail', detail, 'filters', p_row->'filters', 'text', txt);
end $$;

-- ------------------------------------------------------------------------------------------------ intake
create or replace function public.corpus_ecfr_text_intake_v1(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; rels bigint;
begin
  perform corpus_ingest.ecfr_text_run_v1(p_run);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500
     or octet_length(p_rows::text) > 6291456 then
    raise exception 'Expected 1..500 records within 6 MiB' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where
      x->>'source_system' is distinct from 'ecfr' or x->>'entity_type' is distinct from 'section-text'
      or x->>'schema_version' is distinct from 'ecfr-section-text/1'
      or jsonb_typeof(x->'data') is distinct from 'object' or jsonb_typeof(x->'provenance') is distinct from 'object'
      or coalesce(x->>'native_id', '') !~ '^title-[0-9]+/part-[^/]+/section-[^/]+$'
      or x->>'native_id' is distinct from 'title-' || (x->'data'->>'title_number') || '/part-' || (x->'data'->>'part_number') || '/section-' || (x->'data'->>'section_number')
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(x->'data') is distinct from x->'provenance'->>'record_sha256'
      or encode(sha256(convert_to(coalesce(x->'data'->>'text', ''), 'UTF8')), 'hex') is distinct from x->'data'->>'text_sha256'
      or coalesce(x->'provenance'->>'source_url', '') !~ '^https://www\.ecfr\.gov/api/versioner/v1/full/[0-9]{4}-[0-9]{2}-[0-9]{2}/title-[0-9]+\.xml\?part='
      or coalesce(x->'provenance'->>'source_sha256', '') !~ '^[0-9a-f]{64}$'
      or x->'provenance'->>'source_sha256' is distinct from x->'data'->>'raw_response_sha256'
      or coalesce(x->'data'->>'as_of', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or x->'provenance'->>'source_as_of' is distinct from x->'data'->>'as_of'
      or x->'provenance'->'http_status' is distinct from '200'::jsonb
      or coalesce(x->'provenance'->>'retrieved_at', '') = ''
      or coalesce(x->'provenance'->>'raw_object_key', '') !~ '^ecfr-text/sha256/[0-9a-f]{2}/[0-9a-f]{64}\.xml$'
      or x->'provenance'->>'raw_object_key' is distinct from 'ecfr-text/sha256/' || left(x->'provenance'->>'source_sha256', 2) || '/' || (x->'provenance'->>'source_sha256') || '.xml') then
    raise exception 'Invalid eCFR section-text identity, hash, schema or retrieval provenance' using errcode = '22023';
  end if;
  result := corpus_ingest.ingest_entities(p_run, p_rows);
  insert into corpus_ingest.relationships(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256, inferred, target_present, run_id)
  select 'ecfr', 'section-text', x->>'native_id', 'hierarchy_node', 'hierarchy-nodes', x->'data'->>'hierarchy_native_id',
         x->'provenance'->>'record_sha256', true,
         exists (select 1 from corpus_ingest.entities e where e.source_system = 'ecfr' and e.entity_type = 'hierarchy-nodes'
                 and e.native_id = x->'data'->>'hierarchy_native_id'), p_run
    from jsonb_array_elements(p_rows) x
   where x->'data'->>'hierarchy_native_id' is not null
  on conflict do nothing;
  get diagnostics rels = row_count;
  return result || jsonb_build_object('relationships_written', rels);
end $$;

create or replace function public.corpus_ecfr_text_status_v1(p_run uuid, p_after text default null, p_limit integer default 2000)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare page record;
begin
  perform corpus_ingest.ecfr_text_run_v1(p_run, false);
  if p_limit not between 1 and 5000 then raise exception 'Invalid page size' using errcode = '22023'; end if;
  with v as (select * from corpus_ingest.entity_versions
              where source_system = 'ecfr' and entity_type = 'section-text' and first_run = p_run
                and (p_after is null or native_id collate "C" > p_after collate "C")
              order by native_id collate "C" limit p_limit)
  select count(*) n, max(native_id collate "C") last_id,
         count(*) filter (where corpus_ingest.canonical_integer_jsonb_sha256_v1(data) is distinct from payload_sha256) hash_mismatches,
         count(*) filter (where encode(sha256(convert_to(data->>'text', 'UTF8')), 'hex') is distinct from data->>'text_sha256') text_hash_mismatches,
         count(*) filter (where storage_sha256 is distinct from encode(sha256(convert_to(data::text, 'UTF8')), 'hex')) storage_mismatches
    into page from v;
  return jsonb_build_object(
    'run_id', p_run,
    'entities', (select count(*) from corpus_ingest.entities where source_system = 'ecfr' and entity_type = 'section-text'),
    'versions_first_seen_in_run', (select count(*) from corpus_ingest.entity_versions where source_system = 'ecfr' and entity_type = 'section-text' and first_run = p_run),
    'observations', (select count(*) from corpus_ingest.observations where run_id = p_run and source_system = 'ecfr' and entity_type = 'section-text'),
    'distinct_source_sha256', (select count(distinct source_sha256) from corpus_ingest.observations where run_id = p_run and source_system = 'ecfr' and entity_type = 'section-text'),
    'as_of_dates', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb) from (select distinct source_as_of d from corpus_ingest.observations where run_id = p_run and entity_type = 'section-text') x),
    'relationships', (select count(*) from corpus_ingest.relationships where run_id = p_run and from_type = 'section-text'),
    'page', jsonb_build_object('after', p_after, 'rows', page.n, 'last', page.last_id, 'hash_mismatches', page.hash_mismatches,
      'text_hash_mismatches', page.text_hash_mismatches, 'storage_mismatches', page.storage_mismatches));
end $$;

create or replace function public.corpus_ecfr_text_readback_v1(p_run uuid, p_native_ids jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform corpus_ingest.ecfr_text_run_v1(p_run, false);
  if jsonb_typeof(p_native_ids) is distinct from 'array' or jsonb_array_length(p_native_ids) not between 1 and 2000 then
    raise exception 'Expected 1..2000 native ids' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('native_id', e.native_id, 'payload_sha256', e.payload_sha256,
      'schema_version', e.schema_version, 'source_sha256', o.source_sha256, 'source_as_of', o.source_as_of,
      'retrieved_at', o.retrieved_at, 'source_url', o.source_url, 'text_sha256', e.data->>'text_sha256',
      'review_status', e.review_status) order by e.native_id collate "C")
    from jsonb_array_elements_text(p_native_ids) n
    join corpus_ingest.entities e on e.source_system = 'ecfr' and e.entity_type = 'section-text' and e.native_id = n
    join corpus_ingest.observations o on (o.run_id, o.source_system, o.entity_type, o.native_id, o.payload_sha256) = (p_run, e.source_system, e.entity_type, e.native_id, e.payload_sha256)), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------------------------------------ publish records
create or replace function public.corpus_ecfr_text_publish_v1(p_run uuid, p_limit integer default 1000, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare written bigint := 0; pending bigint; base bigint;
begin
  perform corpus_ingest.ecfr_text_run_v1(p_run);
  if p_limit not between 1 and 2000 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  if not exists (select 1 from public.corpus_datasets d where d.id = 'ecfr_section_text' and not d.ready) then
    raise exception 'Dataset ecfr_section_text must be registered and not yet ready' using errcode = '22023';
  end if;
  select count(*) into pending from corpus_ingest.entities e
   where e.source_system = 'ecfr' and e.entity_type = 'section-text' and e.review_status <> 'quarantined'
     and not exists (select 1 from public.corpus_records r where r.dataset = 'ecfr_section_text' and r.id = 'ecfr:section-text:' || e.native_id);
  if p_dry then return jsonb_build_object('dry', true, 'pending', pending); end if;
  select coalesce(max(ordinal), 0) into base from public.corpus_records where dataset = 'ecfr_section_text';
  with batch as (
    select e.native_id, e.data, e.retrieved_at, e.provenance->>'source_url' source_url,
           row_number() over (order by e.native_id collate "C") rn
      from corpus_ingest.entities e
     where e.source_system = 'ecfr' and e.entity_type = 'section-text' and e.review_status <> 'quarantined'
       and not exists (select 1 from public.corpus_records r where r.dataset = 'ecfr_section_text' and r.id = 'ecfr:section-text:' || e.native_id)
     order by e.native_id collate "C" limit p_limit),
  built as (
    select b.rn, b.native_id,
           corpus_ingest.ecfr_text_record_v1(b.native_id, b.data, b.retrieved_at, b.source_url,
             exists (select 1 from public.corpus_records h where h.dataset = 'ecfr_hierarchy'
                     and h.id = 'ecfr:node:' || (b.data->>'hierarchy_native_id'))) j
      from batch b)
  insert into public.corpus_records(dataset, id, category, state, county_geoids, title, source_url, ordinal, item, detail, text, filters)
  select 'ecfr_section_text', j->>'id', j->>'category', j->>'state', '{}'::text[], j->>'title', j->>'source_url', base + rn,
         j->'item', j->'detail', j->>'text', j->'filters'
    from built
  on conflict (dataset, id) do nothing;
  get diagnostics written = row_count;
  return jsonb_build_object('dry', false, 'written', written, 'pending_before', pending);
end $$;

create or replace function public.corpus_ecfr_text_verify_v1(p_run uuid, p_after text default null, p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n bigint; miss bigint; mism bigint; first_id text; last_id text;
begin
  perform corpus_ingest.ecfr_text_run_v1(p_run);
  if p_limit not between 1 and 2000 then raise exception 'Invalid page size' using errcode = '22023'; end if;
  with page as (
    select e.native_id, e.data, e.retrieved_at, e.provenance->>'source_url' source_url
      from corpus_ingest.entities e
     where e.source_system = 'ecfr' and e.entity_type = 'section-text' and e.review_status <> 'quarantined'
       and (p_after is null or e.native_id collate "C" > p_after collate "C")
     order by e.native_id collate "C" limit p_limit),
  exp as (
    select p.native_id, corpus_ingest.ecfr_text_record_v1(p.native_id, p.data, p.retrieved_at, p.source_url,
             exists (select 1 from public.corpus_records h where h.dataset = 'ecfr_hierarchy' and h.id = 'ecfr:node:' || (p.data->>'hierarchy_native_id'))) j
      from page p)
  select count(*), min(x.native_id collate "C"), max(x.native_id collate "C"),
         count(*) filter (where r.id is null),
         count(*) filter (where r.id is not null and (
           r.category is distinct from x.j->>'category' or r.state is distinct from x.j->>'state' or r.title is distinct from x.j->>'title'
           or r.source_url is distinct from x.j->>'source_url' or r.text is distinct from x.j->>'text'
           or r.item is distinct from x.j->'item' or r.detail is distinct from x.j->'detail' or r.filters is distinct from x.j->'filters'))
    into n, first_id, last_id, miss, mism
    from exp x left join public.corpus_records r on r.dataset = 'ecfr_section_text' and r.id = x.j->>'id';
  if n > 0 then
    insert into corpus_ingest.ecfr_text_verify_v1(run_id, first_native, last_native, entities, missing, mismatched)
    values (p_run, first_id, last_id, n, miss, mism)
    on conflict (run_id, first_native, last_native) do update set entities = excluded.entities, missing = excluded.missing,
      mismatched = excluded.mismatched, verified_at = now();
  end if;
  return jsonb_build_object('entities', n, 'last', last_id, 'missing', miss, 'mismatched', mism);
end $$;

create or replace function public.corpus_ecfr_text_finalize_v1(p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare expected bigint; actual bigint; uncovered bigint; bad bigint; ok boolean; facets jsonb;
begin
  perform corpus_ingest.ecfr_text_run_v1(p_run);
  select count(*) into expected from corpus_ingest.entities e where e.source_system = 'ecfr' and e.entity_type = 'section-text' and e.review_status <> 'quarantined';
  select count(*) into actual from public.corpus_records where dataset = 'ecfr_section_text';
  select count(*) into uncovered from corpus_ingest.entities e
   where e.source_system = 'ecfr' and e.entity_type = 'section-text' and e.review_status <> 'quarantined'
     and not exists (select 1 from corpus_ingest.ecfr_text_verify_v1 v where v.run_id = p_run and v.missing = 0 and v.mismatched = 0
                      and e.native_id collate "C" >= v.first_native collate "C" and e.native_id collate "C" <= v.last_native collate "C");
  select count(*) into bad from corpus_ingest.ecfr_text_verify_v1 v where v.run_id = p_run and (v.missing <> 0 or v.mismatched <> 0);
  ok := expected > 0 and expected = actual and uncovered = 0 and bad = 0;
  select jsonb_agg(jsonb_build_object('value', t, 'label', 'Title ' || t, 'count', c) order by t::int) into facets
    from (select filters->>'title_number' t, count(*) c from public.corpus_records where dataset = 'ecfr_section_text' group by 1) f;
  if ok then
    update public.corpus_datasets d set ready = true, expected_records = expected, imported_records = actual, updated_at = now(),
      metadata = d.metadata || jsonb_build_object('projection_run_id', p_run,
        'listing', jsonb_build_object(
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'title_number', 'label', 'CFR title'), jsonb_build_object('key', 'part_number', 'label', 'Part'),
            jsonb_build_object('key', 'section_number', 'label', 'Section'), jsonb_build_object('key', 'as_of', 'label', 'Text as of'),
            jsonb_build_object('key', 'reserved', 'label', 'Reserved')),
          'filters', jsonb_build_array(jsonb_build_object('name', 'title_number', 'type', 'select', 'label', 'CFR title', 'options', facets))))
     where d.id = 'ecfr_section_text';
  else
    update public.corpus_datasets set expected_records = expected, imported_records = actual, updated_at = now() where id = 'ecfr_section_text';
  end if;
  return jsonb_build_object('verified', ok, 'expected', expected, 'actual', actual, 'entities_without_clean_verification', uncovered, 'pages_with_problems', bad);
end $$;

-- ------------------------------------------------------------------------------------------------ plan / apply / rollback
create or replace function public.corpus_ecfr_text_plan_v1(p_run uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it jsonb; r public.corpus_records; oulset text[]; planned bigint := 0; rejected jsonb := '[]'::jsonb; n bigint; expected_native text; kind_expected text;
begin
  perform corpus_ingest.ecfr_text_run_v1(p_run);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 2000 then
    raise exception 'Expected 1..2000 plan items' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into r from public.corpus_records
     where dataset = it->>'dataset' and id = it->>'record_id'
       and it->>'dataset' in ('federal_regulations_sections', 'citation_index');
    if not found then rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'row_missing')); continue; end if;
    select coalesce(array_agg(distinct m[1] order by m[1]), '{}') into oulset
      from regexp_matches(coalesce(r.item::text, '') || coalesce(r.detail::text, '') || coalesce(r.filters::text, '') || coalesce(r.text, ''), '(oul:[0-9a-f]{64})', 'g') m;
    if oulset is distinct from (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(it->'oul_ids') x) then
      rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'oul_ids_differ_from_row')); continue;
    end if;
    kind_expected := case it->>'dataset' when 'federal_regulations_sections' then 'section_row' else 'citation_row' end;
    if it->>'kind' is distinct from kind_expected then
      rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'kind_dataset_mismatch')); continue;
    end if;
    if it->>'dataset' = 'citation_index' and cardinality(oulset) <> 1 then
      rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'citation_row_needs_exactly_one_oul_link')); continue;
    end if;
    if it->>'native_id' is not null then
      if not exists (select 1 from corpus_ingest.entities e where e.source_system = 'ecfr' and e.entity_type = 'section-text'
                      and e.native_id = it->>'native_id' and e.review_status <> 'quarantined') then
        rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'official_entity_missing')); continue;
      end if;
      if it->>'dataset' = 'federal_regulations_sections' then
        expected_native := 'title-' || (r.item->>'title') || '/part-' || (r.item->>'part') || '/section-' || (r.item->>'section');
        if expected_native is distinct from it->>'native_id' then
          rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'native_id_differs_from_row_citation')); continue;
        end if;
      end if;
    end if;
    insert into corpus_ingest.ecfr_text_plan_v1(run_id, kind, dataset, record_id, oul_ids, native_id, unavailable_reason, row_md5)
    values (p_run, it->>'kind', it->>'dataset', it->>'record_id', oulset, it->>'native_id', it->>'unavailable_reason', md5(to_jsonb(r)::text))
    on conflict (run_id, dataset, record_id) do nothing;
    get diagnostics n = row_count; planned := planned + n;
  end loop;
  return jsonb_build_object('planned', planned, 'rejected', rejected);
end $$;

create or replace function public.corpus_ecfr_text_apply_v1(p_run uuid, p_limit integer default 500, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl record; r public.corpus_records; ent_data jsonb; ent_ret timestamptz; nv jsonb; applied bigint := 0; skipped bigint := 0; would bigint := 0; after_md5 text; note text;
begin
  perform corpus_ingest.ecfr_text_run_v1(p_run);
  if p_limit not between 1 and 1000 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  if not p_dry and not exists (select 1 from public.corpus_datasets d where d.id = 'ecfr_section_text' and d.ready) then
    raise exception 'ecfr_section_text must be published and verified before links are repointed' using errcode = '22023';
  end if;
  for pl in select * from corpus_ingest.ecfr_text_plan_v1 where run_id = p_run and status = 'planned' order by seq limit p_limit loop
    note := null; ent_data := null; ent_ret := null;
    select * into r from public.corpus_records where dataset = pl.dataset and id = pl.record_id for update;
    if not found then note := 'row missing';
    elsif md5(to_jsonb(r)::text) <> pl.row_md5 then note := 'row changed since plan';
    end if;
    if note is null and pl.native_id is not null then
      select e.data, e.retrieved_at into ent_data, ent_ret from corpus_ingest.entities e
       where e.source_system = 'ecfr' and e.entity_type = 'section-text' and e.native_id = pl.native_id and e.review_status <> 'quarantined';
      if not found then note := 'official entity missing';
      elsif not exists (select 1 from public.corpus_records t where t.dataset = 'ecfr_section_text' and t.id = 'ecfr:section-text:' || pl.native_id) then
        note := 'official record not projected';
      end if;
    end if;
    if note is not null then
      skipped := skipped + 1;
      if not p_dry then update corpus_ingest.ecfr_text_plan_v1 set status = 'skipped', status_note = note where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id; end if;
      continue;
    end if;
    if pl.kind = 'section_row' then
      nv := corpus_ingest.ecfr_text_section_row_v1(to_jsonb(r), pl.native_id, ent_data, ent_ret, pl.unavailable_reason);
    else
      nv := corpus_ingest.ecfr_text_citation_row_v1(to_jsonb(r), pl.oul_ids[1], pl.native_id, ent_data, pl.unavailable_reason);
    end if;
    if p_dry then would := would + 1; continue; end if;
    update public.corpus_records set item = nv->'item', detail = nv->'detail', filters = nv->'filters', text = nv->>'text'
     where dataset = pl.dataset and id = pl.record_id;
    select md5(to_jsonb(x)::text) into after_md5 from public.corpus_records x where x.dataset = pl.dataset and x.id = pl.record_id;
    insert into corpus_ingest.ecfr_text_ledger_v1(run_id, dataset, record_id, original_record, original_row_md5, applied_md5, replacement)
    values (p_run, pl.dataset, pl.record_id, to_jsonb(r) - 'search_vector', pl.row_md5, after_md5, nv);
    update corpus_ingest.ecfr_text_plan_v1 set status = 'applied', new_md5 = after_md5, applied_at = now() where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id;
    applied := applied + 1;
  end loop;
  return jsonb_build_object('dry', p_dry, 'applied', applied, 'would_apply', would, 'skipped', skipped,
    'remaining_planned', (select count(*) from corpus_ingest.ecfr_text_plan_v1 where run_id = p_run and status = 'planned'));
end $$;

create or replace function public.corpus_ecfr_text_rollback_v1(p_run uuid, p_limit integer default 500, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl record; l corpus_ingest.ecfr_text_ledger_v1; r public.corpus_records; restored bigint := 0; skipped bigint := 0; back_md5 text;
begin
  perform corpus_ingest.ecfr_text_run_v1(p_run, false);
  if p_limit not between 1 and 1000 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  for pl in select * from corpus_ingest.ecfr_text_plan_v1 where run_id = p_run and status = 'applied' order by seq limit p_limit loop
    select * into l from corpus_ingest.ecfr_text_ledger_v1 where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id;
    select * into r from public.corpus_records where dataset = pl.dataset and id = pl.record_id for update;
    if not found or md5(to_jsonb(r)::text) <> l.applied_md5 then
      skipped := skipped + 1;
      if not p_dry then update corpus_ingest.ecfr_text_plan_v1 set status_note = 'rollback skipped: row changed since apply' where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id; end if;
      continue;
    end if;
    if p_dry then restored := restored + 1; continue; end if;
    update public.corpus_records set item = l.original_record->'item', detail = l.original_record->'detail',
           filters = l.original_record->'filters', text = l.original_record->>'text'
     where dataset = pl.dataset and id = pl.record_id;
    select md5(to_jsonb(x)::text) into back_md5 from public.corpus_records x where x.dataset = pl.dataset and x.id = pl.record_id;
    if back_md5 is distinct from l.original_row_md5 then
      raise exception 'Rollback did not reproduce the original row md5 for %', pl.record_id using errcode = '22023';
    end if;
    update corpus_ingest.ecfr_text_plan_v1 set status = 'reverted', reverted_at = now(), status_note = null where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id;
    restored := restored + 1;
  end loop;
  return jsonb_build_object('dry', p_dry, 'restored', restored, 'skipped', skipped,
    'remaining_applied', (select count(*) from corpus_ingest.ecfr_text_plan_v1 where run_id = p_run and status = 'applied'));
end $$;

-- ------------------------------------------------------------------------------------------------ re-check
create or replace function public.corpus_ecfr_text_recheck_v1(p_deep boolean default false, p_dataset text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (
    -- Default scan: the places an oul: target occurs (sections: item, filters, detail.texts[].publisher_record_id/source,
    -- detail.links; citations: item/detail link arrays). p_deep=true scans the whole serialized row (slower).
    select r.dataset,
      case when p_deep then coalesce(r.item::text, '') || coalesce(r.detail::text, '') || coalesce(r.filters::text, '') || coalesce(r.text, '')
           when r.dataset = 'federal_regulations_sections' then coalesce(r.item::text, '') || coalesce(r.filters::text, '')
             || coalesce((r.detail->'links')::text, '') || coalesce((r.detail->'reconciliation')::text, '')
             || coalesce((select string_agg(coalesce(x->>'publisher_record_id', '') || ' ' || coalesce(x->>'source', ''), ' ')
                            from jsonb_array_elements(case when jsonb_typeof(r.detail->'texts') = 'array' then r.detail->'texts' else '[]'::jsonb end) x), '')
           else coalesce((r.item->'links')::text, '') || coalesce((r.detail->'links')::text, '') end t,
      coalesce(r.item->'cells'->>'citation', '') cit
      from public.corpus_records r where r.dataset in ('federal_regulations_sections', 'citation_index')
       and (p_dataset is null or r.dataset = p_dataset)),
  f as (
    select dataset, (t ~ 'oul:[0-9a-f]{64}') oul, (t ~ 'open_us_law') opn, cit from s)
  select jsonb_build_object(
    'deep_scan', p_deep,
    'federal_regulations_sections', jsonb_build_object(
      'rows', count(*) filter (where dataset = 'federal_regulations_sections'),
      'rows_with_oul_link', count(*) filter (where dataset = 'federal_regulations_sections' and oul),
      'rows_mentioning_open_us_law', count(*) filter (where dataset = 'federal_regulations_sections' and opn)),
    'citation_index', jsonb_build_object(
      'rows', count(*) filter (where dataset = 'citation_index'),
      'rows_with_oul_link', count(*) filter (where dataset = 'citation_index' and oul),
      'cfr_by_citation_text', count(*) filter (where dataset = 'citation_index' and oul and cit ~* 'C\.?F\.?R'),
      'usc_by_citation_text', count(*) filter (where dataset = 'citation_index' and oul and cit ~* 'U\.?S\.?C'),
      'other_by_citation_text', count(*) filter (where dataset = 'citation_index' and oul and cit !~* 'C\.?F\.?R' and cit !~* 'U\.?S\.?C')),
    'ecfr_section_text_records', (select count(*) from public.corpus_records where dataset = 'ecfr_section_text'))
  from f
$$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.corpus_ecfr_text_intake_v1(uuid,jsonb)', 'public.corpus_ecfr_text_status_v1(uuid,text,integer)',
    'public.corpus_ecfr_text_readback_v1(uuid,jsonb)', 'public.corpus_ecfr_text_publish_v1(uuid,integer,boolean)',
    'public.corpus_ecfr_text_verify_v1(uuid,text,integer)', 'public.corpus_ecfr_text_finalize_v1(uuid)', 'public.corpus_ecfr_text_plan_v1(uuid,jsonb)',
    'public.corpus_ecfr_text_apply_v1(uuid,integer,boolean)', 'public.corpus_ecfr_text_rollback_v1(uuid,integer,boolean)',
    'public.corpus_ecfr_text_recheck_v1(boolean,text)',
    'corpus_ingest.ecfr_text_run_v1(uuid,boolean)', 'corpus_ingest.ecfr_text_token_v1(text)', 'corpus_ingest.ecfr_text_norm_v1(text)',
    'corpus_ingest.ecfr_text_record_v1(text,jsonb,timestamptz,text,boolean)',
    'corpus_ingest.ecfr_text_section_row_v1(jsonb,text,jsonb,timestamptz,text)',
    'corpus_ingest.ecfr_text_citation_row_v1(jsonb,text,text,jsonb,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

comment on schema corpus_ingest is 'Private, source-versioned administrative corpus enrichment. Metadata is not a finding of legal applicability. No PDF bytes are acquired by this contract.';
comment on table corpus_ingest.ecfr_text_ledger_v1 is 'Verbatim originals of every row repointed from an unverified Open US Law target to official eCFR text; used only by corpus_ecfr_text_rollback_v1.';

commit;
