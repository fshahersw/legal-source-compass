-- Rollback for legal-atlas-approve-api-v1.sql. Returns every row the release approved to 'pending' using the
-- ledger, so the 8 records and 2 edges approved before 2026-10-27 (not in the ledger) stay approved.
-- Bounded (review 2026-10-27): in production run each call below REPEATEDLY until it returns
-- returned_to_pending = 0 (about 15 s per 20,000 fr_document rows), edges first, then records per type.
-- The guard block refuses to drop the contract while any ledgered row is still approved.

select legal_atlas.release_rollback_edges_v1(200000);
select legal_atlas.release_rollback_records_v1(t, 200000)
from unnest(enum_range(null::legal_atlas.entity_type)) t;

do $$
begin
  if exists (select 1 from legal_atlas.edges e join legal_atlas.release_ledger_v1 l on l.kind = 'edge' and l.edge_key = e.edge_key
             where e.review_status = 'approved')
     or exists (select 1 from legal_atlas.records r join legal_atlas.release_ledger_v1 l on l.kind = 'record' and l.record_key = r.record_key
             where r.review_status = 'approved') then
    raise exception 'Ledgered rows are still approved: repeat the rollback calls until they return 0, then rerun this file';
  end if;
end $$;

drop view if exists legal_atlas.release_holds_v1;
drop function if exists legal_atlas.release_rollback_records_v1(legal_atlas.entity_type, integer);
drop function if exists legal_atlas.release_rollback_edges_v1(integer);
drop function if exists legal_atlas.release_pending_edges_v1(integer);
drop function if exists legal_atlas.release_pending_records_v1(legal_atlas.entity_type, integer);
drop function if exists legal_atlas.release_hold_reason_v1(legal_atlas.entity_type, jsonb);
drop table if exists legal_atlas.release_ledger_v1;
