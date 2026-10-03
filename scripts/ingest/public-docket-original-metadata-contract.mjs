import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

// Narrow extension proposal for the separate frozen pagination source plan.
// It does not modify or call the existing metadata uploader.
export const PAGINATION_CAPTURE_STATE_SHA256='6e943e670054194d45467c7b76dd24cb1e581a49e56740e4dbf2842425ed340f';
const PREFIX='c:/users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/firecrawl-dockets/pagination-v1/';
const MAX_BYTES=6*1024**2;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const normalize=p=>path.resolve(p).replaceAll('\\','/').toLowerCase();
function requireRule(ok,code){if(!ok)throw Error(code);}
function docketURL(value){
 const u=new URL(value);
 requireRule(u.origin==='https://www.courtlistener.com'&&!u.username&&!u.password&&!u.hash,'PAGINATION_SOURCE_ORIGIN_INVALID');
 const m=u.pathname.match(/^\/docket\/([1-9][0-9]*)\/[a-z0-9-]+\/$/);
 const keys=[...u.searchParams.keys()];const page=u.searchParams.get('page');
 requireRule(m&&keys.length===1&&keys[0]==='page'&&/^[1-9][0-9]*$/.test(page??'')&&Number(page)>=2,'PAGINATION_SOURCE_LOCATOR_INVALID');
 return{native_case_id:m[1],page:Number(page),url:u.href};
}
function inspectCredentials(value){
 if(Array.isArray(value)){for(const x of value)inspectCredentials(x);return;}
 if(value&&typeof value==='object'){
  for(const [key,x]of Object.entries(value)){
   requireRule(!/^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|external_supabase_key|courtlistener_api_key|firecrawl_api_key)$/i.test(key),'CREDENTIAL_FIELDS_IN_PAGINATION_ORIGINAL');inspectCredentials(x);
  }
 }else if(typeof value==='string'){
  requireRule(!/(?:sb_secret_[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9_.-]{20,})/.test(value),'CREDENTIAL_VALUE_IN_PAGINATION_ORIGINAL');
  if(value.startsWith('https://')){
   let u;try{u=new URL(value);}catch{throw Error('PAGINATION_ORIGINAL_URL_INVALID');}
   requireRule(!u.username&&!u.password,'CREDENTIAL_LOCATOR_IN_PAGINATION_ORIGINAL');
   requireRule(![...u.searchParams.keys()].some(k=>/^(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|token|AWSAccessKeyId|Signature|X-Amz-(?:Credential|Signature|Security-Token))$/i.test(k)),'CREDENTIAL_LOCATOR_IN_PAGINATION_ORIGINAL');
  }
 }
}
export function validatePaginationMetadataPlanRow(row,resolvedPath=row?.local_path){
 requireRule(row&&['firecrawl','tavily'].includes(row.provider)&&typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256)&&Number.isSafeInteger(row.bytes)&&row.bytes>=2&&row.bytes<=MAX_BYTES&&typeof row.local_path==='string'&&path.isAbsolute(row.local_path),'PAGINATION_METADATA_PLAN_ROW_INVALID');
 requireRule(row.capture_state_sha256===PAGINATION_CAPTURE_STATE_SHA256&&row.private_original_evidence===true&&row.public_projection_allowed===false,'PAGINATION_FROZEN_SOURCE_SCOPE_REQUIRED');
 const local=normalize(resolvedPath);requireRule(local.startsWith(PREFIX),'PAGINATION_ORIGINAL_PATH_INVALID');
 requireRule(Array.isArray(row.source_urls)&&row.source_urls.length>=1&&row.source_urls.length<=3&&row.source_url===row.source_urls[0]&&new Set(row.source_urls).size===row.source_urls.length,'PAGINATION_EXACT_REQUEST_LIST_REQUIRED');
 const urls=row.source_urls.map(docketURL);requireRule(Array.isArray(row.successful_source_pages)&&row.successful_source_pages.length>=1&&row.successful_source_pages.length<=row.source_urls.length,'PAGINATION_SUCCESS_PAGE_LIST_REQUIRED');
 for(const page of row.successful_source_pages){
  const locator=docketURL(page.source_url);
  requireRule(row.source_urls.includes(page.source_url)&&locator.native_case_id===page.native_case_id&&typeof page.source_content_sha256==='string'&&/^[a-f0-9]{64}$/.test(page.source_content_sha256)&&Number.isSafeInteger(page.source_content_utf8_bytes)&&page.source_content_utf8_bytes>0,'PAGINATION_SOURCE_PAGE_PROOF_INVALID');
 }
 if(row.provider==='firecrawl'){
  const m=local.slice(PREFIX.length).match(/^originals\/original-([1-9][0-9]*)-page-([1-9][0-9]*)\.json$/);
  requireRule(row.metadata_kind==='courtlistener_firecrawl_pagination_html_json'&&m&&urls.length===1&&urls[0].native_case_id===m[1]&&urls[0].page===Number(m[2]),'PAGINATION_FIRECRAWL_FILENAME_MISMATCH');
 }else requireRule(row.metadata_kind==='courtlistener_tavily_pagination_markdown_json'&&/^tavily-extract-(?:0[1-9]|1[0-3])-original\.json$/.test(local.slice(PREFIX.length)),'PAGINATION_TAVILY_FILENAME_MISMATCH');
 requireRule(row.storage_key==='seeger-weiss/metadata-sha256/'+row.sha256.slice(0,2)+'/'+row.sha256+'.json','PAGINATION_STORAGE_KEY_MISMATCH');return row;
}
export function validatePaginationOriginalMetadataBytes(row,bytes){
 validatePaginationMetadataPlanRow(row);requireRule(bytes.length===row.bytes&&sha(bytes)===row.sha256,'PAGINATION_ORIGINAL_BYTES_MISMATCH');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('PAGINATION_ORIGINAL_JSON_INVALID');}
 requireRule(value&&typeof value==='object'&&!Array.isArray(value)&&!value.result?.isError&&Number.isFinite(Date.parse(value.requested_at))&&Number.isFinite(Date.parse(value.returned_at)),'SUCCESSFUL_PAGINATION_CAPTURE_REQUIRED');
 inspectCredentials(value);const data=value.result?.structuredContent;requireRule(data&&typeof data==='object','PAGINATION_STRUCTURED_RETURN_REQUIRED');
 const embedded=[];
 for(const block of value.result.content??[])if(block.type==='text'&&typeof block.text==='string'){
  let x;try{x=JSON.parse(block.text);}catch{continue;}inspectCredentials(x);embedded.push(x);
 }
 requireRule(embedded.some(x=>isDeepStrictEqual(x,data)),'PAGINATION_ORIGINAL_STRUCTURED_RETURN_MISMATCH');
 if(row.provider==='firecrawl'){
  const locator=docketURL(value.requested_url);
  requireRule(value.requested_url===row.source_url&&String(value.native_case_id)===locator.native_case_id&&data.metadata?.statusCode===200&&data.metadata.sourceURL===row.source_url&&/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(data.metadata.contentType??'')&&typeof data.rawHtml==='string'&&data.rawHtml.trim(),'SUCCESSFUL_FIRECRAWL_PAGINATION_REQUIRED');
  if(data.metadata.url!==undefined)requireRule(data.metadata.url===row.source_url,'PAGINATION_NATIVE_REDIRECT_MISMATCH');
  requireRule(row.successful_source_pages.length===1&&row.successful_source_pages[0].http_status===200&&row.successful_source_pages[0].source_format==='firecrawl_returned_raw_html'&&sha(Buffer.from(data.rawHtml))===row.successful_source_pages[0].source_content_sha256&&Buffer.byteLength(data.rawHtml)===row.successful_source_pages[0].source_content_utf8_bytes,'PAGINATION_FIRECRAWL_BODY_PROOF_MISMATCH');
 }else{
  requireRule(isDeepStrictEqual(value.requested_urls,row.source_urls)&&Array.isArray(data.results)&&data.results.length>=1&&data.results.length<=row.source_urls.length&&Array.isArray(data.failed_results),'PAGINATION_TAVILY_REQUEST_RESULT_REQUIRED');
  requireRule(data.results.length===row.successful_source_pages.length,'PAGINATION_TAVILY_SUCCESS_COUNT_MISMATCH');
  for(const page of row.successful_source_pages){
   const native=data.results[page.provider_result_ordinal-1];
   requireRule(native&&native.url===page.source_url&&typeof native.raw_content==='string'&&native.raw_content.trim()&&page.http_status===null&&page.source_format==='provider_cleaned_markdown'&&sha(Buffer.from(native.raw_content))===page.source_content_sha256&&Buffer.byteLength(native.raw_content)===page.source_content_utf8_bytes,'PAGINATION_TAVILY_BODY_PROOF_MISMATCH');
  }
  requireRule(data.failed_results.length===row.failed_result_count,'PAGINATION_TAVILY_PARTIAL_COUNT_MISMATCH');
  for(const failed of data.failed_results)requireRule(row.source_urls.includes(failed.url),'PAGINATION_UNREQUESTED_FAILED_RESULT');
 }
 return{bytes:bytes.length,sha256:row.sha256,storage_key:row.storage_key,successful_source_pages:row.successful_source_pages.length};
}
