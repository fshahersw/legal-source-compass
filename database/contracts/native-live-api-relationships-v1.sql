-- Version-anchored native API relationships, corpus-native-api-fields/1.
-- Original native payloads remain private. JSON array paths distinguish source associations.
-- A query docket is never substituted for an association's actual docket.
-- Field edge counts are observations, not deduplicated legal representations or MDL membership.
-- Missing targets remain explicitly unresolved. All parsed resource endpoints are exact v4 paths.
-- This example executes only the 105 live API docket versions; equivalent bounded plans
-- for entries/documents/party/attorney associations are recorded in the verified receipts.

with scoped_versions as (
 select v.* from corpus_ingest.entity_versions v
 where v.source_system='courtlistener' and v.entity_type='dockets' and v.schema_version='courtlistener-rest-v4.7/1'
 and exists(select 1 from corpus_ingest.observations o where o.run_id='494cfa52-74c5-42ac-a770-80e46b9a3035'::uuid and o.source_system=v.source_system and o.entity_type=v.entity_type and o.native_id=v.native_id and o.payload_sha256=v.payload_sha256 and o.source_url like 'https://www.courtlistener.com/api/rest/v4/%')
), ranked as (select *,row_number() over(order by native_id,payload_sha256) as source_ordinal from scoped_versions),
batch as (select * from ranked where source_ordinal>0 and source_ordinal<=105),
native_edges as (select b.*,r.field,r.to_type,r.value,'resource'::text as kind from batch b cross join lateral (values ('court','courts',b.data->>'court'),('assigned_to','people',b.data->>'assigned_to'),('referred_to','people',b.data->>'referred_to'),('parent_docket','dockets',b.data->>'parent_docket'),('appeal_from','courts',b.data->>'appeal_from')) r(field,to_type,value) where nullif(r.value,'') is not null
 union all select b.*,'panel['||(a.n-1)||']','people',a.value,'resource' from batch b cross join lateral jsonb_array_elements_text(case when jsonb_typeof(b.data->'panel')='array' then b.data->'panel' else '[]'::jsonb end) with ordinality a(value,n)
 union all select b.*,'clusters['||(a.n-1)||']','clusters',a.value,'resource' from batch b cross join lateral jsonb_array_elements_text(case when jsonb_typeof(b.data->'clusters')='array' then b.data->'clusters' else '[]'::jsonb end) with ordinality a(value,n)),
parsed as (select *,case when kind='native' and value ~ '^[0-9]+$' then value when kind='resource' then substring(value from '^https://www[.]courtlistener[.]com/api/rest/v4/'||to_type||'/([A-Za-z0-9_-]+)/$') end as to_id from native_edges),
written as (
 insert into corpus_ingest.relationships(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256,inferred,target_present,run_id)
 select distinct source_system,entity_type,native_id,field,to_type,to_id,payload_sha256,false,
 exists(select 1 from corpus_ingest.entities t where t.source_system=p.source_system and t.entity_type=p.to_type and t.native_id=p.to_id and t.review_status<>'quarantined'),'494cfa52-74c5-42ac-a770-80e46b9a3035'::uuid
 from parsed p where nullif(to_id,'') is not null
 on conflict(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256) do update set target_present=excluded.target_present
 returning from_type,field,to_type,target_present
)
select jsonb_build_object('entity_type','dockets','lower_source_ordinal_exclusive',0,'upper_source_ordinal_inclusive',105,'source_versions',(select count(*) from batch),'recorded_field_edges',(select count(*) from native_edges),'unparsed_nonempty_references',(select count(*) from parsed where nullif(value,'') is not null and to_id is null),'written_edges',(select count(*) from written),'unresolved_edges',(select count(*) from written where not target_present),'by_target',(select jsonb_agg(to_jsonb(q)) from (select to_type,count(*) as edges,count(*) filter(where not target_present) as unresolved from written group by to_type) q),'checked_at',now()) receipt;
