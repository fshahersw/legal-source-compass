-- group-leftovers/2026-10-06.1: two display groups the collection removals could not plan automatically (admin session; ledgered, md5-guarded, idempotent).
-- (a) 058e1d08...: judge group already pruned once (judge_vendor); its member b5f234bb... belonged to the removed judge_enrichment, but the plan row key (run, action, dataset, group id)
--     already existed, so the second prune was not planned. Remove that member; source_count = members - 1.
-- (b) doc:94e17d6c...: preferred id 2aee2458... was a pending_publication row whose page already exists in county_litigation as 776b59bb...; keep the surviving member as preferred.
with run as (select corpus_ingest.cleanup_run_v1() as id),
target as materialized (
  select g.id, md5(to_jsonb(g)::text) as row_md5, g.preferred_id as old_pref, g.metadata as old_md,
         case g.id when 'doc:94e17d6cf82a80f21792f2eec84d2f11' then '776b59bb20557eca08fa259f66a899f9' else g.preferred_id end as new_pref,
         case g.id when '058e1d087fcf370b3b9ca4a0b07e0e44' then '["058e1d087fcf370b3b9ca4a0b07e0e44"]'::jsonb else '["776b59bb20557eca08fa259f66a899f9"]'::jsonb end as new_members
  from public.corpus_display_groups g
  where (g.id = '058e1d087fcf370b3b9ca4a0b07e0e44' and g.metadata->'member_ids' ? 'b5f234bb9934b14c9d78aac6fca99ec9')
     or (g.id = 'doc:94e17d6cf82a80f21792f2eec84d2f11' and g.preferred_id = '2aee2458d20a776d19047e300debe805')),
audited as (
  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  select 'public.corpus_display_groups', t.id, 'cleanup_20261006_group_leftover', 'label_override', 'Members of removed collections pruned; preferred member kept when it was removed',
         jsonb_build_object('version', 'group-leftovers/2026-10-06.1'), jsonb_build_object('preferred_id', t.old_pref, 'metadata', t.old_md, 'row_md5', t.row_md5),
         jsonb_build_object('preferred_id', t.new_pref, 'member_ids', t.new_members), (select id from run)
  from target t on conflict (dataset, record_id, issue) do nothing returning record_id),
updated as (
  update public.corpus_display_groups g
     set preferred_id = t.new_pref,
         metadata = g.metadata || jsonb_build_object('member_ids', t.new_members, 'retained_members', 1, 'source_count', 0, 'preferred_id', t.new_pref)
    from target t
   where g.id = t.id and md5(to_jsonb(g)::text) = t.row_md5
     and exists (select 1 from public.corpus_records r where r.id = t.new_pref)
     and (t.id in (select record_id from audited) or exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = 'public.corpus_display_groups' and d.record_id = t.id and d.issue = 'cleanup_20261006_group_leftover'))
  returning g.id)
select (select count(*) from target) as candidates, (select count(*) from updated) as updated;
-- ROLLBACK: update public.corpus_display_groups g set preferred_id = d.original_record->>'preferred_id', metadata = d.original_record->'metadata' from corpus_ingest.cleanup_decisions d where d.dataset = 'public.corpus_display_groups' and d.issue = 'cleanup_20261006_group_leftover' and g.id = d.record_id and g.preferred_id = d.replacement->>'preferred_id';
