// Publisher ranges -> bounded memory -> verified private Supabase objects.
// No archive payload or duplicate staging database is written to local disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { adminClient } from './admin-client.mjs';
import { PRIVATE_PROJECT, PRIVATE_BUCKET, CHUNK_BYTES, sha256, integrity, boundedBody, boundedRequest, privateOriginalStorage } from './private-original-storage.mjs';

export function validateRemoteOriginal(item) {
  const url = new URL(item.url);
  if (url.origin !== 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com' || url.search || url.hash || url.username || url.password
    || !/^\/bulk-data\/[a-z0-9_-]+-\d{4}-\d{2}-\d{2}\.csv\.bz2$/.test(url.pathname)
    || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || !/^"[^"\r\n]+"$/.test(item.etag ?? '')
    || !item.provenance || typeof item.provenance !== 'object' || Array.isArray(item.provenance)
    || item.provenance.url !== item.url || item.provenance.etag !== item.etag || item.provenance.bytes !== item.bytes
    || (item.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(item.sha256))) throw integrity('Frozen official archive descriptor required');
  return sha256(JSON.stringify({ url: item.url, bytes: item.bytes, etag: item.etag, chunk_bytes: CHUNK_BYTES }));
}

export async function readPublisherRange(item, offset, bytes, log, fetcher = fetch) {
  return boundedRequest(item.url, { method: 'GET', headers: { Range: `bytes=${offset}-${offset + bytes - 1}`, 'If-Match': item.etag, 'Accept-Encoding': 'identity' } }, async response => {
    if (response.status !== 206 || response.headers.get('etag') !== item.etag
      || response.headers.get('content-range') !== `bytes ${offset}-${offset + bytes - 1}/${item.bytes}`
      || Number(response.headers.get('content-length')) !== bytes) throw integrity('Publisher archive or byte range changed');
    const result = await boundedBody(response, bytes);
    if (result.length !== bytes) throw integrity('Publisher archive range is truncated');
    return result;
  }, log, fetcher);
}

export async function archiveRemoteFile(item, { storage, receipts = [], log = () => {}, fetcher = fetch, progress = () => {} }) {
  const sourceKey = validateRemoteOriginal(item);
  const prior = new Map(receipts.filter(r => r.state === 'range_verified' && r.source_key === sourceKey).map(r => [r.index, r]));
  const digest = crypto.createHash('sha256'), chunks = [];
  const totalChunks = Math.ceil(item.bytes / CHUNK_BYTES);
  let offset = 0;
  for (let start = 0; start < totalChunks; start += 3) {
    // At most three six-MiB chunks are held; process hashes in source order.
    const indices = Array.from({ length: Math.min(3, totalChunks - start) }, (_, i) => start + i);
    const group = await Promise.allSettled(indices.map(async index => {
      const position = index * CHUNK_BYTES, size = Math.min(CHUNK_BYTES, item.bytes - position), old = prior.get(index);
      let bytes, descriptor;
      if (old) {
        if (old.offset !== position || old.bytes !== size || !/^[a-f0-9]{64}$/.test(old.sha256)
          || old.object_key !== `legal-atlas/chunks/sha256/${old.sha256}`) throw integrity('Saved archive range does not match source');
        bytes = await storage.read(old.object_key, old.sha256, size);
        if (bytes.length !== size || sha256(bytes) !== old.sha256) throw integrity('Resumed cloud chunk changed');
        descriptor = { index, offset: position, bytes: size, sha256: old.sha256, object_key: old.object_key };
      } else {
        bytes = await readPublisherRange(item, position, size, log, fetcher);
        const hash = sha256(bytes), object_key = `legal-atlas/chunks/sha256/${hash}`;
        await storage.put(object_key, bytes);
        descriptor = { index, offset: position, bytes: size, sha256: hash, object_key };
        log({ state: 'range_verified', source_key: sourceKey, ...descriptor });
      }
      return { bytes, descriptor };
    }));
    const failed = group.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
    for (const result of group) {
      digest.update(result.value.bytes); offset += result.value.bytes.length; chunks.push(result.value.descriptor);
    }
    progress({ file: path.basename(new URL(item.url).pathname), verified_bytes: offset, total_bytes: item.bytes });
  }
  const hash = digest.digest('hex');
  if (offset !== item.bytes || (item.sha256 && item.sha256 !== hash)) throw integrity('Original archive checksum mismatch');
  const manifest = { schema_version: 'legal-atlas-private-original/2', project_id: PRIVATE_PROJECT, bucket: PRIVATE_BUCKET,
    original_name: path.basename(new URL(item.url).pathname), bytes: item.bytes, sha256: hash, provenance: item.provenance, chunks };
  const encoded = Buffer.from(JSON.stringify(manifest)), manifest_key = `legal-atlas/originals/sha256/${hash}/manifest.json`;
  await storage.put(manifest_key, encoded);
  const receipt = { state: 'original_verified', source_key: sourceKey, source_url: item.url, bytes: item.bytes, sha256: hash,
    manifest_key, manifest_sha256: sha256(encoded), chunks: chunks.length };
  log(receipt);
  return receipt;
}

export async function archiveRemotePlan(planFile, credentials) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (plan.project_id !== PRIVATE_PROJECT || plan.bucket !== PRIVATE_BUCKET || !Array.isArray(plan.files)) throw Error('Private archive plan required');
  plan.files.forEach(validateRemoteOriginal);
  const journal = planFile + '.receipts.jsonl';
  const receipts = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const cooldown = receipts.filter(r => r.state === 'cooldown').at(-1);
  if (cooldown && Date.parse(cooldown.retry_after) > Date.now()) throw Error(`Archive cooldown until ${cooldown.retry_after}`);
  const log = value => fs.appendFileSync(journal, JSON.stringify({ ...value, checked_at: new Date().toISOString() }) + '\n');
  const storage = await privateOriginalStorage(credentials, log), rpc = adminClient(credentials);
  let lastLog = 0;
  for (const item of plan.files) {
    const result = await archiveRemoteFile(item, { storage, receipts, log, progress: p => {
      if (Date.now() - lastLog > 15000) { console.log(JSON.stringify(p)); lastLog = Date.now(); }
    } });
    const verified_at = new Date().toISOString();
    const registered = await rpc('corpus_legal_register_archive_v3', { p_archive: { ...result, provenance: item.provenance, verified_at } });
    if (registered.sha256 !== result.sha256 || registered.bytes !== item.bytes || registered.private !== true) throw Error('Archive registration mismatch');
    log({ state: 'archive_registered', ...registered });
    console.log(JSON.stringify({ state: 'private_original_verified', source_url: item.url, bytes: item.bytes, chunks: result.chunks, sha256: result.sha256 }));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) archiveRemotePlan(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
