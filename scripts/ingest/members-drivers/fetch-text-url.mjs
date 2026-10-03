// Fetch public official text/XML/HTML pages (NOT PDFs) and keep sha256 + retrieval time as evidence.
// node fetch-text-url.mjs <label>=<url> ...   -> official-pages/<label>.<ext> and official-pages/fetch-index.jsonl
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const dir = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members/official-pages';
fs.mkdirSync(dir, { recursive: true });
for (const spec of process.argv.slice(2)) {
  const i = spec.indexOf('=');
  const label = spec.slice(0, i), url = spec.slice(i + 1);
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SeegerWeissCorpus/1.0)', Accept: 'text/html,application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(90000), redirect: 'follow' });
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok) { console.log(JSON.stringify({ label, url, status: r.status })); continue; }
  if (buf.subarray(0, 5).toString().startsWith('%PDF')) { console.log(JSON.stringify({ label, url, status: 'pdf_not_fetched' })); continue; }
  const ct = r.headers.get('content-type') ?? '';
  const ext = /xml/.test(ct) ? 'xml' : /json/.test(ct) ? 'json' : 'html';
  const file = path.join(dir, `${label}.${ext}`);
  fs.writeFileSync(file, buf);
  const rec = { label, url, final_url: r.url, file, content_type: ct, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), retrieved_at: new Date().toISOString(), status: r.status };
  fs.appendFileSync(path.join(dir, 'fetch-index.jsonl'), JSON.stringify(rec) + '\n');
  console.log(JSON.stringify({ ...rec, file: path.basename(file) }));
}
