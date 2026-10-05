-- Additive October 5, 2026 mixed-authority publication contract, v7 legacy defaults and NULL-safe text gate.
-- Preserve v1 and its historical 104-rule guard. Run after source ingestion,
-- explicit evidence edges, projection staging and listing-filter preparation.
-- Exact 124-rule snapshot with 99 source captures (93 statutes, 6 support authorities), 87 conditional baselines across 46 jurisdictions, and 15 judicial references.
-- No DDL, PDF acquisition, private grants or shared-run finalization.

with private_rules as (
 select * from corpus_ingest.entities where source_system='corpus-legal-review' and entity_type='limitation-rules' and review_status<>'quarantined'
), expected as (
 select e.native_id,e.data,e.provenance,e.payload_sha256,e.source_system,e.schema_version,e.retrieved_at,
 row_number() over(order by native_id collate "C") as ordinal,
 replace(data->>'claimType','_',' ')||' · '||(data->>'jurisdiction')||' · '||coalesce(nullif(data->>'subtype',''),'general')||' · '||(data->>'ruleKind') as title,
 (select coalesce(jsonb_agg(link),'[]'::jsonb) from (
  select jsonb_build_object('url',s.data->>'url','label',s.data->>'title')as link from jsonb_array_elements_text(e.data->'sourceIds')j(id)
   join corpus_ingest.entities s on s.source_system=e.source_system and s.entity_type='statutory-sources' and s.native_id=j.id
  union all
  select jsonb_build_object('url',c.data->>'url','label',c.data->>'citation') from jsonb_array_elements_text(coalesce(e.data->'caseReferenceIds','[]'))j(id)
   join corpus_ingest.entities c on c.source_system=e.source_system and c.entity_type='judicial-references' and c.native_id=j.id
 )s)as links from private_rules e
), mismatches as (
 select e.native_id from expected e left join public.corpus_records r on r.dataset='statutory_limitations_review' and r.id='legal-review:'||e.native_id
 where r.id is null or r.category is distinct from 'statutory_limitations_review' or r.state is distinct from e.data->>'jurisdiction'
 or r.title is distinct from e.title or r.source_url is distinct from e.provenance->>'source_url' or r.ordinal is distinct from e.ordinal
 or r.text::jsonb is distinct from e.data
 or r.item->>'id' is distinct from r.id or r.item->>'title' is distinct from e.title or r.item->>'subtitle' is distinct from e.data->>'scope'
 or r.item->'cells' is distinct from jsonb_build_object('native_id',e.native_id,'jurisdiction',e.data->>'jurisdiction','claim_type',e.data->>'claimType','rule_kind',e.data->>'ruleKind','computation',e.data->>'computation','pinpoint',e.data->>'pinpoint','rule_version',e.data->>'ruleVersion')
 or r.item->'badges' is distinct from jsonb_build_array(case when e.data->>'computation'='baseline_only' then 'Conditional calendar baseline' else 'Further legal review' end)
 or not((r.item->'links') @> e.links and e.links @> (r.item->'links')) or jsonb_array_length(r.item->'links') is distinct from jsonb_array_length(e.links)
 or r.detail->>'id' is distinct from r.id or r.detail->>'title' is distinct from e.title or r.detail->>'subtitle' is distinct from e.data->>'scope'
 or r.detail->'facts' is distinct from jsonb_build_array(jsonb_build_array('Rule version',e.data->>'ruleVersion'),jsonb_build_array('Authority',e.data->>'pinpoint'),jsonb_build_array('Computation',e.data->>'computation'),jsonb_build_array('Accrual basis',e.data->>'accrualBasis'),jsonb_build_array('Validity review',e.data->>'validity'),jsonb_build_array('Historical applicability',e.data->>'historicalApplicability'))
 or r.detail->'conditions' is distinct from e.data->'conditions' or r.detail->'exclusions' is distinct from e.data->'exclusions' or r.detail->'warnings' is distinct from e.data->'warnings'
 or not((r.detail->'links') @> e.links and e.links @> (r.detail->'links')) or jsonb_array_length(r.detail->'links') is distinct from jsonb_array_length(e.links)
 or r.detail->>'qualification' is distinct from 'Unadjusted calendar baseline only after governing law, trigger facts, historical statutory applicability and exceptions are independently confirmed. No definitive filing date, automatic tolling, or MDL-state selection.'
 or r.detail->'provenance' is distinct from jsonb_build_object('source_system',e.source_system,'schema_version',e.schema_version,'record_sha256',e.payload_sha256,'source_bundle_sha256',e.provenance->>'source_bundle_sha256','hash_kind',e.provenance->>'hash_kind','retrieved_at',e.retrieved_at)
 or r.filters is distinct from jsonb_build_object('_listing','true','native_id',e.native_id,'state',e.data->>'jurisdiction','jurisdiction',e.data->>'jurisdiction','claim_type',e.data->>'claimType','computation',e.data->>'computation','rule_version',e.data->>'ruleVersion')
), missing_targets as (
 select e.native_id,j.id from private_rules e cross join lateral jsonb_array_elements_text(e.data->'sourceIds')j(id)
 where not exists(select 1 from corpus_ingest.entities t where t.source_system=e.source_system and t.entity_type='statutory-sources' and t.native_id=j.id and t.review_status<>'quarantined')
 union all select e.native_id,j.id from private_rules e cross join lateral jsonb_array_elements_text(coalesce(e.data->'caseReferenceIds','[]'))j(id)
 where not exists(select 1 from corpus_ingest.entities t where t.source_system=e.source_system and t.entity_type='judicial-references' and t.native_id=j.id and t.review_status<>'quarantined')
), hash_mismatch as (
 select e.native_id from private_rules e cross join lateral jsonb_array_elements(coalesce(e.provenance->'source_text_hashes','[]'))j(v)
 left join corpus_ingest.entities s on s.source_system=e.source_system and s.entity_type='statutory-sources' and s.native_id=j.v->>'id'
 where s.native_id is null or s.data->>'sha256' is distinct from j.v->>'sha256'
), version_mismatch as (
 select e.native_id from corpus_ingest.entities e left join corpus_ingest.entity_versions v using(source_system,entity_type,native_id,payload_sha256)
 where e.source_system='corpus-legal-review' and (v.native_id is null or e.data is distinct from v.data or v.storage_sha256 is distinct from encode(sha256(convert_to(v.data::text,'UTF8')),'hex'))
),
text_mismatch as (
 select native_id from corpus_ingest.entities
 where source_system='corpus-legal-review' and entity_type in('statutory-sources','judicial-references')
 and (
  data->>'sha256' is distinct from data->'full_text_storage'->>'sha256'
  or data->'byteLength' is distinct from data->'full_text_storage'->'byteLength'
  or (data?'text' and (
   encode(sha256(convert_to(data->>'text','UTF8')),'hex')is distinct from data->>'sha256'
   or octet_length(data->>'text')is distinct from (data->>'byteLength')::bigint
   or coalesce(data->'full_text_storage'->>'status','') not in ('included','excerpt')
   or (data->'full_text_storage'->>'status'='excerpt' and coalesce(nullif(btrim(data->'full_text_storage'->>'scope'),''),'')='')
  ))
  or (not(data?'text')and(native_id<>'in-code-2026'or data->'full_text_storage'->>'status' is distinct from 'file_locator_only'))
 )
),
authority_kind_mismatch as (
 select native_id from corpus_ingest.entities
 where source_system='corpus-legal-review' and entity_type='statutory-sources'
 and coalesce(data->>'authorityKind','statute') not in ('statute','constitution','legislative_history','publisher_guidance','publisher_table')
),
baseline_statute_mismatch as (
 select r.native_id from corpus_ingest.entities r
 where r.source_system='corpus-legal-review' and r.entity_type='limitation-rules' and r.review_status<>'quarantined'
 and r.data->>'computation'='baseline_only'
 and not exists(
  select 1 from jsonb_array_elements_text(coalesce(r.data->'sourceIds','[]'::jsonb)) sid(id)
  join corpus_ingest.entities s on s.source_system=r.source_system and s.entity_type='statutory-sources' and s.native_id=sid.id
  where s.review_status<>'quarantined' and coalesce(s.data->>'authorityKind','statute')='statute'
 )
),
opinion_schema_mismatch as (
 select native_id from corpus_ingest.entities
 where source_system='corpus-legal-review' and entity_type='judicial-references'
 and (not(data ?& array['schemaVersion','referenceVersion','authorityKind','reviewStatus','textScope'])
  or data->>'schemaVersion' is distinct from '1.0.0'
  or data->>'authorityKind' is distinct from 'judicial_opinion'
  or data->>'reviewStatus' is distinct from 'opinion_passage_reviewed')
),
raw_capture_mismatch as (
 select native_id from corpus_ingest.entities
 where source_system='corpus-legal-review' and entity_type in('statutory-sources','judicial-references')
 and (data?'raw_capture_storage' or data->>'pdfDownloaded'='true')
 and (not(data?'rawCapture') or not(data?'raw_capture_storage')
  or data->'rawCapture'->>'sha256' is distinct from data->'raw_capture_storage'->>'sha256'
  or data->'rawCapture'->'byteLength' is distinct from data->'raw_capture_storage'->'bytes'
  or data->'raw_capture_storage'->>'bucket' is distinct from 'corpus-originals'
  or coalesce(data->'raw_capture_storage'->>'object','') !~ '^legal-authority-raw/sha256/[a-f0-9]{2}/[a-f0-9]{64}\.(html|pdf)$'
  or (data->>'pdfDownloaded'='true' and (data->'rawCapture'->>'contentType' is distinct from 'application/pdf'
   or data->>'officialPdfUrl' is distinct from data->>'url'
   or coalesce(data->>'officialPdfUrl','') !~ '^https://')))
), judicial_hash_mismatch as (
 select e.native_id from private_rules e cross join lateral jsonb_array_elements(coalesce(e.provenance->'judicial_text_hashes','[]'))j(v)
 left join corpus_ingest.entities c on c.source_system=e.source_system and c.entity_type='judicial-references' and c.native_id=j.v->>'id'
 where c.native_id is null or c.data->>'sha256' is distinct from j.v->>'sha256'
),
inventory as (
 select count(*)as n,count(distinct ordinal)as ordinals,min(ordinal)as first,max(ordinal)as last
 from public.corpus_records where dataset='statutory_limitations_review'
),
review_counts as (
 select count(*)as n,
 count(*)filter(where data->>'computation'='baseline_only')as conditional,
 count(*)filter(where data->>'computation'='research_only')as research,
 count(distinct data->>'jurisdiction')filter(where data->>'computation'='baseline_only')as conditional_jurisdictions
 from private_rules
),
evidence_counts as (
 select
 count(*)filter(where entity_type='statutory-sources')as source_captures,
 count(*)filter(where entity_type='statutory-sources'and coalesce(data->>'authorityKind','statute')='statute')as statutes,
 count(*)filter(where entity_type='statutory-sources'and data->>'authorityKind'='legislative_history')as legislative_history,
 count(*)filter(where entity_type='statutory-sources'and data->>'authorityKind'='constitution')as constitutions,
 count(*)filter(where entity_type='statutory-sources'and data->>'authorityKind'='publisher_guidance')as publisher_guidance,
 count(*)filter(where entity_type='statutory-sources'and data->>'authorityKind'='publisher_table')as publisher_tables,
 count(distinct data->>'state')filter(where entity_type='statutory-sources'and data->>'state'<>'US')as primary_jurisdictions,
 count(*)filter(where entity_type='judicial-references')as opinions,
 count(*)filter(where entity_type in('statutory-sources','judicial-references')and data->'full_text_storage'->>'status'='included')as full_texts,
 count(*)filter(where entity_type in('statutory-sources','judicial-references')and data->'full_text_storage'->>'status'='excerpt')as excerpts,
 count(*)filter(where entity_type in('statutory-sources','judicial-references')and data->'full_text_storage'->>'status'='file_locator_only')as locators
 from corpus_ingest.entities where source_system='corpus-legal-review'and review_status<>'quarantined'
),
state_options as (
 select jsonb_agg(jsonb_build_object('value',state,'label',state,'count',n)order by state)as options
 from(select data->>'jurisdiction'as state,count(*)as n from private_rules group by data->>'jurisdiction')s
),
claim_options as (
 select jsonb_agg(jsonb_build_object('value',claim,'label',replace(claim,'_',' '),'count',n)order by claim)as options
 from(select data->>'claimType'as claim,count(*)as n from private_rules group by data->>'claimType')s
),
computation_options as (
 select jsonb_agg(jsonb_build_object('value',computation,'label',case when computation='baseline_only'then'Conditional calendar baseline'else'Further legal review'end,'count',n)order by computation)as options
 from(select data->>'computation'as computation,count(*)as n from private_rules group by data->>'computation')s
),
expected_filters as (
 select jsonb_build_array(
 jsonb_build_object('name','state','type','select','label','Jurisdiction','options',s.options),
 jsonb_build_object('name','claim_type','type','select','label','Claim category','options',c.options),
 jsonb_build_object('name','computation','type','select','label','Review/computation scope','options',o.options)
 )as filters from state_options s,claim_options c,computation_options o
),
publication_checks as (
 select
 r.n=124 and r.conditional=87 and r.research=37 and r.conditional_jurisdictions=46
 and i.n=124 and i.ordinals=124 and i.first=1 and i.last=124 and d.expected_records=124
 and e.source_captures=99 and e.statutes=93 and e.legislative_history=2 and e.constitutions=1 and e.publisher_guidance=1 and e.publisher_tables=2 and e.primary_jurisdictions=47 and e.opinions=15 and e.full_texts=111 and e.excerpts=2 and e.locators=1
 and d.metadata->'listing'->'filters' is not distinct from f.filters
 and not exists(select 1 from mismatches)
 and not exists(select 1 from missing_targets)
 and not exists(select 1 from hash_mismatch)
 and not exists(select 1 from version_mismatch)
 and not exists(select 1 from text_mismatch)
 and not exists(select 1 from authority_kind_mismatch)
 and not exists(select 1 from baseline_statute_mismatch)
 and not exists(select 1 from opinion_schema_mismatch)
 and not exists(select 1 from raw_capture_mismatch)
 and not exists(select 1 from judicial_hash_mismatch)
 as passed,
 jsonb_build_object(
 'version','statutory-limitations-review/7','review_version','2026-10-05.4','checked_at',now(),
 'records',r.n,'conditional_calendar_baselines',r.conditional,'research_only_rules',r.research,
 'conditional_baseline_jurisdictions',r.conditional_jurisdictions,
 'source_captures',e.source_captures,'statutory_source_captures',e.statutes,'legislative_history_sources',e.legislative_history,'constitutional_sources',e.constitutions,'publisher_guidance_sources',e.publisher_guidance,'publisher_table_sources',e.publisher_tables,'primary_text_jurisdictions',e.primary_jurisdictions,'judicial_references',e.opinions,
 'full_field_mismatches',(select count(*)from mismatches),
 'source_authority_scope','93 statutes + 6 supporting authorities; absent legacy authorityKind resolves to statute; support-only baseline count must be zero',
 'legacy_defaulted_statute_sources',(select count(*) from corpus_ingest.entities where source_system='corpus-legal-review' and entity_type='statutory-sources' and review_status<>'quarantined' and not(data?'authorityKind')),
 'support_only_baselines',(select count(*) from baseline_statute_mismatch),
 'missing_native_citation_targets',(select count(*)from missing_targets),
 'source_version_hash_mismatches',(select count(*)from hash_mismatch),
 'stored_version_mismatches',(select count(*)from version_mismatch),
 'text_storage_mismatches',(select count(*)from text_mismatch),
 'authority_kind_mismatches',(select count(*)from authority_kind_mismatch),
 'baseline_without_statute',(select count(*)from baseline_statute_mismatch),
 'support_authorities',e.legislative_history+e.constitutions+e.publisher_guidance+e.publisher_tables,
 'opinion_schema_mismatches',(select count(*)from opinion_schema_mismatch),
 'raw_capture_mismatches',(select count(*)from raw_capture_mismatch),
 'judicial_text_hash_mismatches',(select count(*)from judicial_hash_mismatch),
 'listing_filters_match',d.metadata->'listing'->'filters' is not distinct from f.filters,
 'qualification','Conditional statutory calendar baselines and selected opinion passages only; no comprehensive operative-law, historical, exception or case-specific review'
 )as receipt
 from review_counts r,inventory i,evidence_counts e,expected_filters f
 join public.corpus_datasets d on d.id='statutory_limitations_review'
),
published as (
 update public.corpus_datasets d set
 ready=coalesce(v.passed,false),
 imported_records=case when v.passed then 124 else 0 end,
 metadata=metadata||jsonb_build_object('projection_validation',v.receipt||jsonb_build_object('passed',coalesce(v.passed,false))),
 updated_at=now()
 from publication_checks v where d.id='statutory_limitations_review'
 returning d.id,d.ready,d.expected_records,d.imported_records,d.metadata->'projection_validation'as validation
)
select jsonb_build_object(
 'public_projection',(select to_jsonb(p)from published p),
 'full_field_mismatch_ids',(select coalesce(jsonb_agg(native_id),'[]')from mismatches),
 'run_finalization','None: root owns shared-run finalization'
)as receipt;
