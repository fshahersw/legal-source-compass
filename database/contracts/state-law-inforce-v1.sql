-- state-law-inforce/1 — current, in-force official state statutory text as a browsable, searchable layer.
--
-- Model: scripts/state_law/MODEL.md (state-law/1). Builders: scripts/state_law/states/<xx>.py write edition.json,
-- nodes.jsonl.gz and sections.jsonl.gz from the official government publisher only (AGENTS.md 2026-10-19); the
-- loader scripts/state_law/load.py streams them into the loader RPCs below. Owners: STAT-A (this file), STAT-B reads.
--
-- Schema `state_law` (private; RLS on; service_role only):
--   editions           one acquisition of a publisher's compilation; lifecycle loading -> active -> superseded
--                      (or withdrawn). At most one active edition per state.
--   codes              code keys of an edition (FS, PEN, ILCS, GCJ …) with their citation template
--   citation_patterns  per-code full-match regexes over state_law.norm_cite_v1() output (mirrors lib.apply_patterns)
--   nodes              hierarchy tree (code › title › chapter …), direct and descendant section counts
--   sections           list-partitioned by state; generated tsvector (A: number + heading, B: first 250,000
--                      characters of text, english config); GIN per partition
-- Status values only come from the publisher's markers (MODEL.md §2); nothing here infers them.
--
-- App / CITE RPCs (public, SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to
-- service_role): state_law_states_v1, state_law_tree_v1, state_law_section_v1, state_law_search_v1,
-- state_law_resolve_v1 (signature agreed with CITE), state_law_retained_sources_v1 (retained-original manifests).
-- Loader RPCs (lead only): state_law_begin_edition_v1, state_law_load_nodes_v1, state_law_load_sections_v1,
-- state_law_activate_edition_v1, state_law_withdraw_edition_v1, state_law_purge_edition_v1.
--
-- Idempotent: create … if not exists / create or replace; no DROP statements. Apply once; re-applying is a no-op.
-- Tests: scripts/state_law/state-law-contract.test.mjs (pglite, synthetic rows). Verification SQL at the end.

begin;

create schema if not exists state_law;
revoke all on schema state_law from public, anon, authenticated;
grant usage on schema state_law to service_role;

-- ------------------------------------------------------------------------------------------------ normalisers
-- Mirrors of scripts/state_law/lib.py norm_number / norm_cite (same test vectors in both test suites).
create or replace function state_law.norm_number_v1(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select pg_catalog.rtrim(
           pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(
               pg_catalog.btrim(pg_catalog.lower(pg_catalog.translate(pg_catalog.normalize(coalesce(p, ''), 'NFKC'),
                 E'‐‑‒–—―−﹘﹣－', '----------'))),
               E'^(§+|sec(tion)?s?\\.?)\\s*', ''),
             E'\\s+', '', 'g'),
           '.')
$$;

create or replace function state_law.norm_cite_v1(p text) returns text[]
language plpgsql immutable parallel safe set search_path = '' as $$
declare v text; m text[]; pin text := null; prefix text;
begin
  v := pg_catalog.lower(pg_catalog.translate(pg_catalog.normalize(coalesce(p, ''), 'NFKC'),
         E'‐‑‒–—―−﹘﹣－', '----------'));
  v := pg_catalog.replace(v, '§§', '§');
  v := pg_catalog.regexp_replace(v, E'\\yet\\.?\\s+seq\\.?', ' ', 'g');
  v := pg_catalog.regexp_replace(v, E'\\y(sections|section|secs\\.|sec\\.|ss\\.)\\s*(?=[0-9])', '§ ', 'g');
  v := pg_catalog.regexp_replace(v, E'§\\s*', '§ ', 'g');
  v := pg_catalog.btrim(pg_catalog.regexp_replace(v, E'\\s+', ' ', 'g'));
  v := pg_catalog.regexp_replace(v, E'[\\s,;.]+$', '');
  m := pg_catalog.regexp_match(v, E'((?:\\s*\\((?:[0-9]{1,4}|[a-z]{1,4}|[ivxlc]{1,8})\\))+)\\s*$');
  if m is not null then
    prefix := pg_catalog.left(v, pg_catalog.length(v) - pg_catalog.length(m[1]));
    if pg_catalog.length(prefix) > 0 then
      pin := pg_catalog.regexp_replace(m[1], E'\\s+', '', 'g');
      v := pg_catalog.rtrim(prefix);
    end if;
  end if;
  v := pg_catalog.regexp_replace(v, E'[\\s,]*(subds?\\.|subdivisions?|subsecs?\\.|subsections?|paras?\\.|paragraphs?|cls?\\.|clauses?)$', '');
  return array[v, pin];
end $$;

-- ------------------------------------------------------------------------------------------------ tables
create table if not exists state_law.editions (
  edition_id text primary key check (edition_id ~ '^[a-z]{2}-[0-9]{8}(-[0-9]{1,3})?$'),
  state text not null check (state ~ '^[A-Z]{2}$'),
  lifecycle text not null default 'loading' check (lifecycle in ('loading', 'active', 'superseded', 'withdrawn')),
  code_name text not null,
  publisher text not null,
  publisher_url text not null check (publisher_url ~ '^https://'),
  official_source boolean not null,
  access text not null,
  edition_label text,
  currency_statement text,
  currency_source_url text,
  currency_through date,
  source_last_modified text,
  retrieved_from timestamptz not null,
  retrieved_to timestamptz not null,
  parser text not null,
  lib text not null,
  terms_note text,
  update_cadence text,
  expected jsonb not null,
  manifest jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  check (lower(state) = left(edition_id, 2))
);
create unique index if not exists state_law_editions_one_active on state_law.editions (state) where lifecycle = 'active';

create table if not exists state_law.codes (
  edition_id text not null references state_law.editions (edition_id),
  code text not null check (code ~ '^[A-Z0-9]{1,12}$'),
  name text not null,
  citation_template text not null,
  ordinal integer not null,
  primary key (edition_id, code)
);

create table if not exists state_law.citation_patterns (
  edition_id text not null,
  ord integer not null,
  code text not null,
  regex text not null,
  number_replacement text not null,
  primary key (edition_id, ord),
  foreign key (edition_id, code) references state_law.codes (edition_id, code)
);

create table if not exists state_law.nodes (
  edition_id text not null references state_law.editions (edition_id),
  node_id text not null,
  state text not null,
  code text not null,
  parent_id text,
  level text not null check (level in ('code', 'title', 'subtitle', 'division', 'subdivision', 'part', 'subpart',
    'chapter', 'subchapter', 'article', 'subarticle', 'act', 'appendix', 'other')),
  label text not null,
  number text,
  heading text,
  ordinal integer not null,
  depth integer not null,
  source_url text,
  direct_sections integer not null default 0,
  descendant_sections integer not null default 0,
  primary key (edition_id, node_id)
);
create index if not exists state_law_nodes_parent on state_law.nodes (edition_id, parent_id, ordinal);

create table if not exists state_law.sections (
  state text not null check (state ~ '^[A-Z]{2}$'),
  edition_id text not null,
  section_id text not null,
  code text not null,
  number text not null,
  number_norm text not null,
  version text,
  version_index integer,
  citation text not null,
  heading text,
  text text not null,
  history text,
  status text not null check (status in ('in_force', 'repealed', 'reserved', 'expired', 'renumbered', 'transferred',
    'future_effective', 'not_recorded')),
  status_basis text not null check (status_basis in ('publisher_marker', 'current_compilation', 'not_recorded')),
  status_marker text,
  effective_start date,
  effective_end date,
  effective_note text,
  node_id text not null,
  path jsonb not null,
  ordinal integer not null,
  source_url text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_method text not null check (source_method in ('publisher_page', 'publisher_bulk', 'publisher_api', 'retained_original')),
  source_member text,
  retrieved_at timestamptz not null,
  text_sha256 text not null check (text_sha256 ~ '^[a-f0-9]{64}$'),
  parser text not null,
  tsv tsvector generated always as (
    pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.english'::pg_catalog.regconfig,
      coalesce(number, '') || ' ' || coalesce(heading, '')), 'A') ||
    pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.english'::pg_catalog.regconfig,
      pg_catalog.left("text", 250000)), 'B')) stored,
  primary key (state, edition_id, section_id)
) partition by list (state);

do $$
declare s text;
begin
  foreach s in array array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY',
    'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'] loop
    execute pg_catalog.format('create table if not exists state_law.%I partition of state_law.sections for values in (%L)',
      'sections_' || pg_catalog.lower(s), s);
  end loop;
end $$;

create index if not exists state_law_sections_node on state_law.sections (edition_id, node_id, ordinal);
create index if not exists state_law_sections_number on state_law.sections (edition_id, code, number_norm);
create index if not exists state_law_sections_ordinal on state_law.sections (edition_id, ordinal);
create index if not exists state_law_sections_tsv on state_law.sections using gin (tsv);

alter table state_law.editions enable row level security;
alter table state_law.codes enable row level security;
alter table state_law.citation_patterns enable row level security;
alter table state_law.nodes enable row level security;
alter table state_law.sections enable row level security;
revoke all on all tables in schema state_law from public, anon, authenticated;
grant select on all tables in schema state_law to service_role;
revoke all on all functions in schema state_law from public, anon, authenticated;
grant execute on all functions in schema state_law to service_role;

-- ------------------------------------------------------------------------------------------------ private helpers
create or replace function state_law.active_edition_v1(p_state text) returns text
language sql stable set search_path = '' as $$
  select e.edition_id from state_law.editions e where e.state = upper(p_state) and e.lifecycle = 'active'
$$;

create or replace function state_law.edition_summary_v1(p_edition text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'edition_id', e.edition_id, 'state', e.state, 'code_name', e.code_name, 'publisher', e.publisher,
    'publisher_url', e.publisher_url, 'official_source', e.official_source, 'edition_label', e.edition_label,
    'currency_statement', e.currency_statement, 'currency_source_url', e.currency_source_url,
    'currency_through', e.currency_through, 'source_last_modified', e.source_last_modified,
    'retrieved_from', e.retrieved_from, 'retrieved_to', e.retrieved_to, 'activated_at', e.activated_at,
    'sections', (e.expected->>'sections')::bigint, 'by_status', e.expected->'by_status',
    'update_cadence', e.update_cadence, 'terms_note', e.terms_note, 'source_mode', e.manifest->>'source_mode',
    'codes', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name,
      'citation_template', c.citation_template) order by c.ordinal) from state_law.codes c
      where c.edition_id = e.edition_id), '[]'::jsonb))
  from state_law.editions e where e.edition_id = p_edition
$$;

create or replace function state_law.section_brief_v1(p_section_id text, p_code text, p_number text, p_citation text,
  p_heading text, p_status text, p_version text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('section_id', p_section_id, 'code', p_code, 'number', p_number, 'citation', p_citation,
    'heading', p_heading, 'status', p_status, 'version', p_version)
$$;

-- every node id that contains the given node id, root first (node ids are path-shaped: STATE:CODE/level:n/level:n)
create or replace function state_law.ancestor_ids_v1(p_node text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(pg_catalog.array_to_string(parts[1:i], '/') order by i), '{}')
  from (select pg_catalog.string_to_array(p_node, '/') parts) x, generate_series(1, cardinality(x.parts)) i
$$;

-- ------------------------------------------------------------------------------------------------ loader RPCs
create or replace function public.state_law_begin_edition_v1(p_edition jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e jsonb := p_edition; c jsonb; pt jsonb; prior record; ord_c integer := 0; ord_p integer := 0; probe boolean;
begin
  if jsonb_typeof(e) is distinct from 'object' or e->>'schema' is distinct from 'state-law-edition/1'
    or coalesce(e->>'edition_id', '') !~ '^[a-z]{2}-[0-9]{8}(-[0-9]{1,3})?$'
    or coalesce(e->>'state', '') !~ '^[A-Z]{2}$' or lower(e->>'state') <> left(e->>'edition_id', 2)
    or coalesce(e->>'publisher_url', '') !~ '^https://' or jsonb_typeof(e->'official_source') is distinct from 'boolean'
    or jsonb_typeof(e->'codes') is distinct from 'array' or jsonb_array_length(e->'codes') < 1
    or jsonb_typeof(e->'counts') is distinct from 'object' or coalesce(e->'counts'->>'sections', '') !~ '^[0-9]+$'
    or coalesce(e->'counts'->>'nodes', '') !~ '^[0-9]+$' or e->'sample' is distinct from 'null'::jsonb then
    raise exception 'state-law-edition/1 required (full run, not a sample)' using errcode = '22023';
  end if;
  if e->>'currency_through' is not null and (e->>'currency_through') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'currency_through must be a stated ISO date' using errcode = '22023';
  end if;
  select * into prior from state_law.editions where edition_id = e->>'edition_id';
  if found then
    if prior.manifest = e and prior.lifecycle = 'loading' then
      return jsonb_build_object('edition_id', prior.edition_id, 'replayed', true);
    end if;
    raise exception 'edition % already registered with a different manifest or lifecycle %', prior.edition_id, prior.lifecycle
      using errcode = '23505';
  end if;
  insert into state_law.editions (edition_id, state, code_name, publisher, publisher_url, official_source, access,
    edition_label, currency_statement, currency_source_url, currency_through, source_last_modified, retrieved_from,
    retrieved_to, parser, lib, terms_note, update_cadence, expected, manifest)
  values (e->>'edition_id', e->>'state', e->>'code_name', e->>'publisher', e->>'publisher_url',
    (e->>'official_source')::boolean, e->>'access', e->>'edition_label', e->>'currency_statement',
    e->>'currency_source_url', (e->>'currency_through')::date, e->>'source_last_modified',
    (e->>'retrieved_from')::timestamptz, (e->>'retrieved_to')::timestamptz, e->>'parser', e->>'lib',
    e->>'terms_note', e->>'update_cadence', e->'counts', e);
  for c in select value from jsonb_array_elements(e->'codes') loop
    insert into state_law.codes (edition_id, code, name, citation_template, ordinal)
      values (e->>'edition_id', c->>'code', c->>'name', c->>'citation_template', ord_c);
    ord_c := ord_c + 1;
    for pt in select value from jsonb_array_elements(coalesce(c->'patterns', '[]'::jsonb)) loop
      begin
        probe := '' ~ ('^(?:' || (pt->>'regex') || ')$');
      exception when invalid_regular_expression then
        raise exception 'citation pattern does not compile in PostgreSQL: %', pt->>'regex' using errcode = '22023';
      end;
      insert into state_law.citation_patterns (edition_id, ord, code, regex, number_replacement)
        values (e->>'edition_id', ord_p, c->>'code', pt->>'regex', pt->>'number');
      ord_p := ord_p + 1;
    end loop;
  end loop;
  return jsonb_build_object('edition_id', e->>'edition_id', 'replayed', false, 'codes', ord_c, 'patterns', ord_p);
end $$;

create or replace function public.state_law_load_nodes_v1(p_edition_id text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ed record; n integer;
begin
  select * into ed from state_law.editions where edition_id = p_edition_id;
  if not found or ed.lifecycle <> 'loading' then
    raise exception 'edition % is not loading', p_edition_id using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000
    or octet_length(p_rows::text) > 8388608 then
    raise exception 'bounded batch required (1..5000 rows, 8 MiB)' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r
             where r->>'schema' is distinct from 'state-law-node/1' or r->>'edition_id' is distinct from p_edition_id
               or r->>'state' is distinct from ed.state
               or not exists (select 1 from state_law.codes c where c.edition_id = p_edition_id and c.code = r->>'code')
               or coalesce(r->>'node_id', '') not like ed.state || ':' || (r->>'code') || '%'
               or (r->>'parent_id' is null) <> (r->>'level' = 'code')
               or coalesce(r->>'ordinal', '') !~ '^[0-9]+$') then
    raise exception 'invalid state-law-node/1 row in batch' using errcode = '22023';
  end if;
  insert into state_law.nodes (edition_id, node_id, state, code, parent_id, level, label, number, heading, ordinal,
    depth, source_url)
  select p_edition_id, r->>'node_id', r->>'state', r->>'code', r->>'parent_id', r->>'level', r->>'label', r->>'number',
    r->>'heading', (r->>'ordinal')::integer, cardinality(pg_catalog.string_to_array(r->>'node_id', '/')) - 1, r->>'source_url'
  from jsonb_array_elements(p_rows) r
  on conflict (edition_id, node_id) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('inserted', n, 'rows', jsonb_array_length(p_rows));
end $$;

create or replace function public.state_law_load_sections_v1(p_edition_id text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ed record; n integer; bad text;
begin
  select * into ed from state_law.editions where edition_id = p_edition_id;
  if not found or ed.lifecycle <> 'loading' then
    raise exception 'edition % is not loading', p_edition_id using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500
    or octet_length(p_rows::text) > 8388608 then
    raise exception 'bounded batch required (1..500 rows, 8 MiB)' using errcode = '22023';
  end if;
  select r->>'section_id' into bad from jsonb_array_elements(p_rows) r
  where r->>'schema' is distinct from 'state-law-section/1' or r->>'edition_id' is distinct from p_edition_id
     or r->>'state' is distinct from ed.state
     or not exists (select 1 from state_law.codes c where c.edition_id = p_edition_id and c.code = r->>'code')
     or coalesce(r->>'section_id', '') not like ed.state || ':' || (r->>'code') || ':%'
     or jsonb_typeof(r->'text') is distinct from 'string'
     or encode(sha256(convert_to(r->>'text', 'UTF8')), 'hex') is distinct from r->>'text_sha256'
     or r->>'number_norm' is distinct from state_law.norm_number_v1(r->>'number')
     or coalesce(r->>'status', '') not in ('in_force', 'repealed', 'reserved', 'expired', 'renumbered', 'transferred',
          'future_effective', 'not_recorded')
     or (r->>'status' = 'in_force' and length(r->>'text') = 0)
     or (r->>'status_basis' = 'publisher_marker' and r->>'status_marker' is null)
     or jsonb_typeof(r->'path') is distinct from 'array' or jsonb_typeof(r->'source') is distinct from 'object'
     or coalesce(r->'source'->>'sha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(r->'source'->>'url', '') !~ '^https://'
     or coalesce(r->>'ordinal', '') !~ '^[0-9]+$'
  limit 1;
  if found then
    raise exception 'invalid state-law-section/1 row (%)', left(coalesce(bad, '?'), 120) using errcode = '22023';
  end if;
  insert into state_law.sections (state, edition_id, section_id, code, number, number_norm, version, version_index,
    citation, heading, text, history, status, status_basis, status_marker, effective_start, effective_end,
    effective_note, node_id, path, ordinal, source_url, source_sha256, source_method, source_member, retrieved_at,
    text_sha256, parser)
  select ed.state, p_edition_id, r->>'section_id', r->>'code', r->>'number', r->>'number_norm', r->>'version',
    case when (r->>'section_id') ~ '@[0-9]+$' then (pg_catalog.substring(r->>'section_id', '@([0-9]+)$'))::integer end,
    r->>'citation', r->>'heading', r->>'text', r->>'history', r->>'status', r->>'status_basis', r->>'status_marker',
    (r->'effective'->>'start')::date, (r->'effective'->>'end')::date, r->'effective'->>'note', r->>'node_id', r->'path',
    (r->>'ordinal')::integer, r->'source'->>'url', r->'source'->>'sha256', r->'source'->>'method',
    r->'source'->>'member', (r->'source'->>'retrieved_at')::timestamptz, r->>'text_sha256', r->>'parser'
  from jsonb_array_elements(p_rows) r
  on conflict (state, edition_id, section_id) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('inserted', n, 'rows', jsonb_array_length(p_rows));
end $$;

-- Checks counts and references, computes node section counts, flips the state's active edition.
create or replace function public.state_law_activate_edition_v1(p_edition_id text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ed record; got_sections bigint; got_nodes bigint; orphan_sections bigint; orphan_nodes bigint; dup_ord bigint;
        prior text;
begin
  select * into ed from state_law.editions where edition_id = p_edition_id for update;
  if not found or ed.lifecycle <> 'loading' then
    raise exception 'edition % is not loading', p_edition_id using errcode = '22023';
  end if;
  select count(*) into got_sections from state_law.sections where state = ed.state and edition_id = p_edition_id;
  select count(*) into got_nodes from state_law.nodes where edition_id = p_edition_id;
  if got_sections <> (ed.expected->>'sections')::bigint or got_nodes <> (ed.expected->>'nodes')::bigint then
    raise exception 'counts differ from edition.json: sections %/% nodes %/%', got_sections, ed.expected->>'sections',
      got_nodes, ed.expected->>'nodes' using errcode = '22023';
  end if;
  select count(*) into orphan_sections from state_law.sections s
    where s.state = ed.state and s.edition_id = p_edition_id
      and not exists (select 1 from state_law.nodes n where n.edition_id = p_edition_id and n.node_id = s.node_id);
  select count(*) into orphan_nodes from state_law.nodes n
    where n.edition_id = p_edition_id and n.parent_id is not null
      and not exists (select 1 from state_law.nodes p where p.edition_id = p_edition_id and p.node_id = n.parent_id);
  select count(*) - count(distinct ordinal) into dup_ord from state_law.sections where state = ed.state and edition_id = p_edition_id;
  if orphan_sections > 0 or orphan_nodes > 0 or dup_ord > 0 then
    raise exception 'unresolved references: % sections without node, % nodes without parent, % duplicate ordinals',
      orphan_sections, orphan_nodes, dup_ord using errcode = '22023';
  end if;
  -- one joined update (correlated lookups into the CTEs were quadratic in the node count)
  with direct as (
    select node_id, count(*) n from state_law.sections where state = ed.state and edition_id = p_edition_id group by node_id
  ), deep as (
    select a.anc, sum(d.n) n from direct d cross join lateral unnest(state_law.ancestor_ids_v1(d.node_id)) a(anc) group by a.anc
  ), counts as (
    select n.node_id, coalesce(d.n, 0) direct_n, coalesce(p.n, 0) deep_n
    from state_law.nodes n left join direct d on d.node_id = n.node_id left join deep p on p.anc = n.node_id
    where n.edition_id = p_edition_id
  )
  update state_law.nodes x set direct_sections = c.direct_n, descendant_sections = c.deep_n
  from counts c where x.edition_id = p_edition_id and x.node_id = c.node_id;
  select edition_id into prior from state_law.editions where state = ed.state and lifecycle = 'active';
  update state_law.editions set lifecycle = 'superseded', superseded_at = now() where edition_id = prior;
  update state_law.editions set lifecycle = 'active', activated_at = now(), note = coalesce(p_note, note)
    where edition_id = p_edition_id;
  return jsonb_build_object('edition_id', p_edition_id, 'state', ed.state, 'sections', got_sections, 'nodes', got_nodes,
    'superseded', prior);
end $$;

create or replace function public.state_law_withdraw_edition_v1(p_edition_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ed record;
begin
  if coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into ed from state_law.editions where edition_id = p_edition_id for update;
  if not found or ed.lifecycle = 'withdrawn' then
    raise exception 'edition % not found or already withdrawn', p_edition_id using errcode = '22023';
  end if;
  update state_law.editions set lifecycle = 'withdrawn', superseded_at = now(),
    note = coalesce(note || E'\n', '') || 'withdrawn: ' || p_reason where edition_id = p_edition_id;
  return jsonb_build_object('edition_id', p_edition_id, 'was', ed.lifecycle);
end $$;

-- Counted, bounded removal of a superseded/withdrawn/abandoned-loading edition (call repeatedly until done).
create or replace function public.state_law_purge_edition_v1(p_edition_id text, p_limit integer default 5000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ed record; removed_sections bigint := 0; removed_nodes bigint := 0; remaining bigint;
begin
  select * into ed from state_law.editions where edition_id = p_edition_id;
  if not found then
    return jsonb_build_object('edition_id', p_edition_id, 'done', true, 'note', 'not present');
  end if;
  if ed.lifecycle = 'active' then
    raise exception 'refusing to purge the active edition %', p_edition_id using errcode = '22023';
  end if;
  with doomed as (
    select section_id from state_law.sections where state = ed.state and edition_id = p_edition_id
    limit greatest(1, least(p_limit, 20000))
  ), gone as (
    delete from state_law.sections s using doomed d
    where s.state = ed.state and s.edition_id = p_edition_id and s.section_id = d.section_id returning 1
  ) select count(*) into removed_sections from gone;
  select count(*) into remaining from state_law.sections where state = ed.state and edition_id = p_edition_id;
  if remaining = 0 then
    with doomed as (
      select node_id from state_law.nodes where edition_id = p_edition_id limit greatest(1, least(p_limit, 20000))
    ), gone as (
      delete from state_law.nodes n using doomed d where n.edition_id = p_edition_id and n.node_id = d.node_id returning 1
    ) select count(*) into removed_nodes from gone;
    select count(*) into remaining from state_law.nodes where edition_id = p_edition_id;
    if remaining = 0 then
      with gone as (delete from state_law.citation_patterns where edition_id = p_edition_id returning 1)
      select count(*) into remaining from gone;
      with gone as (delete from state_law.codes where edition_id = p_edition_id returning 1)
      select count(*) into remaining from gone;
      with gone as (delete from state_law.editions where edition_id = p_edition_id returning 1)
      select count(*) into remaining from gone;
      return jsonb_build_object('edition_id', p_edition_id, 'removed_sections', removed_sections,
        'removed_nodes', removed_nodes, 'done', true);
    end if;
  end if;
  return jsonb_build_object('edition_id', p_edition_id, 'removed_sections', removed_sections,
    'removed_nodes', removed_nodes, 'done', false);
end $$;

-- ------------------------------------------------------------------------------------------------ read RPCs
create or replace function public.state_law_states_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(state_law.edition_summary_v1(e.edition_id) order by e.state), '[]'::jsonb)
  from state_law.editions e where e.lifecycle = 'active'
$$;

create or replace function public.state_law_tree_v1(p_state text, p_node_id text default null,
  p_limit integer default 500, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ed text; node jsonb; crumbs jsonb; children jsonb; sections jsonb; total bigint; lim integer; off integer;
begin
  ed := state_law.active_edition_v1(p_state);
  if ed is null then
    return jsonb_build_object('available', false, 'reason', 'no_edition');
  end if;
  lim := greatest(1, least(coalesce(p_limit, 500), 2000));
  off := greatest(0, coalesce(p_offset, 0));
  if p_node_id is null then
    select coalesce(jsonb_agg(jsonb_build_object('node_id', n.node_id, 'level', n.level, 'label', n.label,
      'number', n.number, 'heading', n.heading, 'sections', n.descendant_sections) order by n.ordinal), '[]'::jsonb)
      into children from state_law.nodes n where n.edition_id = ed and n.parent_id is null;
    return jsonb_build_object('available', true, 'edition', state_law.edition_summary_v1(ed), 'node', null,
      'breadcrumb', '[]'::jsonb, 'children', children, 'sections', '[]'::jsonb, 'total_sections', 0);
  end if;
  select jsonb_build_object('node_id', n.node_id, 'level', n.level, 'label', n.label, 'number', n.number,
    'heading', n.heading, 'sections', n.descendant_sections, 'source_url', n.source_url)
    into node from state_law.nodes n where n.edition_id = ed and n.node_id = p_node_id;
  if node is null then
    return jsonb_build_object('available', false, 'reason', 'unknown_node');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('node_id', n.node_id, 'level', n.level, 'label', n.label,
    'number', n.number, 'heading', n.heading) order by n.depth), '[]'::jsonb)
    into crumbs from state_law.nodes n
    where n.edition_id = ed and n.node_id = any (state_law.ancestor_ids_v1(p_node_id)) and n.node_id <> p_node_id;
  select coalesce(jsonb_agg(jsonb_build_object('node_id', n.node_id, 'level', n.level, 'label', n.label,
    'number', n.number, 'heading', n.heading, 'sections', n.descendant_sections) order by n.ordinal), '[]'::jsonb)
    into children from state_law.nodes n where n.edition_id = ed and n.parent_id = p_node_id;
  select count(*) into total from state_law.sections s
    where s.state = upper(p_state) and s.edition_id = ed and s.node_id = p_node_id;
  select coalesce(jsonb_agg(state_law.section_brief_v1(x.section_id, x.code, x.number, x.citation, x.heading, x.status, x.version) order by x.ordinal), '[]'::jsonb) into sections
    from (select s.* from state_law.sections s where s.state = upper(p_state) and s.edition_id = ed
            and s.node_id = p_node_id order by s.ordinal limit lim offset off) x;
  return jsonb_build_object('available', true, 'edition', state_law.edition_summary_v1(ed), 'node', node,
    'breadcrumb', crumbs, 'children', children, 'sections', sections, 'total_sections', total,
    'offset', off, 'truncated', off + lim < total);
end $$;

create or replace function public.state_law_section_v1(p_state text, p_section_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ed text; s state_law.sections; crumbs jsonb; prev jsonb; nxt jsonb; versions jsonb;
begin
  ed := state_law.active_edition_v1(p_state);
  if ed is null then
    return jsonb_build_object('available', false, 'reason', 'no_edition');
  end if;
  select * into s from state_law.sections x where x.state = upper(p_state) and x.edition_id = ed and x.section_id = p_section_id;
  if not found then
    return jsonb_build_object('available', false, 'reason', 'unknown_section', 'edition', state_law.edition_summary_v1(ed));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('node_id', n.node_id, 'level', n.level, 'label', n.label,
    'number', n.number, 'heading', n.heading) order by n.depth), '[]'::jsonb)
    into crumbs from state_law.nodes n where n.edition_id = ed and n.node_id = any (state_law.ancestor_ids_v1(s.node_id));
  select state_law.section_brief_v1(x.section_id, x.code, x.number, x.citation, x.heading, x.status, x.version) into prev from state_law.sections x
    where x.state = s.state and x.edition_id = ed and x.ordinal < s.ordinal order by x.ordinal desc limit 1;
  select state_law.section_brief_v1(x.section_id, x.code, x.number, x.citation, x.heading, x.status, x.version) into nxt from state_law.sections x
    where x.state = s.state and x.edition_id = ed and x.ordinal > s.ordinal order by x.ordinal limit 1;
  select coalesce(jsonb_agg(state_law.section_brief_v1(x.section_id, x.code, x.number, x.citation, x.heading, x.status, x.version) order by x.ordinal), '[]'::jsonb) into versions
    from state_law.sections x where x.state = s.state and x.edition_id = ed and x.code = s.code
      and x.number_norm = s.number_norm and x.section_id <> s.section_id;
  return jsonb_build_object('available', true, 'edition', state_law.edition_summary_v1(ed),
    'section', jsonb_build_object('section_id', s.section_id, 'code', s.code, 'number', s.number,
      'citation', s.citation, 'heading', s.heading, 'text', s.text, 'history', s.history, 'status', s.status,
      'status_basis', s.status_basis, 'status_marker', s.status_marker, 'version', s.version,
      'effective', jsonb_build_object('start', s.effective_start, 'end', s.effective_end, 'note', s.effective_note),
      'node_id', s.node_id, 'path', s.path, 'source', jsonb_build_object('url', s.source_url, 'sha256', s.source_sha256,
        'method', s.source_method, 'member', s.source_member, 'retrieved_at', s.retrieved_at),
      'text_sha256', s.text_sha256, 'parser', s.parser),
    'breadcrumb', crumbs, 'prev', prev, 'next', nxt, 'other_versions', versions);
end $$;

-- Parses one citation and looks it up exactly in the state's active edition (MODEL.md §5). Never fuzzy.
create or replace function public.state_law_resolve_v1(p_state text, p_citation text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st text := upper(btrim(coalesce(p_state, ''))); ed text; nc text[]; norm text; pin text; pat record;
        hits jsonb := '[]'::jsonb; cand jsonb; parsed jsonb := '[]'::jsonb; num text; inforce jsonb; n_inforce integer;
        best jsonb; summary jsonb;
begin
  if st !~ '^[A-Z]{2}$' then
    return jsonb_build_object('state', st, 'input', p_citation, 'result', 'unknown_state', 'candidates', '[]'::jsonb);
  end if;
  ed := state_law.active_edition_v1(st);
  nc := state_law.norm_cite_v1(p_citation);
  norm := nc[1]; pin := nc[2];
  if ed is null then
    return jsonb_build_object('state', st, 'input', p_citation, 'normalized', norm, 'pinpoint', pin,
      'result', 'no_edition', 'candidates', '[]'::jsonb);
  end if;
  if length(coalesce(norm, '')) between 1 and 300 then
    for pat in select p.code, p.regex, p.number_replacement from state_law.citation_patterns p
               where p.edition_id = ed order by p.ord loop
      if norm ~ ('^(?:' || pat.regex || ')$') then
        num := state_law.norm_number_v1(pg_catalog.regexp_replace(norm, '^(?:' || pat.regex || ')$', pat.number_replacement));
        if not parsed @> jsonb_build_array(jsonb_build_object('code', pat.code, 'number_norm', num)) then
          parsed := parsed || jsonb_build_array(jsonb_build_object('code', pat.code, 'number_norm', num));
        end if;
      end if;
    end loop;
    if jsonb_array_length(parsed) = 0 and norm ~ '^(?:§\s?)?[0-9][0-9a-z.:/\-]*$' then
      num := state_law.norm_number_v1(norm);
      select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'number_norm', num) order by c.ordinal), '[]'::jsonb)
        into parsed from state_law.codes c where c.edition_id = ed;
    end if;
  end if;
  select coalesce(jsonb_agg(state_law.section_brief_v1(x.section_id, x.code, x.number, x.citation, x.heading, x.status, x.version) || jsonb_build_object('source_url', x.source_url)
           order by x.ordinal), '[]'::jsonb)
    into hits
    from state_law.sections x
    join jsonb_array_elements(parsed) q on q->>'code' = x.code and q->>'number_norm' = x.number_norm
    where x.state = st and x.edition_id = ed;
  summary := jsonb_build_object('state', st, 'input', p_citation, 'normalized', norm, 'pinpoint', pin,
    'edition_id', ed, 'currency_statement', (select e.currency_statement from state_law.editions e where e.edition_id = ed));
  if jsonb_array_length(hits) = 0 then
    return summary || jsonb_build_object('result', 'unresolved', 'parsed', parsed, 'candidates', '[]'::jsonb);
  end if;
  select count(*) into n_inforce from jsonb_array_elements(hits) h where h->>'status' = 'in_force';
  if jsonb_array_length(hits) = 1 then
    best := hits->0;
  elsif n_inforce = 1 and (select count(distinct h->>'code') from jsonb_array_elements(hits) h) = 1 then
    select h into best from jsonb_array_elements(hits) h where h->>'status' = 'in_force';
  end if;
  if best is null then
    return summary || jsonb_build_object('result', 'ambiguous', 'parsed', parsed, 'candidates', hits);
  end if;
  return summary || jsonb_build_object('result', 'resolved', 'section_id', best->>'section_id', 'code', best->>'code',
    'number', best->>'number', 'citation', best->>'citation', 'heading', best->>'heading', 'status', best->>'status',
    'source_url', best->>'source_url',
    'candidates', coalesce((select jsonb_agg(h) from jsonb_array_elements(hits) h
                            where h->>'section_id' <> best->>'section_id'), '[]'::jsonb));
end $$;

create or replace function public.state_law_search_v1(p_state text, p_q text, p_limit integer default 20,
  p_offset integer default 0, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st text := upper(btrim(coalesce(p_state, ''))); ed text; q tsquery; lim integer; off integer; total bigint;
        hits jsonb; exact jsonb;
begin
  ed := state_law.active_edition_v1(st);
  if ed is null then
    return jsonb_build_object('available', false, 'reason', 'no_edition');
  end if;
  if length(btrim(coalesce(p_q, ''))) < 2 or length(p_q) > 200 then
    return jsonb_build_object('available', true, 'total', 0, 'hits', '[]'::jsonb, 'exact', null);
  end if;
  if p_status is not null and p_status not in ('in_force', 'repealed', 'reserved', 'expired', 'renumbered',
      'transferred', 'future_effective', 'not_recorded') then
    raise exception 'unknown status filter' using errcode = '22023';
  end if;
  lim := greatest(1, least(coalesce(p_limit, 20), 50));
  off := greatest(0, least(coalesce(p_offset, 0), 1000));
  exact := public.state_law_resolve_v1(st, p_q);
  if exact->>'result' not in ('resolved', 'ambiguous') then
    exact := null;
  end if;
  q := pg_catalog.websearch_to_tsquery('pg_catalog.english'::pg_catalog.regconfig, p_q);
  if q is null or pg_catalog.numnode(q) = 0 then
    return jsonb_build_object('available', true, 'total', 0, 'hits', '[]'::jsonb, 'exact', exact);
  end if;
  select count(*) into total from (
    select 1 from state_law.sections s where s.state = st and s.edition_id = ed and s.tsv @@ q
      and (p_status is null or s.status = p_status) limit 10001) c;
  select coalesce(jsonb_agg(h order by (h->>'rank')::real desc, (h->>'ordinal')::integer), '[]'::jsonb) into hits from (
    select state_law.section_brief_v1(s.section_id, s.code, s.number, s.citation, s.heading, s.status, s.version) || jsonb_build_object('ordinal', s.ordinal,
      'rank', pg_catalog.ts_rank_cd(s.tsv, q),
      'snippet', pg_catalog.ts_headline('pg_catalog.english'::pg_catalog.regconfig, pg_catalog.left(s.text, 20000), q,
        'StartSel=⟦, StopSel=⟧, MaxWords=28, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "')) h
    from state_law.sections s
    where s.state = st and s.edition_id = ed and s.tsv @@ q and (p_status is null or s.status = p_status)
    order by pg_catalog.ts_rank_cd(s.tsv, q) desc, s.ordinal limit lim offset off) z;
  return jsonb_build_object('available', true, 'total', total, 'total_capped', total > 10000, 'hits', hits,
    'exact', exact, 'offset', off);
end $$;

-- Retained-original manifest for a re-parse without re-fetching the publisher (kind publisher_original only).
-- Pages by source_url; the builder downloads each object from private Storage and verifies its sha256.
create or replace function public.state_law_retained_sources_v1(p_jurisdiction text, p_after text default null,
  p_limit integer default 1000) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb;
begin
  if coalesce(p_jurisdiction, '') !~ '^[A-Z]{2}$' then
    raise exception 'jurisdiction required' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(r order by r->>'url', r->>'sha256'), '[]'::jsonb) into rows from (
    select jsonb_build_object('url', os.source_url, 'sha256', o.sha256, 'bytes', o.bytes, 'object_key', o.object_key,
      'retrieved_at', os.retrieved_at, 'method', os.retrieval_method) r
    from corpus_ingest.publisher_code_object_sources_v2 os
    join corpus_ingest.publisher_code_objects_v2 o on o.sha256 = os.sha256 and o.kind = 'publisher_original'
    where os.jurisdiction = p_jurisdiction and os.http_status = 200 and (p_after is null or os.source_url > p_after)
    order by os.source_url, o.sha256 limit greatest(1, least(coalesce(p_limit, 1000), 5000))) x;
  return jsonb_build_object('jurisdiction', p_jurisdiction, 'rows', rows, 'count', jsonb_array_length(rows));
end $$;

do $$
declare f text;
begin
  foreach f in array array['state_law_begin_edition_v1(jsonb)', 'state_law_load_nodes_v1(text, jsonb)',
    'state_law_load_sections_v1(text, jsonb)', 'state_law_activate_edition_v1(text, text)',
    'state_law_withdraw_edition_v1(text, text)', 'state_law_purge_edition_v1(text, integer)', 'state_law_states_v1()',
    'state_law_tree_v1(text, text, integer, integer)', 'state_law_section_v1(text, text)',
    'state_law_resolve_v1(text, text)', 'state_law_search_v1(text, text, integer, integer, text)',
    'state_law_retained_sources_v1(text, text, integer)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;
revoke all on all functions in schema state_law from public, anon, authenticated;
grant execute on all functions in schema state_law to service_role;

commit;

-- ------------------------------------------------------------------------------------------------ verification
-- select state, edition_id, lifecycle, expected->>'sections' sections, currency_statement from state_law.editions order by state, created_at;
-- select state, status, count(*) from state_law.sections s join state_law.editions e using (edition_id)
--   where e.lifecycle = 'active' group by 1, 2 order by 1, 2;
-- select public.state_law_resolve_v1('FL', 'Fla. Stat. § 95.11(3)(a)');   -- resolved, pinpoint (3)(a)
-- select public.state_law_resolve_v1('CA', 'Cal. Civ. Proc. Code § 335.1'); -- resolved
-- select public.state_law_resolve_v1('IL', '735 ILCS 5/13-202');            -- resolved
-- select public.state_law_resolve_v1('FL', 'Fla. Stat. § 9999.99');         -- unresolved (never a neighbour)
-- select public.state_law_search_v1('MA', 'statute of limitations tort', 5, 0, null);
-- select pg_size_pretty(pg_total_relation_size('state_law.sections_ca')), pg_size_pretty(pg_indexes_size('state_law.sections_ca'));
