import fs from 'node:fs/promises';
import path from 'node:path';
import {DocketBirdClient}from'./docketbird-mcp-client.mjs';
import{runSettledWorkers}from'./metadata-workflow.mjs';
import{exactDocketReferenceCandidates,docketSheetMetadataCoverage}from'./docketbird-metadata-contract.mjs';

const base='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/docketbird';
const cache=path.join(base,'portfolio-backfill-v1');const c=new DocketBirdClient(cache);
const state={schema_version:'seeger-weiss-docketbird-backfill/1',started_at:new Date().toISOString(),cases:{},searches:[],errors:[],full_firm_portfolio_verified:false,pdf_downloads:0,document_text_downloads:0};
const candidates=new Map();let stop=null,calls=0;let queue=Promise.resolve();
async function save(){const body=JSON.stringify(state,null,2);queue=queue.then(()=>fs.writeFile(path.join(cache,'manifest.json'),body));await queue;}
function unwrap(r){if(r.isError){const t=r.content?.find(x=>x.type==='text')?.text??'provider error';throw Error(t.startsWith('This question took too long')?'PROVIDER_QUERY_TIMEOUT':'PROVIDER_TOOL_ERROR');}return r.structuredContent??JSON.parse(r.content.find(x=>x.type==='text').text);}
async function call(name,args){if(stop)throw Error(stop);if(++calls>650){stop='REQUEST_BUDGET';throw Error(stop);}try{return unwrap(await c.call(name,args));}catch(e){if(/HTTP (401|403|429)|REQUEST_BUDGET/.test(e.message))stop=e.message;throw e;}}
async function add(id,proof){if(typeof id!=='string'||!id.match(/^[a-z0-9_]+-[^/\s]+$/))throw Error('Invalid provider case identity');const prior=candidates.get(id)??{id,evidence:[]};prior.evidence.push(proof);candidates.set(id,prior);}

await c.initialize();
for(const scope of ['narrow-probe','initial-portfolio'])for(const name of await fs.readdir(path.join(base,scope))){if(!name.endsWith('.json'))continue;const capture=JSON.parse(await fs.readFile(path.join(base,scope,name),'utf8'));if(capture.method!=='tools/call')continue;let data;try{data=unwrap(JSON.parse(capture.original_rpc_response).result);}catch{continue;}
 if(capture.params.name==='find_litigation_relationships'&&data.interpretation?.includes("'Seeger Weiss LLP'"))for(const row of data.records??[])if(row['lawfirm.law_firm_id']==='seegerweiss.com')await add(row['case.case_id'],{kind:'provider_law_firm_appearance',source_capture:name,provider_interpretation:data.interpretation,date_precision:row.date_precision});
 if(capture.params.name==='list_my_cases')for(const row of data.cases??[])await add(row.id,{kind:'account_tracked_case',firm_appearance_proven:false,source_capture:name});
}
const cl=(await fs.readFile('C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/courtlistener/live-normalized/firm-search-hits.jsonl','utf8')).trim().split('\n').map(x=>JSON.parse(x));
const master=cl.filter(x=>/\bmd\b/i.test(x.data.docketNumber??''));const recent=cl.slice(0,60);
const targets=[...new Map([...master,...recent].map(x=>[x.data.court_id+'|'+x.data.docketNumber,x])).values()];
await runSettledWorkers(targets.map(row=>async()=>{
 const hit=row.data;try{
  const response=await call('search_cases',{q:hit.docketNumber,court_id:hit.court_id,size:100});
  const match=exactDocketReferenceCandidates(hit,response.cases??[]);
  state.searches.push({court:hit.court_id,docket:hit.docketNumber,courtlistener_id:hit.docket_id,provider_found:response.found,returned:response.cases?.length??0,exact_matches:match.matches.length,match_resolution:match.resolution,definitive_association_allowed:match.definitive_association_allowed,ambiguous_case_candidates:match.matches.length>1?match.matches.map(x=>x.id):[],next_cursor:response.next_cursor,complete:response.next_cursor===null,matching_rule:'exact court, division, source-qualified filing year, case type and numeric sequence; multiple native matches held; no name merge'});
  for(const item of match.matches)await add(item.id,{kind:match.definitive_association_allowed?'exact_cross_provider_docket_reference':'ambiguous_cross_provider_docket_reference',courtlistener_docket_id:String(hit.docket_id),courtlistener_source_url:row.provenance.source_url,courtlistener_source_sha256:row.provenance.source_sha256,firm_appearance_evidence:match.definitive_association_allowed?'CourtListener firm index':'CourtListener source index; target association unresolved',definitive_association_allowed:match.definitive_association_allowed,association_held:!match.definitive_association_allowed,publisher_native_merge:false});
 }catch(e){state.errors.push({scope:'search',courtlistener_id:hit.docket_id,error:e.message});}finally{await save();}
}),{concurrency:3,shouldStop:()=>stop});

await fs.writeFile(path.join(cache,'source-qualified-case-candidates.json'),JSON.stringify([...candidates.values()],null,2));
await runSettledWorkers([...candidates.values()].map(candidate=>async()=>{
 const id=candidate.id;try{
  const header=await call('get_case',{case_id:id});if(header.case?.id!==id)throw Error('Case header identity mismatch');
  const recent=await call('get_docket_sheet',{case_id:id,sort:'recent'});
  let oldest=null;if(recent.entries_total>recent.entries_returned)oldest=await call('get_docket_sheet',{case_id:id,sort:'chronological'});
  const {documents,...coverage}=docketSheetMetadataCoverage(id,recent,oldest);
  state.cases[id]={status:'captured',case_id:id,evidence:candidate.evidence,header_present:true,case_url:header.case.canonical_url,recent_returned:recent.documents.length,chronological_returned:oldest?.documents.length??0,...coverage,pdf_downloads:0};
  console.log(JSON.stringify({event:'docketbird-sheet',caseId:id,rows:documents.size,total:coverage.provider_total,complete:coverage.complete}));
 }catch(e){state.cases[id]={status:'held',error:e.message,evidence:candidate.evidence};}
 finally{state.calls=calls;await save();}
}),{concurrency:3,shouldStop:()=>stop});
state.finished_at=new Date().toISOString();state.status=stop?'partial':'bounded_collection_complete';state.calls=calls;await save();
console.log(JSON.stringify({status:state.status,cases:Object.keys(state.cases).length,capturedCases:Object.values(state.cases).filter(x=>x.status==='captured').length,metadataRows:Object.values(state.cases).reduce((a,x)=>a+(x.unique_document_metadata??0),0),calls,pdfDownloads:0}));
