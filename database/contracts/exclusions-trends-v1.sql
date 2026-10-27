-- exclusions/1 — yearly counts of the health-care and federal exclusion lists for the Enforcement › Exclusions tab
-- (workstream companies, opportunity companies-enforcement#8).
--
-- Source (read only): public.corpus_records, datasets oig_leie_exclusions (HHS-OIG LEIE, cells.excluded = exclusion
-- date, cells.code = exclusion authority such as 1128a1) and sam_exclusions (SAM.gov, cells.active = date the
-- exclusion became active, cells.classification = Individual / Firm / Vessel / Special Entity Designation).
--
-- Rules:
--   * Both lists hold exclusions in force today; reinstated or expired ones are gone. A year's count is "exclusions still
--     listed that took effect that year", never a historical count of actions. The UI says so.
--   * A date must be YYYY-MM-DD; anything else counts as undated. A date after p_as_of (default: today) is published
--     as such (SAM holds rows active from 2084-xx and 2099-12-30) and is counted as future-dated, never charted.
--   * Dates are compared as text (ISO order), so an impossible date such as 2024-02-30 never raises an error.
--   * Counts only; no names or identifiers leave the function.
--
-- SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role. Idempotent.
-- Read by src/lib/external/enforcementExclusions.functions.ts with rpcPostOptional; until it is applied the UI falls
-- back to the LEIE national series of the insights layer (metric leie_exclusions) and shows SAM as not available.

begin;

create or replace function public.exclusions_trends_v1(p_as_of date default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with asof as (
    select to_char(coalesce(p_as_of, current_date), 'YYYY-MM-DD') as d
  ),
  leie_rows as (
    select r.item->'cells'->>'excluded' as dt,
           coalesce(nullif(r.item->'cells'->>'code', ''), 'not_recorded') as grp
    from public.corpus_records r
    where r.dataset = 'oig_leie_exclusions'
  ),
  sam_rows as (
    select r.item->'cells'->>'active' as dt,
           coalesce(nullif(r.item->'cells'->>'classification', ''), 'not_recorded') as grp
    from public.corpus_records r
    where r.dataset = 'sam_exclusions'
  ),
  leie_years as (
    select substr(l.dt, 1, 4) as year, l.grp, count(*)::int as n
    from leie_rows l, asof a
    where l.dt ~ '^\d{4}-\d{2}-\d{2}$' and l.dt <= a.d
    group by 1, 2
  ),
  sam_years as (
    select substr(s.dt, 1, 4) as year, s.grp, count(*)::int as n
    from sam_rows s, asof a
    where s.dt ~ '^\d{4}-\d{2}-\d{2}$' and s.dt <= a.d
    group by 1, 2
  )
  select jsonb_build_object(
    'as_of', (select d from asof),
    'leie', coalesce(
      (select jsonb_agg(jsonb_build_object('year', y.year, 'group', y.grp, 'n', y.n) order by y.year, y.grp)
         from leie_years y), '[]'::jsonb),
    'leie_total', (select count(*)::int from leie_rows),
    'leie_undated', (select count(*)::int from leie_rows l where l.dt is null or l.dt !~ '^\d{4}-\d{2}-\d{2}$'),
    'leie_future', (select count(*)::int from leie_rows l, asof a
                     where l.dt ~ '^\d{4}-\d{2}-\d{2}$' and l.dt > a.d),
    'sam', coalesce(
      (select jsonb_agg(jsonb_build_object('year', y.year, 'group', y.grp, 'n', y.n) order by y.year, y.grp)
         from sam_years y), '[]'::jsonb),
    'sam_total', (select count(*)::int from sam_rows),
    'sam_undated', (select count(*)::int from sam_rows s where s.dt is null or s.dt !~ '^\d{4}-\d{2}-\d{2}$'),
    'sam_future', (select count(*)::int from sam_rows s, asof a
                    where s.dt ~ '^\d{4}-\d{2}-\d{2}$' and s.dt > a.d)
  );
$$;

revoke all on function public.exclusions_trends_v1(date) from public, anon, authenticated;
grant execute on function public.exclusions_trends_v1(date) to service_role;

commit;

-- Verification (read only, after apply):
--   select (r->>'leie_total')::int as leie, (r->>'sam_total')::int as sam, r->'sam_future' as sam_future,
--          jsonb_array_length(r->'leie') as leie_cells
--   from (select public.exclusions_trends_v1('2026-10-27') as r) x;
--   -- expected on 2026-10-27: leie 84093, sam 169031, sam_future 2
