import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeSourceUrl,createDedupIndex,loadDedupIndex,dedupReceiptFields,objectKey,DEDUP_PROVIDERS} from './pdf-dedup.mjs';

const h=(label,algo='sha256')=>createHash(algo).update(label).digest('hex');
const object=(label,extra={})=>({sha256:h(label),sha1:h(label,'sha1'),bytes:1000+label.length,first_verified_at:'2026-10-02T14:00:45.213+00:00',...extra});
const url=n=>'https://storage.courtlistener.com/recap/gov.uscourts.test.1/gov.uscourts.test.1.'+n+'.0.pdf';
const nativeRow=(n,over={})=>({provider:'courtlistener',native_document_id:String(n),native_case_id:'6240169',download_url:url(n),expected_sha1:null,expected_bytes:null,...over});
const locatorRow=(n,over={})=>({provider:'courtlistener-public-locator',native_document_id:url(n),native_case_id:'6240169',download_url:url(n),expected_sha1:null,expected_bytes:null,...over});

test('URLs are compared in one normalized form; credentials, other schemes and junk never match',()=>{
 assert.equal(normalizeSourceUrl('HTTPS://Storage.CourtListener.com/recap/x.pdf#frag'),'https://storage.courtlistener.com/recap/x.pdf');
 assert.equal(normalizeSourceUrl('http://storage.courtlistener.com/recap/x.pdf'),null);
 assert.equal(normalizeSourceUrl('https://user:pw@storage.courtlistener.com/recap/x.pdf'),null);
 assert.equal(normalizeSourceUrl('not a url'),null);
 assert.deepEqual([...DEDUP_PROVIDERS].sort(),['courtlistener','courtlistener-public-locator']);
});

test('provider SHA-1 equal to a stored SHA-1 is a dedup even when the advertised size is stale (the SHA-1 decides)',()=>{
 const stored=object('stored one'),index=createDedupIndex();index.addObject(stored);
 const plan=index.classify(nativeRow(1,{expected_sha1:stored.sha1.toUpperCase(),expected_bytes:stored.bytes-300}));
 assert.equal(plan.action,'dedup');assert.equal(plan.basis,'provider_sha1_equals_stored_sha1');assert.equal(plan.object.sha256,stored.sha256);
 assert.equal(plan.object.first_verified_at,'2026-10-02T14:00:45.213Z');
 const fields=dedupReceiptFields(nativeRow(1,{expected_sha1:stored.sha1,expected_bytes:stored.bytes-300}),plan,index,'corpus-originals','xosqzzsnhxcyehcnirpa');
 assert.equal(fields.state,'dedup_matched');assert.equal(fields.download_skipped,true);assert.equal(fields.storage_key,objectKey(stored.sha256));
 assert.equal(fields.source_size_claim_matched,false);assert.equal(fields.source_sha1_claim_matched,true);assert.equal(fields.object_first_verified_at,'2026-10-02T14:00:45.213Z');
 assert.equal(JSON.stringify(fields).includes('download_url'),false);
});

test('a provider SHA-1 that matches nothing stored needs a real download, and a known native document with other bytes is noted as a new version',()=>{
 const stored=object('old version'),index=createDedupIndex();index.addObject(stored);index.addAsset({source_system:'courtlistener',native_document_id:'7',sha256s:[stored.sha256],first_verified_at:stored.first_verified_at});
 assert.deepEqual(index.classify(nativeRow(5,{expected_sha1:h('never stored','sha1')})),{action:'download',reason:'no_stored_match'});
 const plan=index.classify(nativeRow(7,{expected_sha1:h('new version','sha1')}));
 assert.equal(plan.action,'download');assert.equal(plan.conflict.kind,'native_document_previously_verified_with_other_bytes');assert.deepEqual(plan.conflict.stored_sha256s,[stored.sha256]);
});

test('an exact URL previously verified is a dedup when the row has no contradicting provider hash',()=>{
 const stored=object('locator bytes'),index=createDedupIndex();index.addObject(stored);
 index.addAsset({source_system:'courtlistener-public-locator',native_document_id:url(9),sha256s:[stored.sha256],first_verified_at:stored.first_verified_at});
 const plan=index.classify(locatorRow(9));
 assert.equal(plan.action,'dedup');assert.equal(plan.basis,'exact_url_previously_verified');assert.equal(plan.object.sha256,stored.sha256);
 // a native row for the same URL carrying the matching SHA-1 dedups too (SHA-1 rule first)
 assert.equal(index.classify(nativeRow(9,{expected_sha1:stored.sha1})).basis,'provider_sha1_equals_stored_sha1');
 assert.equal(index.classify(locatorRow(10)).action,'download');
});

test('SHA-1 conflict lesson: a known URL whose provider SHA-1 or size differs from the stored object is downloaded as a new version, with the conflict recorded',()=>{
 const stored=object('first fetch'),index=createDedupIndex();index.addObject(stored);
 index.addVerifiedUrl(url(11),stored.sha256);
 const bySha1=index.classify(nativeRow(11,{expected_sha1:h('replaced file','sha1')}));
 assert.equal(bySha1.action,'download');assert.equal(bySha1.reason,'provider_sha1_differs_from_stored_for_same_url');
 assert.deepEqual(bySha1.conflict,{kind:'provider_sha1_differs_from_stored_for_same_url',stored_sha256:stored.sha256,stored_sha1:stored.sha1,provider_sha1:h('replaced file','sha1')});
 const bySize=index.classify(locatorRow(11,{expected_bytes:stored.bytes+5}));
 assert.equal(bySize.action,'download');assert.equal(bySize.conflict.kind,'provider_size_differs_from_stored_for_same_url');
 // two stored versions of one URL are ambiguous: never guess
 const other=object('second fetch');index.addObject(other);index.addVerifiedUrl(url(11),other.sha256);
 assert.equal(index.classify(locatorRow(11)).conflict.kind,'url_has_multiple_stored_versions');
});

test('rows of providers without a stable hash or URL are always downloaded, and an ambiguous SHA-1 switches the SHA-1 rule off',()=>{
 const stored=object('shared'),index=createDedupIndex();index.addObject(stored);
 for(const provider of ['docketbird','official-court'])assert.deepEqual(index.classify({provider,native_document_id:'x',download_url:url(1),expected_sha1:stored.sha1}),{action:'download',reason:'provider_not_dedupable'});
 index.addObject({...object('collision'),sha1:stored.sha1});
 assert.equal(index.classify(nativeRow(1,{expected_sha1:stored.sha1})).action,'download');
 assert.equal(index.addObject({sha256:'x',sha1:'y',bytes:1}),false);assert.equal(index.addObject(null),false);assert.equal(index.addAsset({source_system:'courtlistener',native_document_id:'1',sha256s:['nope']}),false);
});

test('objects verified earlier in the same run dedup later rows that carry the same hash or URL',()=>{
 const index=createDedupIndex(),fresh=object('stored mid-run');
 assert.equal(index.classify(nativeRow(20,{expected_sha1:fresh.sha1})).action,'download');
 assert.equal(index.hasObject(fresh.sha256),false);
 index.addObject(fresh);index.addVerifiedUrl(url(20),fresh.sha256);
 assert.equal(index.hasObject(fresh.sha256),true);
 assert.equal(index.classify(nativeRow(21,{expected_sha1:fresh.sha1})).action,'dedup');
 assert.equal(index.classify(locatorRow(20)).basis,'exact_url_previously_verified');
});

// ---- index loading --------------------------------------------------------------------------
const res=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function indexServer({objects,assets,failures=[]}){
 const calls=[];
 const fetchImpl=async(target,init)=>{
  const body=JSON.parse(init.body);calls.push(body);
  const failure=failures.shift();if(failure)return failure instanceof Error?Promise.reject(failure):res(failure,{message:'edge'});
  const source=body.p_kind==='objects'?objects:assets,key=r=>body.p_kind==='objects'?r.sha256:r.source_system+'|'+r.native_document_id;
  const rows=source.filter(r=>key(r)>body.p_after).sort((a,b)=>key(a)<key(b)?-1:1).slice(0,body.p_limit);
  return res(200,{rows,last:rows.length?key(rows[rows.length-1]):null});
 };
 return{fetchImpl,calls};
}
test('the index loads every page of both kinds, retries transient registry errors and rejects a stalled cursor',async()=>{
 const objects=Array.from({length:5},(_,i)=>object('obj'+i)),assets=[0,1,2].map(i=>({source_system:'courtlistener-public-locator',native_document_id:url(i),sha256s:[objects[i].sha256],first_verified_at:'2026-10-02T15:00:00Z'}));
 const server=indexServer({objects,assets,failures:[520,Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}})]});const pauses=[];
 const index=await loadDedupIndex({baseUrl:'https://x.supabase.co',headers:{apikey:'k'},fetchImpl:server.fetchImpl,pageSize:2,pause:async ms=>pauses.push(ms)});
 assert.deepEqual(index.stats().objects,5);assert.equal(index.stats().urls,3);assert.equal(index.stats().native_documents,3);
 assert.equal(index.classify(locatorRow(1)).basis,'exact_url_previously_verified');
 assert.deepEqual(pauses,[1000,2000]);assert.equal(index.load.pages.objects,3);
 const stalled=async()=>({ok:true,status:200,text:async()=>JSON.stringify({rows:[object('same')],last:'a'})});
 await assert.rejects(loadDedupIndex({baseUrl:'https://x',headers:{},fetchImpl:stalled,pageSize:1,pause:async()=>{}}),/DEDUP_INDEX_CURSOR_STALLED/);
});

test('permanent registry errors and endless outages surface as explicit, restartable failures',async()=>{
 const denied=indexServer({objects:[],assets:[],failures:[403]});
 await assert.rejects(loadDedupIndex({baseUrl:'https://x',headers:{},fetchImpl:denied.fetchImpl,pause:async()=>{}}),/DEDUP_INDEX_HTTP_403/);
 const down=indexServer({objects:[],assets:[],failures:Array(9).fill(503)});
 await assert.rejects(loadDedupIndex({baseUrl:'https://x',headers:{},fetchImpl:down.fetchImpl,attempts:3,pause:async()=>{}}),e=>e.message==='DEDUP_INDEX_UNAVAILABLE'&&e.failure==='HTTP_503');
 assert.equal(down.calls.length,3);
});

test('the queue report separates rows already done, dedupable by basis, and rows that need a download',async()=>{
 const {default:fs}=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {reportQueueDedup}=await import('./report-pdf-queue-dedup.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dedup-report-')),dir=path.join(root,'courtlistener-pdf-batches');await fs.mkdir(dir,{recursive:true});
 const stored=object('reported'),index=createDedupIndex();index.addObject(stored);index.addVerifiedUrl(url(2),stored.sha256);
 const origin=n=>[{native_record_sha256:h('rec'+n),retrieved_at:'2026-10-02T21:00:00.000Z'}];
 const rows=[nativeRow(1,{expected_sha1:stored.sha1,selected_source_record_sha256:h('rec1'),origins:origin(1)}),locatorRow(2,{selected_source_record_sha256:h('rec2'),origins:origin(2)}),nativeRow(3,{expected_sha1:h('other','sha1'),selected_source_record_sha256:h('rec3'),origins:origin(3)}),nativeRow(4,{selected_source_record_sha256:h('rec4'),origins:origin(4)})];
 const queue=path.join(dir,'q-0001.queue.jsonl');await fs.writeFile(queue,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');await fs.writeFile(queue+'.manifest.json',JSON.stringify({queue,sha256:h('x')}));
 const verified=new Set([rows[3].provider+'|'+rows[3].native_document_id+'|'+h('rec4')]);
 const report=await reportQueueDedup({root,index,verified});
 assert.deepEqual(report.total,{rows:4,already_done:1,dedup_provider_sha1:1,dedup_exact_url:1,download:1,conflicts:0,pending_rows:3,dedupable_rows:2,dedupable_share:0.6667});
 assert.deepEqual(report.download_reasons,{no_stored_match:1});assert.equal(report.per_queue[0].queue,'q-0001');
});
