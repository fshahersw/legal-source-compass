import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return[v.slice(2,i),v.slice(i+1)];}));
const root=path.resolve(args.root),out=path.join(root,'final-retries');fs.mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>createHash('sha256').update(b).digest('hex');
function lines(file){if(!fs.existsSync(file))return[];const text=fs.readFileSync(file,'utf8');return text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(JSON.parse);}
function transferDirs(){return fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.endsWith('-transfers')).map(d=>path.join(root,d.name));}
function verified(){const ids=new Set();for(const dir of transferDirs())for(const row of lines(path.join(dir,'transfer-receipts.jsonl')))if(row.state==='cloud_verified')ids.add(row.provider+'|'+row.native_document_id);return ids;}
function launch(script,values,label){return new Promise((resolve,reject)=>{
 const fd=fs.openSync(path.join(out,label+'.log'),'a');const child=spawn(process.execPath,['--use-system-ca',script,...values],{windowsHide:true,stdio:['ignore',fd,fd]});
 child.once('error',e=>{fs.closeSync(fd);reject(e);});child.once('exit',code=>{fs.closeSync(fd);resolve(code);});
});}
for(;;){
 const states=['docketbird','courtlistener'].map(provider=>{try{return JSON.parse(fs.readFileSync(path.join(root,provider+'-batch-progress.json')));}catch{return{};}});
 if(fs.existsSync(path.join(root,'acquisition-finished.json'))&&states.every(s=>s.state==='complete'))break;
 fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({state:'waiting_for_primary_downloads',checked_at:new Date().toISOString()},null,2));
 await pause(30000);
}
const candidates=new Map();
for(const provider of ['docketbird','courtlistener']){
 const dir=path.join(root,provider+'-pdf-batches');
 for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.queue.jsonl.manifest.json'))){
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,name)));
  const done=JSON.parse(fs.readFileSync(path.join(dir,name+'.done.json')));
  if(done.state==='superseded_before_execution')continue;
  const label=path.basename(manifest.queue).replace('.queue.jsonl',''),transfer=path.join(root,provider+'-batch-'+label+'-transfers');
  const failures=new Set(lines(path.join(transfer,'transfer-receipts.jsonl')).filter(r=>r.state==='failed').map(r=>r.provider+'|'+r.native_document_id));
  for(const row of lines(manifest.queue))if(failures.has(row.provider+'|'+row.native_document_id))candidates.set(row.provider+'|'+row.native_document_id,row);
 }
}
for(let attempt=1;attempt<=2;attempt++)for(const provider of ['docketbird','courtlistener-public-locator']){
 const done=verified(),rows=[...candidates.values()].filter(r=>r.provider===provider&&!done.has(r.provider+'|'+r.native_document_id));
 if(!rows.length)continue;
 const label=provider+'-'+attempt,queue=path.join(out,label+'.queue.jsonl'),bytes=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 if(fs.existsSync(queue)&&sha(fs.readFileSync(queue))!==sha(bytes))throw Error('Retry queue changed; retained prior evidence');
 if(!fs.existsSync(queue))fs.writeFileSync(queue,bytes,{flag:'wx'});
 const transfers=path.join(root,'final-retry-'+label+'-transfers');
 fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({state:'retrying',provider,attempt,documents:rows.length,started_at:new Date().toISOString()},null,2));
 const code=await launch('scripts/ingest/backfill-pdfs-to-supabase.mjs',['--queue='+queue,'--queue-sha256='+sha(bytes),'--cache='+transfers,'--credentials='+args.credentials,'--max-files=200000','--concurrency=3','--source-delay-ms='+(provider==='docketbird'?'250':'1500'),'--execute'],label);
 if(code!==0)throw Error('Retry worker stopped; inspect '+transfers);
 const registration=await launch('scripts/admin/register-private-pdf-assets.mjs',['--transfers='+transfers,'--out='+path.join(out,label+'-registration'),'--credentials='+args.credentials],label+'-registration');
 if(registration!==0)throw Error('Retry registration failed');
}
const done=verified(),unresolved=[...candidates.values()].filter(r=>!done.has(r.provider+'|'+r.native_document_id)).map(r=>({provider:r.provider,native_case_id:r.native_case_id,native_document_id:r.native_document_id,source_record_sha256:r.selected_source_record_sha256}));
const result={state:'finished_with_recorded_gaps',finished_at:new Date().toISOString(),unresolved_pdf_attempts:unresolved,
 known_native_integrity_gaps_file:path.join(root,'courtlistener-native-integrity-gaps.json'),source_page_gaps_file:path.join(root,'acquisition-finished.json'),
 restricted_or_unavailable_entries_remain_held:true,courtlistener_api_requests:0,independent_final_database_count_required:true};
fs.writeFileSync(path.join(root,'pdf-retries-finished.json'),JSON.stringify(result,null,2)+'\n');
fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({finished:true,unresolved:unresolved.length}));
