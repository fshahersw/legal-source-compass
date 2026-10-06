-- corpus-cleanup/1 part 2: phase planners + the single public RPC the administrative service role calls (PostgREST exposes only public).
-- Requires 00-contract-v1.sql. The RPC is SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- It never accepts SQL text: only the fixed operations below.

create or replace function corpus_ingest.cleanup_plan_phase_v1(p_phase text) returns jsonb language plpgsql set search_path = '' as $$
declare n bigint; total bigint := 0; e record; run uuid := corpus_ingest.cleanup_run_v1();
begin
  if p_phase = '1_taxonomy' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select corpus_ingest.cleanup_run_v1(), '1_taxonomy', 'drop_category_map', 'corpus_ingest.category_map', m.native_category,
           'category_map entry with zero corpus_records rows and no declaration in any corpus_datasets.metadata',
           jsonb_build_object('canonical_category', m.canonical_category, 'display_label', m.display_label, 'version', m.version, 'records_using', 0),
           md5(to_jsonb(m)::text)
    from corpus_ingest.category_map m
    where not exists (select 1 from public.corpus_records r where r.category = m.native_category)
      and not exists (select 1 from public.corpus_datasets d where d.metadata::text ilike '%' || replace(replace(m.native_category, '\', '\\'), '%', '\%') || '%') on conflict do nothing;
    get diagnostics n = row_count; total := total + n;
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select corpus_ingest.cleanup_run_v1(), '1_taxonomy', 'drop_dataset_entry', 'public.corpus_datasets', d.id,
           'Catalog entry with zero records and no context, artifact or recent ingest reference. Holds no data; held/ready status is not changed for any non-empty collection.',
           jsonb_build_object('ready', d.ready, 'imported_records', d.imported_records, 'label', d.label),
           md5(to_jsonb(d)::text)
    from public.corpus_datasets d
    where not exists (select 1 from public.corpus_records r where r.dataset = d.id)
      and coalesce(d.imported_records, 0) = 0
      and d.id not in ('open_us_law','cpsc_injury_data')
      and not exists (select 1 from public.corpus_context c where c.key like '%' || d.id || '%')
      and not exists (select 1 from public.corpus_artifacts a where a.route like '%' || d.id || '%')
      and not exists (select 1 from corpus_ingest.runs ru where (ru.status in ('running','partial') or ru.started_at > now() - interval '7 days') and ru.scope::text like '%' || d.id || '%') on conflict do nothing;
    get diagnostics n = row_count; total := total + n;
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select corpus_ingest.cleanup_run_v1(), '1_taxonomy', 'drop_display_group', 'public.corpus_display_groups', g.id,
           'Display group none of whose member_ids exists in corpus_records',
           jsonb_build_object('metadata_title', g.metadata->>'title', 'member_ids', g.metadata->'member_ids'), md5(to_jsonb(g)::text)
    from public.corpus_display_groups g
    where jsonb_typeof(g.metadata->'member_ids') = 'array'
      and not exists (select 1 from public.corpus_records r where r.id in (select jsonb_array_elements_text(g.metadata->'member_ids'))) on conflict do nothing;
    get diagnostics n = row_count; total := total + n;
  elsif p_phase = '2_useless_rows' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select corpus_ingest.cleanup_run_v1(), '2_useless_rows', 'delete_empty_record', r.dataset, r.id,
           'Empty shell: no title, text, detail, source URL, filled cell or native identifier',
           jsonb_build_object('category', r.category, 'state', r.state, 'ordinal', r.ordinal), md5(to_jsonb(r)::text)
    from public.corpus_records r
    where (r.title is null or btrim(r.title) = '') and (r.text is null or btrim(r.text) = '')
      and (r.detail is null or r.detail = '{}'::jsonb) and (r.source_url is null or btrim(r.source_url) = '')
      and not exists (select 1 from jsonb_each(case when jsonb_typeof(r.item->'cells') = 'object' then r.item->'cells' else '{}'::jsonb end) c where not corpus_ingest.cleanup_is_empty_v1(c.value))
      and coalesce(r.filters->>'native_id', '') = '' and not (r.filters ? 'native_case_id' and not corpus_ingest.cleanup_is_empty_v1(r.filters->'native_case_id'))
      and not exists (select 1 from public.corpus_workspace_docket_links l where l.source_dataset = r.dataset and l.source_record_id = r.id)
      and r.dataset not in ('open_us_law','cpsc_injury_data') on conflict do nothing;
    get diagnostics n = row_count; total := total + n;
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, survivor_id, reason, evidence, row_md5, survivor_md5)
    select corpus_ingest.cleanup_run_v1(), '2_useless_rows', 'delete_superseded_record', s.dataset, s.id, s.id,
           'Superseded projection row; the live dataset holds the same exact id and is at least as complete',
           jsonb_build_object('live_dataset', regexp_replace(s.dataset, '_superseded$', ''),
              'score_superseded', corpus_ingest.cleanup_score_v1(s.item, s.detail, s.filters, s.source_url, s.text, s.title),
              'score_live', corpus_ingest.cleanup_score_v1(l.item, l.detail, l.filters, l.source_url, l.text, l.title)),
           md5(to_jsonb(s)::text), md5(to_jsonb(l)::text)
    from public.corpus_records s
    join public.corpus_records l on l.dataset = regexp_replace(s.dataset, '_superseded$', '') and l.id = s.id
    where s.dataset ~ '_superseded$'
      and corpus_ingest.cleanup_score_v1(l.item, l.detail, l.filters, l.source_url, l.text, l.title) >= corpus_ingest.cleanup_score_v1(s.item, s.detail, s.filters, s.source_url, s.text, s.title) on conflict do nothing;
    get diagnostics n = row_count; total := total + n;
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select corpus_ingest.cleanup_run_v1(), '2_useless_rows', 'drop_orphan_docket_link', 'public.corpus_workspace_docket_links', l.source_dataset || '|' || l.source_record_id,
           'Docket link whose source record is absent from corpus_records (all datasets)',
           jsonb_build_object('source_dataset', l.source_dataset, 'source_record_id', l.source_record_id, 'cl_docket_id', l.cl_docket_id), md5(to_jsonb(l)::text)
    from public.corpus_workspace_docket_links l
    where not exists (select 1 from public.corpus_records r where r.id = l.source_record_id)
      and (select count(*) from public.corpus_workspace_docket_links x where x.source_dataset = l.source_dataset and x.source_record_id = l.source_record_id) = 1 on conflict do nothing;
    get diagnostics n = row_count; total := total + n;
  elsif p_phase = '3_dedupe' then
    -- exact native-identifier duplicates inside one dataset and MDL; survivor = most complete row (see 20-plan-dedupe.sql for the rules)
    for e in select * from (values
        ('sw_matters_v1', $x$r.filters->>'native_id'$x$), ('sw_matter_dockets_v1', $x$r.filters->>'native_id'$x$), ('cl_docket_metadata', $x$r.filters->>'native_id'$x$),
        ('sw_docket_entries_v1', $x$r.filters->>'native_id'$x$), ('cl_master_entries', $x$r.filters->>'native_id'$x$), ('sw_matter_parties_v1', $x$r.filters->>'native_id'$x$),
        ('cl_people', $x$r.filters->>'native_id'$x$) ) v(dataset, native_id_expr) where v.dataset <> 'cl_people' loop
      execute format($f$
        with c as (
          select r.id, r.ordinal, r.category, %s as k, coalesce(r.filters->>'mdl','') as mdl, coalesce(r.filters->>'conflict','') = 'true' as conflict,
                 corpus_ingest.cleanup_score_v1(r.item, r.detail, r.filters, r.source_url, r.text, r.title) as score, md5(to_jsonb(r)::text) as row_md5
            from public.corpus_records r where r.dataset = %L),
        k as (select *, count(*) over (partition by mdl, k) as gsize, row_number() over (partition by mdl, k order by score desc, ordinal, id) as rn
                from c where k is not null and btrim(k) <> ''),
        bad as (select mdl, k from k group by mdl, k having count(*) > 1 and (bool_or(conflict) or count(distinct category) > 1))
        insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, survivor_id, reason, evidence, row_md5, survivor_md5)
        select %L::uuid, '3_dedupe', 'merge_duplicate_record', %L, d.id, w.id, 'Exact native-identifier duplicate inside one dataset; merged into the most complete row',
               jsonb_build_object('native_key', d.k, 'mdl', d.mdl, 'score_duplicate', d.score, 'score_survivor', w.score, 'group_size', w.gsize), d.row_md5, w.row_md5
          from k d join k w on w.mdl = d.mdl and w.k = d.k and w.rn = 1
         where d.id <> w.id and d.gsize > 1 and not exists (select 1 from bad b where b.mdl = d.mdl and b.k = d.k)
        on conflict do nothing$f$, e.native_id_expr, e.dataset, run, e.dataset);
      get diagnostics n = row_count; total := total + n;
    end loop;
  else raise exception 'Unknown phase' using errcode = '22023';
  end if;
  return jsonb_build_object('run', run, 'phase', p_phase, 'planned_rows_inserted', total);
end $$;

create or replace function public.corpus_admin_cleanup_v1(p_op text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run uuid; ph text := p_args->>'phase'; res jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_op = 'open_run' then
    insert into corpus_ingest.runs(id, status, scope)
    select gen_random_uuid(), 'running', jsonb_build_object('contract', 'corpus-cleanup/1',
      'purpose', 'taxonomy and useless-row cleanup, then exact/native-ID de-duplication; reversible via corpus_ingest.cleanup_decisions',
      'owner_instruction', '2026-10-06: corpus development resumes; remove gaps/duplicates/useless data/unnecessary taxonomy',
      'excluded', jsonb_build_array('open_us_law','cpsc_injury_data','matter PDFs','held collections (not released or overwritten)','people/judge merges','MDL membership changes'))
    where not exists (select 1 from corpus_ingest.runs where scope->>'contract' = 'corpus-cleanup/1' and status in ('running','partial'));
    return jsonb_build_object('run', corpus_ingest.cleanup_run_v1());
  end if;
  run := corpus_ingest.cleanup_run_v1();
  if p_op = 'plan' then return corpus_ingest.cleanup_plan_phase_v1(ph);
  elsif p_op = 'counts' then return corpus_ingest.cleanup_capture_counts_v1(run, ph, p_args->>'stage');
  elsif p_op = 'apply' then return corpus_ingest.cleanup_apply_v1(run, ph, coalesce((p_args->>'limit')::int, 1000), coalesce((p_args->>'dry')::boolean, true));
  elsif p_op = 'fix_counters' then return corpus_ingest.cleanup_fix_counters_v1(run, ph);
  elsif p_op = 'rollback' then return corpus_ingest.cleanup_rollback_v1(run, ph, coalesce((p_args->>'dry')::boolean, true));
  elsif p_op = 'status' then
    return jsonb_build_object('run', run, 'plan', coalesce((select jsonb_agg(x) from (select phase, action, status, status_note, count(*) as n from corpus_ingest.cleanup_plan where run_id = run group by 1,2,3,4 order by 1,2,3,4) x), '[]'::jsonb),
      'counts', coalesce((select jsonb_agg(c order by phase, dataset, stage) from (select phase, stage, dataset, rows, id_md5 from corpus_ingest.cleanup_counts where run_id = run) c), '[]'::jsonb),
      'ledger', coalesce((select jsonb_agg(l) from (select issue, disposition, count(*) as n from corpus_ingest.cleanup_decisions where run_id = run group by 1,2 order by 1,2) l), '[]'::jsonb));
  elsif p_op = 'plan_sample' then
    return coalesce((select jsonb_agg(x) from (select action, dataset, record_id, survivor_id, status, status_note, reason from corpus_ingest.cleanup_plan where run_id = run and phase = ph order by seq limit coalesce((p_args->>'limit')::int, 50)) x), '[]'::jsonb);
  elsif p_op = 'ledger_export' then
    return coalesce((select jsonb_agg(x) from (select dataset, record_id, issue, disposition, reason, evidence, original_record, replacement from corpus_ingest.cleanup_decisions
      where run_id = run and issue = coalesce(p_args->>'issue', issue) order by dataset, record_id limit coalesce((p_args->>'limit')::int, 1000) offset coalesce((p_args->>'offset')::int, 0)) x), '[]'::jsonb);
  elsif p_op = 'verify' then
    return jsonb_build_object('applied_without_ledger', (select count(*) from corpus_ingest.cleanup_plan p where p.run_id = run and p.status = 'applied'
          and not exists (select 1 from corpus_ingest.cleanup_decisions d where d.run_id = p.run_id and d.dataset = p.dataset and d.record_id = p.record_id and d.issue = 'cleanup_20261006_' || p.action)),
      'counter_mismatch', (select count(*) from public.corpus_datasets d where d.imported_records is distinct from (select count(*) from public.corpus_records r where r.dataset = d.id)),
      'docket_links_missing_source', (select count(*) from public.corpus_workspace_docket_links l where not exists (select 1 from public.corpus_records r where r.dataset = l.source_dataset and r.id = l.source_record_id)));
  elsif p_op = 'schema_probe' then
    return jsonb_build_object('corpus_ingest_tables', (select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'corpus_ingest' and c.relkind = 'r'),
      'category_map_rows', (select count(*) from corpus_ingest.category_map), 'runs', (select count(*) from corpus_ingest.runs), 'entities', (select count(*) from corpus_ingest.entities));
  end if;
  raise exception 'Unknown operation' using errcode = '22023';
end $$;

revoke all on function corpus_ingest.cleanup_plan_phase_v1(text) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_plan_phase_v1(text) to service_role;
revoke all on function public.corpus_admin_cleanup_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_admin_cleanup_v1(text, jsonb) to service_role;
