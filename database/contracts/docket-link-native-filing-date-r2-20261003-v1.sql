-- docket-link-native-filing-date/2026-10-03.1  (round 2 run af6ac9c6-b834-497d-bd19-17970d4857d3)
-- ORCHESTRATOR-APPROVED (round 2, 2026-10-03): fill missing public.corpus_workspace_docket_links.event_date for mdl_docket_activity
-- links ONLY where the native source has an exact, unique filing date, and label it so it is never confused with an entered date.
--   exact key  : links.cl_docket_id = native_docket_id AND links.entry_number = native entry_number
--   native src : public.cl_master_entries (cells.date_filed), cross-checked in the same statement against
--                corpus_ingest.entities(courtlistener, docket-entries, native_entry_id).data->>'date_filed'
--   new values : event_date = native date_filed (YYYY-MM-DD);  date_basis = 'native filing date (CourtListener)'
-- 680 undated links have an exact docket+entry match; 662 are unique and filled. 18 (MDL 2913, docket 16284915) have two native entries
-- with different dates for the same entry number, so no single exact date exists -> left undated.
-- Existing 'entered_date_parsed_from_description' values are untouched. Measured on 6,483 already-dated rows with a native match:
-- filing date = entered date for 5,696 (87.9%), entered 1-3 days later 168, entered over 3 days later 136, entered before filing 483,
-- so the two concepts are NOT interchangeable and the explicit date_basis is required.
-- Two statements (a single CTE chain mis-plans on this projection and exceeds the 2-minute limit):
--   (1) write the audit rows, (2) update strictly from the audit rows of this run.
-- Reversible: the complete original link row is stored in corpus_ingest.cleanup_decisions
-- (dataset 'public.corpus_workspace_docket_links', issue 'dq20261003r2_docket_link_event_date').
--
-- ROLLBACK (exact):
--   update public.corpus_workspace_docket_links l
--      set event_date = c.original_record->>'event_date', date_basis = c.original_record->>'date_basis',
--          refreshed_at = (c.original_record->>'refreshed_at')::timestamptz
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='public.corpus_workspace_docket_links' and c.issue='dq20261003r2_docket_link_event_date'
--      and c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3'
--      and (l.source_dataset||'/'||l.source_record_id||'/'||l.mdl) = c.record_id;

-- (1) audit rows
with undated as (
 select l.* from public.corpus_workspace_docket_links l
 where l.source_dataset = 'mdl_docket_activity' and l.event_date is null and l.cl_docket_id is not null and l.entry_number is not null),
native as (
 select r.id as native_record_id, r.item->'cells'->>'native_entry_id' as nid, r.item->'cells'->>'native_docket_id' as did,
        r.item->'cells'->>'entry_number' as en, r.item->'cells'->>'date_filed' as df
 from public.corpus_records r where r.dataset = 'cl_master_entries'),
cand as (
 select u.source_dataset, u.source_record_id, u.mdl, n.native_record_id, n.nid, n.df,
        count(*) over (partition by u.source_dataset, u.source_record_id, u.mdl) as matches
 from undated u join native n on n.did = u.cl_docket_id and n.en = u.entry_number
 where n.df ~ '^\d{4}-\d{2}-\d{2}$'),
target as materialized (
 select c.* from cand c
 where c.matches = 1
   and exists (select 1 from corpus_ingest.entities e where e.source_system = 'courtlistener' and e.entity_type = 'docket-entries'
                and e.native_id = c.nid and e.data->>'date_filed' = c.df))
insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
select 'public.corpus_workspace_docket_links', t.source_dataset||'/'||t.source_record_id||'/'||t.mdl, 'dq20261003r2_docket_link_event_date', 'label_override',
 'Activity link had no event_date (no docket text recorded). The native CourtListener docket entry with the same docket id and entry number has an exact filing date; filled with an explicit date_basis so it is not read as an entered date.',
 jsonb_build_object('approval','orchestrator round 2, 2026-10-03','native_record','cl_master_entries/'||t.native_record_id,'native_entry_id',t.nid,
                    'private_entity_date_filed_equal',true,'unique_native_match',true),
 to_jsonb(l),
 jsonb_build_object('event_date', t.df, 'date_basis', 'native filing date (CourtListener)'),
 'af6ac9c6-b834-497d-bd19-17970d4857d3'::uuid
from target t join public.corpus_workspace_docket_links l
  on l.source_dataset = t.source_dataset and l.source_record_id = t.source_record_id and l.mdl = t.mdl
on conflict (dataset,record_id,issue) do nothing;

-- (2) update strictly from this run's audit rows (only rows still undated with the audited date_basis)
update public.corpus_workspace_docket_links l
   set event_date = c.replacement->>'event_date', date_basis = c.replacement->>'date_basis', refreshed_at = now()
  from corpus_ingest.cleanup_decisions c
 where c.dataset = 'public.corpus_workspace_docket_links' and c.issue = 'dq20261003r2_docket_link_event_date'
   and c.run_id = 'af6ac9c6-b834-497d-bd19-17970d4857d3'
   and c.record_id = l.source_dataset||'/'||l.source_record_id||'/'||l.mdl
   and l.event_date is null and l.date_basis is not distinct from (c.original_record->>'date_basis');
