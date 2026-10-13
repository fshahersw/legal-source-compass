/** Administrative intake CLI only. No imports from this module into application code. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { boundedBytes, requireValue, sha256, payloadHash, retryDelay, MonitorError, atomicJson, immutableWrite, allowedUrl, isoDate } from './core.mjs';
import { SOURCES } from './adapters.mjs';
export const CORPUS_ORIGIN = 'https://xosqzzsnhxcyehcnirpa.supabase.co';
export const MAX_PACKET_BYTES = 100 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const objectKey = (hash) => `regulatory/${hash.slice(0, 2)}/${hash}.raw`;
export function cloudClient(env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const origin = env.EXTERNAL_SUPABASE_URL; const key = env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? env.EXTERNAL_SUPABASE_KEY;
  requireValue(origin === CORPUS_ORIGIN && typeof key === 'string', 'CORPUS_CREDENTIALS_REQUIRED');
  if (key.startsWith('ey')) { let claims; try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); } catch { throw new MonitorError('CORPUS_SERVICE_ROLE_REQUIRED'); } requireValue(claims.role === 'service_role' && claims.ref === 'xosqzzsnhxcyehcnirpa', 'CORPUS_SERVICE_ROLE_REQUIRED'); }
  else requireValue(key.startsWith('sb_secret_'), 'CORPUS_SERVICE_ROLE_REQUIRED');
  async function request(method, route, { json, bytes, contentType, accepted = [] } = {}) {
    requireValue(route.startsWith('/rest/v1/rpc/corpus_regulatory_') || route === '/storage/v1/bucket/corpus-originals' || route.startsWith('/storage/v1/object/corpus-originals/regulatory/'), 'CORPUS_ROUTE_DISALLOWED');
    for (let attempt = 0; attempt < 4; attempt++) {
      let response;
      try {
        response = await fetchImpl(origin + route, { method, redirect: 'manual', headers: { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }), ...(json !== undefined || bytes ? { 'Content-Type': contentType ?? 'application/json' } : {}), 'x-upsert': 'false' }, body: bytes ?? (json === undefined ? undefined : JSON.stringify(json)), signal: AbortSignal.timeout(120000) });
        if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); if (attempt === 3) throw new MonitorError(`CORPUS_HTTP_${response.status}`); await sleep(retryDelay(response.headers.get('retry-after'), attempt)); continue; }
        if (accepted.includes(response.status)) { await response.body?.cancel(); return { status: response.status, bytes: null }; }
        if (method === 'GET' && route.startsWith('/storage/v1/object/') && accepted.includes(404) && response.status === 400) {
          const errorBytes = await boundedBytes(response, 20000); let error;
          try { error = JSON.parse(errorBytes); } catch { throw new MonitorError('CORPUS_HTTP_400'); }
          requireValue(String(error.statusCode) === '404' && ['not_found', 'not_found_resource', 'NoSuchKey'].includes(error.error ?? error.code), 'CORPUS_HTTP_400');
          return { status: 404, bytes: null };
        }
        requireValue(response.ok, `CORPUS_HTTP_${response.status}`);
        const result = await boundedBytes(response, 105 * 1024 * 1024); return { status: response.status, bytes: result };
      } catch (error) { await response?.body?.cancel().catch(() => {}); if (error instanceof MonitorError || attempt === 3) throw error instanceof MonitorError ? error : new MonitorError('CORPUS_TRANSPORT_FAILED'); await sleep(retryDelay(null, attempt)); }
    }
    throw new MonitorError('CORPUS_TRANSPORT_FAILED');
  }
  async function rpc(name, args = {}) { const r = await request('POST', `/rest/v1/rpc/${name}`, { json: args }); try { return JSON.parse(r.bytes); } catch { throw new MonitorError('CORPUS_JSON_INVALID'); } }
  return { request, rpc };
}
export async function appendJournal(file, record) {
  const handle = await fs.open(file, 'a', 0o600);
  try { await handle.write(JSON.stringify(record) + '\n'); await handle.sync(); } finally { await handle.close(); }
}
export async function putVerified(cloud, capture, bytes, journal) {
  requireValue(bytes.length === capture.byte_count && sha256(bytes) === capture.sha256, 'LOCAL_CAPTURE_HASH_MISMATCH');
  requireValue(capture.storage_key === `regulatory/${capture.sha256.slice(0, 2)}/${capture.sha256}.raw`, 'RAW_STORAGE_KEY_INVALID');
  const route = `/storage/v1/object/corpus-originals/${capture.storage_key}`;
  let found = await cloud.request('GET', route, { accepted: [404] }); let created = false;
  if (found.status === 404) {
    const uploaded = await cloud.request('POST', route, { bytes, contentType: capture.content_type, accepted: [409] });
    created = uploaded.status !== 409;
    // Journal successful creation BEFORE readback, so interrupted verification retains cleanup evidence.
    await appendJournal(journal, { storage_key: capture.storage_key, sha256: capture.sha256, byte_count: capture.byte_count, created, verified: false, observed_at: new Date().toISOString() });
    found = await cloud.request('GET', route);
  }
  requireValue(found.bytes?.length === capture.byte_count && sha256(found.bytes) === capture.sha256, 'STORAGE_HASH_READBACK_MISMATCH');
  const receipt = { storage_key: capture.storage_key, sha256: capture.sha256, byte_count: capture.byte_count, created, verified: true, observed_at: new Date().toISOString() };
  await appendJournal(journal, receipt); return receipt;
}
export function validatePacket(packet) {
  requireValue(packet.schema_version === 'regulatory-packet/1' && ['completed', 'failed', 'partial'].includes(packet.status) && Array.isArray(packet.rows) && Array.isArray(packet.captures), 'PACKET_SCHEMA_INVALID');
  requireValue(packet.status !== 'completed' || packet.expected_count === packet.rows.length, 'PACKET_COUNT_MISMATCH');
  const ids = new Set();
  for (const row of packet.rows) {
    requireValue(Buffer.byteLength(JSON.stringify(row.data)) <= 180000, 'RECORD_PAYLOAD_TOO_LARGE');
    requireValue(row.payload_sha256 === payloadHash(row.data), 'PACKET_PAYLOAD_HASH_MISMATCH'); requireValue(!ids.has(row.data.native_id), 'PACKET_DUPLICATE_NATIVE_ID'); ids.add(row.data.native_id);
    requireValue(packet.captures.some((c) => c.sha256 === row.raw_sha256 && c.storage_key === row.raw_storage_key && c.source_url === row.capture_source_url && c.retrieved_at === row.retrieved_at), 'PACKET_CAPTURE_UNBOUND');
  }
  return packet;
}
/** Strong metadata/path validation before recovery may write any local source evidence. */
export function validateRecoverablePacket(packet) {
  validatePacket(packet);
  requireValue(UUID.test(packet.run_id) && Object.hasOwn(SOURCES, packet.source_id), 'PACKET_IDENTITY_INVALID');
  isoDate(packet.window_from); isoDate(packet.window_to);
  requireValue(packet.window_from <= packet.window_to && Date.parse(packet.window_to) - Date.parse(packet.window_from) <= 90 * 86400000, 'WINDOW_INVALID');
  requireValue(packet.scope && ['initial', 'incremental', 'backfill'].includes(packet.scope.mode), 'PACKET_SCOPE_INVALID');
  requireValue(!['packet_sha256', 'canonicalpacket_sha256', 'packet_file_sha256', 'packet_storage_key'].some((key) => Object.hasOwn(packet.scope, key)), 'PACKET_SCOPE_RESERVED_FIELD');
  requireValue(packet.rows.length <= 10000 && packet.captures.length <= 15000, 'PACKET_RESOURCE_CAP');
  const known = new Map(); let bytes = 0;
  for (const capture of packet.captures) {
    requireValue(SHA.test(capture.sha256) && capture.storage_key === objectKey(capture.sha256), 'RAW_STORAGE_KEY_INVALID');
    requireValue(Number.isSafeInteger(capture.byte_count) && capture.byte_count > 0 && capture.byte_count <= 100 * 1024 * 1024, 'CAPTURE_SIZE_INVALID');
    requireValue(typeof capture.content_type === 'string' && capture.content_type.length <= 200 && !/[\r\n]/.test(capture.content_type), 'CAPTURE_CONTENT_TYPE_INVALID');
    requireValue(typeof capture.retrieved_at === 'string' && /^\d{4}-\d\d-\d\dT/.test(capture.retrieved_at) && Number.isFinite(Date.parse(capture.retrieved_at)), 'CAPTURE_TIMESTAMP_INVALID');
    allowedUrl(capture.source_url, SOURCES[packet.source_id].hosts);
    if (known.has(capture.sha256)) requireValue(known.get(capture.sha256) === capture.byte_count, 'CAPTURE_SIZE_CONFLICT');
    else { known.set(capture.sha256, capture.byte_count); bytes += capture.byte_count; }
  }
  requireValue(bytes <= 2 * 1024 * 1024 * 1024, 'PACKET_RESOURCE_CAP');
  for (const row of packet.rows) allowedUrl(row.data.source_url, SOURCES[packet.source_id].hosts);
  return packet;
}
async function privateBucket(cloud) {
  const bucket = JSON.parse((await cloud.request('GET', '/storage/v1/bucket/corpus-originals')).bytes);
  requireValue(bucket.id === 'corpus-originals' && bucket.public === false, 'PRIVATE_BUCKET_REQUIRED');
}
async function findRun(cloud, id) {
  requireValue(UUID.test(id), 'RUN_ID_INVALID');
  const run = await cloud.rpc('corpus_regulatory_run_v1', { p_run: id });
  requireValue(run === null || (run && run.id === id && typeof run.scope === 'object'), 'RUN_LOOKUP_INVALID');
  return run;
}
function validateRunPacket(run, packet) {
  requireValue(run.id === packet.run_id && run.source === packet.source_id && run.windowFrom === packet.window_from && run.windowTo === packet.window_to && run.expectedCount === packet.expected_count, 'RUN_PACKET_IDENTITY_MISMATCH');
  const canonical = payloadHash(packet);
  requireValue(run.scope?.packet_sha256 === canonical && (!run.scope.canonicalpacket_sha256 || run.scope.canonicalpacket_sha256 === canonical), 'RUN_PACKET_HASH_MISMATCH');
  const { packet_sha256: _legacy, canonicalpacket_sha256: _canonical, packet_file_sha256: _file, packet_storage_key: _key, ...scope } = run.scope;
  requireValue(payloadHash(scope) === payloadHash(packet.scope), 'RUN_PACKET_SCOPE_MISMATCH');
}
async function exactPacketBytes(packet, directory) {
  const file = path.join(directory, 'packet.json'); const stat = await fs.stat(file);
  requireValue(stat.isFile() && stat.size > 0 && stat.size <= MAX_PACKET_BYTES, 'PACKET_FILE_SIZE_INVALID');
  const bytes = await fs.readFile(file); let disk;
  try { disk = JSON.parse(bytes); } catch { throw new MonitorError('PACKET_FILE_INVALID'); }
  requireValue(payloadHash(disk) === payloadHash(packet), 'PACKET_FILE_MISMATCH');
  return bytes;
}
export async function recoverRun({ runId, output, cloud }) {
  const base = path.resolve(output);
  requireValue(!base.split(path.sep).some((part) => ['public', '.output', 'src'].includes(part.toLowerCase())), 'PRIVATE_OUTPUT_REQUIRED');
  await privateBucket(cloud);
  const run = await findRun(cloud, runId); requireValue(run, 'RUN_NOT_FOUND');
  requireValue(['running', 'completed'].includes(run.status), 'RUN_FINALIZED_NOT_RECOVERABLE');
  const scope = run.scope;
  requireValue(scope && SHA.test(scope.packet_file_sha256) && scope.packet_storage_key === objectKey(scope.packet_file_sha256) && SHA.test(scope.canonicalpacket_sha256), 'RUN_RECOVERY_LOCATOR_MISSING');
  const response = await cloud.request('GET', `/storage/v1/object/corpus-originals/${scope.packet_storage_key}`);
  requireValue(response.bytes?.length > 0 && response.bytes.length <= MAX_PACKET_BYTES && sha256(response.bytes) === scope.packet_file_sha256, 'RECOVERY_PACKET_HASH_MISMATCH');
  let packet; try { packet = JSON.parse(response.bytes); } catch { throw new MonitorError('RECOVERY_PACKET_INVALID'); }
  validateRecoverablePacket(packet); validateRunPacket(run, packet);
  const directory = path.join(base, packet.source_id);
  // The complete packet, source/run identity and every remote/local path are checked first.
  for (const dir of [base, directory, path.join(directory, 'objects')]) {
    try { requireValue(!(await fs.lstat(dir)).isSymbolicLink(), 'RECOVERY_SYMLINK_DISALLOWED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(dir, { recursive: true });
  }
  const hashes = new Set();
  for (const capture of packet.captures) {
    if (hashes.has(capture.sha256)) continue;
    const raw = await cloud.request('GET', `/storage/v1/object/corpus-originals/${capture.storage_key}`);
    requireValue(raw.bytes?.length === capture.byte_count && sha256(raw.bytes) === capture.sha256, 'RECOVERY_RAW_HASH_MISMATCH');
    await immutableWrite(path.join(directory, 'objects', `${capture.sha256}.raw`), raw.bytes); hashes.add(capture.sha256);
  }
  await immutableWrite(path.join(directory, 'packet.json'), response.bytes);
  await atomicJson(path.join(directory, 'recovery-receipt.json'), { run_id: runId, source_id: packet.source_id, packet_file_sha256: scope.packet_file_sha256, canonicalpacket_sha256: payloadHash(packet), verified_objects: hashes.size });
  const landing = await landPacket({ packet, directory, cloud });
  return { run_id: runId, source_id: packet.source_id, recovered_objects: hashes.size, landing };
}
export async function landPacket({ packet, directory, cloud }) {
  validateRecoverablePacket(packet);
  await privateBucket(cloud);
  const existing = await findRun(cloud, packet.run_id);
  if (existing) {
    validateRunPacket(existing, packet);
    if (existing.status === 'completed') return { run_id: packet.run_id, status: 'completed', resumed_finalized: true };
    requireValue(existing.status === 'running', 'RUN_NOT_RUNNING');
  }
  const packetBytes = await exactPacketBytes(packet, directory); const packetFileHash = sha256(packetBytes);
  const packetCapture = { sha256: packetFileHash, storage_key: objectKey(packetFileHash), byte_count: packetBytes.length, content_type: 'application/json' };
  const journal = path.join(directory, 'objects-journal.jsonl');
  if (!existing || existing.scope.packet_storage_key) {
    if (existing) requireValue(existing.scope.packet_file_sha256 === packetFileHash && existing.scope.packet_storage_key === packetCapture.storage_key, 'PACKET_FILE_MISMATCH');
    await putVerified(cloud, packetCapture, packetBytes, journal);
  }
  const objects = new Map();
  for (const capture of packet.captures) {
    if (!objects.has(capture.sha256)) { const bytes = await fs.readFile(path.join(directory, 'objects', capture.sha256 + '.raw')); objects.set(capture.sha256, await putVerified(cloud, capture, bytes, path.join(directory, 'objects-journal.jsonl'))); }
  }
  // No database lease is opened until the exact packet AND every raw source object are durable.
  // Existing run scope must remain byte-content identical, including legacy locator-free scope.
  const runScope = existing?.scope ?? { ...packet.scope, packet_sha256: payloadHash(packet), canonicalpacket_sha256: payloadHash(packet), packet_file_sha256: packetFileHash, packet_storage_key: packetCapture.storage_key };
  const opened = await cloud.rpc('corpus_regulatory_open_run_v1', { p_run: packet.run_id, p_source: packet.source_id, p_window_from: packet.window_from, p_window_to: packet.window_to, p_expected_count: packet.expected_count, p_scope: runScope });
  if (opened.status === 'completed') return { run_id: packet.run_id, status: 'completed', resumed_finalized: true };
  requireValue(opened.status === 'running', 'RUN_NOT_RUNNING');
  await atomicJson(path.join(directory, 'intake-checkpoint.json'), { run_id: packet.run_id, source_id: packet.source_id, status: 'running', packet_storage_key: runScope.packet_storage_key ?? null, packet_file_sha256: runScope.packet_file_sha256 ?? null, packet_sha256: payloadHash(packet) });
  for (let at = 0; at < packet.captures.length; at += 50) {
    const captures = packet.captures.slice(at, at + 50).map((c) => ({ sha256: c.sha256, byte_count: c.byte_count, content_type: c.content_type, source_url: c.source_url, retrieved_at: c.retrieved_at, storage_key: c.storage_key, readback_sha256: objects.get(c.sha256).sha256 }));
    const result = await cloud.rpc('corpus_regulatory_capture_v1', { p_run: packet.run_id, p_captures: captures }); requireValue(result.received === captures.length, 'CAPTURE_COUNT_READBACK_MISMATCH');
  }
  let observed = 0; let batch = [];
  async function flush() { if (!batch.length) return; const result = await cloud.rpc('corpus_regulatory_intake_v1', { p_run: packet.run_id, p_rows: batch }); observed += batch.length; requireValue(Number.isSafeInteger(result.observed_count) && result.observed_count >= observed && result.observed_count <= packet.rows.length, 'INTAKE_COUNT_READBACK_MISMATCH'); batch = []; await atomicJson(path.join(directory, 'intake-checkpoint.json'), { run_id: packet.run_id, source_id: packet.source_id, observed_count: result.observed_count, expected_count: packet.expected_count, status: 'running' }); }
  for (const row of packet.rows) { requireValue(Buffer.byteLength(JSON.stringify(row)) <= 1500000, 'INTAKE_ROW_TOO_LARGE'); if (batch.length && (batch.length >= 100 || Buffer.byteLength(JSON.stringify([...batch, row])) > 1500000)) await flush(); batch.push(row); }
  await flush();
  const result = await cloud.rpc('corpus_regulatory_finish_run_v1', { p_run: packet.run_id, p_status: packet.status, p_observed_count: observed, p_error_code: packet.error_code?.toLowerCase() ?? null });
  requireValue(result.status === packet.status && result.observed_count === observed, 'FINISH_COUNT_READBACK_MISMATCH');
  await atomicJson(path.join(directory, 'landing-receipt.json'), { ...result, source_id: packet.source_id, packet_sha256: payloadHash(packet), verified_objects: objects.size }); return result;
}
