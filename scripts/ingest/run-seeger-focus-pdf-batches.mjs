import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
// Supervisor for frozen PDF batches: <root>/<provider>-pdf-batches/*.queue.jsonl(.manifest.json), processed in name order.
// 2026-10-03: a stopped or crashed transfer no longer kills the supervisor (the Oct 2 runner threw "PDF worker failed" on a
// single Supabase HTTP 520 and took its registration child with it). The batch resumes from its durable receipts after a
// cool-down; only integrity/access problems halt, because those need a person.
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// stop_reason written by backfill-pdfs-to-supabase.mjs -> cool-down before the batch is resumed from its receipts
export const RESTART_COOLDOWN_MS={PROVIDER_RATE_LIMIT_REPEATED:30*60e3,SOURCE_UNAVAILABLE:10*60e3,CLOUD_STORAGE_UNAVAILABLE:10*60e3,LOCAL_DISK_RESERVE:5*60e3,DEDUP_INDEX_UNAVAILABLE:5*60e3};
export function disposition({progress,exitCode,idleRestarts=0,maxIdleRestarts=4}){
 if(progress?.complete===true&&!progress.stop_reason)return{action:'done'};
 const reason=progress?.stop_reason??null;
 if(reason&&!(reason in RESTART_COOLDOWN_MS))return{action:'halt',reason}; // CLOUD_HASH_MISMATCH, SOURCE_ACCESS_DENIED_REPEATED, repeated cloud rejections ...
 if(idleRestarts>=maxIdleRestarts)return{action:'halt',reason:'NO_PROGRESS_AFTER_RESTARTS',last_reason:reason??('WORKER_EXIT_'+exitCode)};
 return{action:'restart',reason:reason??('WORKER_EXIT_'+exitCode),cooldownMs:reason?RESTART_COOLDOWN_MS[reason]:60e3};
}
export function pendingManifests(dir){
 return fs.readdirSync(dir).filter(n=>n.endsWith('.queue.jsonl.manifest.json')).sort().filter(name=>!fs.existsSync(path.join(dir,name+'.done.json'))&&!fs.existsSync(path.join(dir,name+'.halted.json')));
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function launch(script,values,log){
 const fd=fs.openSync(log,'a');
 const child=spawn(process.execPath,['--use-system-ca',script,...values],{windowsHide:true,stdio:['ignore',fd,fd]});
 const done=new Promise((resolve,reject)=>{child.once('error',e=>{fs.closeSync(fd);reject(e);});child.once('exit',(code,signal)=>{fs.closeSync(fd);resolve(code??(signal?128:1));});});
 return{child,done};
}
async function main(args){
 const root=path.resolve(args.root),provider=args.provider;
 if(!['courtlistener','docketbird'].includes(provider))throw Error('Unknown batch provider');
 const dir=path.join(root,provider+'-pdf-batches'),finish=path.join(root,'acquisition-finished.json'),status=path.join(root,provider+'-batch-progress.json');
 fs.mkdirSync(dir,{recursive:true});
 const transferScript=args['transfer-script']??'scripts/ingest/backfill-pdfs-to-supabase.mjs',registrationScript=args['registration-script']??'scripts/admin/register-private-pdf-assets.mjs';
 const scale=Number(args['cooldown-scale']??1),pollMs=Number(args['poll-ms']??10000),maxIdleRestarts=Number(args['max-idle-restarts']??4);
 const concurrency=args.concurrency??(provider==='docketbird'?'6':'4'),sourceDelay=args['source-delay-ms']??(provider==='docketbird'?'150':'1000'),workerDelay=args['worker-delay-ms']??(provider==='docketbird'?'0':'1000');
 const writeStatus=value=>fs.writeFileSync(status,JSON.stringify({provider,pid:process.pid,...value,at:new Date().toISOString()},null,2));
 let batches=0,halted=null;
 if(args['wait-for-progress'])for(;;){
  const prior=JSON.parse(fs.readFileSync(args['wait-for-progress']));
  if(prior.complete)break;
  if(prior.stop_reason)throw Error('Prior provider transfer stopped: '+prior.stop_reason);
  writeStatus({state:'waiting_for_existing_provider_queue',wait_for:args['wait-for-progress']});
  await pause(15000);
 }
 for(;;){
  const pending=pendingManifests(dir);
  if(!pending.length){
   if(args['exit-when-idle']||fs.existsSync(finish))break;
   writeStatus({state:'idle_waiting_for_batches',batches_completed:batches});await pause(pollMs);continue;
  }
  const manifestFile=path.join(dir,pending[0]),manifest=JSON.parse(fs.readFileSync(manifestFile));
  const label=path.basename(manifest.queue).replace('.queue.jsonl',''),transfer=path.join(root,provider+'-batch-'+label+'-transfers'),registration=path.join(root,provider+'-batch-'+label+'-registration');
  fs.mkdirSync(transfer,{recursive:true});fs.mkdirSync(registration,{recursive:true});
  const stopFile=path.join(registration,'transfer-exited.json'),progressFile=path.join(transfer,'progress.json');
  let attempt=0,idleRestarts=0,outcome=null;
  for(;;){
   attempt++;
   fs.rmSync(stopFile,{force:true});
   if(fs.existsSync(progressFile))fs.renameSync(progressFile,path.join(transfer,'progress.attempt-'+String(attempt-1).padStart(3,'0')+'.json'));
   writeStatus({state:'transferring',queue:manifest.queue,transfers:transfer,batch:label,attempt,batches_completed:batches});
   const transferRun=launch(transferScript,[
    '--queue='+manifest.queue,'--queue-sha256='+manifest.sha256,'--cache='+transfer,'--credentials='+args.credentials,
    '--max-files=200000','--concurrency='+concurrency,'--source-delay-ms='+sourceDelay,'--worker-delay-ms='+workerDelay,'--pacing-file='+path.join(root,provider+'-pacing.json'),'--execute'
   ],path.join(dir,label+'.transfer.log'));
   const registrationRun=launch(registrationScript,[
    '--transfers='+transfer,'--out='+registration,'--credentials='+args.credentials,'--watch','--stop-file='+stopFile
   ],path.join(dir,label+'.registration.log'));
   const exitCode=await transferRun.done.catch(()=>1);
   // The registration watcher is told the transfer has exited, flushes every durable receipt and ends on its own.
   fs.writeFileSync(stopFile,JSON.stringify({exited_at:new Date().toISOString(),exit_code:exitCode}));
   let registrationCode=await registrationRun.done.catch(()=>1);
   for(let flush=0;![0,2].includes(registrationCode)&&flush<3;flush++){
    // Registration is idempotent; a crashed watcher is replaced by a one-shot pass over the same receipts.
    await pause(30000*scale);
    registrationCode=await launch(registrationScript,['--transfers='+transfer,'--out='+registration,'--credentials='+args.credentials],path.join(dir,label+'.registration.log')).done.catch(()=>1);
   }
   const progress=readJson(progressFile);
   if(progress?.processed>0)idleRestarts=0;else idleRestarts++;
   const next=disposition({progress,exitCode,idleRestarts,maxIdleRestarts});
   if(next.action==='done'){
    const completion=readJson(path.join(registration,'completion.json'));
    fs.writeFileSync(manifestFile+'.done.json',JSON.stringify({completed_at:new Date().toISOString(),attempts:attempt,progress,registration,registration_exit_code:registrationCode,registration_completion:completion},null,2));
    batches++;console.log(JSON.stringify({provider,batch:label,batches_completed:batches,verified:progress.cloud_verified,failed:progress.failed,attempts:attempt,registration_exit_code:registrationCode}));
    outcome='done';break;
   }
   if(next.action==='halt'){
    fs.writeFileSync(manifestFile+'.halted.json',JSON.stringify({halted_at:new Date().toISOString(),attempts:attempt,reason:next.reason,last_reason:next.last_reason??null,progress,preserved_receipts:transfer,registration_exit_code:registrationCode},null,2));
    writeStatus({state:'halted',batch:label,reason:next.reason,transfers:transfer,batches_completed:batches});
    console.error(JSON.stringify({provider,batch:label,state:'halted',reason:next.reason}));halted=next.reason;outcome='halted';break;
   }
   writeStatus({state:'cooling_down',batch:label,attempt,reason:next.reason,resume_after:new Date(Date.now()+next.cooldownMs*scale).toISOString(),transfers:transfer,batches_completed:batches});
   console.error(JSON.stringify({provider,batch:label,state:'cooling_down',reason:next.reason,attempt,cooldown_ms:next.cooldownMs*scale}));
   await pause(next.cooldownMs*scale);
  }
  if(outcome==='halted')break;
 }
 writeStatus({state:halted?'halted':'complete',batches_completed:batches,reason:halted,finished_at:new Date().toISOString()});
 if(halted)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i<0?[v.slice(2),true]:[v.slice(2,i),v.slice(i+1)];}));
 await main(args);
}
