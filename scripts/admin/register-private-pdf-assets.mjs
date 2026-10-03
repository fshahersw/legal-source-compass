import fs from 'node:fs/promises';
import path from 'node:path';
import{createHash}from'node:crypto';
import{pathToFileURL}from'node:url';
const PROJECT='xosqzzsnhxcyehcnirpa',BUCKET='corpus-originals',sha=x=>createHash('sha256').update(x).digest('hex');
export function transportRow(source){
 if(source.state!=='cloud_verified'||source.project_id!==PROJECT||source.bucket!==BUCKET||!/^[a-f0-9]{64}$/.test(source.sha256??'')||!/^[a-f0-9]{40}$/.test(source.sha1??'')||!Number.isSafeInteger(source.bytes)||source.bytes<1||source.storage_key!=='seeger-weiss/pdf-sha256/'+source.sha256.slice(0,2)+'/'+source.sha256+'.pdf')throw Error('Verified transfer identity mismatch');
 const row={...source};delete row.upload_location;
 row.selected_source_record_sha256??=[...row.source_origins].sort((a,b)=>b.retrieved_at.localeCompare(a.retrieved_at))[0].native_record_sha256;
 if(row.durable_url){const locator=new URL(row.durable_url);if(locator.username||locator.password||[...locator.searchParams.keys()].some(key=>/user[_-]?id|token|signature|api[_-]?key|x-amz-/i.test(key))){row.provider_locator_sha256=sha(row.durable_url);row.provider_locator_status='personalized_or_signed_provider_locator_retained_only_in_original_capture';row.durable_url=null;}}
 if(JSON.stringify(row).match(/"(?:download_url|pdf_url)"\s*:/))throw Error('Expiring locators excluded from asset registration');
 return row;
}
// Groups of at most 50 receipts and 500 kB per RPC (unchanged bound).
export function groupReceipts(pending){
 const groups=[];let group=[],bytes=2;
 for(const item of pending){const count=Buffer.byteLength(JSON.stringify(item.row))+1;if(count>500000)throw Error('Single provenance observation exceeds bounded registration');if(group.length&&(group.length>=50||bytes+count>500000)){groups.push(group);group=[];bytes=2;}group.push(item);bytes+=count;}
 if(group.length)groups.push(group);return groups;
}
// Reads only the complete JSONL lines appended since `cursor.offset` (receipts are append-only).
export async function readNewReceiptLines(file,cursor){
 let handle;try{handle=await fs.open(file,'r');}catch(e){if(e.code==='ENOENT')return[];throw e;}
 try{
  const {size}=await handle.stat();if(size<=cursor.offset)return[];
  const buffer=Buffer.allocUnsafe(size-cursor.offset);let read=0;while(read<buffer.length){const part=await handle.read(buffer,read,buffer.length-read,cursor.offset+read);if(!part.bytesRead)break;read+=part.bytesRead;}
  const end=buffer.subarray(0,read).lastIndexOf(10);if(end<0)return[];
  cursor.offset+=end+1;return buffer.subarray(0,end+1).toString('utf8').split('\n').filter(Boolean);
 }finally{await handle.close();}
}
const TRANSIENT=new Set([408,425,429,500,502,503,504,520,521,522,523,524,525,526,527,530]);
const isNetwork=error=>{for(let e=error,d=0;e&&d<5;e=e.cause,d++)if(['TimeoutError','AbortError'].includes(e.name)||['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENOTFOUND','EAI_AGAIN','ENETUNREACH','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(e.code)||(e instanceof TypeError&&/^(?:fetch failed|terminated)$/.test(e.message)))return true;return false;};
// One idempotent RPC. Transient answers (network, 408/425/429, 5xx incl. Cloudflare 520-530, non-JSON edge pages)
// retry with bounded exponential backoff; a definite database rejection is returned, not thrown.
export async function callRegistration({url,headers,rows,fetchImpl=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms)),attempts=6,onRetry=async()=>{}}){
 const body=JSON.stringify({p_rows:rows});
 for(let attempt=0;;attempt++){
  let response,data=null,transient=false,failure=null;
  try{
   response=await fetchImpl(url+'/rest/v1/rpc/corpus_admin_register_pdf_assets_v1',{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(90000)});
   const text=await response.text();try{data=JSON.parse(text);}catch{data=null;}
   if(response.ok&&data&&data.received===rows.length&&data.private_only===true&&data.bucket===BUCKET)return{ok:true,status:response.status,data,batch_sha256:sha(body)};
   if(response.ok)return{ok:false,rejected:true,status:response.status,error_code:'REGISTRATION_ACKNOWLEDGEMENT_MISMATCH',message:null,batch_sha256:sha(body)};
   // Credentials / missing RPC are systemic: never bisect every receipt into a rejection.
   if([401,403,404,405].includes(response.status))throw Object.assign(Error('REGISTRATION_ACCESS_ERROR'),{status:response.status});
   if(TRANSIENT.has(response.status)||data===null&&response.status>=500)transient=true;
   else return{ok:false,rejected:true,status:response.status,error_code:typeof data?.code==='string'?data.code:'HTTP_ERROR',message:typeof data?.message==='string'?data.message.slice(0,200):null,batch_sha256:sha(body)};
   failure='HTTP_'+response.status;
  }catch(error){
   if(!isNetwork(error))throw error;
   transient=true;failure=error?.name==='TimeoutError'?'TIMEOUT':'NETWORK_ERROR';
  }
  if(transient&&attempt+1>=attempts)throw Object.assign(Error('REGISTRATION_TRANSIENT_FAILURE'),{failure});
  const delay=Math.min(60000,2000*2**attempt);await onRetry({attempt:attempt+1,failure,delay_ms:delay});await pause(delay);
 }
}
// Registers a group; when the database definitively rejects it, the group is bisected so one bad receipt
// is isolated and recorded while every other receipt in the group is still registered.
export async function registerWithIsolation(group,{call,record,acknowledged,rejected,depth=0}){
 const result=await call(group.map(x=>x.row));
 if(result.ok){
  await record({state:'registration_acknowledged',batch_sha256:result.batch_sha256,transfer_receipt_sha256s:group.map(x=>x.hash),records:group.length,result:result.data});
  for(const item of group)acknowledged.add(item.hash);return group.length;
 }
 await record({state:'registration_rejected',batch_sha256:result.batch_sha256,status:result.status,error_code:result.error_code,message:result.message,records:group.length});
 if(group.length===1){
  rejected.set(group[0].hash,{status:result.status,error_code:result.error_code,message:result.message});
  await record({state:'registration_receipt_rejected',transfer_receipt_sha256:group[0].hash,status:result.status,error_code:result.error_code,message:result.message});return 0;
 }
 const middle=Math.ceil(group.length/2);
 return await registerWithIsolation(group.slice(0,middle),{call,record,acknowledged,rejected,depth:depth+1})+await registerWithIsolation(group.slice(middle),{call,record,acknowledged,rejected,depth:depth+1});
}
async function main(){
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];}));
 const dirs=String(args.transfers).split('|').map(x=>path.resolve(x)),out=path.resolve(String(args.out)),stopFile=typeof args['stop-file']==='string'?path.resolve(args['stop-file']):null;
 await fs.mkdir(out,{recursive:true});
 const log=path.join(out,'registration-receipts.jsonl');let acknowledgements=[];try{const bytes=await fs.readFile(log,'utf8');acknowledgements=bytes.trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
 const acknowledged=new Set(acknowledgements.filter(x=>x.state==='registration_acknowledged').flatMap(x=>x.transfer_receipt_sha256s));
 const cfg=JSON.parse(await fs.readFile(String(args.credentials),'utf8'));
 if(cfg.EXTERNAL_SUPABASE_URL!=='https://'+PROJECT+'.supabase.co')throw Error('Wrong project');
 const token=cfg.EXTERNAL_SUPABASE_KEY;if(typeof token!=='string')throw Error('Missing server key');
 if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.ref!==PROJECT||claims.role!=='service_role')throw Error('Service role required');}else if(!token.startsWith('sb_secret_'))throw Error('Service role required');
 const headers={apikey:token,'Content-Type':'application/json',...(!token.startsWith('sb_')?{Authorization:'Bearer '+token}:{})};
 async function record(value){const fd=await fs.open(log,'a');try{await fd.write(JSON.stringify({...value,recorded_at:new Date().toISOString()})+'\n');await fd.sync();}finally{await fd.close();}}
 const cursors=new Map(dirs.map(dir=>[dir,{offset:0}])),rejected=new Map(),unregistered=[];
 const call=rows=>callRegistration({url:cfg.EXTERNAL_SUPABASE_URL,headers,rows,onRetry:e=>record({state:'registration_transient_retry',...e})});
 let total=0,idleFailures=0;
 for(;;){
  const pending=[];let transfersFinished=true;
  const stopSeen=stopFile?await fs.access(stopFile).then(()=>true,()=>false):false;
  try{
   for(const dir of dirs){
    for(const line of await readNewReceiptLines(path.join(dir,'transfer-receipts.jsonl'),cursors.get(dir))){
     // Cheap pre-filter; the parsed state is checked again below. Only complete, durable JSONL lines are read while the transfer is active.
     if(!line.includes('"state":"cloud_verified"'))continue;
     const receipt=JSON.parse(line);if(receipt.state!=='cloud_verified')continue;const hash=sha(line);if(acknowledged.has(hash))continue;
     let row;try{row=transportRow(receipt);}catch(error){
      // A receipt that cannot form a valid registration row is isolated, never allowed to block the others.
      const why={status:null,error_code:'TRANSPORT_ROW_INVALID',message:String(error.message).slice(0,200)};rejected.set(hash,why);
      await record({state:'registration_receipt_rejected',transfer_receipt_sha256:hash,...why});continue;
     }
     unregistered.push({hash,row});
    }
    // With --stop-file the supervisor announces that the transfer process has exited, so a stale progress.json
    // from an earlier attempt can never end the watcher while a restarted transfer is still producing receipts.
    if(stopFile)continue;
    try{const progress=JSON.parse(await fs.readFile(path.join(dir,'progress.json'),'utf8'));if(!progress.complete&&!progress.stop_reason)transfersFinished=false;}catch{transfersFinished=false;}
   }
   // The stop file is sampled BEFORE the receipts are read, so every receipt written before the exit is seen.
   if(stopFile)transfersFinished=stopSeen;
   pending.push(...unregistered.filter(x=>!acknowledged.has(x.hash)&&!rejected.has(x.hash)));
   for(const batch of groupReceipts(pending)){
    await record({state:'registration_pending',batch_sha256:sha(JSON.stringify({p_rows:batch.map(x=>x.row)})),records:batch.length,transfer_receipt_sha256s:batch.map(x=>x.hash)});
    total+=await registerWithIsolation(batch,{call,record,acknowledged,rejected});
   }
   unregistered.splice(0,unregistered.length,...unregistered.filter(x=>!acknowledged.has(x.hash)&&!rejected.has(x.hash)));
   idleFailures=0;
  }catch(error){
   // A transient registry outage must not end the watcher: the receipts stay unacknowledged and are retried next cycle.
   if(!args.watch||error.message!=='REGISTRATION_TRANSIENT_FAILURE'||++idleFailures>=20)throw error;
   await record({state:'registration_cycle_deferred',failure:error.failure??null,consecutive:idleFailures});transfersFinished=false;
  }
  if(pending.length)console.log(JSON.stringify({registeredObservationsThisRun:total,totalAcknowledgedTransferReceipts:acknowledged.size,rejectedReceipts:rejected.size,activeTransferQueues:dirs.length}));
  if(!args.watch||transfersFinished&&!unregistered.length){
   await fs.writeFile(path.join(out,'completion.json'),JSON.stringify({finished_at:new Date().toISOString(),registered_receipts:acknowledged.size,rejected_receipts:rejected.size,rejected_detail:[...rejected].slice(0,20).map(([hash,why])=>({transfer_receipt_sha256:hash,...why})),all_transfer_queues_finished:transfersFinished,independent_database_verification_required:true},null,2)+'\n');
   if(rejected.size)process.exitCode=2;break;
  }
  await new Promise(resolve=>setTimeout(resolve,Number(args['poll-ms']??15000)));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
