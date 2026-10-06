-- corpus-cleanup/1 patch 12: read-only re-check that nothing outside the open_us_law collection still references open_us_law records.
-- public.corpus_open_us_law_dependents_v1(p_dataset) is SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- A "reference" is a match of  oul:<32+ hex>  (record links, publisher_record_id, record_id) or the strings "open_us_law" / record/open_us_law
-- inside item, detail, filters or text of a record, or inside the data of a context row.
-- Default scope = the datasets where references were found on 2026-10-06 (federal_regulations_sections, citation_index, limitation_periods, large_text_assets,
-- saved_pages, sources) plus every corpus_context row not in the staged phase-4 plan. Pass p_dataset to scan any other dataset (may exceed the API timeout on huge ones).
-- Result: matches per dataset/context prefix; "blocking_total" excludes rows that go with open_us_law by design (large_text_assets, coverage_topics derived rows,
-- and contexts planned in phase 4). ok = (blocking_total = 0). When ok, the owner can release gate 'open_us_law_dependents_clear'.
create or replace function public.corpus_open_us_law_dependents_v1(p_dataset text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  pat constant text := 'oul:[0-9a-f]{32}|"open_us_law"|record/open_us_law';
  ds text; n_all bigint; n_hit bigint; res jsonb := '{}'::jsonb; ctx jsonb; blocking bigint := 0; by_design bigint := 0; datasets text[];
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  datasets := case when p_dataset is null then array['federal_regulations_sections','citation_index','limitation_periods','large_text_assets','saved_pages','sources'] else array[p_dataset] end;
  foreach ds in array datasets loop
    if ds = 'open_us_law' then raise exception 'open_us_law itself is not a dependent' using errcode = '22023'; end if;
    select count(*), count(*) filter (where (r.item::text || r.detail::text || r.filters::text || coalesce(r.text, '')) ~ pat) into n_all, n_hit from public.corpus_records r where r.dataset = ds;
    res := res || jsonb_build_object(ds, jsonb_build_object('rows', n_all, 'referencing', n_hit, 'by_design', ds in ('large_text_assets', 'coverage_topics')));
    if ds in ('large_text_assets', 'coverage_topics') then by_design := by_design + n_hit; else blocking := blocking + n_hit; end if;
  end loop;
  if p_dataset is null then
    select coalesce(jsonb_object_agg(pfx, jsonb_build_object('rows', rows, 'referencing', hits)), '{}'::jsonb) into ctx
    from (select split_part(c.key, ':', 1) || ':' || split_part(c.key, ':', 2) as pfx, count(*) as rows,
                 count(*) filter (where c.data::text ~ pat and not exists (select 1 from corpus_ingest.cleanup_plan p where p.action = 'delete_open_us_law_context' and p.record_id = c.key)) as hits
            from public.corpus_context c group by 1) s where hits > 0;
    select coalesce(sum((v->>'referencing')::bigint), 0) into n_hit from jsonb_each(ctx) e(k, v);
    blocking := blocking + n_hit;
    res := res || jsonb_build_object('contexts_not_in_plan', ctx);
  end if;
  return jsonb_build_object('scanned', datasets, 'datasets', res, 'blocking_total', blocking, 'by_design_total', by_design, 'ok', blocking = 0, 'checked_at', now());
end $$;
revoke all on function public.corpus_open_us_law_dependents_v1(text) from public, anon, authenticated;
grant execute on function public.corpus_open_us_law_dependents_v1(text) to service_role;
