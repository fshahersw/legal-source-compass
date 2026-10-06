// Read-only retrieval of protected snapshot bundles through the application's own /api/bundles path.
// Every file is page-assembled and verified against the committed manifest SHA-256 before it is used.
// No administrative credential is involved; the origin is supplied by the caller.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST = path.resolve(here, '../../../src/lib/private-data/manifest.server.json');
export const PAGE = 256 * 1024;

export async function loadManifest() { return JSON.parse(await fs.readFile(MANIFEST, 'utf8')).files; }

export async function fetchSnapshot(origin, file, entry, {fetchImpl = fetch} = {}) {
  const pages = Math.ceil(entry.bytes / PAGE);
  const buf = Buffer.alloc(entry.bytes);
  for (let page = 0; page < pages; page++) {
    const qs = new URLSearchParams({file, page: String(page), ...(page ? {version: entry.sha256} : {})});
    let r;
    for (let attempt = 0; ; attempt++) {
      r = await fetchImpl(`${origin}/api/bundles?${qs}`, {signal: AbortSignal.timeout(60000)});
      if (r.ok || attempt >= 3 || r.status < 429) break;
      await new Promise(res => setTimeout(res, 1500 * 2 ** attempt));
    }
    if (!r.ok) throw new Error(`SNAPSHOT_HTTP_${r.status} ${file} page ${page}`);
    const part = Buffer.from(await r.arrayBuffer());
    const start = page * PAGE;
    if (start + part.length > entry.bytes) throw new Error('SNAPSHOT_OVERRUN ' + file);
    part.copy(buf, start);
  }
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (actual !== entry.sha256) throw new Error(`SNAPSHOT_SHA_MISMATCH ${file}`);
  return buf;
}

export async function ensureSnapshot(origin, cacheDir, file, files) {
  const entry = files[file];
  if (!entry) throw new Error('NOT_IN_MANIFEST ' + file);
  const target = path.join(cacheDir, file);
  try {
    const have = await fs.readFile(target);
    if (crypto.createHash('sha256').update(have).digest('hex') === entry.sha256) return have;
  } catch { /* fetch below */ }
  const buf = await fetchSnapshot(origin, file, entry);
  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.writeFile(target, buf);
  return buf;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [origin, cacheDir, ...prefixes] = process.argv.slice(2);
  if (!origin || !cacheDir || !prefixes.length) { console.error('usage: fetch-snapshots.mjs <origin> <cacheDir> <manifest-prefix>...'); process.exit(2); }
  const files = await loadManifest();
  const names = Object.keys(files).filter(n => prefixes.some(p => n.startsWith(p)));
  let bytes = 0;
  for (const n of names) { const b = await ensureSnapshot(origin, cacheDir, n, files); bytes += b.length; }
  console.log(JSON.stringify({files: names.length, bytes, verified: true}));
}
