import { canonicalIntegerJson, hashBytes } from './local-catalog-evidence-contract.mjs';

export const LOCAL_REGISTRY_ARTIFACT_URIS = new Set([
  'file:///C:/Users/firas/Downloads/SW-BULK/registry_v06_1.jsonl',
  'file:///C:/Users/firas/Downloads/courtformsTHREE/SOURCE-INDEX.csv',
  'file:///C:/Users/firas/Downloads/Court-Expansion-States-Part-ONE/SOURCE-INDEX.csv',
  'file:///C:/Users/firas/Downloads/Court-Expansion-States-Part-TWO/SOURCE-INDEX.csv',
  'file:///C:/Users/firas/Downloads/Court-Expansion-States-Part-THREE/SOURCE-INDEX.csv',
  'file:///C:/Users/firas/Downloads/Court-Expansion-Federal-Part-TWO/SOURCE-INDEX.csv',
  'file:///C:/Users/firas/Downloads/courtformsfederalONE/SOURCE-INDEX.csv',
  'file:///C:/Users/firas/Downloads/courtformsTWO/court_forms/MANIFEST.csv',
  'file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/00_CURATED_PRIORITY_SOURCES.jsonl',
  'file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/08_MDL_MASS_TORT_AND_MATTER_HUBS.jsonl',
  'file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/09_MDL_DOCKET_DOCUMENTS.jsonl',
  'file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/11_STATUTES_CODES_AND_LEGISLATION.jsonl',
  'file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/12_FEDERAL_REGULATIONS_AND_RULEMAKING.jsonl',
  'file:///C:/Users/firas/Downloads/returnedfiles/court_access_registry_2026-08-21/registry.jsonl',
  'file:///C:/Users/firas/Downloads/returnedfiles/settlementsverdicts/vli_records.csv',
]);

export function validateLocalRegistryRecord(record, artifacts, scope) {
  if (scope?.source_system !== 'local-source-registry' || scope.public_projection_allowed !== false || scope.calculation_activation_allowed !== false
    || scope.schema_version !== 'local-source-registry-evidence/2' || scope.normalizer_version !== 'local-source-registry-reviewed/3'
    || scope.raw_source_occurrences_independently_verified !== true || !/^[a-f0-9]{64}$/.test(scope.raw_source_verification_sha256 ?? '')) {
    throw new Error('Registry scope must pin the independent raw-occurrence audit and private-only gates.');
  }
  if (record?.source_system !== 'local-source-registry' || record.schema_version !== 'local-source-registry-evidence/2'
    || !/^[a-z][a-z0-9-]{0,80}$/.test(record.entity_type ?? '') || typeof record.native_id !== 'string' || !record.native_id || record.native_id.length > 512
    || !record.data || Array.isArray(record.data) || record.data.local_id !== record.native_id || record.data.publisher_native_entity !== false
    || record.data.normalizer_version !== 'local-source-registry-reviewed/3') {
    throw new Error('Invalid registry evidence identity or publisher qualifier.');
  }
  for (const gate of ['public_projection_eligible', 'public_projection_allowed', 'calculation_activation_allowed', 'credential_locator_held', 'fresh_http_verification', 'legal_authority_or_outcome_verified', 'binary_checksum_independently_verified']) {
    if (record.data[gate] !== false) throw new Error('Local registry source claim cannot activate a verification gate.');
  }
  const p = record.provenance, artifact = artifacts.get(p?.source_file_uri);
  if (!LOCAL_REGISTRY_ARTIFACT_URIS.has(p?.source_file_uri) || !artifact || artifact.source_system !== record.source_system
    || artifact.source_sha256 !== p.source_sha256 || !Number.isSafeInteger(p.source_record_ordinal)
    || p.source_record_ordinal < 1 || p.source_record_ordinal > artifact.source_record_count
    || !/^[a-f0-9]{64}$/.test(p.record_sha256 ?? '') || !/^[a-f0-9]{64}$/.test(p.source_original_record_sha256 ?? '')
    || p.record_hash_codec !== 'canonical-integer-jsonb/1' || !Number.isFinite(Date.parse(p.observed_at ?? '')) || p.source_url !== undefined
    || p.normalizer_version !== 'local-source-registry-reviewed/3'
    || p.http_status != null || p.original_http_status != null || p.original_http_retrieval_at != null
    || record.data.source_original_record_sha256 !== p.source_original_record_sha256) {
    throw new Error('Invalid local registry artifact, ordinal, canonical hash, or local observation.');
  }
  const codec = p.source_file_uri.endsWith('.jsonl') ? 'utf8-jsonl-line/1' : 'canonical-string-csv-row/1';
  if (p.source_original_record_hash_codec !== codec || !record.data.source_record || Array.isArray(record.data.source_record)
    || hashBytes(canonicalIntegerJson(record.data)) !== p.record_sha256
    || (codec === 'canonical-string-csv-row/1' && hashBytes(canonicalIntegerJson(record.data.source_record)) !== p.source_original_record_sha256)) {
    throw new Error('Actual registry normalized payload or original CSV row hash mismatch.');
  }
  return record;
}
