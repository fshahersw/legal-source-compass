-- group-source-count/2026-10-06.1: after judge_vendor members were pruned from two judge display groups, source_count (= members - 1 in these groups) was left unchanged.
-- Set it to retained members - 1 for exactly those two groups. Ledgered (label_override), md5-guarded, idempotent. Admin session.
with run as (select corpus_ingest.cleanup_run_v1() as id),
target as materialized (
  select g.id, md5(to_jsonb(g)::text) as row_md5, g.metadata as old_md,
         g.metadata || jsonb_build_object('source_count', greatest(jsonb_array_length(g.metadata->'member_ids') - 1, 0)) as new_md
  from public.corpus_display_groups g
  where g.id in ('058e1d087fcf370b3b9ca4a0b07e0e44', 'f7efd5cc70bbed837cc6f843de93ee24')
    and (g.metadata->>'source_count')::int <> greatest(jsonb_array_length(g.metadata->'member_ids') - 1, 0)),
audited as (
  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  select 'public.corpus_display_groups', t.id, 'cleanup_20261006_group_source_count', 'label_override', 'source_count follows retained members - 1 after the judge_vendor members were pruned',
         jsonb_build_object('version', 'group-source-count/2026-10-06.1'), jsonb_build_object('metadata', t.old_md, 'row_md5', t.row_md5), jsonb_build_object('metadata', t.new_md), (select id from run)
  from target t on conflict (dataset, record_id, issue) do nothing returning record_id),
updated as (
  update public.corpus_display_groups g set metadata = t.new_md from target t
   where g.id = t.id and md5(to_jsonb(g)::text) = t.row_md5 and (t.id in (select record_id from audited) or exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = 'public.corpus_display_groups' and d.record_id = t.id and d.issue = 'cleanup_20261006_group_source_count'))
  returning g.id)
select (select count(*) from target) as candidates, (select count(*) from updated) as updated;
-- ROLLBACK: update public.corpus_display_groups g set metadata = d.original_record->'metadata' from corpus_ingest.cleanup_decisions d where d.dataset = 'public.corpus_display_groups' and d.issue = 'cleanup_20261006_group_source_count' and g.id = d.record_id and g.metadata = d.replacement->'metadata';
