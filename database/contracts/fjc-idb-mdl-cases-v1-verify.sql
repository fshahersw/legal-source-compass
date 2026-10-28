-- fjc_idb_mdl_cases v1: read-only before/after verification for the release of the held FJC IDB case rows
-- (owner decision 2026-10-27, "dont withhold any data"). Publication itself is NOT SQL: it runs through
-- scripts/enrichment/corpus_writer.py (publish_jsonl) via scripts/enrichment/fjc_idb/build_fjc_idb_mdl_cases.py.
-- Rollback: database/contracts/fjc-idb-mdl-cases-v1-rollback.sql.
-- Every statement here is a SELECT. Run each block separately with a statement timeout.

-- V1 (before and after): the held source rows, by MDL. Expect 22 MDLs, 405,176 rows, one pinned snapshot, no other review status.
set local statement_timeout = '180s';
select data->>'multidistrict_litigation_docket_number' as mdl, count(*) as rows,
       count(*) filter (where data->>'date_terminated' is null) as pending_in_file,
       count(distinct provenance->>'source_sha256') as snapshots,
       min(data->>'date_filed') as first_filed, max(data->>'date_filed') as last_filed
from corpus_ingest.entities
where source_system = 'courtlistener' and entity_type = 'fjc-integrated-database'
group by 1 order by 2 desc;
-- Measured 2026-10-27: 2885 258,227 | 2738 36,166 | 2592 31,663 | 2789 19,295 | 2846 13,723 | 2641 12,594 | 2570 10,017 |
-- 2545 7,964 | 2782 3,854 | 2804 3,212 | 2606 2,316 | 2924 1,409 | 2873 1,402 | 2100 1,099 | 2921 753 | 2973 469 | 2800 440 |
-- 2323 338 | 2741 117 | 2672 71 | 2843 37 | 2913 10 = 405,176; pending_in_file 333,392; filed 2009-10-01 .. 2021-06-30.

-- V2 (before): nothing published yet, and nothing in the source carries a seal/restriction or a hold.
set local statement_timeout = '120s';
select (select count(*) from public.corpus_datasets where id = 'fjc_idb_mdl_cases') as catalog_rows,          -- expect 0
       (select count(*) from public.corpus_records where dataset = 'fjc_idb_mdl_cases') as records,           -- expect 0
       (select jsonb_object_agg(rs, n) from (select review_status rs, count(*) n from corpus_ingest.entities
          where source_system = 'courtlistener' and entity_type = 'fjc-integrated-database' group by 1) x) as review_status,  -- {"source_metadata": 405176}
       (select count(*) from corpus_ingest.entities where source_system = 'courtlistener' and entity_type = 'fjc-integrated-database'
          and (provenance->>'source_sha256' is distinct from '7615684b31e06199a20f0ecd1424398f4cca0f17fd3797ccd637e0669492d957'
               or provenance->>'source_url' is distinct from 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2')) as other_snapshot,  -- expect 0
       (select count(*) from corpus_ingest.entities where source_system = 'courtlistener' and entity_type = 'fjc-integrated-database'
          and not (data->>'multidistrict_litigation_docket_number' ~ '^0*[1-9][0-9]{0,4}$')) as non_numeric_mdl;  -- expect 0

-- V3 (before): exact docket links the builder will make (CourtListener dockets.idb_data_id + same court + same docket number).
-- Measured 2026-10-27: 185,216 FK matches, all same court; 184,943 also same docket number (the other 273 have a blank
-- CourtListener docket number, so they get no link). No idb_data_id is claimed by two dockets.
set local statement_timeout = '240s';
with f as (select native_id, data->>'district_id' d, data->>'docket_number' dn
           from corpus_ingest.entities where source_system = 'courtlistener' and entity_type = 'fjc-integrated-database'),
     m as (select item->'cells'->>'idb_data_id' idb, item->'cells'->>'court_id' court, item->'cells'->>'docket_number' dn
           from public.corpus_records where dataset = 'cl_docket_metadata')
select count(*) as fk_matches,
       count(*) filter (where m.court = f.d) as same_court,
       count(*) filter (where m.court = f.d
                          and substring(m.dn from '^\d+:(\d{2})-[a-z]{2}-') || lpad(substring(m.dn from '^\d+:\d{2}-[a-z]{2}-0*(\d{1,5})(?:-.*)?$'), 5, '0') = f.dn) as exact_links
from f join m on m.idb = f.native_id;

-- V4 (after publish): counts and readiness. Expect records = 405,176, ready = true, imported = expected = 405,176.
set local statement_timeout = '120s';
select d.id, d.ready, d.expected_records, d.imported_records, d.manifest_sha256,
       (select count(*) from public.corpus_records r where r.dataset = 'fjc_idb_mdl_cases') as records
from public.corpus_datasets d where d.id = 'fjc_idb_mdl_cases';

-- V5 (after publish): per-MDL counts must equal V1, and docket links must equal V3 exact_links (184,943 on 2026-10-27).
set local statement_timeout = '240s';
select item->'profile'->>'mdl' as mdl, count(*) as records,
       count(*) filter (where filters->'docket_linked' ? 'yes') as docket_linked,
       count(*) filter (where filters->'status' ? 'pending') as pending_in_file
from public.corpus_records where dataset = 'fjc_idb_mdl_cases' group by 1 order by 2 desc;

-- V6 (after publish): every record keeps the pinned source, carries the historical evidence label, and links only exact targets.
set local statement_timeout = '240s';
select count(*) filter (where source_url is distinct from 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2') as other_source,  -- expect 0
       count(*) filter (where not (item->'badges' ? 'FJC IDB (historical)')) as missing_evidence_label,                                                     -- expect 0
       count(*) filter (where id <> 'fjc:' || (item->'profile'->>'fjc_id')) as id_mismatch,                                                               -- expect 0
       count(*) filter (where exists (select 1 from jsonb_array_elements(item->'links') l
                                      where l->>'url' like '/matters/%'
                                        and not exists (select 1 from public.corpus_records m where m.dataset = 'mdls' and m.id = item->'profile'->>'mdl'))) as bad_mdl_link,  -- expect 0
       count(*) filter (where exists (select 1 from jsonb_array_elements(item->'links') l
                                      where l->>'url' like '/records/cl_docket_metadata/%'
                                        and not exists (select 1 from public.corpus_records c where c.dataset = 'cl_docket_metadata'
                                                          and c.id = substring(l->>'url' from '^/records/cl_docket_metadata/(.+)$')
                                                          and c.item->'cells'->>'idb_data_id' = r.item->'profile'->>'fjc_id'
                                                          and c.item->'cells'->>'court_id' = r.item->'profile'->>'court_id'))) as bad_docket_link  -- expect 0
from public.corpus_records r where r.dataset = 'fjc_idb_mdl_cases';

-- V7 (after publish): spot check one known row against its source.
select r.title, r.item->'cells' as cells, r.detail->'facts' as facts, e.data
from public.corpus_records r
join corpus_ingest.entities e on e.source_system = 'courtlistener' and e.entity_type = 'fjc-integrated-database'
                             and e.native_id = r.item->'profile'->>'fjc_id'
where r.dataset = 'fjc_idb_mdl_cases' and r.id = 'fjc:23114088';
