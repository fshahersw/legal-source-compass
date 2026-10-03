import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalIntegerJson, hashBytes } from './local-catalog-evidence-contract.mjs';
import { validateLocalRegistryRecord } from './local-registry-evidence-contract.mjs';
const uri = 'file:///C:/Users/firas/Downloads/courtformsTHREE/SOURCE-INDEX.csv';
const artifact = { source_system: 'local-source-registry', source_sha256: 'b'.repeat(64), source_record_count: 444 };
const artifacts = new Map([[uri, artifact]]);
const scope = { source_system: artifact.source_system, public_projection_allowed: false, calculation_activation_allowed: false,
  schema_version: 'local-source-registry-evidence/2', normalizer_version: 'local-source-registry-reviewed/3',
  raw_source_occurrences_independently_verified: true, raw_source_verification_sha256: 'c'.repeat(64) };
function fixture() {
  const source_record = { url: 'https://www.example.gov/forms', label: 'Source-provided form claim' }, original = hashBytes(canonicalIntegerJson(source_record));
  const data = { local_id: 'source:001', publisher_native_entity: false, source_original_record_sha256: original, source_record,
    normalizer_version: 'local-source-registry-reviewed/3',
    public_projection_allowed: false, calculation_activation_allowed: false, credential_locator_held: false,
    public_projection_eligible: false, fresh_http_verification: false, legal_authority_or_outcome_verified: false, binary_checksum_independently_verified: false };
  return { source_system: artifact.source_system, schema_version: 'local-source-registry-evidence/2', entity_type: 'form-reference', native_id: data.local_id, data,
    provenance: { source_file_uri: uri, source_sha256: artifact.source_sha256, source_record_ordinal: 1, source_original_record_sha256: original,
      source_original_record_hash_codec: 'canonical-string-csv-row/1', record_hash_codec: 'canonical-integer-jsonb/1',
      normalizer_version: 'local-source-registry-reviewed/3',
      record_sha256: hashBytes(canonicalIntegerJson(data)), observed_at: '2026-10-02T12:00:00Z' } };
}
test('registry packet requires independently audited original occurrences', () => {
  assert.equal(validateLocalRegistryRecord(fixture(), artifacts, scope).source_system, artifact.source_system);
  assert.throws(() => validateLocalRegistryRecord(fixture(), artifacts, { ...scope, raw_source_occurrences_independently_verified: false }));
  assert.throws(() => validateLocalRegistryRecord(fixture(), new Map(), scope));
});
test('rejects cross-root paths, traversal, bad codec, bad ordinal and publisher flags', () => {
  for (const mutate of [r => { r.provenance.source_file_uri = uri.replace('/courtformsTHREE/', '/other-root/'); },
    r => { r.provenance.source_file_uri = uri.replace('/SOURCE-INDEX.csv', '/../SOURCE-INDEX.csv'); },
    r => { r.provenance.source_record_ordinal = 445; }, r => { r.provenance.source_record_ordinal = -1; },
    r => { r.provenance.source_original_record_hash_codec = 'utf8-jsonl-line/1'; }, r => { r.data.publisher_native_entity = true; },
    r => { r.data.normalizer_version = 'local-source-registry-reviewed/2'; },
    r => { r.provenance.source_url = 'https://example.org/invented-source'; }, r => { r.provenance.http_status = 200; }]) {
    const record = fixture(); mutate(record); assert.throws(() => validateLocalRegistryRecord(record, artifacts, scope));
  }
});
test('false legal, publication, freshness and binary gates are required', () => {
  for (const gate of ['public_projection_eligible', 'public_projection_allowed', 'calculation_activation_allowed', 'credential_locator_held', 'fresh_http_verification', 'legal_authority_or_outcome_verified', 'binary_checksum_independently_verified']) {
    const record = fixture(); record.data[gate] = true; assert.throws(() => validateLocalRegistryRecord(record, artifacts, scope));
  }
});
test('changing original CSV row and repinning normalized SHA still fails original-row verification', () => {
  const record = fixture(); record.data.source_record.label = 'Changed claim'; record.provenance.record_sha256 = hashBytes(canonicalIntegerJson(record.data));
  assert.throws(() => validateLocalRegistryRecord(record, artifacts, scope));
});
