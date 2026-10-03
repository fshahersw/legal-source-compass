import fs from 'node:fs/promises';
import path from 'node:path';
import{createHash}from'node:crypto';
const PROJECT='xosqzzsnhxcyehcnirpa',BUCKET='corpus-originals',sha=x=>createHash('sha256').update(x).digest('hex');
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];}));
const dirs=String(args.transfers).split('|').map(x=>path.resolve(x)),out=path.resolve(String(args.out));
await fs.mkdir(out,{recursive:true});
const log=path.join(out,'registration-receipts.jsonl');let acknowledgements=[];try{const bytes=await fs.readFile(log,'utf8');acknowledgements=bytes.trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
const done=new Set(acknowledgements.filter(x=>x.state==='registration_acknowledged').flatMap(x=>x.transfer_receipt_sha256s));
const cfg=JSON.parse(await fs.readFile(String(args.credentials),'utf8'));
if(cfg.EXTERNAL_SUPABASE_URL!=='https://'+PROJECT+'.supabase.co')throw Error('Wrong project');
const token=cfg.EXTERNAL_SUPABASE_KEY;if(typeof token!=='string')throw Error('Missing server key');
if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.ref!==PROJECT||claims.role!=='service_role')throw Error('Service role required');}else if(!token.startsWith('sb_secret_'))throw Error('Service role required');
const headers={apikey:token,'Content-Type':'application/json',...(!token.startsWith('sb_')?{Authorization:'Bearer '+token}:{})};
async function record(value){const fd=await fs.open(log,'a');try{await fd.write(JSON.stringify({...value,recorded_at:new Date().toISOString()})+'\n');await fd.sync();}finally{await fd.close();}}
function transportRow(source){
 if(source.state!=='cloud_verified'||source.project_id!==PROJECT||source.bucket!==BUCKET||!/^[a-f0-9]{64}$/.test(source.sha256??'')||!/^[a-f0-9]{40}$/.test(source.sha1??'')||!Number.isSafeInteger(source.bytes)||source.bytes<1||source.storage_key!=='seeger-weiss/pdf-sha256/'+source.sha256.slice(0,2)+'/'+source.sha256+'.pdf')throw Error('Verified transfer identity mismatch');
 const row={...source};delete row.upload_location;
 row.selected_source_record_sha256??=[...row.source_origins].sort((a,b)=>b.retrieved_at.localeCompare(a.retrieved_at))[0].native_record_sha256;
 if(row.durable_url){const locator=new URL(row.durable_url);if(locator.username||locator.password||[...locator.searchParams.keys()].some(key=>/user[_-]?id|token|signature|api[_-]?key|x-amz-/i.test(key))){row.provider_locator_sha256=sha(row.durable_url);row.provider_locator_status='personalized_or_signed_provider_locator_retained_only_in_original_capture';row.durable_url=null;}}
 if(JSON.stringify(row).match(/"(?:download_url|pdf_url)"\s*:/))throw Error('Expiring locators excluded from asset registration');
 return row;
}
let total=0;
for(;;){
 const pending=[];let transfersFinished=true;
 for(const dir of dirs){
  let data='';try{data=await fs.readFile(path.join(dir,'transfer-receipts.jsonl'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  // Only complete, durable JSONL records are read while the transfer is active.
  const end=data.lastIndexOf('\n');for(const line of data.slice(0,end+1).split('\n').filter(Boolean)){
   const receipt=JSON.parse(line);if(receipt.state!=='cloud_verified')continue;const hash=sha(line);if(done.has(hash))continue;
   pending.push({hash,row:transportRow(receipt)});
  }
  try{const progress=JSON.parse(await fs.readFile(path.join(dir,'progress.json'),'utf8'));if(!progress.complete&&!progress.stop_reason)transfersFinished=false;}catch{transfersFinished=false;}
 }
 let groups=[],group=[],bytes=2;for(const item of pending){const count=Buffer.byteLength(JSON.stringify(item.row))+1;if(count>500000)throw Error('Single provenance observation exceeds bounded registration');if(group.length&&(group.length>=50||bytes+count>500000)){groups.push(group);group=[];bytes=2;}group.push(item);bytes+=count;}if(group.length)groups.push(group);
 for(const batch of groups){
  const body=JSON.stringify({p_rows:batch.map(x=>x.row)}),batchHash=sha(body),hashes=batch.map(x=>x.hash);
  await record({state:'registration_pending',batch_sha256:batchHash,records:batch.length,transfer_receipt_sha256s:hashes});
  let result=null;
  for(let attempt=0;attempt<3;attempt++){
   try{const response=await fetch(cfg.EXTERNAL_SUPABASE_URL+'/rest/v1/rpc/corpus_admin_register_pdf_assets_v1',{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(90000)});const data=await response.json();if(!response.ok){await record({state:'registration_rejected',batch_sha256:batchHash,status:response.status,error_code:data.code??'HTTP_ERROR',message:typeof data.message==='string'?data.message.slice(0,200):null});throw Error('REGISTRATION_REJECTED');}if(data.received!==batch.length||data.private_only!==true||data.bucket!==BUCKET)throw Error('REGISTRATION_ACKNOWLEDGEMENT_MISMATCH');result=data;break;}
   catch(e){if(e.message.startsWith('REGISTRATION_')||attempt===2)throw e;await record({state:'registration_unknown_idempotent_retry',batch_sha256:batchHash,attempt:attempt+1});await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
  }
  await record({state:'registration_acknowledged',batch_sha256:batchHash,transfer_receipt_sha256s:hashes,records:batch.length,result});for(const hash of hashes)done.add(hash);total+=batch.length;
 }
 if(pending.length)console.log(JSON.stringify({registeredObservationsThisRun:total,totalAcknowledgedTransferReceipts:done.size,activeTransferQueues:dirs.length}));
 if(!args.watch||transfersFinished){await fs.writeFile(path.join(out,'completion.json'),JSON.stringify({finished_at:new Date().toISOString(),registered_receipts:done.size,all_transfer_queues_finished:transfersFinished,independent_database_verification_required:true},null,2)+'\n');break;}
 await new Promise(resolve=>setTimeout(resolve,15000));
}
