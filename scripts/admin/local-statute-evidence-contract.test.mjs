import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalIntegerJson, hashBytes } from './local-catalog-evidence-contract.mjs';
import { validateLocalStatuteRecord, validateLocalStatuteUri } from './local-statute-evidence-contract.mjs';
import { selectLocalEvidenceWinner } from './local-evidence-winner.mjs';

const uri = 'file:///C:/Users/firas/Downloads/SW-BULK/corpus/statutes/vaquill/v2026.07/us_ms_statutes.parquet';
const artifact = { source_system: 'local-vaquill-open-us-law', source_sha256: 'b'.repeat(64), source_record_count: 9000 };
const artifacts = new Map([[uri, artifact]]);
function fixture() {
  const source_record = { section_number: '1-49', citation: 'Miss. Code Ann. § 15-1-49', full_text: 'Original supplied text.' };
  const original = hashBytes(canonicalIntegerJson(source_record));
  const data = { local_id: 'occurrence:001', publisher_native_entity: false, current_law_verified: false,
    public_projection_allowed: false, calculation_activation_allowed: false, source_original_record_sha256: original, source_record };
  return { source_system: artifact.source_system, schema_version: 'local-vaquill-state-evidence/1', entity_type: 'state-statute-local-review', native_id: data.local_id, data,
    provenance: { source_file_uri: uri, source_sha256: artifact.source_sha256, source_record_ordinal: 1,
      source_original_record_sha256: original, source_original_record_hash_codec: 'canonical-integer-jsonb/1',
      record_sha256: hashBytes(canonicalIntegerJson(data)), record_hash_codec: 'canonical-integer-jsonb/1', observed_at: '2026-10-02T12:00:00Z',
      original_http_retrieval_at: null, original_http_status: null, remote_capture_date: null, retrieval_method: 'local_parquet_read',
      current_law_verified: false, public_projection_allowed: false, calculation_activation_allowed: false } };
}
test('statute URI allows only the exact secondary-source snapshot roots', () => {
  assert.equal(validateLocalStatuteUri(uri), uri);
  for (const value of [uri.replace('/v2026.07/', '/v2026.09/'), uri.replace('/v2026.07/', '/v2026.07/../v2026.08/'),
    uri.replace('/v2026.07/', '/v2026.07/%2e%2e/'), uri.replace('_statutes.parquet', '_constitutions.parquet'),
    'file:///C:/Users/firas/Downloads/SW-BULK/catalog/statutes.json', uri + '#row1']) assert.throws(() => validateLocalStatuteUri(value));
});
test('rejects unregistered artifact, bad codec, invalid ordinal, and actual row drift', () => {
  assert.equal(validateLocalStatuteRecord(fixture(), artifacts).source_system, artifact.source_system);
  assert.throws(() => validateLocalStatuteRecord(fixture(), new Map()));
  for (const mutate of [r => { r.provenance.source_sha256 = 'c'.repeat(64); }, r => { r.provenance.record_hash_codec = 'guessed'; },
    r => { r.provenance.source_record_ordinal = 0; }, r => { r.provenance.source_record_ordinal = 9001; },
    r => { r.data.source_record.section_number = '15-1-49'; }, r => { r.provenance.original_http_status = 200; },
    r => { r.provenance.source_url = 'https://example.org/invented'; }, r => { r.source_system = 'courtlistener'; }]) {
    const r = fixture(); mutate(r); assert.throws(() => validateLocalStatuteRecord(r, artifacts));
  }
});
test('all legal and publication gates must remain explicitly false', () => {
  for (const gate of ['current_law_verified', 'public_projection_allowed', 'calculation_activation_allowed']) {
    for (const side of ['data', 'provenance']) { const r = fixture(); r[side][gate] = true; assert.throws(() => validateLocalStatuteRecord(r, artifacts)); }
  }
});
test('canonical winner is independent of input and batch order', () => {
  const base = fixture();
  const candidates = [['2026-07-21', '2026-10-02T12:00:00Z', '0'], ['2026-08-16', '2026-10-02T11:00:00Z', 'c'],
    ['2026-08-16', '2026-10-02T12:00:00Z', 'f'], ['2026-08-16', '2026-10-02T12:00:00Z', 'a']].map(([date, at, digit]) => {
    const r = structuredClone(base); Object.assign(r.provenance, { local_snapshot_as_of: date, observed_at: at, record_sha256: digit.repeat(64) }); return r;
  });
  function permutations(items) { return items.length <= 1 ? [items] : items.flatMap((r, i) => permutations(items.filter((_, j) => i !== j)).map(rest => [r, ...rest])); }
  for (const order of permutations(candidates)) {
    assert.equal(order.reduce(selectLocalEvidenceWinner, null).provenance.record_sha256, 'a'.repeat(64));
    const left = order.slice(0, 2).reduce(selectLocalEvidenceWinner, null), right = order.slice(2).reduce(selectLocalEvidenceWinner, null);
    assert.equal(selectLocalEvidenceWinner(left, right).provenance.record_sha256, 'a'.repeat(64));
  }
  const unrelated = fixture(); unrelated.native_id = 'other-occurrence'; assert.throws(() => selectLocalEvidenceWinner(base, unrelated));
});
