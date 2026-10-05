import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const project = 'xosqzzsnhxcyehcnirpa';
const credentialsPath = 'C:/Users/firas/.codex/private/legal-source-compass.preview.json';
const candidatePath = 'private/audit-2026-10-05/storage-hash-duplicate-candidates.json';
const outputDirectory = 'private/audit-2026-10-05/duplicate-recovery';
const outputManifest = path.join(outputDirectory, 'manifest.json');

export function validateCandidateGroups(report) {
  if (!Array.isArray(report?.groups) || report.groups.length !== 30) throw new Error('EXPECTED_30_DUPLICATE_GROUPS');
  const seen = new Set();
  let bytes = 0;
  for (const group of report.groups) {
    const hash = group.path_sha256;
    if (group.bucket_id !== 'corpus-originals' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('INVALID_GROUP_IDENTITY');
    if (group.distinct_key_count !== 2 || !Array.isArray(group.keys_and_declared_bytes) || group.keys_and_declared_bytes.length !== 2) throw new Error('EXPECTED_TWO_KEYS_PER_GROUP');
    if (group.min_declared_bytes !== group.max_declared_bytes || !Number.isSafeInteger(group.max_declared_bytes) || group.max_declared_bytes <= 0) throw new Error('DECLARED_SIZE_CONFLICT_OR_INVALID');
    if (seen.has(hash)) throw new Error('DUPLICATE_GROUP_HASH');
    seen.add(hash);
    const keys = new Set();
    for (const [key, declaredBytes] of group.keys_and_declared_bytes) {
      if (typeof key !== 'string' || keys.has(key) || declaredBytes !== group.max_declared_bytes) throw new Error('INVALID_CANDIDATE_KEY');
      keys.add(key);
      const leaf = key.split('/').at(-1).replace(/\.[^.]+$/, '');
      if (!leaf.includes(hash)) throw new Error('KEY_PATH_DOES_NOT_CONTAIN_HASH');
    }
    bytes += group.max_declared_bytes;
  }
  return { groups: report.groups.length, keys: report.groups.length * 2, uniqueBytes: bytes, downloadedBytes: bytes * 2 };
}

async function fetchObject(base, token, key, expectedBytes) {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const url = `https://${project}.storage.supabase.co/storage/v1/object/authenticated/corpus-originals/${encodedKey}`;
  const headers = { apikey: token, ...(token.startsWith('sb_') ? {} : { Authorization: `Bearer ${token}` }) };
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`OBJECT_GET_FAILED_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== expectedBytes) throw new Error('BODY_SIZE_MISMATCH');
  return bytes;
}

async function main() {
  const cfg = JSON.parse(await fs.readFile(credentialsPath, 'utf8'));
  if (cfg.EXTERNAL_SUPABASE_URL !== `https://${project}.supabase.co` || typeof cfg.EXTERNAL_SUPABASE_KEY !== 'string' || !cfg.EXTERNAL_SUPABASE_KEY) throw new Error('TARGET_OR_CREDENTIAL_CHECK_FAILED');
  const token = cfg.EXTERNAL_SUPABASE_KEY;
  const report = JSON.parse(await fs.readFile(candidatePath, 'utf8'));
  const summary = validateCandidateGroups(report);
  await fs.mkdir(outputDirectory, { recursive: true });
  const verifiedGroups = [];
  let downloadedBytes = 0;

  for (const group of report.groups) {
    const [first, second] = group.keys_and_declared_bytes;
    const bodies = [];
    for (const [key, size] of [first, second]) {
      const body = await fetchObject(cfg.EXTERNAL_SUPABASE_URL, token, key, size);
      const digest = createHash('sha256').update(body).digest('hex');
      if (digest !== group.path_sha256) throw new Error(`BODY_HASH_MISMATCH_${group.path_sha256}`);
      bodies.push(body);
      downloadedBytes += body.length;
    }
    if (!bodies[0].equals(bodies[1])) throw new Error(`BODY_BYTES_DIFFER_${group.path_sha256}`);
    const filename = `${group.path_sha256}.bin`;
    const filePath = path.join(outputDirectory, filename);
    await fs.writeFile(filePath, bodies[0], { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.readFile(filePath);
      if (existing.length !== bodies[0].length || createHash('sha256').update(existing).digest('hex') !== group.path_sha256) throw new Error('EXISTING_RECOVERY_COPY_MISMATCH');
    });
    verifiedGroups.push({
      bucket_id: group.bucket_id,
      sha256: group.path_sha256,
      bytes: bodies[0].length,
      verified_object_keys: [first[0], second[0]],
      object_count: 2,
      byte_equal: true,
      all_object_bodies_sha256_verified: true,
      recovery_file: filename,
      recovery_sha256: createHash('sha256').update(bodies[0]).digest('hex'),
    });
  }

  const manifest = {
    schema_version: 'storage-duplicate-recovery/1',
    target_project: project,
    bucket: 'corpus-originals',
    created_at: new Date().toISOString(),
    source_candidate_report: candidatePath,
    source_candidate_report_sha256: createHash('sha256').update(await fs.readFile(candidatePath)).digest('hex'),
    summary: { ...summary, downloadedBytes, all_groups_verified: verifiedGroups.length === summary.groups },
    groups: verifiedGroups,
    note: 'One local recovery copy per hash; no storage or database mutation was performed.',
  };
  await fs.writeFile(outputManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest.summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
