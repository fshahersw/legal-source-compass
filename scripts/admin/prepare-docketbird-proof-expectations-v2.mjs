import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {canonicalIntegerJson} from './local-catalog-evidence-contract.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const pinned=f=>{const b=fs.readFileSync(f.path??f.file);if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error('PINNED_INPUT_CHANGED');return b;};
export function documentProofExpectations(plan,preparedBytes,runId){
 if(!uuid(runId)||plan.projectId!=='xosqzzsnhxcyehcnirpa'||plan.schemaVersion!=='docketbird-private-evidence-intake-plan/1'||plan.rpcFunction!=='corpus_admin_docketbird_evidence_v1'||plan.privateOnly!==true||plan.publicProjectionAllowed!==false||sha(preparedBytes)!==plan.preparedInput.sha256||preparedBytes.length!==plan.preparedInput.bytes)throw Error('FROZEN_DOCUMENT_PLAN_REQUIRED');
 const rows=preparedBytes.toString('utf8').trimEnd().split('\n').map(x=>JSON.parse(x)),seen=new Set(),ordinals=new Set();
 for(const r of rows){
  if(r.entity_type!=='document_metadata'||r.source_system!=='docketbird-mcp'||r.schema_version!=='seeger-weiss-docketbird-document-evidence/1'||r.native_id!==r.data.native_document_id||!r.native_id.startsWith(r.data.native_case_id+'-')||seen.has(r.native_id)||sha(canonicalIntegerJson(r.data))!==r.provenance.record_sha256||r.provenance.source_packet_file_sha256!==plan.originalInput.sha256||r.provenance.source_manifest_sha256!==plan.originalSourceManifest.sha256||r.provenance.full_lineage.length!==r.provenance.source_occurrence_count)throw Error('DOCUMENT_IDENTITY_OR_LINEAGE_MISMATCH');
  seen.add(r.native_id);for(const x of r.provenance.full_lineage){if(!Number.isSafeInteger(x.input_record_ordinal)||ordinals.has(x.input_record_ordinal)||x.input_record_ordinal<1||x.input_record_ordinal>plan.sourceOccurrencesPreserved)throw Error('DUPLICATE_OR_MISSING_SOURCE_ORDINAL');ordinals.add(x.input_record_ordinal);}
 }
 if(rows.length!==plan.expectedObservations||ordinals.size!==plan.sourceOccurrencesPreserved)throw Error('EXPECTED_GRAIN_MISMATCH');
 rows.sort((a,b)=>a.native_id<b.native_id?-1:a.native_id>b.native_id?1:0);const pages=[];
 for(let i=0;i<rows.length;i+=1000){const page=rows.slice(i,i+1000),fingerprint=page.map(r=>r.native_id+'\t'+r.provenance.record_sha256+'\t'+sha(canonicalIntegerJson(r.provenance))+'\n').join(''),occurrences=page.reduce((n,r)=>n+r.provenance.source_occurrence_count,0);pages.push({page_index:pages.length+1,p_limit:1000,p_after_native_id:i?rows[i-1].native_id:null,expected_page_records:page.length,expected_first_native_id:page[0].native_id,expected_last_native_id:page.at(-1).native_id,expected_payload_provenance_page_sha256:sha(fingerprint),expected_source_occurrences:occurrences,expected_lineage_entries:occurrences});}
 return{schema_version:'docketbird-frozen-paginated-proof-expectations/2',project_id:plan.projectId,run_id:runId,rpc_function:'corpus_admin_docketbird_run_proof_v2',private_only:true,source_manifest_sha256:plan.originalSourceManifest.sha256,original_input_sha256:plan.originalInput.sha256,prepared_input_sha256:plan.preparedInput.sha256,expected_observations:rows.length,expected_distinct_document_ids:seen.size,expected_referenced_versions:rows.length,first_seen_version_count:'reported_separately_not_assumed_equal_to_observations',expected_current_entities:rows.length,expected_source_occurrences:ordinals.size,required_page_equal_record_counts:['versions_present','canonical_payloads_exact','storage_hashes_exact','native_source_identities_exact','observation_columns_exact','source_scopes_exact','current_entities_exact'],required_page_zero_counts:['private_gate_failures','lineage_count_mismatches','selected_lineage_mismatches','invalid_lineage_entries'],pages,final_empty_page_after_native_id:rows.at(-1).native_id};
}
function main(){
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return[x.slice(2,i),x.slice(i+1)];})),b=fs.readFileSync(path.resolve(args.plan));if(sha(b)!==args['plan-sha256'])throw Error('EXTERNAL_PLAN_HASH_REQUIRED');const plan=JSON.parse(b);
 for(const f of [plan.originalSourceManifest,plan.originalInput,plan.independentSourceReview,plan.runScope])pinned(f);
 const e={...documentProofExpectations(plan,pinned(plan.preparedInput),args.run),source_plan_sha256:sha(b)},body=JSON.stringify(e,null,2)+'\n';fs.writeFileSync(path.resolve(args.output),body,{flag:'wx'});console.log(JSON.stringify({state:'frozen_read_only_expectations_prepared',path:path.resolve(args.output),sha256:sha(body),run:e.run_id,records:e.expected_observations,pages:e.pages.length,sourceOccurrences:e.expected_source_occurrences,databaseCalls:0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
