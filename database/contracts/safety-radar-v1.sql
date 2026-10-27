-- safety radar v1 — two read-only windowed reads for the emerging-tort radar builder
-- (scripts/enrichment/build_emerging_tort_radar.py). Additive: needs database/contracts/safety-signals-v1.sql applied
-- first (schema `safety`, tables safety.series and safety.nhtsa_complaints). Creates no table and writes nothing.
--
--   public.safety_series_window_v1(p_prefix, p_series, p_end, p_recent_months, p_baseline_months, p_tail_months)
--     For every stored monthly series of the subjects whose id starts with p_prefix (e.g. 'faers:') and whose name is in
--     p_series: the sum of the p_recent_months months ending at p_end, the sum of the p_baseline_months months before
--     them, how many months of each window the series actually covers (a window that starts before coverage_from is
--     summed over the covered months only; the builder scales it or refuses to rate it), an md5 of the window values
--     (equal hashes = identical counts, used to group duplicate subjects) and the last p_tail_months values (the chart).
--     A series whose coverage ends before p_end is left out (its recent window would be partial).
--   public.safety_nhtsa_complaint_windows_v1(p_end, p_months, p_min_recent)
--     NHTSA ODI complaints received in the p_months months ending with the month of p_end (recent) and the p_months
--     before (prior), counted once per complaint and (make, model, component) as NHTSA lists them on the complaint
--     (model year dropped), with crash/fire/injury and death counts and the monthly prior+recent values. Units with
--     fewer than p_min_recent recent complaints are left out; one 'national' row carries the totals of distinct
--     complaints. p_end must be a month the table fully covers (the builder passes the last complete month).
--     Unit keys are upper(btrim(x)): btrim removes spaces at the ends only, inner whitespace is kept. The builder's
--     fallback (build_emerging_tort_radar.nhtsa_windows_from_records / sql_key) builds the same keys.
--
-- Both: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role only.
-- Idempotent (create or replace), no DROP/DELETE/TRUNCATE. Offline test (pglite, synthetic rows):
--   node --test scripts/enrichment/safety-radar-contract.test.mjs   (needs the private PGlite runtime, like test:sql)

begin;

create or replace function public.safety_series_window_v1(
  p_prefix text,
  p_series text[],
  p_end date,
  p_recent_months integer default 12,
  p_baseline_months integer default 36,
  p_tail_months integer default 24)
returns table (subject_id text, series text, recent bigint, baseline bigint, recent_months integer,
               baseline_months integer, coverage_from date, coverage_to date, values_hash text, tail integer[])
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_prefix is null or p_prefix !~ '^[a-z][a-z0-9_]{1,20}:$' then
    raise exception 'Invalid prefix' using errcode = '22023'; end if;
  if p_series is null or cardinality(p_series) not between 1 and 12 then
    raise exception 'Invalid series list' using errcode = '22023'; end if;
  foreach v in array p_series loop
    if v is null or v !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'Invalid series' using errcode = '22023'; end if;
  end loop;
  if p_end is null or extract(day from p_end) <> 1 then raise exception 'Invalid end month' using errcode = '22023'; end if;
  if p_recent_months is null or p_recent_months not between 1 and 60
     or p_baseline_months is null or p_baseline_months not between 1 and 120
     or p_tail_months is null or p_tail_months not between 0 and 120 then
    raise exception 'Invalid window' using errcode = '22023'; end if;
  return query
  with s as (
    select m.subject_id, m.series, m.coverage_from, m.coverage_to, m.vals,
           ((extract(year from p_end) - extract(year from m.coverage_from)) * 12
             + extract(month from p_end) - extract(month from m.coverage_from))::integer + 1 as e
      from safety.series m
     where left(m.subject_id, length(p_prefix)) = p_prefix
       and m.series = any (p_series)
       and m.coverage_to >= p_end
       and m.coverage_from <= p_end
  )
  select s.subject_id, s.series,
         (select sum(x)::bigint from unnest(s.vals[s.e - p_recent_months + 1 : s.e]) x),
         (select sum(x)::bigint from unnest(s.vals[s.e - p_recent_months - p_baseline_months + 1 : s.e - p_recent_months]) x),
         least(p_recent_months, s.e),
         greatest(0, least(p_baseline_months, s.e - p_recent_months)),
         s.coverage_from, s.coverage_to,
         md5(array_to_string(s.vals[greatest(1, s.e - p_recent_months - p_baseline_months + 1) : s.e], ',')),
         case when p_tail_months = 0 then '{}'::integer[] else s.vals[greatest(1, s.e - p_tail_months + 1) : s.e] end
    from s
   order by s.subject_id, s.series;
end $$;

create or replace function public.safety_nhtsa_complaint_windows_v1(
  p_end date,
  p_months integer default 12,
  p_min_recent integer default 50)
returns table (scope text, make text, model text, component text, recent bigint, prior bigint,
               recent_severe bigint, prior_severe bigint, recent_deaths bigint, prior_deaths bigint,
               recent_injured bigint, prior_injured bigint, months integer[])
language plpgsql stable security definer set search_path = '' as $$
declare v_from date; v_split date; v_to date;
begin
  if p_end is null or extract(day from p_end) <> 1 then raise exception 'Invalid end month' using errcode = '22023'; end if;
  if p_months is null or p_months not between 1 and 36 then raise exception 'Invalid window' using errcode = '22023'; end if;
  if p_min_recent is null or p_min_recent not between 1 and 100000 then raise exception 'Invalid minimum' using errcode = '22023'; end if;
  v_to := (p_end + interval '1 month')::date;                       -- exclusive end: the month after p_end
  v_split := (v_to - make_interval(months => p_months))::date;      -- first recent month
  v_from := (v_split - make_interval(months => p_months))::date;    -- first prior month
  return query
  with c as (
    select n.odino, n.items,
           (coalesce(n.crash, false) or coalesce(n.fire, false) or coalesce(n.injured, 0) > 0 or coalesce(n.deaths, 0) > 0) as severe,
           coalesce(n.deaths, 0)::bigint as deaths, coalesce(n.injured, 0)::bigint as injured,
           n.received >= v_split as is_recent,
           ((extract(year from n.received) - extract(year from v_from)) * 12
             + extract(month from n.received) - extract(month from v_from))::integer + 1 as mi
      from safety.nhtsa_complaints n
     where n.received >= v_from and n.received < v_to
  ), u as (
    select distinct c.odino, c.is_recent, c.severe, c.deaths, c.injured, c.mi,
           upper(btrim(i->>'make')) as mk, upper(btrim(i->>'model')) as md, upper(btrim(i->>'component')) as cp
      from c cross join lateral jsonb_array_elements(c.items) i
     where nullif(btrim(i->>'make'), '') is not null and nullif(btrim(i->>'model'), '') is not null
       and nullif(btrim(i->>'component'), '') is not null
  ), units as (
    select u.mk, u.md, u.cp,
           count(*) filter (where u.is_recent) as r, count(*) filter (where not u.is_recent) as p,
           count(*) filter (where u.is_recent and u.severe) as rs, count(*) filter (where not u.is_recent and u.severe) as ps,
           coalesce(sum(u.deaths) filter (where u.is_recent), 0)::bigint as rd,
           coalesce(sum(u.deaths) filter (where not u.is_recent), 0)::bigint as pd,
           coalesce(sum(u.injured) filter (where u.is_recent), 0)::bigint as ri,
           coalesce(sum(u.injured) filter (where not u.is_recent), 0)::bigint as pi
      from u group by u.mk, u.md, u.cp
    having count(*) filter (where u.is_recent) >= p_min_recent
  ), um as (
    -- complaints per unit and month, aggregated once (only for the units kept above)
    select u.mk, u.md, u.cp, u.mi, count(*) as n
      from u join units k on k.mk = u.mk and k.md = u.md and k.cp = u.cp
     group by u.mk, u.md, u.cp, u.mi
  ), unit_months as (
    select x.mk, x.md, x.cp, array_agg(coalesce(t.n, 0)::integer order by g.i) as months
      from units x
      cross join generate_series(1, 2 * p_months) g(i)
      left join um t on t.mk = x.mk and t.md = x.md and t.cp = x.cp and t.mi = g.i
     group by x.mk, x.md, x.cp
  )
  select 'national'::text, null::text, null::text, null::text,
         count(*) filter (where c.is_recent), count(*) filter (where not c.is_recent),
         count(*) filter (where c.is_recent and c.severe), count(*) filter (where not c.is_recent and c.severe),
         coalesce(sum(c.deaths) filter (where c.is_recent), 0)::bigint, coalesce(sum(c.deaths) filter (where not c.is_recent), 0)::bigint,
         coalesce(sum(c.injured) filter (where c.is_recent), 0)::bigint, coalesce(sum(c.injured) filter (where not c.is_recent), 0)::bigint,
         (select array_agg(coalesce(t.n, 0)::integer order by g.i)
            from generate_series(1, 2 * p_months) g(i)
            left join (select c2.mi, count(*) as n from c c2 group by c2.mi) t on t.mi = g.i)
    from c
  union all
  select 'unit'::text, x.mk, x.md, x.cp, x.r, x.p, x.rs, x.ps, x.rd, x.pd, x.ri, x.pi, m.months
    from units x join unit_months m on m.mk = x.mk and m.md = x.md and m.cp = x.cp;
end $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.safety_series_window_v1(text,text[],date,integer,integer,integer)',
    'public.safety_nhtsa_complaint_windows_v1(date,integer,integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

commit;
