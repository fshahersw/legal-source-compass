-- Privacy-safe public docket projection, courtlistener-docket-metadata-view/1.
-- Prepared administrative contract; never run from the application/client.
-- Raw versions, party records and captions remain PRIVATE.
-- Source selection is pinned to exact September 30 observation hashes and approved native IDs.
-- No filename/title keyword selection, inferred MDL membership, or PDF acquisition occurs.
-- State is deliberately null: court location does not establish governing case jurisdiction.

-- STEP 3: independent bounded reconciliation of EVERY public field, including full JSON provenance.
-- Do not publish after a count-only comparison. Use the SAME frozen source/run across all batches.
-- Root must retain each receipt; mismatched fields may not be ignored as cosmetic.
with projection_batch as (
 select 0::bigint as lower_ordinal_exclusive,10000::bigint as upper_ordinal_inclusive
), bulk as (
 select v.native_id,v.payload_sha256,v.schema_version,v.data,
 o.source_url,o.source_sha256,o.source_as_of,o.retrieved_at,o.provenance
 from corpus_ingest.entity_versions v join corpus_ingest.observations o using(source_system,entity_type,native_id,payload_sha256)
 where v.source_system='courtlistener' and v.entity_type='dockets' and v.schema_version='courtlistener-bulk/1'
 and o.run_id='494cfa52-74c5-42ac-a770-80e46b9a3035'::uuid and o.source_as_of=date '2026-09-30'
 and o.source_url='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-2026-09-30.csv.bz2'
 and o.source_sha256='f40588851cee0d95696c40b8740106473f83ea3ffd8745799e03c42a15b9399b'
), fjc as (
 select v.native_id,v.payload_sha256,v.schema_version,v.data,
 o.source_url,o.source_sha256,o.source_as_of,o.retrieved_at
 from corpus_ingest.entity_versions v join corpus_ingest.observations o using(source_system,entity_type,native_id,payload_sha256)
 where v.source_system='courtlistener' and v.entity_type='fjc-integrated-database' and v.schema_version='courtlistener-bulk/1'
 and o.run_id='494cfa52-74c5-42ac-a770-80e46b9a3035'::uuid and o.source_as_of=date '2026-09-30'
 and o.source_url='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2'
 and o.source_sha256='7615684b31e06199a20f0ecd1424398f4cca0f17fd3797ccd637e0669492d957'
), prepared as (
 select b.*,e.data as metadata_data,e.schema_version as metadata_schema_version,
 e.payload_sha256 as metadata_payload_sha256,e.provenance as metadata_provenance,
 e.source_as_of as metadata_source_as_of,e.retrieved_at as metadata_retrieved_at,
 case when e.schema_version='courtlistener-rest-v4.7/1'
 then substring(e.data->>'court' from '^https://www[.]courtlistener[.]com/api/rest/v4/courts/([A-Za-z0-9_-]+)/$')
 else e.data->>'court_id' end as court_id,
 f.native_id as fjc_native_id,f.payload_sha256 as fjc_payload_sha256,f.schema_version as fjc_schema_version,
 f.source_url as fjc_source_url,f.source_sha256 as fjc_source_sha256,
 f.source_as_of as fjc_source_as_of,f.retrieved_at as fjc_retrieved_at,
 case when f.data->>'multidistrict_litigation_docket_number'~'^[0-9]+$'
 and f.data->>'multidistrict_litigation_docket_number'~'[1-9]'
 then f.data->>'multidistrict_litigation_docket_number' end as mdl_number_raw,
 coalesce((select jsonb_agg(x.value order by x.value)
 from jsonb_array_elements_text(case when jsonb_typeof(b.provenance->'selection_reasons')='array'
 then b.provenance->'selection_reasons' else '[]'::jsonb end)x(value)
 where x.value in('saved_native_docket_id','native_idb_fk_with_explicit_mdl_number')),'[]'::jsonb)as approved_selection_reasons
 from bulk b join corpus_ingest.entities e
 on e.source_system='courtlistener' and e.entity_type='dockets' and e.native_id=b.native_id
 left join fjc f on f.native_id=b.data->>'idb_data_id'
 where e.review_status<>'quarantined'
 and lower(coalesce(b.data->>'blocked','')) in('false','f','0')
 and coalesce(b.data->>'date_blocked','')=''
 and lower(coalesce(e.data->>'blocked','false')) in('false','f','0')
 and coalesce(e.data->>'date_blocked','')=''
), eligible as (
 select p.*,ltrim(p.mdl_number_raw,'0')as mdl_number
 from prepared p where (
 p.approved_selection_reasons ? 'saved_native_docket_id'
 or (p.approved_selection_reasons ? 'native_idb_fk_with_explicit_mdl_number'
 and p.mdl_number_raw is not null))
 and nullif(p.court_id,'') is not null
 and not exists(select 1 from corpus_ingest.entities qc where qc.source_system='courtlistener'
 and qc.entity_type='courts' and qc.review_status='quarantined'
 and qc.native_id in(p.court_id,p.data->>'court_id'))
), ranked as (
 select *,row_number() over(order by native_id collate "C")as record_ordinal from eligible
), bounded as (
 select r.* from ranked r cross join projection_batch b
 where r.record_ordinal>b.lower_ordinal_exclusive and r.record_ordinal<=b.upper_ordinal_inclusive
 and b.lower_ordinal_exclusive>=0 and b.upper_ordinal_inclusive>b.lower_ordinal_exclusive
 and b.upper_ordinal_inclusive-b.lower_ordinal_exclusive<=10000
), safe as (
 select b.*,'cl:dockets:'||native_id as public_id,
 'Docket '||coalesce(nullif(metadata_data->>'docket_number',''),native_id)as display_title,
 jsonb_build_object('native_id',native_id,'docket_number',metadata_data->>'docket_number',
 'court_id',court_id,'date_filed',metadata_data->>'date_filed',
 'date_terminated',metadata_data->>'date_terminated','date_last_filing',metadata_data->>'date_last_filing',
 'date_created',metadata_data->>'date_created','date_modified',metadata_data->>'date_modified',
 'idb_data_id',data->>'idb_data_id','mdl_number',mdl_number,'mdl_number_raw',mdl_number_raw,
 'source_as_of',source_as_of::text)as safe_metadata,
 jsonb_build_object('projection_schema','courtlistener-docket-metadata-view/1',
 'selection_source',jsonb_build_object('schema_version',schema_version,'payload_sha256',payload_sha256,
 'source_url',source_url,'source_sha256',source_sha256,'source_as_of',source_as_of::text,
 'retrieved_at',retrieved_at::text,'selection_reasons',approved_selection_reasons),
 'metadata_source',jsonb_build_object('schema_version',metadata_schema_version,'payload_sha256',metadata_payload_sha256,
 'source_url',metadata_provenance->>'source_url','source_sha256',metadata_provenance->>'source_sha256',
 'source_as_of',metadata_source_as_of::text,'retrieved_at',metadata_retrieved_at::text),
 'fjc_source',case when fjc_native_id is not null then jsonb_build_object('native_id',fjc_native_id,
 'schema_version',fjc_schema_version,'payload_sha256',fjc_payload_sha256,'source_url',fjc_source_url,
 'source_sha256',fjc_source_sha256,'source_as_of',fjc_source_as_of::text,'retrieved_at',fjc_retrieved_at::text)else null end
 )as safe_provenance,
 jsonb_build_array(jsonb_build_object('url','https://www.courtlistener.com/docket/'||native_id||'/','label','CourtListener native docket'),
 jsonb_build_object('url',source_url,'label','Original docket metadata snapshot'))
 ||case when fjc_native_id is not null then jsonb_build_array(jsonb_build_object('url',fjc_source_url,'label','Original FJC metadata snapshot'))else '[]'::jsonb end as source_links
 from bounded b
), expected as (
 select 'cl_docket_metadata'::text as dataset,public_id as id,'docket_metadata'::text as category,
 null::text as state,'{}'::text[]as county_geoids,display_title as title,source_url,record_ordinal as ordinal,
 jsonb_build_object('id',public_id,'title',display_title,'subtitle','Native docket metadata · snapshot '||source_as_of::text,
 'cells',safe_metadata||jsonb_build_object('name',display_title),'links',source_links,
 'badges',jsonb_build_array('Metadata only',case when mdl_number is null then 'Saved native docket'else 'FJC source association'end))as item,
 jsonb_build_object('id',public_id,'title',display_title,'subtitle','Dated native metadata',
 'facts',jsonb_build_array(jsonb_build_array('Native docket ID',native_id),
 jsonb_build_array('Docket number',metadata_data->>'docket_number'),jsonb_build_array('Court ID',court_id),
 jsonb_build_array('Filed (source)',metadata_data->>'date_filed'),
 jsonb_build_array('Terminated (source)',metadata_data->>'date_terminated'),
 jsonb_build_array('Native FJC record ID',data->>'idb_data_id'),
 jsonb_build_array('FJC MDL number (as recorded)',mdl_number_raw),
 jsonb_build_array('Selection snapshot date',source_as_of::text)),
 'provenance',safe_provenance,'links',source_links,'sections','[]'::jsonb,
 'qualification','Metadata only, selected by exact saved native docket IDs or a native FJC foreign key with an explicit positive MDL number. FJC MDL numbers are dated source associations, not a current member-case census, master designation, transfer ruling, claim determination or legal outcome. Unconfirmed candidate and source-blocked records are excluded. Captions, names, party contacts, causes and document contents remain private; no PDFs were downloaded.')as detail,
 jsonb_pretty(safe_metadata)as text,
 jsonb_build_object('_listing','true','native_id',native_id,'court_id',court_id,
 'mdl_number',coalesce(mdl_number,''),'idb_data_id',coalesce(data->>'idb_data_id',''),
 'source_as_of',source_as_of::text,'selection_basis',case when approved_selection_reasons ? 'native_idb_fk_with_explicit_mdl_number'
 then 'native_fjc_mdl_number'else 'saved_native_docket_id'end)as filters
 from safe
) ,compared as(
select x.ordinal,x.id,
r.id is not null as present,
r.id is not null and ROW(r.dataset,r.id,r.category,r.state,r.county_geoids,r.title,r.source_url,r.ordinal,r.item,r.detail,r.text,r.filters)
IS NOT DISTINCT FROM ROW(x.dataset,x.id,x.category,x.state,x.county_geoids,x.title,x.source_url,x.ordinal,x.item,x.detail,x.text,x.filters)as exact_match,
encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex')as expected_row_sha256,
case when r.id is not null then encode(sha256(convert_to(jsonb_build_object(
'dataset',r.dataset,'id',r.id,'category',r.category,'state',r.state,'county_geoids',r.county_geoids,
'title',r.title,'source_url',r.source_url,'ordinal',r.ordinal,'item',r.item,'detail',r.detail,'text',r.text,'filters',r.filters)::text,'UTF8')),'hex')end as actual_row_sha256
from expected x left join public.corpus_records r on r.dataset=x.dataset and r.id=x.id
), checks as(
select (select count(*)from eligible)as eligible_records,
(select expected_records from public.corpus_datasets where id='cl_docket_metadata')as registered_expected_records,
(select count(*)from public.corpus_records where dataset='cl_docket_metadata')as public_records,
count(*)as batch_records,count(*)filter(where not present)as missing_records,
count(*)filter(where not exact_match)as mismatched_records,
(select count(*)from public.corpus_records r cross join projection_batch b where r.dataset='cl_docket_metadata'
and r.ordinal>b.lower_ordinal_exclusive and r.ordinal<=b.upper_ordinal_inclusive
and not exists(select 1 from expected x where x.id=r.id and x.ordinal=r.ordinal))as unexpected_batch_records,
encode(sha256(convert_to(coalesce(string_agg(expected_row_sha256,E'\n' order by ordinal),''),'UTF8')),'hex')as expected_full_fields_sha256,
encode(sha256(convert_to(coalesce(string_agg(actual_row_sha256,E'\n' order by ordinal),''),'UTF8')),'hex')as actual_full_fields_sha256
from compared
)
select jsonb_build_object('contract_version','courtlistener-docket-metadata-view/1',
'lower_ordinal_exclusive',(select lower_ordinal_exclusive from projection_batch),
'upper_ordinal_inclusive',(select upper_ordinal_inclusive from projection_batch),
'checks',(select to_jsonb(c)from checks c),
'mismatched_native_ids',(select coalesce(jsonb_agg(id),'[]'::jsonb)from(select id from compared where not exact_match order by ordinal limit 10)q),
'verified',(select eligible_records=registered_expected_records and batch_records>0 and missing_records=0 and mismatched_records=0
and unexpected_batch_records=0 and expected_full_fields_sha256=actual_full_fields_sha256 from checks),
'checked_at',now())as receipt;
