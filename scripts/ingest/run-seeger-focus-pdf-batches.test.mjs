import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {disposition,pendingManifests,RESTART_COOLDOWN_MS} from './run-seeger-focus-pdf-batches.mjs';

const runner=path.join(path.dirname(fileURLToPath(import.meta.url)),'run-seeger-focus-pdf-batches.mjs');

test('stop reasons: outages and rate limits resume after a cool-down; integrity and access problems halt for a person',()=>{
 assert.deepEqual(disposition({progress:{complete:true,stop_reason:null,processed:5}}),{action:'done'});
 for(const reason of Object.keys(RESTART_COOLDOWN_MS)){
  const next=disposition({progress:{complete:false,stop_reason:reason},exitCode:1});
  assert.equal(next.action,'restart');assert.equal(next.cooldownMs,RESTART_COOLDOWN_MS[reason]);
 }
 for(const reason of ['CLOUD_HASH_MISMATCH','SOURCE_ACCESS_DENIED_REPEATED','CLOUD_UPLOAD_HTTP_403','CLOUD_OBJECT_NOT_FOUND'])assert.equal(disposition({progress:{complete:false,stop_reason:reason},exitCode:1}).action,'halt',reason);
 // A crash without a progress file is retried, but not forever.
 assert.deepEqual(disposition({progress:null,exitCode:1,idleRestarts:1}),{action:'restart',reason:'WORKER_EXIT_1',cooldownMs:60000});
 assert.equal(disposition({progress:null,exitCode:1,idleRestarts:4}).action,'halt');
 // A complete batch that still carries a stop reason is not done.
 assert.equal(disposition({progress:{complete:true,stop_reason:'CLOUD_HASH_MISMATCH'},exitCode:1}).action,'halt');
});

const fakeTransfer=`
import fs from 'node:fs';import path from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return[v.slice(2,i),v.slice(i+1)];}));
fs.mkdirSync(args.cache,{recursive:true});
const counter=path.join(args.cache,'attempts.txt');const n=(fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0)+1;fs.writeFileSync(counter,String(n));
const plan=JSON.parse(fs.readFileSync(path.join(path.dirname(args.queue),'plan.json'),'utf8'))[path.basename(args.queue)]??[{complete:true,processed:2,cloud_verified:2}];
const step=plan[Math.min(n-1,plan.length-1)];
if(step.crash){process.exit(1);}
fs.appendFileSync(path.join(args.cache,'transfer-receipts.jsonl'),JSON.stringify({state:'cloud_verified',attempt:n})+'\\n');
fs.writeFileSync(path.join(args.cache,'progress.json'),JSON.stringify({complete:false,stop_reason:null,failed:0,...step}));
process.exit(step.complete&&!step.stop_reason?0:1);
`;
const fakeRegistration=`
import fs from 'node:fs';import path from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i<0?[v.slice(2),true]:[v.slice(2,i),v.slice(i+1)];}));
fs.mkdirSync(args.out,{recursive:true});fs.appendFileSync(path.join(args.out,'launches.txt'),(args.watch?'watch':'oneshot')+'\\n');
const receipts=()=>{try{return fs.readFileSync(path.join(args.transfers,'transfer-receipts.jsonl'),'utf8').split('\\n').filter(Boolean).length;}catch{return 0;}};
while(args['stop-file']&&!fs.existsSync(args['stop-file']))await new Promise(r=>setTimeout(r,20));
fs.writeFileSync(path.join(args.out,'completion.json'),JSON.stringify({registered_receipts:receipts()}));
`;
async function fixture(plan){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'runner-')),dir=path.join(root,'courtlistener-pdf-batches');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(root,'fake-transfer.mjs'),fakeTransfer);await fs.writeFile(path.join(root,'fake-registration.mjs'),fakeRegistration);
 for(const name of Object.keys(plan)){
  const queue=path.join(dir,name);await fs.writeFile(queue,'{}\n');await fs.writeFile(queue+'.manifest.json',JSON.stringify({queue,sha256:'0'.repeat(64)}));
 }
 await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(plan));return{root,dir};
}
function run(root,extra=[]){
 return new Promise(resolve=>{
  const child=spawn(process.execPath,[runner,'--root='+root,'--provider=courtlistener','--credentials=unused','--exit-when-idle','--cooldown-scale=0.0005','--poll-ms=20','--transfer-script='+path.join(root,'fake-transfer.mjs'),'--registration-script='+path.join(root,'fake-registration.mjs'),...extra],{stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('exit',code=>resolve({code,out,err}));
 });
}
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));

test('a transfer that stops on a cloud outage is resumed after the cool-down, its registration is flushed, and the next batch still runs',async()=>{
 const {root,dir}=await fixture({
  'p1-0001.queue.jsonl':[{complete:false,stop_reason:'CLOUD_STORAGE_UNAVAILABLE',processed:3,cloud_verified:3},{complete:true,processed:2,cloud_verified:2}],
  'p1-0002.queue.jsonl':[{complete:true,processed:4,cloud_verified:4}]
 });
 const result=await run(root);
 assert.equal(result.code,0,result.err);
 const first=await readJson(path.join(dir,'p1-0001.queue.jsonl.manifest.json.done.json')),second=await readJson(path.join(dir,'p1-0002.queue.jsonl.manifest.json.done.json'));
 assert.equal(first.attempts,2);assert.equal(first.progress.cloud_verified,2);assert.equal(second.attempts,1);
 assert.equal(first.registration_completion.registered_receipts,2,'registration saw the receipts of the resumed attempt');
 const transfer=path.join(root,'courtlistener-batch-p1-0001-transfers');
 assert.ok((await fs.readdir(transfer)).includes('progress.attempt-001.json'),'the stopped attempt snapshot is retained as evidence');
 const registrationLaunches=(await fs.readFile(path.join(root,'courtlistener-batch-p1-0001-registration','launches.txt'),'utf8')).trim().split('\n');
 assert.deepEqual(registrationLaunches,['watch','watch']);
 assert.equal((await readJson(path.join(root,'courtlistener-batch-progress.json'))).state,'complete');
 assert.match(result.err,/cooling_down/);
});

test('an integrity stop halts the runner, keeps the receipts and does not start later batches',async()=>{
 const {root,dir}=await fixture({
  'p1-0001.queue.jsonl':[{complete:false,stop_reason:'CLOUD_HASH_MISMATCH',processed:1,cloud_verified:0}],
  'p1-0002.queue.jsonl':[{complete:true,processed:4,cloud_verified:4}]
 });
 const result=await run(root);
 assert.equal(result.code,1);
 const halted=await readJson(path.join(dir,'p1-0001.queue.jsonl.manifest.json.halted.json'));
 assert.equal(halted.reason,'CLOUD_HASH_MISMATCH');
 await assert.rejects(fs.access(path.join(dir,'p1-0002.queue.jsonl.manifest.json.done.json')));
 assert.equal((await readJson(path.join(root,'courtlistener-batch-progress.json'))).state,'halted');
 assert.deepEqual(pendingManifests(dir),['p1-0002.queue.jsonl.manifest.json']);
});

test('a worker that keeps crashing before it writes progress is retried a bounded number of times, then halts',async()=>{
 const {root,dir}=await fixture({'p1-0001.queue.jsonl':[{crash:true}]});
 const result=await run(root,['--max-idle-restarts=3']);
 assert.equal(result.code,1);
 const halted=await readJson(path.join(dir,'p1-0001.queue.jsonl.manifest.json.halted.json'));
 assert.equal(halted.reason,'NO_PROGRESS_AFTER_RESTARTS');assert.equal(halted.attempts,3);
});
