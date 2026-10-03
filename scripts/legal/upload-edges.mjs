import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { adminClient } from './admin-client.mjs';
import { legalEdge } from '../../src/lib/legal/schema.ts';
import { readJsonLines } from './jsonl.ts';
const [configFile, run, credentials] = process.argv.slice(2);
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(run ?? '')) throw Error('Use the completed record intake run ID');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const db = config.edge_file ? null : new DatabaseSync(config.database, { readOnly: true });
const rpc = adminClient(credentials);
const journal = path.join(config.output, `edge-upload-${run}.jsonl`);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const done = new Set(fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.received === r.resolved).map(r => r.batch_sha256) : []);
let batch = [], received = 0, unresolved = 0;
async function send() {
  if (!batch.length) return;
  const digest = sha(JSON.stringify(batch));
  if (!done.has(digest)) {
    const result = await rpc('corpus_legal_edges_v3', { p_run: run, p_edges: batch });
    if (result.received !== batch.length || result.run_id !== run || result.complete !== false) throw Error('Edge intake acknowledgement mismatch');
    fs.appendFileSync(journal, JSON.stringify({ ...result, batch_sha256: digest, checked_at: new Date().toISOString() }) + '\n');
    unresolved += result.received - result.resolved;
  }
  received += batch.length; batch = [];
  if (received % 5000 === 0) console.log(JSON.stringify({ received, unresolved, complete: false }));
}
const rows = config.edge_file ? readJsonLines(config.edge_file) : db.prepare('select edge_key,payload from edges order by edge_key').iterate();
for await (const row of rows) {
  const payload = legalEdge.parse(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
  batch.push({ edge_key: row.edge_key, payload });
  if (batch.length === 250) await send();
}
await send(); db?.close();
console.log(JSON.stringify({ run_id: run, received, unresolved, review_status: 'pending', complete: false, journal }));
