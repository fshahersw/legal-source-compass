// Reads an object from the private corpus-originals bucket with the service role (read-only) and writes it locally.
// Usage: node members-bucket-get.mjs <storage_key> <out_file>
import fs from 'node:fs';
import crypto from 'node:crypto';
const [key, out] = process.argv.slice(2);
if (!key || !out) throw new Error('usage: <storage_key> <out_file>');
if (!/^seeger-weiss\/pdf-sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.pdf$/.test(key)) throw new Error('only seeger-weiss/pdf-sha256 keys are readable by this helper');
const c = JSON.parse(fs.readFileSync(process.env.CORPUS_PREVIEW_CREDENTIALS ?? 'C:/Users/firas/.codex/private/legal-source-compass.preview.json', 'utf8'));
const token = c.EXTERNAL_SUPABASE_KEY;
const headers = { apikey: token, ...(token.startsWith('sb_') ? {} : { Authorization: `Bearer ${token}` }) };
const r = await fetch(`${c.EXTERNAL_SUPABASE_URL}/storage/v1/object/corpus-originals/${key}`, { headers, signal: AbortSignal.timeout(120000) });
if (!r.ok) throw new Error('HTTP ' + r.status);
const buf = Buffer.from(await r.arrayBuffer());
const sha = crypto.createHash('sha256').update(buf).digest('hex');
const expected = key.split('/').pop().replace(/\.pdf$/, '');
if (sha !== expected) throw new Error('sha256 mismatch against content-addressed key');
fs.writeFileSync(out, buf);
console.log(JSON.stringify({ key, bytes: buf.length, sha256: sha, verified_content_address: true }));
