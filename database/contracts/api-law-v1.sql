-- api-law/1 — wave 1025 (worker api-law): official law and government APIs as published datasets, their self-updating
-- sources and the read functions the app needs beyond corpus_records.
--
-- Datasets (published by the lead with scripts/api_law/publish_stream.py; builders under scripts/api_law/):
--   regulations_gov_documents   Regulations.gov Rules, Proposed Rules and Notices of twelve agencies (+ comment counts)
--   regulations_gov_dockets     Regulations.gov dockets of the same agencies (+ docket comment counts)
--
-- Self-updating sources (rows of ingest.sources; same contract as database/contracts/ingest-v1.sql, which must be
-- applied first; adapters listed in src/lib/ingest/sources/apiLawRegistry.ts):
--   regulations_gov_documents, regulations_gov_dockets  edge function ingest-regulations-gov (secret DATA_GOV_API_KEY)
--   sec_enforcement           → sec_enforcement_actions  edge function ingest-sec-enforcement (no key)
--   doj_press_releases_2026 / _2027                      edge function ingest-doj-press-releases (no key; enable 2027 once
--                                                        its partition exists)
--
-- Every public function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to
-- service_role. Idempotent: create or replace; source rows upserted by id without touching `enabled`.
-- Offline test: scripts/api_law/api-law-contract.test.mjs (pglite).
--
-- Deployment (lead):
--   1. ingest-v1.sql is applied (ingest schema present).
--   2. publish the datasets (RUNBOOK in docs/api-law-2026-10-25.md), then apply this file.
--   3. supabase functions deploy <name> --project-ref xosqzzsnhxcyehcnirpa --no-verify-jwt for ingest-regulations-gov
--      (needs the DATA_GOV_API_KEY function secret, entered by the owner in the dashboard), ingest-sec-enforcement and
--      ingest-doj-press-releases (each imports src/lib/ingest; if the bundler refuses that, deploy the copies from
--      node scripts/ingest/bundle_functions.mjs <dir>).
--   4. first run of each source from SQL (ingest-v1.sql step 5, source ids below), check ingest.runs, then
--      update ingest.sources set enabled = true where id in (...); and apply this file again (section 3 schedules).

-- ------------------------------------------------------------------------------------------------ 1. sources
do $sources$
begin
  if to_regclass('ingest.sources') is null then
    raise notice 'api-law sources not registered: apply database/contracts/ingest-v1.sql first';
    return;
  end if;
  insert into ingest.sources as s (id, dataset, label, publisher, source_url, function_name, schedule, stale_after, mode,
    ordinal_policy, category, id_pattern, catalog, terms_note, rate_note)
  values
    ('regulations_gov_documents', 'regulations_gov_documents', 'Regulations.gov documents (rules, proposed rules, notices)',
     'General Services Administration, eRulemaking Program (Regulations.gov)', 'https://open.gsa.gov/api/regulationsgov/',
     'ingest-regulations-gov', '17 6 * * *', interval '3 days', 'upsert', 'prepend', 'regulations_gov_documents',
     '^[A-Za-z0-9][A-Za-z0-9_.-]{2,120}$',
     '{"counted_filters": ["agency", "type", "year", "comments", "fr_linked"], "extend_filters": ["year"], "summary_counts": {"records": 0}}',
     'Regulations.gov API v4 with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); Regulations.gov records are U.S. government works (17 U.S.C. 105).',
     'Regulations.gov allows 1,000 requests an hour per key and the key is shared with other jobs: requests 1.5 s apart, at most 54 per run (12 list pages, 2 comment-window pages, 40 comment counts).'),
    ('regulations_gov_dockets', 'regulations_gov_dockets', 'Regulations.gov dockets',
     'General Services Administration, eRulemaking Program (Regulations.gov)', 'https://open.gsa.gov/api/regulationsgov/',
     'ingest-regulations-gov', '47 6 * * *', interval '3 days', 'upsert', 'prepend', 'regulations_gov_dockets',
     '^[A-Za-z0-9][A-Za-z0-9_.-]{2,120}$',
     '{"counted_filters": ["agency", "docket_type", "id_year", "comments"], "extend_filters": ["id_year"], "summary_counts": {"records": 0}}',
     'Regulations.gov API v4 with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); Regulations.gov records are U.S. government works (17 U.S.C. 105).',
     'Regulations.gov allows 1,000 requests an hour per key and the key is shared with other jobs: requests 1.5 s apart, at most 42 per run (12 list pages, 30 docket comment counts).'),
    ('sec_enforcement', 'sec_enforcement_actions', 'SEC litigation releases and administrative proceedings',
     'U.S. Securities and Exchange Commission', 'https://www.sec.gov/about/rss-feeds',
     'ingest-sec-enforcement', '13 13,22 * * 1-5', interval '4 days', 'upsert', 'prepend', 'sec_enforcement_actions',
     '^sec-(lr|ap):[A-Za-z0-9;.-]{1,80}$',
     '{"counted_filters": [], "extend_filters": [], "summary_counts": {}}',
     'SEC RSS feeds and sec.gov enforcement listing and release pages, no key; SEC material is a U.S. government work. Rows are built exactly as scripts/enrichment/enforcement_actions/build_sec.py builds them (src/lib/ingest/sources/secEnforcement.ts).',
     'SEC fair access: declared User-Agent, at most 10 requests a second; requests 1 s apart, at most 30 per run (2 feeds, up to 2 listing pages per list, one page per new litigation release).'),
    ('doj_press_releases_2026', 'doj_press_releases_2026', 'DOJ press releases, 2026',
     'U.S. Department of Justice', 'https://www.justice.gov/developer/api-documentation/api_v1',
     'ingest-doj-press-releases', '37 11,23 * * *', interval '2 days', 'upsert', 'prepend', 'doj_press_releases_2026',
     '^doj-pr:[0-9a-f-]{36}$',
     '{"counted_filters": [], "extend_filters": [], "summary_counts": {"records": 0}}',
     'DOJ News API (justice.gov/api/v1), no key; DOJ works are in the public domain (17 U.S.C. 105). Rows are built exactly as build_doj.py builds them, with the boilerplate sentence keys of the base build (src/lib/ingest/sources/dojPressReleases.ts).',
     'The API documentation warns that more than 4 requests a second may be blocked: requests 1 s apart, at most 6 pages of 50 releases per run.'),
    ('doj_press_releases_2027', 'doj_press_releases_2027', 'DOJ press releases, 2027',
     'U.S. Department of Justice', 'https://www.justice.gov/developer/api-documentation/api_v1',
     'ingest-doj-press-releases', '39 11,23 * * *', interval '2 days', 'upsert', 'prepend', 'doj_press_releases_2027',
     '^doj-pr:[0-9a-f-]{36}$',
     '{"counted_filters": [], "extend_filters": [], "summary_counts": {"records": 0}}',
     'DOJ News API (justice.gov/api/v1), no key; DOJ works are in the public domain (17 U.S.C. 105). Enable only after the 2027 partition exists in the catalog (the first run of a source needs its dataset).',
     'The API documentation warns that more than 4 requests a second may be blocked: requests 1 s apart, at most 6 pages of 50 releases per run.'),
    ('congress_amendments', 'congress_amendments', 'Congress.gov amendments',
     'Library of Congress (Congress.gov)', 'https://api.congress.gov/',
     'ingest-congress-gov', '19 7 * * *', interval '3 days', 'upsert', 'prepend', 'congress_amendments',
     '^amdt:[0-9]{2,3}-(hamdt|samdt|suamdt)-[0-9]{1,6}$',
     '{"counted_filters": ["congress", "type", "chamber", "year", "detail"], "extend_filters": ["congress", "year"], "summary_counts": {"records": 0}}',
     'Congress.gov API v3 with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); Congress.gov data are works of the U.S. Government.',
     'Congress.gov allows 5,000 requests an hour per key, shared: requests 0.8 s apart, at most 64 per run (4 list pages of 250, 60 details).'),
    ('congress_nominations', 'congress_nominations', 'Congress.gov nominations',
     'Library of Congress (Congress.gov)', 'https://api.congress.gov/',
     'ingest-congress-gov', '27 7 * * *', interval '3 days', 'upsert', 'prepend', 'congress_nominations',
     '^nom:[0-9]{2,3}-PN[0-9]{1,6}(-[0-9]{1,4})?$',
     '{"counted_filters": ["congress", "kind", "status", "year", "judicial"], "extend_filters": ["congress", "year"], "summary_counts": {"records": 0}}',
     'Congress.gov API v3 with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); Congress.gov data are works of the U.S. Government.',
     'Congress.gov allows 5,000 requests an hour per key, shared: requests 0.8 s apart, at most 4 list pages of 250 per run.'),
    ('congress_treaties', 'congress_treaties', 'Congress.gov treaty documents',
     'Library of Congress (Congress.gov)', 'https://api.congress.gov/',
     'ingest-congress-gov', '33 7 * * 1', interval '9 days', 'upsert', 'prepend', 'congress_treaties',
     '^treaty:[0-9]{2,3}-[0-9]{1,4}[A-Z]{0,2}$',
     '{"counted_filters": ["congress", "topic", "in_force"], "extend_filters": ["congress", "topic"], "summary_counts": {"records": 0}}',
     'Congress.gov API v3 with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); Congress.gov data are works of the U.S. Government.',
     'Congress.gov allows 5,000 requests an hour per key, shared: requests 0.8 s apart, at most 21 per run (1 list page, 20 details).'),
    ('congress_committee_reports', 'congress_committee_reports', 'Congress.gov committee reports',
     'Library of Congress (Congress.gov)', 'https://api.congress.gov/',
     'ingest-congress-gov', '43 7 * * *', interval '3 days', 'upsert', 'prepend', 'congress_committee_reports',
     '^crpt:[0-9]{2,3}-(hrpt|srpt|erpt)-[0-9]{1,5}-[0-9]{1,2}$',
     '{"counted_filters": ["congress", "type", "year", "conference"], "extend_filters": ["congress", "year"], "summary_counts": {"records": 0}}',
     'Congress.gov API v3 with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); Congress.gov data are works of the U.S. Government.',
     'Congress.gov allows 5,000 requests an hour per key, shared: requests 0.8 s apart, at most 62 per run (2 list pages, 60 details).'),
    ('govinfo_bill_versions', 'govinfo_bill_versions', 'GovInfo bill text versions',
     'U.S. Government Publishing Office (GovInfo)', 'https://api.govinfo.gov/docs/',
     'ingest-govinfo', '11 8 * * *', interval '3 days', 'upsert', 'prepend', 'govinfo_bill_versions',
     '^[0-9]{2,3}-(hr|s|hjres|sjres|hconres|sconres|hres|sres)-[0-9]{1,5}$',
     '{"counted_filters": ["congress", "type", "enrolled", "held_bill"], "extend_filters": ["congress"], "summary_counts": {"records": 0}}',
     'GovInfo API with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); GovInfo content is a U.S. Government work (17 U.S.C. 105).',
     'GovInfo allows 36,000 requests an hour on this key, shared: requests 0.5 s apart, at most 6 listing pages of 1,000 per run.'),
    ('govinfo_hearings', 'govinfo_hearings', 'GovInfo congressional hearings',
     'U.S. Government Publishing Office (GovInfo)', 'https://api.govinfo.gov/docs/',
     'ingest-govinfo', '23 8 * * *', interval '4 days', 'upsert', 'prepend', 'govinfo_hearings',
     '^CHRG-[A-Za-z0-9_.-]{3,80}$',
     '{"counted_filters": ["congress", "class", "year", "summary"], "extend_filters": ["congress", "class", "year"], "summary_counts": {"records": 0}}',
     'GovInfo API with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); GovInfo content is a U.S. Government work (17 U.S.C. 105).',
     'GovInfo allows 36,000 requests an hour on this key, shared: requests 0.5 s apart, at most 63 per run (3 listing pages, 60 summaries).'),
    ('govinfo_committee_prints', 'govinfo_committee_prints', 'GovInfo committee prints',
     'U.S. Government Publishing Office (GovInfo)', 'https://api.govinfo.gov/docs/',
     'ingest-govinfo', '37 8 * * 2', interval '9 days', 'upsert', 'prepend', 'govinfo_committee_prints',
     '^CPRT-[A-Za-z0-9_.-]{3,80}$',
     '{"counted_filters": ["congress", "class", "year", "summary"], "extend_filters": ["congress", "class", "year"], "summary_counts": {"records": 0}}',
     'GovInfo API with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); GovInfo content is a U.S. Government work (17 U.S.C. 105).',
     'GovInfo allows 36,000 requests an hour on this key, shared: requests 0.5 s apart, at most 32 per run (2 listing pages, 30 summaries).'),
    ('govinfo_gao_reports', 'govinfo_gao_reports', 'GovInfo GAO reports and Comptroller General decisions',
     'U.S. Government Publishing Office (GovInfo)', 'https://api.govinfo.gov/docs/',
     'ingest-govinfo', '49 8 * * 3', interval '9 days', 'upsert', 'prepend', 'govinfo_gao_reports',
     '^GAOREPORTS-[A-Za-z0-9_.-]{3,80}$',
     '{"counted_filters": ["class", "year", "summary"], "extend_filters": ["year"], "summary_counts": {"records": 0}}',
     'GovInfo API with an api.data.gov key sent in the X-Api-Key header (never in a recorded URL); GovInfo content is a U.S. Government work (17 U.S.C. 105).',
     'GovInfo allows 36,000 requests an hour on this key, shared: requests 0.5 s apart, at most 32 per run (2 listing pages, 30 summaries).'),
    ('gao_legal_decisions', 'gao_legal_decisions', 'GAO legal decisions',
     'U.S. Government Accountability Office', 'https://www.gao.gov/about/stay-connected',
     'ingest-gao-legal', '53 12 * * 1-5', interval '4 days', 'upsert', 'prepend', 'gao_legal_decisions',
     '^gao:b-[0-9]+([.][0-9]+)?(,b-[0-9]+([.][0-9]+)?)*$',
     '{"counted_filters": ["year", "month"], "extend_filters": ["year", "month"], "summary_counts": {"records": 0}}',
     'GAO Legal Products RSS feed (https://www.gao.gov/rss/reportslegal.xml), no key; GAO products are U.S. Government works.',
     'gao.gov robots.txt asks for 420 s between requests: one request per run, one run a weekday.')
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
end $sources$;

-- ------------------------------------------------------------------------------------------------ 2. read functions
begin;

-- Regulations.gov at a glance (shape: RegsOverview in src/lib/external/apiLaw.functions.ts). "Today" is the Eastern-time
-- date, the calendar Regulations.gov uses; a comment period is open when its Eastern-time end date is today or later.
-- Comment sums cover only documents whose count has been read (the count of those is returned beside the sum).
create or replace function public.api_law_regs_overview_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  with today as (select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as t),
  d as (
    select r.id, r.title, r.filters -> 'agency' ->> 0 as agency, r.filters -> 'type' ->> 0 as type,
           r.filters -> 'year' ->> 0 as year, r.item -> 'dates_et' ->> 'comment_end' as cend,
           r.filters -> 'docket' ->> 0 as docket,
           case when jsonb_typeof(r.item -> 'comments' -> 'posted') = 'number' then (r.item -> 'comments' ->> 'posted')::bigint end as posted
    from public.corpus_records r
    where r.dataset = 'regulations_gov_documents'
  ), k as (
    select r.id, r.title, r.filters -> 'agency' ->> 0 as agency, r.item -> 'regs_docket' ->> 'docketType' as docket_type,
           case when jsonb_typeof(r.item -> 'comments' -> 'posted') = 'number' then (r.item -> 'comments' ->> 'posted')::bigint end as posted
    from public.corpus_records r
    where r.dataset = 'regulations_gov_dockets'
  ), ag as (
    select d.agency,
           count(*) filter (where d.type = 'rule') as rules,
           count(*) filter (where d.type = 'proposed_rule') as proposed_rules,
           count(*) filter (where d.type = 'notice') as notices,
           count(*) filter (where d.cend >= (select t from today)) as open_documents,
           count(*) filter (where d.type = 'proposed_rule' and d.posted is not null) as pr_counted,
           sum(d.posted) filter (where d.type = 'proposed_rule') as pr_comments
    from d where d.agency is not null group by d.agency
  ), kg as (
    select k.agency, count(*) as dockets, count(*) filter (where k.docket_type = 'Rulemaking') as rulemaking
    from k where k.agency is not null group by k.agency
  )
  select jsonb_build_object(
    'as_of', (select t from today),
    'agencies', coalesce((
      select jsonb_agg(jsonb_build_object('agency', coalesce(ag.agency, kg.agency),
        'rules', coalesce(ag.rules, 0), 'proposed_rules', coalesce(ag.proposed_rules, 0), 'notices', coalesce(ag.notices, 0),
        'dockets', kg.dockets, 'rulemaking_dockets', kg.rulemaking, 'open_documents', coalesce(ag.open_documents, 0),
        'proposed_rules_counted', coalesce(ag.pr_counted, 0), 'comments_on_proposed_rules', ag.pr_comments)
        order by coalesce(ag.agency, kg.agency))
      from ag full join kg on kg.agency = ag.agency), '[]'::jsonb),
    'open_for_comment', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', left(o.title, 300), 'agency', o.agency, 'type', o.type,
        'comment_end', o.cend, 'docket', o.docket, 'posted', o.posted) order by o.cend, o.id)
      from (select * from d where d.cend >= (select t from today) order by d.cend, d.id limit 50) o), '[]'::jsonb),
    'most_commented_dockets', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title', left(x.title, 300), 'agency', x.agency, 'posted', x.posted,
        'docket_type', x.docket_type) order by x.posted desc, x.id)
      from (select * from k where k.posted is not null order by k.posted desc, k.id limit 20) x), '[]'::jsonb),
    'by_year', coalesce((
      select jsonb_agg(jsonb_build_object('year', y.year, 'type', y.type, 'n', y.n) order by y.year, y.type)
      from (select d.year, d.type, count(*) as n from d where d.year is not null and d.type is not null group by d.year, d.type) y),
      '[]'::jsonb))
$$;

do $grants$
declare f text;
begin
  foreach f in array array['public.api_law_regs_overview_v1()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

commit;

-- ------------------------------------------------------------------------------------------------ 3. schedule (LEAD)
-- Applies only when pg_cron and pg_net are installed and ingest-v1.sql created the trigger secret. One job per api-law
-- source (ingest-<source id>), posting only while the source is enabled; re-running updates the jobs in place.
do $schedule$
declare s record;
begin
  if to_regclass('ingest.sources') is null
     or not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'api-law schedule not installed: needs ingest-v1.sql, pg_cron and pg_net';
    return;
  end if;
  for s in select id, function_name, schedule from ingest.sources
           where id in ('regulations_gov_documents', 'regulations_gov_dockets', 'sec_enforcement', 'doj_press_releases_2026', 'doj_press_releases_2027', 'congress_amendments', 'congress_nominations', 'congress_treaties', 'congress_committee_reports', 'govinfo_bill_versions', 'govinfo_hearings', 'govinfo_committee_prints', 'govinfo_gao_reports', 'gao_legal_decisions') order by id loop
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
