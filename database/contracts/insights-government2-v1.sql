-- insights/government2 — rulemaking, Congress and 10-K litigation metrics over the api-law datasets (wave 1025).
--
-- Registers the metric family `government2` in the insights layer (insights-v1.sql; contract src/lib/insights/contract.ts)
-- and its deterministic refresh function insights.facts_government2(). Requires insights-v1.sql applied first; reads only
-- public.corpus_records of the datasets named in the family row (published with scripts/api_law/publish_stream.py and
-- kept current by the api-law sources, database/contracts/api-law-v1.sql). Never edits insights-v1.sql.
--
-- Every value is a count of records the source publishes, or a sum of numbers the source states (Regulations.gov comment
-- counts). A value the data cannot give is NULL with a reason, never 0: comments on proposed rules are summed only when
-- every proposed rule of the agency and year has a count read. A year still in progress, or one the source does not yet
-- cover completely, is partial. Facts are emitted only for entities already in the spine: the nation (US), Federal
-- Register agencies (Regulations.gov agency acronym → Federal Register agency id by the fixed table below, the same as
-- src/lib/ingest/sources/regulationsGov.ts AGENCIES) and SEC registrants by CIK; the family never invents an entity.
-- An MDL number in a 10-K is a mention, never MDL membership (caveat on the metric).
--
-- Idempotent: the family and the registry rows are upserted by id; functions are create or replace. Apply, then
-- `select insights.refresh_government2('initial');`. The scheduled ingestion refreshes the family through
-- insights.refresh_for_datasets(...) whenever one of its datasets is named by a run.
-- Offline test: node --test scripts/api_law/api-law-contract.test.mjs (pglite, built samples).

begin;

insert into insights.families (id, ordinal, datasets, dataset_patterns, description) values
  ('government2', 105, array['regulations_gov_documents', 'congress_amendments', 'congress_nominations',
     'congress_committee_reports', 'govinfo_hearings', 'govinfo_bill_versions', 'company_sec_legal_proceedings'], '{}',
   'Regulations.gov rulemaking and comments, Congress amendments, nominations, reports, hearings and bill texts, 10-K MDL mentions')
on conflict (id) do update set ordinal = excluded.ordinal, datasets = excluded.datasets,
  dataset_patterns = excluded.dataset_patterns, description = excluded.description;

insert into insights.metrics (id, family, ordinal, label, description, unit, format, topic, entity_types, period_type,
  source_datasets, source_links, numerator, denominator, method, caveats, direction) values
('regs_proposed_rules_posted', 'government2', 10500, 'Proposed rules posted on Regulations.gov',
 'Proposed Rule documents the agency posted on Regulations.gov in the calendar year (posting date in Eastern time).',
 'proposed rules', 'count', 'law', array['agency'], 'year', array['regulations_gov_documents'],
 '[{"label": "Regulations.gov API v4", "url": "https://open.gsa.gov/api/regulationsgov/"}]',
 'Regulations.gov documents of type Proposed Rule posted in the year', null,
 'Count of regulations_gov_documents records with filters.type = proposed_rule and filters.year = the year, per agency (Regulations.gov agencyId mapped to its Federal Register agency id). The current year is partial.',
 array['Covers the twelve agencies the dataset reads (CFPB, CMS, CPSC, DEA, EPA, FAA, FDA, FTC, NHTSA, OSHA, PHMSA, SEC).',
       'Agencies moved their dockets to Regulations.gov in different years (from 2003); a year before an agency''s move undercounts its rulemaking. The Federal Register metrics count all publications.',
       'Withdrawn documents stay counted (Regulations.gov keeps them, flagged withdrawn).'],
 'higher_is_more'),
('regs_final_rules_posted', 'government2', 10510, 'Final rules posted on Regulations.gov',
 'Rule documents (final and interim final rules) the agency posted on Regulations.gov in the calendar year (Eastern time).',
 'rules', 'count', 'law', array['agency'], 'year', array['regulations_gov_documents'],
 '[{"label": "Regulations.gov API v4", "url": "https://open.gsa.gov/api/regulationsgov/"}]',
 'Regulations.gov documents of type Rule posted in the year', null,
 'Count of regulations_gov_documents records with filters.type = rule and filters.year = the year, per agency. The current year is partial.',
 array['Covers twelve agencies only; agencies moved to Regulations.gov in different years (from 2003).',
       'Regulations.gov''s Rule type includes interim final and direct final rules as the agency labels them.'],
 'higher_is_more'),
('regs_notices_posted', 'government2', 10520, 'Notices posted on Regulations.gov',
 'Notice documents the agency posted on Regulations.gov in the calendar year (Eastern time).',
 'notices', 'count', 'law', array['agency'], 'year', array['regulations_gov_documents'],
 '[{"label": "Regulations.gov API v4", "url": "https://open.gsa.gov/api/regulationsgov/"}]',
 'Regulations.gov documents of type Notice posted in the year', null,
 'Count of regulations_gov_documents records with filters.type = notice and filters.year = the year, per agency. The current year is partial.',
 array['Covers twelve agencies only; agencies moved to Regulations.gov in different years (from 2003).'],
 'higher_is_more'),
('regs_comments_on_proposed_rules', 'government2', 10530, 'Public comments posted on proposed rules',
 'Comments Regulations.gov shows as posted on the proposed rules the agency posted in the calendar year, summed over those proposed rules.',
 'comments', 'count', 'law', array['agency'], 'year', array['regulations_gov_documents'],
 '[{"label": "Regulations.gov API v4 (comments endpoint, totalElements)", "url": "https://open.gsa.gov/api/regulationsgov/"}]',
 'Sum of the posted-comment counts of the year''s proposed rules', null,
 'Sum of item.comments.posted (the comments endpoint''s totalElements for the document, read on the date in each record) over the agency''s Proposed Rule documents posted in the year; n is the number of proposed rules. NULL with the number read when any proposed rule of the year has no count read yet.',
 array['Counts what the agency posted publicly on Regulations.gov; agencies may withhold, group or post comments late, and mass-mail campaigns can be posted as one comment with a tally.',
       'A comment period still open keeps growing; each count is as read on the date stored in its record.',
       'Covers twelve agencies only.'],
 'higher_is_more'),
('congress_amendments_submitted', 'government2', 10540, 'Amendments submitted in Congress',
 'House and Senate amendments by calendar year of their submitted date (Congress.gov).',
 'amendments', 'count', 'government', array['nation'], 'year', array['congress_amendments'],
 '[{"label": "Congress.gov API v3, amendments", "url": "https://api.congress.gov/"}]',
 'Amendments whose submitted date (as published) falls in the year', null,
 'Count of congress_amendments records with item.amendment.submittedDate in the year. A year is partial while it is in progress or while any amendment of that year''s Congress has no detail read (its submitted date is not yet known).',
 array['An amendment can be submitted and never offered or voted on; Senate amendments are often filed in large numbers to preserve the right to offer them.',
       'Congress.gov amendment data start with the 97th Congress (1981).'],
 'higher_is_more'),
('congress_nominations_received', 'government2', 10550, 'Presidential nominations received by the Senate',
 'Nominations (civilian and military) the Senate received in the calendar year, by received date (Congress.gov).',
 'nominations', 'count', 'government', array['nation'], 'year', array['congress_nominations'],
 '[{"label": "Congress.gov API v3, nominations", "url": "https://api.congress.gov/"}]',
 'Nomination records (PN numbers and their parts) received in the year', null,
 'Count of congress_nominations records with item.nomination.receivedDate in the year. The current year is partial.',
 array['One military nomination can list hundreds of officers; a nomination record is not a person count.',
       'A nomination split into parts is counted once per part, as Congress.gov lists it.'],
 'neutral'),
('congress_nominations_confirmed', 'government2', 10560, 'Nominations confirmed by the Senate',
 'Nominations whose latest published action is Senate confirmation, by calendar year of that action (Congress.gov).',
 'nominations', 'count', 'government', array['nation'], 'year', array['congress_nominations'],
 '[{"label": "Congress.gov API v3, nominations", "url": "https://api.congress.gov/"}]',
 'Nominations whose latest action text begins "Confirmed by the Senate", by the year of that action', null,
 'Count of congress_nominations records with filters.status = confirmed (latest action text starts with "Confirmed by the Senate") by item.nomination.latestAction.date year. The current year is partial.',
 array['Only the latest action is read: a confirmation followed by a later action (rare) is not counted.',
       'Military nominations confirmed en bloc count once per nomination record.'],
 'neutral'),
('congress_committee_reports_issued', 'government2', 10570, 'Committee reports issued',
 'House, Senate and conference committee reports by calendar year of issue (Congress.gov), each report counted once however many parts it has.',
 'reports', 'count', 'government', array['nation'], 'year', array['congress_committee_reports'],
 '[{"label": "Congress.gov API v3, committee reports", "url": "https://api.congress.gov/"}]',
 'Distinct reports (Congress, type, number) whose first part was issued in the year', null,
 'Count of distinct (congress, type, number) among congress_committee_reports records, by the year of the earliest issue date among the report''s parts. The current year is partial.',
 array['Reports without an issue date in Congress.gov are not counted.'],
 'higher_is_more'),
('congress_hearings_published', 'government2', 10580, 'Congressional hearings published by GovInfo',
 'Hearing transcripts in GovInfo''s Congressional Hearings collection, by calendar year of the first hearing date (or the publication date when GovInfo''s summary gives no hearing date).',
 'hearings', 'count', 'government', array['nation'], 'year', array['govinfo_hearings'],
 '[{"label": "GovInfo API, CHRG collection", "url": "https://api.govinfo.gov/docs/"}]',
 'CHRG packages whose first hearing date (else issue date) falls in the year', null,
 'Count of govinfo_hearings records by filters.year (summary heldDates[0], else the package dateIssued). The current and previous year are partial: GovInfo publishes many transcripts a year or more after the hearing.',
 array['Not every hearing is printed; committees publish transcripts at their own pace, so recent years rise as transcripts appear.',
       'A package can cover several hearing days.'],
 'higher_is_more'),
('bill_text_versions_published', 'government2', 10590, 'Bill text versions published',
 'Text versions of bills and resolutions published in GovInfo''s Congressional Bills collection, by calendar year of the version date.',
 'text versions', 'count', 'government', array['nation'], 'year', array['govinfo_bill_versions'],
 '[{"label": "GovInfo API, BILLS collection", "url": "https://api.govinfo.gov/docs/"}]',
 'BILLS packages (one per bill version) dated in the year', null,
 'Count of the versions listed in govinfo_bill_versions records (item.versions[].date) by year. The current year is partial.',
 array['A version is a printing (introduced, reported, engrossed, enrolled and others); one bill can have many.',
       'GovInfo''s Congressional Bills collection starts with the 103rd Congress (1993).'],
 'higher_is_more'),
('bill_enrolled_versions_published', 'government2', 10600, 'Enrolled bills published',
 'Enrolled versions (the text passed by both chambers and sent to the President) published in GovInfo''s Congressional Bills collection, by calendar year of the version date.',
 'enrolled bills', 'count', 'government', array['nation'], 'year', array['govinfo_bill_versions'],
 '[{"label": "GovInfo API, BILLS collection", "url": "https://api.govinfo.gov/docs/"}]',
 'BILLS packages with version code enr dated in the year', null,
 'Count of item.versions[] entries with code = enr in govinfo_bill_versions records, by year of their date. The current year is partial.',
 array['Enrolled simple and concurrent resolutions are included as GovInfo publishes them; an enrolled bill can still be vetoed.'],
 'higher_is_more'),
('company_10k_mdls_mentioned', 'government2', 10610, 'MDLs mentioned in the company''s Form 10-K',
 'Distinct multidistrict litigation numbers (or held MDL captions) written in the Item 3 Legal Proceedings section or the litigation notes of the company''s Form 10-K for the fiscal year.',
 'MDLs mentioned', 'count', 'companies', array['company'], 'twelve_months_ending', array['company_sec_legal_proceedings'],
 '[{"label": "SEC EDGAR full-text filings (Form 10-K)", "url": "https://www.sec.gov/edgar/search/"}]',
 'Distinct MDL numbers mentioned in the 10-K''s Item 3 and the notes it points to', null,
 'Count of distinct item.mentions[].mdl_number of the company_sec_legal_proceedings record for the fiscal period ending on the period date (the latest filed 10-K for that period). 0 when the sections were read and name no MDL; no fact when no section was found.',
 array['A mention is not membership: the company may be a defendant, a plaintiff, an indemnitor or only describe the litigation.',
       'Only Item 3 and the notes it names (or notes titled contingencies / litigation) are read; an MDL named elsewhere in the filing is not counted.'],
 'neutral')
on conflict (id) do update set family = excluded.family, ordinal = excluded.ordinal, label = excluded.label,
  description = excluded.description, unit = excluded.unit, format = excluded.format, topic = excluded.topic,
  entity_types = excluded.entity_types, period_type = excluded.period_type, source_datasets = excluded.source_datasets,
  source_links = excluded.source_links, numerator = excluded.numerator, denominator = excluded.denominator,
  method = excluded.method, caveats = excluded.caveats, direction = excluded.direction;

create or replace function insights.facts_government2() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with agency_map(acronym, fr_id) as (values
    ('FDA', '199'), ('CPSC', '84'), ('NHTSA', '345'), ('EPA', '145'), ('FTC', '192'), ('OSHA', '386'), ('CMS', '45'),
    ('DEA', '116'), ('FAA', '159'), ('CFPB', '573'), ('SEC', '466'), ('PHMSA', '408')
  ), docs as (
    select m.fr_id, r.filters -> 'type' ->> 0 as type, (r.filters -> 'year' ->> 0)::integer as y,
           insights.iso_date(r.item -> 'dates_et' ->> 'posted') as posted,
           case when jsonb_typeof(r.item -> 'comments' -> 'posted') = 'number'
                then (r.item -> 'comments' ->> 'posted')::numeric end as comments
    from public.corpus_records r
    join agency_map m on m.acronym = r.filters -> 'agency' ->> 0
    where r.dataset = 'regulations_gov_documents' and r.filters -> 'year' ->> 0 ~ '^(19|20)[0-9]{2}$'
      and exists (select 1 from insights.entities e where e.entity_type = 'agency' and e.entity_id = m.fr_id)
  ), docs_t as (select max(posted) as t from docs),
  amdt as (
    select r.filters -> 'congress' ->> 0 as congress, insights.iso_date(r.item -> 'amendment' ->> 'submittedDate') as d
    from public.corpus_records r
    where r.dataset = 'congress_amendments'
  ), amdt_missing as (
    select a.congress from amdt a where a.d is null group by a.congress
  ), amdt_t as (select max(d) as t from amdt),
  noms as (
    select insights.iso_date(r.item -> 'nomination' ->> 'receivedDate') as received,
           case when r.filters -> 'status' ->> 0 = 'confirmed'
                then insights.iso_date(r.item -> 'nomination' -> 'latestAction' ->> 'date') end as confirmed
    from public.corpus_records r
    where r.dataset = 'congress_nominations'
  ), noms_t as (select greatest(max(received), max(confirmed)) as t from noms),
  rpt as (
    select r.item -> 'report' ->> 'congress' as congress, r.item -> 'report' ->> 'type' as type,
           r.item -> 'report' ->> 'number' as number, min(insights.iso_date(r.item -> 'report' ->> 'issueDate')) as d
    from public.corpus_records r
    where r.dataset = 'congress_committee_reports'
    group by 1, 2, 3
  ), rpt_t as (select max(d) as t from rpt),
  chrg as (
    select (r.filters -> 'year' ->> 0)::integer as y
    from public.corpus_records r
    where r.dataset = 'govinfo_hearings' and r.filters -> 'year' ->> 0 ~ '^(19|20)[0-9]{2}$'
  ),
  vers as (
    select insights.iso_date(v.value ->> 'date') as d, v.value ->> 'code' as code
    from public.corpus_records r cross join lateral jsonb_array_elements(insights.jarr(r.item -> 'versions')) v
    where r.dataset = 'govinfo_bill_versions'
  ), vers_t as (select max(d) as t from vers),
  tenk as (
    select distinct on (r.item -> 'filing' ->> 'cik', r.item -> 'filing' ->> 'period')
           r.item -> 'filing' ->> 'cik' as cik, insights.iso_date(r.item -> 'filing' ->> 'period') as period,
           r.item -> 'mentions' as mentions,
           (jsonb_typeof(r.item -> 'item3') = 'object' or jsonb_array_length(insights.jarr(r.item -> 'notes')) > 0) as read
    from public.corpus_records r
    where r.dataset = 'company_sec_legal_proceedings' and r.item -> 'filing' ->> 'cik' ~ '^[0-9]{10}$'
      and insights.iso_date(r.item -> 'filing' ->> 'period') is not null
      and exists (select 1 from insights.entities e where e.entity_type = 'company' and e.entity_id = r.item -> 'filing' ->> 'cik')
    order by r.item -> 'filing' ->> 'cik', r.item -> 'filing' ->> 'period', r.item -> 'filing' ->> 'filed' desc, r.id desc
  )
  -- Regulations.gov documents posted, per agency and year
  select m.metric, 'agency', d.fr_id, d.y::text, make_date(d.y, 1, 1), make_date(d.y, 12, 31), count(*)::numeric,
         null::numeric, insights.year_partial(d.y, (select t from docs_t)), null::numeric, null::text
  from docs d
  join (values ('regs_proposed_rules_posted', 'proposed_rule'), ('regs_final_rules_posted', 'rule'),
               ('regs_notices_posted', 'notice')) m(metric, type) on m.type = d.type
  group by m.metric, d.fr_id, d.y
  union all
  -- comments on the year's proposed rules: a sum only when every proposed rule has a count read
  select 'regs_comments_on_proposed_rules', 'agency', d.fr_id, d.y::text, make_date(d.y, 1, 1), make_date(d.y, 12, 31),
         case when count(d.comments) = count(*) then sum(d.comments) end, null::numeric,
         insights.year_partial(d.y, (select t from docs_t)), count(*)::numeric,
         case when count(d.comments) < count(*) then
           'Comment counts read for ' || count(d.comments) || ' of ' || count(*) || ' proposed rules posted this year.' end
  from docs d where d.type = 'proposed_rule'
  group by d.fr_id, d.y
  union all
  -- a year overlaps one Congress (even years) or two (odd years: the old Congress ends on January 3)
  select 'congress_amendments_submitted', 'nation', 'US', a.y::text, make_date(a.y, 1, 1), make_date(a.y, 12, 31),
         count(*)::numeric, null::numeric,
         insights.year_partial(a.y, (select t from amdt_t))
           or exists (select 1 from amdt_missing x
                      where x.congress in (((a.y - 1789) / 2 + 1)::text, ((a.y - 1790) / 2 + 1)::text)),
         null::numeric, null::text
  from (select left(d, 4)::integer as y from amdt where d is not null and d >= '1789-03-04') a
  group by a.y
  union all
  select 'congress_nominations_received', 'nation', 'US', left(n.received, 4), make_date(left(n.received, 4)::integer, 1, 1),
         make_date(left(n.received, 4)::integer, 12, 31), count(*)::numeric, null::numeric,
         insights.year_partial(left(n.received, 4)::integer, (select t from noms_t)), null::numeric, null::text
  from noms n where n.received is not null and n.received >= '1789-03-04'
  group by left(n.received, 4)
  union all
  select 'congress_nominations_confirmed', 'nation', 'US', left(n.confirmed, 4), make_date(left(n.confirmed, 4)::integer, 1, 1),
         make_date(left(n.confirmed, 4)::integer, 12, 31), count(*)::numeric, null::numeric,
         insights.year_partial(left(n.confirmed, 4)::integer, (select t from noms_t)), null::numeric, null::text
  from noms n where n.confirmed is not null and n.confirmed >= '1789-03-04'
  group by left(n.confirmed, 4)
  union all
  select 'congress_committee_reports_issued', 'nation', 'US', left(p.d, 4), make_date(left(p.d, 4)::integer, 1, 1),
         make_date(left(p.d, 4)::integer, 12, 31), count(*)::numeric, null::numeric,
         insights.year_partial(left(p.d, 4)::integer, (select t from rpt_t)), null::numeric, null::text
  from rpt p where p.d is not null and p.d >= '1789-03-04'
  group by left(p.d, 4)
  union all
  select 'congress_hearings_published', 'nation', 'US', c.y::text, make_date(c.y, 1, 1), make_date(c.y, 12, 31),
         count(*)::numeric, null::numeric,
         c.y >= extract(year from (now() at time zone 'America/New_York'))::integer - 1, null::numeric, null::text
  from chrg c group by c.y
  union all
  select m.metric, 'nation', 'US', left(v.d, 4), make_date(left(v.d, 4)::integer, 1, 1), make_date(left(v.d, 4)::integer, 12, 31),
         count(*)::numeric, null::numeric, insights.year_partial(left(v.d, 4)::integer, (select t from vers_t)), null::numeric,
         null::text
  from vers v
  join (values ('bill_text_versions_published', null::text), ('bill_enrolled_versions_published', 'enr')) m(metric, code)
    on m.code is null or m.code = v.code
  where v.d is not null and v.d >= '1789-03-04'
  group by m.metric, left(v.d, 4)
  union all
  select 'company_10k_mdls_mentioned', 'company', k.cik, k.period, insights.t12_start(k.period::date), k.period::date,
         (select count(distinct (x.value ->> 'mdl_number')) from jsonb_array_elements(insights.jarr(k.mentions)) x
           where x.value ->> 'mdl_number' ~ '^[0-9]{1,4}$')::numeric,
         null::numeric, false, null::numeric, null::text
  from tenk k where k.read
$$;

create or replace function insights.refresh_government2(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('government2', p_trigger) $$;

revoke all on function insights.facts_government2() from public, anon, authenticated;
revoke all on function insights.refresh_government2(text) from public, anon, authenticated;
grant execute on function insights.facts_government2() to service_role;
grant execute on function insights.refresh_government2(text) to service_role;

commit;
