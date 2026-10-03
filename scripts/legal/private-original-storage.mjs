import fs from 'node:fs';
import crypto from 'node:crypto';

export const PRIVATE_PROJECT = 'xosqzzsnhxcyehcnirpa';
export const PRIVATE_BUCKET = 'corpus-originals';
export const CHUNK_BYTES = 6 * 1024 ** 2;
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function privateCredentials(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cfg.EXTERNAL_SUPABASE_URL !== `https://${PRIVATE_PROJECT}.supabase.co`) throw Error('Wrong corpus project');
  const key = cfg.EXTERNAL_SUPABASE_KEY;
  if (typeof key !== 'string') throw Error('Server credential required');
  if (key.startsWith('ey')) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'));
    if (claims.role !== 'service_role' || claims.ref !== PRIVATE_PROJECT) throw Error('Server role required');
  } else if (!key.startsWith('sb_secret_')) throw Error('Server credential required');
  return { url: cfg.EXTERNAL_SUPABASE_URL, headers: { apikey: key, ...(!key.startsWith('sb_') ? { Authorization: `Bearer ${key}` } : {}) } };
}

// Retries encompass the body read, not only response headers. A stalled or
// truncated transfer must never become a verified chunk receipt.
export async function boundedRequest(url, init, consume, log = () => {}, fetcher = fetch) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let response;
    try {
      response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(45000) });
      if (response.status !== 429 && response.status < 500) return await consume(response);
    } catch (error) {
      // Validation failures are deterministic and cannot be repaired by retries.
      if (error?.name === 'IntegrityError') throw error;
      if (attempt === 5) throw Error('Archive transport failed after bounded retries');
      log({ state: 'transport_retry', attempt: attempt + 1 });
      await pause(1000 * 2 ** attempt); continue;
    }
    const retry = response.headers.get('retry-after');
    const delay = /^\d+(?:\.\d+)?$/.test(retry ?? '') ? Number(retry) * 1000 : Date.parse(retry ?? '') - Date.now();
    await response.body?.cancel();
    if (attempt === 5) throw Error(`Archive HTTP ${response.status}`);
    let remaining = Math.max(1000 * 2 ** attempt, Number.isFinite(delay) ? delay : 0);
    log({ state: 'http_retry', status: response.status, attempt: attempt + 1, retry_in_ms: remaining });
    if (remaining > 60000) {
      const retry_after = new Date(Date.now() + remaining).toISOString();
      log({ state: 'cooldown', retry_after }); throw Error(`Archive cooldown until ${retry_after}`);
    }
    while (remaining > 0) { const duration = Math.min(remaining, 30000); await pause(duration); remaining -= duration; }
  }
}

export function integrity(message) { const error = Error(message); error.name = 'IntegrityError'; return error; }
export async function boundedBody(response, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > limit) { throw integrity('Archive response exceeds expected length'); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function privateOriginalStorage(credentialFile, log = () => {}) {
  const credentials = privateCredentials(credentialFile);
  const base = `https://${PRIVATE_PROJECT}.storage.supabase.co/storage/v1`;
  const request = (url, init, consume) => boundedRequest(url, { ...init, headers: { ...credentials.headers, ...init.headers } }, consume, log);
  await request(`${credentials.url}/storage/v1/bucket/${PRIVATE_BUCKET}`, { method: 'GET' }, async r => {
    if (!r.ok || (await r.json()).public !== false) throw integrity('Private bucket check failed');
  });
  const read = async (key, expectedSha, bytes) => request(`${base}/object/authenticated/${PRIVATE_BUCKET}/${key}`, { method: 'GET' }, async r => {
    if (!r.ok) throw integrity(`Private original read HTTP ${r.status}`);
    const result = await boundedBody(r, bytes);
    if (result.length !== bytes || sha256(result) !== expectedSha) throw integrity('Private original checksum mismatch');
    return result;
  });
  const put = async (key, bytes) => {
    await request(`${base}/object/${PRIVATE_BUCKET}/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'x-upsert': 'false' }, body: bytes }, async r => {
      const detail = await r.json().catch(() => ({}));
      if (!r.ok && !(r.status === 400 && ['Duplicate', 'Asset Already Exists'].includes(detail.error)) && r.status !== 409) throw integrity(`Private original upload HTTP ${r.status}`);
    });
    await read(key, sha256(bytes), bytes.length);
  };
  return { read, put };
}
