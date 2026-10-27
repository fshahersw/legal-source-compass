-- Rollback for fjc-idb-civil-cases-v1 (dataset fjc_idb_civil_cases, published by build_fjc_idb_cases.py --publish).
-- The dataset did not exist before the release (verified 2026-10-27: 0 records, no catalog row), so rollback removes it entirely.
-- Its source rows in corpus_ingest.entities are untouched by the release and by this rollback; rebuilding is a re-run of the builder.
-- Run as one transaction by the lead; deletes in batches are not needed for ~405k rows on this table, but a 600 s timeout is set.
begin;
set local statement_timeout = '600s';
delete from public.corpus_records where dataset = 'fjc_idb_civil_cases';
delete from public.corpus_datasets where id = 'fjc_idb_civil_cases';
commit;

-- Verify (expect 0 and 0):
-- select count(*) from public.corpus_records where dataset = 'fjc_idb_civil_cases';
-- select count(*) from public.corpus_datasets where id = 'fjc_idb_civil_cases';
