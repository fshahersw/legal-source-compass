-- mdls-searchable-identifiers/2026-10-03.r2.1  (round 2 run af6ac9c6-b834-497d-bd19-17970d4857d3)
-- Work item B (search accuracy). ROOT CAUSE of the failing Seeger Weiss queries '3140', 'MDL 3047', 'MDL 2738', 'MDL 3094', 'MDL 3081',
-- '3:25-md-3140': all 176 public.corpus_records rows of dataset 'mdls' have an EMPTY text column, and search_vector =
-- corpus_bounded_search_vector(title, text) therefore holds only the caption words. The MDL number and the master docket are not
-- searchable, so the MDL card never enters the candidate pool of the 'mdls' priority pass (0 rows returned for every number query) and
-- the app answers with unrelated rows (docket entries, eCFR sections, FDA enforcement records).
-- Fix (deterministic, source-faithful): text := the matter's own identifiers taken from the row's own item JSON:
--     'MDL <mdl_number>' + master_docket as printed + the same docket zero-padded to 5 digits (CM/ECF display form) + compact form
--     e.g. MDL 3140 | 3:25-md-3140 | 3:25-md-03140 | 3:25md3140       (same three forms sw_matters_v1 already uses)
-- Nothing else is added: no judge, court, status or litigation-type words (those would make every MDL match queries such as 'pending',
-- 'Ninth Circuit' or 'Judge Rodgers' and crowd out the judge records). title, item, detail, filters, counts, ids, ordinals unchanged.
-- search_vector is recomputed by the existing trigger corpus_records_search_vector_trg (title + text), 176 rows, ~0.9 MB all-in.
-- text is shown by the UI only where a record's "Record text" block is rendered; for mdls it was empty before and is now this one-line identifier string.
-- Execute statement 1, then statement 2.
--
-- ROLLBACK (exact; the trigger restores the search_vector):
--   update public.corpus_records r set text = c.original_record->>'text'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='mdls' and c.issue='dq20261003r2_mdls_searchable_identifiers' and c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3'
--      and r.dataset='mdls' and r.id=c.record_id;
--
-- ===== statement 1: audit (before-images) =====
with target as materialized (
 select r.id, r.ordinal, r.title, r.text as old_text, r.search_vector::text as old_sv, md5(to_jsonb(r)::text) as row_md5,
        concat_ws(' ',
          'MDL ' || (r.item->>'mdl_number'),
          r.item->>'master_docket',
          case when r.item->>'master_docket' ~ '^[0-9]+:[0-9]{2}-[a-z]+-[0-9]{1,5}$'
               then regexp_replace(r.item->>'master_docket', '-([0-9]+)$', '') || '-' || lpad(substring(r.item->>'master_docket' from '-([0-9]+)$'), 5, '0') end,
          case when r.item->>'master_docket' ~ '^[0-9]+:[0-9]{2}-[a-z]+-[0-9]{1,5}$'
               then regexp_replace(r.item->>'master_docket', '-([a-z]+)-', '\1') end) as new_text
 from public.corpus_records r
 where r.dataset = 'mdls' and r.text = '' and r.item->>'mdl_number' ~ '^[0-9]{1,4}$' and r.item->>'master_docket' is not null),
ins as (
insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
select 'mdls', t.id, 'dq20261003r2_mdls_searchable_identifiers', 'label_override',
  'The MDL record had empty text, so its MDL number and master docket were not in search_vector (queries "3140", "MDL 3047", "3:25-md-3140" could not find the MDL). text now holds the matter identifiers taken from the row''s own item JSON.',
  jsonb_build_object('review_version','mdls-searchable-identifiers/2026-10-03.r2.1','source','item.mdl_number, item.master_docket','added_words','MDL <n>, master docket (printed, 5-digit padded, compact)'),
  jsonb_build_object('id',t.id,'ordinal',t.ordinal,'title',t.title,'text',t.old_text,'search_vector',t.old_sv,'row_md5',t.row_md5),
  jsonb_build_object('text',t.new_text),
  'af6ac9c6-b834-497d-bd19-17970d4857d3'::uuid
from target t where t.new_text <> ''
on conflict (dataset,record_id,issue) do nothing
returning record_id)
select (select count(*) from target) targets, (select count(*) from ins) audit_rows_written,
       (select string_agg(new_text, ' || ' order by id) from (select * from target order by ordinal limit 3) q) samples;

-- ===== statement 2: apply from the audited before-images =====
update public.corpus_records r
   set text = c.replacement->>'text'
  from corpus_ingest.cleanup_decisions c
 where c.dataset = 'mdls' and c.issue = 'dq20261003r2_mdls_searchable_identifiers' and c.run_id = 'af6ac9c6-b834-497d-bd19-17970d4857d3'
   and r.dataset = 'mdls' and r.id = c.record_id and r.text = ''
   and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
returning r.id;
