import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';

const PROJECT='xosqzzsnhxcyehcnirpa',BUCKET='corpus-originals';
const sha=x=>createHash('sha256').update(x).digest('hex');
const defaultPause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function validateDownloadUrl(value,provider){
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('PDF_URL_INVALID');
 const allowed=provider==='docketbird'?u.hostname==='docketbird-case-documents.s3.amazonaws.com':['courtlistener','courtlistener-public-locator'].includes(provider)?u.hostname==='storage.courtlistener.com':provider==='official-court'?/^[a-z0-9.-]+\.uscourts\.gov$/.test(u.hostname):false;
 if(!allowed)throw Error('PDF_HOST_NOT_ALLOWED');return u;
}
export function validateQueueRow(row){
 if(!row||row.schema_version!=='source-qualified-pdf-queue/1'||typeof row.native_document_id!=='string'||!row.native_document_id||row.eligible!==true)throw Error('PDF_ROW_NOT_ELIGIBLE');
 validateDownloadUrl(row.download_url,row.provider);
 if(row.expected_sha1!==null&&row.expected_sha1!==undefined&&!/^[a-f0-9]{40}$/.test(row.expected_sha1))throw Error('INVALID_EXPECTED_SHA1');
 if(row.expected_bytes!==null&&row.expected_bytes!==undefined&&(!Number.isSafeInteger(row.expected_bytes)||row.expected_bytes<=0))throw Error('INVALID_EXPECTED_SIZE');
 if(!Array.isArray(row.origins)||!row.origins.length)throw Error('SOURCE_ORIGIN_REQUIRED');
 for(const origin of row.origins){
  if(!origin||typeof origin!=='object'||Array.isArray(origin)||typeof origin.native_record_sha256!=='string'||!/^[a-f0-9]{64}$/.test(origin.native_record_sha256))throw Error('NATIVE_RECORD_SHA256_REQUIRED');
  if(typeof origin.retrieved_at!=='string'||!Number.isFinite(Date.parse(origin.retrieved_at)))throw Error('SOURCE_OBSERVATION_TIME_REQUIRED');
  if(origin.native_case_id!==undefined&&origin.native_case_id!==row.native_case_id)throw Error('SOURCE_NATIVE_CASE_MISMATCH');
 }
 if(row.selected_source_record_sha256!==undefined&&(!/^[a-f0-9]{64}$/.test(row.selected_source_record_sha256)||!row.origins.some(origin=>origin.native_record_sha256===row.selected_source_record_sha256)))throw Error('SELECTED_SOURCE_VERSION_MISMATCH');
 if(row.provider==='docketbird'){
  const parent=row.native_case_id;
  const federalParent=typeof parent==='string'&&!!parent&&row.native_document_id.startsWith(parent+'-');
  // State IDs use c- for the case and d- for documents. The parent must
  // also be explicitly present in a source observation; never derive it.
  const stateParent=typeof parent==='string'&&parent.startsWith('c-')&&parent.length>2&&row.native_document_id.startsWith('d-'+parent.slice(2)+'-')&&row.origins.some(origin=>origin.native_case_id===parent);
  const explicitAvailability=row.provider_flags?.restricted===false&&[1,true].includes(row.provider_flags?.downloaded);
  const searchLocator=row.provider_flags?.restricted===null&&row.provider_flags?.downloaded===null&&row.provider_flags?.availability_evidence==='publisher_search_pdf_locator'&&row.provider_flags?.search_pdf_url_observed===true&&row.provider_flags?.sealing_related_locator_held===false&&row.origins.some(origin=>origin.source_tool==='search_documents'&&origin.native_case_id===parent);
  if((!explicitAvailability&&!searchLocator)||(!federalParent&&!stateParent))throw Error('RESTRICTED_OR_UNAVAILABLE_PDF');
 }
 if(row.provider==='courtlistener'&&(row.provider_flags?.is_available!==true||![false,null].includes(row.provider_flags?.is_sealed)))throw Error('SEALED_OR_UNAVAILABLE_PDF');
 if(row.provider==='courtlistener-public-locator'){
  if(row.native_document_identity_kind!=='publisher_observed_pdf_locator_url'||row.native_document_id!==row.download_url||row.durable_url!==row.download_url||!/^[1-9][0-9]*$/.test(row.native_case_id??'')||row.provider_flags?.public_pdf_link_observed!==true||row.provider_flags?.sealing_related_locator_held!==false||row.provider_flags?.backend_api_id_verified!==false||row.provider_flags?.api_availability_verified!==false)throw Error('PUBLIC_LOCATOR_IDENTITY_OR_EVIDENCE_MISMATCH');
  const target=new URL(row.download_url);if(target.search||target.hash||!target.pathname.startsWith('/recap/')||!target.pathname.toLowerCase().endsWith('.pdf'))throw Error('PUBLIC_RECAP_LOCATOR_REQUIRED');
 }
 if(row.provider==='official-court'&&row.provider_flags?.sealing_related_locator_held!==false)throw Error('SEALING_RELATED_SOURCE_HELD');
 return row;
}
export function sourcePrivacyQualification(row){
 return row.provider==='courtlistener-public-locator'||(row.provider==='courtlistener'&&row.provider_flags?.is_sealed===null)||(row.provider==='docketbird'&&row.provider_flags?.restricted===null)
  ?{source_seal_status:'unknown',private_quarantine_required:true,public_projection_allowed:false}
  :{source_seal_status:row.provider==='courtlistener'?'explicit_false':row.provider==='docketbird'?'provider_restricted_false':'source_locator_not_sealing_related',private_quarantine_required:false,public_projection_allowed:false};
}
export async function digestStream(stream,{maxBytes,expectedBytes=null,expectedSha1=null,sink=null,allowSizeMismatchIfSha1Matches=false}={}){
 const hash=createHash('sha256'),sha1=createHash('sha1');let bytes=0,first=Buffer.alloc(0);
 const meter=new Transform({transform(chunk,enc,done){bytes+=chunk.length;if(bytes>maxBytes)return done(Error('PDF_SIZE_LIMIT'));if(first.length<1024)first=Buffer.concat([first,chunk.subarray(0,1024-first.length)]);hash.update(chunk);sha1.update(chunk);done(null,sink?chunk:undefined);}});
 if(sink)await pipeline(stream,meter,sink);else await pipeline(stream,meter);
 if(!first.includes(Buffer.from('%PDF-')))throw Error('NOT_A_PDF');
 const digestSha1=sha1.digest('hex');if(expectedSha1&&digestSha1!==expectedSha1)throw Error('SOURCE_SHA1_MISMATCH');
 if(expectedBytes!==null&&expectedBytes!==bytes&&!(allowSizeMismatchIfSha1Matches&&expectedSha1===digestSha1))throw Error('SOURCE_SIZE_MISMATCH');
 return{sha256:hash.digest('hex'),sha1:digestSha1,bytes,source_expected_bytes:expectedBytes,source_size_claim_matched:expectedBytes===null?null:expectedBytes===bytes,source_sha1_claim_matched:expectedSha1===null?null:true};
}
export async function replaceProgressFile(source,target,{rename=fs.rename,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;;attempt++)try{await rename(source,target);return;}catch(error){
  if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=6)throw error;
  await pause(30*2**attempt);
 }
}
export async function retryTransferFileOperation(operation,action,{pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;;attempt++)try{return await action();}catch(error){
  error.operation=operation;
  if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=8)throw error;
  await pause(Math.min(2000,100*2**attempt));
 }
}

// ---------------------------------------------------------------------------------------------
// Transient-failure policy (added 2026-10-03). The Oct 2 runs stopped because one Supabase Storage
// POST answered with Cloudflare HTTP 520 and every CLOUD_* error was fatal to the whole batch.
// Transport failures now retry per file with bounded exponential backoff, repeated failures trip a
// circuit breaker that pauses (not aborts), and a persistent failure is recorded and skipped.
// Integrity checks (PDF magic, SHA-1/SHA-256, byte counts, cloud readback) are unchanged.
// ---------------------------------------------------------------------------------------------
const TRANSIENT_HTTP=new Set([408,425,429,500,502,503,504,520,521,522,523,524,525,526,527,530]);
export function isTransientHttpStatus(status){return TRANSIENT_HTTP.has(status);}
const NETWORK_CODES=new Set(['ECONNRESET','ECONNREFUSED','ECONNABORTED','ETIMEDOUT','EPIPE','ENOTFOUND','EAI_AGAIN','ENETUNREACH','ENETDOWN','EHOSTUNREACH','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_ABORTED','UND_ERR_CLOSED','UND_ERR_REQ_CONTENT_LENGTH_MISMATCH','UND_ERR_RES_CONTENT_LENGTH_MISMATCH','ERR_STREAM_PREMATURE_CLOSE','ABORT_ERR']);
export function isTransientNetworkError(error){
 for(let current=error,depth=0;current&&depth<5;current=current.cause,depth++){
  if(current.name==='TimeoutError'||current.name==='AbortError'||NETWORK_CODES.has(current.code))return true;
  if(current instanceof TypeError&&/^(?:fetch failed|terminated)$/.test(current.message))return true;
 }
 return false;
}
export function isTransientCloudError(error){
 const message=typeof error?.message==='string'?error.message:'';
 const status=/^CLOUD_(?:UPLOAD|VERIFY|TUS_INIT|TUS_CHUNK)_HTTP_(\d+)$/.exec(message);
 if(status)return isTransientHttpStatus(Number(status[1]));
 if(/^CLOUD_(?:VERIFY_NETWORK|TUS_CHUNK_NOT_ACKNOWLEDGED|TUS_OFFSET_UNKNOWN|TUS_RESUME_AUDIT_FAILED|TUS_LOCATION_MISSING)$/.test(message))return true;
 return !/^CLOUD_/.test(message)&&isTransientNetworkError(error);
}
export function retryAfterMs(value,fallback,now=Date.now()){
 if(!value)return fallback;
 const seconds=Number(value);if(Number.isFinite(seconds))return Math.max(1000,seconds*1000);
 const at=Date.parse(value);return Number.isFinite(at)?Math.max(1000,at-now):fallback;
}
export function backoffDelay(attempt,{baseMs=1000,maxMs=60000,random=Math.random}={}){
 return Math.round(Math.min(maxMs,baseMs*2**attempt)*(0.75+0.5*random()));
}
export async function withBackoff(action,{attempts=5,baseMs=1000,maxMs=60000,isRetryable=()=>true,pause=defaultPause,random=Math.random,onRetry=async()=>{}}={}){
 for(let attempt=0;;attempt++)try{return await action(attempt);}catch(error){
  if(attempt+1>=attempts||!isRetryable(error))throw error;
  const delay=Math.max(Number.isFinite(error?.retryAfterMs)?error.retryAfterMs:0,backoffDelay(attempt,{baseMs,maxMs,random}));
  await onRetry(error,attempt,delay);await pause(delay);
 }
}
// Source pacing shared by all workers: every request takes a slot spaced by `sourceDelayMs` (globally) and `workerDelayMs` (per worker).
// An HTTP 429 raises a sticky rate level (spacing x (1+level)) that only relaxes after `recoverAfter` consecutive successes, so a restart
// (the level is persisted by the caller) does not immediately re-probe the pace that was just refused. 5xx/reset penalties are separate and short-lived.
export function createPacer({sourceDelayMs=0,workerDelayMs=0,initialWaitMs=0,now=Date.now,pause=defaultPause,level=0,maxLevel=6,recoverAfter=2000,onLevelChange=()=>{}}={}){
 let nextSourceAt=now()+initialWaitMs,blockedUntil=0,penaltyMs=0,goodStreak=0,rateLevel=Math.min(maxLevel,Math.max(0,level)),calm=0;
 const spacing=()=>sourceDelayMs*(1+rateLevel)+penaltyMs;
 return{
  spacing,
  async slot(pace){for(;;){const due=Math.max(now(),nextSourceAt,blockedUntil,pace.nextAt);nextSourceAt=due+spacing();pace.nextAt=due+workerDelayMs*(1+rateLevel)+penaltyMs;if(due>now())await pause(due-now());if(blockedUntil<=now())return;}},
  block(ms){blockedUntil=Math.max(blockedUntil,now()+ms);return blockedUntil;},
  rateLimited(){rateLevel=Math.min(maxLevel,rateLevel+1);calm=0;goodStreak=0;onLevelChange(rateLevel);},
  penalize(){goodStreak=0;penaltyMs=Math.min(8000,Math.max(500,penaltyMs*2));},
  success(){
   if(penaltyMs&&++goodStreak>=25){goodStreak=0;penaltyMs=penaltyMs<=250?0:Math.floor(penaltyMs/2);}
   if(rateLevel&&++calm>=recoverAfter){calm=0;rateLevel--;onLevelChange(rateLevel);}
  },
  get level(){return rateLevel;},get penaltyMs(){return penaltyMs;},get blockedUntil(){return blockedUntil;}
 };
}
const DIAGNOSTIC_HEADERS=['retry-after','server','via','x-cache','x-amz-cf-pop','x-amzn-errortype','content-type','date','age'];
// A bounded, non-sensitive description of a refusal (status text, a few response headers, the first 300 body characters).
export async function describeRefusal(response){
 let body=null;try{body=(await response.text()).slice(0,300);}catch{/* body unavailable */}
 return{status:response.status,status_text:response.statusText||null,headers:Object.fromEntries(DIAGNOSTIC_HEADERS.map(h=>[h,response.headers.get(h)]).filter(([,v])=>v!==null)),body_snippet:body};
}
// Pauses all workers after `threshold` consecutive failures; stops (breakerExhausted) only after a
// sustained outage of `maxTrips` consecutive cool-downs without a single success.
export class FailureBreaker{
 constructor({stopCode,threshold=6,baseCooldownMs=30000,maxCooldownMs=900000,maxTrips=8,now=Date.now,pause=defaultPause,onTrip=()=>{}}={}){
  Object.assign(this,{stopCode,threshold,baseCooldownMs,maxCooldownMs,maxTrips,now,pause,onTrip,consecutive:0,trips:0,openUntil:0,totalTrips:0});
 }
 success(){this.consecutive=0;this.trips=0;}
 failure(){
  if(++this.consecutive<this.threshold)return false;
  this.consecutive=0;this.trips++;this.totalTrips++;
  const cooldown=Math.min(this.maxCooldownMs,this.baseCooldownMs*2**(this.trips-1));
  this.openUntil=this.now()+cooldown;this.onTrip({stopCode:this.stopCode,trips:this.trips,cooldown_ms:cooldown,resume_after:new Date(this.openUntil).toISOString()});return true;
 }
 get exhausted(){return this.trips>=this.maxTrips;}
 async gate(){
  for(;;){
   if(this.exhausted)throw Object.assign(Error(this.stopCode),{breakerExhausted:true});
   const wait=this.openUntil-this.now();if(wait<=0)return;await this.pause(Math.min(wait,5000));
  }
 }
}
// Permanent source answers are recorded once and never retried by the retry worker.
const PERMANENT_ERROR=/^(?:SOURCE_HTTP_(?:400|401|402|403|404|405|406|409|410|451)|NOT_A_PDF|SOURCE_SHA1_MISMATCH|SOURCE_SIZE_MISMATCH|PDF_SIZE_LIMIT|PDF_HOST_NOT_ALLOWED|PDF_URL_INVALID|PDF_REDIRECT_LIMIT|PDF_REDIRECT_MISSING|CLOUD_HASH_MISMATCH)$/;
export function classifyFailure(error){
 const message=typeof error?.message==='string'?error.message:'';
 let code=/^(?:SOURCE_SHA1_MISMATCH|[A-Z_]+(?:_\d+)?)$/.test(message)?message:null;
 if(!code)code=isTransientNetworkError(error)?(error?.name==='TimeoutError'?'NETWORK_TIMEOUT':'NETWORK_ERROR'):'TRANSFER_OR_INTEGRITY_FAILURE';
 return{error:code,retryable:!PERMANENT_ERROR.test(code)};
}
async function safeFetch(url,opts,provider,fetchImpl=fetch){
 let target=validateDownloadUrl(url,provider);
 for(let redirects=0;redirects<5;redirects++){
  const response=await fetchImpl(target,{...opts,redirect:'manual'});
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('PDF_REDIRECT_MISSING');target=validateDownloadUrl(new URL(location,target).href,provider);continue;}
  return response;
 }
 throw Error('PDF_REDIRECT_LIMIT');
}
// Per-file source download. Network resets, timeouts, mid-stream cuts and 5xx answers retry with
// exponential backoff; 401/403/404/NOT_A_PDF/hash/size problems are permanent for the file.
export async function fetchSourcePdf({row,temp,maxBytes,fetchImpl=fetch,slot=async()=>{},breaker=null,onRateLimit=async()=>{},onPenalty=()=>{},onAccessDenied=()=>{},onSuccess=()=>{},attempts=5,backoff={baseMs:1500,maxMs:30000},pause=defaultPause,random=Math.random,discard=file=>retryTransferFileOperation('partial_temp_unlink',()=>fs.rm(file,{force:true}))}){
 let last=null;
 for(let attempt=0;attempt<attempts;attempt++){
  const final=attempt+1>=attempts,wait=()=>final?undefined:pause(backoffDelay(attempt,{...backoff,random}));
  await breaker?.gate();await slot();
  let response;
  try{response=await safeFetch(row.download_url,{signal:AbortSignal.timeout(300000)},row.provider,fetchImpl);}
  catch(error){
   if(!isTransientNetworkError(error))throw error;
   breaker?.failure();onPenalty();last=Object.assign(Error(error?.name==='TimeoutError'?'SOURCE_TIMEOUT':'SOURCE_NETWORK_ERROR'),{cause:error});await wait();continue;
  }
  if(response.status===429){await onRateLimit(response,attempt,final);if(final)throw Error('SOURCE_HTTP_429');last=Error('SOURCE_HTTP_429');continue;}
  if([401,403].includes(response.status)){await response.body?.cancel();onAccessDenied(response.status);throw Error('SOURCE_HTTP_'+response.status);}
  if(!response.ok){
   await response.body?.cancel();
   if(!isTransientHttpStatus(response.status))throw Error('SOURCE_HTTP_'+response.status);
   breaker?.failure();onPenalty();last=Error('SOURCE_HTTP_'+response.status);if(final)throw last;await wait();continue;
  }
  const announced=response.headers.get('content-length');if(announced&&Number(announced)>maxBytes){await response.body?.cancel();throw Error('PDF_SIZE_LIMIT');}
  try{
   const digest=await digestStream(Readable.fromWeb(response.body),{maxBytes,expectedBytes:row.expected_bytes??null,expectedSha1:row.expected_sha1??null,sink:createWriteStream(temp,{flags:'wx'}),allowSizeMismatchIfSha1Matches:row.provider==='courtlistener'});
   breaker?.success();onSuccess();return digest;
  }catch(error){
   if(!isTransientNetworkError(error))throw error;
   // A body cut mid-stream leaves a partial file; it is discarded because the attempt is repeated.
   await discard(temp);breaker?.failure();onPenalty();last=Object.assign(Error(error?.name==='TimeoutError'?'SOURCE_TIMEOUT':'SOURCE_STREAM_ERROR'),{cause:error});if(final)throw last;await wait();
  }
 }
 throw last??Error('SOURCE_RETRIES_EXHAUSTED');
}
// Cloud side: content-addressed immutable objects (x-upsert:false) verified by full authenticated
// readback. Any unknown outcome is resolved by auditing the exact object, never by overwriting it.
export function createCloudStore({project=PROJECT,bucket=BUCKET,storage,tusEndpoint='https://'+project+'.storage.supabase.co/storage/v1/upload/resumable',headers,fetchImpl=fetch,pause=defaultPause,random=Math.random,record,maxBytes,resumableLocations=new Map(),breaker=null,attempts=5,backoff={baseMs:2000,maxMs:60000},now=Date.now}){
 const verifiedObjects=new Map();
 const retryDelay=(response,fallback)=>retryAfterMs(response.headers.get('retry-after'),fallback,now());
 async function verifyObject(key,expected){
  let response;
  for(let attempt=0;attempt<4;attempt++){
   try{response=await fetchImpl(storage+'/object/authenticated/'+bucket+'/'+key,{headers,redirect:'error',signal:AbortSignal.timeout(300000)});}catch{if(attempt===3)throw Error('CLOUD_VERIFY_NETWORK');await pause(1000*2**attempt);continue;}
   if(isTransientHttpStatus(response.status)&&attempt<3){const delay=retryDelay(response,1000*2**attempt);await response.body?.cancel();await pause(delay);continue;}break;
  }
  if(!response.ok){let errorCode=null;try{const data=await response.json();errorCode=data.code??data.error;}catch{}if(response.status===404||(response.status===400&&errorCode==='NoSuchKey'))throw Error('CLOUD_OBJECT_NOT_FOUND');throw Error('CLOUD_VERIFY_HTTP_'+response.status);}
  const actual=await digestStream(Readable.fromWeb(response.body),{maxBytes,expectedBytes:expected.bytes,expectedSha1:expected.sha1});
  if(actual.sha256!==expected.sha256)throw Error('CLOUD_HASH_MISMATCH');return actual;
 }
 async function uploadResumable(key,file,digest,context){
  const tusHeaders={...headers,'Tus-Resumable':'1.0.0','x-upsert':'false'};
  const metadata=Object.entries({bucketName:bucket,objectName:key,contentType:'application/pdf',cacheControl:'3600'}).map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');
  function validateLocation(location){const target=new URL(location,tusEndpoint);if(target.protocol!=='https:'||![project+'.storage.supabase.co',project+'.supabase.co'].includes(target.hostname)||target.username||target.password||target.port||!target.pathname.startsWith('/storage/v1/upload/resumable/'))throw Error('CLOUD_TUS_LOCATION_INVALID');return target;}
  let target=null,offset=0;const prior=resumableLocations.get(key);
  if(prior?.bytes===digest.bytes&&prior.sha256===digest.sha256){
   const candidate=validateLocation(prior.upload_location),head=await fetchImpl(candidate,{method:'HEAD',headers:tusHeaders,redirect:'error',signal:AbortSignal.timeout(30000)});
   const serverOffset=Number(head.headers.get('upload-offset')),serverLength=Number(head.headers.get('upload-length'));await head.body?.cancel();
   if(head.ok&&serverLength===digest.bytes&&Number.isSafeInteger(serverOffset)&&serverOffset>=0&&serverOffset<=digest.bytes){target=candidate;offset=serverOffset;}
   else if(![404,410].includes(head.status))throw Error('CLOUD_TUS_RESUME_AUDIT_FAILED');
  }
  if(!target){
   const init=await fetchImpl(tusEndpoint,{method:'POST',headers:{...tusHeaders,'Upload-Length':String(digest.bytes),'Upload-Metadata':metadata},redirect:'error',signal:AbortSignal.timeout(90000)});
   if(!init.ok){const status=init.status;await init.body?.cancel();if([400,409].includes(status))return{upload_http_status:status,method:'tus_existing_object_audit'};throw Error('CLOUD_TUS_INIT_HTTP_'+status);}
   const location=init.headers.get('location');await init.body?.cancel();if(!location)throw Error('CLOUD_TUS_LOCATION_MISSING');target=validateLocation(location);
   const created={...context,state:'resumable_upload_created',storage_key:key,...digest,upload_location:target.href};await record(created);resumableLocations.set(key,created);
  }
  const fd=await fs.open(file,'r');
  try{while(offset<digest.bytes){
   const count=Math.min(6*1024**2,digest.bytes-offset),buffer=Buffer.allocUnsafe(count);let read=0;while(read<count){const part=await fd.read(buffer,read,count-read,offset+read);if(!part.bytesRead)throw Error('LOCAL_PDF_SHORT_READ');read+=part.bytesRead;}
   let acknowledged=false;
   for(let attempt=0;attempt<3&&!acknowledged;attempt++){
    let chunk=null;try{chunk=await fetchImpl(target,{method:'PATCH',headers:{...tusHeaders,'Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream','Content-Length':String(count)},body:buffer,redirect:'error',signal:AbortSignal.timeout(180000)});}catch{/* Exact TUS offset audit below resolves unknown chunk acknowledgement. */}
    const chunkStatus=chunk?.status,chunkOffset=Number(chunk?.headers.get('upload-offset'));await chunk?.body?.cancel();
    if(chunk?.ok&&chunkOffset===offset+count){offset=chunkOffset;acknowledged=true;break;}
    if(chunkStatus&&chunkStatus!==409&&!isTransientHttpStatus(chunkStatus))throw Error('CLOUD_TUS_CHUNK_HTTP_'+chunkStatus);
    const check=await fetchImpl(target,{method:'HEAD',headers:tusHeaders,redirect:'error',signal:AbortSignal.timeout(30000)});const checkedOffset=Number(check.headers.get('upload-offset'));await check.body?.cancel();
    if(!check.ok||!Number.isSafeInteger(checkedOffset)||checkedOffset<offset||checkedOffset>offset+count)throw Error('CLOUD_TUS_OFFSET_UNKNOWN');
    if(checkedOffset>offset){await record({...context,state:'resumable_chunk_offset_audited',storage_key:key,previous_offset:offset,acknowledged_offset:checkedOffset});offset=checkedOffset;acknowledged=true;break;}
    await pause(1000*(attempt+1));
   }
   if(!acknowledged)throw Error('CLOUD_TUS_CHUNK_NOT_ACKNOWLEDGED');
  }}finally{await fd.close();}
  return{upload_http_status:204,method:'tus_6mib_chunks'};
 }
 async function attemptEnsure(key,file,digest,context){
  if(digest.bytes>6*1024**2){const upload=await uploadResumable(key,file,digest,context);await verifyObject(key,digest);return{...upload,verified_at:new Date().toISOString()};}
  let response=null;
  try{response=await fetchImpl(storage+'/object/'+bucket+'/'+key,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','Content-Length':String(digest.bytes),'x-upsert':'false'},body:createReadStream(file),duplex:'half',redirect:'error',signal:AbortSignal.timeout(300000)});}catch{/* Audit the exact immutable object after any unknown response. */}
  const uploadStatus=response?.status??null;let uploadCode=null;
  if(response){try{const body=await response.json();uploadCode=typeof body.code==='string'?body.code:typeof body.error==='string'?body.error:null;}catch{/* Full immutable readback below remains the byte-integrity authority. */}}
  await record({...context,state:'upload_response',storage_key:key,...digest,upload_http_status:uploadStatus,upload_error_code:uploadCode});
  // 400/409 carry "already exists"; transient statuses (incl. Cloudflare 520-530) are resolved by the audit below.
  if(response&&!response.ok&&![400,409].includes(response.status)&&!isTransientHttpStatus(response.status))throw Error('CLOUD_UPLOAD_HTTP_'+response.status);
  try{await verifyObject(key,digest);}catch(e){
   if(e.message==='CLOUD_OBJECT_NOT_FOUND'&&(!response||isTransientHttpStatus(response.status))){
    // A missing immutable object after an unknown response is retried through
    // resumable transport; no existing object is overwritten.
    if(response?.status===429)await pause(retryDelay(response,30000));
    const recovery=await uploadResumable(key,file,digest,context);await verifyObject(key,digest);return{...recovery,verified_at:new Date().toISOString()};
   }
   throw e;
  }
  return{upload_http_status:uploadStatus,verified_at:new Date().toISOString()};
 }
 async function ensureObject(key,file,digest,context){
  if(verifiedObjects.has(key))return verifiedObjects.get(key);
  const work=(async()=>{
   await record({...context,state:'upload_pending',storage_key:key,...digest});
   return withBackoff(async()=>{
    await breaker?.gate();
    try{const result=await attemptEnsure(key,file,digest,context);breaker?.success();return result;}
    catch(error){if(isTransientCloudError(error))breaker?.failure();throw error;}
   },{attempts,...backoff,pause,random,isRetryable:isTransientCloudError,onRetry:(error,attempt,delay)=>record({...context,state:'cloud_retry',storage_key:key,attempt:attempt+1,error_code:/^[A-Z_0-9]+$/.test(error?.message??'')?error.message:'CLOUD_NETWORK_ERROR',delay_ms:delay})});
  })();verifiedObjects.set(key,work);try{return await work;}catch(e){verifiedObjects.delete(key);throw e;}
 }
 return{ensureObject,verifyObject};
}
async function main(){
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];}));
 const queuePath=path.resolve(String(args.queue)),queueBytes=await fs.readFile(queuePath);
 if(sha(queueBytes)!==args['queue-sha256'])throw Error('QUEUE_HASH_MISMATCH');
 const all=queueBytes.toString().trim().split('\n').map(x=>JSON.parse(x));
 const rows=all.filter(x=>x.eligible).map(validateQueueRow);
 const root=path.resolve(String(args.cache)),receiptPath=path.join(root,'transfer-receipts.jsonl'),statusPath=path.join(root,'progress.json');
 await fs.mkdir(path.join(root,'staging'),{recursive:true});
 let existing=[];try{existing=(await fs.readFile(receiptPath,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch(e){if(e.code!=='ENOENT')throw Error('RECEIPT_READ_FAILED');}
 const versionOf=row=>row.selected_source_record_sha256??[...(row.origins??[])].sort((a,b)=>b.retrieved_at.localeCompare(a.retrieved_at))[0]?.native_record_sha256;
 const rowMap=new Map(rows.map(row=>[row.provider+'|'+row.native_document_id,row]));
 const done=new Set(existing.filter(x=>{
  const row=rowMap.get(x.provider+'|'+x.native_document_id);if(!row)return false;
  const version=x.selected_source_record_sha256??[...(x.source_origins??[])].sort((a,b)=>b.retrieved_at.localeCompare(a.retrieved_at))[0]?.native_record_sha256;
  return x.state==='cloud_verified'&&x.project_id===PROJECT&&x.bucket===BUCKET&&/^[a-f0-9]{64}$/.test(x.sha256??'')&&x.storage_key==='seeger-weiss/pdf-sha256/'+x.sha256.slice(0,2)+'/'+x.sha256+'.pdf'&&Number.isSafeInteger(x.bytes)&&x.bytes>0&&version&&version===versionOf(row);
 }).map(x=>x.provider+'|'+x.native_document_id));
 const maxFiles=Number(args['max-files']??1000),concurrency=Number(args.concurrency??8),maxBytes=Number(args['max-file-mb']??512)*1024**2;
 if(!Number.isSafeInteger(maxFiles)||maxFiles<1||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>12||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2*1024**3)throw Error('TRANSFER_BOUNDS_INVALID');
 const pending=rows.filter(x=>!done.has(x.provider+'|'+x.native_document_id)).slice(0,maxFiles);
 const sourceDelayMs=Number(args['source-delay-ms']??0),initialWaitMs=Number(args['initial-wait-ms']??0),workerDelayMs=Number(args['worker-delay-ms']??0);
 if(!Number.isSafeInteger(sourceDelayMs)||sourceDelayMs<0||!Number.isSafeInteger(initialWaitMs)||initialWaitMs<0||!Number.isSafeInteger(workerDelayMs)||workerDelayMs<0)throw Error('INVALID_SOURCE_PACING');
 if(!args.execute){console.log(JSON.stringify({state:'verified_dry_run',queued:rows.length,held:all.length-rows.length,alreadyVerified:done.size,pending:pending.length}));return;}
 const cfg=JSON.parse(await fs.readFile(String(args.credentials),'utf8'));
 if(cfg.EXTERNAL_SUPABASE_URL!=='https://'+PROJECT+'.supabase.co')throw Error('WRONG_PROJECT');
 const token=cfg.EXTERNAL_SUPABASE_KEY;if(typeof token!=='string')throw Error('SERVER_KEY_MISSING');
 if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.role!=='service_role'||claims.ref!==PROJECT)throw Error('WRONG_SERVER_ROLE');}else if(!token.startsWith('sb_secret_'))throw Error('SERVER_ROLE_REQUIRED');
 const storage=cfg.EXTERNAL_SUPABASE_URL+'/storage/v1',headers={apikey:token,...(!token.startsWith('sb_')?{Authorization:'Bearer '+token}:{})};
 const bucketResponse=await withBackoff(async()=>{const response=await fetch(storage+'/bucket/'+BUCKET,{headers,signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok){const error=Error('BUCKET_READ_FAILED');error.transient=isTransientHttpStatus(response.status);throw error;}return response;},{attempts:4,baseMs:2000,isRetryable:e=>e.transient===true||isTransientNetworkError(e)});
 const info=await bucketResponse.json();if(info.id!==BUCKET||info.public!==false)throw Error('PRIVATE_BUCKET_REQUIRED');
 let writeQueue=Promise.resolve(),statusQueue=Promise.resolve(),cursor=0,stopped=false;
 const state={schema_version:'pdf-cloud-backfill-progress/1',project_id:PROJECT,bucket:BUCKET,queue_sha256:sha(queueBytes),started_at:new Date().toISOString(),eligible:rows.length,held:all.length-rows.length,initially_verified:done.size,selected:pending.length,processed:0,cloud_verified:0,bytes_verified:0,failed:0,failed_retryable:0,failed_permanent:0,cloud_breaker_trips:0,source_breaker_trips:0,stop_reason:null,complete:false};
 const save=()=>{state.updated_at=new Date().toISOString();const body=JSON.stringify(state,null,2)+'\n';statusQueue=statusQueue.then(async()=>{await retryTransferFileOperation('progress_snapshot_write',()=>fs.writeFile(statusPath+'.part',body));await retryTransferFileOperation('progress_snapshot_replace',()=>fs.rename(statusPath+'.part',statusPath));});return statusQueue;};
 const record=event=>{writeQueue=writeQueue.then(async()=>{
  const fd=await retryTransferFileOperation('receipt_open',()=>fs.open(receiptPath,'a'));
  try{
   // A partly acknowledged append is never blindly retried. Retry fsync on
   // the same descriptor only; the immutable bytes are written once.
   try{const raw=Buffer.from(JSON.stringify({...event,recorded_at:new Date().toISOString()})+'\n');const result=await fd.write(raw);if(result.bytesWritten!==raw.length)throw Error('RECEIPT_SHORT_APPEND');}catch(error){error.operation='receipt_append';throw error;}
   await retryTransferFileOperation('receipt_fsync',()=>fd.sync());
  }finally{await retryTransferFileOperation('receipt_close',()=>fd.close());}
 });return writeQueue;};
 const pause=defaultPause;
 // The learned 429 level is shared across batches/restarts through --pacing-file (a refused pace is not re-probed at every batch start).
 const pacingFile=typeof args['pacing-file']==='string'?path.resolve(args['pacing-file']):null;
 let startLevel=0;if(pacingFile)try{startLevel=Number(JSON.parse(await fs.readFile(pacingFile,'utf8')).level)||0;}catch{/* first run */}
 const pacer=createPacer({sourceDelayMs,workerDelayMs,initialWaitMs,level:startLevel,pause,onLevelChange:level=>{
  state.rate_level=level;state.source_spacing_ms=pacer.spacing();
  if(pacingFile)fs.writeFile(pacingFile+'.part',JSON.stringify({level,spacing_ms:pacer.spacing(),updated_at:new Date().toISOString()}))
   .then(()=>fs.rename(pacingFile+'.part',pacingFile)).catch(()=>{/* the in-process level still applies */});
 }});
 state.rate_level=pacer.level;state.source_spacing_ms=pacer.spacing();
 let accessDenied=0,hardCloudFailures=0;
 const cloudBreaker=new FailureBreaker({stopCode:'CLOUD_STORAGE_UNAVAILABLE',threshold:6,baseCooldownMs:30000,maxTrips:8,pause,onTrip:t=>{state.cloud_breaker_trips++;state.cloud_breaker_resume_after=t.resume_after;record({state:'breaker_tripped',breaker:'cloud',...t}).catch(()=>{});save().catch(()=>{});}});
 const sourceBreaker=new FailureBreaker({stopCode:'SOURCE_UNAVAILABLE',threshold:8,baseCooldownMs:30000,maxTrips:8,pause,onTrip:t=>{state.source_breaker_trips++;state.source_breaker_resume_after=t.resume_after;record({state:'breaker_tripped',breaker:'source',...t}).catch(()=>{});save().catch(()=>{});}});
 const resumableLocations=new Map(existing.filter(x=>x.state==='resumable_upload_created'&&/^[a-f0-9]{64}$/.test(x.sha256??'')&&x.storage_key==='seeger-weiss/pdf-sha256/'+x.sha256.slice(0,2)+'/'+x.sha256+'.pdf').map(x=>[x.storage_key,x]));
 existing=[];
 const cloud=createCloudStore({storage,headers,record,maxBytes,resumableLocations,breaker:cloudBreaker,pause});
 await save();
 // HTTP 429 from the source: honor Retry-After for every worker; the fourth consecutive 429 for one file stops the run.
 async function rateLimited(context,response,final){
  const delay=retryAfterMs(response.headers.get('retry-after'),300000),refusal=await describeRefusal(response);
  pacer.rateLimited();state.rate_limit_events=(state.rate_limit_events??0)+1;
  state.provider_cooldown_until=new Date(pacer.block(delay)).toISOString();
  await record({...context,state:'source_rate_limit_wait',retry_after:response.headers.get('retry-after'),resume_after:state.provider_cooldown_until,rate_level:pacer.level,next_spacing_ms:pacer.spacing(),refusal});
  await response.body?.cancel().catch(()=>{});await save();
  if(final){stopped=true;state.stop_reason='PROVIDER_RATE_LIMIT_REPEATED';}
 }
 async function worker(){
  const pace={nextAt:0};
  for(;;){if(stopped)return;const row=pending[cursor++];if(!row)return;
   const context={provider:row.provider,native_document_id:row.native_document_id,native_document_identity_kind:row.native_document_identity_kind??null,native_case_id:row.native_case_id,durable_url:row.durable_url??null,queue_sha256:sha(queueBytes),selected_source_record_sha256:versionOf(row),source_origins:row.origins,provider_flags:row.provider_flags,source_privacy_qualification:sourcePrivacyQualification(row)};
   const temp=path.join(root,'staging',randomUUID()+'.part');
   try{
    const disk=await fs.statfs(root);if(disk.bavail*disk.bsize<20*1024**3+maxBytes*concurrency){stopped=true;state.stop_reason='LOCAL_DISK_RESERVE';return;}
    await record({...context,state:'download_pending'});
    const digest=await fetchSourcePdf({row,temp,maxBytes,slot:()=>pacer.slot(pace),breaker:sourceBreaker,onPenalty:()=>{pacer.penalize();state.source_penalty_ms=pacer.penaltyMs;},onSuccess:()=>{accessDenied=0;pacer.success();},onAccessDenied:status=>{if(++accessDenied>=8){stopped=true;state.stop_reason='SOURCE_ACCESS_DENIED_REPEATED';}},
     onRateLimit:(response,attempt,final)=>rateLimited(context,response,final),pause});
    const handle=await fs.open(temp,'r+');try{await handle.sync();}finally{await handle.close();}
    const key='seeger-weiss/pdf-sha256/'+digest.sha256.slice(0,2)+'/'+digest.sha256+'.pdf';
    await record({...context,state:'local_pdf_verified',storage_key:key,...digest});
    const stored=await cloud.ensureObject(key,temp,digest,context);
    await record({...context,state:'cloud_verified',bucket:BUCKET,project_id:PROJECT,storage_key:key,...digest,...stored});
    hardCloudFailures=0;done.add(row.provider+'|'+row.native_document_id);state.cloud_verified++;state.bytes_verified+=digest.bytes;state.last_verified_at=new Date().toISOString();
    // Only this worker-created temporary file is removed, after the durable cloud receipt.
    try{await retryTransferFileOperation('verified_temporary_cache_unlink',()=>fs.unlink(temp));}catch(cleanupError){
     state.cleanup_deferred=(state.cleanup_deferred??0)+1;
     await record({...context,state:'cleanup_deferred',storage_key:key,sha256:digest.sha256,local_cache_path:temp,cloud_pdf_remains_verified:true,error_code:['EPERM','EACCES','EBUSY','ENOENT'].includes(cleanupError.code)?cleanupError.code:'CACHE_CLEANUP_FAILURE'});
    }
   }catch(e){
    if(e?.breakerExhausted){
     // A sustained outage: the row is deferred (not failed) and the run stops with a restartable reason.
     stopped=true;state.stop_reason??=e.message;await record({...context,state:'row_deferred',reason:e.message,local_cache_path:temp});await save();return;
    }
    const failure=classifyFailure(e);state.failed++;state[failure.retryable?'failed_retryable':'failed_permanent']++;
    await record({...context,state:'failed',error:failure.error,retryable:failure.retryable,local_cache_path:temp});
    // Integrity alarm: bytes in the immutable object do not match. Never continue past it automatically.
    if(failure.error==='CLOUD_HASH_MISMATCH'){stopped=true;state.stop_reason=failure.error;}
    // A non-transport cloud rejection (credentials, bucket policy) that repeats is systemic, not per file.
    else if(/^CLOUD_/.test(failure.error)&&!isTransientCloudError(e)&&++hardCloudFailures>=3){stopped=true;state.stop_reason=failure.error;}
   }
   state.processed++;await save();if(state.processed%25===0)console.log(JSON.stringify({processed:state.processed,cloudVerified:state.cloud_verified,bytesVerified:state.bytes_verified,failed:state.failed,selected:pending.length}));
  }
 }
 await Promise.all(Array.from({length:concurrency},worker));await writeQueue;state.complete=state.processed===pending.length&&!stopped;state.finished_at=new Date().toISOString();await save();
 console.log(JSON.stringify({state:state.complete?'selected_batch_finished':'stopped_with_receipts',cloudVerified:state.cloud_verified,bytesVerified:state.bytes_verified,failed:state.failed,pendingRemaining:rows.length-done.size,stopReason:state.stop_reason}));
 if(stopped)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(async error=>{
 const allowedCodes=new Set(['EPERM','EACCES','EBUSY','ENOENT','ENOSPC','ECONNRESET','ETIMEDOUT','UND_ERR_SOCKET']);
 const operations=new Set(['progress_snapshot_write','progress_snapshot_replace','receipt_open','receipt_append','receipt_fsync','receipt_close','verified_temporary_cache_unlink','partial_temp_unlink']);
 const summary={state:'worker_fatal',recorded_at:new Date().toISOString(),error:typeof error.message==='string'&&/^[A-Z_]+(?:_\d+)?$/.test(error.message)?error.message:'FATAL_TRANSFER_OR_PROGRESS_FAILURE',code:allowedCodes.has(error.code)?error.code:null,operation:operations.has(error.operation)?error.operation:null};
 try{const cacheArg=process.argv.slice(2).find(x=>x.startsWith('--cache=')),cache=path.resolve(cacheArg?.slice(8)??'');if(cache.replaceAll('\\','/').toLowerCase().startsWith('c:/users/firas/.codex/corpus-cache/'))await fs.writeFile(path.join(cache,'fatal-'+randomUUID()+'.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});}catch{/* Original durable receipts remain the recovery authority. */}
 console.error(JSON.stringify(summary));process.exitCode=1;
});
