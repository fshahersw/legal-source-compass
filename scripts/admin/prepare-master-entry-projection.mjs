/** Offline preparation only: pinned native metadata, held registration and full-field checks. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { reviewEntryPrivacy } from './master-entry-privacy.mjs';
import { buildMasterEntryFacets } from './master-entry-facets.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((s,i,a)=>s.startsWith('--')?[s.slice(2),a[i+1]]:[]).filter(p=>p.length));
if (!args.baseline || !args.continuation || !args.output) throw Error('Require --baseline original-cache --continuation verified-pass --output prepared-contract-directory');
const oldRoot=path.resolve(args.baseline),pass=path.resolve(args.continuation),output=path.resolve(args.output);
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const run=await read(path.join(pass,'run.json')),verified=await read(path.join(pass,'private-independent-verification-receipt.json'));
if(verified.run_id!==run.id||verified.native_edges!==73431||['storage_hash_mismatches','native_identity_mismatches','observation_provenance_errors','inferred_edges','edge_source_field_mismatches','target_presence_mismatches'].some(k=>verified[k]!==0))throw Error('Private intake has not passed independent verification');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const records=new Map(),headers=new Map(),sourceFiles=[];
const resource=(value,type)=>{const u=new URL(value),m=u.pathname.match(/^\/api\/rest\/v4\/([^/]+)\/([0-9]+)\/$/);if(u.origin!=='https://www.courtlistener.com'||u.username||u.password||u.hash||u.search||!m||m[1]!==type)throw Error('Native resource identity mismatch');return m[2];};
const compare=(a,b)=>Date.parse(b.provenance.retrieved_at)-Date.parse(a.provenance.retrieved_at)||(a.provenance.source_url<b.provenance.source_url?-1:a.provenance.source_url>b.provenance.source_url?1:0)||(a.provenance.record_sha256<b.provenance.record_sha256?-1:a.provenance.record_sha256>b.provenance.record_sha256?1:0);
for(const base of [oldRoot,pass])for(const type of ['docket-entries','dockets']){
 const file=path.join(base,'live-normalized',type+'.jsonl'),b=await fs.readFile(file).catch(()=>Buffer.from(''));if(b.length)sourceFiles.push({path:file,bytes:b.length,sha256:hash(b)});
 for(const line of b.toString('utf8').trim().split('\n').filter(Boolean)){
  const r=JSON.parse(line);if(hash(JSON.stringify(r.data))!==r.provenance.record_sha256||resource(r.data.resource_uri,type)!==r.native_id)throw Error('Unverified native source row');
  const map=type==='dockets'?headers:records,prior=map.get(r.native_id);if(!prior||compare(r,prior)<0)map.set(r.native_id,r);
 }
}
const allowed=new Set(['4134359','4264145','4270519','5838695','6102388','6224301','6240169','7603829','8408916','14916674','16284915','18753355','65407433','67678440','68222905']);
const ordered=[...records.values()].sort((a,b)=>a.native_id<b.native_id?-1:a.native_id>b.native_id?1:0);
const sourceSignature=r=>[r.native_id,r.provenance.record_sha256,r.provenance.source_url,r.provenance.retrieved_at,r.provenance.source_sha256].join('\u001f');
let blocked=0,sealed=0,unknownEntries=0,eligible=0,unsealedIds=0;const privacyByDocket={},facetEntries=[];
for(const r of ordered){
 const id=resource(r.data.docket,'dockets'),header=headers.get(id);if(!allowed.has(id)||!header)throw Error('Unexpected/missing native docket scope');
 const privacy=reviewEntryPrivacy(r.data,header.data),blockedFlag=privacy.sourceBlocked,documents=r.data.recap_documents??[];
 const sealedFlag=privacy.explicitlySealed,unknown=privacy.unknownDocumentSeal;
 for(const d of documents)if(resource(d.resource_uri,'recap-documents')!==String(d.id))throw Error('Native document ID mismatch');
 const safeIds=privacy.explicitUnsealedIds;
 privacyByDocket[id]??={sourceEntries:0,sourceBlocked:0,explicitlySealed:0,eligibleEntries:0};const p=privacyByDocket[id];p.sourceEntries++;if(blockedFlag){blocked++;p.sourceBlocked++;}if(sealedFlag){sealed++;p.explicitlySealed++;}if(unknown)unknownEntries++;
 if(!blockedFlag&&!sealedFlag){eligible++;p.eligibleEntries++;unsealedIds+=safeIds.length;facetEntries.push({nativeEntryId:r.native_id,nativeDocketId:id,sourceUnsealedDocumentCount:safeIds.length});}
}
if(ordered.length!==15053||blocked!==40||sealed!==66||eligible!==14947)throw Error('Privacy/source counts changed; new review required');
const facets=buildMasterEntryFacets(facetEntries);
if(facets.eligibleEntries!==eligible||facets.unsealedDocumentAssociations!==unsealedIds||unsealedIds!==3253)throw Error('Entry facet counts changed; new review required');
const frozenSignature=hash(ordered.map(sourceSignature).join('\n'));
const review={schemaVersion:'master-entry-privacy-review/1',preparedAt:new Date().toISOString(),executed:false,sourceRuns:[run.scope.continuation_of,run.id],sourceNativeEntries:ordered.length,blockedEntries:blocked,explicitlySealedEntries:sealed,unknownDocumentSealEntries:unknownEntries,eligibleEntries:eligible,explicitlyUnsealedDocumentAssociations:unsealedIds,sourceSignatureSha256:frozenSignature,pdfDownloads:0,sourceFiles,privacyByDocket,policy:'Exclude a source-blocked docket and any entry containing an explicitly sealed document. Entries with unknown document seal flags may expose only minimal entry metadata; document ID arrays/count include explicit is_sealed=false IDs only. Unknown flags never establish unsealed status, availability or total document count.'};
await fs.mkdir(output,{recursive:true});
const runs=review.sourceRuns.map(id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid source run');return "'"+id+"'::uuid";}).join(',');
const ids=[...allowed].map(id=>"'"+id+"'").join(',');
const version='courtlistener-master-entry-metadata-view/1';
const qualify='One source-native docket entry. No descriptions, captions, parties, contacts or document contents are projected. Source-blocked dockets and entries with explicit sealed-document flags are excluded. Document IDs/count include only source-explicit unsealed IDs; unknown seal flags are omitted and the count is not a total-document or availability count. Native source associations do not establish MDL membership, claim disposition or legal outcome. No PDFs were downloaded.';
const esc=s=>"'"+s.replaceAll("'","''")+"'";
const source=`pinned as materialized (
 select v.native_id,v.payload_sha256,v.schema_version,v.data,o.source_url,o.source_sha256,o.retrieved_at,
 row_number() over(partition by v.native_id order by o.retrieved_at desc,o.source_url collate "C",v.payload_sha256 collate "C") observation_rank
 from corpus_ingest.entity_versions v join corpus_ingest.observations o using(source_system,entity_type,native_id,payload_sha256)
 where v.source_system='courtlistener' and v.entity_type='docket-entries' and v.schema_version='courtlistener-rest-v4.7/1'
 and o.run_id in(${runs}) and o.source_url~'^https://www[.]courtlistener[.]com/api/rest/v4/docket-entries/[?]'
), latest as materialized (
 select *,substring(data->>'docket' from '^https://www[.]courtlistener[.]com/api/rest/v4/dockets/([0-9]+)/$') native_docket_id from pinned where observation_rank=1
), reviewed as materialized (
 select l.*,e.review_status as entry_review_status,d.review_status as docket_review_status,
 (d.native_id is null or d.schema_version<>'courtlistener-rest-v4.7/1' or d.data->'blocked' is distinct from 'false'::jsonb or (d.data ? 'date_blocked' and d.data->'date_blocked'<>'null'::jsonb)) source_blocked,
 exists(select1 from jsonb_array_elements(coalesce(l.data->'recap_documents','[]'::jsonb)) x where x->'is_sealed'='true'::jsonb) explicitly_sealed
 from latest l left join corpus_ingest.entities e on e.source_system='courtlistener' and e.entity_type='docket-entries' and e.native_id=l.native_id
 left join corpus_ingest.entities d on d.source_system='courtlistener' and d.entity_type='dockets' and d.native_id=l.native_docket_id
), source_checks as (
 select count(*) source_records,count(*)filter(where source_blocked) source_blocked_entries,count(*)filter(where explicitly_sealed) explicitly_sealed_entries,
 count(*)filter(where native_docket_id not in(${ids}) or native_docket_id is null) unexpected_native_dockets,
 count(*)filter(where entry_review_status is null or entry_review_status='quarantined' or docket_review_status='quarantined') quarantine_or_missing_sources,
 encode(sha256(convert_to(coalesce(string_agg(native_id||chr(31)||payload_sha256||chr(31)||source_url||chr(31)||to_char(retrieved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||chr(31)||source_sha256,chr(10) order by native_id collate "C"),''),'UTF8')),'hex') source_signature_sha256 from reviewed
), eligible as materialized (
 select r.* from reviewed r where not source_blocked and not explicitly_sealed and native_docket_id in(${ids})
 and entry_review_status<>'quarantined' and docket_review_status<>'quarantined'
), ranked as (
 select *,row_number()over(order by native_id collate "C") record_ordinal from eligible
), bounded as (
 select r.* from ranked r cross join projection_batch b where record_ordinal>b.lower_ordinal_exclusive and record_ordinal<=b.upper_ordinal_inclusive
), safe as (
 select b.*,'cl:docket-entries:'||native_id public_id,'Docket entry '||coalesce(nullif(data->>'entry_number',''),native_id) display_title,
 'https://www.courtlistener.com/docket/'||native_docket_id||'/' source_docket_url,
 coalesce((select jsonb_agg(x.id order by x.id collate "C") from(select distinct x->>'id' id from jsonb_array_elements(coalesce(b.data->'recap_documents','[]'::jsonb))x where x->'is_sealed'='false'::jsonb and x->>'id'~'^[0-9]+$')x),'[]'::jsonb) source_unsealed_document_ids,
 case when exists(select1 from public.corpus_records p join public.corpus_datasets d on d.id=p.dataset and d.ready where p.dataset='cl_docket_metadata' and p.id='cl:dockets:'||b.native_docket_id and p.filters->>'native_id'=b.native_docket_id and p.item->'cells'->>'native_id'=b.native_docket_id)
 then '#record/cl_docket_metadata/cl%3Adockets%3A'||native_docket_id end public_docket_token
 from bounded b
), metadata as (
 select s.*,jsonb_build_object('native_entry_id',native_id,'native_docket_id',native_docket_id,'entry_number',data->'entry_number','date_filed',data->'date_filed','source_unsealed_document_ids',source_unsealed_document_ids,'source_unsealed_document_count',jsonb_array_length(source_unsealed_document_ids),'source_docket_url',source_docket_url) safe_metadata,
 jsonb_build_array(jsonb_build_object('url',source_docket_url,'label','CourtListener source docket'))||case when public_docket_token is not null then jsonb_build_array(jsonb_build_object('url',public_docket_token,'label','Native docket metadata')) else '[]'::jsonb end source_links
 from safe s
), expected as (
 select 'cl_master_entries'::text dataset,public_id id,'master_docket_entry'::text category,null::text state,'{}'::text[]county_geoids,display_title title,source_docket_url source_url,record_ordinal ordinal,
 jsonb_build_object('id',public_id,'title',display_title,'subtitle','Native docket '||native_docket_id,'cells',safe_metadata||jsonb_build_object('name',display_title),'links',jsonb_build_array(jsonb_build_object('url','#record/cl_master_entries/cl%3Adocket-entries%3A'||native_id,'label','Open entry metadata'))||source_links,'badges',jsonb_build_array('Docket entry','Metadata only'))item,
 jsonb_build_object('id',public_id,'title',display_title,'subtitle','Native docket '||native_docket_id,'facts',jsonb_build_array(jsonb_build_array('Native entry ID',native_id),jsonb_build_array('Native docket ID',native_docket_id),jsonb_build_array('Entry number (source)',data->'entry_number'),jsonb_build_array('Filing date (source)',data->'date_filed'),jsonb_build_array('Source-listed unsealed document IDs',source_unsealed_document_ids),jsonb_build_array('Source-listed unsealed document count',jsonb_array_length(source_unsealed_document_ids))),'links',source_links,'sections','[]'::jsonb,'qualification',${esc(qualify)},'provenance',jsonb_build_object('projection_schema',${esc(version)},'schema_version',schema_version,'record_sha256',payload_sha256,'source_url',source_url,'source_sha256',source_sha256,'retrieved_at',retrieved_at))detail,
 jsonb_pretty(safe_metadata)text,jsonb_build_object('_listing','true','native_id',native_id,'native_docket_id',native_docket_id,'source_unsealed_document_count',jsonb_array_length(source_unsealed_document_ids)::text)filters from metadata
)`.replaceAll('select1','select 1');
const header='-- PREPARED ONLY: execute after root review; no implicit publication.\n-- Raw records remain private. Source runs and native identity checksum are frozen.\n-- Entry grain; explicit-unsealed document association count is not a total or availability count.\n';
const guard=`c.source_records=15053 and c.source_blocked_entries=40 and c.explicitly_sealed_entries=66 and c.unexpected_native_dockets=0 and c.quarantine_or_missing_sources=0 and c.source_signature_sha256='${frozenSignature}' and (select count(*)from eligible)=14947`;
const batch=(upper=10000)=>`with projection_batch as(select0::bigint lower_ordinal_exclusive,${upper}::bigint upper_ordinal_inclusive),${source}`.replaceAll('select0','select 0');
const metadata={schema_version:version,source_system:'courtlistener',source_runs:review.sourceRuns,source_native_entries:15053,source_signature_sha256:frozenSignature,aliases:['cl_master_entries'],grain:'One native docket entry',qualification:qualify,privacy_policy:review.policy,listing:{columns:[{key:'native_entry_id',label:'Entry ID'},{key:'native_docket_id',label:'Docket ID'},{key:'entry_number',label:'Entry number'},{key:'date_filed',label:'Filed (source)'},{key:'source_unsealed_document_count',label:'Source-listed unsealed docs'}],filters:facets.filters}};
const registration=header+batch()+`, category_mapping as(insert into corpus_ingest.category_map(native_category,canonical_category,display_label,mapping_basis,version) values('master_docket_entry','dockets','Dockets & case systems','Source-native docket-entry metadata; no MDL member role or legal outcome inferred','2026-10-02.3') on conflict(native_category)do nothing returning native_category),registered as(insert into public.corpus_datasets(id,label,ready,expected_records,imported_records,metadata) select 'cl_master_entries','Source-native docket entries — metadata only',false,14947,0,${esc(JSON.stringify(metadata))}::jsonb from source_checks c where ${guard} on conflict(id)do update set label=excluded.label,expected_records=excluded.expected_records,metadata=excluded.metadata,updated_at=now() where not public.corpus_datasets.ready and public.corpus_datasets.metadata->>'schema_version'=${esc(version)} returning id,ready,expected_records) select jsonb_build_object('source_checks',(select to_jsonb(c)from source_checks c),'eligible_records',(select count(*)from eligible),'registration',(select to_jsonb(r)from registered r))receipt;\n`;
const mutation=header+batch()+`,written as(insert into public.corpus_records(dataset,id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters) select x.* from expected x cross join source_checks c where ${guard} and exists(select1 from public.corpus_datasets d where d.id=x.dataset and not d.ready and d.metadata->>'schema_version'=${esc(version)} and d.metadata->>'source_signature_sha256'='${frozenSignature}') on conflict(dataset,id)do update set category=excluded.category,state=excluded.state,county_geoids=excluded.county_geoids,title=excluded.title,source_url=excluded.source_url,ordinal=excluded.ordinal,item=excluded.item,detail=excluded.detail,text=excluded.text,filters=excluded.filters returning id,ordinal) select jsonb_build_object('source_checks',(select to_jsonb(c)from source_checks c),'eligible_records',(select count(*)from eligible),'expected_batch_records',(select count(*)from expected),'written_records',(select count(*)from written),'min_ordinal',(select min(ordinal)from written),'max_ordinal',(select max(ordinal)from written))receipt;\n`.replaceAll('select1','select 1');
const facetCounts=options=>options.map(({value,count})=>({value,count}));
const docketFacetJson=esc(JSON.stringify(facetCounts(facets.filters[0].options)))+'::jsonb';
const documentFacetJson=esc(JSON.stringify(facetCounts(facets.filters[1].options)))+'::jsonb';
const filtersJson=esc(JSON.stringify(facets.filters))+'::jsonb';
const facetSource=` ,facet_counts as(
 select
 (select jsonb_agg(jsonb_build_object('value',value,'count',records)order by value collate "C")from(select filters->>'native_docket_id' value,count(*)records from expected group by filters->>'native_docket_id')g)source_docket_facets,
 (select jsonb_agg(jsonb_build_object('value',value,'count',records)order by value::bigint)from(select filters->>'source_unsealed_document_count' value,count(*)records from expected group by filters->>'source_unsealed_document_count')g)source_document_facets,
 (select jsonb_agg(jsonb_build_object('value',value,'count',records)order by value collate "C")from(select filters->>'native_docket_id' value,count(*)records from public.corpus_records where dataset='cl_master_entries' group by filters->>'native_docket_id')g)public_docket_facets,
 (select jsonb_agg(jsonb_build_object('value',value,'count',records)order by value::bigint)from(select filters->>'source_unsealed_document_count' value,count(*)records from public.corpus_records where dataset='cl_master_entries' group by filters->>'source_unsealed_document_count')g)public_document_facets,
 (select count(*)from expected)source_facet_records,
 (select count(*)from public.corpus_records where dataset='cl_master_entries')public_facet_records,
 (select sum((filters->>'source_unsealed_document_count')::bigint)from expected)source_unsealed_associations,
 (select sum((filters->>'source_unsealed_document_count')::bigint)from public.corpus_records where dataset='cl_master_entries')public_unsealed_associations,
 exists(select 1 from public.corpus_datasets where id='cl_master_entries' and metadata->'listing'->'filters'=${filtersJson})stored_filters_match
 ),facet_checks as(select f.*,
 source_docket_facets=${docketFacetJson} and source_document_facets=${documentFacetJson}
 and public_docket_facets=${docketFacetJson} and public_document_facets=${documentFacetJson}
 and source_facet_records=14947 and public_facet_records=14947
 and source_unsealed_associations=3253 and public_unsealed_associations=3253 counts_verified,
 source_docket_facets=${docketFacetJson} and source_document_facets=${documentFacetJson}
 and public_docket_facets=${docketFacetJson} and public_document_facets=${documentFacetJson}
 and source_facet_records=14947 and public_facet_records=14947
 and source_unsealed_associations=3253 and public_unsealed_associations=3253 and stored_filters_match verified
 from facet_counts f)`;
const filtersSql=header+batch(9223372036854775807n)+facetSource+`,updated as(
 update public.corpus_datasets d set metadata=jsonb_set(d.metadata,'{listing,filters}',${filtersJson}),updated_at=now()
 from source_checks c cross join facet_checks f where d.id='cl_master_entries' and not d.ready
 and d.expected_records=14947 and d.metadata->>'schema_version'=${esc(version)}
 and d.metadata->>'source_signature_sha256'='${frozenSignature}' and ${guard} and f.counts_verified
 returning d.id,d.ready,d.metadata->'listing'->'filters'filters)
 select jsonb_build_object('source_checks',(select to_jsonb(c)from source_checks c),'facet_checks',(select to_jsonb(f)from facet_checks f),'updated',(select to_jsonb(u)from updated u))receipt;\n`;
const filtersVerify=header+batch(9223372036854775807n)+facetSource+` select jsonb_build_object('source_checks',(select to_jsonb(c)from source_checks c),'facet_checks',(select to_jsonb(f)from facet_checks f),'verified',(select (${guard})and f.verified from source_checks c cross join facet_checks f))receipt;\n`;
const compared=`,compared as(select x.*,r.id is not null present,r.id is not null and row(r.dataset,r.id,r.category,r.state,r.county_geoids,r.title,r.source_url,r.ordinal,r.item,r.detail,r.text,r.filters)is not distinct from row(x.dataset,x.id,x.category,x.state,x.county_geoids,x.title,x.source_url,x.ordinal,x.item,x.detail,x.text,x.filters)exact_match,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex')expected_row_sha256,case when r.id is not null then encode(sha256(convert_to(jsonb_build_object('dataset',r.dataset,'id',r.id,'category',r.category,'state',r.state,'county_geoids',r.county_geoids,'title',r.title,'source_url',r.source_url,'ordinal',r.ordinal,'item',r.item,'detail',r.detail,'text',r.text,'filters',r.filters)::text,'UTF8')),'hex')end actual_row_sha256 from expected x left join public.corpus_records r on r.dataset=x.dataset and r.id=x.id),checks as(select count(*)batch_records,count(*)filter(where not present)missing_records,count(*)filter(where not exact_match)mismatched_records,(select count(*)from public.corpus_records r cross join projection_batch b where r.dataset='cl_master_entries' and r.ordinal>b.lower_ordinal_exclusive and r.ordinal<=b.upper_ordinal_inclusive and not exists(select1 from expected x where x.id=r.id and x.ordinal=r.ordinal))unexpected_records,encode(sha256(convert_to(coalesce(string_agg(expected_row_sha256,chr(10)order by ordinal),''),'UTF8')),'hex')expected_full_fields_sha256,encode(sha256(convert_to(coalesce(string_agg(actual_row_sha256,chr(10)order by ordinal),''),'UTF8')),'hex')actual_full_fields_sha256 from compared)`;
const verify=header+batch()+compared+` select jsonb_build_object('source_checks',(select to_jsonb(c)from source_checks c),'eligible_records',(select count(*)from eligible),'checks',(select to_jsonb(c)from checks c),'verified',(select (${guard}) and k.batch_records>0 and k.missing_records=0 and k.mismatched_records=0 and k.unexpected_records=0 and k.expected_full_fields_sha256=k.actual_full_fields_sha256 from source_checks c cross join checks k))receipt;\n`;
const publish=header+batch(9223372036854775807n)+compared+`,final_checks as(select k.*,(select count(*)from public.corpus_records where dataset='cl_master_entries')public_records,(select count(distinct ordinal)from public.corpus_records where dataset='cl_master_entries')distinct_ordinals,(${guard}) and k.batch_records=14947 and k.missing_records=0 and k.mismatched_records=0 and k.unexpected_records=0 and k.expected_full_fields_sha256=k.actual_full_fields_sha256 and (select count(*)from public.corpus_records where dataset='cl_master_entries')=14947 and (select count(distinct ordinal)from public.corpus_records where dataset='cl_master_entries')=14947 and (select min(ordinal)=1 and max(ordinal)=14947 from public.corpus_records where dataset='cl_master_entries') and exists(select1 from public.corpus_datasets d where d.id='cl_master_entries' and d.expected_records=14947 and d.metadata->>'schema_version'=${esc(version)} and d.metadata->>'source_signature_sha256'='${frozenSignature}')verified from checks k cross join source_checks c),published as(update public.corpus_datasets d set ready=coalesce(c.verified,false),imported_records=c.public_records,metadata=d.metadata||jsonb_build_object('projection_validation',jsonb_build_object('verified',c.verified,'full_fields_sha256',c.actual_full_fields_sha256,'records',c.public_records,'validated_at',now())),updated_at=now() from final_checks c where d.id='cl_master_entries' returning d.id,d.ready,d.expected_records,d.imported_records) select jsonb_build_object('source_checks',(select to_jsonb(c)from source_checks c),'checks',(select to_jsonb(c)from final_checks c),'publication',(select to_jsonb(p)from published p))receipt;\n`;
const reviewSql=header+batch(9223372036854775807n)+` select jsonb_build_object('source_checks',(select to_jsonb(c)from source_checks c),'eligible_records',(select count(*)from eligible),'unsealed_document_associations',(select sum(jsonb_array_length(source_unsealed_document_ids))from safe),'public_parent_links',(select count(*)from safe where public_docket_token is not null),'privacy_by_docket',(select jsonb_agg(to_jsonb(x)order by native_docket_id)from(select native_docket_id,count(*)source_entries,count(*)filter(where source_blocked)blocked,count(*)filter(where explicitly_sealed)explicitly_sealed,count(*)filter(where not source_blocked and not explicitly_sealed and entry_review_status<>'quarantined' and docket_review_status<>'quarantined')eligible from reviewed group by native_docket_id)x))receipt;\n`;
const publishWithFacets=publish.replace(compared,facetSource+compared)
 .replace('and k.batch_records=14947','and coalesce((select verified from facet_checks),false) and k.batch_records=14947')
 .replace("'checks',(select to_jsonb(c)from final_checks c)","'checks',(select to_jsonb(c)from final_checks c),'facet_checks',(select to_jsonb(f)from facet_checks f)");
for(const [suffix,sql]of [['registration',registration],['batch',mutation],['verify',verify],['publish',publishWithFacets],['privacy-review',reviewSql],['filters',filtersSql],['filters-verify',filtersVerify]])await fs.writeFile(path.join(output,'project-master-entries-v1-'+suffix+'.sql'),sql.replaceAll('select1','select 1'));
await fs.writeFile(path.join(output,'master-entry-privacy-review.json'),JSON.stringify(review,null,2)+'\n');
await fs.writeFile(path.join(output,'master-entry-filter-facets-v1.json'),JSON.stringify({schemaVersion:'master-entry-filter-facets/1',preparedOnly:true,sourceSignatureSha256:frozenSignature,eligibleEntries:facets.eligibleEntries,explicitlyUnsealedDocumentAssociations:facets.unsealedDocumentAssociations,filters:facets.filters,qualification:'Facet counts cover eligible projected native entries in this pinned source snapshot. Explicitly unsealed document count omits unknown/true seal flags, is not total documents and does not establish availability.'},null,2)+'\n');
console.log(JSON.stringify({preparedOnly:true,sourceNativeEntries:ordered.length,eligibleEntries:eligible,sourceSignatureSha256:frozenSignature,explicitlyUnsealedDocumentAssociations:unsealedIds,output}));
