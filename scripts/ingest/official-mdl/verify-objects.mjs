// Independent byte re-read of the stored official-court PDFs: for every cloud-verified receipt of a batch, downloads the object from the PRIVATE bucket with the
// service role, recomputes SHA-256 / SHA-1 / size / PDF magic and compares them with the receipt, and keeps a local copy under <run>/peek/ for text extraction.
//   node --use-system-ca scripts/ingest/official-mdl/verify-objects.mjs --label=b001-njd[,b001-txnd...] --credentials=<json> [--run-dir=<dir>]
// Output: <run>/verify-objects.jsonl (append-only). Never prints credentials.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveRunDir, parseArgs, readJsonl, appendJsonl } from './store.mjs';

const PROJECT = 'xosqzzsnhxcyehcnirpa', BUCKET = 'corpus-originals';
const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args['run-dir']);
const cfg = JSON.parse(fs.readFileSync(String(args.credentials), 'utf8'));
if (cfg.EXTERNAL_SUPABASE_URL !== 'https://' + PROJECT + '.supabase.co') throw Error('WRONG_PROJECT');
const token = cfg.EXTERNAL_SUPABASE_KEY;
const headers = { apikey: token, ...(!token.startsWith('sb_') ? { Authorization: 'Bearer ' + token } : {}) };
const labels = String(args.label ?? '').split(',').map(x => x.trim()).filter(Boolean);
fs.mkdirSync(path.join(runDir, 'peek'), { recursive: true });
const out = path.join(runDir, 'verify-objects.jsonl');
let ok = 0, bad = 0;
for (const label of labels) {
  const receipts = readJsonl(path.join(runDir, 'transfers', label, 'transfer-receipts.jsonl')).filter(r => r.state === 'cloud_verified' || r.state === 'dedup_matched');
  const latest = new Map();
  for (const r of receipts) latest.set(r.provider + '|' + r.native_document_id, r);
  for (const r of latest.values()) {
    const started = new Date().toISOString();
    try {
      const response = await fetch(cfg.EXTERNAL_SUPABASE_URL + '/storage/v1/object/authenticated/' + BUCKET + '/' + r.storage_key, { headers, redirect: 'error', signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw Error('HTTP_' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash('sha256').update(bytes).digest('hex'), sha1 = createHash('sha1').update(bytes).digest('hex');
      const match = sha256 === r.sha256 && sha1 === r.sha1 && bytes.length === r.bytes && bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'));
      if (match) fs.writeFileSync(path.join(runDir, 'peek', r.sha256 + '.pdf'), bytes);
      appendJsonl(out, { label, native_document_id: r.native_document_id, native_case_id: r.native_case_id, storage_key: r.storage_key, expected: { sha256: r.sha256, sha1: r.sha1, bytes: r.bytes }, actual: { sha256, sha1, bytes: bytes.length, pdf_magic: bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')) }, match, receipt_state: r.state, object_origin: r.object_origin ?? null, checked_at: started });
      match ? ok++ : bad++;
    } catch (error) {
      bad++;
      appendJsonl(out, { label, native_document_id: r.native_document_id, storage_key: r.storage_key, match: false, error: String(error.message).slice(0, 120), checked_at: started });
    }
  }
}
console.log(JSON.stringify({ labels, verified_exact: ok, failed: bad, out }));
if (bad) process.exitCode = 2;
