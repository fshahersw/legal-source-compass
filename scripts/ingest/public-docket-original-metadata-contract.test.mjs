import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PAGINATION_CAPTURE_STATE_SHA256,validatePaginationMetadataPlanRow,validatePaginationOriginalMetadataBytes} from './public-docket-original-metadata-contract.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const root='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/firecrawl-dockets/pagination-v1/';
const bard='https://www.courtlistener.com/docket/67678440/in-re-bard-implanted-port-catheter-products-liability-litigation/?page=2';
const apple='https://www.courtlistener.com/docket/68869775/apple-inc-smartphone-antitrust-litigation/?page=2';
function fixture(provider='firecrawl'){
 const html='<html><body>Public docket fixture</body></html>',markdown='Public docket fixture';
 const structured=provider==='firecrawl'
  ?{rawHtml:html,metadata:{statusCode:200,sourceURL:bard,url:bard,contentType:'text/html; charset=utf-8'}}
  :{results:[{url:bard,title:'Fixture',raw_content:markdown}],failed_results:[{url:apple,error:'Failed to fetch url'}]};
 const cap={requested_at:'2026-10-02T14:00:00.000Z',returned_at:'2026-10-02T14:00:01.000Z',result:{structuredContent:structured,content:[{type:'text',text:JSON.stringify(structured)}]}};
 if(provider==='firecrawl'){cap.requested_url=bard;cap.native_case_id='67678440';}else cap.requested_urls=[bard,apple];
 const bytes=Buffer.from(JSON.stringify(cap)),digest=sha(bytes),body=provider==='firecrawl'?html:markdown;
 const row={provider,metadata_kind:provider==='firecrawl'?'courtlistener_firecrawl_pagination_html_json':'courtlistener_tavily_pagination_markdown_json',
  local_path:root+(provider==='firecrawl'?'originals/original-67678440-page-2.json':'tavily-extract-03-original.json'),
  source_url:bard,source_urls:provider==='firecrawl'?[bard]:[bard,apple],sha256:digest,bytes:bytes.length,
  storage_key:'seeger-weiss/metadata-sha256/'+digest.slice(0,2)+'/'+digest+'.json',capture_state_sha256:PAGINATION_CAPTURE_STATE_SHA256,
  private_original_evidence:true,public_projection_allowed:false,failed_result_count:provider==='firecrawl'?0:1,
  successful_source_pages:[{native_case_id:'67678440',source_url:bard,provider_result_ordinal:provider==='firecrawl'?null:1,
   source_format:provider==='firecrawl'?'firecrawl_returned_raw_html':'provider_cleaned_markdown',http_status:provider==='firecrawl'?200:null,
   source_content_sha256:sha(body),source_content_utf8_bytes:Buffer.byteLength(body)}]};
 return{row,cap,bytes};
}
function repin(row,cap){const bytes=Buffer.from(JSON.stringify(cap));row.bytes=bytes.length;row.sha256=sha(bytes);row.storage_key='seeger-weiss/metadata-sha256/'+row.sha256.slice(0,2)+'/'+row.sha256+'.json';return bytes;}

test('accepts exact full HTML and partial Tavily wrappers without inventing an HTTP status',()=>{
 for(const provider of ['firecrawl','tavily']){const x=fixture(provider);assert.equal(validatePaginationMetadataPlanRow(x.row),x.row);assert.equal(validatePaginationOriginalMetadataBytes(x.row,x.bytes).successful_source_pages,1);}
});
test('rejects a native parent inconsistent with the source URL',()=>{
 const x=fixture();x.row.successful_source_pages[0].native_case_id='68869775';assert.throws(()=>validatePaginationMetadataPlanRow(x.row),/PAGINATION_SOURCE_PAGE_PROOF_INVALID/);
});
test('rejects paths outside the exact private pagination root and unapproved Tavily filenames',()=>{
 const x=fixture();x.row.local_path='C:/Users/firas/Downloads/original-67678440-page-2.json';assert.throws(()=>validatePaginationMetadataPlanRow(x.row),/PAGINATION_ORIGINAL_PATH_INVALID/);
 const y=fixture('tavily');y.row.local_path=root+'tavily-extract-99-original.json';assert.throws(()=>validatePaginationMetadataPlanRow(y.row),/PAGINATION_TAVILY_FILENAME_MISMATCH/);
});
test('rejects a page different from the exact source filename',()=>{
 const x=fixture();x.row.source_url=bard.replace('page=2','page=3');x.row.source_urls=[x.row.source_url];x.row.successful_source_pages[0].source_url=x.row.source_url;
 assert.throws(()=>validatePaginationMetadataPlanRow(x.row),/PAGINATION_FIRECRAWL_FILENAME_MISMATCH/);
});
test('rejects a credential query or extra pagination parameter',()=>{
 for(const suffix of ['&token=fixture','&q=extra']){const x=fixture();x.row.source_url+=suffix;x.row.source_urls=[x.row.source_url];x.row.successful_source_pages[0].source_url=x.row.source_url;assert.throws(()=>validatePaginationMetadataPlanRow(x.row),/PAGINATION_SOURCE_LOCATOR_INVALID/);}
});
test('rejects altered raw source bytes and fabricated body digest',()=>{
 const x=fixture();assert.throws(()=>validatePaginationOriginalMetadataBytes(x.row,Buffer.concat([x.bytes,Buffer.from(' ')])),/PAGINATION_ORIGINAL_BYTES_MISMATCH/);
 x.row.successful_source_pages[0].source_content_sha256='0'.repeat(64);assert.throws(()=>validatePaginationOriginalMetadataBytes(x.row,x.bytes),/PAGINATION_FIRECRAWL_BODY_PROOF_MISMATCH/);
});
test('rejects Tavily result ordinal, invented HTTP status and partial failure count',()=>{
 const a=fixture('tavily');a.row.successful_source_pages[0].provider_result_ordinal=2;assert.throws(()=>validatePaginationOriginalMetadataBytes(a.row,a.bytes),/PAGINATION_TAVILY_BODY_PROOF_MISMATCH/);
 const b=fixture('tavily');b.row.successful_source_pages[0].http_status=200;assert.throws(()=>validatePaginationOriginalMetadataBytes(b.row,b.bytes),/PAGINATION_TAVILY_BODY_PROOF_MISMATCH/);
 const c=fixture('tavily');c.row.failed_result_count=0;assert.throws(()=>validatePaginationOriginalMetadataBytes(c.row,c.bytes),/PAGINATION_TAVILY_PARTIAL_COUNT_MISMATCH/);
});
test('rejects credentials embedded only in repeated provider JSON text',()=>{
 const x=fixture('tavily');x.cap.result.content[0].text=JSON.stringify({...x.cap.result.structuredContent,api_key:'fixture'});const bytes=repin(x.row,x.cap);
 assert.throws(()=>validatePaginationOriginalMetadataBytes(x.row,bytes),/CREDENTIAL_FIELDS_IN_PAGINATION_ORIGINAL/);
});
test('rejects divergence between provider JSON text and structured result',()=>{
 const x=fixture();x.cap.result.content[0].text=JSON.stringify({...x.cap.result.structuredContent,rawHtml:'changed'});const bytes=repin(x.row,x.cap);
 assert.throws(()=>validatePaginationOriginalMetadataBytes(x.row,bytes),/PAGINATION_ORIGINAL_STRUCTURED_RETURN_MISMATCH/);
});
test('rejects an unrequested failed Tavily source and source parent in wrapper',()=>{
 const x=fixture('tavily');x.cap.result.structuredContent.failed_results=[{url:'https://www.courtlistener.com/docket/1/unrequested/?page=2',error:'Failed'}];x.cap.result.content[0].text=JSON.stringify(x.cap.result.structuredContent);const bytes=repin(x.row,x.cap);
 assert.throws(()=>validatePaginationOriginalMetadataBytes(x.row,bytes),/PAGINATION_UNREQUESTED_FAILED_RESULT/);
 const y=fixture();y.cap.native_case_id='68869775';assert.throws(()=>validatePaginationOriginalMetadataBytes(y.row,repin(y.row,y.cap)),/SUCCESSFUL_FIRECRAWL_PAGINATION_REQUIRED/);
});
