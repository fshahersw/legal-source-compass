import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {DocketBirdClient} from './docketbird-mcp-client.mjs';
import {exactDocketReferenceCandidates,sourceQualifiedDocketKey,docketSheetMetadataCoverage} from './docketbird-metadata-contract.mjs';
import {runSettledWorkers} from './metadata-workflow.mjs';

const BASE='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const TOOLS=new Set(['search_cases','get_case','get_docket_sheet']);
export const RPC_CEILING=1400;
export function reserveRpcAttempt(state){if(state.stop_reason)throw Error(state.stop_reason);if(state.rpc_attempts>=RPC_CEILING){state.stop_reason='RPC_CEILING';throw Error('RPC_CEILING');}state.rpc_attempts++;}
export function validateFirmHit(row){
 const p=row?.provenance;let url;try{url=new URL(p?.source_url);}catch{throw Error('FIRM_QUERY_PROVENANCE');}
 if(row.source_system!=='courtlistener'||row.entity_type!=='firm-search-hits'||String(row.native_id)!==String(row.data?.docket_id)||!Number.isSafeInteger(row.data?.docket_id)||row.data.docket_id<1||p?.http_status!==200||p?.request_method!=='GET'||url.protocol!=='https:'||!['www.courtlistener.com','courtlistener.com'].includes(url.hostname)||url.port||url.username||url.password||url.pathname!=='/api/rest/v4/search/'||url.searchParams.get('q')!=='firm:"Seeger Weiss"'||url.searchParams.get('type')!=='d'||!Number.isFinite(Date.parse(p.retrieved_at))||!/^[a-f0-9]{64}$/.test(p.source_sha256??'')||p.record_sha256!==sha(JSON.stringify(row.data)))throw Error('FIRM_QUERY_PROVENANCE');
}
export function providerData(result){
 if(!result||result.isError)throw Error('PROVIDER_TOOL_ERROR');
 const data=result.structuredContent??JSON.parse(result.content?.find(x=>x.type==='text')?.text??'null');
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('PROVIDER_PAYLOAD_SHAPE');return data;
}
export function recordProviderQuota(state,tool,data){
 if(!TOOLS.has(tool))throw Error('DISALLOWED_METADATA_TOOL');
 if(!Object.hasOwn(data,'remaining_today'))return;
 if(!Number.isSafeInteger(data.remaining_today)||data.remaining_today<0){state.stop_reason='INVALID_PROVIDER_QUOTA';throw Error('INVALID_PROVIDER_QUOTA');}
 const old=state.provider_quota[tool];state.provider_quota[tool]={latest_observed:data.remaining_today,minimum_observed:Math.min(old?.minimum_observed??data.remaining_today,data.remaining_today),observations:(old?.observations??0)+1,unit:'Provider-reported remaining_today for this tool; cross-tool scope not established'};
 if(data.remaining_today===0)state.stop_reason='PROVIDER_REMAINING_TODAY_ZERO';
}
export function exactSearchResolution(source,data){
 const resolution=exactDocketReferenceCandidates(source,data.cases??[]);
 const complete=Object.hasOwn(data,'next_cursor')&&data.next_cursor===null&&Number.isSafeInteger(data.found)&&data.found===(data.cases??[]).length;
 return {...resolution,complete,definitive_association_allowed:complete&&resolution.definitive_association_allowed,resolution:!complete?'provider_search_result_incomplete':resolution.resolution};
}
export function headerMatches(source,nativeId,header){
 // The native search row supplies the exact docket comparison. get_case may
 // explicitly omit case_number; keep it missing rather than reconstructing it
 // from a provider ID. A present contradictory header number remains held.
 const expected=sourceQualifiedDocketKey(source.docketNumber,source.dateFiled?.slice(0,4));
 return header?.id===nativeId&&header.court_id===source.court_id&&Boolean(expected)&&(header.case_number==null||sourceQualifiedDocketKey(header.case_number,header.date_filed?.slice(0,4))===expected);
}
export function sourceNativeIdentityGroups(hits){const groups=new Map();for(const row of hits){const key=sourceQualifiedDocketKey(row.data.docketNumber,row.data.dateFiled?.slice(0,4));if(!key)continue;const joined=row.data.court_id+'|'+key,list=groups.get(joined)??[];if(!list.includes(String(row.native_id)))list.push(String(row.native_id));groups.set(joined,list);}return groups;}
export function candidateSourcesAgree(targets){if(!targets.length)return false;const keys=targets.map(x=>{const key=sourceQualifiedDocketKey(x.source.docketNumber,x.source.dateFiled?.slice(0,4));return key&&x.source.court_id?x.source.court_id+'|'+key:null;});return keys.every(Boolean)&&new Set(keys).size===1;}
const safeError=error=>/^[A-Z][A-Z0-9_]{0,79}$/.test(error?.message??'')?error.message:'PROVIDER_METADATA_FAILURE';
async function capture(file){
 const bytes=await fs.readFile(file),c=JSON.parse(bytes),raw=Buffer.from(c.original_rpc_response??'');
 if(c.schema_version!=='docketbird-mcp-capture/1'||c.source_url!=='https://mcp.docketbird.com/mcp'||c.http_status!==200||c.response_bytes!==raw.length||c.response_sha256!==sha(raw))throw Error('PRIOR_CAPTURE_INTEGRITY');
 if(c.method!=='tools/call'||!TOOLS.has(c.params?.name))return null;
 const text=raw.toString('utf8'),messages=/^(?:event:|data:)/.test(text)?text.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>JSON.parse(x.slice(5))):[JSON.parse(text)];
 const result=messages.find(x=>x.result)?.result;if(!result||result.isError)return null;
 return {file,file_sha256:sha(bytes),response_sha256:c.response_sha256,retrieved_at:c.retrieved_at,tool:c.params.name,args:c.params.arguments,data:providerData(result)};
}
export async function preparePlan(base=BASE){
 const hitFile=path.join(base,'courtlistener/live-normalized/firm-search-hits.jsonl'),hitBytes=await fs.readFile(hitFile),hits=hitBytes.toString().trim().split('\n').map(JSON.parse);
 const ids=new Set();for(const row of hits){validateFirmHit(row);if(ids.has(String(row.native_id)))throw Error('FIRM_SOURCE_NATIVE_ID');ids.add(String(row.native_id));}
 const recent=hits.filter(x=>/^(2025|2026)-\d\d-\d\d$/.test(x.data.dateFiled??'')),masters=hits.filter(x=>/-md-/i.test(x.data.docketNumber??''));
 const union=[...new Map([...masters,...recent].map(row=>[String(row.native_id),row])).values()],sourceKeys=sourceNativeIdentityGroups(hits);
 const prior=[],inputs=[{file:hitFile,sha256:sha(hitBytes),bytes:hitBytes.length,unit:'CourtListener firm-query search-hit metadata, not current representation or complete portfolio'}];
 for(const scope of ['narrow-probe','master-probe','portfolio-backfill-v1','portfolio-tail-v1']){
  const dir=path.join(base,'docketbird',scope);for(const name of(await fs.readdir(dir)).filter(x=>/^\d+-[a-f0-9]{64}\.json$/.test(x)).sort()){
   const file=path.join(dir,name),bytes=await fs.readFile(file),c=JSON.parse(bytes);if(c.method!=='tools/call'||!TOOLS.has(c.params?.name))continue;
   const parsed=await capture(file);if(parsed){prior.push(parsed);inputs.push({file,sha256:sha(bytes),bytes:bytes.length,tool:parsed.tool});}
  }
 }
 const headers=new Map();for(const c of prior)if(c.tool==='get_case'&&c.data.case?.id===c.args.case_id){const old=headers.get(c.args.case_id);if(!old||c.retrieved_at>old.retrieved_at)headers.set(c.args.case_id,c);}
 const targets=[],excluded=[],held=[];
 for(const row of union){
  const source={court_id:row.data.court_id,docketNumber:row.data.docketNumber,dateFiled:row.data.dateFiled},key=sourceQualifiedDocketKey(source.docketNumber,source.dateFiled?.slice(0,4));
  const target={courtlistener_docket_id:String(row.native_id),source,firm_source_provenance:row.provenance,firm_source_record_sha256:sha(JSON.stringify(row)),selection:{filed_2025_or_2026:recent.includes(row),explicit_md_docket_number:masters.includes(row)},native_master_role:'not_inferred_from_case_type',publisher_native_merge:false};
  if(!key||!/^[a-z0-9_]+$/.test(source.court_id??'')){held.push({...target,reason:'source_docket_identity_unqualified'});continue;}
  const sourceIds=sourceKeys.get(source.court_id+'|'+key);if(sourceIds.length!==1){held.push({...target,reason:'multiple_courtlistener_native_ids_for_qualified_docket',ambiguous_courtlistener_native_ids:sourceIds,definitive_association_allowed:false});continue;}
  let existing=null;for(const c of prior.filter(x=>x.tool==='search_cases'&&x.args.court_id===source.court_id&&x.args.q===source.docketNumber)){
   const resolution=exactSearchResolution(source,c.data);if(resolution.definitive_association_allowed&&(!existing||c.retrieved_at>existing.capture.retrieved_at))existing={capture:c,native_case:resolution.matches[0]};
  }
  if(existing){
   const h=headers.get(existing.native_case.id),proof={native_case_id:existing.native_case.id,search_capture_file:existing.capture.file,search_capture_sha256:existing.capture.file_sha256,source_record_sha256:sha(JSON.stringify(existing.native_case)),firm_scope_qualification:'Unique exact court/division/qualified-year/type/sequence reference from a CourtListener firm-query hit; not current representation or publisher-native merge'};
   if(h&&headerMatches(source,existing.native_case.id,h.data.case)){
    const sheets=prior.filter(x=>x.tool==='get_docket_sheet'&&x.args.case_id===existing.native_case.id),views=new Map();for(const s of sheets){const old=views.get(s.args.sort);if(!old||s.retrieved_at>old.retrieved_at)views.set(s.args.sort,s);}
    let coverage=null;try{if(views.get('recent')){const{documents,...counts}=docketSheetMetadataCoverage(existing.native_case.id,views.get('recent').data,views.get('chronological')?.data);coverage=counts;}}catch{coverage={complete:false,reason:'prior_provider_snapshot_inconsistent'};}
    const qualified={...target,...proof,header_capture_file:h.file,header_capture_sha256:h.file_sha256,prior_sheet_coverage:coverage};
    if(coverage===null)targets.push({...qualified,action:'native_sheet',reason:'prior_verified_header_without_sheet_capture'});
    else excluded.push({...qualified,reason:'prior_unique_exact_reference_and_verified_native_header'});continue;
   }
   targets.push({...target,action:'native_header',...proof});
  }else targets.push({...target,action:'exact_search'});
 }
 return {schema_version:'docketbird-recent-expansion-plan/1',prepared_at:new Date().toISOString(),cache_directory:path.join(base,'docketbird/recent-expansion-v1'),inputs,counts:{firm_query_native_docket_ids:ids.size,recent_hits:recent.length,explicit_md_docket_number_hits:masters.length,source_union:union.length,excluded_prior_unique_reference_with_verified_header:excluded.length,excluded_complete_provider_snapshot:excluded.filter(x=>x.prior_sheet_coverage?.complete===true).length,excluded_partial_or_inconsistent_end_views:excluded.filter(x=>x.prior_sheet_coverage?.complete!==true).length,source_identity_held:held.length,source_unqualified_held:held.filter(x=>x.reason==='source_docket_identity_unqualified').length,source_native_ambiguity_held:held.filter(x=>x.reason==='multiple_courtlistener_native_ids_for_qualified_docket').length,targets:targets.length,exact_search_targets:targets.filter(x=>x.action==='exact_search').length,reuse_search_needing_header:targets.filter(x=>x.action==='native_header').length,reuse_verified_header_needing_sheet:targets.filter(x=>x.action==='native_sheet').length},request_limits:{total_rpc_ceiling:RPC_CEILING,concurrency:3,tools:[...TOOLS],provider_quota:'Observe remaining_today by tool; nonnegative integer required when present; stop new requests on any observed zero, HTTP401/403/429; no automatic retry/bypass'},targets,excluded,held,pdf_downloads:0,document_text_downloads:0,database_writes:0,qualification:'Bounded dated firm-query and explicit md case-number scope. An md case number alone does not prove MDL master role. All 1810 firm hits are checked for CourtListener native identity multiplicity before any cross-provider reference; ambiguous source identities stay held. Cached headers are subtracted only after unique complete exact source-qualified search, matching native header and retained sheet coverage. Prior partial middle docket gaps stay unresolved. Docket sheet offers end views, not pagination; no complete portfolio claim.'};
}

export function validatePlanBytes(bytes,expectedSha){if(!/^[a-f0-9]{64}$/.test(expectedSha??'')||sha(bytes)!==expectedSha)throw Error('EXTERNALLY_PINNED_PLAN_SHA_REQUIRED');return JSON.parse(bytes);}
export async function executePlan(planFile,expectedSha){
 const planBytes=await fs.readFile(planFile),plan=validatePlanBytes(planBytes,expectedSha);if(plan.schema_version!=='docketbird-recent-expansion-plan/1'||plan.request_limits.total_rpc_ceiling!==RPC_CEILING||plan.request_limits.concurrency!==3)throw Error('REVIEWED_PLAN_REQUIRED');
 for(const input of plan.inputs)if(sha(await fs.readFile(input.file))!==input.sha256)throw Error('PINNED_INPUT_CHANGED');
 const hitInput=plan.inputs.find(x=>x.unit?.startsWith('CourtListener firm-query'));if(!hitInput)throw Error('FIRM_SCOPE_INPUT_REQUIRED');const hits=new Map((await fs.readFile(hitInput.file,'utf8')).trim().split('\n').map(line=>{const row=JSON.parse(line);validateFirmHit(row);return[String(row.native_id),row];}));
 for(const target of plan.targets){const row=hits.get(target.courtlistener_docket_id);if(!row||target.firm_source_record_sha256!==sha(JSON.stringify(row))||JSON.stringify(target.source)!==JSON.stringify({court_id:row.data.court_id,docketNumber:row.data.docketNumber,dateFiled:row.data.dateFiled})||target.publisher_native_merge!==false)throw Error('PLAN_SOURCE_SCOPE_CHANGED');}
 const cache=plan.cache_directory,captureDir=path.join(cache,'captures');await fs.mkdir(captureDir,{recursive:true});const manifestFile=path.join(cache,'runtime-manifest.json');let state;
 try{state=JSON.parse(await fs.readFile(manifestFile,'utf8'));if(state.plan_sha256!==sha(planBytes))throw Error('RESUME_PLAN_MISMATCH');}catch(error){if(error.code!=='ENOENT')throw error;state={schema_version:'docketbird-recent-expansion-runtime/1',plan_sha256:sha(planBytes),started_at:new Date().toISOString(),rpc_attempts:0,provider_quota:{},searches:{},cases:{},errors:[],pdf_downloads:0,document_text_downloads:0,database_writes:0};}
 if(['PROVIDER_REMAINING_TODAY_ZERO','INVALID_PROVIDER_QUOTA','HTTP_401','HTTP_403','HTTP_429','RPC_CEILING'].includes(state.stop_reason))throw Error('STOPPED_PLAN_REQUIRES_EXPLICIT_NEW_CHECKPOINT');
 let saves=Promise.resolve();const save=()=>{const body=JSON.stringify(state,null,2)+'\n';saves=saves.then(async()=>{await fs.writeFile(manifestFile+'.tmp',body);await fs.rename(manifestFile+'.tmp',manifestFile);});return saves;};
 const client=new DocketBirdClient(captureDir);client.sequence=Math.max(0,...(await fs.readdir(captureDir)).filter(x=>/^\d+-/.test(x)).map(x=>Number(x.split('-')[0])));const rpc=client.rpc.bind(client);
 client.rpc=async(method,args,hasId=true)=>{try{reserveRpcAttempt(state);}catch(error){await save();throw error;}await save();try{return await rpc(method,args,hasId);}catch(error){const http=error.message?.match(/^DocketBird MCP HTTP (\d+)$/);if(http&&['401','403','429'].includes(http[1]))state.stop_reason='HTTP_'+http[1];await save();throw Error(http?'HTTP_'+http[1]:'PROVIDER_TRANSPORT_OR_PROTOCOL_FAILURE');}};
 const call=async(name,args)=>{if(!TOOLS.has(name))throw Error('DISALLOWED_METADATA_TOOL');const data=providerData(await client.call(name,args));recordProviderQuota(state,name,data);await save();return data;};
 await client.initialize();await save();
 const native=new Map();for(const x of plan.targets.filter(x=>x.action!=='exact_search')){const item=native.get(x.native_case_id)??{native_case_id:x.native_case_id,source_targets:[]};item.source_targets.push(x);native.set(x.native_case_id,item);}
 for(const target of plan.targets){const old=state.searches[target.courtlistener_docket_id];if(old?.definitive_association_allowed){const id=old.native_case_id,list=native.get(id)??{native_case_id:id,source_targets:[]};list.source_targets.push(target);native.set(id,list);}}
 await runSettledWorkers(plan.targets.filter(x=>x.action==='exact_search'&&!state.searches[x.courtlistener_docket_id]).map(target=>async()=>{
  try{const data=await call('search_cases',{court_id:target.source.court_id,q:target.source.docketNumber,size:100}),resolution=exactSearchResolution(target.source,data);state.searches[target.courtlistener_docket_id]={resolution:resolution.resolution,complete:resolution.complete,definitive_association_allowed:resolution.definitive_association_allowed,native_case_id:resolution.definitive_association_allowed?resolution.matches[0].id:null,returned:data.cases?.length??0,provider_found:data.found??null,ambiguous_native_ids:resolution.matches.length>1?resolution.matches.map(x=>x.id):[],publisher_native_merge:false};if(resolution.definitive_association_allowed){const id=resolution.matches[0].id,list=native.get(id)??{native_case_id:id,source_targets:[]};list.source_targets.push(target);native.set(id,list);}}
  catch(error){state.errors.push({stage:'exact_search',courtlistener_docket_id:target.courtlistener_docket_id,error_type:safeError(error)});}finally{await save();}
 }),{concurrency:3,shouldStop:()=>Boolean(state.stop_reason)});
 await runSettledWorkers([...native.values()].filter(x=>state.cases[x.native_case_id]?.status!=='captured').map(candidate=>async()=>{
  const id=candidate.native_case_id;try{if(!candidateSourcesAgree([...candidate.source_targets,...plan.excluded.filter(x=>x.native_case_id===id)]))throw Error('CONTRADICTORY_PROVIDER_IDENTITY_REFERENCES');let h;if(candidate.source_targets.every(x=>x.action==='native_sheet')){const target=candidate.source_targets[0],stored=await capture(target.header_capture_file);if(stored?.file_sha256!==target.header_capture_sha256||stored.tool!=='get_case'||stored.args.case_id!==id)throw Error('PINNED_HEADER_CHANGED');h=stored.data;}else h=await call('get_case',{case_id:id});if(!candidate.source_targets.every(x=>headerMatches(x.source,id,h.case)))throw Error('SOURCE_QUALIFIED_NATIVE_HEADER_MISMATCH');const recent=await call('get_docket_sheet',{case_id:id,sort:'recent'}),oldest=recent.entries_total>recent.entries_returned?await call('get_docket_sheet',{case_id:id,sort:'chronological'}):null;const{documents,...coverage}=docketSheetMetadataCoverage(id,recent,oldest);state.cases[id]={status:'captured',native_case_id:id,source_targets:candidate.source_targets,header_exact_reference_verified:true,header_observation:candidate.source_targets.every(x=>x.action==='native_sheet')?'pinned_prior_capture':'new_capture',...coverage,native_document_ids:[...documents.keys()],publisher_native_merge:false};}
  catch(error){state.cases[id]={status:'held',native_case_id:id,source_targets:candidate.source_targets,error_type:safeError(error)};}finally{await save();}
 }),{concurrency:3,shouldStop:()=>Boolean(state.stop_reason)});
 state.finished_at=new Date().toISOString();state.status=state.stop_reason?'partial_stopped_with_originals':'bounded_source_capture_finished';await save();console.log(JSON.stringify({status:state.status,rpc_attempts:state.rpc_attempts,stop_reason:state.stop_reason??null,search_scopes:Object.keys(state.searches).length,captured_native_cases:Object.values(state.cases).filter(x=>x.status==='captured').length,pdf_downloads:0,full_portfolio_verified:false}));return state;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const mode=process.argv[2];if(mode==='--prepare'){const plan=await preparePlan(),dir=plan.cache_directory;await fs.mkdir(dir,{recursive:true});const filename=process.argv[3]??'collection-plan-v1.json';if(!/^collection-plan-v\d+\.json$/.test(filename))throw Error('PLAN_FILENAME_REQUIRED');const file=path.join(dir,filename),bytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');await fs.writeFile(file,bytes,{flag:'wx'});console.log(JSON.stringify({plan_file:file,plan_sha256:sha(bytes),...plan.counts,rpc_ceiling:RPC_CEILING,concurrency:3,api_calls:0}));}
 else if(mode==='--execute'&&process.argv[3])await executePlan(process.argv[3],process.argv.find(x=>x.startsWith('--plan-sha256='))?.slice(14));else throw Error('Use --prepare offline, or root-reviewed --execute <pinned-plan> --plan-sha256=<reviewed-sha256>');
}
