-- company-ir/1 (2026-10-28): investor-relations figures and SEC cover-page facts of the MDL-defendant registrants.
--
-- Registers two ingest/1 sources (database/contracts/ingest-v1.sql must be applied first) served by one edge function,
-- supabase/functions/ingest-company-ir (logic and tests: src/lib/ingest/sources/companyIr.ts):
--   company_ir_kpis         → company_ir_kpis          one row per investor-relations document (results presentations,
--                                                      earnings slides, KPI and segment supplements) on the IR or
--                                                      corporate site the registrant states in its SEC filings, with
--                                                      the segment, product, geography, operating and guidance figures
--                                                      it prints (asynchronous model pass, every figure quoted and
--                                                      checked against the document text)
--   company_sec_cover_facts → company_sec_cover_facts  one row per registrant: dei:EntityPublicFloat and
--                                                      dei:EntityCommonStockSharesOutstanding from data.sec.gov
-- Targets are the registrants of company_sec_statements. Both write only through public.ingest_upsert_v1 with the
-- checks of ingest-v1.sql (id pattern, category, no credential in any URL).
--
-- Deployment (project xosqzzsnhxcyehcnirpa):
--   1. apply this file (idempotent): it adds the two catalog entries (empty until the first run) and the sources,
--      disabled.
--   2. deploy the function with --no-verify-jwt (supabase functions deploy ingest-company-ir, or the self-contained
--      copy from node scripts/safety_v2/bundle_functions.mjs <dir> ingest-company-ir).
--   3. company_sec_cover_facts needs no key: update ingest.sources set enabled = true where id = 'company_sec_cover_facts'.
--   4. company_ir_kpis needs function secrets FIRECRAWL_API_KEY and ANTHROPIC_API_KEY (TAVILY_API_KEY optional: used
--      only for registrants that state no IR site, restricted to their own domains). Dashboard → Edge Functions →
--      Secrets. Then update ingest.sources set enabled = true where id = 'company_ir_kpis'.
--   5. apply this file again to install the cron jobs (a job posts only while its source is enabled).

begin;

insert into public.corpus_datasets as d (id, label, ready, expected_records, imported_records, metadata)
values
  ('company_ir_kpis', 'Segment, product and operating figures from company investor-relations documents', true, 0, 0,
   jsonb_build_object(
     'id', 'company_ir_kpis',
     'label', 'Segment, product and operating figures from company investor-relations documents',
     'ready', true,
     'listing', jsonb_build_object('page', 1, 'limit', 50, 'total', 0,
       'columns', jsonb_build_array(
         jsonb_build_object('key', 'company', 'label', 'Company'),
         jsonb_build_object('key', 'kind', 'label', 'Document'),
         jsonb_build_object('key', 'period', 'label', 'Period'),
         jsonb_build_object('key', 'figures', 'label', 'Figures'),
         jsonb_build_object('key', 'status', 'label', 'Extraction')),
       'filters', jsonb_build_array(
         jsonb_build_object('name', 'q', 'type', 'search', 'label', 'Search'),
         jsonb_build_object('name', 'kind', 'type', 'select', 'label', 'Document', 'options', jsonb_build_array(
           jsonb_build_object('label', 'Presentation', 'value', 'presentation'),
           jsonb_build_object('label', 'Earnings materials', 'value', 'earnings'),
           jsonb_build_object('label', 'Supplement or fact sheet', 'value', 'supplement'),
           jsonb_build_object('label', 'Other', 'value', 'other'))),
         jsonb_build_object('name', 'status', 'type', 'select', 'label', 'Extraction', 'options', jsonb_build_array(
           jsonb_build_object('label', 'Figures read', 'value', 'extracted'),
           jsonb_build_object('label', 'Waiting for the model pass', 'value', 'pending'),
           jsonb_build_object('label', 'In the model pass', 'value', 'submitted'),
           jsonb_build_object('label', 'Could not be read', 'value', 'failed'))))),
     'summary', jsonb_build_object(
       'source', 'Investor-relations and corporate websites the registrants state in their SEC filings',
       'method', 'Documents found by Firecrawl map of the official IR site (Tavily search restricted to the company''s own domains when no IR site is stated), text read by Firecrawl scrape (PDF parser), figures read by one asynchronous model pass per run (Anthropic Message Batches; PDFs given as the document so tables and charts are read from the pages). Every figure carries the line it was read from and is dropped when that line does not print its value; a figure whose value is not in the stored document text is marked as read from the page image only. Nothing is computed or estimated.',
       'published_by', 'ingest/1 company_ir_kpis'))),
  ('company_sec_cover_facts', 'Public float and shares outstanding from SEC cover pages', true, 0, 0,
   jsonb_build_object(
     'id', 'company_sec_cover_facts',
     'label', 'Public float and shares outstanding from SEC cover pages',
     'ready', true,
     'listing', jsonb_build_object('page', 1, 'limit', 50, 'total', 0,
       'columns', jsonb_build_array(
         jsonb_build_object('key', 'company', 'label', 'Company'),
         jsonb_build_object('key', 'public_float', 'label', 'Public float (USD)'),
         jsonb_build_object('key', 'float_date', 'label', 'As of'),
         jsonb_build_object('key', 'shares_outstanding', 'label', 'Shares outstanding'),
         jsonb_build_object('key', 'shares_date', 'label', 'As of')),
       'filters', jsonb_build_array(jsonb_build_object('name', 'q', 'type', 'search', 'label', 'Search'))),
     'summary', jsonb_build_object(
       'source', 'SEC data.sec.gov XBRL company concepts (dei:EntityPublicFloat, dei:EntityCommonStockSharesOutstanding)',
       'meaning', 'Public float is the aggregate market value of common equity held by non-affiliates on the date the filer states on its 10-K cover page. It is not a market capitalisation.',
       'published_by', 'ingest/1 company_sec_cover_facts')))
on conflict (id) do update set label = excluded.label,
  metadata = excluded.metadata || jsonb_build_object('listing',
    (excluded.metadata -> 'listing') || jsonb_build_object('total', d.imported_records)),
  updated_at = now()
where d.label is distinct from excluded.label
   or (d.metadata - 'listing') is distinct from (excluded.metadata - 'listing')
   or ((d.metadata -> 'listing') - 'total') is distinct from ((excluded.metadata -> 'listing') - 'total');

insert into ingest.sources as s (id, dataset, label, publisher, source_url, function_name, schedule, stale_after, mode,
  ordinal_policy, category, id_pattern, catalog, terms_note, rate_note)
values
  ('company_ir_kpis', 'company_ir_kpis', 'Company investor-relations documents and the figures they print',
   'The registrants (their own investor-relations websites); text via Firecrawl, figures via Anthropic Message Batches',
   'https://www.sec.gov/edgar/searchedgar/companysearch', 'ingest-company-ir', '23 * * * *', interval '7 days',
   'upsert', 'append', 'company_ir_kpis', '^ir:[0-9]{10}:[0-9a-f]{16}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'Documents the companies publish for investors on the sites they name in SEC filings; quoted lines are kept short and every document links to the company''s own copy.',
   'At most 40 requests a run, 1.5 s apart per host: finished model batches first, then one batch of up to 15 pending documents, then the most relevant registrant that is due (pending-MDL defendants weekly, other MDL links every two weeks, other current filers monthly), every hour.'),
  ('company_sec_cover_facts', 'company_sec_cover_facts', 'SEC cover-page facts: public float and shares outstanding',
   'U.S. Securities and Exchange Commission (data.sec.gov XBRL company concepts)',
   'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', 'ingest-company-ir', '41 9 * * *',
   interval '3 days', 'upsert', 'append', 'company_sec_cover_facts', '^cover:[0-9]{10}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'SEC EDGAR data is public; requests identify the application and a contact address as the SEC asks.',
   'Two requests per registrant, 0.15 s apart (under the SEC limit of 10 a second), 25 registrants a run in rotation.')
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
    raise notice 'company-ir schedule not installed: pg_cron and pg_net must both be enabled; apply this file again afterwards';
    return;
  end if;
  for s in select id, function_name, schedule from ingest.sources where id in ('company_ir_kpis', 'company_sec_cover_facts') order by id loop
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
