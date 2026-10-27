-- Rollback for release-coverage-topics-20261027-v1.sql (release-dataset-coverage-topics/2026-10-27.v1, run 5792288a-88c5-9f65-f391-6da80fbd194b).
-- Restores every coverage_topics row and the corpus_datasets entry exactly from the before-images in corpus_ingest.cleanup_decisions
-- (issue 'release20261027_coverage_topics_verify'), then removes the ledger rows and the run. Only rows that still carry this release's
-- projection (item.topic_verification.version = 'coverage-topics-verify/2026-10-27.1') are reverted; re-inserts skip ids that exist again.
-- Note: re-inserting the trellis.law row restores a commercial-host row; run this only to undo the release as a whole.

begin;

-- 1 revert the 127 updated rows
update public.corpus_records r
   set item = c.original_record->'item',
       detail = c.original_record->'detail',
       filters = c.original_record->'filters',
       title = c.original_record->>'title',
       source_url = c.original_record->>'source_url'
  from corpus_ingest.cleanup_decisions c
 where c.dataset = 'coverage_topics' and c.issue = 'release20261027_coverage_topics_verify' and c.disposition = 'label_override'
   and c.run_id = '5792288a-88c5-9f65-f391-6da80fbd194b'::uuid
   and r.dataset = 'coverage_topics' and r.id = c.record_id
   and r.item->'topic_verification'->>'version' = 'coverage-topics-verify/2026-10-27.1';

-- 2 re-insert the 7 deleted rows (search_vector is recomputed by corpus_records_search_vector_trg)
insert into public.corpus_records
select (jsonb_populate_record(null::public.corpus_records, c.original_record - 'row_md5')).*
  from corpus_ingest.cleanup_decisions c
 where c.dataset = 'coverage_topics' and c.issue = 'release20261027_coverage_topics_verify' and c.disposition = 'quarantine'
   and c.run_id = '5792288a-88c5-9f65-f391-6da80fbd194b'::uuid
on conflict (dataset, id) do nothing;

-- 3 restore the dataset entry (ready=false, expected 17,942, imported 134, previous metadata)
update public.corpus_datasets d
   set ready = (c.original_record->>'ready')::boolean,
       expected_records = (c.original_record->>'expected_records')::bigint,
       imported_records = (c.original_record->>'imported_records')::bigint,
       metadata = c.original_record->'metadata',
       updated_at = now()
  from corpus_ingest.cleanup_decisions c
 where c.dataset = 'corpus_datasets' and c.record_id = 'coverage_topics' and c.issue = 'release20261027_coverage_topics_verify'
   and c.run_id = '5792288a-88c5-9f65-f391-6da80fbd194b'::uuid and d.id = 'coverage_topics';

do $$
declare n int; t int;
begin
  select count(*) into n from public.corpus_records where dataset = 'coverage_topics';
  select count(*) into t from public.corpus_records where dataset = 'coverage_topics' and item->'topic_verification' is not null;
  if n <> 134 or t <> 0 then raise exception 'rollback check failed: % rows (expected 134), % still projected (expected 0)', n, t; end if;
end $$;

-- 4 remove the ledger rows and the run
delete from corpus_ingest.cleanup_decisions where issue = 'release20261027_coverage_topics_verify' and run_id = '5792288a-88c5-9f65-f391-6da80fbd194b'::uuid;
delete from corpus_ingest.runs where id = '5792288a-88c5-9f65-f391-6da80fbd194b'::uuid;

commit;

-- verify: select ready, expected_records, imported_records from public.corpus_datasets where id = 'coverage_topics';   -- expect false, 17942, 134
--         select count(*) from public.corpus_records where dataset = 'coverage_topics';                              -- expect 134
