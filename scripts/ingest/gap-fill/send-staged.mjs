// Sends staged rows through the fixed intake wrappers once an open run exists:
//   --provider=bulk          public.corpus_admin_gapfill_bulk_v1(p_run,p_rows)  (CourtListener run)
//   --provider=docketbird   public.corpus_admin_gapfill_docketbird_v1(p_run,p_rows)
//   --provider=courtlistener public.corpus_registry_intake_v1(p_run,'courtlistener-rest',p_rows)
// Default is a dry run. Resumable: acknowledged batch hashes are kept in a receipt file; a re-send of identical rows
// is also a readback check (the wrapper rejects a same-hash version whose stored data differs, and reports 0 new versions).
//   EXTERNAL_SUPABASE_URL=... EXTERNAL_SUPABASE_KEY=... node send-staged.mjs --provider=<p> --stage=<dir> --run=<uuid> [--apply] [--verify]
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

/** Split nested RECAP docs out of an oversized docket-entry so each RPC payload stays under the registry bound. */
export function deriveRecapDocuments(entry) {
  const docs = [];
  for (const document of entry.data.recap_documents ?? []) {
    if (!Number.isInteger(document.id)) throw new Error(`Missing native RECAP document ID on entry ${entry.native_id}`);
    let docketId = entry.data.docket_id ?? null;
    if (docketId === null && typeof entry.data.docket === 'string') {
      const m = new URL(entry.data.docket).pathname.match(/^\/api\/rest\/v4\/dockets\/(\d+)\/$/);
      if (m) docketId = Number(m[1]);
    }
    const data = {...document, docket_entry_id: entry.data.id, docket_id: docketId};
    docs.push({
      schema_version: entry.schema_version, source_system: entry.source_system, entity_type: 'recap-documents', native_id: String(document.id), data,
      provenance: {
        ...entry.provenance, source_entity_type: 'docket-entries', source_native_id: entry.native_id, nested_record: true,
        relationship_mapping: {docket_entry_id: 'native containing entry ID', docket_id: 'native docket resource URL or ID', source_docket_resource: entry.data.docket ?? null},
        record_sha256: sha256(JSON.stringify(data)),
      },
    });
  }
  return docs;
}

function trimDocketEntry(entry) {
  const data = {...entry.data, recap_documents: []};
  return {
    ...entry, data,
    provenance: {...entry.provenance, nested_record: false, record_sha256: sha256(JSON.stringify(data))},
  };
}

export function expandCourtListenerRows(rows, maxRowBytes = 1_500_000) {
  const out = [];
  for (const row of rows) {
    if (row.entity_type !== 'docket-entries' || Buffer.byteLength(JSON.stringify(row)) <= maxRowBytes) {
      out.push(row);
      continue;
    }
    out.push(trimDocketEntry(row));
    out.push(...deriveRecapDocuments(row));
  }
  return out;
}

async function postIntake(url, key, rpc, extra, run, rows) {
  const r = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
    method: 'POST', headers: {apikey: key, 'Content-Type': 'application/json'},
    body: JSON.stringify({p_run: run, ...extra, p_rows: rows}), signal: AbortSignal.timeout(120000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} ${body.code ?? ''} ${String(body.message ?? '').slice(0, 160)}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

async function sendBatchResplit(url, key, rpc, extra, run, rows, totals) {
  const attempt = async subset => {
    try {
      return await postIntake(url, key, rpc, extra, run, subset);
    } catch (e) {
      if (subset.length <= 1 || e.status === 401 || e.status === 403) throw e;
      const mid = subset.length >> 1;
      const a = await attempt(subset.slice(0, mid));
      const b = await attempt(subset.slice(mid));
      return {
        new_versions: (a.new_versions ?? 0) + (b.new_versions ?? 0),
        new_observations: (a.new_observations ?? 0) + (b.new_observations ?? 0),
        entities_written: (a.entities_written ?? 0) + (b.entities_written ?? 0),
        split: true,
      };
    }
  };
  const body = await attempt(rows);
  totals.sent_rows += rows.length;
  totals.new_versions += body.new_versions ?? 0;
  totals.new_observations += body.new_observations ?? 0;
  totals.entities_written += body.entities_written ?? 0;
  return body;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  if (!args.stage || !/^[0-9a-f-]{36}$/.test(args.run ?? '')) throw new Error('--stage=<dir> and --run=<uuid> are required');
  const key = process.env.EXTERNAL_SUPABASE_KEY ?? process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.EXTERNAL_SUPABASE_URL;
  if (args.apply && (url !== 'https://xosqzzsnhxcyehcnirpa.supabase.co' || !key)) throw new Error('Wrong or missing corpus credentials');
  const provider = args.provider ?? 'docketbird';
  if (!['docketbird', 'courtlistener', 'bulk'].includes(provider)) throw new Error('--provider must be docketbird, courtlistener or bulk');
  const receipt = path.join(args.stage, `send-receipt-${args.run}.jsonl`);
  const done = new Set((await fs.readFile(receipt, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.ack).map(r => r.batch_sha256));
  const rows = [];
  const files = provider === 'bulk' ? ['stage-bulk/docket-bulk-match.jsonl', 'stage-bulk/fjc-idb-mdl-match.jsonl'] : provider === 'docketbird' ? ['docketbird-rest/case.jsonl', 'docketbird-rest/docket-document.jsonl'] : ['live-normalized/dockets.jsonl', 'live-normalized/parties.jsonl', 'live-normalized/docket-entries.jsonl'];
  for (const f of files) rows.push(...(await fs.readFile(path.join(args.stage, f), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l)));
  const maxRows = Number(args['max-rows'] ?? 200);
  const maxBytes = Number(args['max-bytes'] ?? 1_000_000);
  const intakeRows = provider === 'courtlistener' ? expandCourtListenerRows(rows, maxBytes) : rows;
  const [rpc, extra] = provider === 'bulk' ? ['corpus_admin_gapfill_bulk_v1', {}] : provider === 'docketbird' ? ['corpus_admin_gapfill_docketbird_v1', {}] : ['corpus_registry_intake_v1', {p_mode: 'courtlistener-rest'}];
  const totals = {provider, rows: rows.length, intake_rows: intakeRows.length, max_rows: maxRows, max_bytes: maxBytes, batches: 0, skipped: 0, sent_rows: 0, new_versions: 0, new_observations: 0, entities_written: 0, apply: Boolean(args.apply)};
  for (const b of batches(intakeRows, maxRows, maxBytes)) {
    const id = batchSha(b);
    if (done.has(id) && !args.verify) { totals.skipped++; continue; }
    totals.batches++;
    if (!args.apply) continue;
    const body = await sendBatchResplit(url, key, rpc, extra, args.run, b, totals);
    await appendJsonl(receipt, {provider, verify: Boolean(args.verify), batch_sha256: id, rows: b.length, ack: true, result: body, at: new Date().toISOString()});
  }
  console.log(JSON.stringify(totals));
}
