import fs from 'node:fs/promises';
import path from 'node:path';
import { CourtListenerClient, sha256 } from './courtlistener-client.mjs';
import { verifiedNativeDocketHeader, sourceDocketAllowsRelations, runSettledWorkers, nativeObservationKey } from './metadata-workflow.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
const cache=path.resolve(args.cache??'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/courtlistener');
const client=new CourtListenerClient(cache,Number(args['max-requests']??300));
const out=path.join(cache,'live-normalized');await fs.mkdir(out,{recursive:true});
const manifestPath=path.join(cache,'firm-discovery-manifest.json');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8').catch(()=>JSON.stringify({schema_version:'seeger-weiss-courtlistener-discovery/1',started_at:new Date().toISOString(),search:{},dockets:{},scopes:{},pdf_downloads:0,firm_portfolio_exhaustive:false})));
const candidates=new Map();const seen=new Set();
for(const line of (await fs.readFile(path.join(out,'firm-search-hits.jsonl'),'utf8').catch(()=>'' )).split('\n').filter(Boolean)){const row=JSON.parse(line);candidates.set(String(row.data.docket_id),row.data);seen.add(nativeObservationKey(row));}
async function save(){manifest.updated_at=new Date().toISOString();await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2));}
async function sink(record){const k=nativeObservationKey(record);if(seen.has(k))return;await fs.appendFile(path.join(out,record.entity_type+'.jsonl'),JSON.stringify(record)+'\n');seen.add(k);}
function observation(kind,data,provenance){return {schema_version:'courtlistener-rest-v4.7/1',source_system:'courtlistener',entity_type:kind,native_id:String(data.id),data,provenance:{...provenance,record_sha256:sha256(JSON.stringify(data))}};}
try{
 await client.initialize();
 const query='firm:"Seeger Weiss"';const state=manifest.search[query]??{};
 let next=state.complete?null:state.next??'https://www.courtlistener.com/api/rest/v4/search/?'+new URLSearchParams({q:query,type:'d',order_by:'dateFiled desc'});
 const cursors=new Set();let pages=state.pages??0;
 while(next&&pages<Number(args['search-pages']??110)){
  if(cursors.has(next))throw Error('Repeated firm search cursor');cursors.add(next);
  const {data,provenance}=await client.request(next);if(!Array.isArray(data.results))throw Error('Invalid firm search results');
  for(const hit of data.results){if(!Number.isSafeInteger(hit.docket_id)||hit.docket_id<1)throw Error('Invalid search docket identity');
   const record={schema_version:'courtlistener-rest-v4.7/1',source_system:'courtlistener',entity_type:'firm-search-hits',native_id:String(hit.docket_id),data:hit,provenance:{...provenance,record_sha256:sha256(JSON.stringify(hit))}};
   await sink(record);candidates.set(String(hit.docket_id),hit);
  }
  pages++;next=data.next??null;manifest.search[query]={provider_reported_count:data.count,unique_captured_dockets:candidates.size,pages,next,complete:next===null,result_type:'d',participation_evidence:'provider indexed firm association; exact counsel appearance requires docket-party/attorney verification',count_is_not_total_firm_portfolio:true};await save();
  console.log(JSON.stringify({event:'firm-search',pages,capturedDockets:candidates.size,providerCount:data.count,complete:next===null}));
 }
 const chosen=[...candidates.values()].sort((a,b)=>(b.dateFiled??'').localeCompare(a.dateFiled??'')).slice(0,Number(args['recent-dockets']??40));
 const headers=new Map();
 await runSettledWorkers(chosen.map(hit=>async()=>{
  const id=hit.docket_id;try{const {data,provenance}=await client.request('https://www.courtlistener.com/api/rest/v4/dockets/'+id+'/');const r=observation('dockets',data,provenance);headers.set(String(id),verifiedNativeDocketHeader(r));await sink(r);manifest.dockets[id]={status:'complete',date_filed:data.date_filed,date_modified:data.date_modified,source_blocked:!sourceDocketAllowsRelations(data)};}
  catch(e){manifest.dockets[id]={status:'failed',error:e.message};if(/STOP|BUDGET/.test(e.message))throw e;}finally{await save();}
 }),{concurrency:3,shouldStop:()=>client.stopped});
 const kinds=['parties','attorneys','docket-entries'];
 await runSettledWorkers(chosen.flatMap(hit=>kinds.map(kind=>async()=>{
  const id=hit.docket_id,key=kind+':'+id;if(!sourceDocketAllowsRelations(headers.get(String(id)))){manifest.scopes[key]={complete:false,hold:'publisher_blocked_or_missing_verified_header'};await save();return;}
  const params=new URLSearchParams(kind==='docket-entries'?{docket:String(id),order_by:'-date_created',omit:'recap_documents__plain_text'}:{docket:String(id),filter_nested_results:'True',order_by:'id'});
  try{const p=await client.paginate(manifest.scopes[key]?.next??'https://www.courtlistener.com/api/rest/v4/'+kind+'/?'+params,kind,sink,{maxPages:kind==='docket-entries'?Number(args['entry-pages']??1):Number(args['relation-pages']??2),onPage:async p=>{manifest.scopes[key]=p;await save();}});manifest.scopes[key]=p;console.log(JSON.stringify({event:'docket-scope',docket:id,kind,...p}));}
  catch(e){manifest.scopes[key]={...manifest.scopes[key],complete:false,error:e.message};if(/STOP|BUDGET/.test(e.message))throw e;}finally{await save();}
 })),{concurrency:3,shouldStop:()=>client.stopped});
 manifest.status='bounded_collection_complete';
}catch(e){manifest.status='partial';manifest.stop_reason=e.message;console.log(JSON.stringify({event:'stopped',reason:e.message}));process.exitCode=1;}
finally{manifest.request_count=client.requests;manifest.captured_firm_search_dockets=candidates.size;await save();await client.close();}
console.log(JSON.stringify({status:manifest.status,firmSearchDockets:candidates.size,headerDockets:Object.keys(manifest.dockets).length,requests:client.requests,pdfDownloads:0}));
