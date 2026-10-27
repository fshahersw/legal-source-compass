-- Proposal-to-final rule pace per agency (v1). Read-only RPC over legal_atlas.edges; idempotent. LEAD applies.
--
-- public.law_rule_lifecycle_v1() returns
--   { as_of: latest edge source_date,
--     agencies: [{ agency, prefix, rins_proposed, finalized, median_days, p25_days, p75_days, open_since_2021 }] }
-- Read by src/lib/law/ruleLifecycle.functions.ts (rpcPostOptional; the /law/rulemaking card stays hidden until this
-- function exists).
--
-- Rules (exact identifiers only):
--   - A RIN's first proposal is its earliest 'proposes' edge; its first final rule is the earliest 'finalizes' edge on
--     or after that proposal (a final rule before the first proposal is not counted). RIN = to_key->>2.
--   - Agencies by RIN prefix only: 0910 FDA, 2127 NHTSA, 3041 CPSC, 3084 FTC, EPA prefixes 2040, 2050, 2060, 2070,
--     2080 and 2090 (regex '^20[4-9]0-'; the prefix label '2040–2090' and the page's About text say exactly
--     this). Other 20xx prefixes held in legal_atlas (2020: 13 proposes / 13 finalizes edges, 2025: 31 / 28,
--     2030: 4 / 11 on 2026-10-27) are not counted until their agency is checked against the reginfo agency list.
--   - "open_since_2021": first proposal on or after 2021-01-01 with no final rule in the records held; the rule may
--     have been withdrawn. The page labels it that way.
--   - legal_atlas Federal Register records stop at their last refresh (2026-10-02 on 2026-10-27); as_of says so.
--
-- Apply and verify (LEAD):
--   \i database/contracts/law-rule-lifecycle-v1.sql
--   select public.law_rule_lifecycle_v1();
--   -- read-only check run 2026-10-27 with the same query: CPSC 12 proposed / 4 finalized / median 307.5 days;
--   -- EPA 1,284 / 1,018 / 308; FDA 221 / 136 / 723; FTC 52 / 42 / 468; NHTSA 288 / 203 / 369; as_of 2026-10-02.

begin;

create or replace function public.law_rule_lifecycle_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  with e as (
    select e.type::text as t, e.to_key ->> 2 as rin, e.source_date as d
    from legal_atlas.edges e
    where e.type::text in ('proposes', 'finalizes') and e.source_date is not null and e.to_key ->> 2 is not null
  ), p as (
    select rin, min(d) as first_prop from e where t = 'proposes' group by rin
  ), f as (
    select p.rin, p.first_prop, min(x.d) filter (where x.d >= p.first_prop) as first_final
    from p left join e x on x.rin = p.rin and x.t = 'finalizes'
    group by p.rin, p.first_prop
  ), a(agency, prefix, re, ord) as (
    values ('FDA', '0910', '^0910-', 1), ('NHTSA', '2127', '^2127-', 2), ('CPSC', '3041', '^3041-', 3),
           ('EPA', '2040–2090', '^20[4-9]0-', 4), ('FTC', '3084', '^3084-', 5)
  ), agg as (
    select a.agency, a.prefix, a.ord,
           count(*) as rins_proposed,
           count(f.first_final) as finalized,
           percentile_cont(0.5) within group (order by (f.first_final - f.first_prop))
             filter (where f.first_final is not null) as median_days,
           percentile_cont(0.25) within group (order by (f.first_final - f.first_prop))
             filter (where f.first_final is not null) as p25_days,
           percentile_cont(0.75) within group (order by (f.first_final - f.first_prop))
             filter (where f.first_final is not null) as p75_days,
           count(*) filter (where f.first_final is null and f.first_prop >= date '2021-01-01') as open_since_2021
    from a join f on f.rin ~ a.re
    group by a.agency, a.prefix, a.ord
  )
  select jsonb_build_object(
    'as_of', (select max(d) from e),
    'agencies', coalesce((select jsonb_agg(jsonb_build_object(
        'agency', agency, 'prefix', prefix, 'rins_proposed', rins_proposed, 'finalized', finalized,
        'median_days', median_days, 'p25_days', p25_days, 'p75_days', p75_days, 'open_since_2021', open_since_2021)
        order by ord) from agg), '[]'::jsonb))
$$;

revoke all on function public.law_rule_lifecycle_v1() from public, anon, authenticated;
grant execute on function public.law_rule_lifecycle_v1() to service_role;

commit;
