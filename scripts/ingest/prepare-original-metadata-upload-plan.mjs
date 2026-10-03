import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {validateMetadataPlanRow,validateOriginalMetadataBytes,metadataStorageKey} from './upload-original-metadata-to-supabase.mjs';

// Offline only: no credential loading, network requests, or cloud writes.
const BASE='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02';
const PRIVATE_CACHE='C:/Users/firas/.codex/corpus-cache/';
const sha256=x=>createHash('sha256').update(x).digest('hex');
const normalized=x=>path.resolve(x).replaceAll('\\','/').toLowerCase();
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return[x.slice(2,i),x.slice(i+1)];}));
const expectedQueue=args['queue-sha256'];
const queue=path.resolve(String(args.queue)),output=path.resolve(String(args.output));
if(!/^[a-f0-9]{64}$/.test(expectedQueue)||!normalized(queue).startsWith(PRIVATE_CACHE.toLowerCase())||!normalized(output).startsWith(PRIVATE_CACHE.toLowerCase()))throw Error('PRIVATE_FROZEN_INPUT_OUTPUT_REQUIRED');
const queueDigest=createHash('sha256');for await(const chunk of createReadStream(queue))queueDigest.update(chunk);
if(queueDigest.digest('hex')!==expectedQueue)throw Error('QUEUE_SOURCE_HASH_MISMATCH');
const candidates=new Map(),held=[];
function add(file,provider,source_url,expected_sha256=null){
 const local_path=path.resolve(file),key=normalized(local_path),prior=candidates.get(key);
 if(prior){if(prior.provider!==provider||prior.source_url!==source_url||(expected_sha256&&prior.expected_sha256&&prior.expected_sha256!==expected_sha256))throw Error('ORIGINAL_SOURCE_OBSERVATION_CONFLICT');prior.queue_origin_count++;prior.expected_sha256??=expected_sha256;return;}
 candidates.set(key,{local_path,provider,source_url,expected_sha256,queue_origin_count:expected_sha256?1:0});
}
let queueRows=0;
for await(const line of createInterface({input:createReadStream(queue),crlfDelay:Infinity})){
 if(!line.trim())continue;const row=JSON.parse(line);queueRows++;
 if(row.schema_version!=='source-qualified-pdf-queue/1'||row.provider!=='courtlistener'||!Array.isArray(row.origins))throw Error('FROZEN_COURTLISTENER_QUEUE_REQUIRED');
 for(const origin of row.origins){
  const file=origin.capture_file??(typeof origin.source_capture_file_uri==='string'?fileURLToPath(origin.source_capture_file_uri):null);
  if(!file||!/^[a-f0-9]{64}$/.test(origin.capture_file_sha256))throw Error('ORIGINAL_CAPTURE_HASH_REQUIRED');
  add(file,'courtlistener',origin.source_url,origin.capture_file_sha256);
 }
}
const captureDirs=['narrow-probe','master-probe','portfolio-backfill-v1','initial-portfolio'];
for(const directory of captureDirs){
 const folder=path.join(BASE,'docketbird',directory);
 for(const file of(await fs.readdir(folder)).filter(x=>/^\d+-[a-f0-9]{64}\.json$/.test(x)).sort())add(path.join(folder,file),'docketbird','https://mcp.docketbird.com/mcp');
}
const files=[];
for(const candidate of[...candidates.values()].sort((a,b)=>normalized(a.local_path).localeCompare(normalized(b.local_path)))){
 const bytes=await fs.readFile(candidate.local_path),digest=sha256(bytes);
 if(candidate.expected_sha256&&candidate.expected_sha256!==digest)throw Error('QUEUE_ORIGINAL_CAPTURE_HASH_MISMATCH');
 const row={provider:candidate.provider,metadata_kind:candidate.provider==='courtlistener'?'courtlistener_native_api_json':'docketbird_mcp_capture_json',local_path:candidate.local_path,source_url:candidate.source_url,sha256:digest,bytes:bytes.length,storage_key:metadataStorageKey(digest),queue_origin_count:candidate.queue_origin_count,private_original_evidence:true,public_projection_allowed:false};
 try{const real=await fs.realpath(row.local_path);validateMetadataPlanRow(row,real);validateOriginalMetadataBytes(row,bytes);files.push(row);}
 catch(error){held.push({provider:row.provider,source_file:row.local_path,sha256:digest,bytes:bytes.length,reason:/^[A-Z_]+$/.test(error.message)?error.message:'ORIGINAL_VALIDATION_HELD'});}
}
const plan={schema_version:'source-qualified-original-metadata-plan/1',created_at:new Date().toISOString(),project_id:'xosqzzsnhxcyehcnirpa',bucket:'corpus-originals',source_qualification:'Recognized successful DocketBird native metadata captures and exact CourtListener original capture files referenced by the frozen private PDF queue. Byte-preserving private evidence, not public or firm-membership proof.',source_queue:{file:queue,sha256:expectedQueue,rows:queueRows},docketbird_capture_directories:captureDirs,files};
const planBytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');
const receipt={schema_version:'original-metadata-plan-receipt/1',created_at:plan.created_at,source_queue:plan.source_queue,scanned_unique_files:candidates.size,eligible_original_files:files.length,held_original_files:held.length,source_bytes:files.reduce((n,x)=>n+x.bytes,0),unique_content_hashes:new Set(files.map(x=>x.sha256)).size,counts_by_provider:Object.fromEntries(['courtlistener','docketbird'].map(p=>[p,files.filter(x=>x.provider===p).length])),plan_file:path.join(output,'original-metadata-upload-plan-v1.json'),plan_sha256:sha256(planBytes),held,uploads:0};
await fs.mkdir(output,{recursive:false});
await fs.writeFile(receipt.plan_file,planBytes,{flag:'wx'});await fs.writeFile(path.join(output,'original-metadata-plan-receipt-v1.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...receipt,held:undefined,source_queue:{sha256:expectedQueue,rows:queueRows}}));
