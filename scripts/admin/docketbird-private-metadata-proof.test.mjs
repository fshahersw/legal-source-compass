import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyMetadataStatus,metadataGroupFingerprint,verifyMetadataGlobalProof,unknownMetadataTransportOutcome,verifyMetadataExactAbsence} from './run-docketbird-private-metadata-intake.mjs';
const run='040510b8-86a0-4c77-99a0-1989a2532dc4',rows=[{entity_type:'case_metadata',native_id:'example-1:2026-cv-00001',provenance:{record_sha256:'a'.repeat(64),source_capture:{capture_file_sha256:'b'.repeat(64)},source_scope:[{publisher_native_merge:false}]}}];
const status=()=>({run_id:run,expected:1,expected_payload_provenance_sha256:metadataGroupFingerprint(rows),private_only:true,read_only:true,conflicts:0,...Object.fromEntries(['versions_present','versions_exact','observations_present','observations_exact','entities_present','current_entities_exact','matched'].map(k=>[k,1]))});
test('full private metadata proof rejects altered provenance, wrong native rows and canonical/current mismatches',()=>{
 assert.equal(verifyMetadataStatus(status(),rows,run),true);
 const changed=structuredClone(rows);changed[0].provenance.source_scope[0].publisher_native_merge=true;assert.throws(()=>verifyMetadataStatus(status(),changed,run));
 for(const[k,v]of[['versions_exact',0],['observations_exact',0],['current_entities_exact',0],['conflicts',1],['private_only',false],['run_id','another-run'],['expected_payload_provenance_sha256','c'.repeat(64)]])assert.throws(()=>verifyMetadataStatus({...status(),[k]:v},rows,run));
});
test('mixed type source snapshots retain their separate ordinal units, even if native labels overlap',()=>{
 const types={case_metadata:{input_sha256:'d'.repeat(64),expected_observations:2},search_reference_observation:{input_sha256:'e'.repeat(64),expected_observations:3}},plan={runId:run,sourceManifest:{sha256:'f'.repeat(64)},expectedTypes:types,expectedObservations:5},g={run_id:run,source_manifest_sha256:'f'.repeat(64),expected_types:types,run_observations:5,referenced_version_rows:5,wrong_source_type_endpoint:0,run_relationship_writes:0,unreferenced_first_run_versions:0,first_seen_version_rows:3,private_tables_with_rls:4,anon_or_authenticated_private_select_grants:0,private_only:true,read_only:true,per_type:Object.fromEntries(Object.entries(types).map(([k,s])=>[k,{expected:s.expected_observations,observations:s.expected_observations,distinct_native_ids:s.expected_observations,distinct_input_ordinals:s.expected_observations,max_input_ordinal:s.expected_observations,min_input_ordinal:1,source_input_mismatches:0}]))};
 assert.equal(verifyMetadataGlobalProof(g,plan),true);
 for(const field of ['distinct_native_ids','distinct_input_ordinals','max_input_ordinal']){const changed=structuredClone(g);changed.per_type.case_metadata[field]=1;assert.throws(()=>verifyMetadataGlobalProof(changed,plan));}
 const extra=structuredClone(g);extra.per_type.unreviewed_type={};assert.throws(()=>verifyMetadataGlobalProof(extra,plan));assert.throws(()=>verifyMetadataGlobalProof({...g,anon_or_authenticated_private_select_grants:1},plan));assert.throws(()=>verifyMetadataGlobalProof({...g,unreferenced_first_run_versions:1},plan));
});
test('known semantic acknowledgement failures stop, while only genuine unknown transport outcomes can be audited',()=>{
 assert.equal(unknownMetadataTransportOutcome(Object.assign(Error('METADATA_INTAKE_ACK_MISMATCH'),{httpStatus:200})),false);
 assert.equal(unknownMetadataTransportOutcome(Error('LOCAL_VALIDATION_FAILED')),false);assert.equal(unknownMetadataTransportOutcome(new TypeError('programming error')),false);
 assert.equal(unknownMetadataTransportOutcome(Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}})),true);assert.equal(unknownMetadataTransportOutcome(Object.assign(Error(),{name:'TimeoutError'})),true);
 const absent={...status(),matched:0,versions_present:0,versions_exact:0,observations_present:0,observations_exact:0,entities_present:0,current_entities_exact:0};assert.equal(verifyMetadataExactAbsence(absent,rows,run),true);
 for(const[k,v]of[['run_id','other'],['expected_payload_provenance_sha256','c'.repeat(64)],['private_only',false],['read_only',false],['matched',null],['conflicts',null],['versions_present',2]])assert.throws(()=>verifyMetadataExactAbsence({...absent,[k]:v},rows,run));
});
