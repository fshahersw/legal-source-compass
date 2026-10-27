-- corpus_pdf_case_aliases_v1, set-based body (contract v2). Same function name, signature, output, limits,
-- SECURITY DEFINER, search_path and grants as database/contracts/corpus-pdf-case-aliases-v1.sql; only the body changes.
--
-- Why: the v1 body calls public.corpus_pdf_same_docket_formatting_v1 once for every distinct registered
-- native_case_id (about 3,040) times every asked id (3-9 per matter), about 27,000 calls of 0.35 ms for MDL 2804
-- (EXPLAIN ANALYZE 9.4 s; production mean 3.5 s per call). This body parses the distinct ids once and the asked ids
-- once, then joins on (office, year, type, number) with the same court rule: 219 ms for MDL 2804 with the identical
-- result.
--
-- Equivalence with v1, rule by rule:
--   * the same docket regex, applied to btrim(id), for both sides;
--   * two-digit years: >= 68 -> 19xx, else 20xx; four-digit years as written;
--   * office, type (case-insensitive) and number (leading zeros dropped) must match;
--   * the court prefix matches when either side has none, or both are equal (case-insensitive);
--   * the candidate's year must lie in 1968-2099 (v1 tests the left side, which is the candidate);
--   * 'MDL <n>' and 'MDL No. <n>' are added for the matter's own number only (n = 1-6 digits, no leading zero);
--   * ids already asked for are excluded with the same NULL semantics (not (id = any(p_case_ids)));
--   * sorted by id, at most 20; 1-50 asked ids, otherwise '{}'; service role only.
-- Parity gate (read-only, run by the lead before and after): scripts/admin/parity-pdf-case-aliases.mjs.
-- Rollback: re-apply database/contracts/corpus-pdf-case-aliases-v1.sql.
-- corpus_pdf_same_docket_formatting_v1 is left in place (v1 rollback and any other caller use it).

create or replace function public.corpus_pdf_case_aliases_v1(p_case_ids text[], p_mdl text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter_mdl text := p_mdl;
  docket_form constant text :=
    '^(([A-Za-z]{2,12})-)?([0-9]{1,2}):([0-9]{2}|[0-9]{4})-?([A-Za-z]{2})-?0*([0-9]{1,6})((-[A-Za-z]{1,5})*)$';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_case_ids is null or cardinality(p_case_ids) not between 1 and 50 then
    return '{}'::text[];
  end if;
  if matter_mdl is null or matter_mdl !~ '^[1-9][0-9]{0,5}$' then
    matter_mdl := null;
  end if;
  return coalesce((
    with ids as materialized (
      select distinct a.native_case_id as id
        from corpus_ingest.pdf_document_assets a
       where a.native_case_id is not null
    ),
    parsed as materialized (
      select id, regexp_match(btrim(id), docket_form) as g
        from ids
    ),
    cand as materialized (
      select id,
             lower(g[2]) as court,
             g[3]::int as office,
             case
               when length(g[4]) = 4 then g[4]::int
               when g[4]::int >= 68 then 1900 + g[4]::int
               else 2000 + g[4]::int
             end as yr,
             lower(g[5]) as typ,
             g[6]::int as num
        from parsed
       where g is not null
    ),
    asked as materialized (
      select lower(g[2]) as court,
             g[3]::int as office,
             case
               when length(g[4]) = 4 then g[4]::int
               when g[4]::int >= 68 then 1900 + g[4]::int
               else 2000 + g[4]::int
             end as yr,
             lower(g[5]) as typ,
             g[6]::int as num
        from (select regexp_match(btrim(x), docket_form) as g from unnest(p_case_ids) as x) s
       where g is not null
    )
    select array_agg(id order by id)
      from (
        select u.id
          from (
            select i.id
              from ids i
             where matter_mdl is not null
               and i.id in ('MDL ' || matter_mdl, 'MDL No. ' || matter_mdl)
            union
            select c.id
              from cand c
              join asked k
                on c.office = k.office
               and c.yr = k.yr
               and c.typ = k.typ
               and c.num = k.num
             where c.yr between 1968 and 2099
               and (c.court is null or k.court is null or c.court = k.court)
          ) u
         where not (u.id = any (p_case_ids))
         order by 1
         limit 20
      ) matched
  ), '{}'::text[]);
end
$$;

revoke all on function public.corpus_pdf_case_aliases_v1(text[], text) from public, anon, authenticated;
grant execute on function public.corpus_pdf_case_aliases_v1(text[], text) to service_role;
