-- Lead runbook for legal-atlas-approve-api-v1.sql (release legal-atlas-pending-review). Not a migration:
-- run the statements one at a time as postgres/service_role against xosqzzsnhxcyehcnirpa. Workers never run this.
-- Expected numbers are from the read-only dry run of 2026-10-27; the Federal Register refresh may add rows.

-- 0. BEFORE
select count(*) as visible_edges from legal_atlas.visible_edges;                                    -- 2
select type, review_status, count(*) from legal_atlas.records group by 1,2 order by 1,2;          -- 8 approved, 944,353 pending
select type, extraction_method, review_status, count(*) from legal_atlas.edges group by 1,2,3 order by 1,2,3; -- 91,116 pending api

-- 1. APPLY (one transaction each): legal-atlas-approve-api-v1.sql, then legal-atlas-rin-lineage-v1.sql

-- 2. RELEASE RECORDS: repeat each call until "released" = 0 (about 15 s per 20,000 fr_document rows)
select legal_atlas.release_pending_records_v1('rule_proceeding', 20000);   -- 100,242
select legal_atlas.release_pending_records_v1('fr_document', 20000);       -- 810,586
select legal_atlas.release_pending_records_v1('source_doc', 20000);        -- 182
select legal_atlas.release_pending_records_v1('agency', 20000);            -- 473
select legal_atlas.release_pending_records_v1('court', 20000);             -- 3,361
select legal_atlas.release_pending_records_v1('judge', 20000);             -- 19,459
select legal_atlas.release_pending_records_v1('opinion', 20000);           -- 2,187
select legal_atlas.release_pending_records_v1('case', 20000);              -- 104
select legal_atlas.release_pending_records_v1('docket', 20000);            -- 104
select legal_atlas.release_pending_records_v1('docket_entry', 20000);      -- 5,400 (9 provider-sealed stay held)
select legal_atlas.release_pending_records_v1('party', 20000);             -- 1,359
select legal_atlas.release_pending_records_v1('attorney', 20000);          -- 0 (887 held: counsel contact fields)

-- 3. RELEASE EDGES (after the records): repeat until "released" = 0
select legal_atlas.release_pending_edges_v1(20000);                        -- 91,116 in total

-- 4. AFTER
select count(*) as visible_edges from legal_atlas.visible_edges;                                    -- 91,118
select count(*) from legal_atlas.edges where review_status = 'approved';                            -- equals visible_edges
select count(*) from legal_atlas.edges where review_status = 'pending';                             -- 0
select type, reason, records from legal_atlas.release_holds_v1 order by 1, 2;                      -- attorney 887, docket_entry 9
select kind, entity_type, count(*) from legal_atlas.release_ledger_v1 group by 1, 2 order by 1, 2; -- 943,457 records, 91,116 edges
select public.corpus_legal_rin_v1('1904-AF44') -> 'counts';
select (public.corpus_legal_node_v3('["federal_register","rule_proceeding","1018-AX13","6597222dfc78a24acaa14c40d396700c91fdfb82a2adb1143eb3334fa5cfa24a"]'::jsonb) ->> 'total')::int; -- 1
select public.corpus_legal_quality_v3() -> 'review_pending';                                        -- 896

-- 5. AFTER EACH FEDERAL REGISTER REFRESH: re-run steps 2 (rule_proceeding, fr_document, source_doc, agency) and 3.

-- Applied 2026-10-27 by the lead (owner decision 2026-10-27), migrations legal_atlas_approve_api_v1 and
-- legal_atlas_rin_lineage_v1. Before: visible_edges 2; records pending 944,353 (approved 8); edges pending 91,116.
-- After: records released 943,457 (fr_document 810,586; rule_proceeding 100,242; judge 19,459; docket_entry 5,400;
-- court 3,361; opinion 2,187; party 1,359; agency 473; source_doc 182; case 104; docket 104); edges released 91,116;
-- visible_edges 91,118 = approved edges; pending left: attorney 887 (owner policy: counsel contact fields) and
-- docket_entry 9 (CourtListener is_sealed=true on a document); corpus_legal_quality_v3()->'review_pending' = 896.
-- corpus_legal_rin_v1('2120-AA64') total 19,909; anon execute false; SECURITY DEFINER.
-- Review correction: 13,301 RINs have both a PRORULE-type and a RULE-type document edge; by a strict action test
-- (plain 'Proposed rule.' and plain 'Final rule.'), 11,079 RINs have both. RULE/PRORULE documents include corrections,
-- withdrawals, delays, extensions and hearings, so corpus_legal_rin_v1 labels each document by FR document type with
-- its verbatim action ('Proposed Rule document' / 'Rule document'; counts prorule_documents / rule_documents).
-- Rollback is bounded: legal_atlas.release_rollback_edges_v1 / release_rollback_records_v1, see the rollback file.
