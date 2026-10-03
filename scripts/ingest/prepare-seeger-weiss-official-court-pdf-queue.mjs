import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {canonicalIntegerJson,hashBytes} from '../admin/local-catalog-evidence-contract.mjs';
import {validateQueueRow,sourcePrivacyQualification} from './backfill-pdfs-to-supabase.mjs';

const ROOT='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02';
const SOURCE_DIR=path.join(ROOT,'tavily/reviewed-v1');
const OUT_DIR=path.join(ROOT,'pdf-library-v1');
const SEED_SHA='8f8874b8af8a96f26b1d14ef87ac8afdbb20ad2a8e09252fdd7a36989df57763';
const RECORD_SHA='c9513377ba4d88239094848935d8e0ed2e4e0ff76675bdc245e24e63c7b9677a';
const ALLOWED_HOSTS=new Set(['www.flnd.uscourts.gov','www.paed.uscourts.gov','www.azd.uscourts.gov','www.ilsd.uscourts.gov','www.njd.uscourts.gov']);
const readRows=file=>fs.readFileSync(file,'utf8').trimEnd().split('\n').filter(Boolean).map(JSON.parse);
const captureCache=new Map();
function verifiedCapture(source){
 const file=fileURLToPath(source.source_capture_file_uri);
 if(!captureCache.has(file)){
  const bytes=fs.readFileSync(file);captureCache.set(file,{file,bytes,sha256:hashBytes(bytes),capture:JSON.parse(bytes)});
 }
 const c=captureCache.get(file);assert.equal(c.sha256,source.source_capture_sha256);
 const result=c.capture.response.structuredContent.results[source.source_result_ordinal-1];
 assert.equal(result.url,source.source_url);assert.equal(hashBytes(result.raw_content),source.source_content_sha256);
 assert.equal(c.capture.observed_at??c.capture.requested_at??c.capture.started_at,source.observed_at);
 return {...c,raw:result.raw_content};
}
function codepointSlice(s,a,b){return Array.from(s).slice(a,b).join('');}
function verifyMasterAssertion(assertion){
 const c=verifiedCapture(assertion.source);
 assert.equal(assertion.field,'master_docket_literal');
 assert.equal(assertion.value,assertion.evidence_text);
 assert.equal(codepointSlice(c.raw,assertion.evidence_start_codepoint,assertion.evidence_end_codepoint),assertion.value);
 assert.equal(hashBytes(assertion.evidence_text),assertion.evidence_sha256);
 assert(new URL(assertion.source.source_url).hostname.endsWith('.uscourts.gov'));
 return assertion;
}
function noNestedDownloadKeys(value){
 if(Array.isArray(value))return value.map(noNestedDownloadKeys);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
  .filter(([key])=>!/^(download_url|pdf_url)$/i.test(key))
  .map(([key,val])=>[key,noNestedDownloadKeys(val)]));
 return value;
}
async function main(){
 const seedFile=path.join(SOURCE_DIR,'pdf-document-locator-seeds.jsonl');
 const recordFile=path.join(SOURCE_DIR,'reviewed-records.jsonl');
 const seedBytes=fs.readFileSync(seedFile),recordBytes=fs.readFileSync(recordFile);
 assert.equal(hashBytes(seedBytes),SEED_SHA);assert.equal(hashBytes(recordBytes),RECORD_SHA);
 const seeds=readRows(seedFile),records=readRows(recordFile);assert.equal(seeds.length,313);assert.equal(records.length,419);
 const byId=new Map(records.map((record,i)=>[record.native_id,{record,ordinal:i+1}]));
 const masters=new Map();
 for(const record of records){
  assert.equal(hashBytes(canonicalIntegerJson(record.data)),record.provenance.record_sha256);
  if(record.entity_type==='sw_matter_research_scope'){
   const assertions=record.data.assertions.filter(a=>a.field==='master_docket_literal');
   assert(assertions.length<=1);
   if(assertions.length)masters.set(record.native_id,verifyMasterAssertion(assertions[0]));
  }
 }
 const queue=[],excluded=[],ids=new Set(),countsByHost={},countsByScope={};
 for(const [index,seed]of seeds.entries()){
  const url=new URL(seed.url);
  const reasons=[];
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)reasons.push('not_bare_https_public_locator');
  if(!ALLOWED_HOSTS.has(url.hostname))reasons.push('host_not_in_exact_public_court_allowlist');
  if(url.hostname.startsWith('ecf.')||seed.is_ecf_document_locator)reasons.push('paid_or_login_ecf_locator_excluded');
  if(!url.pathname.toLowerCase().endsWith('.pdf'))reasons.push('not_direct_pdf_path');
  if(seed.sealing_related_locator_held!==false)reasons.push('sealing_related_locator_held');
  if(reasons.length){excluded.push({seed_ordinal:index+1,source_record_id:seed.source_record_id,url:seed.url,reasons});continue;}
  assert(!ids.has(seed.url));ids.add(seed.url);
  const selected=byId.get(seed.source_record_id);assert(selected);
  assert.equal(selected.record.entity_type,'sw_court_document_index_locator');
  assert.equal(selected.record.provenance.record_sha256,seed.source_record_sha256);
  assert.equal(selected.record.data.matter_scope,seed.matter_scope);
  assert.equal(selected.record.data.sealing_related_locator_held,false);
  assert(selected.record.data.source_document_links.some(l=>l.url===seed.url&&l.label===seed.document_label));
  const master=masters.get(seed.matter_scope)??null;
  const nativeCase=master?.value??null;
  const origins=seed.source_record_ids.map(id=>{
   const item=byId.get(id);assert(item);const record=item.record,p=record.provenance;
   assert(record.data.source_document_links.some(link=>link.url===seed.url));
   const c=verifiedCapture(p);
   const span=codepointSlice(c.raw,record.data.source_span_start,record.data.source_span_end);
   assert(span.includes(seed.url)||span.includes(url.pathname));
   if(record.data.source_row_original_sha256)assert.equal(hashBytes(span),record.data.source_row_original_sha256);
   return noNestedDownloadKeys({
    native_document_id:seed.url,native_case_id:nativeCase,
    native_record_sha256:p.record_sha256,
    native_record_hash_codec:'extracted-court-index-locator-json/1',
    native_record_hash_serialization:'canonical-integer-jsonb/1 of frozen reviewed source record data',
    native_record_identity_kind:'normalized_court_index_locator_evidence_not_publisher_docket_document_number',
    source_url:p.source_url,source_sha256:p.source_capture_sha256,
    source_response_sha256:p.source_capture_sha256,
    source_response_hash_semantics:'SHA256 of original saved provider JSON capture; not HTTP wire/HTML bytes',
    capture_file:c.file,capture_file_sha256:p.source_capture_sha256,
    source_page_content_sha256:p.source_content_sha256,
    source_page_content_codec:p.source_content_codec,
    retrieved_at:p.observed_at,
    retrieved_at_basis:'provider_capture_observation_timestamp_not_pdf_download_time',
    source_capture_result_ordinal:p.source_result_ordinal,
    source_index_locator:p.source_locator,
    frozen_source_record_id:id,
    frozen_source_record_file_uri:pathToFileURL(recordFile).href,
    frozen_source_record_file_sha256:RECORD_SHA,
    frozen_source_record_ordinal:item.ordinal
   });
  });
  const row={
   schema_version:'source-qualified-pdf-queue/1',provider:'official-court',
   native_document_id:seed.url,native_document_identity_kind:'publisher_observed_pdf_locator_url',
   native_case_id:nativeCase,native_case_identity_kind:nativeCase?'exact_sourced_master_docket_literal':'not_recorded',
   durable_url:seed.url,download_url:seed.url,
   expected_sha1:null,expected_bytes:null,title:seed.document_label,filing_date:null,
   selected_source_record_sha256:seed.source_record_sha256,
   provider_flags:{sealing_related_locator_held:false,pdf_http_access_verified:false,pdf_content_verified:false},
   eligible:true,held_reason:null,
   source_claims:{matter_scope:seed.matter_scope,source_document_label:seed.document_label,
    index_date_iso:seed.index_date_iso,date_semantics:seed.date_semantics,
    date_is_verified_native_filing_date:false,pdf_content_verified:false,source_metadata_only:true},
   scope_evidence:master?[noNestedDownloadKeys({...master,evidence_kind:'exact_master_docket_literal_in_primary_court_page'})]:[],
   origins,
   provenance:noNestedDownloadKeys({source_seed_file_uri:pathToFileURL(seedFile).href,
    source_seed_file_sha256:SEED_SHA,source_seed_record_ordinal:index+1,
    source_seed_record_id:seed.source_record_id,source_record_sha256:seed.source_record_sha256,
    adapter_version:'seeger-weiss-official-court-pdf-queue/1',
    exact_official_host_allowlist:[...ALLOWED_HOSTS],ecf_paid_login_excluded:true,
    native_document_identity_is_source_locator:true,expected_pdf_checksum_and_size:'not_recorded',
    new_api_requests:0,pdf_transfers:0})
  };
  row.source_privacy_qualification=sourcePrivacyQualification(row);
  validateQueueRow(row);
  assert(origins.some(o=>o.native_record_sha256===row.selected_source_record_sha256));
  queue.push(row);countsByHost[url.hostname]=(countsByHost[url.hostname]??0)+1;countsByScope[seed.matter_scope]=(countsByScope[seed.matter_scope]??0)+1;
 }
 assert.equal(queue.length+excluded.length,seeds.length);
 fs.mkdirSync(OUT_DIR,{recursive:true});
 const output=path.join(OUT_DIR,'official-court-queue-v1.jsonl');
 const bytes=Buffer.from(queue.map(r=>JSON.stringify(r)+'\n').join(''));fs.writeFileSync(output,bytes,{flag:'wx'});
 const excludedFile=path.join(OUT_DIR,'official-court-queue-v1-excluded.json');fs.writeFileSync(excludedFile,JSON.stringify(excluded,null,2)+'\n',{flag:'wx'});
 const manifest={schema_version:'seeger-weiss-official-court-pdf-queue-adapter/1',generated_at:new Date().toISOString(),
  frozen_sources:[{path:seedFile,sha256:SEED_SHA,bytes:seedBytes.length,records:313},{path:recordFile,sha256:RECORD_SHA,bytes:recordBytes.length,records:419}],
  queue:{path:output,sha256:hashBytes(bytes),bytes:bytes.length,records:queue.length},
  counts:{eligible:queue.length,excluded:excluded.length,exact_sourced_master_literal:queue.filter(r=>r.native_case_id!==null).length,
   master_literal_not_recorded:queue.filter(r=>r.native_case_id===null).length,source_provider_capture_files_verified:captureCache.size},
  counts_by_host:countsByHost,counts_by_matter_scope:countsByScope,
  excluded_artifact:{path:excludedFile,sha256:hashBytes(fs.readFileSync(excludedFile))},
  qualification:'Direct public official-court PDF locators only. ECF/login and sealing-related rows excluded. URL is observed native locator identity, not an invented case/document number. PDF body, access, checksum, bytes and native filing-date status remain unverified. No network, database or PDF transfer.',
  new_api_requests:0,pdf_transfers:0};
 fs.writeFileSync(path.join(OUT_DIR,'official-court-queue-v1-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(manifest,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 main().catch(error=>{console.error('Official court queue preparation stopped:',error.code??error.message.split('\n')[0]);process.exitCode=1;});
}

