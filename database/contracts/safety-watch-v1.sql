-- Product watch (2026-10-28): one read of every product's last 12 complete months against the 12 before, for the
-- /safety/products watch view. Reads only stored monthly series (safety.series, built from the openFDA bulk exports
-- and NHTSA complaint files), MDL links that are already recorded (safety.mdl_subjects, the MDL group subjects) and the
-- JPML pending report rows (corpus_records dataset 'mdls'). Nothing is estimated here: windows are sums of stored
-- monthly counts; a window the series does not fully cover is null.
--
-- Row shape (positional arrays keep the payload small):
--   [id, label, subject_type, kind, source, end_month, r12, p12, deaths12, deathsPrior12, severe12, severePrior12,
--    mdls (int[]), pending mdls (int[]), actions pending (sum over pending linked MDLs or null), tail (last 36 months),
--    radar (FAERS products only: the emerging-tort radar unit that lists this subject, with its MDL status and links,
--    brand names, sponsors, points, rank and its five fastest-rising reaction terms; null when no unit lists it)]
--   source: faers | maude | nhtsa. severe = serious reports (FAERS), injury reports (MAUDE), injury or death
--   complaints (NHTSA).
-- national: the same windows for all FAERS and all MAUDE reports, the denominators for the overall change.

create or replace function public.safety_watch_v1(p_min integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare out jsonb;
begin
  if p_min is null or p_min not between 1 and 100000 then
    raise exception 'Invalid minimum' using errcode = '22023';
  end if;
  with base as (
    select m.subject_id, m.series, m.coverage_to, m.vals, cardinality(m.vals) as e
      from safety.series m
     where m.series in ('faers_reports', 'faers_death', 'faers_serious',
                        'maude_reports', 'maude_death', 'maude_injury',
                        'nhtsa_complaints', 'nhtsa_complaints_injury')
       and cardinality(m.vals) > 0
  ), w as (
    select b.subject_id, b.series, b.coverage_to,
           case when b.e >= 12 then (select sum(x) from unnest(b.vals[b.e - 11 : b.e]) x)::bigint end as r12,
           case when b.e >= 24 then (select sum(x) from unnest(b.vals[b.e - 23 : b.e - 12]) x)::bigint end as p12,
           b.vals[greatest(1, b.e - 35) : b.e] as tail
      from base b
  ), subj as (
    select s.id, s.label, s.subject_type, s.kind,
           case when r.series like 'faers%' then 'faers' when r.series like 'maude%' then 'maude' else 'nhtsa' end as src,
           r.coverage_to, r.r12, r.p12, r.tail,
           d.r12 as d12, d.p12 as dp12, v.r12 as s12, v.p12 as sp12
      from safety.subjects s
      join w r on r.subject_id = s.id and r.series in ('faers_reports', 'maude_reports', 'nhtsa_complaints')
      left join w d on d.subject_id = s.id
            and d.series = case r.series when 'faers_reports' then 'faers_death'
                                         when 'maude_reports' then 'maude_death' end
      left join w v on v.subject_id = s.id
            and v.series = case r.series when 'faers_reports' then 'faers_serious'
                                         when 'maude_reports' then 'maude_injury'
                                         else 'nhtsa_complaints_injury' end
     where s.subject_type in ('product', 'device_code', 'mdl_group')
       and (coalesce(r.r12, 0) >= p_min or coalesce(r.p12, 0) >= p_min)
  ), links as (
    select x.id,
           array_agg(distinct x.mdl order by x.mdl) as mdls
      from (
        select ms.subject_id as id, ms.mdl from safety.mdl_subjects ms
        union all
        select s.id, (s.keys ->> 'mdl')::integer
          from safety.subjects s
         where s.subject_type = 'mdl_group' and s.keys ->> 'mdl' ~ '^[0-9]{1,5}$'
      ) x
     group by x.id
  ), radar as (
    select sid.value as id,
           jsonb_build_object(
             'unit', c.id,
             'status', c.item -> 'radar' -> 'mdl_status' -> 'status',
             'links', c.item -> 'radar' -> 'mdl_status' -> 'links',
             'brands', c.item -> 'radar' -> 'identifiers' -> 'brand_names',
             'sponsors', c.item -> 'radar' -> 'identifiers' -> 'sponsors',
             'points', c.item -> 'radar' -> 'points',
             'rank', c.item -> 'radar' -> 'rank',
             'terms', (select coalesce(jsonb_agg(t.value order by t.ordinality), '[]'::jsonb)
                         from jsonb_array_elements(c.item -> 'radar' -> 'top_rising_terms') with ordinality t
                        where t.ordinality <= 5)) as r
      from public.corpus_records c
      cross join lateral jsonb_array_elements_text(c.item -> 'radar' -> 'identifiers' -> 'faers_subjects') sid
     where c.dataset = 'agency_safety_tort_radar' and c.id like 'drug:faers:%'
  ), pending as (
    select (c.item ->> 'mdl_number')::integer as mdl,
           nullif(c.item ->> 'actions_pending', '')::bigint as actions
      from public.corpus_records c
     where c.dataset = 'mdls' and c.item ->> 'status' = 'pending' and c.item ->> 'mdl_number' ~ '^[0-9]{1,5}$'
  )
  select jsonb_build_object(
    'asOf', (select jsonb_object_agg(src, to_char(mx, 'YYYY-MM'))
               from (select src, max(coverage_to) mx from subj group by src) a),
    'national', (select coalesce(jsonb_object_agg(split_part(w.subject_id, ':', 2) || ':' || w.series,
                                   jsonb_build_array(w.r12, w.p12, to_char(w.coverage_to, 'YYYY-MM'))), '{}'::jsonb)
                   from w where w.subject_id in ('national:faers', 'national:maude')
                    and w.series in ('faers_reports', 'faers_death', 'faers_serious',
                                     'maude_reports', 'maude_death', 'maude_injury')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(
               s.id, s.label, s.subject_type, s.kind, s.src, to_char(s.coverage_to, 'YYYY-MM'),
               s.r12, s.p12, s.d12, s.dp12, s.s12, s.sp12,
               to_jsonb(coalesce(l.mdls, '{}'::integer[])),
               to_jsonb(coalesce((select array_agg(p.mdl order by p.mdl) from pending p where p.mdl = any (l.mdls)),
                                 '{}'::integer[])),
               (select sum(p.actions) from pending p where p.mdl = any (l.mdls)),
               to_jsonb(s.tail),
               rd.r) order by s.r12 desc nulls last)
             from subj s
             left join links l on l.id = s.id
             left join (select distinct on (x.id) x.id, x.r from radar x order by x.id) rd on rd.id = s.id),
           '[]'::jsonb)
  ) into out;
  return out;
end;
$function$;

revoke all on function public.safety_watch_v1(integer) from public, anon, authenticated;
grant execute on function public.safety_watch_v1(integer) to service_role;
