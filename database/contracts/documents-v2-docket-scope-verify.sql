-- SUPERSEDED 2026-10-27, NOT APPLIED: release/documents-matter-case-scope (documents-v2-scope.sql) ships the same scope
-- change and is live on corpussite. It also carries this branch's review fixes: litviz_refresh_v1 skips filings without
-- an MDL (the not-null blocker), and exact master-docket keys from the mdls records link 1,595 filings on 13 dockets to
-- their MDL. Do not apply or merge this file; it would replace the live refresh body.
-- Read-only checks for documents-v2-docket-scope.sql. Run each block before and after the release; nothing here writes.
-- Expected values are the 2026-10-27 dry run (release packet private/acq/release-documents-scope-matter-pages-only/).

-- V1. extracted PDFs outside the layer. before: 11948. after refresh: 0.
set local statement_timeout = '120s';
with p as (select distinct sha256 from corpus_ingest.pdf_text_pages)
select count(*) as text_shas_outside_layer
  from p where not exists (select 1 from documents.documents d where d.sha256 = p.sha256);

-- V2. the MDL rule: docket-only rows never carry an MDL. after: 0 and 0.
select count(*) filter (where mdl is not null and listed_by = 'native_case_id') as docket_rows_with_mdl,
       count(*) filter (where mdl is null and listed_by <> 'native_case_id') as listed_rows_without_mdl
  from documents.documents;

-- V3. layer by listing basis and source. before: 40,731 rows, no native_case_id. after the first refresh:
-- native_case_id docketbird 22,959 / courtlistener 1,614 / official-court 1,255 (25,828), listed rows 60,982
-- (registry_pdf_case_id 53,306 incl. 1,120 GovInfo, derived_master_docket 4,720, court_mdl_label 2,956),
-- 86,810 in all. Listed rows grow from 40,731 to 60,982 because availability v2 opened 20,251 listed filings; a v1
-- refresh would add those too.
select listed_by, source_system, count(*) as documents, count(distinct native_case_id) as cases,
       count(*) filter (where mdl is null) as without_mdl
  from documents.documents group by 1, 2 order by 1, 2;

-- V4. no explicit-evidence hold leaked in. after: 0.
select count(*) as flagged_in_layer
  from documents.documents d
 where exists (select 1 from corpus_ingest.local_pdf_asset_occurrences o
                where o.sha256 = d.sha256 and o.source_seal_status = 'locally_flagged_sealed')
    or exists (select 1 from corpus_ingest.pdf_document_assets a
                where a.sha256 = d.sha256
                  and (a.provider_flags -> 'withheld_by_policy' = 'true'::jsonb or a.provider_flags -> 'is_sealed' = 'true'::jsonb
                       or a.provider_flags -> 'restricted' = 'true'::jsonb
                       or a.provider_flags -> 'sealing_related_locator_held' = 'true'::jsonb));

-- V5. the one open PDF held on explicit evidence stays out. after: 0 rows in the layer.
select count(*) as held_pdf_in_layer from documents.documents
 where sha256 = 'd72dd3feea10720e334579e96995e2af4595ea420ad03d512dfcd999c2415cca';

-- V6. text pipeline drained. after build_pages loop: pending_index = 0.
select text_status, count(*) from documents.documents group by 1 order by 1;

-- V7. the four replaced functions are the v2 text (md5 of prosrc, LF line endings).
-- v2: refresh 9f45b30654c12e57d9b35725b53345e0, search 4512c5659500041d6423fca96d54da00,
--     for_entity a43ca9ac600676a0e34e5669857ddb8c, links a6f83b0f7c66e1d556b457617ef014ea
-- v1 (rollback): refresh e96f6c35586d24c7a4917988decc38c1, search d831c0e979fe4ae3b3f86bccb31ed1fc,
--     for_entity aebb21004c253d3a335601f0282fd931, links 6278db649fb81faaa77777ca2c611a55
select p.proname, md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('documents_refresh_v1', 'documents_search_v1', 'documents_for_entity_v1', 'documents_links_v1')
 order by 1;

-- V8. constraints. after: documents_dataset_check includes 'docket', documents_listed_by_check includes
-- 'native_case_id', documents_docket_scope_check present, mdl nullable.
select conname, pg_get_constraintdef(c.oid) from pg_constraint c
 where conrelid = 'documents.documents'::regclass and contype = 'c' order by 1;
select is_nullable from information_schema.columns
 where table_schema = 'documents' and table_name = 'documents' and column_name = 'mdl';

-- V9. sample of released master dockets of MDLs outside the `mdls` dataset (mdl stays null). after the first refresh:
-- (open associations on 2026-10-27; a filing with several case ids is counted under one) cand-5:2018-md-02827 914 filings, mad-1:2013-md-02428 759, njd-3:2017-md-02779 498, nyed-1:2023-md-03089 578;
-- searchable equals filings with text (914 / 696 / 498 / 578) once build_pages has drained.
select native_case_id, court_id, count(*) as filings, count(*) filter (where text_status in ('text_layer', 'partial_text')) as searchable
  from documents.documents
 where native_case_id in ('cand-5:2018-md-02827', 'mad-1:2013-md-02428', 'njd-3:2017-md-02779', 'nyed-1:2023-md-03089')
 group by 1, 2 order by 1;
