import fs from 'node:fs';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

/** Read a retained original directly from private Supabase storage, validating
 * each chunk before yielding it. Consumers must also await final whole-file validation. */
export async function* readPrivateOriginal(manifestKey, expectedManifestSha, credentialFile) {
  if (!/^legal-atlas\/originals\/sha256\/[a-f0-9]{64}\/manifest\.json$/.test(manifestKey) || !/^[a-f0-9]{64}$/.test(expectedManifestSha)) throw Error('Verified private archive locator required');
  const cfg = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  const project = 'xosqzzsnhxcyehcnirpa', bucket = 'corpus-originals';
  if (cfg.EXTERNAL_SUPABASE_URL !== `https://${project}.supabase.co`) throw Error('Wrong corpus project');
  const key = cfg.EXTERNAL_SUPABASE_KEY;
  if (typeof key !== 'string') throw Error('Server credential required');
  const headers = { apikey: key, ...(!key.startsWith('sb_') ? { Authorization: `Bearer ${key}` } : {}) };
  const base = `https://${project}.storage.supabase.co/storage/v1/object/authenticated/${bucket}/`;
  async function get(objectKey, limit) {
    const response = await fetch(base + objectKey, { headers, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Error(`Private original read HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw Error('Private original exceeds expected length'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks);
  }
  const raw = await get(manifestKey, 8 * 1024 ** 2);
  if (digest(raw) !== expectedManifestSha) throw Error('Private original manifest changed');
  const manifest = JSON.parse(raw);
  const prefix = manifestKey.slice(0, -'manifest.json'.length);
  if (manifest.project_id !== project || manifest.bucket !== bucket || manifest.schema_version !== 'legal-atlas-private-original/1' || manifestKey.split('/')[3] !== manifest.sha256 || !Array.isArray(manifest.chunks)) throw Error('Private original manifest mismatch');
  const full = crypto.createHash('sha256'); let total = 0, index = 0;
  for (const chunk of manifest.chunks) {
    if (chunk.index !== index++ || chunk.offset !== total || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > 6 * 1024 ** 2 || !/^[a-f0-9]{64}$/.test(chunk.sha256) || chunk.object_key !== `${prefix}chunk-${String(chunk.index).padStart(6,'0')}-${chunk.sha256}`) throw Error('Invalid archive chunk descriptor');
    const bytes = await get(chunk.object_key, chunk.bytes);
    if (bytes.length !== chunk.bytes || digest(bytes) !== chunk.sha256) throw Error('Private original chunk changed');
    total += bytes.length; full.update(bytes); yield bytes;
  }
  if (total !== manifest.bytes || full.digest('hex') !== manifest.sha256) throw Error('Private original whole-file checksum mismatch');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [key, sha, credentials, mode] = process.argv.slice(2);
  let bytes = 0;
  for await (const chunk of readPrivateOriginal(key, sha, credentials)) {
    bytes += chunk.length;
    if (mode !== '--verify' && !process.stdout.write(chunk)) await once(process.stdout, 'drain');
  }
  if (mode === '--verify') console.log(JSON.stringify({ manifest_key: key, bytes, state: 'whole_original_verified' }));
}
