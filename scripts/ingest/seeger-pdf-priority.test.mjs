import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {tierOfMdl,docRank,mdlFromDocketKey,parseCsv,buildPriorityMap,orderRows,TIER1_MDLS,TIER2_MDLS} from './seeger-pdf-priority.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const freeze=path.join(path.dirname(fileURLToPath(import.meta.url)),'freeze-seeger-priority-pdf-queues.mjs');

test('tiers follow the firm priority list; unknown matters never rank above a listed one',()=>{
 assert.equal(TIER1_MDLS.length,24);assert.equal(TIER2_MDLS.length,14);
 assert.equal(tierOfMdl(2738),1);assert.equal(tierOfMdl(3140),1);assert.equal(tierOfMdl(2323),2);assert.equal(tierOfMdl(1699),3);assert.equal(tierOfMdl(null),4);
 assert.equal(tierOfMdl(null,{parentMaster:true}),3);
 assert.equal(mdlFromDocketKey('njd-3:2016-md-02738'),2738);assert.equal(mdlFromDocketKey('scd-2:2018-mn-02873'),2873);assert.equal(mdlFromDocketKey('njd-3:2020-cv-00001'),null);
});

test('document ranks put court orders and opinions first, administrative filings last',()=>{
 const r=docRank;
 for(const title of ['Conditional Transfer Order (CTO-12)','PRETRIAL ORDER NO. 4','MEMORANDUM OPINION AND ORDER granting 55 Motion','Case Management Order No. 2','ORDER of Dismissal with prejudice relating to cases 19-cv-1','Report and Recommendation'])assert.equal(r(title),0,title);
 assert.equal(r('COMPLAINT against Monsanto Company. (Attachments: # 1 Exhibit)'),1);assert.equal(r('AMENDED COMPLAINT'),1);
 for(const title of ['MOTION for Summary Judgment filed by Monsanto','Response in Opposition re 33006 MOTION in Limine','Declaration of Dr. Smith','Notice of Filing Unredacted Exhibits attached to Plaintiffs Consolidated Reply Memorandum'])assert.equal(r(title),2,title);
 assert.equal(r('Notice of Filing Short Form Complaint, for member case 3:17cv7641, by SUZETTE'),3);assert.equal(r('Short Form Complaint - Charles Getty by PLAINTIFF(S)'),3);
 for(const title of ['ANSWER to Complaint with Jury Demand','STIPULATION of Voluntary Dismissal','Letter from Rule 11'])assert.equal(r(title),4,title);
 for(const title of ['NOTICE of Appearance by Jane Doe','Corporate Disclosure Statement by Monsanto','First MOTION to Appear Pro Hac Vice by Gary A. Anderson','CERTIFICATE OF SERVICE by Scott','ORDER granting 193 Motion to Appear Pro Hac Vice','TRANSCRIPT ORDER FOR proceedings','MOTION to Withdraw as Attorney'])assert.equal(r(title),5,title);
 assert.equal(r(undefined),4);
});

async function fixtureAudit(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prio-')),registry=path.join(dir,'case-registry.json'),csv=path.join(dir,'parent-matters.csv');
 await fs.writeFile(registry,JSON.stringify([
  {case_key:'njd-3:2016-md-02738',courtlistener_ids:['111'],roles:['master'],master_ids:[],mdl_number:null},
  {case_key:'paed-2:2012-md-02323',courtlistener_ids:['222'],roles:['master'],master_ids:[],mdl_number:null},
  {case_key:'cand-3:2005-md-01699',courtlistener_ids:['333'],roles:['master_candidate'],master_ids:[],mdl_number:null},
  {case_key:'paed-2:2026-cv-07521',courtlistener_ids:['444'],roles:['member'],master_ids:['paed-2:2025-md-03163'],mdl_number:3163},
  {case_key:'nysd-1:2020-cv-00001',courtlistener_ids:['555'],roles:[],master_ids:[],mdl_number:null}
 ]));
 await fs.writeFile(csv,'﻿Docket,Caption,MDL number\nnjd-3:2016-md-02738,Talc,2738\n"paed-2:2012-md-02323","NFL, concussion",2323\n');
 return{dir,registry,csv};
}

test('the priority map tiers master dockets, members with a registry MDL number and leaves everything else unranked',async()=>{
 const f=await fixtureAudit();const map=buildPriorityMap({registryFile:f.registry,parentMattersCsv:f.csv});
 assert.equal(map.by_courtlistener_id['111'].tier,1);assert.equal(map.by_courtlistener_id['222'].tier,2);assert.equal(map.by_courtlistener_id['333'].tier,3);
 assert.equal(map.by_courtlistener_id['444'].tier,1);assert.equal(map.by_courtlistener_id['444'].basis,'registry_mdl_number');
 assert.equal(map.by_courtlistener_id['555'].tier,4);assert.equal(map.sources.length,2);assert.match(map.ordering_only,/not an MDL-membership/);
 assert.deepEqual(parseCsv('a,b\n"x, y",2\n'),[{a:'x, y',b:'2'}]);
});

function row(n,{caseId='111',title='ORDER',date='2020-01-01'}={}){
 const url='https://storage.courtlistener.com/recap/gov.uscourts.test.'+caseId+'/gov.uscourts.test.'+caseId+'.'+n+'.0.pdf',record=sha(url+title);
 return{schema_version:'source-qualified-pdf-queue/1',provider:'courtlistener-public-locator',native_document_id:url,native_document_identity_kind:'publisher_observed_pdf_locator_url',native_case_id:caseId,durable_url:url,download_url:url,eligible:true,expected_bytes:null,expected_sha1:null,title,filing_date:date,
  selected_source_record_sha256:record,origins:[{native_record_sha256:record,retrieved_at:'2026-10-02T21:00:00.000Z',native_case_id:caseId}],
  provider_flags:{public_pdf_link_observed:true,sealing_related_locator_held:false,backend_api_id_verified:false,api_availability_verified:false}};
}

test('ordering: Tier 1-2 key documents first, then their bulk, then other matters; tier, rank, smaller matter, newest filing inside a phase',async()=>{
 const f=await fixtureAudit(),map=buildPriorityMap({registryFile:f.registry,parentMattersCsv:f.csv});
 const rows=[row(1,{caseId:'222',title:'ORDER'}),row(2,{caseId:'111',title:'Notice of Appearance'}),row(3,{caseId:'111',title:'ORDER',date:'2019-01-01'}),row(4,{caseId:'111',title:'ORDER',date:'2021-01-01'}),row(5,{caseId:'444',title:'ORDER'}),row(6,{caseId:'333',title:'ORDER'})];
 const order=orderRows(rows,map).map(i=>i.row.native_document_id.match(/\.(\d+)\.0\.pdf$/)[1]);
 // phase 0: tier1 rank0 (matter 444 with 1 row before matter 111, newest first), tier2 rank0; phase 1: tier1 rank5; phase 2: tier3.
 assert.deepEqual(order,['5','4','3','1','2','6']);
});

function run(args){return new Promise(resolve=>{const child=spawn(process.execPath,[freeze,...args],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('exit',code=>resolve({code,out,err}));});}
async function backlogFixture(){
 const f=await fixtureAudit(),from=path.join(f.dir,'old-run'),out=path.join(f.dir,'new-run'),batches=path.join(from,'courtlistener-pdf-batches');await fs.mkdir(batches,{recursive:true});
 const rows=[row(1,{caseId:'111',title:'ORDER'}),row(2,{caseId:'111',title:'Notice of Appearance'}),row(3,{caseId:'222',title:'ORDER'}),row(4,{caseId:'555',title:'ORDER'}),row(5,{caseId:'111',title:'MOTION to Dismiss'})];
 const write=async(name,subset)=>{const queue=path.join(batches,name+'.queue.jsonl'),bytes=Buffer.from(subset.map(r=>JSON.stringify(r)).join('\n')+'\n');await fs.writeFile(queue,bytes);await fs.writeFile(queue+'.manifest.json',JSON.stringify({queue,sha256:sha(bytes)}));};
 await write('001-reviewed',rows.slice(0,3));await write('002-reviewed',rows.slice(3));await write('003-old',[row(9,{caseId:'111'})]);
 await fs.writeFile(path.join(batches,'003-old.queue.jsonl.manifest.json.done.json'),JSON.stringify({state:'superseded_before_execution'}));
 // Row 1 already has a cloud-verified receipt for the same source version.
 const transfers=path.join(from,'courtlistener-batch-001-reviewed-transfers');await fs.mkdir(transfers,{recursive:true});
 await fs.writeFile(path.join(transfers,'transfer-receipts.jsonl'),[{state:'download_pending',...rows[0]},{state:'cloud_verified',provider:rows[0].provider,native_document_id:rows[0].native_document_id,selected_source_record_sha256:rows[0].selected_source_record_sha256,sha256:'a'.repeat(64)}].map(x=>JSON.stringify(x)).join('\n')+'\n');
 return{...f,from,out,transfers,rows,args:['--mode=backlog','--provider=courtlistener','--from-root='+from,'--out-root='+out,'--receipts='+transfers,'--registry='+f.registry,'--parent-matters='+f.csv,'--batch-size=2']};
}

test('backlog freeze excludes verified and superseded rows, orders by priority, hashes every queue and never rewrites',async()=>{
 const f=await backlogFixture(),dry=await run([...f.args,'--dry-run']);assert.equal(dry.code,0,dry.err);
 const preview=JSON.parse(dry.out);assert.equal(preview.excluded_already_verified,1);assert.equal(preview.to_freeze,4);assert.equal(preview.source_queues,2);
 const result=await run(f.args);assert.equal(result.code,0,result.err);
 const batches=path.join(f.out,'courtlistener-pdf-batches'),names=(await fs.readdir(batches)).filter(n=>n.endsWith('.queue.jsonl')).sort();
 assert.deepEqual(names,['p-0001.queue.jsonl','p-0002.queue.jsonl']);
 const first=JSON.parse(await fs.readFile(path.join(batches,'p-0001.queue.jsonl.manifest.json'),'utf8')),bytes=await fs.readFile(first.queue);
 assert.equal(first.sha256,sha(bytes));assert.equal(first.rows,2);assert.equal(first.courtlistener_api_requests,0);assert.equal(first.public_projection_allowed,false);assert.equal(first.priority.ordering_only,true);
 const order=[];for(const n of names)for(const line of (await fs.readFile(path.join(batches,n),'utf8')).trim().split('\n'))order.push(JSON.parse(line).native_document_id.match(/\.(\d+)\.0\.pdf$/)[1]);
 // ORDER 1 is excluded as verified. Phase 0: tier-1 MOTION (5), tier-2 ORDER (3); phase 1: tier-1 Notice of Appearance (2); phase 2: unmapped (4).
 assert.deepEqual(order,['5','3','2','4']);
 const again=await run(f.args);assert.equal(again.code,0,again.err);assert.equal(JSON.parse(again.out).to_freeze,0,'a repeated run finds nothing new');
 assert.equal((await fs.readdir(batches)).filter(n=>n.endsWith('.queue.jsonl')).length,2);
});

test('a source queue that no longer matches its manifest hash is refused',async()=>{
 const f=await backlogFixture();const queue=path.join(f.from,'courtlistener-pdf-batches','002-reviewed.queue.jsonl');await fs.appendFile(queue,'{}\n');
 const result=await run(f.args);assert.notEqual(result.code,0);assert.match(result.err,/SOURCE_QUEUE_HASH_MISMATCH/);
});

test('queue additions: valid rows are frozen (urgent tiers ahead of the backlog), invalid or incomplete drops are not',async()=>{
 const f=await backlogFixture(),drops=path.join(f.dir,'additions');await fs.mkdir(drops,{recursive:true});
 const bad={...row(20,{caseId:'111'}),download_url:'https://evil.example/x.pdf'};
 await fs.writeFile(path.join(drops,'mdl-members-1.jsonl'),[row(10,{caseId:'111',title:'ORDER'}),row(11,{caseId:'555',title:'ORDER'}),bad].map(r=>JSON.stringify(r)).join('\n')+'\n');
 await fs.writeFile(path.join(drops,'partial.jsonl'),JSON.stringify(row(30,{caseId:'111'}))); // no trailing newline: still being written
 const args=['--mode=additions','--provider=courtlistener','--additions-dir='+drops,'--out-root='+f.out,'--receipts='+f.transfers,'--registry='+f.registry,'--parent-matters='+f.csv];
 const result=await run(args);assert.equal(result.code,0,result.err);
 const batches=path.join(f.out,'courtlistener-pdf-batches'),names=(await fs.readdir(batches)).filter(n=>n.endsWith('.queue.jsonl')).sort();
 assert.deepEqual(names,['a-0001.queue.jsonl','z-0001.queue.jsonl']);
 const ledger=(await fs.readFile(path.join(f.out,'additions-ledger.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(ledger.length,1);assert.equal(ledger[0].rejected_rows,1);
 const again=await run(args);assert.equal(JSON.parse(again.out).to_freeze,0,'an already frozen drop is ledgered and not queued twice');
});

test('additions watcher: an empty pass is a no-op, and a complete drop that arrives later is frozen on the next pass',async()=>{
 const f=await backlogFixture(),drops=path.join(f.dir,'additions-watch');await fs.mkdir(drops,{recursive:true});
 // Seed the priority map in the destination root first (watcher passes reuse it).
 const seed=await run(['--mode=backlog','--provider=courtlistener','--from-root='+f.from,'--out-root='+f.out,'--receipts='+f.transfers,'--registry='+f.registry,'--parent-matters='+f.csv,'--dry-run']);assert.equal(seed.code,0,seed.err);
 await fs.mkdir(f.out,{recursive:true});
 const mapOnly=await run(['--mode=backlog','--provider=courtlistener','--from-root='+f.from,'--out-root='+f.out,'--receipts='+f.transfers,'--registry='+f.registry,'--parent-matters='+f.csv,'--prefix=m','--batch-size=100']);assert.equal(mapOnly.code,0,mapOnly.err);
 const child=spawn(process.execPath,[freeze,'--watch','--max-passes=3','--interval-ms=400','--provider=courtlistener','--additions-dir='+drops,'--out-root='+f.out,'--receipts='+f.transfers],{stdio:['ignore','pipe','pipe']});
 let err='';child.stderr.on('data',d=>err+=d);
 await new Promise(r=>setTimeout(r,150));
 await fs.writeFile(path.join(drops,'late.jsonl'),JSON.stringify(row(40,{caseId:'111',title:'ORDER'}))+'\n');
 const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,0,err);
 const batches=path.join(f.out,'courtlistener-pdf-batches'),names=(await fs.readdir(batches)).filter(n=>/^a-\d{4}\.queue\.jsonl$/.test(n));
 assert.equal(names.length,1);
 const ledger=(await fs.readFile(path.join(f.out,'additions-ledger.jsonl'),'utf8')).trim().split('\n');assert.equal(ledger.length,1);
});

test('rows flagged by the matter registry as priority evidence are urgent even for an unmapped matter; --ignore-ledger re-reads a ledgered drop without duplicating live rows',async()=>{
 const f=await backlogFixture(),drops=path.join(f.dir,'additions-flag');await fs.mkdir(drops,{recursive:true});
 const flagged={...row(50,{caseId:'555',title:'Conditional Transfer Order'}),scope_evidence:[{kind:'sw_matter_registry_priority',filter:'cto'}]};
 await fs.writeFile(path.join(drops,'flag.jsonl'),[flagged,row(51,{caseId:'555',title:'Conditional Transfer Order'})].map(r=>JSON.stringify(r)).join('\n')+'\n');
 const args=['--mode=additions','--provider=courtlistener','--additions-dir='+drops,'--out-root='+f.out,'--receipts='+f.transfers,'--registry='+f.registry,'--parent-matters='+f.csv];
 const first=await run(args);assert.equal(first.code,0,first.err);
 const batches=path.join(f.out,'courtlistener-pdf-batches'),count=async n=>(await fs.readFile(path.join(batches,n),'utf8')).trim().split('\n').length;
 assert.equal(await count('a-0001.queue.jsonl'),1);assert.equal(await count('z-0001.queue.jsonl'),1);
 const again=await run([...args,'--ignore-ledger']);assert.equal(again.code,0,again.err);
 assert.equal(JSON.parse(again.out).to_freeze,0,'live queued rows are not frozen twice');
 // Supersede the never-run z queue: its row is fresh again and is re-frozen (with --ignore-ledger) under the same rule.
 await fs.writeFile(path.join(batches,'z-0001.queue.jsonl.manifest.json.done.json'),JSON.stringify({state:'superseded_before_execution'}));
 const third=await run([...args,'--ignore-ledger']);assert.equal(JSON.parse(third.out).to_freeze,1);
});
