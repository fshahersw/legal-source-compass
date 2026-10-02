-- Bounded per-dataset reconciliation and ready-gated publication.
-- Edit projection_spec to one of the seven registered entity type/dataset pairs.
-- Exact native IDs, canonical native JSON, source record/file provenance and dates
-- are compared using a deterministic SHA-256 signature before publication.
-- No publication occurs if counts, ordinals, source URLs or qualifications differ.

with projection_spec as (
 select 'courts'::text as entity_type,'cl_courts'::text as dataset
), eligible as (
 select e.* from corpus_ingest.entities e cross join projection_spec s
 where e.source_system='courtlistener' and e.entity_type=s.entity_type and e.review_status<>'quarantined' and e.source_as_of=date '2026-09-30' and not exists (select 1 from corpus_ingest.entities qc where qc.source_system=e.source_system and qc.entity_type='courts' and qc.review_status='quarantined' and ((e.entity_type in ('courthouses','positions') and e.data->>'court_id'=qc.native_id) or (e.entity_type='court-appeals-to' and (e.data->>'from_court_id'=qc.native_id or e.data->>'to_court_id'=qc.native_id))))
), expected as (
 select count(*) as records,encode(sha256(convert_to(coalesce(string_agg(
 jsonb_build_array(native_id,encode(sha256(convert_to(data::text,'UTF8')),'hex'),payload_sha256,schema_version,provenance->>'source_url',source_as_of::text,retrieved_at::text)::text,
 E'\n' order by native_id collate "C"),''),'UTF8')),'hex') as content_provenance_sha256 from eligible
), actual as (
 select count(*) as records,count(distinct ordinal) as distinct_ordinals,min(ordinal) as min_ordinal,max(ordinal) as max_ordinal,
 count(*) filter(where coalesce(title,'')='') as blank_titles,
 count(*) filter(where coalesce(source_url,'') !~ '^https?://') as invalid_source_urls,
 count(*) filter(where coalesce(detail->>'qualification','')='' or filters->>'_listing' is distinct from 'true') as missing_qualifications,
 encode(sha256(convert_to(coalesce(string_agg(
 jsonb_build_array(item->'cells'->>'native_id',encode(sha256(convert_to((text::jsonb)::text,'UTF8')),'hex'),detail->'facts'->7->>1,detail->'facts'->3->>1,source_url,detail->'facts'->4->>1,detail->'facts'->5->>1)::text,
 E'\n' order by (item->'cells'->>'native_id') collate "C"),''),'UTF8')),'hex') as content_provenance_sha256
 from public.corpus_records r cross join projection_spec s where r.dataset=s.dataset
), checks as (
 select s.*,e.records as expected_source_records,a.records as projected_records,d.expected_records as registered_expected_records,
 e.content_provenance_sha256 as expected_content_provenance_sha256,a.content_provenance_sha256 as actual_content_provenance_sha256,
 a.distinct_ordinals,a.min_ordinal,a.max_ordinal,a.blank_titles,a.invalid_source_urls,a.missing_qualifications,
 (a.records=e.records and a.records=d.expected_records and a.records>0
 and a.distinct_ordinals=a.records and a.min_ordinal=1 and a.max_ordinal=a.records
 and a.blank_titles=0 and a.invalid_source_urls=0 and a.missing_qualifications=0
 and e.content_provenance_sha256=a.content_provenance_sha256) as verified
 from projection_spec s cross join expected e cross join actual a join public.corpus_datasets d on d.id=s.dataset
), published as (
 update public.corpus_datasets d set imported_records=c.projected_records,ready=true,
 metadata=d.metadata||jsonb_build_object('projection_validation',jsonb_build_object('contract_version','courtlistener-reference-view/1','validated_at',now(),'content_provenance_sha256',c.actual_content_provenance_sha256,'records',c.projected_records,'quarantine_decision_version','courtlistener-reference-quarantine/1')),updated_at=now()
 from checks c where d.id=c.dataset and c.verified
 returning d.id,d.ready,d.imported_records
)
select jsonb_build_object('checks',(select to_jsonb(c) from checks c),'published',(select to_jsonb(p) from published p),'checked_at',now()) as receipt;
