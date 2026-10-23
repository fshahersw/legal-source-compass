-- insights/safety2 — product-signal metrics over the safety/1 schema (database/contracts/safety-signals-v1.sql).
--
-- Registers the metric family `safety2` in the insights layer (insights-v1.sql; contract src/lib/insights/contract.ts) and
-- its deterministic refresh function insights.facts_safety2(). Requires insights-v1.sql and safety-signals-v1.sql applied
-- first. Every value is a count the source gives, or a deterministic sum, share or difference of such counts; a value the
-- data cannot give is NULL with a reason. Facts are emitted only for entities already in the spine (nation US; MDLs by
-- their JPML number), so the family never invents an entity. A period not fully covered by the source data is partial.
--
-- Reading rule carried by every adverse-event and device-report metric (caveats): FAERS and MAUDE reports are voluntary,
-- unverified submissions; a report that lists a product is not proof that the product caused the event, report volume
-- follows publicity and litigation, and counts change as FDA merges and revises reports.
--
-- Idempotent: the family, the registry rows (upsert by id) and create or replace functions. Apply, then
-- `select insights.refresh_safety2('initial');`. The scheduled ingestion refreshes it through
-- insights.refresh_for_datasets(...) whenever one of the family's catalog datasets is named by a run.
-- Offline test: node --test scripts/safety_v2/insights-safety2.test.mjs (pglite, synthetic rows).

begin;

insert into insights.families (id, ordinal, datasets, dataset_patterns, description) values
  ('safety2', 85, array['safety_mdl_products', 'safety_faers_products', 'safety_maude_products', 'safety_cfpb_companies',
     'mdls'], '{}', 'Product signals: FAERS / MAUDE / CAERS / NHTSA series of MDL-named products, national report mix, NHTSA complaints, CFPB concentration, OSHA citations (safety/1)')
on conflict (id) do update set ordinal = excluded.ordinal, datasets = excluded.datasets,
  dataset_patterns = excluded.dataset_patterns, description = excluded.description;

insert into insights.metrics (id, family, ordinal, label, description, unit, format, topic, entity_types, period_type,
  source_datasets, source_links, numerator, denominator, method, caveats, direction) values
('mdl_product_reports', 'safety2', 8500, 'Reports naming an MDL''s products',
 'Adverse-event reports (FAERS for drugs, CAERS for foods and cosmetics), medical device reports (MAUDE) or NHTSA vehicle complaints that match the product the MDL''s JPML title names, by calendar year of receipt.',
 'reports', 'count', 'safety', array['mdl'], 'year', array['safety_mdl_products'],
 '[{"label": "openFDA drug adverse events (FAERS)", "url": "https://open.fda.gov/apis/drug/event/"}, {"label": "openFDA device adverse events (MAUDE)", "url": "https://open.fda.gov/apis/device/event/"}, {"label": "NHTSA complaint flat files", "url": "https://www.nhtsa.gov/nhtsa-datasets-and-apis"}]',
 'Reports received in the year whose product matches the MDL group''s stored search (safety.subjects.search; the title tokens and basis are on the MDL link)', null,
 'Sum of the stored monthly counts (safety.series: faers_reports, maude_reports, caers_reports or nhtsa_complaints of subject mdl:<n>) over the calendar year; the year is partial when the source data end before December.',
 array['Reports are voluntary, unverified submissions; a report listing the product is not proof that the product caused the event.',
       'Report volume follows publicity, recalls and litigation (stimulated reporting); a rise is not an incidence rate.',
       'FAERS coverage in openFDA starts in 2004; MAUDE starts in the 1990s; NHTSA complaints are stored from 2020.',
       'The product match follows the JPML title only (see the MDL link''s basis), so a search can be narrower or broader than the litigation.'],
 'higher_is_more'),
('mdl_product_reports_change_pct', 'safety2', 8510, 'Change in reports naming an MDL''s products, last 12 months',
 'Percent change in matching reports received in the 12 complete months to the end of the source data, against the 12 months before.',
 'percent', 'percent', 'safety', array['mdl'], 'twelve_months_ending', array['safety_mdl_products'],
 '[{"label": "openFDA drug adverse events (FAERS)", "url": "https://open.fda.gov/apis/drug/event/"}, {"label": "openFDA device adverse events (MAUDE)", "url": "https://open.fda.gov/apis/device/event/"}]',
 'Reports in the latest 12 complete months minus reports in the 12 months before', 'Reports in the 12 months before',
 '(sum of the last 12 stored months − sum of the 12 before) ÷ sum of the 12 before × 100, from the MDL group''s main series; NULL when the window holds fewer than 24 months or the earlier 12 months hold no report.',
 array['Reports are voluntary, unverified submissions; a report listing the product is not proof that the product caused the event.',
       'Litigation advertising and news coverage raise reporting; a change in reports is not a change in risk.'],
 'neutral'),
('mdl_faers_serious_share', 'safety2', 8520, 'Serious share of FAERS reports naming an MDL''s drug',
 'Share of the FAERS reports matching the MDL''s drug (or drug class) that the reporter marked serious, by calendar year of receipt.',
 'percent of reports', 'percent', 'safety', array['mdl'], 'year', array['safety_mdl_products'],
 '[{"label": "openFDA drug adverse events (FAERS)", "url": "https://open.fda.gov/apis/drug/event/"}]',
 'FAERS reports with serious = 1', 'All matching FAERS reports in the year',
 'Sum of the year''s faers_serious months ÷ sum of its faers_reports months × 100; NULL when the year has no report.',
 array['Reports are voluntary, unverified submissions; a report listing the drug is not proof that the drug caused the event.',
       'Seriousness is the reporter''s classification (death, hospitalization, life-threatening, disability, congenital anomaly or other medically important condition), not an FDA finding.'],
 'neutral'),
('mdl_maude_death_injury_share', 'safety2', 8530, 'Death or injury share of MAUDE reports naming an MDL''s device',
 'Share of the MAUDE reports matching the MDL''s device whose event type is Death or Injury, by calendar year of receipt.',
 'percent of reports', 'percent', 'safety', array['mdl'], 'year', array['safety_mdl_products'],
 '[{"label": "openFDA device adverse events (MAUDE)", "url": "https://open.fda.gov/apis/device/event/"}]',
 'MAUDE reports with event type Death or Injury', 'All matching MAUDE reports in the year',
 '(Sum of the year''s maude_death + maude_injury months) ÷ sum of its maude_reports months × 100; NULL when the year has no report.',
 array['A medical device report does not establish that the device caused or contributed to the event.',
       'The event type is the reporter''s classification.'],
 'neutral'),
('mdl_months_first_report_to_transfer', 'safety2', 8540, 'Months from the first report to MDL centralization',
 'Months between the first calendar month with a report matching the MDL''s product (in the stored openFDA / NHTSA window) and the month the JPML centralized the MDL.',
 'months', 'months', 'safety', array['mdl'], 'snapshot', array['safety_mdl_products', 'mdls'],
 '[{"label": "JPML pending MDL reports", "url": "https://www.jpml.uscourts.gov/pending-mdl-reports-archive"}, {"label": "openFDA", "url": "https://open.fda.gov/"}]',
 'Months from the first matching report month to the transfer month', null,
 '12 × (transfer year − first-report year) + (transfer month − first-report month); the snapshot date is the JPML transfer date of the mdls record. NULL when the first stored month is the start of the source window (the product''s reports may predate it) or the MDL has no recorded transfer date.',
 array['A first report is not a safety signal and not proof of harm: it marks when matching reports begin in the public data.',
       'FAERS data in openFDA start in 2004, MAUDE in the 1990s, NHTSA complaints are stored from 2020: earlier reports are not visible here.'],
 'neutral'),
('mdl_months_first_recall_to_transfer', 'safety2', 8550, 'Months from the first FDA recall record to MDL centralization',
 'Months between the first month with an FDA enforcement report or device recall matching the MDL''s product and the JPML transfer month (negative when the first recall record came after centralization).',
 'months', 'months', 'safety', array['mdl'], 'snapshot', array['safety_mdl_products', 'mdls'],
 '[{"label": "openFDA enforcement reports", "url": "https://open.fda.gov/apis/drug/enforcement/"}, {"label": "openFDA device recalls", "url": "https://open.fda.gov/apis/device/recall/"}]',
 'Months from the first matching recall record month to the transfer month', null,
 'From the stored enforcement_reports and device_recalls series of the MDL group: first month with a record; 12 × year difference + month difference to the JPML transfer date. NULL when no matching record exists in the windows (enforcement reports from 2012-06, device recalls from 1997) or no transfer date is recorded.',
 array['Enforcement reports in openFDA start in June 2012; an earlier recall is not visible in that series.',
       'A recall record matches the product by the title''s terms; one recall event can list several products.'],
 'neutral'),
('faers_serious_share_national', 'safety2', 8560, 'Serious share of all FAERS reports',
 'Share of all FAERS reports (openFDA) received in the year that the reporter marked serious.',
 'percent of reports', 'percent', 'safety', array['nation'], 'year', array['safety_faers_products'],
 '[{"label": "openFDA drug adverse events (FAERS)", "url": "https://open.fda.gov/apis/drug/event/"}]',
 'FAERS reports with serious = 1', 'All FAERS reports in the year',
 'Sum of national:faers faers_serious months ÷ sum of its faers_reports months × 100.',
 array['Reports are voluntary, unverified submissions and are not proof of causation.', 'The latest year is partial until December data are in openFDA.'],
 'neutral'),
('maude_death_injury_share_national', 'safety2', 8570, 'Death or injury share of all MAUDE reports',
 'Share of all MAUDE medical device reports received in the year with event type Death or Injury.',
 'percent of reports', 'percent', 'safety', array['nation'], 'year', array['safety_maude_products'],
 '[{"label": "openFDA device adverse events (MAUDE)", "url": "https://open.fda.gov/apis/device/event/"}]',
 'MAUDE reports with event type Death or Injury', 'All MAUDE reports in the year',
 '(national:maude maude_death + maude_injury) ÷ maude_reports for the year × 100.',
 array['A device report does not establish that the device caused or contributed to the event.',
       'Summary and alternative reporting programs move report volume between years.'],
 'neutral'),
('nhtsa_complaints_crash_fire_share', 'safety2', 8580, 'NHTSA vehicle complaints reporting a crash or fire',
 'Share of NHTSA ODI complaints received in the year that report a crash or a fire.',
 'percent of complaints', 'percent', 'safety', array['nation'], 'year', array['safety_mdl_products'],
 '[{"label": "NHTSA complaint flat files", "url": "https://www.nhtsa.gov/nhtsa-datasets-and-apis"}]',
 'Complaints with crash = Y or fire = Y', 'All complaints received in the year (stored from 2020)',
 'Count over safety.nhtsa_complaints by received year.',
 array['Complaints are submitted by owners and others and are not verified by NHTSA; a complaint does not establish a defect.',
       'The latest year is partial.'],
 'neutral'),
('cfpb_top3_company_share', 'safety2', 8590, 'CFPB complaints sent to the three most-complained-about companies',
 'Share of the CFPB complaints received in the year that went to the three companies with the most complaints that year.',
 'percent of complaints', 'percent', 'companies', array['nation'], 'year', array['safety_cfpb_companies'],
 '[{"label": "CFPB Consumer Complaint Database", "url": "https://www.consumerfinance.gov/data-research/consumer-complaints/"}]',
 'Complaints to the year''s three largest companies (by complaints)', 'All complaints received in the year',
 'From safety.cfpb_monthly: per year, the three company totals with the most complaints ÷ the year''s total × 100.',
 array['Complaints are not verified by the CFPB; volume reflects consumer use of the system as well as company conduct.',
       'Credit-reporting complaints dominate recent years.'],
 'neutral'),
('osha_inspections_with_citations_share', 'safety2', 8600, 'OSHA inspections with at least one citation',
 'Share of OSHA inspections opened in the year (federal and state-plan, as in the DOL catalog) with at least one stored citation that is not deleted.',
 'percent of inspections', 'percent', 'enforcement', array['nation'], 'year', array['safety_mdl_products'],
 '[{"label": "DOL OSHA enforcement data catalog", "url": "https://enforcedata.dol.gov/views/data_catalogs.php"}]',
 'Inspections opened in the year with a citation', 'Inspections opened in the year',
 'From safety.osha_inspections and safety.osha_violations (stored from the build''s --since date).',
 array['Citations can be issued, contested and deleted after the inspection opens: recent years rise as cases close.',
       'Deleted citations are not stored.'],
 'neutral')
on conflict (id) do update set family = excluded.family, ordinal = excluded.ordinal, label = excluded.label,
  description = excluded.description, unit = excluded.unit, format = excluded.format, topic = excluded.topic,
  entity_types = excluded.entity_types, period_type = excluded.period_type, source_datasets = excluded.source_datasets,
  source_links = excluded.source_links, numerator = excluded.numerator, denominator = excluded.denominator,
  method = excluded.method, caveats = excluded.caveats, direction = excluded.direction;

-- one stored monthly series as (year, value, months covered)
create or replace function insights.safety2_years(p_from date, p_vals integer[])
returns table (y integer, v bigint, months integer)
language sql immutable set search_path = '' as $$
  select extract(year from (p_from + make_interval(months => (x.i - 1)::integer)))::integer, sum(x.v)::bigint, count(*)::integer
    from unnest(p_vals) with ordinality x(v, i) group by 1
$$;

create or replace function insights.facts_safety2() returns setof insights.fact_row
language plpgsql stable set search_path = '' as $$
begin
  if to_regclass('safety.series') is null then return; end if;
  return query
  with groups as (
    select (regexp_match(s.id, '^mdl:([0-9]{1,5})$'))[1] as mdl, s.id as sid
      from safety.subjects s
     where s.subject_type = 'mdl_group'
       and exists (select 1 from insights.entities e where e.entity_type = 'mdl' and e.entity_id = (regexp_match(s.id, '^mdl:([0-9]{1,5})$'))[1])),
  main as (
    select distinct on (g.mdl) g.mdl, t.series, t.coverage_from, t.coverage_to, t.vals
      from groups g join safety.series t on t.subject_id = g.sid
     where t.series in ('faers_reports', 'maude_reports', 'caers_reports', 'nhtsa_complaints')
     order by g.mdl, array_position(array['faers_reports', 'maude_reports', 'caers_reports', 'nhtsa_complaints'], t.series)),
  yearly as (
    select m.mdl, y.y, y.v, (y.y < extract(year from m.coverage_to) or extract(month from m.coverage_to) = 12) as full_year
      from main m cross join lateral insights.safety2_years(m.coverage_from, m.vals) y),
  ratio as (
    select g.mdl, num.series as num_series, a.y, a.v as total, sum(b.v) as part,
           (a.y < extract(year from t.coverage_to) or extract(month from t.coverage_to) = 12) as full_year
      from groups g
      join safety.series t on t.subject_id = g.sid
      cross join lateral insights.safety2_years(t.coverage_from, t.vals) a
      join lateral (values ('faers_serious', 'faers_reports'), ('maude_death', 'maude_reports'), ('maude_injury', 'maude_reports')) num(series, base)
        on num.base = t.series
      join safety.series p on p.subject_id = g.sid and p.series = num.series
      cross join lateral insights.safety2_years(p.coverage_from, p.vals) b
     where b.y = a.y
     group by g.mdl, num.series, a.y, a.v, t.coverage_to),
  transfer as (
    select r.id as mdl, insights.iso_date(r.item ->> 'date_transferred')::date as d
      from public.corpus_records r where r.dataset = 'mdls' and r.id ~ '^[0-9]{1,5}$'),
  firsts as (
    -- the stored window starts at the group's first report month, or at the source's floor when reports reach back to it
    select m.mdl, m.coverage_from as first_month,
           case m.series when 'maude_reports' then date '1991-01-01' when 'nhtsa_complaints' then date '2020-01-01'
                         else date '2004-01-01' end as floor_month
      from main m),
  recalls as (
    select g.mdl, min((t.coverage_from + make_interval(months => (x.i - 1)::integer))::date) filter (where x.v > 0) as first_recall
      from groups g join safety.series t on t.subject_id = g.sid
      cross join lateral unnest(t.vals) with ordinality x(v, i)
     where t.series in ('enforcement_reports', 'device_recalls')
     group by g.mdl),
  national as (
    select t.subject_id, t.series, t.coverage_to, y.y, y.v
      from safety.series t cross join lateral insights.safety2_years(t.coverage_from, t.vals) y
     where t.subject_id in ('national:faers', 'national:maude')),
  nat_ratio as (
    select a.subject_id, a.y, a.v as total, sum(b.v) as part,
           (a.y < extract(year from a.coverage_to) or extract(month from a.coverage_to) = 12) as full_year
      from national a join national b on b.subject_id = a.subject_id and b.y = a.y
       and b.series = any (case a.subject_id when 'national:faers' then array['faers_serious'] else array['maude_death', 'maude_injury'] end)
     where a.series in ('faers_reports', 'maude_reports')
     group by a.subject_id, a.y, a.v, a.coverage_to),
  cfpb as (
    select extract(year from m.month)::integer as y, m.company_id, sum(m.complaints) as n, max(m.month) as last_month
      from safety.cfpb_monthly m group by 1, 2),
  cfpb_y as (
    select c.y, sum(c.n) as total,
           (select sum(t.n) from (select c2.n from cfpb c2 where c2.y = c.y order by c2.n desc limit 3) t) as top3,
           max(c.last_month) as last_month
      from cfpb c group by c.y),
  osha as (
    select extract(year from i.open_date)::integer as y, count(*) as n,
           count(*) filter (where exists (select 1 from safety.osha_violations v where v.activity_nr = i.activity_nr)) as cited,
           max(i.open_date) as last_open
      from safety.osha_inspections i where i.open_date is not null group by 1),
  nhtsa as (
    select extract(year from c.received)::integer as y, count(*) as n, count(*) filter (where c.crash or c.fire) as hit,
           max(c.received) as last_received
      from safety.nhtsa_complaints c where c.received is not null group by 1)
  -- reports per MDL group and year
  select 'mdl_product_reports'::text, 'mdl'::text, yy.mdl, yy.y::text, make_date(yy.y, 1, 1), make_date(yy.y, 12, 31),
         yy.v::numeric, null::numeric, not yy.full_year, null::numeric, null::text
    from yearly yy
  union all
  -- 12-month change
  select 'mdl_product_reports_change_pct', 'mdl', m.mdl,
         to_char((m.coverage_to + interval '1 month' - interval '1 day')::date, 'YYYY-MM-DD'),
         (m.coverage_to - interval '11 months')::date, (m.coverage_to + interval '1 month' - interval '1 day')::date,
         case when cardinality(m.vals) >= 24 and (select sum(v) from unnest(m.vals[cardinality(m.vals) - 23:cardinality(m.vals) - 12]) v) > 0
              then round(((select sum(v) from unnest(m.vals[cardinality(m.vals) - 11:cardinality(m.vals)]) v)
                          - (select sum(v) from unnest(m.vals[cardinality(m.vals) - 23:cardinality(m.vals) - 12]) v))::numeric * 100
                         / (select sum(v) from unnest(m.vals[cardinality(m.vals) - 23:cardinality(m.vals) - 12]) v), 1) end,
         null::numeric, false,
         case when cardinality(m.vals) >= 24 then (select sum(v) from unnest(m.vals[cardinality(m.vals) - 11:cardinality(m.vals)]) v) end,
         case when cardinality(m.vals) < 24 then 'Fewer than 24 months of reports in the stored window.'
              when (select sum(v) from unnest(m.vals[cardinality(m.vals) - 23:cardinality(m.vals) - 12]) v) = 0
                then 'No reports in the earlier 12 months, so no percent change.' end
    from main m
  union all
  -- serious share (FAERS) and death-or-injury share (MAUDE)
  select case when r.num_series = 'faers_serious' then 'mdl_faers_serious_share' else 'mdl_maude_death_injury_share' end,
         'mdl', r.mdl, r.y::text, make_date(r.y, 1, 1), make_date(r.y, 12, 31),
         case when r.total > 0 then round(sum(r.part)::numeric * 100 / r.total, 1) end, null::numeric, not r.full_year, r.total::numeric,
         case when r.total > 0 then null else 'No matching report in the year.' end
    from ratio r
   group by r.mdl, case when r.num_series = 'faers_serious' then 'mdl_faers_serious_share' else 'mdl_maude_death_injury_share' end,
            r.y, r.total, r.full_year
  union all
  -- months from the first stored report to the JPML transfer
  select 'mdl_months_first_report_to_transfer', 'mdl', f.mdl, to_char(t.d, 'YYYY-MM-DD'), t.d, t.d,
         case when f.first_month > f.floor_month
              then ((extract(year from t.d) - extract(year from f.first_month)) * 12 + extract(month from t.d) - extract(month from f.first_month))::numeric end,
         null::numeric, false, null::numeric,
         case when f.first_month > f.floor_month then null
              else 'Matching reports reach back to the start of the source window (' || to_char(f.floor_month, 'YYYY-MM') || '); earlier reports are not visible.' end
    from firsts f join transfer t on t.mdl = f.mdl
   where t.d is not null
  union all
  select 'mdl_months_first_recall_to_transfer', 'mdl', g.mdl, to_char(t.d, 'YYYY-MM-DD'), t.d, t.d,
         case when r.first_recall is not null
              then ((extract(year from t.d) - extract(year from r.first_recall)) * 12 + extract(month from t.d) - extract(month from r.first_recall))::numeric end,
         null::numeric, false, null::numeric,
         case when r.first_recall is null then 'No FDA enforcement report or device recall matching the product in the stored windows.' end
    from (select distinct mdl from groups) g join transfer t on t.mdl = g.mdl
    left join recalls r on r.mdl = g.mdl
   where t.d is not null
     and exists (select 1 from safety.series x join groups gg on gg.sid = x.subject_id
                  where gg.mdl = g.mdl and x.series in ('enforcement_reports', 'device_recalls'))
  union all
  select case n.subject_id when 'national:faers' then 'faers_serious_share_national' else 'maude_death_injury_share_national' end,
         'nation', 'US', n.y::text, make_date(n.y, 1, 1), make_date(n.y, 12, 31),
         case when n.total > 0 then round(n.part::numeric * 100 / n.total, 1) end, null::numeric, not n.full_year, n.total::numeric,
         case when n.total > 0 then null else 'No report in the year.' end
    from nat_ratio n
  union all
  select 'nhtsa_complaints_crash_fire_share', 'nation', 'US', h.y::text, make_date(h.y, 1, 1), make_date(h.y, 12, 31),
         round(h.hit::numeric * 100 / h.n, 1), null::numeric, h.last_received < make_date(h.y, 12, 31), h.n::numeric, null::text
    from nhtsa h where h.n > 0
  union all
  select 'cfpb_top3_company_share', 'nation', 'US', c.y::text, make_date(c.y, 1, 1), make_date(c.y, 12, 31),
         round(c.top3::numeric * 100 / c.total, 1), null::numeric, c.last_month < make_date(c.y, 12, 1), c.total::numeric, null::text
    from cfpb_y c where c.total > 0
  union all
  select 'osha_inspections_with_citations_share', 'nation', 'US', o.y::text, make_date(o.y, 1, 1), make_date(o.y, 12, 31),
         round(o.cited::numeric * 100 / o.n, 1), null::numeric, o.last_open < make_date(o.y, 12, 31), o.n::numeric, null::text
    from osha o where o.n > 0;
end $$;

create or replace function insights.refresh_safety2(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('safety2', p_trigger) $$;

revoke all on function insights.safety2_years(date, integer[]) from public, anon, authenticated;
revoke all on function insights.facts_safety2() from public, anon, authenticated;
revoke all on function insights.refresh_safety2(text) from public, anon, authenticated;
grant execute on function insights.safety2_years(date, integer[]) to service_role;
grant execute on function insights.facts_safety2() to service_role;
grant execute on function insights.refresh_safety2(text) to service_role;

commit;
