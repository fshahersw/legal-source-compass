-- caselaw-v2 — courts below the Supreme Court beyond the stage-2 tiers, full-text index by tier, citation resolution.
-- Source: CourtListener bulk data 2026-09-30 (the same snapshot as caselaw-read/1). Builders: scripts/caselaw_v2/.
-- Extends caselaw-read-v1.sql (apply that first); nothing of v1 is removed and the v1 RPCs keep their behaviour:
--   * tiers: 1 Supreme Court, 2 federal appellate, 3 state highest (stage 2) and now 4 state intermediate appellate (SA),
--     5 federal district (FD), 6 other federal courts and tribunals (FS, FB, FBP, MA), 7 other state, territorial and
--     tribal courts (ST, SS, TS, TA, TT, TSP, TRS, TRA, TRT, TRX) — keyed on CourtListener's court jurisdiction code;
--   * caselaw_search_v1 / caselaw_courts_v1 are re-created with a tier <= 3 guard so the deployed app keeps seeing the
--     three tiers it was written for; the v2 RPCs serve every tier;
--   * courts gain level (CourtListener jurisdiction code), system, jurisdiction (state), parent and dates;
--   * case rows of tiers 4-7 are loaded without opinions (caselaw_load_cases_v2 never touches opinions) and each unit of
--     the opinions pass attaches its opinion pointers (caselaw_attach_opinions_v2: merge by opinion id);
--   * caselaw.text_v2 holds tsvectors of opinion text by tier (list partitions t2..t7; tier 1 stays in opinion_fts);
--     scope 'full' (every word, 8,000-word parts like v1 format 2) or 'prefix' (the first N words), chosen per load;
--   * caselaw_resolve_v2(p_citation) resolves a citation to a cluster: resolved / ambiguous / unresolved.
-- Every function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Idempotent: create if not exists / create or replace / conditional changes inside DO blocks; nothing is deleted.

begin;

-- ------------------------------------------------------------------------------------------------ tiers 4-7
do $tiers$
declare c record;
begin
  -- the inline v1 checks are "tier in (1, 2, 3)"; they are replaced by 1..7 (validated, so existing rows are checked)
  for c in select conname, conrelid::regclass::text rel from pg_catalog.pg_constraint
           where conrelid in ('caselaw.cases'::regclass, 'caselaw.courts'::regclass) and contype = 'c'
             and conname in ('cases_tier_check', 'courts_tier_check') loop
    execute format('alter table %s drop constraint %I', c.rel, c.conname);
  end loop;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'cases_tier_v2' and conrelid = 'caselaw.cases'::regclass) then
    alter table caselaw.cases add constraint cases_tier_v2 check (tier between 1 and 7) not valid;
    alter table caselaw.cases validate constraint cases_tier_v2;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'courts_tier_v2' and conrelid = 'caselaw.courts'::regclass) then
    alter table caselaw.courts add constraint courts_tier_v2 check (tier between 1 and 7);
  end if;
end $tiers$;

alter table caselaw.courts add column if not exists level text;            -- CourtListener courts.jurisdiction code
alter table caselaw.courts add column if not exists system text;           -- federal / state / territorial / tribal
alter table caselaw.courts add column if not exists jurisdiction text;     -- two-letter state when every courthouse is in one state
alter table caselaw.courts add column if not exists parent_court_id text;
alter table caselaw.courts add column if not exists url text;
alter table caselaw.courts add column if not exists start_date date;
alter table caselaw.courts add column if not exists end_date date;
alter table caselaw.courts add column if not exists in_use boolean;
alter table caselaw.courts add column if not exists cases_with_text integer;
create index if not exists courts_jurisdiction on caselaw.courts (jurisdiction, tier);

-- provenance of a v2 case row: the Caselaw Access Project file CourtListener merged (an exact crosswalk), the source
-- of the row and when the opinions pass attached text to it
alter table caselaw.cases add column if not exists cap_file text;
alter table caselaw.cases add column if not exists source text;
alter table caselaw.cases add column if not exists attached_build text;
create index if not exists cases_tier_court on caselaw.cases (tier, court_id, date_filed);

-- curated reporter spellings that the punctuation-free cite key does not already unify (variant key -> stored key)
create table if not exists caselaw.reporter_alias (
  variant text primary key check (variant ~ '^[a-z0-9]{1,40}$'),
  canonical text not null check (canonical ~ '^[a-z0-9]{1,40}$'),
  note text not null
);
alter table caselaw.reporter_alias enable row level security;
insert into caselaw.reporter_alias(variant, canonical, note) values
  ('fedappx', 'fappx', 'Fed. Appx. -> F. App''x'),
  ('fapp', 'fappx', 'F. App. -> F. App''x'),
  ('f2nd', 'f2d', 'F.2nd -> F.2d'), ('f3rd', 'f3d', 'F.3rd -> F.3d'), ('f4th', 'f4th', 'F.4th'),
  ('fsupp2nd', 'fsupp2d', 'F. Supp. 2nd -> F. Supp. 2d'), ('fsupp3rd', 'fsupp3d', 'F. Supp. 3rd -> F. Supp. 3d'),
  ('ledsecond', 'led2d', 'L. Ed. second -> L. Ed. 2d'), ('lawyersed', 'led', 'Lawyers'' Ed. -> L. Ed.'),
  ('sct', 'sct', 'S. Ct.'), ('supct', 'sct', 'Sup. Ct. -> S. Ct.'),
  ('us', 'us', 'U.S.'), ('usreports', 'us', 'U.S. Reports -> U.S.'),
  ('so2nd', 'so2d', 'So.2nd -> So. 2d'), ('so3rd', 'so3d', 'So.3rd -> So. 3d'),
  ('ne2nd', 'ne2d', 'N.E.2nd -> N.E.2d'), ('ne3rd', 'ne3d', 'N.E.3rd -> N.E.3d'),
  ('nw2nd', 'nw2d', 'N.W.2nd -> N.W.2d'), ('se2nd', 'se2d', 'S.E.2nd -> S.E.2d'), ('sw2nd', 'sw2d', 'S.W.2nd -> S.W.2d'),
  ('sw3rd', 'sw3d', 'S.W.3rd -> S.W.3d'), ('p2nd', 'p2d', 'P.2nd -> P.2d'), ('p3rd', 'p3d', 'P.3rd -> P.3d'),
  ('a2nd', 'a2d', 'A.2nd -> A.2d'), ('a3rd', 'a3d', 'A.3rd -> A.3d'),
  ('calrptr2nd', 'calrptr2d', 'Cal. Rptr. 2nd -> Cal. Rptr. 2d'), ('calrptr3rd', 'calrptr3d', 'Cal. Rptr. 3rd -> Cal. Rptr. 3d'),
  ('nys2nd', 'nys2d', 'N.Y.S.2nd -> N.Y.S.2d'), ('nys3rd', 'nys3d', 'N.Y.S.3rd -> N.Y.S.3d')
on conflict (variant) do nothing;

-- ------------------------------------------------------------------------------------------------ text index by tier
create table if not exists caselaw.text_v2 (
  tier smallint not null check (tier between 2 and 7),
  opinion_id bigint not null,
  part smallint not null check (part >= 0),
  cluster_id bigint not null,
  court_id text not null,
  date_filed date,
  type text,
  scope text not null check (scope in ('full', 'prefix')),
  words integer not null check (words >= 0),      -- words of the whole opinion text
  tsv tsvector not null,
  tsv_mode smallint not null default 0 check (tsv_mode in (0, 1, 2)),  -- 0 full, 1 positions stripped, 2 truncated
  text_sha256 text not null check (text_sha256 ~ '^[a-f0-9]{64}$'),
  build text not null,
  primary key (tier, opinion_id, part)
) partition by list (tier);
do $parts$
declare t integer;
begin
  for t in 2 .. 7 loop
    if to_regclass(format('caselaw.text_v2_t%s', t)) is null then
      execute format('create table caselaw.text_v2_t%s partition of caselaw.text_v2 for values in (%s)', t, t);
    end if;
    execute format('alter table caselaw.text_v2_t%s enable row level security', t);
  end loop;
end $parts$;
create index if not exists text_v2_tsv on caselaw.text_v2 using gin (tsv);
create index if not exists text_v2_court_date on caselaw.text_v2 (court_id, date_filed);
create index if not exists text_v2_cluster on caselaw.text_v2 (cluster_id);
alter table caselaw.text_v2 enable row level security;
alter table caselaw.reporter_alias enable row level security;
revoke all on all tables in schema caselaw from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ helpers
create or replace function caselaw.type_rank(p text) returns integer
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(array_position(array['010combined', '015unamimous', '020lead', '025plurality', '030concurrence',
    '035concurrenceinpart', '040dissent', '050addendum', '060remittitur', '070rehearing', '080onthemerits',
    '090onmotiontostrike', '100trialcourt'], p), 14)
$$;

-- reporter -> key: lower case, punctuation and spaces removed, "2nd"/"3rd" after a letter or digit -> "2d"/"3d"
create or replace function caselaw.reporter_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^[:alnum:]]+', '', 'g'),
    '2nd$', '2d'), '3rd$', '3d')
$$;

-- One citation string -> its parts. Accepted shapes (anything else: null):
--   "<volume> <reporter> <page>[, <pin>][ (<court> <year>)]"      e.g. 410 U.S. 113, 120 (1973) / 5 F.4th 1 (9th Cir. 2021)
--   "<year>-<State>-<number>" / "<year> <ST> <number>"              neutral citations, e.g. 2021-Ohio-1234, 2019 IL 123456
create or replace function caselaw.parse_citation(p text) returns jsonb
language plpgsql immutable parallel safe set search_path = '' as $$
declare s text; m text[]; v_year integer; v_paren text; v_pin text; v_court text; v_parallel integer := 0;
begin
  if p is null or length(p) > 200 then return null; end if;
  s := btrim(regexp_replace(replace(replace(p, '’', ''''), chr(160), ' '), '\s+', ' ', 'g'));
  s := regexp_replace(s, '[.;,]\s*$', '');
  -- trailing parenthetical: "(1973)", "(9th Cir. 2021)", "(Tex. App.—Houston [1st Dist.] 2004, no pet.)"
  m := regexp_match(s, '^(.*\S)\s*\(([^()]*)\)$');
  if m is not null then
    s := m[1]; v_paren := m[2];
    v_year := (regexp_match(v_paren, '(1[6-9][0-9]{2}|20[0-9]{2})'))[1]::integer;
    v_court := nullif(btrim(regexp_replace(v_paren, '[,]?\s*(1[6-9][0-9]{2}|20[0-9]{2}).*$', '')), '');
  end if;
  -- parallel citations ("410 U.S. 113, 93 S. Ct. 705"): the first one is resolved, the others are reported
  m := regexp_split_to_array(s, ',\s+(?=[0-9]{1,5}\s+[A-Z])');
  s := m[1]; v_parallel := cardinality(m) - 1;
  -- pin cite: ", 120" / ", 120-21" / " at 120"
  m := regexp_match(s, '^(.*\S)(?:,\s*|\s+at\s+)([0-9][0-9,\-–n.& ]{0,30})$');
  if m is not null and m[1] ~ '\s[0-9][0-9,]*[A-Za-z]{0,2}$' then
    s := m[1]; v_pin := btrim(m[2]);
  end if;
  -- neutral: 2021-Ohio-1234
  m := regexp_match(s, '^((?:1[6-9]|20)[0-9]{2})-([A-Za-z]{2,12})-([0-9]{1,7})$');
  if m is not null then
    return jsonb_build_object('volume', m[1], 'reporter', m[2], 'page', m[3], 'pin', v_pin, 'year', coalesce(v_year, m[1]::integer),
      'court', v_court, 'cite_key', m[1] || caselaw.reporter_key(m[2]) || m[3], 'shape', 'neutral_hyphen', 'parallel_ignored', v_parallel);
  end if;
  m := regexp_match(s, '^([0-9]{1,5})\s+([A-Za-z][A-Za-z0-9.''&() -]{0,60}?)\s+([0-9][0-9,]{0,11}[A-Za-z]{0,2}(?:\([A-Za-z]{1,3}\))?)$');
  if m is null then return null; end if;
  return jsonb_build_object('volume', m[1], 'reporter', btrim(m[2]), 'page', m[3], 'pin', v_pin, 'year', v_year, 'court', v_court,
    'cite_key', m[1] || caselaw.reporter_key(m[2]) || lower(regexp_replace(m[3], '[^[:alnum:]]+', '', 'g')),
    'shape', case when m[1] ~ '^(1[6-9]|20)[0-9]{2}$' and m[2] ~ '^[A-Z]{2}( App)?$' then 'neutral' else 'reporter' end,
    'parallel_ignored', v_parallel);
end $$;

create or replace function caselaw.candidate(c caselaw.cases) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('cluster_id', c.cluster_id, 'case_name', c.case_name, 'court_id', c.court_id,
    'court', (select coalesce(k.short_name, k.full_name) from caselaw.courts k where k.court_id = c.court_id),
    'tier', c.tier, 'date_filed', c.date_filed, 'citations', to_jsonb(c.citations), 'precedential_status', c.precedential_status,
    'has_text', jsonb_path_exists(c.opinions, '$[*].o'), 'path', '/cases/' || c.cluster_id)
$$;

create or replace function caselaw.row_summary_v2(c caselaw.cases) returns jsonb
language sql stable set search_path = '' as $$
  select caselaw.row_summary(c) || jsonb_build_object('jurisdiction', (select k.jurisdiction from caselaw.courts k where k.court_id = c.court_id))
$$;

-- ------------------------------------------------------------------------------------------------ v1 behaviour kept
-- (identical to caselaw-read-v1.sql except the tier <= 3 guard: the deployed app parses tiers 1-3 only)
create or replace function public.caselaw_search_v1(p_q text default null, p_tier integer default null, p_court text default null,
  p_from date default null, p_to date default null, p_status text default null, p_sort text default 'relevance',
  p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q tsquery; v_cite text; v_rows jsonb; v_n integer; v_mode text := 'browse';
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 5000 then
    raise exception 'Invalid page' using errcode = '22023'; end if;
  if p_tier is not null and p_tier not in (1, 2, 3) then raise exception 'Invalid tier' using errcode = '22023'; end if;
  if p_court is not null and p_court !~ '^[a-z0-9_-]{1,40}$' then raise exception 'Invalid court' using errcode = '22023'; end if;
  if coalesce(p_sort, 'relevance') not in ('relevance', 'cited', 'newest', 'oldest') then raise exception 'Invalid sort' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('Published', 'Unpublished', 'Errata', 'Separate', 'In-chambers', 'Relating-to', 'Unknown') then
    raise exception 'Invalid status' using errcode = '22023'; end if;
  if p_q is not null and length(p_q) > 300 then raise exception 'Query too long' using errcode = '22023'; end if;
  if caselaw.is_citation(p_q) then v_cite := caselaw.cite_key(p_q); v_mode := 'citation';
  elsif p_q is not null and btrim(p_q) <> '' then v_q := caselaw.name_query(p_q); v_mode := 'name';
    if v_q is null then return jsonb_build_object('mode', 'name', 'rows', '[]'::jsonb, 'has_more', false); end if;
  end if;
  with m as (
    select c as r, case when coalesce(p_sort, 'relevance') = 'relevance' and v_q is not null
                        then (pg_catalog.ts_filter(c.name_tsv, '{a}') @@ v_q)::integer end as k1,
           case when p_sort = 'newest' then c.date_filed end as k2, case when p_sort = 'oldest' then c.date_filed end as k3,
           c.cited_by as k4, c.cluster_id as k5
    from caselaw.cases c
    where c.tier <= 3
      and (v_cite is null or c.cite_keys @> array[v_cite])
      and (v_q is null or c.name_tsv @@ v_q)
      and (p_tier is null or c.tier = p_tier) and (p_court is null or c.court_id = p_court)
      and (p_from is null or c.date_filed >= p_from) and (p_to is null or c.date_filed <= p_to)
      and (p_status is null or c.precedential_status = p_status)
    order by k1 desc nulls last, k2 desc nulls last, k3 asc nulls last, k4 desc nulls last, k5
    limit p_limit + 1 offset p_offset)
  select coalesce(jsonb_agg(caselaw.row_summary(m.r) order by k1 desc nulls last, k2 desc nulls last, k3 asc nulls last, k4 desc nulls last, k5),
                  '[]'::jsonb), count(*)
    into v_rows, v_n
  from m;
  if v_n > p_limit then v_rows := v_rows - p_limit; end if;
  return jsonb_build_object('mode', v_mode, 'rows', v_rows, 'has_more', v_n > p_limit, 'offset', p_offset, 'limit', p_limit);
end $$;

create or replace function public.caselaw_courts_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('court_id', court_id, 'tier', tier, 'full_name', full_name, 'short_name', short_name, 'cases', cases)
                            order by tier, full_name), '[]'::jsonb)
  from caselaw.courts where cases > 0 and tier <= 3
$$;

-- ------------------------------------------------------------------------------------------------ read RPCs (v2)
create or replace function public.caselaw_courts_v2() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('court_id', court_id, 'tier', tier, 'full_name', full_name, 'short_name', short_name,
    'citation_string', citation_string, 'level', level, 'system', system, 'jurisdiction', jurisdiction,
    'parent_court_id', parent_court_id, 'cases', cases, 'cases_with_text', cases_with_text, 'url', url,
    'start_date', start_date, 'end_date', end_date, 'in_use', in_use) order by tier, jurisdiction nulls last, full_name), '[]'::jsonb)
  from caselaw.courts where cases > 0
$$;

-- one case: the caselaw_case_v1 payload plus the court's level/system/jurisdiction and the v2 provenance columns
create or replace function public.caselaw_case_v2(p_cluster_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.caselaw_case_v1(c.cluster_id) || jsonb_build_object(
    'court_level', k.level, 'court_system', k.system, 'jurisdiction', k.jurisdiction, 'parent_court_id', k.parent_court_id,
    'cap_file', c.cap_file, 'source', c.source, 'attached_build', c.attached_build)
  from caselaw.cases c left join caselaw.courts k on k.court_id = c.court_id
  where c.cluster_id = p_cluster_id
$$;

-- names and citations of every tier; filters: tiers, court, jurisdiction (state), system, dates, status
create or replace function public.caselaw_search_v2(p_q text default null, p_tiers integer[] default null, p_court text default null,
  p_jurisdiction text default null, p_system text default null, p_from date default null, p_to date default null,
  p_status text default null, p_sort text default 'relevance', p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q tsquery; v_cite text; v_alias text; v_rows jsonb; v_n integer; v_mode text := 'browse'; v_courts text[]; v_p jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 5000 then
    raise exception 'Invalid page' using errcode = '22023'; end if;
  if p_tiers is not null and (cardinality(p_tiers) not between 1 and 7 or exists (select 1 from unnest(p_tiers) t where t is null or t not between 1 and 7)) then
    raise exception 'Invalid tier' using errcode = '22023'; end if;
  if p_court is not null and p_court !~ '^[a-z0-9_-]{1,40}$' then raise exception 'Invalid court' using errcode = '22023'; end if;
  if p_jurisdiction is not null and p_jurisdiction !~ '^[A-Z]{2}$' then raise exception 'Invalid jurisdiction' using errcode = '22023'; end if;
  if p_system is not null and p_system not in ('federal', 'state', 'territorial', 'tribal') then raise exception 'Invalid system' using errcode = '22023'; end if;
  if coalesce(p_sort, 'relevance') not in ('relevance', 'cited', 'newest', 'oldest') then raise exception 'Invalid sort' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('Published', 'Unpublished', 'Errata', 'Separate', 'In-chambers', 'Relating-to', 'Unknown') then
    raise exception 'Invalid status' using errcode = '22023'; end if;
  if p_q is not null and length(p_q) > 300 then raise exception 'Query too long' using errcode = '22023'; end if;
  if p_jurisdiction is not null or p_system is not null then
    v_courts := array(select k.court_id from caselaw.courts k where (p_jurisdiction is null or k.jurisdiction = p_jurisdiction)
                        and (p_system is null or k.system = p_system) and (p_tiers is null or k.tier = any(p_tiers)));
    if cardinality(v_courts) = 0 then return jsonb_build_object('mode', 'browse', 'rows', '[]'::jsonb, 'has_more', false); end if;
  end if;
  v_p := caselaw.parse_citation(p_q);
  if v_p is not null and (caselaw.is_citation(p_q) or v_p ->> 'shape' = 'neutral_hyphen' or v_p ->> 'pin' is not null or v_p ->> 'year' is not null) then
    v_cite := v_p ->> 'cite_key'; v_mode := 'citation';
    v_alias := (select (v_p ->> 'volume') || a.canonical || lower(regexp_replace(v_p ->> 'page', '[^[:alnum:]]+', '', 'g'))
                from caselaw.reporter_alias a where a.variant = caselaw.reporter_key(v_p ->> 'reporter') and a.canonical <> a.variant);
  elsif p_q is not null and btrim(p_q) <> '' then v_q := caselaw.name_query(p_q); v_mode := 'name';
    if v_q is null then return jsonb_build_object('mode', 'name', 'rows', '[]'::jsonb, 'has_more', false); end if;
  end if;
  with m as (
    select c as r, case when coalesce(p_sort, 'relevance') = 'relevance' and v_q is not null
                        then (pg_catalog.ts_filter(c.name_tsv, '{a}') @@ v_q)::integer end as k1,
           case when p_sort = 'newest' then c.date_filed end as k2, case when p_sort = 'oldest' then c.date_filed end as k3,
           c.cited_by as k4, c.cluster_id as k5
    from caselaw.cases c
    where (v_cite is null or c.cite_keys @> array[v_cite] or (v_alias is not null and c.cite_keys @> array[v_alias]))
      and (v_q is null or c.name_tsv @@ v_q)
      and (p_tiers is null or c.tier = any(p_tiers)) and (p_court is null or c.court_id = p_court)
      and (v_courts is null or c.court_id = any(v_courts))
      and (p_from is null or c.date_filed >= p_from) and (p_to is null or c.date_filed <= p_to)
      and (p_status is null or c.precedential_status = p_status)
    order by k1 desc nulls last, k2 desc nulls last, k3 asc nulls last, k4 desc nulls last, k5
    limit p_limit + 1 offset p_offset)
  select coalesce(jsonb_agg(caselaw.row_summary_v2(m.r) order by k1 desc nulls last, k2 desc nulls last, k3 asc nulls last, k4 desc nulls last, k5),
                  '[]'::jsonb), count(*)
    into v_rows, v_n
  from m;
  if v_n > p_limit then v_rows := v_rows - p_limit; end if;
  return jsonb_build_object('mode', v_mode, 'rows', v_rows, 'has_more', v_n > p_limit, 'offset', p_offset, 'limit', p_limit);
end $$;

-- a court's decisions by year (counts) and one page of its cases
create or replace function public.caselaw_court_years_v2(p_court text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_court is null or p_court !~ '^[a-z0-9_-]{1,40}$' then raise exception 'Invalid court' using errcode = '22023'; end if;
  return (select jsonb_build_object('court_id', p_court,
    'years', coalesce(jsonb_agg(jsonb_build_array(y, n, t) order by y), '[]'::jsonb),
    'undated', (select count(*) from caselaw.cases c where c.court_id = p_court and c.date_filed is null))
  from (select extract(year from c.date_filed)::integer y, count(*) n,
               count(*) filter (where jsonb_path_exists(c.opinions, '$[*].o')) t
        from caselaw.cases c where c.court_id = p_court and c.date_filed is not null group by 1) s);
end $$;

create or replace function public.caselaw_court_cases_v2(p_court text, p_year integer default null, p_sort text default 'newest',
  p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb; v_n integer;
begin
  if p_court is null or p_court !~ '^[a-z0-9_-]{1,40}$' then raise exception 'Invalid court' using errcode = '22023'; end if;
  if p_year is not null and p_year not between 1600 and 2100 then raise exception 'Invalid year' using errcode = '22023'; end if;
  if coalesce(p_sort, 'newest') not in ('newest', 'oldest', 'cited') then raise exception 'Invalid sort' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'Invalid page' using errcode = '22023'; end if;
  with m as (
    select c as r, case when coalesce(p_sort, 'newest') = 'newest' then c.date_filed end k1,
           case when p_sort = 'oldest' then c.date_filed end k2, case when p_sort = 'cited' then c.cited_by end k3, c.cluster_id k4
    from caselaw.cases c
    where c.court_id = p_court
      and (p_year is null or (c.date_filed >= make_date(p_year, 1, 1) and c.date_filed < make_date(p_year + 1, 1, 1)))
    order by k1 desc nulls last, k2 asc nulls last, k3 desc nulls last, k4
    limit p_limit + 1 offset p_offset)
  select coalesce(jsonb_agg(caselaw.row_summary_v2(m.r) order by k1 desc nulls last, k2 asc nulls last, k3 desc nulls last, k4), '[]'::jsonb), count(*)
    into v_rows, v_n from m;
  if v_n > p_limit then v_rows := v_rows - p_limit; end if;
  return jsonb_build_object('rows', v_rows, 'has_more', v_n > p_limit, 'offset', p_offset, 'limit', p_limit);
end $$;

-- full text of every indexed tier (tier 1 from opinion_fts/opinion_fts_part, tiers 2-7 from text_v2)
create or replace function public.caselaw_fulltext_v2(p_q text, p_tiers integer[] default null, p_court text default null,
  p_jurisdiction text default null, p_from date default null, p_to date default null, p_type text default null,
  p_sort text default 'relevance', p_limit integer default 20, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q tsquery; v_rows jsonb; v_n integer; v_courts text[]; v_t1 boolean;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 1000 then
    raise exception 'Invalid page' using errcode = '22023'; end if;
  if p_tiers is not null and (cardinality(p_tiers) not between 1 and 7 or exists (select 1 from unnest(p_tiers) t where t is null or t not between 1 and 7)) then
    raise exception 'Invalid tier' using errcode = '22023'; end if;
  if p_court is not null and p_court !~ '^[a-z0-9_-]{1,40}$' then raise exception 'Invalid court' using errcode = '22023'; end if;
  if p_jurisdiction is not null and p_jurisdiction !~ '^[A-Z]{2}$' then raise exception 'Invalid jurisdiction' using errcode = '22023'; end if;
  if coalesce(p_sort, 'relevance') not in ('relevance', 'cited', 'newest', 'oldest') then raise exception 'Invalid sort' using errcode = '22023'; end if;
  if p_type is not null and p_type !~ '^[0-9]{3}[a-z]{3,30}$' then raise exception 'Invalid type' using errcode = '22023'; end if;
  v_q := caselaw.text_query(p_q);
  if v_q is null then return jsonb_build_object('rows', '[]'::jsonb, 'has_more', false, 'query', null); end if;
  if p_jurisdiction is not null then
    v_courts := array(select k.court_id from caselaw.courts k where k.jurisdiction = p_jurisdiction);
    if cardinality(v_courts) = 0 then return jsonb_build_object('rows', '[]'::jsonb, 'has_more', false, 'query', v_q::text); end if;
  end if;
  v_t1 := (p_tiers is null or 1 = any(p_tiers)) and (p_court is null or p_court = 'scotus') and p_jurisdiction is null;
  with hits as (
    select f.cluster_id, f.opinion_id, f.type, ts_rank_cd(f.tsv, v_q, 32) rk
    from caselaw.opinion_fts f where v_t1 and f.tsv @@ v_q and (p_type is null or f.type = p_type)
    union all
    select f.cluster_id, f.opinion_id, f.type, ts_rank_cd(f.tsv, v_q, 32) rk
    from caselaw.opinion_fts_part f where v_t1 and f.tsv @@ v_q and (p_type is null or f.type = p_type)
    union all
    select f.cluster_id, f.opinion_id, f.type, ts_rank_cd(f.tsv, v_q, 32) rk
    from caselaw.text_v2 f
    where f.tsv @@ v_q and (p_tiers is null or f.tier = any(p_tiers)) and (p_court is null or f.court_id = p_court)
      and (v_courts is null or f.court_id = any(v_courts)) and (p_type is null or f.type = p_type)
      and (p_from is null or f.date_filed >= p_from) and (p_to is null or f.date_filed <= p_to)),
  per_opinion as (select h.cluster_id, h.opinion_id, h.type, max(h.rk) rk from hits h group by 1, 2, 3),
  per_case as (
    select h.cluster_id, max(h.rk) rk, jsonb_agg(jsonb_build_object('opinion_id', h.opinion_id, 'type', h.type) order by h.rk desc, h.opinion_id) matched
    from per_opinion h group by h.cluster_id),
  m as (
    select c as r, p.rk, p.matched, case when coalesce(p_sort, 'relevance') = 'relevance' then p.rk end as k1,
           case when p_sort = 'newest' then c.date_filed end as k2, case when p_sort = 'oldest' then c.date_filed end as k3,
           c.cited_by as k4, c.cluster_id as k5
    from per_case p join caselaw.cases c on c.cluster_id = p.cluster_id
    where (p_from is null or c.date_filed >= p_from) and (p_to is null or c.date_filed <= p_to)
    order by k1 desc nulls last, k2 desc nulls last, k3 asc nulls last, k4 desc nulls last, k5
    limit p_limit + 1 offset p_offset)
  select coalesce(jsonb_agg(caselaw.row_summary_v2(m.r) || jsonb_build_object('rank', round(m.rk::numeric, 5), 'matched', m.matched)
                            order by k1 desc nulls last, k2 desc nulls last, k3 asc nulls last, k4 desc nulls last, k5), '[]'::jsonb), count(*)
    into v_rows, v_n
  from m;
  if v_n > p_limit then v_rows := v_rows - p_limit; end if;
  return jsonb_build_object('rows', v_rows, 'has_more', v_n > p_limit, 'query', v_q::text, 'offset', p_offset, 'limit', p_limit);
end $$;

-- Citation -> case. resolved: exactly one held case carries the citation (after the optional explicit year/court
-- filters); ambiguous: several do (candidates listed, never chosen); unresolved: none does (reason not_held), or the
-- input is not a citation (reason not_a_citation). Blocked cases are never loaded, so they resolve to nothing.
create or replace function public.caselaw_resolve_v2(p_citation text, p_year integer default null, p_court text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_p jsonb; v_key text; v_alias text; v_cands jsonb; v_n integer; v_all integer; v_via text := 'cite_key';
begin
  if p_court is not null and p_court !~ '^[a-z0-9_-]{1,40}$' then raise exception 'Invalid court' using errcode = '22023'; end if;
  if p_year is not null and p_year not between 1600 and 2100 then raise exception 'Invalid year' using errcode = '22023'; end if;
  v_p := caselaw.parse_citation(p_citation);
  if v_p is null then
    return jsonb_build_object('status', 'unresolved', 'reason', 'not_a_citation', 'input', left(p_citation, 200), 'candidates', '[]'::jsonb);
  end if;
  v_key := v_p ->> 'cite_key';
  select count(*) into v_all from caselaw.cases c where c.cite_keys @> array[v_key];
  if v_all = 0 then
    v_alias := (select (v_p ->> 'volume') || a.canonical || lower(regexp_replace(v_p ->> 'page', '[^[:alnum:]]+', '', 'g'))
                from caselaw.reporter_alias a where a.variant = caselaw.reporter_key(v_p ->> 'reporter') and a.canonical <> a.variant);
    if v_alias is not null then
      v_key := v_alias; v_via := 'reporter_alias';
      select count(*) into v_all from caselaw.cases c where c.cite_keys @> array[v_key];
    end if;
  end if;
  with m as (
    select c, c.cited_by k1, c.cluster_id k2 from caselaw.cases c
    where c.cite_keys @> array[v_key]
      and (p_year is null or extract(year from c.date_filed)::integer = p_year)
      and (p_court is null or c.court_id = p_court)
    order by c.cited_by desc nulls last, c.cluster_id limit 21)
  select coalesce(jsonb_agg(caselaw.candidate(m.c) order by m.k1 desc nulls last, m.k2), '[]'::jsonb), count(*) into v_cands, v_n from m;
  return jsonb_build_object(
    'status', case when v_n = 1 then 'resolved' when v_n > 1 then 'ambiguous' else 'unresolved' end,
    'reason', case when v_n = 0 and v_all > 0 then 'filtered_out' when v_n = 0 then 'not_held' end,
    'input', left(p_citation, 200), 'parsed', v_p, 'cite_key', v_key, 'matched_via', case when v_n > 0 then v_via end,
    'filters', jsonb_build_object('year', p_year, 'court', p_court), 'held_with_key', v_all,
    'cluster_id', case when v_n = 1 then (v_cands -> 0 ->> 'cluster_id')::bigint end,
    'candidates', case when v_n > 20 then v_cands - 20 else v_cands end, 'more_candidates', v_n > 20);
end $$;

-- up to 500 citations in one call (worker CITE); each element as caselaw_resolve_v2 returns it, in input order
create or replace function public.caselaw_resolve_many_v2(p_citations text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_citations is null or cardinality(p_citations) not between 1 and 500 then
    raise exception 'Between 1 and 500 citations' using errcode = '22023'; end if;
  return (select jsonb_agg(public.caselaw_resolve_v2(x) order by i) from unnest(p_citations) with ordinality u(x, i));
end $$;

create or replace function public.caselaw_status_v2() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tiers', (select jsonb_object_agg(tier, jsonb_build_object('cases', n, 'with_text', t, 'courts', k)) from (
       select tier, count(*) n, count(*) filter (where jsonb_path_exists(opinions, '$[*].o')) t, count(distinct court_id) k
       from caselaw.cases group by tier) s),
    'builds', (select jsonb_object_agg(build, n) from (select build, count(*) n from caselaw.cases group by build) s),
    'text_v2', (select jsonb_object_agg(tier || '/' || scope, n) from (select tier, scope, count(*) n from caselaw.text_v2 where part = 0 group by 1, 2) s),
    'text_v2_parts', (select count(*) from caselaw.text_v2),
    'objects', (select jsonb_object_agg(kind, n) from (select kind, count(*) n from caselaw.objects group by 1) s),
    'bytes', jsonb_build_object('cases', pg_total_relation_size('caselaw.cases'), 'courts', pg_total_relation_size('caselaw.courts'),
      'text_v2', (select coalesce(sum(pg_total_relation_size(i.inhrelid)), 0) from pg_catalog.pg_inherits i where i.inhparent = 'caselaw.text_v2'::regclass),
      'schema_total', (select sum(pg_total_relation_size(c.oid)) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'caselaw' and c.relkind = 'r')))
$$;

-- ------------------------------------------------------------------------------------------------ load RPCs (builder only)
create or replace function public.caselaw_load_courts_v2(p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'Invalid court batch' using errcode = '22023'; end if;
  insert into caselaw.courts(court_id, tier, full_name, short_name, citation_string, cases, level, system, jurisdiction, parent_court_id,
    url, start_date, end_date, in_use)
  select r ->> 'court_id', (r ->> 'tier')::smallint, r ->> 'full_name', r ->> 'short_name', r ->> 'citation_string',
    coalesce((r ->> 'cases')::integer, 0), r ->> 'level', r ->> 'system', r ->> 'jurisdiction', r ->> 'parent_court_id', r ->> 'url',
    (r ->> 'start_date')::date, (r ->> 'end_date')::date, (r ->> 'in_use')::boolean
  from jsonb_array_elements(p_rows) r
  on conflict (court_id) do update set full_name = excluded.full_name, short_name = excluded.short_name,
    citation_string = excluded.citation_string, level = excluded.level, system = excluded.system, jurisdiction = excluded.jurisdiction,
    parent_court_id = excluded.parent_court_id, url = excluded.url, start_date = excluded.start_date, end_date = excluded.end_date,
    in_use = excluded.in_use,
    -- the tier of a court already holding cases is kept (stage 2 decided it); a new court takes the given tier
    tier = case when caselaw.courts.cases > 0 then caselaw.courts.tier else excluded.tier end;
  get diagnostics n = row_count;
  return n;
end $$;

-- metadata rows of tiers 4-7 (never opinions: those are attached per unit); an identical row is left alone
create or replace function public.caselaw_load_cases_v2(p_build text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_build !~ '^[a-z0-9_.-]{1,40}$' then raise exception 'Invalid build' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'Invalid case batch' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where coalesce((r ->> 'tier')::integer, 0) not between 4 and 7) then
    raise exception 'caselaw_load_cases_v2 loads tiers 4-7 only' using errcode = '22023'; end if;
  -- cited_by is computed for every row before the load (the insights caselaw family sums it; never a placeholder)
  if exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r -> 'cited_by') is distinct from 'number'
             or jsonb_typeof(r -> 'cited_by_cases') is distinct from 'number') then
    raise exception 'Every case row needs cited_by and cited_by_cases' using errcode = '22023'; end if;
  insert into caselaw.cases(cluster_id, tier, court_id, date_filed, date_approx, case_name, case_name_full, docket_number,
    precedential_status, citation_count, cited_by, cited_by_cases, parentheticals, authorities, citations, cite_keys, judges, panel,
    disposition, scdb, opinions, citator, authorities_ref, name_tsv, build, cap_file, source)
  select (r ->> 'cluster_id')::bigint, (r ->> 'tier')::smallint, r ->> 'court_id', (r ->> 'date_filed')::date,
    coalesce((r ->> 'date_approx')::boolean, false), r ->> 'case_name', r ->> 'case_name_full', r ->> 'docket_number',
    r ->> 'precedential_status', (r ->> 'citation_count')::integer, (r ->> 'cited_by')::integer, (r ->> 'cited_by_cases')::integer, 0, 0,
    coalesce(array(select jsonb_array_elements_text(r -> 'citations')), '{}'),
    coalesce(array(select distinct caselaw.cite_key(x) from jsonb_array_elements_text(r -> 'citations') x), '{}'),
    r ->> 'judges', case when jsonb_typeof(r -> 'panel') = 'array' then array(select jsonb_array_elements_text(r -> 'panel')) end,
    r ->> 'disposition', null, '[]'::jsonb, null, null,
    setweight(to_tsvector('simple', caselaw.name_doc(r ->> 'case_name')), 'A')
      || setweight(to_tsvector('simple', caselaw.name_doc(r ->> 'case_name_full')), 'B'),
    p_build, r ->> 'cap_file', r ->> 'source'
  from jsonb_array_elements(p_rows) r
  on conflict (cluster_id) do update set tier = excluded.tier, court_id = excluded.court_id, date_filed = excluded.date_filed,
    date_approx = excluded.date_approx, case_name = excluded.case_name, case_name_full = excluded.case_name_full,
    docket_number = excluded.docket_number, precedential_status = excluded.precedential_status, citation_count = excluded.citation_count,
    cited_by = excluded.cited_by, cited_by_cases = excluded.cited_by_cases, citations = excluded.citations, cite_keys = excluded.cite_keys,
    judges = excluded.judges, panel = excluded.panel, disposition = excluded.disposition, name_tsv = excluded.name_tsv,
    build = excluded.build, cap_file = excluded.cap_file, source = excluded.source
  where caselaw.cases.tier between 4 and 7
    and (caselaw.cases.tier, caselaw.cases.court_id, caselaw.cases.date_filed, caselaw.cases.date_approx, caselaw.cases.case_name,
         caselaw.cases.case_name_full, caselaw.cases.docket_number, caselaw.cases.precedential_status, caselaw.cases.citation_count,
         caselaw.cases.cited_by, caselaw.cases.cited_by_cases, caselaw.cases.citations, caselaw.cases.judges, caselaw.cases.panel,
         caselaw.cases.disposition, caselaw.cases.cap_file, caselaw.cases.source)
    is distinct from
        (excluded.tier, excluded.court_id, excluded.date_filed, excluded.date_approx, excluded.case_name, excluded.case_name_full,
         excluded.docket_number, excluded.precedential_status, excluded.citation_count, excluded.cited_by, excluded.cited_by_cases,
         excluded.citations, excluded.judges, excluded.panel, excluded.disposition, excluded.cap_file, excluded.source);
  get diagnostics n = row_count;
  return n;
end $$;

-- opinion pointers of one unit: [{cluster_id, opinions: [{id, type, author, per_curiam, key, s, n}]}]. Each entry
-- replaces the entry with the same opinion id (or is added); entries stay ordered by CourtListener type, then id. The
-- object key must already be registered (caselaw_load_objects_v1) and the case row must exist (tiers 4-7 only).
create or replace function public.caselaw_attach_opinions_v2(p_build text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; o jsonb; v_ops jsonb; v_new jsonb; v_id integer; v_tier smallint; n integer := 0; missing integer := 0;
  unchanged integer := 0; entries integer := 0;
begin
  if p_build !~ '^[a-z0-9_.-]{1,40}$' then raise exception 'Invalid build' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'Invalid attach batch' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select c.opinions, c.tier into v_ops, v_tier from caselaw.cases c where c.cluster_id = (r ->> 'cluster_id')::bigint for update;
    if not found or v_tier not between 4 and 7 then missing := missing + 1; continue; end if;
    v_new := v_ops;
    for o in select * from jsonb_array_elements(r -> 'opinions') loop
      select id into v_id from caselaw.objects where key = o ->> 'key';
      if v_id is null then raise exception 'Object % is not registered', o ->> 'key' using errcode = '23503'; end if;
      if (o ->> 's')::bigint < 0 or (o ->> 'n')::integer not between 1 and 12000000 then
        raise exception 'Invalid pointer for opinion %', o ->> 'id' using errcode = '22023'; end if;
      v_new := coalesce((select jsonb_agg(e) from jsonb_array_elements(v_new) e where (e ->> 'id')::bigint <> (o ->> 'id')::bigint), '[]'::jsonb)
        || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', (o ->> 'id')::bigint, 'type', o ->> 'type', 'author', o ->> 'author',
             'per_curiam', (o ->> 'per_curiam')::boolean, 'o', v_id, 's', (o ->> 's')::bigint, 'n', (o ->> 'n')::integer)));
      entries := entries + 1;
    end loop;
    v_new := (select coalesce(jsonb_agg(e order by caselaw.type_rank(e ->> 'type'), (e ->> 'id')::bigint), '[]'::jsonb)
              from jsonb_array_elements(v_new) e);
    if v_new is distinct from v_ops then
      update caselaw.cases set opinions = v_new, attached_build = p_build where cluster_id = (r ->> 'cluster_id')::bigint;
      n := n + 1;
    else
      unchanged := unchanged + 1;
    end if;
  end loop;
  return jsonb_build_object('cases_changed', n, 'unchanged', unchanged, 'missing_case', missing, 'entries', entries);
end $$;

-- tsvectors of tier 2-7 opinion text. Rows: [{opinion_id, text, text_sha256, blank: [[start, length], ...]}]; the case
-- (tier, court, date, cluster) is taken from caselaw.cases through the opinion's pointer, never from the input.
-- scope 'full': every word in parts of 8,000 words (+40 overlap); 'prefix': the first p_prefix_words words, one part.
create or replace function public.caselaw_load_text_v2(p_build text, p_scope text, p_rows jsonb, p_prefix_words integer default 2000)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; b record; v tsvector; mode smallint; n integer := 0; unchanged integer := 0; missing integer := 0;
  parts_total integer := 0; t text; pieces text[]; pos integer; w text[]; nw integer; np integer; k integer; chunk text;
  v_id bigint; v_sha text; c record; v_type text;
  c_words constant integer := 8000; c_overlap constant integer := 40;
begin
  if p_build !~ '^[a-z0-9_.-]{1,40}$' then raise exception 'Invalid build' using errcode = '22023'; end if;
  if p_scope not in ('full', 'prefix') then raise exception 'Invalid scope' using errcode = '22023'; end if;
  if p_prefix_words is null or p_prefix_words not between 100 and 8000 then raise exception 'Invalid prefix' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'Invalid text batch' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    t := r ->> 'text'; v_id := (r ->> 'opinion_id')::bigint; v_sha := r ->> 'text_sha256';
    if encode(sha256(convert_to(t, 'UTF8')), 'hex') is distinct from v_sha then
      raise exception 'Text of opinion % does not match its sha256', v_id using errcode = '22023'; end if;
    select x.cluster_id, x.tier, x.court_id, x.date_filed, e ->> 'type' as type into c
    from caselaw.cases x, jsonb_array_elements(x.opinions) e
    where x.cluster_id = (r ->> 'cluster_id')::bigint and (e ->> 'id')::bigint = v_id and e ? 'o';
    if not found or c.tier not between 2 and 7 then missing := missing + 1; continue; end if;
    if exists (select 1 from caselaw.text_v2 f where f.tier = c.tier and f.opinion_id = v_id and f.part = 0 and f.text_sha256 = v_sha
               and f.scope = p_scope and f.cluster_id = c.cluster_id and f.court_id = c.court_id
               and f.date_filed is not distinct from c.date_filed and f.type is not distinct from c.type) then
      unchanged := unchanged + 1; continue;
    end if;
    pieces := '{}'; pos := 0;
    if jsonb_typeof(r -> 'blank') = 'array' then
      for b in select (e ->> 0)::integer st, (e ->> 1)::integer ln from jsonb_array_elements(r -> 'blank') e order by 1 loop
        if b.st >= pos and b.ln between 2 and 24 and b.st + b.ln <= length(t) and substr(t, b.st + 1, b.ln) ~ '^[*][^[:space:]]+$' then
          pieces := pieces || substr(t, pos + 1, b.st - pos) || repeat(' ', b.ln);
          pos := b.st + b.ln;
        end if;
      end loop;
    end if;
    w := regexp_split_to_array(btrim(array_to_string(pieces, '') || substr(t, pos + 1)), '\s+');
    nw := coalesce(array_length(w, 1), 0);
    if p_scope = 'prefix' then np := 1;
    else np := greatest(1, ceil(greatest(nw - c_overlap, 1)::numeric / c_words)::integer); end if;
    -- parts of an earlier version of this opinion's row are replaced (counted CTE, never a bare statement)
    with gone as (delete from caselaw.text_v2 f where f.tier = c.tier and f.opinion_id = v_id returning 1)
    select count(*) into k from gone;
    for k in 0 .. np - 1 loop
      if p_scope = 'prefix' then chunk := array_to_string(w[1 : p_prefix_words], ' ');
      else chunk := array_to_string(w[k * c_words + 1 : (k + 1) * c_words + c_overlap], ' '); end if;
      mode := 0;
      begin
        v := to_tsvector('english', chunk);
      exception when program_limit_exceeded then
        begin
          v := strip(to_tsvector('english', chunk)); mode := 1;
        exception when program_limit_exceeded then
          v := strip(to_tsvector('english', left(chunk, 400000))); mode := 2;
        end;
      end;
      insert into caselaw.text_v2(tier, opinion_id, part, cluster_id, court_id, date_filed, type, scope, words, tsv, tsv_mode, text_sha256, build)
      values (c.tier, v_id, k, c.cluster_id, c.court_id, c.date_filed, c.type, p_scope, nw, v, mode, v_sha, p_build);
    end loop;
    n := n + 1; parts_total := parts_total + np;
  end loop;
  return jsonb_build_object('rows', n, 'parts', parts_total, 'unchanged', unchanged, 'missing', missing);
end $$;

-- court case counts after a load (one pass over caselaw.cases)
create or replace function public.caselaw_refresh_court_counts_v2() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with s as (select court_id, count(*) n, count(*) filter (where jsonb_path_exists(opinions, '$[*].o')) t from caselaw.cases group by 1)
  update caselaw.courts k set cases = s.n, cases_with_text = s.t from s
   where k.court_id = s.court_id and (k.cases, k.cases_with_text) is distinct from (s.n, s.t);
  get diagnostics n = row_count;
  return n;
end $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.caselaw_search_v1(text,integer,text,date,date,text,text,integer,integer)', 'public.caselaw_courts_v1()',
    'public.caselaw_courts_v2()', 'public.caselaw_case_v2(bigint)', 'public.caselaw_search_v2(text,integer[],text,text,text,date,date,text,text,integer,integer)',
    'public.caselaw_court_years_v2(text)', 'public.caselaw_court_cases_v2(text,integer,text,integer,integer)',
    'public.caselaw_fulltext_v2(text,integer[],text,text,date,date,text,text,integer,integer)',
    'public.caselaw_resolve_v2(text,integer,text)', 'public.caselaw_resolve_many_v2(text[])', 'public.caselaw_status_v2()',
    'public.caselaw_load_courts_v2(jsonb)', 'public.caselaw_load_cases_v2(text,jsonb)', 'public.caselaw_attach_opinions_v2(text,jsonb)',
    'public.caselaw_load_text_v2(text,text,jsonb,integer)', 'public.caselaw_refresh_court_counts_v2()',
    'caselaw.type_rank(text)', 'caselaw.reporter_key(text)', 'caselaw.parse_citation(text)', 'caselaw.candidate(caselaw.cases)',
    'caselaw.row_summary_v2(caselaw.cases)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

comment on table caselaw.text_v2 is 'Opinion text tsvectors of tiers 2-7 by tier partition (scope full or prefix); text itself stays in the reading store.';
comment on table caselaw.reporter_alias is 'Curated reporter spellings the punctuation-free cite key does not unify (variant -> stored key).';

commit;
