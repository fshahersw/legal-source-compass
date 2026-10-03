// Offline derivative only. This does not upload, read cloud objects, or register a DB scope.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {hashBytes,canonicalHash} from './local-bundle-pdf-contract.mjs';
import {QUARANTINED_LOCAL_PDF_PACKET_SHA,buildQuarantinedLocalOccurrence} from './local-bundle-quarantine-pdf-contract.mjs';
const BASE='C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02';
const source=path.join(BASE,'local-pdf-quarantine-v1'),out=path.join(BASE,'local-pdf-quarantine-asset-branch-v1');
const packetPath=path.join(source,'local-quarantined-pdf-occurrences-v1.jsonl'),packet=fs.readFileSync(packetPath);assert.equal(hashBytes(packet),QUARANTINED_LOCAL_PDF_PACKET_SHA);
const independent=fs.readFileSync(path.join(source,'local-catalog-independent-verification-v1.json'));assert.equal(hashBytes(independent),'884bf6266b4ff7a98468ad8070ff34eb41ed5bd162fe54c2cd8ffd67a70fb9b3');assert.equal(JSON.parse(independent).status,'passed');
const inventory=fs.readFileSync(path.join(BASE,'local-pdf-reuse-v1/bundle-source-inventory.json'));assert.equal(hashBytes(inventory),'5517e4001325994a9e2e9b4bade743c512572c94aede3f2ffafce0154b1caa5f');
const lines=packet.toString('utf8').trimEnd().split('\n'),rows=lines.map((line,index)=>buildQuarantinedLocalOccurrence(JSON.parse(line),{packetUri:pathToFileURL(packetPath).href,packetOrdinal:index+1,originalLineSha:hashBytes(line),inventorySha:hashBytes(inventory),independentReviewSha:hashBytes(independent)}));
assert.equal(rows.length,701);assert.equal(new Set(rows.map(r=>r.local_occurrence_id)).size,701);assert.equal(new Set(rows.map(r=>r.pdf_sha256)).size,591);assert.equal(rows.filter(r=>r.source_seal_status==='locally_flagged_sealed').length,12);
fs.mkdirSync(out);const normalizedPath=path.join(out,'prepared-local-pdf-occurrences.jsonl'),normalized=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');fs.writeFileSync(normalizedPath,normalized,{flag:'wx'});
const rowDigests=rows.map(r=>({local_occurrence_id:r.local_occurrence_id,source_evidence_sha256:r.source_evidence_sha256,occurrence_sha256:canonicalHash(r),source_packet_record_ordinal:r.source_packet_record_ordinal,pdf_sha256:r.pdf_sha256}));
const digestsPath=path.join(out,'prepared-occurrence-digests.jsonl');fs.writeFileSync(digestsPath,rowDigests.map(r=>JSON.stringify(r)).join('\n')+'\n',{flag:'wx'});
const manifest={schema_version:'local-quarantined-private-asset-preparation/1',prepared_at:new Date().toISOString(),source_packet_sha256:QUARANTINED_LOCAL_PDF_PACKET_SHA,source_packet_path:packetPath,independent_source_review_sha256:hashBytes(independent),source_inventory_sha256:hashBytes(inventory),source_occurrences:701,unique_binary_objects:591,unknown_local_blank_seal:689,locally_flagged_sealed:12,prepared_occurrences_sha256:hashBytes(normalized),prepared_occurrences_bytes:normalized.length,prepared_occurrences_path:normalizedPath,prepared_digests_sha256:hashBytes(fs.readFileSync(digestsPath)),private_quarantine_required:true,public_projection_allowed:false,native_asset_registration_allowed:false,actual_upload_plan_sha256:null,cloud_verified:false,actual_cloud_receipt_binding_required:true,database_scope_registered:false,database_writes:0,uploads:0,new_cloud_reads:0};
const manifestPath=path.join(out,'preparation-manifest-v1.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'prepared_only',occurrences:701,objects:591,manifest_path:manifestPath,manifest_sha256:hashBytes(fs.readFileSync(manifestPath)),normalized_sha256:hashBytes(normalized),database_writes:0,uploads:0}));
