-- lawviz calendar, NHTSA and EPA series (v1). Apply AFTER database/contracts/lawviz-v1.sql. Idempotent; re-applying
-- replaces the same objects. LEAD applies; workers never run this against production.
--
-- Adds three event series to the enforcement calendar (/enforcement, EnforcementCalendar):
--   fr_345        Federal Register documents listing NHTSA (agency id 345)      agency view: nhtsa
--   fr_145        Federal Register documents listing the EPA (agency id 145)    agency view: epa
--   nhtsa_recalls NHTSA recall campaigns by report date (agency_safety_nhtsa_recalls, filters.date)
--                                                                               agency views: all, nhtsa
-- The calendar's coverage rule is unchanged: a day outside a series' first..last window is "not recorded", not 0, and
-- records without a date (or dated after the refresh day) are counted as undated.
--
-- Objects:
--   lawviz.refresh_calendar_extra(p_build text)   writes only these three series (event_series + daily_events)
--   public.lawviz_refresh_v1(text, text)           same as lawviz-v1, plus the extra series after the calendar family
--   public.lawviz_calendar_v1(text, integer)       same as lawviz-v1, plus the 'nhtsa' and 'epa' agency views
-- Privileges: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
--
-- Apply and verify (LEAD):
--   \i database/contracts/lawviz-calendar-nhtsa-epa-v1.sql
--   select public.lawviz_refresh_v1('n20261027', 'calendar');
--   select series, first_day, last_day, total, undated from lawviz.event_series
--     where series in ('fr_345', 'fr_145', 'nhtsa_recalls');
--   -- expected: fr_345 and fr_145 from 1994; nhtsa_recalls 2010-01-01..2026-10-09, total 15,319, undated 0
--   -- (read-only check of the source on 2026-10-27: 15,319 recalls, every one with filters.date)
--   select public.lawviz_calendar_v1('nhtsa', 2026) -> 'series';
-- Then add { id: "nhtsa", label: "NHTSA" } and { id: "epa", label: "EPA" } to AGENCIES in src/lib/lawviz/calendar.ts
-- (the page shows them only once this contract is applied).

begin;

create or replace function lawviz.refresh_calendar_extra(p_build text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_del integer; n_rows integer; v_today date := current_date;
  v_series text[] := array['fr_345', 'fr_145', 'nhtsa_recalls'];
begin
  with d as (delete from lawviz.daily_events where series = any (v_series) returning 1)
  select count(*) into n_del from d;

  insert into lawviz.event_series (series, label, unit, agencies, ord, datasets, source_label, source_url, build)
  values
    ('fr_345', 'Federal Register documents listing NHTSA', 'documents', array['nhtsa'], 7,
     array['federal_register_history'], 'Federal Register',
     'https://www.federalregister.gov/agencies/national-highway-traffic-safety-administration', p_build),
    ('fr_145', 'Federal Register documents listing the EPA', 'documents', array['epa'], 8,
     array['federal_register_history'], 'Federal Register',
     'https://www.federalregister.gov/agencies/environmental-protection-agency', p_build),
    ('nhtsa_recalls', 'NHTSA recall campaigns', 'recalls', array['all', 'nhtsa'], 11,
     array['agency_safety_nhtsa_recalls'], 'NHTSA recalls', 'https://www.nhtsa.gov/recalls', p_build)
  on conflict (series) do update set label = excluded.label, unit = excluded.unit, agencies = excluded.agencies,
    ord = excluded.ord, datasets = excluded.datasets, source_label = excluded.source_label,
    source_url = excluded.source_url, build = excluded.build;

  with ev as (
    select 'fr_' || a as series, lawviz.iso_date(r.item -> 'cells' ->> 'published') as day
    from public.corpus_records r
    cross join lateral jsonb_array_elements_text(lawviz.arr(r.filters -> 'agency')) a
    where r.dataset = 'federal_register_history'
      and (r.filters @> '{"agency":["345"]}'::jsonb or r.filters @> '{"agency":["145"]}'::jsonb)
      and a in ('345', '145')
    union all
    select 'nhtsa_recalls', lawviz.iso_date(r.filters ->> 'date')
    from public.corpus_records r where r.dataset = 'agency_safety_nhtsa_recalls'
  ), counted as materialized (
    select ev.series, ev.day, count(*) as n from ev group by ev.series, ev.day
  ), upd as (
    update lawviz.event_series es
    set first_day = x.first_day, last_day = x.last_day, total = coalesce(x.total, 0), undated = coalesce(u.undated, 0)
    from (select c.series from counted c group by c.series) k
    left join (select c.series, min(c.day) as first_day, max(c.day) as last_day, sum(c.n) as total
               from counted c where c.day is not null and c.day <= v_today group by c.series) x on x.series = k.series
    left join (select c.series, sum(c.n) as undated
               from counted c where c.day is null or c.day > v_today group by c.series) u on u.series = k.series
    where es.series = k.series
    returning 1
  )
  insert into lawviz.daily_events (series, day, n)
  select c.series, c.day, c.n::integer from counted c where c.day is not null and c.day <= v_today;
  get diagnostics n_rows = row_count;

  update lawviz.event_series es set first_day = null, last_day = null, total = 0
  where es.series = any (v_series)
    and not exists (select 1 from lawviz.daily_events d where d.series = es.series);
  return jsonb_build_object('family', 'calendar_extra', 'build', p_build, 'replaced', n_del, 'day_rows', n_rows);
end $$;

create or replace function public.lawviz_refresh_v1(p_build text, p_family text default 'all') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb;
begin
  if p_build is null or p_build !~ '^[a-z0-9_.-]{1,40}$' then
    raise exception 'lawviz: build id must match ^[a-z0-9_.-]{1,40}$';
  end if;
  if p_family not in ('all', 'usc', 'cfr', 'bills', 'calendar') then
    raise exception 'lawviz: unknown family %', p_family;
  end if;
  if p_family in ('all', 'usc') then out := out || jsonb_build_array(lawviz.refresh_usc(p_build)); end if;
  if p_family in ('all', 'cfr') then out := out || jsonb_build_array(lawviz.refresh_cfr(p_build)); end if;
  if p_family in ('all', 'bills') then out := out || jsonb_build_array(lawviz.refresh_bills(p_build)); end if;
  if p_family in ('all', 'calendar') then
    out := out || jsonb_build_array(lawviz.refresh_calendar(p_build));
    out := out || jsonb_build_array(lawviz.refresh_calendar_extra(p_build));
  end if;
  return jsonb_build_object('build', p_build, 'families', out);
end $$;

-- Enforcement calendar: the agency view's series, its days in one year, and monthly totals for every year.
create or replace function public.lawviz_calendar_v1(p_agency text, p_year integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_series text[];
begin
  if p_agency is null or p_agency not in ('all', 'cpsc', 'fda', 'sec', 'ftc', 'doj', 'nhtsa', 'epa')
     or p_year is null or p_year < 1950 or p_year > 2100 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select coalesce(array_agg(series order by ord), '{}') into v_series
  from lawviz.event_series where p_agency = any (agencies);
  if coalesce(array_length(v_series, 1), 0) = 0 then
    return jsonb_build_object('status', 'empty', 'built', lawviz.built('calendar'));
  end if;
  return jsonb_build_object(
    'status', 'ok', 'agency', p_agency, 'year', p_year,
    'series', (select jsonb_agg(jsonb_build_array(es.series, es.label, es.unit, es.first_day, es.last_day, es.total,
                                                  es.undated, es.source_label, es.source_url, es.datasets)
                                order by es.ord)
               from lawviz.event_series es where es.series = any (v_series)),
    'days', (select coalesce(jsonb_agg(jsonb_build_array(d.series, d.day, d.n) order by d.series, d.day), '[]'::jsonb)
             from lawviz.daily_events d
             where d.series = any (v_series) and d.day >= make_date(p_year, 1, 1) and d.day < make_date(p_year + 1, 1, 1)),
    'months', (select coalesce(jsonb_agg(jsonb_build_array(series, m, n) order by series, m), '[]'::jsonb)
               from (select d.series, to_char(d.day, 'YYYY-MM') as m, sum(d.n) as n
                     from lawviz.daily_events d where d.series = any (v_series) group by 1, 2) x),
    'built', lawviz.built('calendar'));
end $$;

revoke all on function lawviz.refresh_calendar_extra(text) from public, anon, authenticated;
revoke all on function public.lawviz_refresh_v1(text, text), public.lawviz_calendar_v1(text, integer)
  from public, anon, authenticated;
grant execute on function public.lawviz_refresh_v1(text, text), public.lawviz_calendar_v1(text, integer)
  to service_role;

commit;
