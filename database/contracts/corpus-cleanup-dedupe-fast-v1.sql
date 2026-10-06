-- corpus-cleanup/1 patch 05 (supersedes the dedupe branch of 03; apply after 03): the planner is split into steps so each call stays inside the API statement timeout (~8 s),
-- and the empty-shell step accepts an explicit candidate list. Only the function cleanup_plan_step_v1 is replaced (the wrapper from 03 is unchanged).
-- Dedupe planner: lightweight duplicate-key scan first (no score/md5); heavy work only for duplicated keys; no-op when there are none.
-- Steps: '1_taxonomy:category_map' | ':datasets' | ':display_groups' | '2_useless_rows:shells' (args.candidates=[{dataset,id}..]) | ':superseded' | ':links'
--        | '3_dedupe:<dataset>'.  The plan rows still carry phase 1_taxonomy / 2_useless_rows / 3_dedupe.

create or replace function corpus_ingest.cleanup_plan_step_v1(p_step text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare n bigint := 0; ngroups bigint := 0; run uuid := corpus_ingest.cleanup_run_v1(); ds text; expr text;
begin
  if p_step = '1_taxonomy:category_map' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '1_taxonomy', 'drop_category_map', 'corpus_ingest.category_map', m.native_category,
           'category_map entry with zero corpus_records rows and no declaration in any corpus_datasets.metadata',
           jsonb_build_object('canonical_category', m.canonical_category, 'display_label', m.display_label, 'version', m.version, 'records_using', 0),
           md5(to_jsonb(m)::text)
    from corpus_ingest.category_map m
    where not exists (select 1 from public.corpus_records r where r.category = m.native_category)
      and not exists (select 1 from public.corpus_datasets d where d.metadata::text ilike '%' || replace(replace(m.native_category, '\', '\\'), '%', '\%') || '%')
    on conflict do nothing;
  elsif p_step = '1_taxonomy:datasets' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '1_taxonomy', 'drop_dataset_entry', 'public.corpus_datasets', d.id,
           'Catalog entry with zero records and no context, artifact or recent ingest reference. Holds no data; held/ready status is not changed for any non-empty collection.',
           jsonb_build_object('ready', d.ready, 'imported_records', d.imported_records, 'label', d.label), md5(to_jsonb(d)::text)
    from public.corpus_datasets d
    where not exists (select 1 from public.corpus_records r where r.dataset = d.id)
      and coalesce(d.imported_records, 0) = 0 and d.id not in ('open_us_law','cpsc_injury_data')
      and coalesce((d.metadata->'listing'->>'total')::bigint, 0) = 0 and (d.metadata->'rules') is null
      and not exists (select 1 from public.corpus_context c where c.key like '%' || d.id || '%')
      and not exists (select 1 from public.corpus_artifacts a where a.route like '%' || d.id || '%')
      and not exists (select 1 from corpus_ingest.runs ru where (ru.status in ('running','partial') or ru.started_at > now() - interval '7 days') and ru.scope::text like '%' || d.id || '%')
    on conflict do nothing;
  elsif p_step = '1_taxonomy:display_groups' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '1_taxonomy', 'drop_display_group', 'public.corpus_display_groups', g.id,
           'Display group none of whose member_ids exists in corpus_records',
           jsonb_build_object('metadata_title', g.metadata->>'title', 'member_ids', g.metadata->'member_ids'), md5(to_jsonb(g)::text)
    from public.corpus_display_groups g
    where jsonb_typeof(g.metadata->'member_ids') = 'array'
      and not exists (select 1 from jsonb_array_elements_text(g.metadata->'member_ids') m(mid) where exists (select 1 from public.corpus_records r where r.id = m.mid))
    on conflict do nothing;
  elsif p_step = '2_useless_rows:shells' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '2_useless_rows', 'delete_empty_record', r.dataset, r.id,
           'Empty shell: no title, text, detail, source URL, filled cell or native identifier',
           jsonb_build_object('category', r.category, 'state', r.state, 'ordinal', r.ordinal), md5(to_jsonb(r)::text)
    from jsonb_to_recordset(coalesce(p_args->'candidates', '[]'::jsonb)) c(dataset text, id text)
    join public.corpus_records r on r.dataset = c.dataset and r.id = c.id
    where (r.title is null or btrim(r.title) = '') and (r.text is null or btrim(r.text) = '')
      and (r.detail is null or r.detail = '{}'::jsonb) and (r.source_url is null or btrim(r.source_url) = '')
      and not exists (select 1 from jsonb_each(case when jsonb_typeof(r.item->'cells') = 'object' then r.item->'cells' else '{}'::jsonb end) k where not corpus_ingest.cleanup_is_empty_v1(k.value))
      and coalesce(r.filters->>'native_id', '') = '' and not (r.filters ? 'native_case_id' and not corpus_ingest.cleanup_is_empty_v1(r.filters->'native_case_id'))
      and not exists (select 1 from public.corpus_workspace_docket_links l where l.source_dataset = r.dataset and l.source_record_id = r.id)
      and r.dataset not in ('open_us_law','cpsc_injury_data')
    on conflict do nothing;
  elsif p_step = '2_useless_rows:superseded' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, survivor_id, reason, evidence, row_md5, survivor_md5)
    select run, '2_useless_rows', 'delete_superseded_record', s.dataset, s.id, s.id,
           'Superseded projection row; the live dataset holds the same exact id and is at least as complete',
           jsonb_build_object('live_dataset', regexp_replace(s.dataset, '_superseded$', ''),
              'score_superseded', corpus_ingest.cleanup_score_v1(s.item, s.detail, s.filters, s.source_url, s.text, s.title),
              'score_live', corpus_ingest.cleanup_score_v1(l.item, l.detail, l.filters, l.source_url, l.text, l.title)),
           md5(to_jsonb(s)::text), md5(to_jsonb(l)::text)
    from public.corpus_records s
    join public.corpus_records l on l.dataset = regexp_replace(s.dataset, '_superseded$', '') and l.id = s.id
    where s.dataset ~ '_superseded$'
      and corpus_ingest.cleanup_score_v1(l.item, l.detail, l.filters, l.source_url, l.text, l.title) >= corpus_ingest.cleanup_score_v1(s.item, s.detail, s.filters, s.source_url, s.text, s.title)
    on conflict do nothing;
  elsif p_step = '2_useless_rows:links' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '2_useless_rows', 'drop_orphan_docket_link', 'public.corpus_workspace_docket_links', l.source_dataset || '|' || l.source_record_id,
           'Docket link whose source record is absent from corpus_records (all datasets)',
           jsonb_build_object('source_dataset', l.source_dataset, 'source_record_id', l.source_record_id, 'cl_docket_id', l.cl_docket_id), md5(to_jsonb(l)::text)
    from public.corpus_workspace_docket_links l
    where not exists (select 1 from public.corpus_records r where r.dataset = l.source_dataset and r.id = l.source_record_id)
      and not exists (select 1 from public.corpus_records r where r.id = l.source_record_id)
      and (select count(*) from public.corpus_workspace_docket_links x where x.source_dataset = l.source_dataset and x.source_record_id = l.source_record_id) = 1
    on conflict do nothing;
  elsif p_step like '3_dedupe:%' then
    ds := substr(p_step, 10);
    expr := case ds when 'sw_matters_v1' then 'r.filters->>''native_id''' when 'sw_matter_dockets_v1' then 'r.filters->>''native_id'''
      when 'cl_docket_metadata' then 'r.filters->>''native_id''' when 'sw_docket_entries_v1' then 'r.filters->>''native_id'''
      when 'cl_master_entries' then 'r.filters->>''native_id''' when 'sw_matter_parties_v1' then 'r.filters->>''native_id''' end;
    if expr is null then raise exception 'Dataset is not enabled for exact native-ID merge' using errcode = '22023'; end if;
    -- 1) lightweight scan: only (mdl, native key) and a count; no scoring, no md5, no row serialisation
    execute format($f$select count(*) from (select 1 from public.corpus_records r where r.dataset = %L and (%s) is not null and btrim(%s) <> ''
                       group by coalesce(r.filters->>'mdl',''), (%s) having count(*) > 1) x$f$, ds, expr, expr, expr) into ngroups;
    if ngroups > 0 then
      -- 2) heavy work only for rows whose (mdl, key) occurs more than once
      execute format($f$
        with dupkeys as materialized (
          select coalesce(r.filters->>'mdl','') as mdl, (%s) as k from public.corpus_records r
           where r.dataset = %L and (%s) is not null and btrim(%s) <> '' group by 1, 2 having count(*) > 1),
        c as (
          select r.id, r.ordinal, r.category, d.k, d.mdl, coalesce(r.filters->>'conflict','') = 'true' as conflict,
                 corpus_ingest.cleanup_score_v1(r.item, r.detail, r.filters, r.source_url, r.text, r.title) as score, md5(to_jsonb(r)::text) as row_md5
            from public.corpus_records r join dupkeys d on d.mdl = coalesce(r.filters->>'mdl','') and d.k = (%s)
           where r.dataset = %L),
        k as (select c.*, count(*) over (partition by c.mdl, c.k) as gsize, row_number() over (partition by c.mdl, c.k order by c.score desc, c.ordinal, c.id) as rn from c),
        bad as (select mdl, k from k group by mdl, k having bool_or(conflict) or count(distinct category) > 1)
        insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, survivor_id, reason, evidence, row_md5, survivor_md5)
        select %L::uuid, '3_dedupe', 'merge_duplicate_record', %L, d.id, w.id, 'Exact native-identifier duplicate inside one dataset; merged into the most complete row',
               jsonb_build_object('native_key', d.k, 'mdl', d.mdl, 'score_duplicate', d.score, 'score_survivor', w.score, 'group_size', w.gsize), d.row_md5, w.row_md5
          from k d join k w on w.mdl = d.mdl and w.k = d.k and w.rn = 1
         where d.id <> w.id and not exists (select 1 from bad b where b.mdl = d.mdl and b.k = d.k)
        on conflict do nothing$f$, expr, ds, expr, expr, expr, ds, run, ds);
      get diagnostics n = row_count;
    end if;
    return jsonb_build_object('run', run, 'step', p_step, 'duplicate_key_groups', ngroups, 'planned_rows_inserted', coalesce(n, 0));
  else raise exception 'Unknown planner step' using errcode = '22023';
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('run', run, 'step', p_step, 'planned_rows_inserted', n);
end $$;
revoke all on function corpus_ingest.cleanup_plan_step_v1(text, jsonb) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_plan_step_v1(text, jsonb) to service_role;

