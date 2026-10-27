-- Read-only verification for regulatory-links-staged-catalog-release/2026-10-27.1. Safe to run before and after.
-- Expected BEFORE: staged_row_md5 = 4f60eb85ba4b4d5e6bac80ffd05b46cc, staged_ready = false, staged_records = 0, ledger_row = 0,
--                  held_catalog_rows = 8 (court_reference, coverage_labels, coverage_topics, judge_portraits, large_text_assets,
--                  mdl_crosswalk, sw_matter_regulatory_links_v1_staged, verdict_reports; other release branches may lower this).
-- Expected AFTER:  staged_row_md5 = null, staged_records = 0, ledger_row = 1, ledger_roundtrip_ok = true, run_status = completed,
--                  held_catalog_rows = BEFORE - 1, and in every case published_ready = true, published_rows = 165,
--                  rows_2846 = 19, rows_2921 = 15, rows_3125 = 4, labelled_rows = 165, staged_before_images_2026_10_03 = 4.
set local statement_timeout = '20s';
select
  (select md5(to_jsonb(d)::text) from public.corpus_datasets d where d.id = 'sw_matter_regulatory_links_v1_staged') as staged_row_md5,
  (select ready from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1_staged') as staged_ready,
  (select count(*) from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1_staged') as staged_records,
  (select count(*) from corpus_ingest.cleanup_decisions
    where dataset = 'public.corpus_datasets' and record_id = 'sw_matter_regulatory_links_v1_staged'
      and issue = 'release_20261027_drop_empty_staged_catalog') as ledger_row,
  (select md5(original_record::text) = '4f60eb85ba4b4d5e6bac80ffd05b46cc'
     from corpus_ingest.cleanup_decisions
    where dataset = 'public.corpus_datasets' and record_id = 'sw_matter_regulatory_links_v1_staged'
      and issue = 'release_20261027_drop_empty_staged_catalog') as ledger_roundtrip_ok,
  (select status from corpus_ingest.runs where id = '19a391c2-f6b8-4c10-8567-50e2ec054bea') as run_status,
  (select count(*) from public.corpus_datasets where not ready) as held_catalog_rows,
  (select ready from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1') as published_ready,
  (select count(*) from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1') as published_rows,
  (select count(*) from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1' and filters->>'mdl' = '2846') as rows_2846,
  (select count(*) from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1' and filters->>'mdl' = '2921') as rows_2921,
  (select count(*) from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1' and filters->>'mdl' = '3125') as rows_3125,
  (select count(*) from public.corpus_records
    where dataset = 'sw_matter_regulatory_links_v1' and (title ilike '%not MDL membership%' or item::text like '%not MDL membership%')) as labelled_rows,
  (select count(*) from corpus_ingest.cleanup_decisions
    where dataset = 'sw_matter_regulatory_links_v1_staged' and issue = 'dq20261003r6_regulatory_links_staged') as staged_before_images_2026_10_03;
