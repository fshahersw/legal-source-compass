import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateQueueRow} from './backfill-pdfs-to-supabase.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return[v.slice(2,i),v.slice(i+1)];}));
const base=path.resolve(args.base),root=path.resolve(args.root),out=path.resolve(args.out),sha=b=>createHash('sha256').update(b).digest('hex');
function lines(file){if(!fs.existsSync(file))return[];const b=fs.readFileSync(file,'utf8');return b.slice(0,b.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(JSON.parse);}
const done=new Set(),queued=new Set(),restricted=new Set(lines(path.join(base,'pdf-library-v1/docketbird-queue-v2.jsonl')).filter(r=>r.provider_flags?.restricted===true).map(r=>r.native_document_id));
for(const dir of fs.readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()&&/^pdf-/.test(d.name)))
 for(const child of fs.readdirSync(path.join(base,dir.name),{withFileTypes:true}).filter(d=>d.isDirectory()))
  for(const row of lines(path.join(base,dir.name,child.name,'transfer-receipts.jsonl')))if(row.provider==='docketbird'&&row.state==='cloud_verified')done.add(row.native_document_id);
const batches=path.join(root,'docketbird-pdf-batches');fs.mkdirSync(batches,{recursive:true});
for(const file of fs.readdirSync(batches).filter(n=>n.endsWith('.queue.jsonl')))for(const row of lines(path.join(batches,file)))queued.add(row.native_document_id);
const records=new Map(),held=[],captures=[];
for(const name of fs.readdirSync(path.join(root,'docketbird')).filter(n=>/^search-(?:year-|recent-|global-).*\.json$/.test(n))){
 const file=path.join(root,'docketbird',name),bytes=fs.readFileSync(file),capture=JSON.parse(bytes);
 const hash=sha(bytes);captures.push({file,sha256:hash});
 for(const doc of capture.result.documents??[]){
  if(done.has(doc.document_id)||queued.has(doc.document_id)||!doc.pdf_url)continue;
  if(restricted.has(doc.document_id)){held.push({id:doc.document_id,case:doc.case_id,reason:'Explicit publisher restriction in existing metadata'});continue;}
  if(/\b(?:seal|sealed|sealing|restricted)\b/i.test(doc.document_title??'')){held.push({id:doc.document_id,case:doc.case_id,reason:'Sealing-related title'});continue;}
  const recordHash=sha(JSON.stringify(doc));
  const origin={capture_file:file,capture_file_sha256:hash,source_response_sha256:sha(JSON.stringify(capture.result)),
   source_tool:'search_documents',retrieved_at:capture.retrieved_at,native_case_id:doc.case_id,native_record_sha256:recordHash};
  const row={schema_version:'source-qualified-pdf-queue/1',provider:'docketbird',native_document_id:doc.document_id,native_case_id:doc.case_id,
   durable_url:doc.canonical_url??null,download_url:doc.pdf_url,expected_sha1:null,expected_bytes:null,title:doc.document_title??null,filing_date:doc.date_filed??null,
   selected_source_record_sha256:recordHash,eligible:true,provider_flags:{restricted:null,downloaded:null,availability_evidence:'publisher_search_pdf_locator',search_pdf_url_observed:true,sealing_related_locator_held:false},
   origins:[origin],scope_evidence:[{kind:'publisher_full_text_firm_mention',query:capture.arguments.q,source_record_sha256:recordHash,firm_appearance_certified:false}]};
  try{validateQueueRow(row);}catch(e){held.push({id:doc.document_id,case:doc.case_id,reason:e.message});continue;}
  if(!records.has(doc.document_id))records.set(doc.document_id,row);
 }
}
const values=[...records.values()];if(!values.length){console.log(JSON.stringify({queued:0,held:held.length,already_verified:done.size}));process.exit(0);}
const bytes=Buffer.from(values.map(x=>JSON.stringify(x)).join('\n')+'\n');fs.writeFileSync(out,bytes,{flag:'wx'});
const manifest={queue:out,sha256:sha(bytes),created_at:new Date().toISOString(),queued:values.length,held,already_verified:done.size,
 source_captures:captures,restriction_status:'unknown; private quarantine',courtlistener_api_requests:0,public_projection_allowed:false};
fs.writeFileSync(out+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...manifest,held:held.length,source_captures:captures.length}));
