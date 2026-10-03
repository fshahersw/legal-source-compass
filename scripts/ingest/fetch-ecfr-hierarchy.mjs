/** Dated public eCFR API metadata only. No PDF, account, or client-secret access. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).map(x => x.replace(/^--/, '').split('=')));
const cache = path.resolve(args.cache ?? 'C:/Users/firas/.codex/corpus-cache/regulatory/2026-10-02/hierarchy');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
await fs.mkdir(path.join(cache, 'originals'), { recursive: true });
const manifestPath = path.join(cache, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8').catch(() => JSON.stringify({
  schema_version: 'ecfr-metadata-acquisition/1', created_at: new Date().toISOString(),
  metadata_only: true, pdf_downloads: 0, sources: {},
})));
let writes = Promise.resolve();
async function checkpoint() {
  manifest.updated_at = new Date().toISOString();
  const value = JSON.stringify(manifest, null, 2) + '\n';
  writes = writes.then(() => fs.writeFile(manifestPath, value));
  await writes;
}
async function acquire(key, url, kind, expected) {
  const old = manifest.sources[key];
  if (old?.complete) {
    const b = await fs.readFile(path.join(cache, old.file));
    if (hash(b) !== old.sha256) throw Error('Cached original checksum mismatch: ' + key);
    return kind === 'json' ? JSON.parse(b) : b.toString('utf8');
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { Accept: kind === 'json' ? 'application/json' : 'application/xml' } });
  const retrieved = new Date().toISOString();
  if (!r.ok) {
    manifest.sources[key] = { url, http_status: r.status, retrieved_at: retrieved, complete: false };
    await checkpoint();
    throw Error('Source scope stopped at HTTP ' + r.status + ': ' + url);
  }
  if (new URL(r.url).origin !== 'https://www.ecfr.gov') throw Error('Unexpected API redirect origin');
  const bytes = Buffer.from(await r.arrayBuffer());
  const content = kind === 'json' ? JSON.parse(bytes) : bytes.toString('utf8');
  if (!expected(content)) throw Error('Unexpected source structure: ' + key);
  const file = 'originals/' + key + (kind === 'json' ? '.json' : '.xml');
  await fs.writeFile(path.join(cache, file), bytes, { flag: 'wx' });
  manifest.sources[key] = { url, file, http_status: r.status, retrieved_at: retrieved, bytes: bytes.length, sha256: hash(bytes), complete: true };
  await checkpoint();
  console.log(JSON.stringify({ key, bytes: bytes.length, sha256: hash(bytes), complete: true }));
  return content;
}

const titles = await acquire('titles', 'https://www.ecfr.gov/api/versioner/v1/titles.json', 'json', x => Array.isArray(x.titles) && x.titles.length === 50);
manifest.requested_titles = titles.titles.map(t => ({ ...t, structure_status: t.reserved ? 'reserved-no-structure-requested' : 'requested' }));
await checkpoint();
let cursor = 0;
const nonreserved = titles.titles.filter(t => !t.reserved);
const outcomes = await Promise.allSettled(Array.from({ length: 4 }, async () => {
  while (cursor < nonreserved.length) {
    const t = nonreserved[cursor++];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.up_to_date_as_of ?? '')) throw Error('Missing publisher currentness date');
    await acquire('title-' + t.number, `https://www.ecfr.gov/api/versioner/v1/structure/${t.up_to_date_as_of}/title-${t.number}.json`, 'json', x => x.type === 'title' && x.identifier === String(t.number) && Array.isArray(x.children));
  }
}));
const failures = outcomes.filter(x => x.status === 'rejected');
manifest.hierarchy_complete = failures.length === 0 && nonreserved.every(t => manifest.sources['title-' + t.number]?.complete);
await checkpoint();
if (failures.length) throw failures[0].reason;

// The subject selection is a research scope, not case-specific applicability.
const parts = { 16: ['1115'], 21: ['7','50','56','201','202','210','211','310','314','600','606','610','801','803','806','807','812','814','820','821','822','830','1271'], 29: ['1910'], 40: ['152','156','158','170','180','300','302','355','372','761'] };
for (const [title, list] of Object.entries(parts)) {
  const t = nonreserved.find(x => String(x.number) === title);
  for (const part of list) {
    await acquire(`part-${title}-${part}`, `https://www.ecfr.gov/api/versioner/v1/full/${t.up_to_date_as_of}/title-${title}.xml?part=${part}`, 'xml', x => /^<\?xml/.test(x) && x.includes(`N="${part}" TYPE="PART"`));
  }
}
await acquire('part-21-820-before-qmsr', 'https://www.ecfr.gov/api/versioner/v1/full/2026-02-01/title-21.xml?part=820', 'xml', x => /^<\?xml/.test(x) && x.includes('N="820" TYPE="PART"'));
manifest.part_scope_complete = Object.entries(parts).every(([title, list]) => list.every(part => manifest.sources[`part-${title}-${part}`]?.complete)) && manifest.sources['part-21-820-before-qmsr']?.complete;
manifest.completed_at = new Date().toISOString();
await checkpoint();
console.log(JSON.stringify({ cache, hierarchy_complete: manifest.hierarchy_complete, part_scope_complete: manifest.part_scope_complete, originals: Object.values(manifest.sources).filter(s => s.complete).length, pdf_downloads: 0 }));
