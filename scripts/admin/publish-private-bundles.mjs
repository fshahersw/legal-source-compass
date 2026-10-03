import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const PROJECT='xosqzzsnhxcyehcnirpa', BUCKET='corpus-originals', MAX_BYTES=16*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const args=Object.fromEntries(process.argv.slice(2).map(value=>{const at=value.indexOf('=');return at<0?[value.slice(2),true]:[value.slice(2,at),value.slice(at+1)];}));
const root=path.resolve('private/data');
let sourceRequestsStopped=false;
async function filesIn(dir){const files=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isSymbolicLink())throw Error('SYMLINK_SOURCE_REJECTED');if(item.isDirectory())files.push(...await filesIn(file));else if(item.isFile())files.push(file);}return files;}
async function request(url,options={}){
 for(let attempt=0;;attempt++){
  if(sourceRequestsStopped)throw Error('PRIVATE_STORAGE_AUTH_OR_RATE_STOP');
  try {const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(60000)});if(response.status===429||response.status===401||response.status===403){sourceRequestsStopped=true;return response;}if(response.status>=500&&attempt<2){await response.body?.cancel();await new Promise(r=>setTimeout(r,1000*(attempt+1)));continue;}return response;}
  catch(error){if(sourceRequestsStopped||attempt>=2)throw error;await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
 }
}
async function main(){
 if(!args.execute){
  const files={};for(const file of (await filesIn(root)).sort()){
   const name=path.relative(root,file).replaceAll('\\','/');if(!/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(jsonl?|xlsx|txt|csv)$/.test(name))throw Error('UNSUPPORTED_SOURCE_FILE');
   const bytes=await fs.readFile(file);if(bytes.length<1||bytes.length>MAX_BYTES)throw Error('UNBOUNDED_SOURCE_FILE');const digest=sha(bytes);
   files[name]={sha256:digest,bytes:bytes.length,storage_key:`atlas-private-data/sha256/${digest.slice(0,2)}/${digest}.bin`};
  }
  const manifest={schema_version:'atlas-private-snapshots/1',project_id:PROJECT,bucket:BUCKET,created_at:new Date().toISOString(),files};
  const content=JSON.stringify(manifest,null,2)+'\n';await fs.mkdir(path.dirname(args.manifest),{recursive:true});await fs.writeFile(args.manifest,content,{flag:'wx'});
  await fs.mkdir('src/lib/private-data',{recursive:true});await fs.writeFile('src/lib/private-data/manifest.server.json',content,{flag:'wx'});
  console.log(JSON.stringify({state:'private_snapshot_manifest_prepared',files:Object.keys(files).length,bytes:Object.values(files).reduce((sum,x)=>sum+x.bytes,0),manifest_sha256:sha(content)}));return;
 }
 const raw=await fs.readFile(args.manifest);if(sha(raw)!==args['manifest-sha256'])throw Error('EXACT_MANIFEST_REQUIRED');const manifest=JSON.parse(raw);
 if(manifest.project_id!==PROJECT||manifest.bucket!==BUCKET||manifest.schema_version!=='atlas-private-snapshots/1')throw Error('PRIVATE_PROJECT_REQUIRED');
 const jobs=[];for(const[name,entry]of Object.entries(manifest.files)){
  const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)||entry.bytes>MAX_BYTES||entry.storage_key!==`atlas-private-data/sha256/${entry.sha256.slice(0,2)}/${entry.sha256}.bin`)throw Error('EXACT_PRIVATE_SOURCE_REQUIRED');
  const bytes=await fs.readFile(file);if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error('SOURCE_CHANGED');jobs.push({name,file,...entry});
 }
 const cfg=JSON.parse(await fs.readFile(args.credentials,'utf8'));const token=cfg.EXTERNAL_SUPABASE_KEY;if(cfg.EXTERNAL_SUPABASE_URL!==`https://${PROJECT}.supabase.co`||typeof token!=='string')throw Error('PROJECT_CREDENTIALS_REQUIRED');
 if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.ref!==PROJECT||claims.role!=='service_role')throw Error('SERVICE_ROLE_REQUIRED');}else if(!token.startsWith('sb_secret_'))throw Error('SERVICE_ROLE_REQUIRED');
 const receipt=await fs.open(args.receipt,'wx');const headers={apikey:token,...(!token.startsWith('sb_')?{Authorization:`Bearer ${token}`}:{})};
 let receiptWrites=Promise.resolve();
 const appendReceipt=entry=>{const bytes=Buffer.from(JSON.stringify(entry)+'\n');const write=receiptWrites.then(async()=>{let offset=0;while(offset<bytes.length){const result=await receipt.write(bytes,offset,bytes.length-offset);if(result.bytesWritten<1)throw Error('RECEIPT_SHORT_WRITE');offset+=result.bytesWritten;}await receipt.sync();});receiptWrites=write;return write;};
 let verified=0,totalBytes=0;const unique=[...new Map(jobs.map(job=>[job.sha256,job])).values()];let next=0;
 async function verify(response,job){if(!response.ok||!response.body)throw Error('CLOUD_READBACK_FAILED');const digest=createHash('sha256');let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>job.bytes)throw Error('CLOUD_SIZE_MISMATCH');digest.update(chunk);}if(size!==job.bytes||digest.digest('hex')!==job.sha256)throw Error('CLOUD_HASH_MISMATCH');}
 try {
  const workers=await Promise.allSettled(Array.from({length:4},async()=>{while(!sourceRequestsStopped&&next<unique.length){
   const job=unique[next++],url=`https://${PROJECT}.supabase.co/storage/v1/object/${BUCKET}/${job.storage_key}`;let existing=await request(url,{headers});
   if(!existing.ok){const body=await existing.text();let detail;try{detail=JSON.parse(body);}catch{};if(!(existing.status===404||existing.status===400&&/not.?found|nosuchkey/i.test(String(detail?.error)+' '+String(detail?.message))))throw Error('EXISTING_OBJECT_LOOKUP_FAILED');
    const bytes=await fs.readFile(job.file);if(sha(bytes)!==job.sha256)throw Error('SOURCE_CHANGED_DURING_UPLOAD');
    const uploaded=await request(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','x-upsert':'false'},body:bytes});
    if(!uploaded.ok&&uploaded.status!==409)throw Error('PRIVATE_UPLOAD_FAILED');await uploaded.body?.cancel();existing=await request(url,{headers});
   }
   await verify(existing,job);verified++;totalBytes+=job.bytes;
   await appendReceipt({state:'private_snapshot_cloud_verified',project_id:PROJECT,bucket:BUCKET,storage_key:job.storage_key,sha256:job.sha256,bytes:job.bytes,manifest_sha256:sha(raw),verified_at:new Date().toISOString()});
   if(verified%25===0)console.log(JSON.stringify({verified,uniqueObjects:unique.length}));
  }}));
  await receiptWrites;await receipt.sync();if(workers.some(result=>result.status==='rejected')||sourceRequestsStopped||verified!==unique.length){for(const result of workers)if(result.status==='rejected')console.error(JSON.stringify({state:'private_snapshot_worker_failed',error_type:/^[A-Z_]+$/.test(result.reason?.message)?result.reason.message:'NETWORK_OR_FILESYSTEM_ERROR',http_status:result.reason?.httpStatus??null}));throw Error('SOME_PRIVATE_SNAPSHOTS_FAILED');}
  const completion={state:'all_private_snapshots_verified',files:jobs.length,unique_objects:verified,unique_bytes:totalBytes,manifest_sha256:sha(raw),finished_at:new Date().toISOString()};
  await fs.writeFile(args.receipt+'.complete.json',JSON.stringify(completion,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(completion));
 }finally{await receipt.close();}
}
main().catch(error=>{console.error(JSON.stringify({state:'private_snapshot_operation_stopped',error_type:/^[A-Z_]+$/.test(error.message)?error.message:'PRIVATE_SNAPSHOT_ERROR'}));process.exitCode=1;});
