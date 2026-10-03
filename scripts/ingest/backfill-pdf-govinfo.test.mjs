import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDownloadUrl,validateQueueRow,sourcePrivacyQualification} from './backfill-pdfs-to-supabase.mjs';

const PACKAGE='USCOURTS-njd-3_16-md-02738',GRANULE=PACKAGE+'-4',URL_='https://www.govinfo.gov/content/pkg/'+PACKAGE+'/pdf/'+GRANULE+'.pdf';
const hex=c=>c.repeat(64);
function govinfoRow(){
 return{schema_version:'source-qualified-pdf-queue/1',provider:'govinfo',native_document_id:GRANULE,native_document_identity_kind:'govinfo_granule_id',native_case_id:PACKAGE,native_case_identity_kind:'govinfo_package_id',
  durable_url:URL_,download_url:URL_,expected_sha1:null,expected_bytes:null,title:'MEMORANDUM ORDER',filing_date:null,selected_source_record_sha256:hex('a'),
  provider_flags:{sealing_related_locator_held:false,pdf_http_access_verified:false,pdf_content_verified:false},eligible:true,held_reason:null,
  origins:[{native_document_id:GRANULE,native_case_id:PACKAGE,native_record_sha256:hex('a'),source_response_sha256:hex('b'),retrieved_at:'2026-10-03T17:00:00.000Z'}]};
}
test('govinfo allows only https www.govinfo.gov USCOURTS content paths',()=>{
 assert.equal(validateDownloadUrl(URL_,'govinfo').hostname,'www.govinfo.gov');
 for(const bad of ['http://www.govinfo.gov/content/pkg/'+PACKAGE+'/pdf/'+GRANULE+'.pdf','https://govinfo.gov/content/pkg/'+PACKAGE+'/pdf/'+GRANULE+'.pdf','https://api.govinfo.gov/packages/'+PACKAGE+'/granules/'+GRANULE+'/htm',
  'https://www.govinfo.gov/app/details/'+PACKAGE,'https://www.govinfo.gov/content/pkg/BILLS-119hr1ih/pdf/BILLS-119hr1ih.pdf','https://www.govinfo.gov:8443/content/pkg/'+PACKAGE+'/pdf/'+GRANULE+'.pdf','https://user:pw@www.govinfo.gov/content/pkg/'+PACKAGE+'/pdf/'+GRANULE+'.pdf','https://www.govinfo.gov.example.com/content/pkg/USCOURTS-x/pdf/y.pdf'])
  assert.throws(()=>validateDownloadUrl(bad,'govinfo'),/PDF_URL_INVALID|PDF_HOST_NOT_ALLOWED/,bad);
});
test('govinfo host is not accepted for other providers and court hosts are not accepted for govinfo',()=>{
 for(const provider of ['official-court','courtlistener','docketbird'])assert.throws(()=>validateDownloadUrl(URL_,provider),/PDF_HOST_NOT_ALLOWED/);
 assert.throws(()=>validateDownloadUrl('https://www.njd.uscourts.gov/sites/njd/files/Order8MDL2738.pdf','govinfo'),/PDF_HOST_NOT_ALLOWED/);
 assert.equal(validateDownloadUrl('https://www.njd.uscourts.gov/sites/njd/files/Order8MDL2738.pdf','official-court').hostname,'www.njd.uscourts.gov');
});
test('govinfo queue rows need package/granule identity, matching URL and an explicit not-sealing-related flag',()=>{
 const row=govinfoRow();
 assert.equal(validateQueueRow(row),row);
 assert.deepEqual(sourcePrivacyQualification(row),{source_seal_status:'source_locator_not_sealing_related',private_quarantine_required:false,public_projection_allowed:false});
 assert.throws(()=>validateQueueRow({...row,provider_flags:{...row.provider_flags,sealing_related_locator_held:true}}),/SEALING_RELATED_SOURCE_HELD/);
 assert.throws(()=>validateQueueRow({...row,provider_flags:{pdf_http_access_verified:false}}),/SEALING_RELATED_SOURCE_HELD/);
 const other='USCOURTS-njd-3_16-md-02739-4',otherUrl='https://www.govinfo.gov/content/pkg/USCOURTS-njd-3_16-md-02739/pdf/'+other+'.pdf';
 for(const changed of [{native_document_id:other},{native_case_id:'USCOURTS-njd-3_16-md-02739'},{native_case_id:'3:16-md-02738'},{native_document_id:'12345'},{durable_url:otherUrl},{download_url:otherUrl,durable_url:otherUrl}])
  assert.throws(()=>validateQueueRow({...structuredClone(row),...changed}),/GOVINFO_GRANULE_IDENTITY_MISMATCH|SOURCE_NATIVE_CASE_MISMATCH|PDF_/,JSON.stringify(changed));
});
test('govinfo rows still need an observed source origin with a native record hash and observation time',()=>{
 const row=govinfoRow();
 assert.throws(()=>validateQueueRow({...row,origins:[]}),/SOURCE_ORIGIN_REQUIRED/);
 assert.throws(()=>validateQueueRow({...row,origins:[{...row.origins[0],native_record_sha256:'x'}]}),/NATIVE_RECORD_SHA256_REQUIRED/);
 assert.throws(()=>validateQueueRow({...row,origins:[{...row.origins[0],retrieved_at:'not a date'}]}),/SOURCE_OBSERVATION_TIME_REQUIRED/);
 assert.throws(()=>validateQueueRow({...row,origins:[{...row.origins[0],native_case_id:'USCOURTS-njd-3_16-md-02739'}]}),/SOURCE_NATIVE_CASE_MISMATCH/);
});
