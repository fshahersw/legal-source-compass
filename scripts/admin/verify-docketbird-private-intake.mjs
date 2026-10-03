import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const PROJECT='xosqzzsnhxcyehcnirpa',RPC='corpus_admin_docketbird_run_proof_v1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixedRuns=new Set(['45d9fecf-33f4-403a-ae8d-a3b1559657d3','3eb56bc3-0d7d-4159-8b30-64d342a5febb']);
const argsOf=()=>Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];}));
const failure=code=>{throw Error(code);};
export function verifyDocketbirdProofPage(proof,page,expectations){
 if(proof.run_id!==expectations.run_id||proof.private_only!==true||proof.read_only!==true||proof.page_records!==page.expected_page_records||proof.first_native_id!==page.expected_first_native_id||proof.last_native_id!==page.expected_last_native_id||proof.page_payload_provenance_sha256!==page.expected_payload_provenance_page_sha256)failure('PAGE_IDENTITY_OR_FULL_PROVENANCE_FINGERPRINT_MISMATCH');
 if(expectations.required_page_equal_record_counts.some(k=>proof[k]!==page.expected_page_records)||expectations.required_page_zero_counts.some(k=>proof[k]!==0)||proof.declared_source_occurrences!==page.expected_source_occurrences||proof.lineage_entries!==page.expected_lineage_entries)failure('PAGE_CANONICAL_STORAGE_LINEAGE_OR_PRIVATE_GATE_MISMATCH');
 return true;
}
export function verifyDocketbirdGlobalProof(global,expectations){
 if(!global)failure('GLOBAL_PROOF_REQUIRED');
 const required={expected_observations:expectations.expected_observations,expected_source_occurrences:expectations.expected_source_occurrences,run_observations:expectations.expected_observations,distinct_document_ids:expectations.expected_distinct_document_ids,wrong_source_or_type_or_endpoint:0,run_version_rows:expectations.expected_run_versions,run_current_entity_rows:expectations.expected_current_entities,preserved_source_occurrences:expectations.expected_source_occurrences,distinct_source_record_ordinals:expectations.expected_source_occurrences,min_source_record_ordinal:1,max_source_record_ordinal:expectations.expected_source_occurrences,invalid_or_out_of_range_ordinals:0,run_relationship_writes:0,private_tables_with_rls:4,anon_or_authenticated_private_select_grants:0,source_manifest_sha256:expectations.source_manifest_sha256,original_input_sha256:expectations.original_input_sha256};
 if(Object.entries(required).some(([k,v])=>global[k]!==v))failure('GLOBAL_COUNTS_ORDINALS_SCOPE_OR_PRIVATE_RELEASE_MISMATCH');return true;
}
export async function parseDocketbirdProofResponse(response){
 if(!response.ok)throw Object.assign(Error('KNOWN_HTTP_PROOF_REJECTED'),{httpStatus:response.status});
 let proof;try{proof=await response.json();}catch{throw Object.assign(Error('KNOWN_HTTP_PROOF_BODY_UNREADABLE'),{httpStatus:response.status});}
 if(!proof||typeof proof!=='object'||Array.isArray(proof))throw Object.assign(Error('KNOWN_HTTP_PROOF_SHAPE_INVALID'),{httpStatus:response.status});return proof;
}
function loadExpectations(file,pinnedSHA){
 const bytes=fs.readFileSync(file);if(!/^[a-f0-9]{64}$/.test(pinnedSHA??'')||sha(bytes)!==pinnedSHA)failure('FROZEN_EXPECTATION_HASH_MISMATCH');const e=JSON.parse(bytes);
 if(e.schema_version!=='docketbird-frozen-paginated-proof-expectations/1'||e.project_id!==PROJECT||!fixedRuns.has(e.run_id)||e.rpc_function!==RPC||e.private_only!==true||!Array.isArray(e.pages)||!e.pages.length)failure('FROZEN_EXPECTATION_SCOPE_REQUIRED');
 let rows=0,occurrences=0,last=null;
 for(const p of e.pages){if(p.p_limit!==1000||p.p_after_native_id!==last||!Number.isSafeInteger(p.expected_page_records)||p.expected_page_records<1||p.expected_page_records>1000||typeof p.expected_last_native_id!=='string'||(last!==null&&p.expected_first_native_id<=last)||p.expected_first_native_id>p.expected_last_native_id||!/^[a-f0-9]{64}$/.test(p.expected_payload_provenance_page_sha256)||p.expected_source_occurrences!==p.expected_lineage_entries)failure('EXPECTED_PAGE_ORDER_OR_GRAIN_MISMATCH');rows+=p.expected_page_records;occurrences+=p.expected_source_occurrences;last=p.expected_last_native_id;}
 if(rows!==e.expected_observations||occurrences!==e.expected_source_occurrences||e.final_empty_page_after_native_id!==last)failure('EXPECTED_PAGE_SUM_MISMATCH');return e;
}
async function main(){
 const args=argsOf(),file=path.resolve(String(args.expectations)),e=loadExpectations(file,args['expectations-sha256']);
 if(args.execute!==true){if(args.execute!==undefined)failure('EXPLICIT_EXECUTE_FLAG_REQUIRED');console.log(JSON.stringify({state:'frozen_expectations_verified',pages:e.pages.length,records:e.expected_observations,sourceOccurrences:e.expected_source_occurrences,run:e.run_id,databaseCalls:0}));return;}
 const cfg=JSON.parse(fs.readFileSync(String(args.credentials),'utf8'));if(cfg.EXTERNAL_SUPABASE_URL!==`https://${PROJECT}.supabase.co`)failure('WRONG_PROJECT');const token=cfg.EXTERNAL_SUPABASE_KEY;
 if(typeof token!=='string')failure('SERVER_ROLE_REQUIRED');if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.ref!==PROJECT||claims.role!=='service_role')failure('SERVER_ROLE_REQUIRED');}else if(!token.startsWith('sb_secret_'))failure('SERVER_ROLE_REQUIRED');
 const target=path.resolve(String(args.receipt));if(fs.existsSync(target)||fs.existsSync(target+'.partial'))failure('FRESH_VERIFICATION_RECEIPT_REQUIRED');
 const receipt={schemaVersion:'docketbird-private-paginated-database-proof/1',projectId:PROJECT,runId:e.run_id,expectationsSha256:args['expectations-sha256'],startedAt:new Date().toISOString(),pages:[],complete:false,databaseWrites:0,privateOnly:true};
 const save=()=>{const tmp=target+'.partial';const fd=fs.openSync(tmp,'w');try{fs.writeFileSync(fd,JSON.stringify(receipt,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,target);};save();
 const headers={apikey:token,'Content-Type':'application/json',...(!token.startsWith('sb_')?{Authorization:'Bearer '+token}:{})};
 const call=async(after)=>parseDocketbirdProofResponse(await fetch(cfg.EXTERNAL_SUPABASE_URL+'/rest/v1/rpc/'+RPC,{method:'POST',headers,body:JSON.stringify({p_run:e.run_id,p_after_native_id:after,p_limit:1000}),redirect:'error',signal:AbortSignal.timeout(90000)}));
 const pageKeys=['run_id','page_records','first_native_id','last_native_id','versions_present','canonical_payloads_exact','storage_hashes_exact','native_source_identities_exact','observation_columns_exact','source_scopes_exact','current_entities_exact','private_gate_failures','declared_source_occurrences','lineage_entries','lineage_count_mismatches','selected_lineage_mismatches','invalid_lineage_entries','page_payload_provenance_sha256','private_only','read_only','global_checks'];
 try{
  for(const page of e.pages){const proof=await call(page.p_after_native_id);verifyDocketbirdProofPage(proof,page,e);if(page.page_index===1)verifyDocketbirdGlobalProof(proof.global_checks,e);receipt.pages.push(Object.fromEntries(pageKeys.filter(k=>Object.hasOwn(proof,k)).map(k=>[k,proof[k]])));save();console.log(JSON.stringify({verifiedPages:receipt.pages.length,totalPages:e.pages.length,verifiedRecords:receipt.pages.reduce((n,p)=>n+p.page_records,0)}));}
  const final=await call(e.final_empty_page_after_native_id);if(final.run_id!==e.run_id||final.page_records!==0||final.first_native_id!==null||final.last_native_id!==null||final.page_payload_provenance_sha256!==sha('')||final.read_only!==true||final.private_only!==true)failure('FINAL_EMPTY_PAGE_MISMATCH');verifyDocketbirdGlobalProof(final.global_checks,e);
  receipt.finalGlobalProof=final.global_checks;receipt.verifiedRecords=receipt.pages.reduce((n,p)=>n+p.page_records,0);receipt.verifiedSourceOccurrences=receipt.pages.reduce((n,p)=>n+p.lineage_entries,0);receipt.complete=true;receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({state:'private_database_intake_independently_verified',run:e.run_id,records:receipt.verifiedRecords,sourceOccurrences:receipt.verifiedSourceOccurrences,fullProvenanceFingerprintsMatched:true,canonicalHashesVerified:true,relationshipWrites:0,publicRelease:false,databaseWrites:0}));
 }catch(error){receipt.stopReason=/^[A-Z_]+$/.test(error.message)?error.message:'READ_ONLY_DATABASE_PROOF_FAILED';if(Number.isInteger(error.httpStatus))receipt.httpStatus=error.httpStatus;receipt.stoppedAt=new Date().toISOString();save();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('Private read-only verification stopped; inspect its private receipt. Credentials and source payloads withheld.');process.exitCode=1;});
