// Writes <run>/registered-official.jsonl entries for completed batches that finished before the ledger existed (idempotent: existing keys are skipped).
//   node scripts/ingest/official-mdl/backfill-ledger.mjs [--run-dir=<dir>]
import fs from 'node:fs';
import path from 'node:path';
import { resolveRunDir, parseArgs, readJsonl, appendJsonl } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args['run-dir']);
const ledgerFile = path.join(runDir, 'registered-official.jsonl');
const have = new Set(readJsonl(ledgerFile).map(x => [x.provider, x.native_document_id, x.native_case_id, x.record_sha256].join('|')));
let added = 0;
for (const name of fs.readdirSync(path.join(runDir, 'queues')).filter(n => n.endsWith('.queue.jsonl.manifest.json')).sort()) {
  const manifestFile = path.join(runDir, 'queues', name);
  const done = manifestFile + '.done.json';
  if (!fs.existsSync(done)) continue;
  const completion = JSON.parse(fs.readFileSync(done, 'utf8')).registration_completion;
  if (!completion || completion.rejected_receipts !== 0) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')), label = path.basename(manifest.queue).replace('.queue.jsonl', '');
  const receipts = new Map(readJsonl(path.join(runDir, 'transfers', label, 'transfer-receipts.jsonl')).filter(r => r.state === 'cloud_verified' || r.state === 'dedup_matched').map(r => [r.provider + '|' + r.native_document_id, r]));
  for (const line of fs.readFileSync(manifest.queue, 'utf8').trim().split('\n')) {
    const row = JSON.parse(line), r = receipts.get(row.provider + '|' + row.native_document_id);
    const key = [row.provider, row.native_document_id, row.native_case_id, row.selected_source_record_sha256].join('|');
    if (!r || have.has(key)) continue;
    appendJsonl(ledgerFile, { provider: row.provider, native_document_id: row.native_document_id, url: row.download_url, native_case_id: row.native_case_id, record_sha256: row.selected_source_record_sha256, sha256: r.sha256, bytes: r.bytes, storage_key: r.storage_key, object_origin: r.object_origin ?? null, label, registered_at: (completion.finished_at ?? new Date().toISOString()) });
    have.add(key); added++;
  }
}
console.log(JSON.stringify({ ledger: ledgerFile, added, total: have.size }));
