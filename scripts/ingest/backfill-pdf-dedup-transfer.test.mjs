import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runTransfer} from './backfill-pdfs-to-supabase.mjs';
import {objectKey} from './pdf-dedup.mjs';

const SUPABASE='https://xosqzzsnhxcyehcnirpa.supabase.co';
const sha=(x,algo='sha256')=>createHash(algo).update(x).digest('hex');
const pdf=label=>Buffer.from('%PDF-1.7\n'+label+'\n%%EOF\n');
const url=n=>'https://storage.courtlistener.com/recap/gov.uscourts.test.1/gov.uscourts.test.1.'+n+'.0.pdf';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

function nativeRow(n,bytes,over={}){
 const record=sha('record'+n);
 return{schema_version:'source-qualified-pdf-queue/1',provider:'courtlistener',native_document_id:String(n),native_case_id:'6240169',eligible:true,download_url:url(n),durable_url:'https://www.courtlistener.com/docket/6240169/'+n+'/x/',
  expected_sha1:sha(bytes,'sha1'),expected_bytes:bytes.length,title:null,selected_source_record_sha256:record,provider_flags:{is_available:true,is_sealed:null},
  origins:[{native_record_sha256:record,retrieved_at:'2026-10-02T21:00:00.000Z',native_case_id:'6240169',source_response_sha256:sha('response'+n),source_url:'https://www.courtlistener.com/api/rest/v4/docket-entries/?docket=6240169'}],...over};
}
function locatorRow(n){
 const record=sha('locator'+n);
 return{schema_version:'source-qualified-pdf-queue/1',provider:'courtlistener-public-locator',native_document_id:url(n),native_document_identity_kind:'publisher_observed_pdf_locator_url',native_case_id:'6240169',durable_url:url(n),download_url:url(n),eligible:true,expected_bytes:null,expected_sha1:null,title:'ORDER',
  selected_source_record_sha256:record,origins:[{native_record_sha256:record,retrieved_at:'2026-10-02T21:00:00.000Z',native_case_id:'6240169',source_response_sha256:sha('page'+n)}],
  provider_flags:{public_pdf_link_observed:true,sealing_related_locator_held:false,backend_api_id_verified:false,api_availability_verified:false}};
}
const stored=(label,extra={})=>{const b=pdf(label);return{sha256:sha(b),sha1:sha(b,'sha1'),bytes:b.length,first_verified_at:'2026-10-02T14:00:45.213+00:00',...extra};};

function world({objects=[],assets=[],pdfs={},indexStatus=200}={}){
 const sourceCalls=[],rpcCalls=[],uploaded=new Map();
 const fetchImpl=async(target,init={})=>{
  const u=String(target),method=init.method??'GET';
  if(u.startsWith('https://storage.courtlistener.com/')){sourceCalls.push(u);const b=pdfs[u];return b?new Response(b,{status:200}):new Response('<html>gone</html>',{status:404});}
  if(u===SUPABASE+'/storage/v1/bucket/corpus-originals')return json({id:'corpus-originals',public:false});
  if(u===SUPABASE+'/rest/v1/rpc/corpus_admin_pdf_dedup_index_v1'){
   rpcCalls.push(JSON.parse(init.body));if(indexStatus!==200)return new Response('edge',{status:indexStatus});
   const body=JSON.parse(init.body),source=body.p_kind==='objects'?objects:assets,key=r=>body.p_kind==='objects'?r.sha256:r.source_system+'|'+r.native_document_id;
   const rows=source.filter(r=>key(r)>body.p_after).sort((a,b)=>key(a)<key(b)?-1:1).slice(0,body.p_limit);return json({rows,last:rows.length?key(rows.at(-1)):null});
  }
  const m=/\/storage\/v1\/object\/(?:authenticated\/)?corpus-originals\/(.+)$/.exec(u);
  if(m&&method==='POST'){if(uploaded.has(m[1]))return json({code:'KeyAlreadyExists'},400);const chunks=[];for await(const c of init.body)chunks.push(c);uploaded.set(m[1],Buffer.concat(chunks));return json({Key:m[1]});}
  if(m&&method==='GET')return uploaded.has(m[1])?new Response(uploaded.get(m[1]),{status:200}):json({error:'not_found'},404);
  throw Error('unexpected request '+method+' '+u);
 };
 return{fetchImpl,sourceCalls,rpcCalls,uploaded};
}
async function setup(rows){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dedup-run-')),queue=path.join(dir,'q.queue.jsonl'),bytes=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 await fs.writeFile(queue,bytes);
 const credentials=path.join(dir,'credentials.json');await fs.writeFile(credentials,JSON.stringify({EXTERNAL_SUPABASE_URL:SUPABASE,EXTERNAL_SUPABASE_KEY:'sb_secret_unit_test_value'}));
 const argv=(cache,extra=[])=>['--queue='+queue,'--queue-sha256='+sha(bytes),'--cache='+path.join(dir,cache),'--credentials='+credentials,'--max-files=100','--concurrency=1','--disk-reserve-gb=0','--execute',...extra];
 return{dir,argv};
}
const receipts=async(dir,cache)=>(await fs.readFile(path.join(dir,cache,'transfer-receipts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);

test('rows whose bytes are already stored are registered without any source request; only genuinely new bytes are downloaded',async()=>{
 const A=pdf('document A (already stored)'),B=pdf('document B (new)'),E=pdf('document E (new version)'),Y=stored('old bytes of the URL E points at'),X=stored('document A (already stored)'),L=stored('locator bytes already verified');
 const rows=[nativeRow(1,A,{expected_bytes:A.length+99}),nativeRow(2,B),nativeRow(3,B),locatorRow(4),nativeRow(5,E,{download_url:url(50)})];
 const w=world({objects:[X,Y,L],assets:[
   {source_system:'courtlistener-public-locator',native_document_id:url(4),sha256s:[L.sha256],first_verified_at:L.first_verified_at},
   {source_system:'courtlistener-public-locator',native_document_id:url(50),sha256s:[Y.sha256],first_verified_at:Y.first_verified_at}],
  pdfs:{[url(2)]:B,[url(3)]:B,[url(50)]:E}});
 const {dir,argv}=await setup(rows),result=await runTransfer(argv('cache'),{fetch:w.fetchImpl,pause:async()=>{}});
 const s=result.state;
 assert.equal(result.stopped,false);assert.equal(s.complete,true);assert.equal(s.processed,5);
 assert.equal(s.dedup_candidates,2);assert.equal(s.download_candidates,3,'the index only knows the stored bytes when the run starts');
 assert.deepEqual(w.sourceCalls,[url(2),url(50)],'A, the repeated B and the known locator never touch the source');
 assert.equal(s.dedup_registered,3);assert.deepEqual(s.dedup_by_basis,{provider_sha1_equals_stored_sha1:2,exact_url_previously_verified:1});
 assert.equal(s.new_objects,2);assert.equal(s.verified_existing,0);assert.equal(s.dedup_conflicts,1);assert.equal(s.cloud_verified,2);
 const r=await receipts(dir,'cache'),dedup=r.filter(x=>x.state==='dedup_matched');
 assert.equal(dedup.length,3);
 // dedup first, then downloads: the first download_pending comes after the two initially-dedupable rows
 assert.deepEqual(r.slice(0,2).map(x=>x.state),['dedup_matched','dedup_matched']);
 const a=dedup.find(x=>x.native_document_id==='1');
 assert.equal(a.dedup_basis,'provider_sha1_equals_stored_sha1');assert.equal(a.sha256,X.sha256);assert.equal(a.storage_key,objectKey(X.sha256));assert.equal(a.object_first_verified_at,'2026-10-02T14:00:45.213Z');
 assert.equal(a.download_skipped,true);assert.equal(a.source_size_claim_matched,false);assert.equal(a.source_sha1_claim_matched,true);assert.equal(a.queue_sha256.length,64);
 const c=dedup.find(x=>x.native_document_id==='3');assert.equal(c.sha256,sha(B),'the repeated document dedups against the object stored a moment earlier in this run');
 const verified=r.filter(x=>x.state==='cloud_verified');assert.deepEqual(verified.map(x=>x.object_origin),['new_object','new_object']);
 assert.equal(r.filter(x=>x.state==='dedup_conflict_noted').length,1);
 assert.equal(verified.find(x=>x.native_document_id==='5').dedup_conflict.kind,'provider_sha1_differs_from_stored_for_same_url');
 assert.equal(JSON.stringify(r).includes('download_url'),false,'no source locator is written to a receipt');
 assert.deepEqual([...w.uploaded.keys()].sort(),[objectKey(sha(B)),objectKey(sha(E))].sort());
});

test('a finished run resumes as done: dedup receipts count as completed work and nothing is fetched again',async()=>{
 const A=pdf('resume A'),X=stored('resume A'),rows=[nativeRow(1,A),nativeRow(2,pdf('resume B'))];
 const w=world({objects:[X],pdfs:{[url(2)]:pdf('resume B')}}),{dir,argv}=await setup(rows);
 await runTransfer(argv('cache'),{fetch:w.fetchImpl,pause:async()=>{}});
 const calls=w.sourceCalls.length,second=await runTransfer(argv('cache'),{fetch:w.fetchImpl,pause:async()=>{}});
 assert.equal(second.state.selected,0);assert.equal(second.state.initially_verified,2);assert.equal(second.state.complete,true);
 assert.equal(w.sourceCalls.length,calls);
});

test('with --no-dedup nothing is looked up; an already stored object is reported as verified_existing, not as new',async()=>{
 const B=pdf('no dedup B'),w=world({pdfs:{[url(2)]:B,[url(3)]:B}}),{argv}=await setup([nativeRow(2,B),nativeRow(3,B)]);
 const result=await runTransfer(argv('cache',['--no-dedup']),{fetch:w.fetchImpl,pause:async()=>{}});
 assert.equal(w.rpcCalls.length,0);assert.deepEqual(w.sourceCalls,[url(2),url(3)]);
 assert.equal(result.state.new_objects,1);assert.equal(result.state.verified_existing,1);assert.equal(result.state.dedup_registered,0);assert.equal(result.state.dedup_enabled,false);
});

test('if the stored-object index cannot be loaded the run stops (restartable) instead of spending source requests blindly',async()=>{
 const B=pdf('index down'),w=world({indexStatus:503,pdfs:{[url(2)]:B}}),{dir,argv}=await setup([nativeRow(2,B)]);
 const result=await runTransfer(argv('cache'),{fetch:w.fetchImpl,pause:async()=>{}});
 assert.equal(result.stopped,true);assert.equal(result.state.stop_reason,'DEDUP_INDEX_UNAVAILABLE');assert.equal(result.state.complete,false);
 assert.equal(w.sourceCalls.length,0);assert.equal(w.rpcCalls.length,5);
 assert.equal((await receipts(dir,'cache')).at(-1).state,'dedup_index_unavailable');
});

test('eligibility is unchanged: a held row is never dedup-registered or downloaded',async()=>{
 const A=pdf('held A'),X=stored('held A'),sealed=nativeRow(1,A,{provider_flags:{is_available:true,is_sealed:true}});
 const w=world({objects:[X]}),{argv}=await setup([sealed]);
 await assert.rejects(runTransfer(argv('cache'),{fetch:w.fetchImpl,pause:async()=>{}}),/SEALED_OR_UNAVAILABLE_PDF/);
 assert.equal(w.sourceCalls.length,0);
});

// ---- host guard (--allowed-hosts) ------------------------------------------------------------
const OFFICIAL='https://www.njd.uscourts.gov/sites/njd/files/';
function officialRow(n){
 const record=sha('official'+n),u=OFFICIAL+'CaseMO'+n+'.pdf';
 return{schema_version:'source-qualified-pdf-queue/1',provider:'official-court',native_document_id:u,native_document_identity_kind:'publisher_observed_pdf_locator_url',native_case_id:'3:16-md-02738',durable_url:u,download_url:u,
  expected_sha1:null,expected_bytes:null,title:'Case Management Order '+n,filing_date:null,selected_source_record_sha256:record,eligible:true,
  provider_flags:{sealing_related_locator_held:false,pdf_http_access_verified:false,pdf_content_verified:false},
  origins:[{native_record_sha256:record,retrieved_at:'2026-10-03T16:00:00.000Z',native_case_id:'3:16-md-02738',source_response_sha256:sha('official page '+n)}]};
}
const GUARD=['--allowed-hosts=storage.courtlistener.com','--host-skip-reason=non_courtlistener_host'];
function guardedWorld(pdfs){
 const w=world({pdfs}),inner=w.fetchImpl,otherCalls=[];
 w.otherCalls=otherCalls;
 w.fetchImpl=async(target,init)=>{const u=String(target);if(!u.startsWith(SUPABASE)&&!u.startsWith('https://storage.courtlistener.com/'))otherCalls.push(u);return inner(target,init);};
 return w;
}

test('the host guard skips rows aimed at hosts the runner does not own: never fetched, never failed, receipt reason non_courtlistener_host',async()=>{
 const B=pdf('guard B'),w=guardedWorld({[url(1)]:B}),{dir,argv}=await setup([nativeRow(1,B),officialRow(1),officialRow(2)]);
 const result=await runTransfer(argv('cache',GUARD),{fetch:w.fetchImpl,pause:async()=>{}});
 const s=result.state;
 assert.equal(result.stopped,false);assert.equal(s.complete,true);
 assert.equal(s.eligible,3);assert.equal(s.held,0);assert.equal(s.selected,1);assert.equal(s.processed,1);assert.equal(s.failed,0);
 assert.equal(s.skipped,2);assert.deepEqual(s.skipped_by_reason,{non_courtlistener_host:2});assert.deepEqual(s.skipped_hosts,{'www.njd.uscourts.gov':2});
 assert.deepEqual(w.sourceCalls,[url(1)]);assert.deepEqual(w.otherCalls,[],'no request of any kind reaches an official court host');
 const r=await receipts(dir,'cache'),skipped=r.filter(x=>x.state==='skipped');
 assert.equal(skipped.length,2);
 for(const x of skipped){assert.equal(x.reason,'non_courtlistener_host');assert.equal(x.host,'www.njd.uscourts.gov');assert.equal(x.provider,'official-court');assert.equal(x.queue_sha256.length,64);}
 assert.equal(r.filter(x=>x.state==='failed').length,0);
 assert.equal(r.some(x=>x.state==='cloud_verified'&&x.provider==='official-court'),false,'a skipped row is never reported as verified');
 assert.equal(JSON.stringify(skipped).includes('download_url'),false);
});

test('resuming a guarded batch does not repeat skipped receipts or fetch anything',async()=>{
 const B=pdf('guard resume'),w=guardedWorld({[url(1)]:B}),{dir,argv}=await setup([nativeRow(1,B),officialRow(3)]);
 await runTransfer(argv('cache',GUARD),{fetch:w.fetchImpl,pause:async()=>{}});
 const calls=w.sourceCalls.length,second=await runTransfer(argv('cache',GUARD),{fetch:w.fetchImpl,pause:async()=>{}});
 assert.equal(second.state.selected,0);assert.equal(second.state.skipped,1);assert.equal(second.state.complete,true);
 assert.equal(w.sourceCalls.length,calls);assert.deepEqual(w.otherCalls,[]);
 assert.equal((await receipts(dir,'cache')).filter(x=>x.state==='skipped').length,1);
});

test('a batch made only of skipped rows completes with nothing transferred',async()=>{
 const w=guardedWorld({}),{dir,argv}=await setup(Array.from({length:9},(_,i)=>officialRow(10+i)));
 const result=await runTransfer(argv('cache',GUARD),{fetch:w.fetchImpl,pause:async()=>{}});
 assert.equal(result.state.complete,true);assert.equal(result.state.processed,0);assert.equal(result.state.selected,0);assert.equal(result.state.skipped,9);
 assert.equal(w.sourceCalls.length,0);assert.deepEqual(w.otherCalls,[]);assert.equal(result.state.new_objects+result.state.dedup_registered+result.state.cloud_verified,0);
 assert.equal((await receipts(dir,'cache')).filter(x=>x.state==='skipped').length,9);
});

test('under the guard even a row whose host fails provider validation is skipped instead of aborting the whole batch; without the guard behavior is unchanged',async()=>{
 const B=pdf('guard foreign'),foreign=nativeRow(2,B,{download_url:'https://evil.example/recap/x.pdf'}),w=guardedWorld({[url(1)]:B}),{argv}=await setup([nativeRow(1,B),foreign]);
 const guarded=await runTransfer(argv('cache',GUARD),{fetch:w.fetchImpl,pause:async()=>{}});
 assert.equal(guarded.state.skipped,1);assert.equal(guarded.state.cloud_verified+guarded.state.dedup_registered,1);assert.deepEqual(w.otherCalls,[]);
 await assert.rejects(runTransfer(argv('unguarded'),{fetch:w.fetchImpl,pause:async()=>{}}),/PDF_HOST_NOT_ALLOWED/);
});

test('an empty allow-list is refused rather than silently skipping everything; the dry run reports the skipped count',async()=>{
 const {argv}=await setup([officialRow(20)]);
 await assert.rejects(runTransfer(argv('cache',['--allowed-hosts=']),{fetch:async()=>{throw Error('no network');},pause:async()=>{}}),/ALLOWED_HOSTS_INVALID/);
 const lines=[],log=console.log;console.log=x=>lines.push(x);
 try{await runTransfer(argv('dry',GUARD).filter(a=>a!=='--execute'),{fetch:async()=>{throw Error('no network');}});}finally{console.log=log;}
 assert.deepEqual(JSON.parse(lines.at(-1)),{state:'verified_dry_run',queued:0,held:0,skippedHost:1,alreadyVerified:0,pending:0});
});
