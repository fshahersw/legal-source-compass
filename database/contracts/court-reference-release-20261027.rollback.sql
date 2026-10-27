-- ROLLBACK for court-reference-release/2026-10-27.2 (run c36e2186-fb92-42bb-8632-4bd599772cff).
-- Returns court_reference to its exact pre-release state: dataset held (ready and metadata.ready false, release note removed),
-- all 253 seal artifacts held, and the ilsd, mdd and nyappdiv records restored byte-for-byte from the ledger before-images.
-- Storage objects uploaded by scripts/admin/upload-court-reference-seals.mjs stay in the private corpus-originals bucket;
-- with every artifact row held they are unreachable from the site. Remove them only on a separate, ledgered decision.
-- The run row stays (status failed, rolled_back_at); a re-release needs a new run id.
-- Run as one transaction.

begin;
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from corpus_ingest.cleanup_decisions
       where run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff' and dataset = 'court_reference'
         and record_id in ('ilsd', 'mdd', 'nyappdiv') and issue = 'court_reference_seal_wrong_court') <> 3 then
    raise exception 'ROLLBACK: the three ledger before-images (ilsd, mdd, nyappdiv) were not found; nothing to roll back';
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

-- 3. the three records restored from the before-images (search_vector is recomputed by corpus_records_search_vector_trg)
update public.corpus_records r
   set item = c.original_record->'item',
       detail = c.original_record->'detail',
       text = c.original_record->>'text'
  from corpus_ingest.cleanup_decisions c
 where c.run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff' and c.dataset = 'court_reference'
   and c.issue = 'court_reference_seal_wrong_court'
   and r.dataset = 'court_reference' and r.id = c.record_id;

-- 4. ledger rows removed (they would block a re-apply); the run row records the rollback
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
  if (select string_agg(id || '=' || md5(item::text) || md5(detail::text) || md5(text), ',' order by id)
        from public.corpus_records where dataset = 'court_reference' and id in ('ilsd', 'mdd', 'nyappdiv'))
     is distinct from
       'ilsd=' || '26a85010599051ab3d736d308a71d811' || '4984c7540e8f3a8fdcefb99b85e9a7f5' || '6110ae89cd4f5159cb2d372d9d17e0ba' || ',' ||
       'mdd=' || '3bf9c9c885770d7410b4b0a1b2108ac5' || 'b4177322ee56f2b84b6c6898b38c99c6' || '96fde658896969e6f5da7aaa94105f97' || ',' ||
       'nyappdiv=' || '89980b68c7b80473296134a73c05cf52' || 'f2a2f1b86ea41595d5c7b08ec169677a' || '0e4f0253ac3b8b235cd1a8de28d28143' then
    raise exception 'ROLLBACK POSTFLIGHT: the kept-out records were not restored exactly';
  end if;
end $$;

commit;
