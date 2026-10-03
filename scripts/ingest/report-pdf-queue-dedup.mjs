import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {pathToFileURL} from 'node:url';
import {loadDedupIndex} from './pdf-dedup.mjs';
import {verifiedKeys,versionOf} from './freeze-seeger-priority-pdf-queues.mjs';
// Read-only report: for every pending queue of a run root, how many rows are already done, can be registered from stored bytes without a
// source request (and on which basis), or need a real download. No source requests; the only network call is the index RPC (CLI mode).
export async function reportQueueDedup({root,index,provider='courtlistener',verified}){
 const dir=path.join(root,provider+'-pdf-batches'),total={rows:0,already_done:0,dedup_provider_sha1:0,dedup_exact_url:0,download:0,conflicts:0},reasons={},conflicts={},perQueue=[];
 for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.queue.jsonl.manifest.json')).sort()){
  if(fs.existsSync(path.join(dir,name+'.done.json'))||fs.existsSync(path.join(dir,name+'.halted.json')))continue;
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,name))),s={queue:name.replace('.queue.jsonl.manifest.json',''),rows:0,already_done:0,dedup_provider_sha1:0,dedup_exact_url:0,download:0,conflicts:0};
  const rl=readline.createInterface({input:fs.createReadStream(manifest.queue.split('\\').join('/'),{encoding:'utf8'}),crlfDelay:Infinity});
  for await(const line of rl){
   if(!line)continue;const row=JSON.parse(line);s.rows++;
   if(verified.has(row.provider+'|'+row.native_document_id+'|'+versionOf(row))){s.already_done++;continue;}
   const plan=index.classify(row);
   if(plan.action==='dedup')s[plan.basis==='provider_sha1_equals_stored_sha1'?'dedup_provider_sha1':'dedup_exact_url']++;
   else{s.download++;reasons[plan.reason]=(reasons[plan.reason]??0)+1;}
   if(plan.conflict){s.conflicts++;conflicts[plan.conflict.kind]=(conflicts[plan.conflict.kind]??0)+1;}
  }
  perQueue.push(s);for(const k of Object.keys(total))total[k]+=s[k];
 }
 const dedup=total.dedup_provider_sha1+total.dedup_exact_url,pending=dedup+total.download;
 return{total:{...total,pending_rows:pending,dedupable_rows:dedup,dedupable_share:pending?+(dedup/pending).toFixed(4):0},download_reasons:reasons,conflicts,per_queue:perQueue};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i<0?[v.slice(2),true]:[v.slice(2,i),v.slice(i+1)];}));
 const root=path.resolve(String(args.root)),cfg=JSON.parse(fs.readFileSync(String(args.credentials),'utf8'));
 if(cfg.EXTERNAL_SUPABASE_URL!=='https://xosqzzsnhxcyehcnirpa.supabase.co')throw Error('WRONG_PROJECT');
 const token=cfg.EXTERNAL_SUPABASE_KEY,headers={apikey:token,...(!token.startsWith('sb_')?{Authorization:'Bearer '+token}:{})};
 const index=await loadDedupIndex({baseUrl:cfg.EXTERNAL_SUPABASE_URL,headers});
 const verified=await verifiedKeys(fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.endsWith('-transfers')).map(d=>path.join(root,d.name)));
 console.log(JSON.stringify({index:index.stats(),...await reportQueueDedup({root,index,provider:String(args.provider??'courtlistener'),verified})},null,1));
}
