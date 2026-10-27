-- Rollback of state-codes-third-party-projection-off-v1.sql: project GA, AR, TN, MS again exactly as before
-- (flag true, the appended note removed). Lead only.
-- Verify after: select jurisdiction, public_projection_allowed from corpus_ingest.publisher_code_states_v2
--   where jurisdiction in ('GA','AR','TN','MS');   -- 4 rows, all true
--   select count(*) from jsonb_array_elements(public.corpus_publisher_code_projected_states_v2());   -- 51

begin;
set local statement_timeout = '30s';

update corpus_ingest.publisher_code_states_v2
set public_projection_allowed = true,
    notes = nullif(regexp_replace(notes, E'\\n\\[state-codes-third-party-projection-off-v1 2026-10-27\\][^\\n]*$', ''), ''),
    updated_at = now()
where (jurisdiction, source_system) in (('GA', 'ga-georgiacommons-2025'), ('AR', 'ar-historical-rtf-20201106'),
                                        ('TN', 'tn-historical-rtf-20210521'), ('MS', 'ms-historical-rtf-20200708'))
  and not public_projection_allowed
  and notes like '%[state-codes-third-party-projection-off-v1 2026-10-27]%';

commit;
