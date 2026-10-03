// Imports normalized CourtListener REST observations (live-normalized/*.jsonl) into the private
// corpus_ingest contract through the service_role-only wrapper public.corpus_registry_intake_v1.
// Resumable: a per-batch receipt (JSONL) records every acknowledged batch; re-running skips them.
// Verifies each row before sending: native id == data.id, https v4 API source URL, HTTP 200,
// record_sha256 == sha256(JSON.stringify(data)) for direct observations.
// Credentials come from --credentials (JSON with EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY); never printed.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
const pass = path.resolve(args.pass ?? '');
const run = args.run;
if (!args.pass || !/^[0-9a-f-]{36}$/.test(run ?? '')) throw new Error('--pass=<dir> and --run=<uuid> are required');
const types = (args.types ?? 'dockets,docket-entries,parties,attorneys,recap-documents').split(',');
const dry = args['dry-run'] === 'true';
const maxBytes = Number(args['max-bytes'] ?? 1_500_000);
const maxRows = Number(args['max-rows'] ?? 2000);
const receiptPath = path.resolve(args.receipt ?? path.join(pass, `import-receipt-${run}.jsonl`));
const credentialsFile = args.credentials ?? 'C:/Users/firas/.codex/private/legal-source-compass.preview.json';
const sha = x => createHash('sha256').update(x).digest('hex');
const out = path.join(pass, 'live-normalized');

const cfg = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
if (cfg.EXTERNAL_SUPABASE_URL !== 'https://xosqzzsnhxcyehcnirpa.supabase.co' || typeof cfg.EXTERNAL_SUPABASE_KEY !== 'string') throw new Error('Wrong server credentials project');
const token = cfg.EXTERNAL_SUPABASE_KEY;
const headers = { apikey: token, 'Content-Type': 'application/json', ...(token.startsWith('sb_') ? {} : { Authorization: `Bearer ${token}` }) };

async function* lines(file) {
  if (!fs.existsSync(file)) return;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let pending = null;
  for await (const l of rl) {
    if (!l.trim()) continue;
    if (pending !== null) yield JSON.parse(pending); // every line except the last must parse
    pending = l;
  }
  if (pending !== null) { try { yield JSON.parse(pending); } catch { /* the collector may be mid-write on the final line */ } }
}
function check(rec) {
  if (rec.source_system !== 'courtlistener' || rec.schema_version !== 'courtlistener-rest-v4.7/1') throw new Error('bad namespace/schema');
  if (String(rec.data?.id) !== rec.native_id) throw new Error('native id mismatch');
  const p = rec.provenance ?? {};
  if (!/^https:\/\/www\.courtlistener\.com\/api\/rest\/v4\//.test(p.source_url ?? '') || p.http_status !== 200) throw new Error('bad provenance');
  if (!/^[0-9a-f]{64}$/.test(p.record_sha256 ?? '') || !Number.isFinite(Date.parse(p.retrieved_at))) throw new Error('bad hash/time');
  if (!rec.provenance.nested_record && sha(JSON.stringify(rec.data)) !== p.record_sha256) throw new Error('record_sha256 mismatch');
  if (rec.provenance.nested_record && sha(JSON.stringify(rec.data)) !== p.record_sha256) throw new Error('nested record_sha256 mismatch');
}
function deriveDocs(entry) {
  const docs = [];
  for (const document of entry.data.recap_documents ?? []) {
    if (!Number.isInteger(document.id)) throw new Error('Missing native RECAP document ID');
    let docketId = entry.data.docket_id ?? null;
    if (docketId === null && typeof entry.data.docket === 'string') {
      const m = new URL(entry.data.docket).pathname.match(/^\/api\/rest\/v4\/dockets\/(\d+)\/$/);
      if (m) docketId = Number(m[1]);
    }
    const data = { ...document, docket_entry_id: entry.data.id, docket_id: docketId };
    docs.push({ schema_version: 'courtlistener-rest-v4.7/1', source_system: 'courtlistener', entity_type: 'recap-documents', native_id: String(document.id), data,
      provenance: { ...entry.provenance, source_entity_type: 'docket-entries', source_native_id: entry.native_id, nested_record: true,
        relationship_mapping: { docket_entry_id: 'native containing entry ID', docket_id: 'native docket resource URL or ID', source_docket_resource: entry.data.docket ?? null },
        record_sha256: sha(JSON.stringify(data)) } });
  }
  return docs;
}

const done = new Set();
if (fs.existsSync(receiptPath)) for (const l of fs.readFileSync(receiptPath, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.ack) done.add(r.batch_sha256); }
const receipt = fs.createWriteStream(receiptPath, { flags: 'a' });
const totals = { read: 0, sent: 0, skipped_batches: 0, batches: 0, new_versions: 0, new_observations: 0, entities_written: 0, held_rows: 0 };

async function post(rows) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try { r = await fetch(`${cfg.EXTERNAL_SUPABASE_URL}/rest/v1/rpc/corpus_registry_intake_v1`, { method: 'POST', headers, body: JSON.stringify({ p_run: run, p_mode: 'courtlistener-rest', p_rows: rows }), signal: AbortSignal.timeout(120000) }); }
    catch (e) { if (attempt >= 4) throw new Error('network failure'); await new Promise(res => setTimeout(res, 2000 * 2 ** attempt)); continue; }
    if (r.status === 429 || r.status >= 500) { if (attempt >= 4) throw new Error('HTTP ' + r.status); await new Promise(res => setTimeout(res, 3000 * 2 ** attempt)); continue; }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error('HTTP ' + r.status + ' ' + (body.code ?? '') + ' ' + String(body.message ?? '').slice(0, 160)); err.status = r.status; throw err; }
    return body;
  }
}
async function sendBatch(type, rows, bno) {
  const batchSha = sha(rows.map(r => `${r.entity_type}:${r.native_id}:${r.provenance.record_sha256}:${r.provenance.source_url}`).join('\n'));
  if (done.has(batchSha)) { totals.skipped_batches++; return; }
  if (dry) { totals.batches++; totals.sent += rows.length; return; }
  const attempt = async (subset) => {
    try {
      const res = await post(subset);
      totals.batches++; totals.sent += subset.length; totals.new_versions += res.new_versions ?? 0; totals.new_observations += res.new_observations ?? 0; totals.entities_written += res.entities_written ?? 0;
      return res;
    } catch (e) {
      if (subset.length === 1 || e.status === 401 || e.status === 403) {
        if (subset.length === 1) { totals.held_rows++; receipt.write(JSON.stringify({ type, held: true, native_id: subset[0].native_id, error: e.message, at: new Date().toISOString() }) + '\n'); return null; }
        throw e;
      }
      const mid = subset.length >> 1; const a = await attempt(subset.slice(0, mid)); const b = await attempt(subset.slice(mid)); return { split: true, a, b };
    }
  };
  const res = await attempt(rows);
  receipt.write(JSON.stringify({ type, batch_no: bno, rows: rows.length, first: rows[0].native_id, last: rows.at(-1).native_id, batch_sha256: batchSha, ack: true, result: res && !res.split ? res : { split: true }, at: new Date().toISOString() }) + '\n');
}

for (const type of types) {
  const file = path.join(out, `${type === 'recap-documents' ? 'docket-entries' : type}.jsonl`);
  let batch = [], bytes = 2, bno = 0; const seenKeys = new Set();
  const flush = async () => { if (batch.length) { await sendBatch(type, batch, ++bno); batch = []; bytes = 2; } };
  for await (const entry of lines(file)) {
    const recs = type === 'recap-documents' ? deriveDocs(entry) : [entry];
    for (const rec of recs) {
      totals.read++;
      const key = `${rec.entity_type}|${rec.native_id}|${rec.provenance.record_sha256}|${rec.provenance.source_url}`;
      if (seenKeys.has(key)) continue; seenKeys.add(key);
      check(rec);
      const size = Buffer.byteLength(JSON.stringify(rec)) + 1;
      if (size > maxBytes) { totals.held_rows++; receipt.write(JSON.stringify({ type, held: true, native_id: rec.native_id, error: 'row too large' }) + '\n'); continue; }
      if (batch.length && (bytes + size > maxBytes || batch.length >= maxRows)) await flush();
      batch.push(rec); bytes += size;
    }
  }
  await flush();
  console.log(JSON.stringify({ type, ...totals }));
}
receipt.end();
console.log(JSON.stringify({ event: 'import_done', run, pass, dry, ...totals }));
