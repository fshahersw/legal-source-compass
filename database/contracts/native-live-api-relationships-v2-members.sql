-- Version-anchored native API relationships for CourtListener REST entries/documents/parties/attorneys (mdl-members, 2026-10-03).
-- Same field naming as native-live-api-relationships-v1.sql and the existing 33k-entry graph:
--   docket-entries   : field 'docket' -> dockets ; field 'recap_documents[N].resource_uri' -> recap-documents
--   recap-documents  : field 'docket_entry_id' -> docket-entries ; field 'docket_id' -> dockets
-- Execute as a bounded statement per (:ENTITY_TYPE, :RUN, source ordinal window). Placeholders are substituted by the caller:
--   __RUN__ uuid of the run whose first_run versions are scoped; __LO__/__HI__ ordinal window (exclusive/inclusive);
-- No inference: every edge is a field recorded in the stored source version. Unresolved targets stay target_present=false.

-- (A) docket-entries
with scoped as (
  select v.* from corpus_ingest.entity_versions v
  where v.source_system='courtlistener' and v.entity_type='docket-entries' and v.first_run='__RUN__'::uuid
), ranked as (select *, row_number() over(order by native_id, payload_sha256) as source_ordinal from scoped),
batch as (select * from ranked where source_ordinal > __LO__ and source_ordinal <= __HI__),
edges as (
  select b.source_system, b.entity_type, b.native_id, b.payload_sha256, 'docket'::text as field, 'dockets'::text as to_type,
    substring(b.data->>'docket' from '^https://www[.]courtlistener[.]com/api/rest/v4/dockets/([0-9]+)/$') as to_id
  from batch b
  union all
  select b.source_system, b.entity_type, b.native_id, b.payload_sha256, 'recap_documents['||(a.n-1)||'].resource_uri', 'recap-documents',
    substring(a.d->>'resource_uri' from '^https://www[.]courtlistener[.]com/api/rest/v4/recap-documents/([0-9]+)/$')
  from batch b cross join lateral jsonb_array_elements(case when jsonb_typeof(b.data->'recap_documents')='array' then b.data->'recap_documents' else '[]'::jsonb end) with ordinality a(d, n)
), written as (
  insert into corpus_ingest.relationships(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256, inferred, target_present, run_id)
  select distinct e.source_system, e.entity_type, e.native_id, e.field, e.to_type, e.to_id, e.payload_sha256, false,
    exists(select 1 from corpus_ingest.entities t where t.source_system=e.source_system and t.entity_type=e.to_type and t.native_id=e.to_id and t.review_status<>'quarantined'),
    '__RUN__'::uuid
  from edges e where nullif(e.to_id,'') is not null
  on conflict(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256) do update set target_present=excluded.target_present
  returning to_type, target_present
)
select jsonb_build_object('entity_type','docket-entries','window',jsonb_build_array(__LO__,__HI__),'source_versions',(select count(*) from batch),
  'recorded_field_edges',(select count(*) from edges),'unparsed_nonempty_references',(select count(*) from edges where to_id is null),
  'written_edges',(select count(*) from written),'unresolved_edges',(select count(*) from written where not target_present),'checked_at',now()) as receipt;

-- (B) recap-documents  (execute separately: replace the scoped entity_type)
-- with scoped as (select v.* from corpus_ingest.entity_versions v where v.source_system='courtlistener' and v.entity_type='recap-documents' and v.first_run='__RUN__'::uuid),
-- ranked as (select *, row_number() over(order by native_id, payload_sha256) as source_ordinal from scoped),
-- batch as (select * from ranked where source_ordinal > __LO__ and source_ordinal <= __HI__),
-- edges as (
--   select b.source_system, b.entity_type, b.native_id, b.payload_sha256, 'docket_entry_id'::text as field, 'docket-entries'::text as to_type, b.data->>'docket_entry_id' as to_id from batch b
--   union all select b.source_system, b.entity_type, b.native_id, b.payload_sha256, 'docket_id', 'dockets', b.data->>'docket_id' from batch b)
-- insert into corpus_ingest.relationships(...) as in (A).
