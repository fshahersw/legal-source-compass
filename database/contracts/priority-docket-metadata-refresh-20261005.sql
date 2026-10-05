-- Existing public metadata only; no member, caption, party, publication or PDF changes.
-- Raw API versions and observations were ingested by the native registry contract.
-- This run checked 41 exact court+docket identities; four source-blocked records
-- remain private. 34 already-published docket metadata rows are eligible here.
-- The cleanup ledger retains full before-images. Reruns never overwrite those.
begin;
create temporary table priority_refresh on commit drop as
with eligible as (
 select r.*, e.data, e.provenance as current_provenance,
   e.schema_version as current_schema, e.payload_sha256 as current_sha,
   e.retrieved_at as checked_at
 from public.corpus_records r
 join corpus_ingest.entities e on e.source_system='courtlistener'
   and e.entity_type='dockets' and r.id='cl:dockets:'||e.native_id
 where r.dataset='cl_docket_metadata'
   and e.last_run='b11bce32-fa58-4c07-a4ac-7cf830f44da0'::uuid
   and e.review_status<>'quarantined'
   and e.data->>'blocked'='false' and nullif(e.data->>'date_blocked','') is null
   and r.item->'cells'->>'native_id'=e.native_id
   and e.data->>'court'='https://www.courtlistener.com/api/rest/v4/courts/'||(r.item->'cells'->>'court_id')||'/'
), replacement as (
 select id,
 jsonb_set(item,'{cells}',(item->'cells')||jsonb_build_object(
   'date_filed',data->'date_filed','date_terminated',data->'date_terminated',
   'date_last_filing',data->'date_last_filing','date_modified',data->'date_modified',
   'source_checked_at',checked_at::text)) as new_item,
 jsonb_set(jsonb_set(detail,'{provenance,metadata_source}',jsonb_build_object(
   'schema_version',current_schema,'payload_sha256',current_sha,
   'source_url',current_provenance->>'source_url',
   'source_sha256',current_provenance->>'source_sha256','retrieved_at',checked_at::text)),
   '{facts}',coalesce((select jsonb_agg(f.value order by f.ordinality)
     from jsonb_array_elements(detail->'facts') with ordinality f(value,ordinality)
     where f.value->>0 not in ('Filed (source)','Terminated (source)','Last filing (source)','CourtListener checked')),'[]'::jsonb)
     ||jsonb_build_array(jsonb_build_array('Filed (source)',data->'date_filed'),
       jsonb_build_array('Terminated (source)',data->'date_terminated'),
       jsonb_build_array('Last filing (source)',data->'date_last_filing'),
       jsonb_build_array('CourtListener checked',checked_at::text))) as new_detail
 from eligible
)
select r.id,to_jsonb(r) as before_image,
 jsonb_build_object('item',p.new_item,'detail',p.new_detail,
   'text',jsonb_pretty((p.new_item->'cells')-'name')) as after_fields
from public.corpus_records r join replacement p using(id)
where r.dataset='cl_docket_metadata';

do $$ begin
 if (select count(*) from priority_refresh)<>34 then
   raise exception 'Expected exactly 34 existing, unblocked metadata rows; no changes committed';
 end if;
 if (select count(*) from corpus_ingest.observations where run_id='b11bce32-fa58-4c07-a4ac-7cf830f44da0' and entity_type='dockets')<>41 then
   raise exception 'Missing native refresh observations';
 end if;
end $$;

insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
select 'cl_docket_metadata',id,'priority_header_refresh_20261005','label_override',
 'Refresh source-recorded dates and checked-at provenance from an exact native CourtListener docket header; historical selection evidence retained.',
 jsonb_build_object('contract','priority-docket-metadata-refresh/1','source','CourtListener REST v4.7','counting_unit','docket header; not a full docket or membership census'),
 before_image,after_fields,'b11bce32-fa58-4c07-a4ac-7cf830f44da0'::uuid
from priority_refresh on conflict(dataset,record_id,issue) do nothing;

update public.corpus_records r set item=c.replacement->'item',detail=c.replacement->'detail',text=c.replacement->>'text'
from corpus_ingest.cleanup_decisions c
where r.dataset='cl_docket_metadata' and c.dataset=r.dataset and c.record_id=r.id
 and c.issue='priority_header_refresh_20261005' and c.run_id='b11bce32-fa58-4c07-a4ac-7cf830f44da0'
 and to_jsonb(r)=c.original_record;

do $$ begin
 if (select count(*) from public.corpus_records r join corpus_ingest.cleanup_decisions c on c.dataset=r.dataset and c.record_id=r.id
   where c.issue='priority_header_refresh_20261005' and c.run_id='b11bce32-fa58-4c07-a4ac-7cf830f44da0'
   and r.item=c.replacement->'item' and r.detail=c.replacement->'detail' and r.text=c.replacement->>'text')<>34 then
   raise exception 'Public refresh verification failed; transaction rolled back';
 end if;
end $$;
update corpus_ingest.runs set status='completed',finished_at=now(),counts=jsonb_build_object(
 'headers_checked',41,'observations',41,'new_native_versions',6,'public_metadata_refreshed',34,'source_blocked',4)
where id='b11bce32-fa58-4c07-a4ac-7cf830f44da0';
commit;

-- Rollback, if needed: restore only these three mutable columns from the ledger;
-- keep the native API versions, observations and historical selection provenance.
-- UPDATE public.corpus_records r SET item=c.original_record->'item',detail=c.original_record->'detail',text=c.original_record->>'text'
-- FROM corpus_ingest.cleanup_decisions c WHERE c.dataset=r.dataset AND c.record_id=r.id
-- AND c.issue='priority_header_refresh_20261005' AND c.run_id='b11bce32-fa58-4c07-a4ac-7cf830f44da0'
-- AND r.item=c.replacement->'item' AND r.detail=c.replacement->'detail' AND r.text=c.replacement->>'text';
