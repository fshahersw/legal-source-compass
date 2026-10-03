import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {exactDocketReferenceCandidates} from './docketbird-metadata-contract.mjs';

const base='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02';
const out=path.join(base,'pdf-library-v1');
const sha=x=>createHash('sha256').update(x).digest('hex');
const captures=[],documents=new Map(),headers=new Map(),qualified=new Map(),scopeHeld=[];
const clHits=(await fs.readFile(path.join(base,'courtlistener/live-normalized/firm-search-hits.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));
const clTargets=new Map();for(const row of clHits){const key=row.data.court_id+'|'+row.data.docketNumber;const list=clTargets.get(key)??[];if(!list.some(x=>x.data.docket_id===row.data.docket_id))list.push(row);clTargets.set(key,list);}
for(const scope of ['narrow-probe','master-probe','portfolio-backfill-v1']){
 const dir=path.join(base,'docketbird',scope);
 for(const name of (await fs.readdir(dir)).filter(x=>/^\d+-[a-f0-9]{64}\.json$/.test(x))){
  const file=path.join(dir,name),bytes=await fs.readFile(file),capture=JSON.parse(bytes);
  const raw=Buffer.from(capture.original_rpc_response??'');
  if(capture.schema_version!=='docketbird-mcp-capture/1'||capture.source_url!=='https://mcp.docketbird.com/mcp'||capture.http_status!==200||sha(raw)!==capture.response_sha256||raw.length!==capture.response_bytes)throw Error('Capture integrity guard failed');
  if(capture.method!=='tools/call')continue;
  const messages=raw.toString().startsWith('data:')?raw.toString().split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>JSON.parse(x.slice(5))):[JSON.parse(raw)];
  const result=messages.find(x=>x.result)?.result;if(!result||result.isError)continue;
  const data=result.structuredContent??JSON.parse(result.content.find(x=>x.type==='text').text);
  captures.push({capture,file,capture_file_sha256:sha(bytes),data});
 }
}
function qualify(id,evidence){if(typeof id!=='string'||!/^[a-z0-9_]+-[^/\s]+$/.test(id))throw Error('Provider case identity invalid');const list=qualified.get(id)??[];list.push(evidence);qualified.set(id,list);}
for(const {capture,file,capture_file_sha256,data}of captures){
 const evidence={capture_file:file,capture_file_sha256,source_response_sha256:capture.response_sha256,retrieved_at:capture.retrieved_at};
 if(capture.params.name==='find_litigation_relationships')for(const row of data.records??[])if(row['lawfirm.law_firm_id']==='seegerweiss.com')qualify(row['case.case_id'],{...evidence,kind:'provider_native_firm_appearance',law_firm_id:'seegerweiss.com'});
 // Account tracking remains a research lead; firm scope requires separate source proof.
 if(capture.params.name==='search_cases'){
  const hits=clTargets.get(capture.params.arguments.court_id+'|'+capture.params.arguments.q);
  if(!hits)continue;if(hits.length!==1){scopeHeld.push({courtlistener_docket_ids:hits.map(x=>String(x.data.docket_id)),resolution:'multiple_native_source_docket_ids',native_case_candidates:(data.cases??[]).map(x=>x.id)});continue;}
  const hit=hits[0],resolution=exactDocketReferenceCandidates(hit.data,data.cases??[]);
  if(resolution.definitive_association_allowed)for(const row of resolution.matches)qualify(row.id,{...evidence,kind:'exact_native_docket_reference',courtlistener_docket_id:String(hit.data.docket_id),cross_provider_merge:false});
  else scopeHeld.push({courtlistener_docket_id:String(hit.data.docket_id),resolution:resolution.resolution,native_case_candidates:resolution.matches.map(x=>x.id)});
 }
}
for(const {capture,file,capture_file_sha256,data}of captures){
 if(capture.params.name==='get_case'&&data.case?.id===capture.params.arguments.case_id)headers.set(data.case.id,{capture_file:file,capture_file_sha256,data:data.case});
 if(capture.params.name!=='get_docket_sheet')continue;
 const id=capture.params.arguments.case_id;
 for(const doc of data.documents??[]){
  if(typeof doc.id!=='string'||!doc.id.startsWith(id+'-'))throw Error('Document belongs to a different native case');
  const origin={capture_file:file,capture_file_sha256,source_response_sha256:capture.response_sha256,retrieved_at:capture.retrieved_at,native_case_id:id,sort:capture.params.arguments.sort,native_record_sha256:sha(JSON.stringify(doc))};
  const prev=documents.get(doc.id);
  if(prev){prev.origins.push(origin);if(capture.retrieved_at>prev.retrieved_at){prev.data=doc;prev.retrieved_at=capture.retrieved_at;}}
  else documents.set(doc.id,{data:doc,native_case_id:id,retrieved_at:capture.retrieved_at,origins:[origin]});
 }
}
const rows=[];
for(const [id,row]of documents){
 const data=row.data;let heldReason=null,download=null;
 if(!qualified.has(row.native_case_id))heldReason='unresolved_firm_or_tracked_matter_scope';
 else if(!headers.has(row.native_case_id))heldReason='native_case_header_not_captured';
 else if(data.restricted!==false)heldReason=data.restricted===true?'provider_restricted':'provider_restriction_unknown';
 else if(data.downloaded!==1&&data.downloaded!==true)heldReason='provider_pdf_not_downloaded';
 else if(!data.pdf_url)heldReason='pdf_url_not_recorded';
 else{const u=new URL(data.pdf_url);if(u.protocol!=='https:'||u.hostname!=='docketbird-case-documents.s3.amazonaws.com'||u.username||u.password)heldReason='unapproved_provider_pdf_host';else download=u.href;}
 const selectedOrigin=[...row.origins].sort((a,b)=>b.retrieved_at.localeCompare(a.retrieved_at))[0];
 rows.push({schema_version:'source-qualified-pdf-queue/1',provider:'docketbird',native_document_id:id,native_case_id:row.native_case_id,durable_url:data.canonical_url??null,download_url:download,expected_sha1:null,expected_bytes:null,title:data.title??null,filing_date:data.filing_date??null,selected_source_record_sha256:selectedOrigin.native_record_sha256,provider_flags:{restricted:data.restricted,downloaded:data.downloaded},eligible:heldReason===null,held_reason:heldReason,scope_evidence:qualified.get(row.native_case_id)??[],origins:row.origins});
}
await fs.mkdir(out,{recursive:true});
const queue=Buffer.from(rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
await fs.writeFile(path.join(out,'docketbird-queue-v2.jsonl'),queue,{flag:'wx'});
const manifest={schema_version:'pdf-queue-preparation/1',prepared_at:new Date().toISOString(),provider:'docketbird',original_captures:captures.length,native_documents:rows.length,eligible:rows.filter(x=>x.eligible).length,held:rows.filter(x=>!x.eligible).length,qualified_case_scopes:qualified.size,scope_ambiguities:scopeHeld,queue_sha256:sha(queue),queue_bytes:queue.length,supabase_project:'xosqzzsnhxcyehcnirpa',bucket:'corpus-originals',pdf_downloads:0};
await fs.writeFile(path.join(out,'docketbird-queue-v2-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({nativeDocuments:manifest.native_documents,eligible:manifest.eligible,held:manifest.held,queueSha256:manifest.queue_sha256}));
