-- court-map-quarantined-testing-courts/2026-10-03.1  (round 2 run af6ac9c6-b834-497d-bd19-17970d4857d3)
-- ORCHESTRATOR-APPROVED (round 2, 2026-10-03): remove the 2 stale rows of the derived projection public.corpus_workspace_court_map
-- for the publisher testing courts 'psc' (U.S. District Court for the PACER Training Site) and 'test' (Testing Supreme Court).
-- Their court_spine source rows were quarantined on 2026-10-02 (corpus_ingest.cleanup_decisions issue
-- native_testing_court_in_public_registry, disposition quarantine) but the projection kept them (map 5,413 rows vs court_spine 5,411).
-- Guards: exact ids, source record absent, a quarantine decision exists, zero references from corpus_workspace_docket_links.
-- The complete row is stored before deletion; nothing else is deleted.
--
-- ROLLBACK (exact):
--   insert into public.corpus_workspace_court_map
--   select (jsonb_populate_record(null::public.corpus_workspace_court_map, c.original_record)).*
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='public.corpus_workspace_court_map' and c.issue='dq20261003r2_court_map_quarantined_testing_court'
--      and c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3'
--   on conflict (court_id) do nothing;
with target as materialized (
 select m.* from public.corpus_workspace_court_map m
 where m.court_id in ('test','psc')
   and not exists (select 1 from public.corpus_records r where r.dataset = m.source_dataset and r.id = m.source_record_id)
   and exists (select 1 from corpus_ingest.cleanup_decisions c where c.dataset = 'court_spine' and c.record_id = m.court_id
                and c.issue = 'native_testing_court_in_public_registry' and c.disposition = 'quarantine')
   and not exists (select 1 from public.corpus_workspace_docket_links l where l.court_id = m.court_id)
   and not exists (select 1 from public.corpus_workspace_court_map x where x.parent_id = m.court_id)),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,run_id)
 select 'public.corpus_workspace_court_map', t.court_id, 'dq20261003r2_court_map_quarantined_testing_court', 'quarantine',
  'Derived court-map row for a publisher testing court whose court_spine source record was already quarantined. Projection row removed so it no longer lists a testing court; the complete row is retained here.',
  jsonb_build_object('approval','orchestrator round 2, 2026-10-03','court_spine_quarantine_issue','native_testing_court_in_public_registry','source_record_present',false,'docket_link_references',0),
  to_jsonb(t), 'af6ac9c6-b834-497d-bd19-17970d4857d3'::uuid
 from target t
 on conflict (dataset,record_id,issue) do nothing
 returning record_id),
deleted as (
 delete from public.corpus_workspace_court_map m
  using target t join audited a on a.record_id = t.court_id
  where m.court_id = t.court_id
  returning m.court_id)
select jsonb_build_object('contract','court-map-quarantined-testing-courts/2026-10-03.1','targets',(select count(*) from target),
 'audit_rows_written',(select count(*) from audited),'rows_deleted',(select count(*) from deleted),
 'court_map_rows_after',(select count(*) from public.corpus_workspace_court_map),
 'court_spine_rows',(select count(*) from public.corpus_records where dataset = 'court_spine'),'checked_at',now()) as receipt;
