-- Read-only checks for court-reference-release/2026-10-27.3. Run before (expect the BEFORE column) and after (expect AFTER).
-- BEFORE values were read from production on 2026-10-27 (read-only); see private/acq/release-dataset-court-reference-seals/.
set local statement_timeout = '30s';

-- V1 dataset flag                                   BEFORE: f | false | 253 | 253 | 253 | f      AFTER: t | true | 250 | 250 | 250 | t
select ready, metadata->'ready' as metadata_ready, expected_records, imported_records,
       metadata->'listing'->'total' as listing_total, metadata ? 'release_20261027' as has_release_note
  from public.corpus_datasets where id = 'court_reference';

-- V2 seal artifacts                                 BEFORE: 253 | 0 | 253              AFTER: 253 | 247 | 6
select count(*) as artifacts, count(*) filter (where ready) as ready, count(*) filter (where not ready) as held
  from public.corpus_artifacts where route like '/supplement-files/court_reference/%';

-- V2b held seal ids                                 AFTER: aoc,cbca,compliance,ilsd,mdd,nyappdiv
select string_agg(replace(route, '/supplement-files/court_reference/', ''), ',' order by route) as held_ids
  from public.corpus_artifacts where route like '/supplement-files/court_reference/%' and not ready
having count(*) <= 10;

-- V3 stored objects behind the artifacts            BEFORE (no upload): 0 | 253        AFTER upload: 253 | 0
select count(o.name) filter (where (o.metadata->>'size')::bigint = a.bytes) as stored_with_recorded_size,
       count(*) filter (where o.name is null) as missing
  from public.corpus_artifacts a
  left join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = a.object_key
 where a.route like '/supplement-files/court_reference/%';

-- V4 every READY artifact has its object            AFTER: 0
select count(*) as ready_without_object
  from public.corpus_artifacts a
 where a.route like '/supplement-files/court_reference/%' and a.ready
   and not exists (select 1 from storage.objects o where o.bucket_id = 'corpus-originals' and o.name = a.object_key
                     and (o.metadata->>'size')::bigint = a.bytes);

-- V5 records and the ids outside court_spine        BEFORE: 253 | 3 | aoc,cbca,compliance     AFTER: 250 | 0 | null
select count(*) as records,
       count(*) filter (where not exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = r.id)) as not_in_spine,
       string_agg(r.id, ',' order by r.id) filter (where not exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = r.id)) as ids
  from public.corpus_records r where r.dataset = 'court_reference';

-- V6 wrong-seal records: seal link removed, facts kept
--   BEFORE: ilsd t 4 | mdd t 3 | nyappdiv t 3, ledger 0        AFTER: ilsd f 4 | mdd f 3 | nyappdiv f 3, ledger 1 each
select r.id,
       (r.item::text || r.detail::text) like '%/supplement-files/court_reference/%' as links_held_seal,
       jsonb_array_length(r.detail->'facts') as facts,
       (select count(*) from corpus_ingest.cleanup_decisions c
         where c.run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff' and c.record_id = r.id) as ledger_rows
  from public.corpus_records r where r.dataset = 'court_reference' and r.id in ('ilsd', 'mdd', 'nyappdiv') order by r.id;

-- V6b archived seal-only records                    BEFORE: 0 | 0      AFTER: 3 | 3 (complete rows in the ledger, none live)
select (select count(*) from corpus_ingest.cleanup_decisions
         where run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff' and issue = 'court_reference_no_court_spine_id'
           and original_record->>'id' = record_id and original_record ? 'item' and original_record ? 'text') as archived,
       3 - (select count(*) from public.corpus_records where dataset = 'court_reference' and id in ('aoc', 'cbca', 'compliance')) as removed_live;

-- V7 no record links a held seal                    BEFORE: 253 (all held)  AFTER: 0
select count(*) as records_linking_held_seal
  from public.corpus_records r
  join public.corpus_artifacts a on a.route = '/supplement-files/court_reference/' || r.id and not a.ready
 where r.dataset = 'court_reference'
   and (r.item::text like '%' || a.route || '%' or r.detail::text like '%' || a.route || '%');

-- V8 the dataset now appears in the site's ready catalog query (catalog.reads.server.ts)   BEFORE: 0 rows  AFTER: 1 row
select id, imported_records from public.corpus_datasets where ready = true and id = 'court_reference';

-- V9 release-plan gate: ids not in court_spine      BEFORE: 3   AFTER: 0
select count(*) from public.corpus_records r
 where r.dataset = 'court_reference'
   and not exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = r.id);

-- V10 run and ledger                                BEFORE: 0 | 0      AFTER: 1 | 6
select (select count(*) from corpus_ingest.runs where id = 'c36e2186-fb92-42bb-8632-4bd599772cff') as run_rows,
       (select count(*) from corpus_ingest.cleanup_decisions where run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff') as ledger_rows;
