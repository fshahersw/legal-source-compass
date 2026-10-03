import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {digestStream} from './backfill-pdfs-to-supabase.mjs';
import {validateLocalPdfOccurrence,verifyLocalCloudReadback,pdfStorageKey} from './upload-local-bundle-pdfs-to-supabase.mjs';

// This harness executes the real main body with an entirely in-memory filesystem
// and fetch substitute. It never reads credentials or source files, makes network
// requests, starts workers, deletes files, or writes transfer receipts to disk.
const source=await fs.readFile(new URL('./upload-local-bundle-pdfs-to-supabase.mjs',import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const mainBody=source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'').replace(/^if\(process\.argv\[1\].*$/m,'');
assert.match(mainBody,/async function main\(/);
const compile=new AsyncFunction('fs','createReadStream','path','createHash','Readable','pathToFileURL','digestStream','retryTransferFileOperation','process','fetch','AbortSignal','console',mainBody+'\nreturn main;');
const root='C:/Users/firas/Downloads/MATTER-ETL-BATCH-PIPELINE/bundles';
const privateOut='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/local-pdf-reuse-v1/test-only';
const sha=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const key=p=>path.win32.resolve(p).replaceAll('\\','/').toLowerCase();
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function occurrence(index=0){
 const localPath=root+'/offline-fixture/document-'+index+'.pdf';
 const bytes=Buffer.from('%PDF-1.7\nOffline fault-injection fixture '+index+'\n%%EOF\n');
 const manifest=Buffer.from('{"offline_fixture":true}\n'),csv=Buffer.from('offline_fixture\ntrue\n');
 return {bytes,manifest,csv,row:{schema_version:'local-bundle-observed-pdf-occurrence/1',provider:'local-matter-bundle',native_backend_document_id:null,native_backend_identity_asserted:false,private_only:true,publisher_sealing_asserted:false,cloud_body_hash_verified:false,pdf_magic_verified:true,source_occurrence_sha256:sha('offline-occurrence-'+index),actual_sha256:sha(bytes),actual_sha1:sha(bytes,'sha1'),actual_bytes:bytes.length,local_path:localPath,source_evidence:{courtlistener_docket_id:'1',bundle_manifest_file:root+'/offline-fixture/manifest.json',bundle_manifest_sha256:sha(manifest),docket_csv_file:root+'/offline-fixture/docket.csv',docket_csv_sha256:sha(csv),csv_ordinal:index+1,explicit_file_name:'document-'+index+'.pdf',source_is_sealed_literal:'',literal_recap_pdf_url:'https://storage.courtlistener.com/recap/offline-fixture.'+index+'.pdf'}}};
}
async function harness({count=1,execute=true,onFetch=null,onWrite=null,sourceEscape=null,mutate=null,planHash=null,sourceKind=null,planPathOverride=null}={}){
 const fixtures=Array.from({length:count},(_,i)=>occurrence(i)),rows=fixtures.map(x=>x.row);
 const plan=Buffer.from(rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
 const planPath=planPathOverride??'C:/offline-test/local-plan.jsonl',credentialsPath='C:/offline-test/fake-credentials.json';
 const files=new Map([[key(planPath),plan],[key(credentialsPath),Buffer.from(JSON.stringify({EXTERNAL_SUPABASE_URL:'https://xosqzzsnhxcyehcnirpa.supabase.co',EXTERNAL_SUPABASE_KEY:'sb_secret_offline_fixture_only'}))]]);
 for(const f of fixtures){files.set(key(f.row.local_path),f.bytes);files.set(key(f.row.source_evidence.bundle_manifest_file),f.manifest);files.set(key(f.row.source_evidence.docket_csv_file),f.csv);}
 mutate?.({files,fixtures,rows});
 const writes=[],requests=[],readPaths=[];
 const missing=()=>Object.assign(Error('offline missing file'),{code:'ENOENT'});
 const mockFs={
  async readFile(p,encoding){readPaths.push(key(p));const value=files.get(key(p));if(value===undefined)throw missing();return encoding?value.toString(encoding):Buffer.from(value);},
  async realpath(p){return sourceEscape?.(p)??p;},
  async mkdir(){},
  async open(p){return {async write(raw){writes.push(Buffer.from(raw));const custom=await onWrite?.(raw);return custom??{bytesWritten:raw.length};},async sync(){},async close(){}};},
  async writeFile(p,raw,options){if(options?.flag==='wx'&&files.has(key(p)))throw Object.assign(Error('offline exists'),{code:'EEXIST'});files.set(key(p),Buffer.from(raw));},
 };
 const fetch=async(url,options={})=>{
  assert.match(url,/^https:\/\/xosqzzsnhxcyehcnirpa\.storage\.supabase\.co\/storage\/v1\//);
  requests.push({url,method:options.method??'GET'});
  if(url.endsWith('/bucket/corpus-originals'))return new Response(JSON.stringify({id:'corpus-originals',public:false}),{status:200});
  if(onFetch){const result=await onFetch(url,options,{fixtures,rows});if(result!==undefined)return result;}
  if(options.method==='POST')return new Response('',{status:200});
  const f=fixtures.find(x=>url.endsWith('/'+pdfStorageKey(x.row.actual_sha256)));assert.ok(f,'readback must address the exact pinned object');return new Response(f.bytes,{status:200});
 };
 const argv=['offline-node','offline-uploader','--plan='+planPath,'--plan-sha256='+(planHash??sha(plan)),'--out='+privateOut,'--credentials='+credentialsPath,...(execute?['--execute']:[]),...(sourceKind===null?[]:['--source-kind='+sourceKind])];
 const main=await compile(mockFs,p=>Readable.from([files.get(key(p))]),path.win32,createHash,Readable,pathToFileURL,digestStream,async(_operation,action)=>action(),{argv},fetch,AbortSignal,{log(){}});
 return {main,fixtures,files,writes,requests,readPaths,receipts:()=>writes.flatMap(raw=>{try{return [JSON.parse(raw.toString())];}catch{return [];}}),completion:()=>files.get(key(privateOut+'/completion.json'))};
}

test('local occurrence rejects mismatched parent, escaped path, inferred identity and credential locator',()=>{
 const original=occurrence().row;
 assert.equal(validateLocalPdfOccurrence(structuredClone(original)).private_only,true);
 for(const change of [r=>{r.local_path='C:/outside/document-0.pdf';},r=>{r.source_evidence.docket_csv_file=root+'/other/docket.csv';},r=>{r.native_backend_identity_asserted=true;},r=>{r.source_evidence.literal_recap_pdf_url+='?token=offline';},r=>{r.source_evidence.source_is_sealed_literal='false';}]){
  const row=structuredClone(original);change(row);assert.throws(()=>validateLocalPdfOccurrence(row));
 }
});

test('plan hash mismatch stops before any metadata, credentials or network access',async()=>{
 const h=await harness({planHash:'0'.repeat(64)});await assert.rejects(h.main(),/PINNED_LOCAL_PLAN_REQUIRED/);assert.equal(h.readPaths.length,1);assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
});

test('realpath escape is blocked before any upload',async()=>{
 const h=await harness({sourceEscape:p=>p.endsWith('/document-0.pdf')?'C:/outside/document-0.pdf':p});await assert.rejects(h.main(),/LOCAL_PDF_RESOLVES_OUTSIDE_BUNDLES/);assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
});

test('changed manifest and changed PDF bytes are rejected before credentials or network access',async t=>{
 for(const target of ['manifest','pdf'])await t.test(target,async()=>{
  const h=await harness({mutate:({files,fixtures})=>{files.set(key(target==='manifest'?fixtures[0].row.source_evidence.bundle_manifest_file:fixtures[0].row.local_path),Buffer.from(target==='manifest'?'changed':'%PDF-1.7\nchanged\n'));}});
  await assert.rejects(h.main(),target==='manifest'?/PINNED_LOCAL_METADATA_CHANGED/:/SOURCE_SIZE_MISMATCH|SOURCE_SHA1_MISMATCH|PINNED_LOCAL_PDF_CHANGED/);assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.equal(h.readPaths.some(p=>p.endsWith('fake-credentials.json')),false);
 });
});

test('cloud readback requires PDF magic, exact length, SHA1 and SHA256',async t=>{
 const f=occurrence();await verifyLocalCloudReadback(new Response(f.bytes),f.row);
 for(const [name,bytes,expected,pattern] of [
  ['magic',Buffer.alloc(f.bytes.length,65),f.row,/NOT_A_PDF/],
  ['bytes',f.bytes,{...f.row,actual_bytes:f.bytes.length+1},/SOURCE_SIZE_MISMATCH/],
  ['sha1',f.bytes,{...f.row,actual_sha1:'0'.repeat(40)},/SOURCE_SHA1_MISMATCH/],
  ['sha256',f.bytes,{...f.row,actual_sha256:'0'.repeat(64)},/LOCAL_CLOUD_HASH_MISMATCH/],
 ])await t.test(name,()=>assert.rejects(verifyLocalCloudReadback(new Response(bytes),expected),pattern));
});

test('an unknown POST outcome becomes verified only after a full exact readback',async()=>{
 const h=await harness({onFetch:async(_url,options)=>{if(options.method==='POST')throw Error('offline unknown POST outcome');}});await h.main();
 const receipt=h.receipts().find(x=>x.state==='local_cloud_verified');assert.ok(receipt);assert.equal(receipt.upload_http_status,null);assert.equal(receipt.private_only,true);assert.equal(receipt.backend_api_document_identity_asserted,false);assert.deepEqual(receipt.source_occurrence_sha256s,[h.fixtures[0].row.source_occurrence_sha256]);assert.ok(h.completion());assert.equal(h.requests.filter(x=>x.url.includes('/object/authenticated/')).length,1);
});

test('existing immutable object conflict still requires readback',async()=>{
 const h=await harness({onFetch:async(_url,options)=>options.method==='POST'?new Response('',{status:409}):undefined});await h.main();assert.equal(h.receipts().find(x=>x.state==='local_cloud_verified').upload_http_status,409);assert.equal(h.requests.filter(x=>x.url.includes('/object/authenticated/')).length,1);
});

test('an unknown POST with a wrong cloud body never records verified success',async()=>{
 const h=await harness({onFetch:async(url,options)=>{if(options.method==='POST')throw Error('offline unknown outcome');if(url.includes('/object/authenticated/'))return new Response('%PDF-1.7\nwrong\n');}});await assert.rejects(h.main(),/SOURCE_SIZE_MISMATCH|SOURCE_SHA1_MISMATCH/);assert.equal(h.receipts().some(x=>x.state==='local_cloud_verified'),false);assert.equal(h.completion(),undefined);
});

test('POST authentication and rate limits stop without retry or readback',async t=>{
 for(const status of [401,403,429])await t.test(String(status),async()=>{
  const h=await harness({onFetch:async(_url,options)=>options.method==='POST'?new Response('',{status}):undefined});await assert.rejects(h.main(),new RegExp('LOCAL_CLOUD_UPLOAD_HTTP_'+status));assert.equal(h.requests.filter(x=>x.method==='POST').length,1);assert.equal(h.requests.some(x=>x.url.includes('/object/authenticated/')),false);assert.equal(h.receipts().some(x=>x.state==='local_cloud_verified'),false);
 });
});

test('readback authentication and rate limits stop without retry or verified receipt',async t=>{
 for(const status of [401,403,429])await t.test(String(status),async()=>{
  const h=await harness({onFetch:async url=>url.includes('/object/authenticated/')?new Response('',{status}):undefined});await assert.rejects(h.main(),new RegExp('LOCAL_CLOUD_VERIFY_HTTP_'+status));assert.equal(h.requests.filter(x=>x.url.includes('/object/authenticated/')).length,1);assert.equal(h.receipts().some(x=>x.state==='local_cloud_verified'),false);
 });
});

test('a failed sibling waits for already-started uploads and durable receipts before reporting stopped',async()=>{
 const release=deferred(),siblingsStarted=deferred();let siblingPosts=0;
 const h=await harness({count:4,onFetch:async(url,options,{fixtures})=>{
  if(options.method!=='POST')return undefined;
  if(url.endsWith('/'+pdfStorageKey(fixtures[0].row.actual_sha256))){await siblingsStarted.promise;return new Response('',{status:403});}
  if(++siblingPosts===2)siblingsStarted.resolve();await release.promise;return new Response('',{status:200});
 }});
 let settled=false;const running=h.main();const observed=running.then(()=>{settled=true;},()=>{settled=true;});
 try{await siblingsStarted.promise;await tick();await tick();assert.equal(settled,false,'stopped status must wait for the two in-flight siblings');}
 finally{release.resolve();}
 await assert.rejects(running,/LOCAL_CLOUD_UPLOAD_HTTP_403/);await observed;
 const receipts=h.receipts();assert.equal(receipts.filter(x=>x.state==='local_cloud_verified').length,2);assert.equal(receipts.filter(x=>x.state==='local_transfer_failed').length,1);assert.equal(h.requests.filter(x=>x.method==='POST').length,3,'no fourth upload may start after authentication failure');assert.equal(h.completion(),undefined);
});

test('a short receipt append stops before POST and is never replayed blindly',async()=>{
 const h=await harness({onWrite:async raw=>({bytesWritten:raw.length-1})});await assert.rejects(h.main(),/RECEIPT_SHORT_APPEND/);assert.equal(h.writes.length,1);assert.equal(h.requests.filter(x=>x.method==='POST').length,0);assert.equal(h.completion(),undefined);
});

test('only proven missing readback permits one immutable retry after an unknown or transient POST',async t=>{
 for(const initialStatus of [null,408,500,502,503,504])await t.test(String(initialStatus),async()=>{
  let posts=0,gets=0;const bodies=[];
  const h=await harness({onFetch:async(url,options)=>{
   if(options.method==='POST'){posts++;bodies.push({bytes:Buffer.from(options.body),upsert:options.headers['x-upsert'],url});if(posts===1){if(initialStatus===null)throw Error('offline unknown upload');return new Response('',{status:initialStatus});}return new Response('',{status:201});}
   if(url.includes('/object/authenticated/')&&++gets===1)return initialStatus===null?new Response('',{status:404}):new Response(JSON.stringify({code:'NoSuchKey'}),{status:400});
  }});
  await h.main();assert.equal(posts,2);assert.equal(gets,2);assert.equal(bodies[0].url,bodies[1].url);assert.deepEqual(bodies[0].bytes,bodies[1].bytes);assert.deepEqual(bodies.map(x=>x.upsert),['false','false']);
  assert.equal(h.receipts().filter(x=>x.state==='local_missing_object_recovery').length,1);assert.deepEqual(h.receipts().filter(x=>x.state==='local_upload_response').map(x=>x.upload_http_status),[initialStatus,201]);assert.equal(h.receipts().filter(x=>x.state==='local_cloud_verified').length,1);
 });
});

test('known conflicts or successful POST responses never permit a missing-object replay',async t=>{
 for(const status of [200,201,400,409])await t.test(String(status),async()=>{
  const h=await harness({onFetch:async(url,options)=>options.method==='POST'?new Response('',{status}):url.includes('/object/authenticated/')?new Response('',{status:404}):undefined});
  await assert.rejects(h.main(),/LOCAL_CLOUD_OBJECT_NOT_FOUND/);assert.equal(h.requests.filter(x=>x.method==='POST').length,1);assert.equal(h.receipts().some(x=>x.state==='local_missing_object_recovery'),false);assert.equal(h.receipts().some(x=>x.state==='local_cloud_verified'),false);
 });
});

test('generic HTTP400 is not missing-object evidence and never permits retry',async()=>{
 const h=await harness({onFetch:async(url,options)=>{if(options.method==='POST')throw Error('offline unknown upload');if(url.includes('/object/authenticated/'))return new Response(JSON.stringify({code:'InvalidRequest'}),{status:400});}});
 await assert.rejects(h.main(),/LOCAL_CLOUD_VERIFY_HTTP_400/);assert.equal(h.requests.filter(x=>x.method==='POST').length,1);assert.equal(h.receipts().some(x=>x.state==='local_missing_object_recovery'),false);
});

test('a second missing-object response stops after exactly one recovery',async()=>{
 let posts=0;const h=await harness({onFetch:async(url,options)=>{if(options.method==='POST'){posts++;throw Error('offline unknown upload');}if(url.includes('/object/authenticated/'))return new Response(JSON.stringify({error:'NoSuchKey'}),{status:400});}});
 await assert.rejects(h.main(),/LOCAL_CLOUD_OBJECT_NOT_FOUND/);assert.equal(posts,2);assert.equal(h.receipts().filter(x=>x.state==='local_missing_object_recovery').length,1);assert.equal(h.receipts().some(x=>x.state==='local_cloud_verified'),false);assert.equal(h.completion(),undefined);
});

test('authentication or rate failure on recovery POST stops before another readback',async t=>{
 for(const status of [401,403,429])await t.test(String(status),async()=>{
  let posts=0,gets=0;const h=await harness({onFetch:async(url,options)=>{if(options.method==='POST'){if(++posts===1)throw Error('offline unknown upload');return new Response('',{status});}if(url.includes('/object/authenticated/')){gets++;return new Response('',{status:404});}}});
  await assert.rejects(h.main(),new RegExp('LOCAL_CLOUD_UPLOAD_HTTP_'+status));assert.equal(posts,2);assert.equal(gets,1);assert.equal(h.receipts().some(x=>x.state==='local_cloud_verified'),false);
 });
});

test('corrupt recovery readback remains unverified without a third POST',async()=>{
 let posts=0,gets=0;const h=await harness({onFetch:async(url,options)=>{if(options.method==='POST'){if(++posts===1)throw Error('offline unknown upload');return new Response('',{status:200});}if(url.includes('/object/authenticated/'))return ++gets===1?new Response('',{status:404}):new Response('%PDF-1.7\nwrong\n');}});
 await assert.rejects(h.main(),/SOURCE_SIZE_MISMATCH|SOURCE_SHA1_MISMATCH/);assert.equal(posts,2);assert.equal(gets,2);assert.equal(h.receipts().some(x=>x.state==='local_cloud_verified'),false);
});

function quarantinedOccurrence(sealed=false){
 const row=occurrence().row;
 return {...row,schema_version:'local-bundle-quarantined-pdf-occurrence/1',native_document_id:null,native_case_id:null,publisher_native_entity:false,publisher_parent_association_verified:false,private_quarantine_required:true,public_projection_allowed:false,network_download_performed:false,local_binary_sha_verified:true,source_http_status:null,source_http_retrieved_at:null,literal_recap_pdf_url:null,local_sealed_claim:sealed,source_seal_status:sealed?'locally_flagged_sealed':'unknown_local_blank',source_evidence:{...row.source_evidence,literal_recap_pdf_url:'',source_is_sealed_literal:sealed?'true':''}};
}

test('quarantine mode preserves blank and local sealed claims while default mode rejects both',()=>{
 for(const sealed of [false,true]){
  const row=quarantinedOccurrence(sealed);assert.equal(validateLocalPdfOccurrence(row,{allowQuarantine:true}),row);assert.throws(()=>validateLocalPdfOccurrence(row),/LOCAL_OCCURRENCE_REQUIRED/);
 }
});

test('quarantine mode rejects asserted API identities, public access and contradictory sealing claims',async t=>{
 const changes=[
  ['native_document_id',r=>{r.native_document_id='123';}],
  ['native_case_id',r=>{r.native_case_id='123';}],
  ['native_backend_document_id',r=>{r.native_backend_document_id='123';}],
  ['native_backend_identity_asserted',r=>{r.native_backend_identity_asserted=true;}],
  ['publisher_native_entity',r=>{r.publisher_native_entity=true;}],
  ['publisher_parent_association_verified',r=>{r.publisher_parent_association_verified=true;}],
  ['private_only',r=>{r.private_only=false;}],
  ['private_quarantine_required',r=>{r.private_quarantine_required=false;}],
  ['public_projection_allowed',r=>{r.public_projection_allowed=true;}],
  ['publisher_sealing_asserted',r=>{r.publisher_sealing_asserted=true;}],
  ['source literal false is not publisher-unsealed proof',r=>{r.source_evidence.source_is_sealed_literal='false';}],
  ['local sealed claim disagreement',r=>{r.local_sealed_claim=false;}],
  ['unsealed status substitution',r=>{r.source_seal_status='unsealed';}],
  ['blank status substitution',r=>{r.source_seal_status='unknown_local_blank';}],
  ['top-level publisher locator',r=>{r.literal_recap_pdf_url='https://storage.courtlistener.com/recap/offline.pdf';}],
  ['source publisher locator',r=>{r.source_evidence.literal_recap_pdf_url='https://storage.courtlistener.com/recap/offline.pdf';}],
  ['network_download_performed',r=>{r.network_download_performed=true;}],
  ['source_http_status',r=>{r.source_http_status=200;}],
  ['source_http_retrieved_at',r=>{r.source_http_retrieved_at='2026-10-02T00:00:00Z';}],
  ['local_binary_sha_verified',r=>{r.local_binary_sha_verified=false;}],
 ];
 for(const [name,change] of changes)await t.test(name,()=>{const row=quarantinedOccurrence(true);change(row);assert.throws(()=>validateLocalPdfOccurrence(row,{allowQuarantine:true}));});
});

test('16MiB cap belongs only to explicit quarantined rows and the default 6MiB cap remains intact',()=>{
 const ordinary={...occurrence().row,actual_bytes:6*1024**2+1};assert.throws(()=>validateLocalPdfOccurrence(ordinary),/LOCAL_OCCURRENCE_REQUIRED/);assert.throws(()=>validateLocalPdfOccurrence(ordinary,{allowQuarantine:true}),/LOCAL_OCCURRENCE_REQUIRED/);
 const row={...quarantinedOccurrence(),actual_bytes:16*1024**2};assert.equal(validateLocalPdfOccurrence(row,{allowQuarantine:true}),row);assert.throws(()=>validateLocalPdfOccurrence({...row,actual_bytes:16*1024**2+1},{allowQuarantine:true}),/LOCAL_OCCURRENCE_REQUIRED/);
});

test('readback cap accepts the exact larger quarantined body and rejects it in the original scope',async()=>{
 const bytes=Buffer.alloc(6*1024**2+1,32);bytes.write('%PDF-1.7\n');const expected={...quarantinedOccurrence(),actual_bytes:bytes.length,actual_sha256:sha(bytes),actual_sha1:sha(bytes,'sha1')};
 await verifyLocalCloudReadback(new Response(bytes),expected);await assert.rejects(verifyLocalCloudReadback(new Response(bytes),{...expected,schema_version:'local-bundle-observed-pdf-occurrence/1'}),/PDF_SIZE_LIMIT/);
});

test('quarantine activation rejects an unrecognized mode, arbitrary path or unpinned replacement packet',async t=>{
 for(const [name,options,error] of [
  ['unknown mode',{sourceKind:'local-unsealed'},/LOCAL_SOURCE_KIND_REQUIRED/],
  ['arbitrary path',{sourceKind:'private-local-quarantine'},/REVIEWED_QUARANTINE_PACKET_REQUIRED/],
  ['correct path with replacement bytes',{sourceKind:'private-local-quarantine',planPathOverride:'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/local-pdf-quarantine-v1/local-quarantined-pdf-occurrences-v1.jsonl'},/REVIEWED_QUARANTINE_PACKET_REQUIRED/],
 ])await t.test(name,async()=>{const h=await harness(options);await assert.rejects(h.main(),error);assert.equal(h.requests.length,0);assert.equal(h.readPaths.length,1);assert.equal(h.writes.length,0);});
});
