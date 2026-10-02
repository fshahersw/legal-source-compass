-- Bounded CourtListener public reference projection, courtlistener-reference-view/1.
-- Run registration/quarantine in project-reference-metadata-v1.sql first.
-- Execute one bounded batch per transaction with Supabase execute_sql.
-- Ordinals are computed over the entire eligible entity type before selecting the batch.
-- No schema changes, ingestion function changes or existing dataset updates occur here.
-- This file defaults to courts, ordinals 1..2000; edit projection_batch for other batches.

with specs(entity_type,dataset,category) as (values
 ('courts','cl_courts','court_reference'),('courthouses','cl_courthouses','court_reference'),
 ('court-appeals-to','cl_court_appeals_to','court_reference'),('people','cl_people','historical_biography'),
 ('positions','cl_positions','judicial_service'),('educations','cl_educations','biographical_reference'),('schools','cl_schools','biographical_reference')
), projection_batch as (
 -- Edit only these three values for a bounded replay. Keep upper-lower <= 2000.
 select 'courts'::text as entity_type,0::bigint as lower_ordinal_exclusive,2000::bigint as upper_ordinal_inclusive
), prepared as (
 select s.dataset,s.category,e.*,
 case e.entity_type
  when 'courts' then coalesce(nullif(e.data->>'full_name',''),nullif(e.data->>'short_name',''),'Court record '||e.native_id)
  when 'people' then coalesce(nullif(btrim(concat_ws(' ',e.data->>'name_first',e.data->>'name_middle',e.data->>'name_last',e.data->>'name_suffix')),''),'Person record '||e.native_id)
  when 'schools' then coalesce(nullif(e.data->>'name',''),'School record '||e.native_id)
  when 'positions' then coalesce(nullif(e.data->>'job_title',''),nullif(e.data->>'organization_name',''),nullif(e.data->>'position_type',''),'Position record '||e.native_id)
  when 'educations' then coalesce(nullif(e.data->>'degree_detail',''),nullif(e.data->>'degree_level',''),'Education record '||e.native_id)
  when 'courthouses' then coalesce(nullif(e.data->>'building_name',''),'Courthouse record '||e.native_id)
  when 'court-appeals-to' then (e.data->>'from_court_id')||' → '||(e.data->>'to_court_id')
 end as display_title,
 row_number() over(partition by s.dataset order by e.native_id) as record_ordinal
 from corpus_ingest.entities e join specs s on s.entity_type=e.entity_type
 join projection_batch b on b.entity_type=e.entity_type
 and b.upper_ordinal_inclusive>b.lower_ordinal_exclusive
 and b.upper_ordinal_inclusive-b.lower_ordinal_exclusive<=2000
 and b.lower_ordinal_exclusive>=0
 where e.source_system='courtlistener' and e.review_status<>'quarantined' and e.source_as_of=date '2026-09-30' and not exists (select 1 from corpus_ingest.entities qc where qc.source_system=e.source_system and qc.entity_type='courts' and qc.review_status='quarantined' and ((e.entity_type in ('courthouses','positions') and e.data->>'court_id'=qc.native_id) or (e.entity_type='court-appeals-to' and (e.data->>'from_court_id'=qc.native_id or e.data->>'to_court_id'=qc.native_id))))
), rendered as (
 select prepared.*,jsonb_build_array(jsonb_build_object('url',provenance->>'source_url','label','Original CourtListener metadata snapshot')) as source_links,
  jsonb_build_array(jsonb_build_array('Source system','CourtListener'),jsonb_build_array('Native entity type',entity_type),
    jsonb_build_array('Native ID',native_id),jsonb_build_array('Schema version',schema_version),
    jsonb_build_array('Source snapshot date',source_as_of::text),jsonb_build_array('Retrieved at',retrieved_at::text),
    jsonb_build_array('Original file SHA-256',provenance->>'source_sha256'),jsonb_build_array('Native payload SHA-256',payload_sha256)) as provenance_facts
 from prepared cross join projection_batch b
 where record_ordinal>b.lower_ordinal_exclusive and record_ordinal<=b.upper_ordinal_inclusive
), written as (
insert into public.corpus_records(dataset,id,category,state,title,source_url,ordinal,item,detail,text,filters)
select dataset,'cl:'||entity_type||':'||native_id,category,
 case when entity_type='courthouses' and data->>'country_code'='US'
   and data->>'state'=any(array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','AS','GU','MP','PR','VI'])
   then data->>'state' else null end,
 display_title,provenance->>'source_url',record_ordinal,
 jsonb_build_object('id','cl:'||entity_type||':'||native_id,'title',display_title,
   'subtitle','CourtListener metadata · snapshot '||source_as_of::text,
   'cells',(data - 'id')||jsonb_build_object('name',display_title,'native_id',native_id,'source_as_of',source_as_of::text),
   'links',source_links,'badges',jsonb_build_array('Source metadata',case when nullif(data->>'is_alias_of_id','') is not null then 'Explicit source alias' else entity_type end)),
 jsonb_build_object('id','cl:'||entity_type||':'||native_id,'title',display_title,'subtitle','Dated metadata snapshot',
   'facts',provenance_facts,'links',source_links,'sections','[]'::jsonb,
   'qualification','Native source metadata, preserved at its original entity grain. Dates can be historical, approximate or absent; native codes are not inferred legal outcomes. Explicit aliases remain distinct source records. Court geography and employment history are not case assignments, appeal jurisdiction or judge performance.'),
 jsonb_pretty(data),jsonb_build_object('_listing','true','source_as_of',source_as_of::text,'entity_type',entity_type,
   'native_id',native_id,'court',coalesce(data->>'court_id',''),'person',coalesce(data->>'person_id',''))
from rendered
on conflict(dataset,id) do update set category=excluded.category,state=excluded.state,title=excluded.title,
 source_url=excluded.source_url,ordinal=excluded.ordinal,item=excluded.item,detail=excluded.detail,text=excluded.text,filters=excluded.filters returning id,ordinal
)
select jsonb_build_object('entity_type',(select entity_type from projection_batch),'lower_ordinal_exclusive',(select lower_ordinal_exclusive from projection_batch),'upper_ordinal_inclusive',(select upper_ordinal_inclusive from projection_batch),'written',(select count(*) from written),'min_ordinal',(select min(ordinal) from written),'max_ordinal',(select max(ordinal) from written),'checked_at',now()) as receipt;
