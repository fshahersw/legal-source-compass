-- mdl-crosswalk-release/2026-10-27.v1 -- read-only verification (run BEFORE and AFTER database/contracts/mdl-crosswalk-release-v1.sql).
-- Owner decision 2026-10-27 (AGENTS.md): "dont withhold any data. If its accurate and valuable, USE IT".
-- Expected BEFORE: ready=false, meta_ready=false, records=59, rows_md5=94e5163608c9cf200fb440d47a7cf7cc, meta_md5=660aa8f72b922a3593339983e0b6a665,
--                  old_qualification=59, hash_links=59, entity_links=0, fact_3014_old=1, ledger_records=0, ledger_dataset=0, dup_check=59.
-- Expected AFTER:  ready=true,  meta_ready=true,  records=59, rows_md5=3e583ffe224cdf363576edcf64054748, old_qualification=0, hash_links=0,
--                  entity_links=59, fact_3014_old=0, fact_annotated=3, ledger_records=59, ledger_dataset=1, dup_check=59, metadata_release=1.
set local statement_timeout = '30s';
select
  (select ready from public.corpus_datasets where id = 'mdl_crosswalk') as ready,
  (select metadata->>'ready' from public.corpus_datasets where id = 'mdl_crosswalk') as meta_ready,
  (select md5(metadata::text) from public.corpus_datasets where id = 'mdl_crosswalk') as meta_md5,
  (select count(*) from public.corpus_records where dataset = 'mdl_crosswalk') as records,
  (select md5(string_agg(id || item::text || detail::text || text, '|' order by id)) from public.corpus_records where dataset = 'mdl_crosswalk') as rows_md5,
  (select count(*) from public.corpus_records where dataset = 'mdl_crosswalk'
     and (position('personal-testing' in text) > 0 or detail->>'qualification' like '%not for redistribution%')) as old_qualification,
  (select count(*) from public.corpus_records where dataset = 'mdl_crosswalk' and item->'links'->0->>'url' ~ '^#mdls\?mdl=[0-9]+$') as hash_links,
  (select count(*) from public.corpus_records where dataset = 'mdl_crosswalk'
     and item->'links'->0->>'url' = '#mdl/' || (item->'cells'->>'mdl') and detail->'links'->0->>'url' = '#mdl/' || (item->'cells'->>'mdl')) as entity_links,
  (select count(*) from public.corpus_records r, jsonb_array_elements(r.detail->'facts') f
     where r.dataset = 'mdl_crosswalk' and r.id = 'mdl:3014' and f->>1 = '63571952') as fact_3014_old,
  (select count(*) from public.corpus_records r, jsonb_array_elements(r.detail->'facts') f
     where r.dataset = 'mdl_crosswalk' and r.id in ('mdl:2804', 'mdl:3010', 'mdl:3014')
       and f->>0 = 'CourtListener docket id (matter_aliases.courtlistener_docket_id)' and (f->>1 like '% (one of %' or f->>1 like '% is not the MDL master:%')) as fact_annotated,
  (select count(*) from corpus_ingest.cleanup_decisions where dataset = 'mdl_crosswalk' and issue = 'release20261027_mdl_crosswalk') as ledger_records,
  (select count(*) from corpus_ingest.cleanup_decisions where dataset = 'corpus_datasets' and record_id = 'mdl_crosswalk' and issue = 'release20261027_mdl_crosswalk_dataset') as ledger_dataset,
  (select count(*) from public.corpus_datasets where id = 'mdl_crosswalk' and metadata ? 'release_2026_10_27') as metadata_release,
  -- duplication check from the release category: every crosswalk row matches a published mdls row with the same court
  (select count(*) from public.corpus_records x
     join public.corpus_records m on m.dataset = 'mdls' and m.id = x.item->'cells'->>'mdl' and lower(m.detail->>'cl_court_id') = x.item->'cells'->>'court'
    where x.dataset = 'mdl_crosswalk') as dup_check,
  -- the 3014 correction stays consistent with the published MDL directory
  (select m.detail->'summary'->>'cl_docket_id' from public.corpus_records m where m.dataset = 'mdls' and m.id = '3014') as mdls_3014_cl_docket_id;
