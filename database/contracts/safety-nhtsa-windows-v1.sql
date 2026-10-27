-- safety-nhtsa-windows/1 — read RPCs for the Products & safety section (/safety, the recall detail sheet), over the
-- record-level tables of safety/1 (database/contracts/safety-signals-v1.sql must be applied first):
--
--   public.safety_nhtsa_complaint_windows_v1(p_as_of, p_min, p_limit)
--       NHTSA ODI complaints in the latest 365 days vs the 365 days before, by manufacturer and by manufacturer ×
--       top-level component (the vehicle complaint surge radar). Both windows are 365 days, so they compare directly.
--   public.safety_nhtsa_recall_complaints_v1(p_campaign)
--       Complaints for the exact vehicles of one NHTSA recall campaign, by quarter received, before and after the recall
--       date (the recall's effect on complaints).
--   public.safety_osha_silica_v1()
--       OSHA respirable crystalline silica citations (29 CFR 1910.1053 general industry, 1926.1153 construction) by year,
--       by state and by cut-stone fabricator establishment (NAICS 327991), joined to inspections on activity_nr.
--
-- Accuracy rules carried by the results:
--   - Complaints are unverified consumer reports, received 2020-01-01 onward (the table's coverage is returned).
--   - One complaint can name several components: per-component counts must not be added up (each pair counts the
--     complaints naming that top-level component at least once; totals are counted per complaint).
--   - Recall vehicles are matched exactly: the recall's own 'MAKE MODEL YYYY–YYYY' strings are split on the recall's own
--     makes list; a complaint matches when one of its makes AND one of its models equal a recall vehicle's make and model
--     and one of its model years falls in that vehicle's year range. Components match on the exact top-level segment
--     (text before the first ':') of the recall's components; NHTSA's two component vocabularies ('ENGINE' and 'ENGINE AND
--     ENGINE COOLING') are NOT merged, so the vehicle-only count is returned beside the component-matched count.
--     Unparsed vehicle strings are returned, never guessed.
--   - Silica citations count citation items as OSHA records them; inspections reflect enforcement priorities (emphasis
--     programs), not disease incidence. Establishment names are as recorded and are never merged with other names.
--   - A value the data does not hold is null ("Not recorded"), never 0.
--
-- Every function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Idempotent (create or replace). Read-only: no table is created or written.
-- Offline test: node --test src/lib/safety/nhtsaWindows.contract.test.mjs (pglite, synthetic rows).

begin;

-- ------------------------------------------------------------------------------------------------ complaint windows
create or replace function public.safety_nhtsa_complaint_windows_v1(p_as_of date default null, p_min integer default 50,
  p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of date;
  v_from date;
  v_to date;
begin
  if p_min is null or p_min not between 1 and 100000 then raise exception 'Invalid minimum' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 200 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  select min(c.received), max(c.received) into v_from, v_to from safety.nhtsa_complaints c;
  v_as_of := least(coalesce(p_as_of, v_to), v_to);
  if v_as_of is null then
    return jsonb_build_object('as_of', null, 'coverage_from', null, 'coverage_to', null, 'totals', null,
      'manufacturers', '[]'::jsonb, 'pairs', '[]'::jsonb);
  end if;
  return (
    with w as (
      select c.odino, coalesce(nullif(btrim(c.manufacturer), ''), 'Not recorded') as manufacturer, c.components,
             c.crash, c.fire, c.injured, c.deaths,
             case when c.received > v_as_of - 365 then 'current' else 'prior' end as win
        from safety.nhtsa_complaints c
       where c.received > v_as_of - 730 and c.received <= v_as_of
    ),
    tot as (
      select count(*) filter (where win = 'current') as cur, count(*) filter (where win = 'prior') as pri,
             sum(injured) filter (where win = 'current') as inj, sum(deaths) filter (where win = 'current') as dth,
             count(*) filter (where win = 'current' and crash) as crash, count(*) filter (where win = 'current' and fire) as fire
        from w
    ),
    makers as (
      select manufacturer, count(*) filter (where win = 'current') as cur, count(*) filter (where win = 'prior') as pri,
             sum(injured) filter (where win = 'current') as inj, sum(deaths) filter (where win = 'current') as dth,
             count(*) filter (where win = 'current' and crash) as crash, count(*) filter (where win = 'current' and fire) as fire
        from w group by manufacturer
    ),
    pairs as (
      select w.manufacturer, x.comp, count(*) filter (where w.win = 'current') as cur,
             count(*) filter (where w.win = 'prior') as pri,
             sum(w.injured) filter (where w.win = 'current') as inj, sum(w.deaths) filter (where w.win = 'current') as dth,
             count(*) filter (where w.win = 'current' and w.crash) as crash,
             count(*) filter (where w.win = 'current' and w.fire) as fire
        from w cross join lateral (select distinct split_part(u, ':', 1) as comp from unnest(w.components) u
                                    where nullif(btrim(u), '') is not null) x
       group by w.manufacturer, x.comp
    )
    select jsonb_build_object(
      'as_of', v_as_of,
      'current_from', v_as_of - 364, 'current_to', v_as_of,
      'prior_from', v_as_of - 729, 'prior_to', v_as_of - 365,
      'coverage_from', v_from, 'coverage_to', v_to,
      'prior_partial', (v_as_of - 729) < v_from,
      'totals', (select jsonb_build_object('current', cur, 'prior', pri, 'injured', inj, 'deaths', dth,
                   'crashes', crash, 'fires', fire) from tot),
      'manufacturers', coalesce((select jsonb_agg(jsonb_build_object('manufacturer', m.manufacturer, 'current', m.cur,
                   'prior', m.pri, 'injured', m.inj, 'deaths', m.dth, 'crashes', m.crash, 'fires', m.fire)
                   order by m.cur desc, m.manufacturer)
                   from (select * from makers order by cur desc, manufacturer limit 25) m), '[]'::jsonb),
      'pairs', coalesce((select jsonb_agg(jsonb_build_object('manufacturer', p.manufacturer, 'component', p.comp,
                   'current', p.cur, 'prior', p.pri, 'injured', p.inj, 'deaths', p.dth, 'crashes', p.crash, 'fires', p.fire)
                   order by (p.cur - p.pri) desc, p.manufacturer, p.comp)
                   from (select * from pairs where cur >= p_min and comp <> 'UNKNOWN OR OTHER'
                          order by (cur - pri) desc, manufacturer, comp limit p_limit) p), '[]'::jsonb),
      'unit', 'complaints received',
      'source', 'NHTSA Office of Defects Investigation complaints (safety.nhtsa_complaints)')
  );
end $$;

-- ------------------------------------------------------------------------------------------------ recall effect
create or replace function public.safety_nhtsa_recall_complaints_v1(p_campaign text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_recall jsonb;
  v_date date;
  v_from date;
  v_to date;
begin
  if p_campaign is null or p_campaign !~ '^[0-9]{2}[VEITC][0-9]{3}000$' then
    raise exception 'Invalid campaign number' using errcode = '22023';
  end if;
  select r.item -> 'recall', nullif(r.item -> 'cells' ->> 'date', '')::date into v_recall, v_date
    from public.corpus_records r
   where r.dataset = 'agency_safety_nhtsa_recalls' and r.id = p_campaign;
  if v_recall is null then return null; end if;
  select min(c.received), max(c.received) into v_from, v_to from safety.nhtsa_complaints c;
  return (
    with vs as (
      select v.txt, m.mk
        from jsonb_array_elements_text(coalesce(v_recall -> 'vehicles', '[]'::jsonb)) v(txt)
        left join lateral (
          select mk from jsonb_array_elements_text(coalesce(v_recall -> 'makes', '[]'::jsonb)) mk
           where v.txt like mk || ' %' order by length(mk) desc limit 1) m on true
    ),
    parsed as (
      select vs.txt, vs.mk as make,
             nullif(btrim(regexp_replace(substr(vs.txt, length(vs.mk) + 2), '\s+[0-9]{4}(–[0-9]{4})?$', '')), '') as model,
             (regexp_match(vs.txt, '\s([0-9]{4})(?:–([0-9]{4}))?$'))[1]::int as y1,
             coalesce((regexp_match(vs.txt, '\s([0-9]{4})(?:–([0-9]{4}))?$'))[2],
                      (regexp_match(vs.txt, '\s([0-9]{4})(?:–([0-9]{4}))?$'))[1])::int as y2
        from vs
    ),
    veh as (select * from parsed where make is not null and model is not null and y1 is not null and y2 >= y1),
    tops as (
      select coalesce(array_agg(distinct split_part(c, ':', 1)) filter (where nullif(btrim(c), '') is not null), '{}') as t
        from jsonb_array_elements_text(coalesce(v_recall -> 'components', '[]'::jsonb)) c
    ),
    matched as (
      select c.received, c.injured, c.crash, c.fire, c.deaths,
             exists (select 1 from unnest(c.components) u, tops where split_part(u, ':', 1) = any (tops.t)) as comp_match
        from safety.nhtsa_complaints c
       -- Pre-filter the GIN index nhtsa_complaints_makes can serve, so a recall reads only its makes' complaints.
       where c.makes && (select coalesce(array_agg(distinct veh.make), '{}'::text[]) from veh)
         and exists (select 1 from veh
                      where veh.make = any (c.makes) and veh.model = any (c.models)
                        and exists (select 1 from unnest(c.model_years) y where y between veh.y1 and veh.y2))
    ),
    q as (
      select to_char(date_trunc('quarter', received), 'YYYY-"Q"Q') as quarter,
             count(*) filter (where comp_match) as complaints, count(*) as vehicle_complaints,
             sum(injured) filter (where comp_match) as injured, count(*) filter (where comp_match and crash) as crashes,
             count(*) filter (where comp_match and fire) as fires, sum(deaths) filter (where comp_match) as deaths
        from matched group by 1
    )
    select jsonb_build_object(
      'campaign', p_campaign,
      'recall_date', v_date,
      'vehicles', coalesce((select jsonb_agg(jsonb_build_object('make', make, 'model', model, 'from', y1, 'to', y2) order by make, model, y1) from veh), '[]'::jsonb),
      'unparsed', coalesce((select jsonb_agg(txt order by txt) from parsed where make is null or model is null or y1 is null or y2 < y1), '[]'::jsonb),
      'components', (select to_jsonb(t) from tops),
      'coverage_from', v_from, 'coverage_to', v_to,
      'quarters', coalesce((select jsonb_agg(jsonb_build_object('quarter', quarter, 'complaints', complaints,
                    'vehicle_complaints', vehicle_complaints, 'injured', injured, 'crashes', crashes, 'fires', fires,
                    'deaths', deaths) order by quarter) from q), '[]'::jsonb),
      'before', case when v_date is null then null else jsonb_build_object(
                    'from', v_date - 365, 'to', v_date,
                    'complaints', (select count(*) from matched where comp_match and received > v_date - 365 and received <= v_date),
                    'injured', (select sum(injured) from matched where comp_match and received > v_date - 365 and received <= v_date),
                    'crashes', (select count(*) from matched where comp_match and crash and received > v_date - 365 and received <= v_date),
                    'partial', v_from is null or v_date - 365 < v_from) end,
      'after', case when v_date is null then null else jsonb_build_object(
                    'from', v_date + 1, 'to', v_date + 365,
                    'complaints', (select count(*) from matched where comp_match and received > v_date and received <= v_date + 365),
                    'injured', (select sum(injured) from matched where comp_match and received > v_date and received <= v_date + 365),
                    'crashes', (select count(*) from matched where comp_match and crash and received > v_date and received <= v_date + 365),
                    'partial', v_to is null or v_date + 365 > v_to) end,
      'unit', 'complaints received',
      'source', 'NHTSA Office of Defects Investigation complaints (safety.nhtsa_complaints); NHTSA recall campaign ' || p_campaign)
  );
end $$;

-- ------------------------------------------------------------------------------------------------ OSHA silica
create or replace function public.safety_osha_silica_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  with v as (
    select o.activity_nr, o.citation_id, o.issuance_date, o.current_penalty,
           case when o.standard like '19101053%' then 'general' else 'construction' end as std,
           i.naics_code, nullif(btrim(i.site_state), '') as site_state, i.estab_name, i.site_city
      from safety.osha_violations o
      left join safety.osha_inspections i on i.activity_nr = o.activity_nr
     where (o.standard like '19101053%' or o.standard like '19261153%') and o.issuance_date is not null
  ),
  b as (select max(issuance_date) as to_date, min(issuance_date) as from_date from v),
  tagged as (
    select v.*, coalesce(v.naics_code like '327991%', false) as fabricator,
           v.issuance_date > b.to_date - 365 as last12
      from v cross join b
  )
  select jsonb_build_object(
    'from', (select from_date from b), 'to', (select to_date from b),
    'years', coalesce((select jsonb_agg(jsonb_build_object('year', y, 'fabricator_general', fg, 'other_general', og,
                'construction', cn, 'penalties', pen) order by y)
              from (select extract(year from issuance_date)::int as y,
                           count(*) filter (where std = 'general' and fabricator) as fg,
                           count(*) filter (where std = 'general' and not fabricator) as og,
                           count(*) filter (where std = 'construction') as cn,
                           sum(current_penalty) as pen
                      from tagged group by 1) t), '[]'::jsonb),
    'last12', (select jsonb_build_object('violations', count(*), 'fabricator_violations', count(*) filter (where fabricator),
                'fabricator_inspections', count(distinct activity_nr) filter (where fabricator),
                'penalties', sum(current_penalty), 'states', count(distinct site_state))
              from tagged where last12),
    'states', coalesce((select jsonb_agg(jsonb_build_object('state', site_state, 'violations', n, 'fabricator_violations', f)
                order by n desc, site_state)
              from (select site_state, count(*) as n, count(*) filter (where fabricator) as f
                      from tagged where last12 and site_state is not null group by 1) s), '[]'::jsonb),
    'establishments', coalesce((select jsonb_agg(jsonb_build_object('activity_nr', e.activity_nr, 'name', e.estab_name,
                'city', e.site_city, 'state', e.site_state, 'violations', e.n, 'penalties', e.pen, 'latest', e.latest)
                order by e.n desc, e.latest desc)
              from (select activity_nr, max(estab_name) as estab_name, max(site_city) as site_city, max(site_state) as site_state,
                           count(*) as n, sum(current_penalty) as pen, max(issuance_date) as latest
                      from tagged
                     where fabricator and issuance_date > (select to_date from b) - 730
                     group by activity_nr order by count(*) desc, max(issuance_date) desc limit 100) e), '[]'::jsonb),
    'unit', 'citation items',
    'source', 'U.S. Department of Labor, OSHA enforcement data (safety.osha_violations joined to safety.osha_inspections on activity_nr)')
$$;

revoke all on function public.safety_nhtsa_complaint_windows_v1(date, integer, integer) from public, anon, authenticated;
revoke all on function public.safety_nhtsa_recall_complaints_v1(text) from public, anon, authenticated;
revoke all on function public.safety_osha_silica_v1() from public, anon, authenticated;
grant execute on function public.safety_nhtsa_complaint_windows_v1(date, integer, integer) to service_role;
grant execute on function public.safety_nhtsa_recall_complaints_v1(text) to service_role;
grant execute on function public.safety_osha_silica_v1() to service_role;

commit;
