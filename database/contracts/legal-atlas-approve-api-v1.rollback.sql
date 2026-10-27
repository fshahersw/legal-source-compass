-- Rollback for legal-atlas-approve-api-v1.sql. Returns every row the release approved to 'pending' using the
-- ledger, so the 8 records and 2 edges approved before 2026-10-27 (not in the ledger) stay approved.
-- Run the edge statement first. The record statements are per entity type so each stays a bounded statement;
-- run them one at a time and confirm each before the next. Then drop the contract objects.
-- The fr_document statement re-runs the records CHECK (record_errors) on ~810k rows: about 8 minutes, so run it
-- with a raised statement_timeout (e.g. `set statement_timeout = '20min';` in the same psql session).

update legal_atlas.edges e set review_status = 'pending'
from legal_atlas.release_ledger_v1 l
where l.kind = 'edge' and l.edge_key = e.edge_key and e.review_status = 'approved';

update legal_atlas.records r set review_status = 'pending' from legal_atlas.release_ledger_v1 l
where l.kind = 'record' and l.entity_type = 'rule_proceeding' and l.record_key = r.record_key and r.review_status = 'approved';
update legal_atlas.records r set review_status = 'pending' from legal_atlas.release_ledger_v1 l
where l.kind = 'record' and l.entity_type = 'fr_document' and l.record_key = r.record_key and r.review_status = 'approved';
update legal_atlas.records r set review_status = 'pending' from legal_atlas.release_ledger_v1 l
where l.kind = 'record' and l.entity_type not in ('rule_proceeding', 'fr_document') and l.record_key = r.record_key and r.review_status = 'approved';

-- Verify before dropping: both must be 0.
-- select count(*) from legal_atlas.edges e join legal_atlas.release_ledger_v1 l on l.kind='edge' and l.edge_key=e.edge_key where e.review_status='approved';
-- select count(*) from legal_atlas.records r join legal_atlas.release_ledger_v1 l on l.kind='record' and l.record_key=r.record_key where r.review_status='approved';

drop view if exists legal_atlas.release_holds_v1;
drop function if exists legal_atlas.release_pending_edges_v1(integer);
drop function if exists legal_atlas.release_pending_records_v1(legal_atlas.entity_type, integer);
drop function if exists legal_atlas.release_hold_reason_v1(legal_atlas.entity_type, jsonb);
drop table if exists legal_atlas.release_ledger_v1;
