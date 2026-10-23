-- insights/1 — our own metric layer on top of the corpus (owner decision 2026-10-23 evening).
--
-- Schema `insights`: a metric registry (one row per MetricDef of src/lib/insights/contract.ts), facts (one value per
-- metric, entity and period), an entity spine (nation › state › county, circuit › court, judges, MDLs, companies,
-- agencies, products, law units) with exact links, and a refresh ledger. Every fact is computed inside the database by
-- a deterministic refresh function from public.corpus_records (and caselaw.cases): a value is the number the source
-- states, or a deterministic sum or ratio of stated numbers; nothing is estimated, interpolated or projected. A value
-- the source does not give is NULL with a reason, never 0. A period still in progress, or only partly covered by the
-- source, is partial = true. Per-capita rates divide by the Census population estimate of the same geography and the
-- same year (else NULL with a reason).
--
-- Refresh: insights.refresh_<family>() per metric family, insights.refresh_all(), insights.refresh_for_datasets(text[])
-- (called by the scheduled ingestion after new records land). Each family refresh stages its facts, validates them
-- (registered metric, declared entity type, entity in the spine, period format of the metric's period type, value or
-- reason), and merges them in one subtransaction: rows no longer produced are deleted, changed rows are updated, an
-- identical row is left alone (so a second refresh over unchanged sources changes nothing). Every run is recorded in
-- insights.runs, a failed run with its error (the family's previous facts stay untouched).
--
-- Read RPCs (public schema, SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to
-- service_role): insights_catalog_v1, insights_series_v1, insights_snapshot_v1, insights_latest_v1, insights_cross_v1,
-- insights_entity_v1, insights_links_v1 (shapes of INSIGHTS_RPC in contract.ts, snake_case). insights_freshness_v1
-- belongs to the ingestion contract (ingest-v1.sql) and is not defined here.
--
-- Idempotent: create ... if not exists / create or replace; the registry is upserted by id. Apply this file, then run
-- `select insights.refresh_all('initial');`, then (separately, deliberately) the pg_cron section at the end.
-- Tests: scripts/insights/insights-contract.test.mjs (pglite, synthetic fixture). Live check: scripts/insights/verify_insights.mjs.

begin;

create schema if not exists insights;
revoke all on schema insights from public, anon, authenticated;
grant usage on schema insights to service_role;

-- ------------------------------------------------------------------------------------------------ tables
create table if not exists insights.metrics (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{2,63}$'),
  family text not null check (family ~ '^[a-z][a-z0-9_]{1,31}$'),
  ordinal integer not null default 0,
  label text not null check (length(label) between 3 and 160),
  description text not null,
  unit text not null,
  format text not null check (format in ('count', 'rate_per_100k', 'percent', 'currency_usd', 'months', 'days', 'ratio')),
  topic text not null check (topic in ('places', 'courts', 'litigation', 'law', 'enforcement', 'safety', 'companies', 'government')),
  entity_types text[] not null check (cardinality(entity_types) >= 1 and entity_types <@ array['nation', 'state', 'county',
    'circuit', 'court', 'judge', 'mdl', 'company', 'firm', 'agency', 'product', 'law_unit']),
  period_type text not null check (period_type in ('year', 'fiscal_year', 'quarter', 'month', 'twelve_months_ending', 'snapshot')),
  source_datasets text[] not null check (cardinality(source_datasets) >= 1),
  source_links jsonb not null default '[]' check (jsonb_typeof(source_links) = 'array'),
  numerator text not null,
  denominator text,
  method text not null,
  caveats text[] not null default '{}',
  direction text not null check (direction in ('higher_is_more', 'higher_is_less', 'neutral')),
  coverage_from text,
  coverage_to text,
  coverage_entities integer not null default 0,
  coverage_facts integer not null default 0,
  refreshed_at timestamptz
);

create table if not exists insights.facts (
  metric_id text not null references insights.metrics(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  period text not null,
  period_start date not null,
  period_end date not null,
  value numeric,
  moe numeric,
  partial boolean not null default false,
  n numeric,
  not_recorded_reason text,
  computed_at timestamptz not null default now(),
  primary key (metric_id, entity_type, entity_id, period),
  constraint facts_value_or_reason check ((value is null) = (not_recorded_reason is not null)),
  constraint facts_period_order check (period_end >= period_start),
  constraint facts_moe check (moe is null or (moe >= 0 and value is not null))
);
-- series reads use the primary key; snapshot reads (one period, all entities) and latest reads have their own index
create index if not exists facts_snapshot on insights.facts (metric_id, entity_type, period);
create index if not exists facts_latest on insights.facts (metric_id, entity_type, entity_id, period_end desc)
  where not partial and value is not null;

create table if not exists insights.entities (
  entity_type text not null check (entity_type in ('nation', 'state', 'county', 'circuit', 'court', 'judge', 'mdl',
    'company', 'firm', 'agency', 'product', 'law_unit')),
  entity_id text not null check (entity_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$'),
  label text not null,
  parent_type text,
  parent_id text,
  keys jsonb not null default '{}' check (jsonb_typeof(keys) = 'object'),
  href text check (href is null or href ~ '^/[a-z][A-Za-z0-9/_.:-]*$'),
  source_dataset text not null,
  updated_at timestamptz not null default now(),
  primary key (entity_type, entity_id),
  check ((parent_type is null) = (parent_id is null))
);
create index if not exists entities_parent on insights.entities (parent_type, parent_id);

create table if not exists insights.links (
  from_type text not null,
  from_id text not null,
  to_type text not null,
  to_id text not null,
  relation text not null check (relation ~ '^[a-z][a-z_]{1,39}$'),
  evidence text not null check (evidence in ('exact_id', 'exact_name_in_context', 'publisher_stated')),
  source_dataset text not null,
  source_record_id text not null,
  updated_at timestamptz not null default now(),
  primary key (from_type, from_id, to_type, to_id, relation, source_dataset, source_record_id)
);
create index if not exists links_to on insights.links (to_type, to_id, relation);

create table if not exists insights.runs (
  id bigint generated by default as identity primary key,
  family text not null,
  trigger text not null default 'manual',
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  staged integer,
  inserted integer,
  updated integer,
  deleted integer,
  unchanged integer,
  error text
);
create index if not exists runs_family on insights.runs (family, started_at desc);

-- metric families: the refresh function and the corpus datasets it reads (exact ids, plus LIKE patterns for
-- partitioned datasets such as doj_press_releases_<year>)
create table if not exists insights.families (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,31}$'),
  ordinal integer not null,
  datasets text[] not null default '{}',
  dataset_patterns text[] not null default '{}',
  description text not null
);

-- USPS / FIPS / name of the states, DC and the territories (Census Bureau FIPS state codes). The spine's state
-- entities come from this list; a source's state code outside it (military mail codes, foreign codes) is not a state.
create table if not exists insights.geo_states (
  usps text primary key check (usps ~ '^[A-Z]{2}$'),
  fips text not null unique check (fips ~ '^[0-9]{2}$'),
  name text not null,
  kind text not null check (kind in ('state', 'district', 'territory')),
  places_page boolean not null
);
insert into insights.geo_states (usps, fips, name, kind, places_page) values
  ('AL','01','Alabama','state',true), ('AK','02','Alaska','state',true), ('AZ','04','Arizona','state',true),
  ('AR','05','Arkansas','state',true), ('CA','06','California','state',true), ('CO','08','Colorado','state',true),
  ('CT','09','Connecticut','state',true), ('DE','10','Delaware','state',true), ('DC','11','District of Columbia','district',true),
  ('FL','12','Florida','state',true), ('GA','13','Georgia','state',true), ('HI','15','Hawaii','state',true),
  ('ID','16','Idaho','state',true), ('IL','17','Illinois','state',true), ('IN','18','Indiana','state',true),
  ('IA','19','Iowa','state',true), ('KS','20','Kansas','state',true), ('KY','21','Kentucky','state',true),
  ('LA','22','Louisiana','state',true), ('ME','23','Maine','state',true), ('MD','24','Maryland','state',true),
  ('MA','25','Massachusetts','state',true), ('MI','26','Michigan','state',true), ('MN','27','Minnesota','state',true),
  ('MS','28','Mississippi','state',true), ('MO','29','Missouri','state',true), ('MT','30','Montana','state',true),
  ('NE','31','Nebraska','state',true), ('NV','32','Nevada','state',true), ('NH','33','New Hampshire','state',true),
  ('NJ','34','New Jersey','state',true), ('NM','35','New Mexico','state',true), ('NY','36','New York','state',true),
  ('NC','37','North Carolina','state',true), ('ND','38','North Dakota','state',true), ('OH','39','Ohio','state',true),
  ('OK','40','Oklahoma','state',true), ('OR','41','Oregon','state',true), ('PA','42','Pennsylvania','state',true),
  ('RI','44','Rhode Island','state',true), ('SC','45','South Carolina','state',true), ('SD','46','South Dakota','state',true),
  ('TN','47','Tennessee','state',true), ('TX','48','Texas','state',true), ('UT','49','Utah','state',true),
  ('VT','50','Vermont','state',true), ('VA','51','Virginia','state',true), ('WA','53','Washington','state',true),
  ('WV','54','West Virginia','state',true), ('WI','55','Wisconsin','state',true), ('WY','56','Wyoming','state',true),
  ('AS','60','American Samoa','territory',false), ('GU','66','Guam','territory',false),
  ('MP','69','Northern Mariana Islands','territory',false), ('PR','72','Puerto Rico','territory',true),
  ('VI','78','U.S. Virgin Islands','territory',false)
on conflict (usps) do update set fips = excluded.fips, name = excluded.name, kind = excluded.kind,
  places_page = excluded.places_page;

alter table insights.metrics enable row level security;
alter table insights.facts enable row level security;
alter table insights.entities enable row level security;
alter table insights.links enable row level security;
alter table insights.runs enable row level security;
alter table insights.families enable row level security;
alter table insights.geo_states enable row level security;
revoke all on all tables in schema insights from public, anon, authenticated;

-- one staged fact (the return type of every insights.facts_<family>() function)
do $type$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'insights' and t.typname = 'fact_row') then
    create type insights.fact_row as (
      metric_id text, entity_type text, entity_id text, period text, period_start date, period_end date,
      value numeric, moe numeric, partial boolean, n numeric, not_recorded_reason text);
  end if;
end $type$;

-- ------------------------------------------------------------------------------------------------ helpers
-- a JSON number, or a string holding a plain or comma-grouped number ("1,234", "12.5"); anything else is null
create or replace function insights.jnum(p jsonb) returns numeric
language sql immutable parallel safe set search_path = '' as $$
  select case jsonb_typeof(p)
    when 'number' then (p #>> '{}')::numeric
    when 'string' then case when btrim(p #>> '{}') ~ '^-?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)([.][0-9]+)?$'
                            then replace(btrim(p #>> '{}'), ',', '')::numeric end
  end
$$;

create or replace function insights.jobj(p jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end
$$;

create or replace function insights.jarr(p jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end
$$;

-- an ISO calendar date "YYYY-MM-DD" (shape and day-of-month range checked), else null; text compares as dates do
create or replace function insights.iso_date(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when p ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then p end
$$;

create or replace function insights.fy_start(y integer) returns date
language sql immutable parallel safe set search_path = '' as $$ select make_date(y - 1, 10, 1) $$;

create or replace function insights.fy_end(y integer) returns date
language sql immutable parallel safe set search_path = '' as $$ select make_date(y, 9, 30) $$;

-- first day of a 12-month period that ends on p_end ("12 months ending 2024-06-30" starts 2023-07-01)
create or replace function insights.t12_start(p_end date) returns date
language sql immutable parallel safe set search_path = '' as $$
  select (p_end - interval '12 months' + interval '1 day')::date
$$;

create or replace function insights.month_end(p_month text) returns date
language sql immutable parallel safe set search_path = '' as $$
  select (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
$$;

-- the period-key shape of each period type (contract.ts PERIOD_TYPES)
create or replace function insights.period_ok(p_type text, p_period text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case p_type
    when 'year' then p_period ~ '^[0-9]{4}$'
    when 'fiscal_year' then p_period ~ '^FY[0-9]{4}$'
    when 'quarter' then p_period ~ '^[0-9]{4}-Q[1-4]$'
    when 'month' then p_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    when 'twelve_months_ending' then insights.iso_date(p_period) is not null
    when 'snapshot' then insights.iso_date(p_period) is not null
    else false end
$$;

-- Census resident population on July 1 (Population Estimates Program) for the nation, states, DC, Puerto Rico and
-- counties: vintage 2019 for 2010-2019, vintage 2025 for 2020-2025 (each year from one vintage only). The denominator of
-- every per-capita metric; a year or geography it does not cover has no row.
create or replace function insights.population()
returns table (entity_type text, entity_id text, year integer, pop numeric)
language sql stable set search_path = '' as $$
  with geo as (
    select case r.item -> 'census' ->> 'level' when 'us' then 'nation' else r.item -> 'census' ->> 'level' end as etype,
           case r.item -> 'census' ->> 'level' when 'us' then 'US' when 'state' then r.item -> 'census' ->> 'usps'
                else r.id end as eid,
           r.item -> 'census' -> 'series' as s
    from public.corpus_records r
    where r.dataset = 'census_pop_estimates' and r.item -> 'census' ->> 'level' in ('us', 'state', 'county')
  )
  select g.etype, g.eid, v.key::integer, insights.jnum(v.value)
  from geo g cross join lateral jsonb_each(insights.jobj(g.s -> 'v2019' -> 'pop')) v
  where v.key ~ '^[0-9]{4}$' and v.key::integer between 2010 and 2019 and insights.jnum(v.value) > 0
  union all
  select g.etype, g.eid, v.key::integer, insights.jnum(v.value)
  from geo g cross join lateral jsonb_each(insights.jobj(g.s -> 'v2025' -> 'pop')) v
  where v.key ~ '^[0-9]{4}$' and v.key::integer >= 2020 and insights.jnum(v.value) > 0
$$;

-- rate per 100,000 residents, rounded to 4 decimal places; null when either side is missing
create or replace function insights.per_100k(p_count numeric, p_pop numeric) returns numeric
language sql immutable parallel safe set search_path = '' as $$
  select case when p_count is not null and p_pop > 0 then round(p_count * 100000 / p_pop, 4) end
$$;

-- ------------------------------------------------------------------------------------------------ staging and merge
create or replace function insights.stage_open() returns void
language plpgsql set search_path = '' as $$
begin
  if to_regclass('pg_temp.insights_stage') is null then
    create temp table insights_stage (
      metric_id text not null, entity_type text not null, entity_id text not null, period text not null,
      period_start date not null, period_end date not null, value numeric, moe numeric, partial boolean not null,
      n numeric, not_recorded_reason text,
      primary key (metric_id, entity_type, entity_id, period));
  else
    truncate pg_temp.insights_stage;
  end if;
end $$;

-- Validate the staged facts of one family and merge them into insights.facts. Raises on any invalid row, so a family
-- either refreshes completely or not at all.
create or replace function insights.stage_commit(p_family text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_metrics text[];
  v_bad text;
  v_staged integer;
  v_deleted integer;
  v_inserted integer;
  v_updated integer;
begin
  v_metrics := array(select m.id from insights.metrics m where m.family = p_family order by m.id);
  select count(*) into v_staged from pg_temp.insights_stage;
  select s.metric_id into v_bad from pg_temp.insights_stage s
    where s.metric_id <> all (v_metrics) limit 1;
  if v_bad is not null then
    raise exception 'Staged fact for metric % is not a metric of family %', v_bad, p_family using errcode = '22023';
  end if;
  select s.metric_id || ' ' || s.entity_type into v_bad from pg_temp.insights_stage s
    join insights.metrics m on m.id = s.metric_id
    where s.entity_type <> all (m.entity_types) limit 1;
  if v_bad is not null then raise exception 'Entity type not declared by the metric: %', v_bad using errcode = '22023'; end if;
  select s.metric_id || ' ' || s.period into v_bad from pg_temp.insights_stage s
    join insights.metrics m on m.id = s.metric_id
    where not insights.period_ok(m.period_type, s.period) or s.period_end < s.period_start limit 1;
  if v_bad is not null then raise exception 'Period does not match the metric''s period type: %', v_bad using errcode = '22023'; end if;
  select s.metric_id || ' ' || s.entity_type || ':' || s.entity_id || ' ' || s.period into v_bad from pg_temp.insights_stage s
    where (s.value is null) <> (s.not_recorded_reason is not null)
       or (s.moe is not null and (s.moe < 0 or s.value is null)) limit 1;
  if v_bad is not null then raise exception 'A fact needs a value or a reason, not both: %', v_bad using errcode = '22023'; end if;
  select s.entity_type || ':' || s.entity_id || ' (' || s.metric_id || ')' into v_bad from pg_temp.insights_stage s
    where not exists (select 1 from insights.entities e where e.entity_type = s.entity_type and e.entity_id = s.entity_id)
    order by s.metric_id, s.entity_type, s.entity_id limit 1;
  if v_bad is not null then raise exception 'Fact for an entity missing from the spine: %', v_bad using errcode = '23503'; end if;

  with gone as (
    delete from insights.facts f
      where f.metric_id = any (v_metrics)
        and not exists (select 1 from pg_temp.insights_stage s where s.metric_id = f.metric_id and s.entity_type = f.entity_type
                        and s.entity_id = f.entity_id and s.period = f.period)
      returning 1)
  select count(*) into v_deleted from gone;

  update insights.facts f set period_start = s.period_start, period_end = s.period_end, value = s.value, moe = s.moe,
      partial = s.partial, n = s.n, not_recorded_reason = s.not_recorded_reason, computed_at = now()
    from pg_temp.insights_stage s
    where s.metric_id = f.metric_id and s.entity_type = f.entity_type and s.entity_id = f.entity_id and s.period = f.period
      and (f.period_start, f.period_end, f.value, f.moe, f.partial, f.n, f.not_recorded_reason)
          is distinct from (s.period_start, s.period_end, s.value, s.moe, s.partial, s.n, s.not_recorded_reason);
  get diagnostics v_updated = row_count;

  insert into insights.facts (metric_id, entity_type, entity_id, period, period_start, period_end, value, moe, partial, n,
      not_recorded_reason)
    select s.metric_id, s.entity_type, s.entity_id, s.period, s.period_start, s.period_end, s.value, s.moe, s.partial, s.n,
      s.not_recorded_reason
    from pg_temp.insights_stage s
    where not exists (select 1 from insights.facts f where f.metric_id = s.metric_id and f.entity_type = s.entity_type
                      and f.entity_id = s.entity_id and f.period = s.period);
  get diagnostics v_inserted = row_count;

  update insights.metrics m set coverage_from = c.cfrom, coverage_to = c.cto, coverage_entities = coalesce(c.ents, 0),
      coverage_facts = coalesce(c.nfacts, 0), refreshed_at = now()
    from (select mm.id, min(f.period) cfrom, max(f.period) cto, count(distinct (f.entity_type, f.entity_id))::integer ents,
                 count(f.metric_id)::integer nfacts
          from insights.metrics mm left join insights.facts f on f.metric_id = mm.id
          where mm.family = p_family group by mm.id) c
    where m.id = c.id;

  return jsonb_build_object('staged', v_staged, 'inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted,
    'unchanged', v_staged - v_inserted - v_updated);
end $$;

-- ------------------------------------------------------------------------------------------------ families
insert into insights.families (id, ordinal, datasets, dataset_patterns, description) values
  ('entities', 0, array['census_pop_estimates', 'census_acs_counties', 'census_cbp_counties', 'court_spine',
     'fjc_civil_districts', 'judge_profiles_fjc', 'judges', 'mdls', 'jpml_pending_history_mdls', 'company_sec_profiles',
     'company_sec_financials', 'company_payments_manufacturers', 'fr_agency_profiles', 'oversight_trends',
     'fda_faers_product_series', 'fda_device_event_series', 'ecfr_section_versions'], '{}',
   'Entity spine and exact links'),
  ('places', 10, array['census_pop_estimates', 'census_acs1_states', 'census_acs_counties', 'census_cbp_states',
     'census_cbp_counties'], '{}', 'Census population, ACS and County Business Patterns'),
  ('courts_fjc', 20, array['fjc_civil_national', 'fjc_civil_states', 'fjc_civil_districts', 'fjc_criminal_districts',
     'census_pop_estimates'], '{}', 'FJC Integrated Database civil and criminal series'),
  ('courts_tables', 30, array['uscourts_tables_district', 'uscourts_tables_circuit', 'uscourts_tables_bankruptcy'], '{}',
   'U.S. Courts published statistical tables'),
  ('judiciary', 40, array['judicial_vacancies', 'judge_profiles_fjc'], '{}', 'Judgeship vacancies and sitting judges'),
  ('mdl', 50, array['jpml_pending_history_mdls', 'mdls', 'jpml_statistics_extra', 'mdl_intel_jpml_stats',
     'scac_statistics'], '{}', 'Multidistrict litigation and securities class actions'),
  ('caselaw', 60, array['caselaw'], '{}', 'Case-law opinion clusters (caselaw.cases)'),
  ('enforcement', 70, array['sec_enforcement_actions', 'ftc_enforcement_actions', 'frb_enforcement_actions',
     'epa_echo_case_series', 'osha_inspections_states', 'osha_inspections_national', 'oig_leie_exclusions',
     'oversight_trends'], array['doj\_press\_releases\_2%'], 'Federal enforcement and oversight output'),
  ('safety', 80, array['regulatory_cpsc_aggregates', 'agency_safety_nhtsa_recalls', 'fsis_recalls',
     'agency_safety_openfda_drug_enforcement', 'agency_safety_openfda_device_enforcement',
     'agency_safety_openfda_food_enforcement', 'fda_faers_national_series', 'fda_faers_product_series',
     'fda_device_event_series', 'fda_caers_series', 'neiss_national_years', 'saferproducts_reports_series'], '{}',
   'Recalls, adverse-event reports and injury estimates'),
  ('companies', 90, array['company_sec_financials', 'company_payments_manufacturers'], '{}',
   'Company financials and industry payments'),
  ('government', 100, array['fr_agency_trends', 'ecfr_section_versions', 'congress_bills', 'public_laws_enacted',
     'state_bills'], '{}', 'Federal Register, CFR, Congress and state legislation'),
  ('consumer', 110, array['cfpb_complaints_states', 'cfpb_complaints_national', 'ftc_sentinel_states',
     'ftc_sentinel_national', 'ftc_dnc_states', 'census_pop_estimates'], '{}', 'Consumer complaints and reports')
on conflict (id) do update set ordinal = excluded.ordinal, datasets = excluded.datasets,
  dataset_patterns = excluded.dataset_patterns, description = excluded.description;

-- ------------------------------------------------------------------------------------------------ metric registry
-- One row per metric (contract.ts MetricDef). Coverage columns are written by each refresh.
insert into insights.metrics (id, family, ordinal, label, description, unit, format, topic, entity_types, period_type,
  source_datasets, source_links, numerator, denominator, method, caveats, direction) values
-- places ------------------------------------------------------------------------------------------------------------
('pop_resident', 'places', 1000, 'Resident population',
 'Resident population on July 1 as estimated by the Census Bureau Population Estimates Program.',
 'people', 'count', 'places', array['nation', 'state', 'county'], 'year', array['census_pop_estimates'],
 '[{"label": "Census Bureau, Population Estimates Program", "url": "https://www.census.gov/programs-surveys/popest.html"}]',
 'Resident population on July 1 of the year, as published', null,
 'Value as published: vintage 2019 estimates for 2010-2019 and vintage 2025 estimates for 2020-2025 (each year from one vintage only).',
 array['An estimate, not a count. Vintages are not revised together: 2010-2019 come from vintage 2019 and 2020-2025 from vintage 2025, so 2019 to 2020 crosses two estimate series.',
       'Connecticut counties are planning regions in the 2022 and later estimates. Puerto Rico municipios are not included.'],
 'neutral'),
('acs1_median_household_income', 'places', 1010, 'Median household income (ACS 1-year)',
 'Median household income in the past 12 months, American Community Survey 1-year estimate (table B19013).',
 'dollars (inflation-adjusted to the survey year)', 'currency_usd', 'places', array['nation', 'state'], 'year',
 array['census_acs1_states'],
 '[{"label": "Census Bureau, ACS 1-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-1year.html"}]',
 'Median household income (B19013_001) as published', null,
 'Value and margin of error (90 percent) as published.',
 array['Survey estimate with a margin of error at the 90 percent confidence level.',
       'Dollars of each survey year; years are not adjusted to a common year.',
       'The Census Bureau released no standard 2020 ACS 1-year estimates; 2020 is Not recorded.'],
 'neutral'),
('acs1_poverty_rate', 'places', 1011, 'People below the poverty level (ACS 1-year)',
 'Share of people for whom poverty status is determined whose income is below the poverty level (table B17001).',
 'percent of people for whom poverty status is determined', 'percent', 'places', array['nation', 'state'], 'year',
 array['census_acs1_states'],
 '[{"label": "Census Bureau, ACS 1-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-1year.html"}]',
 'People below the poverty level (B17001_002)', 'People for whom poverty status is determined (B17001_001), same survey and year',
 'Percentage computed by the corpus builder from the published cells: 100 x B17001_002 / B17001_001, with the ACS handbook margin of error for a ratio.',
 array['Survey estimate with a margin of error at the 90 percent confidence level.',
       'The Census Bureau released no standard 2020 ACS 1-year estimates; 2020 is Not recorded.'],
 'neutral'),
('acs1_uninsured_rate', 'places', 1012, 'No health insurance coverage (ACS 1-year)',
 'Share of the civilian noninstitutionalized population with no health insurance coverage (table B27010).',
 'percent of civilian noninstitutionalized population', 'percent', 'places', array['nation', 'state'], 'year',
 array['census_acs1_states'],
 '[{"label": "Census Bureau, ACS 1-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-1year.html"}]',
 'People with no health insurance coverage (B27010_017 + _033 + _050 + _066)',
 'Civilian noninstitutionalized population (B27010_001), same survey and year',
 'Percentage computed by the corpus builder from the published cells, with the ACS handbook margin of error.',
 array['Survey estimate with a margin of error at the 90 percent confidence level.',
       'The Census Bureau released no standard 2020 ACS 1-year estimates; 2020 is Not recorded.'],
 'neutral'),
('acs1_bachelors_or_higher', 'places', 1013, 'Bachelor''s degree or higher (ACS 1-year)',
 'Share of the population 25 years and over with a bachelor''s, master''s, professional or doctorate degree (table B15003).',
 'percent of population 25 years and over', 'percent', 'places', array['nation', 'state'], 'year',
 array['census_acs1_states'],
 '[{"label": "Census Bureau, ACS 1-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-1year.html"}]',
 'Population 25 and over with a bachelor''s degree or higher (B15003_022 to _025)',
 'Population 25 years and over (B15003_001), same survey and year',
 'Percentage computed by the corpus builder from the published cells, with the ACS handbook margin of error.',
 array['Survey estimate with a margin of error at the 90 percent confidence level.',
       'The Census Bureau released no standard 2020 ACS 1-year estimates; 2020 is Not recorded.'],
 'neutral'),
('acs1_unemployment_rate', 'places', 1014, 'Unemployment rate (ACS 1-year)',
 'Unemployed share of the civilian labor force, American Community Survey 1-year estimate (table B23025).',
 'percent of civilian labor force', 'percent', 'places', array['nation', 'state'], 'year', array['census_acs1_states'],
 '[{"label": "Census Bureau, ACS 1-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-1year.html"}]',
 'Unemployed (B23025_005)', 'Civilian labor force (B23025_003), same survey and year',
 'Percentage computed by the corpus builder from the published cells, with the ACS handbook margin of error.',
 array['A survey estimate for the whole year; not the monthly BLS unemployment rate.',
       'The Census Bureau released no standard 2020 ACS 1-year estimates; 2020 is Not recorded.'],
 'neutral'),
('acs1_median_home_value', 'places', 1015, 'Median home value (ACS 1-year)',
 'Median value of owner-occupied housing units as reported by owners (table B25077).',
 'dollars', 'currency_usd', 'places', array['nation', 'state'], 'year', array['census_acs1_states'],
 '[{"label": "Census Bureau, ACS 1-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-1year.html"}]',
 'Median value of owner-occupied housing units (B25077_001) as published', null,
 'Value and margin of error (90 percent) as published.',
 array['Owner-reported value; survey estimate with a margin of error at the 90 percent confidence level.',
       'The Census Bureau released no standard 2020 ACS 1-year estimates; 2020 is Not recorded.'],
 'neutral'),
('acs5_median_household_income', 'places', 1020, 'Median household income (ACS 5-year)',
 'Median household income, American Community Survey 5-year estimate (table B19013), for counties. The period is the five-year window ending in the year shown.',
 'dollars (inflation-adjusted to the last year of the window)', 'currency_usd', 'places', array['county'], 'year',
 array['census_acs_counties'],
 '[{"label": "Census Bureau, ACS 5-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-5year.html"}]',
 'Median household income (B19013_001) as published', null,
 'Value and margin of error (90 percent) as published; the period key is the last year of the five-year window (period_start is January 1 of its first year).',
 array['A five-year estimate: "2024" means the 2020-2024 window. Consecutive windows share four years and are not independent.',
       'Connecticut planning regions replace its counties from the 2018-2022 window; Valdez-Cordova was split in 2019.'],
 'neutral'),
('acs5_poverty_rate', 'places', 1021, 'People below the poverty level (ACS 5-year)',
 'Share of people for whom poverty status is determined whose income is below the poverty level, 5-year estimate (table B17001), for counties.',
 'percent of people for whom poverty status is determined', 'percent', 'places', array['county'], 'year',
 array['census_acs_counties'],
 '[{"label": "Census Bureau, ACS 5-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-5year.html"}]',
 'People below the poverty level (B17001_002)', 'People for whom poverty status is determined (B17001_001), same window',
 'Percentage computed by the corpus builder from the published cells, with the ACS handbook margin of error; period key is the last year of the window.',
 array['A five-year estimate: "2024" means the 2020-2024 window. Consecutive windows share four years and are not independent.'],
 'neutral'),
('acs5_uninsured_rate', 'places', 1022, 'No health insurance coverage (ACS 5-year)',
 'Share of the civilian noninstitutionalized population with no health insurance coverage, 5-year estimate (table B27010), for counties.',
 'percent of civilian noninstitutionalized population', 'percent', 'places', array['county'], 'year',
 array['census_acs_counties'],
 '[{"label": "Census Bureau, ACS 5-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-5year.html"}]',
 'People with no health insurance coverage (B27010_017 + _033 + _050 + _066)',
 'Civilian noninstitutionalized population (B27010_001), same window',
 'Percentage computed by the corpus builder from the published cells, with the ACS handbook margin of error; period key is the last year of the window.',
 array['A five-year estimate: "2024" means the 2020-2024 window. Consecutive windows share four years and are not independent.'],
 'neutral'),
('acs5_bachelors_or_higher', 'places', 1023, 'Bachelor''s degree or higher (ACS 5-year)',
 'Share of the population 25 years and over with a bachelor''s degree or higher, 5-year estimate (table B15003), for counties.',
 'percent of population 25 years and over', 'percent', 'places', array['county'], 'year', array['census_acs_counties'],
 '[{"label": "Census Bureau, ACS 5-year estimates", "url": "https://www.census.gov/data/developers/data-sets/acs-5year.html"}]',
 'Population 25 and over with a bachelor''s degree or higher (B15003_022 to _025)',
 'Population 25 years and over (B15003_001), same window',
 'Percentage computed by the corpus builder from the published cells, with the ACS handbook margin of error; period key is the last year of the window.',
 array['A five-year estimate: "2024" means the 2020-2024 window. Consecutive windows share four years and are not independent.'],
 'neutral'),
('cbp_establishments', 'places', 1030, 'Business establishments (County Business Patterns)',
 'Establishments with paid employees, all NAICS sectors, County Business Patterns.',
 'establishments', 'count', 'places', array['nation', 'state', 'county'], 'year',
 array['census_cbp_states', 'census_cbp_counties'],
 '[{"label": "Census Bureau, County Business Patterns", "url": "https://www.census.gov/programs-surveys/cbp.html"}]',
 'Establishments (ESTAB), all sectors (NAICS 00), as published', null, 'Value as published.',
 array['Covers establishments with paid employees; excludes most government employers, self-employed people and farm production.',
       'A figure the Census Bureau withholds (flags D or S) is Not recorded with its reason.'],
 'higher_is_more'),
('cbp_employees', 'places', 1031, 'Employees in the mid-March pay period (County Business Patterns)',
 'Paid employees for the pay period including March 12, all NAICS sectors, County Business Patterns.',
 'employees', 'count', 'places', array['nation', 'state', 'county'], 'year',
 array['census_cbp_states', 'census_cbp_counties'],
 '[{"label": "Census Bureau, County Business Patterns", "url": "https://www.census.gov/programs-surveys/cbp.html"}]',
 'Employees (EMP), all sectors, as published', null, 'Value as published.',
 array['Counts paid employees of private establishments in the mid-March pay period; not total employment.',
       'A figure the Census Bureau withholds (flags D or S) is Not recorded with its reason.'],
 'higher_is_more'),
('cbp_annual_payroll', 'places', 1032, 'Annual payroll (County Business Patterns)',
 'Annual payroll of establishments with paid employees, all NAICS sectors, County Business Patterns.',
 'dollars', 'currency_usd', 'places', array['nation', 'state', 'county'], 'year',
 array['census_cbp_states', 'census_cbp_counties'],
 '[{"label": "Census Bureau, County Business Patterns", "url": "https://www.census.gov/programs-surveys/cbp.html"}]',
 'Annual payroll (PAYANN), all sectors', null,
 'Published in thousands of dollars; stored in dollars (published value x 1,000, exact).',
 array['Nominal dollars, not adjusted for inflation.',
       'A figure the Census Bureau withholds (flags D or S) is Not recorded with its reason.'],
 'higher_is_more'),
-- courts: FJC Integrated Database ------------------------------------------------------------------------------------
('fjc_civil_filed', 'courts_fjc', 2000, 'Federal civil cases filed',
 'Civil cases filed in the U.S. district courts in the fiscal year, Federal Judicial Center Integrated Database.',
 'cases', 'count', 'courts', array['nation', 'state', 'court'], 'fiscal_year',
 array['fjc_civil_national', 'fjc_civil_states', 'fjc_civil_districts'],
 '[{"label": "Federal Judicial Center, Integrated Database (civil)", "url": "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present"}]',
 'Civil cases with a filing date in the fiscal year (October 1 to September 30)', null,
 'Count computed by the corpus builder from the IDB case records; state figures sum the state''s districts.',
 array['Fiscal years end September 30 and are named for the year they end.',
       'The latest fiscal year runs only through the IDB file''s last filing date and is partial.',
       'MDL member actions filed directly in a transferee court count where they are filed.'],
 'higher_is_more'),
('fjc_civil_terminated', 'courts_fjc', 2001, 'Federal civil cases terminated',
 'Civil cases terminated in the U.S. district courts in the fiscal year, FJC Integrated Database.',
 'cases', 'count', 'courts', array['nation', 'state', 'court'], 'fiscal_year',
 array['fjc_civil_national', 'fjc_civil_states', 'fjc_civil_districts'],
 '[{"label": "Federal Judicial Center, Integrated Database (civil)", "url": "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present"}]',
 'Civil cases with a termination date in the fiscal year', null,
 'Count computed by the corpus builder from the IDB case records; state figures sum the state''s districts.',
 array['A year''s terminations include cases filed in earlier years.',
       'The latest fiscal year is partial.'],
 'neutral'),
('fjc_civil_pending', 'courts_fjc', 2002, 'Federal civil cases pending at fiscal-year end',
 'Civil cases pending in the U.S. district courts at the end of the fiscal year, FJC Integrated Database.',
 'cases', 'count', 'courts', array['nation', 'state', 'court'], 'fiscal_year',
 array['fjc_civil_national', 'fjc_civil_states', 'fjc_civil_districts'],
 '[{"label": "Federal Judicial Center, Integrated Database (civil)", "url": "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present"}]',
 'Civil cases filed and not terminated at the end of the fiscal year (or at the IDB snapshot for the partial year)', null,
 'Count computed by the corpus builder from the IDB case records.',
 array['For the partial latest fiscal year the count is as of the IDB snapshot, not September 30.'],
 'neutral'),
('fjc_civil_median_days', 'courts_fjc', 2003, 'Median days from filing to termination, federal civil cases',
 'Median number of days from filing to termination of the civil cases terminated in the fiscal year.',
 'days', 'days', 'courts', array['nation', 'state', 'court'], 'fiscal_year',
 array['fjc_civil_national', 'fjc_civil_states', 'fjc_civil_districts'],
 '[{"label": "Federal Judicial Center, Integrated Database (civil)", "url": "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present"}]',
 'Median of (termination date - filing date) over cases terminated in the fiscal year', null,
 'Median computed by the corpus builder from the IDB case records; n is the number of cases terminated in the year.',
 array['Mass terminations of MDL member actions can move a district''s median sharply.',
       'Earlier fiscal years without a computed median are Not recorded.'],
 'higher_is_less'),
('fjc_civil_filed_per_100k', 'courts_fjc', 2004, 'Federal civil cases filed per 100,000 residents',
 'Civil cases filed in the state''s federal district courts per 100,000 residents.',
 'cases per 100,000 residents', 'rate_per_100k', 'courts', array['nation', 'state'], 'fiscal_year',
 array['fjc_civil_national', 'fjc_civil_states', 'census_pop_estimates'],
 '[{"label": "Federal Judicial Center, Integrated Database (civil)", "url": "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present"}, {"label": "Census Bureau, Population Estimates Program", "url": "https://www.census.gov/programs-surveys/popest.html"}]',
 'Civil cases filed in the fiscal year (fjc_civil_filed)',
 'Census resident population on July 1 of the calendar year in which the fiscal year ends (July 1 falls inside the fiscal year); vintage 2019 for 2010-2019, vintage 2025 for 2020-2025',
 'cases x 100,000 / population, rounded to 4 decimal places; n is the case count.',
 array['Where a case is filed is not where the parties live: MDL member actions and removals concentrate filings in some districts.',
       'No rate before 2010 or for a fiscal year without a population estimate (Not recorded).'],
 'higher_is_more'),
('fjc_criminal_filed', 'courts_fjc', 2010, 'Federal criminal defendants filed',
 'Criminal defendants filed in the U.S. district courts in the fiscal year, FJC Integrated Database.',
 'defendants', 'count', 'courts', array['nation', 'court'], 'fiscal_year', array['fjc_criminal_districts'],
 '[{"label": "Federal Judicial Center, Integrated Database (criminal)", "url": "https://www.fjc.gov/research/idb/criminal-defendants-filed-terminated-and-pending-fy-1996-present"}]',
 'Criminal defendants with a filing date in the fiscal year, including inter-district transfers', null,
 'Count computed by the corpus builder from the IDB defendant records.',
 array['Counts defendants, not cases.', 'The latest fiscal year is partial.'],
 'higher_is_more'),
('fjc_criminal_terminated', 'courts_fjc', 2011, 'Federal criminal defendants terminated',
 'Criminal defendants terminated in the U.S. district courts in the fiscal year, FJC Integrated Database.',
 'defendants', 'count', 'courts', array['nation', 'court'], 'fiscal_year', array['fjc_criminal_districts'],
 '[{"label": "Federal Judicial Center, Integrated Database (criminal)", "url": "https://www.fjc.gov/research/idb/criminal-defendants-filed-terminated-and-pending-fy-1996-present"}]',
 'Criminal defendants with a termination date in the fiscal year', null,
 'Count computed by the corpus builder from the IDB defendant records.',
 array['Counts defendants, not cases.', 'The latest fiscal year is partial.'],
 'neutral'),
-- courts: U.S. Courts published tables -------------------------------------------------------------------------------
('usc_civil_filed', 'courts_tables', 3000, 'Civil cases commenced (U.S. Courts Table C)',
 'Civil cases commenced in the 12-month period, as printed in U.S. Courts statistical Table C. For a circuit: the district courts in the circuit.',
 'cases', 'count', 'courts', array['nation', 'circuit', 'court'], 'twelve_months_ending',
 array['uscourts_tables_district', 'uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table C)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Civil cases commenced, column "Filed" of Table C', null,
 'Value as printed for the 12-month period; the national value is the table''s total row (taken only when every court record of the table prints the same total).',
 array['Tables are published for 12-month periods ending March 31, June 30, September 30 and December 31; periods overlap.',
       'A dash printed in the table is Not recorded, not zero.'],
 'higher_is_more'),
('usc_civil_terminated', 'courts_tables', 3001, 'Civil cases terminated (U.S. Courts Table C)',
 'Civil cases terminated in the 12-month period, U.S. Courts statistical Table C.',
 'cases', 'count', 'courts', array['nation', 'circuit', 'court'], 'twelve_months_ending',
 array['uscourts_tables_district', 'uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table C)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Civil cases terminated, column "Terminated" of Table C', null, 'Value as printed for the 12-month period.',
 array['Periods of different end dates overlap; compare like with like (e.g. September 30 to September 30).'],
 'neutral'),
('usc_civil_pending', 'courts_tables', 3002, 'Civil cases pending at period end (U.S. Courts Table C)',
 'Civil cases pending at the end of the 12-month period, U.S. Courts statistical Table C.',
 'cases', 'count', 'courts', array['nation', 'circuit', 'court'], 'twelve_months_ending',
 array['uscourts_tables_district', 'uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table C)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Civil cases pending, column "Pending" of Table C', null, 'Value as printed for the period end.',
 array['A count at the end of the period, published with the 12-month table.'],
 'neutral'),
('usc_civil_median_months', 'courts_tables', 3003, 'Median months from filing to disposition, civil cases (Table C-5)',
 'Median time in months from filing to disposition of civil cases terminated in the 12-month period, U.S. Courts Table C-5.',
 'months', 'months', 'courts', array['nation', 'circuit', 'court'], 'twelve_months_ending',
 array['uscourts_tables_district', 'uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table C-5)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Median time interval in months, total cases, Table C-5', null,
 'Value of the published table''s spreadsheet cell (it can carry more decimals than the printed page, which rounds to one); n is the number of cases terminated in the same table.',
 array['Table C-5 excludes land condemnation, prisoner petitions, deportation reviews, recovery of overpayments and enforcement of judgments.'],
 'higher_is_less'),
('usc_civil_pending_3yr_pct', 'courts_tables', 3004, 'Civil cases pending three years or more (Table C-6)',
 'Share of pending civil cases that had been pending three years or more on the date shown, U.S. Courts Table C-6.',
 'percent of pending civil cases', 'percent', 'courts', array['nation', 'circuit', 'court'], 'snapshot',
 array['uscourts_tables_district', 'uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table C-6)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Civil cases pending three years or more, Table C-6', 'All civil cases pending on the same date (Table C-6 total)',
 'Percent of the published table''s spreadsheet cell (it can carry more decimals than the printed page); n is the number pending three years or more in the same table.',
 array['Pending MDL member actions are counted in the transferee district and can dominate a district''s share.'],
 'higher_is_less'),
('usc_weighted_filings_per_judgeship', 'courts_tables', 3005, 'Weighted filings per authorized judgeship (Table X-1A)',
 'Weighted civil and criminal filings per authorized district judgeship in the 12-month period, U.S. Courts Table X-1A.',
 'weighted filings per judgeship', 'ratio', 'courts', array['nation', 'court'], 'twelve_months_ending',
 array['uscourts_tables_district'],
 '[{"label": "U.S. Courts, statistical tables (Table X-1A)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Weighted filings per judgeship, total column of Table X-1A', 'Authorized judgeships as printed in the same table',
 'Value of the published table''s spreadsheet cell (it can carry more decimals than the printed page, which shows whole numbers).',
 array['Case weights reflect the Judicial Conference''s weighting study in force for the period; weights changed over time.'],
 'neutral'),
('usc_judgeships', 'courts_tables', 3006, 'Authorized district judgeships (Table X-1A)',
 'Authorized Article III district judgeships, as printed in U.S. Courts Table X-1A for the period.',
 'judgeships', 'count', 'courts', array['nation', 'court'], 'twelve_months_ending', array['uscourts_tables_district'],
 '[{"label": "U.S. Courts, statistical tables (Table X-1A)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Judgeships column of Table X-1A', null, 'Value as printed.',
 array['Authorized judgeships, not judges serving; vacancies are not subtracted.'],
 'neutral'),
('usc_product_liability_filed', 'courts_tables', 3007, 'Product liability cases commenced (Table C-11)',
 'Product liability civil cases commenced in the 12-month period, U.S. Courts Table C-11.',
 'cases', 'count', 'litigation', array['nation', 'circuit', 'court'], 'twelve_months_ending',
 array['uscourts_tables_district', 'uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table C-11)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Total product liability cases commenced in the current year column of Table C-11', null, 'Value as printed.',
 array['Mass torts concentrate filings: MDL direct filings make a few transferee districts dominate.'],
 'higher_is_more'),
('usc_appeals_filed', 'courts_tables', 3010, 'Appeals commenced in the U.S. courts of appeals (Table B)',
 'Appeals commenced in the 12-month period, U.S. Courts statistical Table B, by court of appeals.',
 'appeals', 'count', 'courts', array['nation', 'circuit'], 'twelve_months_ending', array['uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table B)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Appeals commenced, column "Filed" of Table B', null,
 'Value as printed; the national value is the table''s total row when every circuit record prints the same total.',
 array['Table B covers the regional courts of appeals; the Federal Circuit is reported separately (Table B-8).'],
 'higher_is_more'),
('usc_appeals_terminated', 'courts_tables', 3011, 'Appeals terminated in the U.S. courts of appeals (Table B)',
 'Appeals terminated in the 12-month period, U.S. Courts statistical Table B.',
 'appeals', 'count', 'courts', array['nation', 'circuit'], 'twelve_months_ending', array['uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table B)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Appeals terminated, column "Terminated" of Table B', null, 'Value as printed.', array[]::text[], 'neutral'),
('usc_appeals_pending', 'courts_tables', 3012, 'Appeals pending at period end (Table B)',
 'Appeals pending at the end of the 12-month period, U.S. Courts statistical Table B.',
 'appeals', 'count', 'courts', array['nation', 'circuit'], 'twelve_months_ending', array['uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table B)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Appeals pending, column "Pending" of Table B', null, 'Value as printed.', array[]::text[], 'neutral'),
('usc_bankruptcy_filed', 'courts_tables', 3013, 'Bankruptcy cases commenced (Table F)',
 'Bankruptcy cases commenced in the 12-month period in the district''s bankruptcy court, U.S. Courts Table F (the entity is the district court).',
 'cases', 'count', 'courts', array['nation', 'circuit', 'court'], 'twelve_months_ending',
 array['uscourts_tables_bankruptcy', 'uscourts_tables_circuit'],
 '[{"label": "U.S. Courts, statistical tables (Table F)", "url": "https://www.uscourts.gov/data-news/data-tables"}]',
 'Bankruptcy cases commenced, column "Filed" of Table F', null, 'Value as printed.',
 array['Rows the table prints for the two Arkansas districts combined have no court entity; they count in the national total only.'],
 'higher_is_more'),
-- courts: judiciary --------------------------------------------------------------------------------------------------
('judicial_vacancies', 'judiciary', 4000, 'Federal judgeships vacant',
 'Vacancies on the Administrative Office''s monthly list of current Article III judicial vacancies.',
 'vacancies', 'count', 'courts', array['nation'], 'month', array['judicial_vacancies'],
 '[{"label": "U.S. Courts, judicial vacancies archive", "url": "https://www.uscourts.gov/data-news/judicial-vacancies/archive-judicial-vacancies"}]',
 'Vacancies listed on the month''s list', null,
 'Count of the vacancies the month''s list prints, kept only when the whole list was read.',
 array['A month whose list could not be read in full (scanned report without text, unsupported layout, partly read) is Not recorded, never a smaller number or zero.'],
 'neutral'),
('fjc_sitting_judges', 'judiciary', 4001, 'Sitting Article III judges',
 'Article III judges recorded as sitting (active or senior) on the court in the Federal Judicial Center''s Biographical Directory.',
 'judges', 'count', 'courts', array['nation', 'court'], 'snapshot', array['judge_profiles_fjc'],
 '[{"label": "Federal Judicial Center, Biographical Directory of Article III Federal Judges", "url": "https://www.fjc.gov/history/judges"}]',
 'Judges whose directory record is sitting, by the court of their current service', null,
 'Count of directory records, as of the directory retrieval date.',
 array['Article III judges only: magistrate and bankruptcy judges are not in the directory.'],
 'neutral'),
-- litigation -------------------------------------------------------------------------------------------------------
('mdl_actions_pending', 'mdl', 5000, 'Actions pending in multidistrict litigation',
 'Actions pending in each MDL as listed in the JPML''s monthly Pending MDL Dockets report; the national value sums the MDLs of the report.',
 'actions', 'count', 'litigation', array['nation', 'mdl'], 'snapshot', array['jpml_pending_history_mdls'],
 '[{"label": "Judicial Panel on Multidistrict Litigation, pending MDL dockets", "url": "https://www.jpml.uscourts.gov/pending-mdls"}]',
 'Actions pending as printed for the MDL on the report date', null,
 'Value as printed; national value = sum over the MDLs listed in the report (n = MDLs listed).',
 array['The period is the report date (the first of the month). Pending counts fall when member actions are dismissed or remanded, not only when cases resolve.'],
 'neutral'),
('mdl_actions_total', 'mdl', 5001, 'Actions in multidistrict litigation since creation',
 'Total actions (historical) the JPML''s monthly report prints for the MDL, pending and closed.',
 'actions', 'count', 'litigation', array['mdl'], 'snapshot', array['jpml_pending_history_mdls'],
 '[{"label": "Judicial Panel on Multidistrict Litigation, pending MDL dockets", "url": "https://www.jpml.uscourts.gov/pending-mdls"}]',
 'Total actions (historical) as printed on the report date', null, 'Value as printed.', array[]::text[], 'neutral'),
('mdl_pending_mdls', 'mdl', 5002, 'MDLs pending',
 'Multidistrict litigations listed as pending in the JPML''s monthly Pending MDL Dockets report.',
 'MDLs', 'count', 'litigation', array['nation'], 'snapshot', array['jpml_pending_history_mdls'],
 '[{"label": "Judicial Panel on Multidistrict Litigation, pending MDL dockets", "url": "https://www.jpml.uscourts.gov/pending-mdls"}]',
 'MDLs listed in the report with a pending count', null, 'Count of the MDLs in the report.', array[]::text[], 'neutral'),
('mdl_court_actions_pending', 'mdl', 5003, 'Actions pending in MDLs assigned to the court',
 'Actions pending in the pending MDLs whose transferee court is the court, per the JPML report the MDL registry was built from.',
 'actions', 'count', 'litigation', array['court'], 'snapshot', array['mdls'],
 '[{"label": "Judicial Panel on Multidistrict Litigation, pending MDL dockets", "url": "https://www.jpml.uscourts.gov/pending-mdls"}]',
 'Sum of actions pending over the court''s pending MDLs', null,
 'Deterministic sum of printed values; n is the number of pending MDLs in the court.',
 array['MDLs whose transferee court could not be identified exactly are not attributed to any court.'],
 'neutral'),
('mdl_court_pending_mdls', 'mdl', 5004, 'Pending MDLs assigned to the court',
 'Pending multidistrict litigations whose transferee court is the court.',
 'MDLs', 'count', 'litigation', array['court'], 'snapshot', array['mdls'],
 '[{"label": "Judicial Panel on Multidistrict Litigation, pending MDL dockets", "url": "https://www.jpml.uscourts.gov/pending-mdls"}]',
 'Pending MDLs with the court as transferee court', null, 'Count of registry records.', array[]::text[], 'neutral'),
('jpml_fy_actions_pending', 'mdl', 5005, 'Actions pending in MDL transferee districts at fiscal-year end',
 'Actions pending in MDL transferee districts at the end of the fiscal year, JPML fiscal-year statistics.',
 'actions', 'count', 'litigation', array['nation'], 'fiscal_year', array['jpml_statistics_extra'],
 '[{"label": "Judicial Panel on Multidistrict Litigation, statistics", "url": "https://www.jpml.uscourts.gov/statistics-info"}]',
 'Total actions pending on September 30, as printed in the Panel''s circuit-and-district table', null,
 'Value as printed.', array['FY1992 prints a 15-month report period; the pending count is still the September 30 figure.'],
 'neutral'),
('jpml_motions_granted', 'mdl', 5006, 'Motions for centralization granted by the JPML',
 'Motions for transfer under 28 U.S.C. 1407 that the Judicial Panel on Multidistrict Litigation granted in the calendar year.',
 'motions', 'count', 'litigation', array['nation'], 'year', array['mdl_intel_jpml_stats'],
 '[{"label": "Judicial Panel on Multidistrict Litigation, statistics", "url": "https://www.jpml.uscourts.gov/statistics-info"}]',
 'Motions granted as printed in the Panel''s calendar-year statistics', null, 'Value as printed.',
 array['A granted motion creates a new MDL docket or adds a litigation to one.'],
 'higher_is_more'),
('scac_filings', 'mdl', 5007, 'Federal securities class action filings',
 'Federal securities class action filings by calendar year, Stanford Securities Class Action Clearinghouse.',
 'filings', 'count', 'litigation', array['nation'], 'year', array['scac_statistics'],
 '[{"label": "Stanford Law School Securities Class Action Clearinghouse", "url": "https://securities.stanford.edu/"}]',
 'Filings as published by the Clearinghouse', null, 'Value as published.',
 array['The latest year runs only through the Clearinghouse''s as-of date and is partial.'],
 'higher_is_more'),
('caselaw_opinion_clusters', 'caselaw', 6000, 'Court opinions (opinion clusters) filed',
 'Opinion clusters with an exact filing date in the year in CourtListener''s bulk data (one cluster holds a case''s opinions).',
 'opinion clusters', 'count', 'litigation', array['nation', 'court'], 'year', array['caselaw'],
 '[{"label": "CourtListener bulk data (Free Law Project)", "url": "https://www.courtlistener.com/help/api/bulk-data/"}]',
 'Opinion clusters whose filing date (not approximate) falls in the year', null,
 'Count of caselaw.cases rows; the nation row counts every court in the collection (federal and state).',
 array['Coverage differs by court and era; a low count can mean incomplete coverage rather than few decisions.',
       'Clusters with only an approximate date are not counted. The latest year runs only through the bulk snapshot and is partial.'],
 'neutral'),
('caselaw_citations_received', 'caselaw', 6001, 'Citations received by the year''s opinions',
 'Later opinions citing the opinion clusters filed in the year, summed over clusters (CourtListener citation map).',
 'citing opinions', 'count', 'litigation', array['nation', 'court'], 'year', array['caselaw'],
 '[{"label": "CourtListener bulk data (Free Law Project)", "url": "https://www.courtlistener.com/help/api/bulk-data/"}]',
 'Sum of cited_by (citing opinions in the citation map) over the clusters counted in caselaw_opinion_clusters', null,
 'Deterministic sum; n is the number of clusters.',
 array['Older opinions have had longer to be cited; compare years with care.'],
 'neutral'),
-- enforcement ------------------------------------------------------------------------------------------------------
('doj_press_releases', 'enforcement', 7000, 'Department of Justice press releases',
 'Press releases published on justice.gov in the calendar year (all components and U.S. Attorneys'' offices).',
 'press releases', 'count', 'enforcement', array['nation'], 'year', array['doj_press_releases'],
 '[{"label": "U.S. Department of Justice, news", "url": "https://www.justice.gov/news"}]',
 'Press releases with a release date in the year', null,
 'Count of corpus records of the yearly partitions doj_press_releases_<year> by release date.',
 array['Counts publications, not cases, charges or outcomes. The latest year runs through the latest release held and is partial.'],
 'higher_is_more'),
('doj_state_press_releases', 'enforcement', 7001, 'DOJ press releases attributed to an office in the state',
 'Justice Department press releases whose stored office state is the state (mostly U.S. Attorneys'' offices).',
 'press releases', 'count', 'enforcement', array['state'], 'year', array['doj_press_releases'],
 '[{"label": "U.S. Department of Justice, news", "url": "https://www.justice.gov/news"}]',
 'Press releases with a release date in the year and the state as office state', null,
 'Count of corpus records of the yearly partitions doj_press_releases_<year> by release date and office state.',
 array['Releases of headquarters components without an office state are not attributed to any state.',
       'A year with no release for the state has no fact (Not recorded), not zero.'],
 'higher_is_more'),
('sec_litigation_releases', 'enforcement', 7002, 'SEC litigation releases',
 'Litigation releases the Securities and Exchange Commission published in the calendar year.',
 'releases', 'count', 'enforcement', array['nation'], 'year', array['sec_enforcement_actions'],
 '[{"label": "SEC, litigation releases", "url": "https://www.sec.gov/enforcement-litigation/litigation-releases"}]',
 'Litigation releases with a release year in the year', null, 'Count of corpus records.',
 array['Counts publications; one action can produce several releases. The latest year is partial.'],
 'higher_is_more'),
('sec_administrative_proceedings', 'enforcement', 7003, 'SEC administrative proceedings',
 'Administrative proceeding documents the SEC published in the calendar year.',
 'proceedings', 'count', 'enforcement', array['nation'], 'year', array['sec_enforcement_actions'],
 '[{"label": "SEC, administrative proceedings", "url": "https://www.sec.gov/enforcement-litigation/administrative-proceedings"}]',
 'Administrative proceedings with a release year in the year', null, 'Count of corpus records.',
 array['Counts publications. The latest year is partial.'], 'higher_is_more'),
('ftc_enforcement_actions', 'enforcement', 7004, 'FTC enforcement actions',
 'Actions in the FTC''s four enforcement data sets (merger, nonmerger conduct, competition and consumer-protection civil penalties) by calendar year of the action''s date.',
 'actions', 'count', 'enforcement', array['nation'], 'year', array['ftc_enforcement_actions'],
 '[{"label": "Federal Trade Commission, data sets", "url": "https://www.ftc.gov/policy-notices/open-government/data-sets"}]',
 'Actions of the four data sets with a year', null, 'Count of corpus records; actions without a year are not counted.',
 array['The latest year is partial.'], 'higher_is_more'),
('frb_enforcement_actions', 'enforcement', 7005, 'Federal Reserve Board enforcement actions',
 'Enforcement actions the Federal Reserve Board published, by year of the action.',
 'actions', 'count', 'enforcement', array['nation'], 'year', array['frb_enforcement_actions'],
 '[{"label": "Federal Reserve Board, enforcement actions", "url": "https://www.federalreserve.gov/supervisionreg/enforcementactions.htm"}]',
 'Actions with an effective year in the year', null, 'Count of corpus records.',
 array['Terminations of earlier actions are listed by the Board as separate entries. The latest year is partial.'],
 'neutral'),
('epa_cases_opened', 'enforcement', 7006, 'EPA civil enforcement cases opened',
 'EPA civil enforcement cases opened in the fiscal year (ECHO ICIS-FE&C case data), nation and facility state.',
 'cases', 'count', 'enforcement', array['nation', 'state'], 'fiscal_year', array['epa_echo_case_series'],
 '[{"label": "EPA ECHO, ICIS-FE&C case data", "url": "https://echo.epa.gov/tools/data-downloads/icis-fec-download-summary"}]',
 'Cases with an enforcement-start date in the fiscal year', null, 'Count computed by the corpus builder from the ECHO case file.',
 array['State figures use the facility state code of the case; codes outside the states and territories are excluded.',
       'Fiscal years after the file''s latest complete fiscal year are partial.'],
 'neutral'),
('epa_federal_penalties', 'enforcement', 7007, 'EPA federal penalties assessed',
 'Federal penalties recorded on EPA civil enforcement cases, by fiscal year (ECHO case data).',
 'dollars', 'currency_usd', 'enforcement', array['nation', 'state'], 'fiscal_year', array['epa_echo_case_series'],
 '[{"label": "EPA ECHO, ICIS-FE&C case data", "url": "https://echo.epa.gov/tools/data-downloads/icis-fec-download-summary"}]',
 'Sum of case federal penalty amounts as recorded in the file', null, 'Sum computed by the corpus builder.',
 array['Nominal dollars; one large case can dominate a year.', 'Fiscal years after the latest complete fiscal year are partial.'],
 'neutral'),
('osha_inspections', 'enforcement', 7008, 'OSHA inspections',
 'Workplace safety and health inspections opened in the fiscal year (federal OSHA and state plans), by site state.',
 'inspections', 'count', 'enforcement', array['nation', 'state'], 'fiscal_year',
 array['osha_inspections_states', 'osha_inspections_national'],
 '[{"label": "Department of Labor, OSHA enforcement data", "url": "https://enforcedata.dol.gov/views/data_summary.php"}]',
 'Inspections opened in the fiscal year', null, 'Count computed by the corpus builder from the OSHA inspection file.',
 array['State-plan states inspect most private workplaces themselves; their inspections are included.',
       'Fiscal years after the latest complete fiscal year are partial.'],
 'neutral'),
('osha_current_penalties', 'enforcement', 7009, 'OSHA current penalties',
 'Current (after settlement or contest) penalties of the inspections opened in the fiscal year, by site state.',
 'dollars', 'currency_usd', 'enforcement', array['nation', 'state'], 'fiscal_year',
 array['osha_inspections_states', 'osha_inspections_national'],
 '[{"label": "Department of Labor, OSHA enforcement data", "url": "https://enforcedata.dol.gov/views/data_summary.php"}]',
 'Sum of current penalties of the year''s inspections', null, 'Sum computed by the corpus builder.',
 array['Recent years change as cases settle or are contested.', 'Fiscal years after the latest complete fiscal year are partial.'],
 'neutral'),
('leie_exclusions', 'enforcement', 7010, 'HHS-OIG exclusions on the current LEIE list',
 'Individuals and entities on the current List of Excluded Individuals/Entities, by year of exclusion and recorded state.',
 'exclusions', 'count', 'enforcement', array['nation', 'state'], 'year', array['oig_leie_exclusions'],
 '[{"label": "HHS Office of Inspector General, LEIE", "url": "https://oig.hhs.gov/exclusions/exclusions_list.asp"}]',
 'Records of the current list with an exclusion date in the year', null, 'Count of corpus records.',
 array['The list holds current exclusions only: people later reinstated are no longer on it, so older years are undercounted relative to exclusions imposed then.',
       'A year with no exclusion for the state has no fact (Not recorded), not zero.'],
 'neutral'),
('oversight_reports', 'enforcement', 7011, 'Inspector General reports published',
 'Reports published on Oversight.gov by Offices of Inspector General, by calendar year.',
 'reports', 'count', 'government', array['nation', 'agency'], 'year', array['oversight_trends'],
 '[{"label": "Oversight.gov (CIGIE)", "url": "https://www.oversight.gov/reports"}]',
 'Reports with a publication year in the year', null, 'Count computed by the corpus builder from Oversight.gov listings.',
 array['Not every OIG posts every report on Oversight.gov, and early years are sparse. The latest year is partial.'],
 'neutral'),
-- safety -----------------------------------------------------------------------------------------------------------
('cpsc_recalls', 'safety', 8000, 'Consumer product recalls (CPSC)',
 'Recalls announced by the Consumer Product Safety Commission, by calendar year.',
 'recalls', 'count', 'safety', array['nation'], 'year', array['regulatory_cpsc_aggregates'],
 '[{"label": "CPSC recalls (Recall API)", "url": "https://www.cpsc.gov/Recalls"}]',
 'Recalls with a recall date in the year', null, 'Count computed by the corpus builder from the CPSC Recall API.',
 array['The latest year is partial.'], 'neutral'),
('nhtsa_recall_campaigns', 'safety', 8001, 'Vehicle and equipment recall campaigns (NHTSA)',
 'Recall campaigns NHTSA recorded, by calendar year of the report date.',
 'campaigns', 'count', 'safety', array['nation'], 'year', array['agency_safety_nhtsa_recalls'],
 '[{"label": "NHTSA datasets and APIs", "url": "https://www.nhtsa.gov/nhtsa-datasets-and-apis"}]',
 'Recall campaigns with a year in the year', null, 'Count of corpus records.',
 array['Campaigns, not vehicles. The corpus holds campaigns from 2010. The latest year is partial.'], 'neutral'),
('fsis_recalls', 'safety', 8002, 'Meat, poultry and egg product recalls (USDA FSIS)',
 'Recalls (classes I, II and III) announced by the Food Safety and Inspection Service, by calendar year.',
 'recalls', 'count', 'safety', array['nation'], 'year', array['fsis_recalls'],
 '[{"label": "USDA FSIS recalls and public health alerts", "url": "https://www.fsis.usda.gov/recalls"}]',
 'Recalls of class I, II or III dated in the year', null, 'Count of corpus records.',
 array['Public health alerts are counted separately. The corpus holds 2014 onward; the latest year is partial.'], 'neutral'),
('fsis_public_health_alerts', 'safety', 8003, 'Public health alerts (USDA FSIS)',
 'Public health alerts issued by the Food Safety and Inspection Service, by calendar year.',
 'alerts', 'count', 'safety', array['nation'], 'year', array['fsis_recalls'],
 '[{"label": "USDA FSIS recalls and public health alerts", "url": "https://www.fsis.usda.gov/recalls"}]',
 'Public health alerts dated in the year', null, 'Count of corpus records.', array['The latest year is partial.'], 'neutral'),
('fda_drug_enforcement_reports', 'safety', 8004, 'FDA drug recall enforcement-report entries',
 'Drug product entries in FDA''s weekly enforcement reports (openFDA), by calendar year of the report date.',
 'entries', 'count', 'safety', array['nation'], 'year', array['agency_safety_openfda_drug_enforcement'],
 '[{"label": "openFDA drug enforcement reports", "url": "https://open.fda.gov/apis/drug/enforcement/"}]',
 'Entries with a report date in the year', null, 'Count of corpus records.',
 array['One recall event can list many products, each an entry. The latest year is partial.'], 'neutral'),
('fda_device_enforcement_reports', 'safety', 8005, 'FDA device recall enforcement-report entries',
 'Medical device entries in FDA''s weekly enforcement reports (openFDA), by calendar year of the report date.',
 'entries', 'count', 'safety', array['nation'], 'year', array['agency_safety_openfda_device_enforcement'],
 '[{"label": "openFDA device enforcement reports", "url": "https://open.fda.gov/apis/device/enforcement/"}]',
 'Entries with a report date in the year', null, 'Count of corpus records.',
 array['One recall event can list many products, each an entry. The latest year is partial.'], 'neutral'),
('fda_food_enforcement_reports', 'safety', 8006, 'FDA food recall enforcement-report entries',
 'Food product entries in FDA''s weekly enforcement reports (openFDA), by calendar year of the report date.',
 'entries', 'count', 'safety', array['nation'], 'year', array['agency_safety_openfda_food_enforcement'],
 '[{"label": "openFDA food enforcement reports", "url": "https://open.fda.gov/apis/food/enforcement/"}]',
 'Entries with a report date in the year', null, 'Count of corpus records.',
 array['One recall event can list many products, each an entry. The latest year is partial.'], 'neutral'),
('faers_reports', 'safety', 8007, 'Drug adverse-event reports received by FDA (FAERS)',
 'Adverse-event reports FDA received in the calendar year (openFDA FAERS), nationally and for the drugs tracked.',
 'reports', 'count', 'safety', array['nation', 'product'], 'year',
 array['fda_faers_national_series', 'fda_faers_product_series'],
 '[{"label": "openFDA drug adverse events (FAERS)", "url": "https://open.fda.gov/apis/drug/event/"}]',
 'Reports with a receipt date in the year, for the product''s openFDA search', null, 'Value as returned by openFDA.',
 array['Reports are submissions, not confirmed causes, and not rates: without exposure data they cannot be read as risk.',
       'A product''s series counts reports matching its openFDA search (shown in the entity''s keys). The latest year is partial.'],
 'neutral'),
('maude_reports', 'safety', 8008, 'Medical device adverse-event reports (MAUDE)',
 'Medical device reports FDA received in the calendar year (openFDA MAUDE), nationally and for the devices tracked.',
 'reports', 'count', 'safety', array['nation', 'product'], 'year', array['fda_device_event_series'],
 '[{"label": "openFDA device adverse events (MAUDE)", "url": "https://open.fda.gov/apis/device/event/"}]',
 'Reports with a receipt date in the year, for the device''s openFDA search', null, 'Value as returned by openFDA.',
 array['Reports are submissions, not confirmed causes, and not rates. Summary reporting programs change counts between eras. The latest year is partial.'],
 'neutral'),
('caers_reports', 'safety', 8009, 'Food, supplement and cosmetic adverse-event reports (CAERS)',
 'Adverse-event reports in FDA''s CFSAN Adverse Event Reporting System (openFDA), by calendar year.',
 'reports', 'count', 'safety', array['nation'], 'year', array['fda_caers_series'],
 '[{"label": "openFDA food adverse events (CAERS)", "url": "https://open.fda.gov/apis/food/event/"}]',
 'Reports created in the year', null, 'Value as returned by openFDA.',
 array['Reports are submissions, not confirmed causes. The latest year is partial.'], 'neutral'),
('neiss_injury_estimate', 'safety', 8010, 'Consumer-product injuries treated in emergency departments (NEISS estimate)',
 'National estimate of consumer-product-related injuries treated in hospital emergency departments, CPSC NEISS.',
 'injuries (national estimate)', 'count', 'safety', array['nation'], 'year', array['neiss_national_years'],
 '[{"label": "CPSC National Electronic Injury Surveillance System", "url": "https://www.cpsc.gov/Research--Statistics/NEISS-Injury-Data"}]',
 'National estimate as published by CPSC', null,
 'Value as published; n is the number of sample cases behind the estimate.',
 array['A weighted estimate from a probability sample of hospitals; CPSC publishes a 95 percent confidence interval (see the dataset), not a margin of error.'],
 'neutral'),
('saferproducts_reports', 'safety', 8011, 'SaferProducts.gov consumer reports published',
 'Unverified consumer product incident reports published on SaferProducts.gov, by publication year.',
 'reports', 'count', 'safety', array['nation'], 'year', array['saferproducts_reports_series'],
 '[{"label": "SaferProducts.gov public database", "url": "https://www.saferproducts.gov/"}]',
 'Reports with a publication date in the year', null, 'Count computed by the corpus builder from the SaferProducts.gov export.',
 array['Reports are unverified submissions. 2011 (database launch) and the current year are partial.'], 'neutral'),
-- companies --------------------------------------------------------------------------------------------------------
('sec_revenue', 'companies', 9000, 'Revenue reported to the SEC',
 'Annual revenue reported in 10-K XBRL financial data, by the SEC''s calendar-year frame.',
 'dollars', 'currency_usd', 'companies', array['company'], 'year', array['company_sec_financials'],
 '[{"label": "SEC EDGAR XBRL frames", "url": "https://www.sec.gov/edgar/sec-api-documentation"}]',
 'Annual revenue fact (us-gaap revenue concept) the SEC assigns to the calendar-year frame', null,
 'Value as filed; period_start and period_end are the company''s own fiscal period; a frame with two different values is Not recorded.',
 array['Fiscal years differ between companies; the SEC frame assigns each annual fact to the calendar year it best aligns with.',
       'Concepts differ between companies and years (e.g. SalesRevenueNet, Revenues).'],
 'neutral'),
('sec_net_income', 'companies', 9001, 'Net income reported to the SEC',
 'Annual net income (loss) reported in 10-K XBRL financial data, by the SEC''s calendar-year frame.',
 'dollars', 'currency_usd', 'companies', array['company'], 'year', array['company_sec_financials'],
 '[{"label": "SEC EDGAR XBRL frames", "url": "https://www.sec.gov/edgar/sec-api-documentation"}]',
 'Annual net income fact assigned to the calendar-year frame', null,
 'Value as filed (losses negative); a frame with two different values is Not recorded.',
 array['Fiscal years differ between companies; the SEC frame aligns each annual fact to a calendar year.'], 'neutral'),
('open_payments_general', 'companies', 9010, 'Open Payments general payments by the manufacturer',
 'General (non-research) payments and transfers of value the manufacturer reported to CMS Open Payments for the program year.',
 'dollars', 'currency_usd', 'companies', array['company'], 'year', array['company_payments_manufacturers'],
 '[{"label": "CMS Open Payments", "url": "https://openpaymentsdata.cms.gov/"}]',
 'Sum of general payment amounts for the program year', null,
 'Sum computed by the corpus builder from the program-year files; n is the number of payment records.',
 array['Manufacturers are the 300 largest by total in the corpus; names as reported to CMS, not linked to SEC companies.'],
 'neutral'),
('open_payments_research', 'companies', 9011, 'Open Payments research payments by the manufacturer',
 'Research payments the manufacturer reported to CMS Open Payments for the program year.',
 'dollars', 'currency_usd', 'companies', array['company'], 'year', array['company_payments_manufacturers'],
 '[{"label": "CMS Open Payments", "url": "https://openpaymentsdata.cms.gov/"}]',
 'Sum of research payment amounts for the program year', null,
 'Sum computed by the corpus builder from the program-year files; n is the number of payment records.',
 array['Manufacturers are the 300 largest by total in the corpus; names as reported to CMS.'], 'neutral'),
-- law and government -----------------------------------------------------------------------------------------------
('fr_documents', 'government', 10000, 'Federal Register documents published',
 'Documents published in the Federal Register in the calendar year (all types), nationally and by agency.',
 'documents', 'count', 'law', array['nation', 'agency'], 'year', array['fr_agency_trends'],
 '[{"label": "Federal Register API", "url": "https://www.federalregister.gov/developers/documentation/api/v1"}]',
 'Documents with a publication date in the year', null, 'Count returned by the Federal Register API facets.',
 array['A document listed under several agencies counts for each of them. The latest year is partial.'], 'neutral'),
('fr_final_rules', 'government', 10001, 'Final rules published in the Federal Register',
 'Documents of type Rule published in the Federal Register in the calendar year, nationally and by agency.',
 'rules', 'count', 'law', array['nation', 'agency'], 'year', array['fr_agency_trends'],
 '[{"label": "Federal Register API", "url": "https://www.federalregister.gov/developers/documentation/api/v1"}]',
 'Rule documents with a publication date in the year', null, 'Count returned by the Federal Register API facets.',
 array['Includes corrections and technical amendments published as rules. The latest year is partial.'], 'neutral'),
('fr_proposed_rules', 'government', 10002, 'Proposed rules published in the Federal Register',
 'Documents of type Proposed Rule published in the Federal Register in the calendar year, nationally and by agency.',
 'proposed rules', 'count', 'law', array['nation', 'agency'], 'year', array['fr_agency_trends'],
 '[{"label": "Federal Register API", "url": "https://www.federalregister.gov/developers/documentation/api/v1"}]',
 'Proposed Rule documents with a publication date in the year', null, 'Count returned by the Federal Register API facets.',
 array['The latest year is partial.'], 'neutral'),
('cfr_section_versions', 'government', 10003, 'Substantive CFR section versions',
 'New substantive versions of Code of Federal Regulations sections dated in the year, by CFR title (eCFR versioner).',
 'section versions', 'count', 'law', array['nation', 'law_unit'], 'year', array['ecfr_section_versions'],
 '[{"label": "eCFR versioner API", "url": "https://www.ecfr.gov/developers/documentation/api/v1"}]',
 'Section versions marked substantive with a version date in the year, from 2017-01-03 on', null,
 'Count of version entries listed by the eCFR for each section.',
 array['The eCFR''s point-in-time history starts on 2017-01-03, so 2017 is partial; so is the current year.',
       'Counts section versions, not rules: one rule can change many sections.'],
 'neutral'),
('congress_bills_introduced', 'government', 10004, 'Bills and joint resolutions introduced in Congress',
 'House and Senate bills and joint resolutions (the measures that can become law) introduced in the calendar year.',
 'measures', 'count', 'government', array['nation'], 'year', array['congress_bills'],
 '[{"label": "GovInfo Bill Status bulk data", "url": "https://www.govinfo.gov/bulkdata/BILLSTATUS"}]',
 'H.R., S., H.J.Res. and S.J.Res. measures with an introduction date in the year', null, 'Count of corpus records.',
 array['Simple and concurrent resolutions are excluded. The corpus covers the 108th Congress (2003) on; the latest year is partial.'],
 'neutral'),
('public_laws_enacted', 'government', 10005, 'Public laws enacted',
 'Public laws enacted in the calendar year (Statutes at Large and slip laws).',
 'public laws', 'count', 'law', array['nation'], 'year', array['public_laws_enacted'],
 '[{"label": "GovInfo public and private laws", "url": "https://www.govinfo.gov/app/collection/plaw"}]',
 'Records of kind "Public law" with an enactment date in the year', null, 'Count of corpus records.',
 array['Historical public acts, chapters and public resolutions are not counted. The latest year is partial.'], 'neutral'),
('state_bills_current_session', 'government', 10006, 'Bills in the current regular legislative session',
 'Bills and resolutions of the state''s current regular session in the Open States bulk data.',
 'bills and resolutions', 'count', 'government', array['state'], 'snapshot', array['state_bills'],
 '[{"label": "Open States bulk data", "url": "https://open.pluralpolicy.com/data/"}]',
 'Records whose session is the current regular session', null,
 'Count of corpus records, as of the bulk dump''s last-modified date.',
 array['Sessions differ in length and in what they count as a bill; compare states with care.'], 'neutral'),
-- consumer ---------------------------------------------------------------------------------------------------------
('cfpb_complaints', 'consumer', 11000, 'Consumer complaints received by the CFPB',
 'Complaints received by the Consumer Financial Protection Bureau, by consumer state and calendar year.',
 'complaints', 'count', 'enforcement', array['nation', 'state'], 'year',
 array['cfpb_complaints_states', 'cfpb_complaints_national'],
 '[{"label": "CFPB Consumer Complaint Database", "url": "https://www.consumerfinance.gov/data-research/consumer-complaints/"}]',
 'Complaints with a received date in the year (state from the consumer''s mailing address)', null,
 'Count returned by the CFPB complaint API.',
 array['Complaints are not findings of wrongdoing. Credit-reporting complaints dominate recent years.',
       'A year the database does not fully cover (2011, the current year) is partial.'],
 'neutral'),
('cfpb_complaints_per_100k', 'consumer', 11001, 'CFPB complaints per 100,000 residents',
 'Consumer complaints received by the CFPB per 100,000 residents of the consumer''s state.',
 'complaints per 100,000 residents', 'rate_per_100k', 'enforcement', array['nation', 'state'], 'year',
 array['cfpb_complaints_states', 'cfpb_complaints_national', 'census_pop_estimates'],
 '[{"label": "CFPB Consumer Complaint Database", "url": "https://www.consumerfinance.gov/data-research/consumer-complaints/"}, {"label": "Census Bureau, Population Estimates Program", "url": "https://www.census.gov/programs-surveys/popest.html"}]',
 'Complaints received in the year (cfpb_complaints)',
 'Census resident population on July 1 of the same year; vintage 2019 for 2010-2019, vintage 2025 for 2020-2025',
 'complaints x 100,000 / population, rounded to 4 decimal places; n is the complaint count.',
 array['May differ from rates the CFPB data builder showed, which used other population vintages.',
       'No rate for a year without a population estimate (Not recorded).'],
 'neutral'),
('ftc_sentinel_fraud_other_reports', 'consumer', 11010, 'Consumer Sentinel fraud and other reports',
 'Fraud and other (non-identity-theft) reports in the FTC Consumer Sentinel Network Data Book, by consumer state.',
 'reports', 'count', 'enforcement', array['state'], 'year', array['ftc_sentinel_states'],
 '[{"label": "FTC Consumer Sentinel Network reports", "url": "https://www.ftc.gov/enforcement/consumer-sentinel-network/reports"}]',
 'Fraud & Other reports as printed in the state table', null, 'Value as printed.',
 array['Excludes reports from state-specific data contributors and reports with no state; the FTC revises categories between editions.'],
 'neutral'),
('ftc_sentinel_identity_theft_reports', 'consumer', 11011, 'Consumer Sentinel identity theft reports',
 'Identity theft reports in the FTC Consumer Sentinel Network Data Book, by consumer state.',
 'reports', 'count', 'enforcement', array['state'], 'year', array['ftc_sentinel_states'],
 '[{"label": "FTC Consumer Sentinel Network reports", "url": "https://www.ftc.gov/enforcement/consumer-sentinel-network/reports"}]',
 'Identity theft reports as printed in the state table', null, 'Value as printed.',
 array['Excludes reports from state-specific data contributors and reports with no state.'], 'neutral'),
('ftc_sentinel_fraud_other_per_100k', 'consumer', 11012, 'Consumer Sentinel fraud and other reports per 100,000 residents',
 'Fraud and other reports per 100,000 residents of the state, computed with the same year''s Census estimate.',
 'reports per 100,000 residents', 'rate_per_100k', 'enforcement', array['state'], 'year',
 array['ftc_sentinel_states', 'census_pop_estimates'],
 '[{"label": "FTC Consumer Sentinel Network reports", "url": "https://www.ftc.gov/enforcement/consumer-sentinel-network/reports"}, {"label": "Census Bureau, Population Estimates Program", "url": "https://www.census.gov/programs-surveys/popest.html"}]',
 'Fraud & Other reports (ftc_sentinel_fraud_other_reports)',
 'Census resident population on July 1 of the same year (vintage 2025 for 2020-2025, vintage 2019 for 2010-2019)',
 'reports x 100,000 / population, rounded to 4 decimal places; n is the report count.',
 array['The FTC''s own per-100K figures use an earlier year''s population and so differ from these.'], 'neutral'),
('ftc_sentinel_reports', 'consumer', 11013, 'Consumer Sentinel reports (all types)',
 'Reports received by the FTC Consumer Sentinel Network in the calendar year, all report types.',
 'reports', 'count', 'enforcement', array['nation'], 'year', array['ftc_sentinel_national'],
 '[{"label": "FTC Consumer Sentinel Network reports", "url": "https://www.ftc.gov/enforcement/consumer-sentinel-network/reports"}]',
 'Total reports as printed in the Data Book', null, 'Value as printed.',
 array['Reports are not verified complaints; contributors joined and left over the years.'], 'neutral'),
('ftc_dnc_complaints', 'consumer', 11020, 'Do Not Call complaints',
 'Complaints about unwanted calls reported to the FTC''s Do Not Call registry, by consumer state and fiscal year.',
 'complaints', 'count', 'enforcement', array['state'], 'fiscal_year', array['ftc_dnc_states'],
 '[{"label": "FTC National Do Not Call Registry Data Book", "url": "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data"}]',
 'Complaints as printed in the Data Book state table', null, 'Value as printed.', array[]::text[], 'neutral'),
('ftc_dnc_complaints_per_100k', 'consumer', 11021, 'Do Not Call complaints per 100,000 residents',
 'Do Not Call complaints per 100,000 residents, computed with the Census estimate of the year in which the fiscal year ends.',
 'complaints per 100,000 residents', 'rate_per_100k', 'enforcement', array['state'], 'fiscal_year',
 array['ftc_dnc_states', 'census_pop_estimates'],
 '[{"label": "FTC National Do Not Call Registry Data Book", "url": "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data"}, {"label": "Census Bureau, Population Estimates Program", "url": "https://www.census.gov/programs-surveys/popest.html"}]',
 'Do Not Call complaints in the fiscal year (ftc_dnc_complaints)',
 'Census resident population on July 1 of the calendar year in which the fiscal year ends (inside the fiscal year)',
 'complaints x 100,000 / population, rounded to 4 decimal places; n is the complaint count.',
 array['The Data Book''s own per-100K figures may use another population vintage.'], 'neutral')
on conflict (id) do update set family = excluded.family, ordinal = excluded.ordinal, label = excluded.label,
  description = excluded.description, unit = excluded.unit, format = excluded.format, topic = excluded.topic,
  entity_types = excluded.entity_types, period_type = excluded.period_type, source_datasets = excluded.source_datasets,
  source_links = excluded.source_links, numerator = excluded.numerator, denominator = excluded.denominator,
  method = excluded.method, caveats = excluded.caveats, direction = excluded.direction;

-- ------------------------------------------------------------------------------------------------ entity spine
-- Entities come only from published identifiers: USPS/FIPS codes, Census GEOIDs, court ids (court_spine), FJC judge
-- ids (nid), JPML MDL numbers, SEC CIKs, CMS Open Payments manufacturer ids, Federal Register agency ids, Oversight.gov
-- OIG slugs, openFDA product searches and CFR title numbers. Two identifiers are never merged by name. An href is set
-- only where the in-app page exists for that id.
create or replace function insights.stage_entities() returns void
language plpgsql set search_path = '' as $$
begin
  if to_regclass('pg_temp.insights_stage_entities') is null then
    create temp table insights_stage_entities (
      entity_type text not null, entity_id text not null, label text not null, parent_type text, parent_id text,
      keys jsonb not null, href text, source_dataset text not null, primary key (entity_type, entity_id));
  else
    truncate pg_temp.insights_stage_entities;
  end if;
  if to_regclass('pg_temp.insights_stage_links') is null then
    create temp table insights_stage_links (
      from_type text not null, from_id text not null, to_type text not null, to_id text not null, relation text not null,
      evidence text not null, source_dataset text not null, source_record_id text not null,
      primary key (from_type, from_id, to_type, to_id, relation, source_dataset, source_record_id));
  else
    truncate pg_temp.insights_stage_links;
  end if;

  -- nation, states, DC, territories
  insert into pg_temp.insights_stage_entities values
    ('nation', 'US', 'United States', null, null, '{"usps": "US"}', '/places', 'insights.geo_states');
  insert into pg_temp.insights_stage_entities
    select 'state', g.usps, g.name, 'nation', 'US', jsonb_build_object('usps', g.usps, 'fips', g.fips),
           case when g.places_page then '/places/' || g.usps end, 'insights.geo_states'
    from insights.geo_states g;

  -- counties (5-digit GEOIDs) from the Census datasets, first source wins for the label
  insert into pg_temp.insights_stage_entities
    select distinct on (c.id) 'county', c.id, c.label, 'state', g.usps, jsonb_build_object('fips', c.id),
           case when g.places_page and exists (select 1 from public.corpus_records d where d.dataset = 'counties' and d.id = c.id)
                then '/places/' || g.usps || '/' || c.id end,
           c.dataset
    from (select r.id, r.title as label, r.dataset,
                 case r.dataset when 'census_pop_estimates' then 1 when 'census_acs_counties' then 2 else 3 end as pri
          from public.corpus_records r
          where r.dataset in ('census_pop_estimates', 'census_acs_counties', 'census_cbp_counties')
            and r.item -> 'census' ->> 'level' = 'county' and r.id ~ '^[0-9]{5}$' and coalesce(r.title, '') <> '') c
    join insights.geo_states g on g.fips = left(c.id, 2)
    order by c.id, c.pri;

  -- courts: every court_spine court; district courts sit in their circuit (FJC district table), other courts in
  -- their state, else directly under the nation
  insert into pg_temp.insights_stage_entities
    select 'circuit', s.id, s.title, 'nation', 'US', jsonb_build_object('court_id', s.id), '/courts/' || s.id, 'court_spine'
    from public.corpus_records s
    where s.dataset = 'court_spine'
      and s.id in ('ca1', 'ca2', 'ca3', 'ca4', 'ca5', 'ca6', 'ca7', 'ca8', 'ca9', 'ca10', 'ca11', 'cadc', 'cafc')
      and coalesce(s.title, '') <> '';
  insert into pg_temp.insights_stage_entities
    select 'court', s.id, s.title,
           case when d.circuit is not null then 'circuit' when g.usps is not null then 'state' else 'nation' end,
           coalesce(d.circuit, g.usps, 'US'),
           jsonb_strip_nulls(jsonb_build_object('court_id', s.id, 'court_type', s.filters -> 'type' ->> 0)),
           '/courts/' || s.id, 'court_spine'
    from public.corpus_records s
    left join lateral (select f.filters -> 'circuit' ->> 0 as circuit from public.corpus_records f
                       where f.dataset = 'fjc_civil_districts' and f.id = s.id
                         and f.filters -> 'circuit' ->> 0 in ('ca1', 'ca2', 'ca3', 'ca4', 'ca5', 'ca6', 'ca7', 'ca8', 'ca9',
                                                               'ca10', 'ca11', 'cadc')
                       limit 1) d on true
    left join insights.geo_states g on g.usps = s.state
    where s.dataset = 'court_spine' and s.id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' and coalesce(s.title, '') <> '';
  insert into pg_temp.insights_stage_links
    select 'court', s.id, 'state', g.usps, 'located_in', 'publisher_stated', 'court_spine', s.id
    from public.corpus_records s join insights.geo_states g on g.usps = s.state
    where s.dataset = 'court_spine' and s.id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' and coalesce(s.title, '') <> '';

  -- Article III judges (FJC Biographical Directory id); their judge page is the directory profile the record names
  insert into pg_temp.insights_stage_entities
    select 'judge', j.id, j.title,
           case when c.entity_id is not null then 'court' end, c.entity_id,
           jsonb_strip_nulls(jsonb_build_object('fjc_nid', j.id, 'judge_profile', j.filters -> 'judge_profile' ->> 0,
             'cl_person', j.filters -> 'cl_person' ->> 0)),
           case when exists (select 1 from public.corpus_records p where p.dataset = 'judges'
                             and p.id = j.filters -> 'judge_profile' ->> 0) then '/judges/' || (j.filters -> 'judge_profile' ->> 0) end,
           'judge_profiles_fjc'
    from public.corpus_records j
    left join pg_temp.insights_stage_entities c on c.entity_type = 'court' and c.entity_id = j.filters -> 'court' ->> 0
    where j.dataset = 'judge_profiles_fjc' and j.id ~ '^[0-9]{1,12}$' and coalesce(j.title, '') <> '';
  insert into pg_temp.insights_stage_links
    select distinct 'judge', j.id, 'court', c.value, 'served_on', 'publisher_stated', 'judge_profiles_fjc', j.id
    from public.corpus_records j cross join lateral jsonb_array_elements_text(insights.jarr(j.filters -> 'courts_served')) c
    where j.dataset = 'judge_profiles_fjc' and j.id ~ '^[0-9]{1,12}$'
      and exists (select 1 from pg_temp.insights_stage_entities e where e.entity_type = 'court' and e.entity_id = c.value);
  insert into pg_temp.insights_stage_links
    select 'judge', j.id, 'court', j.filters -> 'court' ->> 0, 'sits_on', 'publisher_stated', 'judge_profiles_fjc', j.id
    from public.corpus_records j
    where j.dataset = 'judge_profiles_fjc' and j.id ~ '^[0-9]{1,12}$' and j.filters -> 'sitting' ->> 0 = 'yes'
      and exists (select 1 from pg_temp.insights_stage_entities e where e.entity_type = 'court'
                  and e.entity_id = j.filters -> 'court' ->> 0);

  -- MDLs (JPML numbers): the current registry first, then the monthly-report history
  insert into pg_temp.insights_stage_entities
    select distinct on (m.id) 'mdl', m.id, m.label,
           case when c.entity_id is not null then 'court' end, c.entity_id,
           jsonb_build_object('mdl_number', m.id), '/matters/lens/' || m.id, m.dataset
    from (select r.id, coalesce(nullif(r.item ->> 'title', ''), r.title) as label, r.item ->> 'cl_court_id' as court,
                 r.dataset, 1 as pri
          from public.corpus_records r where r.dataset = 'mdls' and r.id ~ '^[0-9]{1,5}$'
          union all
          select r.id, coalesce(nullif(r.item -> 'history' ->> 'title', ''), r.title), r.filters -> 'court' ->> 0, r.dataset, 2
          from public.corpus_records r where r.dataset = 'jpml_pending_history_mdls' and r.id ~ '^[0-9]{1,5}$') m
    left join pg_temp.insights_stage_entities c on c.entity_type = 'court' and c.entity_id = m.court
    where coalesce(m.label, '') <> ''
    order by m.id, m.pri;
  insert into pg_temp.insights_stage_links
    select 'mdl', r.id, 'court', r.item ->> 'cl_court_id', 'transferee_court', 'publisher_stated', 'mdls', r.id
    from public.corpus_records r
    where r.dataset = 'mdls' and r.id ~ '^[0-9]{1,5}$'
      and exists (select 1 from pg_temp.insights_stage_entities e where e.entity_type = 'court' and e.entity_id = r.item ->> 'cl_court_id');
  -- transferee judge: the registry's CourtListener person id equals exactly one FJC judge's CourtListener person id
  insert into pg_temp.insights_stage_links
    select 'mdl', r.id, 'judge', (array_agg(j.id))[1], 'transferee_judge', 'exact_id', 'mdls', r.id
    from public.corpus_records r
    join public.corpus_records j on j.dataset = 'judge_profiles_fjc' and j.filters -> 'cl_person' ? (r.filters ->> 'cl_person_id')
    where r.dataset = 'mdls' and r.id ~ '^[0-9]{1,5}$' and coalesce(r.filters ->> 'cl_person_id', '') ~ '^[0-9]+$'
      and j.id ~ '^[0-9]{1,12}$'
    group by r.id having count(distinct j.id) = 1;

  -- companies: SEC CIKs; CMS Open Payments manufacturers keep their own id (never merged with a CIK by name)
  insert into pg_temp.insights_stage_entities
    select distinct on (r.id) 'company', r.id, coalesce(nullif(r.title, ''), r.item ->> 'name'), null, null,
           jsonb_build_object('cik', r.id), '/companies/' || r.id, r.dataset
    from public.corpus_records r
    where r.dataset in ('company_sec_profiles', 'company_sec_financials') and r.id ~ '^[0-9]{10}$'
      and coalesce(nullif(r.title, ''), r.item ->> 'name', '') <> ''
    order by r.id, case r.dataset when 'company_sec_profiles' then 1 else 2 end;
  insert into pg_temp.insights_stage_entities
    select 'company', r.id, r.title, null, null, jsonb_build_object('open_payments_id', substr(r.id, 4)), null, r.dataset
    from public.corpus_records r
    where r.dataset = 'company_payments_manufacturers' and r.id ~ '^op-[0-9]{6,15}$' and coalesce(r.title, '') <> '';

  -- agencies: Federal Register agency ids; Offices of Inspector General by their Oversight.gov slug
  insert into pg_temp.insights_stage_entities
    select 'agency', r.id, r.title, null, null, jsonb_build_object('federal_register_id', r.id), '/agencies/' || r.id,
           'fr_agency_profiles'
    from public.corpus_records r
    where r.dataset = 'fr_agency_profiles' and r.id ~ '^[0-9]{1,6}$' and coalesce(r.title, '') <> '';
  update pg_temp.insights_stage_entities e set parent_type = 'agency', parent_id = p.parent
    from (select r.id, r.filters -> 'parent' ->> 0 as parent from public.corpus_records r
          where r.dataset = 'fr_agency_profiles' and r.id ~ '^[0-9]{1,6}$') p
    where e.entity_type = 'agency' and e.entity_id = p.id and p.parent is distinct from p.id
      and exists (select 1 from pg_temp.insights_stage_entities q where q.entity_type = 'agency' and q.entity_id = p.parent);
  insert into pg_temp.insights_stage_entities
    select 'agency', r.id, r.item -> 'trend' ->> 'name', null, null, jsonb_build_object('oversight_slug', substr(r.id, 5)),
           null, 'oversight_trends'
    from public.corpus_records r
    where r.dataset = 'oversight_trends' and r.id ~ '^oig:[a-z0-9-]{2,70}$' and coalesce(r.item -> 'trend' ->> 'name', '') <> '';

  -- products: the openFDA searches of the FAERS and MAUDE product series (the search is the published key)
  insert into pg_temp.insights_stage_entities
    select 'product', 'faers:' || r.id, r.item ->> 'product', null, null, jsonb_build_object('openfda_search', r.source_url),
           null, 'fda_faers_product_series'
    from public.corpus_records r
    where r.dataset = 'fda_faers_product_series' and r.id ~ '^[A-Za-z0-9_-]{1,40}$' and coalesce(r.item ->> 'product', '') <> ''
      and r.source_url ~ '^https://api[.]fda[.]gov/';
  insert into pg_temp.insights_stage_entities
    select 'product', 'maude:' || r.id, r.item ->> 'product', null, null, jsonb_build_object('openfda_search', r.source_url),
           null, 'fda_device_event_series'
    from public.corpus_records r
    where r.dataset = 'fda_device_event_series' and r.id <> 'national' and r.id ~ '^[A-Za-z0-9_-]{1,40}$'
      and coalesce(r.item ->> 'product', '') <> '' and r.source_url ~ '^https://api[.]fda[.]gov/';

  -- law units: CFR titles
  insert into pg_temp.insights_stage_entities
    select distinct 'law_unit', 'cfr:' || t.n, 'Title ' || t.n || ', Code of Federal Regulations', 'nation', 'US',
           jsonb_build_object('cfr_title', t.n), '/law/cfr/' || t.n, 'ecfr_section_versions'
    from (select distinct r.item -> 'cells' ->> 'title_number' as n from public.corpus_records r
          where r.dataset = 'ecfr_section_versions') t
    where t.n ~ '^[1-9][0-9]?$';
end $$;

create or replace function insights.entities_commit() returns jsonb
language plpgsql set search_path = '' as $$
declare v_ins integer; v_upd integer; v_del integer; v_lins integer; v_ldel integer; v_staged integer;
begin
  select count(*) into v_staged from pg_temp.insights_stage_entities;
  update insights.entities e set label = s.label, parent_type = s.parent_type, parent_id = s.parent_id, keys = s.keys,
      href = s.href, source_dataset = s.source_dataset, updated_at = now()
    from pg_temp.insights_stage_entities s
    where s.entity_type = e.entity_type and s.entity_id = e.entity_id
      and (e.label, e.parent_type, e.parent_id, e.keys, e.href, e.source_dataset)
          is distinct from (s.label, s.parent_type, s.parent_id, s.keys, s.href, s.source_dataset);
  get diagnostics v_upd = row_count;
  insert into insights.entities (entity_type, entity_id, label, parent_type, parent_id, keys, href, source_dataset)
    select s.entity_type, s.entity_id, s.label, s.parent_type, s.parent_id, s.keys, s.href, s.source_dataset
    from pg_temp.insights_stage_entities s
    where not exists (select 1 from insights.entities e where e.entity_type = s.entity_type and e.entity_id = s.entity_id);
  get diagnostics v_ins = row_count;
  -- an entity no source names any more is removed unless facts still refer to it (they go at their family's refresh)
  with gone as (
    delete from insights.entities e
      where not exists (select 1 from pg_temp.insights_stage_entities s where s.entity_type = e.entity_type and s.entity_id = e.entity_id)
        and not exists (select 1 from insights.facts f where f.entity_type = e.entity_type and f.entity_id = e.entity_id)
      returning 1)
  select count(*) into v_del from gone;
  with gone as (
    delete from insights.links l
      where not exists (select 1 from pg_temp.insights_stage_links s where s.from_type = l.from_type and s.from_id = l.from_id
                        and s.to_type = l.to_type and s.to_id = l.to_id and s.relation = l.relation
                        and s.source_dataset = l.source_dataset and s.source_record_id = l.source_record_id)
      returning 1)
  select count(*) into v_ldel from gone;
  insert into insights.links (from_type, from_id, to_type, to_id, relation, evidence, source_dataset, source_record_id)
    select s.from_type, s.from_id, s.to_type, s.to_id, s.relation, s.evidence, s.source_dataset, s.source_record_id
    from pg_temp.insights_stage_links s
    on conflict (from_type, from_id, to_type, to_id, relation, source_dataset, source_record_id)
    do update set evidence = excluded.evidence, updated_at = now() where insights.links.evidence is distinct from excluded.evidence;
  get diagnostics v_lins = row_count;
  return jsonb_build_object('staged', v_staged, 'inserted', v_ins, 'updated', v_upd, 'deleted', v_del,
    'unchanged', v_staged - v_ins - v_upd, 'links_written', v_lins, 'links_deleted', v_ldel);
end $$;

-- ------------------------------------------------------------------------------------------------ family: places
create or replace function insights.facts_places() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with acs as (
    select case when r.dataset = 'census_acs_counties' then 'acs5' else 'acs1' end as survey,
           case r.item -> 'census' ->> 'level' when 'us' then 'nation' else r.item -> 'census' ->> 'level' end as etype,
           case r.item -> 'census' ->> 'level' when 'us' then 'US' when 'state' then r.item -> 'census' ->> 'usps'
                else r.id end as eid,
           r.item -> 'census' as c
    from public.corpus_records r
    where (r.dataset = 'census_acs1_states' and r.item -> 'census' ->> 'level' in ('us', 'state'))
       or (r.dataset = 'census_acs_counties' and r.item -> 'census' ->> 'level' = 'county' and r.id ~ '^[0-9]{5}$')
  ), span as (
    select a.*,
           (select min(v::integer) from jsonb_array_elements_text(insights.jarr(a.c -> 'years')) v where v ~ '^[0-9]{4}$') as y0,
           (select max(v::integer) from jsonb_array_elements_text(insights.jarr(a.c -> 'years')) v where v ~ '^[0-9]{4}$') as y1
    from acs a
  ), measure (survey, metric, key) as (values
    ('acs1', 'acs1_median_household_income', 'median_hh_income'), ('acs1', 'acs1_poverty_rate', 'poverty_rate'),
    ('acs1', 'acs1_uninsured_rate', 'uninsured'), ('acs1', 'acs1_bachelors_or_higher', 'bachelors_plus'),
    ('acs1', 'acs1_unemployment_rate', 'unemployment_rate'), ('acs1', 'acs1_median_home_value', 'median_home_value'),
    ('acs5', 'acs5_median_household_income', 'median_hh_income'), ('acs5', 'acs5_poverty_rate', 'poverty_rate'),
    ('acs5', 'acs5_uninsured_rate', 'uninsured'), ('acs5', 'acs5_bachelors_or_higher', 'bachelors_plus')
  ), acs_facts as (
    select m.metric, s.etype, s.eid, s.survey, y.y, s.c -> 'series' -> m.key -> (y.y::text) as fig
    from span s join measure m on m.survey = s.survey
    cross join lateral generate_series(s.y0, s.y1) y(y)
  ), cbp as (
    select case r.item -> 'census' ->> 'level' when 'us' then 'nation' else r.item -> 'census' ->> 'level' end as etype,
           case r.item -> 'census' ->> 'level' when 'us' then 'US' when 'state' then r.item -> 'census' ->> 'usps'
                else r.id end as eid,
           r.item -> 'census' as c
    from public.corpus_records r
    where (r.dataset = 'census_cbp_states' and r.item -> 'census' ->> 'level' in ('us', 'state'))
       or (r.dataset = 'census_cbp_counties' and r.item -> 'census' ->> 'level' = 'county' and r.id ~ '^[0-9]{5}$')
  )
  -- resident population (the same series every per-capita metric divides by)
  select 'pop_resident', p.entity_type, p.entity_id, p.year::text, make_date(p.year, 1, 1), make_date(p.year, 12, 31),
         p.pop, null::numeric, false, null::numeric, null::text
  from insights.population() p
  union all
  -- ACS: [value, margin of error, flag]; a missing year inside the geography's span is a gap with its reason
  select f.metric, f.etype, f.eid, f.y::text,
         case when f.survey = 'acs5' then make_date(f.y - 4, 1, 1) else make_date(f.y, 1, 1) end, make_date(f.y, 12, 31),
         v.value, case when v.value is not null and v.moe >= 0 then v.moe end, false, null::numeric,
         case when v.value is not null then null
              when f.fig is null and f.survey = 'acs1' and f.y = 2020
                then 'The Census Bureau released no standard 2020 ACS 1-year estimates (experimental estimates only).'
              when f.fig is null then 'No estimate is stored for this geography and year.'
              when jsonb_typeof(f.fig) = 'array' and f.fig -> 0 = 'null'::jsonb
                then 'The Census Bureau did not publish this figure for this geography and release.'
              else 'The stored figure could not be read.' end
  from acs_facts f
  cross join lateral (select case when jsonb_typeof(f.fig) = 'array' then insights.jnum(f.fig -> 0) end as value,
                             case when jsonb_typeof(f.fig) = 'array' then insights.jnum(f.fig -> 1) end as moe) v
  union all
  -- County Business Patterns, all sectors: [establishments, employees, payroll in $1,000, {flags}]
  select m.metric, b.etype, b.eid, y.key, make_date(y.key::integer, 1, 1), make_date(y.key::integer, 12, 31),
         case when insights.jnum(y.value -> m.idx) >= 0 then insights.jnum(y.value -> m.idx) * m.mult end,
         null::numeric, false, null::numeric,
         case when insights.jnum(y.value -> m.idx) >= 0 then null
              when y.value -> 3 ->> m.flag = 'D'
                then 'Withheld by the Census Bureau to avoid disclosing data of individual businesses (flag D).'
              when y.value -> 3 ->> m.flag = 'S'
                then 'Withheld by the Census Bureau because it does not meet publication standards (flag S).'
              else 'Not published for this geography and year.' end
  from cbp b
  cross join lateral jsonb_each(insights.jobj(b.c -> 'series' -> '00')) y
  cross join (values ('cbp_establishments', 0, 'estab', 1), ('cbp_employees', 1, 'emp', 1),
                     ('cbp_annual_payroll', 2, 'pay', 1000)) m(metric, idx, flag, mult)
  where y.key ~ '^[0-9]{4}$' and jsonb_typeof(y.value) = 'array'
$$;

-- ------------------------------------------------------------------------------------------------ family: courts_fjc
create or replace function insights.facts_courts_fjc() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with civ as (
    select 'nation' as etype, 'US' as eid, r.item -> 'profile' -> 'series' as s
    from public.corpus_records r where r.dataset = 'fjc_civil_national' and r.id = 'US:summary'
    union all
    select 'state', r.id, r.item -> 'profile' -> 'series'
    from public.corpus_records r where r.dataset = 'fjc_civil_states' and r.id ~ '^[A-Z]{2}$'
    union all
    select 'court', r.id, r.item -> 'profile' -> 'series'
    from public.corpus_records r where r.dataset = 'fjc_civil_districts' and r.id ~ '^[a-z]{2,8}$'
  ), civ_y as (
    select distinct on (c.etype, c.eid, (t.e ->> 'fy')::integer)
           c.etype, c.eid, (t.e ->> 'fy')::integer as fy, t.e, coalesce(t.e -> 'partial' = 'true'::jsonb, false) as partial
    from civ c cross join lateral jsonb_array_elements(insights.jarr(c.s)) with ordinality t(e, ord)
    where t.e ->> 'fy' ~ '^[0-9]{4}$'
    order by c.etype, c.eid, (t.e ->> 'fy')::integer, t.ord
  ), crim as (
    select case when r.id = 'national' then 'nation' else 'court' end as etype,
           case when r.id = 'national' then 'US' else substr(r.id, 10) end as eid, r.item -> 'series' as s
    from public.corpus_records r
    where r.dataset = 'fjc_criminal_districts' and (r.id = 'national' or r.id ~ '^district:[a-z]{2,8}$')
  ), crim_y as (
    select distinct on (c.etype, c.eid, (t.e ->> 'fy')::integer)
           c.etype, c.eid, (t.e ->> 'fy')::integer as fy, t.e, coalesce(t.e -> 'partial' = 'true'::jsonb, false) as partial
    from crim c cross join lateral jsonb_array_elements(insights.jarr(c.s)) with ordinality t(e, ord)
    where t.e ->> 'fy' ~ '^[0-9]{4}$'
    order by c.etype, c.eid, (t.e ->> 'fy')::integer, t.ord
  ), pop as (select * from insights.population())
  select m.metric, c.etype, c.eid, 'FY' || c.fy, insights.fy_start(c.fy), insights.fy_end(c.fy),
         case when insights.jnum(c.e -> m.key) >= 0 then insights.jnum(c.e -> m.key) end, null::numeric, c.partial,
         case when m.nkey is not null and insights.jnum(c.e -> m.nkey) >= 0 then insights.jnum(c.e -> m.nkey) end,
         case when insights.jnum(c.e -> m.key) >= 0 then null
              else 'Not recorded in the FJC series for this fiscal year.' end
  from civ_y c
  cross join (values ('fjc_civil_filed', 'filings', null), ('fjc_civil_terminated', 'terminations', null),
                     ('fjc_civil_pending', 'pending_end', null), ('fjc_civil_median_days', 'median_days', 'terminations'))
             m(metric, key, nkey)
  union all
  select 'fjc_civil_filed_per_100k', c.etype, c.eid, 'FY' || c.fy, insights.fy_start(c.fy), insights.fy_end(c.fy),
         insights.per_100k(case when insights.jnum(c.e -> 'filings') >= 0 then insights.jnum(c.e -> 'filings') end, p.pop),
         null::numeric, c.partial,
         case when insights.jnum(c.e -> 'filings') >= 0 then insights.jnum(c.e -> 'filings') end,
         case when coalesce(insights.jnum(c.e -> 'filings') >= 0, false) = false
                then 'Not recorded in the FJC series for this fiscal year.'
              when p.pop is null then 'No Census population estimate for this geography and year.' end
  from civ_y c left join pop p on p.entity_type = c.etype and p.entity_id = c.eid and p.year = c.fy
  where c.etype in ('nation', 'state')
  union all
  select m.metric, c.etype, c.eid, 'FY' || c.fy, insights.fy_start(c.fy), insights.fy_end(c.fy),
         case when insights.jnum(c.e -> m.key) >= 0 then insights.jnum(c.e -> m.key) end, null::numeric, c.partial,
         null::numeric,
         case when insights.jnum(c.e -> m.key) >= 0 then null else 'Not recorded in the FJC series for this fiscal year.' end
  from crim_y c cross join (values ('fjc_criminal_filed', 'filed'), ('fjc_criminal_terminated', 'terminated')) m(metric, key)
$$;

-- ------------------------------------------------------------------------------------------------ family: courts_tables
-- One column of one U.S. Courts table (stored as item.ust: periods, columns, value arrays aligned to the periods, the
-- national total row `nat`, dashes printed by the publisher). Records without a court (summary records) and columns whose
-- array does not match the period count are skipped, as the app's own reader does.
create or replace function insights.ust_values(p_dataset text, p_table text, p_col text, p_n_col text)
returns table (court text, months integer, period_end date, value numeric, n numeric, dashed boolean, nat numeric,
               nat_n numeric, nat_dashed boolean)
language sql stable set search_path = '' as $$
  select x.u ->> 'court', insights.jnum(p.e -> 'months')::integer, (insights.iso_date(p.e ->> 'end'))::date,
         insights.jnum(x.u -> 'data' -> p_col -> p.i),
         case when p_n_col is not null then insights.jnum(x.u -> 'data' -> p_n_col -> p.i) end,
         coalesce(x.u -> 'dash' -> p_col @> to_jsonb(p.i), false),
         insights.jnum(x.u -> 'nat' -> p_col -> p.i),
         case when p_n_col is not null then insights.jnum(x.u -> 'nat' -> p_n_col -> p.i) end,
         coalesce(x.u -> 'natDash' -> p_col @> to_jsonb(p.i), false)
  from public.corpus_records r
  cross join lateral (select r.item -> 'ust' as u) x
  cross join lateral (select t.e, (t.ord - 1)::integer as i
                      from jsonb_array_elements(insights.jarr(x.u -> 'periods')) with ordinality t(e, ord)) p
  where r.dataset = p_dataset and split_part(r.id, ':', 2) = p_table and x.u ->> 'v' = '1'
    and x.u ->> 'court' is not null and x.u ->> 'court' = split_part(r.id, ':', 1)
    and jsonb_typeof(x.u -> 'data' -> p_col) = 'array'
    and jsonb_array_length(x.u -> 'data' -> p_col) = jsonb_array_length(x.u -> 'periods')
    and insights.iso_date(p.e ->> 'end') is not null
$$;

create or replace function insights.facts_courts_tables() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with spec (metric, dataset, tbl, col, ncol, months, etype, national) as (values
    ('usc_civil_filed', 'uscourts_tables_district', 'c', 'filed/y0', null, 12, 'court', true),
    ('usc_civil_filed', 'uscourts_tables_circuit', 'c', 'filed/y0', null, 12, 'circuit', false),
    ('usc_civil_terminated', 'uscourts_tables_district', 'c', 'terminated/y0', null, 12, 'court', true),
    ('usc_civil_terminated', 'uscourts_tables_circuit', 'c', 'terminated/y0', null, 12, 'circuit', false),
    ('usc_civil_pending', 'uscourts_tables_district', 'c', 'pending/y0', null, 12, 'court', true),
    ('usc_civil_pending', 'uscourts_tables_circuit', 'c', 'pending/y0', null, 12, 'circuit', false),
    ('usc_civil_median_months', 'uscourts_tables_district', 'c-5', 'total_cases/median_time_interval_in_months',
     'total_cases/number_of_cases', 12, 'court', true),
    ('usc_civil_median_months', 'uscourts_tables_circuit', 'c-5', 'total_cases/median_time_interval_in_months',
     'total_cases/number_of_cases', 12, 'circuit', false),
    ('usc_civil_pending_3yr_pct', 'uscourts_tables_district', 'c-6', 'length_of_time_pending/3_years_or_more/percent',
     'length_of_time_pending/3_years_or_more/number', 0, 'court', true),
    ('usc_civil_pending_3yr_pct', 'uscourts_tables_circuit', 'c-6', 'length_of_time_pending/3_years_or_more/percent',
     'length_of_time_pending/3_years_or_more/number', 0, 'circuit', false),
    ('usc_weighted_filings_per_judgeship', 'uscourts_tables_district', 'x-1a', 'weighted_filings_per_judgeship/total', null,
     12, 'court', true),
    ('usc_judgeships', 'uscourts_tables_district', 'x-1a', 'judgeships', null, 12, 'court', true),
    ('usc_product_liability_filed', 'uscourts_tables_district', 'c-11', 'y0_total', null, 12, 'court', true),
    ('usc_product_liability_filed', 'uscourts_tables_circuit', 'c-11', 'y0_total', null, 12, 'circuit', false),
    ('usc_appeals_filed', 'uscourts_tables_circuit', 'b', 'filed/y0', null, 12, 'circuit', true),
    ('usc_appeals_terminated', 'uscourts_tables_circuit', 'b', 'terminated/y0', null, 12, 'circuit', true),
    ('usc_appeals_pending', 'uscourts_tables_circuit', 'b', 'pending/y0', null, 12, 'circuit', true),
    ('usc_bankruptcy_filed', 'uscourts_tables_bankruptcy', 'f', 'filed/y0', null, 12, 'court', true),
    ('usc_bankruptcy_filed', 'uscourts_tables_circuit', 'f', 'filed/y0', null, 12, 'circuit', false)
  ), v as (
    select s.metric, s.etype, s.national, s.months as want, u.*
    from spec s cross join lateral insights.ust_values(s.dataset, s.tbl, s.col, s.ncol) u
    where u.months = s.months
  )
  select v.metric, v.etype, v.court, v.period_end::text,
         case when v.want = 0 then v.period_end else insights.t12_start(v.period_end) end, v.period_end,
         v.value, null::numeric, false, v.n,
         case when v.value is not null then null
              when v.dashed then 'The table prints a dash for this court and period.'
              else 'No figure is stored for this court and period of the table.' end
  from v
  -- the two Arkansas districts' combined bankruptcy row has no court of its own (it counts in the national total)
  where not (v.metric = 'usc_bankruptcy_filed' and v.court = 'arcomb')
  union all
  select v.metric, 'nation', 'US', v.period_end::text,
         case when v.want = 0 then v.period_end else insights.t12_start(v.period_end) end, v.period_end,
         case when count(distinct v.nat) = 1 then min(v.nat) end, null::numeric, false,
         case when count(distinct v.nat) = 1 and count(distinct v.nat_n) = 1 then min(v.nat_n) end,
         case when count(distinct v.nat) = 1 then null
              when count(distinct v.nat) > 1 then 'The national total differs between the court records of this table.'
              when bool_or(v.nat_dashed) then 'The table prints a dash for the national total.'
              else 'No national total is stored for this period of the table.' end
  from v where v.national
  group by v.metric, v.want, v.period_end
$$;

-- ------------------------------------------------------------------------------------------------ family: judiciary
create or replace function insights.facts_judiciary() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with vac as (
    select distinct on (t.e ->> 'month') t.e ->> 'month' as month, t.e
    from public.corpus_records r cross join lateral jsonb_array_elements(insights.jarr(r.item -> 'series')) with ordinality t(e, ord)
    where r.dataset = 'judicial_vacancies' and r.id = 'national' and t.e ->> 'month' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    order by t.e ->> 'month', t.ord
  ), asof as (
    select insights.iso_date(d.metadata -> 'summary' ->> 'as_of') as d from public.corpus_datasets d where d.id = 'judge_profiles_fjc'
  ), sitting as (
    select r.filters -> 'court' ->> 0 as court
    from public.corpus_records r
    where r.dataset = 'judge_profiles_fjc' and r.id ~ '^[0-9]{1,12}$' and r.filters -> 'sitting' ->> 0 = 'yes'
      and r.filters -> 'court' ->> 0 is not null
  )
  select 'judicial_vacancies', 'nation', 'US', v.month, to_date(v.month || '-01', 'YYYY-MM-DD'), insights.month_end(v.month),
         case when v.e -> 'reports' ->> 'vacancies' = 'parsed' and insights.jnum(v.e -> 'vacancies_listed') >= 0
              then insights.jnum(v.e -> 'vacancies_listed') end,
         null::numeric, false, null::numeric,
         case when v.e -> 'reports' ->> 'vacancies' = 'parsed' and insights.jnum(v.e -> 'vacancies_listed') >= 0 then null
              when v.e -> 'reports' ->> 'vacancies' = 'parsed' then 'The list was read but its vacancy count is not recorded.'
              else 'This month''s vacancy list was not read in full (scanned report, unsupported layout or partly read); not a zero.' end
  from vac v
  union all
  select 'fjc_sitting_judges', 'court', s.court, a.d, a.d::date, a.d::date, count(*)::numeric, null::numeric, false,
         null::numeric, null::text
  from sitting s cross join asof a where a.d is not null
  group by s.court, a.d
  union all
  select 'fjc_sitting_judges', 'nation', 'US', a.d, a.d::date, a.d::date, count(*)::numeric, null::numeric, false,
         null::numeric, null::text
  from sitting s cross join asof a where a.d is not null
  group by a.d
$$;

-- a calendar year is partial when the data's latest date ("through", ISO text) falls before its last day
create or replace function insights.year_partial(p_year integer, p_through text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p_through is null or (p_year::text || '-12-31') > p_through
$$;

-- ------------------------------------------------------------------------------------------------ family: mdl
create or replace function insights.facts_mdl() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with hist as (
    select distinct on (r.id, t.e ->> 'report_date') r.id as mdl, t.e ->> 'report_date' as d,
           case when insights.jnum(t.e -> 'pending') >= 0 then insights.jnum(t.e -> 'pending') end as pending,
           case when insights.jnum(t.e -> 'total') >= 0 then insights.jnum(t.e -> 'total') end as total
    from public.corpus_records r
    cross join lateral jsonb_array_elements(insights.jarr(r.item -> 'history' -> 'series')) with ordinality t(e, ord)
    where r.dataset = 'jpml_pending_history_mdls' and r.id ~ '^[0-9]{1,5}$' and insights.iso_date(t.e ->> 'report_date') is not null
    order by r.id, t.e ->> 'report_date', t.ord
  ), reg as (
    select r.id, r.item ->> 'cl_court_id' as court, insights.iso_date(r.item ->> 'as_of') as asof,
           case when insights.jnum(r.item -> 'actions_pending') >= 0 then insights.jnum(r.item -> 'actions_pending') end as pending
    from public.corpus_records r
    where r.dataset = 'mdls' and r.id ~ '^[0-9]{1,5}$' and r.item ->> 'status' = 'pending'
  ), fy as (
    select distinct on ((t.e ->> 'fy')::integer) (t.e ->> 'fy')::integer as fy, t.e
    from public.corpus_records r cross join lateral jsonb_array_elements(insights.jarr(r.item -> 'overview' -> 'series')) with ordinality t(e, ord)
    where r.dataset = 'jpml_statistics_extra' and r.id = 'summary:overview' and t.e ->> 'fy' ~ '^[0-9]{4}$'
    order by (t.e ->> 'fy')::integer, t.ord
  ), panel as (
    select (r.item -> 'stats' ->> 'year')::integer as y, r.item -> 'stats' -> 'motions_granted' as v
    from public.corpus_records r
    where r.dataset = 'mdl_intel_jpml_stats' and r.id ~ '^year:[0-9]{4}$' and r.item -> 'stats' ->> 'year' = substr(r.id, 6)
  ), scac as (
    select (r.item -> 'cells' ->> 'year')::integer as y, r.item -> 'cells' as c
    from public.corpus_records r
    where r.dataset = 'scac_statistics' and r.id ~ '^year:[0-9]{4}$' and r.item -> 'cells' ->> 'kind' = 'year'
      and r.item -> 'cells' ->> 'year' = substr(r.id, 6)
  )
  select 'mdl_actions_pending', 'mdl', h.mdl, h.d, h.d::date, h.d::date, h.pending, null::numeric, false, null::numeric,
         case when h.pending is null then 'The report prints no pending count for this MDL.' end
  from hist h
  union all
  select 'mdl_actions_total', 'mdl', h.mdl, h.d, h.d::date, h.d::date, h.total, null::numeric, false, null::numeric,
         case when h.total is null then 'The report prints no historical total for this MDL.' end
  from hist h
  union all
  select 'mdl_actions_pending', 'nation', 'US', h.d, h.d::date, h.d::date,
         case when count(*) = count(h.pending) then sum(h.pending) end, null::numeric, false, count(*)::numeric,
         case when count(*) <> count(h.pending) then 'At least one MDL of the report has no printed pending count.' end
  from hist h group by h.d
  union all
  select 'mdl_pending_mdls', 'nation', 'US', h.d, h.d::date, h.d::date, count(*)::numeric, null::numeric, false,
         null::numeric, null::text
  from hist h group by h.d
  union all
  select 'mdl_court_actions_pending', 'court', g.court, g.asof, g.asof::date, g.asof::date,
         case when count(*) = count(g.pending) then sum(g.pending) end, null::numeric, false, count(*)::numeric,
         case when count(*) <> count(g.pending) then 'At least one of the court''s MDLs has no printed pending count.' end
  from reg g where g.court is not null and g.asof is not null group by g.court, g.asof
  union all
  select 'mdl_court_pending_mdls', 'court', g.court, g.asof, g.asof::date, g.asof::date, count(*)::numeric, null::numeric,
         false, null::numeric, null::text
  from reg g where g.court is not null and g.asof is not null group by g.court, g.asof
  union all
  select 'jpml_fy_actions_pending', 'nation', 'US', 'FY' || f.fy, insights.fy_start(f.fy), insights.fy_end(f.fy),
         case when insights.jnum(f.e -> 'pending') >= 0 then insights.jnum(f.e -> 'pending') end, null::numeric, false,
         null::numeric,
         case when insights.jnum(f.e -> 'pending') >= 0 then null else 'Not printed in the Panel''s statistics for this fiscal year.' end
  from fy f
  union all
  select 'jpml_motions_granted', 'nation', 'US', p.y::text, make_date(p.y, 1, 1), make_date(p.y, 12, 31),
         case when insights.jnum(p.v) >= 0 then insights.jnum(p.v) end, null::numeric, false, null::numeric,
         case when insights.jnum(p.v) >= 0 then null else 'Not printed in the Panel''s statistics for this year.' end
  from panel p
  union all
  select 'scac_filings', 'nation', 'US', s.y::text, make_date(s.y, 1, 1), make_date(s.y, 12, 31),
         case when insights.jnum(s.c -> 'filings') >= 0 then insights.jnum(s.c -> 'filings') end, null::numeric,
         coalesce(s.c -> 'partial' = 'true'::jsonb, false), null::numeric,
         case when insights.jnum(s.c -> 'filings') >= 0 then null else 'Not published by the Clearinghouse for this year.' end
  from scac s
$$;

-- ------------------------------------------------------------------------------------------------ family: caselaw
-- plpgsql so the function can be created where the caselaw schema is installed later
create or replace function insights.facts_caselaw() returns setof insights.fact_row
language plpgsql stable set search_path = '' as $$
declare v_through text;
begin
  select to_char(max(c.date_filed), 'YYYY-MM-DD') into v_through from caselaw.cases c where not c.date_approx;
  if v_through is null then return; end if;
  return query
    with y as (
      select c.court_id, extract(year from c.date_filed)::integer as yr, count(*)::numeric as n,
             sum(c.cited_by)::numeric as cites
      from caselaw.cases c
      where not c.date_approx and c.date_filed >= date '1750-01-01'
      group by c.court_id, extract(year from c.date_filed)::integer
    )
    select 'caselaw_opinion_clusters'::text, 'court'::text, y.court_id, y.yr::text, make_date(y.yr, 1, 1),
           make_date(y.yr, 12, 31), y.n, null::numeric, insights.year_partial(y.yr, v_through), null::numeric, null::text
    from y
    union all
    select 'caselaw_citations_received', 'court', y.court_id, y.yr::text, make_date(y.yr, 1, 1), make_date(y.yr, 12, 31),
           y.cites, null::numeric, insights.year_partial(y.yr, v_through), y.n, null::text
    from y
    union all
    select 'caselaw_opinion_clusters', 'nation', 'US', y.yr::text, make_date(y.yr, 1, 1), make_date(y.yr, 12, 31),
           sum(y.n), null::numeric, insights.year_partial(y.yr, v_through), null::numeric, null::text
    from y group by y.yr
    union all
    select 'caselaw_citations_received', 'nation', 'US', y.yr::text, make_date(y.yr, 1, 1), make_date(y.yr, 12, 31),
           sum(y.cites), null::numeric, insights.year_partial(y.yr, v_through), sum(y.n), null::text
    from y group by y.yr;
end $$;

-- ------------------------------------------------------------------------------------------------ family: enforcement
create or replace function insights.facts_enforcement() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with doj as (
    select left(r.item -> 'release' ->> 'date', 4)::integer as y, r.item -> 'release' ->> 'date' as d,
           r.filters -> 'state' ->> 0 as st
    from public.corpus_records r
    where r.dataset = any (array(select d.id from public.corpus_datasets d where d.id ~ '^doj_press_releases_[0-9]{4}$'))
      and insights.iso_date(r.item -> 'release' ->> 'date') is not null
  ), doj_t as (select max(d) as t from doj),
  sec as (
    select r.filters -> 'type' ->> 0 as type, (r.filters -> 'year' ->> 0)::integer as y,
           insights.iso_date(r.item -> 'sec_action' ->> 'date') as d
    from public.corpus_records r
    where r.dataset = 'sec_enforcement_actions' and r.filters -> 'year' ->> 0 ~ '^[0-9]{4}$'
      and r.filters -> 'type' ->> 0 in ('litigation_release', 'administrative_proceeding')
  ), sec_t as (select coalesce(max(d), max(y)::text || '-01-01') as t from sec),
  ftc as (
    select (r.filters -> 'year' ->> 0)::integer as y, insights.iso_date(r.item -> 'ftc_action' ->> 'date') as d
    from public.corpus_records r
    where r.dataset = 'ftc_enforcement_actions' and r.filters -> 'year' ->> 0 ~ '^[0-9]{4}$'
      and r.filters -> 'kind' ->> 0 in ('merger', 'nonmerger', 'bc_penalty', 'bcp_penalty')
  ), ftc_t as (select coalesce(max(d), max(y)::text || '-01-01') as t from ftc),
  frb as (
    select (r.filters -> 'year' ->> 0)::integer as y, insights.iso_date(r.item -> 'cells' ->> 'effective') as d
    from public.corpus_records r
    where r.dataset = 'frb_enforcement_actions' and r.item ? 'frb_action' and r.filters -> 'year' ->> 0 ~ '^[0-9]{4}$'
  ), frb_t as (select coalesce(max(d), max(y)::text || '-01-01') as t from frb),
  epa as (
    select case when split_part(r.id, ':', 2) = 'US' then 'nation' else 'state' end as etype,
           case when split_part(r.id, ':', 2) = 'US' then 'US' else split_part(r.id, ':', 3) end as eid,
           (regexp_match(r.id, '([0-9]{4})$'))[1]::integer as fy, r.item -> 'cells' as c
    from public.corpus_records r
    where r.dataset = 'epa_echo_case_series' and r.id ~ '^epa-echo-series:(US|state:[A-Z]{2}):[0-9]{4}$'
      and r.item -> 'cells' ->> 'fy' = (regexp_match(r.id, '([0-9]{4})$'))[1]
  ), epa_lcf as (
    select coalesce((select insights.jnum(d.metadata -> 'summary' -> 'latest_complete_fy') from public.corpus_datasets d
                     where d.id = 'epa_echo_case_series'), (select max(fy) - 1 from epa)) as fy
  ), osha_st as (
    select distinct on (r.id, (t.e ->> 'fy')::integer) substr(r.id, 12) as st, t.e, (t.e ->> 'fy')::integer as fy
    from public.corpus_records r
    cross join lateral jsonb_array_elements(insights.jarr(r.item -> 'profile' -> 'years')) with ordinality t(e, ord)
    where r.dataset = 'osha_inspections_states' and r.id ~ '^osha-state:[A-Z]{2}$' and t.e ->> 'fy' ~ '^[0-9]{4}$'
    order by r.id, (t.e ->> 'fy')::integer, t.ord
  ), osha_us as (
    select (r.item -> 'year' ->> 'fy')::integer as fy, r.item -> 'year' as e
    from public.corpus_records r
    where r.dataset = 'osha_inspections_national' and r.id ~ '^osha-national:FY[0-9]{4}$'
      and r.item -> 'year' ->> 'fy' = substr(r.id, 17)
  ), osha_lcf as (
    select coalesce((select max(insights.jnum(r.item -> 'profile' -> 'latest_complete_fy')) from public.corpus_records r
                     where r.dataset = 'osha_inspections_states'), (select max(fy) - 1 from osha_us)) as fy
  ), leie as (
    select left(r.item -> 'cells' ->> 'excluded', 4)::integer as y, r.item -> 'cells' ->> 'excluded' as d,
           r.item -> 'cells' ->> 'state' as st
    from public.corpus_records r
    where r.dataset = 'oig_leie_exclusions' and insights.iso_date(r.item -> 'cells' ->> 'excluded') is not null
  ), leie_t as (select max(d) as t from leie),
  ovs as (
    select distinct on (r.id, (t.e ->> 'year')::integer)
           case when r.id = 'national' then 'nation' else 'agency' end as etype,
           case when r.id = 'national' then 'US' else r.id end as eid,
           (t.e ->> 'year')::integer as y, t.e,
           coalesce(insights.iso_date(r.item -> 'trend' ->> 'as_of'), insights.iso_date(r.item -> 'cells' ->> 'last')) as asof
    from public.corpus_records r
    cross join lateral jsonb_array_elements(insights.jarr(r.item -> 'trend' -> 'years')) with ordinality t(e, ord)
    where r.dataset = 'oversight_trends' and (r.id = 'national' or r.id ~ '^oig:[a-z0-9-]{2,70}$')
      and t.e ->> 'year' ~ '^[0-9]{4}$'
    order by r.id, (t.e ->> 'year')::integer, t.ord
  )
  select 'doj_press_releases', 'nation', 'US', y::text, make_date(y, 1, 1), make_date(y, 12, 31), count(*)::numeric,
         null::numeric, insights.year_partial(y, (select t from doj_t)), null::numeric, null::text
  from doj group by y
  union all
  select 'doj_state_press_releases', 'state', g.usps, doj.y::text, make_date(doj.y, 1, 1), make_date(doj.y, 12, 31),
         count(*)::numeric, null::numeric, insights.year_partial(doj.y, (select t from doj_t)), null::numeric, null::text
  from doj join insights.geo_states g on g.usps = doj.st group by g.usps, doj.y
  union all
  select case s.type when 'litigation_release' then 'sec_litigation_releases' else 'sec_administrative_proceedings' end,
         'nation', 'US', s.y::text, make_date(s.y, 1, 1), make_date(s.y, 12, 31), count(*)::numeric, null::numeric,
         insights.year_partial(s.y, (select t from sec_t)), null::numeric, null::text
  from sec s group by s.type, s.y
  union all
  select 'ftc_enforcement_actions', 'nation', 'US', f.y::text, make_date(f.y, 1, 1), make_date(f.y, 12, 31),
         count(*)::numeric, null::numeric, insights.year_partial(f.y, (select t from ftc_t)), null::numeric, null::text
  from ftc f group by f.y
  union all
  select 'frb_enforcement_actions', 'nation', 'US', f.y::text, make_date(f.y, 1, 1), make_date(f.y, 12, 31),
         count(*)::numeric, null::numeric, insights.year_partial(f.y, (select t from frb_t)), null::numeric, null::text
  from frb f group by f.y
  union all
  select m.metric, e.etype, e.eid, 'FY' || e.fy, insights.fy_start(e.fy), insights.fy_end(e.fy),
         case when insights.jnum(e.c -> m.key) >= 0 then insights.jnum(e.c -> m.key) end, null::numeric,
         e.fy > (select fy from epa_lcf), null::numeric,
         case when insights.jnum(e.c -> m.key) >= 0 then null else 'Not recorded in the ECHO case series for this fiscal year.' end
  from epa e cross join (values ('epa_cases_opened', 'opened'), ('epa_federal_penalties', 'fed_penalty')) m(metric, key)
  where e.etype = 'nation' or exists (select 1 from insights.geo_states g where g.usps = e.eid)
  union all
  select m.metric, 'state', o.st, 'FY' || o.fy, insights.fy_start(o.fy), insights.fy_end(o.fy),
         case when insights.jnum(o.e -> m.key) >= 0 then insights.jnum(o.e -> m.key) end, null::numeric,
         o.fy > (select fy from osha_lcf), null::numeric,
         case when insights.jnum(o.e -> m.key) >= 0 then null else 'Not recorded in the OSHA series for this fiscal year.' end
  from osha_st o cross join (values ('osha_inspections', 'inspections'), ('osha_current_penalties', 'current_penalty')) m(metric, key)
  where exists (select 1 from insights.geo_states g where g.usps = o.st)
  union all
  select m.metric, 'nation', 'US', 'FY' || o.fy, insights.fy_start(o.fy), insights.fy_end(o.fy),
         case when insights.jnum(o.e -> m.key) >= 0 then insights.jnum(o.e -> m.key) end, null::numeric,
         o.fy > (select fy from osha_lcf), null::numeric,
         case when insights.jnum(o.e -> m.key) >= 0 then null else 'Not recorded in the OSHA series for this fiscal year.' end
  from osha_us o cross join (values ('osha_inspections', 'inspections'), ('osha_current_penalties', 'current_penalty')) m(metric, key)
  union all
  select 'leie_exclusions', 'nation', 'US', l.y::text, make_date(l.y, 1, 1), make_date(l.y, 12, 31), count(*)::numeric,
         null::numeric, insights.year_partial(l.y, (select t from leie_t)), null::numeric, null::text
  from leie l group by l.y
  union all
  select 'leie_exclusions', 'state', g.usps, l.y::text, make_date(l.y, 1, 1), make_date(l.y, 12, 31), count(*)::numeric,
         null::numeric, insights.year_partial(l.y, (select t from leie_t)), null::numeric, null::text
  from leie l join insights.geo_states g on g.usps = l.st group by g.usps, l.y
  union all
  select 'oversight_reports', o.etype, o.eid, o.y::text, make_date(o.y, 1, 1),
         make_date(o.y, 12, 31),
         case when insights.jnum(o.e -> 'reports') >= 0 then insights.jnum(o.e -> 'reports') end, null::numeric,
         insights.year_partial(o.y, o.asof), null::numeric,
         case when insights.jnum(o.e -> 'reports') >= 0 then null else 'Not recorded in the Oversight.gov tally for this year.' end
  from ovs o
$$;

-- ------------------------------------------------------------------------------------------------ family: safety
-- a yearly report series stored as [{year, reports, partial}, ...]
create or replace function insights.year_series(p_series jsonb, p_key text)
returns table (y integer, value numeric, partial boolean)
language sql immutable set search_path = '' as $$
  select distinct on ((t.e ->> 'year')::integer) (t.e ->> 'year')::integer,
         case when insights.jnum(t.e -> p_key) >= 0 then insights.jnum(t.e -> p_key) end,
         coalesce(t.e -> 'partial' = 'true'::jsonb, false)
  from jsonb_array_elements(insights.jarr(p_series)) with ordinality t(e, ord)
  where t.e ->> 'year' ~ '^[0-9]{4}$'
  order by (t.e ->> 'year')::integer, t.ord
$$;

create or replace function insights.facts_safety() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with cpsc as (
    select (r.item -> 'agg' ->> 'year')::integer as y, r.item -> 'agg' as a
    from public.corpus_records r
    where r.dataset = 'regulatory_cpsc_aggregates' and r.id ~ '^cpsc-agg:year:[0-9]{4}$'
      and r.item -> 'agg' ->> 'year' = substr(r.id, 15)
  ), nhtsa as (
    select (r.filters -> 'year' ->> 0)::integer as y, insights.iso_date(r.filters ->> 'date') as d
    from public.corpus_records r
    where r.dataset = 'agency_safety_nhtsa_recalls' and r.item ->> 'kind' = 'recall' and r.filters -> 'year' ->> 0 ~ '^[0-9]{4}$'
  ), nhtsa_t as (select coalesce(max(d), max(y)::text || '-01-01') as t from nhtsa),
  fsis as (
    select left(r.item -> 'cells' ->> 'date', 4)::integer as y, r.item -> 'cells' ->> 'date' as d,
           case when r.item -> 'cells' ->> 'kind' = 'Recall' and r.item -> 'cells' ->> 'class' in ('I', 'II', 'III') then 'fsis_recalls'
                when r.item -> 'cells' ->> 'kind' = 'Public health alert' then 'fsis_public_health_alerts' end as metric
    from public.corpus_records r
    where r.dataset = 'fsis_recalls' and insights.iso_date(r.item -> 'cells' ->> 'date') is not null
  ), fsis_t as (select max(d) as t from fsis),
  fda as (
    select case r.dataset when 'agency_safety_openfda_drug_enforcement' then 'fda_drug_enforcement_reports'
                          when 'agency_safety_openfda_device_enforcement' then 'fda_device_enforcement_reports'
                          else 'fda_food_enforcement_reports' end as metric,
           left(r.filters ->> 'report_date', 4)::integer as y, r.filters ->> 'report_date' as d
    from public.corpus_records r
    where r.dataset in ('agency_safety_openfda_drug_enforcement', 'agency_safety_openfda_device_enforcement',
                        'agency_safety_openfda_food_enforcement')
      and insights.iso_date(r.filters ->> 'report_date') is not null
  ), fda_t as (select f.metric, max(f.d) as t from fda f group by f.metric),
  adverse as (
    select 'faers_reports' as metric, 'nation' as etype, 'US' as eid, r.item -> 'series' as s
    from public.corpus_records r where r.dataset = 'fda_faers_national_series' and r.id = 'all_years'
    union all
    select 'faers_reports', 'product', 'faers:' || r.id, r.item -> 'series'
    from public.corpus_records r
    where r.dataset = 'fda_faers_product_series' and r.id ~ '^[A-Za-z0-9_-]{1,40}$' and coalesce(r.item ->> 'product', '') <> ''
      and r.source_url ~ '^https://api[.]fda[.]gov/'
    union all
    select 'maude_reports', 'nation', 'US', r.item -> 'series'
    from public.corpus_records r where r.dataset = 'fda_device_event_series' and r.id = 'national'
    union all
    select 'maude_reports', 'product', 'maude:' || r.id, r.item -> 'series'
    from public.corpus_records r
    where r.dataset = 'fda_device_event_series' and r.id <> 'national' and r.id ~ '^[A-Za-z0-9_-]{1,40}$'
      and coalesce(r.item ->> 'product', '') <> '' and r.source_url ~ '^https://api[.]fda[.]gov/'
  ), caers as (
    select distinct on ((r.item -> 'point' ->> 'year')::integer) (r.item -> 'point' ->> 'year')::integer as y,
           r.item -> 'point' as p
    from public.corpus_records r
    where r.dataset = 'fda_caers_series' and r.item ->> 'kind' = 'caers_year' and r.item -> 'point' ->> 'year' ~ '^[0-9]{4}$'
    order by (r.item -> 'point' ->> 'year')::integer, r.id
  ), neiss as (
    select r.id::integer as y, r.item -> 'cells' as c
    from public.corpus_records r where r.dataset = 'neiss_national_years' and r.id ~ '^[0-9]{4}$'
  ), safer as (
    select substr(r.id, 8)::integer as y, r.item -> 'cells' as c
    from public.corpus_records r where r.dataset = 'saferproducts_reports_series' and r.id ~ '^sp-pub-[0-9]{4}$'
  )
  select 'cpsc_recalls', 'nation', 'US', c.y::text, make_date(c.y, 1, 1), make_date(c.y, 12, 31),
         case when insights.jnum(c.a -> 'recalls') >= 0 then insights.jnum(c.a -> 'recalls') end, null::numeric,
         coalesce(c.a -> 'partial' = 'true'::jsonb, false), null::numeric,
         case when insights.jnum(c.a -> 'recalls') >= 0 then null else 'Not recorded in the CPSC aggregates for this year.' end
  from cpsc c
  union all
  select 'nhtsa_recall_campaigns', 'nation', 'US', n.y::text, make_date(n.y, 1, 1), make_date(n.y, 12, 31), count(*)::numeric,
         null::numeric, insights.year_partial(n.y, (select t from nhtsa_t)), null::numeric, null::text
  from nhtsa n group by n.y
  union all
  select f.metric, 'nation', 'US', f.y::text, make_date(f.y, 1, 1), make_date(f.y, 12, 31), count(*)::numeric,
         null::numeric, insights.year_partial(f.y, (select t from fsis_t)), null::numeric, null::text
  from fsis f where f.metric is not null group by f.metric, f.y
  union all
  select f.metric, 'nation', 'US', f.y::text, make_date(f.y, 1, 1), make_date(f.y, 12, 31), count(*)::numeric,
         null::numeric, insights.year_partial(f.y, t.t), null::numeric, null::text
  from fda f join fda_t t on t.metric = f.metric group by f.metric, f.y, t.t
  union all
  select a.metric, a.etype, a.eid, s.y::text, make_date(s.y, 1, 1), make_date(s.y, 12, 31), s.value, null::numeric,
         s.partial, null::numeric,
         case when s.value is null then 'Not recorded in the openFDA series for this year.' end
  from adverse a cross join lateral insights.year_series(a.s, 'reports') s
  union all
  select 'caers_reports', 'nation', 'US', c.y::text, make_date(c.y, 1, 1), make_date(c.y, 12, 31),
         case when insights.jnum(c.p -> 'reports') >= 0 then insights.jnum(c.p -> 'reports') end, null::numeric,
         coalesce(c.p -> 'partial' = 'true'::jsonb, false), null::numeric,
         case when insights.jnum(c.p -> 'reports') >= 0 then null else 'Not recorded in the openFDA series for this year.' end
  from caers c
  union all
  select 'neiss_injury_estimate', 'nation', 'US', n.y::text, make_date(n.y, 1, 1), make_date(n.y, 12, 31),
         case when insights.jnum(n.c -> 'estimate') >= 0 then insights.jnum(n.c -> 'estimate') end, null::numeric, false,
         case when insights.jnum(n.c -> 'cases') >= 0 then insights.jnum(n.c -> 'cases') end,
         case when insights.jnum(n.c -> 'estimate') >= 0 then null else 'CPSC published no estimate for this year.' end
  from neiss n
  union all
  select 'saferproducts_reports', 'nation', 'US', s.y::text, make_date(s.y, 1, 1), make_date(s.y, 12, 31),
         case when insights.jnum(s.c -> 'reports') >= 0 then insights.jnum(s.c -> 'reports') end, null::numeric,
         coalesce(s.c ->> 'period' ~* 'partial', false), null::numeric,
         case when insights.jnum(s.c -> 'reports') >= 0 then null else 'Not recorded in the SaferProducts.gov series for this year.' end
  from safer s
$$;

-- ------------------------------------------------------------------------------------------------ family: companies
create or replace function insights.facts_companies() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with fin as (
    select m.metric, r.id as cik, substr(e.value ->> 'frame', 3)::integer as y, insights.jnum(e.value -> 'value') as v,
           insights.iso_date(e.value ->> 'start') as s, insights.iso_date(e.value ->> 'end') as en
    from public.corpus_records r
    cross join (values ('sec_revenue', 'revenue'), ('sec_net_income', 'net_income')) m(metric, key)
    cross join lateral jsonb_array_elements(insights.jarr(r.item -> 'annual' -> m.key)) e
    where r.dataset = 'company_sec_financials' and r.id ~ '^[0-9]{10}$' and e.value ->> 'frame' ~ '^CY[0-9]{4}$'
      and coalesce(e.value ->> 'unit', 'USD') = 'USD'
  ), pay as (
    select distinct on (r.id, (t.e ->> 'year')::integer) r.id, (t.e ->> 'year')::integer as y, t.e
    from public.corpus_records r
    cross join lateral jsonb_array_elements(insights.jarr(r.item -> 'payments' -> 'years')) with ordinality t(e, ord)
    where r.dataset = 'company_payments_manufacturers' and r.id ~ '^op-[0-9]{6,15}$' and t.e ->> 'year' ~ '^[0-9]{4}$'
    order by r.id, (t.e ->> 'year')::integer, t.ord
  )
  select f.metric, 'company', f.cik, f.y::text,
         case when count(distinct f.s) = 1 then min(f.s)::date else make_date(f.y, 1, 1) end,
         case when count(distinct f.en) = 1 then min(f.en)::date else make_date(f.y, 12, 31) end,
         case when count(distinct f.v) = 1 and count(f.v) = count(*) then min(f.v) end, null::numeric, false, null::numeric,
         case when count(distinct f.v) = 1 and count(f.v) = count(*) then null
              when count(f.v) < count(*) then 'A value filed for this frame could not be read.'
              else 'Different values were filed for this frame.' end
  from fin f group by f.metric, f.cik, f.y
  union all
  select m.metric, 'company', p.id, p.y::text, make_date(p.y, 1, 1), make_date(p.y, 12, 31),
         case when insights.jnum(p.e -> m.key) >= 0 then insights.jnum(p.e -> m.key) end, null::numeric, false,
         case when insights.jnum(p.e -> m.nkey) >= 0 then insights.jnum(p.e -> m.nkey) end,
         case when insights.jnum(p.e -> m.key) >= 0 then null else 'Not recorded for this program year.' end
  from pay p
  cross join (values ('open_payments_general', 'general', 'generalRecords'),
                     ('open_payments_research', 'research', 'researchRecords')) m(metric, key, nkey)
$$;

-- ------------------------------------------------------------------------------------------------ family: government
create or replace function insights.facts_government() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with fr as (
    select case when r.id = 'federal-register' then 'nation' else 'agency' end as etype,
           case when r.id = 'federal-register' then 'US' else r.id end as eid,
           r.item -> 'trends' -> 'yearly' as yearly, insights.iso_date(r.item -> 'trends' ->> 'asOf') as asof
    from public.corpus_records r
    where r.dataset = 'fr_agency_trends' and (r.id = 'federal-register' or r.id ~ '^[0-9]{1,6}$')
  ), cfr as (
    select r.item -> 'cells' ->> 'title_number' as title, left(v.value ->> 'date', 4)::integer as y, v.value ->> 'date' as d
    from public.corpus_records r cross join lateral jsonb_array_elements(insights.jarr(r.detail -> 'versions')) v
    where r.dataset = 'ecfr_section_versions' and r.item -> 'cells' ->> 'title_number' ~ '^[1-9][0-9]?$'
      and v.value -> 'substantive' = 'true'::jsonb and insights.iso_date(v.value ->> 'date') >= '2017-01-03'
  ), cfr_t as (select max(d) as t from cfr),
  bills as (
    select left(r.item -> 'cells' ->> 'introduced', 4)::integer as y, r.item -> 'cells' ->> 'introduced' as d
    from public.corpus_records r
    where r.dataset = 'congress_bills' and r.filters -> 'type' ->> 0 in ('hr', 's', 'hjres', 'sjres')
      and insights.iso_date(r.item -> 'cells' ->> 'introduced') >= '1789-03-04'
  ), bills_t as (select max(d) as t from bills),
  laws as (
    select left(r.item -> 'cells' ->> 'enacted', 4)::integer as y, r.item -> 'cells' ->> 'enacted' as d
    from public.corpus_records r
    where r.dataset = 'public_laws_enacted' and r.filters -> 'kind' ->> 0 = 'Public law'
      -- a date before the First Congress (a placeholder such as 0001-01-01 in the source file) is not counted
      and insights.iso_date(r.item -> 'cells' ->> 'enacted') >= '1789-03-04'
  ), laws_t as (select max(d) as t from laws),
  dump as (
    select to_char(to_date(substring(d.metadata -> 'summary' -> 'dump' ->> 'last_modified'
                                     from '^[A-Za-z]{3}, ([0-9]{2} [A-Za-z]{3} [0-9]{4}) '), 'DD Mon YYYY'), 'YYYY-MM-DD') as d
    from public.corpus_datasets d
    where d.id = 'state_bills'
      and d.metadata -> 'summary' -> 'dump' ->> 'last_modified' ~ '^[A-Za-z]{3}, [0-9]{2} [A-Za-z]{3} [0-9]{4} '
  ), sb as (
    select r.filters -> 'state' ->> 0 as st
    from public.corpus_records r
    where r.dataset = 'state_bills' and r.filters -> 'session_role' ->> 0 = 'current'
  )
  select m.metric, f.etype, f.eid, y.key, make_date(y.key::integer, 1, 1), make_date(y.key::integer, 12, 31),
         case when insights.jnum(y.value) >= 0 then insights.jnum(y.value) end, null::numeric,
         insights.year_partial(y.key::integer, f.asof), null::numeric,
         case when insights.jnum(y.value) >= 0 then null else 'Not recorded in the Federal Register facet for this year.' end
  from fr f
  cross join (values ('fr_documents', 'ALL'), ('fr_final_rules', 'RULE'), ('fr_proposed_rules', 'PRORULE')) m(metric, key)
  cross join lateral jsonb_each(insights.jobj(f.yearly -> m.key)) y
  where y.key ~ '^[0-9]{4}$'
  union all
  select 'cfr_section_versions', 'law_unit', 'cfr:' || c.title, c.y::text, make_date(c.y, 1, 1), make_date(c.y, 12, 31),
         count(*)::numeric, null::numeric, c.y = 2017 or insights.year_partial(c.y, (select t from cfr_t)), null::numeric, null::text
  from cfr c group by c.title, c.y
  union all
  select 'cfr_section_versions', 'nation', 'US', c.y::text, make_date(c.y, 1, 1), make_date(c.y, 12, 31),
         count(*)::numeric, null::numeric, c.y = 2017 or insights.year_partial(c.y, (select t from cfr_t)), null::numeric, null::text
  from cfr c group by c.y
  union all
  select 'congress_bills_introduced', 'nation', 'US', b.y::text, make_date(b.y, 1, 1), make_date(b.y, 12, 31),
         count(*)::numeric, null::numeric, insights.year_partial(b.y, (select t from bills_t)), null::numeric, null::text
  from bills b group by b.y
  union all
  select 'public_laws_enacted', 'nation', 'US', l.y::text, make_date(l.y, 1, 1), make_date(l.y, 12, 31),
         count(*)::numeric, null::numeric, insights.year_partial(l.y, (select t from laws_t)), null::numeric, null::text
  from laws l group by l.y
  union all
  select 'state_bills_current_session', 'state', g.usps, d.d, d.d::date, d.d::date, count(*)::numeric, null::numeric, false,
         null::numeric, null::text
  from sb join insights.geo_states g on g.usps = sb.st cross join dump d
  where d.d is not null
  group by g.usps, d.d
$$;

-- ------------------------------------------------------------------------------------------------ family: consumer
create or replace function insights.facts_consumer() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with cfpb as (
    select distinct on (x.etype, x.eid, (t.e ->> 'year')::integer) x.etype, x.eid, (t.e ->> 'year')::integer as y,
           case when insights.jnum(t.e -> 'complaints') >= 0 then insights.jnum(t.e -> 'complaints') end as v,
           coalesce(t.e -> 'complete' = 'true'::jsonb, false) as complete
    from (select 'state' as etype, substr(r.id, 12) as eid, r.item -> 'state_profile' -> 'years' as s, r.id as rid
          from public.corpus_records r
          where r.dataset = 'cfpb_complaints_states' and r.id ~ '^cfpb-state:[A-Z]{2}$'
            and exists (select 1 from insights.geo_states g where g.usps = substr(r.id, 12))
          union all
          select 'nation', 'US', r.item -> 'national' -> 'years', r.id
          from public.corpus_records r where r.dataset = 'cfpb_complaints_national' and r.id = 'cfpb-national:all') x
    cross join lateral jsonb_array_elements(insights.jarr(x.s)) with ordinality t(e, ord)
    where t.e ->> 'year' ~ '^[0-9]{4}$'
    order by x.etype, x.eid, (t.e ->> 'year')::integer, t.ord
  ), sentinel as (
    select left(r.id, 2) as st, substr(r.id, 4)::integer as y, r.item -> 'metrics' as m
    from public.corpus_records r
    where r.dataset = 'ftc_sentinel_states' and r.id ~ '^[A-Z]{2}-[0-9]{4}$'
      and exists (select 1 from insights.geo_states g where g.usps = left(r.id, 2))
  ), sentinel_us as (
    select substr(r.id, 4)::integer as y, r.item -> 'reports' as rep
    from public.corpus_records r where r.dataset = 'ftc_sentinel_national' and r.id ~ '^US-[0-9]{4}$'
  ), dnc as (
    select left(r.id, 2) as st, substr(r.id, 6)::integer as fy, r.item -> 'metrics' as m
    from public.corpus_records r
    where r.dataset = 'ftc_dnc_states' and r.id ~ '^[A-Z]{2}-FY[0-9]{4}$'
      and exists (select 1 from insights.geo_states g where g.usps = left(r.id, 2))
  ), pop as (select * from insights.population())
  select 'cfpb_complaints', c.etype, c.eid, c.y::text, make_date(c.y, 1, 1), make_date(c.y, 12, 31), c.v, null::numeric,
         not c.complete, null::numeric,
         case when c.v is null then 'Not recorded in the CFPB tally for this year.' end
  from cfpb c
  union all
  select 'cfpb_complaints_per_100k', c.etype, c.eid, c.y::text, make_date(c.y, 1, 1), make_date(c.y, 12, 31),
         insights.per_100k(c.v, p.pop), null::numeric, not c.complete, c.v,
         case when c.v is null then 'Not recorded in the CFPB tally for this year.'
              when p.pop is null then 'No Census population estimate for this geography and year.' end
  from cfpb c left join pop p on p.entity_type = c.etype and p.entity_id = c.eid and p.year = c.y
  union all
  select m.metric, 'state', s.st, s.y::text, make_date(s.y, 1, 1), make_date(s.y, 12, 31),
         case when insights.jnum(s.m -> m.key) >= 0 then insights.jnum(s.m -> m.key) end, null::numeric, false, null::numeric,
         case when insights.jnum(s.m -> m.key) >= 0 then null else 'Not printed in the Data Book state table for this year.' end
  from sentinel s
  cross join (values ('ftc_sentinel_fraud_other_reports', 'fraud_other_reports'),
                     ('ftc_sentinel_identity_theft_reports', 'identity_theft_reports')) m(metric, key)
  union all
  select 'ftc_sentinel_fraud_other_per_100k', 'state', s.st, s.y::text, make_date(s.y, 1, 1), make_date(s.y, 12, 31),
         insights.per_100k(case when insights.jnum(s.m -> 'fraud_other_reports') >= 0 then insights.jnum(s.m -> 'fraud_other_reports') end, p.pop),
         null::numeric, false,
         case when insights.jnum(s.m -> 'fraud_other_reports') >= 0 then insights.jnum(s.m -> 'fraud_other_reports') end,
         case when coalesce(insights.jnum(s.m -> 'fraud_other_reports') >= 0, false) = false
                then 'Not printed in the Data Book state table for this year.'
              when p.pop is null then 'No Census population estimate for this geography and year.' end
  from sentinel s left join pop p on p.entity_type = 'state' and p.entity_id = s.st and p.year = s.y
  union all
  select 'ftc_sentinel_reports', 'nation', 'US', u.y::text, make_date(u.y, 1, 1), make_date(u.y, 12, 31),
         case when insights.jnum(u.rep -> 'total') >= 0 then insights.jnum(u.rep -> 'total') end, null::numeric, false,
         null::numeric,
         case when insights.jnum(u.rep -> 'total') >= 0 then null else 'Not printed in the Data Book for this year.' end
  from sentinel_us u
  union all
  select 'ftc_dnc_complaints', 'state', d.st, 'FY' || d.fy, insights.fy_start(d.fy), insights.fy_end(d.fy),
         case when insights.jnum(d.m -> 'complaints') >= 0 then insights.jnum(d.m -> 'complaints') end, null::numeric, false,
         null::numeric,
         case when insights.jnum(d.m -> 'complaints') >= 0 then null else 'Not printed in the Data Book state table for this year.' end
  from dnc d
  union all
  select 'ftc_dnc_complaints_per_100k', 'state', d.st, 'FY' || d.fy, insights.fy_start(d.fy), insights.fy_end(d.fy),
         insights.per_100k(case when insights.jnum(d.m -> 'complaints') >= 0 then insights.jnum(d.m -> 'complaints') end, p.pop),
         null::numeric, false,
         case when insights.jnum(d.m -> 'complaints') >= 0 then insights.jnum(d.m -> 'complaints') end,
         case when coalesce(insights.jnum(d.m -> 'complaints') >= 0, false) = false
                then 'Not printed in the Data Book state table for this year.'
              when p.pop is null then 'No Census population estimate for this geography and year.' end
  from dnc d left join pop p on p.entity_type = 'state' and p.entity_id = d.st and p.year = d.fy
$$;

-- ------------------------------------------------------------------------------------------------ refresh
-- Run one family: stage, validate, merge, inside a subtransaction; the run row records the outcome either way.
create or replace function insights.run_family(p_family text, p_trigger text default 'manual') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_run bigint; v_res jsonb; v_err text; v_state text;
begin
  if not exists (select 1 from insights.families f where f.id = p_family) then
    raise exception 'Unknown insights family %', p_family using errcode = '22023';
  end if;
  insert into insights.runs (family, trigger) values (p_family, left(coalesce(p_trigger, 'manual'), 80)) returning id into v_run;
  begin
    if p_family = 'entities' then
      perform insights.stage_entities();
      v_res := insights.entities_commit();
    else
      perform insights.stage_open();
      execute format('insert into pg_temp.insights_stage select * from insights.%I()', 'facts_' || p_family);
      v_res := insights.stage_commit(p_family);
    end if;
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    update insights.runs set status = 'failed', finished_at = clock_timestamp(), error = left(v_state || ': ' || v_err, 2000)
      where id = v_run;
    return jsonb_build_object('family', p_family, 'run', v_run, 'status', 'failed', 'error', v_err);
  end;
  update insights.runs set status = 'succeeded', finished_at = clock_timestamp(), staged = (v_res ->> 'staged')::integer,
      inserted = (v_res ->> 'inserted')::integer, updated = (v_res ->> 'updated')::integer,
      deleted = (v_res ->> 'deleted')::integer, unchanged = (v_res ->> 'unchanged')::integer
    where id = v_run;
  return jsonb_build_object('family', p_family, 'run', v_run, 'status', 'succeeded') || v_res;
end $$;

create or replace function insights.refresh_entities(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('entities', p_trigger) $$;
create or replace function insights.refresh_places(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('places', p_trigger) $$;
create or replace function insights.refresh_courts_fjc(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('courts_fjc', p_trigger) $$;
create or replace function insights.refresh_courts_tables(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('courts_tables', p_trigger) $$;
create or replace function insights.refresh_judiciary(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('judiciary', p_trigger) $$;
create or replace function insights.refresh_mdl(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('mdl', p_trigger) $$;
create or replace function insights.refresh_caselaw(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('caselaw', p_trigger) $$;
create or replace function insights.refresh_enforcement(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('enforcement', p_trigger) $$;
create or replace function insights.refresh_safety(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('safety', p_trigger) $$;
create or replace function insights.refresh_companies(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('companies', p_trigger) $$;
create or replace function insights.refresh_government(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('government', p_trigger) $$;
create or replace function insights.refresh_consumer(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('consumer', p_trigger) $$;

-- Every family in order (the entity spine first). One family's failure is recorded and does not stop the others.
create or replace function insights.refresh_all(p_trigger text default 'manual') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f record; v_runs jsonb := '[]'; v_res jsonb; v_failed integer := 0;
begin
  for f in select id from insights.families order by ordinal, id loop
    v_res := insights.run_family(f.id, p_trigger);
    if v_res ->> 'status' <> 'succeeded' then v_failed := v_failed + 1; end if;
    v_runs := v_runs || jsonb_build_array(v_res);
  end loop;
  return jsonb_build_object('status', case when v_failed = 0 then 'succeeded'
                                           when v_failed = jsonb_array_length(v_runs) then 'failed' else 'partial' end,
                            'failed', v_failed, 'runs', v_runs);
end $$;

-- Refresh only the families that read the given corpus datasets (exact ids or the families' LIKE patterns), in family
-- order; the entity spine runs first whenever one of its source datasets is named. Called by the scheduled ingestion
-- after new records land.
create or replace function insights.refresh_for_datasets(p_datasets text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f record; v_runs jsonb := '[]'; v_res jsonb; v_failed integer := 0; v_matched text[] := '{}'; v_unmatched text[];
begin
  if p_datasets is null or cardinality(p_datasets) = 0 or cardinality(p_datasets) > 500 then
    raise exception 'Give between 1 and 500 dataset ids' using errcode = '22023';
  end if;
  for f in
    select fam.id from insights.families fam
    where fam.datasets && p_datasets
       or exists (select 1 from unnest(fam.dataset_patterns) pat cross join unnest(p_datasets) d where d like pat)
    order by fam.ordinal, fam.id
  loop
    v_matched := v_matched || f.id;
    v_res := insights.run_family(f.id, 'datasets');
    if v_res ->> 'status' <> 'succeeded' then v_failed := v_failed + 1; end if;
    v_runs := v_runs || jsonb_build_array(v_res);
  end loop;
  v_unmatched := array(select d from unnest(p_datasets) d
                       where not exists (select 1 from insights.families fam where d = any (fam.datasets)
                                           or exists (select 1 from unnest(fam.dataset_patterns) pat where d like pat))
                       order by d);
  return jsonb_build_object('status', case when cardinality(v_matched) = 0 then 'nothing_to_refresh'
                                           when v_failed = 0 then 'succeeded'
                                           when v_failed = cardinality(v_matched) then 'failed' else 'partial' end,
                            'families', to_jsonb(v_matched), 'unmatched_datasets', to_jsonb(v_unmatched),
                            'failed', v_failed, 'runs', v_runs);
end $$;

-- the same, callable through PostgREST by the service role (the ingestion edge functions)
create or replace function public.insights_refresh_for_datasets_v1(p_datasets text[]) returns jsonb
language sql security definer set search_path = '' as $$ select insights.refresh_for_datasets(p_datasets) $$;

-- ------------------------------------------------------------------------------------------------ read RPCs
-- the contract shapes (snake_case) of a fact row and an entity row, given as to_jsonb(row)
create or replace function insights.fact_json(f jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('metric_id', f -> 'metric_id', 'entity_type', f -> 'entity_type', 'entity_id', f -> 'entity_id',
    'period', f -> 'period', 'period_start', f -> 'period_start', 'period_end', f -> 'period_end', 'value', f -> 'value',
    'moe', f -> 'moe', 'partial', f -> 'partial', 'n', f -> 'n', 'not_recorded_reason', f -> 'not_recorded_reason')
$$;

create or replace function insights.entity_json(e jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('type', e -> 'entity_type', 'id', e -> 'entity_id', 'label', e -> 'label',
    'parent', case when e ->> 'parent_type' is null then 'null'::jsonb
                   else jsonb_build_object('type', e -> 'parent_type', 'id', e -> 'parent_id') end,
    'keys', e -> 'keys', 'href', e -> 'href')
$$;

create or replace function insights.check_metric(p_metric text, p_entity_type text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_metric is null or not exists (select 1 from insights.metrics m where m.id = p_metric) then
    raise exception 'Unknown metric' using errcode = '22023';
  end if;
  if p_entity_type is not null and not exists (select 1 from insights.metrics m where m.id = p_metric
                                               and p_entity_type = any (m.entity_types)) then
    raise exception 'The metric has no facts for this entity type' using errcode = '22023';
  end if;
end $$;

create or replace function public.insights_catalog_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'label', m.label, 'description', m.description, 'unit', m.unit, 'format', m.format, 'topic', m.topic,
      'entity_types', to_jsonb(m.entity_types), 'period_type', m.period_type, 'source_datasets', to_jsonb(m.source_datasets),
      'source_links', m.source_links, 'numerator', m.numerator, 'denominator', m.denominator, 'method', m.method,
      'caveats', to_jsonb(m.caveats), 'direction', m.direction,
      'coverage', jsonb_build_object('from', m.coverage_from, 'to', m.coverage_to, 'entities', m.coverage_entities,
                                     'facts', m.coverage_facts),
      'refreshed_at', m.refreshed_at) order by m.ordinal, m.id), '[]'::jsonb)
  from insights.metrics m
$$;

-- one metric's facts for some (or, with p_entity_ids null, all) entities of a type, oldest period first
create or replace function public.insights_series_v1(p_metric text, p_entity_type text, p_entity_ids text[] default null,
  p_from text default null, p_to text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_n integer; v_out jsonb;
begin
  perform insights.check_metric(p_metric, p_entity_type);
  if p_entity_type is null then raise exception 'Give an entity type' using errcode = '22023'; end if;
  if p_entity_ids is not null and cardinality(p_entity_ids) > 500 then
    raise exception 'At most 500 entity ids' using errcode = '22023';
  end if;
  select count(*) into v_n from insights.facts f
    where f.metric_id = p_metric and f.entity_type = p_entity_type
      and (p_entity_ids is null or f.entity_id = any (p_entity_ids))
      and (p_from is null or f.period >= p_from) and (p_to is null or f.period <= p_to);
  if v_n > 50000 then raise exception 'More than 50,000 facts; narrow the entities or periods' using errcode = '54000'; end if;
  select coalesce(jsonb_agg(insights.fact_json(to_jsonb(f)) order by f.entity_id, f.period), '[]'::jsonb) into v_out
  from insights.facts f
  where f.metric_id = p_metric and f.entity_type = p_entity_type
    and (p_entity_ids is null or f.entity_id = any (p_entity_ids))
    and (p_from is null or f.period >= p_from) and (p_to is null or f.period <= p_to);
  return v_out;
end $$;

-- one period, every entity of the type
create or replace function public.insights_snapshot_v1(p_metric text, p_entity_type text, p_period text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform insights.check_metric(p_metric, p_entity_type);
  if p_entity_type is null or p_period is null then raise exception 'Give an entity type and a period' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(insights.fact_json(to_jsonb(f)) order by f.entity_id), '[]'::jsonb)
          from insights.facts f where f.metric_id = p_metric and f.entity_type = p_entity_type and f.period = p_period);
end $$;

-- each entity's latest complete period that has a value
create or replace function public.insights_latest_v1(p_metric text, p_entity_type text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform insights.check_metric(p_metric, p_entity_type);
  if p_entity_type is null then raise exception 'Give an entity type' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(insights.fact_json(to_jsonb(l)) order by l.entity_id), '[]'::jsonb)
          from (select distinct on (f.entity_id) f.*
                from insights.facts f
                where f.metric_id = p_metric and f.entity_type = p_entity_type and not f.partial and f.value is not null
                order by f.entity_id, f.period_end desc, f.period desc) l);
end $$;

-- paired values of two metrics for the same entities (complete periods with values only)
create or replace function public.insights_cross_v1(p_metric_x text, p_metric_y text, p_entity_type text, p_period_x text,
  p_period_y text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform insights.check_metric(p_metric_x, p_entity_type);
  perform insights.check_metric(p_metric_y, p_entity_type);
  if p_entity_type is null or p_period_x is null or p_period_y is null then
    raise exception 'Give an entity type and both periods' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('entity_id', x.entity_id, 'label', e.label, 'x', x.value,
                                                       'y', y.value, 'period_x', x.period, 'period_y', y.period)
                                    order by x.entity_id), '[]'::jsonb)
          from insights.facts x
          join insights.facts y on y.metric_id = p_metric_y and y.entity_type = x.entity_type and y.entity_id = x.entity_id
                               and y.period = p_period_y and y.value is not null and not y.partial
          join insights.entities e on e.entity_type = x.entity_type and e.entity_id = x.entity_id
          where x.metric_id = p_metric_x and x.entity_type = p_entity_type and x.period = p_period_x
            and x.value is not null and not x.partial);
end $$;

-- an entity, its latest complete fact of every metric, and its children; {"entity": null, "facts": [], "children": []}
-- when the entity is not in the spine (an explicit answer, so a caller can tell it from a missing function)
create or replace function public.insights_entity_v1(p_type text, p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
    'entity', insights.entity_json(to_jsonb(e)),
    'facts', (select coalesce(jsonb_agg(insights.fact_json(to_jsonb(l)) order by m.ordinal, l.metric_id), '[]'::jsonb)
              from (select distinct on (f.metric_id) f.*
                    from insights.facts f
                    where f.entity_type = e.entity_type and f.entity_id = e.entity_id and not f.partial and f.value is not null
                    order by f.metric_id, f.period_end desc, f.period desc) l
              join insights.metrics m on m.id = l.metric_id),
    'children', (select coalesce(jsonb_agg(insights.entity_json(to_jsonb(c)) order by c.entity_type, c.label, c.entity_id), '[]'::jsonb)
                 from (select * from insights.entities c0 where c0.parent_type = e.entity_type and c0.parent_id = e.entity_id
                       order by c0.entity_type, c0.label, c0.entity_id limit 2000) c))
    from insights.entities e where e.entity_type = p_type and e.entity_id = p_id),
    jsonb_build_object('entity', null, 'facts', '[]'::jsonb, 'children', '[]'::jsonb))
$$;

-- links from or to an entity (optionally one relation), at most p_limit (1-1000)
create or replace function public.insights_links_v1(p_type text, p_id text, p_relation text default null,
  p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_type is null or p_id is null then raise exception 'Give an entity type and id' using errcode = '22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'Limit must be 1 to 1000' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
              'from', jsonb_build_object('type', l.from_type, 'id', l.from_id),
              'to', jsonb_build_object('type', l.to_type, 'id', l.to_id),
              'relation', l.relation, 'evidence', l.evidence, 'source_dataset', l.source_dataset,
              'source_record_id', l.source_record_id) order by l.relation, l.from_type, l.from_id, l.to_type, l.to_id,
              l.source_dataset, l.source_record_id), '[]'::jsonb)
          from (select * from insights.links k
                where ((k.from_type = p_type and k.from_id = p_id) or (k.to_type = p_type and k.to_id = p_id))
                  and (p_relation is null or k.relation = p_relation)
                order by k.relation, k.from_type, k.from_id, k.to_type, k.to_id, k.source_dataset, k.source_record_id
                limit p_limit) l);
end $$;

-- ------------------------------------------------------------------------------------------------ grants
do $grants$
declare f record;
begin
  -- every function of the insights schema: service role only
  for f in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'insights' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  for f in select unnest(array[
      'public.insights_catalog_v1()', 'public.insights_series_v1(text,text,text[],text,text)',
      'public.insights_snapshot_v1(text,text,text)', 'public.insights_latest_v1(text,text)',
      'public.insights_cross_v1(text,text,text,text,text)', 'public.insights_entity_v1(text,text)',
      'public.insights_links_v1(text,text,text,integer)', 'public.insights_refresh_for_datasets_v1(text[])']) as sig loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $grants$;

-- ------------------------------------------------------------------------------------------------ pg_cron (helpers)
-- Defined here, called by the lead only (see the section after COMMIT). Plpgsql resolves cron.* at call time, so this
-- file loads where pg_cron is not installed.
create or replace function insights.schedule_nightly(p_schedule text default '23 6 * * *') returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_job bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed in this database' using errcode = '55000';
  end if;
  execute 'select cron.schedule($1, $2, $3)' into v_job
    using 'insights-refresh-all', p_schedule, 'select insights.refresh_all(''cron'')';
  return v_job;
end $$;

create or replace function insights.unschedule_nightly() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return false; end if;
  execute 'select cron.unschedule($1)' into v_ok using 'insights-refresh-all';
  return v_ok;
end $$;
revoke all on function insights.schedule_nightly(text) from public, anon, authenticated, service_role;
revoke all on function insights.unschedule_nightly() from public, anon, authenticated, service_role;

comment on schema insights is 'Insights metric layer (insights/1): metric registry, facts computed in the database from corpus records by tested refresh functions, entity spine with exact links, refresh ledger. Contract: src/lib/insights/contract.ts.';

commit;

-- =====================================================================================================================
-- PG_CRON SECTION — for the lead to apply deliberately, after this file and a successful
--   select insights.refresh_all('initial');
-- Schedules the nightly refresh of every family at 06:23 UTC (a jittered minute, off the hour). Re-running replaces the
-- job of the same name (cron.schedule upserts by job name).
--
--   select insights.schedule_nightly('23 6 * * *');
--
-- To remove it:  select insights.unschedule_nightly();
-- Runs are recorded in insights.runs (family, trigger 'cron', status, counts, error).
-- =====================================================================================================================
