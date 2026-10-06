// Sends staged DocketBird REST rows through public.corpus_admin_gapfill_docketbird_v1 once an open run exists.
// Default is a dry run (validates and batches only). Resumable: acknowledged batch hashes are kept in a receipt file.
//   EXTERNAL_SUPABASE_URL=... EXTERNAL_SUPABASE_KEY=... node send-staged-docketbird.mjs --stage=<dir> --run=<uuid> [--apply]
import fs from 'node:fs/promises';
import path from 'node:path';
import {sha256, appendJsonl} from './lib.mjs';

export function batches(rows, maxRows = 500, maxBytes = 1_500_000) {
  const out = []; let cur = [], bytes = 2;
  for (const r of rows) {
    const n = Buffer.byteLength(JSON.stringify(r));
    if (cur.length && (cur.length >= maxRows || bytes + n > maxBytes)) { out.push(cur); cur = []; bytes = 2; }
    cur.push(r); bytes += n + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}
export const batchSha = rows => sha256(rows.map(r => `${r.entity_type}:${r.native_id}:${r.provenance.record_sha256}:${r.provenance.source_sha256}`).join('\n'));

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  if (!args.stage || !/^[0-9a-f-]{36}$/.test(args.run ?? '')) throw new Error('--stage=<dir> and --run=<uuid> are required');
  const key = process.env.EXTERNAL_SUPABASE_KEY ?? process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.EXTERNAL_SUPABASE_URL;
  if (args.apply && (url !== 'https://xosqzzsnhxcyehcnirpa.supabase.co' || !key)) throw new Error('Wrong or missing corpus credentials');
  const receipt = path.join(args.stage, `send-receipt-${args.run}.jsonl`);
  const done = new Set((await fs.readFile(receipt, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.ack).map(r => r.batch_sha256));
  const rows = [];
  for (const f of ['case.jsonl', 'docket-document.jsonl']) rows.push(...(await fs.readFile(path.join(args.stage, 'docketbird-rest', f), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l)));
  const totals = {rows: rows.length, batches: 0, skipped: 0, sent_rows: 0, new_versions: 0, new_observations: 0, entities_written: 0, apply: Boolean(args.apply)};
  for (const b of batches(rows)) {
    const id = batchSha(b);
    if (done.has(id)) { totals.skipped++; continue; }
    totals.batches++;
    if (!args.apply) continue;
    const r = await fetch(`${url}/rest/v1/rpc/corpus_admin_gapfill_docketbird_v1`, {method: 'POST', headers: {apikey: key, 'Content-Type': 'application/json'}, body: JSON.stringify({p_run: args.run, p_rows: b}), signal: AbortSignal.timeout(120000)});
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${body.code ?? ''} ${String(body.message ?? '').slice(0, 160)}`);
    totals.sent_rows += b.length; totals.new_versions += body.new_versions ?? 0; totals.new_observations += body.new_observations ?? 0; totals.entities_written += body.entities_written ?? 0;
    await appendJsonl(receipt, {batch_sha256: id, rows: b.length, ack: true, result: body, at: new Date().toISOString()});
  }
  console.log(JSON.stringify(totals));
}
