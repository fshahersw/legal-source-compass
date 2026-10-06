-- Read-only lookup of registered PDF case ids that are another spelling of a docket the
-- matter page already requests, or an MDL / MDL No. label for that matter's own number.
--
-- Formatting is hyphens, zero-padding, a two-digit or four-digit year, letter case, a trailing
-- judge suffix, and a court prefix when the other id has none. Two different court prefixes are
-- not the same docket. Captions, firms, and parties are not read.
--
-- The matter page passes the ids it already requests plus its MDL number. This function returns
-- at most 20 additional registered native_case_id values. It does not create a matter page.

create or replace function public.corpus_pdf_same_docket_formatting_v1(p_left text, p_right text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  with parsed as (
    select side,
           (regexp_match(
             btrim(id),
             '^(([A-Za-z]{2,12})-)?([0-9]{1,2}):([0-9]{2}|[0-9]{4})-?([A-Za-z]{2})-?0*([0-9]{1,6})((-[A-Za-z]{1,5})*)$'
           )) as g
      from (values ('l', p_left), ('r', p_right)) as v(side, id)
  ),
  keys as (
    select side,
           lower(g[2]) as court,
           g[3]::int as office,
           case
             when length(g[4]) = 4 then g[4]::int
             when g[4]::int >= 68 then 1900 + g[4]::int
             else 2000 + g[4]::int
           end as year,
           lower(g[5]) as type,
           g[6]::int as num
      from parsed
     where g is not null
  )
  select exists (
    select 1
      from keys l
      join keys r on l.side = 'l' and r.side = 'r'
     where l.office = r.office
       and l.year = r.year
       and l.year between 1968 and 2099
       and l.type = r.type
       and l.num = r.num
       and (l.court is null or r.court is null or l.court = r.court)
  );
$$;

create or replace function public.corpus_pdf_case_aliases_v1(p_case_ids text[], p_mdl text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter_mdl text := p_mdl;
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
    select array_agg(id order by id)
      from (
        select ids.id
          from (
            select distinct a.native_case_id as id
              from corpus_ingest.pdf_document_assets a
             where a.native_case_id is not null
          ) ids
         where not (ids.id = any (p_case_ids))
           and (
             (matter_mdl is not null and ids.id in ('MDL ' || matter_mdl, 'MDL No. ' || matter_mdl))
             or exists (
               select 1
                 from unnest(p_case_ids) asked
                where public.corpus_pdf_same_docket_formatting_v1(ids.id, asked)
             )
           )
         order by 1
         limit 20
      ) matched
  ), '{}'::text[]);
end
$$;

revoke all on function public.corpus_pdf_same_docket_formatting_v1(text, text) from public, anon, authenticated;
revoke all on function public.corpus_pdf_case_aliases_v1(text[], text) from public, anon, authenticated;
grant execute on function public.corpus_pdf_same_docket_formatting_v1(text, text) to service_role;
grant execute on function public.corpus_pdf_case_aliases_v1(text[], text) to service_role;
