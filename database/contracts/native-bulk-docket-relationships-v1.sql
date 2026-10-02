-- Version-anchored native bulk docket graph, corpus-native-docket-fields/1.
-- Private metadata only. Run AFTER all 187,900 September 30 source observations reconcile.
-- Change only the two projection_batch bounds; <=10,000 source versions per transaction.
-- Each relationship cites the EXACT bulk payload SHA, even if a newer API version is canonical.
-- Criminal parent_docket_id is a native criminal/superseding relation, NEVER MDL membership.
-- Raw FJC MDL numbers remain source fields. No JPML entity is fabricated from a number.
-- Missing target records are retained as unresolved native references.
-- No public records, source versions, captions, or contacts are changed.

with projection_batch as (
 select 0::bigint as lower_ordinal_exclusive,10000::bigint as upper_ordinal_inclusive
), source_scope as (
 select o.source_system,o.entity_type,o.native_id,o.payload_sha256
 from corpus_ingest.observations o
 join corpus_ingest.entity_versions v using(source_system,entity_type,native_id,payload_sha256)
 where o.run_id='494cfa52-74c5-42ac-a770-80e46b9a3035'::uuid
 and o.source_system='courtlistener' and o.entity_type='dockets'
 and o.source_as_of=date '2026-09-30' and v.schema_version='courtlistener-bulk/1'
 and o.source_url='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-2026-09-30.csv.bz2'
 and o.source_sha256='f40588851cee0d95696c40b8740106473f83ea3ffd8745799e03c42a15b9399b'
), ranked as (
 select *,row_number() over(order by native_id collate "C",payload_sha256 collate "C") as source_ordinal from source_scope
), batch as (
 select r.*,v.data from ranked r join corpus_ingest.entity_versions v using(source_system,entity_type,native_id,payload_sha256)
 cross join projection_batch b
 where r.source_ordinal>b.lower_ordinal_exclusive and r.source_ordinal<=b.upper_ordinal_inclusive
 and b.lower_ordinal_exclusive>=0 and b.upper_ordinal_inclusive>b.lower_ordinal_exclusive
 and b.upper_ordinal_inclusive-b.lower_ordinal_exclusive<=10000
), native_fields as (
 select b.source_system,b.entity_type,b.native_id,b.payload_sha256,b.source_ordinal,x.*
 from batch b cross join lateral (values
 ('court_id','courts',b.data->>'court_id','court'),
 ('appeal_from_id','courts',b.data->>'appeal_from_id','court'),
 ('assigned_to_id','people',b.data->>'assigned_to_id','numeric'),
 ('referred_to_id','people',b.data->>'referred_to_id','numeric'),
 ('idb_data_id','fjc-integrated-database',b.data->>'idb_data_id','numeric'),
 ('originating_court_information_id','originating-court-information',b.data->>'originating_court_information_id','numeric'),
 ('parent_docket_id','dockets',b.data->>'parent_docket_id','numeric')
 )x(field,to_type,to_id,id_kind) where nullif(x.to_id,'') is not null
), parsed as (
 select *,case when id_kind='numeric' then to_id~'^[0-9]+$' else to_id~'^[A-Za-z0-9_-]+$' end as native_id_valid
 from native_fields
), written as (
 insert into corpus_ingest.relationships(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256,inferred,target_present,run_id)
 select p.source_system,p.entity_type,p.native_id,p.field,p.to_type,p.to_id,p.payload_sha256,false,
 exists(select 1 from corpus_ingest.entities t where t.source_system=p.source_system and t.entity_type=p.to_type and t.native_id=p.to_id and t.review_status<>'quarantined'),
 '494cfa52-74c5-42ac-a770-80e46b9a3035'::uuid
 from parsed p where p.native_id_valid
 and not exists(select 1 from parsed q where not q.native_id_valid)
 on conflict(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256)
 do update set target_present=excluded.target_present,run_id=excluded.run_id
 returning field,to_type,target_present
)
select jsonb_build_object(
 'contract_version','corpus-native-docket-fields/1',
 'lower_ordinal_exclusive',(select lower_ordinal_exclusive from projection_batch),
 'upper_ordinal_inclusive',(select upper_ordinal_inclusive from projection_batch),
 'source_versions',(select count(*) from batch),
 'source_identity_ordinal_sha256',(select encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(native_id,payload_sha256,source_ordinal)::text,E'\n' order by source_ordinal),''),'UTF8')),'hex') from batch),
 'native_field_edges',(select count(*) from parsed),
 'unparsed_nonempty_references',(select count(*) from parsed where not native_id_valid),
 'written_edges',(select count(*) from written),
 'unresolved_edges',(select count(*) from written where not target_present),
 'by_field',(select jsonb_agg(to_jsonb(q)) from(select field,to_type,count(*)as edges,count(*)filter(where not target_present)as unresolved from written group by field,to_type order by field)q),
 'checked_at',now())as receipt;
