import { canonicalIntegerJson, hashBytes } from './local-catalog-evidence-contract.mjs';

export function validateLocalStatuteUri(value) {
  if (typeof value !== 'string' || !/^file:\/\/\/C:\/Users\/firas\/Downloads\/SW-BULK\/corpus\/statutes\/vaquill\/(v2026\.07|v2026\.08)\/us_[a-z]{2}_statutes\.parquet$/.test(value)) {
    throw new Error('Expected an original July/August Vaquill state-statute Parquet URI.');
  }
  return value;
}

export function validateLocalStatuteRecord(record, artifacts) {
  if (record?.source_system !== 'local-vaquill-open-us-law' || record.schema_version !== 'local-vaquill-state-evidence/1'
    || !/^[a-z][a-z0-9-]{0,80}$/.test(record.entity_type ?? '') || typeof record.native_id !== 'string'
    || !record.native_id || record.native_id.length > 512 || !record.data || Array.isArray(record.data)
    || record.data.local_id !== record.native_id || record.data.publisher_native_entity !== false) {
    throw new Error('Invalid local statute namespace, identity or publisher qualifier.');
  }
  const p = record.provenance, uri = validateLocalStatuteUri(p?.source_file_uri), artifact = artifacts.get(uri);
  if (!artifact || artifact.source_system !== record.source_system || artifact.source_sha256 !== p.source_sha256
    || !Number.isSafeInteger(p.source_record_ordinal) || p.source_record_ordinal < 1 || p.source_record_ordinal > artifact.source_record_count
    || !/^[a-f0-9]{64}$/.test(p.record_sha256 ?? '') || !/^[a-f0-9]{64}$/.test(p.source_original_record_sha256 ?? '')
    || p.record_hash_codec !== 'canonical-integer-jsonb/1' || p.source_original_record_hash_codec !== 'canonical-integer-jsonb/1'
    || p.source_url !== undefined || p.retrieval_method !== 'local_parquet_read' || !Number.isFinite(Date.parse(p.observed_at ?? ''))
    || p.original_http_status !== null || p.original_http_retrieval_at !== null || p.remote_capture_date !== null) {
    throw new Error('Invalid registered local statute artifact, ordinal, codec or observation provenance.');
  }
  for (const gate of ['current_law_verified', 'public_projection_allowed', 'calculation_activation_allowed']) {
    if (record.data[gate] !== false || p[gate] !== false) throw new Error('Unverified local statute cannot activate a legal or publication gate.');
  }
  if (!record.data.source_record || Array.isArray(record.data.source_record)
    || record.data.source_original_record_sha256 !== p.source_original_record_sha256
    || hashBytes(canonicalIntegerJson(record.data.source_record)) !== p.source_original_record_sha256
    || hashBytes(canonicalIntegerJson(record.data)) !== p.record_sha256) {
    throw new Error('Local statute original row or actual normalized payload hash mismatch.');
  }
  return record;
}
