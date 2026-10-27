-- fjc_idb_civil_cases v1: case-level FJC Integrated Database civil records (release fjc-idb-case-level, 2026-10-27).
--
-- No DDL. The dataset is published by scripts/enrichment/fjc_idb/build_fjc_idb_cases.py --publish (corpus_writer.publish_jsonl),
-- run by the lead. This file holds the read-only dry-run and verification queries; rollback is fjc-idb-civil-cases-v1.rollback.sql.
--
-- Source rows: corpus_ingest.entities (source_system 'courtlistener', entity_type 'fjc-integrated-database'), CourtListener's copy of
-- the FJC civil IDB from fjc-integrated-database-2026-09-30.csv.bz2. Owner decisions: 2026-10-22 (1) FJC IDB permitted, (3) names
-- as the official publisher publishes them; 2026-10-27 "dont withhold any data". Nothing is held: the IDB has no seal or restriction
-- flag. Dry run on 2026-10-27 (read-only SELECTs below): 405,176 entities -> 405,176 records.

-- 1. Before: source count (expect 405176) and target count (expect 0, dataset absent).
set local statement_timeout = '120s';
select count(*) as source_entities
from corpus_ingest.entities
where source_system = 'courtlistener' and entity_type = 'fjc-integrated-database';

select count(*) as target_records from public.corpus_records where dataset = 'fjc_idb_civil_cases';
select id, ready, expected_records, imported_records from public.corpus_datasets where id = 'fjc_idb_civil_cases';

-- 2. Dry-run projection counts (mirror of idb_case_level.project; 2026-10-27 result in the trailing comment).
set local statement_timeout = '240s';
with dk as (
  select item -> 'cells' ->> 'idb_data_id' as idb, count(*) as n
  from public.corpus_records
  where dataset = 'cl_docket_metadata' and item -> 'cells' ->> 'idb_data_id' is not null
  group by 1),
ds as (select id, state from public.corpus_records where dataset = 'fjc_civil_districts'),
p as (
  select coalesce(e.data ->> 'date_terminated', '') <> '' as term, e.data ->> 'disposition' as disp,
         e.data ->> 'class_action' as ca, dk.n as dkn, e.data ->> 'dataset_source' as src, ds.state, e.data ->> 'judgment' as judg,
         (coalesce(e.data ->> 'date_transfer', '') <> '' or coalesce(e.data ->> 'transfer_office', '') <> ''
          or coalesce(e.data ->> 'transfer_docket_number', '') <> '' or coalesce(e.data ->> 'transfer_origin', '') <> '') as tr
  from corpus_ingest.entities e
  left join dk on dk.idb = e.native_id
  left join ds on ds.id = e.data ->> 'district_id'
  where e.source_system = 'courtlistener' and e.entity_type = 'fjc-integrated-database')
select count(*) as records,
       count(*) filter (where not term) as pending,
       count(*) filter (where term) as terminated,
       count(*) filter (where term and disp in ('2', '3', '12', '13', '14')) as dismissed,
       count(*) filter (where term and disp in ('4', '5', '6', '7', '8', '9', '15', '16', '17', '18', '19', '20')) as judgment,
       count(*) filter (where term and disp in ('0', '1', '10', '11')) as transferred_remanded,
       count(*) filter (where ca in ('t', 'true', '1')) as class_action_yes,
       count(*) filter (where dkn = 1) as linked_docket,
       count(*) filter (where dkn > 1) as ambiguous_link,
       count(*) filter (where tr) as transfer_recorded,
       count(*) filter (where coalesce(state, '') = '') as state_blank,
       count(*) filter (where term and coalesce(judg, '') not in ('1', '2', '3', '4')) as judgment_not_recorded_terminated
from p;
-- 2026-10-27: records 405176, pending 333392, terminated 71784, dismissed 65393, judgment 2387, transferred_remanded 4004,
-- class_action_yes 727, linked_docket 185216, ambiguous_link 0, transfer_recorded 506, state_blank 0,
-- judgment_not_recorded_terminated 70640 (JUDGMENT code 0, not in the codebook table: shown "Not recorded (code 0)").

-- 3. After publish: counts must match (405176 = 405176), dataset ready, every record has a source URL and the MDL label.
set local statement_timeout = '240s';
select (select count(*) from public.corpus_records where dataset = 'fjc_idb_civil_cases') as published,
       (select count(*) from corpus_ingest.entities
         where source_system = 'courtlistener' and entity_type = 'fjc-integrated-database') as source_entities;

select id, ready, expected_records, imported_records, manifest_sha256
from public.corpus_datasets where id = 'fjc_idb_civil_cases';

select count(*) filter (where coalesce(source_url, '') = '') as no_source_url,
       count(*) filter (where not (item -> 'badges') ? 'FJC IDB (historical)') as no_mdl_label,
       count(*) filter (where filters -> 'linked_docket' = '["yes"]'::jsonb) as linked_docket,
       count(*) filter (where filters -> 'status' = '["pending"]'::jsonb) as pending
from public.corpus_records where dataset = 'fjc_idb_civil_cases';
-- expect no_source_url 0, no_mdl_label 0, linked_docket 185216, pending 333392

-- 4. Spot check: a known terminated record decodes from the codebook (CourtListener FJC record 24342848, MDL 2545, jury verdict).
select id, title, detail -> 'facts' from public.corpus_records where dataset = 'fjc_idb_civil_cases' and id = 'idb:24342848';
