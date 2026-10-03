-- Aggregate only. No names, captions, contacts, raw payloads or credentials.
with mdl_values as (
 select native_id,substring(trim(data->>'multidistrict_litigation_docket_number') from '^(?:MDL[ -]*)?0*([0-9]+)$') mdl
 from corpus_ingest.entities
 where source_system='courtlistener' and entity_type='fjc-integrated-database'
), docket_idb as (
 select distinct d.native_id docket_id,f.mdl
 from corpus_ingest.entity_versions d
 join mdl_values f on f.native_id=d.data->>'idb_data_id'
 where d.source_system='courtlistener' and d.entity_type='dockets'
)
select jsonb_build_object(
 'captured_at',now(),
 'entities',(select jsonb_agg(x) from (
  select source_system,entity_type,count(*)::integer records from corpus_ingest.entities group by 1,2 order by 1,2)x),
 'counts',jsonb_build_object(
  'canonicalEntities',(select count(*) from corpus_ingest.entities),
  'sourceRecords',(select count(*) from corpus_ingest.observations),
  'sourceVersions',(select count(*) from corpus_ingest.entity_versions),
  'observations',(select count(*) from corpus_ingest.observations),
  -- Historical aliases above remain HTTP-table observations. Local file rows
  -- have a separate grain and retain original file SHA plus occurrence ordinal.
  'httpSourceObservations',(select count(*) from corpus_ingest.observations),
  'localFileOccurrences',(select count(*) from corpus_ingest.local_observations),
  'nativeRelationships',(select count(*) from corpus_ingest.relationships),
  -- nativeRelationships is the historical total, including local pointers.
  'sourceRecordedRelationships',(select count(*) from corpus_ingest.relationships where source_system not in ('local-sw-catalog','local-vaquill-open-us-law','local-source-registry')),
  'localPointerRelationships',(select count(*) from corpus_ingest.relationships where source_system in ('local-sw-catalog','local-vaquill-open-us-law','local-source-registry')),
  'pdfDownloads',0),
 'mdls',(select jsonb_agg(x) from (
  select m.mdl,count(*)::integer administrative_records,(select count(*)::integer from docket_idb d where d.mdl=m.mdl) native_docket_links
  from mdl_values m where m.mdl is not null group by m.mdl order by m.mdl)x),
 'master_entries',(select jsonb_agg(x) from (
  select substring(data->>'docket' from '/dockets/([0-9]+)/') native_docket_id,count(*)::integer records
  from corpus_ingest.entities where source_system='courtlistener' and entity_type='docket-entries'
  group by 1)x),
 'public_docket_counts',(select jsonb_agg(x) from (
  select filters->>'mdl_number' mdl,count(*)::integer records from public.corpus_records where dataset='cl_docket_metadata' group by 1)x),
 'public_datasets',(select jsonb_agg(x) from (
  select id,ready,expected_records,imported_records from public.corpus_datasets
  where id in ('cl_courts','cl_courthouses','cl_court_appeals_to','cl_people','cl_positions','cl_educations','cl_schools','cl_docket_metadata','cl_master_entries','cl_reporter_citations','cl_citation_edges','statutory_limitations_review','mass_tort_authority_evidence','jpml_html_reference','regulatory_backfill','ecfr_hierarchy','ecfr_authority_notes','agency_safety_openfda_device_classification_20261002','agency_safety_openfda_device_enforcement_20260928','agency_safety_openfda_drug_enforcement_20260928','agency_safety_openfda_device_recalls_20261002') order by id)x),
 'document_availability',(select jsonb_build_object('records',count(*),'available',count(*)filter(where data->>'is_available'='true'),'unavailable',count(*)filter(where data->>'is_available'='false'),'unknown',count(*)filter(where data->>'is_available' is null or data->>'is_available' not in ('true','false'))) from corpus_ingest.entities where source_system='courtlistener' and entity_type='recap-documents'),
 'profiles',(select jsonb_agg(x) from (
  select id,title from public.corpus_records where dataset='mdls' and id in ('2100','2545','2570','2592','2606','2641','2782','2789','2804','2846','2873','2885','2913','2973','3047','3081','3094'))x),
 'relationships',(select jsonb_agg(x) from (
  select source_system,from_type,to_type,count(*)::integer records,count(*) filter(where not target_present)::integer unresolved,count(*) filter(where inferred)::integer source_inferred
  from corpus_ingest.relationships group by 1,2,3 order by 1,2,3)x),
 'mapped_categories',(select count(*) from corpus_ingest.category_map),
 'unmapped_categories',(select jsonb_agg(category) from (
  select distinct r.category from public.corpus_records r left join corpus_ingest.category_map m on m.native_category=r.category where m.native_category is null)x)
) receipt;
