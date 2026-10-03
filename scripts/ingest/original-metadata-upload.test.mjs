import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {validateMetadataPlanRow,validateOriginalMetadataBytes,digestMetadataStream,ensureVerifiedMetadataObject,metadataStorageKey,verifyMetadataReadback,drainMetadataResponse,sanitizedMetadataError} from './upload-original-metadata-to-supabase.mjs';
import {nativeDocumentSourceVersionDisposition} from './native-document-version-contract.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
function capture(metadata={documents:[{pdf_url:'https://docketbird-case-documents.s3.amazonaws.com/file.pdf?AWSAccessKeyId=fixture&Signature=fixture&Expires=1'}]},name='get_docket_sheet'){
 const raw=JSON.stringify({jsonrpc:'2.0',id:1,result:{structuredContent:metadata,content:[{type:'text',text:JSON.stringify(metadata)}]}});
 const bytes=Buffer.from(JSON.stringify({schema_version:'docketbird-mcp-capture/1',source_url:'https://mcp.docketbird.com/mcp',http_status:200,method:'tools/call',params:{name},response_bytes:Buffer.byteLength(raw),response_sha256:hash(raw),original_rpc_response:raw}));
 return {bytes,row:{provider:'docketbird',metadata_kind:'docketbird_mcp_capture_json',local_path:'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/docketbird/master-probe/000001-'+hash(raw)+'.json',source_url:'https://mcp.docketbird.com/mcp',bytes:bytes.length,sha256:hash(bytes)}};
}
test('private signed native document locators survive original-byte validation unchanged',()=>{
 const x=capture();const before=Buffer.from(x.bytes);validateMetadataPlanRow(x.row);const proof=validateOriginalMetadataBytes(x.row,x.bytes);
 assert.deepEqual(x.bytes,before);assert.equal(proof.sha256,hash(before));assert.equal(proof.storage_key,metadataStorageKey(hash(before)));
});
test('credential/config and unrecognized capture scopes cannot enter an originals plan',()=>{
 const x=capture();
 for(const local_path of ['C:/Users/firas/.codex/private/legal-source-compass.preview.json','C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/docketbird/config.json','C:/Users/firas/.codex/corpus-cache-evil/seeger-weiss/2026-10-02/docketbird/master-probe/000001-'+x.row.sha256+'.json'])assert.throws(()=>validateMetadataPlanRow({...x.row,local_path}));
 assert.throws(()=>validateMetadataPlanRow({...x.row,storage_key:'another/object.json'}),/METADATA_STORAGE_KEY_MISMATCH/);
 assert.throws(()=>validateMetadataPlanRow({...x.row,bytes:6*1024**2+1}),/METADATA_PLAN_ROW_INVALID/);
});
test('CourtListener originals require native API endpoint and native payload, not provenance/config files',()=>{
 const bytes=Buffer.from('{"results":[{"id":12}],"next":null}');const row={provider:'courtlistener',metadata_kind:'courtlistener_native_api_json',local_path:'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T115000Z/api/'+hash(bytes)+'.json',source_url:'https://www.courtlistener.com/api/rest/v4/docket-entries/?docket=12',sha256:hash(bytes),bytes:bytes.length};
 validateMetadataPlanRow(row);validateOriginalMetadataBytes(row,bytes);
 validateMetadataPlanRow({...row,local_path:row.local_path.replace('.json','-'+row.sha256+'.json')});
 assert.throws(()=>validateMetadataPlanRow({...row,local_path:row.local_path.replace('.json','-'+'b'.repeat(64)+'.json')}),/VERSIONED_ORIGINAL_FILENAME_HASH_MISMATCH/);
 assert.throws(()=>validateMetadataPlanRow({...row,source_url:row.source_url+'&api_key=fixture'}),/CREDENTIAL_SOURCE_LOCATOR_HELD/);
 assert.throws(()=>validateMetadataPlanRow({...row,source_url:'https://www.courtlistener.com.evil.example/api/rest/v4/docket-entries/'}),/ORIGINAL_SOURCE_ORIGIN_INVALID/);
 assert.throws(()=>validateMetadataPlanRow({...row,local_path:row.local_path.replace('.json','.provenance.json')}),/UNAPPROVED_COURTLISTENER_ORIGINAL/);
 const other=Buffer.from('{"retrieved_at":"2026-10-02"}');assert.throws(()=>validateOriginalMetadataBytes({...row,sha256:hash(other),bytes:other.length},other),/NATIVE_API_PAYLOAD_REQUIRED/);
});
test('embedded text-only MCP credentials and authentication responses are rejected',()=>{
 for(const name of ['whoami','auth','tools/list']){const x=capture({},name);assert.throws(()=>validateOriginalMetadataBytes(x.row,x.bytes),/NATIVE_MCP_METADATA_CAPTURE_REQUIRED/);}
 const x=capture({api_key:'private-fixture'});assert.throws(()=>validateOriginalMetadataBytes(x.row,x.bytes),/CREDENTIAL_FIELDS_IN_ORIGINAL/);
 const raw=JSON.stringify({result:{content:[{type:'text',text:'{"access_token":"private-fixture"}'}]}});
 const value=JSON.parse(capture().bytes);Object.assign(value,{original_rpc_response:raw,response_bytes:Buffer.byteLength(raw),response_sha256:hash(raw)});const bytes=Buffer.from(JSON.stringify(value));
 assert.throws(()=>validateOriginalMetadataBytes({...capture().row,sha256:hash(bytes),bytes:bytes.length},bytes),/CREDENTIAL_FIELDS_IN_ORIGINAL/);
});
test('signed S3 access is limited to native pdf_url fields and the exact document host',()=>{
 for(const metadata of [{url:'https://docketbird-case-documents.s3.amazonaws.com/f.pdf?Signature=fixture'},{documents:[{pdf_url:'https://evil.example/f.pdf?Signature=fixture'}]},{documents:[{pdf_url:'https://docketbird-case-documents.s3.amazonaws.com/f.pdf?access_token=fixture'}]}]){
  const x=capture(metadata);assert.throws(()=>validateOriginalMetadataBytes(x.row,x.bytes),/UNAPPROVED_SIGNED_METADATA_LOCATOR|CREDENTIAL_SOURCE_LOCATOR_HELD/);
 }
});
test('both whole capture bytes and original provider response hashes are independently pinned',()=>{
 const x=capture();assert.throws(()=>validateOriginalMetadataBytes({...x.row,sha256:'a'.repeat(64)},x.bytes),/ORIGINAL_FILE_HASH_OR_SIZE_MISMATCH/);
 const value=JSON.parse(x.bytes);value.response_sha256='a'.repeat(64);const bytes=Buffer.from(JSON.stringify(value));assert.throws(()=>validateOriginalMetadataBytes({...x.row,sha256:hash(bytes),bytes:bytes.length},bytes),/ORIGINAL_PROVIDER_RESPONSE_MISMATCH/);
});
test('whole cloud readback requires exact bytes, hash and JSON, with a bounded stream',async()=>{
 const x=capture();const expected={bytes:x.bytes.length,sha256:hash(x.bytes)};
 assert.deepEqual(await digestMetadataStream(Readable.from([x.bytes.subarray(0,9),x.bytes.subarray(9)]),expected),expected);
 await assert.rejects(digestMetadataStream(Readable.from([x.bytes]),{...expected,bytes:expected.bytes+1}),/METADATA_CLOUD_HASH_OR_SIZE_MISMATCH/);
 await assert.rejects(digestMetadataStream(Readable.from([x.bytes]),{...expected,sha256:'a'.repeat(64)}),/METADATA_CLOUD_HASH_OR_SIZE_MISMATCH/);
 const nonJSON=Buffer.from('not json');await assert.rejects(digestMetadataStream(Readable.from([nonJSON]),{bytes:nonJSON.length,sha256:hash(nonJSON)}),/METADATA_CLOUD_JSON_INVALID/);
 await assert.rejects(digestMetadataStream(Readable.from([Buffer.alloc(6*1024**2+1)]),expected),/METADATA_CLOUD_SIZE_LIMIT/);
});
test('lost upload responses are recovered only by an independent exact-object verifier',async()=>{
 let reads=0,uploads=0;const result=await ensureVerifiedMetadataObject({verify:async()=>++reads===2,upload:async()=>{uploads++;throw Error('unknown network result');}});
 assert.equal(reads,2);assert.equal(uploads,1);assert.equal(result.upload_http_status,null);assert.equal(result.already_present_verified,false);
});
test('an absent unknown outcome retries at most once and records the gap',async()=>{
 const events=[];let uploads=0,reads=0,pauses=0;
 await assert.rejects(ensureVerifiedMetadataObject({verify:async()=>{reads++;return false;},upload:async()=>{uploads++;return null;},onEvent:async e=>events.push(e),pause:async()=>{pauses++;}}),/METADATA_UPLOAD_OUTCOME_UNRESOLVED/);
 assert.equal(uploads,2);assert.equal(reads,3);assert.equal(pauses,1);assert.equal(events.filter(x=>x.state==='metadata_absent_after_unknown_upload').length,1);
});
test('400/409 existing-object responses need a real readback; throttles and integrity failures never retry',async()=>{
 for(const status of [400,409]){let reads=0;const result=await ensureVerifiedMetadataObject({verify:async()=>++reads===2,upload:async()=>status});assert.equal(result.upload_http_status,status);}
 let uploads=0;await assert.rejects(ensureVerifiedMetadataObject({verify:async()=>false,upload:async()=>{uploads++;return 409;}}),/METADATA_UPLOAD_HTTP_409/);assert.equal(uploads,1);
 for(const status of [401,403,429]){let reads=0;await assert.rejects(ensureVerifiedMetadataObject({verify:async()=>++reads===2,upload:async()=>status}),new RegExp('METADATA_UPLOAD_HTTP_'+status));}
 let reads=0;await assert.rejects(ensureVerifiedMetadataObject({verify:async()=>{if(++reads===2)throw Error('METADATA_CLOUD_HASH_OR_SIZE_MISMATCH');return false;},upload:async()=>200}),/METADATA_CLOUD_HASH_OR_SIZE_MISMATCH/);
});
test('an existing exact object avoids upload but still undergoes independent verification',async()=>{
 let uploads=0;assert.deepEqual(await ensureVerifiedMetadataObject({verify:async()=>true,upload:async()=>{uploads++;return 200;}}),{upload_http_status:null,already_present_verified:true});assert.equal(uploads,0);
});
function interruptedRead(bytes){
 let pulls=0;
 return new Response(new ReadableStream({pull(controller){
  if(pulls++===0)controller.enqueue(bytes.subarray(0,9));
  else controller.error(Object.assign(new TypeError('terminated at a private URL that must not be recorded'),{cause:{code:'UND_ERR_SOCKET'}}));
 }}),{status:200});
}
test('terminated cloud read starts a fresh whole GET and verifies every byte before recovery',async()=>{
 const x=capture(),events=[];let reads=0,pauses=0;
 const verified=await verifyMetadataReadback({expected:x.row,fetchResponse:async()=>++reads===1?interruptedRead(x.bytes):new Response(x.bytes),onEvent:async e=>events.push(e),pause:async()=>{pauses++;}});
 assert.equal(verified,true);assert.equal(reads,2);assert.equal(pauses,1);
 assert.deepEqual(events,[{state:'metadata_verify_transport_retry',attempt:0,next_attempt:1,error_type:'TypeError',cause_code:'UND_ERR_SOCKET'}]);
 assert.ok(!JSON.stringify(events).includes('private URL'));
});
test('a changed replacement response cannot be accepted or retried after an interrupted read',async()=>{
 const x=capture();let reads=0;
 const changed=Buffer.from(x.bytes);changed[changed.length-2]^=1;
 await assert.rejects(verifyMetadataReadback({expected:x.row,fetchResponse:async()=>++reads===1?interruptedRead(x.bytes):new Response(changed),pause:async()=>{}}),/METADATA_CLOUD_HASH_OR_SIZE_MISMATCH/);
 assert.equal(reads,2);
});
test('readback retries are bounded to three attempts and preserve safe transport diagnostics',async()=>{
 let reads=0,pauses=0;const events=[];
 const network=Object.assign(new TypeError('https://secret-host/path?token=private'),{cause:{code:'ECONNRESET'}});
 await assert.rejects(verifyMetadataReadback({expected:{},fetchResponse:async()=>{reads++;throw network;},onEvent:async e=>events.push(e),pause:async()=>{pauses++;}}),/METADATA_VERIFY_TRANSIENT_EXHAUSTED/);
 assert.equal(reads,3);assert.equal(pauses,2);assert.equal(events.length,2);
 assert.deepEqual(sanitizedMetadataError(network),{error_type:'TypeError',cause_code:'ECONNRESET'});
 assert.deepEqual(sanitizedMetadataError({name:'https://private.example',message:'secret',cause:{code:'private-token'}}),{error_type:'UnknownError',cause_code:null});
 assert.ok(!JSON.stringify(events).includes('secret-host'));
});
test('absence, denial, malformed JSON and TLS failure never become a successful retry or overwrite',async()=>{
 const x=capture();let reads=0;
 assert.equal(await verifyMetadataReadback({expected:x.row,fetchResponse:async()=>{reads++;return new Response('{"message":"Object not found"}',{status:404});}}),false);assert.equal(reads,1);
 for(const status of [400,401,403,429]){
  let count=0;await assert.rejects(verifyMetadataReadback({expected:x.row,fetchResponse:async()=>{count++;return new Response('{"error":"denied"}',{status});},pause:async()=>{throw Error('No retry expected');}}),new RegExp('METADATA_VERIFY_HTTP_'+status));assert.equal(count,1);
 }
 const nonJSON=Buffer.from('not json');let count=0;await assert.rejects(verifyMetadataReadback({expected:{bytes:nonJSON.length,sha256:hash(nonJSON)},fetchResponse:async()=>{count++;return new Response(nonJSON);}}),/METADATA_CLOUD_JSON_INVALID/);assert.equal(count,1);
 count=0;await assert.rejects(verifyMetadataReadback({expected:x.row,fetchResponse:async()=>{count++;throw Object.assign(new TypeError('TLS host value withheld'),{cause:{code:'ERR_TLS_CERT_ALTNAME_INVALID'}});}}),/TLS host/);assert.equal(count,1);
});
test('bounded successful POST response draining consumes the full body without canceling',async()=>{
 const response=new Response('{"Key":"private-CAS-key"}');const bytes=await drainMetadataResponse(response);
 assert.equal(bytes.toString(),'{"Key":"private-CAS-key"}');assert.equal(response.bodyUsed,true);
 await assert.rejects(drainMetadataResponse(new Response(Buffer.alloc(65537))),/METADATA_RESPONSE_BODY_LIMIT/);
 let reads=0;const error=Object.assign(new TypeError('terminated'),{upload_http_status:429,cause:{code:'UND_ERR_SOCKET'}});
 await assert.rejects(ensureVerifiedMetadataObject({verify:async()=>++reads===2,upload:async()=>{throw error;}}),/METADATA_UPLOAD_HTTP_429/);assert.equal(reads,2);
});
test('transient server responses retry a fresh read but generic bad-request payloads do not imply absence',async()=>{
 const x=capture();let reads=0;
 assert.equal(await verifyMetadataReadback({expected:x.row,fetchResponse:async()=>++reads===1?new Response('{"error":"temporary"}',{status:503}):new Response(x.bytes),pause:async()=>{}}),true);assert.equal(reads,2);
 assert.equal(await verifyMetadataReadback({expected:x.row,fetchResponse:async()=>new Response('{"statusCode":"404","error":"not_found"}',{status:400})}),false);
});
test('new whole-docket originals require exact source/native-ID and successful HTML capture schema',()=>{
 const source_url='https://www.courtlistener.com/docket/123/source-docket/';
 const value={requested_url:source_url,native_case_id:'123',requested_at:'2026-10-02T14:29:17.581Z',returned_at:'2026-10-02T14:29:33.676Z',result:{structuredContent:{rawHtml:'<html><body>Private source evidence</body></html>',metadata:{statusCode:200,contentType:'text/html; charset=utf-8',sourceURL:source_url,url:source_url}}}};
 function fixture(v=value){const bytes=Buffer.from(JSON.stringify(v));return{bytes,row:{provider:'firecrawl',metadata_kind:'courtlistener_firecrawl_docket_html_json',local_path:'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/firecrawl-dockets/original-123.json',source_url,sha256:hash(bytes),bytes:bytes.length}};}
 const x=fixture();validateMetadataPlanRow(x.row);assert.equal(validateOriginalMetadataBytes(x.row,x.bytes).sha256,hash(x.bytes));
 assert.throws(()=>validateMetadataPlanRow({...x.row,local_path:x.row.local_path.replace('original-123','original-456')}),/UNAPPROVED_FIRECRAWL_DOCKET_ORIGINAL/);
 for(const patch of [{statusCode:403},{contentType:'application/pdf'},{sourceURL:'https://www.courtlistener.com/docket/456/other/'},{url:'https://www.courtlistener.com/docket/456/other/'}]){
  const next=structuredClone(value);Object.assign(next.result.structuredContent.metadata,patch);const y=fixture(next);assert.throws(()=>validateOriginalMetadataBytes(y.row,y.bytes),/NATIVE_FIRECRAWL_DOCKET_CAPTURE_REQUIRED|FIRECRAWL_NATIVE_DOCKET_REDIRECT_MISMATCH/);
 }
 const secret=structuredClone(value);secret.result.content=[{type:'text',text:'{"api_key":"private-fixture"}'}];const y=fixture(secret);assert.throws(()=>validateOriginalMetadataBytes(y.row,y.bytes),/CREDENTIAL_FIELDS_IN_ORIGINAL/);
});
test('tail deduplication compares native provider/parent/ID and metadata version without inferring PDF bytes',()=>{
 const row={provider:'docketbird',native_document_id:'case-1',native_case_id:'case',selected_source_record_sha256:'a'.repeat(64)};
 assert.equal(nativeDocumentSourceVersionDisposition(row),'new_native_identity');
 assert.equal(nativeDocumentSourceVersionDisposition(row,{...row}),'exact_native_source_version_duplicate');
 assert.equal(nativeDocumentSourceVersionDisposition({...row,selected_source_record_sha256:'b'.repeat(64)},row),'new_metadata_version');
 for(const patch of [{provider:'courtlistener'},{native_document_id:'another-document'},{native_case_id:'another-parent'}])assert.throws(()=>nativeDocumentSourceVersionDisposition(row,{...row,...patch}),/NATIVE_SOURCE_VERSION_IDENTITY_CONFLICT/);
 for(const selected_source_record_sha256 of [null,undefined,'a'.repeat(63)])assert.throws(()=>nativeDocumentSourceVersionDisposition({...row,selected_source_record_sha256},row),/NATIVE_SOURCE_VERSION_IDENTITY_REQUIRED/);
});
