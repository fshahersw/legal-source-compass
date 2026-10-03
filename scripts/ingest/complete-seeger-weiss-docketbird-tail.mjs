import fs from 'node:fs/promises';
import path from 'node:path';
import{createHash}from'node:crypto';
import{DocketBirdClient}from'./docketbird-mcp-client.mjs';
import{docketSheetMetadataCoverage}from'./docketbird-metadata-contract.mjs';
import{runSettledWorkers}from'./metadata-workflow.mjs';
const base='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/docketbird';
const priorBytes=await fs.readFile(path.join(base,'portfolio-backfill-v1/manifest.json')),prior=JSON.parse(priorBytes);
const seedBytes=await fs.readFile(path.join(base,'portfolio-backfill-v1/source-qualified-case-candidates.json')),seeds=JSON.parse(seedBytes);
const targets=seeds.filter(x=>prior.cases[x.id]?.status!=='captured');
const cache=path.join(base,'portfolio-tail-v1'),c=new DocketBirdClient(cache),state={schema_version:'docketbird-bounded-tail/1',started_at:new Date().toISOString(),original_manifest_sha256:createHash('sha256').update(priorBytes).digest('hex'),candidate_file_sha256:createHash('sha256').update(seedBytes).digest('hex'),prior_captured_cases:Object.values(prior.cases).filter(x=>x.status==='captured').length,selected_native_cases:targets.map(x=>x.id),cases:{},calls:0,pdf_downloads:0};
let saveQueue=Promise.resolve(),stop=false;
const save=()=>{const body=JSON.stringify(state,null,2)+'\n';saveQueue=saveQueue.then(()=>fs.writeFile(path.join(cache,'tail-receipt.json'),body));return saveQueue;};
function unwrap(r){if(r.isError)throw Error('PROVIDER_TOOL_ERROR');return r.structuredContent??JSON.parse(r.content.find(x=>x.type==='text').text);}
async function call(name,args){if(stop||++state.calls>45)throw Error('TAIL_BUDGET');try{return unwrap(await c.call(name,args));}catch(e){if(/HTTP (401|403|429)/.test(e.message))stop=true;throw e;}}
await c.initialize();await save();
await runSettledWorkers(targets.map(seed=>async()=>{
 try{const h=await call('get_case',{case_id:seed.id});if(h.case?.id!==seed.id)throw Error('NATIVE_CASE_MISMATCH');const recent=await call('get_docket_sheet',{case_id:seed.id,sort:'recent'});const oldest=recent.entries_total>recent.entries_returned?await call('get_docket_sheet',{case_id:seed.id,sort:'chronological'}):null;const{documents,...coverage}=docketSheetMetadataCoverage(seed.id,recent,oldest);state.cases[seed.id]={status:'captured',native_case_id:seed.id,...coverage};console.log(JSON.stringify({capturedNativeCase:seed.id,documents:documents.size,complete:coverage.complete}));}
 catch(e){state.cases[seed.id]={status:'held',error:/^[A-Z_]+$|^DocketBird MCP HTTP \d+$/.test(e.message)?e.message:'PROVIDER_METADATA_FAILURE'};}
 finally{await save();}
}),{concurrency:2,shouldStop:()=>stop});
state.finished_at=new Date().toISOString();state.status=stop?'stopped_with_receipts':'selected_tail_finished';await save();console.log(JSON.stringify({status:state.status,captured:Object.values(state.cases).filter(x=>x.status==='captured').length,held:Object.values(state.cases).filter(x=>x.status==='held').length,calls:state.calls}));
