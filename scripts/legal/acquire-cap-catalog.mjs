import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [destination] = process.argv.slice(2);
fs.mkdirSync(destination, { recursive: true });
async function retain(url, filename) {
  const file = path.join(destination, filename); const provenance = file + '.provenance.json';
  if (fs.existsSync(provenance)) {
    const p = JSON.parse(fs.readFileSync(provenance)); const bytes = fs.readFileSync(file);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== p.sha256) throw Error('CAP retained original checksum mismatch');
    return bytes;
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`CAP HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const p = { source_url: url, retrieved_at: new Date().toISOString(), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, http_status: response.status, licence: 'CC0 1.0 Universal', licence_url: 'https://case.law/terms/' };
  fs.writeFileSync(file, bytes, { flag: 'wx' }); fs.writeFileSync(provenance, JSON.stringify(p, null, 2), { flag: 'wx' });
  return bytes;
}
const root = (await retain('https://static.case.law/', 'index.html')).toString();
for (const name of ['ReportersMetadata.json', 'VolumesMetadata.json', 'JurisdictionsMetadata.json']) {
  const url = `https://static.case.law/${name}`;
  if (!root.includes(url)) throw Error('Metadata file is not linked from the publisher index');
  await retain(url, name);
}
const volumes = JSON.parse(fs.readFileSync(path.join(destination, 'VolumesMetadata.json')));
const candidates = volumes.filter(v => Math.max(v.publication_year || 0, v.end_year || 0, v.spine_end_year || 0) >= 2000);
const unknown = volumes.filter(v => !v.publication_year && !v.end_year && !v.spine_end_year);
const plan = { source_url: 'https://static.case.law/VolumesMetadata.json', from_date: '2000-01-01', candidate_volumes: candidates, unknown_date_volumes: unknown, all_volumes: volumes.length, complete: false };
fs.writeFileSync(path.join(destination, 'load-plan.json'), JSON.stringify(plan));
const index = (await retain('https://static.case.law/us/', 'us-index.html')).toString();
const sample = 'https://static.case.law/us/572.zip';
if (!index.includes(sample)) throw Error('Sample volume is not published in the index');
await retain(sample, 'us-572.zip');
console.log(JSON.stringify({ volumes: volumes.length, candidate_volumes: candidates.length, unknown_date_volumes: unknown.length, sample_bulk_archive: 'us-572.zip', complete: false }));
