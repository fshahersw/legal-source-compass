import fs from 'node:fs/promises';
import path from 'node:path';
import{createHash}from'node:crypto';
export const RECENT_METADATA_KIND='docketbird_recent_mcp_capture_json';
export const RECENT_ROOT='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/docketbird/recent-expansion-v1';
export const RECENT_PLAN_SHA='ca2f0927cb38f69bda8e918a6ccfdee407bbf22e76573d6578205889159ed6f5';
export const RECENT_RUNTIME_SHA='5bd83d0d815487d959e1a1bb880de2ef3c425804862cee2a1a615ad447166e2b';
const norm=x=>path.resolve(x).replaceAll('\\','/').toLowerCase();
const sha=x=>createHash('sha256').update(x).digest('hex');
export function validateRecentMetadataRow(row,resolvedPath=row.local_path){
 if(row.metadata_kind!==RECENT_METADATA_KIND||row.provider!=='docketbird'||row.source_url!=='https://mcp.docketbird.com/mcp'||row.collector_plan_sha256!==RECENT_PLAN_SHA||row.collector_runtime_sha256!==RECENT_RUNTIME_SHA||!/^[a-f0-9]{64}$/.test(row.provider_response_sha256??'')||!new RegExp('^'+norm(RECENT_ROOT).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/captures/\\d+-'+row.provider_response_sha256+'\\.json$').test(norm(resolvedPath)))throw Error('RECENT_ORIGINAL_FIXED_SOURCE_BINDING_REQUIRED');
 return row;
}
export async function verifyRecentOriginalPlanBindings(plan,{readFile=fs.readFile,realpath=fs.realpath}={}){
 const rows=plan.files.filter(x=>x.metadata_kind===RECENT_METADATA_KIND);if(!rows.length)return;
 const source=plan.source_inputs;
 if(source?.collector_plan_sha256!==RECENT_PLAN_SHA||source?.collector_runtime_sha256!==RECENT_RUNTIME_SHA||norm(source.collector_plan_file??'')!==norm(RECENT_ROOT+'/collection-plan-v4.json')||norm(source.collector_runtime_file??'')!==norm(RECENT_ROOT+'/runtime-manifest.json'))throw Error('RECENT_ORIGINAL_PLAN_BINDING_REQUIRED');
 for(const file of[source.collector_plan_file,source.collector_runtime_file])if(norm(await realpath(file))!==norm(file))throw Error('RECENT_SOURCE_REALPATH_CHANGED');
 const planBytes=await readFile(source.collector_plan_file),runtimeBytes=await readFile(source.collector_runtime_file);
 if(sha(planBytes)!==RECENT_PLAN_SHA||sha(runtimeBytes)!==RECENT_RUNTIME_SHA)throw Error('RECENT_FROZEN_SOURCE_CHANGED');
 const collector=JSON.parse(planBytes),runtime=JSON.parse(runtimeBytes);
 if(runtime.plan_sha256!==RECENT_PLAN_SHA||runtime.status!=='bounded_source_capture_finished'||!runtime.finished_at||runtime.pdf_downloads!==0||runtime.document_text_downloads!==0||runtime.database_writes!==0)throw Error('RECENT_COMPLETED_SOURCE_REQUIRED');
 const searches=new Set(collector.targets.filter(x=>x.action==='exact_search').map(x=>x.source.court_id+'|'+x.source.docketNumber));
 for(const row of rows){
  validateRecentMetadataRow(row,await realpath(row.local_path));const bytes=await readFile(row.local_path);
  if(sha(bytes)!==row.sha256||bytes.length!==row.bytes)throw Error('RECENT_CAPTURE_HASH_CHANGED');
  const c=JSON.parse(bytes),args=c.params?.arguments??{},keys=Object.keys(args).sort().join('|');
  if(c.response_sha256!==row.provider_response_sha256||c.source_url!==row.source_url||c.method!=='tools/call'||c.http_status!==200||Date.parse(c.retrieved_at)<Date.parse(runtime.started_at)||Date.parse(c.retrieved_at)>Date.parse(runtime.finished_at))throw Error('RECENT_CAPTURE_SOURCE_CHANGED');
  if(c.params.name==='search_cases'){if(keys!=='court_id|q|size'||args.size!==100||!searches.has(args.court_id+'|'+args.q))throw Error('RECENT_SEARCH_OUTSIDE_PLAN');}
  else if(c.params.name==='get_case'){if(keys!=='case_id'||!runtime.cases[args.case_id])throw Error('RECENT_HEADER_OUTSIDE_RUN');}
  else if(c.params.name==='get_docket_sheet'){if(keys!=='case_id|sort'||!runtime.cases[args.case_id]||!['recent','chronological'].includes(args.sort))throw Error('RECENT_SHEET_OUTSIDE_RUN');}
  else throw Error('RECENT_TOOL_NOT_PERMITTED');
 }
}
