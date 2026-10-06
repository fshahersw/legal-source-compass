-- uscode-section-text/1 — official U.S. Code section text (govinfo, United States Code 2024 Edition), private ingest + reversible repoint.
-- Prepared migration; the release owner applies it. Same pattern as ecfr-section-text-v1.sql (which must already be applied: the
-- shared helper corpus_ingest.ecfr_text_token_v1 and corpus_ecfr_text_recheck_v1 are reused). Idempotent.
-- Fixed RPCs only; every function SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Scope: citation_index links to open_us_law U.S. Code records. Nothing else is touched.
begin;

create table if not exists corpus_ingest.uscode_text_plan_v1 (
  run_id uuid not null references corpus_ingest.runs(id),
  seq bigint generated always as identity,
  kind text not null check (kind = 'citation_row'),
  dataset text not null check (dataset = 'citation_index'),
  record_id text not null,
  oul_ids text[] not null check (cardinality(oul_ids) = 1),
  native_id text,
  unavailable_reason text check (unavailable_reason is null or unavailable_reason in ('granule_not_found','identity_mismatch')),
  row_md5 text not null,
  status text not null default 'planned' check (status in ('planned','applied','skipped','reverted')),
  status_note text,
  new_md5 text,
  planned_at timestamptz not null default now(),
  applied_at timestamptz,
  reverted_at timestamptz,
  primary key (run_id, dataset, record_id),
  check ((native_id is null) = (unavailable_reason is not null))
);
create index if not exists uscode_text_plan_status on corpus_ingest.uscode_text_plan_v1(run_id, status, seq);

create table if not exists corpus_ingest.uscode_text_ledger_v1 (
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

create table if not exists corpus_ingest.uscode_text_verify_v1 (
  run_id uuid not null references corpus_ingest.runs(id),
  first_native text not null,
  last_native text not null,
  entities bigint not null,
  missing bigint not null,
  mismatched bigint not null,
  verified_at timestamptz not null default now(),
  primary key (run_id, first_native, last_native)
);

alter table corpus_ingest.uscode_text_plan_v1 enable row level security;
alter table corpus_ingest.uscode_text_ledger_v1 enable row level security;
alter table corpus_ingest.uscode_text_verify_v1 enable row level security;
revoke all on corpus_ingest.uscode_text_plan_v1, corpus_ingest.uscode_text_ledger_v1, corpus_ingest.uscode_text_verify_v1 from public, anon, authenticated;
grant all on corpus_ingest.uscode_text_plan_v1, corpus_ingest.uscode_text_ledger_v1, corpus_ingest.uscode_text_verify_v1 to service_role;

create or replace function corpus_ingest.uscode_text_run_v1(p_run uuid, p_open boolean default true)
returns jsonb language plpgsql stable set search_path = '' as $$
declare s jsonb;
begin
  select r.scope into s from corpus_ingest.runs r where r.id = p_run and (not p_open or r.status in ('running','partial'));
  if s is null or s->>'contract' is distinct from 'uscode-section-text/1' or s->>'source_system' is distinct from 'uscode'
     or s->>'entity_type' is distinct from 'section-text' then
    raise exception 'Exact uscode-section-text/1 run required' using errcode = '22023';
  end if;
  return s;
end $$;

create or replace function corpus_ingest.uscode_text_record_v1(p_native text, p_data jsonb, p_retrieved timestamptz, p_source_url text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  rid text := 'uscode:section-text:' || p_native;
  heading text := p_data->>'heading';
  repealed boolean := coalesce((p_data->>'repealed')::boolean, false);
  proxied boolean := coalesce((p_data->>'proxied_fetch')::boolean, false);
  links jsonb := jsonb_build_array(jsonb_build_object('url', p_data->>'govinfo_details_url', 'label', 'Open on govinfo.gov'));
  facts jsonb;
begin
  facts := jsonb_build_array(
    jsonb_build_array('U.S. Code title', p_data->>'title_number'),
    jsonb_build_array('Section', p_data->>'section_number'),
    jsonb_build_array('Edition', p_data->>'edition_label'),
    jsonb_build_array('Current through', p_data->>'current_through'),
    jsonb_build_array('Status as printed', case when repealed then 'Repealed or transferred (as the page states)' else 'Text as printed' end),
    jsonb_build_array('Fetch route', case when proxied then 'proxied fetch (official govinfo.gov page obtained through a fetch service; content hash recorded)' else 'Direct from govinfo.gov' end),
    jsonb_build_array('Source response basis (SHA-256)', p_data->>'raw_response_sha256'));
  if p_data->>'source_credit' is not null then
    facts := facts || jsonb_build_array(jsonb_build_array('Source credit as printed', p_data->>'source_credit'));
  end if;
  if p_data->>'repeal_summary' is not null then
    facts := facts || jsonb_build_array(jsonb_build_array('Repeal or transfer note as printed', p_data->>'repeal_summary'));
  end if;
  return jsonb_build_object(
    'id', rid, 'category', 'statutes', 'state', 'Federal', 'title', heading, 'source_url', p_source_url,
    'text', coalesce(p_data->>'text', ''),
    'filters', jsonb_build_object('_listing', 'true', 'native_id', p_native, 'title_number', p_data->>'title_number',
      'section_number', p_data->>'section_number', 'edition', p_data->>'edition', 'current_through', p_data->>'current_through',
      'repealed', case when repealed then 'true' else 'false' end),
    'item', jsonb_build_object('id', rid,
      'cells', jsonb_build_object('title_number', p_data->>'title_number', 'section_number', p_data->>'section_number',
        'edition', p_data->>'edition', 'current_through', p_data->>'current_through', 'repealed', repealed),
      'links', links, 'title', heading,
      'badges', case when proxied then jsonb_build_array('section', 'Official U.S. Code text', 'proxied fetch') else jsonb_build_array('section', 'Official U.S. Code text') end,
      'subtitle', 'Title ' || (p_data->>'title_number') || ' · ' || (p_data->>'edition_label') || ' (current through ' || (p_data->>'current_through') || ')'),
    'detail', jsonb_build_object('id', rid, 'title', heading,
      'qualification', 'Section text from the official United States Code page published by the U.S. Government Publishing Office on govinfo.gov, for the stated edition and currency date. A Code edition is a point in time: later amendments are not reflected, and the date shown is the edition currency, not a legal effective date. Statutory notes are retained privately with the source page. Text does not establish applicability to any claim.',
      'facts', facts, 'links', links));
end $$;

create or replace function corpus_ingest.uscode_text_citation_row_v1(p_row jsonb, p_oul text, p_native text, p_ent jsonb, p_reason text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  item jsonb := p_row->'item'; detail jsonb := p_row->'detail';
  old_url text := '#record/' || p_oul;
  new_link jsonb; facts jsonb; txt text := coalesce(p_row->>'text', '');
  where_old text := 'Saved law text'; where_new text; why text;
begin
  if p_ent is not null then
    new_link := jsonb_build_object('url', '#record/uscode_section_text/' || replace(replace(corpus_ingest.ecfr_text_token_v1('uscode:section-text:' || p_native), '[', '%5B'), ']', '%5D'),
      'label', 'Open ' || coalesce(item->'cells'->>'citation', p_row->>'title') || ' in the official U.S. Code text (' || (p_ent->>'edition_label') || ', current through ' || (p_ent->>'current_through') || ')');
    where_new := 'Official U.S. Code text';
    item := jsonb_set(item, '{links}', coalesce((select jsonb_agg(case when l->>'url' = old_url then new_link else l end order by o)
        from jsonb_array_elements(item->'links') with ordinality x(l, o)), '[]'::jsonb));
    detail := jsonb_set(detail, '{links}', coalesce((select jsonb_agg(case when l->>'url' = old_url then new_link else l end order by o)
        from jsonb_array_elements(detail->'links') with ordinality x(l, o)), '[]'::jsonb));
  else
    where_new := 'Not recorded';
    item := jsonb_set(item, '{links}', coalesce((select jsonb_agg(l order by o) from jsonb_array_elements(item->'links') with ordinality x(l, o) where l->>'url' <> old_url), '[]'::jsonb));
    detail := jsonb_set(detail, '{links}', coalesce((select jsonb_agg(l order by o) from jsonb_array_elements(detail->'links') with ordinality x(l, o) where l->>'url' <> old_url), '[]'::jsonb));
  end if;
  if item->'cells'->>'where' = where_old then item := jsonb_set(item, '{cells,where}', to_jsonb(where_new)); end if;
  select coalesce(jsonb_agg(case
      when f->>0 = 'In this library' and f->>1 = where_old then jsonb_build_array('In this library', where_new)
      when f->>0 = 'Match to the saved text' then jsonb_build_array('Match to the official text', f->1)
      else f end order by o), '[]'::jsonb) into facts
    from jsonb_array_elements(coalesce(detail->'facts', '[]'::jsonb)) with ordinality x(f, o)
   where p_ent is not null or f->>0 is distinct from 'Match to the saved text';
  if p_ent is null then
    why := case coalesce(p_reason, '') when 'granule_not_found' then 'The official govinfo page for this section was not available in the acquired edition'
      when 'identity_mismatch' then 'The official govinfo page did not carry the expected section identity' else 'The official text was not returned' end;
    facts := facts || jsonb_build_array(jsonb_build_array('Official U.S. Code text', 'Not recorded'), jsonb_build_array('Why the official text is not recorded', why));
  end if;
  detail := jsonb_set(detail, '{facts}', facts);
  txt := replace(replace(txt, 'In this library ' || where_old, 'In this library ' || where_new), 'Match to the saved text', 'Match to the official text');
  return jsonb_build_object('item', item, 'detail', detail, 'filters', p_row->'filters', 'text', txt);
end $$;

create or replace function public.corpus_uscode_text_intake_v1(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform corpus_ingest.uscode_text_run_v1(p_run);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text) > 8388608 then
    raise exception 'Expected 1..500 records within 8 MiB' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where
      x->>'source_system' is distinct from 'uscode' or x->>'entity_type' is distinct from 'section-text'
      or x->>'schema_version' is distinct from 'uscode-section-text/1'
      or jsonb_typeof(x->'data') is distinct from 'object' or jsonb_typeof(x->'provenance') is distinct from 'object'
      or coalesce(x->>'native_id', '') !~ '^title-[0-9]+/section-[^/]+$'
      or x->>'native_id' is distinct from 'title-' || (x->'data'->>'title_number') || '/section-' || (x->'data'->>'section_number')
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(x->'data') is distinct from x->'provenance'->>'record_sha256'
      or encode(sha256(convert_to(coalesce(x->'data'->>'text', ''), 'UTF8')), 'hex') is distinct from x->'data'->>'text_sha256'
      or coalesce(x->'provenance'->>'source_url', '') !~ '^https://www\.govinfo\.gov/content/pkg/USCODE-[0-9]{4}-title[0-9]+/html/USCODE-[0-9]{4}-title[0-9]+-[A-Za-z0-9-]+\.htm$'
      or coalesce(x->'provenance'->>'source_sha256', '') !~ '^[0-9a-f]{64}$'
      or x->'provenance'->>'source_sha256' is distinct from x->'data'->>'raw_response_sha256'
      or coalesce(x->'data'->>'current_through', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or x->'provenance'->>'source_as_of' is distinct from x->'data'->>'current_through'
      or x->'provenance'->'http_status' is distinct from '200'::jsonb
      or coalesce(x->'provenance'->>'retrieved_at', '') = ''
      or x->'provenance'->>'route' not in ('direct', 'firecrawl')
      or (x->'data'->>'proxied_fetch')::boolean is distinct from (x->'provenance'->>'route' = 'firecrawl')
      or coalesce(x->'provenance'->>'raw_object_key', '') !~ '^uscode-text/sha256/[0-9a-f]{2}/[0-9a-f]{64}\.htm$'
      or x->'provenance'->>'raw_object_key' is distinct from 'uscode-text/sha256/' || left(x->'provenance'->>'source_sha256', 2) || '/' || (x->'provenance'->>'source_sha256') || '.htm') then
    raise exception 'Invalid U.S. Code section-text identity, hash, schema or retrieval provenance' using errcode = '22023';
  end if;
  result := corpus_ingest.ingest_entities(p_run, p_rows);
  return result;
end $$;

create or replace function public.corpus_uscode_text_plan_v1(p_run uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it jsonb; r public.corpus_records; oulset text[]; planned bigint := 0; rejected jsonb := '[]'::jsonb; n bigint;
begin
  perform corpus_ingest.uscode_text_run_v1(p_run);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 2000 then
    raise exception 'Expected 1..2000 plan items' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into r from public.corpus_records where dataset = 'citation_index' and id = it->>'record_id' and it->>'dataset' = 'citation_index';
    if not found then rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'row_missing')); continue; end if;
    select coalesce(array_agg(distinct m[1] order by m[1]), '{}') into oulset
      from regexp_matches(coalesce(r.item::text, '') || coalesce(r.detail::text, '') || coalesce(r.filters::text, '') || coalesce(r.text, ''), '(oul:[0-9a-f]{64})', 'g') m;
    if cardinality(oulset) <> 1 or oulset is distinct from (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(it->'oul_ids') x) then
      rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'oul_ids_differ_from_row_or_not_exactly_one')); continue;
    end if;
    if it->>'kind' is distinct from 'citation_row' then
      rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'kind_mismatch')); continue;
    end if;
    if it->>'native_id' is not null and not exists (select 1 from corpus_ingest.entities e where e.source_system = 'uscode'
        and e.entity_type = 'section-text' and e.native_id = it->>'native_id' and e.review_status <> 'quarantined') then
      rejected := rejected || jsonb_build_array(jsonb_build_object('record_id', it->>'record_id', 'why', 'official_entity_missing')); continue;
    end if;
    insert into corpus_ingest.uscode_text_plan_v1(run_id, kind, dataset, record_id, oul_ids, native_id, unavailable_reason, row_md5)
    values (p_run, 'citation_row', 'citation_index', it->>'record_id', oulset, it->>'native_id', it->>'unavailable_reason', md5(to_jsonb(r)::text))
    on conflict (run_id, dataset, record_id) do nothing;
    get diagnostics n = row_count; planned := planned + n;
  end loop;
  return jsonb_build_object('planned', planned, 'rejected', rejected);
end $$;

create or replace function public.corpus_uscode_text_status_v1(p_run uuid, p_after text default null, p_limit integer default 2000)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare page record;
begin
  perform corpus_ingest.uscode_text_run_v1(p_run, false);
  if p_limit not between 1 and 5000 then raise exception 'Invalid page size' using errcode = '22023'; end if;
  with v as (select * from corpus_ingest.entity_versions
              where source_system = 'uscode' and entity_type = 'section-text' and first_run = p_run
                and (p_after is null or native_id collate "C" > p_after collate "C")
              order by native_id collate "C" limit p_limit)
  select count(*) n, max(native_id collate "C") last_id,
         count(*) filter (where corpus_ingest.canonical_integer_jsonb_sha256_v1(data) is distinct from payload_sha256) hash_mismatches,
         count(*) filter (where encode(sha256(convert_to(data->>'text', 'UTF8')), 'hex') is distinct from data->>'text_sha256') text_hash_mismatches,
         count(*) filter (where storage_sha256 is distinct from encode(sha256(convert_to(data::text, 'UTF8')), 'hex')) storage_mismatches
    into page from v;
  return jsonb_build_object(
    'run_id', p_run,
    'entities', (select count(*) from corpus_ingest.entities where source_system = 'uscode' and entity_type = 'section-text'),
    'versions_first_seen_in_run', (select count(*) from corpus_ingest.entity_versions where source_system = 'uscode' and entity_type = 'section-text' and first_run = p_run),
    'observations', (select count(*) from corpus_ingest.observations where run_id = p_run and source_system = 'uscode' and entity_type = 'section-text'),
    'distinct_source_sha256', (select count(distinct source_sha256) from corpus_ingest.observations where run_id = p_run and source_system = 'uscode' and entity_type = 'section-text'),
    'as_of_dates', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb) from (select distinct source_as_of d from corpus_ingest.observations where run_id = p_run and entity_type = 'section-text') x),
    'relationships', (select count(*) from corpus_ingest.relationships where run_id = p_run and from_type = 'section-text'),
    'page', jsonb_build_object('after', p_after, 'rows', page.n, 'last', page.last_id, 'hash_mismatches', page.hash_mismatches,
      'text_hash_mismatches', page.text_hash_mismatches, 'storage_mismatches', page.storage_mismatches));
end $$;

create or replace function public.corpus_uscode_text_readback_v1(p_run uuid, p_native_ids jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform corpus_ingest.uscode_text_run_v1(p_run, false);
  if jsonb_typeof(p_native_ids) is distinct from 'array' or jsonb_array_length(p_native_ids) not between 1 and 2000 then
    raise exception 'Expected 1..2000 native ids' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('native_id', e.native_id, 'payload_sha256', e.payload_sha256,
      'schema_version', e.schema_version, 'source_sha256', o.source_sha256, 'source_as_of', o.source_as_of,
      'retrieved_at', o.retrieved_at, 'source_url', o.source_url, 'text_sha256', e.data->>'text_sha256',
      'review_status', e.review_status) order by e.native_id collate "C")
    from jsonb_array_elements_text(p_native_ids) n
    join corpus_ingest.entities e on e.source_system = 'uscode' and e.entity_type = 'section-text' and e.native_id = n
    join corpus_ingest.observations o on (o.run_id, o.source_system, o.entity_type, o.native_id, o.payload_sha256) = (p_run, e.source_system, e.entity_type, e.native_id, e.payload_sha256)), '[]'::jsonb);
end $$;

create or replace function public.corpus_uscode_text_publish_v1(p_run uuid, p_limit integer default 1000, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare written bigint := 0; pending bigint; base bigint;
begin
  perform corpus_ingest.uscode_text_run_v1(p_run);
  if p_limit not between 1 and 2000 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  if not exists (select 1 from public.corpus_datasets d where d.id = 'uscode_section_text' and not d.ready) then
    raise exception 'Dataset uscode_section_text must be registered and not yet ready' using errcode = '22023';
  end if;
  select count(*) into pending from corpus_ingest.entities e
   where e.source_system = 'uscode' and e.entity_type = 'section-text' and e.review_status <> 'quarantined'
     and not exists (select 1 from public.corpus_records r where r.dataset = 'uscode_section_text' and r.id = 'uscode:section-text:' || e.native_id);
  if p_dry then return jsonb_build_object('dry', true, 'pending', pending); end if;
  select coalesce(max(ordinal), 0) into base from public.corpus_records where dataset = 'uscode_section_text';
  with batch as (
    select e.native_id, e.data, e.retrieved_at, e.provenance->>'source_url' source_url,
           row_number() over (order by e.native_id collate "C") rn
      from corpus_ingest.entities e
     where e.source_system = 'uscode' and e.entity_type = 'section-text' and e.review_status <> 'quarantined'
       and not exists (select 1 from public.corpus_records r where r.dataset = 'uscode_section_text' and r.id = 'uscode:section-text:' || e.native_id)
     order by e.native_id collate "C" limit p_limit),
  built as (
    select b.rn, b.native_id,
           corpus_ingest.uscode_text_record_v1(b.native_id, b.data, b.retrieved_at, b.source_url) j
      from batch b)
  insert into public.corpus_records(dataset, id, category, state, county_geoids, title, source_url, ordinal, item, detail, text, filters)
  select 'uscode_section_text', j->>'id', j->>'category', j->>'state', '{}'::text[], j->>'title', j->>'source_url', base + rn,
         j->'item', j->'detail', j->>'text', j->'filters'
    from built
  on conflict (dataset, id) do nothing;
  get diagnostics written = row_count;
  return jsonb_build_object('dry', false, 'written', written, 'pending_before', pending);
end $$;

create or replace function public.corpus_uscode_text_verify_v1(p_run uuid, p_after text default null, p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n bigint; miss bigint; mism bigint; first_id text; last_id text;
begin
  perform corpus_ingest.uscode_text_run_v1(p_run);
  if p_limit not between 1 and 2000 then raise exception 'Invalid page size' using errcode = '22023'; end if;
  with page as (
    select e.native_id, e.data, e.retrieved_at, e.provenance->>'source_url' source_url
      from corpus_ingest.entities e
     where e.source_system = 'uscode' and e.entity_type = 'section-text' and e.review_status <> 'quarantined'
       and (p_after is null or e.native_id collate "C" > p_after collate "C")
     order by e.native_id collate "C" limit p_limit),
  exp as (
    select p.native_id, corpus_ingest.uscode_text_record_v1(p.native_id, p.data, p.retrieved_at, p.source_url) j
      from page p)
  select count(*), min(x.native_id collate "C"), max(x.native_id collate "C"),
         count(*) filter (where r.id is null),
         count(*) filter (where r.id is not null and (
           r.category is distinct from x.j->>'category' or r.state is distinct from x.j->>'state' or r.title is distinct from x.j->>'title'
           or r.source_url is distinct from x.j->>'source_url' or r.text is distinct from x.j->>'text'
           or r.item is distinct from x.j->'item' or r.detail is distinct from x.j->'detail' or r.filters is distinct from x.j->'filters'))
    into n, first_id, last_id, miss, mism
    from exp x left join public.corpus_records r on r.dataset = 'uscode_section_text' and r.id = x.j->>'id';
  if n > 0 then
    insert into corpus_ingest.uscode_text_verify_v1(run_id, first_native, last_native, entities, missing, mismatched)
    values (p_run, first_id, last_id, n, miss, mism)
    on conflict (run_id, first_native, last_native) do update set entities = excluded.entities, missing = excluded.missing,
      mismatched = excluded.mismatched, verified_at = now();
  end if;
  return jsonb_build_object('entities', n, 'last', last_id, 'missing', miss, 'mismatched', mism);
end $$;

create or replace function public.corpus_uscode_text_finalize_v1(p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare expected bigint; actual bigint; uncovered bigint; bad bigint; ok boolean; facets jsonb;
begin
  perform corpus_ingest.uscode_text_run_v1(p_run);
  select count(*) into expected from corpus_ingest.entities e where e.source_system = 'uscode' and e.entity_type = 'section-text' and e.review_status <> 'quarantined';
  select count(*) into actual from public.corpus_records where dataset = 'uscode_section_text';
  select count(*) into uncovered from corpus_ingest.entities e
   where e.source_system = 'uscode' and e.entity_type = 'section-text' and e.review_status <> 'quarantined'
     and not exists (select 1 from corpus_ingest.uscode_text_verify_v1 v where v.run_id = p_run and v.missing = 0 and v.mismatched = 0
                      and e.native_id collate "C" >= v.first_native collate "C" and e.native_id collate "C" <= v.last_native collate "C");
  select count(*) into bad from corpus_ingest.uscode_text_verify_v1 v where v.run_id = p_run and (v.missing <> 0 or v.mismatched <> 0);
  ok := expected > 0 and expected = actual and uncovered = 0 and bad = 0;
  select jsonb_agg(jsonb_build_object('value', t, 'label', 'Title ' || t, 'count', c) order by t::int) into facets
    from (select filters->>'title_number' t, count(*) c from public.corpus_records where dataset = 'uscode_section_text' group by 1) f;
  if ok then
    update public.corpus_datasets d set ready = true, expected_records = expected, imported_records = actual, updated_at = now(),
      metadata = d.metadata || jsonb_build_object('projection_run_id', p_run,
        'listing', jsonb_build_object(
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'title_number', 'label', 'U.S.C. title'), jsonb_build_object('key', 'section_number', 'label', 'Section'),
            jsonb_build_object('key', 'edition', 'label', 'Edition'), jsonb_build_object('key', 'current_through', 'label', 'Current through'),
            jsonb_build_object('key', 'repealed', 'label', 'Repealed or transferred')),
          'filters', jsonb_build_array(jsonb_build_object('name', 'title_number', 'type', 'select', 'label', 'U.S.C. title', 'options', facets))))
     where d.id = 'uscode_section_text';
  else
    update public.corpus_datasets set expected_records = expected, imported_records = actual, updated_at = now() where id = 'uscode_section_text';
  end if;
  return jsonb_build_object('verified', ok, 'expected', expected, 'actual', actual, 'entities_without_clean_verification', uncovered, 'pages_with_problems', bad);
end $$;

create or replace function public.corpus_uscode_text_apply_v1(p_run uuid, p_limit integer default 500, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl record; r public.corpus_records; ent_data jsonb; ent_ret timestamptz; nv jsonb; applied bigint := 0; skipped bigint := 0; would bigint := 0; after_md5 text; note text;
begin
  perform corpus_ingest.uscode_text_run_v1(p_run);
  if p_limit not between 1 and 1000 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  if not p_dry and not exists (select 1 from public.corpus_datasets d where d.id = 'uscode_section_text' and d.ready) then
    raise exception 'uscode_section_text must be published and verified before links are repointed' using errcode = '22023';
  end if;
  for pl in select * from corpus_ingest.uscode_text_plan_v1 where run_id = p_run and status = 'planned' order by seq limit p_limit loop
    note := null; ent_data := null; ent_ret := null;
    select * into r from public.corpus_records where dataset = pl.dataset and id = pl.record_id for update;
    if not found then note := 'row missing';
    elsif md5(to_jsonb(r)::text) <> pl.row_md5 then note := 'row changed since plan';
    end if;
    if note is null and pl.native_id is not null then
      select e.data, e.retrieved_at into ent_data, ent_ret from corpus_ingest.entities e
       where e.source_system = 'uscode' and e.entity_type = 'section-text' and e.native_id = pl.native_id and e.review_status <> 'quarantined';
      if not found then note := 'official entity missing';
      elsif not exists (select 1 from public.corpus_records t where t.dataset = 'uscode_section_text' and t.id = 'uscode:section-text:' || pl.native_id) then
        note := 'official record not projected';
      end if;
    end if;
    if note is not null then
      skipped := skipped + 1;
      if not p_dry then update corpus_ingest.uscode_text_plan_v1 set status = 'skipped', status_note = note where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id; end if;
      continue;
    end if;
    nv := corpus_ingest.uscode_text_citation_row_v1(to_jsonb(r), pl.oul_ids[1], pl.native_id, ent_data, pl.unavailable_reason);
    if p_dry then would := would + 1; continue; end if;
    update public.corpus_records set item = nv->'item', detail = nv->'detail', filters = nv->'filters', text = nv->>'text'
     where dataset = pl.dataset and id = pl.record_id;
    select md5(to_jsonb(x)::text) into after_md5 from public.corpus_records x where x.dataset = pl.dataset and x.id = pl.record_id;
    insert into corpus_ingest.uscode_text_ledger_v1(run_id, dataset, record_id, original_record, original_row_md5, applied_md5, replacement)
    values (p_run, pl.dataset, pl.record_id, to_jsonb(r) - 'search_vector', pl.row_md5, after_md5, nv);
    update corpus_ingest.uscode_text_plan_v1 set status = 'applied', new_md5 = after_md5, applied_at = now() where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id;
    applied := applied + 1;
  end loop;
  return jsonb_build_object('dry', p_dry, 'applied', applied, 'would_apply', would, 'skipped', skipped,
    'remaining_planned', (select count(*) from corpus_ingest.uscode_text_plan_v1 where run_id = p_run and status = 'planned'));
end $$;

create or replace function public.corpus_uscode_text_rollback_v1(p_run uuid, p_limit integer default 500, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl record; l corpus_ingest.uscode_text_ledger_v1; r public.corpus_records; restored bigint := 0; skipped bigint := 0; back_md5 text;
begin
  perform corpus_ingest.uscode_text_run_v1(p_run, false);
  if p_limit not between 1 and 1000 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  for pl in select * from corpus_ingest.uscode_text_plan_v1 where run_id = p_run and status = 'applied' order by seq limit p_limit loop
    select * into l from corpus_ingest.uscode_text_ledger_v1 where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id;
    select * into r from public.corpus_records where dataset = pl.dataset and id = pl.record_id for update;
    if not found or md5(to_jsonb(r)::text) <> l.applied_md5 then
      skipped := skipped + 1;
      if not p_dry then update corpus_ingest.uscode_text_plan_v1 set status_note = 'rollback skipped: row changed since apply' where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id; end if;
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
    update corpus_ingest.uscode_text_plan_v1 set status = 'reverted', reverted_at = now(), status_note = null where run_id = p_run and dataset = pl.dataset and record_id = pl.record_id;
    restored := restored + 1;
  end loop;
  return jsonb_build_object('dry', p_dry, 'restored', restored, 'skipped', skipped,
    'remaining_applied', (select count(*) from corpus_ingest.uscode_text_plan_v1 where run_id = p_run and status = 'applied'));
end $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.corpus_uscode_text_intake_v1(uuid,jsonb)', 'public.corpus_uscode_text_status_v1(uuid,text,integer)',
    'public.corpus_uscode_text_readback_v1(uuid,jsonb)', 'public.corpus_uscode_text_publish_v1(uuid,integer,boolean)',
    'public.corpus_uscode_text_verify_v1(uuid,text,integer)', 'public.corpus_uscode_text_finalize_v1(uuid)',
    'public.corpus_uscode_text_plan_v1(uuid,jsonb)', 'public.corpus_uscode_text_apply_v1(uuid,integer,boolean)',
    'public.corpus_uscode_text_rollback_v1(uuid,integer,boolean)',
    'corpus_ingest.uscode_text_run_v1(uuid,boolean)', 'corpus_ingest.uscode_text_record_v1(text,jsonb,timestamptz,text)',
    'corpus_ingest.uscode_text_citation_row_v1(jsonb,text,text,jsonb,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

comment on table corpus_ingest.uscode_text_ledger_v1 is 'Verbatim originals of every citation_index row repointed from an unverified Open US Law target to official U.S. Code text; used only by corpus_uscode_text_rollback_v1.';

commit;
