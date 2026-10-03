import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {validateMetadataPlanRow,validateOriginalMetadataBytes,metadataStorageKey} from './upload-original-metadata-to-supabase.mjs';
import {validateQueueRow,sourcePrivacyQualification} from './backfill-pdfs-to-supabase.mjs';
import {exactDocketReferenceCandidates,docketSheetMetadataCoverage} from './docketbird-metadata-contract.mjs';
import {nativeDocumentSourceVersionDisposition} from './native-document-version-contract.mjs';

// Offline packet preparation. Never loads credentials, calls a provider, or
// transfers files. Existing plans and queues are pinned and stay immutable.
const base='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02';
const sha=x=>createHash('sha256').update(x).digest('hex');
const queueFile=path.join(base,'pdf-library-v1/docketbird-queue-v2.jsonl');
const priorQueueSha='63388def0ea4f1b573fc8bfe59cc73dc3e476fd6063b00cf6152c7fdc19fde37';
const originalPlanFile=path.join(base,'metadata-originals-v2/original-metadata-upload-plan-v1.json');
const priorPlanSha='1bf6335dcd93c90564035a8ff5bee2c289eaa52662627fffca52f218db47c867';
const htmlManifestFile=path.join(base,'firecrawl-dockets/reviewed-v1/manifest.json');
const htmlManifestSha='d666a1ac1a50c0558fb18b99d64334e8fc4c5b08bfc8781c7b442cbffc667c35';
const tailDirectory=path.join(base,'docketbird/portfolio-tail-v1');
const outputPlan=path.join(base,'metadata-originals-tail-firecrawl-v1');
const outputQueue=path.join(base,'pdf-library-tail-v1');
async function pinned(file,expected){const b=await fs.readFile(file);if(sha(b)!==expected)throw Error('FROZEN_INPUT_HASH_MISMATCH');return b;}
const hash=createHash('sha256');for await(const b of createReadStream(queueFile))hash.update(b);if(hash.digest('hex')!==priorQueueSha)throw Error('PRIOR_QUEUE_HASH_MISMATCH');
const priorPlan=JSON.parse(await pinned(originalPlanFile,priorPlanSha));
const priorOriginalHashes=new Set(priorPlan.files.map(x=>x.sha256));
const htmlManifest=JSON.parse(await pinned(htmlManifestFile,htmlManifestSha));
const tailReceiptFile=path.join(tailDirectory,'tail-receipt.json'),tailReceiptBytes=await fs.readFile(tailReceiptFile),tailReceipt=JSON.parse(tailReceiptBytes);
if(tailReceipt.schema_version!=='docketbird-bounded-tail/1'||tailReceipt.status!=='selected_tail_finished'||tailReceipt.pdf_downloads!==0)throw Error('FINISHED_METADATA_TAIL_REQUIRED');
const candidatesFile=path.join(base,'docketbird/portfolio-backfill-v1/source-qualified-case-candidates.json');
const candidates=JSON.parse(await pinned(candidatesFile,tailReceipt.candidate_file_sha256));
const candidateMap=new Map(candidates.map(x=>[x.id,x]));
const originals=[],heldOriginals=[],duplicateOriginals=[],tailCaptures=[];
function parseResponse(capture){
 const raw=Buffer.from(capture.original_rpc_response??'');
 if(capture.schema_version!=='docketbird-mcp-capture/1'||capture.source_url!=='https://mcp.docketbird.com/mcp'||capture.http_status!==200||sha(raw)!==capture.response_sha256||raw.length!==capture.response_bytes)throw Error('CAPTURE_INTEGRITY_MISMATCH');
 const messages=raw.toString().startsWith('data:')?raw.toString().split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>JSON.parse(x.slice(5))):[JSON.parse(raw)];
 const result=messages.find(x=>x.result)?.result;if(!result||result.isError)return null;
 return result.structuredContent??JSON.parse(result.content.find(x=>x.type==='text').text);
}
async function considerOriginal(file,provider,kind,source_url,expected=null){
 const bytes=await fs.readFile(file),digest=sha(bytes);if(expected&&expected!==digest)throw Error('ORIGINAL_MANIFEST_HASH_MISMATCH');
 const row={provider,metadata_kind:kind,local_path:file,source_url,sha256:digest,bytes:bytes.length,storage_key:metadataStorageKey(digest),private_original_evidence:true,public_projection_allowed:false,publisher_wire_bytes_asserted:false};
 try{validateMetadataPlanRow(row,await fs.realpath(file));validateOriginalMetadataBytes(row,bytes);}catch(error){heldOriginals.push({source_file:file,provider,sha256:digest,bytes:bytes.length,reason:/^[A-Z_]+$/.test(error.message)?error.message:'CAPTURE_VALIDATION_HELD'});return;}
 if(priorOriginalHashes.has(digest)){duplicateOriginals.push({source_file:file,provider,sha256:digest,bytes:bytes.length,reason:'exact_original_bytes_already_in_frozen_plan'});return;}
 originals.push(row);
}
for(const name of(await fs.readdir(tailDirectory)).filter(x=>/^\d+-[a-f0-9]{64}\.json$/.test(x)).sort()){
 const file=path.join(tailDirectory,name),bytes=await fs.readFile(file),capture=JSON.parse(bytes);
 await considerOriginal(file,'docketbird','docketbird_mcp_capture_json','https://mcp.docketbird.com/mcp');
 if(capture.method==='tools/call'&&['get_case','get_docket_sheet'].includes(capture.params?.name)){
  const data=parseResponse(capture);if(data)tailCaptures.push({capture,file,capture_file_sha256:sha(bytes),data});
 }
}
for(const source of htmlManifest.original_capture_artifacts){
 const file=fileURLToPath(source.file_uri),stat=await fs.stat(file);if(stat.size!==source.bytes)throw Error('FIRECRAWL_ORIGINAL_SIZE_MISMATCH');
 await considerOriginal(file,'firecrawl','courtlistener_firecrawl_docket_html_json',source.source_url,source.sha256);
}

// Independently qualify the tail using retained native firm appearances or
// unique exact CourtListener firm-query references, never account tracking.
const hitsFile=path.join(base,'courtlistener/live-normalized/firm-search-hits.jsonl'),hitsBytes=await fs.readFile(hitsFile);
const hits=hitsBytes.toString().trim().split('\n').map(JSON.parse),clTargets=new Map();
for(const row of hits){const key=row.data.court_id+'|'+row.data.docketNumber,list=clTargets.get(key)??[];if(!list.some(x=>x.data.docket_id===row.data.docket_id))list.push(row);clTargets.set(key,list);}
const qualified=new Map(),qualificationCaptures=[];
function qualify(id,evidence){const list=qualified.get(id)??[];list.push(evidence);qualified.set(id,list);}
for(const directory of ['narrow-probe','master-probe','portfolio-backfill-v1']){
 const folder=path.join(base,'docketbird',directory);
 for(const name of(await fs.readdir(folder)).filter(x=>/^\d+-[a-f0-9]{64}\.json$/.test(x)).sort()){
  const file=path.join(folder,name),bytes=await fs.readFile(file),capture=JSON.parse(bytes);
  if(capture.method!=='tools/call'||!['find_litigation_relationships','search_cases'].includes(capture.params?.name))continue;
  const data=parseResponse(capture);if(!data)continue;
  const origin={capture_file:file,capture_file_sha256:sha(bytes),source_response_sha256:capture.response_sha256,retrieved_at:capture.retrieved_at};
  qualificationCaptures.push(origin);
  if(capture.params.name==='find_litigation_relationships')for(const [ordinal,row]of(data.records??[]).entries())if(row['lawfirm.law_firm_id']==='seegerweiss.com')qualify(row['case.case_id'],{...origin,kind:'provider_native_firm_appearance',law_firm_id:'seegerweiss.com',source_field:'records['+ordinal+']',source_record_sha256:sha(JSON.stringify(row)),publisher_native_merge:false});
  if(capture.params.name==='search_cases'){
   const nativeHits=clTargets.get(capture.params.arguments.court_id+'|'+capture.params.arguments.q);
   if(!nativeHits||nativeHits.length!==1)continue;
   const hit=nativeHits[0],resolution=exactDocketReferenceCandidates(hit.data,data.cases??[]);
   if(!resolution.definitive_association_allowed)continue;
   for(const row of resolution.matches)qualify(row.id,{...origin,kind:'exact_native_docket_reference',courtlistener_docket_id:String(hit.data.docket_id),courtlistener_source_provenance:hit.provenance,source_field:'cases['+(data.cases??[]).indexOf(row)+']',source_record_sha256:sha(JSON.stringify(row)),publisher_native_merge:false,firm_scope_qualification:'Exact CourtListener firm-index docket reference; not current representation, complete portfolio, or publisher-native merge.'});
  }
 }
}
const priorDocuments=new Map();
for await(const line of createInterface({input:createReadStream(queueFile),crlfDelay:Infinity})){
 if(!line.trim())continue;const row=JSON.parse(line);if(priorDocuments.has(row.native_document_id))throw Error('PRIOR_NATIVE_DOCUMENT_DUPLICATE');priorDocuments.set(row.native_document_id,row);
}
const headers=new Map(),docs=new Map(),scopeCoverage=[];
for(const item of tailCaptures){
 const {capture,file,capture_file_sha256,data}=item,id=capture.params.arguments.case_id;
 if(!tailReceipt.selected_native_cases.includes(id)||!candidateMap.has(id))throw Error('UNEXPECTED_TAIL_SCOPE');
 if(capture.params.name==='get_case'){
  if(data.case?.id!==id)throw Error('TAIL_NATIVE_HEADER_MISMATCH');headers.set(id,{file,capture_file_sha256,capture,data:data.case});continue;
 }
 const coverage=docketSheetMetadataCoverage(id,data);scopeCoverage.push({native_case_id:id,...Object.fromEntries(Object.entries(coverage).filter(([k])=>k!=='documents')),source_file:file,source_file_sha256:capture_file_sha256});
 for(const doc of data.documents){
  const origin={capture_file:file,capture_file_sha256,source_response_sha256:capture.response_sha256,retrieved_at:capture.retrieved_at,native_case_id:id,sort:capture.params.arguments.sort,native_record_sha256:sha(JSON.stringify(doc)),native_record_sha256_codec:'original-native-document-JSON.stringify-utf8/1'};
  const old=docs.get(doc.id);if(old){if(old.native_case_id!==id)throw Error('TAIL_NATIVE_DOCUMENT_PARENT_CONFLICT');old.origins.push(origin);if(capture.retrieved_at>old.retrieved_at)Object.assign(old,{data:doc,retrieved_at:capture.retrieved_at});}else docs.set(doc.id,{data:doc,native_case_id:id,retrieved_at:capture.retrieved_at,origins:[origin]});
 }
}
const queue=[],duplicates=[],changedVersions=[],heldReasons={},classification={new_native_document_ids:0,existing_native_id_new_metadata_version:0,duplicate_native_identity_and_selected_sha:0};
for(const[id,item]of[...docs].sort(([a],[b])=>a.localeCompare(b))){
 const data=item.data,origin=[...item.origins].sort((a,b)=>b.retrieved_at.localeCompare(a.retrieved_at))[0],old=priorDocuments.get(id);
 const disposition=nativeDocumentSourceVersionDisposition({provider:'docketbird',native_document_id:id,native_case_id:item.native_case_id,selected_source_record_sha256:origin.native_record_sha256},old);
 if(disposition==='exact_native_source_version_duplicate'){classification.duplicate_native_identity_and_selected_sha++;duplicates.push({native_document_id:id,native_case_id:item.native_case_id,selected_source_record_sha256:origin.native_record_sha256,origins:item.origins});continue;}
 if(old){classification.existing_native_id_new_metadata_version++;changedVersions.push({native_document_id:id,native_case_id:item.native_case_id,prior_selected_source_record_sha256:old.selected_source_record_sha256,new_selected_source_record_sha256:origin.native_record_sha256,pdf_byte_identity:'unknown_without_actual_body_hash',historical_version_retained:true});}else classification.new_native_document_ids++;
 let reason=null,url=null;
 if(!qualified.has(item.native_case_id))reason='unresolved_firm_or_tracked_matter_scope';
 else if(!headers.has(item.native_case_id))reason='native_case_header_not_captured';
 else if(data.restricted!==false)reason=data.restricted===true?'provider_restricted':'provider_restriction_unknown';
 else if(data.downloaded!==1&&data.downloaded!==true)reason='provider_pdf_not_downloaded';
 else if(!data.pdf_url)reason='pdf_url_not_recorded';
 else{const u=new URL(data.pdf_url);if(u.protocol!=='https:'||u.hostname!=='docketbird-case-documents.s3.amazonaws.com'||u.port||u.username||u.password)reason='unapproved_provider_pdf_host';else url=u.href;}
 if(reason)heldReasons[reason]=(heldReasons[reason]??0)+1;
 const row={schema_version:'source-qualified-pdf-queue/1',provider:'docketbird',native_document_id:id,native_case_id:item.native_case_id,durable_url:data.canonical_url??null,download_url:url,expected_sha1:null,expected_bytes:null,title:data.title??null,filing_date:data.filing_date??null,selected_source_record_sha256:origin.native_record_sha256,provider_flags:{restricted:data.restricted,downloaded:data.downloaded},eligible:reason===null,held_reason:reason,scope_evidence:qualified.get(item.native_case_id)??[],origins:item.origins,source_version_disposition:old?'new_metadata_observation_existing_native_document':'new_native_document_metadata',prior_selected_source_record_sha256:old?.selected_source_record_sha256??null,provenance:{tail_receipt_sha256:sha(tailReceiptBytes),candidate_file_sha256:tailReceipt.candidate_file_sha256,prior_queue_sha256:priorQueueSha,source_metadata_hash_not_pdf_checksum:true,publisher_native_merge:false,public_projection_allowed:false}};
 if(row.eligible){validateQueueRow(row);row.source_privacy_qualification=sourcePrivacyQualification(row);}else row.source_privacy_qualification={source_seal_status:'not_asserted',private_quarantine_required:true,public_projection_allowed:false};
 queue.push(row);
}
if(docs.size!==260)throw Error('EXPECTED_TAIL_DOCUMENT_SCOPE_MISMATCH');
const preparedAt=new Date().toISOString();
const originalPlan={schema_version:'source-qualified-original-metadata-plan/1',created_at:preparedAt,project_id:'xosqzzsnhxcyehcnirpa',bucket:'corpus-originals',source_qualification:'Disjoint recognized native DocketBird portfolio-tail metadata captures and successful exact-source CourtListener Firecrawl HTML wrapper originals. Provider representation bytes; not publisher HTTP wire, not PDF bodies, and never public.',source_inputs:{prior_plan_file:originalPlanFile,prior_plan_sha256:priorPlanSha,tail_receipt_file:tailReceiptFile,tail_receipt_sha256:sha(tailReceiptBytes),firecrawl_manifest_file:htmlManifestFile,firecrawl_manifest_sha256:htmlManifestSha},files:originals};
const originalPlanBytes=Buffer.from(JSON.stringify(originalPlan,null,2)+'\n'),queueBytes=Buffer.from(queue.map(x=>JSON.stringify(x)).join('\n')+'\n');
const receipt={schema_version:'seeger-weiss-tail-packets-receipt/1',prepared_at:preparedAt,source_inputs:{...originalPlan.source_inputs,candidate_file:candidatesFile,candidate_file_sha256:tailReceipt.candidate_file_sha256,firm_search_hits_file:hitsFile,firm_search_hits_sha256:sha(hitsBytes),prior_queue_file:queueFile,prior_queue_sha256:priorQueueSha},metadata_original_files:originals.length,metadata_original_bytes:originals.reduce((n,x)=>n+x.bytes,0),metadata_original_counts_by_provider:Object.fromEntries(['docketbird','firecrawl'].map(p=>[p,originals.filter(x=>x.provider===p).length])),metadata_originals_held:heldOriginals,metadata_originals_exact_duplicate_bytes:duplicateOriginals,tail_native_case_headers:headers.size,tail_document_metadata_scopes:scopeCoverage.length,tail_native_document_metadata:docs.size,pdf_queue_rows:queue.length,pdf_queue_eligible:queue.filter(x=>x.eligible).length,pdf_queue_held:queue.filter(x=>!x.eligible).length,pdf_held_reasons:heldReasons,...classification,scope_coverage:scopeCoverage,tail_case_acquisition_holds:Object.entries(tailReceipt.cases).filter(([,v])=>v.status==='held').map(([native_case_id,v])=>({native_case_id,status:v.status,error_type:v.error==='DocketBird MCP HTTP 500'?'source_http_500':'source_acquisition_held'})),qualification_capture_count:qualificationCaptures.length,metadata_plan_sha256:sha(originalPlanBytes),metadata_plan_bytes:originalPlanBytes.length,queue_sha256:sha(queueBytes),queue_bytes:queueBytes.length,pdf_downloads:0,metadata_uploads:0,database_writes:0,api_calls:0,qualification:'All counts are exact captured source metadata, not current membership, active representation, outcomes, complete provider portfolio or actual PDF acquisition. Native+selected-source-SHA comparison never implies PDF byte equivalence. Historical source versions remain intact.'};
await fs.mkdir(outputPlan);await fs.mkdir(outputQueue);
await fs.writeFile(path.join(outputPlan,'original-metadata-upload-plan-v1.json'),originalPlanBytes,{flag:'wx'});
await fs.writeFile(path.join(outputQueue,'docketbird-tail-queue-v1.jsonl'),queueBytes,{flag:'wx'});
await fs.writeFile(path.join(outputQueue,'exact-version-duplicates-v1.json'),JSON.stringify(duplicates,null,2)+'\n',{flag:'wx'});
await fs.writeFile(path.join(outputQueue,'changed-source-versions-v1.json'),JSON.stringify(changedVersions,null,2)+'\n',{flag:'wx'});
for(const folder of[outputPlan,outputQueue])await fs.writeFile(path.join(folder,'tail-packet-receipt-v1.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...receipt,source_inputs:undefined,scope_coverage:undefined,metadata_originals_held:heldOriginals.map(x=>({provider:x.provider,reason:x.reason})),metadata_originals_exact_duplicate_bytes:duplicateOriginals.length}));
