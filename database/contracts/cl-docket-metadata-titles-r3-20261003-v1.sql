-- cl-docket-metadata-titles/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; approved by the coordinator after the round-2 review)
-- Work item C follow-up. cl_docket_metadata titles are 'Docket <number>' without the court: 30,453 of 186,923 rows share their title with another docket
-- (e.g. 'Docket 2:18-cv-07211' exists in several courts; groups of up to 5). Only those rows get the court appended; unique titles are left untouched.
-- New title:  <old title> (<court_id>)   e.g.  Docket 2:18-cv-07211 (laed).   court_id = the row's own cells.court_id (present on all 30,453 rows).
-- 30,438 of the 30,453 titles become distinct (15 stay shared: same docket number in the same court). cells.name, item.title, detail.title follow (complete JSON strings).
-- text, filters, links, ids, ordinals unchanged; search_vector recomputed by the existing trigger (title changed).
-- ORDER MATTERS: run statement 1 (audit) for ALL ordinal windows (1-93000, then 93001-186923) BEFORE any statement 2. 'Shared title' is evaluated against the CURRENT titles of the whole
-- dataset, so applying one window first would change the group sizes seen by the other window. Statement 2 is windowed only to bound its size: it was run as ordinal 1-46500 and
-- ordinal > 46500 (both far below 50,000 rows; 30,453 rows in total). Before-image: whole title / item / detail + whole-row md5.
--
-- ROLLBACK (exact; the trigger restores the search_vector):
--   update public.corpus_records r set title = c.original_record->>'title', item = c.original_record->'item', detail = c.original_record->'detail'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='cl_docket_metadata' and c.issue='dq20261003r3_cl_docket_title_court' and c.run_id='c490cdf1-b32e-46ae-95c5-788cdeba3f33'
--      and r.dataset='cl_docket_metadata' and r.id=c.record_id;
--
-- ===== statement 1 (run once per window, for all windows first; second window: ordinal between 93001 and 186923): audit =====
with t as (
 select r.id, r.ordinal, r.title, count(*) over (partition by r.title) as g, r.item->'cells'->>'court_id' as ci
 from public.corpus_records r where r.dataset = 'cl_docket_metadata'),
target as materialized (
 select r.id, r.ordinal, r.title as old_title, r.item as old_item, r.detail as old_detail, md5(to_jsonb(r)::text) as row_md5, t.ci, t.g
 from t join public.corpus_records r on r.dataset = 'cl_docket_metadata' and r.id = t.id
 where t.g > 1 and t.ordinal between 1 and 93000 and btrim(coalesce(t.ci,'')) <> ''),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'cl_docket_metadata', x.id, 'dq20261003r3_cl_docket_title_court', 'label_override',
  'Docket title was shared with at least one other docket (same number, different court). The row''s own court id is appended so the title identifies the docket.',
  jsonb_build_object('review_version','cl-docket-metadata-titles/2026-10-03.r3.1','format','<title> (<court_id>)','rows_sharing_title',x.g,'approved_by','coordinator (round 2 review)'),
  jsonb_build_object('id',x.id,'ordinal',x.ordinal,'title',x.old_title,'item',x.old_item,'detail',x.old_detail,'row_md5',x.row_md5),
  jsonb_build_object('title', x.old_title || ' (' || btrim(x.ci) || ')'),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from target x
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from target) targets, (select count(*) from ins) audit_rows_written;

-- ===== statement 2 (run twice, after all audits: ordinal between 1 and 46500, then ordinal > 46500): apply from the audited before-images =====
with u as (
 update public.corpus_records r
    set title  = c.replacement->>'title',
        item   = replace(r.item::text,   to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb,
        detail = replace(r.detail::text, to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'cl_docket_metadata' and c.issue = 'dq20261003r3_cl_docket_title_court' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and (c.original_record->>'ordinal')::int between 1 and 46500   -- second run: (c.original_record->>'ordinal')::int > 46500
    and r.dataset = 'cl_docket_metadata' and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;
