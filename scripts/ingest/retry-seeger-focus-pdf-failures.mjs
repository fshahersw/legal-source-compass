import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
// Retries recorded PDF failures twice. 2026-10-03: also reads failures from earlier runs (--sources-file), skips answers the
// source gave permanently (HTTP 404/403/410, not a PDF, checksum conflicts: those stay held and are reported, not hammered),
// can run on demand (--no-wait), and a stopped retry attempt no longer aborts the remaining providers.
const pause=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>createHash('sha256').update(b).digest('hex');
// Same permanent set as backfill-pdfs-to-supabase.mjs classifyFailure(); duplicated so older receipts without `retryable` classify identically.
const PERMANENT=/^(?:SOURCE_HTTP_(?:400|401|402|403|404|405|406|409|410|451)|NOT_A_PDF|SOURCE_SHA1_MISMATCH|SOURCE_SIZE_MISMATCH|PDF_SIZE_LIMIT|PDF_HOST_NOT_ALLOWED|PDF_URL_INVALID|PDF_REDIRECT_LIMIT|PDF_REDIRECT_MISSING|CLOUD_HASH_MISMATCH)$/;
export const isPermanentFailure=receipt=>receipt.retryable===false||(receipt.retryable===undefined&&PERMANENT.test(receipt.error??''));
export function lines(file){if(!fs.existsSync(file))return[];const text=fs.readFileSync(file,'utf8');return text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(JSON.parse);}
// Latest outcome per document across receipts (several transfer directories may be merged): verified always wins;
// otherwise the most recently recorded failure with its classification.
export function outcomes(receiptLines,into=new Map()){
 for(const r of receiptLines){
  const key=r.provider+'|'+r.native_document_id,current=into.get(key);
  if(r.state==='cloud_verified'||r.state==='dedup_matched')into.set(key,{verified:true});
  else if(r.state==='failed'&&!current?.verified&&(!current||String(r.recorded_at??'')>=String(current.at??'')))into.set(key,{verified:false,error:r.error,permanent:isPermanentFailure(r),at:r.recorded_at});
 }
 return into;
}
function launch(script,values,log){return new Promise((resolve,reject)=>{
 const fd=fs.openSync(log,'a');const child=spawn(process.execPath,['--use-system-ca',script,...values],{windowsHide:true,stdio:['ignore',fd,fd]});
 child.once('error',e=>{fs.closeSync(fd);reject(e);});child.once('exit',code=>{fs.closeSync(fd);resolve(code);});
});}
async function main(args){
 const root=path.resolve(args.root),out=path.join(root,'final-retries');fs.mkdirSync(out,{recursive:true});
 const runId=args['run-id']??'r1',marker=args.marker??'pdf-retries-finished.json',attempts=Number(args.attempts??2);
 const providers=(args.providers??'docketbird,courtlistener-public-locator,courtlistener,official-court').split(',');
 const transferDirs=()=>[...fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.endsWith('-transfers')).map(d=>path.join(root,d.name)),...extra.map(e=>e.transfers)];
 const extra=args['sources-file']?JSON.parse(fs.readFileSync(args['sources-file'],'utf8')).map(e=>({transfers:path.resolve(e.transfers),queue:e.queue?path.resolve(e.queue):null})):[];
 if(!args['no-wait'])for(;;){
  const states=['docketbird','courtlistener'].map(provider=>{try{return JSON.parse(fs.readFileSync(path.join(root,provider+'-batch-progress.json')));}catch{return{};}});
  if(fs.existsSync(path.join(root,'acquisition-finished.json'))&&states.every(s=>s.state==='complete'))break;
  fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({state:'waiting_for_primary_downloads',checked_at:new Date().toISOString()},null,2));
  await pause(30000);
 }
 const status=()=>{const map=new Map();for(const dir of transferDirs())outcomes(lines(path.join(dir,'transfer-receipts.jsonl')),map);return map;};
 // Candidate rows: every queued row whose latest recorded outcome is a failure. Queue rows come from the batch manifests of this
 // run (done, halted or still pending) and from any --sources-file pair.
 const candidates=new Map(),pairs=[];
 for(const provider of ['docketbird','courtlistener']){
  const dir=path.join(root,provider+'-pdf-batches');if(!fs.existsSync(dir))continue;
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.queue.jsonl.manifest.json'))){
   const manifest=JSON.parse(fs.readFileSync(path.join(dir,name))),doneFile=path.join(dir,name+'.done.json');
   if(fs.existsSync(doneFile)&&JSON.parse(fs.readFileSync(doneFile)).state?.startsWith('superseded'))continue;
   const label=path.basename(manifest.queue).replace('.queue.jsonl','');
   pairs.push({queue:manifest.queue,transfers:path.join(root,provider+'-batch-'+label+'-transfers')});
  }
 }
 pairs.push(...extra.filter(e=>e.queue)); // entries without a queue only contribute their verified receipts
 for(const pair of pairs){
  const failed=new Set([...outcomes(lines(path.join(pair.transfers,'transfer-receipts.jsonl')))].filter(([,v])=>!v.verified).map(([k])=>k));
  if(!failed.size)continue;
  for(const row of lines(pair.queue)){const key=row.provider+'|'+row.native_document_id;if(failed.has(key))candidates.set(key,row);}
 }
 for(let attempt=1;attempt<=attempts;attempt++)for(const provider of providers){
  const known=status(),rows=[...candidates.values()].filter(r=>{const k=r.provider+'|'+r.native_document_id,o=known.get(k);return r.provider===provider&&!o?.verified&&!o?.permanent;});
  if(!rows.length)continue;
  const label=runId+'-'+provider+'-'+attempt,queue=path.join(out,label+'.queue.jsonl'),bytes=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  if(fs.existsSync(queue)&&sha(fs.readFileSync(queue))!==sha(bytes))throw Error('Retry queue changed; retained prior evidence');
  if(!fs.existsSync(queue))fs.writeFileSync(queue,bytes,{flag:'wx'});
  const transfers=path.join(root,'final-retry-'+label+'-transfers');
  fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({state:'retrying',provider,attempt,documents:rows.length,started_at:new Date().toISOString()},null,2));
  const slow=provider!=='docketbird';
  const code=await launch('scripts/ingest/backfill-pdfs-to-supabase.mjs',['--queue='+queue,'--queue-sha256='+sha(bytes),'--cache='+transfers,'--credentials='+args.credentials,'--max-files=200000','--concurrency=3','--source-delay-ms='+(slow?'400':'250'),'--worker-delay-ms='+(slow?'1500':'0'),'--pacing-file='+path.join(root,(slow?'courtlistener':'docketbird')+'-pacing.json'),'--execute'],path.join(out,label+'.log'));
  // A stopped attempt keeps its receipts; registration still runs for everything that verified, and later attempts/providers continue.
  const registration=await launch('scripts/admin/register-private-pdf-assets.mjs',['--transfers='+transfers,'--out='+path.join(out,label+'-registration'),'--credentials='+args.credentials],path.join(out,label+'-registration.log'));
  fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({state:'attempt_finished',provider,attempt,transfer_exit_code:code,registration_exit_code:registration,finished_at:new Date().toISOString()},null,2));
 }
 const final=status(),unresolved=[...candidates.values()].filter(r=>!final.get(r.provider+'|'+r.native_document_id)?.verified).map(r=>{const o=final.get(r.provider+'|'+r.native_document_id);return{provider:r.provider,native_case_id:r.native_case_id,native_document_id:r.native_document_id,source_record_sha256:r.selected_source_record_sha256,last_error:o?.error??null,permanent:o?.permanent===true};});
 const result={state:'finished_with_recorded_gaps',run_id:runId,finished_at:new Date().toISOString(),candidates:candidates.size,resolved:candidates.size-unresolved.length,unresolved_pdf_attempts:unresolved,
  permanent_source_answers_remain_held:unresolved.filter(u=>u.permanent).length,
  known_native_integrity_gaps_file:path.join(root,'courtlistener-native-integrity-gaps.json'),source_page_gaps_file:path.join(root,'acquisition-finished.json'),
  restricted_or_unavailable_entries_remain_held:true,courtlistener_api_requests:0,independent_final_database_count_required:true};
 fs.writeFileSync(path.join(root,marker),JSON.stringify(result,null,2)+'\n');
 fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({finished:true,candidates:candidates.size,unresolved:unresolved.length,permanent:result.permanent_source_answers_remain_held}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i<0?[v.slice(2),true]:[v.slice(2,i),v.slice(i+1)];}));
 await main(args);
}
