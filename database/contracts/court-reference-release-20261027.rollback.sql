-- ROLLBACK for court-reference-release/2026-10-27.3 (run c36e2186-fb92-42bb-8632-4bd599772cff).
-- Returns court_reference to its exact pre-release state: dataset held (ready and metadata.ready false, release note removed,
-- expected/imported_records and listing totals back to 253), all 253 seal artifacts held, the ilsd, mdd and nyappdiv records
-- restored byte-for-byte from the ledger before-images, and the aoc, cbca and compliance records re-inserted from the ledger
-- (search_vector is recomputed by corpus_records_search_vector_trg).
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
  if (select count(*) from corpus_ingest.cleanup_decisions
       where run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff' and dataset = 'court_reference'
         and record_id in ('aoc', 'cbca', 'compliance') and issue = 'court_reference_no_court_spine_id') <> 3 then
    raise exception 'ROLLBACK: the three archived records (aoc, cbca, compliance) were not found; nothing to roll back';
  end if;
end $$;

-- 1. every seal artifact held again (all 253 were ready = false before the release)
update public.corpus_artifacts
   set ready = false
 where route like '/supplement-files/court_reference/%' and ready;

-- 2. the three wrong-seal records restored from the before-images
update public.corpus_records r
   set item = c.original_record->'item',
       detail = c.original_record->'detail',
       text = c.original_record->>'text'
  from corpus_ingest.cleanup_decisions c
 where c.run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff' and c.dataset = 'court_reference'
   and c.issue = 'court_reference_seal_wrong_court'
   and r.dataset = 'court_reference' and r.id = c.record_id;

-- 3. the three seal-only records re-inserted exactly as archived
insert into public.corpus_records
select (jsonb_populate_record(null::public.corpus_records, c.original_record)).*
  from corpus_ingest.cleanup_decisions c
 where c.run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff' and c.dataset = 'court_reference'
   and c.issue = 'court_reference_no_court_spine_id'
on conflict (dataset, id) do nothing;

-- 4. dataset held again, counts and listing totals restored
update public.corpus_datasets d
   set ready = false,
       expected_records = c.n,
       imported_records = c.n,
       metadata = jsonb_set(jsonb_set(jsonb_set(d.metadata, '{ready}', 'false'::jsonb),
                    '{listing,total}', to_jsonb(c.n)), '{listing_modes,default,total}', to_jsonb(c.n)) - 'release_20261027',
       updated_at = now()
  from (select count(*)::bigint as n from public.corpus_records where dataset = 'court_reference') c
 where d.id = 'court_reference';

-- 5. ledger rows removed (they would block a re-apply); the run row records the rollback
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
  if (select imported_records from public.corpus_datasets where id = 'court_reference') <> 253
     or (select count(*) from public.corpus_records where dataset = 'court_reference') <> 253 then
    raise exception 'ROLLBACK POSTFLIGHT: expected 253 records again';
  end if;
  if exists (select 1 from public.corpus_artifacts where route like '/supplement-files/court_reference/%' and ready) then
    raise exception 'ROLLBACK POSTFLIGHT: a seal artifact is still ready';
  end if;
  if (select string_agg(id || '=' || md5(item::text) || md5(detail::text) || md5(text), ',' order by id)
        from public.corpus_records where dataset = 'court_reference'
         and id in ('aoc', 'cbca', 'compliance', 'ilsd', 'mdd', 'nyappdiv'))
     is distinct from
       'aoc=' || 'f6f4d6bf8604b30ea192a725d11a0851' || '54761f62e8f2ee2a839fa78fd171aab0' || 'b9c30fe78895b5056b352ba41e1648cf' || ',' ||
       'cbca=' || '6b7f11755106d3da21ff246c639cc59f' || '648982d736a159887f4230e1b6c14f9d' || '1a14756eaaf43a9e547500c325d4908b' || ',' ||
       'compliance=' || 'e015f25af49bc5315bb604ac9b12ad48' || '4b60564735d0d0590c2d389051c57b7e' || '6c5cf781381c954d2373d339846f03dc' || ',' ||
       'ilsd=' || '26a85010599051ab3d736d308a71d811' || '4984c7540e8f3a8fdcefb99b85e9a7f5' || '6110ae89cd4f5159cb2d372d9d17e0ba' || ',' ||
       'mdd=' || '3bf9c9c885770d7410b4b0a1b2108ac5' || 'b4177322ee56f2b84b6c6898b38c99c6' || '96fde658896969e6f5da7aaa94105f97' || ',' ||
       'nyappdiv=' || '89980b68c7b80473296134a73c05cf52' || 'f2a2f1b86ea41595d5c7b08ec169677a' || '0e4f0253ac3b8b235cd1a8de28d28143' then
    raise exception 'ROLLBACK POSTFLIGHT: the kept-out records were not restored exactly';
  end if;
end $$;

commit;
