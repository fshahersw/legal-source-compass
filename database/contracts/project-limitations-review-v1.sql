-- Explicit native evidence edges and separate legal-rule publication.
-- No legacy, held-law or rejected-source publication.
with native_edges as (
 select e.source_system,e.entity_type as from_type,e.native_id as from_id,'sourceIds'::text as field,'statutory-sources'::text as to_type,j.value#>>'{}' as to_id,e.payload_sha256 as evidence_sha256,e.last_run as run_id
 from corpus_ingest.entities e cross join lateral jsonb_array_elements(coalesce(e.data->'sourceIds','[]'::jsonb)) j(value)
 where e.source_system='corpus-legal-review' and e.entity_type in ('limitation-rules','jurisdiction-coverage')
 union all
 select e.source_system,e.entity_type,e.native_id,'caseReferenceIds','judicial-references',j.value#>>'{}',e.payload_sha256,e.last_run
 from corpus_ingest.entities e cross join lateral jsonb_array_elements(coalesce(e.data->'caseReferenceIds','[]'::jsonb)) j(value)
 where e.source_system='corpus-legal-review' and e.entity_type='limitation-rules'
 union all
 select e.source_system,e.entity_type,e.native_id,k.field,'limitation-rules',j.value#>>'{}',e.payload_sha256,e.last_run
 from corpus_ingest.entities e cross join lateral (values('baselineRuleIds'),('researchRuleIds'))k(field)
 cross join lateral jsonb_array_elements(coalesce(e.data->k.field,'[]'::jsonb)) j(value)
 where e.source_system='corpus-legal-review' and e.entity_type='jurisdiction-coverage'
), missing as (
 select n.* from native_edges n where not exists(select 1 from corpus_ingest.entities t where t.source_system=n.source_system and t.entity_type=n.to_type and t.native_id=n.to_id)
), edges as (
 insert into corpus_ingest.relationships(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256,inferred,target_present,run_id)
 select source_system,from_type,from_id,field,to_type,to_id,evidence_sha256,false,true,run_id from native_edges
 where not exists(select 1 from missing)
 on conflict do nothing returning from_id
), rejected as (
 update corpus_ingest.entities set review_status='quarantined'
 where source_system='corpus-legal-review' and entity_type='rejected-captures'
 returning native_id
)
select jsonb_build_object('explicit_relationships_written',(select count(*) from edges),'native_relationship_candidates',(select count(*) from native_edges),'unresolved_targets',(select count(*) from missing),'rejection_audits_quarantined',(select count(*) from rejected)) as receipt;

with eligible as materialized (
 select e.* from corpus_ingest.entities e where source_system='corpus-legal-review' and entity_type='limitation-rules' and review_status<>'quarantined'
), totals as (select count(*) as n from eligible), registration as (
 insert into public.corpus_datasets(id,label,ready,expected_records,imported_records,metadata,updated_at)
 select 'statutory_limitations_review','Cited U.S. limitations rules — October 2026 review',false,n,0,jsonb_build_object(
 'schema_version','statutory-limitations-review/1','source_system','corpus-legal-review','source_as_of','2026-10-02',
 'qualification','Conditional statutory calendar baselines and selected primary evidence. No comprehensive operative-law, historical-amendment, choice-of-law, tolling, repose or case-specific review. The rule corpus does not certify a filing deadline. Legacy third-party summaries remain separate.',
 'aliases',jsonb_build_array('statutory_limitations_review'),
 'listing',jsonb_build_object('columns',jsonb_build_array(
 jsonb_build_object('key','native_id','label','Rule ID'),jsonb_build_object('key','jurisdiction','label','Jurisdiction'),
 jsonb_build_object('key','claim_type','label','Claim'),jsonb_build_object('key','rule_kind','label','Rule kind'),
 jsonb_build_object('key','computation','label','Computation scope'),jsonb_build_object('key','pinpoint','label','Authority pinpoint'),
 jsonb_build_object('key','rule_version','label','Rule version')),'filters','[]'::jsonb)),now() from totals
 on conflict(id)do update set label=excluded.label,ready=false,expected_records=excluded.expected_records,imported_records=0,metadata=excluded.metadata,updated_at=excluded.updated_at
 returning id
), prepared as (
 select e.*,row_number()over(order by native_id collate "C") as ordinal,
 replace(data->>'claimType','_',' ')||' · '||(data->>'jurisdiction')||' · '||coalesce(nullif(data->>'subtype',''),'general')||' · '||(data->>'ruleKind') as title,
 (select coalesce(jsonb_agg(link),'[]'::jsonb) from (
  select jsonb_build_object('url',s.data->>'url','label',s.data->>'title')as link
  from jsonb_array_elements_text(e.data->'sourceIds')j(id)
  join corpus_ingest.entities s on s.source_system=e.source_system and s.entity_type='statutory-sources' and s.native_id=j.id
  union all select jsonb_build_object('url',c.data->>'url','label',c.data->>'citation')
  from jsonb_array_elements_text(coalesce(e.data->'caseReferenceIds','[]'::jsonb))j(id)
  join corpus_ingest.entities c on c.source_system=e.source_system and c.entity_type='judicial-references' and c.native_id=j.id
 )links)as source_links
 from eligible e
), written as (
 insert into public.corpus_records(dataset,id,category,state,title,source_url,ordinal,item,detail,text,filters)
 select 'statutory_limitations_review','legal-review:'||native_id,'statutory_limitations_review',data->>'jurisdiction',title,provenance->>'source_url',ordinal,
 jsonb_build_object('id','legal-review:'||native_id,'title',title,'subtitle',data->>'scope',
 'cells',jsonb_build_object('native_id',native_id,'jurisdiction',data->>'jurisdiction','claim_type',data->>'claimType','rule_kind',data->>'ruleKind','computation',data->>'computation','pinpoint',data->>'pinpoint','rule_version',data->>'ruleVersion'),
 'links',source_links,'badges',jsonb_build_array(case when data->>'computation'='baseline_only' then 'Conditional calendar baseline' else 'Further legal review' end)),
 jsonb_build_object('id','legal-review:'||native_id,'title',title,'subtitle',data->>'scope',
 'facts',jsonb_build_array(jsonb_build_array('Rule version',data->>'ruleVersion'),jsonb_build_array('Authority',data->>'pinpoint'),jsonb_build_array('Computation',data->>'computation'),jsonb_build_array('Accrual basis',data->>'accrualBasis'),jsonb_build_array('Validity review',data->>'validity'),jsonb_build_array('Historical applicability',data->>'historicalApplicability')),
 'links',source_links,'conditions',data->'conditions','exclusions',data->'exclusions','warnings',data->'warnings',
 'qualification','Unadjusted calendar baseline only after governing law, trigger facts, historical statutory applicability and exceptions are independently confirmed. No definitive filing date, automatic tolling, or MDL-state selection.',
 'provenance',jsonb_build_object('source_system',source_system,'schema_version',schema_version,'record_sha256',payload_sha256,'source_bundle_sha256',provenance->>'source_bundle_sha256','hash_kind',provenance->>'hash_kind','retrieved_at',retrieved_at)),
 jsonb_pretty(data),jsonb_build_object('_listing','true','native_id',native_id,'state',data->>'jurisdiction','jurisdiction',data->>'jurisdiction','claim_type',data->>'claimType','computation',data->>'computation','rule_version',data->>'ruleVersion')
 from prepared
 on conflict(dataset,id)do update set category=excluded.category,state=excluded.state,title=excluded.title,source_url=excluded.source_url,ordinal=excluded.ordinal,item=excluded.item,detail=excluded.detail,text=excluded.text,filters=excluded.filters
 returning id,ordinal
)
select jsonb_build_object('dataset_registered',(select id from registration),'records_written',(select count(*)from written),'min_ordinal',(select min(ordinal)from written),'max_ordinal',(select max(ordinal)from written),'ready',false)as receipt;
