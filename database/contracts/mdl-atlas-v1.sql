-- MDL atlas (2026-10-28): one read-only aggregate for the second half of /insights/stories.
--
-- corpus_mdl_atlas_v1(): every MDL in the captured JPML "Pending MDL Dockets" reports (jpml_mdl_pending_series).
--   dates: the report dates (frame order).
--   mdls: each MDL with its title, JPML type where the pending-history rows record one, its latest transferee district
--     and judge as the latest report it appears in prints them, its transfer date where the series records one, whether
--     it is in the latest report, its total actions (pending plus closed) in that latest report, and its pending count
--     from the first frame it is listed in (start) to the last (values; null = not listed in that report).
--   districts: actions pending and MDLs listed per transferee district in every frame, each point counted under the
--     district its own report prints, with the courthouse the district court lists first on its own website and the
--     Census geocoder matched (court_locations), or failing that the first building with coordinates in the court's
--     building registry (court_buildings); placedBy says which. The JPML code maps to the court id exactly (lower(code) || 'd',
--     "OHS" -> "ohsd"); a district with no matched courthouse comes back with null coordinates.
-- Nothing is interpolated or estimated here.

create or replace function public.corpus_mdl_atlas_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare out jsonb;
begin
  with s as (
    select (c.item -> 'series' ->> 'mdl')::integer as mdl, c.item as item
      from public.corpus_records c
     where c.dataset = 'jpml_mdl_pending_series'
       and c.item -> 'series' ->> 'mdl' ~ '^[0-9]{1,5}$'
  ), p as (
    select s.mdl, (pt ->> 'date')::date as d, (pt ->> 'pending')::integer as v, upper(pt ->> 'district') as district
      from s cross join lateral jsonb_array_elements(s.item -> 'series' -> 'points') pt
     where pt ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$'
       and pt ->> 'pending' ~ '^[0-9]+$'
  ), dates as (
    select d, (row_number() over (order by d) - 1)::integer as i from (select distinct d from p) x
  ), pi as (
    select p.*, dates.i from p join dates using (d)
  ), span as (
    select mdl, min(i) as i0, max(i) as i1 from pi group by mdl
  ), types as (
    select distinct on ((c.item -> 'cells' ->> 'mdl')::integer) (c.item -> 'cells' ->> 'mdl')::integer as mdl,
           c.item -> 'cells' ->> 'type' as type
      from public.corpus_records c
     where c.dataset = 'jpml_pending_history_mdls' and c.item -> 'cells' ->> 'mdl' ~ '^[0-9]{1,5}$'
     order by (c.item -> 'cells' ->> 'mdl')::integer
  ), m as (
    select s.mdl,
           coalesce(s.item ->> 'title', s.item -> 'cells' ->> 'litigation') as title,
           t.type,
           upper(s.item -> 'series' -> 'latest' ->> 'district') as district,
           s.item -> 'series' -> 'latest' -> 'judges' ->> 0 as judge,
           case when s.item -> 'series' ->> 'date_transferred' ~ '^\d{4}-\d{2}-\d{2}$'
                then s.item -> 'series' ->> 'date_transferred' end as transferred,
           s.item -> 'series' ->> 'status' = 'in_latest_monthly_report' as in_latest,
           case when s.item -> 'series' -> 'latest' ->> 'total' ~ '^[0-9]+$'
                then (s.item -> 'series' -> 'latest' ->> 'total')::integer end as total,
           sp.i0, sp.i1
      from s join span sp using (mdl) left join types t using (mdl)
  ), dist as (
    select distinct district from pi where district ~ '^[A-Z]{2,3}$'
  ), loc as (
    select dd.district,
           coalesce(c.item -> 'cells' ->> 'court',
                    (select cb.item -> 'cells' ->> 'court' from public.corpus_records cb
                      where cb.dataset = 'court_buildings' and cb.item ->> 'id' = lower(dd.district) || 'd'
                      limit 1)) as court,
           (select jsonb_build_object('lat', (l ->> 'lat')::float8, 'lon', (l ->> 'lon')::float8,
                                      'city', l ->> 'city', 'state', l ->> 'state')
              from jsonb_array_elements(c.item -> 'profile' -> 'locations') with ordinality as x(l, o)
             where l ->> 'geocode_match' = 'Match'
               and coalesce(l ->> 'kind', 'street') <> 'po_box'
               and l ->> 'address1' !~* '^p\.?\s?o\.?\s+box'
             order by o limit 1) as at,
           (select jsonb_build_object('lat', (b ->> 'latitude')::float8, 'lon', (b ->> 'longitude')::float8,
                                      'city', b ->> 'city', 'state', b ->> 'state')
              from public.corpus_records cb
              cross join lateral jsonb_array_elements(cb.item -> 'buildings') with ordinality as y(b, o)
             where cb.dataset = 'court_buildings' and cb.item ->> 'id' = lower(dd.district) || 'd'
               and b ->> 'latitude' ~ '^-?[0-9.]+$' and b ->> 'longitude' ~ '^-?[0-9.]+$'
             order by o limit 1) as at2
      from dist dd
      left join public.corpus_records c
        on c.dataset = 'court_locations' and c.item -> 'cells' ->> 'court_id' = lower(dd.district) || 'd'
  ), dframes as (
    select district, i, sum(v)::integer as v, count(*)::integer as n from pi
     where district ~ '^[A-Z]{2,3}$' group by district, i
  )
  select jsonb_build_object(
    'dates', (select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by i) from dates),
    'mdls', coalesce((select jsonb_agg(jsonb_build_object(
               'mdl', m.mdl, 'title', m.title, 'type', m.type, 'district', m.district, 'judge', m.judge,
               'transferred', m.transferred, 'inLatest', coalesce(m.in_latest, false), 'total', m.total,
               'start', m.i0,
               'values', (select jsonb_agg(pp.v order by g.i)
                            from generate_series(m.i0, m.i1) as g(i)
                            left join pi pp on pp.mdl = m.mdl and pp.i = g.i))
             order by m.i0, m.mdl) from m), '[]'::jsonb),
    'districts', coalesce((select jsonb_agg(jsonb_build_object(
               'code', l.district,
               'courtId', lower(l.district) || 'd',
               'court', l.court,
               'lat', coalesce(l.at, l.at2) -> 'lat', 'lon', coalesce(l.at, l.at2) -> 'lon',
               'city', coalesce(l.at, l.at2) ->> 'city', 'state', coalesce(l.at, l.at2) ->> 'state',
               'placedBy', case when l.at is not null then 'court_locations'
                                when l.at2 is not null then 'court_buildings' end,
               'values', (select jsonb_agg(coalesce(f.v, 0) order by dd.i)
                            from dates dd left join dframes f on f.district = l.district and f.i = dd.i),
               'counts', (select jsonb_agg(coalesce(f.n, 0) order by dd.i)
                            from dates dd left join dframes f on f.district = l.district and f.i = dd.i))
             order by l.district) from loc l), '[]'::jsonb)
  ) into out;
  return out;
end;
$function$;

revoke all on function public.corpus_mdl_atlas_v1() from public, anon, authenticated;
grant execute on function public.corpus_mdl_atlas_v1() to service_role;
