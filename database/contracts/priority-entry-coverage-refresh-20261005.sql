-- 17 existing matter coverage records; source versions and prior coverage retained.
-- Full page exhaustion was observed only for MDL 3114. Other refreshes are partial.
-- Current provider totals are deliberately unknown for partial scopes.
begin;
set local statement_timeout='300s';
create temporary table entry_refresh_scope on commit drop as
select * from jsonb_to_recordset($scope$[{"mdl":"3114","docket_id":"68936135","docket_key":"txnd:3:2024-md-03114","recent_records":85,"complete":true,"observed_at":"2026-10-05T07:31:31.038Z"},{"mdl":"2741","docket_id":"5981306","docket_key":"cand:3:2016-md-02741","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:27:55.242Z"},{"mdl":"2789","docket_id":"6224301","docket_key":"njd:2:2017-md-02789","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:27:57.845Z"},{"mdl":"2873","docket_id":"8408916","docket_key":"scd:2:2018-mn-02873","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:29:02.540Z"},{"mdl":"3014","docket_id":"60866823","docket_key":"pawd:2:2021-mc-01230","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:29:05.962Z"},{"mdl":"3026","docket_id":"61690868","docket_key":"ilnd:1:2022-cv-00071","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:29:11.077Z"},{"mdl":"3047","docket_id":"65407433","docket_key":"cand:4:2022-md-03047","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:29:11.705Z"},{"mdl":"3060","docket_id":"66801859","docket_key":"ilnd:1:2023-cv-00818","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:29:16.042Z"},{"mdl":"3080","docket_id":"67665081","docket_key":"njd:2:2023-md-03080","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:29:18.025Z"},{"mdl":"3081","docket_id":"67678440","docket_key":"azd:2:2023-md-03081","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:30:16.396Z"},{"mdl":"3094","docket_id":"68222905","docket_key":"paed:2:2024-md-03094","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:30:17.421Z"},{"mdl":"3108","docket_id":"68837976","docket_key":"mnd:0:2024-md-03108","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:30:20.172Z"},{"mdl":"3113","docket_id":"68869775","docket_key":"njd:2:2024-md-03113","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:30:23.685Z"},{"mdl":"3125","docket_id":"69255166","docket_key":"casd:3:2024-md-03125","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:30:31.172Z"},{"mdl":"3144","docket_id":"69871659","docket_key":"cacd:2:2025-ml-03144","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:30:35.248Z"},{"mdl":"3149","docket_id":"69912599","docket_key":"casd:3:2025-md-03149","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:30:38.217Z"},{"mdl":"3166","docket_id":"72030009","docket_key":"cand:3:2025-md-03166","recent_records":20,"complete":false,"observed_at":"2026-10-05T07:30:44.052Z"}]$scope$::jsonb)
as s(mdl text,docket_id text,docket_key text,recent_records integer,complete boolean,observed_at text);

create temporary table entry_refresh on commit drop as
with published as (
 select s.mdl,count(r.id) as rows,count(r.id) filter(where r.item->'cells'->>'held'='true') as withheld
 from entry_refresh_scope s left join public.corpus_records r
 on r.dataset='sw_docket_entries_v1' and r.filters->>'mdl'=s.mdl
 group by s.mdl
), captured as (
 select s.mdl,count(e.native_id) as rows
 from entry_refresh_scope s left join corpus_ingest.entities e
 on e.source_system='courtlistener' and e.entity_type='docket-entries' and e.review_status<>'quarantined'
 and e.data->>'docket'='https://www.courtlistener.com/api/rest/v4/dockets/'||s.docket_id||'/'
 group by s.mdl
), replacement as (
 select r.id,to_jsonb(r) as before_image,s.*,p.rows as published,c.rows as captured,p.withheld,
 (s.complete and c.rows=s.recent_records) as verified_complete,
 jsonb_build_object('provider','courtlistener','docket_key',s.docket_key,'cl_docket_id',s.docket_id,
  'captured',c.rows,'complete',(s.complete and c.rows=s.recent_records),
  'provider_total',case when s.complete then s.recent_records else null end,
  'observed_at',s.observed_at,'recent_records',s.recent_records,'refresh_run','65881579-a4ad-462a-a4ca-70aa36063a62',
  'qualification','Recent source refresh; full scope only when every page was read. Earlier provider totals are preserved in previous_snapshot.',
  'previous_snapshot',coalesce((select x from jsonb_array_elements(r.detail->'registry'->'entries') x where x->>'cl_docket_id'=s.docket_id limit 1),'{}'::jsonb)) as coverage
 from entry_refresh_scope s join public.corpus_records r on r.dataset='sw_matters_v1' and r.id='sw-matter:'||s.mdl
 join published p using(mdl) join captured c using(mdl)
 where exists(select 1 from jsonb_array_elements(r.detail->'registry'->'case_ids') d
  where d->>'role'='master' and d->>'docket_key'=s.docket_key
   and exists(select 1 from jsonb_array_elements(d->'native_case_ids') n where n->>'provider'='courtlistener' and n->>'id'=s.docket_id))
), fields as (
 select id,before_image,
 jsonb_set(before_image->'item','{cells}',before_image->'item'->'cells'||jsonb_build_object(
 'entries_captured',captured,'entries_total',case when verified_complete then recent_records else null end,
 'entries_published',published,'entries_withheld',withheld)) as item,
 jsonb_set(jsonb_set(before_image->'detail','{registry,entries}',
 coalesce((select jsonb_agg(x) from jsonb_array_elements(before_image->'detail'->'registry'->'entries') x where x->>'cl_docket_id'<>docket_id),'[]'::jsonb)||jsonb_build_array(coverage)),
 '{facts}',coalesce((select jsonb_agg(x) from jsonb_array_elements(before_image->'detail'->'facts') x
 where x->>0<>'Docket entries captured / provider total (CourtListener)'),'[]'::jsonb)||
 jsonb_build_array(jsonb_build_array('Docket entries captured / provider total (CourtListener)',
 captured::text||case when verified_complete then ' / '||recent_records::text||' (complete at capture)' else ' captured; recent refresh partial; current provider total not checked' end))) as detail
 from replacement
)
select id,before_image,jsonb_build_object('item',item,'detail',detail) as replacement from fields;

do $$ begin
 if (select count(*) from entry_refresh)<>17 then raise exception 'Scope verification failed'; end if;
 if (select count(*) from public.corpus_records where dataset='sw_docket_entries_v1')<>63973 then raise exception 'Unexpected published entry count'; end if;
 if not exists(select 1 from public.corpus_datasets where id='sw_docket_entries_v1'
 and metadata->'projection_validation'->>'verified'='true' and metadata->'source_runs' ? '65881579-a4ad-462a-a4ca-70aa36063a62') then raise exception 'Projection not verified'; end if;
 if (select count(*) from corpus_ingest.observations where run_id='65881579-a4ad-462a-a4ca-70aa36063a62' and entity_type='docket-entries')<>405 then raise exception 'Source observations missing'; end if;
end $$;
insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
select 'sw_matters_v1',id,'priority_entry_refresh_20261005','label_override',
'Refresh exact entry counts and distinguish recent partial collection from a completed source scope.',
jsonb_build_object('contract','priority-entry-coverage-refresh/1','source_run','65881579-a4ad-462a-a4ca-70aa36063a62'),before_image,replacement,'65881579-a4ad-462a-a4ca-70aa36063a62'::uuid
from entry_refresh on conflict(dataset,record_id,issue) do nothing;
update public.corpus_records r set item=c.replacement->'item',detail=c.replacement->'detail'
from corpus_ingest.cleanup_decisions c where c.dataset=r.dataset and c.record_id=r.id
and c.issue='priority_entry_refresh_20261005' and c.run_id='65881579-a4ad-462a-a4ca-70aa36063a62' and to_jsonb(r)=c.original_record;
do $$ begin
 if (select count(*) from public.corpus_records r join corpus_ingest.cleanup_decisions c on c.dataset=r.dataset and c.record_id=r.id
 where c.issue='priority_entry_refresh_20261005' and c.run_id='65881579-a4ad-462a-a4ca-70aa36063a62' and r.item=c.replacement->'item' and r.detail=c.replacement->'detail')<>17
 then raise exception 'Coverage readback failed; transaction rolled back'; end if;
end $$;
update corpus_ingest.runs set status='completed',finished_at=now(),counts=jsonb_build_object(
'docket_entry_observations',405,'recap_document_observations',896,'new_source_versions',455,
'public_entries_upserted',405,'public_entries_added',60,'matter_coverage_rows',17,'complete_scopes',1,'partial_scopes',16)
where id='65881579-a4ad-462a-a4ca-70aa36063a62';
commit;
select jsonb_agg(jsonb_build_object('mdl',r.item->'cells'->'mdl_number','captured',r.item->'cells'->'entries_captured',
'published',r.item->'cells'->'entries_published','withheld',r.item->'cells'->'entries_withheld','coverage',r.detail->'registry'->'entries') order by r.id) as refreshed_coverage
from public.corpus_records r join corpus_ingest.cleanup_decisions c on c.dataset=r.dataset and c.record_id=r.id
where c.issue='priority_entry_refresh_20261005' and c.run_id='65881579-a4ad-462a-a4ca-70aa36063a62';
-- Rollback only item/detail against exact replacement equality using original_record in cleanup_decisions.
