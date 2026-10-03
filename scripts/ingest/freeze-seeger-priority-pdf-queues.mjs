import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateQueueRow} from './backfill-pdfs-to-supabase.mjs';
import {buildPriorityMap,orderRows,summarize} from './seeger-pdf-priority.mjs';
// Freezes NEW priority-ordered queues + sha256 manifests from (a) the unexecuted/partly executed backlog of an earlier run or
// (b) locator rows dropped by other agents. Source queues and manifests are never edited; rows already verified or already
// frozen elsewhere are excluded; every output is created with flag 'wx'. No network access, no CourtListener API requests.
const sha=b=>createHash('sha256').update(b).digest('hex');
export const versionOf=row=>row.selected_source_record_sha256??[...(row.origins??[])].sort((a,b)=>b.retrieved_at.localeCompare(a.retrieved_at))[0]?.native_record_sha256;
export const rowKey=row=>row.provider+'|'+row.native_document_id+'|'+versionOf(row);
async function* jsonlLines(file){
 const rl=readline.createInterface({input:fs.createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity});
 for await(const line of rl)if(line)yield line;
}
// Receipts of every transfer directory: rows that already have a cloud-verified receipt for the same source version.
export async function verifiedKeys(transferDirs){
 const keys=new Set();
 for(const dir of transferDirs){
  const file=path.join(dir,'transfer-receipts.jsonl');if(!fs.existsSync(file))continue;
  for await(const line of jsonlLines(file)){
   if(!line.includes('"state":"cloud_verified"'))continue;
   let r;try{r=JSON.parse(line);}catch{continue;}
   if(r.state!=='cloud_verified'||!/^[a-f0-9]{64}$/.test(r.sha256??''))continue;
   const version=r.selected_source_record_sha256??[...(r.source_origins??[])].sort((a,b)=>b.retrieved_at.localeCompare(a.retrieved_at))[0]?.native_record_sha256;
   keys.add(r.provider+'|'+r.native_document_id+'|'+version);
  }
 }
 return keys;
}
// Keys already frozen into queues of the destination root (so a repeated run never queues a row twice).
export async function queuedKeys(root){
 const keys=new Set();
 for(const provider of ['courtlistener','docketbird']){
  const dir=path.join(root,provider+'-pdf-batches');if(!fs.existsSync(dir))continue;
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.queue.jsonl'))){
   // A queue superseded before it ran no longer holds its rows.
   const done=path.join(dir,name+'.manifest.json.done.json');
   if(fs.existsSync(done)&&JSON.parse(fs.readFileSync(done)).state==='superseded_before_execution')continue;
   for await(const line of jsonlLines(path.join(dir,name)))keys.add(rowKey(JSON.parse(line)));
  }
 }
 return keys;
}
export function nextSequence(dir,prefix){
 const used=fs.existsSync(dir)?fs.readdirSync(dir).map(n=>new RegExp('^'+prefix+'-(\\d{4})\\.queue\\.jsonl$').exec(n)?.[1]).filter(Boolean).map(Number):[];
 return used.length?Math.max(...used)+1:1;
}
export function chunk(items,size){const out=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;}
export function writeQueue({dir,label,lines,meta}){
 fs.mkdirSync(dir,{recursive:true});
 const queue=path.join(dir,label+'.queue.jsonl'),bytes=Buffer.from(lines.join('\n')+'\n');
 fs.writeFileSync(queue,bytes,{flag:'wx'});
 const manifest={queue,sha256:sha(bytes),created_at:new Date().toISOString(),rows:lines.length,new_pdf_locators:lines.length,label,...meta,courtlistener_api_requests:0,public_projection_allowed:false};
 fs.writeFileSync(queue+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return manifest;
}
async function readSourceRows(files){
 const rows=[],rejected=[];
 for(const file of files){
  for await(const line of jsonlLines(file)){
   let row;try{row=JSON.parse(line);}catch{rejected.push({file,reason:'INVALID_JSON'});continue;}
   if(!row.eligible)continue;
   try{validateQueueRow(row);}catch(e){rejected.push({file,native_document_id:String(row.native_document_id).slice(-120),reason:e.message});continue;}
   rows.push({line,row});
  }
 }
 return{rows,rejected};
}
async function main(args){
 const mode=args.mode??'backlog',provider=args.provider??'courtlistener',outRoot=path.resolve(args['out-root']);
 const batchSize=Number(args['batch-size']??4000),dry=!!args['dry-run'];
 if(!['backlog','additions'].includes(mode)||!['courtlistener','docketbird'].includes(provider)||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>20000)throw Error('INVALID_FREEZE_ARGUMENTS');
 const mapFile=args['priority-map']?path.resolve(args['priority-map']):path.join(outRoot,'priority-map.json');
 let map;
 if(fs.existsSync(mapFile))map=JSON.parse(fs.readFileSync(mapFile,'utf8'));
 else{
  if(!args['registry']||!args['parent-matters'])throw Error('PRIORITY_MAP_OR_INPUTS_REQUIRED');
  map=buildPriorityMap({registryFile:path.resolve(args.registry),parentMattersCsv:path.resolve(args['parent-matters'])});
  fs.mkdirSync(path.dirname(mapFile),{recursive:true});fs.writeFileSync(mapFile,JSON.stringify(map)+'\n',{flag:'wx'});
 }
 let sources=[],sourceInfo=[];
 if(mode==='backlog'){
  const fromRoot=path.resolve(args['from-root']),dir=path.join(fromRoot,provider+'-pdf-batches');
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.queue.jsonl.manifest.json')).sort()){
   const done=path.join(dir,name+'.done.json');
   if(fs.existsSync(done)&&!JSON.parse(fs.readFileSync(done)).state?.startsWith('superseded_after'))continue; // finished or superseded before execution
   const manifest=JSON.parse(fs.readFileSync(path.join(dir,name))),queue=manifest.queue.split('\\').join('/');
   if(sha(fs.readFileSync(queue))!==manifest.sha256)throw Error('SOURCE_QUEUE_HASH_MISMATCH');
   sources.push(queue);sourceInfo.push({queue:manifest.queue,sha256:manifest.sha256});
  }
 }else{
  const addDir=path.resolve(args['additions-dir']),ledgerFile=path.join(outRoot,'additions-ledger.jsonl');
  const seen=new Set(fs.existsSync(ledgerFile)?fs.readFileSync(ledgerFile,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l).sha256):[]);
  for(const name of fs.existsSync(addDir)?fs.readdirSync(addDir).filter(n=>n.endsWith('.jsonl')).sort():[]){
   const file=path.join(addDir,name),bytes=fs.readFileSync(file);
   if(!bytes.length||seen.has(sha(bytes)))continue;
   // A drop that is still being written is not frozen: only complete lines count, and an empty tail is ignored.
   if(bytes[bytes.length-1]!==10)continue;
   sources.push(file);sourceInfo.push({queue:file,sha256:sha(bytes)});
  }
 }
 const {rows,rejected}=await readSourceRows(sources);
 const providerOf=r=>r.provider==='docketbird'?'docketbird':'courtlistener';
 const transferDirs=(args.receipts?String(args.receipts).split('|'):[]).map(d=>path.resolve(d));
 for(const root of [outRoot])if(fs.existsSync(root))for(const d of fs.readdirSync(root,{withFileTypes:true}))if(d.isDirectory()&&d.name.endsWith('-transfers'))transferDirs.push(path.join(root,d.name));
 const verified=await verifiedKeys(transferDirs),queued=await queuedKeys(outRoot);
 const seenKeys=new Set(),fresh=[];let excludedVerified=0,excludedQueued=0,excludedDuplicate=0,excludedOtherProvider=0;
 for(const item of rows){
  if(mode==='backlog'&&providerOf(item.row)!==provider){excludedOtherProvider++;continue;}
  const key=rowKey(item.row);
  if(verified.has(key)){excludedVerified++;continue;}
  if(queued.has(key)){excludedQueued++;continue;}
  if(seenKeys.has(key)){excludedDuplicate++;continue;}
  seenKeys.add(key);fresh.push(item);
 }
 const ordered=orderRows(fresh.map(x=>x.row),map);
 const lineOf=new Map(fresh.map(x=>[x.row,x.line]));
 const summary={mode,provider,source_queues:sourceInfo.length,source_rows:rows.length,rejected_rows:rejected.length,excluded_already_verified:excludedVerified,excluded_already_frozen:excludedQueued,excluded_duplicate:excludedDuplicate,excluded_other_provider:excludedOtherProvider,to_freeze:ordered.length,...summarize(ordered)};
 if(dry||!ordered.length){console.log(JSON.stringify({dry_run:dry,...summary,matters:summary.matters.slice(0,40)},null,1));return;}
 const manifests=[],mapSha=sha(fs.readFileSync(mapFile));
 // Additions are split by provider family; tier 1-2 additions sort ahead of the backlog (a-), the rest after it (z-).
 const groups=new Map();
 for(const info of ordered){
  const family=mode==='additions'?providerOf(info.row):provider,urgent=info.matter.tier<=2;
  const prefix=mode==='additions'?(urgent?'a':'z'):(args.prefix??'p'),k=family+'|'+prefix;
  if(!groups.has(k))groups.set(k,[]);groups.get(k).push(info);
 }
 for(const [k,infos] of groups){
  const [family,prefix]=k.split('|'),dir=path.join(outRoot,family+'-pdf-batches');
  let seq=nextSequence(dir,prefix);
  for(const part of chunk(infos,batchSize)){
   const label=prefix+'-'+String(seq++).padStart(4,'0'),sum=summarize(part);
   manifests.push(writeQueue({dir,label,lines:part.map(i=>lineOf.get(i.row)),meta:{mode,source_queues:sourceInfo,priority_map:{file:mapFile,sha256:mapSha},priority:{ordering_only:true,tier_counts:sum.tier_counts,rank_counts:sum.rank_counts,matters:sum.matters.slice(0,25)},
    excluded:{already_verified:excludedVerified,already_frozen:excludedQueued,duplicate:excludedDuplicate,rejected:rejected.length}}}));
  }
 }
 if(mode==='additions'){
  const ledger=path.join(outRoot,'additions-ledger.jsonl');
  for(const s of sourceInfo)fs.appendFileSync(ledger,JSON.stringify({at:new Date().toISOString(),file:s.queue,sha256:s.sha256,frozen_into:manifests.map(m=>m.label),rejected_rows:rejected.length})+'\n');
  if(rejected.length)fs.writeFileSync(path.join(outRoot,'additions-rejected-'+Date.now()+'.json'),JSON.stringify(rejected,null,2)+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify({...summary,matters:undefined,queues:manifests.map(m=>({label:m.label,rows:m.rows,sha256:m.sha256}))},null,1));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i<0?[v.slice(2),true]:[v.slice(2,i),v.slice(i+1)];}));
 await main(args);
}
