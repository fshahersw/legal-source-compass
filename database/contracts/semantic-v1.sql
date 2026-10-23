-- semantic-v1 — semantic index over the legal text the corpus holds (retrieval and "related" suggestions only).
--
-- What it holds: one row per passage (chunk) of a statute section, regulation section, court opinion, report or bill, with the
-- passage's exact place in the source record (record id, chunk number, character offsets into the text the builder chunked, the
-- sha256 of that passage text), the record's title and in-app link, a short snippet, and a 1024-dimension embedding stored as
-- halfvec (16-bit floats). The text itself stays in corpus_records / the case-law reading store; nothing here is a source of
-- truth, and a semantic match is never a citation or an identity link (people, companies and courts are linked only on exact keys).
-- The embedding configuration is an opaque label (index_version); no served object names the model or its provider.
--
-- Datasets (see scripts/semantic/sources.py): us_code_sections, ecfr_sections_full, crs_reports, caselaw_scotus (record id =
-- case-law cluster id), congress_bills, oversight_reports, doj_oig_reports, ftc_publications_index. `composed` corpora embed a text
-- the builder composed from record fields (titles, summaries); their offsets index that composed text.
--
-- Every function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Idempotent (create if not exists / create or replace); a reload upserts by (dataset, record_id, chunk_no) and leaves an identical
-- row alone. The pgvector extension must be enabled by the project owner (PART 1). Run PART 3 (the HNSW index) after the load:
-- building it on an empty table and then loading every row is much slower than loading first.
--
-- Sizing (rows x about 2.6 KB of table + about 2.2 KB of HNSW index per 1024-dim halfvec): 100,000 passages ~ 0.5 GB in all.
-- Builders and loader: scripts/semantic/; offline test: scripts/semantic/semantic-sql.test.mjs.

-- ================================================================================================ PART 1: extension and schema
begin;

create extension if not exists vector with schema extensions;

create schema if not exists semantic;
revoke all on schema semantic from public, anon, authenticated;

create table if not exists semantic.corpora (
  dataset text primary key check (dataset ~ '^[a-z][a-z0-9_]{1,80}$'),
  label text not null,
  index_version text not null check (index_version ~ '^[a-z0-9_.-]{1,40}$'),
  composed boolean not null,
  records integer not null default 0 check (records >= 0),
  chunks integer not null default 0 check (chunks >= 0),
  capped_records integer not null default 0 check (capped_records >= 0),
  built_at timestamptz,
  source_digest text,
  loaded_at timestamptz not null default now()
);

create table if not exists semantic.chunks (
  dataset text not null references semantic.corpora (dataset) on delete cascade,
  record_id text not null check (length(record_id) between 1 and 300),
  chunk_no integer not null check (chunk_no >= 0),
  chunk_total integer not null check (chunk_total >= 1),          -- passages the record has in all (more than were kept when capped)
  char_start integer not null check (char_start >= 0),
  char_end integer not null,
  text_sha256 text not null check (text_sha256 ~ '^[a-f0-9]{64}$'),
  title text not null,
  href text not null check (href ~ '^/[^/]'),                      -- in-app link only
  source_url text check (source_url is null or source_url ~ '^https?://'),
  snippet text not null,
  embedding extensions.halfvec(1024) not null,
  primary key (dataset, record_id, chunk_no),
  check (char_end > char_start),
  check (chunk_no < chunk_total)
);

revoke all on all tables in schema semantic from public, anon, authenticated;
alter table semantic.corpora enable row level security;
alter table semantic.chunks enable row level security;

-- ================================================================================================ PART 2: read and load RPCs
-- Nearest passages of a query vector (helper of the two read RPCs; not granted to any API role). A filter that keeps few
-- passages (at most 25,000 of the datasets' recorded chunks) is answered exactly by a scan of those passages: the approximate
-- index would have to visit about p_n / (share of passages kept) entries, more than its scan bound allows for the smallest
-- datasets, and could return fewer neighbours than exist. Every other request uses the HNSW index with an iterative scan.
create or replace function semantic.nearest_v1(
  p_query extensions.halfvec, p_datasets text[], p_exclude_dataset text, p_exclude_record text, p_n integer
) returns table (
  dataset text, record_id text, chunk_no integer, chunk_total integer, char_start integer, char_end integer,
  title text, href text, source_url text, snippet text, distance float8
)
language plpgsql stable set search_path = '' set hnsw.iterative_scan = 'relaxed_order' set hnsw.ef_search = '100' set hnsw.max_scan_tuples = '100000' as $$
#variable_conflict use_column
begin
  if p_datasets is not null
     and (select coalesce(sum(k.chunks), 0) from semantic.corpora k where k.dataset = any (p_datasets)) <= 25000 then
    return query
      select c.dataset, c.record_id, c.chunk_no, c.chunk_total, c.char_start, c.char_end, c.title, c.href, c.source_url, c.snippet,
             (c.embedding operator(extensions.<=>) p_query)::float8
      from semantic.chunks c
      where c.dataset = any (p_datasets)
        and (p_exclude_record is null or not (c.dataset = p_exclude_dataset and c.record_id = p_exclude_record))
      -- "+ 0" keeps the planner off the index: an exact ordering of the filtered passages
      order by (c.embedding operator(extensions.<=>) p_query)::float8 + 0, c.dataset, c.record_id, c.chunk_no
      limit p_n;
  else
    return query
      select c.dataset, c.record_id, c.chunk_no, c.chunk_total, c.char_start, c.char_end, c.title, c.href, c.source_url, c.snippet,
             (c.embedding operator(extensions.<=>) p_query)::float8
      from semantic.chunks c
      where (p_datasets is null or c.dataset = any (p_datasets))
        and (p_exclude_record is null or not (c.dataset = p_exclude_dataset and c.record_id = p_exclude_record))
      order by c.embedding operator(extensions.<=>) p_query
      limit p_n;
  end if;
end $$;
revoke all on function semantic.nearest_v1(extensions.halfvec, text[], text, text, integer) from public, anon, authenticated;

-- Nearest passages of an embedded query, best passage per record. p_datasets null = every dataset; an empty list is refused.
create or replace function public.semantic_search_v1(
  p_embedding extensions.halfvec, p_datasets text[] default null, p_limit integer default 10
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50); v_out jsonb;
begin
  if p_embedding is null or extensions.vector_dims(p_embedding) <> 1024 then
    raise exception 'The query embedding must have 1024 dimensions' using errcode = '22023'; end if;
  if p_datasets is not null and cardinality(p_datasets) = 0 then
    raise exception 'Choose at least one dataset or pass null' using errcode = '22023'; end if;
  with cand as materialized (
    select * from semantic.nearest_v1(p_embedding, p_datasets, null, null, least(v_limit * 6, 300))
  ), best as (
    select distinct on (dataset, record_id) * from cand order by dataset, record_id, distance, chunk_no
  ), ranked as (
    select b.*, row_number() over (order by b.distance, b.dataset, b.record_id) as rank from best b order by b.distance, b.dataset, b.record_id limit v_limit
  )
  select jsonb_build_object(
    'index_version', (select min(k.index_version) from semantic.corpora k),
    'results', coalesce(jsonb_agg(jsonb_build_object(
      'rank', r.rank, 'dataset', r.dataset, 'record_id', r.record_id, 'chunk_no', r.chunk_no, 'chunk_total', r.chunk_total,
      'char_start', r.char_start, 'char_end', r.char_end, 'title', r.title, 'href', r.href, 'source_url', r.source_url,
      'snippet', r.snippet, 'distance', round(r.distance::numeric, 4)) order by r.rank), '[]'::jsonb))
  into v_out from ranked r;
  return v_out;
end $$;

-- Records whose passages are nearest to the mean of one record's passages (its first 64), the record itself excluded.
create or replace function public.semantic_related_v1(
  p_dataset text, p_record_id text, p_limit integer default 8, p_datasets text[] default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 50); v_center extensions.halfvec; v_n integer; v_out jsonb;
begin
  if p_datasets is not null and cardinality(p_datasets) = 0 then
    raise exception 'Choose at least one dataset or pass null' using errcode = '22023'; end if;
  select extensions.avg(c.embedding), count(*)::integer into v_center, v_n
  from semantic.chunks c where c.dataset = p_dataset and c.record_id = p_record_id and c.chunk_no < 64;
  if v_n = 0 or v_center is null then
    return jsonb_build_object('indexed', false, 'index_version', (select min(k.index_version) from semantic.corpora k), 'results', '[]'::jsonb);
  end if;
  with cand as materialized (
    select * from semantic.nearest_v1(v_center, p_datasets, p_dataset, p_record_id, least(v_limit * 6, 300))
  ), best as (
    select distinct on (dataset, record_id) * from cand order by dataset, record_id, distance, chunk_no
  ), ranked as (
    select b.*, row_number() over (order by b.distance, b.dataset, b.record_id) as rank from best b order by b.distance, b.dataset, b.record_id limit v_limit
  )
  select jsonb_build_object(
    'indexed', true, 'passages_used', v_n, 'index_version', (select min(k.index_version) from semantic.corpora k),
    'results', coalesce(jsonb_agg(jsonb_build_object(
      'rank', r.rank, 'dataset', r.dataset, 'record_id', r.record_id, 'chunk_no', r.chunk_no, 'chunk_total', r.chunk_total,
      'char_start', r.char_start, 'char_end', r.char_end, 'title', r.title, 'href', r.href, 'source_url', r.source_url,
      'snippet', r.snippet, 'distance', round(r.distance::numeric, 4)) order by r.rank), '[]'::jsonb))
  into v_out from ranked r;
  return v_out;
end $$;

-- What the index covers (counts per dataset), for the pages' "not indexed" and coverage statements.
create or replace function public.semantic_status_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'index_version', (select min(k.index_version) from semantic.corpora k),
    'datasets', coalesce(jsonb_agg(jsonb_build_object('dataset', k.dataset, 'label', k.label, 'records', k.records, 'chunks', k.chunks,
      'loaded_chunks', coalesce(l.n, 0), 'capped_records', k.capped_records, 'composed', k.composed, 'built_at', k.built_at)
      order by k.dataset), '[]'::jsonb))
  from semantic.corpora k
  left join (select dataset, count(*)::integer as n from semantic.chunks group by dataset) l on l.dataset = k.dataset
$$;

-- Load RPCs (builder only).
create or replace function public.semantic_load_corpus_v1(p_row jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_row) is distinct from 'object' then raise exception 'Invalid corpus row' using errcode = '22023'; end if;
  insert into semantic.corpora(dataset, label, index_version, composed, records, chunks, capped_records, built_at, source_digest)
  values (p_row ->> 'dataset', p_row ->> 'label', p_row ->> 'index_version', (p_row ->> 'composed')::boolean,
          (p_row ->> 'records')::integer, (p_row ->> 'chunks')::integer, coalesce((p_row ->> 'capped_records')::integer, 0),
          (p_row ->> 'built_at')::timestamptz, p_row ->> 'source_digest')
  on conflict (dataset) do update set label = excluded.label, index_version = excluded.index_version, composed = excluded.composed,
    records = excluded.records, chunks = excluded.chunks, capped_records = excluded.capped_records, built_at = excluded.built_at,
    source_digest = excluded.source_digest, loaded_at = now();
  return 1;
end $$;

create or replace function public.semantic_load_v1(p_dataset text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_changed integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'Invalid passage batch' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_rows);
  with ins as (
    insert into semantic.chunks as t(dataset, record_id, chunk_no, chunk_total, char_start, char_end, text_sha256, title, href, source_url, snippet, embedding)
    select p_dataset, r ->> 'record_id', (r ->> 'chunk_no')::integer, (r ->> 'chunk_total')::integer, (r ->> 'char_start')::integer,
           (r ->> 'char_end')::integer, r ->> 'text_sha256', r ->> 'title', r ->> 'href', nullif(r ->> 'source_url', ''), r ->> 'snippet',
           (r ->> 'embedding')::extensions.halfvec(1024)
    from jsonb_array_elements(p_rows) r
    on conflict (dataset, record_id, chunk_no) do update set chunk_total = excluded.chunk_total, char_start = excluded.char_start,
      char_end = excluded.char_end, text_sha256 = excluded.text_sha256, title = excluded.title, href = excluded.href,
      source_url = excluded.source_url, snippet = excluded.snippet, embedding = excluded.embedding
      where (t.chunk_total, t.char_start, t.char_end, t.text_sha256, t.title, t.href, t.source_url, t.snippet)
              is distinct from (excluded.chunk_total, excluded.char_start, excluded.char_end, excluded.text_sha256, excluded.title,
                                excluded.href, excluded.source_url, excluded.snippet)
         -- both sides are not null; the operator is named because search_path is empty
         or t.embedding operator(extensions.<>) excluded.embedding
    returning 1)
  select count(*)::integer into v_changed from ins;
  return jsonb_build_object('rows', v_n, 'written', v_changed, 'unchanged', v_n - v_changed);
end $$;

-- Remove passages numbered at or beyond a record's current count (a reload that kept fewer passages of a record).
create or replace function public.semantic_prune_v1(p_dataset text, p_counts jsonb) returns integer
language sql security definer set search_path = '' as $$
  with del as (
    delete from semantic.chunks c using jsonb_each_text(p_counts) e
    where c.dataset = p_dataset and c.record_id = e.key and c.chunk_no >= e.value::integer
    returning 1)
  select count(*)::integer from del
$$;

-- Remove up to p_limit passages of a dataset (call until it returns 0), to rebuild a dataset from nothing.
create or replace function public.semantic_purge_v1(p_dataset text, p_limit integer default 20000) returns integer
language sql security definer set search_path = '' as $$
  with del as (
    delete from semantic.chunks c where (c.dataset, c.record_id, c.chunk_no) in (
      select dataset, record_id, chunk_no from semantic.chunks where dataset = p_dataset limit least(greatest(p_limit, 1), 50000))
    returning 1)
  select count(*)::integer from del
$$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.semantic_search_v1(extensions.halfvec,text[],integer)',
    'public.semantic_related_v1(text,text,integer,text[])',
    'public.semantic_status_v1()',
    'public.semantic_load_corpus_v1(jsonb)',
    'public.semantic_load_v1(text,jsonb)',
    'public.semantic_prune_v1(text,jsonb)',
    'public.semantic_purge_v1(text,integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

comment on schema semantic is 'Semantic index: passages of statutes, regulations, opinions, reports and bills with 1024-dimension embeddings, for retrieval and related-item suggestions only.';

commit;

-- ================================================================================================ PART 3: HNSW index (after the load)
-- Cosine distance on the 16-bit vectors. Needs maintenance_work_mem of about 1 GB or more for several hundred thousand rows
-- (set it for the session that builds the index; build with a direct database connection, not the SQL editor's request timeout).
create index if not exists chunks_embedding_hnsw on semantic.chunks using hnsw (embedding extensions.halfvec_cosine_ops) with (m = 16, ef_construction = 64);
analyze semantic.chunks;
