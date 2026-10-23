-- litviz/1 — precomputed series and bounded read RPCs for the litigation visualizations (wave 1025, worker VIZ-B):
-- MDL lifecycle lanes, the product signal timeline, the citation map and the court hierarchy explorer.
--
-- Sources (read only): public.corpus_records (jpml_pending_history_mdls, jpml_statistics_extra, fjc_civil_mdls, mdls,
-- mdl_analytics, mdl_terminated_history, sw_docket_entries_v1, mdl_docket_activity, fda_faers_product_series,
-- fda_device_event_series, mdl_intel_jpml_stats, us_code_sections, federal_regulations_parts), public.corpus_datasets
-- (snapshot date of fjc_civil_mdls), documents.* (documents-v1.sql), caselaw.cases/courts (caselaw-read-v1.sql) and
-- insights.* (insights-v1.sql). Nothing outside schema `litviz` is written.
--
-- Rules:
--   * A value comes from one published field; nothing is estimated or interpolated; a missing value is no row (the UI
--     says "Not recorded"). Flow counts are zero-filled only between the first and last month the corpus holds for that
--     MDL; the month of p_today is marked ':partial_month'.
--   * Docket entries come from sw_docket_entries_v1 for an MDL it covers, else from mdl_docket_activity (never both).
--   * Product series are the FDA series records that name the MDL themselves (item.mdl); no product is matched to an MDL
--     by name, caption, firm or search term (AGENTS.md: explicit evidence only). Recalls and enforcement reports have
--     no such link in the corpus, so none are attributed here; public.product_signals_v1 (worker SAFETY) supplies them
--     when it maps them.
--   * Citations are documents.links (relation 'cites', evidence exact_id) of documents whose text the layer serves and
--     that are open under documents.is_open(); a citation is a mention, never MDL membership.
--   * Court metrics are the latest complete insights facts; a judge's MDLs are those whose `mdls` record names the judge's
--     profile with judge_match_kind = 'exact'.
-- The series and label derivations have a TypeScript twin (src/lib/litviz/derive.ts) used while these functions are
-- not applied; src/lib/litviz/contract.test.mjs runs both on one fixture and requires identical rows.
--
-- Every function: SECURITY DEFINER (public RPCs) or internal (schema litviz), search_path = '', revoked from
-- public/anon/authenticated, granted to service_role. Idempotent (create if not exists / create or replace).
--
-- Apply, then build once:   select public.litviz_refresh_v1();
-- Schedule (lead, after the documents-nightly job at 05:41 UTC):
--   select cron.schedule('litviz-nightly', '17 6 * * *', $c$select public.litviz_refresh_v1()$c$);

begin;

create schema if not exists litviz;
revoke all on schema litviz from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ tables
create table if not exists litviz.mdl_series (
  mdl text not null check (mdl ~ '^([1-9][0-9]{0,5}|US)$'),
  series text not null check (series ~ '^[a-z][a-z0-9_]{1,40}$'),
  month text not null check (month ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])$'),
  value numeric,
  unit text not null,
  source_dataset text not null,
  source_url text,
  basis text not null,
  primary key (mdl, series, month)
);

create table if not exists litviz.mdl_sources (
  mdl text primary key check (mdl ~ '^[1-9][0-9]{0,5}$'),
  scope text not null check (scope in ('reported', 'historical')),
  src jsonb not null
);

create table if not exists litviz.mdl_meta (
  mdl text primary key check (mdl ~ '^[1-9][0-9]{0,5}$'),
  docket_dataset text,
  docket_total integer not null default 0,
  docket_undated integer not null default 0,
  filings integer not null default 0,
  filings_undated integer not null default 0,
  with_text integer not null default 0,
  citing integer not null default 0,
  cites_unresolved integer not null default 0,
  cites_ambiguous integer not null default 0
);

create table if not exists litviz.authorities (
  to_type text not null check (to_type in ('record', 'law_unit')),
  to_id text not null,
  kind text not null check (kind in ('case', 'usc', 'cfr')),
  class text not null check (class in ('scotus', 'federal_appellate', 'state_high', 'other_court', 'usc', 'cfr')),
  label text not null,
  cite text,
  heading text,
  court_id text,
  court_label text,
  year integer,
  primary key (to_type, to_id)
);

create table if not exists litviz.citations (
  mdl text not null,
  to_type text not null,
  to_id text not null,
  filings integer not null,
  mentions integer not null,
  primary key (mdl, to_type, to_id)
);
create index if not exists citations_authority on litviz.citations (to_type, to_id);

create table if not exists litviz.cocitations (
  mdl text not null,
  a_type text not null,
  a_id text not null,
  b_type text not null,
  b_id text not null,
  filings integer not null,
  primary key (mdl, a_type, a_id, b_type, b_id)
);

create table if not exists litviz.refreshes (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  today date not null,
  counts jsonb
);

alter table litviz.mdl_series enable row level security;
alter table litviz.mdl_sources enable row level security;
alter table litviz.mdl_meta enable row level security;
alter table litviz.authorities enable row level security;
alter table litviz.citations enable row level security;
alter table litviz.cocitations enable row level security;
alter table litviz.refreshes enable row level security;
revoke all on all tables in schema litviz from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ derivations
-- Long series rows (twin: src/lib/litviz/derive.ts). p_today fixes the partial month.
create or replace function litviz.series_rows(p_today date)
returns table (mdl text, series text, month text, value numeric, unit text, source_dataset text, source_url text, basis text)
language sql stable set search_path = '' as $$
  with cur as (select to_char(p_today, 'YYYY-MM') as m),
  -- A. JPML monthly pending reports
  -- (every JSON-array series keeps one line per period: the first printed; a fiscal year prefers a verified line)
  jpml as (
    select distinct on (r.id, p ->> 'month')
           r.id as mdl, 'jpml_pending'::text as series, p ->> 'month' as month, (p ->> 'pending')::numeric as value,
           'actions'::text as unit, 'jpml_pending_history_mdls'::text as source_dataset,
           case when jsonb_typeof(p -> 'source_url') = 'string' then p ->> 'source_url' end as source_url,
           'jpml_monthly_report'::text as basis
      from public.corpus_records r
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.item -> 'history' -> 'series') = 'array'
                                                   then r.item -> 'history' -> 'series' else '[]'::jsonb end)
                 with ordinality e(p, ord)
     where r.dataset = 'jpml_pending_history_mdls' and r.id ~ '^[1-9][0-9]{0,5}$'
       and jsonb_typeof(p) = 'object' and (p ->> 'month') ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])$'
       and jsonb_typeof(p -> 'pending') = 'number'
     order by r.id, p ->> 'month', e.ord),
  -- B. JPML fiscal-year history per MDL
  fyurl as (
    select substr(r.id, 4)::integer as fy, r.source_url from public.corpus_records r
     where r.dataset = 'jpml_statistics_extra' and r.id ~ '^fy:[12][0-9]{3}$'),
  fyp as (
    select distinct on (r.id, (p ->> 'fy')::integer) substr(r.id, 5) as mdl, (p ->> 'fy')::integer as fy, p
      from public.corpus_records r
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.item -> 'fy_history' -> 'series') = 'array'
                                                   then r.item -> 'fy_history' -> 'series' else '[]'::jsonb end)
                 with ordinality e(p, ord)
     where r.dataset = 'jpml_statistics_extra' and r.id ~ '^mdl:[1-9][0-9]{0,5}$'
       and jsonb_typeof(p) = 'object' and (p ->> 'fy') ~ '^[12][0-9]{3}$'
     order by r.id, (p ->> 'fy')::integer, (p ->> 'attribution' = 'verified') desc nulls last, e.ord),
  fy as (
    select f.mdl, s.series, f.fy::text || '-09' as month, (f.p ->> s.field)::numeric as value, 'actions'::text as unit,
           'jpml_statistics_extra'::text as source_dataset, u.source_url,
           (case when f.p ->> 'attribution' = 'verified' then 'jpml_fy_statistical_analysis'
                 else 'jpml_fy_statistical_analysis:attribution_unverified' end)
           || case when s.flow and f.fy = 1992 then ':15_month_period' else '' end as basis
      from fyp f
      cross join (values ('jpml_fy_pending', 'pending', false), ('jpml_fy_closed', 'closed', true),
                         ('jpml_fy_remanded', 'remanded', true)) s(series, field, flow)
      left join fyurl u on u.fy = f.fy
     where jsonb_typeof(f.p -> s.field) = 'number'),
  -- C. FJC IDB civil cases carrying the MDL number, by fiscal year filed (historical association)
  -- "… filing dates through 2026-06-30" (the published snapshot note): the last filing date the extract covers
  fjcsnap as (
    select substring(d.metadata -> 'summary' ->> 'snapshot' from 'through ([12][0-9]{3}-[01][0-9]-[0-3][0-9])') as snapshot
      from public.corpus_datasets d where d.id = 'fjc_civil_mdls'),
  fjc as (
    select distinct on (r.id, p ->> 'fy')
           substr(r.id, 5) as mdl, 'fjc_idb_cases'::text as series, (p ->> 'fy') || '-09' as month,
           (p ->> 'cases')::numeric as value, 'civil cases'::text as unit, 'fjc_civil_mdls'::text as source_dataset,
           coalesce(r.source_url, case when jsonb_typeof(r.item -> 'links' -> 0 -> 'url') = 'string'
                                       then r.item -> 'links' -> 0 ->> 'url' end) as source_url,
           'fjc_idb:historical_association'
           || case when (select s.snapshot from fjcsnap s) is not null
                    and ((p ->> 'fy') || '-09-30') > (select s.snapshot from fjcsnap s) collate "C"
                   then ':partial' else '' end as basis
      from public.corpus_records r
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.item -> 'profile' -> 'by_fy') = 'array'
                                                   then r.item -> 'profile' -> 'by_fy' else '[]'::jsonb end)
                 with ordinality e(p, ord)
     where r.dataset = 'fjc_civil_mdls' and r.id ~ '^mdl:[1-9][0-9]{0,5}$'
       and jsonb_typeof(p) = 'object' and (p ->> 'fy') ~ '^[12][0-9]{3}$' and jsonb_typeof(p -> 'cases') = 'number'
     order by r.id, p ->> 'fy', e.ord),
  -- D. Master-docket entries collected per month (sw_docket_entries_v1, else mdl_docket_activity), zero-filled in span
  sw as (
    select r.item -> 'cells' ->> 'mdl' as mdl, left(r.item -> 'cells' ->> 'date_filed', 7) as month,
           case when jsonb_typeof(r.item -> 'cells' -> 'source_url') = 'string' then r.item -> 'cells' ->> 'source_url' end as url
      from public.corpus_records r
     where r.dataset = 'sw_docket_entries_v1' and (r.item -> 'cells' ->> 'mdl') ~ '^[1-9][0-9]{0,5}$'),
  sw_mdls as (select distinct sw.mdl from sw),
  act as (
    select r.item -> 'cells' ->> 'mdl' as mdl, left(r.item -> 'cells' ->> 'published_at', 7) as month, r.source_url as url
      from public.corpus_records r
     where r.dataset = 'mdl_docket_activity' and (r.item -> 'cells' ->> 'mdl') ~ '^[1-9][0-9]{0,5}$'),
  dk as (
    select sw.mdl, sw.month, 'sw_docket_entries_v1'::text as ds, sw.url from sw
    union all
    select act.mdl, act.month, 'mdl_docket_activity', act.url from act where act.mdl not in (select sw_mdls.mdl from sw_mdls)),
  dk_counts as (
    select dk.mdl, dk.ds, dk.month, count(*)::numeric as n, min(dk.url collate "C") as url
      from dk
     where dk.month ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])$' and dk.month >= '1968-01' and dk.month <= (select cur.m from cur)
     group by 1, 2, 3),
  dk_span as (
    select c.mdl, c.ds, min(c.month) as lo, max(c.month) as hi, min(c.url collate "C") as url from dk_counts c group by 1, 2),
  dk_rows as (
    select s.mdl, 'docket_entries'::text as series, to_char(g, 'YYYY-MM') as month, coalesce(c.n, 0) as value,
           'entries'::text as unit, s.ds as source_dataset, s.url as source_url,
           'master_docket:collected_entries'
           || case when to_char(g, 'YYYY-MM') = (select cur.m from cur) then ':partial_month' else '' end as basis
      from dk_span s
      cross join lateral generate_series(to_date(s.lo || '-01', 'YYYY-MM-DD'), to_date(s.hi || '-01', 'YYYY-MM-DD'),
                                         interval '1 month') g
      left join dk_counts c on c.mdl = s.mdl and c.ds = s.ds and c.month = to_char(g, 'YYYY-MM')),
  -- E. Court filings collected per month (documents layer), zero-filled in span
  docs as (
    select d.mdl, to_char(d.filed_date, 'YYYY-MM') as month, count(*)::numeric as n
      from documents.documents d
     where d.mdl ~ '^[1-9][0-9]{0,5}$' and d.filed_date is not null
     group by 1, 2),
  docs_in as (
    select * from docs where docs.month >= '1968-01' and docs.month <= (select cur.m from cur)),
  doc_span as (select d.mdl, min(d.month) as lo, max(d.month) as hi from docs_in d group by 1),
  doc_rows as (
    select s.mdl, 'filings'::text as series, to_char(g, 'YYYY-MM') as month, coalesce(c.n, 0) as value,
           'filings'::text as unit, 'documents'::text as source_dataset,
           '/litigation/documents?mdl=' || s.mdl as source_url,
           'documents:listing_rule'
           || case when to_char(g, 'YYYY-MM') = (select cur.m from cur) then ':partial_month' else '' end as basis
      from doc_span s
      cross join lateral generate_series(to_date(s.lo || '-01', 'YYYY-MM-DD'), to_date(s.hi || '-01', 'YYYY-MM-DD'),
                                         interval '1 month') g
      left join docs_in c on c.mdl = s.mdl and c.month = to_char(g, 'YYYY-MM')),
  -- F/G. FDA product series that name the MDL in their own record
  prod as (
    select distinct on (r.dataset, r.item ->> 'mdl', p ->> 'year') r.dataset, r.item ->> 'mdl' as mdl, r.source_url, p
      from public.corpus_records r
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.item -> 'series') = 'array'
                                                   then r.item -> 'series' else '[]'::jsonb end)
                 with ordinality e(p, ord)
     where r.dataset in ('fda_faers_product_series', 'fda_device_event_series')
       and (r.item ->> 'mdl') ~ '^[1-9][0-9]{0,5}$'
       and jsonb_typeof(p) = 'object' and (p ->> 'year') ~ '^[12][0-9]{3}$' and jsonb_typeof(p -> 'reports') = 'number'
     order by r.dataset, r.item ->> 'mdl', p ->> 'year', r.id collate "C", e.ord),
  prod_rows as (
    select prod.mdl, case prod.dataset when 'fda_faers_product_series' then 'faers_reports' else 'maude_reports' end as series,
           (p ->> 'year') || '-01' as month, (p ->> 'reports')::numeric as value, 'reports'::text as unit,
           prod.dataset as source_dataset, prod.source_url,
           'calendar_year_total' || case when p -> 'partial' = 'true'::jsonb then ':partial' else '' end as basis
      from prod),
  -- national context (mdl 'US')
  nat as (
    select 'US'::text as mdl, 'jpml_fy_pending'::text as series, substr(r.id, 4) || '-09' as month,
           (r.item -> 'fy_stats' ->> 'pending')::numeric as value, 'actions'::text as unit,
           'jpml_statistics_extra'::text as source_dataset, r.source_url, 'jpml_fy_statistical_analysis'::text as basis
      from public.corpus_records r
     where r.dataset = 'jpml_statistics_extra' and r.id ~ '^fy:[12][0-9]{3}$'
       and jsonb_typeof(r.item -> 'fy_stats' -> 'pending') = 'number'
    union all
    select 'US', 'jpml_motions_granted', (r.item -> 'stats' ->> 'year') || '-01',
           (r.item -> 'stats' ->> 'motions_granted')::numeric, 'motions', 'mdl_intel_jpml_stats', r.source_url,
           'calendar_year_total'
      from public.corpus_records r
     where r.dataset = 'mdl_intel_jpml_stats' and r.id ~ '^year:[12][0-9]{3}$'
       and (r.item -> 'stats' ->> 'year') ~ '^[12][0-9]{3}$'
       and jsonb_typeof(r.item -> 'stats' -> 'motions_granted') = 'number')
  select * from jpml
  union all select * from fy
  union all select * from fjc
  union all select * from dk_rows
  union all select * from doc_rows
  union all select * from prod_rows
  union all select * from nat
$$;

-- Label fields of every MDL, as published by each source record (twin: sourceRows in src/lib/litviz/derive.ts).
create or replace function litviz.source_rows()
returns table (mdl text, scope text, src jsonb)
language sql stable set search_path = '' as $$
  with
  m as (
    select r.id as mdl, jsonb_strip_nulls(jsonb_build_object(
      'title', r.item ->> 'title', 'status', r.item ->> 'status', 'litigation_type', r.item ->> 'litigation_type',
      'cl_court_id', r.item ->> 'cl_court_id', 'court_name', r.item ->> 'court_name',
      'judge_name_as_printed', r.item ->> 'judge_name_as_printed', 'judge_profile_id', r.item ->> 'judge_profile_id',
      'judge_match_kind', r.item ->> 'judge_match_kind', 'date_transferred', r.item ->> 'date_transferred',
      'date_closed', r.item ->> 'date_closed', 'as_of', r.item ->> 'as_of',
      'actions_pending', case when jsonb_typeof(r.item -> 'actions_pending') = 'number' then r.item -> 'actions_pending' end,
      'total_actions', case when jsonb_typeof(r.item -> 'total_actions') = 'number' then r.item -> 'total_actions' end)) as v
      from public.corpus_records r where r.dataset = 'mdls' and r.id ~ '^[1-9][0-9]{0,5}$'),
  h as (
    select r.id as mdl, jsonb_strip_nulls(jsonb_build_object(
      'title', x ->> 'title', 'type', x ->> 'type', 'judge', x ->> 'judge', 'district', x ->> 'district',
      'date_filed', x ->> 'date_filed', 'date_transferred', x ->> 'date_transferred', 'date_closed', x ->> 'date_closed',
      'exit_status', x ->> 'exit_status', 'last_report', x ->> 'last_report',
      'closed_url', x -> 'closed_evidence' ->> 'url')) as v
      from public.corpus_records r
      cross join lateral (select case when jsonb_typeof(r.item -> 'history') = 'object' then r.item -> 'history' end as x) q
     where r.dataset = 'jpml_pending_history_mdls' and r.id ~ '^[1-9][0-9]{0,5}$'),
  a as (
    select r.id as mdl, jsonb_strip_nulls(jsonb_build_object(
      'mass_tort', case when jsonb_typeof(r.item -> 'analytics' -> 'mass_tort') = 'boolean' then r.item -> 'analytics' -> 'mass_tort' end,
      'type', r.item -> 'analytics' ->> 'type', 'title', r.item ->> 'title')) as v
      from public.corpus_records r where r.dataset = 'mdl_analytics' and r.id ~ '^[1-9][0-9]{0,5}$'),
  xp as (
    select substr(r.id, 5) as mdl, r.item, e.p, (e.p ->> 'fy')::integer as fy, e.ord
      from public.corpus_records r
      left join lateral jsonb_array_elements(case when jsonb_typeof(r.item -> 'fy_history' -> 'series') = 'array'
                                                  then r.item -> 'fy_history' -> 'series' else '[]'::jsonb end)
                with ordinality e(p, ord)
             on jsonb_typeof(e.p) = 'object' and (e.p ->> 'fy') ~ '^[12][0-9]{3}$'
     where r.dataset = 'jpml_statistics_extra' and r.id ~ '^mdl:[1-9][0-9]{0,5}$'),
  x as (
    select xp.mdl, jsonb_strip_nulls(jsonb_build_object(
      'caption', min(xp.item ->> 'title'), 'judge', min(xp.item -> 'fy_history' ->> 'judge'),
      'district', (array_agg(xp.p ->> 'district' order by xp.fy desc, xp.ord) filter (where xp.p is not null))[1],
      'first_fy', min(xp.fy), 'last_fy', max(xp.fy))) as v
      from xp group by xp.mdl),
  t0 as (
    select r.item -> 'history' ->> 'mdl' as mdl, (r.item -> 'history' ->> 'termination_year')::numeric as y,
           r.item -> 'history' ->> 'district_name' as d
      from public.corpus_records r
     where r.dataset = 'mdl_terminated_history' and (r.item -> 'history' ->> 'mdl') ~ '^[1-9][0-9]{0,5}$'
       and jsonb_typeof(r.item -> 'history' -> 'termination_year') = 'number'),
  t as (
    select distinct on (t0.mdl) t0.mdl, jsonb_strip_nulls(jsonb_build_object('termination_year', t0.y, 'district', t0.d)) as v
      from t0 order by t0.mdl, t0.y desc, t0.d collate "C" asc nulls last),
  p as (
    select r.item ->> 'mdl' as mdl,
           jsonb_agg(jsonb_strip_nulls(jsonb_build_object('dataset', r.dataset, 'id', r.id, 'product', r.item ->> 'product',
                       'source_url', nullif(r.source_url, ''), 'data_through', r.item ->> 'data_through'))
                     order by r.dataset collate "C", r.id collate "C") as v
      from public.corpus_records r
     where r.dataset in ('fda_faers_product_series', 'fda_device_event_series') and (r.item ->> 'mdl') ~ '^[1-9][0-9]{0,5}$'
     group by 1),
  rep as (select m.mdl from m union select h.mdl from h union select a.mdl from a),
  ids as (select rep.mdl from rep union select x.mdl from x union select t.mdl from t)
  select i.mdl, case when i.mdl in (select rep.mdl from rep) then 'reported' else 'historical' end,
         jsonb_strip_nulls(jsonb_build_object('m', m.v, 'h', h.v, 'a', a.v, 'x', x.v, 't', t.v, 'products', p.v))
    from ids i
    left join m on m.mdl = i.mdl left join h on h.mdl = i.mdl left join a on a.mdl = i.mdl
    left join x on x.mdl = i.mdl left join t on t.mdl = i.mdl left join p on p.mdl = i.mdl
$$;

-- ------------------------------------------------------------------------------------------------ refresh
-- Rebuilds every litviz table from the sources (one transaction; readers see the old rows until it commits).
create or replace function public.litviz_refresh_v1(p_today date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'utc')::date);
  v_id bigint; n_series integer; n_sources integer; n_meta integer; n_auth integer; n_cit integer; n_co integer; n integer;
begin
  insert into litviz.refreshes (today) values (v_today) returning id into v_id;

  with d as (delete from litviz.mdl_series s where s.mdl is not null returning 1) select count(*) into n from d;
  insert into litviz.mdl_series (mdl, series, month, value, unit, source_dataset, source_url, basis)
  select r.mdl, r.series, r.month, r.value, r.unit, r.source_dataset, r.source_url, r.basis from litviz.series_rows(v_today) r;
  get diagnostics n_series = row_count;

  with d as (delete from litviz.mdl_sources s where s.mdl is not null returning 1) select count(*) into n from d;
  insert into litviz.mdl_sources (mdl, scope, src) select r.mdl, r.scope, r.src from litviz.source_rows() r;
  get diagnostics n_sources = row_count;

  -- citations of open, text-serving filings (documents.links relation 'cites', exact ids only)
  with d as (delete from litviz.citations c where c.mdl is not null returning 1) select count(*) into n from d;
  insert into litviz.citations (mdl, to_type, to_id, filings, mentions)
  select d.mdl, l.to_type, l.to_id, count(distinct d.id), sum(l.mentions)
    from documents.links l
    join documents.documents d on d.id = l.document_id
   where l.relation = 'cites' and l.evidence = 'exact_id' and l.to_type in ('record', 'law_unit')
     and d.text_status in ('text_layer', 'partial_text') and documents.is_open(d.source_system, d.native_document_id)
   group by 1, 2, 3;
  get diagnostics n_cit = row_count;

  -- co-citation among each MDL's 40 most-cited authorities (filings citing both; two or more)
  with d as (delete from litviz.cocitations c where c.mdl is not null returning 1) select count(*) into n from d;
  insert into litviz.cocitations (mdl, a_type, a_id, b_type, b_id, filings)
  with top as (
    select c.mdl, c.to_type, c.to_id from (
      select c0.*, row_number() over (partition by c0.mdl order by c0.filings desc, c0.mentions desc,
                                      c0.to_type collate "C", c0.to_id collate "C") as rn
        from litviz.citations c0) c
     where c.rn <= 40),
  dl as (
    select distinct d.mdl, d.id, l.to_type, l.to_id
      from documents.links l
      join documents.documents d on d.id = l.document_id
      join top t on t.mdl = d.mdl and t.to_type = l.to_type and t.to_id = l.to_id
     where l.relation = 'cites' and l.evidence = 'exact_id'
       and d.text_status in ('text_layer', 'partial_text') and documents.is_open(d.source_system, d.native_document_id))
  select a.mdl, a.to_type, a.to_id, b.to_type, b.to_id, count(*)
    from dl a join dl b on b.mdl = a.mdl and b.id = a.id
     and (a.to_type || '|' || a.to_id) collate "C" < (b.to_type || '|' || b.to_id) collate "C"
   group by 1, 2, 3, 4, 5
  having count(*) >= 2;
  get diagnostics n_co = row_count;

  -- labels of every cited authority
  with d as (delete from litviz.authorities a where a.to_id is not null returning 1) select count(*) into n from d;
  insert into litviz.authorities (to_type, to_id, kind, class, label, cite, heading, court_id, court_label, year)
  select c.to_type, c.to_id, 'case',
         case when k.court_id = 'scotus' then 'scotus' when k.tier = 2 then 'federal_appellate'
              when k.tier = 3 then 'state_high' else 'other_court' end,
         coalesce(nullif(btrim(k.case_name), ''), 'Decision ' || substr(c.to_id, 9)),
         (select x from unnest(k.citations) x where x !~* '(lexis|westlaw|\mWL\M)' limit 1),
         null, k.court_id, ct.short_name, extract(year from k.date_filed)::integer
    from (select distinct c0.to_type, c0.to_id from litviz.citations c0
           where c0.to_type = 'record' and c0.to_id ~ '^caselaw/[1-9][0-9]{0,9}$') c
    join caselaw.cases k on k.cluster_id = substr(c.to_id, 9)::bigint
    left join caselaw.courts ct on ct.court_id = k.court_id
  union all
  select c.to_type, c.to_id, 'usc', 'usc',
         split_part(c.to_id, ':', 2) || ' U.S.C. § ' || substr(c.to_id, length(split_part(c.to_id, ':', 2)) + 6),
         null,
         nullif(btrim(regexp_replace(u.title, '^[0-9]+a? U\.S\.C\. § \S+\s*', '')), ''),
         null, null, null
    from (select distinct c0.to_type, c0.to_id from litviz.citations c0
           where c0.to_type = 'law_unit' and c0.to_id ~ '^usc:[0-9]{1,2}a?:.+$') c
    left join public.corpus_records u on u.dataset = 'us_code_sections' and u.id = substr(c.to_id, 5)
  union all
  select c.to_type, c.to_id, 'cfr', 'cfr',
         split_part(c.to_id, ':', 2) || ' C.F.R. part ' || split_part(c.to_id, ':', 3),
         null, nullif(btrim(f.title), ''), null, null, null
    from (select distinct c0.to_type, c0.to_id from litviz.citations c0
           where c0.to_type = 'law_unit' and c0.to_id ~ '^cfr:[0-9]{1,2}:[0-9]{1,5}$') c
    left join public.corpus_records f on f.dataset = 'federal_regulations_parts' and f.id = c.to_id;
  get diagnostics n_auth = row_count;

  -- per-MDL denominators and coverage notes
  with d as (delete from litviz.mdl_meta m where m.mdl is not null returning 1) select count(*) into n from d;
  insert into litviz.mdl_meta (mdl, docket_dataset, docket_total, docket_undated, filings, filings_undated, with_text,
                               citing, cites_unresolved, cites_ambiguous)
  with sw as (
    select r.item -> 'cells' ->> 'mdl' as mdl, left(r.item -> 'cells' ->> 'date_filed', 7) as month
      from public.corpus_records r
     where r.dataset = 'sw_docket_entries_v1' and (r.item -> 'cells' ->> 'mdl') ~ '^[1-9][0-9]{0,5}$'),
  act as (
    select r.item -> 'cells' ->> 'mdl' as mdl, left(r.item -> 'cells' ->> 'published_at', 7) as month
      from public.corpus_records r
     where r.dataset = 'mdl_docket_activity' and (r.item -> 'cells' ->> 'mdl') ~ '^[1-9][0-9]{0,5}$'
       and (r.item -> 'cells' ->> 'mdl') not in (select sw.mdl from sw)),
  dk as (
    select sw.mdl, 'sw_docket_entries_v1'::text as ds, sw.month from sw
    union all select act.mdl, 'mdl_docket_activity', act.month from act),
  dkm as (
    select dk.mdl, min(dk.ds) as ds, count(*)::integer as total,
           count(*) filter (where not (coalesce(dk.month, '') ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])$'
                                       and dk.month >= '1968-01' and dk.month <= to_char(v_today, 'YYYY-MM')))::integer as undated
      from dk group by dk.mdl),
  dm as (
    select d.mdl, count(*)::integer as filings,
           count(*) filter (where d.filed_date is null or d.filed_date < date '1968-01-01'
                                  or to_char(d.filed_date, 'YYYY-MM') > to_char(v_today, 'YYYY-MM'))::integer as undated,
           count(*) filter (where d.text_status in ('text_layer', 'partial_text'))::integer as with_text
      from documents.documents d where d.mdl ~ '^[1-9][0-9]{0,5}$' group by d.mdl),
  cm as (
    select d.mdl, count(distinct d.id)::integer as citing
      from documents.links l join documents.documents d on d.id = l.document_id
     where l.relation = 'cites' and l.evidence = 'exact_id' and l.to_type in ('record', 'law_unit')
       and d.text_status in ('text_layer', 'partial_text') and documents.is_open(d.source_system, d.native_document_id)
     group by d.mdl),
  um as (
    select x.mdl, count(*) filter (where x.resolution = 'unresolved')::integer as unresolved,
           count(*) filter (where x.resolution = 'ambiguous')::integer as ambiguous
      from (select distinct d.mdl, e.sha256, e.page, e.start_offset, e.resolution
              from documents.extractions e join documents.documents d on d.sha256 = e.sha256
             where e.kind = 'case_citation' and e.resolution in ('unresolved', 'ambiguous')
               and d.text_status in ('text_layer', 'partial_text')) x
     group by x.mdl),
  ids as (select dkm.mdl from dkm union select dm.mdl from dm)
  select i.mdl, dkm.ds, coalesce(dkm.total, 0), coalesce(dkm.undated, 0), coalesce(dm.filings, 0), coalesce(dm.undated, 0),
         coalesce(dm.with_text, 0), coalesce(cm.citing, 0), coalesce(um.unresolved, 0), coalesce(um.ambiguous, 0)
    from ids i left join dkm on dkm.mdl = i.mdl left join dm on dm.mdl = i.mdl
    left join cm on cm.mdl = i.mdl left join um on um.mdl = i.mdl;
  get diagnostics n_meta = row_count;

  update litviz.refreshes set finished_at = now(),
    counts = jsonb_build_object('series_rows', n_series, 'mdls', n_sources, 'meta', n_meta, 'citations', n_cit,
                                'cocitations', n_co, 'authorities', n_auth)
   where id = v_id;
  return (select r.counts || jsonb_build_object('today', r.today, 'finished_at', r.finished_at)
            from litviz.refreshes r where r.id = v_id);
end $$;

-- ------------------------------------------------------------------------------------------------ read RPCs
create or replace function litviz.last_refresh() returns table (today date, finished_at timestamptz)
language sql stable set search_path = '' as $$
  select r.today, r.finished_at from litviz.refreshes r where r.finished_at is not null order by r.id desc limit 1
$$;

-- All MDL lanes of one scope ('reported': in the JPML monthly reports since October 2024 or the current MDL list;
-- 'historical': fiscal-year statistics or terminated-litigation tables only). Stocks keep every point; docket entries
-- and filings are summed per calendar year; docket_entries_12m is the last 12 complete months. Null until built.
create or replace function public.litviz_mdl_lanes_v1(p_scope text default 'reported') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date; v_refreshed timestamptz; v_cur text; v_from text;
begin
  if p_scope is null or p_scope not in ('reported', 'historical') then
    raise exception 'Invalid scope' using errcode = '22023'; end if;
  select l.today, l.finished_at into v_today, v_refreshed from litviz.last_refresh() l;
  if v_today is null then return null; end if;
  v_cur := to_char(v_today, 'YYYY-MM');
  v_from := to_char(v_today - interval '12 months', 'YYYY-MM');
  return (
    with s as (select x.mdl, x.src from litviz.mdl_sources x where x.scope = p_scope),
    r as (select ms.mdl, ms.series, ms.month, ms.value, ms.basis from litviz.mdl_series ms
           where ms.mdl in (select s.mdl from s) and ms.series in ('jpml_pending', 'jpml_fy_pending', 'docket_entries', 'filings')),
    roll as (
      select r.mdl, r.series, r.month as period, r.value, r.basis from r where r.series in ('jpml_pending', 'jpml_fy_pending')
      union all
      select r.mdl, r.series, left(r.month, 4), sum(r.value), case when bool_or(r.basis like '%:partial%') then 'partial' else '' end
        from r where r.series in ('docket_entries', 'filings') group by r.mdl, r.series, left(r.month, 4)
      union all
      select r.mdl, 'docket_entries_12m', v_from || '/' || v_cur, sum(r.value), ''
        from r where r.series = 'docket_entries' and r.month >= v_from and r.month < v_cur group by r.mdl)
    select jsonb_build_object(
      'scope', p_scope, 'today', v_today, 'refreshed', v_refreshed,
      'mdls', (select coalesce(jsonb_agg(jsonb_build_object('mdl', s.mdl, 'src', s.src) order by s.mdl::integer), '[]'::jsonb) from s),
      'rows', (select coalesce(jsonb_agg(jsonb_build_array(roll.mdl, roll.series, roll.period, roll.value, roll.basis)
                                         order by roll.mdl::integer, roll.series, roll.period), '[]'::jsonb) from roll),
      'national', (select coalesce(jsonb_agg(jsonb_build_object('series', n.series, 'month', n.month, 'value', n.value,
                     'unit', n.unit, 'source_dataset', n.source_dataset, 'source_url', n.source_url, 'basis', n.basis)
                     order by n.series, n.month), '[]'::jsonb)
                     from litviz.mdl_series n where n.mdl = 'US'))
  );
end $$;

-- One MDL: label fields, coverage notes and every series row (the detailed lane and the product signal timeline).
create or replace function public.litviz_mdl_series_v1(p_mdl text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date; v_refreshed timestamptz;
begin
  if p_mdl is null or p_mdl !~ '^[1-9][0-9]{0,5}$' then raise exception 'Invalid MDL' using errcode = '22023'; end if;
  select l.today, l.finished_at into v_today, v_refreshed from litviz.last_refresh() l;
  if v_today is null then return null; end if;
  return jsonb_build_object(
    'mdl', p_mdl, 'today', v_today, 'refreshed', v_refreshed,
    'scope', (select s.scope from litviz.mdl_sources s where s.mdl = p_mdl),
    'src', (select s.src from litviz.mdl_sources s where s.mdl = p_mdl),
    'meta', (select to_jsonb(m) - 'mdl' from litviz.mdl_meta m where m.mdl = p_mdl),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('series', r.series, 'month', r.month, 'value', r.value,
               'unit', r.unit, 'source_dataset', r.source_dataset, 'source_url', r.source_url, 'basis', r.basis)
               order by r.series, r.month), '[]'::jsonb)
               from litviz.mdl_series r where r.mdl = p_mdl));
end $$;

create or replace function litviz.authority_json(a litviz.authorities, p_to_type text, p_to_id text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'key', p_to_type || '|' || p_to_id, 'to_type', p_to_type, 'to_id', p_to_id,
    'kind', a.kind, 'class', coalesce(a.class, 'other_court'), 'label', coalesce(a.label, p_to_id),
    'cite', a.cite, 'heading', a.heading, 'court_id', a.court_id, 'court_label', a.court_label, 'year', a.year))
$$;

-- Authorities cited by an MDL's filings (top p_limit by filings citing), with co-citation edges among them.
create or replace function public.litviz_citations_v1(p_mdl text, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_refreshed timestamptz;
begin
  if p_mdl is null or p_mdl !~ '^[1-9][0-9]{0,5}$' then raise exception 'Invalid MDL' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 60 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  select l.finished_at into v_refreshed from litviz.last_refresh() l;
  if v_refreshed is null then return null; end if;
  return (
    with top as (
      select c.to_type, c.to_id, c.filings, c.mentions from litviz.citations c where c.mdl = p_mdl
       order by c.filings desc, c.mentions desc, c.to_type collate "C", c.to_id collate "C" limit p_limit)
    select jsonb_build_object(
      'mdl', p_mdl, 'refreshed', v_refreshed,
      'meta', (select to_jsonb(m) - 'mdl' from litviz.mdl_meta m where m.mdl = p_mdl),
      'distinct_authorities', (select count(*) from litviz.citations c where c.mdl = p_mdl),
      'authorities', (select coalesce(jsonb_agg(litviz.authority_json(a, t.to_type, t.to_id)
                        || jsonb_build_object('filings', t.filings, 'mentions', t.mentions)
                        order by t.filings desc, t.mentions desc, t.to_type collate "C", t.to_id collate "C"), '[]'::jsonb)
                        from top t left join litviz.authorities a on a.to_type = t.to_type and a.to_id = t.to_id),
      'edges', (select coalesce(jsonb_agg(jsonb_build_array(x.a_type || '|' || x.a_id, x.b_type || '|' || x.b_id, x.filings)
                  order by x.filings desc, x.a_type collate "C", x.a_id collate "C", x.b_type collate "C", x.b_id collate "C"), '[]'::jsonb)
                  from litviz.cocitations x
                 where x.mdl = p_mdl
                   and (x.a_type, x.a_id) in (select t.to_type, t.to_id from top t)
                   and (x.b_type, x.b_id) in (select t.to_type, t.to_id from top t)))
  );
end $$;

-- Authority × MDL grid: filings citing each authority in each MDL. p_mdls null = the 10 MDLs with the most citing filings.
create or replace function public.litviz_citation_grid_v1(p_mdls text[] default null, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_refreshed timestamptz; v_bad integer;
begin
  if p_limit is null or p_limit not between 1 and 60 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  if p_mdls is not null then
    if cardinality(p_mdls) not between 1 and 12 then raise exception 'Give 1 to 12 MDLs' using errcode = '22023'; end if;
    select count(*) into v_bad from unnest(p_mdls) x where x is null or x !~ '^[1-9][0-9]{0,5}$';
    if v_bad > 0 then raise exception 'Invalid MDL' using errcode = '22023'; end if;
  end if;
  select l.finished_at into v_refreshed from litviz.last_refresh() l;
  if v_refreshed is null then return null; end if;
  return (
    with sel as (
      select distinct x as mdl from unnest(p_mdls) x where p_mdls is not null
      union all
      select m.mdl from (select m0.mdl from litviz.mdl_meta m0 where p_mdls is null and m0.citing > 0
                          order by m0.citing desc, m0.mdl::integer limit 10) m),
    auth as (
      select c.to_type, c.to_id, sum(c.filings)::integer as filings
        from litviz.citations c where c.mdl in (select sel.mdl from sel)
       group by c.to_type, c.to_id order by sum(c.filings) desc, c.to_type collate "C", c.to_id collate "C" limit p_limit),
    cols as (
      select sel.mdl, m.filings, m.with_text, m.citing,
             coalesce(s.src #>> '{m,title}', s.src #>> '{h,title}', s.src #>> '{a,title}', s.src #>> '{x,caption}') as title
        from sel left join litviz.mdl_meta m on m.mdl = sel.mdl left join litviz.mdl_sources s on s.mdl = sel.mdl)
    select jsonb_build_object(
      'refreshed', v_refreshed,
      'mdls', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('mdl', cols.mdl, 'title', cols.title,
                 'filings', cols.filings, 'with_text', cols.with_text, 'citing', cols.citing))
                 order by cols.citing desc nulls last, cols.mdl::integer), '[]'::jsonb) from cols),
      'authorities', (select coalesce(jsonb_agg(litviz.authority_json(a, x.to_type, x.to_id)
                        || jsonb_build_object('filings', x.filings)
                        order by x.filings desc, x.to_type collate "C", x.to_id collate "C"), '[]'::jsonb)
                        from auth x left join litviz.authorities a on a.to_type = x.to_type and a.to_id = x.to_id),
      'cells', (select coalesce(jsonb_agg(jsonb_build_array(c.to_type || '|' || c.to_id, c.mdl, c.filings)
                  order by c.mdl::integer, c.to_type collate "C", c.to_id collate "C"), '[]'::jsonb)
                  from litviz.citations c
                 where c.mdl in (select sel.mdl from sel) and (c.to_type, c.to_id) in (select x.to_type, x.to_id from auth x)))
  );
end $$;

-- One filing: the authorities it cites, with how many filings of its MDL (and of all MDLs) cite each.
create or replace function public.litviz_filing_citations_v1(p_document text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d documents.documents; v_refreshed timestamptz;
begin
  if p_document is null or p_document !~ '^d_[0-9a-f]{24}$' then raise exception 'Invalid document' using errcode = '22023'; end if;
  select * into d from documents.documents x where x.id = p_document;
  if not found or not documents.is_open(d.source_system, d.native_document_id) then return null; end if;
  select l.finished_at into v_refreshed from litviz.last_refresh() l;
  return jsonb_build_object(
    'document', d.id, 'mdl', d.mdl, 'text_status', d.text_status, 'refreshed', v_refreshed,
    'mdl_citing', (select m.citing from litviz.mdl_meta m where m.mdl = d.mdl),
    'authorities', case when d.text_status not in ('text_layer', 'partial_text') then '[]'::jsonb else
      (select coalesce(jsonb_agg(litviz.authority_json(a, l.to_type, l.to_id)
         || jsonb_build_object('mentions', l.mentions, 'first_page', l.first_page,
              'mdl_filings', (select c.filings from litviz.citations c where c.mdl = d.mdl and c.to_type = l.to_type and c.to_id = l.to_id),
              'all_filings', (select sum(c.filings) from litviz.citations c where c.to_type = l.to_type and c.to_id = l.to_id))
         order by l.mentions desc, l.to_type collate "C", l.to_id collate "C"), '[]'::jsonb)
         from (select * from documents.links l0 where l0.document_id = d.id and l0.relation = 'cites'
                  and l0.evidence = 'exact_id' and l0.to_type in ('record', 'law_unit')
                order by l0.mentions desc, l0.to_type collate "C", l0.to_id collate "C" limit 60) l
         left join litviz.authorities a on a.to_type = l.to_type and a.to_id = l.to_id) end);
end $$;

-- Court hierarchy, one level at a time: 'root' (Supreme Court + state systems), 'court' (children of a court: the
-- circuits under the Supreme Court, the judges of any other court), 'circuit' (its district courts and its appellate
-- judges), 'judges' (judges of a court), 'states', 'state' (a state's highest and intermediate appellate courts).
create or replace function public.litviz_court_children_v1(p_type text, p_id text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_metrics text[] := array['usc_civil_pending', 'usc_civil_median_months', 'mdl_court_pending_mdls',
    'mdl_court_actions_pending', 'usc_weighted_filings_per_judgeship', 'fjc_sitting_judges', 'caselaw_opinion_clusters',
    'usc_appeals_pending', 'usc_appeals_filed'];
  v_appellate text[] := array['S', 'TS', 'SA', 'TA'];
begin
  if p_type is null or p_type not in ('root', 'court', 'circuit', 'judges', 'states', 'state') then
    raise exception 'Invalid level' using errcode = '22023'; end if;
  if (p_type in ('court', 'circuit', 'judges') and (p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,40}$'))
     or (p_type = 'state' and (p_id is null or p_id !~ '^[A-Z]{2}$')) then
    raise exception 'Invalid id' using errcode = '22023'; end if;
  return (
    with nodes as (
      -- root
      select 'court'::text as type, e.entity_id as id, e.label, e.href, e.keys ->> 'court_type' as court_type, 0 as ord,
             array['court:' || e.entity_id] as facts
        from insights.entities e where p_type = 'root' and e.entity_type = 'court' and e.entity_id = 'scotus'
      union all
      select 'states', 'US', 'State court systems', null, null, 1, array[]::text[] where p_type = 'root'
      -- the circuits under the Supreme Court
      union all
      select 'circuit', e.entity_id, e.label, e.href, null,
             coalesce(nullif(substring(e.entity_id from '^ca([0-9]+)$'), '')::integer, case e.entity_id when 'cadc' then 12 else 13 end),
             array['circuit:' || e.entity_id, 'court:' || e.entity_id]
        from insights.entities e where p_type = 'court' and p_id = 'scotus' and e.entity_type = 'circuit'
      -- a circuit's district courts
      union all
      select 'court', e.entity_id, e.label, e.href, e.keys ->> 'court_type', 100, array['court:' || e.entity_id]
        from insights.entities e where p_type = 'circuit' and e.entity_type = 'court' and e.parent_type = 'circuit' and e.parent_id = p_id
      -- judges (of a court, or the appellate judges of a circuit, or the justices)
      union all
      select 'judge', e.entity_id, e.label, e.href, null, 200, array['judge:' || e.entity_id]
        from insights.entities e
       where e.entity_type = 'judge' and e.parent_type = 'court'
         and ((p_type in ('court', 'judges') and p_id <> 'scotus' and e.parent_id = p_id) or (p_type = 'judges' and p_id = 'scotus' and e.parent_id = 'scotus'))
      union all
      select 'judges', p_id, case when p_id = 'scotus' then 'Justices' else 'Judges of the court of appeals' end, null, null, 300, array[]::text[]
       where ((p_type = 'court' and p_id = 'scotus') or p_type = 'circuit')
         and exists (select 1 from insights.entities e where e.entity_type = 'judge' and e.parent_type = 'court' and e.parent_id = p_id)
      -- state systems
      union all
      select 'state', e.entity_id, e.label, e.href, null, 400, array[]::text[]
        from insights.entities e
       where p_type = 'states' and e.entity_type = 'state'
         and exists (select 1 from insights.entities c where c.entity_type = 'court' and c.parent_type = 'state'
                       and c.parent_id = e.entity_id and c.keys ->> 'court_type' = any (v_appellate))
      union all
      select 'court', e.entity_id, e.label, e.href, e.keys ->> 'court_type',
             case when e.keys ->> 'court_type' in ('S', 'TS') then 500 else 501 end, array['court:' || e.entity_id]
        from insights.entities e
       where p_type = 'state' and e.entity_type = 'court' and e.parent_type = 'state' and e.parent_id = p_id
         and e.keys ->> 'court_type' = any (v_appellate)
      union all
      select 'other_courts', p_id, 'Trial and other courts', '/courts?system=State&state=' || p_id, null, 600, array[]::text[]
       where p_type = 'state'),
    counted as (
      select n.*,
        case n.type
          when 'court' then case when n.id = 'scotus' then (select count(*) from insights.entities e where e.entity_type = 'circuit')
                                 else (select count(*) from insights.entities e where e.entity_type = 'judge' and e.parent_type = 'court' and e.parent_id = n.id) end
          when 'circuit' then (select count(*) from insights.entities e where e.entity_type = 'court' and e.parent_type = 'circuit' and e.parent_id = n.id)
                              + case when exists (select 1 from insights.entities e where e.entity_type = 'judge' and e.parent_type = 'court' and e.parent_id = n.id) then 1 else 0 end
          when 'judges' then (select count(*) from insights.entities e where e.entity_type = 'judge' and e.parent_type = 'court' and e.parent_id = n.id)
          when 'states' then (select count(*) from insights.entities e where e.entity_type = 'state'
                                and exists (select 1 from insights.entities c where c.entity_type = 'court' and c.parent_type = 'state'
                                              and c.parent_id = e.entity_id and c.keys ->> 'court_type' = any (v_appellate)))
          when 'state' then (select count(*) from insights.entities c where c.entity_type = 'court' and c.parent_type = 'state'
                               and c.parent_id = n.id and c.keys ->> 'court_type' = any (v_appellate))
          when 'other_courts' then (select count(*) from insights.entities c where c.entity_type = 'court' and c.parent_type = 'state'
                                      and c.parent_id = n.id and coalesce(c.keys ->> 'court_type', '') <> all (v_appellate))
          else 0 end as children
        from nodes n),
    latest as (
      select distinct on (f.metric_id, f.entity_type, f.entity_id) f.metric_id, f.entity_type, f.entity_id, f.period, f.value
        from insights.facts f
       where f.metric_id = any (v_metrics) and not f.partial and f.value is not null
         and (f.entity_type || ':' || f.entity_id) in (select unnest(c.facts) from counted c)
       order by f.metric_id, f.entity_type, f.entity_id, f.period_end desc, f.period desc),
    judge_mdls as (
      select j.entity_id, count(*)::integer as mdls, sum(case when jsonb_typeof(r.item -> 'actions_pending') = 'number'
                                                              then (r.item ->> 'actions_pending')::numeric end) as actions,
             max(r.item ->> 'as_of') as as_of
        from insights.entities j
        join public.corpus_records r on r.dataset = 'mdls' and r.item ->> 'judge_profile_id' = j.keys ->> 'judge_profile'
                                    and r.item ->> 'judge_match_kind' = 'exact'
       where j.entity_type = 'judge' and j.entity_id in (select c.id from counted c where c.type = 'judge')
       group by j.entity_id)
    select jsonb_build_object(
      'type', p_type, 'id', p_id,
      'nodes', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'type', c.type, 'id', c.id, 'label', c.label, 'href', c.href, 'court_type', c.court_type,
                  'children', c.children,
                  'metrics', (select jsonb_object_agg(x.metric_id, jsonb_build_array(x.value, x.period, x.entity_type))
                                from (select distinct on (l.metric_id) l.* from latest l
                                       where (l.entity_type || ':' || l.entity_id) = any (c.facts)
                                       order by l.metric_id, case l.entity_type when 'circuit' then 0 else 1 end) x),
                  'judge', (select jsonb_build_object('pending_mdls', jm.mdls, 'actions_pending', jm.actions, 'as_of', jm.as_of)
                              from judge_mdls jm where c.type = 'judge' and jm.entity_id = c.id)))
                  order by c.ord, c.label collate "C", c.id collate "C"), '[]'::jsonb) from counted c),
      'catalog', (select coalesce(jsonb_object_agg(m.id, jsonb_build_object('label', m.label, 'unit', m.unit, 'format', m.format,
                    'period_type', m.period_type, 'source_links', m.source_links, 'source_datasets', m.source_datasets)), '{}'::jsonb)
                    from insights.metrics m where m.id = any (v_metrics)))
  );
end $$;

create or replace function public.litviz_status_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'last', (select to_jsonb(r) from (select * from litviz.refreshes x order by x.id desc limit 1) r),
    'series_rows', (select count(*) from litviz.mdl_series),
    'by_series', (select coalesce(jsonb_object_agg(series, n), '{}'::jsonb) from (select series, count(*) n from litviz.mdl_series group by 1) s),
    'mdls', (select coalesce(jsonb_object_agg(scope, n), '{}'::jsonb) from (select scope, count(*) n from litviz.mdl_sources group by 1) s),
    'citations', (select count(*) from litviz.citations),
    'authorities', (select count(*) from litviz.authorities),
    'bytes', (select pg_total_relation_size('litviz.mdl_series') + pg_total_relation_size('litviz.citations')
                   + pg_total_relation_size('litviz.cocitations') + pg_total_relation_size('litviz.mdl_sources')))
$$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'litviz.series_rows(date)', 'litviz.source_rows()', 'litviz.last_refresh()',
    'litviz.authority_json(litviz.authorities,text,text)',
    'public.litviz_refresh_v1(date)', 'public.litviz_mdl_lanes_v1(text)', 'public.litviz_mdl_series_v1(text)',
    'public.litviz_citations_v1(text,integer)', 'public.litviz_citation_grid_v1(text[],integer)',
    'public.litviz_filing_citations_v1(text)', 'public.litviz_court_children_v1(text,text)', 'public.litviz_status_v1()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

grant usage on schema litviz to service_role;

comment on schema litviz is 'litviz/1: precomputed series and bounded reads for the MDL lifecycle lanes, product signal timeline, citation map and court hierarchy explorer. Rebuilt by public.litviz_refresh_v1(); nothing outside this schema is written.';

commit;
