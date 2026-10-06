/**
 * Reconciles the app's static Federal Register supplement (private bundle
 * quality/reference/federal-register-gap/*) with the acquired API documents.
 * Read-only: pages are fetched through the app's own snapshot endpoint and
 * checked against the manifest's byte counts and SHA-256 values.
 *
 *   node reconcile-supplement.mjs --site https://firastest1.com --dir PRIVATE_DIR [--out report.json]
 */
import fs from 'node:fs';
import { loadCheckpoint, readPage } from './acquire.mjs';
import { sha256 } from './lib.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const site = arg('--site', 'https://firastest1.com');
const dir = arg('--dir');
if (!dir) throw new Error('Usage: --dir PRIVATE_DIR [--site URL] [--out FILE]');
const PAGE = 256 * 1024;

async function snapshot(file) {
  const get = (page, version) => fetch(`${site}/api/bundles?${new URLSearchParams({ file, page: String(page), ...(version ? { version } : {}) })}`, { signal: AbortSignal.timeout(60000) });
  const first = await get(0);
  if (!first.ok) throw new Error(`Snapshot ${file}: HTTP ${first.status}`);
  const sha = first.headers.get('x-atlas-snapshot-sha256');
  const total = Number(first.headers.get('x-atlas-snapshot-bytes'));
  const parts = [Buffer.from(await first.arrayBuffer())];
  for (let page = 1; page < Math.ceil(total / PAGE); page++) {
    const r = await get(page, sha);
    if (!r.ok) throw new Error(`Snapshot ${file} page ${page}: HTTP ${r.status}`);
    parts.push(Buffer.from(await r.arrayBuffer()));
  }
  const bytes = Buffer.concat(parts);
  if (bytes.length !== total || sha256(bytes) !== sha) throw new Error(`Snapshot ${file} checksum mismatch`);
  return bytes;
}

const root = 'quality/reference/federal-register-gap/';
const manifest = JSON.parse((await snapshot(root + 'manifest.json')).toString('utf8'));
const supplement = new Map();
for (const page of manifest.pages) {
  const bytes = await snapshot(root + page.name);
  if (sha256(bytes) !== page.sha256 || bytes.length !== page.bytes) throw new Error(`Supplement page ${page.name} differs from its manifest`);
  for (const r of JSON.parse(bytes.toString('utf8')).results) supplement.set(r.document_number, r);
}
const cp = loadCheckpoint(dir);
const mine = new Map();
for (const [day, entry] of Object.entries(cp.days)) {
  if (day < manifest.publicationFrom) continue;
  for (const page of entry.pages) for (const r of readPage(dir, page).results) mine.set(r.document_number, r);
}
const inRange = (r) => r.publication_date >= manifest.publicationFrom && r.publication_date <= manifest.publicationThrough;
const mineInRange = new Map([...mine].filter(([, r]) => inRange(r)));
const both = [...supplement.keys()].filter((k) => mineInRange.has(k));
const onlySupplement = [...supplement.keys()].filter((k) => !mine.has(k));
const supplementOutOfRange = [...supplement.keys()].filter((k) => mine.has(k) && !inRange(mine.get(k)));
const onlyAcquisition = [...mineInRange.keys()].filter((k) => !supplement.has(k));
const fieldNames = Object.keys([...supplement.values()][0] ?? {});
let fieldDifferences = 0;
const differing = {};
for (const k of both) {
  for (const f of fieldNames) {
    if (JSON.stringify(supplement.get(k)[f]) !== JSON.stringify(mine.get(k)[f])) { fieldDifferences++; differing[f] = (differing[f] ?? 0) + 1; }
  }
}
const lateAdded = (id) => ({ document_number: id, publication_date: mine.get(id)?.publication_date, type: mine.get(id)?.type });
const report = {
  supplement: { documents: supplement.size, from: manifest.publicationFrom, through: manifest.publicationThrough, manifestRecords: manifest.records, fetchedAt: manifest.fetchedAt },
  acquisition: { documentsInSupplementRange: mineInRange.size, documentsTotal: mine.size },
  overlap: both.length,
  inSupplementNotInAcquisition: onlySupplement,
  inSupplementButOutsideRangeInAcquisition: supplementOutOfRange,
  inAcquisitionNotInSupplement: { total: onlyAcquisition.length, byDate: Object.fromEntries([...onlyAcquisition.reduce((m, id) => m.set(mine.get(id).publication_date, (m.get(mine.get(id).publication_date) ?? 0) + 1), new Map())].sort()), sample: onlyAcquisition.slice(0, 10).map(lateAdded) },
  afterSupplementRange: [...mine.values()].filter((r) => r.publication_date > manifest.publicationThrough).length,
  sharedFieldDifferences: { total: fieldDifferences, byField: differing },
};
if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
