-- Read-only checks for court-reference-release/2026-10-27.1. Run before (expect the BEFORE column) and after (expect AFTER).
set local statement_timeout = '30s';

-- V1 dataset flag                                   BEFORE: f | false | 253 | f        AFTER: t | true | 253 | t
select ready, metadata->'ready' as metadata_ready, imported_records, metadata ? 'release_20261027' as has_release_note
  from public.corpus_datasets where id = 'court_reference';

-- V2 seal artifacts                                 BEFORE: 253 | 0 | 253              AFTER: 253 | 252 | 1
select count(*) as artifacts, count(*) filter (where ready) as ready, count(*) filter (where not ready) as held
  from public.corpus_artifacts where route like '/supplement-files/court_reference/%';

-- V2b held seal ids                                 AFTER: ilsd
select string_agg(replace(route, '/supplement-files/court_reference/', ''), ',') as held_ids
  from public.corpus_artifacts where route like '/supplement-files/court_reference/%' and not ready
having count(*) <= 5;

-- V3 stored objects behind the artifacts            BEFORE (no upload): 0 | 253        AFTER: 253 | 0
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

-- V5 records unchanged in number; the 3 ids outside court_spine (expect aoc, cbca, compliance)   BEFORE = AFTER: 253 | 3
select count(*) as records,
       count(*) filter (where not exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = r.id)) as not_in_spine,
       string_agg(r.id, ',') filter (where not exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = r.id)) as ids
  from public.corpus_records r where r.dataset = 'court_reference';

-- V6 ilsd: seal link removed, facts kept            BEFORE: t | 4 facts | 1st md5 26a85010...   AFTER: f | 4 facts | ledger 1
select (item::text || detail::text) like '%/supplement-files/court_reference/ilsd%' as links_held_seal,
       jsonb_array_length(detail->'facts') as facts,
       md5(item::text) as item_md5,
       (select count(*) from corpus_ingest.cleanup_decisions c where c.run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff') as ledger_rows
  from public.corpus_records where dataset = 'court_reference' and id = 'ilsd';

-- V7 no ready record links a held seal              AFTER: 0
select count(*) as records_linking_held_seal
  from public.corpus_records r
  join public.corpus_artifacts a on a.route = '/supplement-files/court_reference/' || r.id and not a.ready
 where r.dataset = 'court_reference'
   and (r.item::text like '%' || a.route || '%' or r.detail::text like '%' || a.route || '%');

-- V8 the dataset now appears in the site's ready catalog query (catalog.reads.server.ts)   AFTER: 1 row
select id, imported_records from public.corpus_datasets where ready = true and id = 'court_reference';
