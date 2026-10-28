-- census/1 (2026-10-28): Census Bureau sources as self-updating ingest/1 sources.
--
-- Registers four sources (database/contracts/ingest-v1.sql must be applied first) served by one edge function,
-- supabase/functions/ingest-census (logic and tests: src/lib/ingest/sources/{censusGovUnits,censusBtos,censusModeled}.ts,
-- workbook reader src/lib/ingest/xlsx.ts):
--   census_gov_units   → census_gov_units   Government Units List (Census of Governments): every county, municipal and
--                                           township government, special district, school district, dependent school
--                                           system and public pension system, one row per county and category (plus
--                                           statewide rows for units listed without a county). Eight parts on
--                                           consecutive runs, so the schedule runs it on eight days a month.
--   census_btos_states → census_btos_states Business Trends and Outlook Survey indexes and AI-use / weather-loss shares,
--                                           every two-week period, for the nation and each state.
--   census_saipe       → census_saipe       SAIPE poverty and median household income, nation, states, counties,
--                                           1989 onward (two parts: state FIPS 01-29, 30-56).
--   census_sahie       → census_sahie       SAHIE health insurance (under 65), nation, states, counties, 2006 onward.
-- All public domain (U.S. Census Bureau). SAIPE and SAHIE need the function secret CENSUS_API_KEY; until it is set
-- their runs answer "missing function secrets" and write nothing.
--
-- Deployment (project xosqzzsnhxcyehcnirpa):
--   1. apply this file (idempotent): catalog entries (empty until the first run) and the sources, enabled.
--   2. deploy ingest-census with --no-verify-jwt (or the self-contained copy from
--      node scripts/safety_v2/bundle_functions.mjs <dir> ingest-census).
--   3. set the function secret CENSUS_API_KEY (Supabase dashboard, Edge Functions, Secrets).
--   4. apply this file again after the deploy if pg_cron or pg_net were missing the first time.

begin;

with entries(id, label, columns, summary) as (values
  ('census_gov_units', 'Census Government Units List: local governments, special districts, school districts and public pension systems by county',
   jsonb_build_array(
     jsonb_build_object('key', 'area', 'label', 'County or state'),
     jsonb_build_object('key', 'category', 'label', 'Category'),
     jsonb_build_object('key', 'units', 'label', 'Units'),
     jsonb_build_object('key', 'county_population', 'label', 'County population'),
     jsonb_build_object('key', 'enrollment', 'label', 'Enrollment'),
     jsonb_build_object('key', 'edition', 'label', 'Edition')),
   jsonb_build_object(
     'source', 'U.S. Census Bureau, Government Units List (Census of Governments / Government Units Survey), annual workbook',
     'meaning', 'Every government unit the Census Bureau lists, with mailing address, website, contact title as printed and population or enrollment. A unit serving several counties appears once, under the county the file gives it. The file names no individuals.')),
  ('census_btos_states', 'Census Business Trends and Outlook Survey: nation and states',
   jsonb_build_array(
     jsonb_build_object('key', 'area', 'label', 'Area'),
     jsonb_build_object('key', 'latest_collection_end', 'label', 'Collected through'),
     jsonb_build_object('key', 'current_performance', 'label', 'Current performance index'),
     jsonb_build_object('key', 'future_performance', 'label', 'Future performance index'),
     jsonb_build_object('key', 'ai_use_pct', 'label', 'Businesses using AI (%)')),
   jsonb_build_object(
     'source', 'U.S. Census Bureau, Business Trends and Outlook Survey (experimental data product), National.xlsx and State.xlsx downloads',
     'meaning', 'Indexes run 0 to 100 (increased or excellent 100, no change or average 50, decreased or poor 0); 50 is balanced. Shares are percent of employer businesses. Suppressed estimates stay empty.')),
  ('census_saipe', 'Census Small Area Income and Poverty Estimates (SAIPE): nation, states and counties',
   jsonb_build_array(
     jsonb_build_object('key', 'area', 'label', 'Area'),
     jsonb_build_object('key', 'latest_year', 'label', 'Latest year'),
     jsonb_build_object('key', 'poverty_rate', 'label', 'Poverty rate (%)'),
     jsonb_build_object('key', 'child_poverty_rate', 'label', 'Child poverty rate (%)'),
     jsonb_build_object('key', 'median_household_income', 'label', 'Median household income (USD)')),
   jsonb_build_object(
     'source', 'U.S. Census Bureau, Small Area Income and Poverty Estimates (api.census.gov timeseries/poverty/saipe)',
     'meaning', 'Model-based annual estimates with 90% margins of error, 1989 onward as published. Not the ACS figures in county profiles.')),
  ('census_sahie', 'Census Small Area Health Insurance Estimates (SAHIE): nation, states and counties',
   jsonb_build_array(
     jsonb_build_object('key', 'area', 'label', 'Area'),
     jsonb_build_object('key', 'latest_year', 'label', 'Latest year'),
     jsonb_build_object('key', 'uninsured_rate', 'label', 'Uninsured under 65 (%)'),
     jsonb_build_object('key', 'uninsured_count', 'label', 'People uninsured under 65')),
   jsonb_build_object(
     'source', 'U.S. Census Bureau, Small Area Health Insurance Estimates (api.census.gov timeseries/healthins/sahie)',
     'meaning', 'Model-based annual estimates for people under 65, all incomes, both sexes, all races, with 90% margins of error. Not the ACS figures in county profiles.'))
)
insert into public.corpus_datasets as d (id, label, ready, expected_records, imported_records, metadata)
select id, label, true, 0, 0, jsonb_build_object(
  'id', id, 'label', label, 'ready', true,
  'listing', jsonb_build_object('page', 1, 'limit', 50, 'total', 0, 'columns', columns,
    'filters', jsonb_build_array(jsonb_build_object('name', 'q', 'type', 'search', 'label', 'Search'))),
  'summary', summary || jsonb_build_object('published_by', 'ingest/1 ' || id))
from entries
on conflict (id) do update set label = excluded.label,
  metadata = excluded.metadata || jsonb_build_object('listing',
    (excluded.metadata -> 'listing') || jsonb_build_object('total', d.imported_records)),
  updated_at = now()
where d.label is distinct from excluded.label
   or (d.metadata - 'listing') is distinct from (excluded.metadata - 'listing')
   or ((d.metadata -> 'listing') - 'total') is distinct from ((excluded.metadata -> 'listing') - 'total');

insert into ingest.sources as s (id, dataset, label, publisher, source_url, function_name, schedule, stale_after, mode,
  ordinal_policy, category, id_pattern, catalog, terms_note, rate_note, enabled)
values
  ('census_gov_units', 'census_gov_units', 'Census Government Units List', 'U.S. Census Bureau',
   'https://www.census.gov/programs-surveys/gus.html', 'ingest-census', '23 8 1-8 * *', interval '45 days', 'upsert', 'append',
   'census_gov_units', '^govunits:[0-9]{2}([0-9]{3})?:(general|special|schools|pensions)$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'Census Bureau data are public domain.',
   'Three requests a run (datasets index, year folder, workbook ZIP); one of eight parts a run, days 1-8 each month.', true),
  ('census_btos_states', 'census_btos_states', 'Census Business Trends and Outlook Survey', 'U.S. Census Bureau',
   'https://www.census.gov/hfp/btos/data', 'ingest-census', '29 9 * * 5', interval '21 days', 'upsert', 'append',
   'census_btos_states', '^btos:[A-Z]{2}$', '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'Census Bureau data are public domain.', 'Two requests a run (National.xlsx, State.xlsx), weekly; BTOS publishes every two weeks.', true),
  ('census_saipe', 'census_saipe', 'Census Small Area Income and Poverty Estimates', 'U.S. Census Bureau',
   'https://www.census.gov/programs-surveys/saipe.html', 'ingest-census', '41 9 10,11 * *', interval '45 days', 'upsert', 'append',
   'census_saipe', '^saipe:(US|[0-9]{2}|[0-9]{5})$', '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'Census Bureau data are public domain; api.census.gov with an API key.',
   'About 34 requests a run (nation, states, one county call per published year), two parts on days 10 and 11 each month.', true),
  ('census_sahie', 'census_sahie', 'Census Small Area Health Insurance Estimates', 'U.S. Census Bureau',
   'https://www.census.gov/programs-surveys/sahie.html', 'ingest-census', '47 9 12 * *', interval '45 days', 'upsert', 'append',
   'census_sahie', '^sahie:(US|[0-9]{2}|[0-9]{5})$', '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'Census Bureau data are public domain; api.census.gov with an API key.',
   'About 21 requests a run (nation, states, one county call per published year), monthly on day 12.', true)
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

commit;

-- ------------------------------------------------------------------------------------------------ schedule
do $schedule$
declare s record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'census schedule not installed: pg_cron and pg_net must both be enabled; apply this file again afterwards';
    return;
  end if;
  for s in select id, function_name, schedule from ingest.sources
           where id in ('census_gov_units', 'census_btos_states', 'census_saipe', 'census_sahie') order by id loop
    perform cron.schedule('ingest-' || replace(s.id, '_', '-'), s.schedule, format($cmd$
select net.http_post(
  url := 'https://xosqzzsnhxcyehcnirpa.supabase.co/functions/v1/%1$s',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_cron_secret')),
  body := jsonb_build_object('source', %2$L, 'trigger', 'schedule'),
  timeout_milliseconds := 10000)
where exists (select 1 from ingest.sources where id = %2$L and enabled)$cmd$, s.function_name, s.id));
  end loop;
end $schedule$;
