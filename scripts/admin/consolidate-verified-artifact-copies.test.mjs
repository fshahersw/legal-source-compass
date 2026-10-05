import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsolidationPlan } from './consolidate-verified-artifact-copies.mjs';

const RUN_ID = 'acb5e84e-bfb1-4e6d-8212-f2f13ee673f7';

function fixture() {
  const report = { candidate_groups: 30, candidate_keys: 60, groups: [], corpus_artifact_rows: [] };
  const recovery = {
    target_project: 'xosqzzsnhxcyehcnirpa',
    bucket: 'corpus-originals',
    summary: { all_groups_verified: true },
    groups: [],
  };
  for (let i = 0; i < 30; i++) {
    const hash = (i + 1).toString(16).padStart(64, '0');
    const bytes = 100 + i;
    const legacyKey = `${hash.slice(0, 2)}/${hash}`;
    const canonicalKey = `seeger-weiss/pdf-sha256/${hash.slice(0, 2)}/${hash}.pdf`;
    const fullMatterKey = `seeger-weiss/full-matter-audit-sha256/${hash.slice(0, 2)}/${hash}`;
    const bundleKey = `atlas-private-data/sha256/${hash.slice(0, 2)}/${hash}.bin`;
    const retainedKey = i < 25 ? canonicalKey : i < 27 ? bundleKey : fullMatterKey;
    const routes = i === 0 ? [`/fixture/${i}/a`, `/fixture/${i}/b`] : i < 29 ? [`/fixture/${i}`] : [];
    const legacy = {
      object_key: i < 29 ? legacyKey : fullMatterKey,
      declared_bytes: bytes,
      stored_bytes: bytes,
      storage_object_present: true,
      references: i < 29
        ? routes.map(source_id => ({ ref_kind: 'corpus_artifacts', expected_sha256: hash, expected_bytes: bytes, source_id }))
        : [{ ref_kind: 'seeger_full_matter_archive_file', expected_sha256: hash, expected_bytes: bytes, source_id: 'fixture-map' }],
    };
    const retained = {
      object_key: i < 29 ? retainedKey : canonicalKey,
      declared_bytes: bytes,
      stored_bytes: bytes,
      storage_object_present: true,
      references: [{ ref_kind: i < 25 || i === 29 ? 'pdf_objects' : i < 27 ? 'private_bundle_manifest' : 'seeger_full_matter_archive_file',
        expected_sha256: hash, expected_bytes: bytes, source_id: hash }],
    };
    const keys = [legacy, retained];
    report.groups.push({ sha256: hash, keys });
    for (const route of routes) {
      report.corpus_artifact_rows.push({
        route,
        object_key: legacyKey,
        sha256: hash,
        bytes,
        ready: true,
        mime: 'application/pdf',
        filename: `source-${i}.pdf`,
        label: `Fixture ${i}`,
        metadata: { source_occurrence: `occ-${i}`, preserved: true },
      });
    }
    recovery.groups.push({
      sha256: hash,
      bytes,
      all_object_bodies_sha256_verified: true,
      byte_equal: true,
      recovery_sha256: hash,
      recovery_file: `${hash}.bin`,
      verified_object_keys: keys.map(key => key.object_key),
    });
  }
  return { report, recovery };
}

test('plans 29 mutable aliases and retains one immutable group while changing only object_key', () => {
  const { report, recovery } = fixture();
  const plan = buildConsolidationPlan(report, recovery, RUN_ID);
  assert.equal(plan.objects.length, 29);
  assert.equal(plan.rows.length, 30);
  assert.equal(plan.retained.length, 1);
  assert.equal(plan.objects.reduce((n, row) => n + row.bytes, 0), 100 + Array.from({ length: 29 }, (_, i) => 100 + i).slice(1).reduce((a, b) => a + b, 0));
  for (const { before, after } of plan.rows) {
    assert.equal(after.object_key, plan.objects.find(object => object.sha256 === before.sha256).retained_key);
    assert.deepEqual({ ...after, object_key: before.object_key }, before);
  }
});

test('rejects any legacy key with a non-artifact reference', () => {
  const { report, recovery } = fixture();
  report.groups[0].keys[0].references.push({ ref_kind: 'pdf_asset_observation', expected_sha256: report.groups[0].sha256, expected_bytes: 100 });
  assert.throws(() => buildConsolidationPlan(report, recovery, RUN_ID), /LEGACY_REFERENCE_NOT_MUTABLE_ARTIFACT/);
});

test('rejects incomplete full-body proof for a key scheduled for consolidation', () => {
  const { report, recovery } = fixture();
  recovery.groups[8].all_object_bodies_sha256_verified = false;
  assert.throws(() => buildConsolidationPlan(report, recovery, RUN_ID), /BODY_PROOF_MISMATCH/);
});

test('rejects changed candidate totals or a changed route population', () => {
  const wrongTotal = fixture();
  wrongTotal.report.candidate_keys = 59;
  assert.throws(() => buildConsolidationPlan(wrongTotal.report, wrongTotal.recovery, RUN_ID), /AUDIT_SCOPE_MISMATCH/);

  const wrongRoutes = fixture();
  wrongRoutes.report.corpus_artifact_rows.pop();
  assert.throws(() => buildConsolidationPlan(wrongRoutes.report, wrongRoutes.recovery, RUN_ID), /ARTIFACT_SET_MISMATCH/);
});
