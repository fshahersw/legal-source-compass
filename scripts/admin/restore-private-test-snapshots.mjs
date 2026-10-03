// Restore authorized test snapshots into ignored local storage; never publishes source data.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = resolve(root, 'private/data');
const manifest = JSON.parse(await readFile(resolve(root, 'src/lib/private-data/manifest.server.json'), 'utf8'));
const expectedProject = 'xosqzzsnhxcyehcnirpa';
const base = process.env.EXTERNAL_SUPABASE_URL;
const key = process.env.EXTERNAL_SUPABASE_KEY;
if (!base || new URL(base).origin !== `https://${expectedProject}.supabase.co` || !key)
  throw new Error('Set the external corpus URL and server key in the process environment before restoring private test data.');
if (manifest.project_id !== expectedProject || manifest.bucket !== 'corpus-originals') throw new Error('Unexpected snapshot destination');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let restored = 0;
let existing = 0;
for (const [file, item] of Object.entries(manifest.files)) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid snapshot path');
  const target = resolve(destination, file);
  if (!target.startsWith(destination + sep)) throw new Error('Snapshot path escaped local storage');
  if (!/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 16 * 1024 * 1024
    || item.storage_key !== `atlas-private-data/sha256/${item.sha256.slice(0, 2)}/${item.sha256}.bin`) throw new Error('Invalid immutable snapshot');
  let local;
  try { local = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (local) {
    if (local.length !== item.bytes || digest(local) !== item.sha256) throw new Error(`Local snapshot differs; preserving it: ${file}`);
    existing++;
    continue;
  }
  const response = await fetch(`${new URL(base).origin}/storage/v1/object/authenticated/${manifest.bucket}/${item.storage_key}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) throw new Error(`Private snapshot restore stopped (HTTP ${response.status})`);
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > item.bytes) throw new Error('Private snapshot exceeds its pinned size');
    parts.push(part);
  }
  const bytes = Buffer.concat(parts);
  if (size !== item.bytes || digest(bytes) !== item.sha256) throw new Error('Private snapshot verification failed');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  restored++;
}
console.log(JSON.stringify({ restored, existing, verified: restored + existing }));
