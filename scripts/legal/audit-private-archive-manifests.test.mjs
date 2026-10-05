import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateArchiveManifest } from './audit-private-archive-manifests.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(version = 1) {
  const sha256 = 'a'.repeat(64), bytes = 3;
  const chunks = [{ index: 0, offset: 0, bytes, sha256: 'b'.repeat(64),
    object_key: version === 1
      ? `legal-atlas/originals/sha256/${sha256}/chunk-000000-${'b'.repeat(64)}`
      : `legal-atlas/chunks/sha256/${'b'.repeat(64)}` }];
  const manifest = { schema_version: `legal-atlas-private-original/${version}`, project_id: 'xosqzzsnhxcyehcnirpa',
    bucket: 'corpus-originals', original_name: 'fixture.bin', bytes, sha256, provenance: {}, chunks };
  const raw = Buffer.from(JSON.stringify(manifest));
  return { raw, descriptor: { sha256, bytes, bucket: 'corpus-originals',
    manifest_key: `legal-atlas/originals/sha256/${sha256}/manifest.json`, manifest_sha256: hash(raw) } };
}

test('validates v1 chunked archive manifest and emits exact key references', () => {
  const { raw, descriptor } = fixture(1);
  const result = validateArchiveManifest(descriptor, raw);
  assert.equal(result.chunk_count, 1);
  assert.equal(result.chunks[0].object_key, `legal-atlas/originals/sha256/${'a'.repeat(64)}/chunk-000000-${'b'.repeat(64)}`);
});

test('validates v2 content-addressed chunk keys', () => {
  const { raw, descriptor } = fixture(2);
  assert.equal(validateArchiveManifest(descriptor, raw).chunks[0].object_key, `legal-atlas/chunks/sha256/${'b'.repeat(64)}`);
});

test('rejects tampered manifest bytes before parsing references', () => {
  const { raw, descriptor } = fixture();
  const modified = Buffer.from(raw); modified[modified.length - 2] ^= 1;
  assert.throws(() => validateArchiveManifest(descriptor, modified), /SHA-256 mismatch/);
});

test('rejects a chunk key that does not match its hash and schema version', () => {
  const { raw, descriptor } = fixture(1);
  const manifest = JSON.parse(raw);
  manifest.chunks[0].object_key = `legal-atlas/chunks/sha256/${manifest.chunks[0].sha256}`;
  const bad = Buffer.from(JSON.stringify(manifest));
  descriptor.manifest_sha256 = hash(bad);
  assert.throws(() => validateArchiveManifest(descriptor, bad), /object key does not match/);
});

