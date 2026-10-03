import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return[v.slice(2,i),v.slice(i+1)];}));
const root=path.resolve(args.root),base=path.resolve(args.base),batchDir=path.join(root,'courtlistener-pdf-batches');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ledger=path.join(root,'acquisition-supervisor.jsonl');
const log=row=>fs.appendFileSync(ledger,JSON.stringify({...row,at:new Date().toISOString()})+'\n');
function launch(script,values,label){return new Promise((resolve,reject)=>{
 const fd=fs.openSync(path.join(root,label+'.log'),'a');
 const child=spawn(process.execPath,['--use-system-ca',script,...values],{windowsHide:true,stdio:['ignore',fd,fd]});
 child.once('error',e=>{fs.closeSync(fd);reject(e);});child.once('exit',code=>{fs.closeSync(fd);resolve(code);});
});}
const readLines=file=>fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
function coverage(){const records=readLines(path.join(root,'courtlistener-page-receipts.jsonl'));const done=new Set(records.filter(r=>r.state==='page_registered').map(r=>r.source_url));
 const failures=new Map(records.filter(r=>r.state==='page_failed'&&!done.has(r.source_url)).map(r=>[r.source_url,r]));return{registered_pages:done.size,unresolved_failures:[...failures.values()]};}
let serial=1,lastFrozen=0,retries=0;
for(;;){
 const progress=JSON.parse(fs.readFileSync(path.join(root,'courtlistener-page-progress.json')));
 if(progress.stop_reason){log({state:'scanner_stopped',progress});throw Error('Scanner stopped: '+progress.stop_reason);}
 if(progress.registered_pages-lastFrozen>=200||progress.complete){
  while(fs.existsSync(path.join(batchDir,`auto-${String(serial).padStart(4,'0')}.queue.jsonl`)))serial++;
  const out=path.join(batchDir,`auto-${String(serial++).padStart(4,'0')}.queue.jsonl`);
  const code=await launch('scripts/ingest/freeze-seeger-focus-pdf-queue.mjs',['--base='+base,'--root='+root,'--out='+out],'freeze-courtlistener-batches');
  if(code!==0)throw Error('Queue freeze failed');lastFrozen=progress.registered_pages;log({state:'queue_snapshot_frozen',registered_pages:lastFrozen,out});
 }
 if(progress.complete){
  const report=coverage();
  if(report.unresolved_failures.length&&retries<2){
   retries++;log({state:'retrying_failed_pages',attempt:retries,unresolved:report.unresolved_failures.length});
   const code=await launch('scripts/ingest/scrape-seeger-focus-courtlistener.mjs',[
    '--root='+root,'--seeds='+path.join(base,'courtlistener/live-normalized/firm-search-hits.jsonl'),
    '--credentials='+args.credentials,'--firecrawl-credentials='+args['firecrawl-credentials'],'--python='+args.python,'--max-pages=10000','--concurrency=4'
   ],'retry-courtlistener-pages-'+retries);
   if(code!==0)throw Error('Docket page retry worker failed');continue;
  }
  const meta=await launch('scripts/ingest/preserve-seeger-focus-docketbird.mjs',['--root='+root,'--credentials='+args.credentials],'preserve-final-docketbird-metadata');
  if(meta!==0)throw Error('Final DocketBird metadata preservation failed');
  const manifest={schema_version:'seeger-weiss-acquisition-finished/1',finished_at:new Date().toISOString(),
   ...report,source_page_acquisition_finished:true,pdf_transfers_still_require_completion:true,
   courtlistener_api_requests:0,source_scope:'1,810 cached firm-indexed CourtListener dockets and complete dated DocketBird exact-phrase searches',public_projection_allowed:false};
  fs.writeFileSync(path.join(root,'acquisition-finished.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});log({state:'acquisition_finished',registered_pages:report.registered_pages,gaps:report.unresolved_failures.length});break;
 }
 await pause(15000);
}
