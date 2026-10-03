import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonicalIntegerJson } from './local-catalog-evidence-contract.mjs';

const modes={openfda:{source:'openfda',fn:'ingest_entities'},'local-catalog':{source:'local-sw-catalog',fn:'ingest_local_catalog_entities_v1'},'local-statute':{source:'local-vaquill-open-us-law',fn:'ingest_local_statute_entities_v1'},'local-registry':{source:'local-source-registry',fn:'ingest_local_registry_entities_v1'}};
const sha=x=>createHash('sha256').update(x).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function decodePinnedBatch(job){
  const mode=modes[job.mode];
  if(!mode||!uuid.test(job.runId)||!Number.isSafeInteger(job.records)||job.records<1)throw Error('Invalid frozen job');
  const bytes=fs.readFileSync(job.path);
  if(bytes.length!==job.bytes||sha(bytes)!==job.sha256)throw Error('Frozen batch file guard failed');
  const sql=bytes.toString('utf8');
  const call=sql.match(/corpus_ingest\.([a-z0-9_]+)\('([a-f0-9-]+)'::uuid/);
  if(!call||call[1]!==mode.fn||call[2]!==job.runId)throw Error('Prepared dispatch function or run mismatch');
  const block=sql.match(/\$((?:fda|local|corpus|registry)_[a-f0-9]+|local_statute_rows)\$([\s\S]+?)\$\1\$/);
  if(!block)throw Error('Missing pinned transport block');
  const value=JSON.parse(block[2]);
  let rows;
  if(Array.isArray(value))rows=value;
  else if(job.mode==='openfda'&&Array.isArray(value.rows)&&Array.isArray(value.columns)){
    rows=value.rows.map(r=>{
      if(r.length!==6||r[5].length!==value.columns.length||!Array.isArray(value.omitted_field_sets[r[4]]))throw Error('Invalid FDA compact row');
      return {schema_version:value.schema_version,source_system:'openfda',entity_type:value.entity_type,native_id:r[0],data:Object.fromEntries(value.columns.map((k,i)=>[k,r[5][i]])),provenance:{...value.common_provenance,record_sha256:r[1],native_record_without_harmonized_annotation_sha256:r[2],source_row_ordinal:r[3],source_fields_omitted:value.omitted_field_sets[r[4]]}};
    });
  }else throw Error('Unexpected pinned transport format');
  if(rows.length!==job.records)throw Error('Frozen record count mismatch');
  for(const row of rows){
    if(row.source_system!==mode.source||sha(canonicalIntegerJson(row.data))!==row.provenance?.record_sha256)throw Error('Source-qualified payload checksum mismatch');
  }
  return rows;
}
export function splitBoundedRows(rows,maxBytes=700000){
  const groups=[];let group=[],bytes=2;
  for(const row of rows){const size=Buffer.byteLength(JSON.stringify(row))+1;
    if(size+2>maxBytes)throw Error('Single row exceeds bounded intake; hold without truncation');
    if(group.length&&bytes+size>maxBytes){groups.push(group);group=[];bytes=2;}
    group.push(row);bytes+=size;
  }
  if(group.length)groups.push(group);return groups;
}
async function main(){
  const args=Object.fromEntries(process.argv.slice(2).map(s=>{const n=s.indexOf('=');return n<0?[s.replace(/^--/,''),true]:[s.slice(2,n),s.slice(n+1)];}));
  const planPath=path.resolve(String(args.plan));
  const bytes=fs.readFileSync(planPath),plan=JSON.parse(bytes);
  if(sha(bytes)!==args['plan-sha256']||plan.projectId!=='xosqzzsnhxcyehcnirpa'||!Array.isArray(plan.jobs))throw Error('Frozen project/plan guard failed');
  // Validate every input before acquiring credentials or submitting any mutation.
  for(const job of plan.jobs)splitBoundedRows(decodePinnedBatch(job));
  if(!args.execute){console.log(JSON.stringify({state:'dry-run-verified',jobs:plan.jobs.length,records:plan.jobs.reduce((s,j)=>s+j.records,0),pdfDownloads:0}));return;}
  const cfg=JSON.parse(fs.readFileSync(String(args.credentials),'utf8'));
  if(cfg.EXTERNAL_SUPABASE_URL!=='https://xosqzzsnhxcyehcnirpa.supabase.co'||typeof cfg.EXTERNAL_SUPABASE_KEY!=='string')throw Error('Wrong server credentials project');
  const token=cfg.EXTERNAL_SUPABASE_KEY;
  if(token.startsWith('ey')){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());if(claims.role!=='service_role'||claims.ref!=='xosqzzsnhxcyehcnirpa')throw Error('Server role required');}
  else if(!token.startsWith('sb_secret_'))throw Error('Server role required');
  const receiptPath=path.resolve(String(args.receipt));
  if(fs.existsSync(receiptPath))throw Error('Fresh receipt required; audit unknown outcomes before a new plan');
  const receipt={schemaVersion:'direct-private-corpus-intake-receipt/1',projectId:plan.projectId,planSha256:sha(bytes),startedAt:new Date().toISOString(),pdfDownloads:0,jobs:[],complete:false};
  const save=()=>{fs.writeFileSync(receiptPath+'.partial',JSON.stringify(receipt,null,2)+'\n');fs.renameSync(receiptPath+'.partial',receiptPath);};save();
  for(const [index,job]of plan.jobs.entries()){
    const rows=decodePinnedBatch(job),groups=splitBoundedRows(rows),live={fileSha256:job.sha256,mode:job.mode,runId:job.runId,records:job.records,parts:[],complete:false};receipt.jobs.push(live);save();
    for(const [partIndex,part]of groups.entries()){
      const attempt={partIndex,records:part.length,payloadSha256:sha(canonicalIntegerJson(part)),startedAt:new Date().toISOString(),outcome:'unknown'};live.parts.push(attempt);save();
      for(let recovery=0;;recovery++)try{
        const headers={apikey:token,'Content-Type':'application/json'};if(!token.startsWith('sb_'))headers.Authorization='Bearer '+token;
        const response=await fetch(cfg.EXTERNAL_SUPABASE_URL+'/rest/v1/rpc/corpus_admin_intake_v1',{method:'POST',headers,body:JSON.stringify({p_run:job.runId,p_mode:job.mode,p_rows:part}),signal:AbortSignal.timeout(90000)});
        attempt.status=response.status;const result=await response.json();
        if(!response.ok){attempt.errorCode=typeof result.code==='string'?result.code:'HTTP_ERROR';save();throw Error('Administrative intake failed; inspect private receipt status/code');}
        if(result.received!==part.length||(job.mode!=='openfda'&&result.publisher_native_entities_written!==0))throw Error('Administrative aggregate count mismatch');
        attempt.result=result;attempt.outcome='acknowledged';attempt.finishedAt=new Date().toISOString();save();break;
      }catch{
        // Never retry a rejected response or a contradictory aggregate count.
        // A network failure may be audited once against exact retained payload,
        // schema and occurrence provenance. Replaying these frozen wrappers is
        // idempotent; source timestamps and observations are never regenerated.
        if(attempt.status===undefined&&recovery<2){
          try{
            const headers={apikey:token,'Content-Type':'application/json'};if(!token.startsWith('sb_'))headers.Authorization='Bearer '+token;
            const check=await fetch(cfg.EXTERNAL_SUPABASE_URL+'/rest/v1/rpc/corpus_admin_intake_status_v1',{method:'POST',headers,body:JSON.stringify({p_run:job.runId,p_mode:job.mode,p_rows:part}),signal:AbortSignal.timeout(30000)});
            const proof=await check.json();
            if(!check.ok||proof.expected!==part.length||proof.conflicts!==0||![0,part.length].includes(proof.matched))throw Error('Ambiguous acknowledgement');
            attempt.recoveryProofs??=[];attempt.recoveryProofs.push(proof);save();
            if(proof.matched===part.length){attempt.outcome='acknowledged_by_exact_database_proof';attempt.finishedAt=new Date().toISOString();save();break;}
            await new Promise(resolve=>setTimeout(resolve,1000));continue;
          }catch{/* Retain unknown outcome and stop the queue. */}
        }
        receipt.stoppedAt=new Date().toISOString();receipt.stopReason='Unknown or rejected outcome; independent database audit required before retry';save();throw Error(receipt.stopReason);
      }
    }
    live.complete=true;save();if((index+1)%10===0||index+1===plan.jobs.length)console.log(JSON.stringify({completedJobs:index+1,totalJobs:plan.jobs.length,records:receipt.jobs.reduce((s,j)=>s+(j.complete?j.records:0),0)}));
  }
  receipt.complete=true;receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({state:'intake-acknowledged',jobs:receipt.jobs.length,records:receipt.jobs.reduce((s,j)=>s+j.records,0),independentDatabaseVerificationRequired:true,pdfDownloads:0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('Private intake stopped; inspect its private receipt or validate the frozen inputs.');process.exitCode=1;});
