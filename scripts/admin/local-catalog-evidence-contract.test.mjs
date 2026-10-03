import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalIntegerJson, hashBytes, localOccurrenceKey, validateLocalCatalogRecord, validateLocalCatalogUri } from './local-catalog-evidence-contract.mjs';

const uri = 'file:///C:/Users/firas/Downloads/SW-BULK/catalog/statute_nodes.csv';
const original = 'a'.repeat(64);
const artifact = { source_sha256: 'b'.repeat(64), source_record_count: 10 };
const artifacts = new Map([[uri, artifact]]);
function fixture() {
  const data = { local_id: 'usc:21-360k', publisher_native_entity: false, source_original_record_sha256: original, section: '360k', title: '21' };
  return { source_system: 'local-sw-catalog', schema_version: 'local-sw-catalog-evidence/1', entity_type: 'statute-references', native_id: data.local_id, data,
    provenance: { source_file_uri: uri, source_sha256: artifact.source_sha256, source_record_ordinal: 1,
      source_original_record_sha256: original, record_sha256: hashBytes(canonicalIntegerJson(data)),
      record_hash_codec: 'canonical-integer-jsonb/1', observed_at: '2026-10-02T12:00:00Z',
      retrieved_at: '2026-10-02T12:00:00Z', http_status: null, schema_version: 'local-sw-catalog-evidence/1',
      retrieved_at_basis: 'local_file_read_timestamp_not_upstream_retrieval' } };
}
test('accepts only the explicitly supplied local metadata roots', () => {
  assert.equal(validateLocalCatalogUri(uri), uri);
  for (const value of ['https://example.org/source.csv', 'file:///C:/Users/firas/Downloads/SW-BULK/catalog/../registry/records.jsonl',
    'file:///C:/Users/firas/Downloads/SW-BULK/catalog/%2e%2e/records.json', 'file://server/catalog/a.json',
    'file:///C:/Users/firas/Downloads/SW-BULK/recap-pdfs/file.pdf', uri + '?token=secret']) assert.throws(() => validateLocalCatalogUri(value));
});
test('pins the actual payload, registered original artifact, and ordinal', () => {
  const record = fixture();
  assert.equal(validateLocalCatalogRecord(record, artifacts), record);
  for (const mutate of [r => { r.data.section = 'changed'; }, r => { r.provenance.source_record_ordinal = 11; },
    r => { r.provenance.source_sha256 = 'c'.repeat(64); }, r => { r.provenance.source_url = 'https://example.org/invented'; },
    r => { r.data.publisher_native_entity = true; }, r => { r.source_system = 'courtlistener'; },
    r => { r.provenance.http_status = 200; }, r => { r.provenance.retrieved_at_basis = 'publisher_capture'; }]) {
    const changed = structuredClone(record); mutate(changed); assert.throws(() => validateLocalCatalogRecord(changed, artifacts));
  }
});
test('occurrences preserve identical rows in distinct original files or positions', () => {
  const record = fixture(), other = structuredClone(record); other.provenance.source_record_ordinal = 2;
  assert.notEqual(localOccurrenceKey(record), localOccurrenceKey(other));
});
test('canonical integer domain rejects unsupported numeric and string values', () => {
  assert.equal(canonicalIntegerJson({ z: null, a: ['é', 2, false] }), '{"a":["é",2,false],"z":null}');
  for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1, NaN, { value: undefined }, '\u0000', '\ud800']) assert.throws(() => canonicalIntegerJson(value));
});
