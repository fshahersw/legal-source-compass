// Fetch arbitrary JPML/GovInfo PDF URLs, record sha256 + retrieval time in jpml-pdfs/fetch-index.jsonl. Usage: node fetch-jpml-url.mjs <mdl>=<url> ...
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const work = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members';
const dir = path.join(work, 'jpml-pdfs');
fs.mkdirSync(dir, { recursive: true });
const index = path.join(dir, 'fetch-index.jsonl');
for (const spec of process.argv.slice(2)) {
  const i = spec.indexOf('=');
  const mdl = spec.slice(0, i), url = spec.slice(i + 1);
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SeegerWeissCorpus/1.0)' }, signal: AbortSignal.timeout(60000), redirect: 'follow' });
  if (!r.ok) { console.log(JSON.stringify({ mdl, url, status: r.status })); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.subarray(0, 5).toString().startsWith('%PDF')) { console.log(JSON.stringify({ mdl, url, status: 'not_pdf' })); continue; }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.pdf$/i, '');
  const host = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
  const file = path.join(dir, `${host}-${name}.pdf`);
  fs.writeFileSync(file, buf);
  const rec = { mdl: Number(mdl), url, file, bytes: buf.length, sha256: sha, retrieved_at: new Date().toISOString(), status: r.status };
  fs.appendFileSync(index, JSON.stringify(rec) + '\n');
  console.log(JSON.stringify({ ...rec, file: path.basename(file) }));
}
