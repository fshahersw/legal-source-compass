import { createHash } from 'node:crypto';

export const LOCAL_CATALOG_SOURCE = 'local-sw-catalog';
export const LOCAL_CATALOG_SCHEMA = 'local-sw-catalog-evidence/1';
export const hashBytes = (value) => createHash('sha256').update(value).digest('hex');

export function validateLocalCatalogUri(value) {
  if (typeof value !== 'string' || !/^file:\/\/\/C:\/Users\/firas\/Downloads\/SW-BULK\/(catalog|catalog_test)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(json|jsonl|csv|parquet)$/.test(value)
    || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) {
    throw new Error('Expected an absolute metadata file URI in the supplied catalog roots.');
  }
  return value;
}

export function canonicalIntegerJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && (/\u0000/.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))) {
      throw new Error('Unsupported normalized JSON string.');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Expected a safe integer normalized payload.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalIntegerJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort();
    if (keys.some((key) => /[^\x20-\x7e]/.test(key))) throw new Error('Normalized field names must be ASCII for the pinned canonical codec.');
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalIntegerJson(value[key])}`).join(',')}}`;
  }
  throw new Error('Unsupported normalized JSON value.');
}

export function validateLocalCatalogRecord(record, artifacts) {
  if (record?.source_system !== LOCAL_CATALOG_SOURCE || record.schema_version !== LOCAL_CATALOG_SCHEMA
    || !/^[a-z][a-z0-9-]{0,80}$/.test(record.entity_type ?? '') || typeof record.native_id !== 'string' || !record.native_id
    || record.native_id.length > 512 || !record.data || Array.isArray(record.data)
    || record.data.publisher_native_entity !== false || record.data.local_id !== record.native_id) {
    throw new Error('Invalid local source namespace, identity, schema, or publisher qualifier.');
  }
  const provenance = record.provenance;
  const uri = validateLocalCatalogUri(provenance?.source_file_uri);
  const artifact = artifacts.get(uri);
  if (!artifact || artifact.source_sha256 !== provenance.source_sha256
    || !Number.isSafeInteger(provenance.source_record_ordinal) || provenance.source_record_ordinal < 1
    || provenance.source_record_ordinal > artifact.source_record_count
    || !/^[a-f0-9]{64}$/.test(provenance.record_sha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(provenance.source_original_record_sha256 ?? '')
    || provenance.record_hash_codec !== 'canonical-integer-jsonb/1'
    || provenance.source_original_record_sha256 !== record.data.source_original_record_sha256
    || !Number.isFinite(Date.parse(provenance.observed_at ?? '')) || provenance.source_url !== undefined
    || provenance.http_status !== null || provenance.schema_version !== record.schema_version
    || provenance.retrieved_at !== provenance.observed_at
    || provenance.retrieved_at_basis !== 'local_file_read_timestamp_not_upstream_retrieval') {
    throw new Error('Invalid registered artifact, ordinal, observation or payload provenance.');
  }
  if (hashBytes(canonicalIntegerJson(record.data)) !== provenance.record_sha256) {
    throw new Error('Actual local payload hash differs from its pinned hash.');
  }
  return record;
}

export function localOccurrenceKey(record) {
  const p = record.provenance;
  return JSON.stringify([record.source_system, record.entity_type, record.native_id, p.record_sha256,
    p.source_file_uri, p.source_sha256, p.source_record_ordinal]);
}
