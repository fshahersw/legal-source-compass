-- mdl-docket-documents-titles/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; approved by the coordinator after the round-2 review)
-- Work item C follow-up. All 5,016 mdl_docket_documents rows carried the DOCKET label as title ("2:24-md-03094 - paed (IN RE: Glucagon-like ... Litigation)"),
-- so one docket's documents were indistinguishable (17 distinct titles for 5,016 rows, largest group 645).
-- New title (deterministic, from the row's own fields): <description> · entry <entry number>, where
--   description  = item.cells.description (whitespace collapsed; unchanged wording; the source caps it at 200 characters),
--   entry number = 3rd segment of the stable id  doc:<docket>:<entry>:<doc>:<recap id>  when it is a number (the 96 text-only entries have 'None' and get the description alone).
-- The original docket label is KEPT as item.docket_label and detail.docket_label (and stays in the searchable text column, which was never the title).
-- Result: 4,995 distinct (docket, title) pairs for 5,016 rows (21 rows are identical sibling documents of one docket entry, e.g. 3 x 'Exhibit' on entry 1634).
-- item.title / detail.title (complete JSON strings equal to the old title) follow the new title; subtitle (docket number, court, MDL, filing date) unchanged.
-- search_vector is recomputed by the existing trigger (title changed). Before-image: whole title / item / detail + whole-row md5.
-- Execute statement 1, then statement 2.
--
-- ROLLBACK (exact; the trigger restores the search_vector):
--   update public.corpus_records r set title = c.original_record->>'title', item = c.original_record->'item', detail = c.original_record->'detail'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='mdl_docket_documents' and c.issue='dq20261003r3_mdl_docket_document_title' and c.run_id='c490cdf1-b32e-46ae-95c5-788cdeba3f33'
--      and r.dataset='mdl_docket_documents' and r.id=c.record_id;
--
-- ===== statement 1: audit (before-images) =====
with target as materialized (
 select r.id, r.ordinal, r.title as old_title, r.item as old_item, r.detail as old_detail, md5(to_jsonb(r)::text) as row_md5,
        regexp_replace(btrim(r.item->'cells'->>'description'), '\s+', ' ', 'g') as descr,
        (regexp_match(r.id, '^doc:([0-9]+):([^:]*):([^:]*):([0-9]+)$'))[2] as entry_no
 from public.corpus_records r where r.dataset = 'mdl_docket_documents'),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'mdl_docket_documents', t.id, 'dq20261003r3_mdl_docket_document_title', 'label_override',
  'Title was the docket label shared by every document of the docket; it is replaced by the document description plus the docket entry number (both from the row itself). The docket label is kept as docket_label in item and detail.',
  jsonb_build_object('review_version','mdl-docket-documents-titles/2026-10-03.r3.1','format','<description> · entry <n>','entry_source','id segment 3','approved_by','coordinator (round 2 review)'),
  jsonb_build_object('id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item',t.old_item,'detail',t.old_detail,'row_md5',t.row_md5),
  jsonb_build_object('title', case when t.entry_no ~ '^[0-9]+$' then t.descr || ' · entry ' || t.entry_no else t.descr end),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from target t where t.descr is not null and t.descr <> ''
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from target) targets, (select count(*) from ins) audit_rows_written;

-- ===== statement 2: apply from the audited before-images =====
with u as (
 update public.corpus_records r
    set title  = c.replacement->>'title',
        item   = jsonb_set(replace(r.item::text,   to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb, '{docket_label}', to_jsonb(c.original_record->>'title')),
        detail = jsonb_set(replace(r.detail::text, to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb, '{docket_label}', to_jsonb(c.original_record->>'title'))
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'mdl_docket_documents' and c.issue = 'dq20261003r3_mdl_docket_document_title' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and r.dataset = 'mdl_docket_documents' and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;
