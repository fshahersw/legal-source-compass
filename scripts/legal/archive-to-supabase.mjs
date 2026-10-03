// Private, content-addressed originals. Bounded chunks avoid another large
// temporary archive and make transfers resumable without overwriting objects.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const project = 'xosqzzsnhxcyehcnirpa', bucket = 'corpus-originals';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function archive(planFile, credentialFile) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (plan.project_id !== project || plan.bucket !== bucket || !Array.isArray(plan.files)) throw Error('Private archive plan required');
  const cfg = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  if (cfg.EXTERNAL_SUPABASE_URL !== `https://${project}.supabase.co`) throw Error('Wrong corpus project');
  const key = cfg.EXTERNAL_SUPABASE_KEY;
  if (typeof key !== 'string' || !(key.startsWith('sb_secret_') || key.startsWith('ey'))) throw Error('Server credential required');
  if (key.startsWith('ey')) { const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); if (claims.role !== 'service_role' || claims.ref !== project) throw Error('Server role required'); }
  const headers = { apikey: key, ...(!key.startsWith('sb_') ? { Authorization: `Bearer ${key}` } : {}) };
  const base = `https://${project}.storage.supabase.co/storage/v1`;
  const bucketCheck = await fetch(`${cfg.EXTERNAL_SUPABASE_URL}/storage/v1/bucket/${bucket}`, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!bucketCheck.ok || (await bucketCheck.json()).public !== false) throw Error('Private bucket check failed');
  const journal = planFile + '.receipts.jsonl';
  const log = value => fs.appendFileSync(journal, JSON.stringify({ ...value, checked_at: new Date().toISOString() }) + '\n');
  const prior = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const cooldown = prior.filter(r => r.state === 'cooldown').at(-1);
  if (cooldown && Date.parse(cooldown.retry_after) > Date.now()) throw Error(`Private archive cooldown until ${cooldown.retry_after}`);
  const verified = new Map(prior.filter(r => r.state === 'chunk_verified').map(r => [r.object_key, r]));
  async function request(url, init) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let r;
      try { r = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(45000) }); }
      catch { console.log(JSON.stringify({ state: 'transport_retry', attempt: attempt + 1 })); if (attempt === 5) throw Error('Private archive transport failed'); await pause(1000 * 2 ** attempt); continue; }
      if (r.status !== 429 && r.status < 500) return r;
      const after = r.headers.get('retry-after'); const delay = /^\d+$/.test(after ?? '') ? Number(after) * 1000 : Date.parse(after ?? '') - Date.now();
      await r.body?.cancel(); if (attempt === 5) throw Error(`Private archive HTTP ${r.status}`);
      let remaining = Math.max(1000 * 2 ** attempt, Number.isFinite(delay) ? delay : 0);
      console.log(JSON.stringify({ state: 'http_retry', status: r.status, attempt: attempt + 1, retry_in_ms: remaining }));
      if (remaining > 60000) { const retry_after = new Date(Date.now() + remaining).toISOString(); log({ state: 'cooldown', retry_after }); throw Error(`Private archive cooldown until ${retry_after}`); }
      while (remaining > 0) { const ms = Math.min(remaining, 30000); await pause(ms); remaining -= ms; }
    }
  }
  async function readback(objectKey, expected, bytes) {
    const response = await request(`${base}/object/authenticated/${bucket}/${objectKey}`, { method: 'GET' });
    if (!response.ok) throw Error(`Private archive readback HTTP ${response.status}`);
    const digest = crypto.createHash('sha256'); let length = 0;
    for await (const chunk of response.body) { digest.update(chunk); length += chunk.length; if (length > bytes) throw Error('Private archive readback too large'); }
    if (length !== bytes || digest.digest('hex') !== expected) throw Error('Private archive checksum mismatch');
  }
  async function storeObject(objectKey, bytes) {
    const digest = sha(bytes); const old = verified.get(objectKey);
    if (old && old.sha256 === digest && old.bytes === bytes.length) return;
    const response = await request(`${base}/object/${bucket}/${objectKey}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'x-upsert': 'false' }, body: bytes });
    // A duplicate immutable object is safe only after complete readback.
    const status = response.status; const detail = await response.json().catch(() => ({}));
    if (!response.ok && !(status === 400 && ['Duplicate','Asset Already Exists'].includes(detail.error)) && status !== 409) throw Error(`Private archive upload HTTP ${status}`);
    await readback(objectKey, digest, bytes.length);
    const receipt = { state: 'chunk_verified', object_key: objectKey, sha256: digest, bytes: bytes.length };
    log(receipt); verified.set(objectKey, receipt);
  }
  for (const item of plan.files) {
    const real = fs.realpathSync(item.path); const allowed = fs.realpathSync(plan.allowed_root);
    if (!real.toLowerCase().startsWith(allowed.toLowerCase() + path.sep) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw Error('Archive path or hash outside plan');
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size !== item.bytes) throw Error('Archive byte count changed');
    const prefix = `legal-atlas/originals/sha256/${item.sha256}`;
    const digest = crypto.createHash('sha256'); const chunks = []; let offset = 0; let batch = [];
    for await (const bytes of fs.createReadStream(real, { highWaterMark: 6 * 1024 ** 2 })) {
      digest.update(bytes);
      const index = chunks.length, hash = sha(bytes), object_key = `${prefix}/chunk-${String(index).padStart(6,'0')}-${hash}`;
      chunks.push({ index, offset, bytes: bytes.length, sha256: hash, object_key }); offset += bytes.length;
      batch.push(storeObject(object_key, bytes));
      if (batch.length === 3) { await Promise.all(batch); batch = []; }
      if (chunks.length % 30 === 0) console.log(JSON.stringify({ file: path.basename(real), verified_bytes: offset, total_bytes: stat.size }));
    }
    await Promise.all(batch);
    const after = fs.statSync(real);
    if (digest.digest('hex') !== item.sha256 || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw Error('Local archive changed during upload');
    const manifest = { schema_version: 'legal-atlas-private-original/1', project_id: project, bucket, original_name: path.basename(real), bytes: item.bytes, sha256: item.sha256, provenance: item.provenance, chunks };
    const encoded = Buffer.from(JSON.stringify(manifest)); const manifestKey = `${prefix}/manifest.json`;
    await storeObject(manifestKey, encoded);
    // Manifest is independently read back even on a resumed transfer.
    await readback(manifestKey, sha(encoded), encoded.length);
    log({ state: 'original_verified', local_path: real, bytes: item.bytes, sha256: item.sha256, manifest_key: manifestKey, manifest_sha256: sha(encoded), chunks: chunks.length });
    console.log(JSON.stringify({ file: path.basename(real), state: 'private_original_verified', bytes: item.bytes, chunks: chunks.length }));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) archive(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
