import fs from 'node:fs';
import { adminClient } from './admin-client.mjs';
const [planFile, credentials] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const receipts = fs.readFileSync(planFile + '.receipts.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const verified = new Map(receipts.filter(r => r.state === 'original_verified').map(r => [r.sha256, r]));
const rpc = adminClient(credentials);
let files = 0, bytes = 0;
for (const item of plan.files) {
  const receipt = verified.get(item.sha256);
  if (!receipt) continue;
  if (receipt.bytes !== item.bytes) throw Error('Archive receipt disagrees with source plan');
  const result = await rpc('corpus_legal_register_archive_v3', { p_archive: { sha256: item.sha256, bytes: item.bytes, manifest_key: receipt.manifest_key,
    manifest_sha256: receipt.manifest_sha256, provenance: item.provenance, verified_at: receipt.checked_at } });
  if (result.sha256 !== item.sha256 || result.bytes !== item.bytes || result.private !== true) throw Error('Archive registration acknowledgement mismatch');
  files++; bytes += item.bytes;
}
console.log(JSON.stringify({ registered_archives: files, bytes, total_planned: plan.files.length, private: true }));
