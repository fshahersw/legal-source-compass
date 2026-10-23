-- citations/2 nightly extraction (pg_cron + pg_net). Apply after database/contracts/citations-v2.sql and after the
-- edge function is deployed; kept apart from the contract file because the offline PGlite test has no scheduler.
--
-- documents-nightly (documents-v1-schedule.sql, 05:41 UTC) indexes the day's new filings; from 06:13 UTC this job posts
-- six times, 20 minutes apart, to supabase/functions/ingest-citations. Each invocation extracts byte sets that still
-- have a page not read at the current extractor version (newest first) for about 1.2 s of CPU (the edge runtime's limit
-- is about 2 s per request), loads them, resolves the new authority keys and relinks the loaded documents; a run that
-- stops at its budget ends 'partial' and the next invocation continues. Runs: select * from citations.runs order by
-- started_at desc limit 20;   Status: select public.citations_status_v2();
--
-- Deployment (lead; project xosqzzsnhxcyehcnirpa):
--   1. apply database/contracts/citations-v2.sql (and the lookup indexes and full load: RUNBOOK in
--      docs/citations-v2-2026-10-25.md);
--   2. supabase functions deploy ingest-citations --project-ref xosqzzsnhxcyehcnirpa --no-verify-jwt
--      (it imports src/lib/citations and src/lib/ingest; if the bundler refuses, deploy the copy written by
--      node scripts/ingest/bundle_functions.mjs <dir>);
--   3. first run from SQL (the trigger secret stays in the database):
--      select net.http_post(url := 'https://xosqzzsnhxcyehcnirpa.supabase.co/functions/v1/ingest-citations',
--        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
--          (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_cron_secret')),
--        body := jsonb_build_object('trigger', 'manual'), timeout_milliseconds := 10000);
--   4. apply this file (after insights-citations-v1.sql if the insights family is wanted). Re-applying replaces the
--      jobs; select cron.unschedule('citations-nightly'); and cron.unschedule('citations-insights-nightly') remove them.
do $schedule$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'citations schedule not installed: pg_cron and pg_net must both be enabled; apply this file again afterwards';
    return;
  end if;
  if to_regprocedure('public.citations_open_run_v2(text,text,text)') is null then
    raise notice 'citations schedule not installed: apply database/contracts/citations-v2.sql first';
    return;
  end if;
  perform cron.schedule('citations-nightly', '13,33,53 6,7 * * *', $cmd$
select net.http_post(
  url := 'https://xosqzzsnhxcyehcnirpa.supabase.co/functions/v1/ingest-citations',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_cron_secret')),
  body := jsonb_build_object('trigger', 'schedule'),
  timeout_milliseconds := 10000)
where not exists (select 1 from citations.runs where kind = 'nightly' and status = 'running' and started_at > now() - interval '3 hours')$cmd$);
  -- the insights family 'citations' (insights-citations-v1.sql), after the last nightly invocation
  if to_regprocedure('insights.refresh_citations(text)') is not null then
    perform cron.schedule('citations-insights-nightly', '17 8 * * *', $cmd$select insights.refresh_citations('schedule')$cmd$);
  end if;
end $schedule$;
