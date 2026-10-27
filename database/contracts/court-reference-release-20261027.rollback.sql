-- ROLLBACK for court-reference-release/2026-10-27.1 (run c36e2186-fb92-42bb-8632-4bd599772cff).
-- Returns court_reference to its exact pre-release state: dataset held (ready and metadata.ready false, release note removed),
-- all 253 seal artifacts held, and the ilsd record restored byte-for-byte from the ledger before-image.
-- Storage objects uploaded by scripts/admin/upload-court-reference-seals.mjs stay in the private corpus-originals bucket;
-- with every artifact row held they are unreachable from the site. Remove them only on a separate, ledgered decision.
-- Run as one transaction.

begin;
set local statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from corpus_ingest.cleanup_decisions
                  where run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff' and dataset = 'court_reference'
                    and record_id = 'ilsd' and issue = 'court_reference_seal_wrong_court') then
    raise exception 'ROLLBACK: ledger before-image for ilsd not found; nothing to roll back';
  end if;
end $$;

-- 1. dataset held again
update public.corpus_datasets
   set ready = false,
       metadata = jsonb_set(metadata, '{ready}', 'false'::jsonb) - 'release_20261027',
       updated_at = now()
 where id = 'court_reference';

-- 2. every seal artifact held again (all 253 were ready = false before the release)
update public.corpus_artifacts
   set ready = false
 where route like '/supplement-files/court_reference/%' and ready;

-- 3. ilsd record restored from the before-image (search_vector is recomputed by corpus_records_search_vector_trg)
update public.corpus_records r
   set item = c.original_record->'item',
       detail = c.original_record->'detail',
       text = c.original_record->>'text'
  from corpus_ingest.cleanup_decisions c
 where c.run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff' and c.dataset = 'court_reference'
   and c.record_id = 'ilsd' and c.issue = 'court_reference_seal_wrong_court'
   and r.dataset = 'court_reference' and r.id = 'ilsd';

-- 4. ledger row removed (it would block a re-apply); the run row records the rollback
delete from corpus_ingest.cleanup_decisions where run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff';
update corpus_ingest.runs
   set status = 'failed', finished_at = now(),
       counts = counts || jsonb_build_object('rolled_back_at', now()::text)
 where id = 'c36e2186-fb92-42bb-8632-4bd599772cff';

do $$
begin
  if (select ready from public.corpus_datasets where id = 'court_reference') is distinct from false then
    raise exception 'ROLLBACK POSTFLIGHT: dataset still ready';
  end if;
  if exists (select 1 from public.corpus_artifacts where route like '/supplement-files/court_reference/%' and ready) then
    raise exception 'ROLLBACK POSTFLIGHT: a seal artifact is still ready';
  end if;
  if (select md5(item::text) || md5(detail::text) || md5(text) from public.corpus_records where dataset = 'court_reference' and id = 'ilsd')
     is distinct from '26a85010599051ab3d736d308a71d811' || '4984c7540e8f3a8fdcefb99b85e9a7f5' || '6110ae89cd4f5159cb2d372d9d17e0ba' then
    raise exception 'ROLLBACK POSTFLIGHT: ilsd record not restored exactly';
  end if;
end $$;

commit;
