import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {validatePaginationMetadataPlanRow,validatePaginationOriginalMetadataBytes} from './public-docket-original-metadata-contract.mjs';
import {RECENT_METADATA_KIND,validateRecentMetadataRow,verifyRecentOriginalPlanBindings} from './recent-docketbird-original-contract.mjs';

const PROJECT='xosqzzsnhxcyehcnirpa',BUCKET='corpus-originals',MAX_BYTES=6*1024**2;
const sha256=x=>createHash('sha256').update(x).digest('hex');
const hex64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const normalize=x=>path.resolve(x).replaceAll('\\','/').toLowerCase();
const PRIVATE_CACHE='C:/Users/firas/.codex/corpus-cache/';
const metadataMethods=new Set(['get_case','get_docket_sheet','search_cases','find_litigation_relationships','list_my_cases']);
const paginationKinds=new Set(['courtlistener_firecrawl_pagination_html_json','courtlistener_tavily_pagination_markdown_json']);
const PRIVATE_CREDENTIALS='C:/Users/firas/.codex/private/';
const transientCodes=new Set(['ECONNRESET','ETIMEDOUT','EPIPE','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
const safeCauseCodes=new Set([...transientCodes,'ENOENT','EACCES','EPERM','EISDIR','ENOSPC','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID','UND_ERR_ABORTED']);
const safeErrorTypes=new Set(['Error','TypeError','DOMException','TimeoutError','AbortError','SystemError','AggregateError']);
export function sanitizedMetadataError(error){
 const pending=[error];let code=null;
 for(let i=0;i<pending.length&&i<16;i++){
  const current=pending[i];if(!current||typeof current!=='object')continue;
  if(typeof current.code==='string'&&safeCauseCodes.has(current.code)){code=current.code;break;}
  if(current.cause)pending.push(current.cause);
  if(Array.isArray(current.errors))pending.push(...current.errors.slice(0,4));
 }
 return {error_type:safeErrorTypes.has(error?.name)?error.name:'UnknownError',cause_code:code};
}
function transientMetadataRead(error){
 const summary=sanitizedMetadataError(error);
 return transientCodes.has(summary.cause_code)||error?.name==='TimeoutError'||/^METADATA_VERIFY_HTTP_(?:408|500|502|503|504)$/.test(error?.message??'');
}
export async function drainMetadataResponse(response,maxBytes=64*1024){
 if(!response.body)return Buffer.alloc(0);
 const chunks=[];let bytes=0;
 for await(const chunk of Readable.fromWeb(response.body)){
  const block=Buffer.from(chunk);bytes+=block.length;
  if(bytes>maxBytes)throw Error('METADATA_RESPONSE_BODY_LIMIT');
  chunks.push(block);
 }
 return Buffer.concat(chunks);
}

export function metadataStorageKey(digest){
 if(!hex64(digest))throw Error('METADATA_DIGEST_INVALID');
 return 'seeger-weiss/metadata-sha256/'+digest.slice(0,2)+'/'+digest+'.json';
}
export function validateMetadataPlanRow(row,resolvedPath=row?.local_path){
 if(paginationKinds.has(row?.metadata_kind))return validatePaginationMetadataPlanRow(row,resolvedPath);
 if(!row||!['courtlistener','docketbird','firecrawl'].includes(row.provider)||!hex64(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<2||row.bytes>MAX_BYTES||typeof row.local_path!=='string'||!path.isAbsolute(row.local_path))throw Error('METADATA_PLAN_ROW_INVALID');
 const local=normalize(resolvedPath);
 if(!local.startsWith(PRIVATE_CACHE.toLowerCase()))throw Error('SOURCE_OUTSIDE_PRIVATE_CORPUS_CACHE');
 if(row.provider==='courtlistener'){
  const filename=local.match(/\/api\/[a-f0-9]{64}(?:-([a-f0-9]{64}))?\.json$/);
  if(row.metadata_kind!=='courtlistener_native_api_json'||!local.includes('/courtlistener/')||!filename)throw Error('UNAPPROVED_COURTLISTENER_ORIGINAL');
  if(filename[1]&&filename[1]!==row.sha256)throw Error('VERSIONED_ORIGINAL_FILENAME_HASH_MISMATCH');
  const u=new URL(row.source_url);
  if(u.origin!=='https://www.courtlistener.com'||!u.pathname.startsWith('/api/rest/v4/')||u.username||u.password||u.port)throw Error('ORIGINAL_SOURCE_ORIGIN_INVALID');
  for(const key of u.searchParams.keys())if(/^(?:api[_-]?key|authorization|access[_-]?token|token|key)$/i.test(key))throw Error('CREDENTIAL_SOURCE_LOCATOR_HELD');
 }else if(row.provider==='docketbird'){
  if(row.metadata_kind===RECENT_METADATA_KIND)validateRecentMetadataRow(row,resolvedPath);
  else if(row.metadata_kind!=='docketbird_mcp_capture_json'||!local.includes('/seeger-weiss/')||!/\/docketbird\/(?:narrow-probe|master-probe|portfolio-backfill-v1|initial-portfolio|portfolio-tail-v1)\/\d+-[a-f0-9]{64}\.json$/.test(local)||row.source_url!=='https://mcp.docketbird.com/mcp')throw Error('UNAPPROVED_DOCKETBIRD_ORIGINAL');
 }else{
  const filename=local.match(/\/seeger-weiss\/2026-10-02\/firecrawl-dockets\/original-(\d+)\.json$/);
  const u=new URL(row.source_url);
  if(row.metadata_kind!=='courtlistener_firecrawl_docket_html_json'||!filename||u.origin!=='https://www.courtlistener.com'||!new RegExp('^/docket/'+filename[1]+'/[^/]+/?$').test(u.pathname)||u.username||u.password||u.search||u.hash)throw Error('UNAPPROVED_FIRECRAWL_DOCKET_ORIGINAL');
 }
 if(row.storage_key!==undefined&&row.storage_key!==metadataStorageKey(row.sha256))throw Error('METADATA_STORAGE_KEY_MISMATCH');
 return row;
}
function inspectCredentialFields(value,fieldPath=[]){
 if(Array.isArray(value)){for(const item of value)inspectCredentialFields(item,fieldPath);return;}
 if(value&&typeof value==='object'){
  for(const [key,item]of Object.entries(value)){
   if(/^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|supabase[_-]?(?:service[_-]?role[_-]?)?key|external_supabase_key|courtlistener_api_key|firecrawl_api_key)$/i.test(key))throw Error('CREDENTIAL_FIELDS_IN_ORIGINAL');
   if(key!=='original_rpc_response')inspectCredentialFields(item,[...fieldPath,key]);
  }
 }else if(typeof value==='string'){
  if(/(?:sb_secret_[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9_.-]{20,})/.test(value))throw Error('CREDENTIAL_VALUE_IN_ORIGINAL');
  if(value.startsWith('https://')){
   let url;try{url=new URL(value);}catch{throw Error('ORIGINAL_URL_INVALID');}
   if(url.username||url.password)throw Error('CREDENTIAL_SOURCE_LOCATOR_HELD');
   const names=[...url.searchParams.keys()];
   if(names.some(x=>/^(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|token)$/i.test(x)))throw Error('CREDENTIAL_SOURCE_LOCATOR_HELD');
   if(names.some(x=>/^(?:AWSAccessKeyId|Signature|X-Amz-(?:Credential|Signature|Security-Token))$/i.test(x))&&
     (url.origin!=='https://docketbird-case-documents.s3.amazonaws.com'||fieldPath.at(-1)!=='pdf_url'))throw Error('UNAPPROVED_SIGNED_METADATA_LOCATOR');
  }
 }
}
export function validateOriginalMetadataBytes(row,bytes){
 if(bytes.length!==row.bytes||sha256(bytes)!==row.sha256)throw Error('ORIGINAL_FILE_HASH_OR_SIZE_MISMATCH');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('ORIGINAL_JSON_INVALID');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('ORIGINAL_CAPTURE_OBJECT_REQUIRED');
 inspectCredentialFields(value);
 if(paginationKinds.has(row.metadata_kind))return validatePaginationOriginalMetadataBytes(row,bytes);
 if(row.provider==='courtlistener'){
  if(!('results'in value)&&!('id'in value))throw Error('NATIVE_API_PAYLOAD_REQUIRED');
 }else if(row.provider==='docketbird'){
  if(value.schema_version!=='docketbird-mcp-capture/1'||value.source_url!=='https://mcp.docketbird.com/mcp'||value.http_status!==200||value.method!=='tools/call'||!metadataMethods.has(value.params?.name)||typeof value.original_rpc_response!=='string')throw Error('NATIVE_MCP_METADATA_CAPTURE_REQUIRED');
  const raw=Buffer.from(value.original_rpc_response);
  if(raw.length!==value.response_bytes||sha256(raw)!==value.response_sha256)throw Error('ORIGINAL_PROVIDER_RESPONSE_MISMATCH');
  let messages;try{messages=value.original_rpc_response.startsWith('data:')?value.original_rpc_response.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>JSON.parse(x.slice(5))):[JSON.parse(value.original_rpc_response)];}catch{throw Error('ORIGINAL_PROVIDER_JSON_INVALID');}
  const result=messages.find(x=>x.result)?.result;
  if(!result||result.isError)throw Error('SUCCESSFUL_METADATA_RESPONSE_REQUIRED');
  inspectCredentialFields(messages);
  // MCP repeats structured metadata as JSON text. Inspect that domain too,
  // while preserving the exact wrapper and original response bytes.
  for(const block of result.content??[])if(block.type==='text'&&typeof block.text==='string'){
   let embedded;try{embedded=JSON.parse(block.text);}catch{continue;}
   inspectCredentialFields(embedded,['native_metadata']);
  }
 }else{
  const data=value.result?.structuredContent;
  const id=String(value.native_case_id??'');
  if(!/^\d+$/.test(id)||value.requested_url!==row.source_url||!row.source_url.startsWith('https://www.courtlistener.com/docket/'+id+'/')||!Number.isFinite(Date.parse(value.requested_at))||!Number.isFinite(Date.parse(value.returned_at))||value.result?.isError||!data||data.metadata?.statusCode!==200||!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(data.metadata.contentType??'')||typeof data.rawHtml!=='string'||!data.rawHtml.trim()||data.metadata.sourceURL!==row.source_url)throw Error('NATIVE_FIRECRAWL_DOCKET_CAPTURE_REQUIRED');
  if(data.metadata.url!==undefined){const final=new URL(data.metadata.url);if(final.origin!=='https://www.courtlistener.com'||!final.pathname.startsWith('/docket/'+id+'/')||final.username||final.password)throw Error('FIRECRAWL_NATIVE_DOCKET_REDIRECT_MISMATCH');}
  for(const block of value.result.content??[])if(block.type==='text'&&typeof block.text==='string'){
   let embedded;try{embedded=JSON.parse(block.text);}catch{continue;}
   inspectCredentialFields(embedded,['native_metadata']);
  }
 }
 return {bytes:bytes.length,sha256:row.sha256,storage_key:metadataStorageKey(row.sha256)};
}
export async function digestMetadataStream(stream,expected){
 const digest=createHash('sha256');let bytes=0;const chunks=[];
 for await(const chunk of stream){const block=Buffer.from(chunk);bytes+=block.length;if(bytes>MAX_BYTES)throw Error('METADATA_CLOUD_SIZE_LIMIT');digest.update(block);chunks.push(block);}
 if(bytes!==expected.bytes||digest.digest('hex')!==expected.sha256)throw Error('METADATA_CLOUD_HASH_OR_SIZE_MISMATCH');
 try{JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw Error('METADATA_CLOUD_JSON_INVALID');}
 return {bytes,sha256:expected.sha256};
}
export async function verifyMetadataReadback({fetchResponse,expected,onEvent=async()=>{},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxAttempts=3}){
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw Error('METADATA_VERIFY_ATTEMPT_BOUNDS');
 for(let attempt=0;attempt<maxAttempts;attempt++){
  try{
   // Each attempt starts a new whole GET and a new digest. Partial bytes are
   // never reused or combined with another response.
   const response=await fetchResponse();
   if(response.status===404){await drainMetadataResponse(response);return false;}
   if(response.status===400){
    const raw=await drainMetadataResponse(response);let payload;try{payload=JSON.parse(raw);}catch{throw Error('METADATA_VERIFY_HTTP_400');}
    if(payload?.error==='NoSuchKey'||String(payload?.statusCode)==='404'||payload?.code==='not_found')return false;
    throw Error('METADATA_VERIFY_HTTP_400');
   }
   if(!response.ok){
    if([401,403,429].includes(response.status)){await drainMetadataResponse(response).catch(()=>{});throw Error('METADATA_VERIFY_HTTP_'+response.status);}
    await drainMetadataResponse(response);throw Error('METADATA_VERIFY_HTTP_'+response.status);
   }
   await digestMetadataStream(Readable.fromWeb(response.body),expected);return true;
  }catch(error){
   if(!transientMetadataRead(error))throw error;
   if(attempt+1===maxAttempts)throw Object.assign(Error('METADATA_VERIFY_TRANSIENT_EXHAUSTED',{cause:error}),{name:'Error'});
   await onEvent({state:'metadata_verify_transport_retry',attempt,next_attempt:attempt+1,...sanitizedMetadataError(error)});
   await pause(1000*(attempt+1));
  }
 }
}
export async function ensureVerifiedMetadataObject({verify,upload,onEvent=async()=>{},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 if(await verify())return {upload_http_status:null,already_present_verified:true};
 for(let attempt=0;attempt<2;attempt++){
  await onEvent({state:'metadata_upload_pending',attempt});
  let status=null;try{status=await upload();}catch(error){
   if(Number.isInteger(error?.upload_http_status)&&error.upload_http_status>=100&&error.upload_http_status<=599)status=error.upload_http_status;
   await onEvent({state:'metadata_upload_outcome_unknown',attempt,upload_http_status:status,...sanitizedMetadataError(error)});
  }
  const verified=await verify();
  // Stop a throttled/authentication scope even when a concurrent immutable
  // object happened to become visible. The receipt must not hide a denial.
  if([401,403,429].includes(status))throw Error('METADATA_UPLOAD_HTTP_'+status);
  if(verified)return {upload_http_status:status,already_present_verified:false};
  if(attempt===0&&(status===null||[408,500,502,503,504].includes(status))){await onEvent({state:'metadata_absent_after_unknown_upload',attempt,upload_http_status:status});await pause(1000);continue;}
  throw Error(status===null?'METADATA_UPLOAD_OUTCOME_UNRESOLVED':'METADATA_UPLOAD_HTTP_'+status);
 }
}
async function readPinnedOriginal(row){
 const real=await fs.realpath(row.local_path);validateMetadataPlanRow(row,real);
 const stat=await fs.stat(real);if(!stat.isFile()||stat.size!==row.bytes)throw Error('ORIGINAL_FILE_STAT_MISMATCH');
 validateOriginalMetadataBytes(row,await fs.readFile(real));return real;
}
async function main(){
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];}));
 const planBytes=await fs.readFile(String(args.plan));if(!hex64(args['plan-sha256'])||sha256(planBytes)!==args['plan-sha256'])throw Error('FROZEN_PLAN_HASH_MISMATCH');
 const plan=JSON.parse(planBytes);
 if(plan.schema_version!=='source-qualified-original-metadata-plan/1'||plan.project_id!==PROJECT||plan.bucket!==BUCKET||!Array.isArray(plan.files)||!plan.files.length)throw Error('METADATA_PLAN_INVALID');
 await verifyRecentOriginalPlanBindings(plan);
 const unique=new Set();for(const row of plan.files){validateMetadataPlanRow(row);const identity=normalize(row.local_path);if(unique.has(identity))throw Error('DUPLICATE_SOURCE_FILE');unique.add(identity);await readPinnedOriginal(row);}
 const maxFiles=Number(args['max-files']??plan.files.length),concurrency=Number(args.concurrency??4);
 if(!Number.isSafeInteger(maxFiles)||maxFiles<1||maxFiles>5000||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8)throw Error('METADATA_TRANSFER_BOUNDS_INVALID');
 const selected=plan.files.slice(0,maxFiles);
 if(args.execute!==true){if(args.execute!==undefined)throw Error('EXECUTE_REQUIRES_EXPLICIT_FLAG');console.log(JSON.stringify({state:'verified_dry_run',files:plan.files.length,selected:selected.length,source_bytes:plan.files.reduce((n,x)=>n+x.bytes,0),uploads:0}));return;}
 const receiptPath=path.resolve(String(args.receipt));if(!normalize(receiptPath).startsWith(PRIVATE_CACHE.toLowerCase()))throw Error('PRIVATE_RECEIPT_PATH_REQUIRED');
 await fs.mkdir(path.dirname(receiptPath),{recursive:true});
 const credentialPath=await fs.realpath(String(args.credentials));if(!normalize(credentialPath).startsWith(PRIVATE_CREDENTIALS.toLowerCase()))throw Error('PRIVATE_CREDENTIAL_FILE_REQUIRED');
 const cfg=JSON.parse(await fs.readFile(credentialPath,'utf8'));
 if(cfg.EXTERNAL_SUPABASE_URL!=='https://'+PROJECT+'.supabase.co'||typeof cfg.EXTERNAL_SUPABASE_KEY!=='string')throw Error('WRONG_STORAGE_PROJECT');
 const token=cfg.EXTERNAL_SUPABASE_KEY;
 if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.role!=='service_role'||claims.ref!==PROJECT)throw Error('SERVER_STORAGE_ROLE_REQUIRED');}
 else if(!token.startsWith('sb_secret_'))throw Error('SERVER_STORAGE_ROLE_REQUIRED');
 const objectHost=args['object-host']??'project';if(!['project','direct'].includes(objectHost))throw Error('METADATA_STORAGE_HOST_INVALID');
 const storage=cfg.EXTERNAL_SUPABASE_URL+'/storage/v1',objectStorage=objectHost==='direct'?'https://'+PROJECT+'.storage.supabase.co/storage/v1':storage;
 const headers={apikey:token,...(!token.startsWith('sb_')?{Authorization:'Bearer '+token}:{})};
 const bucket=await fetch(storage+'/bucket/'+BUCKET,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!bucket.ok)throw Error('PRIVATE_BUCKET_READ_FAILED');const info=await bucket.json();if(info.id!==BUCKET||info.public!==false)throw Error('PRIVATE_BUCKET_REQUIRED');
 let writes=Promise.resolve(),cursor=0,stopped=false,verified=0,failed=0;
 const record=event=>{writes=writes.then(async()=>{const handle=await fs.open(receiptPath,'a');try{await handle.write(JSON.stringify({...event,recorded_at:new Date().toISOString()})+'\n');await handle.sync();}finally{await handle.close();}});return writes;};
 async function verifyObject(row,context){
  return verifyMetadataReadback({expected:row,onEvent:event=>record({...context,...event}),fetchResponse:()=>fetch(objectStorage+'/object/authenticated/'+BUCKET+'/'+metadataStorageKey(row.sha256),{headers,redirect:'error',signal:AbortSignal.timeout(90000)})});
 }
 const objects=new Map();
 async function ensureObject(row,file,context){
  const key=metadataStorageKey(row.sha256);if(objects.has(key))return objects.get(key);
  const work=ensureVerifiedMetadataObject({verify:()=>verifyObject(row,context),onEvent:event=>record({...context,...event}),upload:async()=>{
   await readPinnedOriginal(row);
   const response=await fetch(objectStorage+'/object/'+BUCKET+'/'+key,{method:'POST',headers:{...headers,'Content-Type':'application/json','Content-Length':String(row.bytes),'x-upsert':'false'},body:createReadStream(file),duplex:'half',redirect:'error',signal:AbortSignal.timeout(90000)});
   // Consume the bounded upload response instead of canceling it so the
   // connection can be reused. A failed drain remains an unknown outcome.
   const status=response.status;
   try{await drainMetadataResponse(response);}catch(error){error.upload_http_status=status;throw error;}
   return status;
  }});objects.set(key,work);try{return await work;}catch(error){objects.delete(key);throw error;}
 }
 await record({schema_version:'original-metadata-cloud-receipt/1',state:'metadata_batch_started',project_id:PROJECT,bucket:BUCKET,plan_sha256:sha256(planBytes),selected:selected.length,object_host:objectHost,readback_max_attempts:3});
 async function worker(){for(;;){if(stopped)return;const row=selected[cursor++];if(!row)return;
  const context={schema_version:'original-metadata-cloud-receipt/1',provider:row.provider,metadata_kind:row.metadata_kind,source_file:row.local_path,source_file_sha256:row.sha256,source_bytes:row.bytes,storage_key:metadataStorageKey(row.sha256),plan_sha256:sha256(planBytes),project_id:PROJECT,bucket:BUCKET};
  try{const file=await readPinnedOriginal(row),proof=await ensureObject(row,file,context);await record({...context,state:'metadata_cloud_verified',verified_at:new Date().toISOString(),...proof});verified++;}
  catch(error){const code=/^[A-Z_]+(?:_\d+)?$/.test(error.message)?error.message:'METADATA_TRANSFER_OR_INTEGRITY_FAILURE';await record({...context,state:'metadata_failed',error:code,...sanitizedMetadataError(error)});failed++;stopped=true;}
 }}
 await Promise.all(Array.from({length:concurrency},worker));await writes;
 await record({schema_version:'original-metadata-cloud-receipt/1',state:stopped?'metadata_batch_stopped':'metadata_batch_finished',project_id:PROJECT,bucket:BUCKET,plan_sha256:sha256(planBytes),verified,failed,selected:selected.length,complete:!stopped&&verified===selected.length});
 console.log(JSON.stringify({state:stopped?'stopped_with_private_receipts':'selected_batch_verified',verified,failed,selected:selected.length}));if(stopped)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('Original metadata upload stopped; inspect the private plan and receipts. Sensitive URLs and credentials withheld.');process.exitCode=1;});
