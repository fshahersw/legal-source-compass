-- corpus-cleanup/1 patch 09: owner-approval-gated removal of whole collections, with the execution ordering learned from library_assets
-- (records first, dependent display groups/contexts, catalog entry only when the dataset has no records and its counter is already 0, counters last).
-- NOTHING IS PLANNED OR EXECUTED BY APPLYING THIS FILE. It adds: per-collection approval gates (all closed), two actions
-- (delete_collection_context, prune_display_group_members), and the planner corpus_ingest.cleanup_plan_collection_removal_v1(dataset, step).
-- The planner refuses to create plan rows until the owner's approval for that exact collection is recorded in the admin session:
--   update corpus_ingest.cleanup_gates set released = true, released_by = '<owner>', released_at = now(), evidence = '{"decision":"<date/ref>"}'
--    where gate = 'collection_removal:<dataset>';
-- Requires 00 (contract), 03/05 (planner base) and 06 (gate table, router, phase 4). Removal candidates (7, none gated by export): cl_courthouses,
-- agency_safety_openfda_orangebook, docsupload_coverage, judge_vendor, sw_matter_dockets_v1_superseded, trellis_browser_counties, trellis_receipts.
-- Execution per approved collection D (one collection at a time; save the 'counts' JSON each time):
--   1 gate released for D
--   2 plan step 'records'   : select public.corpus_admin_cleanup_v1('plan', '{"step":"2_useless_rows:collection:D:records"}')
--   3 plan step 'groups'    : ... "2_useless_rows:collection:D:groups"    (drops display groups made only of D rows; prunes D ids from mixed groups)
--   4 plan step 'contexts'  : ... "2_useless_rows:collection:D:contexts"  (supplement contexts named for D)
--   5 counts before, apply phase 2_useless_rows in batches (limit <= 2000), counts after, fix_counters(2_useless_rows)   -> imported_records becomes 0
--   6 plan step 'catalog'   : ... "1_taxonomy:collection:D:catalog"       (only now: 0 records and imported_records = 0 are required)
--   7 apply phase 1_taxonomy, counts after, verify, ledger_export; rollback (phase 2 then 1) restores everything from the ledger.

create table if not exists corpus_ingest.cleanup_gates (gate text primary key, released boolean not null default false, released_by text, released_at timestamptz, evidence jsonb not null default '{}'::jsonb);
insert into corpus_ingest.cleanup_gates(gate) values
  ('collection_removal:cl_courthouses'), ('collection_removal:agency_safety_openfda_orangebook'), ('collection_removal:docsupload_coverage'),
  ('collection_removal:judge_vendor'), ('collection_removal:sw_matter_dockets_v1_superseded'), ('collection_removal:trellis_browser_counties'),
  ('collection_removal:trellis_receipts')
on conflict do nothing;

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'corpus_ingest.cleanup_plan'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%action%' loop
    execute format('alter table corpus_ingest.cleanup_plan drop constraint %I', c.conname);
  end loop;
end $$;
alter table corpus_ingest.cleanup_plan add constraint cleanup_plan_action_check check (action in ('drop_category_map','drop_dataset_entry','drop_display_group','drop_orphan_docket_link',
  'delete_empty_record','delete_superseded_record','merge_duplicate_record','delete_open_us_law_context','delete_derived_record','delete_collection_context','prune_display_group_members'));

create or replace function corpus_ingest.cleanup_row_v1(p_action text, p_dataset text, p_id text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare j jsonb;
begin
  if p_action = 'drop_category_map' then
    select to_jsonb(m) into j from corpus_ingest.category_map m where m.native_category = p_id;
  elsif p_action = 'drop_dataset_entry' then
    select to_jsonb(d) into j from public.corpus_datasets d where d.id = p_id;
  elsif p_action in ('drop_display_group','prune_display_group_members') then
    select to_jsonb(g) into j from public.corpus_display_groups g where g.id = p_id;
  elsif p_action = 'drop_orphan_docket_link' then
    select to_jsonb(l) into j from public.corpus_workspace_docket_links l where l.source_dataset || '|' || l.source_record_id = p_id;
  elsif p_action in ('delete_open_us_law_context','delete_collection_context') then
    select to_jsonb(c) into j from public.corpus_context c where c.key = p_id;
  else
    select to_jsonb(r) into j from public.corpus_records r where r.dataset = p_dataset and r.id = p_id;
  end if;
  return j;
end $$;

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

create or replace function corpus_ingest.cleanup_rollback_v1(p_run uuid, p_phase text, p_dry boolean default true) returns jsonb
language plpgsql set search_path = '' as $$
declare
  p record; led record; n int := 0; conflicts int := 0; surv record; surv_restored int := 0; surv_kept int := 0; cur_md5 text;
begin
  for p in select * from corpus_ingest.cleanup_plan where run_id = p_run and phase = p_phase and status = 'applied' order by seq desc loop
    select * into led from corpus_ingest.cleanup_decisions
      where dataset = p.dataset and record_id = p.record_id and issue = 'cleanup_20261006_' || p.action and run_id = p_run;
    if not found then conflicts := conflicts + 1; continue; end if;
    if p_dry then n := n + 1; continue; end if;
    if p.action = 'prune_display_group_members' then
      update public.corpus_display_groups g set metadata = led.original_record->'metadata' where g.id = p.record_id;
    else
    perform corpus_ingest.cleanup_restore_row_v1(
      case p.action when 'drop_category_map' then 'corpus_ingest.category_map'::regclass when 'drop_dataset_entry' then 'public.corpus_datasets'::regclass
                    when 'drop_display_group' then 'public.corpus_display_groups'::regclass when 'drop_orphan_docket_link' then 'public.corpus_workspace_docket_links'::regclass
                    when 'delete_open_us_law_context' then 'public.corpus_context'::regclass when 'delete_collection_context' then 'public.corpus_context'::regclass
                    else 'public.corpus_records'::regclass end, led.original_record);
    end if;
    update corpus_ingest.cleanup_plan set status = 'rolled_back', applied_at = null where run_id = p.run_id and action = p.action and dataset = p.dataset and record_id = p.record_id;
    n := n + 1;
  end loop;

  if not p_dry then
    for led in select * from corpus_ingest.cleanup_decisions where run_id = p_run and issue = 'cleanup_20261006_repoint_docket_link' order by reviewed_at desc loop
      if (led.replacement->>'deleted')::boolean then
        perform corpus_ingest.cleanup_restore_row_v1('public.corpus_workspace_docket_links'::regclass, led.original_record);
      else
        update public.corpus_workspace_docket_links set source_record_id = led.original_record->>'source_record_id'
          where source_dataset = led.original_record->>'source_dataset' and source_record_id = led.replacement->>'source_record_id'
            and (select count(*) from public.corpus_workspace_docket_links x where x.source_dataset = led.original_record->>'source_dataset' and x.source_record_id = led.replacement->>'source_record_id') = 1;
      end if;
    end loop;

    for surv in select * from corpus_ingest.cleanup_decisions where run_id = p_run and issue = 'cleanup_20261006_merge_survivor' loop
      select md5(to_jsonb(r)::text) into cur_md5 from public.corpus_records r where r.dataset = surv.dataset and r.id = surv.record_id;
      if cur_md5 is not distinct from surv.replacement->>'after_md5' then
        update public.corpus_records r set item = surv.original_record->'item', filters = surv.original_record->'filters', detail = surv.original_record->'detail',
               source_url = surv.original_record->>'source_url', text = surv.original_record->>'text'
          where r.dataset = surv.dataset and r.id = surv.record_id;
        surv_restored := surv_restored + 1;
      else surv_kept := surv_kept + 1; end if;
    end loop;

    for led in select * from corpus_ingest.cleanup_decisions where run_id = p_run and issue = 'cleanup_20261006_counter' loop
      update public.corpus_datasets set imported_records = (led.original_record->>'imported_records')::bigint where id = led.record_id;
    end loop;
  end if;
  return jsonb_build_object('contract', 'corpus-cleanup/1', 'run', p_run, 'phase', p_phase, 'dry_run', p_dry, 'rows_restored', n, 'ledger_missing', conflicts,
                            'survivors_restored', surv_restored, 'survivors_kept_because_changed_after_merge', surv_kept);
end $$;

create or replace function corpus_ingest.cleanup_plan_collection_removal_v1(p_dataset text, p_step text) returns jsonb
language plpgsql set search_path = '' as $$
declare n bigint := 0; run uuid := corpus_ingest.cleanup_run_v1(); skipped bigint := 0;
begin
  if p_dataset not in ('cl_courthouses','agency_safety_openfda_orangebook','docsupload_coverage','judge_vendor','sw_matter_dockets_v1_superseded','trellis_browser_counties','trellis_receipts') then
    raise exception 'Dataset is not an approved removal candidate' using errcode = '22023';
  end if;
  if not exists (select 1 from corpus_ingest.cleanup_gates g where g.gate = 'collection_removal:' || p_dataset and g.released) then
    raise exception 'Owner approval for removing % is not recorded (gate collection_removal:% is closed)', p_dataset, p_dataset using errcode = '42501';
  end if;

  if p_step = 'records' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '2_useless_rows', 'delete_empty_record', r.dataset, r.id,
           'Owner-approved removal of the whole collection ' || p_dataset, jsonb_build_object('owner_gate', 'collection_removal:' || p_dataset, 'category', r.category, 'state', r.state), md5(to_jsonb(r)::text)
    from public.corpus_records r
    where r.dataset = p_dataset
      and not exists (select 1 from public.corpus_workspace_docket_links l where l.source_dataset = r.dataset and l.source_record_id = r.id)
    on conflict do nothing;
    get diagnostics n = row_count;
  elsif p_step = 'groups' then
    -- groups consisting only of rows of this dataset are dropped; mixed groups lose only this dataset's ids (their preferred id must not be one of them)
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '2_useless_rows', 'drop_display_group', 'public.corpus_display_groups', g.id,
           'Display group made only of members of removed collection ' || p_dataset, jsonb_build_object('owner_gate', 'collection_removal:' || p_dataset, 'member_ids', g.metadata->'member_ids'), md5(to_jsonb(g)::text)
    from public.corpus_display_groups g
    where jsonb_typeof(g.metadata->'member_ids') = 'array'
      and exists (select 1 from jsonb_array_elements_text(g.metadata->'member_ids') m(v) join public.corpus_records r on r.dataset = p_dataset and r.id = m.v)
      and not exists (select 1 from jsonb_array_elements_text(g.metadata->'member_ids') m(v) where not exists (select 1 from public.corpus_records r where r.dataset = p_dataset and r.id = m.v))
    on conflict do nothing;
    get diagnostics n = row_count;
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '2_useless_rows', 'prune_display_group_members', 'public.corpus_display_groups', g.id,
           'Mixed display group loses members that belong to removed collection ' || p_dataset,
           jsonb_build_object('owner_gate', 'collection_removal:' || p_dataset, 'remove_ids', (select jsonb_agg(m.v) from jsonb_array_elements_text(g.metadata->'member_ids') m(v) join public.corpus_records r on r.dataset = p_dataset and r.id = m.v)), md5(to_jsonb(g)::text)
    from public.corpus_display_groups g
    where jsonb_typeof(g.metadata->'member_ids') = 'array'
      and exists (select 1 from jsonb_array_elements_text(g.metadata->'member_ids') m(v) join public.corpus_records r on r.dataset = p_dataset and r.id = m.v)
      and exists (select 1 from jsonb_array_elements_text(g.metadata->'member_ids') m(v) where not exists (select 1 from public.corpus_records r where r.dataset = p_dataset and r.id = m.v))
      and not exists (select 1 from public.corpus_records r where r.dataset = p_dataset and r.id = g.preferred_id)
    on conflict do nothing;
    get diagnostics skipped = row_count; n := n + skipped;
  elsif p_step = 'contexts' then
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '2_useless_rows', 'delete_collection_context', 'public.corpus_context', c.key,
           'Supplement context named for removed collection ' || p_dataset, jsonb_build_object('owner_gate', 'collection_removal:' || p_dataset, 'ready', c.ready), md5(to_jsonb(c)::text)
    from public.corpus_context c where c.key like 'supplement:' || replace(p_dataset, '_', '\_') || '\_%' escape '\'
    on conflict do nothing;
    get diagnostics n = row_count;
  elsif p_step = 'catalog' then
    if exists (select 1 from public.corpus_records r where r.dataset = p_dataset) then raise exception 'Records of % still exist: apply the records plan first', p_dataset using errcode = '22023'; end if;
    if exists (select 1 from public.corpus_datasets d where d.id = p_dataset and coalesce(d.imported_records, 0) <> 0) then raise exception 'imported_records of % is not 0 yet: run fix_counters first', p_dataset using errcode = '22023'; end if;
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '1_taxonomy', 'drop_dataset_entry', 'public.corpus_datasets', d.id,
           'Owner-approved removal of the whole collection ' || p_dataset || ' (catalog entry, after its records)', jsonb_build_object('owner_gate', 'collection_removal:' || p_dataset, 'ready', d.ready, 'label', d.label), md5(to_jsonb(d)::text)
    from public.corpus_datasets d where d.id = p_dataset
    on conflict do nothing;
    get diagnostics n = row_count;
  else raise exception 'Unknown collection step' using errcode = '22023';
  end if;
  return jsonb_build_object('run', run, 'dataset', p_dataset, 'step', p_step, 'planned_rows_inserted', n);
end $$;
revoke all on function corpus_ingest.cleanup_plan_collection_removal_v1(text, text) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_plan_collection_removal_v1(text, text) to service_role;

-- route '<phase>:collection:<dataset>:<step>' through the existing planner entry point (the 06 router is replaced, keeping the 4_open_us_law branch)
create or replace function corpus_ingest.cleanup_plan_step_v1(p_step text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare parts text[];
begin
  if p_step like '4\_open\_us\_law:%' escape '\' then return corpus_ingest.cleanup_plan_open_us_law_v1(p_step); end if;
  if p_step like '%:collection:%' then
    parts := string_to_array(p_step, ':');
    return corpus_ingest.cleanup_plan_collection_removal_v1(parts[3], parts[4]);
  end if;
  return corpus_ingest.cleanup_plan_step_base_v1(p_step, p_args);
end $$;
revoke all on function corpus_ingest.cleanup_plan_step_v1(text, jsonb) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_plan_step_v1(text, jsonb) to service_role;
