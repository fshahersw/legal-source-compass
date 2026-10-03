import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecentMetadataRow,RECENT_ROOT,RECENT_PLAN_SHA,RECENT_RUNTIME_SHA,RECENT_METADATA_KIND}from'./recent-docketbird-original-contract.mjs';
import {privateDocumentEnvelope}from'./prepare-docketbird-recent-packets.mjs';
const responseSha='a'.repeat(64);
const row={provider:'docketbird',metadata_kind:RECENT_METADATA_KIND,source_url:'https://mcp.docketbird.com/mcp',local_path:RECENT_ROOT+'/captures/000003-'+responseSha+'.json',collector_plan_sha256:RECENT_PLAN_SHA,collector_runtime_sha256:RECENT_RUNTIME_SHA,provider_response_sha256:responseSha};
test('recent original allowance is fixed to the reviewed plan/run and response-hash filename',()=>{
 assert.equal(validateRecentMetadataRow(row),row);
 for(const patch of[{collector_runtime_sha256:'b'.repeat(64)},{collector_plan_sha256:'c'.repeat(64)},{local_path:RECENT_ROOT+'/captures/config.json'},{local_path:RECENT_ROOT+'/other/000003-'+responseSha+'.json'},{local_path:RECENT_ROOT+'/captures/000003-'+'b'.repeat(64)+'.json'},{source_url:'https://evil.example/mcp'}])assert.throws(()=>validateRecentMetadataRow({...row,...patch}),/FIXED_SOURCE_BINDING/);
});
const caseId='njd-2:2026-cv-08564';
function fixture(doc={}){return{file:RECENT_ROOT+'/captures/000010-'+responseSha+'.json',file_sha256:'b'.repeat(64),file_bytes:1200,capture:{source_url:'https://mcp.docketbird.com/mcp',response_sha256:responseSha,response_bytes:1000,retrieved_at:'2026-10-02T15:27:00Z',params:{arguments:{case_id:caseId,sort:'recent'}}},value:{documents:[{id:caseId+'-00001',primary_docket_sheet_number:0,filing_date:null,restricted:false,downloaded:0,title:'Private case description',pdf_url:'https://docketbird-case-documents.s3.amazonaws.com/doc.pdf?AWSAccessKeyId=fixture-value&Signature=fixture-value',canonical_url:'https://www.docketbird.com/doc?user_id=private-user',...doc}]}};}
test('private document evidence retains native IDs and zero/false while withholding signed and personalized values',()=>{
 const envelope=privateDocumentEnvelope(fixture(),0,[{native_courtlistener_docket_id:'42'}]),encoded=JSON.stringify(envelope);
 assert.equal(envelope.native_id,caseId+'-00001');assert.equal(envelope.data.native_case_id,caseId);assert.equal(envelope.data.source_primary_docket_sheet_number,0);assert.equal(envelope.data.source_provider_downloaded_indicator,0);assert.equal(envelope.data.source_restricted,false);
 assert.equal(envelope.data.source_pdf_locator_signed,true);assert.equal(envelope.data.source_canonical_locator_personalized,true);assert.equal(envelope.data.public_projection_allowed,false);assert.equal(encoded.includes('fixture-value'),false);assert.equal(encoded.includes('private-user'),false);assert.equal(encoded.includes('Private case description'),false);assert.equal('pdf_url'in envelope.data,false);
});
test('a native document from another parent and an unapproved locator origin stay held',()=>{
 assert.throws(()=>privateDocumentEnvelope(fixture({id:'nysd-1:2026-cv-00001-00001'}),0,[]),/PARENT_MISMATCH/);
 assert.throws(()=>privateDocumentEnvelope(fixture({pdf_url:'https://evil.example/doc.pdf'}),0,[]),/LOCATOR_ORIGIN/);
 assert.throws(()=>privateDocumentEnvelope(fixture({canonical_url:'https://evil.example/doc'}),0,[]),/LOCATOR_ORIGIN/);
});
