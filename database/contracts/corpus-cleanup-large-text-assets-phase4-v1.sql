-- corpus-cleanup/1 patch 18: phase-4 planner step for the 77 held large_text_assets rows that are open_us_law records (id large-text:oul:<hash>).
-- Owner decision 2026-10-06: they go with open_us_law unless their text is referenced elsewhere (dependents scan: no other dataset or context references them).
-- Plans rows only; they are applied in phase 4 behind the same gates as the other derived rows. Requires 10. The 77 matching corpus_artifacts rows (all ready = false)
-- and their storage objects are NOT part of this plan: object removal is the owner's Storage-API procedure (docs/owner-data-removal-2026-10-05.md).
create or replace function corpus_ingest.cleanup_plan_open_us_law_v1(p_step text) returns jsonb language plpgsql set search_path = '' as $$
declare n bigint := 0; run uuid := corpus_ingest.cleanup_run_v1();
begin
  if p_step = '4_open_us_law:context' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '4_open_us_law', 'delete_open_us_law_context', 'public.corpus_context', c.key,
           'Context payload derived from open_us_law (mentions open_us_law / oul: row ids); goes only with open_us_law, after the owner releases the export gate',
           jsonb_build_object('ready', c.ready, 'prefix', split_part(c.key, ':', 1) || ':' || split_part(c.key, ':', 2)), md5(to_jsonb(c)::text)
    from public.corpus_context c
    where (c.key like 'federal:part:%' or c.key like 'coverage:%' or c.key like 'core:%' or c.key = 'federal:info' or c.key like 'supplement%')
      and (c.data::text like '%open_us_law%' or c.data::text like '%oul:%' or c.data::text ilike '%open-us-law%')
    on conflict do nothing;
  elsif p_step = '4_open_us_law:coverage_topics' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '4_open_us_law', 'delete_derived_record', r.dataset, r.id,
           'coverage_topics row derived from an open_us_law row (item.row_id oul:*); goes only with open_us_law, after the owner releases the export gate',
           jsonb_build_object('row_id', r.item->>'row_id', 'family', r.item->>'family'), md5(to_jsonb(r)::text)
    from public.corpus_records r
    where r.dataset = 'coverage_topics' and r.id like 'open\_us\_law\_row:%' escape '\' and coalesce(r.item->>'row_id', '') like 'oul:%'
    on conflict do nothing;
  elsif p_step = '4_open_us_law:large_text_assets' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '4_open_us_law', 'delete_derived_record', r.dataset, r.id,
           'Held large_text_assets row whose id is an open_us_law record (large-text:oul:<hash>); goes with open_us_law (owner decision 2026-10-06), after the export gate',
           jsonb_build_object('category', r.category, 'source_url', r.source_url), md5(to_jsonb(r)::text)
    from public.corpus_records r where r.dataset = 'large_text_assets' and r.id like 'large-text:oul:%'
    on conflict do nothing;
  elsif p_step = '4_open_us_law:catalog' then
    if not exists (select 1 from corpus_ingest.cleanup_gates g where g.gate = 'open_us_law_export_verified' and g.released) then raise exception 'Gate open_us_law_export_verified is not released' using errcode = '42501'; end if;
    if exists (select 1 from public.corpus_records r where r.dataset = 'open_us_law') then raise exception 'open_us_law records still exist: finish the batch deletion first' using errcode = '22023'; end if;
    if exists (select 1 from public.corpus_datasets d where d.id = 'open_us_law' and coalesce(d.imported_records, 0) <> 0) then raise exception 'imported_records of open_us_law is not 0 yet' using errcode = '22023'; end if;
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '4_open_us_law', 'drop_dataset_entry', 'public.corpus_datasets', d.id,
           'open_us_law catalog entry removed after its records (owner decision 2026-10-05; export verified)', jsonb_build_object('ready', d.ready, 'label', d.label), md5(to_jsonb(d)::text)
    from public.corpus_datasets d where d.id = 'open_us_law'
    on conflict do nothing;
  else raise exception 'Unknown phase 4 step' using errcode = '22023';
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('run', run, 'step', p_step, 'planned_rows_inserted', n);
end $$;
