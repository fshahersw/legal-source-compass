import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const PROJECT = 'xosqzzsnhxcyehcnirpa';
const BUCKET = 'corpus-originals';
const MAX_MANIFEST_BYTES = 8 * 1024 ** 2;
const MAX_CHUNK_BYTES = 6 * 1024 ** 2;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };

function walkObjectDescriptors(value, found = []) {
  if (Array.isArray(value)) {
    for (const child of value) walkObjectDescriptors(child, found);
  } else if (value && typeof value === 'object') {
    if (Object.hasOwn(value, 'object_key')) found.push(value);
    for (const child of Object.values(value)) walkObjectDescriptors(child, found);
  }
  return found;
}

export function validateArchiveManifest(descriptor, raw) {
  if (!Buffer.isBuffer(raw) || raw.length < 1 || raw.length > MAX_MANIFEST_BYTES) fail('Manifest length outside bounds');
  if (!descriptor || descriptor.bucket !== BUCKET || !/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(descriptor.manifest_sha256 ?? '')
    || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1
    || descriptor.manifest_key !== `legal-atlas/originals/sha256/${descriptor.sha256}/manifest.json`) fail('Pinned archive descriptor required');
  if (sha256(raw) !== descriptor.manifest_sha256) fail('Archive manifest SHA-256 mismatch');
  let manifest;
  try { manifest = JSON.parse(raw.toString('utf8')); } catch { fail('Archive manifest is not valid JSON'); }
  if (manifest?.project_id !== PROJECT || manifest.bucket !== BUCKET
    || !['legal-atlas-private-original/1', 'legal-atlas-private-original/2'].includes(manifest.schema_version)
    || manifest.sha256 !== descriptor.sha256 || manifest.bytes !== descriptor.bytes
    || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0) fail('Archive manifest identity or schema mismatch');
  const v1 = manifest.schema_version.endsWith('/1');
  let expectedOffset = 0;
  const chunks = [];
  const descriptors = walkObjectDescriptors(manifest.chunks);
  if (descriptors.length !== manifest.chunks.length) fail('Unexpected nested or missing archive chunk descriptor');
  for (let index = 0; index < descriptors.length; index++) {
    const chunk = descriptors[index];
    if (!Number.isSafeInteger(chunk.index) || chunk.index !== index
      || !Number.isSafeInteger(chunk.offset) || chunk.offset !== expectedOffset
      || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > MAX_CHUNK_BYTES
      || !/^[a-f0-9]{64}$/.test(chunk.sha256 ?? '')) fail('Invalid or non-contiguous chunk descriptor');
    const expectedKey = v1
      ? `legal-atlas/originals/sha256/${descriptor.sha256}/chunk-${String(index).padStart(6, '0')}-${chunk.sha256}`
      : `legal-atlas/chunks/sha256/${chunk.sha256}`;
    if (chunk.object_key !== expectedKey) fail('Chunk object key does not match manifest version and hash');
    chunks.push({ index, offset: chunk.offset, bytes: chunk.bytes, sha256: chunk.sha256, object_key: chunk.object_key });
    expectedOffset += chunk.bytes;
  }
  if (expectedOffset !== descriptor.bytes) fail('Chunk byte total does not match registered original');
  return {
    archive_sha256: descriptor.sha256,
    archive_bytes: descriptor.bytes,
    bucket: descriptor.bucket,
    manifest_key: descriptor.manifest_key,
    manifest_sha256: descriptor.manifest_sha256,
    manifest_schema: manifest.schema_version,
    chunk_count: chunks.length,
    chunks,
  };
}

async function fetchManifest(descriptor, headers, fetcher = fetch) {
  const url = `https://${PROJECT}.storage.supabase.co/storage/v1/object/authenticated/${BUCKET}/${descriptor.manifest_key}`;
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetcher(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (response.status !== 429 && response.status < 500) break;
    await response.body?.cancel();
    if (attempt === 2) fail(`Manifest read HTTP ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  if (!response.ok) fail(`Manifest read HTTP ${response.status}`);
  const parts = [];
  let total = 0;
  for await (const part of response.body) {
    total += part.length;
    if (total > MAX_MANIFEST_BYTES) fail('Archive manifest exceeds size bound');
    parts.push(Buffer.from(part));
  }
  const raw = Buffer.concat(parts, total);
  return { raw, parsed: validateArchiveManifest(descriptor, raw) };
}

export async function collectArchiveChunkReferences({ descriptorFile, credentialFile, outputFile, fetcher = fetch }) {
  const descriptors = JSON.parse(fs.readFileSync(descriptorFile, 'utf8'));
  if (!Array.isArray(descriptors.archives) || descriptors.archives.length !== descriptors.count
    || descriptors.archives.length > 100) fail('Expected bounded registered archive descriptor page');
  const cfg = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  if (cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co`) fail('Wrong corpus project');
  const key = cfg.EXTERNAL_SUPABASE_KEY;
  if (typeof key !== 'string' || !(key.startsWith('sb_secret_') || key.startsWith('ey'))) fail('Server credential required');
  if (key.startsWith('ey')) {
    let claims;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); } catch { fail('Invalid server credential token'); }
    if (claims.role !== 'service_role' || claims.ref !== PROJECT) fail('Credential is not a service role for the pinned project');
  }
  const headers = { apikey: key, ...(!key.startsWith('sb_') ? { Authorization: `Bearer ${key}` } : {}) };
  const archiveResults = [];
  for (const descriptor of descriptors.archives) {
    archiveResults.push((await fetchManifest(descriptor, headers, fetcher)).parsed);
  }
  const chunkReferences = archiveResults.flatMap(archive => archive.chunks.map(chunk => ({
    archive_sha256: archive.archive_sha256,
    archive_manifest_key: archive.manifest_key,
    archive_manifest_sha256: archive.manifest_sha256,
    archive_schema: archive.manifest_schema,
    archive_bytes: archive.archive_bytes,
    ...chunk,
  })));
  const evidence = {
    evidence_schema: 'read-only-legal-archive-chunk-references/1',
    target_project: PROJECT,
    target_bucket: BUCKET,
    descriptor_count: archiveResults.length,
    chunk_reference_count: chunkReferences.length,
    collected_at: new Date().toISOString(),
    archives: archiveResults,
    chunk_references: chunkReferences,
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const temporary = `${outputFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(evidence, null, 2) + '\n', { flag: 'w' });
  fs.renameSync(temporary, outputFile);
  return { descriptor_count: archiveResults.length, chunk_reference_count: chunkReferences.length, output_file: outputFile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [descriptorFile = 'private/audit-2026-10-05/legal-archive-manifests.json',
    credentialFile = 'C:/Users/firas/.codex/private/legal-source-compass.preview.json',
    outputFile = 'private/audit-2026-10-05/legal-archive-chunk-refs.json'] = process.argv.slice(2);
  collectArchiveChunkReferences({ descriptorFile, credentialFile, outputFile })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
