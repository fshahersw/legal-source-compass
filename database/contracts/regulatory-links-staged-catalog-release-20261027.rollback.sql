-- SUPERSEDED, DO NOT APPLY (2026-10-27): the same row was retired in production by
-- release/dataset-regulatory-links-staged-empty (database/contracts/release-dataset-regulatory-links-staged-empty-v1.sql,
-- ledger issue release20261027_retire_empty_staged_catalog), which also adds URL redirects. Use that branch's rollback.
-- This file's preflight refuses anyway: the catalog row is gone.
-- ROLLBACK for regulatory-links-staged-catalog-release/2026-10-27.1 (run 19a391c2-f6b8-4c10-8567-50e2ec054bea).
-- Re-inserts the empty sw_matter_regulatory_links_v1_staged catalog row byte-for-byte from the ledger before-image
-- (md5 of the row 4f60eb85ba4b4d5e6bac80ffd05b46cc, updated_at unchanged), removes this contract's ledger row and marks the run
-- rolled back. The published sw_matter_regulatory_links_v1 was never touched and is not touched here.
-- The run row stays (status failed, rolled_back_at); re-applying the contract afterwards needs a new run id.
-- Offline test: scripts/admin/regulatory-links-staged-catalog-release.test.mjs (pglite).
-- Run as one transaction.

begin;
set local statement_timeout = '30s';

do $$
begin
  if not exists (select 1 from corpus_ingest.cleanup_decisions
                  where run_id = '19a391c2-f6b8-4c10-8567-50e2ec054bea' and dataset = 'public.corpus_datasets'
                    and record_id = 'sw_matter_regulatory_links_v1_staged'
                    and issue = 'release_20261027_drop_empty_staged_catalog') then
    raise exception 'ROLLBACK: ledger before-image not found; nothing to roll back';
  end if;
  if exists (select 1 from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1_staged') then
    raise exception 'ROLLBACK: sw_matter_regulatory_links_v1_staged is already in the catalog';
  end if;
end $$;

-- 1. catalog row restored from the before-image
insert into public.corpus_datasets
select (jsonb_populate_record(null::public.corpus_datasets, c.original_record)).*
  from corpus_ingest.cleanup_decisions c
 where c.run_id = '19a391c2-f6b8-4c10-8567-50e2ec054bea' and c.dataset = 'public.corpus_datasets'
   and c.record_id = 'sw_matter_regulatory_links_v1_staged' and c.issue = 'release_20261027_drop_empty_staged_catalog';

-- 2. ledger row removed (it would block a re-apply); the run row records the rollback
delete from corpus_ingest.cleanup_decisions where run_id = '19a391c2-f6b8-4c10-8567-50e2ec054bea';
update corpus_ingest.runs
   set status = 'failed', finished_at = now(),
       counts = counts || jsonb_build_object('rolled_back_at', now()::text)
 where id = '19a391c2-f6b8-4c10-8567-50e2ec054bea';

do $$
begin
  if (select md5(to_jsonb(d)::text) from public.corpus_datasets d where d.id = 'sw_matter_regulatory_links_v1_staged')
     is distinct from '4f60eb85ba4b4d5e6bac80ffd05b46cc' then
    raise exception 'ROLLBACK POSTFLIGHT: staged catalog row not restored exactly';
  end if;
end $$;

commit;
