import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateQueueRow} from './backfill-pdfs-to-supabase.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return[v.slice(2,i),v.slice(i+1)];}));
const base=path.resolve(args.base),root=path.resolve(args.root),out=path.resolve(args.out),sha=b=>createHash('sha256').update(b).digest('hex');
function lines(file){if(!fs.existsSync(file))return[];const text=fs.readFileSync(file,'utf8');return text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(JSON.parse);}
const graphFile=path.join(root,'docketbird/firm-mdl-graph.json'),graphBytes=fs.readFileSync(graphFile),graph=JSON.parse(graphBytes);
const scope=new Map(graph.result.records.filter(r=>r['lawfirm.law_firm_id']==='seegerweiss.com'&&/-md-/.test(r['case.case_id'])).map(r=>[r['case.case_id'],r]));
const covered=new Set();
for(const dir of fs.readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()&&/^pdf-/.test(d.name)))
 for(const child of fs.readdirSync(path.join(base,dir.name),{withFileTypes:true}).filter(d=>d.isDirectory()))
  for(const row of lines(path.join(base,dir.name,child.name,'transfer-receipts.jsonl')))if(row.provider==='docketbird'&&row.state==='cloud_verified')covered.add(row.native_document_id);
for(const name of fs.readdirSync(path.join(root,'docketbird-pdf-batches')).filter(n=>n.endsWith('.queue.jsonl')))
 for(const row of lines(path.join(root,'docketbird-pdf-batches',name)))covered.add(row.native_document_id);
const queue=new Map(),held=[],counts=[];
for(const name of fs.readdirSync(path.join(root,'docketbird')).filter(n=>/^mdl-refresh-sheet-.*\.json$/.test(n))){
 const file=path.join(root,'docketbird',name),bytes=fs.readFileSync(file),capture=JSON.parse(bytes),id=capture.arguments.case_id;
 if(!scope.has(id))throw Error('Native firm/case relationship required');
 counts.push({native_case_id:id,returned_documents:capture.result.documents.length,full_docket_not_assumed:true});
 for(const doc of capture.result.documents){
  if(covered.has(doc.id))continue;
  if(doc.restricted!==false||![1,true].includes(doc.downloaded)||!doc.pdf_url){held.push({native_case_id:id,native_document_id:doc.id,restricted:doc.restricted,downloaded:doc.downloaded,reason:'Publisher PDF unavailable or restricted'});continue;}
  const recordHash=sha(JSON.stringify(doc));
  const row={schema_version:'source-qualified-pdf-queue/1',provider:'docketbird',native_document_id:doc.id,native_case_id:id,
   durable_url:doc.canonical_url??null,download_url:doc.pdf_url,expected_sha1:null,expected_bytes:null,title:doc.title??null,filing_date:doc.filing_date??null,
   selected_source_record_sha256:recordHash,eligible:true,provider_flags:{restricted:doc.restricted,downloaded:doc.downloaded},
   origins:[{capture_file:file,capture_file_sha256:sha(bytes),source_response_sha256:sha(JSON.stringify(capture.result)),retrieved_at:capture.retrieved_at,native_case_id:id,native_record_sha256:recordHash}],
   scope_evidence:[{kind:'publisher_native_firm_case_relationship',graph_file:graphFile,graph_file_sha256:sha(graphBytes),record:scope.get(id)}]};
  validateQueueRow(row);queue.set(doc.id,row);
 }
}
const bytes=Buffer.from([...queue.values()].map(r=>JSON.stringify(r)).join('\n')+'\n');
if(!queue.size){console.log(JSON.stringify({queued:0,held:held.length,cases:counts.length}));process.exit(0);}
fs.writeFileSync(out,bytes,{flag:'wx'});
const manifest={queue:out,sha256:sha(bytes),queued:queue.size,created_at:new Date().toISOString(),held,cases:counts,courtlistener_api_requests:0,public_projection_allowed:false};
fs.writeFileSync(out+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...manifest,held:held.length,cases:counts.length}));
