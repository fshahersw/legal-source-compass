-- corpus-cleanup/1  (contract; DDL + functions). Private, versioned, reversible cleanup of the external corpus.
-- Everything lives in schema corpus_ingest (not exposed by PostgREST). Nothing here deletes data: it only creates the plan/ledger
-- machinery. Run as the administrative database role, never from the client. Idempotent (create if not exists / create or replace).
--
-- Flow per phase:   plan (11/12/20-*.sql)  ->  review counts  ->  capture 'before'  ->  apply (bounded batches)  ->  capture 'after'
--                   -> verify (90-verify.sql)  ->  (optional) rollback by run+phase.
-- Every removed or changed row is first written verbatim to corpus_ingest.cleanup_decisions (original_record), together with the
-- reason, evidence and merge target (replacement). Rows are only touched when their md5 still equals the md5 recorded at plan time,
-- so an enriched sibling written by a parallel backfill worker is never overwritten or deleted by a stale plan.

create table if not exists corpus_ingest.cleanup_plan (
  run_id uuid not null references corpus_ingest.runs(id),
  seq bigint generated always as identity,
  phase text not null check (phase in ('1_taxonomy','2_useless_rows','3_dedupe')),
  action text not null check (action in ('drop_category_map','drop_dataset_entry','drop_display_group','drop_orphan_docket_link',
                                          'delete_empty_record','delete_superseded_record','merge_duplicate_record')),
  dataset text not null,
  record_id text not null,
  survivor_id text,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  row_md5 text not null,
  survivor_md5 text,
  status text not null default 'planned' check (status in ('planned','applied','skipped','rolled_back')),
  status_note text,
  planned_at timestamptz not null default now(),
  applied_at timestamptz,
  primary key (run_id, action, dataset, record_id)
);
create index if not exists cleanup_plan_run_phase on corpus_ingest.cleanup_plan(run_id, phase, status, seq);

create table if not exists corpus_ingest.cleanup_counts (
  run_id uuid not null references corpus_ingest.runs(id),
  phase text not null,
  stage text not null check (stage in ('before','after','rollback')),
  dataset text not null,
  rows bigint not null,
  id_md5 text not null,
  captured_at timestamptz not null default now(),
  primary key (run_id, phase, stage, dataset)
);

alter table corpus_ingest.cleanup_plan enable row level security;
alter table corpus_ingest.cleanup_counts enable row level security;
revoke all on corpus_ingest.cleanup_plan, corpus_ingest.cleanup_counts from public, anon, authenticated;
grant all on corpus_ingest.cleanup_plan, corpus_ingest.cleanup_counts to service_role;

-- ---------------------------------------------------------------------------------------------------------------- helpers
create or replace function corpus_ingest.cleanup_run_v1() returns uuid language plpgsql stable set search_path = '' as $$
declare r uuid;
begin
  select id into r from corpus_ingest.runs
   where scope->>'contract' = 'corpus-cleanup/1' and status in ('running','partial') order by started_at desc limit 1;
  if r is null then raise exception 'No open corpus-cleanup/1 run. Execute cleanup/01-open-run.sql first.' using errcode = '22023'; end if;
  return r;
end $$;

create or replace function corpus_ingest.cleanup_is_empty_v1(v jsonb) returns boolean language sql immutable set search_path = '' as $$
  select v is null or jsonb_typeof(v) = 'null'
      or (jsonb_typeof(v) = 'string' and (btrim(v #>> '{}') = '' or lower(btrim(v #>> '{}')) in ('not recorded','unknown','n/a','none','null')))
      or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0)
      or (jsonb_typeof(v) = 'object' and v = '{}'::jsonb)
$$;

-- Completeness of a corpus_records row: filled cells + non-empty detail keys + provenance fields. Higher = more complete.
create or replace function corpus_ingest.cleanup_score_v1(p_item jsonb, p_detail jsonb, p_filters jsonb, p_source_url text, p_text text, p_title text)
returns integer language sql immutable set search_path = '' as $$
  select coalesce((select count(*) from jsonb_each(case when jsonb_typeof(p_item->'cells') = 'object' then p_item->'cells' else '{}'::jsonb end) c
                    where not corpus_ingest.cleanup_is_empty_v1(c.value)), 0)::int * 10
       + coalesce((select count(*) from jsonb_each(case when jsonb_typeof(p_detail) = 'object' then p_detail else '{}'::jsonb end) d
                    where not corpus_ingest.cleanup_is_empty_v1(d.value)), 0)::int * 5
       + coalesce((select count(*) from jsonb_each(case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end) f
                    where not corpus_ingest.cleanup_is_empty_v1(f.value)), 0)::int
       + (case when coalesce(btrim(p_source_url), '') <> '' then 5 else 0 end)
       + (case when coalesce(btrim(p_title), '') <> '' then 5 else 0 end)
       + least(coalesce(length(p_text), 0) / 500, 20)
$$;

-- Current row as jsonb for a plan target (full row, including search_vector). NULL when the row does not exist.
create or replace function corpus_ingest.cleanup_row_v1(p_action text, p_dataset text, p_id text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare j jsonb;
begin
  if p_action = 'drop_category_map' then
    select to_jsonb(m) into j from corpus_ingest.category_map m where m.native_category = p_id;
  elsif p_action = 'drop_dataset_entry' then
    select to_jsonb(d) into j from public.corpus_datasets d where d.id = p_id;
  elsif p_action = 'drop_display_group' then
    select to_jsonb(g) into j from public.corpus_display_groups g where g.id = p_id;
  elsif p_action = 'drop_orphan_docket_link' then
    select to_jsonb(l) into j from public.corpus_workspace_docket_links l where l.source_dataset || '|' || l.source_record_id = p_id;
  else
    select to_jsonb(r) into j from public.corpus_records r where r.dataset = p_dataset and r.id = p_id;
  end if;
  return j;
end $$;

-- Insert a row back from its archived jsonb into any table, skipping generated columns. No-op when the key already exists.
create or replace function corpus_ingest.cleanup_restore_row_v1(p_table regclass, p_row jsonb) returns boolean
language plpgsql set search_path = '' as $$
declare cols text; n bigint;
begin
  select string_agg(format('%I', attname), ',' order by attnum) into cols
    from pg_attribute where attrelid = p_table and attnum > 0 and not attisdropped and attgenerated = '';
  execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) on conflict do nothing', p_table, cols, cols, p_table) using p_row;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function corpus_ingest.cleanup_archive_v1(p_run uuid, p_dataset text, p_id text, p_issue text, p_disp text,
                                                             p_reason text, p_evidence jsonb, p_original jsonb, p_replacement jsonb) returns void
language sql set search_path = '' as $$
  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  values (p_dataset, p_id, p_issue, p_disp, p_reason, p_evidence, p_original, p_replacement, p_run)
  on conflict (dataset, record_id, issue) do nothing
$$;

-- ---------------------------------------------------------------------------------------------------------------- counts
create or replace function corpus_ingest.cleanup_capture_counts_v1(p_run uuid, p_phase text, p_stage text) returns jsonb
language plpgsql set search_path = '' as $$
declare d record; n bigint; h text; out jsonb := '{}'::jsonb;
begin
  for d in select distinct dataset from corpus_ingest.cleanup_plan where run_id = p_run and phase = p_phase loop
    if d.dataset = 'corpus_ingest.category_map' then select count(*), coalesce(md5(string_agg(native_category, ',' order by native_category)), md5('')) into n, h from corpus_ingest.category_map;
    elsif d.dataset = 'public.corpus_datasets' then select count(*), coalesce(md5(string_agg(id, ',' order by id)), md5('')) into n, h from public.corpus_datasets;
    elsif d.dataset = 'public.corpus_display_groups' then select count(*), coalesce(md5(string_agg(id, ',' order by id)), md5('')) into n, h from public.corpus_display_groups;
    elsif d.dataset = 'public.corpus_workspace_docket_links' then select count(*), coalesce(md5(string_agg(source_dataset || '|' || source_record_id, ',' order by source_dataset, source_record_id)), md5('')) into n, h from public.corpus_workspace_docket_links;
    else select count(*), coalesce(md5(string_agg(id, ',' order by id)), md5('')) into n, h from public.corpus_records where dataset = d.dataset;
    end if;
    insert into corpus_ingest.cleanup_counts(run_id, phase, stage, dataset, rows, id_md5) values (p_run, p_phase, p_stage, d.dataset, n, h)
      on conflict (run_id, phase, stage, dataset) do update set rows = excluded.rows, id_md5 = excluded.id_md5, captured_at = now();
    out := out || jsonb_build_object(d.dataset, n);
  end loop;
  return out;
end $$;

-- Keep corpus_datasets.imported_records aligned, but only for datasets whose counter equalled the pre-cleanup actual row count.
create or replace function corpus_ingest.cleanup_fix_counters_v1(p_run uuid, p_phase text) returns jsonb
language plpgsql set search_path = '' as $$
declare d record; actual bigint; before_n bigint; fixed int := 0; skipped int := 0;
begin
  for d in select distinct p.dataset from corpus_ingest.cleanup_plan p
            where p.run_id = p_run and p.phase = p_phase and p.status = 'applied'
              and p.dataset not like '%.%' and p.action in ('delete_empty_record','delete_superseded_record','merge_duplicate_record') loop
    select count(*) into actual from public.corpus_records where dataset = d.dataset;
    select rows into before_n from corpus_ingest.cleanup_counts where run_id = p_run and phase = p_phase and stage = 'before' and dataset = d.dataset;
    if exists (select 1 from public.corpus_datasets c where c.id = d.dataset and c.imported_records = before_n) then
      perform corpus_ingest.cleanup_archive_v1(p_run, 'public.corpus_datasets', d.dataset, 'cleanup_20261006_counter', 'review',
        'imported_records aligned to the actual row count after cleanup', jsonb_build_object('rows_before', before_n, 'rows_after', actual),
        (select to_jsonb(c) from public.corpus_datasets c where c.id = d.dataset), jsonb_build_object('imported_records', actual));
      update public.corpus_datasets set imported_records = actual where id = d.dataset;
      fixed := fixed + 1;
    else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('counters_updated', fixed, 'counters_left_unchanged', skipped);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- apply
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
      else delete from public.corpus_records where dataset = p.dataset and id = p.record_id;
      end if;
    end if;

    update corpus_ingest.cleanup_plan set status = 'applied', applied_at = now(), status_note = null where run_id = p.run_id and action = p.action and dataset = p.dataset and record_id = p.record_id;
    applied := applied + 1; by_action := jsonb_set(by_action, array[p.action || ':applied'], to_jsonb(coalesce((by_action->>(p.action || ':applied'))::int, 0) + 1));
  end loop;

  return jsonb_build_object('contract', 'corpus-cleanup/1', 'run', p_run, 'phase', p_phase, 'dry_run', p_dry, 'applied', applied, 'would_apply', would, 'skipped', skipped,
                            'detail', by_action, 'remaining_planned', (select count(*) from corpus_ingest.cleanup_plan where run_id = p_run and phase = p_phase and status = 'planned'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------- rollback
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
    perform corpus_ingest.cleanup_restore_row_v1(
      case p.action when 'drop_category_map' then 'corpus_ingest.category_map'::regclass when 'drop_dataset_entry' then 'public.corpus_datasets'::regclass
                    when 'drop_display_group' then 'public.corpus_display_groups'::regclass when 'drop_orphan_docket_link' then 'public.corpus_workspace_docket_links'::regclass
                    else 'public.corpus_records'::regclass end, led.original_record);
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

revoke all on function corpus_ingest.cleanup_run_v1(), corpus_ingest.cleanup_is_empty_v1(jsonb), corpus_ingest.cleanup_score_v1(jsonb,jsonb,jsonb,text,text,text),
  corpus_ingest.cleanup_row_v1(text,text,text), corpus_ingest.cleanup_restore_row_v1(regclass,jsonb),
  corpus_ingest.cleanup_archive_v1(uuid,text,text,text,text,text,jsonb,jsonb,jsonb), corpus_ingest.cleanup_capture_counts_v1(uuid,text,text),
  corpus_ingest.cleanup_fix_counters_v1(uuid,text), corpus_ingest.cleanup_apply_v1(uuid,text,integer,boolean),
  corpus_ingest.cleanup_rollback_v1(uuid,text,boolean) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_run_v1(), corpus_ingest.cleanup_is_empty_v1(jsonb), corpus_ingest.cleanup_score_v1(jsonb,jsonb,jsonb,text,text,text),
  corpus_ingest.cleanup_row_v1(text,text,text), corpus_ingest.cleanup_restore_row_v1(regclass,jsonb),
  corpus_ingest.cleanup_archive_v1(uuid,text,text,text,text,text,jsonb,jsonb,jsonb), corpus_ingest.cleanup_capture_counts_v1(uuid,text,text),
  corpus_ingest.cleanup_fix_counters_v1(uuid,text), corpus_ingest.cleanup_apply_v1(uuid,text,integer,boolean),
  corpus_ingest.cleanup_rollback_v1(uuid,text,boolean) to service_role;

comment on table corpus_ingest.cleanup_plan is 'corpus-cleanup/1 plan: one row per intended removal or merge, with the md5 of the row at plan time. Applied only while the md5 still matches.';
comment on table corpus_ingest.cleanup_counts is 'corpus-cleanup/1 before/after row counts and id checksums per touched dataset.';
