/** A metadata version is not a checksum or identity assertion for PDF bytes. */
export function nativeDocumentSourceVersionDisposition(current,prior=null){
 function validate(row){
  if(!row||typeof row.provider!=='string'||!row.provider||typeof row.native_document_id!=='string'||!row.native_document_id||typeof row.native_case_id!=='string'||!row.native_case_id||typeof row.selected_source_record_sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.selected_source_record_sha256))throw Error('NATIVE_SOURCE_VERSION_IDENTITY_REQUIRED');
 }
 validate(current);
 if(!prior)return 'new_native_identity';
 validate(prior);
 if(prior.provider!==current.provider||prior.native_document_id!==current.native_document_id||prior.native_case_id!==current.native_case_id)throw Error('NATIVE_SOURCE_VERSION_IDENTITY_CONFLICT');
 return prior.selected_source_record_sha256===current.selected_source_record_sha256?'exact_native_source_version_duplicate':'new_metadata_version';
}
