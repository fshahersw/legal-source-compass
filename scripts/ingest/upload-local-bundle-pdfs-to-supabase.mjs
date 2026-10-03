import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {digestStream,retryTransferFileOperation} from './backfill-pdfs-to-supabase.mjs';

const PROJECT='xosqzzsnhxcyehcnirpa',BUCKET='corpus-originals';
const ROOT='C:/Users/firas/Downloads/MATTER-ETL-BATCH-PIPELINE/bundles';
const sha=x=>createHash('sha256').update(x).digest('hex');
const normalize=x=>path.resolve(x).replaceAll('\\','/').toLowerCase();
export function validateLocalPdfOccurrence(row,{allowQuarantine=false}={}){
 const quarantined=allowQuarantine&&row?.schema_version==='local-bundle-quarantined-pdf-occurrence/1',maxBytes=(quarantined?16:6)*1024**2;
 if((!quarantined&&row?.schema_version!=='local-bundle-observed-pdf-occurrence/1')||row.provider!=='local-matter-bundle'||row.native_backend_document_id!==null||row.native_backend_identity_asserted!==false||row.private_only!==true||row.publisher_sealing_asserted!==false||row.cloud_body_hash_verified!==false||row.pdf_magic_verified!==true||!/^[a-f0-9]{64}$/.test(row.source_occurrence_sha256??'')||!/^[a-f0-9]{64}$/.test(row.actual_sha256??'')||!/^[a-f0-9]{40}$/.test(row.actual_sha1??'')||!Number.isSafeInteger(row.actual_bytes)||row.actual_bytes<1||row.actual_bytes>maxBytes)throw Error('LOCAL_OCCURRENCE_REQUIRED');
 const evidence=row.source_evidence;
 if(!evidence||!/^[1-9][0-9]*$/.test(evidence.courtlistener_docket_id??'')||!/^[a-f0-9]{64}$/.test(evidence.bundle_manifest_sha256??'')||!/^[a-f0-9]{64}$/.test(evidence.docket_csv_sha256??'')||!Number.isSafeInteger(evidence.csv_ordinal)||evidence.csv_ordinal<1||!evidence.explicit_file_name||(!quarantined&&evidence.source_is_sealed_literal!==''))throw Error('LOCAL_SOURCE_EVIDENCE_REQUIRED');
 if(quarantined){
  if(row.native_document_id!==null||row.native_case_id!==null||row.publisher_native_entity!==false||row.publisher_parent_association_verified!==false||row.private_quarantine_required!==true||row.public_projection_allowed!==false||row.network_download_performed!==false||row.local_binary_sha_verified!==true||row.source_http_status!==null||row.source_http_retrieved_at!==null||row.literal_recap_pdf_url!==null||evidence.literal_recap_pdf_url!==''||!['','true'].includes(evidence.source_is_sealed_literal)||row.local_sealed_claim!==(evidence.source_is_sealed_literal==='true')||row.source_seal_status!==(evidence.source_is_sealed_literal==='true'?'locally_flagged_sealed':'unknown_local_blank'))throw Error('PRIVATE_LOCAL_QUARANTINE_REQUIRED');
 }else{
  const url=new URL(evidence.literal_recap_pdf_url);
  if(url.protocol!=='https:'||url.hostname!=='storage.courtlistener.com'||url.port||url.username||url.password||url.search||url.hash||!url.pathname.startsWith('/recap/')||!url.pathname.endsWith('.pdf'))throw Error('LITERAL_RECAP_LOCATOR_REQUIRED');
 }
 for(const file of[row.local_path,evidence.bundle_manifest_file,evidence.docket_csv_file])if(typeof file!=='string'||!normalize(file).startsWith(normalize(ROOT)+'/'))throw Error('LOCAL_BUNDLE_PATH_REQUIRED');
 if(path.basename(row.local_path)!==evidence.explicit_file_name||normalize(path.dirname(row.local_path))!==normalize(path.dirname(evidence.bundle_manifest_file))||normalize(path.dirname(row.local_path))!==normalize(path.dirname(evidence.docket_csv_file)))throw Error('LOCAL_BUNDLE_PARENT_MISMATCH');
 return row;
}
export function pdfStorageKey(hash){if(!/^[a-f0-9]{64}$/.test(hash??''))throw Error('PDF_HASH_REQUIRED');return 'seeger-weiss/pdf-sha256/'+hash.slice(0,2)+'/'+hash+'.pdf';}
export async function verifyLocalCloudReadback(response,expected){
 if(!response.ok){await response.body?.cancel();throw Error('LOCAL_CLOUD_VERIFY_HTTP_'+response.status);}
 const maxBytes=(expected.schema_version==='local-bundle-quarantined-pdf-occurrence/1'?16:6)*1024**2;
 const actual=await digestStream(Readable.fromWeb(response.body),{maxBytes,expectedBytes:expected.actual_bytes,expectedSha1:expected.actual_sha1});
 if(actual.sha256!==expected.actual_sha256)throw Error('LOCAL_CLOUD_HASH_MISMATCH');return actual;
}
async function main(){
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];}));
 const planFile=path.resolve(String(args.plan)),planBytes=await fs.readFile(planFile);
 if(!/^[a-f0-9]{64}$/.test(args['plan-sha256']??'')||sha(planBytes)!==args['plan-sha256'])throw Error('PINNED_LOCAL_PLAN_REQUIRED');
 if(args['source-kind']!==undefined&&args['source-kind']!=='private-local-quarantine')throw Error('LOCAL_SOURCE_KIND_REQUIRED');
 const allowQuarantine=args['source-kind']==='private-local-quarantine';
 if(allowQuarantine&&(normalize(planFile)!==normalize('C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/local-pdf-quarantine-v1/local-quarantined-pdf-occurrences-v1.jsonl')||sha(planBytes)!=='4b6caa7dd9aad890569a575a64339f2bd17f46ef5969f3dab962319527868cf3'))throw Error('REVIEWED_QUARANTINE_PACKET_REQUIRED');
 const rows=planBytes.toString('utf8').trim().split('\n').filter(Boolean).map(x=>validateLocalPdfOccurrence(JSON.parse(x),{allowQuarantine}));
 if(allowQuarantine&&(rows.length!==701||rows.some(row=>row.schema_version!=='local-bundle-quarantined-pdf-occurrence/1')))throw Error('REVIEWED_QUARANTINE_COUNTS_REQUIRED');
 if(rows.length<1||rows.length>1000||new Set(rows.map(x=>x.source_occurrence_sha256)).size!==rows.length)throw Error('BOUNDED_UNIQUE_LOCAL_OCCURRENCES_REQUIRED');
 const resolvedRoot=normalize(await fs.realpath(ROOT)),sourceHashes=new Map(),unique=new Map();
 for(const row of rows){
  for(const [file,expected]of[[row.source_evidence.bundle_manifest_file,row.source_evidence.bundle_manifest_sha256],[row.source_evidence.docket_csv_file,row.source_evidence.docket_csv_sha256]]){
   if(!normalize(await fs.realpath(file)).startsWith(resolvedRoot+'/'))throw Error('LOCAL_SOURCE_RESOLVES_OUTSIDE_BUNDLES');
   if(!sourceHashes.has(file))sourceHashes.set(file,sha(await fs.readFile(file)));
   if(sourceHashes.get(file)!==expected)throw Error('PINNED_LOCAL_METADATA_CHANGED');
  }
  if(!normalize(await fs.realpath(row.local_path)).startsWith(resolvedRoot+'/'))throw Error('LOCAL_PDF_RESOLVES_OUTSIDE_BUNDLES');
  const actual=await digestStream(createReadStream(row.local_path),{maxBytes:(allowQuarantine?16:6)*1024**2,expectedBytes:row.actual_bytes,expectedSha1:row.actual_sha1});
  if(actual.sha256!==row.actual_sha256)throw Error('PINNED_LOCAL_PDF_CHANGED');
  if(!unique.has(row.actual_sha256))unique.set(row.actual_sha256,row);
 }
 if(!args.execute){console.log(JSON.stringify({state:'pinned_local_pdf_plan_verified',occurrences:rows.length,unique_pdf_objects:unique.size,uploads:0,database_writes:0}));return;}
 const cfg=JSON.parse(await fs.readFile(String(args.credentials),'utf8'));
 if(cfg.EXTERNAL_SUPABASE_URL!=='https://'+PROJECT+'.supabase.co')throw Error('WRONG_PROJECT');
 const token=cfg.EXTERNAL_SUPABASE_KEY;if(typeof token!=='string')throw Error('SERVER_KEY_REQUIRED');
 if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.ref!==PROJECT||claims.role!=='service_role')throw Error('SERVICE_ROLE_REQUIRED');}else if(!token.startsWith('sb_secret_'))throw Error('SERVICE_ROLE_REQUIRED');
 const headers={apikey:token,...(!token.startsWith('sb_')?{Authorization:'Bearer '+token}:{})},storage='https://'+PROJECT+'.storage.supabase.co/storage/v1';
 const bucket=await fetch(storage+'/bucket/'+BUCKET,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});if(!bucket.ok)throw Error('BUCKET_READ_FAILED');const details=await bucket.json();if(details.id!==BUCKET||details.public!==false)throw Error('PRIVATE_BUCKET_REQUIRED');
 const out=path.resolve(String(args.out)),receiptRoot=allowQuarantine?'local-pdf-quarantine-v1':'local-pdf-reuse-v1';if(!normalize(out).startsWith(normalize('C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/'+receiptRoot)+'/'))throw Error('PRIVATE_LOCAL_RECEIPT_DIRECTORY_REQUIRED');await fs.mkdir(out,{recursive:true});
 const receiptFile=path.join(out,'cloud-transfer-receipts.jsonl');let append=Promise.resolve();
 const record=value=>{append=append.then(async()=>{const fd=await retryTransferFileOperation('receipt_open',()=>fs.open(receiptFile,'a'));try{const raw=Buffer.from(JSON.stringify({...value,recorded_at:new Date().toISOString()})+'\n'),written=await fd.write(raw);if(written.bytesWritten!==raw.length)throw Error('RECEIPT_SHORT_APPEND');await retryTransferFileOperation('receipt_fsync',()=>fd.sync());}finally{await retryTransferFileOperation('receipt_close',()=>fd.close());}});return append;};
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function readback(key,row){for(let attempt=0;;attempt++){let response;try{response=await fetch(storage+'/object/authenticated/'+BUCKET+'/'+key,{headers,redirect:'error',signal:AbortSignal.timeout(90000)});}catch{if(attempt>=2)throw Error('LOCAL_CLOUD_VERIFY_NETWORK');await pause(1000*2**attempt);continue;}
   if([408,500,502,503,504].includes(response.status)&&attempt<2){await response.body?.cancel();await pause(1000*2**attempt);continue;}
   if(response.status===404){await response.body?.cancel();throw Error('LOCAL_CLOUD_OBJECT_NOT_FOUND');}
   if(response.status===400){let code=null;try{const data=await response.json();code=data.code??data.error;}catch{}if(code==='NoSuchKey')throw Error('LOCAL_CLOUD_OBJECT_NOT_FOUND');throw Error('LOCAL_CLOUD_VERIFY_HTTP_400');}
   return verifyLocalCloudReadback(response,row);}}
 let cursor=0,verified=0,verifiedBytes=0,stop=false;
 const pending=[...unique.values()],concurrency=Math.min(3,pending.length);
 const settled=await Promise.allSettled(Array.from({length:concurrency},async()=>{while(!stop&&cursor<pending.length){const row=pending[cursor++],key=pdfStorageKey(row.actual_sha256);try{
   // Recheck the chosen local binary immediately before the immutable upload.
   const raw=await fs.readFile(row.local_path);if(raw.length!==row.actual_bytes||sha(raw)!==row.actual_sha256)throw Error('PINNED_LOCAL_PDF_CHANGED');
   await record({state:'local_upload_pending',sha256:row.actual_sha256,bytes:row.actual_bytes,storage_key:key,plan_sha256:sha(planBytes)});
   const post=async()=>{let status=null;try{const response=await fetch(storage+'/object/'+BUCKET+'/'+key,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','Content-Length':String(raw.length),'x-upsert':'false'},body:raw,redirect:'error',signal:AbortSignal.timeout(90000)});status=response.status;await response.body?.cancel();}catch{/* Exact full object readback resolves an unknown upload outcome. */}
    await record({state:'local_upload_response',sha256:row.actual_sha256,storage_key:key,upload_http_status:status,plan_sha256:sha(planBytes)});
    if(status!==null&&!([200,201,400,409,408,500,502,503,504].includes(status)))throw Error('LOCAL_CLOUD_UPLOAD_HTTP_'+status);return status;};
   let status=await post();
   try{await readback(key,row);}catch(error){
    if(error.message!=='LOCAL_CLOUD_OBJECT_NOT_FOUND'||!(status===null||[408,500,502,503,504].includes(status)))throw error;
    // A proven missing object permits one retry of the same immutable bytes.
    // Known conflicts, auth/rate limits and checksum mismatches never retry.
    await record({state:'local_missing_object_recovery',sha256:row.actual_sha256,storage_key:key,previous_upload_http_status:status,plan_sha256:sha(planBytes)});
    status=await post();await readback(key,row);
   }
   await record({state:'local_cloud_verified',project_id:PROJECT,bucket:BUCKET,sha256:row.actual_sha256,sha1:row.actual_sha1,bytes:row.actual_bytes,storage_key:key,upload_http_status:status,verified_at:new Date().toISOString(),plan_sha256:sha(planBytes),source_occurrence_sha256s:rows.filter(x=>x.actual_sha256===row.actual_sha256).map(x=>x.source_occurrence_sha256),private_only:true,backend_api_document_identity_asserted:false});verified++;verifiedBytes+=row.actual_bytes;
  }catch(error){stop=true;const type=/^[A-Z][A-Z0-9_]{0,80}$/.test(error.message??'')?error.message:'LOCAL_TRANSFER_FAILURE';await record({state:'local_transfer_failed',sha256:row.actual_sha256,error_type:type});throw Error(type);}
 }}));
 await append;const failed=settled.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 const completion={schema_version:'local-pdf-cloud-transfer-completion/1',project_id:PROJECT,bucket:BUCKET,plan_sha256:sha(planBytes),verified_unique_pdf_objects:verified,verified_unique_bytes:verifiedBytes,source_occurrences:rows.length,finished_at:new Date().toISOString(),private_only:true,database_writes:0,local_files_deleted:0};await fs.writeFile(path.join(out,'completion.json'),JSON.stringify(completion,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(completion));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({state:'local_upload_stopped',error_type:/^[A-Z][A-Z0-9_]{0,80}$/.test(error.message??'')?error.message:'LOCAL_TRANSFER_FAILURE'}));process.exitCode=1;});
