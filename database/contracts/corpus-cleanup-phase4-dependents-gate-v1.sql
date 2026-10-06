-- corpus-cleanup/1 patch 19: phase 4 (open_us_law-derived contexts and rows) now also requires gate 'open_us_law_dependents_clear', as the delete batch already does.
-- Reason: until now only the export gate was checked for a non-dry apply of phase 4. Replaces cleanup_apply_v1 (otherwise identical to the version in patch 13).
create or replace function corpus_ingest.cleanup_apply_v1(p_run uuid, p_phase text, p_limit integer default 1000, p_dry boolean default true) returns jsonb
language plpgsql set search_path = '' as $$
declare
  p record; cur jsonb; srow jsonb; v_issue text; applied int := 0; skipped int := 0; would int := 0; by_action jsonb := '{}'::jsonb;
  tbl regclass; note text; sc int; dc int;
  s public.corpus_records; dup public.corpus_records; new_cells jsonb; new_alias jsonb; moved int;
  lk jsonb; lk_surv boolean;
begin
  if not exists (select 1 from corpus_ingest.runs where id = p_run and status in ('running','partial')) then
    raise exception 'Run is not open' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 10000 then raise exception 'p_limit must be 1..10000' using errcode = '22023'; end if;
  if p_phase = '4_open_us_law' and not p_dry and not exists (select 1 from corpus_ingest.cleanup_gates g where g.gate = 'open_us_law_export_verified' and g.released) then
    raise exception 'Gate open_us_law_export_verified is not released: the owner must supply the verified export evidence first' using errcode = '42501';
  end if;
  if p_phase = '4_open_us_law' and not p_dry and not exists (select 1 from corpus_ingest.cleanup_gates g where g.gate = 'open_us_law_dependents_clear' and g.released) then
    raise exception 'Gate open_us_law_dependents_clear is not released: the dependents re-check must report 0 and the owner must release this gate before phase 4 is applied' using errcode = '42501';
  end if;

  for p in select * from corpus_ingest.cleanup_plan where run_id = p_run and phase = p_phase and status = 'planned' order by seq limit p_limit loop
    v_issue := 'cleanup_20261006_' || p.action;
    cur := corpus_ingest.cleanup_row_v1(p.action, p.dataset, p.record_id);
    note := null;
    if cur is null then note := 'row_missing';
    elsif md5(cur::text) <> p.row_md5 then note := 'row_changed_since_plan';
    end if;

    if note is null and p.action = 'merge_duplicate_record' then
      select * into dup from public.corpus_records where dataset = p.dataset and id = p.record_id;
      select * into s from public.corpus_records where dataset = p.dataset and id = p.survivor_id;
      if s.id is null then note := 'survivor_missing';
      elsif md5(to_jsonb(s)::text) <> p.survivor_md5 and not exists (
              select 1 from corpus_ingest.cleanup_decisions cd where cd.dataset = p.dataset and cd.record_id = p.survivor_id
                 and cd.issue = 'cleanup_20261006_merge_survivor' and cd.run_id = p_run and cd.replacement->>'after_md5' = md5(to_jsonb(s)::text)) then
        note := 'survivor_changed_since_plan';
      else
        sc := corpus_ingest.cleanup_score_v1(s.item, s.detail, s.filters, s.source_url, s.text, s.title);
        dc := corpus_ingest.cleanup_score_v1(dup.item, dup.detail, dup.filters, dup.source_url, dup.text, dup.title);
        if dc > sc then note := 'duplicate_is_more_complete_than_survivor'; end if;
      end if;
    end if;

    if note is null and p.action in ('delete_empty_record','delete_superseded_record','drop_display_group','drop_dataset_entry') then
      if p.action in ('delete_empty_record','delete_superseded_record') and exists (
           select 1 from public.corpus_workspace_docket_links l where l.source_dataset = p.dataset and l.source_record_id = p.record_id) then
        note := 'still_referenced_by_docket_link';
      end if;
    end if;

    if note is not null then
      if not p_dry then update corpus_ingest.cleanup_plan set status = 'skipped', status_note = note where run_id = p.run_id and action = p.action and dataset = p.dataset and record_id = p.record_id; end if;
      skipped := skipped + 1; by_action := jsonb_set(by_action, array[p.action || ':skipped:' || note], to_jsonb(coalesce((by_action->>(p.action || ':skipped:' || note))::int, 0) + 1));
      continue;
    end if;

    if p_dry then
      would := would + 1; by_action := jsonb_set(by_action, array[p.action || ':would_apply'], to_jsonb(coalesce((by_action->>(p.action || ':would_apply'))::int, 0) + 1));
      continue;
    end if;

    if p.action = 'merge_duplicate_record' then
      perform corpus_ingest.cleanup_archive_v1(p_run, p.dataset, p.record_id, v_issue, 'canonical_alias', p.reason,
        p.evidence || jsonb_build_object('plan_seq', p.seq), cur, jsonb_build_object('merged_into', jsonb_build_object('dataset', p.dataset, 'id', p.survivor_id)));
      perform corpus_ingest.cleanup_archive_v1(p_run, p.dataset, p.survivor_id, 'cleanup_20261006_merge_survivor', 'review',
        'Survivor of exact-duplicate merge; original row kept for rollback', jsonb_build_object('merged_ids', jsonb_build_array(p.record_id)),
        to_jsonb(s), jsonb_build_object('after_md5', null));

      new_alias := (select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from (
          select jsonb_array_elements_text(case when jsonb_typeof(s.filters->'alias_ids') = 'array' then s.filters->'alias_ids' else '[]'::jsonb end) v
          union select dup.id
          union select jsonb_array_elements_text(case when jsonb_typeof(dup.filters->'alias_ids') = 'array' then dup.filters->'alias_ids' else '[]'::jsonb end)
          union select dup.filters->>'native_id' where coalesce(dup.filters->>'native_id', '') <> '' and dup.filters->>'native_id' is distinct from s.filters->>'native_id') x);
      new_cells := case when jsonb_typeof(s.item->'cells') = 'object' then s.item->'cells' else '{}'::jsonb end;
      if jsonb_typeof(dup.item->'cells') = 'object' then
        new_cells := new_cells || coalesce((select jsonb_object_agg(d.key, d.value) from jsonb_each(dup.item->'cells') d
                                             where not corpus_ingest.cleanup_is_empty_v1(d.value) and corpus_ingest.cleanup_is_empty_v1(new_cells->d.key)), '{}'::jsonb);
      end if;
      update public.corpus_records r set
          item = case when jsonb_typeof(r.item->'cells') = 'object' or jsonb_typeof(dup.item->'cells') = 'object' then jsonb_set(r.item, '{cells}', new_cells, true) else r.item end,
          filters = r.filters || jsonb_build_object('alias_ids', new_alias),
          source_url = coalesce(nullif(btrim(r.source_url), ''), dup.source_url),
          text = coalesce(nullif(btrim(r.text), ''), dup.text),
          detail = case when r.detail is null or r.detail = '{}'::jsonb then dup.detail else r.detail end
        where r.dataset = p.dataset and r.id = p.survivor_id;

      for lk in select to_jsonb(l) from public.corpus_workspace_docket_links l where l.source_dataset = p.dataset and l.source_record_id = p.record_id loop
        select exists (select 1 from public.corpus_workspace_docket_links l2 where l2.source_dataset = p.dataset and l2.source_record_id = p.survivor_id) into lk_surv;
        perform corpus_ingest.cleanup_archive_v1(p_run, 'public.corpus_workspace_docket_links', p.dataset || '|' || p.record_id, 'cleanup_20261006_repoint_docket_link', 'canonical_alias',
          'Docket link of a merged duplicate', jsonb_build_object('plan_seq', p.seq), lk, jsonb_build_object('source_record_id', p.survivor_id, 'deleted', lk_surv));
        if lk_surv then
          delete from public.corpus_workspace_docket_links where source_dataset = p.dataset and source_record_id = p.record_id;
        else
          update public.corpus_workspace_docket_links set source_record_id = p.survivor_id where source_dataset = p.dataset and source_record_id = p.record_id;
        end if;
      end loop;

      delete from public.corpus_records where dataset = p.dataset and id = p.record_id;
      update corpus_ingest.cleanup_decisions set replacement = jsonb_build_object('after_md5', (select md5(to_jsonb(r)::text) from public.corpus_records r where r.dataset = p.dataset and r.id = p.survivor_id))
        where dataset = p.dataset and record_id = p.survivor_id and issue = 'cleanup_20261006_merge_survivor' and run_id = p_run;

    else
      perform corpus_ingest.cleanup_archive_v1(p_run, p.dataset, p.record_id, v_issue,
        case when p.survivor_id is not null then 'canonical_alias' else 'quarantine' end, p.reason, p.evidence || jsonb_build_object('plan_seq', p.seq), cur,
        case when p.survivor_id is not null then jsonb_build_object('merged_into', p.survivor_id) else null end);
      if p.action = 'drop_category_map' then delete from corpus_ingest.category_map where native_category = p.record_id;
      elsif p.action = 'drop_dataset_entry' then delete from public.corpus_datasets where id = p.record_id;
      elsif p.action = 'drop_display_group' then delete from public.corpus_display_groups where id = p.record_id;
      elsif p.action = 'drop_orphan_docket_link' then delete from public.corpus_workspace_docket_links where source_dataset || '|' || source_record_id = p.record_id;
      elsif p.action in ('delete_open_us_law_context','delete_collection_context') then delete from public.corpus_context where key = p.record_id;
      elsif p.action = 'prune_display_group_members' then
        update public.corpus_display_groups g set metadata = g.metadata || jsonb_build_object('member_ids', k.ids, 'retained_members', jsonb_array_length(k.ids))
          || case when (g.metadata->>'source_count') ~ '^[0-9]+$' and (g.metadata->>'source_count')::int = jsonb_array_length(g.metadata->'member_ids') - 1 then jsonb_build_object('source_count', greatest(jsonb_array_length(k.ids) - 1, 0)) else '{}'::jsonb end
          from (select coalesce(jsonb_agg(m.v order by m.ord), '[]'::jsonb) as ids
                  from public.corpus_display_groups g2, jsonb_array_elements_text(g2.metadata->'member_ids') with ordinality m(v, ord)
                 where g2.id = p.record_id and not (m.v = any (array(select jsonb_array_elements_text(p.evidence->'remove_ids'))))) k
         where g.id = p.record_id;
      else delete from public.corpus_records where dataset = p.dataset and id = p.record_id;
      end if;
    end if;

    update corpus_ingest.cleanup_plan set status = 'applied', applied_at = now(), status_note = null where run_id = p.run_id and action = p.action and dataset = p.dataset and record_id = p.record_id;
    applied := applied + 1; by_action := jsonb_set(by_action, array[p.action || ':applied'], to_jsonb(coalesce((by_action->>(p.action || ':applied'))::int, 0) + 1));
  end loop;

  return jsonb_build_object('contract', 'corpus-cleanup/1', 'run', p_run, 'phase', p_phase, 'dry_run', p_dry, 'applied', applied, 'would_apply', would, 'skipped', skipped,
                            'detail', by_action, 'remaining_planned', (select count(*) from corpus_ingest.cleanup_plan where run_id = p_run and phase = p_phase and status = 'planned'));
end $$;
