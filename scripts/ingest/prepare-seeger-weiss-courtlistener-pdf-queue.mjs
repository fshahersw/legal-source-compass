import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {once} from 'node:events';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {canonicalIntegerJson,hashBytes} from '../admin/local-catalog-evidence-contract.mjs';
import {validateQueueRow,sourcePrivacyQualification} from './backfill-pdfs-to-supabase.mjs';

const SEED_SHA256='01ce71081bb11c6919fe35fc4aafc5349f1725e57cbc7369ca39d47bcc17d72f';
const ROOT='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02';
const DEFAULT_SEED=path.join(ROOT,'tavily/reviewed-v1/courtlistener-private-pdf-seeds-v2.jsonl');
const DEFAULT_OUT=path.join(ROOT,'pdf-library-v1/courtlistener-queue-v1.jsonl');
export function removeOriginDownloadLocators(value){
 if(Array.isArray(value))return value.map(removeOriginDownloadLocators);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
  .filter(([key])=>!/^(download_url|pdf_url)$/i.test(key))
  .map(([key,val])=>[key,removeOriginDownloadLocators(val)]));
 return value;
}
export function adaptCourtListenerSeed(seed,{seedFileUri,seedFileSha256,sourceRecordOrdinal}){
 assert.equal(seed.provider,'courtlistener');assert.equal(typeof seed.queue_eligible,'boolean');
 assert.equal(seed.public_projection_allowed,false);assert.equal(seed.native_identity_conflict,false);
 assert.equal(seed.native_record_sha256,seed.selected_source_record_sha256);
 assert.equal(seed.native_record_sha256,seed.provenance.source_nested_document_sha256);
 assert(/^[a-f0-9]{64}$/.test(seed.native_record_sha256));
 assert(seed.all_origin_observations.length>0);
 const origins=seed.all_origin_observations.map(original=>{
  const origin=removeOriginDownloadLocators(original);
  assert.equal(origin.native_case_id,seed.native_case_id);
  assert.equal(origin.native_record_sha256,origin.source_nested_document_sha256);
  assert(/^[a-f0-9]{64}$/.test(origin.source_sha256));
  assert(Number.isFinite(Date.parse(origin.retrieved_at)));
  const capture=fileURLToPath(origin.source_capture_file_uri);
  return {...origin,capture_file:capture,capture_file_sha256:origin.source_sha256,
   source_response_sha256:origin.source_sha256};
 });
 assert(origins.some(o=>o.native_record_sha256===seed.selected_source_record_sha256));
 const row={
  schema_version:'source-qualified-pdf-queue/1',provider:'courtlistener',
  native_document_id:seed.native_document_id,native_case_id:seed.native_case_id,
  durable_url:seed.durable_url,download_url:seed.download_url,
  expected_sha1:seed.expected_sha1,expected_bytes:seed.expected_bytes,
  title:null,filing_date:seed.source_entry_date_filed,
  selected_source_record_sha256:seed.selected_source_record_sha256,
  provider_flags:{is_available:seed.is_available,is_sealed:seed.is_sealed},
  eligible:seed.queue_eligible,held_reason:seed.queue_eligible?null:seed.unavailable_reason,
  seal_status_unknown:seed.seal_status_unknown,
  scope_evidence:[removeOriginDownloadLocators(seed.provenance.firm_index_scope_evidence)],
  origins,
  provenance:removeOriginDownloadLocators({
   source_seed_file_uri:seedFileUri,source_seed_file_sha256:seedFileSha256,
   source_seed_record_ordinal:sourceRecordOrdinal,source_seed_record_sha256:seed.record_sha256,
   native_record_hash_codec:seed.native_record_hash_codec,
   source_selection_rule:seed.selected_observation_rule,
   source_selected_origin:seed.provenance,
   adapter_version:'seeger-weiss-courtlistener-pdf-queue/1',
   metadata_only_adapter:true,pdf_transfers:0
  })
 };
 row.source_privacy_qualification=sourcePrivacyQualification(row);
 if(row.eligible)validateQueueRow(row);
 if(row.seal_status_unknown){
  assert.equal(row.provider_flags.is_sealed,null);
  assert.equal(row.source_privacy_qualification.private_quarantine_required,true);
  assert.equal(row.source_privacy_qualification.public_projection_allowed,false);
 }
 return row;
}
async function main(){
 const args=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf('=');return i<0?[s.slice(2),true]:[s.slice(2,i),s.slice(i+1)];}));
 const seedFile=path.resolve(String(args.seed??DEFAULT_SEED));const output=path.resolve(String(args.output??DEFAULT_OUT));
 const seedBytes=fs.readFileSync(seedFile);assert.equal(hashBytes(seedBytes),SEED_SHA256,'Frozen seed checksum mismatch');
 const expectedRecordCount=23745,expectedEligibleCount=12907;
 fs.mkdirSync(path.dirname(output),{recursive:true});
 const tmp=output+'.prepared-part';const stream=fs.createWriteStream(tmp,{flags:'wx'});
 let ordinal=0,eligible=0,unknownEligible=0,unsealedEligible=0,held=0;
 for await(const line of readline.createInterface({input:fs.createReadStream(seedFile),crlfDelay:Infinity})){
  if(!line)continue;ordinal++;const seed=JSON.parse(line);const {record_sha256,...payload}=seed;
  assert.equal(hashBytes(canonicalIntegerJson(payload)),record_sha256);
  const row=adaptCourtListenerSeed(seed,{seedFileUri:pathToFileURL(seedFile).href,seedFileSha256:SEED_SHA256,sourceRecordOrdinal:ordinal});
  if(row.eligible){eligible++;if(row.provider_flags.is_sealed===null)unknownEligible++;else unsealedEligible++;}else held++;
  if(!stream.write(JSON.stringify(row)+'\n'))await once(stream,'drain');
 }
 stream.end();await once(stream,'finish');
 assert.equal(ordinal,expectedRecordCount);assert.equal(eligible,expectedEligibleCount);
 fs.renameSync(tmp,output);
 const queueBytes=fs.readFileSync(output);
 const manifest={schema_version:'seeger-weiss-courtlistener-pdf-queue-adapter/1',generated_at:new Date().toISOString(),
  original_seed:{path:seedFile.replaceAll('\\','/'),sha256:SEED_SHA256,bytes:seedBytes.length,records:ordinal},
  queue:{path:output.replaceAll('\\','/'),sha256:hashBytes(queueBytes),bytes:queueBytes.length,records:ordinal},
  counts:{eligible,eligible_unknown_seal_private_quarantine:unknownEligible,eligible_explicit_unsealed:unsealedEligible,held},
  qualification:'Pure local adapter. All nested origins/provenance download_url/pdf_url keys removed. Expected PDF SHA1/size remain publisher claims; original metadata/source hashes and exact seed ordinal preserved. No API, DB, PDF transfer or seed mutation.',
  worker_validator:'scripts/ingest/backfill-pdfs-to-supabase.mjs validateQueueRow/sourcePrivacyQualification; all eligible rows passed',
  pdf_transfers:0,new_api_requests:0};
 const manifestPath=path.join(path.dirname(output),'courtlistener-queue-v1-manifest.json');
 fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify(manifest,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 main().catch(error=>{console.error('CourtListener queue adapter stopped:',error.code??error.message.split('\n')[0]);process.exitCode=1;});
}

