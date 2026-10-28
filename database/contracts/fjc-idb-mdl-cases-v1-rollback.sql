-- Rollback for fjc_idb_mdl_cases v1 (published by scripts/enrichment/fjc_idb/build_fjc_idb_mdl_cases.py publish).
-- The dataset is new: before the release neither the catalog row nor any record existed (verify V2: 0 and 0), and the source
-- rows in corpus_ingest.entities are never modified by the release. Rolling back = removing the published copy; the held
-- source rows stay exactly as they were, so the release can be repeated from them.
-- Lead only; run in one transaction, then re-run fjc-idb-mdl-cases-v1-verify.sql V2 (expect 0 and 0).
begin;
set local statement_timeout = '600s';
-- 1. remove the published records (405,176 expected)
delete from public.corpus_records where dataset = 'fjc_idb_mdl_cases';
-- 2. remove the catalog entry
delete from public.corpus_datasets where id = 'fjc_idb_mdl_cases';
commit;
-- If the delete is too large for one statement in the timeout, first hide the dataset in its own statement
--   update public.corpus_datasets set ready = false where id = 'fjc_idb_mdl_cases';
-- then delete in slices until a slice deletes 0 rows, then run the transaction above:
--   delete from public.corpus_records where dataset = 'fjc_idb_mdl_cases' and id in
--     (select id from public.corpus_records where dataset = 'fjc_idb_mdl_cases' limit 50000);
