import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {sha256} from '../legal/private-original-storage.mjs';
import {focusStorage} from './seeger-focus-storage.mjs';
import {validateQueueRow} from './backfill-pdfs-to-supabase.mjs';
const run = promisify(execFile), pause = ms => new Promise(r => setTimeout(r,ms));
export function docketUrl(url, id) {
 const u = new URL(url);
 if (u.origin !== 'https://www.courtlistener.com' || u.username || u.password || u.port ||
   !new RegExp(`^/docket/${id}/[^/]+/$`).test(u.pathname) || u.hash ||
   [...u.searchParams.keys()].some(k => k !== 'page') || u.searchParams.getAll('page').length > 1 ||
   (u.searchParams.has('page') && !/^[1-9][0-9]*$/.test(u.searchParams.get('page')))) throw Error('Unqualified docket URL');
 if (u.searchParams.get('page') === '1') u.search = '';
 return u.href;
}
async function main() {
 const args = Object.fromEntries(process.argv.slice(2).map(v => {const i=v.indexOf('=');return [v.slice(2,i),v.slice(i+1)];}));
 const root = path.resolve(args.root), pagesDir = path.join(root,'courtlistener-pages'); fs.mkdirSync(pagesDir,{recursive:true});
 const logFile = path.join(root,'courtlistener-page-receipts.jsonl');
 const log = row => fs.appendFileSync(logFile,JSON.stringify({...row,recorded_at:new Date().toISOString()})+'\n');
 const seedBytes = fs.readFileSync(args.seeds), seedHash = sha256(seedBytes);
 const seeds = seedBytes.toString().trim().split('\n').map(JSON.parse).filter(r => r.data.firm?.some(x => /\bSeeger Weiss\b/i.test(x)));
 seeds.sort((a,b) => Number(/-(?:md|ml)-/i.test(b.data.docketNumber))-Number(/-(?:md|ml)-/i.test(a.data.docketNumber)) || (b.data.dateFiled??'').localeCompare(a.data.dateFiled??''));
 const pending = [], seen = new Set(), finished = new Set(), origins = new Map();
 for (const seed of seeds) {
  const id=String(seed.data.docket_id), url=docketUrl('https://www.courtlistener.com'+seed.data.docket_absolute_url,id);
  const evidence = {kind:'cached_exact_firm_index_match',firm:'Seeger Weiss LLP',native_case_id:id,
   source_firm_labels:seed.data.firm.filter(x=>/\bSeeger Weiss\b/i.test(x)),seed_file:args.seeds,seed_file_sha256:seedHash,seed_record_sha256:seed.provenance.record_sha256,
   original_retrieved_at:seed.provenance.retrieved_at,firm_appearance_certified:false};
  origins.set(id,evidence); if(!seen.has(url)){seen.add(url);pending.push({url,id});}
 }
 let prior=[]; if(fs.existsSync(logFile)) prior=fs.readFileSync(logFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 for(const row of prior) if(row.state==='page_registered') finished.add(row.source_url);
 const key = JSON.parse(fs.readFileSync(args['firecrawl-credentials'],'utf8')).FIRECRAWL_API_KEY;
 if(typeof key!=='string'||!key) throw Error('Firecrawl key absent');
 const preserve = await focusStorage(args.credentials,log);
 let active=0, completed=0, errors=0, rows=0, pdfs=0, credits=0, stop=null;
 const maxPages=Number(args['max-pages']??10000), concurrency=Number(args.concurrency??6);
 const progress = () => fs.writeFileSync(path.join(root,'courtlistener-page-progress.json'),JSON.stringify({
  at:new Date().toISOString(),seed_dockets:origins.size,discovered_page_urls:seen.size,registered_pages:finished.size,
  completed_this_run:completed,pending:pending.length,active,errors,visible_rows:rows,pdf_occurrences:pdfs,
  reported_credits_used:credits,courtlistener_api_requests:0,stop_reason:stop,complete:pending.length===0&&active===0},null,2));
 async function handle(item) {
  const capturePath=path.join(pagesDir,sha256(item.url)+'.json'), parsedPath=path.join(pagesDir,sha256(item.url)+'.parsed.json');
  if(fs.existsSync(capturePath)) {
   const old=JSON.parse(fs.readFileSync(capturePath));
   if(old.result?.data?.metadata?.statusCode!==200) fs.renameSync(capturePath,capturePath+'.failed-'+sha256(fs.readFileSync(capturePath)));
  }
  if(!fs.existsSync(capturePath)) {
   let response, payload;
   for(let attempt=0;attempt<3;attempt++) {
    const started=new Date().toISOString();
    response=await fetch('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
     body:JSON.stringify({url:item.url,formats:['rawHtml','links'],onlyMainContent:false,maxAge:0,proxy:'basic',parsers:[],timeout:45000}),
     signal:AbortSignal.timeout(90000),redirect:'error'});
    payload=await response.json();
    if([429,500,502,503,504].includes(response.status)&&attempt<2){const delay=Math.max(5000*2**attempt,Number(response.headers.get('retry-after')??0)*1000);if(delay>60000)throw Error('Firecrawl cooldown');await pause(delay);continue;}
    if(!response.ok||payload.success!==true) throw Error('Firecrawl HTTP '+response.status);
    fs.writeFileSync(capturePath,JSON.stringify({schema_version:'courtlistener-firecrawl-focus-capture/1',requested_url:item.url,
      native_case_id:item.id,requested_at:started,retrieved_at:new Date().toISOString(),result:payload}),{flag:'wx'});
    break;
   }
  }
  await run(args.python,[path.resolve('scripts/ingest/parse-seeger-focus-docket.py'),capturePath,parsedPath],{windowsHide:true,maxBuffer:1024*1024});
  const data=JSON.parse(fs.readFileSync(parsedPath));
  const queue=data.pdf_queue.map(row=>validateQueueRow({...row,scope_evidence:[origins.get(item.id)]}));
  const receipt=await preserve(capturePath,parsedPath,{source_system:'courtlistener-firecrawl-html',source_url:item.url,native_case_id:item.id,
   retrieved_at:data.provenance.retrieved_at,provenance:{firm_scope_evidence:origins.get(item.id)}});
  log({...receipt,state:'page_registered',capture_file:capturePath,parsed_file:parsedPath,visible_rows:data.rows.length,
    pdfs:queue.length,held:data.held_pdf_locators.length,pagination:data.pagination,credits_used:data.credits_used});
  if(queue.length) fs.appendFileSync(path.join(root,'courtlistener-observed-pdf-candidates.jsonl'),queue.map(x=>JSON.stringify(x)).join('\n')+'\n');
  finished.add(item.url); completed++;rows+=data.rows.length;pdfs+=queue.length;credits+=Number(data.credits_used??0);
  for(const candidate of data.pagination) {const url=docketUrl(candidate,item.id);if(!seen.has(url)){seen.add(url);pending.unshift({url,id:item.id});}}
  if(completed%10===0) console.log(JSON.stringify({completed,registered:finished.size,pending:pending.length,rows,pdfs,errors}));
 }
 // Reconstruct observed pagination when restarting; never construct unobserved page numbers.
 for(const row of prior.filter(r=>r.state==='page_registered')) for(const candidate of row.pagination??[]) {
  const id=String(row.native_case_id);if(!origins.has(id))continue;const url=docketUrl(candidate,id);if(!seen.has(url)){seen.add(url);pending.unshift({url,id});}
 }
 async function worker() {
  while(pending.length&&!stop) {
   if(completed+active>=maxPages){stop='PAGE_LIMIT';break;}
   const item=pending.shift();if(finished.has(item.url))continue;active++;progress();
   try{await handle(item);}catch(e){errors++;const message=String(e.message).split('\n')[0].slice(0,180);log({state:'page_failed',source_url:item.url,native_case_id:item.id,error:message});
    if(/HTTP (?:401|402|403)|registry|Private original|cooldown/i.test(message))stop=message;
   }finally{active--;progress();}
  }
 }
 await Promise.all(Array.from({length:concurrency},worker));progress();console.log(JSON.stringify({finished:true,completed,registered:finished.size,errors,stop}));
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href) main().catch(e=>{console.error(String(e.message).slice(0,250));process.exitCode=1;});
