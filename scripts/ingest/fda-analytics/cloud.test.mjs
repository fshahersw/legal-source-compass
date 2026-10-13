import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CATALOG } from './catalog.mjs';
import { assertPublishableSnapshot, cloudClient, CORPUS_ORIGIN, putVerified, publishSnapshot } from './cloud.mjs';
import { verifySnapshotEvidence } from './verify.mjs';
import { queryUrl, readFacet } from './collect.mjs';
import { sha256, payloadHash } from '../regulatory/core.mjs';
import { canonicalIntegerJson } from '../../admin/local-catalog-evidence-contract.mjs';

// Entirely synthetic offline fixture; never a public source snapshot or production intake.
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fda-cloud-test-')); const directory = path.join(base, 'private'); await fs.mkdir(path.join(directory, 'objects'), { recursive: true });
  const receipt = async (url, json) => { const bytes = Buffer.from(JSON.stringify(json)); const hash = sha256(bytes); await fs.writeFile(path.join(directory, 'objects', hash + '.raw'), bytes); return { id: sha256(url + '\n' + hash), url, sha256: hash, retrievedAt: '2026-10-12T12:00:00Z', lastUpdated: json.meta.last_updated, byteCount: bytes.length, contentType: 'application/json', httpStatus: 200 }; };
  const d = CATALOG.find((v) => v.id === 'drug_ndc');
  const totalRaw = { meta: { last_updated: '2026-10-12', results: { total: 10 } }, results: [{ fixture: true }] };
  const countRaw = { meta: { last_updated: '2026-10-12' }, results: [{ term: 'A', count: 6 }, { term: 'B', count: 4 }] };
  const totals = await Promise.all(CATALOG.map((c) => receipt(queryUrl(c.endpoint), totalRaw)));
  const tr = totals[CATALOG.indexOf(d)]; const cr = await receipt(queryUrl(d.endpoint, undefined, d.facets[0].field), countRaw);
  const facet = readFacet({ json: countRaw }, 10, d.facets[0], { kind: 'inventory' }, [tr.id, cr.id]);
  const snapshot = { schemaVersion: 'fda-analytics/1', runId: randomUUID(), generatedAt: '2026-10-12T12:01:00Z', window: { from: '2024-10-12', to: '2026-10-11' }, datasets: CATALOG.map((c, index) => ({ id: c.id, endpoint: c.endpoint, label: c.label, documentationUrl: c.documentationUrl, productFamily: c.productFamily, countUnit: c.countUnit, status: 'ready', statusReason: null, retrievedAt: '2026-10-12T12:00:00Z', sourceUpdatedAt: '2026-10-12', qualification: c.qualification, total: { value: 10, scope: c.dateField ? 'all_time' : 'inventory', receiptIds: [totals[index].id] }, series: null, facets: c.id === d.id ? [facet] : [] })), receipts: [...totals, cr], qualifications: ['Offline test fixture only.'] };
  await fs.writeFile(path.join(directory, 'snapshot.json'), canonicalIntegerJson(snapshot));
  return { base, directory, snapshot, receipt };
}
function fakeCloud() {
  const objects = new Map(); const calls = []; let stored = null;
  return { objects, calls,
    async request(method, route, args) { calls.push({ method, route }); if (route === '/storage/v1/bucket/corpus-originals') return { status: 200, bytes: Buffer.from('{"id":"corpus-originals","public":false}') }; if (method === 'POST') { if (objects.has(route)) return { status: 409, bytes: null }; objects.set(route, args.bytes); return { status: 200, bytes: Buffer.from('{}') }; } return objects.has(route) ? { status: 200, bytes: objects.get(route) } : { status: 404, bytes: null }; },
    async rpc(name, args) { calls.push({ name }); if (name === 'corpus_fda_analytics_snapshot_v1') return stored; assert.equal(name, 'corpus_fda_analytics_publish_v1'); stored = { snapshot: args.p_snapshot, payloadSha256: args.p_payload_sha256 }; return { runId: args.p_run, payloadSha256: args.p_payload_sha256, status: 'completed', datasetCount: args.p_snapshot.datasets.length, receiptCount: args.p_receipts.length }; },
  };
}
test('all numeric aggregate evidence is independently rederived before publishing', async () => {
  const f = await fixture(); try { const proof = await verifySnapshotEvidence(f.snapshot, f.directory); assert.equal(proof.verified, true); f.snapshot.datasets.find((d) => d.id === 'drug_ndc').facets[0].buckets[0].count++; await assert.rejects(verifySnapshotEvidence(f.snapshot, f.directory), /FACET_EVIDENCE_MISMATCH/); } finally { await fs.rm(f.base, { recursive: true, force: true }); }
});
test('independent verifier rejects numerically plausible mixed-release facet evidence', async () => {
  const f = await fixture(); try { const old = f.snapshot.receipts.at(-1); const changed = await f.receipt(old.url, { meta: { last_updated: '2026-10-11' }, results: [{ term: 'A', count: 6 }, { term: 'B', count: 4 }] }); f.snapshot.receipts[f.snapshot.receipts.length - 1] = changed; f.snapshot.datasets.find((d) => d.id === 'drug_ndc').facets[0].receiptIds[1] = changed.id; await assert.rejects(verifySnapshotEvidence(f.snapshot, f.directory), /METRIC_RELEASE_EVIDENCE_MISMATCH/); } finally { await fs.rm(f.base, { recursive: true, force: true }); }
});
test('any partial/failed/unavailable dataset blockspublication before allnetwork activity and preserveslocal evidence', async () => {
  const f = await fixture();
  try {
    const before = await fs.readFile(path.join(f.directory, 'snapshot.json'));
    for (const status of ['partial', 'failed', 'unavailable']) {
      const snapshot = structuredClone(f.snapshot); snapshot.datasets[0].status = status; snapshot.datasets[0].statusReason = 'SYNTHETIC_SOURCE_OUTAGE';
      const cloud = fakeCloud();
      assert.throws(() => assertPublishableSnapshot(snapshot), /DEGRADED_CAPTURE_NOT_PUBLISHED/);
      await assert.rejects(publishSnapshot({ snapshot, directory: f.directory, cloud }), /DEGRADED_CAPTURE_NOT_PUBLISHED/);
      assert.equal(cloud.calls.length, 0); assert.equal(cloud.objects.size, 0);
      assert.deepEqual(await fs.readFile(path.join(f.directory, 'snapshot.json')), before);
    }
    assert.doesNotThrow(() => assertPublishableSnapshot(f.snapshot));
  } finally { await fs.rm(f.base, { recursive: true, force: true }); }
});
test('landingCLI exitsnonzero fordegradedcapture before requiringcredentials and retainscapturebytes', async () => {
  const f = await fixture();
  try {
    f.snapshot.datasets[0].status = 'partial'; f.snapshot.datasets[0].statusReason = 'SYNTHETIC_SOURCE_OUTAGE';
    const bytes = Buffer.from(canonicalIntegerJson(f.snapshot)); await fs.writeFile(path.join(f.directory, 'snapshot.json'), bytes);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url)), 'land', '--execute', `--output=${f.directory}`], { encoding: 'utf8', env: {}, timeout: 10000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /DEGRADED_CAPTURE_NOT_PUBLISHED/); assert.doesNotMatch(result.stderr, /CORPUS_CREDENTIALS_REQUIRED/);
    assert.deepEqual(await fs.readFile(path.join(f.directory, 'snapshot.json')), bytes);
  } finally { await fs.rm(f.base, { recursive: true, force: true }); }
});
test('publish verifies immutable private raw and snapshot objects beforeatomicRPC and full hashreadback', async () => {
  const f = await fixture(); try { const cloud = fakeCloud(); const done = await publishSnapshot({ ...f, cloud }); assert.equal(done.readbackVerified, true); assert.equal(done.payloadSha256, payloadHash(f.snapshot)); assert.equal(cloud.objects.size, 3); const journal = (await fs.readFile(path.join(f.directory, 'objects-journal.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse); assert.equal(journal.filter((j) => j.verified).length, 3); const repeated = await publishSnapshot({ ...f, cloud }); assert.equal(repeated.resumed, true); assert.equal(cloud.calls.filter((c) => c.name === 'corpus_fda_analytics_publish_v1').length, 1); } finally { await fs.rm(f.base, { recursive: true, force: true }); }
});
test('readback failure journals creation before failure and never overwrites mismatchedexistingobjects', async () => {
  const f = await fixture(); try { const cloud = fakeCloud(); const bytes = Buffer.from('synthetic'); const hash = sha256(bytes); const key = `fda-analytics/${hash.slice(0, 2)}/${hash}.raw`; const route = '/storage/v1/object/corpus-originals/' + key; cloud.objects.set(route, Buffer.from('wrong')); await assert.rejects(putVerified(cloud, key, bytes, path.join(f.directory, 'j.jsonl')), /STORAGE_HASH_READBACK_MISMATCH/); assert.equal(cloud.calls.filter((c) => c.method === 'POST').length, 0); } finally { await fs.rm(f.base, { recursive: true, force: true }); }
});
test('admin transport rejects otherorigins/routes/redirects; authfailures are not missingobjects', async () => {
  assert.throws(() => cloudClient({ EXTERNAL_SUPABASE_URL: 'https://example.com', EXTERNAL_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture' }), /CORPUS_CREDENTIALS_REQUIRED/);
  let calls = 0; const client = cloudClient({ EXTERNAL_SUPABASE_URL: CORPUS_ORIGIN, EXTERNAL_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture' }, async (_u, init) => { calls++; assert.equal(init.redirect, 'manual'); assert.equal(init.headers['x-upsert'], 'false'); return new Response('denied', { status: 403 }); }, async () => {});
  await assert.rejects(client.request('POST', '/rest/v1/rpc/unrelated'), /CORPUS_ROUTE_DISALLOWED/); assert.equal(calls, 0);
  await assert.rejects(client.request('GET', '/storage/v1/bucket/corpus-originals'), /CORPUS_HTTP_403/); assert.equal(calls, 1);
});
