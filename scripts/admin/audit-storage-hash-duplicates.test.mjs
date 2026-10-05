import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidateGroups } from './audit-storage-hash-duplicates.mjs';

function sampleReport() {
  return {
    groups: Array.from({ length: 30 }, (_, i) => {
      const hash = String(i).padStart(64, '0');
      return {
        bucket_id: 'corpus-originals',
        path_sha256: hash,
        distinct_key_count: 2,
        min_declared_bytes: 7,
        max_declared_bytes: 7,
        keys_and_declared_bytes: [[`${hash.slice(0, 2)}/${hash}`, 7], [`seeger-weiss/pdf-sha256/${hash.slice(0, 2)}/${hash}.pdf`, 7]],
      };
    }),
  };
}

test('validates the bounded 30-group set and computes exact download cap', () => {
  assert.deepEqual(validateCandidateGroups(sampleReport()), { groups: 30, keys: 60, uniqueBytes: 210, downloadedBytes: 420 });
});

test('rejects candidates with conflicting declared sizes', () => {
  const report = sampleReport();
  report.groups[0].min_declared_bytes = 6;
  assert.throws(() => validateCandidateGroups(report), /DECLARED_SIZE_CONFLICT_OR_INVALID/);
});

test('rejects candidate paths that do not bind to the claimed hash', () => {
  const report = sampleReport();
  report.groups[0].keys_and_declared_bytes[0][0] = `00/${'f'.repeat(64)}`;
  assert.throws(() => validateCandidateGroups(report), /KEY_PATH_DOES_NOT_CONTAIN_HASH/);
});
