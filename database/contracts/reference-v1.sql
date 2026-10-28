-- reference/1 (2026-10-28): official reference publications as self-updating sources.
--
-- Registers five ingest/1 sources (database/contracts/ingest-v1.sql must be applied first) served by one edge function,
-- supabase/functions/ingest-reference (logic and tests: src/lib/ingest/sources/{govman,cdir,fdaPmr,cdcOverdose}.ts):
--   govman_agencies     → govman_agencies     The United States Government Manual (GPO, GovInfo XML): one row per
--                                             entity at every level with addresses, leadership as printed, mission,
--                                             legal authority, programs and sources of information
--   cdir_members        → cdir_members        Official Congressional Directory (GPO, GovInfo ZIP text): one row per
--                                             Member, Delegate and Resident Commissioner (biography as printed,
--                                             Washington and district offices), linked to congress_members only on
--                                             an exact seat match
--   cdir_committees     → cdir_committees     the same directory's committee rosters (Senate, House, joint) with
--                                             subcommittees, printed roles and majority/minority columns
--   fda_pmr_pmc         → fda_pmr_pmc         FDA postmarketing requirements and commitments (downloadable database)
--   cdc_overdose_states → cdc_overdose_states CDC NCHS provisional drug overdose death counts by jurisdiction
-- All public domain; every row carries the publisher's page as source_url.
--
-- Deployment (project xosqzzsnhxcyehcnirpa):
--   1. apply this file (idempotent): catalog entries (empty until the first run) and the sources, enabled.
--   2. deploy ingest-reference with --no-verify-jwt (or the self-contained copy from
--      node scripts/safety_v2/bundle_functions.mjs <dir> ingest-reference).
--   3. apply this file again after the deploy if pg_cron or pg_net were missing the first time.

begin;

with entries(id, label, columns, summary) as (values
  ('govman_agencies', 'The United States Government Manual: agencies and their entries',
   jsonb_build_array(
     jsonb_build_object('key', 'agency', 'label', 'Agency'),
     jsonb_build_object('key', 'branch', 'label', 'Branch or category'),
     jsonb_build_object('key', 'within', 'label', 'Listed under'),
     jsonb_build_object('key', 'leaders', 'label', 'Leaders listed'),
     jsonb_build_object('key', 'edition', 'label', 'Edition')),
   jsonb_build_object(
     'source', 'The United States Government Manual, U.S. Government Publishing Office (GovInfo package GOVMAN, XML)',
     'meaning', 'What the edition prints for each entity. The nesting is the manual''s arrangement of entries, not a reporting relationship; leadership names are as printed and can lag appointments.')),
  ('cdir_members', 'Official Congressional Directory: Members of Congress',
   jsonb_build_array(
     jsonb_build_object('key', 'name', 'label', 'Member'),
     jsonb_build_object('key', 'party', 'label', 'Party'),
     jsonb_build_object('key', 'state', 'label', 'State'),
     jsonb_build_object('key', 'chamber', 'label', 'Chamber'),
     jsonb_build_object('key', 'district', 'label', 'District'),
     jsonb_build_object('key', 'washington_phone', 'label', 'Washington office')),
   jsonb_build_object(
     'source', 'Official Congressional Directory, Joint Committee on Printing / U.S. Government Publishing Office (GovInfo package CDIR, full text)',
     'meaning', 'Biographies, offices and phone numbers as printed, members as of the directory''s closing date. Linked to Member profiles only on an exact seat match.')),
  ('cdir_committees', 'Official Congressional Directory: committee rosters',
   jsonb_build_array(
     jsonb_build_object('key', 'committee', 'label', 'Committee'),
     jsonb_build_object('key', 'chamber', 'label', 'Chamber'),
     jsonb_build_object('key', 'chair', 'label', 'Chair'),
     jsonb_build_object('key', 'ranking_member', 'label', 'Ranking member'),
     jsonb_build_object('key', 'members', 'label', 'Members'),
     jsonb_build_object('key', 'subcommittees', 'label', 'Subcommittees')),
   jsonb_build_object(
     'source', 'Official Congressional Directory, U.S. Government Publishing Office (GovInfo package CDIR, full text)',
     'meaning', 'Members of each committee and subcommittee in printed order; roles exactly as printed after each name; columns are the directory''s majority and minority sides.')),
  ('fda_pmr_pmc', 'FDA postmarketing requirements and commitments',
   jsonb_build_array(
     jsonb_build_object('key', 'product', 'label', 'Product'),
     jsonb_build_object('key', 'applicant', 'label', 'Applicant'),
     jsonb_build_object('key', 'application', 'label', 'Application'),
     jsonb_build_object('key', 'kind', 'label', 'PMR or PMC'),
     jsonb_build_object('key', 'type', 'label', 'Type'),
     jsonb_build_object('key', 'status', 'label', 'Status'),
     jsonb_build_object('key', 'final_report_due', 'label', 'Final report due')),
   jsonb_build_object(
     'source', 'U.S. Food and Drug Administration, Postmarketing Requirements and Commitments downloadable database',
     'meaning', 'Studies and clinical trials FDA required of (PMR) or agreed with (PMC) an applicant after approval, with the status FDA reports. Applicants as FDA prints them; no company link is inferred.')),
  ('cdc_overdose_states', 'CDC provisional drug overdose death counts by state',
   jsonb_build_array(
     jsonb_build_object('key', 'jurisdiction', 'label', 'Jurisdiction'),
     jsonb_build_object('key', 'latest_period', 'label', '12 months ending'),
     jsonb_build_object('key', 'reported', 'label', 'Reported deaths'),
     jsonb_build_object('key', 'predicted', 'label', 'Predicted deaths'),
     jsonb_build_object('key', 'change_vs_year_before_pct', 'label', 'Change vs a year before (%)')),
   jsonb_build_object(
     'source', 'CDC National Center for Health Statistics, VSRR provisional drug overdose death counts (data.cdc.gov xkb8-kh2a)',
     'meaning', '12-month-ending counts by drug class, as reported and as predicted for delayed reporting. Suppressed values stay empty.'))
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
  ('govman_agencies', 'govman_agencies', 'The United States Government Manual', 'U.S. Government Publishing Office (GovInfo)',
   'https://www.govinfo.gov/app/collection/govman', 'ingest-reference', '37 6 3 * *', interval '45 days', 'upsert', 'append',
   'govman_agencies', '^govman:[0-9]{1,7}$', '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'GPO publications are public domain.', 'Two requests a run (collection page, edition XML), monthly.', true),
  ('cdir_members', 'cdir_members', 'Official Congressional Directory: Members', 'U.S. Government Publishing Office (GovInfo)',
   'https://www.govinfo.gov/app/collection/cdir', 'ingest-reference', '41 6 4 * *', interval '45 days', 'upsert', 'append',
   'cdir_members', '^cdir:[A-Za-z0-9-]{3,60}$', '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'GPO publications are public domain.', 'Two requests a run (collection page, package ZIP), monthly.', true),
  ('cdir_committees', 'cdir_committees', 'Official Congressional Directory: committees', 'U.S. Government Publishing Office (GovInfo)',
   'https://www.govinfo.gov/app/collection/cdir', 'ingest-reference', '47 6 4 * *', interval '45 days', 'upsert', 'append',
   'cdir_committees', '^cdir-committee:[a-z0-9-]{3,100}$', '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'GPO publications are public domain.', 'Two requests a run (collection page, package ZIP), monthly.', true),
  ('fda_pmr_pmc', 'fda_pmr_pmc', 'FDA postmarketing requirements and commitments', 'U.S. Food and Drug Administration',
   'https://www.fda.gov/drugs/guidance-compliance-regulatory-information/postmarket-requirements-and-commitments',
   'ingest-reference', '13 7 * * 1', interval '21 days', 'upsert', 'append', 'fda_pmr_pmc', '^pmr:[0-9]{1,12}$',
   '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'fda.gov content is in the public domain.', 'One request a run (the database ZIP), weekly.', true),
  ('cdc_overdose_states', 'cdc_overdose_states', 'CDC provisional drug overdose death counts', 'CDC National Center for Health Statistics',
   'https://data.cdc.gov/d/xkb8-kh2a', 'ingest-reference', '19 7 * * 3', interval '45 days', 'upsert', 'append',
   'cdc_overdose_states', '^od:[A-Z]{2}$', '{"counted_filters": [], "extend_filters": [], "summary_counts": {"rows": 0}}',
   'Public Domain U.S. Government (data.cdc.gov).', 'One request a run (the dataset as CSV), weekly.', true)
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
    raise notice 'reference schedule not installed: pg_cron and pg_net must both be enabled; apply this file again afterwards';
    return;
  end if;
  for s in select id, function_name, schedule from ingest.sources
           where id in ('govman_agencies', 'cdir_members', 'cdir_committees', 'fda_pmr_pmc', 'cdc_overdose_states') order by id loop
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
