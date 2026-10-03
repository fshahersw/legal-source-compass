import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDocketbirdProofPage,verifyDocketbirdGlobalProof,parseDocketbirdProofResponse} from './verify-docketbird-private-intake.mjs';

const expected={run_id:'45d9fecf-33f4-403a-ae8d-a3b1559657d3',expected_observations:1000,expected_distinct_document_ids:1000,expected_run_versions:1000,expected_current_entities:1000,expected_source_occurrences:1100,source_manifest_sha256:'a'.repeat(64),original_input_sha256:'b'.repeat(64),required_page_equal_record_counts:['versions_present','canonical_payloads_exact','storage_hashes_exact','native_source_identities_exact','observation_columns_exact','source_scopes_exact','current_entities_exact'],required_page_zero_counts:['private_gate_failures','lineage_count_mismatches','selected_lineage_mismatches','invalid_lineage_entries']};
const page={expected_page_records:1000,expected_first_native_id:'court-case-0001',expected_last_native_id:'court-case-1000',expected_payload_provenance_page_sha256:'c'.repeat(64),expected_source_occurrences:1100,expected_lineage_entries:1100};
const validPage=()=>({run_id:expected.run_id,private_only:true,read_only:true,page_records:1000,first_native_id:page.expected_first_native_id,last_native_id:page.expected_last_native_id,page_payload_provenance_sha256:page.expected_payload_provenance_page_sha256,declared_source_occurrences:1100,lineage_entries:1100,...Object.fromEntries(expected.required_page_equal_record_counts.map(k=>[k,1000])),...Object.fromEntries(expected.required_page_zero_counts.map(k=>[k,0]))});
const validGlobal=()=>({expected_observations:1000,expected_source_occurrences:1100,run_observations:1000,distinct_document_ids:1000,wrong_source_or_type_or_endpoint:0,run_version_rows:1000,run_current_entity_rows:1000,preserved_source_occurrences:1100,distinct_source_record_ordinals:1100,min_source_record_ordinal:1,max_source_record_ordinal:1100,invalid_or_out_of_range_ordinals:0,run_relationship_writes:0,private_tables_with_rls:4,anon_or_authenticated_private_select_grants:0,source_manifest_sha256:expected.source_manifest_sha256,original_input_sha256:expected.original_input_sha256});

test('page proof requires complete provenance fingerprint, every payload/storage proof and exact lineage/private counts',()=>{
 assert.equal(verifyDocketbirdProofPage(validPage(),page,expected),true);
 for(const [field,value]of [['run_id','other-run'],['page_payload_provenance_sha256','0'.repeat(64)],['last_native_id','wrong-cursor'],['versions_present',999],['canonical_payloads_exact',999],['storage_hashes_exact',999],['current_entities_exact',999],['lineage_entries',1099],['declared_source_occurrences',1099],['selected_lineage_mismatches',1],['private_gate_failures',1],['invalid_lineage_entries',1],['read_only',false],['private_only',false]])assert.throws(()=>verifyDocketbirdProofPage({...validPage(),[field]:value},page,expected));
});
test('global proof detects duplicate/missing ordinals, extra native edges and public grants even with matching total rows',()=>{
 assert.equal(verifyDocketbirdGlobalProof(validGlobal(),expected),true);
 for(const [field,value]of [['distinct_document_ids',999],['distinct_source_record_ordinals',1099],['min_source_record_ordinal',2],['max_source_record_ordinal',1101],['invalid_or_out_of_range_ordinals',1],['run_relationship_writes',1],['private_tables_with_rls',3],['anon_or_authenticated_private_select_grants',1],['original_input_sha256','0'.repeat(64)],['source_manifest_sha256','0'.repeat(64)]])assert.throws(()=>verifyDocketbirdGlobalProof({...validGlobal(),[field]:value},expected));
 assert.throws(()=>verifyDocketbirdGlobalProof(null,expected));
});
test('known HTTP rejection never loses status or parses server error text',async()=>{
 let parsed=false;await assert.rejects(()=>parseDocketbirdProofResponse({ok:false,status:503,json:async()=>{parsed=true;throw Error('PRIVATE_SERVER_BODY_WITHHELD');}}),e=>e.httpStatus===503&&e.message==='KNOWN_HTTP_PROOF_REJECTED');assert.equal(parsed,false);
});
test('successful HTTP with malformed or non-object proof keeps known status and stops',async()=>{
 await assert.rejects(()=>parseDocketbirdProofResponse({ok:true,status:200,json:async()=>{throw Error('PRIVATE_BODY_WITHHELD');}}),e=>e.httpStatus===200&&e.message==='KNOWN_HTTP_PROOF_BODY_UNREADABLE');
 await assert.rejects(()=>parseDocketbirdProofResponse({ok:true,status:200,json:async()=>[]}),e=>e.httpStatus===200&&e.message==='KNOWN_HTTP_PROOF_SHAPE_INVALID');
 assert.deepEqual(await parseDocketbirdProofResponse({ok:true,status:200,json:async()=>({read_only:true})}),{read_only:true});
});
