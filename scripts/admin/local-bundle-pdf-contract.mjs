import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {canonicalIntegerJson} from './local-catalog-evidence-contract.mjs';

export const LOCAL_PDF_PACKET_SHA='974b72f7b7a4ec34ec9eeadcea4da9d470452eef2afb757f0d1982c6aedd22bf';
export const LOCAL_PDF_SOURCE='local-matter-bundle-pdf';
export const LOCAL_PDF_SCHEMA='local-bundle-private-pdf-occurrence/1';
export const LOCAL_PDF_ROOT='C:/Users/firas/Downloads/MATTER-ETL-BATCH-PIPELINE';
export const hashBytes=x=>createHash('sha256').update(x).digest('hex');
export const canonicalHash=x=>hashBytes(canonicalIntegerJson(x));
const hex=(value,length=64)=>typeof value==='string'&&new RegExp(`^[a-f0-9]{${length}}$`).test(value);

export function localBundleFileUri(value){
 if(typeof value!=='string'||!/^C:[\\/]/.test(value)||/[\0]/.test(value)||value.slice(2).includes(':')||value.split(/[\\/]/).some(x=>x==='.'||x==='..'||/^(examples?|golden|fixtures?)$/i.test(x)))throw Error('LOCAL_BUNDLE_PATH_REQUIRED');
 const relative=path.win32.relative(LOCAL_PDF_ROOT,value);
 if(!relative||relative.startsWith('..')||path.win32.isAbsolute(relative))throw Error('LOCAL_BUNDLE_ROOT_REQUIRED');
 return pathToFileURL(path.win32.normalize(value)).href;
}

export function validateLocalReviewedPdf(row){
 const evidence=row?.source_evidence;
 if(row?.schema_version!=='local-bundle-observed-pdf-occurrence/1'||row.provider!=='local-matter-bundle'||row.native_backend_document_id!==null||row.native_backend_identity_asserted!==false||row.private_only!==true||row.publisher_sealing_asserted!==false||row.cloud_body_hash_verified!==false||row.pdf_magic_verified!==true||!hex(row.actual_sha256)||!hex(row.actual_sha1,40)||!Number.isSafeInteger(row.actual_bytes)||row.actual_bytes<1||row.csv_sha256_claim_matches_actual!==true||row.csv_bytes_claim_matches_actual!==true||row.manifest_bytes_claim_matches_actual!==true||!evidence||!hex(row.source_occurrence_sha256)||row.source_occurrence_sha256!==hashBytes(JSON.stringify(evidence))||!hex(row.firm_scope_source_sha256))throw Error('REVIEWED_LOCAL_PDF_REQUIRED');
 for(const name of ['bundle_manifest_file','docket_csv_file'])localBundleFileUri(evidence[name]);
 localBundleFileUri(row.local_path);
 if(!hex(evidence.bundle_manifest_sha256)||!hex(evidence.docket_csv_sha256)||!Number.isSafeInteger(evidence.csv_ordinal)||evidence.csv_ordinal<2||!/^\d+$/.test(String(evidence.courtlistener_docket_id))||evidence.source_is_sealed_literal!==''||evidence.csv_sha256_claim!==row.actual_sha256||Number(evidence.csv_bytes_claim)!==row.actual_bytes||Number(evidence.manifest_bytes_claim)!==row.actual_bytes||typeof evidence.explicit_file_name!=='string'||path.win32.basename(row.local_path)!==evidence.explicit_file_name||evidence.source_parent_field!=='manifest.dockets[source=main].courtlistener_docket_id')throw Error('EXACT_LOCAL_SOURCE_EVIDENCE_REQUIRED');
 let url;try{url=new URL(evidence.literal_recap_pdf_url);}catch{throw Error('LITERAL_RECAP_LOCATOR_REQUIRED');}
 if(url.protocol!=='https:'||url.hostname!=='storage.courtlistener.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/recap\/[^?#\s]+\.pdf$/.test(url.pathname)||/seal(?:ed|ing)?|restricted|ex[._ -]?parte/i.test(url.pathname))throw Error('PRIVATE_UNQUALIFIED_LOCATOR_HELD');
 return row;
}

export function localPdfStorageKey(sha){if(!hex(sha))throw Error('PDF_SHA_REQUIRED');return `seeger-weiss/pdf-sha256/${sha.slice(0,2)}/${sha}.pdf`;}

export function buildLocalPdfOccurrence(row,{packetUri,packetOrdinal,originalLineSha,inventorySha,localVerifiedAt,firmParentEvidence}){
 validateLocalReviewedPdf(row);
 if(!Number.isSafeInteger(packetOrdinal)||packetOrdinal<1||packetOrdinal>51||!hex(originalLineSha)||!hex(inventorySha)||!Number.isFinite(Date.parse(localVerifiedAt))||firmParentEvidence?.native_docket_id!==String(row.source_evidence.courtlistener_docket_id)||firmParentEvidence.http_status!==200||firmParentEvidence.request_method!=='GET'||!hex(firmParentEvidence.record_sha256)||!hex(firmParentEvidence.response_sha256))throw Error('LOCAL_PACKET_LINEAGE_REQUIRED');
 const localOccurrenceId='local-pdf:'+canonicalHash([LOCAL_PDF_SOURCE,LOCAL_PDF_PACKET_SHA,packetOrdinal,originalLineSha,row.source_occurrence_sha256]);
 return {
  schema_version:LOCAL_PDF_SCHEMA,source_system:LOCAL_PDF_SOURCE,local_occurrence_id:localOccurrenceId,
  native_document_id:null,native_case_id:null,native_backend_document_id:null,
  publisher_native_entity:false,publisher_parent_association_verified:false,
  private_only:true,private_quarantine_required:true,public_projection_allowed:false,
  source_seal_status:'unknown_local_blank',publisher_sealing_asserted:false,
  pdf_sha256:row.actual_sha256,pdf_sha1:row.actual_sha1,pdf_bytes:row.actual_bytes,
  local_file_uri:localBundleFileUri(row.local_path),local_binary_sha_verified:true,pdf_magic_verified:true,
  source_packet_file_uri:packetUri,source_packet_sha256:LOCAL_PDF_PACKET_SHA,
  source_packet_record_ordinal:packetOrdinal,source_packet_original_record_sha256:originalLineSha,
  source_packet_original_record_sha256_codec:'raw-utf8-jsonl-line-without-line-terminator/1',
  source_inventory_sha256:inventorySha,source_evidence_sha256:row.source_occurrence_sha256,
  source_evidence_sha256_codec:'original-insertion-order-compact-utf8-json/1',
  source_evidence:row.source_evidence,firm_query_parent_evidence:firmParentEvidence,
  local_verified_at:localVerifiedAt,local_verified_at_basis:'local_full_file_read_not_publisher_or_HTTP_capture',
  source_http_retrieved_at:null,source_http_status:null,network_download_performed:false,
  storage_bucket:'corpus-originals',intended_storage_key:localPdfStorageKey(row.actual_sha256),
  cloud_binary_verified:false,
 };
}

export function validateLocalCloudProof(proof,occurrence,planSha){
 if(!hex(planSha)||proof?.schema_version!=='local-bundle-private-cloud-readback/1'||proof.state!=='local_cloud_verified'||proof.project_id!=='xosqzzsnhxcyehcnirpa'||proof.bucket!=='corpus-originals'||proof.storage_key!==localPdfStorageKey(occurrence.pdf_sha256)||proof.sha256!==occurrence.pdf_sha256||proof.sha1!==occurrence.pdf_sha1||proof.bytes!==occurrence.pdf_bytes||proof.whole_object_get_hash_verified!==true||proof.local_original_file_hash_verified!==true||proof.verification_method!=='authenticated_whole_object_readback_sha256_sha1_bytes'||proof.transfer_plan_sha256!==planSha||!hex(proof.transfer_receipt_file_sha256)||!Number.isSafeInteger(proof.transfer_receipt_record_ordinal)||proof.transfer_receipt_record_ordinal<1||!Number.isFinite(Date.parse(proof.verified_at)))throw Error('WHOLE_PRIVATE_OBJECT_READBACK_PROOF_REQUIRED');
 const allowed=['schema_version','state','project_id','bucket','storage_key','sha256','sha1','bytes','whole_object_get_hash_verified','local_original_file_hash_verified','verification_method','verified_at','transfer_plan_sha256','transfer_receipt_file_sha256','transfer_receipt_record_ordinal'];
 if(Object.keys(proof).some(key=>!allowed.includes(key)))throw Error('UNEXPECTED_CLOUD_PROOF_FIELDS');
 return proof;
}
