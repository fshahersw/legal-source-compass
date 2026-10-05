// Owner-authorized removal of two exact collections. Recovery files stay private.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { rest } from '../ingest/members-pgrest.mjs';

const PROJECT='xosqzzsnhxcyehcnirpa';
const EXPECTED=new Map([['judge_disclosures',21832],['url_directory',131743]]);
const root=path.resolve('private/audit-2026-10-05/remove-peripheral-datasets');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?`[${x.map(canonical).join(',')}]`:`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
const mode=process.argv[2]??'verify';
if(!['verify','execute','restore'].includes(mode))throw Error('Expected verify, execute or restore');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'before-manifest.json'),'utf8'));
if(manifest.target_project!==PROJECT || manifest.schema!=='peripheral-dataset-before-images/v1' || manifest.datasets.length!==2)throw Error('Wrong recovery manifest');
const receipts=path.join(root,'removal-receipts');fs.mkdirSync(receipts,{recursive:true});
const lock=path.join(root,'removal.lock');
const lockFd=fs.openSync(lock,'wx');fs.writeSync(lockFd,JSON.stringify({pid:process.pid,started_at:new Date().toISOString(),mode}));
function readVerified(entry){
  const file=path.resolve(root,entry.file);
  if(!file.startsWith(root+path.sep))throw Error('Recovery file outside pinned directory');
  const bytes=fs.readFileSync(file);
  if(bytes.length!==entry.bytes || sha(bytes)!==entry.sha256)throw Error('Recovery hash mismatch');
  return bytes;
}
function save(name,data){
  const file=path.join(receipts,name), bytes=Buffer.from(JSON.stringify(data,null,2));
  if(fs.existsSync(file)){if(canonical(JSON.parse(fs.readFileSync(file,'utf8')))!==canonical(data))throw Error('Receipt changed');}
  else fs.writeFileSync(file,bytes,{flag:'wx'});
}
const creds=JSON.parse(fs.readFileSync('C:/Users/firas/.codex/private/legal-source-compass.preview.json','utf8'));
if(creds.EXTERNAL_SUPABASE_URL!==`https://${PROJECT}.supabase.co` || typeof creds.EXTERNAL_SUPABASE_KEY!=='string')throw Error('Wrong credential target');
async function mutate(route,method,body,prefer){
  // Never automatically retry a mutation with an unknown outcome.
  const key=creds.EXTERNAL_SUPABASE_KEY;
  const response=await fetch(`${creds.EXTERNAL_SUPABASE_URL}/rest/v1/${route}`,{method,headers:{apikey:key,'Content-Type':'application/json',...(key.startsWith('sb_')?{}:{Authorization:`Bearer ${key}`}),Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null;}catch{throw Error(`Non-JSON mutation response ${response.status}`);}
  if(!response.ok)throw Error(`Mutation failed HTTP ${response.status} code ${data?.code??'unknown'}`);
  return {data,preference:response.headers.get('preference-applied'),range:response.headers.get('content-range')};
}
const count=async dataset=>Number((await rest(`corpus_records?dataset=eq.${dataset}&select=id&limit=1`,{prefer:'count=exact'})).headers.get('content-range')?.split('/')[1]);
const queryPage=(dataset,page,select='*')=>new URLSearchParams([['dataset',`eq.${dataset}`],['id',`gte.${page.first_id}`],['id',`lte.${page.last_id}`],['select',select]]).toString();
try{
 const catalog=JSON.parse(readVerified(manifest.catalog).toString('utf8'));
 let total=0;
 for(const dataset of manifest.datasets){
   if(EXPECTED.get(dataset.dataset)!==dataset.rows)throw Error('Unapproved dataset or count');
   const ids=new Set();
   for(const page of dataset.pages){
     const rows=readVerified(page).toString('utf8').trim().split('\n').map(JSON.parse);
     if(rows.length!==page.rows || rows[0].id!==page.first_id || rows.at(-1).id!==page.last_id || rows.length>1000)throw Error('Invalid recovery page');
     for(const row of rows){if(row.dataset!==dataset.dataset || ids.has(row.id))throw Error('Recovery identity conflict');ids.add(row.id);}
   }
   if(ids.size!==dataset.rows)throw Error('Recovery count mismatch');total+=ids.size;
 }
 console.log(JSON.stringify({recovery_verified:true,rows:total,mode}));
 if(mode==='verify')process.exitCode=0;
 else for(const dataset of manifest.datasets){
   const id=dataset.dataset, original=catalog.find(x=>x.id===id);
   if(!original)throw Error('Catalog before-image missing');
   if(mode==='restore'){
     const current=(await rest(`corpus_datasets?id=eq.${id}&select=*`)).data;
     if(current.length && current[0].metadata?.owner_removal_review!=='2026-10-05')throw Error('Existing catalog requires separate recovery review');
     if(!current.length)await mutate('corpus_datasets','POST',{...original,ready:false,metadata:{...original.metadata,ready:false,owner_removal_review:'2026-10-05'}},'return=minimal');
     for(const page of dataset.pages){
       const rows=readVerified(page).toString('utf8').trim().split('\n').map(JSON.parse);
       await mutate('corpus_records','POST',rows,'resolution=ignore-duplicates,return=minimal');
       const actual=(await rest(`corpus_records?${queryPage(id,page)}&order=id.asc&limit=1000`)).data;
       if(canonical(actual)!==canonical(rows))throw Error('Restored page differs from exact before-image');
     }
     if(await count(id)!==dataset.rows)throw Error('Restored count mismatch');
     await mutate(`corpus_datasets?id=eq.${id}`,'PATCH',original,'return=minimal');
     console.log(JSON.stringify({dataset:id,restored_rows:dataset.rows}));continue;
   }
   const catalogReceipt=`${id}-catalog-removed.json`;
   if(fs.existsSync(path.join(receipts,catalogReceipt))){if(await count(id)!==0)throw Error('Removed dataset reappeared');continue;}
   const current=(await rest(`corpus_datasets?id=eq.${id}&select=*`)).data;
   const held={...original,ready:false,metadata:{...original.metadata,ready:false,owner_removal_review:'2026-10-05'}};
   if(current.length!==1)throw Error('Expected pinned catalog row');
   if(canonical(current[0])===canonical(original)){
     if(await count(id)!==dataset.rows)throw Error('Target count changed before removal');
     const patch=await mutate(`corpus_datasets?id=eq.${id}&updated_at=eq.${encodeURIComponent(original.updated_at)}`,'PATCH',{ready:false,metadata:held.metadata},'return=representation');
     if(patch.data?.length!==1)throw Error('Catalog changed before withdrawal');
     save(`${id}-withdrawn.json`,patch.data[0]);
   } else if(current[0].metadata?.owner_removal_review!=='2026-10-05' || current[0].ready!==false)throw Error('Catalog changed outside removal');
   let deleted=0;
   for(const page of dataset.pages){
     const receiptName=`${id}-${path.basename(page.file,'.jsonl')}.json`;
     if(fs.existsSync(path.join(receipts,receiptName))){deleted+=page.rows;continue;}
     const rows=readVerified(page).toString('utf8').trim().split('\n').map(JSON.parse);
     const check=await rest(`corpus_records?${queryPage(id,page)}&order=id.asc&limit=1000`,{prefer:'count=exact'});
     const exact=Number(check.headers.get('content-range')?.split('/')[1]);
     if(exact===0){
       // A previous request can have committed without its receipt reaching disk.
       const intent=path.join(receipts,`${receiptName}.intent`);
       if(!fs.existsSync(intent))throw Error('Rows vanished without a recorded removal intent');
       save(receiptName,{dataset:id,rows:page.rows,recovery_sha256:page.sha256,outcome:'verified_absent_after_unknown_response'});deleted+=page.rows;continue;
     }
     if(exact!==page.rows || canonical(check.data)!==canonical(rows))throw Error('Live page differs from before-image');
     const expected=rows.map(r=>({dataset:r.dataset,id:r.id}));
     const intent=path.join(receipts,`${receiptName}.intent`);
     if(!fs.existsSync(intent))fs.writeFileSync(intent,JSON.stringify({dataset:id,recovery_sha256:page.sha256,expected_ids_sha256:sha(canonical(expected)),rows:page.rows}),{flag:'wx'});
     const response=await mutate(`corpus_records?${queryPage(id,page,'dataset,id')}`,'DELETE',undefined,`handling=strict,max-affected=${page.rows},return=representation,count=exact`);
     const actual=response.data;
     if(!Array.isArray(actual) || actual.length!==expected.length || actual.some(r=>r.dataset!==id) || new Set(actual.map(r=>r.id)).size!==expected.length || expected.some(r=>!actual.some(a=>a.id===r.id)))throw Error('Deletion identity receipt mismatch');
     save(receiptName,{dataset:id,rows:page.rows,recovery_sha256:page.sha256,deleted_ids_sha256:sha(canonical(actual.sort((a,b)=>a.id.localeCompare(b.id)))),outcome:'deleted_with_returned_identities'});
     deleted+=page.rows;if(deleted%10000===0)console.log(JSON.stringify({dataset:id,deleted_rows:deleted}));
   }
   if(await count(id)!==0)throw Error('Target rows remain');
   const after=(await rest(`corpus_datasets?id=eq.${id}&select=*`)).data;
   if(after.length!==1 || after[0].ready!==false || after[0].metadata?.owner_removal_review!=='2026-10-05')throw Error('Unexpected catalog before final removal');
   const result=await mutate(`corpus_datasets?id=eq.${id}&updated_at=eq.${encodeURIComponent(after[0].updated_at)}`,'DELETE',undefined,'handling=strict,max-affected=1,return=representation');
   if(result.data?.length!==1 || result.data[0].id!==id)throw Error('Catalog removal receipt mismatch');
   save(catalogReceipt,{dataset:id,removed_catalog:result.data[0],rows:dataset.rows});
   console.log(JSON.stringify({dataset:id,removed_rows:dataset.rows,catalog_removed:true}));
 }
}finally{fs.closeSync(lockFd);fs.unlinkSync(lock);}
