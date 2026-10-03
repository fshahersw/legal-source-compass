import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export class DocketBirdClient {
 constructor(cache){this.cache=cache;this.sequence=0;this.endpoint='https://mcp.docketbird.com/mcp';}
 async initialize(){
  try{this.token=execFileSync('C:/Users/firas/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['C:/Users/firas/.codex/private/read-docketbird-oauth.py'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:30000});}
  catch{throw new Error('DocketBird credential loading failed; credential details withheld');}
  await fs.mkdir(this.cache,{recursive:true});
  const hello=await this.rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'compass-metadata-intake',version:'1.0.0'}});
  this.protocol=hello.protocolVersion;await this.rpc('notifications/initialized',{},false);
  const list=await this.rpc('tools/list',{});this.tools=new Map(list.tools.map(x=>[x.name,x]));return list;
 }
 async rpc(method,params,hasId=true){
  const id=hasId?++this.sequence:null;
  const body=JSON.stringify({jsonrpc:'2.0',...(hasId?{id}:{}),method,params});
  const headers={Authorization:'Bearer '+this.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  if(this.session)headers['Mcp-Session-Id']=this.session;if(this.protocol)headers['MCP-Protocol-Version']=this.protocol;
  const r=await fetch(this.endpoint,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(120000)});
  if(r.headers.get('mcp-session-id'))this.session=r.headers.get('mcp-session-id');
  const bytes=Buffer.from(await r.arrayBuffer());const raw=bytes.toString('utf8');
  if(!r.ok)throw new Error('DocketBird MCP HTTP '+r.status);
  if(!hasId)return null;
  let messages;if(r.headers.get('content-type')?.includes('event-stream'))messages=raw.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>JSON.parse(x.slice(5).trim()));else messages=[JSON.parse(raw)];
  const msg=messages.find(x=>x.id===id);if(!msg||msg.error)throw new Error('DocketBird MCP protocol error');
  const hash=createHash('sha256').update(bytes).digest('hex');
  // Credentials, auth responses and request headers never enter the capture.
  if(method==='tools/list'||method==='tools/call')await fs.writeFile(path.join(this.cache,String(id).padStart(6,'0')+'-'+hash+'.json'),JSON.stringify({schema_version:'docketbird-mcp-capture/1',retrieved_at:new Date().toISOString(),source_url:this.endpoint,method,params,response_sha256:hash,response_bytes:bytes.length,http_status:r.status,original_rpc_response:raw},null,2),{flag:'wx'});
  return msg.result;
 }
 async call(name,args){
  const allowed=new Set(['search_cases','get_case','get_docket_sheet','get_document','find_litigation_relationships','whoami','list_my_cases','find_court','list_court_systems']);
  if(!allowed.has(name)||this.tools.get(name)?.annotations?.readOnlyHint!==true)throw Error('Only verified metadata tools are permitted');
  return this.rpc('tools/call',{name,arguments:args});
 }
}

if(process.argv[1]?.replaceAll('\\','/').endsWith('/docketbird-mcp-client.mjs')){
 const c=new DocketBirdClient('C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/docketbird');
 try{const list=await c.initialize();console.log(JSON.stringify(list,null,2));}catch{console.error('DocketBird MCP initialization failed; credential details withheld.');process.exitCode=1;}
}
