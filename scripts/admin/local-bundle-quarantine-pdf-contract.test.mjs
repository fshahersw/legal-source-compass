import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hashBytes} from './local-bundle-pdf-contract.mjs';
import {QUARANTINED_LOCAL_PDF_PACKET_SHA,validateQuarantinedReviewedPdf,buildQuarantinedLocalOccurrence} from './local-bundle-quarantine-pdf-contract.mjs';
const packetUri='file:///C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/local-pdf-quarantine-v1/local-quarantined-pdf-occurrences-v1.jsonl';
const rows=fs.readFileSync(new URL(packetUri),'utf8').trimEnd().split('\n').map(x=>JSON.parse(x));
const options=(r,ordinal=1)=>({packetUri,packetOrdinal:ordinal,originalLineSha:hashBytes(JSON.stringify(r)),inventorySha:r.source_inventory_sha256,independentReviewSha:'a'.repeat(64)});

test('blank locator and local sealed flags retain private unknown publisher status and null native identities',()=>{
 for(const source of [rows[0],rows.find(r=>r.local_sealed_claim)]){validateQuarantinedReviewedPdf(source);const out=buildQuarantinedLocalOccurrence(source,options(source));assert.equal(out.source_seal_status,source.source_seal_status);assert.equal(out.source_evidence.literal_recap_pdf_url,'');assert.equal(out.private_quarantine_required,true);assert.equal(out.public_projection_allowed,false);assert.equal(out.native_document_id,null);assert.equal(out.publisher_sealing_asserted,false);assert.equal(out.cloud_binary_verified,false);assert.equal(out.source_packet_sha256,QUARANTINED_LOCAL_PDF_PACKET_SHA);}
});
test('identical local bytes in separate original occurrences never collapse or invent native assets',()=>{
 const source=rows[0],a=buildQuarantinedLocalOccurrence(source,options(source,1)),b=buildQuarantinedLocalOccurrence(source,options(source,2));assert.equal(a.pdf_sha256,b.pdf_sha256);assert.notEqual(a.local_occurrence_id,b.local_occurrence_id);assert.equal(a.native_case_id,null);assert.equal(a.firm_query_parent_evidence.publisher_document_parent_association_verified,false);
});
test('source bytes, parent query, lineage, API identity and private qualification contradictions are rejected',()=>{
 for(const[k,v]of [['native_document_id','claimed-api-id'],['public_projection_allowed',true],['publisher_sealing_asserted',true],['private_quarantine_required',false],['source_seal_status','public_unsealed'],['actual_bytes',rows[0].actual_bytes+1],['local_path','C:/Users/firas/Downloads/MATTER-ETL-BATCH-PIPELINE/../escape.pdf']]){const r=structuredClone(rows[0]);r[k]=v;assert.throws(()=>validateQuarantinedReviewedPdf(r));}
 const parent=structuredClone(rows[0]);parent.firm_query_parent_evidence.source_url='https://www.courtlistener.com/api/rest/v4/search/?q=unrelated&type=d';assert.throws(()=>validateQuarantinedReviewedPdf(parent));
 const source=structuredClone(rows[0]);source.source_evidence.csv_ordinal+=1;assert.throws(()=>validateQuarantinedReviewedPdf(source));
 for(const[k,v]of [['packetOrdinal',702],['packetUri',packetUri.replace('local-pdf-quarantine-v1','different-packet')],['inventorySha','b'.repeat(64)]])assert.throws(()=>buildQuarantinedLocalOccurrence(rows[0],{...options(rows[0]),[k]:v}));
});
