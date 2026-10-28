-- company-prices/1 (2026-10-28): daily share prices of the SEC registrants on the company pages.
--
-- Registers one ingest/1 source (database/contracts/ingest-v1.sql must be applied first), served by the edge function
-- supabase/functions/ingest-company-ir (logic and tests: src/lib/ingest/sources/companyPrices.ts):
--   company_price_history → company_price_history   one row per registrant (px:<CIK>): ten years of daily closes of
--                                                    the listed common stock (split-adjusted), the latest close, the
--                                                    close a year earlier and the 52-week range restated from them
-- Targets are the registrants of company_sec_statements with a ticker and exchange in their SEC profile. Writes only
-- through public.ingest_upsert_v1 with the checks of ingest-v1.sql (id pattern, category, no credential in any URL).
-- The price provider is recorded in the run ledger only; it is not named in UI text or published data (owner decision
-- 2026-10-28, AGENTS.md). Each row's source_url is the listing exchange's quote page for the ticker.
--
-- Deployment (project xosqzzsnhxcyehcnirpa):
--   1. apply this file (idempotent): it adds the catalog entry (empty until the first run) and the source, enabled
--      (no key is needed).
--   2. deploy ingest-company-ir (it serves company_ir_kpis, company_sec_cover_facts and company_price_history).
--   3. apply this file again after the deploy if pg_cron or pg_net were missing the first time.

begin;

insert into public.corpus_datasets as d (id, label, ready, expected_records, imported_records, metadata)
values
  ('company_price_history', 'Daily share prices of the registrants on the company pages', true, 0, 0,
   jsonb_build_object(
     'id', 'company_price_history',
     'label', 'Daily share prices of the registrants on the company pages',
     'ready', true,
     'listing', jsonb_build_object('page', 1, 'limit', 50, 'total', 0,
       'columns', jsonb_build_array(
         jsonb_build_object('key', 'company', 'label', 'Company'),
         jsonb_build_object('key', 'ticker', 'label', 'Ticker'),
         jsonb_build_object('key', 'exchange', 'label', 'Exchange'),
         jsonb_build_object('key', 'last_close', 'label', 'Latest close'),
         jsonb_build_object('key', 'as_of', 'label', 'As of'),
         jsonb_build_object('key', 'change_1y_pct', 'label', 'Change over a year (%)')),
       'filters', jsonb_build_array(jsonb_build_object('name', 'q', 'type', 'search', 'label', 'Search'))),
     'summary', jsonb_build_object(
       'source', 'Daily closing prices of the listed common stock; ticker and exchange as the registrant states them in SEC filings',
       'meaning', 'Closes are adjusted for stock splits; dividends are not added back. A trading day still in session is not included. Each row links the exchange quote page where a close can be checked.',
       'published_by', 'ingest/1 company_price_history')))
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
  ('company_price_history', 'company_price_history', 'Daily share prices of the company-page registrants',
   'Yahoo Finance chart endpoint (no key; not named in UI text or published data, owner decision 2026-10-28)',
   'https://finance.yahoo.com/', 'ingest-company-ir', '17 */3 * * *', interval '3 days', 'upsert', 'append',
   'company_price_history', '^px:[0-9]{10}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'Unofficial public chart endpoint; the owner chose it for price history. Each row links the listing exchange quote page.',
   'One request per registrant, 0.4 s apart, 46 registrants a run (stalest first), every three hours: every registrant about every nine hours.',
   true)
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
    raise notice 'company-prices schedule not installed: pg_cron and pg_net must both be enabled; apply this file again afterwards';
    return;
  end if;
  for s in select id, function_name, schedule from ingest.sources where id = 'company_price_history' loop
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
