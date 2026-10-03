import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { adminClient } from './admin-client.mjs';
import { LEGAL_SCHEMA_VERSION, legalRecord } from '../../src/lib/legal/schema.ts';
const [configFile, credentials] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const db = new DatabaseSync(config.database, { readOnly: true });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const files = db.prepare('select path,sha256,state,rows from files order by path').all();
if (files.some(f => f.state !== 'complete')) throw Error('Input file staging has not finished');
const manifest = { schema_version: LEGAL_SCHEMA_VERSION, scope: 'Retained source records; private review pending', inputs: files, complete: false };
const digest = sha(JSON.stringify(manifest));
const run = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
const journal = path.join(config.output, `upload-${run}.jsonl`);
fs.mkdirSync(config.output, { recursive: true });
const done = new Set(fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).batch_sha256) : []);
const rpc = adminClient(credentials); let batch = []; let bytes = 0; let received = 0; let lastLog = Date.now();
const inFlight = new Set(); let failure;
async function queue() {
  if (!batch.length) return;
  if (failure) { await Promise.all(inFlight); throw failure; }
  const current = batch; batch = []; bytes = 0;
  const batchHash = sha(JSON.stringify(current));
  if (done.has(batchHash)) { received += current.length; return; }
  // Batches have distinct input keys. Server constraints and post-conflict
  // checks preserve immutable versions under concurrent requests.
  const pending = (async () => {
    const result = await rpc('corpus_legal_stage_v3', { p_run: run, p_manifest: manifest, p_rows: current });
    if (result.received !== current.length || result.run_id !== run || result.complete !== false) throw Error('Staging acknowledgement mismatch');
    fs.appendFileSync(journal, JSON.stringify({ ...result, batch_sha256: batchHash, checked_at: new Date().toISOString() }) + '\n');
    received += current.length;
    if (Date.now() - lastLog > 15000) { lastLog = Date.now(); console.log(JSON.stringify({ run_id: run, received, complete: false })); }
  })().catch(error => { failure = error; }).finally(() => inFlight.delete(pending));
  inFlight.add(pending);
  if (inFlight.size >= 3) {
    await Promise.race(inFlight);
    if (failure) { await Promise.all(inFlight); throw failure; }
  }
}
for (const row of db.prepare('select * from inputs order by input_key').iterate()) {
  const candidates = JSON.parse(row.candidates_json);
  const validated = candidates.map(c => legalRecord.safeParse(c));
  const errors = validated.flatMap(r => r.success ? [] : r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`));
  const value = { input_key: row.input_key, source_name: row.source, source_year: row.source_year, raw: JSON.parse(row.raw_json), candidates: validated.map((r, i) => r.success ? r.data : candidates[i]), errors };
  const size = Buffer.byteLength(JSON.stringify(value));
  if (batch.length >= 250 || bytes + size > 2000000) await queue();
  batch.push(value); bytes += size;
}
await queue(); await Promise.all(inFlight); if (failure) throw failure; db.close();
console.log(JSON.stringify({ run_id: run, received, complete: false, state: 'private_staging_uploaded', journal }));
