// Content-addressed upload of evidence files to the private corpus-originals bucket with sha256-verified readback.
//   EXTERNAL_SUPABASE_URL=... EXTERNAL_SUPABASE_KEY=... node upload-evidence.mjs <prefix> <manifestOut> <file>...
// Key: <prefix>/sha256/<aa>/<sha256>/<basename>. An existing object with the same key is verified, never overwritten.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const BUCKET = 'corpus-originals';
export const keyFor = (prefix, sha, name) => `${prefix}/sha256/${sha.slice(0, 2)}/${sha}/${name}`;

async function sha256File(file) {
  const h = crypto.createHash('sha256'); const f = await fs.open(file);
  try { for await (const c of f.createReadStream()) h.update(c); } finally { await f.close(); }
  return h.digest('hex');
}

export async function uploadOne(url, key, file, name, prefix) {
  const sha = await sha256File(file), bytes = (await fs.stat(file)).size;
  const objectKey = keyFor(prefix, sha, name);
  const headers = {apikey: key};
  const get = () => fetch(`${url}/storage/v1/object/${BUCKET}/${objectKey}`, {headers, signal: AbortSignal.timeout(600000)});
  let existing = await get();
  if (!existing.ok) {
    await existing.arrayBuffer();
    const body = await fs.readFile(file);
    const put = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectKey}`, {method: 'POST', headers: {...headers, 'Content-Type': 'application/octet-stream', 'x-upsert': 'false'}, body, signal: AbortSignal.timeout(1800000)});
    if (!put.ok) throw new Error(`UPLOAD_HTTP_${put.status} ${(await put.text()).slice(0, 200)}`);
    existing = await get();
    if (!existing.ok) throw new Error('READBACK_HTTP_' + existing.status);
  }
  const h = crypto.createHash('sha256'); let n = 0;
  for await (const c of existing.body) { h.update(c); n += c.length; }
  if (h.digest('hex') !== sha || n !== bytes) throw new Error('READBACK_MISMATCH ' + name);
  return {name, bucket: BUCKET, key: objectKey, sha256: sha, bytes, readback_verified: true};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [prefix, manifestOut, ...files] = process.argv.slice(2);
  const url = process.env.EXTERNAL_SUPABASE_URL, key = process.env.EXTERNAL_SUPABASE_KEY ?? process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  if (url !== 'https://xosqzzsnhxcyehcnirpa.supabase.co' || !key || !prefix || !files.length) throw new Error('usage: upload-evidence.mjs <prefix> <manifestOut> <file>...');
  const out = [];
  for (const f of files) { out.push(await uploadOne(url, key, f, path.basename(f), prefix)); console.log(JSON.stringify(out.at(-1))); }
  await fs.writeFile(manifestOut, JSON.stringify({uploaded_at: new Date().toISOString(), files: out}, null, 2));
}
