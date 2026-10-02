import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const out = path.resolve(process.argv[2] ?? '../audit/2026-10-02/metadata');
await fs.mkdir(out, { recursive: true });
const keys = JSON.parse(await fs.readFile('C:/Users/firas/.codex/private/legal-source-compass.ingest.json', 'utf8'));
const targets = [
  ['usage', 'https://www.courtlistener.com/api/rest/v4/api-usage/', true],
  ['api-root', 'https://www.courtlistener.com/api/rest/v4/', true],
  ['bulk-index', 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&prefix=bulk-data/&max-keys=1000', false],
];
for (const [label, url, auth] of targets) {
  const response = await fetch(url, { headers: auth ? { Authorization: `Token ${keys.COURTLISTENER_API_KEY}`, Accept: 'application/json' } : {}, redirect: 'error', signal: AbortSignal.timeout(60_000) });
  const body = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(path.join(out, `${label}.${label === 'bulk-index' ? 'xml' : 'json'}`), body);
  const item = { url, retrievedAt: new Date().toISOString(), status: response.status, sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length };
  await fs.writeFile(path.join(out, `${label}.provenance.json`), JSON.stringify(item, null, 2));
  if (label === 'usage') console.log(JSON.stringify({ label, ...item, body: JSON.parse(body.toString()) }));
  else if (label === 'api-root') console.log(JSON.stringify({ label, ...item, endpoints: JSON.parse(body.toString()) }));
  else console.log(JSON.stringify({ label, ...item, files: [...body.toString().matchAll(/<Key>(.*?)<\/Key>/g)].map(x => x[1]) }));
}
