-- Read-only verification for release docket-metadata-sw-builders (owner decision 2026-10-27). Run each block before and after the lead's
-- apply/publish steps; every statement is a SELECT. Expected values are from the read-only dry run of 2026-10-27.

-- 1. Function present, security definer, empty search_path, service_role only (after the contract is applied: 1 row, anon/auth false).
select p.oid::regprocedure as sig, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'corpus_sw_docketbird_read_v1';

-- 2. Dataset counts. Before: sw_docket_documents_v1 2,783 (1 case), sw_matter_parties_v1 11,825.
--    After:  sw_docket_documents_v1 99,672 = 2,783 kept (ilnd-1:2023-cv-00818, stage-only) + 24,348 docketbird-rest + 72,541 docketbird-mcp;
--            sw_matter_parties_v1 11,825 (unchanged count; 3 names released).
select dataset, count(*) from public.corpus_records where dataset in ('sw_docket_documents_v1', 'sw_matter_parties_v1') group by 1 order by 1;
select id, ready, expected_records, imported_records, metadata->'withheld_counts' as withheld, metadata->'projection_validation'->>'verified' as verified
  from public.corpus_datasets where id in ('sw_docket_documents_v1', 'sw_matter_parties_v1') order by 1;

-- 3. Rows by source and case count (after: docketbird-rest 24,348 / 10 cases, docketbird-mcp 72,541 / 498 cases (3 cases shared with REST),
--    legacy 2,783 / 1 case; 507 distinct cases).
set local statement_timeout = '120s';
select coalesce(filters->>'source_system', 'docketbird-rest (legacy row)') as source, count(*), count(distinct filters->>'case_id') as cases
  from public.corpus_records where dataset = 'sw_docket_documents_v1' group by 1 order by 1;

-- 4. Nothing the provider flags restricted is published (after: 0 / 0), and no personalized DocketBird locator is published (0).
select count(*) as restricted_rows from public.corpus_records r
 where r.dataset = 'sw_docket_documents_v1'
   and (exists (select 1 from corpus_ingest.entities e where e.source_system = 'docketbird-rest' and e.entity_type = 'docket-document' and e.native_id = r.filters->>'native_id' and e.data->>'restricted' = 'true')
     or exists (select 1 from corpus_ingest.entities e where e.source_system = 'docketbird-mcp' and e.entity_type = 'document_metadata' and e.native_id = r.filters->>'native_id' and e.data->>'source_restricted' = 'true'));
select count(*) as personalized_locators from public.corpus_records where dataset = 'sw_docket_documents_v1' and (item::text ~ 'user_id=' or detail::text ~ 'user_id=');

-- 5. Before: 0 / 0 / 60. After: unknown_seal_rows 0 (neither DocketBird source has a null restricted flag today; the rule would publish
--    them with "Seal status: Not recorded by the provider"), sealing_word_rows about 3,600 (titles the earlier keyword rule withheld:
--    685 REST + 2,979 MCP before de-duplication and contact holds), contact_withheld_rows about 990 (60 legacy + 38 REST + 897 MCP).
select count(*) filter (where item->'cells'->'restricted' = 'null'::jsonb) as unknown_seal_rows,
       count(*) filter (where item->'cells'->>'description' ~* '(seal|restricted|in[[:space:]-]*camera|ex[[:space:]-]*parte|redact)') as sealing_word_rows,
       count(*) filter (where item->'cells'->>'description_withheld' = 'contact_or_access_data') as contact_withheld_rows
  from public.corpus_records where dataset = 'sw_docket_documents_v1';

-- 6. Parties: before 3 rows name_withheld=true (keyword rule); after 0. Counsel omitted for "Attorney in sealed group": 0 before and after.
select count(*) filter (where item->'cells'->>'name_withheld' = 'true') as name_withheld,
       sum((item->'cells'->>'counsel_sealed_omitted')::int) as counsel_sealed_omitted
  from public.corpus_records where dataset = 'sw_matter_parties_v1';
select id, item->'cells'->>'party_name' as party_name from public.corpus_records
 where dataset = 'sw_matter_parties_v1' and id in ('sw-party:courtlistener:8408916:19617955', 'sw-party:courtlistener:65407433:16857545', 'sw-party:courtlistener:68869775:14366118');
