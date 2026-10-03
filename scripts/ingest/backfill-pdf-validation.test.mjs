import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {validateQueueRow,sourcePrivacyQualification,digestStream} from './backfill-pdfs-to-supabase.mjs';

const digest='a'.repeat(64),otherDigest='b'.repeat(64);
function publicLocator(){const url='https://storage.courtlistener.com/recap/gov.uscourts.test.123.4.0.pdf';return {...source(),provider:'courtlistener-public-locator',native_document_id:url,native_document_identity_kind:'publisher_observed_pdf_locator_url',native_case_id:'12345',durable_url:url,download_url:url,provider_flags:{public_pdf_link_observed:true,sealing_related_locator_held:false,backend_api_id_verified:false,api_availability_verified:false},origins:[{native_record_sha256:digest,retrieved_at:'2026-10-02T13:44:47.216Z',native_case_id:'12345'}]};}
test('published public PDF URL identity remains distinct from an unverified API document ID',()=>{
 const row=publicLocator();assert.equal(validateQueueRow(row).native_document_id,row.download_url);assert.deepEqual(sourcePrivacyQualification(row),{source_seal_status:'unknown',private_quarantine_required:true,public_projection_allowed:false});
 for(const changed of [{native_document_id:'98765'},{native_document_identity_kind:'courtlistener_native_document_id'},{provider_flags:{...row.provider_flags,backend_api_id_verified:true}},{provider_flags:{...row.provider_flags,sealing_related_locator_held:true}}])assert.throws(()=>validateQueueRow({...row,...changed}),/PUBLIC_LOCATOR_IDENTITY_OR_EVIDENCE_MISMATCH/);
});
test('public locator branch rejects credential queries and scope-changing source parents',()=>{
 const row=publicLocator(),url=row.download_url+'?token=withheld';assert.throws(()=>validateQueueRow({...row,native_document_id:url,durable_url:url,download_url:url}),/PUBLIC_RECAP_LOCATOR_REQUIRED/);
 assert.throws(()=>validateQueueRow({...row,native_case_id:'77777'}),/SOURCE_NATIVE_CASE_MISMATCH/);
});
function source(){return{schema_version:'source-qualified-pdf-queue/1',provider:'docketbird',native_document_id:'njd-2:2024-md-03113-10',native_case_id:'njd-2:2024-md-03113',eligible:true,download_url:'https://docketbird-case-documents.s3.amazonaws.com/document.pdf',provider_flags:{restricted:false,downloaded:1},selected_source_record_sha256:digest,origins:[{native_record_sha256:digest,retrieved_at:'2026-10-02T13:44:47.216Z',native_case_id:'njd-2:2024-md-03113'}]};}
test('DocketBird state c-/d- identities require an explicitly observed matching parent',()=>{
 const row=source();row.native_case_id='c-nynew-2021-950535/2021';row.native_document_id='d-nynew-2021-950535/2021-00054';row.origins[0].native_case_id=row.native_case_id;
 assert.equal(validateQueueRow(row),row);
 assert.throws(()=>validateQueueRow({...row,native_document_id:'d-nynew-2021-950498/2021-00054'}),/RESTRICTED_OR_UNAVAILABLE_PDF/);
 const missing=structuredClone(row);delete missing.origins[0].native_case_id;assert.throws(()=>validateQueueRow(missing),/RESTRICTED_OR_UNAVAILABLE_PDF/);
 assert.throws(()=>validateQueueRow({...row,provider_flags:{restricted:true,downloaded:1}}),/RESTRICTED_OR_UNAVAILABLE_PDF/);
 assert.equal(validateQueueRow(source()).native_case_id,'njd-2:2024-md-03113');
});
test('eligible flag must be boolean true before a queued transfer can start',()=>{
 assert.equal(validateQueueRow(source()).eligible,true);
 for(const eligible of ['true','false',1,false,null,undefined])assert.throws(()=>validateQueueRow({...source(),eligible}),/PDF_ROW_NOT_ELIGIBLE/);
});
test('DocketBird search-provided download locator preserves unknown restriction status',()=>{
 const row=source();row.provider_flags={restricted:null,downloaded:null,availability_evidence:'publisher_search_pdf_locator',search_pdf_url_observed:true,sealing_related_locator_held:false};row.origins[0].source_tool='search_documents';
 assert.equal(validateQueueRow(row),row);assert.equal(sourcePrivacyQualification(row).private_quarantine_required,true);assert.equal(sourcePrivacyQualification(row).source_seal_status,'unknown');
 for(const changed of [{restricted:true},{restricted:undefined},{downloaded:undefined},{search_pdf_url_observed:false},{sealing_related_locator_held:true}])assert.throws(()=>validateQueueRow({...row,provider_flags:{...row.provider_flags,...changed}}),/RESTRICTED_OR_UNAVAILABLE_PDF/);
 const missing=structuredClone(row);delete missing.origins[0].source_tool;assert.throws(()=>validateQueueRow(missing),/RESTRICTED_OR_UNAVAILABLE_PDF/);
});
test('source version is tied to an actual retained native record observation',()=>{
 for(const hash of [undefined,null,'a'.repeat(63),'z'.repeat(64)]){
  const row=source();row.origins[0].native_record_sha256=hash;assert.throws(()=>validateQueueRow(row),/NATIVE_RECORD_SHA256_REQUIRED/);
 }
 assert.throws(()=>validateQueueRow({...source(),selected_source_record_sha256:otherDigest}),/SELECTED_SOURCE_VERSION_MISMATCH/);
 const row=source();row.origins.push({native_record_sha256:otherDigest,retrieved_at:'2026-10-02T13:43:47.216Z',native_case_id:row.native_case_id});
 assert.equal(validateQueueRow({...row,selected_source_record_sha256:otherDigest}).selected_source_record_sha256,otherDigest);
});
test('observation time and parent must remain source-qualified rather than guessed',()=>{
 const badTime=source();badTime.origins[0].retrieved_at='not a date';assert.throws(()=>validateQueueRow(badTime),/SOURCE_OBSERVATION_TIME_REQUIRED/);
 const wrongParent=source();wrongParent.origins[0].native_case_id='other-case';assert.throws(()=>validateQueueRow(wrongParent),/SOURCE_NATIVE_CASE_MISMATCH/);
});
test('available CourtListener PDF with unknown sealing remains explicitly private quarantine',()=>{
 const row={...source(),provider:'courtlistener',download_url:'https://storage.courtlistener.com/recap/source.pdf',provider_flags:{is_available:true,is_sealed:null}};
 const result=validateQueueRow(row);assert.equal(result.provider_flags.is_sealed,null);
 assert.deepEqual(sourcePrivacyQualification(result),{source_seal_status:'unknown',private_quarantine_required:true,public_projection_allowed:false});
 for(const is_sealed of [true,'true','false',undefined,0])assert.throws(()=>validateQueueRow({...row,provider_flags:{is_available:true,is_sealed}}),/SEALED_OR_UNAVAILABLE_PDF/);
 assert.equal(sourcePrivacyQualification(validateQueueRow({...row,provider_flags:{is_available:true,is_sealed:false}})).source_seal_status,'explicit_false');
});
test('source host, provider availability and native parent gates are enforced together',()=>{
 assert.throws(()=>validateQueueRow({...source(),download_url:'https://docketbird-case-documents.s3.amazonaws.com.evil.example/document.pdf'}),/PDF_HOST_NOT_ALLOWED/);
 assert.throws(()=>validateQueueRow({...source(),download_url:'https://user:pass@docketbird-case-documents.s3.amazonaws.com/document.pdf'}),/PDF_URL_INVALID/);
 assert.throws(()=>validateQueueRow({...source(),native_document_id:'other-case-10'}),/RESTRICTED_OR_UNAVAILABLE_PDF/);
 for(const restricted of [true,null,'false'])assert.throws(()=>validateQueueRow({...source(),provider_flags:{restricted,downloaded:1}}),/RESTRICTED_OR_UNAVAILABLE_PDF/);
 assert.throws(()=>validateQueueRow({...source(),provider_flags:{restricted:false,downloaded:0}}),/RESTRICTED_OR_UNAVAILABLE_PDF/);
});
test('advertised source size can disagree only when complete streamed bytes match source SHA1',async()=>{
 const bytes=Buffer.from('%PDF-1.7\nsynthetic streaming review fixture\n%%EOF\n');
 const expectedSha1=createHash('sha1').update(bytes).digest('hex');
 const result=await digestStream(Readable.from([bytes.subarray(0,7),bytes.subarray(7)]),{maxBytes:1024,expectedBytes:bytes.length+99,expectedSha1,allowSizeMismatchIfSha1Matches:true});
 assert.equal(result.bytes,bytes.length);assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(result.source_expected_bytes,bytes.length+99);assert.equal(result.source_size_claim_matched,false);assert.equal(result.source_sha1_claim_matched,true);
 await assert.rejects(digestStream(Readable.from([bytes]),{maxBytes:1024,expectedBytes:bytes.length+99,expectedSha1:'0'.repeat(40),allowSizeMismatchIfSha1Matches:true}),/SOURCE_SHA1_MISMATCH/);
 await assert.rejects(digestStream(Readable.from([bytes]),{maxBytes:1024,expectedBytes:bytes.length+99,expectedSha1:null,allowSizeMismatchIfSha1Matches:true}),/SOURCE_SIZE_MISMATCH/);
});
test('cloud reread remains strict to actual registered bytes even with a matching source hash',async()=>{
 const bytes=Buffer.from('%PDF-1.7\nstrict cloud reread fixture\n%%EOF\n');
 const expectedSha1=createHash('sha1').update(bytes).digest('hex');
 await assert.rejects(digestStream(Readable.from([bytes]),{maxBytes:1024,expectedBytes:bytes.length+1,expectedSha1}),/SOURCE_SIZE_MISMATCH/);
 const result=await digestStream(Readable.from([bytes]),{maxBytes:1024,expectedBytes:bytes.length,expectedSha1});
 assert.equal(result.source_size_claim_matched,true);assert.equal(result.bytes,bytes.length);
});
test('size disagreement policy never relaxes file bound or accepts a non-PDF response body',async()=>{
 const bytes=Buffer.from('%PDF-1.7\nmaximum byte guard fixture\n%%EOF\n');
 const expectedSha1=createHash('sha1').update(bytes).digest('hex');
 await assert.rejects(digestStream(Readable.from([bytes]),{maxBytes:bytes.length-1,expectedBytes:1,expectedSha1,allowSizeMismatchIfSha1Matches:true}),/PDF_SIZE_LIMIT/);
 await assert.rejects(digestStream(Readable.from([Buffer.from('{"error":"not a document"}')]),{maxBytes:1024}),/NOT_A_PDF/);
});
