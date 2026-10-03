import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {transportRow,groupReceipts,readNewReceiptLines,callRegistration,registerWithIsolation} from './register-private-pdf-assets.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const ack=n=>JSON.stringify({received:n,private_only:true,bucket:'corpus-originals'});
const res=(status,body)=>new Response(body,{status,headers:{'content-type':String(body).startsWith('{')?'application/json':'text/html'}});
const pauses=()=>{const delays=[];const pause=async ms=>{delays.push(ms);};pause.delays=delays;return pause;};
function receipt(n,overrides={}){
 const bytes=Buffer.from('%PDF-1.7 '+n),digest=sha(bytes);
 return{provider:'courtlistener-public-locator',native_document_id:'https://storage.courtlistener.com/recap/gov.uscourts.test.'+n+'.pdf',native_case_id:'123',durable_url:'https://storage.courtlistener.com/recap/gov.uscourts.test.'+n+'.pdf',
  selected_source_record_sha256:sha('src'+n),source_origins:[{native_record_sha256:sha('src'+n),retrieved_at:'2026-10-02T21:00:00.000Z'}],state:'cloud_verified',project_id:'xosqzzsnhxcyehcnirpa',bucket:'corpus-originals',
  storage_key:'seeger-weiss/pdf-sha256/'+digest.slice(0,2)+'/'+digest+'.pdf',sha256:digest,sha1:createHash('sha1').update(bytes).digest('hex'),bytes:bytes.length,...overrides};
}

test('transport rows keep the verified identity, drop resumable locations and hash personalized provider locators',()=>{
 const base=receipt(1);delete base.selected_source_record_sha256;
 const row=transportRow({...base,upload_location:'https://x.storage.supabase.co/storage/v1/upload/resumable/abc'});
 assert.equal('upload_location' in row,false);assert.equal(row.selected_source_record_sha256,sha('src1'));
 const signed=transportRow(receipt(2,{durable_url:'https://www.docketbird.com/court_documents?id=1&user_id=99'}));
 assert.equal(signed.durable_url,null);assert.equal(signed.provider_locator_sha256,sha('https://www.docketbird.com/court_documents?id=1&user_id=99'));
 assert.throws(()=>transportRow(receipt(3,{sha256:'a'.repeat(64)})),/Verified transfer identity mismatch/);
 assert.throws(()=>transportRow(receipt(4,{download_url:'https://x'})),/Expiring locators excluded/);
});

test('groups never exceed 50 receipts per RPC',()=>{
 const items=Array.from({length:120},(_,i)=>({hash:sha('h'+i),row:transportRow(receipt(i))}));
 assert.deepEqual(groupReceipts(items).map(g=>g.length),[50,50,20]);
});

test('only complete JSONL lines are consumed and offsets advance without re-reading',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reg-'));const file=path.join(dir,'transfer-receipts.jsonl');const cursor={offset:0};
 assert.deepEqual(await readNewReceiptLines(file,cursor),[]);
 await fs.writeFile(file,'{"a":1}\n{"b":2}\n{"c"');
 assert.deepEqual(await readNewReceiptLines(file,cursor),['{"a":1}','{"b":2}']);
 assert.deepEqual(await readNewReceiptLines(file,cursor),[]);
 await fs.appendFile(file,':3}\n{"d":"é"}\n');
 assert.deepEqual(await readNewReceiptLines(file,cursor),['{"c":3}','{"d":"é"}']);
 assert.equal(cursor.offset,(await fs.stat(file)).size);
});

test('Cloudflare 520 pages and connection resets retry with backoff and then acknowledge',async()=>{
 const steps=[()=>res(520,'<html>Web server returned an unknown error</html>'),()=>{throw Object.assign(new TypeError('fetch failed'),{cause:Object.assign(new Error('read ECONNRESET'),{code:'ECONNRESET'})});},()=>res(200,ack(2))];
 let calls=0;const pause=pauses(),retries=[];
 const result=await callRegistration({url:'https://xosqzzsnhxcyehcnirpa.supabase.co',headers:{},rows:[{a:1},{a:2}],fetchImpl:async()=>steps[calls++](),pause,onRetry:e=>retries.push(e.failure)});
 assert.equal(result.ok,true);assert.equal(calls,3);assert.deepEqual(pause.delays,[2000,4000]);assert.deepEqual(retries,['HTTP_520','NETWORK_ERROR']);
});

test('definite database rejections are returned (not retried); access errors and endless outages are thrown',async()=>{
 let calls=0;
 const rejected=await callRegistration({url:'https://x',headers:{},rows:[{}],fetchImpl:async()=>{calls++;return res(400,JSON.stringify({code:'P0001',message:'Private stored original not found at verified size'}));},pause:pauses()});
 assert.equal(rejected.ok,false);assert.equal(rejected.error_code,'P0001');assert.equal(calls,1);
 const mismatch=await callRegistration({url:'https://x',headers:{},rows:[{},{}],fetchImpl:async()=>res(200,ack(1)),pause:pauses()});
 assert.equal(mismatch.error_code,'REGISTRATION_ACKNOWLEDGEMENT_MISMATCH');
 for(const status of [401,403,404])await assert.rejects(callRegistration({url:'https://x',headers:{},rows:[{}],fetchImpl:async()=>res(status,'{}'),pause:pauses()}),e=>e.message==='REGISTRATION_ACCESS_ERROR'&&e.status===status);
 calls=0;await assert.rejects(callRegistration({url:'https://x',headers:{},rows:[{}],fetchImpl:async()=>{calls++;return res(503,'busy');},pause:pauses(),attempts:3}),e=>e.message==='REGISTRATION_TRANSIENT_FAILURE'&&e.failure==='HTTP_503');
 assert.equal(calls,3);
});

test('one rejected receipt is isolated by bisection while every other receipt in the group is registered',async()=>{
 const items=Array.from({length:7},(_,i)=>({hash:sha('r'+i),row:{id:i}}));const bad=3;
 const events=[],acknowledged=new Set(),rejected=new Map();let calls=0;
 const call=async rows=>{calls++;const body=JSON.stringify({p_rows:rows});
  if(rows.some(r=>r.id===bad))return{ok:false,rejected:true,status:400,error_code:'P0001',message:'Immutable native PDF association conflict',batch_sha256:sha(body)};
  return{ok:true,status:200,data:JSON.parse(ack(rows.length)),batch_sha256:sha(body)};};
 const total=await registerWithIsolation(items,{call,record:async e=>{events.push(e);},acknowledged,rejected});
 assert.equal(total,6);assert.equal(acknowledged.size,6);assert.equal(acknowledged.has(items[bad].hash),false);
 assert.deepEqual([...rejected.keys()],[items[bad].hash]);assert.equal(rejected.get(items[bad].hash).error_code,'P0001');
 assert.ok(calls<=1+2*Math.ceil(Math.log2(7))+1,'bisection stays logarithmic: '+calls);
 assert.equal(events.filter(e=>e.state==='registration_receipt_rejected').length,1);
 assert.equal(events.filter(e=>e.state==='registration_acknowledged').reduce((n,e)=>n+e.records,0),6);
});

test('a fully valid group is registered with a single call',async()=>{
 const items=Array.from({length:5},(_,i)=>({hash:sha('ok'+i),row:{id:i}}));let calls=0;const acknowledged=new Set();
 const total=await registerWithIsolation(items,{call:async rows=>{calls++;return{ok:true,status:200,data:JSON.parse(ack(rows.length)),batch_sha256:sha('x')};},record:async()=>{},acknowledged,rejected:new Map()});
 assert.equal(total,5);assert.equal(calls,1);assert.equal(acknowledged.size,5);
});

function dedupReceipt(n,overrides={}){
 const base=receipt(n);
 return{...base,state:'dedup_matched',dedup_basis:'provider_sha1_equals_stored_sha1',download_skipped:true,byte_verification:'earlier_hash_checked_cloud_readback',
  object_first_verified_at:'2026-10-02T14:00:45.213Z',dedup_index_loaded_at:'2026-10-03T15:30:00.000Z',recorded_at:'2026-10-03T15:31:00.000Z',source_sha1_claim_matched:true,source_size_claim_matched:false,...overrides};
}

test('a dedup receipt registers as a cloud-verified association carrying the earlier verification time and the dedup basis',()=>{
 const row=transportRow(dedupReceipt(7));
 assert.equal(row.state,'cloud_verified');assert.equal(row.verified_at,'2026-10-02T14:00:45.213Z');
 assert.equal(row.dedup_basis,'provider_sha1_equals_stored_sha1');assert.equal(row.download_skipped,true);
 assert.equal(row.association_receipt_state,'dedup_matched');assert.equal(row.association_recorded_at,'2026-10-03T15:31:00.000Z');
 assert.equal(row.sha256,receipt(7).sha256);assert.equal(JSON.stringify(row).includes('download_url'),false);
 assert.equal(transportRow(dedupReceipt(8,{dedup_basis:'exact_url_previously_verified'})).dedup_basis,'exact_url_previously_verified');
});

test('dedup receipts without explicit evidence, with an unknown basis or with a wrong object identity are refused',()=>{
 assert.throws(()=>transportRow(dedupReceipt(1,{dedup_basis:'because_it_looked_similar'})),/Dedup receipt evidence mismatch/);
 assert.throws(()=>transportRow(dedupReceipt(2,{download_skipped:false})),/Dedup receipt evidence mismatch/);
 assert.throws(()=>transportRow(dedupReceipt(3,{object_first_verified_at:'not a time'})),/Dedup receipt evidence mismatch/);
 assert.throws(()=>transportRow(dedupReceipt(4,{sha256:'a'.repeat(64)})),/Verified transfer identity mismatch/);
});
