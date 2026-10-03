-- cl-master-entries-titles/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; approved by the coordinator after the round-2 review)
-- Work item C follow-up. cl_master_entries titles were only 'Docket entry N' (23,919 rows, 13,694 distinct): entry 210 of one docket is indistinguishable from entry 210 of
-- every other docket. Every row joins to its native docket (cells.native_docket_id -> cl_docket_metadata 'cl:dockets:<id>', 23,919 of 23,919).
-- New title (deterministic, from the two rows' own fields):  Docket entry <n> · <docket_number> (<court_id>)   e.g.  Docket entry 123 · 3:25-md-03140 (flnd)
-- 23,346 distinct titles (the rest are genuinely repeated entries of one docket). cells.name, item.title and detail.title (complete JSON strings equal to the old title) follow.
-- text, filters, links, ids, ordinals unchanged; search_vector recomputed by the existing trigger (title changed), so entries now also match the docket number and court id.
-- Run in two ordinal windows (0-11999, then ordinal >= 12000; the dataset's ordinals run 1-23,919) so each statement stays far below the 50k-row limit. Before-image: whole title / item / detail + whole-row md5.
--
-- ROLLBACK (exact; the trigger restores the search_vector):
--   update public.corpus_records r set title = c.original_record->>'title', item = c.original_record->'item', detail = c.original_record->'detail'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='cl_master_entries' and c.issue='dq20261003r3_cl_master_entry_title' and c.run_id='c490cdf1-b32e-46ae-95c5-788cdeba3f33'
--      and r.dataset='cl_master_entries' and r.id=c.record_id;
--
-- ===== statement 1 (run once per window: ordinal between 0 and 11999, then ordinal >= 12000): audit =====
with target as materialized (
 select r.id, r.ordinal, r.title as old_title, r.item as old_item, r.detail as old_detail, md5(to_jsonb(r)::text) as row_md5,
        d.item->'cells'->>'docket_number' as dn, d.item->'cells'->>'court_id' as ci
 from public.corpus_records r
 join public.corpus_records d on d.dataset = 'cl_docket_metadata' and d.id = 'cl:dockets:' || (r.item->'cells'->>'native_docket_id')
 where r.dataset = 'cl_master_entries' and r.ordinal between 0 and 11999 and r.title ~ '^Docket entry [0-9]+$'
   and btrim(coalesce(d.item->'cells'->>'docket_number','')) <> '' and btrim(coalesce(d.item->'cells'->>'court_id','')) <> ''),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'cl_master_entries', t.id, 'dq20261003r3_cl_master_entry_title', 'label_override',
  'Title was only "Docket entry N", identical across dockets. The docket number and court id of the entry''s own native docket are appended.',
  jsonb_build_object('review_version','cl-master-entries-titles/2026-10-03.r3.1','format','Docket entry <n> · <docket_number> (<court_id>)','source','cl_docket_metadata cells via native_docket_id','approved_by','coordinator (round 2 review)'),
  jsonb_build_object('id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item',t.old_item,'detail',t.old_detail,'row_md5',t.row_md5),
  jsonb_build_object('title', t.old_title || ' · ' || btrim(t.dn) || ' (' || btrim(t.ci) || ')'),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from target t
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from target) targets, (select count(*) from ins) audit_rows_written;

-- ===== statement 2 (run once per window): apply from the audited before-images =====
with u as (
 update public.corpus_records r
    set title  = c.replacement->>'title',
        item   = replace(r.item::text,   to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb,
        detail = replace(r.detail::text, to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'cl_master_entries' and c.issue = 'dq20261003r3_cl_master_entry_title' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and (c.original_record->>'ordinal')::int between 0 and 11999
    and r.dataset = 'cl_master_entries' and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;
