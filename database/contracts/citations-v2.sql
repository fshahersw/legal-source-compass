-- citations/2 — citation graph over the stored court-filing pages: every citation the canonical extractor reads
-- (src/lib/citations, scripts/citations_v2: one pattern table, a Python and a TypeScript engine held to one golden
-- fixture), resolved by exact key to corpus records, and aggregated into citing-document -> cited-authority edges.
--
-- Scope and rules
--   * Text: page text never leaves corpus_ingest.pdf_text_pages. Only byte sets that documents/1 indexed
--     (documents.page_sets.status = 'indexed', i.e. the display rule passed) are read, and only documents that serve
--     their text (documents.documents.text_status in ('text_layer', 'partial_text') and documents.is_open) are listed.
--   * Occurrences are accepted only when the stored page text holds exactly `matched` at [start, end) (code points) and
--     the key has the shape its kind requires; everything else is rejected and counted in the run ledger.
--   * Resolution is by exact key, never by similarity. States: resolved (one corpus record), ambiguous (two or more,
--     candidates kept), unresolved (the key cannot be mapped: a range, a page that starts no document, a resolver that
--     is not installed yet -> reason 'unresolved_target_missing'), not_in_corpus (the authority is well formed and the
--     corpus has no record of it). Resolvers owned by other contracts are called by name when present:
--       public.caselaw_resolve_v2(p_citation text)                    (case law; else caselaw.cases.cite_keys, exact)
--       public.state_law_resolve_v1(p_state text, p_citation text)    (state statutes)
--       public.state_reg_resolve_v1(p_state text, p_citation text)    (state regulations)
--     Their result is read tolerantly (jsonb object, set of rows or a scalar record id; fields status|resolution,
--     dataset|target_dataset, record_id|target_id|id|cluster_id, candidates) and a resolved target must exist in
--     public.corpus_records (or caselaw.cases) or the authority stays unresolved ('resolver_target_not_found').
--   * An MDL number or a docket number in a document is a mention (relation 'mentions'), never membership.
--   * documents.links (documents/1) is not touched; citations.document_links is the same row shape built from these
--     edges, and public.citations_links_v2 answers in the documents_links_v1 (insights Link) shape.
-- Every function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Idempotent (create if not exists / create or replace / on conflict). No statement deletes outside this schema.
--
-- Pipeline (the lead runs it; scripts/citations_v2/run_batch.py wraps the first three steps for the full re-extraction):
--   select public.citations_build_index_v2('fr', '', 200000);   -- repeat with the returned `last` until done (FR pages)
--   select public.citations_build_index_v2('pl', '', 100000);   -- public laws by Congress and number
--   python3 scripts/citations_v2/run_batch.py ...               -- export pages -> extract -> citations_load_v2
--   select public.citations_resolve_v2(5000);                   -- repeat until pending = 0
--   select public.citations_link_v2(null, '', 500);             -- repeat with the returned `last` until done
-- Nightly: supabase/functions/ingest-citations (src/lib/citations/nightly.ts) after documents-nightly
-- (citations-v2-schedule.sql). Offline test: src/lib/citations/contract.test.mjs (PGlite).

begin;

create schema if not exists citations;
revoke all on schema citations from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ tables
create table if not exists citations.runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('batch', 'nightly')),
  trigger text not null default 'manual' check (trigger in ('schedule', 'manual')),
  extractor_version text not null check (extractor_version ~ '^[a-z0-9./_-]{3,60}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  pages_loaded integer not null default 0,
  citations_accepted integer not null default 0,
  citations_rejected integer not null default 0,
  rejected jsonb not null default '{}',
  authorities_resolved integer not null default 0,
  documents_linked integer not null default 0,
  error text,
  notes jsonb not null default '{}',
  constraint runs_finished_when_done check ((status = 'running') = (finished_at is null))
);
create index if not exists runs_started on citations.runs (started_at desc);
create unique index if not exists runs_one_running on citations.runs (kind) where status = 'running';

-- one row per extracted page: which extractor version read it (a page without citations still gets its row)
create table if not exists citations.page_state (
  src text not null check (src in ('pdf')),
  src_id text not null check (src_id ~ '^[0-9a-f]{64}$'),
  page integer not null check (page between 1 and 20000),
  extractor_version text not null,
  citations integer not null default 0,
  rejected integer not null default 0,
  run_id uuid,
  extracted_at timestamptz not null default now(),
  primary key (src, src_id, page)
);

create table if not exists citations.occurrences (
  src text not null check (src in ('pdf')),
  src_id text not null,
  page integer not null,
  seq integer not null check (seq between 0 and 4999),
  kind text not null check (kind in ('case', 'usc', 'cfr', 'cfr_part', 'federal_register', 'statutes_at_large', 'public_law',
    'constitution_us', 'constitution_state', 'federal_rule', 'local_rule', 'state_statute', 'state_regulation', 'mdl', 'docket', 'short')),
  form text not null check (form in ('full', 'short')),
  short_type text check (short_type in ('id', 'at', 'supra', 'section', 'rule')),
  short_status text check (short_status in ('resolved', 'ambiguous', 'none')),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null,
  matched text not null,
  key text,
  normalized text,
  pin text,
  grp integer,
  case_name text,
  antecedent jsonb,
  fields jsonb not null default '{}',
  extractor_version text not null,
  primary key (src, src_id, page, seq),
  check (end_offset > start_offset and end_offset - start_offset <= 400)
);
create index if not exists occurrences_key on citations.occurrences (key) where key is not null;

create table if not exists citations.authorities (
  key text primary key check (length(key) between 5 and 200),
  kind text not null,
  normalized text,
  resolution text not null default 'pending' check (resolution in ('pending', 'resolved', 'ambiguous', 'unresolved', 'not_in_corpus')),
  reason text,
  target_dataset text,
  target_id text,
  target_title text,
  candidates jsonb,
  link_type text check (link_type in ('law_unit', 'mdl', 'record')),
  link_id text,
  resolver text,
  first_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((resolution = 'resolved') = (target_dataset is not null and target_id is not null))
);
create index if not exists authorities_pending on citations.authorities (kind) where resolution = 'pending';
create index if not exists authorities_target on citations.authorities (target_dataset, target_id) where resolution = 'resolved';

-- citing document -> cited authority (one row per document and authority key)
create table if not exists citations.edges (
  citing_type text not null check (citing_type in ('document')),
  citing_id text not null,
  key text not null,
  kind text not null,
  relation text not null check (relation in ('cites', 'mentions')),
  mentions integer not null check (mentions >= 1),
  full_mentions integer not null,
  short_mentions integer not null,
  first_page integer not null,
  first_start integer not null,
  first_end integer not null,
  pages integer[] not null,
  pins text[] not null,
  extractor_version text not null,
  linked_at timestamptz not null default now(),
  primary key (citing_type, citing_id, key)
);
create index if not exists edges_key on citations.edges (key);

-- Federal Register documents by volume and page range (federal_register_history detail fact "Citation":
-- "80 FR 53243 (pages 53243-53256)"), and enacted public laws by Congress and number (public_laws_enacted cells.law)
create table if not exists citations.fr_index (
  volume integer not null,
  first_page integer not null,
  last_page integer not null,
  record_id text not null,
  primary key (volume, first_page, record_id)
);
create index if not exists fr_index_last on citations.fr_index (volume, last_page);
create table if not exists citations.pl_index (
  congress integer not null,
  law integer not null,
  record_id text not null,
  primary key (congress, law, record_id)
);

alter table citations.runs enable row level security;
alter table citations.page_state enable row level security;
alter table citations.occurrences enable row level security;
alter table citations.authorities enable row level security;
alter table citations.edges enable row level security;
alter table citations.fr_index enable row level security;
alter table citations.pl_index enable row level security;
revoke all on all tables in schema citations from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ helpers
-- The key shape every kind must have (the canonical extractor's keys; scripts/citations_v2/pattern_source.py).
create or replace function citations.key_ok(p_kind text, p_key text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'case' then p_key ~ '^case:[0-9]{1,4}:[^:]{1,40}:[0-9]{1,7}(-?[A-Z])?$'
    when 'usc' then p_key ~ '^(usc:[0-9]{1,2}a?:[0-9][0-9A-Za-z.-]{0,40}(:[0-9][0-9A-Za-z.-]{0,40})?|usc-ch:[0-9]{1,2}:[0-9]{1,4}[A-Z]?)$'
    when 'cfr' then p_key ~ '^cfr:[0-9]{1,2}:[0-9]{1,5}\.[0-9][0-9A-Za-z().-]{0,40}(:[0-9][0-9A-Za-z().-]{0,40})?$'
    when 'cfr_part' then p_key ~ '^cfr-part:[0-9]{1,2}:[0-9]{1,5}(:[0-9]{1,5})?$'
    when 'federal_register' then p_key ~ '^fr:[0-9]{1,3}:[0-9]{1,6}$'
    when 'statutes_at_large' then p_key ~ '^stat:[0-9]{1,3}A?:[0-9]{1,5}$'
    when 'public_law' then p_key ~ '^pl:[0-9]{1,3}:[0-9]{1,4}$'
    when 'constitution_us' then p_key ~ '^const-us:[a-z0-9:-]{1,60}$'
    when 'constitution_state' then p_key ~ '^const:[A-Z]{2}:[a-z0-9:-]{1,60}$'
    when 'federal_rule' then p_key ~ '^rule:(frcp|frcrp|fre|frap|frbp):[0-9A-Za-z.-]{1,12}$'
    when 'local_rule' then p_key ~ '^local-rule:@?[a-z0-9]{0,24}:[0-9A-Za-z.-]{1,16}$'
    when 'state_statute' then p_key ~ '^state-stat:[A-Z]{2}:[a-z0-9-]{1,30}:[^[:space:]].{0,79}$'
    when 'state_regulation' then p_key ~ '^state-reg:[A-Z]{2}:[a-z0-9-]{1,30}:[^[:space:]].{0,79}$'
    when 'mdl' then p_key ~ '^mdl:[1-9][0-9]{0,5}$'
    when 'docket' then p_key ~ '^docket:[0-9A-Za-z:-]{3,60}$'
    else false end
$$;

-- kind of an authority key (a resolved short form carries its antecedent's key)
create or replace function citations.key_kind(p_key text) returns text
language sql immutable set search_path = '' as $$
  select case split_part(p_key, ':', 1)
    when 'case' then 'case' when 'usc' then 'usc' when 'usc-ch' then 'usc' when 'cfr' then 'cfr' when 'cfr-part' then 'cfr_part'
    when 'fr' then 'federal_register' when 'stat' then 'statutes_at_large' when 'pl' then 'public_law'
    when 'const-us' then 'constitution_us' when 'const' then 'constitution_state' when 'rule' then 'federal_rule'
    when 'local-rule' then 'local_rule' when 'state-stat' then 'state_statute' when 'state-reg' then 'state_regulation'
    when 'mdl' then 'mdl' when 'docket' then 'docket' end
$$;

-- "XIV" -> 14, "3" -> 3, anything else -> null
create or replace function citations.roman_int(p text) returns integer
language plpgsql immutable set search_path = '' as $$
declare s text := upper(trim(coalesce(p, ''))); v integer := 0; i integer; c integer; n integer;
begin
  if s ~ '^[0-9]{1,4}$' then return s::integer; end if;
  if s !~ '^[IVXLC]{1,9}$' then return null; end if;
  for i in 1 .. length(s) loop
    c := case substr(s, i, 1) when 'I' then 1 when 'V' then 5 when 'X' then 10 when 'L' then 50 else 100 end;
    n := case when i < length(s) then case substr(s, i + 1, 1) when 'I' then 1 when 'V' then 5 when 'X' then 10 when 'L' then 50 else 100 end else 0 end;
    v := v + case when c < n then -c else c end;
  end loop;
  return v;
end $$;

-- Court id of a federal district from the court part of a local-rule key ("ndcalciv" -> cand, "dnj" -> njd,
-- "sdny" -> nysd); null when the letters are not a district abbreviation.
create or replace function citations.court_from_slug(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := regexp_replace(coalesce(p, ''), '(civ|crim|cr)$', ''); m text[]; dir text := ''; st text; postal text;
begin
  m := regexp_match(s, '^([nsewmc])d(.+)$');
  if m is not null then dir := m[1]; st := m[2];
  else m := regexp_match(s, '^d(.+)$'); if m is null then return null; end if; st := m[1]; end if;
  select x.code into postal from (values ('ala','al'),('alaska','ak'),('ariz','az'),('ark','ar'),('cal','ca'),('colo','co'),
    ('conn','ct'),('del','de'),('dc','dc'),('fla','fl'),('ga','ga'),('haw','hi'),('hawaii','hi'),('idaho','id'),('ill','il'),
    ('ind','in'),('iowa','ia'),('kan','ks'),('ky','ky'),('la','la'),('me','me'),('md','md'),('mass','ma'),('mich','mi'),
    ('minn','mn'),('miss','ms'),('mo','mo'),('mont','mt'),('neb','ne'),('nev','nv'),('nh','nh'),('nj','nj'),('nm','nm'),
    ('ny','ny'),('nc','nc'),('nd','nd'),('ohio','oh'),('okla','ok'),('or','or'),('ore','or'),('pa','pa'),('ri','ri'),
    ('sc','sc'),('sd','sd'),('tenn','tn'),('tex','tx'),('utah','ut'),('vt','vt'),('va','va'),('wash','wa'),('wva','wv'),
    ('wis','wi'),('wyo','wy'),('pr','pr'),('vi','vi'),('guam','gu')) x(abbr, code) where x.abbr = st;
  if postal is null then return null; end if;
  return postal || dir || 'd';
end $$;

-- Calls a resolver owned by another contract when it is installed: {"present": false} | {"present": true, "rows": [...]}
-- | {"present": true, "error": "..."}. Only these three names can be called.
create or replace function citations.call_resolver(p_fn text, p_a text, p_b text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_fn = 'caselaw_resolve_v2' then
    if to_regprocedure('public.caselaw_resolve_v2(text)') is null then return jsonb_build_object('present', false); end if;
    begin
      execute 'select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from public.caselaw_resolve_v2($1) r' into v using p_a;
    exception when others then return jsonb_build_object('present', true, 'error', left(sqlerrm, 200));
    end;
  elsif p_fn in ('state_law_resolve_v1', 'state_reg_resolve_v1') then
    if to_regprocedure('public.' || p_fn || '(text,text)') is null then return jsonb_build_object('present', false); end if;
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from public.%I($1, $2) r', p_fn) into v using p_a, p_b;
    exception when others then return jsonb_build_object('present', true, 'error', left(sqlerrm, 200));
    end;
  else
    raise exception 'Unknown resolver' using errcode = '22023';
  end if;
  return jsonb_build_object('present', true, 'rows', v);
end $$;

-- Reads a resolver answer (see call_resolver) into the resolution shape of citations.resolve_key.
create or replace function citations.read_resolver(p_fn text, p_answer jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb := '[]'::jsonb; r jsonb; v jsonb; st text; v_ds text; v_id text; v_ids text[] := '{}'; n integer; v_title text;
begin
  if not coalesce((p_answer ->> 'present')::boolean, false) then
    return jsonb_build_object('resolution', 'unresolved', 'reason', 'unresolved_target_missing', 'resolver', p_fn);
  end if;
  if p_answer ? 'error' then
    return jsonb_build_object('resolution', 'unresolved', 'reason', 'resolver_error', 'resolver', p_fn, 'note', p_answer ->> 'error');
  end if;
  -- unwrap: a scalar function answers {"<fn>": value}; a value may itself be an object or an array of objects
  for r in select * from jsonb_array_elements(coalesce(p_answer -> 'rows', '[]'::jsonb)) loop
    v := case when jsonb_typeof(r) = 'object' and r ? p_fn and (select count(*) from jsonb_object_keys(r)) = 1 then r -> p_fn else r end;
    if v is null or jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) = 'array' then v_rows := v_rows || v;
    elsif jsonb_typeof(v) = 'object' then v_rows := v_rows || jsonb_build_array(v);
    else v_rows := v_rows || jsonb_build_array(jsonb_build_object('record_id', v #>> '{}')); end if;
  end loop;
  n := jsonb_array_length(v_rows);
  if n = 0 then
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'resolver_no_match', 'resolver', p_fn);
  end if;
  if n = 1 then
    r := v_rows -> 0;
    st := lower(coalesce(r ->> 'status', r ->> 'resolution', r ->> 'state', ''));
    if st in ('ambiguous') then
      return jsonb_build_object('resolution', 'ambiguous', 'reason', 'resolver_ambiguous', 'resolver', p_fn,
                                'candidates', coalesce(r -> 'candidates', '[]'::jsonb));
    elsif st in ('not_in_corpus', 'not_found', 'none', 'missing') then
      return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'resolver_not_found', 'resolver', p_fn);
    elsif st in ('unresolved', 'invalid', 'error') then
      return jsonb_build_object('resolution', 'unresolved', 'reason', 'resolver_unresolved', 'resolver', p_fn);
    end if;
  end if;
  -- one or more answers naming a record: they must all name the same existing record
  for r in select * from jsonb_array_elements(v_rows) loop
    v_id := coalesce(r ->> 'record_id', r ->> 'target_id', r ->> 'id', r ->> 'cluster_id');
    if v_id is not null and not (v_id = any(v_ids)) then v_ids := v_ids || v_id; end if;
  end loop;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('resolution', 'unresolved', 'reason', 'resolver_answer_unreadable', 'resolver', p_fn);
  end if;
  if cardinality(v_ids) > 1 then
    return jsonb_build_object('resolution', 'ambiguous', 'reason', 'resolver_several_records', 'resolver', p_fn,
                              'candidates', to_jsonb(v_ids[1:10]));
  end if;
  r := v_rows -> 0;
  v_ds := coalesce(r ->> 'dataset', r ->> 'target_dataset');
  v_id := v_ids[1];
  if p_fn = 'caselaw_resolve_v2' and (v_ds is null or v_ds = 'caselaw') then
    if v_id ~ '^(caselaw/)?[1-9][0-9]{0,11}$' then
      v_id := regexp_replace(v_id, '^caselaw/', '');
      select c.case_name into v_title from caselaw.cases c where c.cluster_id = v_id::bigint;
      if found then
        return jsonb_build_object('resolution', 'resolved', 'reason', 'resolver', 'resolver', p_fn, 'dataset', 'caselaw', 'id', v_id,
                                  'title', v_title, 'link_type', 'record', 'link_id', 'caselaw/' || v_id);
      end if;
    end if;
    return jsonb_build_object('resolution', 'unresolved', 'reason', 'resolver_target_not_found', 'resolver', p_fn);
  end if;
  if v_ds is not null then
    select x.title into v_title from public.corpus_records x where x.dataset = v_ds and x.id = v_id;
    if found then
      return jsonb_build_object('resolution', 'resolved', 'reason', 'resolver', 'resolver', p_fn, 'dataset', v_ds, 'id', v_id, 'title', v_title);
    end if;
  end if;
  return jsonb_build_object('resolution', 'unresolved', 'reason', 'resolver_target_not_found', 'resolver', p_fn);
end $$;

-- Resolution of one authority key (exact; see the header). Returns
-- {resolution, reason, resolver, dataset, id, title, candidates, link_type, link_id}.
create or replace function citations.resolve_key(p_key text, p_normalized text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare k text[] := string_to_array(p_key, ':'); v_kind text := citations.key_kind(p_key); v jsonb; n integer; v_ids text[];
  v_t text; v_id text; v_ds text; v_part text; v_art integer; v_sec text; v_court text; v_cite text;
begin
  if v_kind is null then return jsonb_build_object('resolution', 'unresolved', 'reason', 'unknown_key'); end if;

  if v_kind = 'case' then
    v_cite := k[2] || ' ' || k[3] || ' ' || k[4];
    v := citations.call_resolver('caselaw_resolve_v2', v_cite, null);
    if coalesce((v ->> 'present')::boolean, false) then return citations.read_resolver('caselaw_resolve_v2', v); end if;
    if to_regclass('caselaw.cases') is null then
      return jsonb_build_object('resolution', 'unresolved', 'reason', 'unresolved_target_missing');
    end if;
    select array_agg(c.cluster_id::text order by c.cluster_id), min(c.case_name) into v_ids, v_t
      from (select c.cluster_id, c.case_name from caselaw.cases c where c.cite_keys @> array[caselaw.cite_key(v_cite)] limit 11) c;
    n := coalesce(cardinality(v_ids), 0);
    if n = 1 then
      return jsonb_build_object('resolution', 'resolved', 'reason', 'exact_citation', 'resolver', 'cite_keys', 'dataset', 'caselaw',
                                'id', v_ids[1], 'title', v_t, 'link_type', 'record', 'link_id', 'caselaw/' || v_ids[1]);
    elsif n > 1 then
      return jsonb_build_object('resolution', 'ambiguous', 'reason', 'several_cases_carry_this_citation', 'resolver', 'cite_keys',
                                'candidates', to_jsonb(v_ids[1:10]));
    end if;
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'no_case_with_this_citation', 'resolver', 'cite_keys');
  end if;

  if k[1] = 'usc-ch' then
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'code_chapters_are_not_records');
  end if;
  if v_kind = 'usc' then
    if cardinality(k) = 4 then return jsonb_build_object('resolution', 'unresolved', 'reason', 'section_range'); end if;
    v_id := k[2] || ':' || k[3];
    select x.title into v_t from public.corpus_records x where x.dataset = 'us_code_sections' and x.id = v_id;
    if found then
      return jsonb_build_object('resolution', 'resolved', 'reason', 'exact_section', 'dataset', 'us_code_sections', 'id', v_id,
                                'title', v_t, 'link_type', 'law_unit', 'link_id', 'usc:' || v_id);
    end if;
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'no_current_section');
  end if;

  if v_kind in ('cfr', 'cfr_part') then
    if cardinality(k) = 4 then return jsonb_build_object('resolution', 'unresolved', 'reason', 'range'); end if;
    v_part := case v_kind when 'cfr' then split_part(k[3], '.', 1) else k[3] end;
    for v_ds, v_id in select * from (values
        ('ecfr_sections_full', case v_kind when 'cfr' then 'cfr:' || k[2] || ':' || k[3] else 'cfr:' || k[2] || ':part-' || k[3] end),
        (case v_kind when 'cfr' then 'federal_regulations_sections' else 'federal_regulations_parts' end, 'cfr:' || k[2] || ':' || k[3])) s loop
      select x.title into v_t from public.corpus_records x where x.dataset = v_ds and x.id = v_id;
      if found then
        return jsonb_build_object('resolution', 'resolved', 'reason', case v_kind when 'cfr' then 'exact_section' else 'exact_part' end,
          'dataset', v_ds, 'id', v_id, 'title', v_t,
          'link_type', case when exists (select 1 from public.corpus_records x where x.dataset = 'federal_regulations_parts'
                                          and x.id = 'cfr:' || k[2] || ':' || v_part) then 'law_unit' end,
          'link_id', case when exists (select 1 from public.corpus_records x where x.dataset = 'federal_regulations_parts'
                                        and x.id = 'cfr:' || k[2] || ':' || v_part) then 'cfr:' || k[2] || ':' || v_part end);
      end if;
    end loop;
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', case v_kind when 'cfr' then 'no_current_section' else 'no_current_part' end);
  end if;

  if v_kind = 'federal_register' then
    if not exists (select 1 from citations.fr_index) then
      return jsonb_build_object('resolution', 'unresolved', 'reason', 'fr_index_not_built');
    end if;
    select array_agg(f.record_id order by f.record_id) into v_ids
      from (select f.record_id from citations.fr_index f where f.volume = k[2]::integer and f.first_page = k[3]::integer limit 11) f;
    if coalesce(cardinality(v_ids), 0) = 0 then
      select array_agg(f.record_id order by f.record_id) into v_ids
        from (select f.record_id from citations.fr_index f where f.volume = k[2]::integer and f.first_page < k[3]::integer
                and f.last_page >= k[3]::integer limit 11) f;
      v_t := 'page_within_document';
    else
      v_t := 'first_page';
    end if;
    n := coalesce(cardinality(v_ids), 0);
    if n = 1 then
      return jsonb_build_object('resolution', 'resolved', 'reason', v_t, 'dataset', 'federal_register_history', 'id', v_ids[1],
        'title', (select x.title from public.corpus_records x where x.dataset = 'federal_register_history' and x.id = v_ids[1]));
    elsif n > 1 then
      return jsonb_build_object('resolution', 'ambiguous', 'reason', 'several_documents_on_page', 'candidates', to_jsonb(v_ids[1:10]));
    end if;
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'no_document_on_page');
  end if;

  if v_kind = 'statutes_at_large' then
    v_id := 'stat-' || k[2] || '-' || k[3];
    select x.title into v_t from public.corpus_records x where x.dataset = 'public_laws_enacted' and x.id = v_id;
    if found then
      return jsonb_build_object('resolution', 'resolved', 'reason', 'first_page_of_law', 'dataset', 'public_laws_enacted', 'id', v_id, 'title', v_t);
    end if;
    return jsonb_build_object('resolution', 'unresolved', 'reason', 'no_law_starts_on_page');
  end if;

  if v_kind = 'public_law' then
    if not exists (select 1 from citations.pl_index) then
      return jsonb_build_object('resolution', 'unresolved', 'reason', 'pl_index_not_built');
    end if;
    select array_agg(p.record_id order by p.record_id) into v_ids from citations.pl_index p where p.congress = k[2]::integer and p.law = k[3]::integer;
    n := coalesce(cardinality(v_ids), 0);
    if n = 1 then
      return jsonb_build_object('resolution', 'resolved', 'reason', 'exact_law_number', 'dataset', 'public_laws_enacted', 'id', v_ids[1],
        'title', (select x.title from public.corpus_records x where x.dataset = 'public_laws_enacted' and x.id = v_ids[1]));
    elsif n > 1 then
      return jsonb_build_object('resolution', 'ambiguous', 'reason', 'several_records', 'candidates', to_jsonb(v_ids[1:10]));
    end if;
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'no_enacted_law_with_this_number');
  end if;

  if v_kind = 'constitution_us' then
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'us_constitution_not_in_corpus');
  end if;

  if v_kind = 'constitution_state' then
    v_art := (select citations.roman_int(substr(x, 5)) from unnest(k[3:]) x where x ~ '^art-' limit 1);
    v_sec := (select substr(x, 5) from unnest(k[3:]) x where x ~ '^sec-' limit 1);
    if v_art is null or exists (select 1 from unnest(k[3:]) x where x !~ '^(art|sec)-') then
      return jsonb_build_object('resolution', 'unresolved', 'reason', 'provision_form_not_mapped');
    end if;
    select array_agg(x.id order by x.id), min(x.title) into v_ids, v_t
      from public.corpus_records x
     where x.dataset = 'state_constitution_sections' and x.item -> 'constitution_section' ->> 'state' = k[2]
       and citations.roman_int(x.item -> 'constitution_section' ->> 'article') = v_art
       and ((v_sec is null and x.item -> 'constitution_section' ->> 'section' is null)
            or x.item -> 'constitution_section' ->> 'section' = v_sec);
    n := coalesce(cardinality(v_ids), 0);
    if n = 1 then
      return jsonb_build_object('resolution', 'resolved', 'reason', 'exact_provision', 'dataset', 'state_constitution_sections', 'id', v_ids[1], 'title', v_t);
    elsif n > 1 then
      return jsonb_build_object('resolution', 'ambiguous', 'reason', 'several_provisions', 'candidates', to_jsonb(v_ids[1:10]));
    end if;
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'no_such_provision');
  end if;

  if v_kind in ('federal_rule', 'local_rule') then
    if v_kind = 'federal_rule' then
      v_court := null;
      v_ids := (select array_agg(x.id order by x.id) from public.corpus_records x
               where x.dataset = 'court_rule_sections' and x.filters -> 'doc' ->> 0 = 'us-' || k[2]
                 and x.item -> 'rule_section' ->> 'number' = k[3]);
    else
      if k[2] = '' then return jsonb_build_object('resolution', 'unresolved', 'reason', 'court_not_named'); end if;
      v_court := case when k[2] like '@%' then substr(k[2], 2) else citations.court_from_slug(k[2]) end;
      if v_court is null then return jsonb_build_object('resolution', 'unresolved', 'reason', 'court_not_recognized'); end if;
      v_ids := (select array_agg(x.id order by x.id) from public.corpus_records x
               where x.dataset = 'court_rule_sections' and x.filters -> 'doc' ->> 0 in (v_court || '-civil', v_court || '-combined')
                 and x.item -> 'rule_section' ->> 'number' = k[3]
                 and coalesce(x.item -> 'rule_section' ->> 'label', '') !~* '(crim|^cr\.|pat\.)');
    end if;
    n := coalesce(cardinality(v_ids), 0);
    if n = 1 then
      return jsonb_build_object('resolution', 'resolved', 'reason', 'exact_rule_number', 'dataset', 'court_rule_sections', 'id', v_ids[1],
        'title', (select x.title from public.corpus_records x where x.dataset = 'court_rule_sections' and x.id = v_ids[1]));
    elsif n > 1 then
      return jsonb_build_object('resolution', 'ambiguous', 'reason', 'several_rule_texts', 'candidates', to_jsonb(v_ids[1:10]));
    end if;
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'no_rule_with_this_number');
  end if;

  if v_kind in ('state_statute', 'state_regulation') then
    v_t := case v_kind when 'state_statute' then 'state_law_resolve_v1' else 'state_reg_resolve_v1' end;
    return citations.read_resolver(v_t, citations.call_resolver(v_t, k[2], coalesce(p_normalized, p_key)));
  end if;

  if v_kind = 'mdl' then
    select x.title into v_t from public.corpus_records x where x.dataset = 'mdls' and x.id = k[2];
    if found then
      return jsonb_build_object('resolution', 'resolved', 'reason', 'exact_mdl_number', 'dataset', 'mdls', 'id', k[2], 'title', v_t,
                                'link_type', 'mdl', 'link_id', k[2]);
    end if;
    return jsonb_build_object('resolution', 'not_in_corpus', 'reason', 'no_mdl_record');
  end if;

  return jsonb_build_object('resolution', 'unresolved', 'reason', 'docket_numbers_are_mentions');
end $$;

-- A node of the citation graph: the resolved record (so parallel citations of one decision are one node), else the key.
create or replace function citations.node_id(p_resolution text, p_dataset text, p_id text, p_key text) returns text
language sql immutable set search_path = '' as $$
  select case when p_resolution = 'resolved' then p_dataset || '/' || p_id else 'key/' || p_key end
$$;

-- edges as rows of documents.links (documents/1 shape): resolved authorities that have a documents/1 link id
create or replace view citations.document_links as
  select e.citing_id as document_id, a.link_type as to_type, a.link_id as to_id, e.relation, 'exact_id'::text as evidence,
         sum(e.mentions)::integer as mentions, min(e.first_page) as first_page,
         (array_agg(distinct p order by p))[1:20] as pages
    from citations.edges e
    join citations.authorities a on a.key = e.key and a.resolution = 'resolved' and a.link_type is not null
    cross join lateral unnest(e.pages) p
   where e.citing_type = 'document'
   group by e.citing_id, a.link_type, a.link_id, e.relation;
revoke all on citations.document_links from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ lookup indexes
-- p_what 'fr' (federal_register_history) or 'pl' (public_laws_enacted); batches by record id after p_after.
create or replace function public.citations_build_index_v2(p_what text, p_after text default '', p_limit integer default 100000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer; v_last text; v_read integer;
begin
  if p_what is null or p_what not in ('fr', 'pl') then raise exception 'Invalid index' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 300000 or length(coalesce(p_after, '')) > 40 then
    raise exception 'Invalid batch' using errcode = '22023'; end if;
  if p_what = 'fr' then
    with b as (select r.id, r.detail, r.item from public.corpus_records r
                where r.dataset = 'federal_register_history' and r.id > coalesce(p_after, '') order by r.id limit p_limit),
    c as (select b.id, coalesce((select f ->> 1 from jsonb_array_elements(case when jsonb_typeof(b.detail -> 'facts') = 'array'
                                     then b.detail -> 'facts' else '[]'::jsonb end) f where f ->> 0 = 'Citation' limit 1),
                                b.item -> 'cells' ->> 'citation') as cite from b),
    m as (select c.id, regexp_match(c.cite, '^([0-9]{1,3}) FR ([0-9]{1,6})(?: \(pages ([0-9]{1,6})-([0-9]{1,6})\))?') as x from c),
    ins as (insert into citations.fr_index (volume, first_page, last_page, record_id)
            select m.x[1]::integer, m.x[2]::integer, greatest(m.x[2]::integer, coalesce(m.x[4]::integer, m.x[2]::integer)), m.id
              from m where m.x is not null
            on conflict (volume, first_page, record_id) do update set last_page = excluded.last_page
            returning 1)
    select (select count(*) from ins), (select max(id) from b), (select count(*) from b) into n, v_last, v_read;
  else
    with b as (select r.id, r.item from public.corpus_records r
                where r.dataset = 'public_laws_enacted' and r.id > coalesce(p_after, '') order by r.id limit p_limit),
    m as (select b.id, regexp_match(b.item -> 'cells' ->> 'law', '([0-9]{1,3})\s*[-–‑]\s*([0-9]{1,4})$') as x from b),
    ins as (insert into citations.pl_index (congress, law, record_id)
            select m.x[1]::integer, m.x[2]::integer, m.id from m where m.x is not null
            on conflict do nothing returning 1)
    select (select count(*) from ins), (select max(id) from b), (select count(*) from b) into n, v_last, v_read;
  end if;
  return jsonb_build_object('index', p_what, 'read', v_read, 'written', n, 'last', v_last, 'done', v_read < p_limit,
    'rows', case p_what when 'fr' then (select count(*) from citations.fr_index) else (select count(*) from citations.pl_index) end);
end $$;

-- ------------------------------------------------------------------------------------------------ run ledger
-- Opens a run. A run of the same kind still 'running' after three hours is closed as failed (its process died).
create or replace function public.citations_open_run_v2(p_kind text, p_trigger text, p_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; n integer;
begin
  if p_kind is null or p_kind not in ('batch', 'nightly') or p_trigger is null or p_trigger not in ('schedule', 'manual')
     or p_version is null or p_version !~ '^[a-z0-9./_-]{3,60}$' then
    raise exception 'Invalid run' using errcode = '22023'; end if;
  update citations.runs set status = 'failed', finished_at = now(), error = 'abandoned: no finish within three hours'
   where kind = p_kind and status = 'running' and started_at < now() - interval '3 hours';
  if exists (select 1 from citations.runs where kind = p_kind and status = 'running') then
    raise exception 'A % citations run is already running', p_kind using errcode = '55006'; end if;
  insert into citations.runs (kind, trigger, extractor_version) values (p_kind, p_trigger, p_version) returning id into v_id;
  select count(*) into n from citations.page_state where extractor_version = p_version;
  return jsonb_build_object('run_id', v_id, 'kind', p_kind, 'extractor_version', p_version, 'pages_at_version', n);
end $$;

create or replace function public.citations_finish_run_v2(p_run uuid, p_status text, p_notes jsonb default '{}', p_error text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r citations.runs;
begin
  if p_status is null or p_status not in ('ok', 'partial', 'failed') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update citations.runs set status = p_status, finished_at = now(),
         notes = notes || case when jsonb_typeof(p_notes) = 'object' then p_notes else '{}'::jsonb end,
         error = left(regexp_replace(coalesce(p_error, ''), '(eyJ|sb_secret_|Bearer )[A-Za-z0-9._-]+', '[redacted]', 'g'), 500)
   where id = p_run and status = 'running' returning * into r;
  if not found then raise exception 'No running run %', p_run using errcode = '22023'; end if;
  if r.error = '' then update citations.runs set error = null where id = p_run; end if;
  return jsonb_build_object('run_id', r.id, 'status', r.status, 'pages_loaded', r.pages_loaded,
    'citations_accepted', r.citations_accepted, 'citations_rejected', r.citations_rejected,
    'authorities_resolved', r.authorities_resolved, 'documents_linked', r.documents_linked);
end $$;

-- ------------------------------------------------------------------------------------------------ extraction exchange
-- Byte sets (newest first) with a stored text page not yet extracted at p_version, with their page text, for the
-- extractor: whole byte sets (short forms link across pages), at most p_max_pages pages unless one set is larger.
create or replace function public.citations_pending_pages_v2(p_version text, p_limit integer default 10, p_max_pages integer default 600) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_sets text[]; v_docs jsonb; v_remaining integer;
begin
  if p_version is null or p_version !~ '^[a-z0-9./_-]{3,60}$' or p_limit is null or p_limit not between 1 and 50
     or p_max_pages is null or p_max_pages not between 1 and 5000 then
    raise exception 'Invalid request' using errcode = '22023'; end if;
  with todo as materialized (
    select ps.sha256, ps.built_at, t.n as pages from documents.page_sets ps
     cross join lateral (select count(*) n from corpus_ingest.pdf_text_pages p where p.sha256 = ps.sha256) t
     where ps.status = 'indexed' and t.n > 0
       and exists (select 1 from documents.documents d where d.sha256 = ps.sha256 and d.text_status in ('text_layer', 'partial_text'))
       and (select count(*) from citations.page_state s where s.src = 'pdf' and s.src_id = ps.sha256 and s.extractor_version = p_version) < t.n),
  ranked as (select todo.*, row_number() over w as rn, sum(todo.pages) over w as cum
               from todo window w as (order by todo.built_at desc, todo.sha256))
  select (select array_agg(r.sha256 order by r.rn) from ranked r where r.rn <= p_limit and (r.rn = 1 or r.cum <= p_max_pages)),
         (select count(*) from todo)
    into v_sets, v_remaining;
  if v_sets is null then return jsonb_build_object('documents', '[]'::jsonb, 'remaining', 0); end if;
  select coalesce(jsonb_agg(jsonb_build_object('sha256', s.sha256, 'pages', s.pages) order by s.ord), '[]'::jsonb) into v_docs
    from (select u.sha256, u.ord, (select coalesce(jsonb_agg(jsonb_build_object('page', p.page, 'text', p.text) order by p.page), '[]'::jsonb)
                                     from corpus_ingest.pdf_text_pages p where p.sha256 = u.sha256) as pages
            from unnest(v_sets) with ordinality u(sha256, ord)) s;
  return jsonb_build_object('documents', v_docs, 'remaining', v_remaining);
end $$;

-- Loads the citations of whole pages (each page's rows replace what that page held). p_pages:
--   [{"src": "pdf", "src_id": <sha256>, "page": n, "citations": [{"seq", "kind", "form", "short", "short_status", "start",
--     "end", "matched", "key", "normalized", "pin", "group", "name", "antecedent": {"page", "seq"} | null, "fields"}]}]
-- A citation is accepted only when the bytes are indexed, the page exists and its text holds exactly `matched` at
-- [start, end) (code points) and the key has its kind's shape; rejected rows are counted by reason.
create or replace function public.citations_load_v2(p_run uuid, p_version text, p_pages jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pg jsonb; c jsonb; v_text text; v_why text; v_start integer; v_end integer; v_kind text; v_key text; v_form text;
  v_src text; v_sha text; v_page integer; v_ok jsonb; n_ok integer; n_bad integer; t_ok integer := 0; t_bad integer := 0;
  t_pages integer := 0; v_rejected jsonb := '{}'::jsonb; v_sample jsonb := '[]'::jsonb; n_total integer := 0; n_del integer;
begin
  if p_version is null or p_version !~ '^[a-z0-9./_-]{3,60}$' then raise exception 'Invalid version' using errcode = '22023'; end if;
  if not exists (select 1 from citations.runs r where r.id = p_run and r.status = 'running' and r.extractor_version = p_version) then
    raise exception 'No running run % at this extractor version', p_run using errcode = '22023'; end if;
  if jsonb_typeof(p_pages) is distinct from 'array' or jsonb_array_length(p_pages) not between 1 and 500 then
    raise exception 'Invalid page batch' using errcode = '22023'; end if;
  select coalesce(sum(case when jsonb_typeof(x -> 'citations') = 'array' then jsonb_array_length(x -> 'citations') else 0 end), 0)
    into n_total from jsonb_array_elements(p_pages) x;
  if n_total > 20000 then raise exception 'Too many citations in one batch' using errcode = '22023'; end if;

  for pg in select * from jsonb_array_elements(p_pages) loop
    v_src := pg ->> 'src'; v_sha := pg ->> 'src_id'; v_why := null; v_text := null;
    begin v_page := (pg ->> 'page')::integer; exception when others then v_page := null; end;
    if v_src is distinct from 'pdf' or v_sha is null or v_sha !~ '^[0-9a-f]{64}$' or v_page is null or v_page not between 1 and 20000
       or jsonb_typeof(pg -> 'citations') is distinct from 'array' then
      v_why := 'bad_page';
    elsif not exists (select 1 from documents.page_sets ps where ps.sha256 = v_sha and ps.status = 'indexed') then
      v_why := 'bytes_not_indexed';
    else
      select p.text into v_text from corpus_ingest.pdf_text_pages p where p.sha256 = v_sha and p.page = v_page;
      if v_text is null then v_why := 'no_such_page'; end if;
    end if;
    if v_why is not null then
      v_rejected := v_rejected || jsonb_build_object(v_why, coalesce((v_rejected ->> v_why)::integer, 0) + 1);
      if jsonb_array_length(v_sample) < 10 then
        v_sample := v_sample || jsonb_build_array(jsonb_build_object('why', v_why, 'src_id', v_sha, 'page', pg -> 'page')); end if;
      continue;
    end if;

    v_ok := '[]'::jsonb; n_ok := 0; n_bad := 0;
    for c in select * from jsonb_array_elements(pg -> 'citations') loop
      v_why := null; v_kind := c ->> 'kind'; v_key := c ->> 'key'; v_form := c ->> 'form';
      begin
        v_start := (c ->> 'start')::integer; v_end := (c ->> 'end')::integer;
      exception when others then v_why := 'bad_offsets';
      end;
      if v_why is null and (v_start is null or v_end is null or v_start < 0 or v_end <= v_start or v_end - v_start > 400) then
        v_why := 'bad_offsets'; end if;
      if v_why is null and (v_form is null or v_form not in ('full', 'short')) then v_why := 'bad_form'; end if;
      if v_why is null and (c ->> 'seq') !~ '^[0-9]{1,4}$' then v_why := 'bad_seq'; end if;
      if v_why is null and substr(v_text, v_start + 1, v_end - v_start) is distinct from c ->> 'matched' then v_why := 'text_mismatch'; end if;
      if v_why is null then
        if v_key is null then
          if v_form <> 'short' then v_why := 'bad_key'; end if;   -- only a short form may stay unlinked
        elsif v_kind = 'short' or not citations.key_ok(v_kind, v_key) or citations.key_kind(v_key) is distinct from v_kind then
          v_why := 'bad_key';
        end if;
      end if;
      if v_why is null and v_kind not in ('case', 'usc', 'cfr', 'cfr_part', 'federal_register', 'statutes_at_large', 'public_law',
          'constitution_us', 'constitution_state', 'federal_rule', 'local_rule', 'state_statute', 'state_regulation', 'mdl', 'docket', 'short') then
        v_why := 'bad_kind'; end if;
      if v_why is not null then
        n_bad := n_bad + 1;
        v_rejected := v_rejected || jsonb_build_object(v_why, coalesce((v_rejected ->> v_why)::integer, 0) + 1);
        if jsonb_array_length(v_sample) < 10 then
          v_sample := v_sample || jsonb_build_array(jsonb_build_object('why', v_why, 'src_id', v_sha, 'page', v_page,
                                                                       'start', c -> 'start', 'kind', v_kind, 'key', v_key)); end if;
        continue;
      end if;
      v_ok := v_ok || jsonb_build_array(c);
      n_ok := n_ok + 1;
    end loop;

    with gone as (delete from citations.occurrences o where o.src = 'pdf' and o.src_id = v_sha and o.page = v_page returning 1)
    select count(*) into n_del from gone;
    insert into citations.occurrences (src, src_id, page, seq, kind, form, short_type, short_status, start_offset, end_offset, matched,
      key, normalized, pin, grp, case_name, antecedent, fields, extractor_version)
    select 'pdf', v_sha, v_page, (x ->> 'seq')::integer, x ->> 'kind', x ->> 'form',
           case when x ->> 'short' in ('id', 'at', 'supra', 'section', 'rule') then x ->> 'short' end,
           case when x ->> 'short_status' in ('resolved', 'ambiguous', 'none') then x ->> 'short_status' end,
           (x ->> 'start')::integer, (x ->> 'end')::integer, x ->> 'matched', x ->> 'key', left(x ->> 'normalized', 300),
           left(x ->> 'pin', 60), case when (x ->> 'group') ~ '^[0-9]{1,6}$' then (x ->> 'group')::integer end,
           left(case when jsonb_typeof(x -> 'name') = 'object' then x -> 'name' ->> 'text' else x ->> 'name' end, 300),
           case when jsonb_typeof(x -> 'antecedent') = 'object' and (x -> 'antecedent' ->> 'page') ~ '^[0-9]{1,5}$'
                     and (x -> 'antecedent' ->> 'seq') ~ '^[0-9]{1,4}$'
                then jsonb_build_object('page', (x -> 'antecedent' ->> 'page')::integer, 'seq', (x -> 'antecedent' ->> 'seq')::integer) end,
           case when jsonb_typeof(x -> 'fields') = 'object' then x -> 'fields' else '{}'::jsonb end, p_version
      from jsonb_array_elements(v_ok) x
    on conflict (src, src_id, page, seq) do update set kind = excluded.kind, form = excluded.form, short_type = excluded.short_type,
      short_status = excluded.short_status, start_offset = excluded.start_offset, end_offset = excluded.end_offset,
      matched = excluded.matched, key = excluded.key, normalized = excluded.normalized, pin = excluded.pin, grp = excluded.grp,
      case_name = excluded.case_name, antecedent = excluded.antecedent, fields = excluded.fields, extractor_version = excluded.extractor_version;

    insert into citations.authorities (key, kind, normalized)
    select distinct on (x ->> 'key') x ->> 'key', x ->> 'kind', left(x ->> 'normalized', 300)
      from jsonb_array_elements(v_ok) x where x ->> 'key' is not null and x ->> 'kind' <> 'short'
     order by x ->> 'key', x ->> 'form'
    on conflict (key) do nothing;

    insert into citations.page_state (src, src_id, page, extractor_version, citations, rejected, run_id)
    values ('pdf', v_sha, v_page, p_version, n_ok, (select count(*) from jsonb_array_elements(pg -> 'citations')) - n_ok, p_run)
    on conflict (src, src_id, page) do update set extractor_version = excluded.extractor_version, citations = excluded.citations,
      rejected = excluded.rejected, run_id = excluded.run_id, extracted_at = now();
    t_ok := t_ok + n_ok; t_pages := t_pages + 1;
    t_bad := t_bad + (select count(*) from jsonb_array_elements(pg -> 'citations'))::integer - n_ok;
  end loop;

  update citations.runs r set pages_loaded = r.pages_loaded + t_pages, citations_accepted = r.citations_accepted + t_ok,
         citations_rejected = r.citations_rejected + t_bad,
         rejected = (select coalesce(jsonb_object_agg(k, coalesce((r.rejected ->> k)::integer, 0) + coalesce((v_rejected ->> k)::integer, 0)), '{}'::jsonb)
                       from (select jsonb_object_keys(r.rejected) k union select jsonb_object_keys(v_rejected)) ks)
   where r.id = p_run;
  return jsonb_build_object('pages', t_pages, 'accepted', t_ok, 'rejected', v_rejected, 'rejected_sample', v_sample);
end $$;

-- ------------------------------------------------------------------------------------------------ resolve and link
-- Resolves up to p_limit pending authorities (exact; see citations.resolve_key).
create or replace function public.citations_resolve_v2(p_limit integer default 5000, p_run uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; v jsonb; n integer := 0; v_pending integer;
begin
  if p_limit is null or p_limit not between 1 and 50000 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  for a in select x.key, x.normalized from citations.authorities x where x.resolution = 'pending' order by x.key limit p_limit loop
    v := citations.resolve_key(a.key, a.normalized);
    update citations.authorities set resolution = v ->> 'resolution', reason = v ->> 'reason', resolver = v ->> 'resolver',
           target_dataset = case when v ->> 'resolution' = 'resolved' then v ->> 'dataset' end,
           target_id = case when v ->> 'resolution' = 'resolved' then v ->> 'id' end,
           target_title = case when v ->> 'resolution' = 'resolved' then left(v ->> 'title', 300) end,
           candidates = case when v ->> 'resolution' = 'ambiguous' then v -> 'candidates' end,
           link_type = case when v ->> 'resolution' = 'resolved' then v ->> 'link_type' end,
           link_id = case when v ->> 'resolution' = 'resolved' then v ->> 'link_id' end,
           resolved_at = now()
     where key = a.key;
    n := n + 1;
  end loop;
  if p_run is not null then update citations.runs set authorities_resolved = authorities_resolved + n where id = p_run and status = 'running'; end if;
  select count(*) into v_pending from citations.authorities where resolution = 'pending';
  return jsonb_build_object('resolved_batch', n, 'pending', v_pending,
    'by_resolution', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from
                       (select kind || ':' || resolution k, count(*) c from citations.authorities group by 1) s));
end $$;

-- Puts authorities back to pending (e.g. once a resolver named in the header is installed):
-- p_reason (e.g. 'unresolved_target_missing') and/or p_kind; at least one is required.
create or replace function public.citations_requeue_v2(p_kind text default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_kind is null and p_reason is null then raise exception 'Name a kind or a reason' using errcode = '22023'; end if;
  with q as (update citations.authorities set resolution = 'pending', reason = null, target_dataset = null, target_id = null,
                    target_title = null, candidates = null, link_type = null, link_id = null, resolver = null, resolved_at = null
              where (p_kind is null or kind = p_kind) and (p_reason is null or reason = p_reason) returning 1)
  select count(*) into n from q;
  return jsonb_build_object('requeued', n);
end $$;

-- Rebuilds the edges of the documents whose bytes are in p_shas, or of the next p_limit byte sets after p_after (sha256
-- order). A local rule cited without a court ("Local Rule 7.1") is read as a rule of the citing document's court.
create or replace function public.citations_link_v2(p_shas text[] default null, p_after text default '', p_limit integer default 500,
  p_run uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_shas text[]; n_del integer; n_ins integer; n_docs integer; v_last text;
begin
  if p_limit is null or p_limit not between 1 and 5000 or length(coalesce(p_after, '')) > 64 then
    raise exception 'Invalid batch' using errcode = '22023'; end if;
  if p_shas is not null then
    if cardinality(p_shas) > 5000 or exists (select 1 from unnest(p_shas) s where s !~ '^[0-9a-f]{64}$') then
      raise exception 'Invalid byte sets' using errcode = '22023'; end if;
    v_shas := p_shas;
  else
    select array_agg(x.sha256 order by x.sha256) into v_shas
      from (select ps.sha256 from documents.page_sets ps where ps.status = 'indexed' and ps.sha256 > coalesce(p_after, '')
             order by ps.sha256 limit p_limit) x;
  end if;
  if v_shas is null or cardinality(v_shas) = 0 then
    return jsonb_build_object('byte_sets', 0, 'documents', 0, 'edges', 0, 'last', null, 'done', true); end if;
  v_last := v_shas[cardinality(v_shas)];

  with gone as (delete from citations.edges e
                 where e.citing_type = 'document'
                   and e.citing_id in (select d.id from documents.documents d where d.sha256 = any(v_shas)) returning 1)
  select count(*) into n_del from gone;

  with occ as (
    select d.id as doc, o.page, o.start_offset, o.end_offset, o.form, o.pin, o.extractor_version,
           case when o.key like 'local-rule::%' and d.court_id ~ '^[a-z0-9]{2,8}$' then 'local-rule:@' || d.court_id || substr(o.key, 12)
                else o.key end as key
      from citations.occurrences o
      join documents.documents d on d.sha256 = o.src_id and d.text_status in ('text_layer', 'partial_text')
     where o.src = 'pdf' and o.src_id = any(v_shas) and o.key is not null and o.kind <> 'short'),
  agg as (
    select occ.doc, occ.key, count(*)::integer as mentions, count(*) filter (where occ.form = 'full')::integer as full_mentions,
           count(*) filter (where occ.form = 'short')::integer as short_mentions,
           (array_agg(occ.page order by occ.page, occ.start_offset))[1] as first_page,
           (array_agg(occ.start_offset order by occ.page, occ.start_offset))[1] as first_start,
           (array_agg(occ.end_offset order by occ.page, occ.start_offset))[1] as first_end,
           (array_agg(distinct occ.page order by occ.page))[1:50] as pages,
           coalesce((array_agg(distinct occ.pin order by occ.pin) filter (where occ.pin is not null))[1:30], '{}') as pins,
           max(occ.extractor_version) as extractor_version
      from occ where occ.key is not null group by occ.doc, occ.key),
  ins as (
    insert into citations.edges (citing_type, citing_id, key, kind, relation, mentions, full_mentions, short_mentions, first_page,
      first_start, first_end, pages, pins, extractor_version)
    select 'document', agg.doc, agg.key, citations.key_kind(agg.key),
           case when citations.key_kind(agg.key) in ('mdl', 'docket') then 'mentions' else 'cites' end,
           agg.mentions, agg.full_mentions, agg.short_mentions, agg.first_page, agg.first_start, agg.first_end, agg.pages, agg.pins,
           agg.extractor_version
      from agg
    returning 1)
  select count(*) into n_ins from ins;

  -- authorities for the court-qualified local rules created above
  insert into citations.authorities (key, kind, normalized)
  select distinct e.key, 'local_rule', 'Local Rule ' || split_part(e.key, ':', 3) || ' (' || substr(split_part(e.key, ':', 2), 2) || ')'
    from citations.edges e
   where e.citing_type = 'document' and e.key like 'local-rule:@%'
     and e.citing_id in (select d.id from documents.documents d where d.sha256 = any(v_shas))
  on conflict (key) do nothing;

  select count(distinct d.id) into n_docs from documents.documents d where d.sha256 = any(v_shas)
     and exists (select 1 from citations.edges e where e.citing_type = 'document' and e.citing_id = d.id);
  if p_run is not null then update citations.runs set documents_linked = documents_linked + n_docs where id = p_run and status = 'running'; end if;
  return jsonb_build_object('byte_sets', cardinality(v_shas), 'documents', n_docs, 'edges', n_ins, 'edges_replaced', n_del,
                            'last', v_last, 'done', p_shas is null and cardinality(v_shas) < p_limit);
end $$;

-- ------------------------------------------------------------------------------------------------ read RPCs
-- An authority node as returned by the read RPCs.
create or replace function citations.node_json(a citations.authorities) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('node', citations.node_id(a.resolution, a.target_dataset, a.target_id, a.key), 'key', a.key, 'kind', a.kind,
    'label', coalesce(a.normalized, a.key), 'resolution', a.resolution, 'reason', a.reason,
    'target', case when a.resolution = 'resolved' then jsonb_build_object('dataset', a.target_dataset, 'id', a.target_id, 'title', a.target_title) end,
    'candidates', a.candidates)
$$;

-- keys of a node: p_key alone, or every key resolved to the same record (parallel citations of one decision)
create or replace function citations.node_keys(p_key text, p_dataset text, p_id text) returns text[]
language sql stable security definer set search_path = '' as $$
  select case
    when p_dataset is not null and p_id is not null then
      (select coalesce(array_agg(a.key order by a.key), '{}') from citations.authorities a
        where a.resolution = 'resolved' and a.target_dataset = p_dataset and a.target_id = p_id)
    else
      (select coalesce(array_agg(b.key order by b.key), array[p_key]) from citations.authorities a
         join citations.authorities b on a.resolution = 'resolved' and b.resolution = 'resolved'
          and b.target_dataset = a.target_dataset and b.target_id = a.target_id
        where a.key = p_key)
    end
$$;

-- Citations in one document: every cited authority with counts, pages, pins and resolution.
create or replace function public.citations_document_v2(p_document_id text, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d documents.documents; v jsonb;
begin
  if p_document_id is null or p_document_id !~ '^d_[0-9a-f]{24}$' then raise exception 'Invalid document' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  select * into d from documents.documents x where x.id = p_document_id;
  if not found or not documents.is_open(d.source_system, d.native_document_id) then return null; end if;
  if d.text_status not in ('text_layer', 'partial_text') then
    return jsonb_build_object('document', documents.summary(d), 'text_served', false, 'authorities', '[]'::jsonb);
  end if;
  select jsonb_build_object(
    'document', documents.summary(d),
    'text_served', true,
    'pages_extracted', (select count(*) from citations.page_state s where s.src = 'pdf' and s.src_id = d.sha256),
    'extractor_versions', (select coalesce(jsonb_agg(distinct s.extractor_version), '[]'::jsonb) from citations.page_state s
                            where s.src = 'pdf' and s.src_id = d.sha256),
    'total_authorities', (select count(*) from citations.edges e where e.citing_type = 'document' and e.citing_id = d.id),
    'by_kind', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from
                 (select e.kind k, count(*) n from citations.edges e where e.citing_type = 'document' and e.citing_id = d.id group by 1) s),
    'by_resolution', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from
                 (select a.resolution k, count(*) n from citations.edges e join citations.authorities a on a.key = e.key
                   where e.citing_type = 'document' and e.citing_id = d.id group by 1) s),
    'short_forms_unlinked', (select count(*) from citations.occurrences o where o.src = 'pdf' and o.src_id = d.sha256 and o.key is null),
    'authorities', (select coalesce(jsonb_agg(citations.node_json(a) || jsonb_build_object('relation', e.relation, 'mentions', e.mentions,
                      'full_mentions', e.full_mentions, 'short_mentions', e.short_mentions, 'first_page', e.first_page,
                      'pages', to_jsonb(e.pages), 'pins', to_jsonb(e.pins))
                      order by e.relation, e.mentions desc, e.key), '[]'::jsonb)
                      from (select * from citations.edges e where e.citing_type = 'document' and e.citing_id = d.id
                             order by e.mentions desc, e.key limit p_limit) e
                      left join citations.authorities a on a.key = e.key))
  into v;
  return v;
end $$;

-- Documents citing an authority node (p_key, or p_dataset + p_id of a resolved record), with counts by MDL, court and year.
create or replace function public.citations_cited_by_v2(p_key text default null, p_dataset text default null, p_id text default null,
  p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_keys text[]; v jsonb; a citations.authorities;
begin
  if p_limit is null or p_limit not between 0 and 100 or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'Invalid page' using errcode = '22023'; end if;
  if (p_key is null) = (p_dataset is null or p_id is null) or length(coalesce(p_key, '')) > 200
     or length(coalesce(p_dataset, '')) > 80 or length(coalesce(p_id, '')) > 120 then
    raise exception 'Name a key or a dataset and record id' using errcode = '22023'; end if;
  v_keys := citations.node_keys(p_key, p_dataset, p_id);
  select * into a from citations.authorities x where x.key = coalesce(p_key, v_keys[1]);
  if not found then return null; end if;
  with e as (
    select e.citing_id, sum(e.mentions)::integer mentions, min(e.first_page) first_page,
           (select coalesce(array_agg(distinct p order by p), '{}') from citations.edges e2 cross join lateral unnest(e2.pins) p
             where e2.citing_type = 'document' and e2.citing_id = e.citing_id and e2.key = any(v_keys)) pins
      from citations.edges e where e.citing_type = 'document' and e.key = any(v_keys) group by e.citing_id),
  s as materialized (
    select e.*, d from e join documents.documents d on d.id = e.citing_id
     where d.text_status in ('text_layer', 'partial_text') and documents.is_open(d.source_system, d.native_document_id))
  select jsonb_build_object(
    'authority', citations.node_json(a),
    'keys', to_jsonb(v_keys),
    'documents', (select count(*) from s),
    'mentions', (select coalesce(sum(s.mentions), 0) from s),
    'by_mdl', (select coalesce(jsonb_agg(jsonb_build_array(t.k, t.n) order by t.n desc, t.k), '[]'::jsonb) from
                (select (s.d).mdl k, count(*) n from s group by 1) t),
    'by_court', (select coalesce(jsonb_agg(jsonb_build_array(t.k, t.n) order by t.n desc, t.k), '[]'::jsonb) from
                (select coalesce((s.d).court_id, 'not_recorded') k, count(*) n from s group by 1) t),
    'by_year', (select coalesce(jsonb_agg(jsonb_build_array(t.y, t.n) order by t.y), '[]'::jsonb) from
                (select extract(year from (s.d).filed_date)::integer y, count(*) n from s where (s.d).filed_date is not null group by 1) t),
    'undated', (select count(*) from s where (s.d).filed_date is null),
    'list', (select coalesce(jsonb_agg(documents.summary(x.d) || jsonb_build_object('mentions', x.mentions, 'first_page', x.first_page,
                                                                                    'pins', to_jsonb(x.pins[1:10]))
                                       order by (x.d).filed_date desc nulls last, x.citing_id), '[]'::jsonb)
               from (select * from s order by (s.d).filed_date desc nulls last, s.citing_id offset p_offset limit p_limit) x))
  into v;
  return v;
end $$;

-- Most-cited authority nodes in the filings of one MDL (p_mdl) or of the whole layer (null), by citing documents.
create or replace function public.citations_top_authorities_v2(p_mdl text default null, p_kind text default null, p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_mdl is not null and p_mdl !~ '^[1-9][0-9]{0,5}$' then raise exception 'Invalid MDL' using errcode = '22023'; end if;
  if p_kind is not null and p_kind not in ('case', 'usc', 'cfr', 'cfr_part', 'federal_register', 'statutes_at_large', 'public_law',
      'constitution_us', 'constitution_state', 'federal_rule', 'local_rule', 'state_statute', 'state_regulation', 'mdl', 'docket') then
    raise exception 'Invalid kind' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 200 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  with docs as materialized (
    select d.id, d.filed_date from documents.documents d
     where (p_mdl is null or d.mdl = p_mdl) and d.text_status in ('text_layer', 'partial_text')
       and documents.is_open(d.source_system, d.native_document_id)),
  e as (
    select citations.node_id(a.resolution, a.target_dataset, a.target_id, a.key) node, e.citing_id, e.mentions, e.key, docs.filed_date
      from docs join citations.edges e on e.citing_type = 'document' and e.citing_id = docs.id
      join citations.authorities a on a.key = e.key
     where e.relation = 'cites' and (p_kind is null or e.kind = p_kind)),
  n as (
    select e.node, count(distinct e.citing_id) documents, sum(e.mentions) mentions, min(e.key) key,
           min(extract(year from e.filed_date))::integer first_year, max(extract(year from e.filed_date))::integer last_year
      from e group by e.node order by 2 desc, 3 desc, 1 limit p_limit)
  select jsonb_build_object('mdl', p_mdl, 'kind', p_kind,
    'documents_with_citations', (select count(distinct e.citing_id) from e),
    'authorities', (select coalesce(jsonb_agg(citations.node_json(a) || jsonb_build_object('documents', n.documents, 'mentions', n.mentions,
                      'first_year', n.first_year, 'last_year', n.last_year) order by n.documents desc, n.mentions desc, n.node), '[]'::jsonb)
                      from n join citations.authorities a on a.key = n.key))
  into v;
  return v;
end $$;

-- Co-citation: authority nodes most often cited in the same documents as p_key's node (p_key), or the most frequent pairs
-- among the p_top most-cited nodes of an MDL (p_mdl). Counts are documents citing both.
create or replace function public.citations_cocitations_v2(p_key text default null, p_mdl text default null, p_limit integer default 25,
  p_min integer default 2, p_top integer default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_keys text[]; v jsonb; a citations.authorities;
begin
  if (p_key is null) = (p_mdl is null) then raise exception 'Name a key or an MDL' using errcode = '22023'; end if;
  if p_mdl is not null and p_mdl !~ '^[1-9][0-9]{0,5}$' then raise exception 'Invalid MDL' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 200 or p_min is null or p_min not between 1 and 1000
     or p_top is null or p_top not between 2 and 200 or length(coalesce(p_key, '')) > 200 then
    raise exception 'Invalid limits' using errcode = '22023'; end if;
  if p_key is not null then
    v_keys := citations.node_keys(p_key, null, null);
    select * into a from citations.authorities x where x.key = p_key;
    if not found then return null; end if;
    with base as (select distinct e.citing_id from citations.edges e
                   join documents.documents d on d.id = e.citing_id and documents.is_open(d.source_system, d.native_document_id)
                  where e.citing_type = 'document' and e.key = any(v_keys)),
    other as (
      select citations.node_id(b.resolution, b.target_dataset, b.target_id, b.key) node, count(distinct e.citing_id) together, min(b.key) key
        from base join citations.edges e on e.citing_type = 'document' and e.citing_id = base.citing_id and e.relation = 'cites'
        join citations.authorities b on b.key = e.key
       where not (e.key = any(v_keys))
       group by 1 having count(distinct e.citing_id) >= p_min order by 2 desc, 1 limit p_limit)
    select jsonb_build_object('authority', citations.node_json(a), 'documents', (select count(*) from base),
      'co_cited', (select coalesce(jsonb_agg(citations.node_json(b) || jsonb_build_object('documents_together', o.together)
                     order by o.together desc, o.node), '[]'::jsonb) from other o join citations.authorities b on b.key = o.key))
    into v;
    return v;
  end if;
  with docs as materialized (select d.id from documents.documents d where d.mdl = p_mdl and d.text_status in ('text_layer', 'partial_text')
                               and documents.is_open(d.source_system, d.native_document_id)),
  e0 as materialized (
    select citations.node_id(au.resolution, au.target_dataset, au.target_id, au.key) node, ed.citing_id, au.key
      from docs join citations.edges ed on ed.citing_type = 'document' and ed.citing_id = docs.id and ed.relation = 'cites'
      join citations.authorities au on au.key = ed.key),
  e as materialized (select distinct e0.node, e0.citing_id from e0),
  top as (select e.node from e group by e.node order by count(*) desc, e.node limit p_top),
  et as (select e.* from e join top using (node)),
  pairs as (select x.node na, y.node nb, count(*) together from et x join et y on x.citing_id = y.citing_id and x.node < y.node
             group by 1, 2 having count(*) >= p_min order by 3 desc, 1, 2 limit p_limit),
  rep as (select e0.node, min(e0.key) key from e0 where e0.node in (select pairs.na from pairs union select pairs.nb from pairs) group by e0.node)
  select jsonb_build_object('mdl', p_mdl, 'documents', (select count(distinct e.citing_id) from e),
    'pairs', (select coalesce(jsonb_agg(jsonb_build_object('a', citations.node_json(aa), 'b', citations.node_json(bb), 'documents_together', p.together)
                order by p.together desc, p.na, p.nb), '[]'::jsonb)
                from pairs p join rep ra on ra.node = p.na join citations.authorities aa on aa.key = ra.key
                join rep rb on rb.node = p.nb join citations.authorities bb on bb.key = rb.key))
  into v;
  return v;
end $$;

-- Profile of an authority node: resolution, citing documents by MDL / court / year, first and last citing filing,
-- most frequent co-cited authorities and the latest citing documents.
create or replace function public.citations_authority_v2(p_key text default null, p_dataset text default null, p_id text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; c jsonb; v_key text;
begin
  v := public.citations_cited_by_v2(p_key, p_dataset, p_id, 10, 0);
  if v is null then return null; end if;
  v_key := v -> 'authority' ->> 'key';
  c := public.citations_cocitations_v2(v_key, null, 10, 2, 60);
  return v || jsonb_build_object(
    'co_cited', coalesce(c -> 'co_cited', '[]'::jsonb),
    'occurrences', (select count(*) from citations.occurrences o where o.key = any(citations.node_keys(v_key, null, null))),
    'first_filed', (select min(d.filed_date) from citations.edges e join documents.documents d on d.id = e.citing_id
                     where e.citing_type = 'document' and e.key = any(citations.node_keys(v_key, null, null))
                       and documents.is_open(d.source_system, d.native_document_id)),
    'last_filed', (select max(d.filed_date) from citations.edges e join documents.documents d on d.id = e.citing_id
                     where e.citing_type = 'document' and e.key = any(citations.node_keys(v_key, null, null))
                       and documents.is_open(d.source_system, d.native_document_id)));
end $$;

-- Citation map of one MDL (VIZ-B): the p_authorities most-cited authority nodes and the p_documents filings that cite the
-- most of them, as a bipartite graph. Shape (documented in docs/citations-v2-2026-10-25.md):
--   {mdl, kinds, documents_total, nodes: [{id, type: 'authority', key, kind, label, resolution, target, documents, mentions}
--   | {id, type: 'document', document: <documents.summary>, authorities}], links: [{source, target, mentions}], truncated}
create or replace function public.citations_map_v2(p_mdl text, p_kinds text[] default null, p_authorities integer default 40,
  p_documents integer default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_mdl is null or p_mdl !~ '^[1-9][0-9]{0,5}$' then raise exception 'Invalid MDL' using errcode = '22023'; end if;
  if p_authorities is null or p_authorities not between 1 and 150 or p_documents is null or p_documents not between 1 and 300 then
    raise exception 'Invalid limits' using errcode = '22023'; end if;
  if p_kinds is not null and (cardinality(p_kinds) > 15 or exists (select 1 from unnest(p_kinds) k where k not in ('case', 'usc', 'cfr',
      'cfr_part', 'federal_register', 'statutes_at_large', 'public_law', 'constitution_us', 'constitution_state', 'federal_rule',
      'local_rule', 'state_statute', 'state_regulation'))) then
    raise exception 'Invalid kinds' using errcode = '22023'; end if;
  with docs as materialized (
    select d from documents.documents d where d.mdl = p_mdl and d.text_status in ('text_layer', 'partial_text')
       and documents.is_open(d.source_system, d.native_document_id)),
  e as materialized (
    select citations.node_id(a.resolution, a.target_dataset, a.target_id, a.key) node, e.citing_id, e.mentions, a.key
      from docs join citations.edges e on e.citing_type = 'document' and e.citing_id = (docs.d).id and e.relation = 'cites'
      join citations.authorities a on a.key = e.key
     where p_kinds is null or e.kind = any(p_kinds)),
  an as (select e.node, count(distinct e.citing_id) documents, sum(e.mentions) mentions, min(e.key) key
           from e group by e.node order by 2 desc, 3 desc, 1 limit p_authorities),
  dl as (select e.citing_id, e.node, sum(e.mentions)::integer mentions from e join an using (node) group by 1, 2),
  dn as (select dl.citing_id, count(*) authorities from dl group by 1 order by 2 desc, 1 limit p_documents)
  select jsonb_build_object('mdl', p_mdl, 'kinds', to_jsonb(p_kinds),
    'documents_total', (select count(*) from docs),
    'documents_citing', (select count(distinct e.citing_id) from e),
    'nodes', (select coalesce(jsonb_agg(x order by x ->> 'type', (x ->> 'documents')::integer desc nulls last, x ->> 'id'), '[]'::jsonb) from (
                select citations.node_json(a) || jsonb_build_object('id', an.node, 'type', 'authority', 'documents', an.documents,
                       'mentions', an.mentions) x
                  from an join citations.authorities a on a.key = an.key
                union all
                select jsonb_build_object('id', 'documents/' || dn.citing_id, 'type', 'document', 'authorities', dn.authorities,
                       'document', documents.summary(docs.d))
                  from dn join docs on (docs.d).id = dn.citing_id) n),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('source', 'documents/' || dl.citing_id, 'target', dl.node, 'mentions', dl.mentions)
                order by dl.citing_id, dl.node), '[]'::jsonb) from dl join dn using (citing_id)),
    'truncated', (select count(distinct e.node) from e) > p_authorities or (select count(distinct dl.citing_id) from dl) > p_documents)
  into v;
  return v;
end $$;

-- documents_links_v1 (insights Link) shape over citations.document_links: outgoing for a document (p_type 'record',
-- p_id 'documents/<id>'), else incoming to an entity ('mdl', 'law_unit', or 'record' 'caselaw/<cluster id>').
create or replace function public.citations_links_v2(p_type text, p_id text, p_relation text default null, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_doc text; v jsonb;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  if p_type is null or p_type not in ('record', 'mdl', 'law_unit') or p_id is null or length(p_id) > 120 then
    raise exception 'Invalid entity' using errcode = '22023'; end if;
  if p_relation is not null and p_relation not in ('cites', 'mentions') then raise exception 'Invalid relation' using errcode = '22023'; end if;
  v_doc := case when p_type = 'record' and p_id ~ '^documents/d_[0-9a-f]{24}$' then substr(p_id, 11) end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'from', jsonb_build_object('type', 'record', 'id', 'documents/' || x.document_id),
      'to', jsonb_build_object('type', x.to_type, 'id', x.to_id),
      'relation', x.relation, 'evidence', x.evidence, 'sourceDataset', 'documents', 'sourceRecordId', x.document_id)
      order by x.document_id, x.relation, x.to_type, x.to_id), '[]'::jsonb)
    into v
    from (select l.* from citations.document_links l
           join documents.documents d on d.id = l.document_id and documents.is_open(d.source_system, d.native_document_id)
          where ((v_doc is not null and l.document_id = v_doc) or (v_doc is null and l.to_type = p_type and l.to_id = p_id))
            and (p_relation is null or l.relation = p_relation)
          order by l.document_id, l.relation, l.to_type, l.to_id limit p_limit) x;
  return v;
end $$;

create or replace function public.citations_status_v2() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pages_extracted', (select count(*) from citations.page_state),
    'pages_by_version', (select coalesce(jsonb_object_agg(extractor_version, n), '{}'::jsonb) from
                          (select extractor_version, count(*) n from citations.page_state group by 1) s),
    'byte_sets_extracted', (select count(distinct src_id) from citations.page_state),
    'byte_sets_indexed', (select count(*) from documents.page_sets where status = 'indexed'),
    'occurrences', (select count(*) from citations.occurrences),
    'occurrences_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from citations.occurrences group by 1) s),
    'authorities', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select kind || ':' || resolution k, count(*) n from citations.authorities group by 1) s),
    'unresolved_reasons', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from
                            (select kind || ':' || coalesce(reason, '') k, count(*) n from citations.authorities
                              where resolution in ('unresolved', 'not_in_corpus', 'ambiguous') group by 1) s),
    'edges', (select count(*) from citations.edges),
    'documents_with_edges', (select count(distinct citing_id) from citations.edges),
    'index_rows', jsonb_build_object('fr', (select count(*) from citations.fr_index), 'pl', (select count(*) from citations.pl_index)),
    'resolvers', jsonb_build_object('caselaw_resolve_v2', to_regprocedure('public.caselaw_resolve_v2(text)') is not null,
                                    'state_law_resolve_v1', to_regprocedure('public.state_law_resolve_v1(text,text)') is not null,
                                    'state_reg_resolve_v1', to_regprocedure('public.state_reg_resolve_v1(text,text)') is not null),
    'runs', (select coalesce(jsonb_agg(to_jsonb(r) - 'rejected' order by r.started_at desc), '[]'::jsonb) from
              (select * from citations.runs order by started_at desc limit 10) r),
    'bytes', jsonb_build_object('occurrences', pg_total_relation_size('citations.occurrences'), 'edges', pg_total_relation_size('citations.edges'),
                                'authorities', pg_total_relation_size('citations.authorities'), 'page_state', pg_total_relation_size('citations.page_state')))
$$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.citations_build_index_v2(text,text,integer)', 'public.citations_open_run_v2(text,text,text)',
    'public.citations_finish_run_v2(uuid,text,jsonb,text)', 'public.citations_pending_pages_v2(text,integer,integer)',
    'public.citations_load_v2(uuid,text,jsonb)', 'public.citations_resolve_v2(integer,uuid)', 'public.citations_requeue_v2(text,text)',
    'public.citations_link_v2(text[],text,integer,uuid)', 'public.citations_document_v2(text,integer)',
    'public.citations_cited_by_v2(text,text,text,integer,integer)', 'public.citations_top_authorities_v2(text,text,integer)',
    'public.citations_cocitations_v2(text,text,integer,integer,integer)', 'public.citations_authority_v2(text,text,text)',
    'public.citations_map_v2(text,text[],integer,integer)', 'public.citations_links_v2(text,text,text,integer)',
    'public.citations_status_v2()',
    'citations.key_ok(text,text)', 'citations.key_kind(text)', 'citations.roman_int(text)', 'citations.court_from_slug(text)',
    'citations.call_resolver(text,text,text)', 'citations.read_resolver(text,jsonb)', 'citations.resolve_key(text,text)',
    'citations.node_id(text,text,text,text)', 'citations.node_json(citations.authorities)', 'citations.node_keys(text,text,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

comment on schema citations is 'citations/2: canonical citation occurrences of the indexed court-filing pages, exact resolution to corpus records, and the citing-document -> authority graph. Page text stays in corpus_ingest.pdf_text_pages.';

commit;
