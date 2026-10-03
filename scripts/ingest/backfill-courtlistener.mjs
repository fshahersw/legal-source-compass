import fs from 'node:fs/promises';
import path from 'node:path';
import { CourtListenerClient, DEFAULT_CACHE, sha256 } from './courtlistener-client.mjs';
import { runSettledWorkers, nativeObservationKey, sourceDocketAllowsRelations, verifiedNativeDocketHeader } from './metadata-workflow.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
const cache=path.resolve(args.cache??DEFAULT_CACHE);
const maxRequests=Number(args['max-requests']??450);
const caseLimit=Number(args['case-limit']??250);
const entryPages=Number(args['entry-pages']??6);
const relationPages=Number(args['relation-pages']??10);
const entriesOnly=args['entries-only']==='true';
const masterLimit=Number(args['master-limit']??Number.MAX_SAFE_INTEGER);
const client=new CourtListenerClient(cache,maxRequests);
const output=path.join(cache,'live-normalized');await fs.mkdir(output,{recursive:true});
const docketHeaders=new Map();
const headerFile=args['docket-headers']??path.join(output,'dockets.jsonl');
for(const line of (await fs.readFile(headerFile,'utf8').catch(()=>'' )).split('\n').filter(Boolean)) {
 const record=JSON.parse(line);
 docketHeaders.set(record.native_id,verifiedNativeDocketHeader(record));
}
const cases=JSON.parse(await fs.readFile('private/data/catalog-matters.json','utf8'));
const masters=JSON.parse(await fs.readFile('private/data/mdl-documents/master-dockets.json','utf8'));
const ids=[...new Set([...Object.keys(masters).map(Number),...cases.filter(x=>x.mdl_master_docket_id).sort((a,b)=>(b.date_filed??'').localeCompare(a.date_filed??'')).map(x=>x.docket_id),...cases.map(x=>x.docket_id)])];
const manifestPath=path.join(cache,'live-backfill-manifest.json');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8').catch(()=>JSON.stringify({schema_version:'courtlistener-backfill/1',created_at:new Date().toISOString(),dockets:{},scopes:{},coverage:{saved_cases:cases.length,master_dockets:Object.keys(masters).length,native_docket_targets:ids.length,pdf_downloads:0}})));
let manifestQueue=Promise.resolve();
async function saveManifest(){manifest.updated_at=new Date().toISOString();const text=JSON.stringify(manifest,null,2);manifestQueue=manifestQueue.then(()=>fs.writeFile(manifestPath,text));await manifestQueue;}
const sinks=new Map();const seen=new Map();
async function sink(record){
 const kind=record.entity_type;
 if(!sinks.has(kind)){
  const filename=path.join(output,`${kind}.jsonl`);
  const previous=await fs.readFile(filename,'utf8').catch(()=>'');
  const entries=new Set(previous.trim().split('\n').filter(Boolean).map(x=>nativeObservationKey(JSON.parse(x))));
  seen.set(kind,entries);sinks.set(kind,filename);
 }
 const observationKey=nativeObservationKey(record);
 if(seen.get(kind).has(observationKey))return;
 // Versioned observations are append-only; the importer selects one native ID's
 // latest source modification, retaining every prior original/provenance.
 await fs.appendFile(sinks.get(kind),JSON.stringify(record)+'\n');seen.get(kind).add(observationKey);
}
async function getDocket(id){
 if(manifest.dockets[id]?.status==='complete')return;
 try{
  const {data,provenance}=await client.request(`https://www.courtlistener.com/api/rest/v4/dockets/${id}/`);
  if(data.id!==id)throw new Error('Native docket ID mismatch');
  const record={schema_version:'courtlistener-rest-v4.7/1',source_system:'courtlistener',entity_type:'dockets',native_id:String(id),data,provenance:{...provenance,record_sha256:sha256(JSON.stringify(data))}};
  docketHeaders.set(String(id),verifiedNativeDocketHeader(record));
  await sink(record);
  manifest.dockets[id]={status:'complete',retrieved_at:provenance.retrieved_at,source_modified_at:data.date_modified??null,master_mdl:masters[id]??null};
  console.log(JSON.stringify({scope:'docket',id,status:'complete',master:masters[id]??null}));
 }catch(e){
  manifest.dockets[id]={status:'failed',error:e.message};if(/AUTHORIZATION_STOP|RATE_LIMIT_STOP|REQUEST_BUDGET/.test(e.message))throw e;
  console.log(JSON.stringify({scope:'docket',id,status:'failed',error:e.message}));
 }finally{await saveManifest();}
}
async function getRelated(id,kind,maxPages){
 const key=`${kind}:${id}`;if(manifest.scopes[key]?.complete)return;
 if(!sourceDocketAllowsRelations(docketHeaders.get(String(id)))) {
  manifest.scopes[key]={...(manifest.scopes[key]??{}),complete:false,status:'source_blocked_or_missing_header',docket_id:id,updated_at:new Date().toISOString()};
  await saveManifest();console.log(JSON.stringify({scope:key,event:'source_blocked_or_missing_header'}));return;
 }
 const params=new URLSearchParams(kind==='docket-entries'?{docket:String(id),order_by:'-date_created',omit:'recap_documents__plain_text'}:{docket:String(id),filter_nested_results:'True',order_by:'id'});
 const url=manifest.scopes[key]?.next??`https://www.courtlistener.com/api/rest/v4/${kind}/?${params}`;
 const previous=manifest.scopes[key]??{};
 async function checkpoint(progress){
  manifest.scopes[key]={...progress,records:(previous.records??0)+progress.records,pages:(previous.pages??0)+progress.pages,updated_at:new Date().toISOString(),docket_id:id};
  await saveManifest();
 }
 try{
  const result=await client.paginate(url,kind,sink,{maxPages,onPage:checkpoint});
  await checkpoint(result);
  console.log(JSON.stringify({scope:key,...manifest.scopes[key]}));
 }catch(e){
  manifest.scopes[key]={...(manifest.scopes[key]??{}),complete:false,status:'failed',error:e.message,docket_id:id,updated_at:new Date().toISOString()};
  console.log(JSON.stringify({scope:key,status:'failed',error:e.message}));
  if(/AUTHORIZATION_STOP|RATE_LIMIT_STOP|REQUEST_BUDGET/.test(e.message))throw e;
 }finally{await saveManifest();}
}
async function runWorkers(tasks){
 await runSettledWorkers(tasks,{concurrency:3,shouldStop:()=>client.stopped});
}
try{
 await client.initialize();manifest.run_status='running';delete manifest.stop_reason;await saveManifest();
 // Complete master docket headers first; then independent relation scopes fan out.
 const countReport=JSON.parse(await fs.readFile(path.join(cache,'master-scope-counts.json'),'utf8').catch(()=>'{"sources":[]}'));
 const counts=new Map(countReport.sources.map(x=>[x.docket_id,x.entries]));
 const masterIDs=Object.keys(masters).map(Number).sort((a,b)=>(counts.get(a)??Number.MAX_SAFE_INTEGER)-(counts.get(b)??Number.MAX_SAFE_INTEGER));
 await runWorkers(masterIDs.map(id=>()=>getDocket(id)));
 const relationTypes=entriesOnly?[['docket-entries',entryPages]]:[['parties',relationPages],['attorneys',relationPages],['docket-entries',entryPages]];
 const tasks=masterIDs.slice(0,masterLimit).flatMap(id=>relationTypes.map(([kind,limit])=>()=>getRelated(id,kind,limit)));
 await runWorkers(tasks);
 const caseIDs=ids.filter(id=>!masters[id]).slice(0,caseLimit);
 await runWorkers(caseIDs.map(id=>()=>getDocket(id)));
 manifest.run_status='bounded_batch_complete';
}catch(e){manifest.run_status='stopped';manifest.stop_reason=e.message;console.log(JSON.stringify({event:'stopped',reason:e.message}));process.exitCode=1;
}finally{await saveManifest();await client.close();}
console.log(JSON.stringify({requestCount:client.requests,docketsComplete:Object.values(manifest.dockets).filter(x=>x.status==='complete').length,relationScopesComplete:Object.values(manifest.scopes).filter(x=>x.complete).length,partialRelationScopes:Object.values(manifest.scopes).filter(x=>!x.complete).length,output,pdfDownloads:0}));
