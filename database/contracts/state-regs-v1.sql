-- state-regs/1 — state administrative codes: coverage (51 jurisdictions), table-of-contents tree, rule text, citation
-- resolution, and the self-updating state register issue index (ingest source state_registers).
--
-- Sources: each state's official publisher (scripts/state_regs/sources.py; coverage measured by probe.py). Rules come only
-- from official government publishers; commercial hosts are never fetched; where the official code is published only by a
-- commercial vendor (or on a state domain operated by one that claims copyright) the state is index-only or blocked.
-- Builders: scripts/state_regs/build.py (stream: fetch -> parse -> exact-text check -> jsonl.gz shard -> drop raw);
-- loader: scripts/state_regs/load.py (calls the load RPCs below in batches). Register issues: the edge function
-- supabase/functions/ingest-state-registers (src/lib/ingest/sources/stateRegisters.ts) writes corpus dataset
-- state_register_issues through public.ingest_upsert_v1 (database/contracts/ingest-v1.sql).
--
-- Invariants:
--   * A citation resolves only to the rule whose key (state_regs.cite_key: the state's pattern table, lowercased, leading
--     zeros dropped) is exactly equal; no key or no rule is "unresolved", several are "ambiguous". Never a nearby rule.
--   * Load RPCs upsert by id; a row identical to the stored one is left untouched; nothing is deleted except by
--     state_reg_prune_v1 (rows of one state from builds other than the named complete build, counted CTE delete).
--   * Text is stored exactly as built (published wording); text_check records the exact-text check against an independent
--     rendering of the response bytes.
-- Every public function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to
-- service_role. Idempotent (create if not exists / create or replace / on conflict). Offline test:
-- scripts/state_regs/state-regs-contract.test.mjs (pglite).

begin;

create schema if not exists state_regs;
revoke all on schema state_regs from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ 1. tables
create table if not exists state_regs.codes (
  state text primary key check (state ~ '^[A-Z]{2}$'),
  code_name text not null,
  cite_form text,
  publisher text not null,
  code_url text not null check (code_url ~ '^https?://'),
  access text not null check (access in ('api', 'html', 'pdf', 'bulk', 'portal', 'none')),
  status text not null check (status in ('official_free', 'official_partial', 'commercial_only', 'vendor_operated', 'paid_official', 'no_compiled_code')),
  blocked_reason text,
  acquisition jsonb not null default '{}',      -- {"text": "acquired|sample|parser_ready|deferred|blocked|index_only", "reason": ..., "builds": [...]}
  probe jsonb not null default '{}',            -- robots verdict, HTTP status, title, currency statements, retrieved_at, sha256
  terms_url text,
  currency text,
  edition text,
  register_name text,
  register_url text check (register_url is null or register_url ~ '^https?://'),
  register_freq text,
  register_note text,
  index_nodes integer not null default 0,
  text_rules integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists state_regs.nodes (
  id text primary key check (id ~ '^[a-z]{2}:[A-Za-z0-9][A-Za-z0-9.:_()/-]{0,120}$'),
  state text not null references state_regs.codes (state),
  parent_id text,
  level text not null check (level ~ '^[a-z][a-z ]{1,30}$'),
  num text,
  heading text,
  agency text,
  citation text,
  source_url text not null check (source_url ~ '^https?://'),
  ordinal integer not null check (ordinal >= 0),
  rule_count integer check (rule_count is null or rule_count >= 0),   -- as listed by the publisher
  rules_loaded integer not null default 0,                            -- rules held here (state_reg_finish_v1)
  build text not null
);
create index if not exists nodes_state_parent on state_regs.nodes (state, parent_id, ordinal);

create table if not exists state_regs.rules (
  id text primary key check (id ~ '^[a-z]{2}:[A-Za-z0-9][A-Za-z0-9.:_()/-]{0,120}$'),
  state text not null references state_regs.codes (state),
  node_id text,
  number text not null,
  citation text not null,
  cite_key text not null,
  heading text,
  agency text,
  text text,
  history text,
  authority text,
  status text not null check (status ~ '^[a-z][a-z ]{1,30}$'),
  emergency boolean,
  effective_date date,
  adopted_date date,
  register_citation text,
  source_url text not null check (source_url ~ '^https?://'),
  edition text,
  currency text,
  retrieved_at timestamptz not null,
  raw_sha256 text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
  text_sha256 text check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$'),
  text_check jsonb,
  ordinal integer not null check (ordinal >= 0),
  build text not null,
  tsv tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(citation, '') || ' ' || coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, left(coalesce(text, ''), 200000)), 'D')) stored
);
create unique index if not exists rules_state_key on state_regs.rules (state, cite_key);
create index if not exists rules_node on state_regs.rules (node_id, ordinal);
create index if not exists rules_state_ord on state_regs.rules (state, ordinal);
create index if not exists rules_tsv on state_regs.rules using gin (tsv);

create table if not exists state_regs.cite_patterns (
  state text not null check (state ~ '^[A-Z]{2}$'),
  ord smallint not null,
  pattern text not null,
  template text not null,
  primary key (state, ord)
);

alter table state_regs.codes enable row level security;
alter table state_regs.nodes enable row level security;
alter table state_regs.rules enable row level security;
alter table state_regs.cite_patterns enable row level security;
revoke all on all tables in schema state_regs from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ 2. citation patterns
-- Same rows as scripts/state_regs/cite_patterns.json (a test keeps them identical).
insert into state_regs.cite_patterns as c (state, ord, pattern, template) values
  ('CO', 1, '([0-9]{1,2}) ?CCR ?([0-9]{3,4}-[0-9]{1,3})', '\1-\2'),
  ('FL', 1, '([0-9]{1,3}[A-Z]{0,2}-[0-9]{1,3}[A-Z]?\.[0-9]{3,4}[A-Z]?)', '\1'),
  ('GA', 1, '([0-9]{2,3}-[0-9]{1,3}-[0-9]{1,3}-\.[0-9]{2,3})', '\1'),
  ('IL', 1, '([0-9]{1,2}) ?Ill\.? ?Adm(in)?\.? ?Code,? ?(§ ?)?([0-9]{1,4})\.([0-9]{1,5}[a-z]?)', '\1-\4.\5'),
  ('IL', 2, '([0-9]{1,2}) ?IAC ?(§ ?)?([0-9]{1,4})\.([0-9]{1,5}[a-z]?)', '\1-\3.\4'),
  ('KY', 1, '([0-9]{3}) ?KAR ?([0-9]{1,3}):([0-9]{3})', '\1-\2:\3'),
  ('MD', 1, '([0-9]{2})\.([0-9]{2})\.([0-9]{2})\.([0-9]{2,3}[A-Z]?)', '\1.\2.\3.\4'),
  ('MI', 1, 'R ?([0-9]{2,3}\.[0-9]{1,5}[a-z]?)', '\1'),
  ('MN', 1, '([0-9]{4}\.[0-9]{4})', '\1'),
  ('NC', 1, '([0-9]{1,2}[A-Z]?) ?N\.? ?C\.? ?A\.? ?C\.? ?([0-9]{1,2}[A-Z]{1,2}) ?\.?([0-9]{4})', '\1-\2-\3'),
  ('OH', 1, '([0-9]{3,4}(:[0-9]{1,2})?-[0-9]{1,3}(\.[0-9]{1,2})?-[0-9]{1,3}(\.[0-9]{1,3})?)', '\1'),
  ('OR', 1, '([0-9]{3}-[0-9]{3}-[0-9]{4})', '\1'),
  ('TX', 1, '([0-9]{1,2}) ?(Tex\.? ?Admin\.? ?Code|T\.? ?A\.? ?C\.?),? ?(§+ ?)?([0-9]{1,4}\.[0-9]{1,4})', '\1-\4'),
  ('VA', 1, '([0-9]{1,2}) ?VAC ?([0-9]{1,3})-([0-9]{1,4})-([0-9]{1,5})', '\1-\2-\3-\4'),
  ('WA', 1, '([0-9]{1,3}[A-Z]?-[0-9]{2,3}[A-Z]?-[0-9]{3,5}[A-Z]?)', '\1')
on conflict (state, ord) do update set pattern = excluded.pattern, template = excluded.template
where (c.pattern, c.template) is distinct from (excluded.pattern, excluded.template);

-- ------------------------------------------------------------------------------------------------ 3. helpers
-- The rule key of a citation in the state's form (null when no pattern of the state matches). Mirrors scripts/state_regs/cite.py.
create or replace function state_regs.cite_key(p_state text, p_citation text) returns text
language plpgsql stable set search_path = '' as $$
declare
  t text := btrim(regexp_replace(replace(coalesce(p_citation, ''), chr(160), ' '), '\s+', ' ', 'g'));
  p record; g text[]; k text; prev text; i integer;
begin
  if t = '' or p_state !~ '^[A-Z]{2}$' then return null; end if;
  for p in select pattern, template from state_regs.cite_patterns where state = p_state order by ord loop
    g := regexp_match(t, p.pattern, 'i');
    if g is not null then
      k := p.template;
      for i in reverse coalesce(array_length(g, 1), 0) .. 1 loop
        k := replace(k, '\' || i::text, coalesce(g[i], ''));
      end loop;
      k := lower(k);
      loop
        prev := k;
        k := regexp_replace(k, '(^|[^0-9])0+([0-9])', '\1\2', 'g');
        exit when k = prev;
      end loop;
      return k;
    end if;
  end loop;
  return null;
end $$;

create or replace function state_regs.rule_head(r state_regs.rules) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'state', r.state, 'number', r.number, 'citation', r.citation, 'heading', r.heading,
    'status', r.status, 'emergency', r.emergency, 'effective_date', r.effective_date, 'source_url', r.source_url,
    'node_id', r.node_id, 'chars', length(r.text))
$$;

create or replace function state_regs.node_json(n state_regs.nodes) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', n.id, 'state', n.state, 'parent_id', n.parent_id, 'level', n.level, 'num', n.num,
    'heading', n.heading, 'agency', n.agency, 'citation', n.citation, 'source_url', n.source_url, 'ordinal', n.ordinal,
    'rule_count', n.rule_count, 'rules_loaded', n.rules_loaded,
    'children', (select count(*) from state_regs.nodes c where c.parent_id = n.id))
$$;

-- ------------------------------------------------------------------------------------------------ 4. read RPCs
create or replace function public.state_reg_codes_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'state', c.state, 'code_name', c.code_name, 'cite_form', c.cite_form, 'publisher', c.publisher, 'code_url', c.code_url,
      'access', c.access, 'status', c.status, 'blocked_reason', c.blocked_reason, 'acquisition', c.acquisition,
      'robots', c.probe -> 'robots', 'probe_result', c.probe ->> 'result', 'probe_at', c.probe ->> 'retrieved_at',
      'terms_url', c.terms_url, 'currency', c.currency, 'edition', c.edition, 'register_name', c.register_name,
      'register_url', c.register_url, 'register_freq', c.register_freq, 'register_note', c.register_note,
      'index_nodes', c.index_nodes, 'text_rules', c.text_rules, 'updated_at', c.updated_at) order by c.state), '[]'::jsonb)
  from state_regs.codes c
$$;

-- Children of a node (p_parent null = the top level of the state's code), in the publisher's order.
create or replace function public.state_reg_tree_v1(p_state text, p_parent text default null, p_limit integer default 500,
  p_offset integer default 0) returns jsonb
language sql stable security definer set search_path = '' as $$
  with kids as (
    select n from state_regs.nodes n
    where n.state = p_state and n.parent_id is not distinct from p_parent
    order by n.ordinal limit least(greatest(p_limit, 1), 2000) offset greatest(p_offset, 0))
  select jsonb_build_object(
    'state', p_state,
    'parent', (select state_regs.node_json(p) from state_regs.nodes p where p.id = p_parent and p.state = p_state),
    'path', (with recursive up as (
               select p.id, p.parent_id, p.level, p.num, p.heading, 0 as d from state_regs.nodes p where p.id = p_parent and p.state = p_state
               union all
               select q.id, q.parent_id, q.level, q.num, q.heading, up.d + 1 from state_regs.nodes q join up on q.id = up.parent_id
               where up.d < 12)
             select coalesce(jsonb_agg(jsonb_build_object('id', id, 'level', level, 'num', num, 'heading', heading) order by d desc), '[]'::jsonb) from up),
    'total', (select count(*) from state_regs.nodes n where n.state = p_state and n.parent_id is not distinct from p_parent),
    'nodes', coalesce((select jsonb_agg(state_regs.node_json(k.n) order by (k.n).ordinal) from kids k), '[]'::jsonb),
    'rules', case when p_parent is null then '[]'::jsonb else coalesce((
      select jsonb_agg(state_regs.rule_head(x.r) order by (x.r).ordinal) from (
        select r from state_regs.rules r where r.node_id = p_parent and r.state = p_state order by r.ordinal limit 1000) x), '[]'::jsonb) end)
$$;

create or replace function public.state_reg_rule_v1(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rule', to_jsonb(r) - 'tsv' - 'build' - 'ordinal',
    'path', (with recursive up as (
               select p.id, p.parent_id, p.level, p.num, p.heading, 0 as d from state_regs.nodes p where p.id = r.node_id
               union all
               select q.id, q.parent_id, q.level, q.num, q.heading, up.d + 1 from state_regs.nodes q join up on q.id = up.parent_id
               where up.d < 12)
             select coalesce(jsonb_agg(jsonb_build_object('id', id, 'level', level, 'num', num, 'heading', heading) order by d desc), '[]'::jsonb) from up),
    'prev', (select state_regs.rule_head(x) from state_regs.rules x where x.state = r.state and x.ordinal < r.ordinal order by x.ordinal desc limit 1),
    'next', (select state_regs.rule_head(x) from state_regs.rules x where x.state = r.state and x.ordinal > r.ordinal order by x.ordinal limit 1),
    'code', (select jsonb_build_object('code_name', c.code_name, 'publisher', c.publisher, 'code_url', c.code_url, 'edition', c.edition, 'currency', c.currency)
             from state_regs.codes c where c.state = r.state))
  from state_regs.rules r where r.id = p_id
$$;

-- Full-text search within one state's rules (citation + heading weighted above the body); a query that is itself a
-- citation of the state puts the exactly-resolved rule first.
create or replace function public.state_reg_search_v1(p_state text, p_q text, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  q tsquery;
  k text := state_regs.cite_key(p_state, p_q);
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  hits jsonb; total bigint; exact jsonb;
begin
  if p_state !~ '^[A-Z]{2}$' or length(coalesce(btrim(p_q), '')) < 2 then
    return jsonb_build_object('total', 0, 'hits', '[]'::jsonb, 'exact', null);
  end if;
  if k is not null then
    select state_regs.rule_head(r) into exact from state_regs.rules r where r.state = p_state and r.cite_key = k;
  end if;
  q := websearch_to_tsquery('english'::regconfig, left(p_q, 200));
  if q is null or numnode(q) = 0 then
    return jsonb_build_object('total', case when exact is null then 0 else 1 end, 'hits', '[]'::jsonb, 'exact', exact);
  end if;
  select count(*) into total from state_regs.rules r where r.state = p_state and r.tsv @@ q;
  select coalesce(jsonb_agg(h order by rank desc, ord), '[]'::jsonb) into hits from (
    select state_regs.rule_head(r) || jsonb_build_object('snippet',
             ts_headline('english'::regconfig, left(coalesce(r.text, r.heading, ''), 20000), q,
               'StartSel=«,StopSel=»,MaxWords=30,MinWords=12,MaxFragments=1')) as h,
           ts_rank(r.tsv, q) as rank, r.ordinal as ord
    from state_regs.rules r where r.state = p_state and r.tsv @@ q
    order by ts_rank(r.tsv, q) desc, r.ordinal limit lim offset greatest(coalesce(p_offset, 0), 0)) s;
  return jsonb_build_object('total', total, 'hits', hits, 'exact', exact);
end $$;

-- Resolve a citation to a rule id (worker CITE). status: resolved | ambiguous | unresolved | not_covered | invalid.
-- A citation that is not a rule key of the state, or a key no held rule has, is unresolved: never a nearby rule.
create or replace function public.state_reg_resolve_v1(p_state text, p_citation text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st text := upper(btrim(coalesce(p_state, '')));
  k text; n integer; c record;
begin
  if st !~ '^[A-Z]{2}$' or length(coalesce(p_citation, '')) not between 2 and 300 then
    return jsonb_build_object('status', 'invalid', 'state', st, 'citation', left(p_citation, 300));
  end if;
  select * into c from state_regs.codes where state = st;
  if not found then
    return jsonb_build_object('status', 'not_covered', 'state', st, 'citation', p_citation, 'reason', 'state not in the coverage table');
  end if;
  k := state_regs.cite_key(st, p_citation);
  if k is null then
    return jsonb_build_object('status', 'unresolved', 'state', st, 'citation', p_citation, 'key', null,
      'reason', 'not a rule citation of this state''s administrative code', 'code_url', c.code_url);
  end if;
  select count(*) into n from state_regs.rules where state = st and cite_key = k;
  if n = 1 then
    return (select jsonb_build_object('status', 'resolved', 'state', st, 'citation', p_citation, 'key', k, 'rule_id', r.id,
              'rule', state_regs.rule_head(r)) from state_regs.rules r where r.state = st and r.cite_key = k);
  elsif n > 1 then
    return jsonb_build_object('status', 'ambiguous', 'state', st, 'citation', p_citation, 'key', k,
      'candidates', (select jsonb_agg(state_regs.rule_head(r) order by r.ordinal) from state_regs.rules r where r.state = st and r.cite_key = k));
  end if;
  return jsonb_build_object('status', 'unresolved', 'state', st, 'citation', p_citation, 'key', k,
    'reason', case when c.text_rules = 0 then 'no rule text of this state is held' else 'no held rule has this citation' end,
    'code_url', c.code_url);
end $$;

create or replace function public.state_reg_status_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'codes', (select count(*) from state_regs.codes),
    'nodes', (select count(*) from state_regs.nodes),
    'rules', (select count(*) from state_regs.rules),
    'by_state', coalesce((select jsonb_object_agg(state, jsonb_build_object('nodes', nn, 'rules', rr, 'builds', bb)) from (
       select c.state,
         (select count(*) from state_regs.nodes n where n.state = c.state) nn,
         (select count(*) from state_regs.rules r where r.state = c.state) rr,
         (select coalesce(jsonb_agg(distinct r.build), '[]'::jsonb) from state_regs.rules r where r.state = c.state) bb
       from state_regs.codes c) s where nn > 0 or rr > 0), '{}'::jsonb))
$$;

-- ------------------------------------------------------------------------------------------------ 5. load RPCs (lead)
create or replace function public.state_reg_load_codes_v1(p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'p_rows must be an array'; end if;
  with src as (select * from jsonb_to_recordset(p_rows) as x(state text, code_name text, cite_form text, publisher text,
      code_url text, access text, status text, blocked_reason text, acquisition jsonb, probe jsonb, terms_url text, currency text,
      edition text, register_name text, register_url text, register_freq text, register_note text)),
  up as (
    insert into state_regs.codes as c (state, code_name, cite_form, publisher, code_url, access, status, blocked_reason,
      acquisition, probe, terms_url, currency, edition, register_name, register_url, register_freq, register_note, updated_at)
    select state, code_name, cite_form, publisher, code_url, access, status, blocked_reason, coalesce(acquisition, '{}'),
      coalesce(probe, '{}'), terms_url, currency, edition, register_name, register_url, register_freq, register_note, now() from src
    on conflict (state) do update set code_name = excluded.code_name, cite_form = excluded.cite_form, publisher = excluded.publisher,
      code_url = excluded.code_url, access = excluded.access, status = excluded.status, blocked_reason = excluded.blocked_reason,
      acquisition = excluded.acquisition, probe = excluded.probe, terms_url = excluded.terms_url, currency = excluded.currency,
      edition = excluded.edition, register_name = excluded.register_name, register_url = excluded.register_url,
      register_freq = excluded.register_freq, register_note = excluded.register_note, updated_at = now()
    where (c.code_name, c.cite_form, c.publisher, c.code_url, c.access, c.status, c.blocked_reason, c.acquisition, c.probe,
           c.terms_url, c.currency, c.edition, c.register_name, c.register_url, c.register_freq, c.register_note)
      is distinct from (excluded.code_name, excluded.cite_form, excluded.publisher, excluded.code_url, excluded.access,
           excluded.status, excluded.blocked_reason, excluded.acquisition, excluded.probe, excluded.terms_url, excluded.currency,
           excluded.edition, excluded.register_name, excluded.register_url, excluded.register_freq, excluded.register_note)
    returning 1)
  select count(*) into n from up;
  return n;
end $$;

create or replace function public.state_reg_load_nodes_v1(p_build text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_build !~ '^[a-z0-9_.:-]{3,80}$' then raise exception 'invalid build id'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'p_rows must be an array'; end if;
  with src as (select * from jsonb_to_recordset(p_rows) as x(id text, state text, parent_id text, level text, num text,
      heading text, agency text, citation text, source_url text, ordinal integer, rule_count integer)),
  up as (
    insert into state_regs.nodes as t (id, state, parent_id, level, num, heading, agency, citation, source_url, ordinal, rule_count, build)
    select id, state, parent_id, level, num, heading, agency, citation, source_url, ordinal, rule_count, p_build from src
    on conflict (id) do update set state = excluded.state, parent_id = excluded.parent_id, level = excluded.level, num = excluded.num,
      heading = excluded.heading, agency = excluded.agency, citation = excluded.citation, source_url = excluded.source_url,
      ordinal = excluded.ordinal, rule_count = excluded.rule_count, build = excluded.build
    where (t.state, t.parent_id, t.level, t.num, t.heading, t.agency, t.citation, t.source_url, t.ordinal, t.rule_count, t.build)
      is distinct from (excluded.state, excluded.parent_id, excluded.level, excluded.num, excluded.heading, excluded.agency,
        excluded.citation, excluded.source_url, excluded.ordinal, excluded.rule_count, excluded.build)
    returning 1)
  select count(*) into n from up;
  return n;   -- rows inserted or changed (a row only re-stamped with this build counts too)
end $$;

-- Rules are compared on their content (retrieval time, build and ordinal aside): `written` counts new or changed rules;
-- an unchanged rule is only re-stamped with this build (so state_reg_prune_v1 keeps it).
create or replace function public.state_reg_load_rules_v1(p_build text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare changed integer; total integer; bad text;
begin
  if p_build !~ '^[a-z0-9_.:-]{3,80}$' then raise exception 'invalid build id'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'p_rows must be an array'; end if;
  select x->>'id' into bad from jsonb_array_elements(p_rows) x
   where state_regs.cite_key(x->>'state', x->>'citation') is distinct from x->>'cite_key' limit 1;
  if bad is not null then raise exception 'cite_key differs from state_regs.cite_key for %', bad; end if;
  select count(*) into changed from jsonb_to_recordset(p_rows) as s(id text, state text, node_id text, number text, citation text,
      cite_key text, heading text, agency text, text text, history text, authority text, status text, emergency boolean,
      effective_date date, adopted_date date, register_citation text, source_url text, edition text, currency text,
      retrieved_at timestamptz, raw_sha256 text, text_sha256 text, text_check jsonb, ordinal integer)
    left join state_regs.rules t on t.id = s.id
   where t.id is null
      or (t.node_id, t.number, t.citation, t.heading, t.agency, t.text, t.history, t.authority, t.status, t.emergency,
          t.effective_date, t.adopted_date, t.register_citation, t.source_url, t.edition, t.currency, t.text_check, t.ordinal)
         is distinct from (s.node_id, s.number, s.citation, s.heading, s.agency, s.text, s.history, s.authority, s.status, s.emergency,
          s.effective_date, s.adopted_date, s.register_citation, s.source_url, s.edition, s.currency, s.text_check, s.ordinal);
  insert into state_regs.rules as t (id, state, node_id, number, citation, cite_key, heading, agency, text, history, authority,
    status, emergency, effective_date, adopted_date, register_citation, source_url, edition, currency, retrieved_at, raw_sha256,
    text_sha256, text_check, ordinal, build)
  select id, state, node_id, number, citation, cite_key, heading, agency, text, history, authority, status, emergency,
    effective_date, adopted_date, register_citation, source_url, edition, currency, retrieved_at, raw_sha256, text_sha256,
    text_check, ordinal, p_build from jsonb_to_recordset(p_rows) as x(id text, state text, node_id text, number text, citation text,
      cite_key text, heading text, agency text, text text, history text, authority text, status text, emergency boolean,
      effective_date date, adopted_date date, register_citation text, source_url text, edition text, currency text,
      retrieved_at timestamptz, raw_sha256 text, text_sha256 text, text_check jsonb, ordinal integer)
  on conflict (id) do update set node_id = excluded.node_id, number = excluded.number, citation = excluded.citation,
    cite_key = excluded.cite_key, heading = excluded.heading, agency = excluded.agency, text = excluded.text,
    history = excluded.history, authority = excluded.authority, status = excluded.status, emergency = excluded.emergency,
    effective_date = excluded.effective_date, adopted_date = excluded.adopted_date, register_citation = excluded.register_citation,
    source_url = excluded.source_url, edition = excluded.edition, currency = excluded.currency,
    retrieved_at = case when (t.text, t.heading, t.history) is not distinct from (excluded.text, excluded.heading, excluded.history)
                        then t.retrieved_at else excluded.retrieved_at end,
    raw_sha256 = excluded.raw_sha256, text_sha256 = excluded.text_sha256, text_check = excluded.text_check,
    ordinal = excluded.ordinal, build = excluded.build
  where (t.node_id, t.number, t.citation, t.heading, t.agency, t.text, t.history, t.authority, t.status, t.emergency,
         t.effective_date, t.adopted_date, t.register_citation, t.source_url, t.edition, t.currency, t.text_check, t.ordinal, t.build)
    is distinct from (excluded.node_id, excluded.number, excluded.citation, excluded.heading, excluded.agency, excluded.text,
         excluded.history, excluded.authority, excluded.status, excluded.emergency, excluded.effective_date,
         excluded.adopted_date, excluded.register_citation, excluded.source_url, excluded.edition, excluded.currency,
         excluded.text_check, excluded.ordinal, excluded.build);
  total := jsonb_array_length(p_rows);
  return jsonb_build_object('rows', total, 'written', changed, 'unchanged', total - changed);
end $$;

-- After a state's load: rules held per node, and the code's counts.
create or replace function public.state_reg_finish_v1(p_state text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare nn integer; rr integer;
begin
  update state_regs.nodes n set rules_loaded = coalesce(x.c, 0)
  from (select n2.id, (select count(*) from state_regs.rules r where r.node_id = n2.id) c from state_regs.nodes n2 where n2.state = p_state) x
  where n.id = x.id and n.rules_loaded is distinct from coalesce(x.c, 0);
  select count(*) into nn from state_regs.nodes where state = p_state;
  select count(*) into rr from state_regs.rules where state = p_state and text is not null;
  update state_regs.codes set index_nodes = nn, text_rules = rr, updated_at = now()
  where state = p_state and (index_nodes, text_rules) is distinct from (nn, rr);
  return jsonb_build_object('state', p_state, 'nodes', nn, 'text_rules', rr);
end $$;

-- Remove rows of one state that a complete later build no longer contains (counted; never other states).
create or replace function public.state_reg_prune_v1(p_state text, p_build text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rr integer; nn integer;
begin
  if p_state !~ '^[A-Z]{2}$' or p_build !~ '^[a-z0-9_.:-]{3,80}$' then raise exception 'invalid arguments'; end if;
  if not exists (select 1 from state_regs.rules where state = p_state and build = p_build) then
    raise exception 'build % has no rules for %; nothing pruned', p_build, p_state;
  end if;
  with gone as (delete from state_regs.rules where state = p_state and build <> p_build returning 1) select count(*) into rr from gone;
  with gone as (delete from state_regs.nodes where state = p_state and build <> p_build returning 1) select count(*) into nn from gone;
  return jsonb_build_object('state', p_state, 'build', p_build, 'rules_removed', rr, 'nodes_removed', nn);
end $$;

-- ------------------------------------------------------------------------------------------------ 6. register issue index
-- Corpus dataset written by the ingest source state_registers (edge function ingest-state-registers, weekly).
insert into public.corpus_datasets (id, label, ready, expected_records, imported_records, metadata)
values ('state_register_issues', 'State registers: rulemaking bulletin issues by state (official publishers)', true, 0, 0,
  jsonb_build_object('id', 'state_register_issues', 'label', 'State registers: rulemaking bulletin issues by state (official publishers)',
    'ready', true,
    'listing', jsonb_build_object('page', 1, 'limit', 50, 'total', 0,
      'columns', jsonb_build_array(jsonb_build_object('key', 'publication', 'label', 'Publication'),
        jsonb_build_object('key', 'issue_date', 'label', 'Issue date'), jsonb_build_object('key', 'issue', 'label', 'Volume / issue')),
      'filters', jsonb_build_array(jsonb_build_object('name', 'q', 'type', 'search', 'label', 'Search'))),
    'summary', jsonb_build_object('scope', 'Issues of each state''s official register as listed by its publisher (date, volume/issue, official address); issue contents are not copied.',
      'source', 'scripts/state_regs/sources.py (registers), src/lib/ingest/sources/stateRegisters.ts')))
on conflict (id) do nothing;

insert into ingest.sources as s (id, dataset, label, publisher, source_url, function_name, schedule, stale_after, mode,
  ordinal_policy, category, id_pattern, catalog, terms_note, rate_note)
values
  ('state_registers', 'state_register_issues', 'State register issues', 'State register publishers (secretaries of state, legislative agencies)',
   'https://www.sos.texas.gov/texreg/index.shtml', 'ingest-state-registers', '17 6 * * 2',
   interval '10 days', 'upsert', 'prepend', 'state_register_issues', '^[a-z]{2}-reg:[0-9]{4}-[0-9]{2}(-[0-9]{2})?(:[A-Za-z0-9.-]{1,24})?$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {}}',
   'Official state register listing pages (state government works; issue listings only: date, volume/issue, official address).',
   'One listing page per state per run (at most 20 requests), at least 2 s apart per host; robots.txt honoured by the builder that chose the pages.')
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

-- ------------------------------------------------------------------------------------------------ 7. grants
do $grants$
declare f text;
begin
  foreach f in array array[
    'public.state_reg_codes_v1()', 'public.state_reg_tree_v1(text, text, integer, integer)', 'public.state_reg_rule_v1(text)',
    'public.state_reg_search_v1(text, text, integer, integer)', 'public.state_reg_resolve_v1(text, text)',
    'public.state_reg_status_v1()', 'public.state_reg_load_codes_v1(jsonb)', 'public.state_reg_load_nodes_v1(text, jsonb)',
    'public.state_reg_load_rules_v1(text, jsonb)', 'public.state_reg_finish_v1(text)', 'public.state_reg_prune_v1(text, text)',
    'state_regs.cite_key(text, text)', 'state_regs.rule_head(state_regs.rules)', 'state_regs.node_json(state_regs.nodes)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;
grant usage on schema state_regs to service_role;

commit;
