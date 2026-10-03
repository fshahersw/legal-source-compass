import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [sourceManifest, destination] = process.argv.slice(2);
fs.mkdirSync(destination, { recursive: true });
const sources = JSON.parse(fs.readFileSync(sourceManifest, 'utf8')).sources.filter(r => ['fjc-demographics','fjc-service'].includes(r.id));
const result = [];
for (const source of sources) {
  const response = await fetch(source.url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!response.ok || new URL(response.url).hostname !== 'www.fjc.gov') throw Error('Official FJC audit source unavailable');
  const bytes = Buffer.from(await response.arrayBuffer()); const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const file = path.join(destination, digest + '.csv');
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' });
  result.push({ id: source.id, path: file, source_url: source.url, final_url: response.url, status: response.status, bytes: bytes.length, sha256: digest, snapshot_sha256: source.sha256,
    unchanged_from_acquisition: digest === source.sha256, checked_at: new Date().toISOString() });
}
fs.writeFileSync(path.join(destination, 'fresh-source-receipts.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ official_sources_checked: result.length, all_unchanged: result.every(r => r.unchanged_from_acquisition) }));
