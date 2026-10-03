import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return[v.slice(2,i),v.slice(i+1)];}));
const root=path.resolve(args.root),provider=args.provider;
if(!['courtlistener','docketbird'].includes(provider))throw Error('Unknown batch provider');
const dir=path.join(root,provider+'-pdf-batches'),finish=path.join(root,'acquisition-finished.json');
fs.mkdirSync(dir,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const status=path.join(root,provider+'-batch-progress.json');let batches=0;
function launch(script,values,log){return new Promise((resolve,reject)=>{
 const fd=fs.openSync(log,'a');const child=spawn(process.execPath,['--use-system-ca',script,...values],{windowsHide:true,stdio:['ignore',fd,fd]});
 child.once('error',e=>{fs.closeSync(fd);reject(e);});child.once('exit',code=>{fs.closeSync(fd);resolve(code);});
});}
if(args['wait-for-progress'])for(;;){
 const prior=JSON.parse(fs.readFileSync(args['wait-for-progress']));
 if(prior.complete)break;
 if(prior.stop_reason)throw Error('Prior provider transfer stopped: '+prior.stop_reason);
 fs.writeFileSync(status,JSON.stringify({state:'waiting_for_existing_provider_queue',wait_for:args['wait-for-progress'],at:new Date().toISOString()},null,2));
 await pause(15000);
}
for(;;){
 const pending=fs.readdirSync(dir).filter(n=>n.endsWith('.queue.jsonl.manifest.json')).sort().filter(name=>!fs.existsSync(path.join(dir,name+'.done.json')));
 if(!pending.length){if(fs.existsSync(finish))break;await pause(10000);continue;}
 const manifestFile=path.join(dir,pending[0]),manifest=JSON.parse(fs.readFileSync(manifestFile));
 const label=path.basename(manifest.queue).replace('.queue.jsonl',''),transfer=path.join(root,provider+'-batch-'+label+'-transfers'),registration=path.join(root,provider+'-batch-'+label+'-registration');
 fs.writeFileSync(status,JSON.stringify({state:'transferring',queue:manifest.queue,transfers:transfer,batches_completed:batches,at:new Date().toISOString()},null,2));
 const transferPromise=launch('scripts/ingest/backfill-pdfs-to-supabase.mjs',[
  '--queue='+manifest.queue,'--queue-sha256='+manifest.sha256,'--cache='+transfer,'--credentials='+args.credentials,
  '--max-files=200000','--concurrency='+(provider==='docketbird'?'6':'4'),'--source-delay-ms='+(provider==='docketbird'?'150':'1000'),'--execute'
 ],path.join(dir,label+'.transfer.log'));
 const registrationPromise=launch('scripts/admin/register-private-pdf-assets.mjs',[
  '--transfers='+transfer,'--out='+registration,'--credentials='+args.credentials,'--watch'
 ],path.join(dir,label+'.registration.log'));
 const code=await transferPromise;
 if(code!==0)throw Error('PDF worker failed; preserved receipts at '+transfer);
 const progress=JSON.parse(fs.readFileSync(path.join(transfer,'progress.json')));
 if(!progress.complete||progress.stop_reason)throw Error('PDF worker incomplete: '+String(progress.stop_reason));
 const registrationCode=await registrationPromise;if(registrationCode!==0)throw Error('PDF registration failed');
 fs.writeFileSync(manifestFile+'.done.json',JSON.stringify({completed_at:new Date().toISOString(),progress,registration},null,2));
 batches++;console.log(JSON.stringify({provider,batches_completed:batches,verified:progress.cloud_verified,failed:progress.failed}));
}
fs.writeFileSync(status,JSON.stringify({state:'complete',batches_completed:batches,finished_at:new Date().toISOString()},null,2));
