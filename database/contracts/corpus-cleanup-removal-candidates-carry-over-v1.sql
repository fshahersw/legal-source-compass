-- corpus-cleanup/1 patch 13: removal candidates as data, extended for the owner's 2026-10-06 removals and the merge sources, plus ledgered carry-over of
-- fields the survivors lack (so source collections can be removed without losing information). Requires 00, 03, 06, 09, 10, 11. Applying this file changes no data.
-- (1) corpus_ingest.cleanup_removal_candidates replaces the hard-coded list in cleanup_plan_collection_removal_v1; every candidate has its own closed gate
--     'collection_removal:<dataset>' released only when the owner (or the codebase worker's repoint report) clears it.
--     New candidates: cl_citation_edges (owner removal; bare opinion ids resolve to nothing), the 13 merge sources and regulatory_backfill (duplicate of federal_register_history once the FR projection lands).
-- (2) corpus_ingest.cleanup_carry_over_v1(merge, limit): ledgered, md5-guarded, idempotent, batched projections into the survivor; rollback restores exactly.
--     merges: cl_courts, cl_court_appeals_to (-> court_spine facts), device_classification (-> definition fact), cl_people_education, cl_people_positions
--     (-> sections on cl_people), and row moves county_enrichment_20260928 / pending_publication (-> county_litigation), gap_enrichment_20260927 (-> focused),
--     cl_reporter_citations (-> citation_index). regulatory_backfill (-> federal_register_history facts/links: dates as printed, recorded effective date, correction_of, related documents, GovInfo edition link, full title when the survivor's is a truncation), people (-> cl_people cells courts/career_summary/education_summary/has_photo_reference + photo facts). judge_enrichment carries no provenance the judges rows lack (all 11,926 source URLs are already on the profiles) so it needs no carry-over; cl_master_entries waits for its code repoint.
-- (3) wrapper ops: carry_over {merge, limit}, carry_over_rollback {merge} (all earlier ops kept).
-- Order per merge: carry_over until remaining = 0 -> verify -> removal procedure of 09 (records, groups, contexts, counts/apply, fix_counters, catalog).

create table if not exists corpus_ingest.cleanup_removal_candidates (dataset text primary key, kind text not null check (kind in ('owner_removal','merge_source')), survivor text, note text);
alter table corpus_ingest.cleanup_removal_candidates enable row level security;
revoke all on corpus_ingest.cleanup_removal_candidates from public, anon, authenticated;
grant select on corpus_ingest.cleanup_removal_candidates to service_role;
insert into corpus_ingest.cleanup_removal_candidates(dataset, kind, survivor, note) values
  ('cl_courthouses','owner_removal',null,'3,352 of 3,361 rows have no location fields'),
  ('agency_safety_openfda_orangebook','owner_removal',null,'reference data outside scope'),
  ('docsupload_coverage','owner_removal',null,'name index without provenance'),
  ('judge_vendor','owner_removal',null,'vendor preview rows'),
  ('sw_matter_dockets_v1_superseded','owner_removal',null,'superseded'),
  ('trellis_browser_counties','owner_removal',null,'third-party county pages'),
  ('trellis_receipts','owner_removal',null,'connector receipts'),
  ('cl_citation_edges','owner_removal',null,'201 bare opinion-id edges that resolve to nothing in the corpus'),
  ('agency_safety_openfda_device_classification','merge_source','agency_safety_openfda_device_classification_20261002','carry over definition (2,606 rows)'),
  ('cl_court_appeals_to','merge_source','court_spine','carry over as Appeals-to facts'),
  ('cl_courts','merge_source','court_spine','carry over website and notes'),
  ('cl_educations','merge_source','cl_people','carry over as Education section'),
  ('cl_positions','merge_source','cl_people','carry over as Positions section'),
  ('cl_schools','merge_source','cl_people','school names are carried inside the Education section'),
  ('cl_master_entries','merge_source','sw_docket_entries_v1','after the 7,854 missing entries are projected'),
  ('cl_reporter_citations','merge_source','citation_index','row move'),
  ('county_enrichment_20260928','merge_source','county_litigation','row move'),
  ('gap_enrichment_20260927','merge_source','focused','row move'),
  ('judge_enrichment','merge_source','judges','after observations are attached as profile sources'),
  ('pending_publication','merge_source','county_litigation','row move of rows whose URL is not already in the survivor'),
  ('regulatory_backfill','merge_source','federal_register_history','becomes an exact duplicate once the FR projection lands; confirm by native id before removal'),
  ('people','merge_source','cl_people','after all reads are repointed')
on conflict (dataset) do nothing;
insert into corpus_ingest.cleanup_gates(gate) select 'collection_removal:' || dataset from corpus_ingest.cleanup_removal_candidates on conflict do nothing;

-- a display-group member id counts as removed with collection D only if the row exists in D and is not (same id) present in D's survivor
create or replace function corpus_ingest.cleanup_member_removed_v1(p_dataset text, p_id text) returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.corpus_records r where r.dataset = p_dataset and r.id = p_id)
     and not exists (select 1 from public.corpus_records r2 join corpus_ingest.cleanup_removal_candidates c on c.dataset = p_dataset and c.survivor = r2.dataset where r2.id = p_id)
$$;
revoke all on function corpus_ingest.cleanup_member_removed_v1(text, text) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_member_removed_v1(text, text) to service_role;

create or replace function corpus_ingest.cleanup_plan_collection_removal_v1(p_dataset text, p_step text) returns jsonb
language plpgsql set search_path = '' as $$
declare n bigint := 0; run uuid := corpus_ingest.cleanup_run_v1(); skipped bigint := 0;
begin
  if not exists (select 1 from corpus_ingest.cleanup_removal_candidates c where c.dataset = p_dataset) then
    raise exception 'Dataset is not a registered removal candidate' using errcode = '22023';
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
      and exists (select 1 from jsonb_array_elements_text(g.metadata->'member_ids') m(v) where corpus_ingest.cleanup_member_removed_v1(p_dataset, m.v))
      and not exists (select 1 from jsonb_array_elements_text(g.metadata->'member_ids') m(v) where not corpus_ingest.cleanup_member_removed_v1(p_dataset, m.v))
    on conflict do nothing;
    get diagnostics n = row_count;
    insert into corpus_ingest.cleanup_plan(run_id, phase, action, dataset, record_id, reason, evidence, row_md5)
    select run, '2_useless_rows', 'prune_display_group_members', 'public.corpus_display_groups', g.id,
           'Mixed display group loses members that belong to removed collection ' || p_dataset,
           jsonb_build_object('owner_gate', 'collection_removal:' || p_dataset, 'remove_ids', (select jsonb_agg(m.v) from jsonb_array_elements_text(g.metadata->'member_ids') m(v) where corpus_ingest.cleanup_member_removed_v1(p_dataset, m.v))), md5(to_jsonb(g)::text)
    from public.corpus_display_groups g
    where jsonb_typeof(g.metadata->'member_ids') = 'array'
      and exists (select 1 from jsonb_array_elements_text(g.metadata->'member_ids') m(v) where corpus_ingest.cleanup_member_removed_v1(p_dataset, m.v))
      and exists (select 1 from jsonb_array_elements_text(g.metadata->'member_ids') m(v) where not corpus_ingest.cleanup_member_removed_v1(p_dataset, m.v))
      and not corpus_ingest.cleanup_member_removed_v1(p_dataset, g.preferred_id)
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

create or replace function corpus_ingest.cleanup_carry_over_v1(p_merge text, p_limit integer default 2000) returns jsonb
language plpgsql set search_path = '' as $$
declare
  run uuid := corpus_ingest.cleanup_run_v1(); v_issue text := 'cleanup_20261006_carry_' || p_merge; surv text; n_cand bigint; n_done bigint := 0; remaining bigint := 0;
  src text; moved bigint := 0; before_n bigint; after_n bigint; src_count bigint := null;
begin
  if p_limit < 1 or p_limit > 10000 then raise exception 'p_limit must be 1..10000' using errcode = '22023'; end if;
  create temp table if not exists _carry(ds text, id text, old_detail jsonb, new_detail jsonb, row_md5 text, old_item jsonb, new_item jsonb, old_title text, new_title text, primary key (ds, id)) on commit drop;
  truncate _carry;

  if p_merge = 'cl_courts' then
    surv := 'court_spine';
    insert into _carry(ds, id, old_detail, new_detail, row_md5)
    select 'court_spine', s.id, s.detail,
           jsonb_set(s.detail, '{facts}', coalesce(s.detail->'facts', '[]'::jsonb)
             || case when btrim(coalesce(c.item->'cells'->>'url', '')) <> '' then jsonb_build_array(jsonb_build_array('Court website (CourtListener courts snapshot 2026-09-30)', btrim(c.item->'cells'->>'url'))) else '[]'::jsonb end
             || case when btrim(coalesce(c.item->'cells'->>'notes', '')) <> '' then jsonb_build_array(jsonb_build_array('Notes (CourtListener courts snapshot 2026-09-30)', btrim(c.item->'cells'->>'notes'))) else '[]'::jsonb end),
           md5(to_jsonb(s)::text)
    from public.corpus_records c join public.corpus_records s on s.dataset = 'court_spine' and s.id = replace(c.id, 'cl:courts:', '')
    where c.dataset = 'cl_courts' and (btrim(coalesce(c.item->'cells'->>'url', '')) <> '' or btrim(coalesce(c.item->'cells'->>'notes', '')) <> '')
      and not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = 'court_spine' and d.record_id = s.id and d.issue = v_issue)
    limit p_limit;
  elsif p_merge = 'cl_court_appeals_to' then
    surv := 'court_spine';
    insert into _carry(ds, id, old_detail, new_detail, row_md5)
    select 'court_spine', s.id, s.detail,
           jsonb_set(s.detail, '{facts}', coalesce(s.detail->'facts', '[]'::jsonb) || jsonb_build_array(jsonb_build_array('Appeals to (CourtListener court-appeals-to snapshot 2026-09-30)', a.to_ids))),
           md5(to_jsonb(s)::text)
    from (select c.item->'cells'->>'from_court_id' as from_id, string_agg(c.item->'cells'->>'to_court_id', ', ' order by c.item->'cells'->>'to_court_id') as to_ids
            from public.corpus_records c where c.dataset = 'cl_court_appeals_to' group by 1) a
    join public.corpus_records s on s.dataset = 'court_spine' and s.id = a.from_id
    where not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = 'court_spine' and d.record_id = s.id and d.issue = v_issue)
    limit p_limit;
  elsif p_merge = 'device_classification' then
    surv := 'agency_safety_openfda_device_classification_20261002';
    insert into _carry(ds, id, old_detail, new_detail, row_md5)
    select surv, n.id, n.detail,
           jsonb_set(n.detail, '{facts}', coalesce(n.detail->'facts', '[]'::jsonb) || jsonb_build_array(jsonb_build_array('FDA definition (earlier openFDA snapshot, date not recorded)', o.detail->'fields'->>'definition'))),
           md5(to_jsonb(n.*)::text)
    from public.corpus_records o join public.corpus_records n on n.dataset = surv and n.id = 'openfda:device-classification:' || (o.item->>'native_id')
    where o.dataset = 'agency_safety_openfda_device_classification' and btrim(coalesce(o.detail->'fields'->>'definition', '')) <> ''
      and not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = surv and d.record_id = n.id and d.issue = v_issue)
    limit p_limit;
  elsif p_merge = 'cl_people_education' then
    surv := 'cl_people';
    insert into _carry(ds, id, old_detail, new_detail, row_md5)
    select 'cl_people', s.id, s.detail,
           jsonb_set(s.detail, '{sections}', coalesce(s.detail->'sections', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('heading', 'Education (CourtListener, snapshot 2026-09-30)', 'header', jsonb_build_array('Degree', 'School', 'Year'), 'rows', e.rows))),
           md5(to_jsonb(s)::text)
    from (select 'cl:people:' || (x.item->'cells'->>'person_id') as pid,
                 jsonb_agg(jsonb_build_array(coalesce(nullif(x.item->'cells'->>'degree_detail', ''), nullif(x.item->'cells'->>'degree_level', ''), '—'),
                                             coalesce((select sc.item->'cells'->>'name' from public.corpus_records sc where sc.dataset = 'cl_schools' and sc.id = 'cl:schools:' || (x.item->'cells'->>'school_id')), '—'),
                                             coalesce(nullif(x.item->'cells'->>'degree_year', ''), '—')) order by x.item->'cells'->>'degree_year', x.id) as rows
            from public.corpus_records x where x.dataset = 'cl_educations' and x.item->'cells'->>'person_id' is not null group by 1) e
    join public.corpus_records s on s.dataset = 'cl_people' and s.id = e.pid
    where not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = 'cl_people' and d.record_id = s.id and d.issue = v_issue)
    limit p_limit;
  elsif p_merge = 'cl_people_positions' then
    surv := 'cl_people';
    insert into _carry(ds, id, old_detail, new_detail, row_md5)
    select 'cl_people', s.id, s.detail,
           jsonb_set(s.detail, '{sections}', coalesce(s.detail->'sections', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('heading', 'Positions (CourtListener, snapshot 2026-09-30)', 'header', jsonb_build_array('Position', 'Court', 'Start', 'End', 'Place'), 'rows', e.rows))),
           md5(to_jsonb(s)::text)
    from (select 'cl:people:' || (x.item->'cells'->>'person_id') as pid,
                 jsonb_agg(jsonb_build_array(coalesce(nullif(x.item->'cells'->>'job_title', ''), nullif(x.item->'cells'->>'name', ''), '—'), coalesce(nullif(x.item->'cells'->>'court_id', ''), '—'),
                                             coalesce(nullif(x.item->'cells'->>'date_start', ''), '—'), coalesce(nullif(x.item->'cells'->>'date_termination', ''), '—'),
                                             coalesce(nullif(btrim(coalesce(x.item->'cells'->>'location_city', '') || ' ' || coalesce(x.item->'cells'->>'location_state', '')), ''), '—')) order by x.item->'cells'->>'date_start', x.id) as rows
            from public.corpus_records x where x.dataset = 'cl_positions' and x.item->'cells'->>'person_id' is not null group by 1) e
    join public.corpus_records s on s.dataset = 'cl_people' and s.id = e.pid
    where not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = 'cl_people' and d.record_id = s.id and d.issue = v_issue)
    limit p_limit;
  elsif p_merge = 'people' then
    surv := 'cl_people';
    insert into _carry(ds, id, old_item, new_item, old_detail, new_detail, row_md5)
    select 'cl_people', s.id, s.item,
           jsonb_set(s.item, '{cells}', coalesce(s.item->'cells', '{}'::jsonb)
             || case when jsonb_typeof(p.item->'courts') = 'array' and jsonb_array_length(p.item->'courts') > 0 then jsonb_build_object('courts', p.item->'courts') else '{}'::jsonb end
             || case when btrim(coalesce(p.item->>'career_summary', '')) <> '' then jsonb_build_object('career_summary', p.item->>'career_summary') else '{}'::jsonb end
             || case when btrim(coalesce(p.item->>'education_summary', '')) <> '' then jsonb_build_object('education_summary', p.item->>'education_summary') else '{}'::jsonb end
             || jsonb_build_object('has_photo_reference', coalesce((p.item->>'has_photo_reference')::boolean, false))),
           s.detail,
           case when btrim(coalesce(p.detail->>'photo_url', '')) <> '' then
             jsonb_set(s.detail, '{facts}', coalesce(s.detail->'facts', '[]'::jsonb)
               || jsonb_build_array(jsonb_build_array('Photo reference (earlier biographies snapshot)', p.detail->>'photo_url'))
               || case when btrim(coalesce(p.detail->>'photo_credit', '')) <> '' then jsonb_build_array(jsonb_build_array('Photo credit', p.detail->>'photo_credit')) else '[]'::jsonb end
               || case when btrim(coalesce(p.detail->>'photo_source', '')) <> '' then jsonb_build_array(jsonb_build_array('Photo source', p.detail->>'photo_source')) else '[]'::jsonb end)
           else s.detail end,
           md5(to_jsonb(s)::text)
    from public.corpus_records p join public.corpus_records s on s.dataset = 'cl_people' and s.id = 'cl:people:' || p.id
    where p.dataset = 'people' and not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = 'cl_people' and d.record_id = s.id and d.issue = v_issue)
    limit p_limit;
  elsif p_merge = 'regulatory_backfill' then
    surv := 'federal_register_history';
    insert into _carry(ds, id, old_title, new_title, old_detail, new_detail, row_md5)
    select surv, s.id,
           s.title, case when length(p.title) > length(s.title) and left(p.title, length(s.title)) = s.title then p.title end,
           s.detail,
           jsonb_set(s.detail, '{facts}', coalesce(s.detail->'facts', '[]'::jsonb)
             || case when btrim(coalesce(p.item->'cells'->>'dates', '')) <> '' then jsonb_build_array(jsonb_build_array('Dates as printed (federalregister.gov API, extract 2026-10-02)', btrim(p.item->'cells'->>'dates'))) else '[]'::jsonb end
             || case when btrim(coalesce(p.item->'cells'->>'effective_on', '')) <> '' and position(left(p.item->'cells'->>'effective_on', 10) in s.detail::text) = 0
                     then jsonb_build_array(jsonb_build_array('Recorded effective date (API field, extract 2026-10-02)', left(p.item->'cells'->>'effective_on', 10))) else '[]'::jsonb end
             || case when btrim(coalesce(p.item->'cells'->>'correction_of', '')) <> '' then jsonb_build_array(jsonb_build_array('Correction of (API field)', p.item->'cells'->>'correction_of')) else '[]'::jsonb end
             || case when jsonb_typeof(p.item->'cells'->'related_documents') = 'object' and p.item->'cells'->'related_documents' <> '{}'::jsonb then
                  jsonb_build_array(jsonb_build_array('Related documents (API, by docket)', (select string_agg(k || ': ' || (select string_agg(d->>'document_number', ', ' order by d->>'publication_date', d->>'document_number') from jsonb_array_elements(v) d), '; ' order by k) from jsonb_each(p.item->'cells'->'related_documents') e(k, v)))) else '[]'::jsonb end)
           || case when btrim(coalesce(p.item->'cells'->>'pdf_url', '')) <> '' and position(p.item->'cells'->>'pdf_url' in s.detail::text) = 0
                   then jsonb_build_object('links', coalesce(s.detail->'links', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('url', p.item->'cells'->>'pdf_url', 'label', 'Official GovInfo edition (not downloaded)'))) else '{}'::jsonb end,
           md5(to_jsonb(s)::text)
    from public.corpus_records p join public.corpus_records s on s.dataset = surv and s.source_url = 'https://www.federalregister.gov/d/' || substr(p.id, 4)
    where p.dataset = 'regulatory_backfill' and left(p.id, 3) = 'fr:'
      and not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = surv and d.record_id = s.id and d.issue = v_issue)
    limit p_limit;
  elsif p_merge in ('county_enrichment_20260928', 'pending_publication', 'gap_enrichment_20260927', 'cl_reporter_citations') then
    src := p_merge;
    surv := case p_merge when 'county_enrichment_20260928' then 'county_litigation' when 'pending_publication' then 'county_litigation' when 'gap_enrichment_20260927' then 'focused' else 'citation_index' end;
    select count(*) into before_n from public.corpus_records where dataset = surv;
    with cand as (
      select r.* from public.corpus_records r
       where r.dataset = src
         and not exists (select 1 from public.corpus_records x where x.dataset = surv and x.id = r.id)
         and not (coalesce(r.source_url, '') <> '' and exists (select 1 from public.corpus_records x where x.dataset = surv and x.source_url = r.source_url))
         and not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = surv and d.record_id = r.id and d.issue = v_issue)
       order by r.ordinal, r.id limit p_limit),
    base as (select coalesce(max(ordinal), 0) as mx from public.corpus_records where dataset = surv),
    ins as (
      insert into public.corpus_records as t(dataset, id, ordinal, title, state, category, source_url, text, item, detail, filters, county_geoids)
      select surv, c.id, b.mx + row_number() over (order by c.ordinal, c.id), c.title, c.state, c.category, c.source_url, c.text, c.item, c.detail,
             coalesce(c.filters, '{}'::jsonb) || jsonb_build_object('moved_from', src), c.county_geoids
      from cand c cross join base b returning t.id, md5(to_jsonb(t)::text) as m),
    led as (
      insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
      select surv, i.id, v_issue, 'canonical_alias', 'Row moved from ' || src || ' into ' || surv || '; the source row stays in the ledger when the source is removed',
             jsonb_build_object('moved_from', src), jsonb_build_object('row_md5', i.m), jsonb_build_object('inserted', true, 'moved_from', src), run
      from ins i returning record_id)
    select count(*) into moved from led;
    select count(*) into after_n from public.corpus_records where dataset = surv;
    if moved > 0 and exists (select 1 from public.corpus_datasets d where d.id = surv and d.imported_records = before_n) then
      perform corpus_ingest.cleanup_archive_v1(run, 'public.corpus_datasets', surv, v_issue || '_counter', 'review', 'imported_records aligned after rows were moved in',
        jsonb_build_object('rows_before', before_n, 'rows_after', after_n), (select to_jsonb(d) from public.corpus_datasets d where d.id = surv), jsonb_build_object('imported_records', after_n));
      update public.corpus_datasets set imported_records = after_n where id = surv;
    end if;
    select count(*) into remaining from public.corpus_records r where r.dataset = src
      and not exists (select 1 from public.corpus_records x where x.dataset = surv and x.id = r.id)
      and not (coalesce(r.source_url, '') <> '' and exists (select 1 from public.corpus_records x where x.dataset = surv and x.source_url = r.source_url));
    return jsonb_build_object('merge', p_merge, 'survivor', surv, 'moved', moved, 'remaining', remaining,
      'already_present_in_survivor_by_id_or_url', (select count(*) from public.corpus_records r where r.dataset = src and (exists (select 1 from public.corpus_records x where x.dataset = surv and x.id = r.id) or (coalesce(r.source_url, '') <> '' and exists (select 1 from public.corpus_records x where x.dataset = surv and x.source_url = r.source_url)))));
  else
    raise exception 'Unknown merge' using errcode = '22023';
  end if;

  select count(*) into n_cand from _carry;
  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
    select c.ds, c.id, v_issue, 'label_override', 'Field carried into the survivor before its source collection is removed', jsonb_build_object('merge', p_merge, 'version', 'carry-over/2026-10-06.1'),
           jsonb_build_object('detail', c.old_detail, 'row_md5', c.row_md5) || case when c.new_item is not null then jsonb_build_object('item', c.old_item) else '{}'::jsonb end || case when c.new_title is not null then jsonb_build_object('title', c.old_title) else '{}'::jsonb end,
           jsonb_build_object('detail_md5', md5(c.new_detail::text)) || case when c.new_item is not null then jsonb_build_object('item_md5', md5(c.new_item::text)) else '{}'::jsonb end || case when c.new_title is not null then jsonb_build_object('title', c.new_title) else '{}'::jsonb end, run from _carry c
    on conflict (dataset, record_id, issue) do nothing;
  update public.corpus_records r set detail = c.new_detail, item = coalesce(c.new_item, r.item), title = coalesce(c.new_title, r.title) from _carry c
   where r.dataset = c.ds and r.id = c.id and md5(to_jsonb(r)::text) = c.row_md5;
  get diagnostics n_done = row_count;
  return jsonb_build_object('merge', p_merge, 'survivor', surv, 'candidates', n_cand, 'updated', n_done, 'more_may_remain', n_cand = p_limit);
end $$;
revoke all on function corpus_ingest.cleanup_carry_over_v1(text, integer) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_carry_over_v1(text, integer) to service_role;

create or replace function corpus_ingest.cleanup_carry_over_rollback_v1(p_merge text) returns jsonb language plpgsql set search_path = '' as $$
declare v_issue text := 'cleanup_20261006_carry_' || p_merge; n bigint; m bigint := 0;
begin
  update public.corpus_records r set detail = d.original_record->'detail', item = coalesce(d.original_record->'item', r.item), title = coalesce(d.original_record->>'title', r.title)
    from corpus_ingest.cleanup_decisions d
   where d.issue = v_issue and d.original_record ? 'detail' and r.dataset = d.dataset and r.id = d.record_id and md5(r.detail::text) = d.replacement->>'detail_md5'
     and (d.replacement->>'item_md5' is null or md5(r.item::text) = d.replacement->>'item_md5');
  get diagnostics n = row_count;
  delete from public.corpus_records r using corpus_ingest.cleanup_decisions d
   where d.issue = v_issue and d.replacement->>'inserted' = 'true' and r.dataset = d.dataset and r.id = d.record_id and md5(to_jsonb(r)::text) = d.original_record->>'row_md5';
  get diagnostics m = row_count;
  return jsonb_build_object('merge', p_merge, 'details_restored', n, 'moved_rows_removed', m);
end $$;
revoke all on function corpus_ingest.cleanup_carry_over_rollback_v1(text) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_carry_over_rollback_v1(text) to service_role;

create or replace function public.corpus_admin_cleanup_v1(p_op text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run uuid; ph text := p_args->>'phase';
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
  if p_op = 'plan' then return corpus_ingest.cleanup_plan_step_v1(p_args->>'step', p_args);
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
  elsif p_op = 'delete_open_us_law_batch' then
    return corpus_ingest.cleanup_delete_open_us_law_batch_v1(coalesce((p_args->>'limit')::int, 1000));
  elsif p_op = 'strip_oul_links' then
    return corpus_ingest.cleanup_strip_oul_links_v1(p_args->>'scope');
  elsif p_op = 'strip_oul_links_rollback' then
    return jsonb_build_object('restored', corpus_ingest.cleanup_strip_oul_links_rollback_v1());
  elsif p_op = 'carry_over' then
    return corpus_ingest.cleanup_carry_over_v1(p_args->>'merge', coalesce((p_args->>'limit')::int, 2000));
  elsif p_op = 'carry_over_rollback' then
    return corpus_ingest.cleanup_carry_over_rollback_v1(p_args->>'merge');
  elsif p_op = 'schema_probe' then
    return jsonb_build_object('corpus_ingest_tables', (select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'corpus_ingest' and c.relkind = 'r'),
      'category_map_rows', (select count(*) from corpus_ingest.category_map), 'runs', (select count(*) from corpus_ingest.runs), 'entities', (select count(*) from corpus_ingest.entities));
  end if;
  raise exception 'Unknown operation' using errcode = '22023';
end $$;


revoke all on function public.corpus_admin_cleanup_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_admin_cleanup_v1(text, jsonb) to service_role;
