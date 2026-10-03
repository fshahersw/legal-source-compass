-- PREPARED ONLY: execute after root review; no implicit publication.
-- Raw records remain private. Source runs and native identity checksum are frozen.
-- Entry grain; explicit-unsealed document association count is not a total or availability count.
with projection_batch as(select 0::bigint lower_ordinal_exclusive,10000::bigint upper_ordinal_inclusive),pinned as materialized (
 select v.native_id,v.payload_sha256,v.schema_version,v.data,o.source_url,o.source_sha256,o.retrieved_at,
 row_number() over(partition by v.native_id order by o.retrieved_at desc,o.source_url collate "C",v.payload_sha256 collate "C") observation_rank
 from corpus_ingest.entity_versions v join corpus_ingest.observations o using(source_system,entity_type,native_id,payload_sha256)
 where v.source_system='courtlistener' and v.entity_type='docket-entries' and v.schema_version='courtlistener-rest-v4.7/1'
 and o.run_id in('494cfa52-74c5-42ac-a770-80e46b9a3035'::uuid,'377d9b7a-f895-4314-a5bc-98279ec3c2fb'::uuid) and o.source_url~'^https://www[.]courtlistener[.]com/api/rest/v4/docket-entries/[?]'
), latest as materialized (
 select *,substring(data->>'docket' from '^https://www[.]courtlistener[.]com/api/rest/v4/dockets/([0-9]+)/$') native_docket_id from pinned where observation_rank=1
), reviewed as materialized (
 select l.*,e.review_status as entry_review_status,d.review_status as docket_review_status,
 (d.native_id is null or d.schema_version<>'courtlistener-rest-v4.7/1' or d.data->'blocked' is distinct from 'false'::jsonb or (d.data ? 'date_blocked' and d.data->'date_blocked'<>'null'::jsonb)) source_blocked,
 exists(select 1 from jsonb_array_elements(coalesce(l.data->'recap_documents','[]'::jsonb)) x where x->'is_sealed'='true'::jsonb) explicitly_sealed
 from latest l left join corpus_ingest.entities e on e.source_system='courtlistener' and e.entity_type='docket-entries' and e.native_id=l.native_id
 left join corpus_ingest.entities d on d.source_system='courtlistener' and d.entity_type='dockets' and d.native_id=l.native_docket_id
), source_checks as (
 select count(*) source_records,count(*)filter(where source_blocked) source_blocked_entries,count(*)filter(where explicitly_sealed) explicitly_sealed_entries,
 count(*)filter(where native_docket_id not in('4134359','4264145','4270519','5838695','6102388','6224301','6240169','7603829','8408916','14916674','16284915','18753355','65407433','67678440','68222905') or native_docket_id is null) unexpected_native_dockets,
 count(*)filter(where entry_review_status is null or entry_review_status='quarantined' or docket_review_status='quarantined') quarantine_or_missing_sources,
 encode(sha256(convert_to(coalesce(string_agg(native_id||chr(31)||payload_sha256||chr(31)||source_url||chr(31)||to_char(retrieved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||chr(31)||source_sha256,chr(10) order by native_id collate "C"),''),'UTF8')),'hex') source_signature_sha256 from reviewed
), eligible as materialized (
 select r.* from reviewed r where not source_blocked and not explicitly_sealed and native_docket_id in('4134359','4264145','4270519','5838695','6102388','6224301','6240169','7603829','8408916','14916674','16284915','18753355','65407433','67678440','68222905')
 and entry_review_status<>'quarantined' and docket_review_status<>'quarantined'
), ranked as (
 select *,row_number()over(order by native_id collate "C") record_ordinal from eligible
), bounded as (
 select r.* from ranked r cross join projection_batch b where record_ordinal>b.lower_ordinal_exclusive and record_ordinal<=b.upper_ordinal_inclusive
), safe as (
 select b.*,'cl:docket-entries:'||native_id public_id,'Docket entry '||coalesce(nullif(data->>'entry_number',''),native_id) display_title,
 'https://www.courtlistener.com/docket/'||native_docket_id||'/' source_docket_url,
 coalesce((select jsonb_agg(x.id order by x.id collate "C") from(select distinct x->>'id' id from jsonb_array_elements(coalesce(b.data->'recap_documents','[]'::jsonb))x where x->'is_sealed'='false'::jsonb and x->>'id'~'^[0-9]+$')x),'[]'::jsonb) source_unsealed_document_ids,
 case when exists(select 1 from public.corpus_records p join public.corpus_datasets d on d.id=p.dataset and d.ready where p.dataset='cl_docket_metadata' and p.id='cl:dockets:'||b.native_docket_id and p.filters->>'native_id'=b.native_docket_id and p.item->'cells'->>'native_id'=b.native_docket_id)
 then '#record/cl_docket_metadata/cl%3Adockets%3A'||native_docket_id end public_docket_token
 from bounded b
), metadata as (
 select s.*,jsonb_build_object('native_entry_id',native_id,'native_docket_id',native_docket_id,'entry_number',data->'entry_number','date_filed',data->'date_filed','source_unsealed_document_ids',source_unsealed_document_ids,'source_unsealed_document_count',jsonb_array_length(source_unsealed_document_ids),'source_docket_url',source_docket_url) safe_metadata,
 jsonb_build_array(jsonb_build_object('url',source_docket_url,'label','CourtListener source docket'))||case when public_docket_token is not null then jsonb_build_array(jsonb_build_object('url',public_docket_token,'label','Native docket metadata')) else '[]'::jsonb end source_links
 from safe s
), expected as (
 select 'cl_master_entries'::text dataset,public_id id,'master_docket_entry'::text category,null::text state,'{}'::text[]county_geoids,display_title title,source_docket_url source_url,record_ordinal ordinal,
 jsonb_build_object('id',public_id,'title',display_title,'subtitle','Native docket '||native_docket_id,'cells',safe_metadata||jsonb_build_object('name',display_title),'links',jsonb_build_array(jsonb_build_object('url','#record/cl_master_entries/cl%3Adocket-entries%3A'||native_id,'label','Open entry metadata'))||source_links,'badges',jsonb_build_array('Docket entry','Metadata only'))item,
 jsonb_build_object('id',public_id,'title',display_title,'subtitle','Native docket '||native_docket_id,'facts',jsonb_build_array(jsonb_build_array('Native entry ID',native_id),jsonb_build_array('Native docket ID',native_docket_id),jsonb_build_array('Entry number (source)',data->'entry_number'),jsonb_build_array('Filing date (source)',data->'date_filed'),jsonb_build_array('Source-listed unsealed document IDs',source_unsealed_document_ids),jsonb_build_array('Source-listed unsealed document count',jsonb_array_length(source_unsealed_document_ids))),'links',source_links,'sections','[]'::jsonb,'qualification','One source-native docket entry. No descriptions, captions, parties, contacts or document contents are projected. Source-blocked dockets and entries with explicit sealed-document flags are excluded. Document IDs/count include only source-explicit unsealed IDs; unknown seal flags are omitted and the count is not a total-document or availability count. Native source associations do not establish MDL membership, claim disposition or legal outcome. No PDFs were downloaded.','provenance',jsonb_build_object('projection_schema','courtlistener-master-entry-metadata-view/1','schema_version',schema_version,'record_sha256',payload_sha256,'source_url',source_url,'source_sha256',source_sha256,'retrieved_at',retrieved_at))detail,
 jsonb_pretty(safe_metadata)text,jsonb_build_object('_listing','true','native_id',native_id,'native_docket_id',native_docket_id,'source_unsealed_document_count',jsonb_array_length(source_unsealed_document_ids)::text)filters from metadata
),written as(insert into public.corpus_records(dataset,id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters) select x.* from expected x cross join source_checks c where c.source_records=15053 and c.source_blocked_entries=40 and c.explicitly_sealed_entries=66 and c.unexpected_native_dockets=0 and c.quarantine_or_missing_sources=0 and c.source_signature_sha256='3e0ec6816f07b0f675ea00fb4a9649972201d67ae3e620fe35be32657a8560b1' and (select count(*)from eligible)=14947 and exists(select 1 from public.corpus_datasets d where d.id=x.dataset and not d.ready and d.metadata->>'schema_version'='courtlistener-master-entry-metadata-view/1' and d.metadata->>'source_signature_sha256'='3e0ec6816f07b0f675ea00fb4a9649972201d67ae3e620fe35be32657a8560b1') on conflict(dataset,id)do update set category=excluded.category,state=excluded.state,county_geoids=excluded.county_geoids,title=excluded.title,source_url=excluded.source_url,ordinal=excluded.ordinal,item=excluded.item,detail=excluded.detail,text=excluded.text,filters=excluded.filters returning id,ordinal) select jsonb_build_object('source_checks',(select to_jsonb(c)from source_checks c),'eligible_records',(select count(*)from eligible),'expected_batch_records',(select count(*)from expected),'written_records',(select count(*)from written),'min_ordinal',(select min(ordinal)from written),'max_ordinal',(select max(ordinal)from written))receipt;
