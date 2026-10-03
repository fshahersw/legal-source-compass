import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateQueueRow} from './backfill-pdfs-to-supabase.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return[v.slice(2,i),v.slice(i+1)];}));
const base=path.resolve(args.base),root=path.resolve(args.root),out=path.resolve(args.out);
const sha=b=>createHash('sha256').update(b).digest('hex');
function lines(file){if(!fs.existsSync(file))return[];const raw=fs.readFileSync(file,'utf8');return raw.slice(0,raw.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(JSON.parse);}
const known=new Set(),queued=new Set(),restricted=new Set();
// Every prior native-API queue URL is covered by the existing resumed worker.
for(const row of lines(path.join(base,'pdf-library-v1/courtlistener-queue-v1.jsonl'))){if(row.eligible)known.add(row.native_case_id+'|'+row.download_url);if(row.provider_flags?.is_sealed===true&&row.download_url)restricted.add(row.native_case_id+'|'+row.download_url);}
for(const folder of fs.readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()&&/^pdf-library/.test(d.name)))
 for(const file of fs.readdirSync(path.join(base,folder.name)).filter(n=>/queue.*\.jsonl$/.test(n)))
  for(const row of lines(path.join(base,folder.name,file)))if(row.eligible&&row.provider==='courtlistener-public-locator')known.add(row.native_case_id+'|'+row.download_url);
const batches=path.join(root,'courtlistener-pdf-batches');fs.mkdirSync(batches,{recursive:true});
for(const file of fs.readdirSync(batches).filter(f=>f.endsWith('.queue.jsonl')))for(const row of lines(path.join(batches,file)))queued.add(row.native_case_id+'|'+row.download_url);
const records=lines(path.join(root,'courtlistener-page-receipts.jsonl')).filter(r=>r.state==='page_registered');
const candidates=new Map();let covered=0,held=0;
for(const record of records){const data=JSON.parse(fs.readFileSync(record.parsed_file));for(const row of data.pdf_queue){
 const key=row.native_case_id+'|'+row.download_url;if(restricted.has(key)){held++;continue;}if(known.has(key)||queued.has(key)){covered++;continue;}
 if(!candidates.has(key))candidates.set(key,validateQueueRow(row));
}}
const values=[...candidates.values()];if(!values.length){console.log(JSON.stringify({new_pdf_locators:0,covered_occurrences:covered}));process.exit(0);}
const bytes=Buffer.from(values.map(x=>JSON.stringify(x)).join('\n')+'\n');fs.writeFileSync(out,bytes,{flag:'wx'});
const manifest={queue:out,sha256:sha(bytes),created_at:new Date().toISOString(),new_pdf_locators:values.length,
 pages_considered:records.length,covered_occurrences:covered,known_sealed_occurrences_held:held,source:'Observed CourtListener HTML links',courtlistener_api_requests:0,public_projection_allowed:false};
fs.writeFileSync(out+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(manifest));
