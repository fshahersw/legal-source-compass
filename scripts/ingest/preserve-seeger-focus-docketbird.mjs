import fs from 'node:fs';
import path from 'node:path';
import {focusStorage} from './seeger-focus-storage.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return[v.slice(2,i),v.slice(i+1)];}));
const root=path.resolve(args.root),source=path.join(root,'docketbird'),out=path.join(root,'docketbird-normalized');fs.mkdirSync(out,{recursive:true});
const ledger=path.join(root,'docketbird-metadata-receipts.jsonl');
const log=row=>fs.appendFileSync(ledger,JSON.stringify({...row,recorded_at:new Date().toISOString()})+'\n');
const done=new Set(fs.existsSync(ledger)?fs.readFileSync(ledger,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.state==='metadata_cloud_verified').map(r=>r.capture_file):[]);
const preserve=await focusStorage(args.credentials,log);let n=0;
function clean(value){
 if(Array.isArray(value))return value.map(clean);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='pdf_url').map(([k,v])=>[k,clean(v)]));
 if(typeof value==='string'&&value.startsWith('https://www.docketbird.com/')){const u=new URL(value);u.searchParams.delete('user_id');return u.href;}
 return value;
}
const files=fs.readdirSync(source).filter(name=>name.endsWith('.json')&&!name.startsWith('search-error-')&&name!=='firm-account.json').map(name=>path.join(source,name)).filter(file=>!done.has(file));
async function worker(){while(files.length){const file=files.shift(),capture=JSON.parse(fs.readFileSync(file));
 if(capture.schema_version!=='docketbird-codex-capture/1'||capture.source_url!=='https://mcp.docketbird.com/mcp')continue;
 const metadata={schema_version:'seeger-weiss-focused-docketbird-metadata/1',tool:capture.tool,arguments:capture.arguments,
  result:clean(capture.result),qualifications:{firm_participation_certified:false,full_text_mention_is_representation:false,
   download_urls_retained_in_private_original:true,public_projection_allowed:false}};
 const parsed=path.join(out,path.basename(file));fs.writeFileSync(parsed,JSON.stringify(metadata)+'\n');
 const receipt=await preserve(file,parsed,{source_system:'docketbird-mcp',source_url:capture.source_url,native_case_id:capture.arguments.case_id??null,
  retrieved_at:capture.retrieved_at,provenance:{tool:capture.tool,arguments:capture.arguments,scope:'Seeger Weiss source-qualified PDF backfill'}});
 log({...receipt,capture_file:file,metadata_file:parsed});n++;if(n%25===0)console.log(JSON.stringify({registered_captures:n,pending:files.length}));
}}
await Promise.all([worker(),worker(),worker(),worker()]);console.log(JSON.stringify({registered_captures:n,complete:true}));
