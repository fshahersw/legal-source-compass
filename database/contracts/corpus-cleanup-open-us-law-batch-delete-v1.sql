-- corpus-cleanup/1 patch 10: guarded batch deletion of the open_us_law records (recovery path = the verified export), plus catalog step and wrapper op.
-- Requires 00, 03, 06. Nothing is deleted by applying this file.
-- corpus_ingest.cleanup_delete_open_us_law_batch_v1(p_limit) deletes up to p_limit open_us_law records per call (1..5000) and refuses unless
--   (0) gate 'open_us_law_dependents_clear' is released (dependents re-check = 0 blocking references, owner confirms),
--   (1) gate 'open_us_law_export_verified' is released,
--   (2) cleanup_gates.evidence has manifest_sha256 (64 hex), storage_path and rows (bigint),
--   (3) the number of open_us_law records still present is <= evidence.rows (nothing newer than the export may be deleted).
-- Each call records a running 'after' count (cleanup_counts stage 'after', dataset open_us_law) and a receipt row in corpus_ingest.cleanup_batches.
-- When no record remains it archives the catalog row and sets imported_records = 0 (counters last). Then: plan '4_open_us_law:catalog' and apply phase 4.
-- Release the gate (admin session only):
--   update corpus_ingest.cleanup_gates set released = true, released_by = '<owner>', released_at = now(),
--          evidence = '{"manifest_sha256":"<64 hex>","storage_path":"corpus-exports/open-us-law-removal-2026-10-06/manifest.json","rows":2968623}'::jsonb
--    where gate = 'open_us_law_export_verified';

-- second gate: the dependents re-check (12-open-us-law-dependents-check-v1.sql) must report 0 blocking references and the owner releases this gate
insert into corpus_ingest.cleanup_gates(gate) values ('open_us_law_dependents_clear') on conflict do nothing;

create table if not exists corpus_ingest.cleanup_batches (
  run_id uuid not null references corpus_ingest.runs(id),
  batch_no bigint generated always as identity,
  phase text not null,
  dataset text not null,
  deleted bigint not null,
  remaining bigint not null,
  first_id text,
  last_id text,
  ids_md5 text,
  at timestamptz not null default now(),
  primary key (run_id, batch_no)
);
alter table corpus_ingest.cleanup_batches enable row level security;
revoke all on corpus_ingest.cleanup_batches from public, anon, authenticated;
grant all on corpus_ingest.cleanup_batches to service_role;

create or replace function corpus_ingest.cleanup_delete_open_us_law_batch_v1(p_limit integer) returns jsonb
language plpgsql set search_path = '' as $$
declare
  run uuid := corpus_ingest.cleanup_run_v1(); g record; before_n bigint; remaining bigint; prev bigint; d_n bigint; d_first text; d_last text; d_md5 text; b_no bigint; counter_fixed boolean := false;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then raise exception 'p_limit must be 1..5000' using errcode = '22023'; end if;
  select * into g from corpus_ingest.cleanup_gates where gate = 'open_us_law_export_verified';
  if not found or not g.released then raise exception 'Gate open_us_law_export_verified is not released: the owner must supply the verified export evidence first' using errcode = '42501'; end if;
  if not exists (select 1 from corpus_ingest.cleanup_gates g2 where g2.gate = 'open_us_law_dependents_clear' and g2.released) then
    raise exception 'Gate open_us_law_dependents_clear is not released: dependents (CFR sections, citations, limitation periods, state-page blocks) must be re-sourced and re-checked first' using errcode = '42501';
  end if;
  if coalesce(g.evidence->>'manifest_sha256', '') !~ '^[0-9a-f]{64}$' or coalesce(g.evidence->>'storage_path', '') = '' or coalesce(g.evidence->>'rows', '') !~ '^[0-9]+$' then
    raise exception 'Gate evidence must contain manifest_sha256 (64 hex), storage_path and rows' using errcode = '42501';
  end if;

  select rows into prev from corpus_ingest.cleanup_counts where run_id = run and phase = '4_open_us_law' and stage = 'after' and dataset = 'open_us_law';
  if prev is null then
    select count(*) into prev from public.corpus_records where dataset = 'open_us_law';
    insert into corpus_ingest.cleanup_counts(run_id, phase, stage, dataset, rows, id_md5) values (run, '4_open_us_law', 'before', 'open_us_law', prev, md5('before:' || prev))
      on conflict (run_id, phase, stage, dataset) do nothing;
  end if;
  if prev > (g.evidence->>'rows')::bigint then
    raise exception 'open_us_law has % records but the verified export has only %: refusing to delete rows newer than the export', prev, g.evidence->>'rows' using errcode = '42501';
  end if;

  with b as (select r.id from public.corpus_records r where r.dataset = 'open_us_law' order by r.id limit p_limit),
       d as (delete from public.corpus_records r using b where r.dataset = 'open_us_law' and r.id = b.id returning r.id)
  select count(*), min(id), max(id), coalesce(md5(string_agg(id, ',' order by id)), md5('')) into d_n, d_first, d_last, d_md5 from d;

  remaining := greatest(prev - d_n, 0);
  if d_n < p_limit then select count(*) into remaining from public.corpus_records where dataset = 'open_us_law'; end if;

  insert into corpus_ingest.cleanup_counts(run_id, phase, stage, dataset, rows, id_md5) values (run, '4_open_us_law', 'after', 'open_us_law', remaining, coalesce(d_md5, md5('')))
    on conflict (run_id, phase, stage, dataset) do update set rows = excluded.rows, id_md5 = excluded.id_md5, captured_at = now();
  insert into corpus_ingest.cleanup_batches(run_id, phase, dataset, deleted, remaining, first_id, last_id, ids_md5) values (run, '4_open_us_law', 'open_us_law', d_n, remaining, d_first, d_last, d_md5) returning batch_no into b_no;

  if remaining = 0 then
    select rows into before_n from corpus_ingest.cleanup_counts where run_id = run and phase = '4_open_us_law' and stage = 'before' and dataset = 'open_us_law';
    if exists (select 1 from public.corpus_datasets c where c.id = 'open_us_law' and c.imported_records = before_n) then
      perform corpus_ingest.cleanup_archive_v1(run, 'public.corpus_datasets', 'open_us_law', 'cleanup_20261006_counter', 'review', 'imported_records aligned to 0 after the verified-export removal',
        jsonb_build_object('rows_before', before_n, 'rows_after', 0, 'manifest_sha256', g.evidence->>'manifest_sha256'), (select to_jsonb(c) from public.corpus_datasets c where c.id = 'open_us_law'), jsonb_build_object('imported_records', 0));
      update public.corpus_datasets set imported_records = 0 where id = 'open_us_law';
      counter_fixed := true;
    end if;
  end if;
  return jsonb_build_object('run', run, 'batch_no', b_no, 'deleted', d_n, 'remaining', remaining, 'first_id', d_first, 'last_id', d_last, 'counter_set_to_zero', counter_fixed,
                            'manifest_sha256', g.evidence->>'manifest_sha256');
end $$;
revoke all on function corpus_ingest.cleanup_delete_open_us_law_batch_v1(integer) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_delete_open_us_law_batch_v1(integer) to service_role;

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
  elsif p_op = 'schema_probe' then
    return jsonb_build_object('corpus_ingest_tables', (select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'corpus_ingest' and c.relkind = 'r'),
      'category_map_rows', (select count(*) from corpus_ingest.category_map), 'runs', (select count(*) from corpus_ingest.runs), 'entities', (select count(*) from corpus_ingest.entities));
  end if;
  raise exception 'Unknown operation' using errcode = '22023';
end $$;

revoke all on function public.corpus_admin_cleanup_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_admin_cleanup_v1(text, jsonb) to service_role;
