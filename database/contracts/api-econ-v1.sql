-- api-econ/1 (wave 1025): the self-updating FRED sources of the economic datasets.
--
-- Registers two ingest/1 sources (database/contracts/ingest-v1.sql must be applied first) served by one edge function,
-- supabase/functions/ingest-fred (logic and tests: src/lib/ingest/sources/fred.ts):
--   fred_observations → econ_fred_observations  one row per FRED series and calendar year (observations + vintages)
--   fred_series       → econ_fred_series        one row per series (metadata as published, latest observation)
-- Both write only through public.ingest_upsert_v1 with the checks of ingest-v1.sql (id pattern, category, no
-- credential in any URL). The observations source runs first; the series source restates the latest observation from
-- the stored observation rows half an hour later.
--
-- The other api-econ datasets (econ_nchs_life_tables, econ_ssa_awi, econ_bls_cpi_areas, econ_bls_oews,
-- company_federal_awards, census_acs_cvap_counties, econ_state_judgment_rates) change once a year or less and are
-- rebuilt by their builders in scripts/api_econ (RUNBOOK in docs/api-econ-2026-10-25.md); they have no scheduled source.
--
-- Deployment (lead; project xosqzzsnhxcyehcnirpa):
--   1. publish the full builds of econ_fred_series and econ_fred_observations (private/scratch/enrich/publish_build.py);
--      ingest_open_run_v1 refuses a source whose dataset is not in the catalog.
--   2. apply this file (idempotent; the sources stay disabled until step 5).
--   3. function secret FRED_API_KEY (dashboard → Edge Functions → Secrets), then from the repository root:
--        supabase functions deploy ingest-fred --project-ref xosqzzsnhxcyehcnirpa --no-verify-jwt
--      (or deploy the self-contained copy from node scripts/ingest/bundle_functions.mjs <dir>).
--   4. first runs from SQL, observations first (the trigger secret never leaves the database):
--        select net.http_post(url := 'https://xosqzzsnhxcyehcnirpa.supabase.co/functions/v1/ingest-fred',
--          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
--            (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_cron_secret')),
--          body := jsonb_build_object('source', 'fred_observations', 'trigger', 'manual'), timeout_milliseconds := 10000);
--      then the same with 'fred_series'; check ingest.runs.
--   5. update ingest.sources set enabled = true where id in ('fred_observations', 'fred_series'); then apply this file
--      again (or ingest-v1.sql, whose section 9 schedules every source) to install the cron jobs.
-- Offline test: scripts/api_econ/api-econ-contract.test.mjs (pglite).

begin;

insert into ingest.sources as s (id, dataset, label, publisher, source_url, function_name, schedule, stale_after, mode,
  ordinal_policy, category, id_pattern, catalog, terms_note, rate_note)
values
  ('fred_observations', 'econ_fred_observations', 'FRED observations by series and year',
   'Federal Reserve Bank of St. Louis (FRED/ALFRED); data from the Federal Reserve Board, BLS and BEA',
   'https://fred.stlouisfed.org/docs/api/fred/', 'ingest-fred', '17 11,22 * * *', interval '4 days', 'upsert', 'append',
   'econ_fred_observations', '^fred:[A-Z0-9]{2,30}:[0-9]{4}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'FRED API Terms of Use (https://fred.stlouisfed.org/docs/api/terms_of_use.html): the notice "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." is shown with the data; series whose FRED notes say "Copyright" are refused. The series are U.S. government data (Federal Reserve H.15, BLS, BEA).',
   'FRED allows 120 requests a minute per key; requests 0.6 s apart, at most 60 per run (release-date checks first, then the series whose release published since they were last read; the rest stay due for the next run).'),
  ('fred_series', 'econ_fred_series', 'FRED series metadata and latest observation',
   'Federal Reserve Bank of St. Louis (FRED); data from the Federal Reserve Board, BLS and BEA',
   'https://fred.stlouisfed.org/docs/api/fred/', 'ingest-fred', '47 11,22 * * *', interval '4 days', 'upsert', 'append',
   'econ_fred_series', '^fred:[A-Z0-9]{2,30}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0, "series": 0}}',
   'FRED API Terms of Use (https://fred.stlouisfed.org/docs/api/terms_of_use.html); see fred_observations.',
   'Requests 0.6 s apart, at most 42 per run: the metadata of 30 series in rotation (every series every few days); latest observations are read from the stored rows.')
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

-- ------------------------------------------------------------------------------------------------ schedule (LEAD)
-- Same pattern as ingest-v1.sql section 9, for these two sources only: installed when pg_cron and pg_net are both
-- present; a job posts only while its source is enabled; re-running replaces the jobs in place.
do $schedule$
declare s record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'fred schedule not installed: pg_cron and pg_net must both be enabled; apply this file again afterwards';
    return;
  end if;
  for s in select id, function_name, schedule from ingest.sources where id in ('fred_observations', 'fred_series') order by id loop
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
