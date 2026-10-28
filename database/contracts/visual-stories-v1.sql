-- Visual stories (2026-10-28): two read-only aggregates for /insights/stories.
--
-- corpus_mdl_docket_v1(p_min_peak): every captured JPML "Pending MDL Dockets" report (jpml_mdl_pending_series points)
--   as one frame. dates: the report dates; totals / listed: actions pending and MDLs listed across every MDL in that
--   report; mdls: each MDL whose peak in any captured report reached p_min_peak, with its pending count in every frame
--   (null = not listed in that report), its title, its JPML type where the pending-history rows record one, and its
--   latest transferee district. Nothing is interpolated here.
--
-- corpus_defendant_network_v1(): the company–MDL links from SEC filings (company_sec_mdl_links) whose role is
--   "defendant", with each link's evidence tier as recorded, the company name, the MDL's title, status and pending
--   count as the link row records them, and the MDL product groups (safety.subjects, mdl_group) that name a product for
--   the same MDL. Links are only those rows; nothing is inferred from names.

create or replace function public.corpus_mdl_docket_v1(p_min_peak integer default 300)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare out jsonb;
begin
  if p_min_peak is null or p_min_peak not between 1 and 1000000 then
    raise exception 'Invalid peak' using errcode = '22023';
  end if;
  with p as (
    select (c.item -> 'series' ->> 'mdl')::integer as mdl,
           (pt ->> 'date')::date as d,
           (pt ->> 'pending')::integer as v,
           pt ->> 'district' as district,
           coalesce(c.item ->> 'title', c.item -> 'cells' ->> 'litigation') as title
      from public.corpus_records c
      cross join lateral jsonb_array_elements(c.item -> 'series' -> 'points') pt
     where c.dataset = 'jpml_mdl_pending_series'
       and c.item -> 'series' ->> 'mdl' ~ '^[0-9]{1,5}$'
       and pt ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$'
       and pt ->> 'pending' ~ '^[0-9]+$'
  ), dates as (
    select d, row_number() over (order by d) as i from (select distinct d from p) x
  ), frames as (
    select d.d, d.i, sum(p.v)::bigint as total, count(*)::integer as listed
      from dates d join p on p.d = d.d group by d.d, d.i
  ), keep as (
    select mdl, max(v) as peak from p group by mdl having max(v) >= p_min_peak
  ), types as (
    select distinct on (c.item -> 'cells' ->> 'mdl') (c.item -> 'cells' ->> 'mdl')::integer as mdl,
           c.item -> 'cells' ->> 'type' as type
      from public.corpus_records c
     where c.dataset = 'jpml_pending_history_mdls' and c.item -> 'cells' ->> 'mdl' ~ '^[0-9]{1,5}$'
     order by c.item -> 'cells' ->> 'mdl'
  ), latest as (
    select distinct on (mdl) mdl, district, title from p order by mdl, d desc
  )
  select jsonb_build_object(
    'dates', (select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by i) from dates),
    'totals', (select jsonb_agg(total order by i) from frames),
    'listed', (select jsonb_agg(listed order by i) from frames),
    'mdls', coalesce((select jsonb_agg(jsonb_build_object(
               'mdl', k.mdl,
               'title', l.title,
               'type', t.type,
               'district', l.district,
               'peak', k.peak,
               'values', (select jsonb_agg(pp.v order by dd.i)
                            from dates dd left join p pp on pp.d = dd.d and pp.mdl = k.mdl))
             order by k.peak desc)
           from keep k left join latest l on l.mdl = k.mdl left join types t on t.mdl = k.mdl), '[]'::jsonb)
  ) into out;
  return out;
end;
$function$;

revoke all on function public.corpus_mdl_docket_v1(integer) from public, anon, authenticated;
grant execute on function public.corpus_mdl_docket_v1(integer) to service_role;

create or replace function public.corpus_defendant_network_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare out jsonb;
begin
  with l as (
    select c.item -> 'link' as k
      from public.corpus_records c
     where c.dataset = 'company_sec_mdl_links'
       and c.item -> 'link' ->> 'role' = 'defendant'
       and c.item -> 'link' ->> 'mdl' ~ '^[0-9]{1,5}$'
       and c.item -> 'link' ->> 'cik' ~ '^[0-9]{10}$'
  )
  select jsonb_build_object(
    'links', coalesce((select jsonb_agg(jsonb_build_object(
               'cik', k ->> 'cik',
               'company', k ->> 'company',
               'mdl', (k ->> 'mdl')::integer,
               'tier', k ->> 'tier',
               'tierLabel', k ->> 'tier_label',
               'verified', nullif(k ->> 'verified_count', '')::integer,
               'first', k ->> 'first_verified',
               'last', k ->> 'last_verified')
             order by (k ->> 'mdl')::integer, k ->> 'company') from l), '[]'::jsonb),
    'mdls', coalesce((select jsonb_agg(x order by (x ->> 'mdl')::integer) from (
               select distinct on ((k ->> 'mdl')::integer) jsonb_build_object(
                 'mdl', (k ->> 'mdl')::integer,
                 'title', k ->> 'mdl_title',
                 'status', k ->> 'mdl_status',
                 'type', k ->> 'mdl_type',
                 'pending', nullif(k ->> 'pending', '')::integer,
                 'district', k ->> 'district') as x
                 from l order by (k ->> 'mdl')::integer, (k ->> 'pending') is null) z), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
               'id', s.id, 'label', s.label, 'kind', s.kind, 'mdl', (s.keys ->> 'mdl')::integer) order by s.id)
             from safety.subjects s
            where s.subject_type = 'mdl_group' and s.keys ->> 'mdl' ~ '^[0-9]{1,5}$'
              and (s.keys ->> 'mdl')::integer in (select (k ->> 'mdl')::integer from l)), '[]'::jsonb)
  ) into out;
  return out;
end;
$function$;

revoke all on function public.corpus_defendant_network_v1() from public, anon, authenticated;
grant execute on function public.corpus_defendant_network_v1() to service_role;
