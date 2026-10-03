import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalHash,validateLocalCloudProof} from './local-bundle-pdf-contract.mjs';
import {retryTransferFileOperation} from '../ingest/backfill-pdfs-to-supabase.mjs';

const PROJECT='xosqzzsnhxcyehcnirpa',WRITE='corpus_admin_register_local_bundle_pdf_assets_v1',READ='corpus_admin_local_bundle_pdf_assets_status_v1';
const sha=x=>createHash('sha256').update(x).digest('hex');
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];}));
async function main(){
 const bytes=await fs.readFile(String(args.body));if(!/^[a-f0-9]{64}$/.test(args['body-sha256']??'')||sha(bytes)!==args['body-sha256']||bytes.length>500000)throw Error('PINNED_LOCAL_REGISTRATION_BODY_REQUIRED');
 const decoded=JSON.parse(bytes);if(Object.keys(decoded).join('|')!=='p_rows'||!Array.isArray(decoded.p_rows)||decoded.p_rows.length<1||decoded.p_rows.length>100)throw Error('BOUNDED_LOCAL_REGISTRATION_REQUIRED');
 const rows=decoded.p_rows,ids=new Set();
 for(const row of rows){
  const original=row.occurrence,proof=row.cloud_verification;
  if(Object.keys(row).sort().join('|')!=='cloud_verification|occurrence|occurrence_sha256'||original?.source_system!=='local-matter-bundle-pdf'||original.native_document_id!==null||original.native_case_id!==null||original.private_quarantine_required!==true||original.public_projection_allowed!==false||canonicalHash(original)!==row.occurrence_sha256||ids.has(original.local_occurrence_id))throw Error('PRIVATE_LOCAL_IDENTITY_REQUIRED');
  ids.add(original.local_occurrence_id);validateLocalCloudProof(proof,original,original.source_packet_sha256);
 }
 if(!args.execute){console.log(JSON.stringify({state:'pinned_local_registration_verified',records:rows.length,database_writes:0}));return;}
 const cfg=JSON.parse(await fs.readFile(String(args.credentials),'utf8'));if(cfg.EXTERNAL_SUPABASE_URL!=='https://'+PROJECT+'.supabase.co')throw Error('WRONG_PROJECT');const token=cfg.EXTERNAL_SUPABASE_KEY;if(typeof token!=='string')throw Error('SERVICE_ROLE_REQUIRED');
 if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.ref!==PROJECT||claims.role!=='service_role')throw Error('SERVICE_ROLE_REQUIRED');}else if(!token.startsWith('sb_secret_'))throw Error('SERVICE_ROLE_REQUIRED');
 const receiptPath=path.resolve(String(args.receipt));if(!receiptPath.replaceAll('\\','/').toLowerCase().startsWith('c:/users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/'))throw Error('PRIVATE_RECEIPT_REQUIRED');
 await fs.mkdir(path.dirname(receiptPath),{recursive:true});try{await fs.access(receiptPath);throw Error('FRESH_RECEIPT_REQUIRED');}catch(error){if(error.code!=='ENOENT')throw error;}
 const receipt={schema_version:'private-local-pdf-registration-receipt/1',project_id:PROJECT,body_sha256:sha(bytes),records:rows.length,started_at:new Date().toISOString(),attempts:[],complete:false};
 const save=async()=>{await retryTransferFileOperation('progress_snapshot_write',()=>fs.writeFile(receiptPath+'.part',JSON.stringify(receipt,null,2)+'\n'));await retryTransferFileOperation('progress_snapshot_replace',()=>fs.rename(receiptPath+'.part',receiptPath));};await save();
 const headers={apikey:token,'Content-Type':'application/json',...(!token.startsWith('sb_')?{Authorization:'Bearer '+token}:{})};
 const call=async fn=>{const response=await fetch(cfg.EXTERNAL_SUPABASE_URL+'/rest/v1/rpc/'+fn,{method:'POST',headers,body:bytes,redirect:'error',signal:AbortSignal.timeout(90000)});let data;try{data=await response.json();}catch{throw Object.assign(Error('KNOWN_HTTP_BODY_UNREADABLE'),{httpStatus:response.status});}if(!response.ok)throw Object.assign(Error('KNOWN_HTTP_REJECTED'),{httpStatus:response.status,code:/^[A-Z0-9_]{1,40}$/.test(data.code??'')?data.code:null});return data;};
 const matches=proof=>proof?.expected===rows.length&&proof.matched===rows.length&&proof.conflicts===0&&proof.private_only===true&&proof.publisher_native_asset_writes===0;
 try{
  for(let attempt=0;attempt<2;attempt++){
   const item={attempt:attempt+1,started_at:new Date().toISOString()};receipt.attempts.push(item);await save();
   try{const ack=await call(WRITE);if(ack.received!==rows.length||ack.private_only!==true||ack.private_quarantine_required!==true||ack.publisher_native_asset_writes!==0||ack.bucket!=='corpus-originals')throw Error('LOCAL_ACKNOWLEDGEMENT_MISMATCH');item.outcome='acknowledged';item.acknowledgement=ack;break;}
   catch(error){
    if(Number.isInteger(error.httpStatus)){item.http_status=error.httpStatus;throw error;}
    if(error.message==='LOCAL_ACKNOWLEDGEMENT_MISMATCH')throw error;
    const proof=await call(READ);item.unknown_outcome_read_only_proof=proof;await save();
    if(matches(proof)){item.outcome='acknowledged_by_exact_database_proof';break;}
    if(proof.expected!==rows.length||proof.matched!==0||proof.conflicts!==0||proof.private_only!==true||attempt!==0)throw Error('LOCAL_UNKNOWN_OUTCOME_UNRESOLVED');
    item.outcome='proven_absent_same_body_retry';await save();
   }
  }
  const final=await call(READ);if(!matches(final))throw Error('LOCAL_FULL_DATABASE_PROOF_FAILED');
  receipt.final_database_proof=final;receipt.complete=true;receipt.finished_at=new Date().toISOString();await save();console.log(JSON.stringify({state:'private_local_pdf_assets_registered_and_verified',records:rows.length,publisher_native_asset_writes:0,private_quarantine_required:true}));
 }catch(error){receipt.stop_reason=/^[A-Z][A-Z0-9_]{0,80}$/.test(error.message??'')?error.message:'PRIVATE_LOCAL_REGISTRATION_STOPPED';if(Number.isInteger(error.httpStatus))receipt.http_status=error.httpStatus;receipt.stopped_at=new Date().toISOString();await save();throw error;}
}
main().catch(error=>{console.error(JSON.stringify({state:'private_local_registration_stopped',error_type:/^[A-Z][A-Z0-9_]{0,80}$/.test(error.message??'')?error.message:'PRIVATE_LOCAL_REGISTRATION_FAILURE'}));process.exitCode=1;});
