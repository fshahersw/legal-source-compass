import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
 isTransientHttpStatus,isTransientNetworkError,isTransientCloudError,classifyFailure,retryAfterMs,backoffDelay,withBackoff,FailureBreaker,fetchSourcePdf,createCloudStore,createPacer,describeRefusal
} from './backfill-pdfs-to-supabase.mjs';

const pdf=label=>Buffer.from('%PDF-1.7\n'+label+'\n%%EOF\n');
const digestOf=bytes=>({sha256:createHash('sha256').update(bytes).digest('hex'),sha1:createHash('sha1').update(bytes).digest('hex'),bytes:bytes.length});
const noPause=()=>{const delays=[];const pause=async ms=>{delays.push(ms);};pause.delays=delays;return pause;};
const middle=()=>0.5; // jitter factor exactly 1.0
const networkError=code=>Object.assign(new TypeError('fetch failed'),{cause:Object.assign(new Error('read '+code),{code})});
async function tmp(){return fs.mkdtemp(path.join(os.tmpdir(),'pdf-resilience-'));}

test('Cloudflare edge errors, rate limits and gateway errors are transient; client errors are not',()=>{
 for(const status of [408,425,429,500,502,503,504,520,521,522,523,524,525,526,527,530])assert.equal(isTransientHttpStatus(status),true,String(status));
 for(const status of [200,400,401,403,404,409,413,422,501,505])assert.equal(isTransientHttpStatus(status),false,String(status));
});

test('network resets, timeouts and cut streams are transient; integrity answers are not',()=>{
 assert.equal(isTransientNetworkError(networkError('ECONNRESET')),true);
 assert.equal(isTransientNetworkError(networkError('UND_ERR_SOCKET')),true);
 assert.equal(isTransientNetworkError(new DOMException('The operation was aborted due to timeout','TimeoutError')),true);
 assert.equal(isTransientNetworkError(Object.assign(new TypeError('terminated'),{cause:Object.assign(new Error('other side closed'),{code:'UND_ERR_SOCKET'})})),true);
 assert.equal(isTransientNetworkError(Object.assign(new Error('Premature close'),{code:'ERR_STREAM_PREMATURE_CLOSE'})),true);
 for(const message of ['NOT_A_PDF','SOURCE_SHA1_MISMATCH','CLOUD_HASH_MISMATCH','PDF_HOST_NOT_ALLOWED'])assert.equal(isTransientNetworkError(Error(message)),false,message);
 assert.equal(isTransientNetworkError(new TypeError('Invalid URL')),false);
});

test('cloud errors: 520-class and chunk acknowledgement problems retry; credentials, policy and hash mismatches do not',()=>{
 for(const message of ['CLOUD_UPLOAD_HTTP_520','CLOUD_UPLOAD_HTTP_503','CLOUD_VERIFY_HTTP_524','CLOUD_TUS_INIT_HTTP_520','CLOUD_TUS_CHUNK_HTTP_502','CLOUD_VERIFY_NETWORK','CLOUD_TUS_CHUNK_NOT_ACKNOWLEDGED','CLOUD_TUS_OFFSET_UNKNOWN','CLOUD_TUS_RESUME_AUDIT_FAILED'])assert.equal(isTransientCloudError(Error(message)),true,message);
 for(const message of ['CLOUD_UPLOAD_HTTP_401','CLOUD_UPLOAD_HTTP_403','CLOUD_UPLOAD_HTTP_413','CLOUD_VERIFY_HTTP_404','CLOUD_HASH_MISMATCH','CLOUD_OBJECT_NOT_FOUND','CLOUD_TUS_LOCATION_INVALID'])assert.equal(isTransientCloudError(Error(message)),false,message);
 assert.equal(isTransientCloudError(networkError('ECONNRESET')),true);
});

test('failure classification keeps source answers explicit and marks permanent ones non-retryable',()=>{
 assert.deepEqual(classifyFailure(Error('SOURCE_HTTP_404')),{error:'SOURCE_HTTP_404',retryable:false});
 assert.deepEqual(classifyFailure(Error('NOT_A_PDF')),{error:'NOT_A_PDF',retryable:false});
 assert.deepEqual(classifyFailure(Error('SOURCE_SHA1_MISMATCH')),{error:'SOURCE_SHA1_MISMATCH',retryable:false});
 assert.deepEqual(classifyFailure(Error('CLOUD_HASH_MISMATCH')),{error:'CLOUD_HASH_MISMATCH',retryable:false});
 assert.deepEqual(classifyFailure(Error('SOURCE_HTTP_503')),{error:'SOURCE_HTTP_503',retryable:true});
 assert.deepEqual(classifyFailure(Error('CLOUD_UPLOAD_HTTP_520')),{error:'CLOUD_UPLOAD_HTTP_520',retryable:true});
 assert.deepEqual(classifyFailure(networkError('ECONNRESET')),{error:'NETWORK_ERROR',retryable:true});
 assert.deepEqual(classifyFailure(new DOMException('x','TimeoutError')),{error:'NETWORK_TIMEOUT',retryable:true});
 assert.deepEqual(classifyFailure(new RangeError('some internal message that must not leak')),{error:'TRANSFER_OR_INTEGRITY_FAILURE',retryable:true});
});

test('Retry-After accepts seconds and HTTP dates and never waits less than one second',()=>{
 assert.equal(retryAfterMs('30',5000),30000);
 assert.equal(retryAfterMs('0',5000),1000);
 assert.equal(retryAfterMs(null,5000),5000);
 assert.equal(retryAfterMs('garbage',5000),5000);
 assert.equal(retryAfterMs(new Date(1_000_000+90_000).toUTCString(),5000,1_000_000),90000);
});

test('bounded exponential backoff doubles to a cap, jitters within 25 percent and honors retryAfterMs',async()=>{
 assert.deepEqual([0,1,2,3,4,5,6].map(attempt=>backoffDelay(attempt,{baseMs:1000,maxMs:10000,random:middle})),[1000,2000,4000,8000,10000,10000,10000]);
 assert.equal(backoffDelay(2,{baseMs:1000,maxMs:60000,random:()=>0}),3000);
 assert.equal(backoffDelay(2,{baseMs:1000,maxMs:60000,random:()=>1}),5000);
 const pause=noPause();let calls=0;
 const value=await withBackoff(async()=>{if(++calls<4)throw Object.assign(Error('CLOUD_UPLOAD_HTTP_520'),calls===2?{retryAfterMs:9000}:{});return 'ok';},{attempts:5,baseMs:1000,maxMs:60000,pause,random:middle,isRetryable:isTransientCloudError});
 assert.equal(value,'ok');assert.equal(calls,4);assert.deepEqual(pause.delays,[1000,9000,4000]);
});

test('retries are bounded and permanent errors are thrown at once',async()=>{
 const pause=noPause();let calls=0;
 await assert.rejects(withBackoff(async()=>{calls++;throw Error('CLOUD_UPLOAD_HTTP_520');},{attempts:4,pause,random:middle,isRetryable:isTransientCloudError}),/CLOUD_UPLOAD_HTTP_520/);
 assert.equal(calls,4);assert.equal(pause.delays.length,3);
 calls=0;await assert.rejects(withBackoff(async()=>{calls++;throw Error('CLOUD_UPLOAD_HTTP_403');},{attempts:4,pause:noPause(),isRetryable:isTransientCloudError}),/CLOUD_UPLOAD_HTTP_403/);
 assert.equal(calls,1);
});

test('failure breaker pauses after consecutive failures, doubles its cool-down and only stops after a sustained outage',async()=>{
 let clock=0;const trips=[];const waits=[];
 const breaker=new FailureBreaker({stopCode:'CLOUD_STORAGE_UNAVAILABLE',threshold:3,baseCooldownMs:1000,maxCooldownMs:4000,maxTrips:4,now:()=>clock,pause:async ms=>{waits.push(ms);clock+=ms;},onTrip:t=>trips.push(t.cooldown_ms)});
 assert.equal(breaker.failure(),false);assert.equal(breaker.failure(),false);breaker.success();
 assert.equal(breaker.failure(),false);assert.equal(breaker.failure(),false);assert.equal(breaker.failure(),true);
 await breaker.gate();assert.deepEqual(waits,[1000]);assert.equal(clock,1000);
 for(let i=0;i<3;i++)breaker.failure();await breaker.gate();
 for(let i=0;i<3;i++)breaker.failure();await breaker.gate();
 assert.deepEqual(trips,[1000,2000,4000]);
 breaker.success();assert.equal(breaker.exhausted,false);assert.equal(breaker.trips,0);
 for(let round=0;round<4;round++)for(let i=0;i<3;i++)breaker.failure();
 assert.equal(breaker.exhausted,true);
 await assert.rejects(breaker.gate(),e=>e.message==='CLOUD_STORAGE_UNAVAILABLE'&&e.breakerExhausted===true);
});

// ---- per-file source download ---------------------------------------------------------------
const row={provider:'courtlistener-public-locator',download_url:'https://storage.courtlistener.com/recap/gov.uscourts.test.1.2.0.pdf',expected_bytes:null,expected_sha1:null};
const respond=(status,body,headers={})=>new Response([204,205,304].includes(status)?null:body,{status,headers});
function scripted(...steps){const calls=[];const fetchImpl=async url=>{calls.push(String(url));const step=steps[Math.min(calls.length-1,steps.length-1)];return typeof step==='function'?step():step;};fetchImpl.calls=calls;return fetchImpl;}

test('a 503 and a connection reset retry with backoff and then store the verified bytes',async()=>{
 const dir=await tmp(),temp=path.join(dir,'a.part'),bytes=pdf('retry source');
 const pause=noPause(),breaker=new FailureBreaker({stopCode:'SOURCE_UNAVAILABLE',threshold:8});
 const fetchImpl=scripted(()=>respond(503,'busy'),()=>{throw networkError('ECONNRESET');},()=>respond(200,bytes));
 const digest=await fetchSourcePdf({row,temp,maxBytes:1024,fetchImpl,pause,random:middle,breaker,backoff:{baseMs:1000,maxMs:30000}});
 assert.equal(fetchImpl.calls.length,3);assert.deepEqual(pause.delays,[1000,2000]);
 assert.equal(digest.sha256,digestOf(bytes).sha256);assert.deepEqual(await fs.readFile(temp),bytes);assert.equal(breaker.consecutive,0);
});

test('a body cut mid-stream discards the partial file and succeeds on the next attempt',async()=>{
 const dir=await tmp(),temp=path.join(dir,'b.part'),bytes=pdf('cut stream');
 const cut=()=>new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,6));controller.error(Object.assign(new TypeError('terminated'),{cause:Object.assign(new Error('other side closed'),{code:'UND_ERR_SOCKET'})}));}}),{status:200});
 const fetchImpl=scripted(cut,()=>respond(200,bytes));
 const digest=await fetchSourcePdf({row,temp,maxBytes:1024,fetchImpl,pause:noPause(),random:middle});
 assert.equal(fetchImpl.calls.length,2);assert.equal(digest.bytes,bytes.length);assert.deepEqual(await fs.readFile(temp),bytes);
});

test('permanent source answers are recorded once without retries',async()=>{
 const dir=await tmp();
 for(const [status,code] of [[404,'SOURCE_HTTP_404'],[410,'SOURCE_HTTP_410']]){
  const fetchImpl=scripted(()=>respond(status,'gone'));
  await assert.rejects(fetchSourcePdf({row,temp:path.join(dir,'c.part'),maxBytes:1024,fetchImpl,pause:noPause()}),e=>e.message===code);assert.equal(fetchImpl.calls.length,1);
 }
 const notPdf=scripted(()=>respond(200,'<html>not a pdf</html>'));
 await assert.rejects(fetchSourcePdf({row,temp:path.join(dir,'d.part'),maxBytes:1024,fetchImpl:notPdf,pause:noPause()}),/NOT_A_PDF/);assert.equal(notPdf.calls.length,1);
 const denied=[];const forbidden=scripted(()=>respond(403,'no'));
 await assert.rejects(fetchSourcePdf({row,temp:path.join(dir,'e.part'),maxBytes:1024,fetchImpl:forbidden,pause:noPause(),onAccessDenied:status=>denied.push(status)}),/SOURCE_HTTP_403/);
 assert.equal(forbidden.calls.length,1);assert.deepEqual(denied,[403]);
});

test('a persistently failing source stops after the attempt bound and feeds the breaker',async()=>{
 const dir=await tmp(),breaker=new FailureBreaker({stopCode:'SOURCE_UNAVAILABLE',threshold:100}),penalties=[];
 const fetchImpl=scripted(()=>respond(503,'busy'));
 await assert.rejects(fetchSourcePdf({row,temp:path.join(dir,'f.part'),maxBytes:1024,fetchImpl,pause:noPause(),random:middle,breaker,attempts:4,onPenalty:()=>penalties.push(1)}),/SOURCE_HTTP_503/);
 assert.equal(fetchImpl.calls.length,4);assert.equal(breaker.consecutive,4);assert.equal(penalties.length,4);
 const reset=scripted(()=>{throw networkError('ETIMEDOUT');});
 await assert.rejects(fetchSourcePdf({row,temp:path.join(dir,'g.part'),maxBytes:1024,fetchImpl:reset,pause:noPause(),random:middle,attempts:3}),/SOURCE_NETWORK_ERROR/);assert.equal(reset.calls.length,3);
});

test('HTTP 429 goes to the rate-limit handler and the final 429 is surfaced, never retried around',async()=>{
 const dir=await tmp(),seen=[];
 const fetchImpl=scripted(()=>respond(429,'slow down',{'retry-after':'12'}),()=>respond(200,pdf('after limit')));
 const digest=await fetchSourcePdf({row,temp:path.join(dir,'h.part'),maxBytes:1024,fetchImpl,pause:noPause(),onRateLimit:async(response,attempt,final)=>{seen.push([response.headers.get('retry-after'),attempt,final]);await response.body?.cancel();}});
 assert.equal(digest.bytes,pdf('after limit').length);assert.deepEqual(seen,[['12',0,false]]);
 const always=scripted(()=>respond(429,'no',{'retry-after':'1'}));
 await assert.rejects(fetchSourcePdf({row,temp:path.join(dir,'i.part'),maxBytes:1024,fetchImpl:always,pause:noPause(),attempts:3,onRateLimit:async(response)=>{await response.body?.cancel();}}),/SOURCE_HTTP_429/);
 assert.equal(always.calls.length,3);
});

test('hosts and redirects stay inside the provider allow-list on every retry',async()=>{
 const dir=await tmp();
 const toEvil=scripted(()=>respond(302,'',{location:'https://evil.example/recap/x.pdf'}));
 await assert.rejects(fetchSourcePdf({row,temp:path.join(dir,'j.part'),maxBytes:1024,fetchImpl:toEvil,pause:noPause()}),/PDF_HOST_NOT_ALLOWED/);assert.equal(toEvil.calls.length,1);
});

// ---- cloud store: Supabase Storage fake -----------------------------------------------------
const STORAGE='https://xosqzzsnhxcyehcnirpa.supabase.co/storage/v1',TUS='https://xosqzzsnhxcyehcnirpa.storage.supabase.co/storage/v1/upload/resumable';
function fakeSupabase({objects=new Map(),postStatuses=[],tusInitStatuses=[],verifyStatuses=[],storeOnPost=false,bytesForStore=null}={}){
 const log=[],uploads=new Map();
 const fetchImpl=async(url,init={})=>{
  const target=String(url),method=init.method??'GET';log.push(method+' '+target.replace(/^https:\/\/[^/]+/,''));
  const object=/\/object\/(?:authenticated\/)?corpus-originals\/(.+)$/.exec(target);
  if(object&&method==='POST'){
   const status=postStatuses.length?postStatuses.shift():200;
   if(status instanceof Error)throw status;
   if(status===200||storeOnPost&&status>=500){if(objects.has(object[1]))return respond(400,JSON.stringify({code:'KeyAlreadyExists'}));objects.set(object[1],bytesForStore);}
   return status===200?respond(200,JSON.stringify({Key:object[1]})):respond(status,'<html>edge error</html>');
  }
  if(object&&method==='GET'){
   const status=verifyStatuses.length?verifyStatuses.shift():200;
   if(status!==200)return respond(status,'edge error');
   return objects.has(object[1])?respond(200,objects.get(object[1])):respond(404,JSON.stringify({error:'not_found'}));
  }
  if(target===TUS&&method==='POST'){
   const status=tusInitStatuses.length?tusInitStatuses.shift():201;
   if(status!==201)return respond(status,'edge error');
   const id='upload-'+uploads.size;uploads.set(id,{offset:0,length:Number(init.headers['Upload-Length']),key:/objectName (\S+)/.exec(init.headers['Upload-Metadata'])&&Buffer.from(/objectName ([^,]+)/.exec(init.headers['Upload-Metadata'])[1],'base64').toString()});
   return respond(201,'',{location:TUS+'/'+id});
  }
  const tus=target.startsWith(TUS+'/')?uploads.get(target.slice(TUS.length+1)):null;
  if(tus&&method==='HEAD')return respond(200,'',{'upload-offset':String(tus.offset),'upload-length':String(tus.length)});
  if(tus&&method==='PATCH'){tus.offset+=init.body.length;if(tus.offset===tus.length)objects.set(tus.key,bytesForStore);return respond(204,'',{'upload-offset':String(tus.offset)});}
  throw Error('unexpected fake request '+method+' '+target);
 };
 return{fetchImpl,objects,log,uploads};
}
async function cloudFixture(options={}){
 const dir=await tmp(),bytes=pdf(options.label??'cloud fixture'),file=path.join(dir,'x.pdf');await fs.writeFile(file,bytes);
 const digest=digestOf(bytes),key='seeger-weiss/pdf-sha256/'+digest.sha256.slice(0,2)+'/'+digest.sha256+'.pdf';
 const fake=fakeSupabase({...options.fake,bytesForStore:bytes});const events=[];
 const breaker=new FailureBreaker({stopCode:'CLOUD_STORAGE_UNAVAILABLE',threshold:options.threshold??100});const pause=noPause();
 const store=createCloudStore({storage:STORAGE,tusEndpoint:TUS,headers:{apikey:'test'},fetchImpl:fake.fetchImpl,pause,random:middle,record:async e=>{events.push(e);},maxBytes:10*1024**2,breaker,attempts:options.attempts??5,backoff:{baseMs:1000,maxMs:60000}});
 return{store,fake,file,digest,key,bytes,events,breaker,pause};
}

test('Oct 2 failure: a Cloudflare 520 on upload no longer aborts; the missing immutable object is recovered through resumable upload and read back',async()=>{
 const f=await cloudFixture({fake:{postStatuses:[520]}});
 const result=await f.store.ensureObject(f.key,f.file,f.digest,{provider:'x'});
 assert.equal(result.method,'tus_6mib_chunks');assert.equal(f.fake.objects.get(f.key).equals(f.bytes),true);
 assert.deepEqual(f.events.map(e=>e.state),['upload_pending','upload_response','resumable_upload_created']);
 assert.equal(f.events[1].upload_http_status,520);assert.equal(f.breaker.consecutive,0);
});

test('a resumable chunk whose acknowledgement is lost is resolved by an exact offset audit, not by re-sending',async()=>{
 const f=await cloudFixture({fake:{postStatuses:[520]}});
 const original=f.fake.fetchImpl;let dropped=false;
 const store=createCloudStore({storage:STORAGE,tusEndpoint:TUS,headers:{apikey:'test'},pause:noPause(),random:middle,record:async e=>{f.events.push(e);},maxBytes:10*1024**2,
  fetchImpl:async(url,init={})=>{const response=await original(url,init);if(init.method==='PATCH'&&!dropped){dropped=true;throw networkError('ECONNRESET');}return response;}});
 const result=await store.ensureObject(f.key,f.file,f.digest,{provider:'x'});
 assert.equal(result.method,'tus_6mib_chunks');assert.equal(f.fake.objects.get(f.key).equals(f.bytes),true);
 assert.equal(f.events.filter(e=>e.state==='resumable_chunk_offset_audited').length,1);assert.equal(f.fake.log.filter(l=>l.startsWith('PATCH ')).length,1);
});

test('a 520 whose upload actually landed is accepted only after the hash-checked readback',async()=>{
 const f=await cloudFixture({fake:{postStatuses:[520],storeOnPost:true}});
 const result=await f.store.ensureObject(f.key,f.file,f.digest,{provider:'x'});
 assert.equal(result.upload_http_status,520);assert.ok(f.fake.log.some(line=>line.startsWith('GET ')));assert.equal(f.fake.log.filter(l=>l.startsWith('POST /storage/v1/object')).length,1);
});

test('transient edge errors at every stage retry with bounded backoff, then succeed',async()=>{
 const f=await cloudFixture({fake:{postStatuses:[520,520],tusInitStatuses:[521]}});
 const result=await f.store.ensureObject(f.key,f.file,f.digest,{provider:'x'});
 assert.equal(f.fake.objects.get(f.key).equals(f.bytes),true);assert.ok(result.verified_at);
 const retries=f.events.filter(e=>e.state==='cloud_retry');assert.equal(retries.length,1);assert.equal(retries[0].error_code,'CLOUD_TUS_INIT_HTTP_521');assert.equal(retries[0].attempt,1);
 assert.deepEqual(f.pause.delays.filter(ms=>ms>=1000),[1000]);
});

test('an outage that outlasts the retry bound fails only that file and informs the breaker',async()=>{
 const f=await cloudFixture({attempts:3,fake:{postStatuses:[520,520,520],tusInitStatuses:[520,520,520]}});
 await assert.rejects(f.store.ensureObject(f.key,f.file,f.digest,{provider:'x'}),/CLOUD_TUS_INIT_HTTP_520/);
 assert.equal(f.events.filter(e=>e.state==='cloud_retry').length,2);assert.equal(f.breaker.consecutive,3);assert.equal(f.fake.objects.size,0);
});

test('an already stored identical object is verified by readback, not rewritten',async()=>{
 const f=await cloudFixture();f.fake.objects.set(f.key,f.bytes);
 const result=await f.store.ensureObject(f.key,f.file,f.digest,{provider:'x'});
 assert.equal(result.upload_http_status,400);assert.equal(f.events.find(e=>e.state==='upload_response').upload_error_code,'KeyAlreadyExists');
});

test('integrity and credential problems are never retried: hash mismatch and 403 surface immediately',async()=>{
 const mismatch=await cloudFixture();mismatch.fake.objects.set(mismatch.key,pdf('different bytes of the same length..'));
 await assert.rejects(mismatch.store.ensureObject(mismatch.key,mismatch.file,mismatch.digest,{provider:'x'}),e=>/^(?:CLOUD_HASH_MISMATCH|SOURCE_SIZE_MISMATCH|SOURCE_SHA1_MISMATCH)$/.test(e.message));
 assert.equal(mismatch.events.filter(e=>e.state==='cloud_retry').length,0);
 const denied=await cloudFixture({fake:{postStatuses:[403]}});
 await assert.rejects(denied.store.ensureObject(denied.key,denied.file,denied.digest,{provider:'x'}),/CLOUD_UPLOAD_HTTP_403/);
 assert.equal(denied.events.filter(e=>e.state==='cloud_retry').length,0);assert.equal(denied.fake.objects.size,0);
});

test('a sustained cloud outage trips the breaker, which pauses and finally stops instead of recording every file as failed',async()=>{
 const f=await cloudFixture({attempts:2,threshold:2,fake:{postStatuses:Array(50).fill(520),tusInitStatuses:Array(50).fill(520)}});
 let clock=0;f.breaker.now=()=>clock;f.breaker.pause=async ms=>{clock+=ms;};f.breaker.maxTrips=2;f.breaker.baseCooldownMs=1000;
 const outcomes=[];
 for(let i=0;i<4;i++)outcomes.push(await f.store.ensureObject(f.key,f.file,f.digest,{provider:'x'}).then(()=>'ok',e=>e.breakerExhausted?'stop':e.message));
 assert.ok(outcomes.includes('stop'),outcomes.join(','));assert.ok(f.breaker.totalTrips>=2);
});

// ---- source pacing -------------------------------------------------------------------------
function clock(){let t=1_000_000;const waits=[];return{now:()=>t,pause:async ms=>{waits.push(ms);t+=ms;},waits,get t(){return t;}};}

test('pacer spaces requests globally and per worker, and a 429 raises a sticky level that survives until sustained calm',async()=>{
 const c=clock(),levels=[];
 const pacer=createPacer({sourceDelayMs:500,workerDelayMs:1000,now:c.now,pause:c.pause,recoverAfter:3,onLevelChange:l=>levels.push(l)});
 const a={nextAt:0},b={nextAt:0},starts=[];
 for(const worker of [a,b,a,b]){await pacer.slot(worker);starts.push(c.t);}
 assert.deepEqual(starts.map(t=>t-1_000_000),[0,500,1000,1500],'global spacing of 500 ms across workers, each worker at most once per second');
 pacer.block(60000);pacer.rateLimited();
 assert.equal(pacer.level,1);assert.equal(pacer.spacing(),1000);
 const before=c.t;await pacer.slot(a);assert.ok(c.t-before>=60000,'every worker waits out the refusal');
 pacer.success();pacer.success();assert.equal(pacer.level,1);pacer.success();assert.equal(pacer.level,0);assert.deepEqual(levels,[1,0]);assert.equal(pacer.spacing(),500);
});

test('a persisted level is honored at start, is capped, and 5xx penalties relax in steps without touching the rate level',()=>{
 const c=clock();
 const resumed=createPacer({sourceDelayMs:500,level:2,now:c.now,pause:c.pause});assert.equal(resumed.spacing(),1500);
 assert.equal(createPacer({sourceDelayMs:500,level:99,now:c.now,pause:c.pause}).level,6);
 const pacer=createPacer({sourceDelayMs:100,now:c.now,pause:c.pause});
 pacer.penalize();assert.equal(pacer.penaltyMs,500);pacer.penalize();assert.equal(pacer.penaltyMs,1000);assert.equal(pacer.level,0);
 for(let i=0;i<25;i++)pacer.success();assert.equal(pacer.penaltyMs,500);
 for(let i=0;i<25;i++)pacer.success();assert.equal(pacer.penaltyMs,250);
 for(let i=0;i<25;i++)pacer.success();assert.equal(pacer.penaltyMs,0);
});

test('a refusal is described with a bounded, allow-listed slice of the response only',async()=>{
 const response=new Response('<html>'+'x'.repeat(1000)+'</html>',{status:429,statusText:'Too Many Requests',headers:{server:'AmazonS3','x-cache':'Error from cloudfront','set-cookie':'secret=1','x-amz-cf-pop':'ORD58-C1','authorization':'Bearer nope'}});
 const info=await describeRefusal(response);
 assert.equal(info.status,429);assert.equal(info.body_snippet.length,300);
 assert.deepEqual(Object.keys(info.headers).sort(),['content-type','server','x-amz-cf-pop','x-cache']);
 assert.equal(JSON.stringify(info).includes('secret'),false);
 // The worker cancels the body after describing it; a consumed body must not make that throw.
 await assert.doesNotReject(async()=>{await response.body?.cancel().catch(()=>{});});
});
