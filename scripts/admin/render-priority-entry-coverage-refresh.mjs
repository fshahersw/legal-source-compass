// Render an auditable, narrowly scoped data update. Does not connect or mutate.
import fs from 'node:fs';
const root = 'private/audit-2026-10-05';
const run = '65881579-a4ad-462a-a4ca-70aa36063a62';
const manifest = JSON.parse(fs.readFileSync(`${root}/recent-entries/live-backfill-manifest.json`, 'utf8'));
const expected = JSON.parse(fs.readFileSync(`${root}/master-refresh/expected.json`, 'utf8'));
const scopes = Object.entries(manifest.scopes).filter(([k]) => k.startsWith('docket-entries:')).map(([k, s]) => {
  const id = k.split(':')[1];
  const e = expected.filter(x => x.id === id);
  if (e.length !== 1 || !Number.isSafeInteger(s.records) || !Number.isFinite(Date.parse(s.updated_at))) throw Error('Ambiguous or invalid scope');
  return { mdl: e[0].mdl, docket_id: id, docket_key: e[0].key, recent_records: s.records, complete: s.complete, observed_at: s.updated_at };
});
if (scopes.length !== 17 || scopes.reduce((n, x) => n + x.recent_records, 0) !== 405 || scopes.filter(x => x.complete).length !== 1) throw Error('Unexpected collection scope');
const sql = `-- 17 existing matter coverage records; source versions and prior coverage retained.
-- Full page exhaustion was observed only for MDL 3114. Other refreshes are partial.
-- Current provider totals are deliberately unknown for partial scopes.
begin;
set local statement_timeout='300s';
create temporary table entry_refresh_scope on commit drop as
select * from jsonb_to_recordset($scope$${JSON.stringify(scopes)}$scope$::jsonb)
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
  'observed_at',s.observed_at,'recent_records',s.recent_records,'refresh_run','${run}',
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
 and metadata->'projection_validation'->>'verified'='true' and metadata->'source_runs' ? '${run}') then raise exception 'Projection not verified'; end if;
 if (select count(*) from corpus_ingest.observations where run_id='${run}' and entity_type='docket-entries')<>405 then raise exception 'Source observations missing'; end if;
end $$;
insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
select 'sw_matters_v1',id,'priority_entry_refresh_20261005','label_override',
'Refresh exact entry counts and distinguish recent partial collection from a completed source scope.',
jsonb_build_object('contract','priority-entry-coverage-refresh/1','source_run','${run}'),before_image,replacement,'${run}'::uuid
from entry_refresh on conflict(dataset,record_id,issue) do nothing;
update public.corpus_records r set item=c.replacement->'item',detail=c.replacement->'detail'
from corpus_ingest.cleanup_decisions c where c.dataset=r.dataset and c.record_id=r.id
and c.issue='priority_entry_refresh_20261005' and c.run_id='${run}' and to_jsonb(r)=c.original_record;
do $$ begin
 if (select count(*) from public.corpus_records r join corpus_ingest.cleanup_decisions c on c.dataset=r.dataset and c.record_id=r.id
 where c.issue='priority_entry_refresh_20261005' and c.run_id='${run}' and r.item=c.replacement->'item' and r.detail=c.replacement->'detail')<>17
 then raise exception 'Coverage readback failed; transaction rolled back'; end if;
end $$;
update corpus_ingest.runs set status='completed',finished_at=now(),counts=jsonb_build_object(
'docket_entry_observations',405,'recap_document_observations',896,'new_source_versions',455,
'public_entries_upserted',405,'public_entries_added',60,'matter_coverage_rows',17,'complete_scopes',1,'partial_scopes',16)
where id='${run}';
commit;
select jsonb_agg(jsonb_build_object('mdl',r.item->'cells'->'mdl_number','captured',r.item->'cells'->'entries_captured',
'published',r.item->'cells'->'entries_published','withheld',r.item->'cells'->'entries_withheld','coverage',r.detail->'registry'->'entries') order by r.id) as refreshed_coverage
from public.corpus_records r join corpus_ingest.cleanup_decisions c on c.dataset=r.dataset and c.record_id=r.id
where c.issue='priority_entry_refresh_20261005' and c.run_id='${run}';
-- Rollback only item/detail against exact replacement equality using original_record in cleanup_decisions.
`;
fs.writeFileSync('database/contracts/priority-entry-coverage-refresh-20261005.sql',sql);
console.log(JSON.stringify({rendered:true,matters:scopes.length,observations:405}));
