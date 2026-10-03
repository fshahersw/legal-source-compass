import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {canonicalIntegerJson} from './local-catalog-evidence-contract.mjs';

const PROJECT='xosqzzsnhxcyehcnirpa',RPC='corpus_admin_docketbird_evidence_v1';
const sha=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const argsOf=()=>Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];}));
function pinned(file){const bytes=fs.readFileSync(file.path??file.file);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('PINNED_FILE_MISMATCH');return bytes;}
export function decodeDocketbirdGroup(job,plan){
 if(job.function!==RPC||job.format!=='json-array'||job.bytes>480000||!Number.isSafeInteger(job.records)||job.records<1||job.records>100)throw Error('BOUNDED_GROUP_REQUIRED');
 const rows=JSON.parse(pinned(job));if(!Array.isArray(rows)||rows.length!==job.records)throw Error('GROUP_COUNT_MISMATCH');
 let occurrences=0;
 for(const row of rows){const p=row.provenance,d=row.data;
  if(row.source_system!=='docketbird-mcp'||row.entity_type!=='document_metadata'||row.schema_version!=='seeger-weiss-docketbird-document-evidence/1'||row.native_id!==d?.native_document_id||!d?.native_case_id||!row.native_id.startsWith(d.native_case_id+'-')||sha(canonicalIntegerJson(d))!==p?.record_sha256||p.source_manifest_sha256!==plan.originalSourceManifest.sha256||p.source_packet_file_sha256!==plan.originalInput.sha256||p.intake_normalizer_version!=='docketbird-private-observation-lineage/1')throw Error('SOURCE_IDENTITY_OR_HASH_MISMATCH');
  if(d.publisher_native_entity!==true||['public_projection_allowed','publisher_native_cross_provider_merge_allowed','firm_current_participation_verified','mdl_member_relationship_verified','binary_checksum_independently_verified','pdf_download_performed_by_this_normalizer'].some(key=>d[key]!==false)||!Array.isArray(p.full_lineage)||p.source_occurrence_count!==p.full_lineage.length||p.full_lineage.filter(x=>x.provenance_role==='selected_observation').length!==1)throw Error('PRIVATE_LINEAGE_REQUIRED');
  occurrences+=p.source_occurrence_count;
 }
 if(occurrences!==job.sourceOccurrences)throw Error('SOURCE_OCCURRENCE_MISMATCH');return rows;
}
export function bindDocketbirdPlan(parentBytes,parentHash,runId){
 if(!hex(parentHash)||sha(parentBytes)!==parentHash||!uuid(runId))throw Error('PLAN_BINDING_GUARD');
 const plan=JSON.parse(parentBytes);
 if(plan.schemaVersion!=='docketbird-private-evidence-intake-plan/1'||plan.projectId!==PROJECT||plan.runId!==null||plan.runBindingRequired!==true||plan.rpcFunction!==RPC||plan.privateOnly!==true||plan.publicProjectionAllowed!==false||!Array.isArray(plan.jobs))throw Error('SOURCE_PLAN_REQUIRED');
 return {...plan,runId,runBindingRequired:false,parentPlanSha256:parentHash,boundAt:new Date().toISOString()};
}
async function main(){
 const args=argsOf(),planPath=path.resolve(String(args.plan)),planBytes=fs.readFileSync(planPath);
 if(sha(planBytes)!==args['plan-sha256'])throw Error('PLAN_SHA_MISMATCH');let plan=JSON.parse(planBytes);
 if(args.bind){plan=bindDocketbirdPlan(planBytes,args['plan-sha256'],String(args.run));const target=path.resolve(String(args.bind));fs.writeFileSync(target,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({state:'immutable_plan_bound',run:plan.runId,sha256:sha(fs.readFileSync(target)),path:target}));return;}
 if(plan.projectId!==PROJECT||plan.schemaVersion!=='docketbird-private-evidence-intake-plan/1'||!uuid(plan.runId)||plan.runBindingRequired!==false||plan.rpcFunction!==RPC||!hex(plan.parentPlanSha256))throw Error('BOUND_PLAN_REQUIRED');
 pinned(plan.originalSourceManifest);pinned(plan.originalInput);pinned(plan.independentSourceReview);pinned(plan.runScope);pinned(plan.preparedInput);
 let records=0,occurrences=0;for(const job of plan.jobs){const rows=decodeDocketbirdGroup(job,plan);pinned(job.verificationTemplate);records+=rows.length;occurrences+=job.sourceOccurrences;}
 if(records!==plan.expectedObservations||occurrences!==plan.sourceOccurrencesPreserved)throw Error('PLAN_COUNT_MISMATCH');
 if(args.execute!==true){if(args.execute!==undefined)throw Error('EXPLICIT_EXECUTE_FLAG_REQUIRED');console.log(JSON.stringify({state:'dry_run_verified',jobs:plan.jobs.length,records,occurrences,run:plan.runId,mutations:0}));return;}
 const cfg=JSON.parse(fs.readFileSync(String(args.credentials),'utf8'));if(cfg.EXTERNAL_SUPABASE_URL!=='https://'+PROJECT+'.supabase.co')throw Error('WRONG_PROJECT');const token=cfg.EXTERNAL_SUPABASE_KEY;
 if(typeof token!=='string')throw Error('SERVER_ROLE_REQUIRED');if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.ref!==PROJECT||claims.role!=='service_role')throw Error('SERVER_ROLE_REQUIRED');}else if(!token.startsWith('sb_secret_'))throw Error('SERVER_ROLE_REQUIRED');
 const receiptPath=path.resolve(String(args.receipt));if(fs.existsSync(receiptPath))throw Error('FRESH_RECEIPT_REQUIRED');
 const headers={apikey:token,'Content-Type':'application/json',...(!token.startsWith('sb_')?{Authorization:'Bearer '+token}:{})};
 const receipt={schemaVersion:'docketbird-private-intake-receipt/1',projectId:PROJECT,runId:plan.runId,planSha256:sha(planBytes),startedAt:new Date().toISOString(),jobs:[],complete:false};
 const save=()=>{fs.writeFileSync(receiptPath+'.partial',JSON.stringify(receipt,null,2)+'\n');fs.renameSync(receiptPath+'.partial',receiptPath);};save();
 const call=async(fn,body,ms)=>{const response=await fetch(cfg.EXTERNAL_SUPABASE_URL+'/rest/v1/rpc/'+fn,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(ms)});let data;try{data=await response.json();}catch{throw Object.assign(Error('KNOWN_HTTP_RESPONSE_BODY_UNREADABLE'),{httpStatus:response.status});}return {status:response.status,ok:response.ok,data};};
 const maxJobs=Number(args['max-jobs']??plan.jobs.length);if(!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>plan.jobs.length)throw Error('JOB_BOUND_REQUIRED');
 for(const job of plan.jobs.slice(0,maxJobs)){
  const rows=decodeDocketbirdGroup(job,plan),body=JSON.stringify({p_run:plan.runId,p_rows:rows});
  const live={jobIndex:job.jobIndex,fileSha256:job.sha256,bodySha256:sha(body),records:rows.length,outcome:'unknown',startedAt:new Date().toISOString()};receipt.jobs.push(live);save();
  try{
   for(let recovery=0;;recovery++){
    try{const result=await call(RPC,body,90000);live.status=result.status;
     if(!result.ok){live.errorCode=result.data.code??'HTTP_ERROR';throw Error('INTAKE_HTTP_REJECTED');}
     if(result.data.received!==rows.length||result.data.private_only!==true||result.data.publisher_native_entities_released!==0)throw Error('INTAKE_ACK_MISMATCH');
     live.result=result.data;live.outcome='acknowledged';break;
    }catch(error){
     if(Number.isInteger(error.httpStatus))live.status=error.httpStatus;
     if(live.status!==undefined||recovery>=2)throw error;
     const audit=await call('corpus_admin_docketbird_evidence_status_v1',body,60000),proof=audit.data;
     if(!audit.ok||proof.expected!==rows.length||proof.conflicts!==0||![0,rows.length].includes(proof.matched))throw Error('UNKNOWN_OUTCOME_REQUIRES_AUDIT');
     live.recoveryProofs??=[];live.recoveryProofs.push(proof);save();
     if(proof.matched===rows.length){live.outcome='acknowledged_by_exact_database_proof';break;}
     await new Promise(resolve=>setTimeout(resolve,1000));
    }
   }
   live.finishedAt=new Date().toISOString();save();
  }catch(error){receipt.stopReason=/^[A-Z_]+$/.test(error.message)?error.message:'UNKNOWN_OUTCOME_REQUIRES_AUDIT';receipt.stoppedAt=new Date().toISOString();save();throw error;}
  if(job.jobIndex%10===0||receipt.jobs.length===maxJobs)console.log(JSON.stringify({acknowledgedJobs:receipt.jobs.length,totalJobs:plan.jobs.length,records:receipt.jobs.reduce((n,x)=>n+x.records,0)}));
 }
 receipt.complete=maxJobs===plan.jobs.length;receipt.selectedBatchComplete=true;receipt.finishedAt=new Date().toISOString();receipt.independentDatabaseVerificationRequired=true;save();console.log(JSON.stringify({state:'selected_groups_acknowledged',complete:receipt.complete,records:receipt.jobs.reduce((n,x)=>n+x.records,0),privateOnly:true}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('Source-qualified private intake stopped; inspect its private receipt. Credentials and locator values withheld.');process.exitCode=1;});
