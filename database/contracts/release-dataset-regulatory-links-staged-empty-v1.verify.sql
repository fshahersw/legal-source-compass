-- Read-only checks for release-dataset-regulatory-links-staged-empty-v1.sql. Run before and after the apply (and after a rollback).
-- Expected BEFORE (dry run 2026-10-27): staged_catalog_rows 1, staged_row_md5 4f60eb85ba4b4d5e6bac80ffd05b46cc, staged_ready false,
--   staged_imported 0, staged_records 0, live_records 165, live_ready true, moved_links_in_live 38, live_row_md5 280b3a94ae60d2aae84f18a6b6409f3e,
--   references 0, ledger_retire_rows 0, held_derived_links 151 (2026-10-03 restriction before-images; unchanged by this release).
-- Expected AFTER: staged_catalog_rows 0, staged_row_md5 null, staged_records 0, live_records 165, live_ready true, moved_links_in_live 38,
--   live_row_md5 unchanged, ledger_retire_rows 1.
begin read only;
set local statement_timeout = '8s';
select
  (select count(*) from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1_staged') as staged_catalog_rows,
  (select md5(to_jsonb(d)::text) from public.corpus_datasets d where id = 'sw_matter_regulatory_links_v1_staged') as staged_row_md5,
  (select ready from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1_staged') as staged_ready,
  (select imported_records from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1_staged') as staged_imported,
  (select count(*) from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1_staged') as staged_records,
  (select count(*) from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1') as live_records,
  (select ready from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1') as live_ready,
  (select count(*) from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1' and id ~ '^sw-reg:(2846|2921|3125):') as moved_links_in_live,
  (select md5(to_jsonb(d)::text) from public.corpus_datasets d where id = 'sw_matter_regulatory_links_v1') as live_row_md5,
  (select count(*) from public.corpus_context c where c.key like '%sw_matter_regulatory_links_v1_staged%')
   + (select count(*) from public.corpus_artifacts a where a.route like '%sw_matter_regulatory_links_v1_staged%')
   + (select count(*) from public.corpus_display_groups g where g.metadata::text like '%sw_matter_regulatory_links_v1_staged%') as references,
  (select count(*) from corpus_ingest.cleanup_decisions where dataset = 'public.corpus_datasets'
     and record_id = 'sw_matter_regulatory_links_v1_staged' and issue = 'release20261027_retire_empty_staged_catalog') as ledger_retire_rows,
  (select count(*) from corpus_ingest.cleanup_decisions where dataset = 'sw_matter_regulatory_links_v1' and disposition = 'quarantine') as held_derived_links;
commit;
