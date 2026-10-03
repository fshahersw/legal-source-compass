import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {documentProofExpectations} from './prepare-docketbird-proof-expectations-v2.mjs';
import {verifyScopeDocketbirdGlobalProof,validateScopeExpectations} from './verify-docketbird-private-intake-v2.mjs';
import {validateRecentMetadataRow} from './docketbird-recent-metadata-contract.mjs';
import {coverageMetadataEnvelope} from './prepare-docketbird-recent-metadata-intake.mjs';

const base='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/docketbird';
const available=fs.existsSync(base+'/private-intake-recent-v1/proof-expectations-v2-040510b8.json');
const expected=available?JSON.parse(fs.readFileSync(base+'/private-intake-recent-v1/proof-expectations-v2-040510b8.json')):{expected_observations:7923,expected_source_occurrences:8414,expected_distinct_document_ids:7923,expected_referenced_versions:7923,expected_current_entities:7923,source_manifest_sha256:'a'.repeat(64),original_input_sha256:'b'.repeat(64)};
const global=()=>({expected_observations:7923,expected_source_occurrences:8414,run_observations:7923,distinct_document_ids:7923,wrong_source_or_type_or_endpoint:0,referenced_version_rows:7923,unreferenced_first_run_versions:0,run_version_rows:7652,run_current_entity_rows:7923,preserved_source_occurrences:8414,distinct_source_record_ordinals:8414,min_source_record_ordinal:1,max_source_record_ordinal:8414,invalid_or_out_of_range_ordinals:0,run_relationship_writes:0,private_tables_with_rls:4,anon_or_authenticated_private_select_grants:0,source_manifest_sha256:expected.source_manifest_sha256,original_input_sha256:expected.original_input_sha256});
test('recent frozen proof preserves all source ordinals and exact full-provenance pages',{skip:!available},()=>{
 const plan=JSON.parse(fs.readFileSync(base+'/private-intake-recent-v1/plan-unbound.json')),b=fs.readFileSync(plan.preparedInput.path),actual=documentProofExpectations(plan,b,expected.run_id);assert.equal(actual.pages.length,8);assert.deepEqual(actual.pages,expected.pages);assert.equal(actual.expected_source_occurrences,8414);assert.equal(validateScopeExpectations(expected),expected);
 const rows=b.toString().trimEnd().split('\n').map(x=>JSON.parse(x));rows[1].provenance.full_lineage[0].input_record_ordinal=rows[0].provenance.full_lineage[0].input_record_ordinal;const changed=Buffer.from(rows.map(x=>JSON.stringify(x)).join('\n')+'\n'),changedPlan={...plan,preparedInput:{...plan.preparedInput,sha256:createHash('sha256').update(changed).digest('hex'),bytes:changed.length}};assert.throws(()=>documentProofExpectations(changedPlan,changed,expected.run_id),/DUPLICATE_OR_MISSING_SOURCE_ORDINAL/);
});
test('reobserved historical payloads remain valid but unresolved versions, extra run payloads and private grant leaks fail',()=>{
 for(const newVersions of [0,7652,7923])assert.equal(verifyScopeDocketbirdGlobalProof({...global(),run_version_rows:newVersions},expected),true);
 for(const[k,v]of[['referenced_version_rows',7922],['unreferenced_first_run_versions',1],['run_version_rows',7924],['run_version_rows',-1],['run_relationship_writes',1],['distinct_source_record_ordinals',8413],['anon_or_authenticated_private_select_grants',1]])assert.throws(()=>verifyScopeDocketbirdGlobalProof({...global(),[k]:v},expected));
});
test('expected page order/count tampering fails before any database call',{skip:!available},()=>{
 assert.throws(()=>validateScopeExpectations({...expected,pages:expected.pages.map((p,i)=>i===1?{...p,p_after_native_id:null}:p)}));assert.throws(()=>validateScopeExpectations({...expected,expected_referenced_versions:7922}));
});
const packet=base+'/recent-expansion-v1/prepared-follow-on-v1',packetAvailable=fs.existsSync(packet+'/private-header-metadata.jsonl'),header=packetAvailable?JSON.parse(fs.readFileSync(packet+'/private-header-metadata.jsonl','utf8').split('\n')[0]):null;
test('native header null values stay null and raw personalized locators cannot enter typed private intake',{skip:!packetAvailable},()=>{
 assert.equal(validateRecentMetadataRow(header),header);assert.equal(header.data.source_case_number,null);
 assert.throws(()=>validateRecentMetadataRow({...header,native_id:'different-native-case'}),/NATIVE_HEADER_IDENTITY/);assert.throws(()=>validateRecentMetadataRow({...header,provenance:{...header.provenance,pdf_url:'https://docketbird-case-documents.s3.amazonaws.com/a'}}),/RAW_PDF_LOCATOR/);assert.throws(()=>validateRecentMetadataRow({...header,provenance:{...header.provenance,extra:'https://www.docketbird.com/x?user_id=1'}}),/PERSONALIZED_LOCATOR/);
});
test('provider coverage leaves missing counters null, retains genuine zero and does not claim court or PDF completeness',{skip:!packetAvailable},()=>{
 const originals=fs.readFileSync(packet+'/private-source-qualified-coverage.jsonl','utf8').trimEnd().split('\n').map(x=>JSON.parse(x)),missing=originals.find(x=>x.complete===false),missingHeader=fs.readFileSync(packet+'/private-header-metadata.jsonl','utf8').trimEnd().split('\n').map(x=>JSON.parse(x)).find(x=>x.native_id===missing.native_case_id);const r=coverageMetadataEnvelope(missing,missingHeader,1);assert.equal(r.data.source_missing_metadata,null);assert.equal(r.data.source_provider_total,null);assert.equal(r.data.source_provider_metadata_complete,false);assert.equal(r.data.publisher_native_entity,false);assert.equal(r.data.court_docket_completeness_verified,false);assert.equal(r.data.pdf_body_completeness_verified,false);const complete=coverageMetadataEnvelope(originals[0],header,1);assert.equal(complete.data.source_missing_metadata,0);assert.equal(complete.data.source_restricted_metadata_rows,0);assert.throws(()=>coverageMetadataEnvelope(missing,header,1),/COVERAGE_NATIVE_HEADER_EVIDENCE/);
});
