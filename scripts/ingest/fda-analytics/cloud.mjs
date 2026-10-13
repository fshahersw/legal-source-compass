/** Offline administrative CLI module. Never import into browser or app server handlers. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalIntegerJson } from '../../admin/local-catalog-evidence-contract.mjs';
import { boundedBytes, requireValue, sha256, payloadHash, retryDelay, MonitorError, atomicJson } from '../regulatory/core.mjs';
import { appendJournal } from '../regulatory/cloud.mjs';
import { verifySnapshotEvidence } from './verify.mjs';
export const CORPUS_ORIGIN = 'https://xosqzzsnhxcyehcnirpa.supabase.co';
export function assertPublishableSnapshot(snapshot) {
  requireValue(Array.isArray(snapshot?.datasets) && snapshot.datasets.length > 0 && snapshot.datasets.every((dataset) => dataset.status === 'ready'), 'DEGRADED_CAPTURE_NOT_PUBLISHED');
}
export function cloudClient(env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const origin = env.EXTERNAL_SUPABASE_URL; const key = env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? env.EXTERNAL_SUPABASE_KEY;
  requireValue(origin === CORPUS_ORIGIN && typeof key === 'string', 'CORPUS_CREDENTIALS_REQUIRED');
  if (key.startsWith('ey')) { let claims; try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); } catch { throw new MonitorError('CORPUS_SERVICE_ROLE_REQUIRED'); } requireValue(claims.role === 'service_role' && claims.ref === 'xosqzzsnhxcyehcnirpa', 'CORPUS_SERVICE_ROLE_REQUIRED'); }
  else requireValue(key.startsWith('sb_secret_'), 'CORPUS_SERVICE_ROLE_REQUIRED');
  let nextAllowedAt = 0;
  async function request(method, route, { json, bytes, contentType = 'application/json', accepted = [] } = {}) {
    requireValue((method === 'POST' && ['/rest/v1/rpc/corpus_fda_analytics_publish_v1', '/rest/v1/rpc/corpus_fda_analytics_snapshot_v1'].includes(route)) || (method === 'GET' && route === '/storage/v1/bucket/corpus-originals') || (['GET', 'POST'].includes(method) && /^\/storage\/v1\/object\/corpus-originals\/fda-analytics\/(?:[a-f0-9]{2}\/[a-f0-9]{64}\.raw|snapshots\/[a-f0-9]{64}\.json)$/.test(route)), 'CORPUS_ROUTE_DISALLOWED');
    for (let attempt = 0; attempt < 4; attempt++) {
      let response;
      try {
        await sleep(Math.max(0, nextAllowedAt - Date.now()));
        response = await fetchImpl(origin + route, { method, redirect: 'manual', headers: { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': contentType, 'x-upsert': 'false' }, body: bytes ?? (json === undefined ? undefined : JSON.stringify(json)), signal: AbortSignal.timeout(120000) });
        if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); if (attempt === 3) throw new MonitorError(`CORPUS_HTTP_${response.status}`); const delay = retryDelay(response.headers.get('retry-after'), attempt); nextAllowedAt = Math.max(nextAllowedAt, Date.now() + delay); await sleep(delay); continue; }
        if (accepted.includes(response.status)) { await response.body?.cancel(); return { status: response.status, bytes: null }; }
        if (method === 'GET' && route.startsWith('/storage/v1/object/') && accepted.includes(404) && response.status === 400) {
          const raw = await boundedBytes(response, 20000); let error; try { error = JSON.parse(raw); } catch { throw new MonitorError('CORPUS_HTTP_400'); }
          requireValue(String(error.statusCode) === '404' && ['not_found', 'not_found_resource', 'NoSuchKey'].includes(error.error ?? error.code), 'CORPUS_HTTP_400'); return { status: 404, bytes: null };
        }
        requireValue(response.ok, `CORPUS_HTTP_${response.status}`); return { status: response.status, bytes: await boundedBytes(response, 13 * 1024 * 1024) };
      } catch (error) { await response?.body?.cancel().catch(() => {}); if (error instanceof MonitorError || attempt === 3) throw error instanceof MonitorError ? error : new MonitorError('CORPUS_TRANSPORT_FAILED'); await sleep(retryDelay(null, attempt)); }
    }
    throw new MonitorError('CORPUS_TRANSPORT_FAILED');
  }
  return { request, async rpc(name, args) { const result = await request('POST', `/rest/v1/rpc/${name}`, { json: args }); try { return JSON.parse(result.bytes); } catch { throw new MonitorError('CORPUS_JSON_INVALID'); } } };
}
const journals = new Map();
function journalRecord(file, record) { const queued = (journals.get(file) ?? Promise.resolve()).then(() => appendJournal(file, record)); journals.set(file, queued); return queued; }
export async function putVerified(cloud, storageKey, bytes, journal) {
  const hash = sha256(bytes); requireValue(storageKey === `fda-analytics/${hash.slice(0, 2)}/${hash}.raw` || storageKey === `fda-analytics/snapshots/${hash}.json`, 'STORAGE_KEY_INVALID');
  requireValue(bytes.length > 0 && bytes.length <= 12 * 1024 * 1024, 'STORAGE_SIZE_INVALID');
  const route = `/storage/v1/object/corpus-originals/${storageKey}`; let found = await cloud.request('GET', route, { accepted: [404] }); let created = false;
  if (found.status === 404) {
    const put = await cloud.request('POST', route, { bytes, accepted: [409] }); created = put.status !== 409;
    await journalRecord(journal, { storageKey, sha256: hash, byteCount: bytes.length, created, verified: false, observedAt: new Date().toISOString() });
    found = await cloud.request('GET', route);
  }
  requireValue(found.bytes?.length === bytes.length && sha256(found.bytes) === hash, 'STORAGE_HASH_READBACK_MISMATCH');
  const receipt = { storageKey, sha256: hash, byteCount: bytes.length, created, verified: true, observedAt: new Date().toISOString() }; await journalRecord(journal, receipt); return receipt;
}
export async function publishSnapshot({ snapshot, directory, cloud }) {
  assertPublishableSnapshot(snapshot);
  requireValue(/(?:^|[\\/])private(?:[\\/]|$)/i.test(path.resolve(directory)), 'PRIVATE_DIRECTORY_REQUIRED');
  const verification = await verifySnapshotEvidence(snapshot, directory);
  requireValue(snapshot.datasets.some((d) => d.total.value !== null), 'NO_VERIFIED_METRICS_TO_PUBLISH');
  const canonical = Buffer.from(canonicalIntegerJson(snapshot)); const hash = payloadHash(snapshot);
  const stored = await fs.readFile(path.join(directory, 'snapshot.json')); requireValue(sha256(stored) === hash && stored.equals(canonical), 'SNAPSHOT_FILE_MISMATCH');
  await atomicJson(path.join(directory, 'verification.json'), verification);
  const bucket = JSON.parse((await cloud.request('GET', '/storage/v1/bucket/corpus-originals')).bytes); requireValue(bucket.id === 'corpus-originals' && bucket.public === false, 'PRIVATE_BUCKET_REQUIRED');
  const existing = await cloud.rpc('corpus_fda_analytics_snapshot_v1', { p_run: snapshot.runId });
  if (existing) { requireValue(existing.payloadSha256 === hash && payloadHash(existing.snapshot) === hash, 'EXISTING_SNAPSHOT_MISMATCH'); return { runId: snapshot.runId, payloadSha256: hash, status: 'completed', resumed: true, datasetCount: snapshot.datasets.length, receiptCount: snapshot.receipts.length }; }
  const journal = path.join(directory, 'objects-journal.jsonl'); const unique = [...new Map(snapshot.receipts.map((r) => [r.sha256, r])).values()]; let cursor = 0; let failed = false;
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (!failed && cursor < unique.length) { const r = unique[cursor++]; try { await putVerified(cloud, `fda-analytics/${r.sha256.slice(0, 2)}/${r.sha256}.raw`, await fs.readFile(path.join(directory, 'objects', r.sha256 + '.raw')), journal); } catch (error) { failed = true; throw error; } }
  }));
  const failure = outcomes.find((r) => r.status === 'rejected'); if (failure) throw failure.reason;
  const receipts = snapshot.receipts.map((r) => ({ id: r.id, storageKey: `fda-analytics/${r.sha256.slice(0, 2)}/${r.sha256}.raw`, readbackSha256: r.sha256 }));
  await putVerified(cloud, `fda-analytics/snapshots/${hash}.json`, canonical, journal);
  await atomicJson(path.join(directory, 'storage-checkpoint.json'), { runId: snapshot.runId, payloadSha256: hash, verifiedObjects: unique.length + 1, receiptCount: receipts.length, readyToPublish: true });
  const result = await cloud.rpc('corpus_fda_analytics_publish_v1', { p_run: snapshot.runId, p_snapshot: snapshot, p_payload_sha256: hash, p_receipts: receipts });
  requireValue(result.runId === snapshot.runId && result.payloadSha256 === hash && result.status === 'completed' && result.datasetCount === snapshot.datasets.length && result.receiptCount === snapshot.receipts.length, 'PUBLISH_RECEIPT_MISMATCH');
  const readback = await cloud.rpc('corpus_fda_analytics_snapshot_v1', { p_run: snapshot.runId });
  requireValue(readback?.payloadSha256 === hash && payloadHash(readback.snapshot) === hash, 'PUBLISHED_SNAPSHOT_HASH_MISMATCH');
  return { ...result, verifiedObjects: unique.length + 1, readbackVerified: true };
}
