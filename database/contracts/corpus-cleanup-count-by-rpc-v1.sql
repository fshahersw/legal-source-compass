-- corpus-cleanup/1 patch 07 (OPTIONAL, apply only if a page needs live grouped counts with no public path):
-- one narrow, read-only grouped-count RPC. Per AGENTS.md: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Safety: service role only; published (ready) datasets only; grouping field is either category/state or a filter key the dataset itself declares in
-- corpus_datasets.metadata.listing.filters (no arbitrary column or JSON path); at most 1,000 groups; exact counts (a timeout surfaces as an error, never a guess).
-- Unknown values come back as value = null (the UI shows "Not recorded").
-- Example: select public.corpus_count_by_v1('sw_matter_dockets_v1', 'year');  -- dockets per filing year, if 'year' is a declared filter.
-- Records per collection already exist: corpus_datasets.imported_records (verified equal to actual rows for all 92 entries on Oct 6).
create or replace function public.corpus_count_by_v1(p_dataset text, p_field text, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb; total bigint; n_groups bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'p_limit must be 1..1000' using errcode = '22023'; end if;
  if not exists (select 1 from public.corpus_datasets d where d.id = p_dataset and d.ready) then raise exception 'Dataset is not published' using errcode = '22023'; end if;
  if p_field in ('category', 'state') then
    execute format('select count(*), count(distinct %I) from public.corpus_records where dataset = $1', p_field) into total, n_groups using p_dataset;
    execute format('select coalesce(jsonb_agg(jsonb_build_object(''value'', v, ''rows'', n) order by n desc, v), ''[]''::jsonb) from (select %I as v, count(*) as n from public.corpus_records where dataset = $1 group by 1 order by 2 desc, 1 limit $2) s', p_field)
      into res using p_dataset, p_limit;
  elsif exists (select 1 from public.corpus_datasets d, jsonb_array_elements(case when jsonb_typeof(d.metadata->'listing'->'filters') = 'array' then d.metadata->'listing'->'filters' else '[]'::jsonb end) f
                where d.id = p_dataset and f->>'key' = p_field) then
    select count(*), count(distinct filters->>p_field) into total, n_groups from public.corpus_records where dataset = p_dataset;
    select coalesce(jsonb_agg(jsonb_build_object('value', v, 'rows', n) order by n desc, v), '[]'::jsonb) into res
      from (select filters->>p_field as v, count(*) as n from public.corpus_records where dataset = p_dataset group by 1 order by 2 desc, 1 limit p_limit) s;
  else
    raise exception 'Field is not category, state or a declared filter of this dataset' using errcode = '22023';
  end if;
  return jsonb_build_object('dataset', p_dataset, 'field', p_field, 'total_rows', total, 'distinct_values', n_groups, 'truncated', n_groups > p_limit, 'groups', res);
end $$;
revoke all on function public.corpus_count_by_v1(text, text, integer) from public, anon, authenticated;
grant execute on function public.corpus_count_by_v1(text, text, integer) to service_role;
