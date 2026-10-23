-- insights/1 family "economy" (api-econ, wave 1025): rates, prices, wages, unemployment and the jury-eligible
-- population, computed from the api-econ datasets. Registration only; nothing in insights-v1.sql is changed.
--
-- Apply AFTER database/contracts/insights-v1.sql (it uses insights.fact_row, insights.jnum/jarr/jobj, insights.month_end,
-- insights.run_family and the entity spine). Idempotent: the family and metric rows are upserted by id, functions are
-- create or replace. Then:  select insights.refresh_economy('initial');
-- The family reads econ_fred_observations, econ_bls_oews, econ_ssa_awi and census_acs_cvap_counties, so the scheduled
-- FRED refresh (public.ingest_refresh_insights_v1 → insights.refresh_for_datasets) re-runs it after new observations land.
--
-- Rules (insights/1): every value is the number the source publishes, or a deterministic ratio of published numbers
-- (CPI 12-month change, citizen share of the population); a value the source does not give is NULL with a reason, never
-- 0; facts are staged only for entities already in the spine (nation US, states by USPS code, counties by FIPS code).
-- Offline test: scripts/api_econ/insights-economy-contract.test.mjs (pglite).

begin;

insert into insights.families (id, ordinal, datasets, dataset_patterns, description) values
  ('economy', 120, array['econ_fred_observations', 'econ_bls_oews', 'econ_ssa_awi', 'census_acs_cvap_counties'], '{}',
   'Interest rates, prices, wages, unemployment and the citizen voting-age population')
on conflict (id) do update set ordinal = excluded.ordinal, datasets = excluded.datasets,
  dataset_patterns = excluded.dataset_patterns, description = excluded.description;

insert into insights.metrics (id, family, ordinal, label, description, unit, format, topic, entity_types, period_type,
  source_datasets, source_links, numerator, denominator, method, caveats, direction) values
('econ_unemployment_rate', 'economy', 12000, 'Unemployment rate (seasonally adjusted)',
 'Unemployment rate, seasonally adjusted: national (Current Population Survey) and state (Local Area Unemployment Statistics), as published by BLS.',
 'percent of the labor force', 'percent', 'places', array['nation', 'state'], 'month', array['econ_fred_observations'],
 '[{"label": "BLS Local Area Unemployment Statistics", "url": "https://www.bls.gov/lau/"}, {"label": "FRED (UNRATE and <state>UR series)", "url": "https://fred.stlouisfed.org/series/UNRATE"}]',
 'Unemployment rate for the month as currently published', null,
 'Value as published (current vintage in FRED: UNRATE for the nation, <USPS>UR for each state).',
 array['Seasonally adjusted values are revised each year; the current vintage is shown.',
       'BLS published no estimates for October 2025 (lapse in appropriations); that month has no value.'],
 'higher_is_more'),
('econ_cpi_u_index', 'economy', 12010, 'Consumer Price Index (CPI-U, all items)',
 'Consumer Price Index for All Urban Consumers, all items, U.S. city average, not seasonally adjusted (BLS CUUR0000SA0, FRED CPIAUCNS).',
 'index, 1982-84 = 100', 'ratio', 'places', array['nation'], 'month', array['econ_fred_observations'],
 '[{"label": "BLS Consumer Price Index", "url": "https://www.bls.gov/cpi/"}, {"label": "FRED CPIAUCNS", "url": "https://fred.stlouisfed.org/series/CPIAUCNS"}]',
 'Index value for the month as published', null, 'Value as published.',
 array['Not seasonally adjusted; BLS does not revise it except to correct errors (the 2016 corrections are kept in the dataset).',
       'October 2025 was not published (lapse in appropriations).'],
 'neutral'),
('econ_cpi_u_change_12m', 'economy', 12020, 'Consumer prices, change over 12 months',
 'Percent change in the CPI-U (all items, not seasonally adjusted) from the same month a year earlier.',
 'percent', 'percent', 'places', array['nation'], 'month', array['econ_fred_observations'],
 '[{"label": "BLS Consumer Price Index", "url": "https://www.bls.gov/cpi/"}]',
 'CPI-U for the month', 'CPI-U for the same month of the previous year',
 '(index for the month ÷ index twelve months earlier − 1) × 100, rounded to one decimal place as BLS reports it.',
 array['No value where either month was not published.'],
 'higher_is_more'),
('econ_postjudgment_rate', 'economy', 12030, 'Federal post-judgment interest rate (28 U.S.C. § 1961)',
 'Weekly average 1-year constant maturity Treasury yield (Federal Reserve H.15, FRED WGS1YR), the rate 28 U.S.C. § 1961(a) applies to judgments entered in the following Monday-to-Sunday week.',
 'percent per year', 'percent', 'places', array['nation'], 'snapshot', array['econ_fred_observations'],
 '[{"label": "Federal Reserve H.15", "url": "https://www.federalreserve.gov/releases/h15/"}, {"label": "28 U.S.C. § 1961 (uscourts.gov)", "url": "https://www.uscourts.gov/28-usc-1961-post-judgment-interest-rates"}]',
 'Weekly average yield for the week ending on the period date (a Friday)', null,
 'Value as published; the period is the week-ending date (period start = the Saturday six days earlier).',
 array['Applies to judgments entered on or after December 21, 2000; earlier judgments used the 52-week Treasury bill auction yield.'],
 'neutral'),
('econ_treasury_10y', 'economy', 12040, '10-year Treasury yield (monthly average)',
 'Market yield on U.S. Treasury securities at 10-year constant maturity, monthly average (Federal Reserve H.15, FRED GS10).',
 'percent per year', 'percent', 'places', array['nation'], 'month', array['econ_fred_observations'],
 '[{"label": "FRED GS10", "url": "https://fred.stlouisfed.org/series/GS10"}]',
 'Monthly average yield as published', null, 'Value as published.', '{}', 'neutral'),
('econ_prime_rate', 'economy', 12050, 'Bank prime loan rate (monthly average)',
 'Bank prime loan rate, monthly average (Federal Reserve H.15, FRED MPRIME).',
 'percent per year', 'percent', 'places', array['nation'], 'month', array['econ_fred_observations'],
 '[{"label": "FRED MPRIME", "url": "https://fred.stlouisfed.org/series/MPRIME"}]',
 'Monthly average rate as published', null, 'Value as published.', '{}', 'neutral'),
('econ_avg_hourly_earnings', 'economy', 12060, 'Average hourly earnings, private employees',
 'Average hourly earnings of all employees, total private, seasonally adjusted (BLS Current Employment Statistics, FRED CES0500000003).',
 'dollars per hour', 'currency_usd', 'places', array['nation'], 'month', array['econ_fred_observations'],
 '[{"label": "FRED CES0500000003", "url": "https://fred.stlouisfed.org/series/CES0500000003"}]',
 'Average hourly earnings as published', null, 'Value as published (current vintage; recent months are revised by BLS).',
 array['Series begins March 2006.'], 'higher_is_more'),
('econ_oews_annual_median_wage', 'economy', 12070, 'Annual median wage, all occupations (OEWS)',
 'Annual median wage across all occupations and industries, BLS Occupational Employment and Wage Statistics (May estimates).',
 'dollars per year', 'currency_usd', 'places', array['nation', 'state'], 'year', array['econ_bls_oews'],
 '[{"label": "BLS OEWS", "url": "https://www.bls.gov/oes/"}]',
 'Annual median wage, all occupations, as published', null,
 'Value as published in BLS''s bulk time-series file (occupation 000000, industry 000000, data type 13).',
 array['May reference period; the period key is the survey year.', 'Excludes the self-employed.'],
 'higher_is_more'),
('econ_ssa_awi', 'economy', 12080, 'National average wage index (SSA)',
 'The Social Security Administration''s national average wage index for the year, as published in its annual Federal Register notice.',
 'dollars', 'currency_usd', 'places', array['nation'], 'year', array['econ_ssa_awi'],
 '[{"label": "SSA, national average wage index", "url": "https://www.ssa.gov/oact/cola/AWI.html"}]',
 'Index value as stated in the notice (the later notice''s value where SSA corrected it)', null, 'Value as published.',
 array['SSA corrected the 2009 and 2016 indexes in later notices; the corrected values are used.'], 'higher_is_more'),
('econ_cvap', 'economy', 12090, 'Citizens 18 and over (ACS 5-year)',
 'Citizen voting-age population, ACS 5-year table B29001: the population jurors are drawn from (28 U.S.C. § 1865(b)(1)).',
 'people', 'count', 'places', array['nation', 'state', 'county'], 'year', array['census_acs_cvap_counties'],
 '[{"label": "Census Bureau, ACS table B29001", "url": "https://data.census.gov/table/ACSDT5Y2024.B29001"}]',
 'Citizens aged 18 and over (B29001_001E) as published', null,
 'Value as published; the period key is the last year of the five-year release.',
 array['An estimate with a margin of error (stored as published).'], 'neutral'),
('econ_cvap_share', 'economy', 12100, 'Citizens 18 and over, share of the population',
 'Citizen voting-age population as a share of the total population, same ACS 5-year release.',
 'percent of the population', 'percent', 'places', array['nation', 'state', 'county'], 'year', array['census_acs_cvap_counties'],
 '[{"label": "Census Bureau, ACS tables B29001 and B01003", "url": "https://www.census.gov/programs-surveys/acs"}]',
 'Citizens aged 18 and over (B29001_001E)', 'Total population (B01003_001E), same release',
 'Numerator ÷ denominator × 100, rounded to one decimal place; no margin computed.',
 array['Both figures are estimates of the same five-year release.'], 'neutral')
on conflict (id) do update set family = excluded.family, ordinal = excluded.ordinal, label = excluded.label,
  description = excluded.description, unit = excluded.unit, format = excluded.format, topic = excluded.topic,
  entity_types = excluded.entity_types, period_type = excluded.period_type, source_datasets = excluded.source_datasets,
  source_links = excluded.source_links, numerator = excluded.numerator, denominator = excluded.denominator,
  method = excluded.method, caveats = excluded.caveats, direction = excluded.direction;

-- ------------------------------------------------------------------------------------------------ facts
create or replace function insights.facts_economy() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with fred as (
    -- every stored observation of the series this family reads: [date, value as text or null, vintage, ...]
    select split_part(r.id, ':', 2) as sid, o.e ->> 0 as d,
           case when jsonb_typeof(o.e -> 1) = 'string' then insights.jnum(o.e -> 1) end as v
    from public.corpus_records r
    cross join lateral jsonb_array_elements(insights.jarr(r.item -> 'fred' -> 'obs')) o(e)
    where r.dataset = 'econ_fred_observations'
      and r.id ~ '^fred:(UNRATE|CPIAUCNS|GS10|MPRIME|CES0500000003|WGS1YR|[A-Z]{2}UR):[0-9]{4}$'
      and jsonb_typeof(o.e) = 'array' and insights.iso_date(o.e ->> 0) is not null
  ), monthly (sid, metric, etype, eid) as (
    select m.sid, m.metric, 'nation', 'US' from (values ('UNRATE', 'econ_unemployment_rate'), ('CPIAUCNS', 'econ_cpi_u_index'),
      ('GS10', 'econ_treasury_10y'), ('MPRIME', 'econ_prime_rate'), ('CES0500000003', 'econ_avg_hourly_earnings')) m(sid, metric)
    union all
    select g.usps || 'UR', 'econ_unemployment_rate', 'state', g.usps
    from insights.geo_states g
    where exists (select 1 from insights.entities e where e.entity_type = 'state' and e.entity_id = g.usps)
  ), cpi as (
    select f.d::date as d, f.v from fred f where f.sid = 'CPIAUCNS' and f.d ~ '-01$'
  ), oews as (
    select case when r.item -> 'oews' ->> 'areatype' = 'N' then 'nation' else 'state' end as etype,
           case when r.item -> 'oews' ->> 'areatype' = 'N' then 'US' else r.item -> 'oews' ->> 'usps' end as eid,
           (r.item -> 'oews' ->> 'year')::integer as y,
           r.item -> 'oews' -> 'occupations' -> '000000' ->> 6 as raw
    from public.corpus_records r
    where r.dataset = 'econ_bls_oews' and r.id ~ '^oews:(N0000000|S[0-9]{7})$'
      and r.item -> 'oews' ->> 'year' ~ '^[0-9]{4}$'
  ), cvap as (
    select case r.item -> 'census' ->> 'level' when 'us' then 'nation' else r.item -> 'census' ->> 'level' end as etype,
           case r.item -> 'census' ->> 'level' when 'us' then 'US' when 'state' then r.item -> 'census' ->> 'usps' else r.id end as eid,
           y.key::integer as y, y.value -> 'estimate' as est, y.value -> 'moe' as moe
    from public.corpus_records r
    cross join lateral jsonb_each(insights.jobj(r.item -> 'census' -> 'years')) y
    where r.dataset = 'census_acs_cvap_counties' and y.key ~ '^[0-9]{4}$'
      and r.item -> 'census' ->> 'level' in ('us', 'state', 'county')
  )
  -- monthly series: the value as published, or no value with the reason
  select m.metric, m.etype, m.eid, left(f.d, 7), f.d::date, insights.month_end(left(f.d, 7)), f.v, null::numeric, false,
         null::numeric, case when f.v is null then 'No value was published for this month (FRED records ".").' end
  from fred f join monthly m on m.sid = f.sid
  where f.d ~ '-01$'
    and exists (select 1 from insights.entities e where e.entity_type = m.etype and e.entity_id = m.eid)
  union all
  -- CPI-U, 12-month percent change (both months published)
  select 'econ_cpi_u_change_12m', 'nation', 'US', to_char(c.d, 'YYYY-MM'), c.d, insights.month_end(to_char(c.d, 'YYYY-MM')),
         case when c.v is not null and p.v > 0 then round((c.v / p.v - 1) * 100, 1) end, null::numeric, false, null::numeric,
         case when c.v is null or p.v is null then 'The index was not published for this month or for the same month a year earlier.' end
  from cpi c join cpi p on p.d = (c.d - interval '12 months')::date
  where exists (select 1 from insights.entities e where e.entity_type = 'nation' and e.entity_id = 'US')
  union all
  -- weekly 1-year Treasury average (28 U.S.C. § 1961): keyed by the week-ending Friday
  select 'econ_postjudgment_rate', 'nation', 'US', f.d, f.d::date - 6, f.d::date, f.v, null::numeric, false, null::numeric,
         case when f.v is null then 'No weekly average was published for this week.' end
  from fred f
  where f.sid = 'WGS1YR'
    and exists (select 1 from insights.entities e where e.entity_type = 'nation' and e.entity_id = 'US')
  union all
  -- OEWS annual median wage, all occupations
  select 'econ_oews_annual_median_wage', o.etype, o.eid, o.y::text, make_date(o.y, 1, 1), make_date(o.y, 12, 31),
         insights.jnum(to_jsonb(o.raw)), null::numeric, false, null::numeric,
         case when insights.jnum(to_jsonb(o.raw)) is null then 'BLS did not release this estimate ("-" in the published file).' end
  from oews o
  where o.eid is not null and exists (select 1 from insights.entities e where e.entity_type = o.etype and e.entity_id = o.eid)
  union all
  -- SSA national average wage index
  select 'econ_ssa_awi', 'nation', 'US', r.item -> 'awi' ->> 'year', make_date((r.item -> 'awi' ->> 'year')::integer, 1, 1),
         make_date((r.item -> 'awi' ->> 'year')::integer, 12, 31), insights.jnum(r.item -> 'awi' -> 'value'), null::numeric, false,
         null::numeric, case when insights.jnum(r.item -> 'awi' -> 'value') is null then 'The notice''s value could not be read.' end
  from public.corpus_records r
  where r.dataset = 'econ_ssa_awi' and r.item -> 'awi' ->> 'year' ~ '^[0-9]{4}$'
    and exists (select 1 from insights.entities e where e.entity_type = 'nation' and e.entity_id = 'US')
  union all
  -- citizen voting-age population and its share of the population (ACS 5-year; period = last year of the release)
  select x.metric, c.etype, c.eid, c.y::text, make_date(c.y - 4, 1, 1), make_date(c.y, 12, 31), x.v,
         case when x.metric = 'econ_cvap' and x.v is not null and insights.jnum(c.moe -> 'cvap') >= 0
              then insights.jnum(c.moe -> 'cvap') end,
         false, case when x.metric = 'econ_cvap_share' and x.v is not null then insights.jnum(c.est -> 'cvap') end,
         case when x.v is null then 'The Census Bureau did not publish this figure for this geography and release.' end
  from cvap c
  cross join lateral (values
    ('econ_cvap', insights.jnum(c.est -> 'cvap')),
    ('econ_cvap_share', case when insights.jnum(c.est -> 'cvap') is not null and insights.jnum(c.est -> 'population') > 0
                             then round(insights.jnum(c.est -> 'cvap') * 100 / insights.jnum(c.est -> 'population'), 1) end)) x(metric, v)
  where c.eid is not null and exists (select 1 from insights.entities e where e.entity_type = c.etype and e.entity_id = c.eid)
$$;

create or replace function insights.refresh_economy(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('economy', p_trigger) $$;

do $grants$
begin
  revoke all on function insights.facts_economy() from public, anon, authenticated;
  grant execute on function insights.facts_economy() to service_role;
  revoke all on function insights.refresh_economy(text) from public, anon, authenticated;
  grant execute on function insights.refresh_economy(text) to service_role;
end $grants$;

commit;
