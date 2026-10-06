// Owner-authorised (2026-10-06): after a Tier-1 master docket is followed on the DocketBird account, enumerate every document of the case
// (cursor-paginated /documents/search, which also works for dockets the whole-sheet endpoint cannot return), read each document's flags and
// signed PDF link (GET /documents/<id>), stage the sheet rows for versioned ingest, and queue ONLY documents the provider states are
// restricted === false and downloaded === 1 whose title carries no sealed/restricted/in camera/ex parte/redacted wording (the broad registry rule).
// Checkpointed, resumable, raw responses retained with sha256. Stops at the PDF count or on a response that reports a charge amount.
//   node docketbird-pull.mjs --work=<dir> --case=<id> [--stop-at-pdfs=2000] [--concurrency=6]
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DocketBird, Stop} from './clients.mjs';
import {atomicWriteJson, readJson, appendJsonl, sha256} from './lib.mjs';
import {dbCaseRow, dbDocumentRow} from './normalize.mjs';
import {amountsIn, chargeText} from './docketbird-follow.mjs';
import {excluded} from '../members-publish-rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = (cmd, args) => new Promise((resolve, reject) => { const p = spawn(cmd, args, {stdio: ['ignore', 'inherit', 'inherit']}); p.on('error', reject); p.on('exit', c => c === 0 ? resolve() : reject(new Error(`${path.basename(args[0])} exited ${c}`))); });
/** Workers stop taking items as soon as one fails (a Stop must end the whole run, not leave siblings running). */
const pool = async (items, n, fn) => { let i = 0; pool.stop = false; await Promise.all(Array.from({length: n}, async () => { while (i < items.length && !pool.stop) { try { await fn(items[i++]); } catch (e) { pool.stop = true; throw e; } } })); };

/** Eligibility for a PDF fetch: explicit provider flags plus the broad exclusion rule on the title. */
export function pdfEligible(doc) {
  return doc.restricted === false && doc.downloaded === 1 && typeof doc.docketbird_document_url === 'string' && !excluded(doc.title);
}

export async function enumerate({db, caseId, st, save}) {
  st.search ??= {cursor: null, ids: [], done: false};
  while (!st.search.done) {
    const params = {case_id: caseId, q: '*', size: '100', ...(st.search.cursor ? {cursor: st.search.cursor} : {})};
    const {data} = await db.get('/documents/search', params);
    for (const d of data.documents ?? []) st.search.ids.push(d.document_id);
    st.search.found = data.found ?? st.search.found; st.search.cursor = data.next_cursor ?? null; st.search.done = !st.search.cursor;
    await save();
  }
  st.search.ids = [...new Set(st.search.ids)];
  return st.search.ids;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const work = path.resolve(args.work), caseId = args.case, stopAt = Number(args['stop-at-pdfs'] ?? 2000), conc = Number(args.concurrency ?? 6);
  await fs.mkdir(work, {recursive: true});
  const ckFile = path.join(work, 'checkpoint.json');
  const ck = await readJson(ckFile, {schema: 'docketbird-pull/1', cases: {}, totals: {pdfs_cloud_verified: 0, documents_read: 0, charge_amounts_seen: []}});
  const st = ck.cases[caseId] ??= {details_done: {}, queued: [], uploaded: 0};
  const save = () => atomicWriteJson(ckFile, ck);
  const db = new DocketBird({cacheDir: path.join(work, 'raw'), maxRequests: Number(args['max-requests'] ?? 200000), minGapMs: Number(args['min-gap-ms'] ?? 350)});
  const stage = path.join(work, 'stage/docketbird-rest');
  const ledger = path.join(work, 'cost-ledger.jsonl');
  const noteCharges = async (where, text) => {
    for (const a of amountsIn(text)) if (!ck.totals.charge_amounts_seen.includes(a)) { ck.totals.charge_amounts_seen.push(a); await appendJsonl(ledger, {event: 'charge_amount_reported', where, amount: a, at: new Date().toISOString()}); await save(); throw new Stop('NEW_CHARGE_AMOUNT', a); }
  };
  try {
    if (!st.header) { const {data, receipt} = await db.get(`/cases/${caseId}`); await noteCharges('GET /cases', chargeText(data)); await appendJsonl(path.join(stage, 'case.jsonl'), dbCaseRow(data.case, receipt)); st.header = true; await save(); }
    const ids = await enumerate({db, caseId, st, save});
    console.log(JSON.stringify({case: caseId, found: st.search.found, enumerated: ids.length}));
    const todo = ids.filter(id => !st.details_done[id]);
    const batchSize = 200;
    for (let b = 0; b < todo.length && ck.totals.pdfs_cloud_verified < stopAt; b += batchSize) {
      const batch = todo.slice(b, b + batchSize), queue = [], rows = [];
      await pool(batch, conc, async id => {
        const {data, receipt, notFound} = await db.get(`/documents/${id}`);
        if (notFound) { st.details_done[id] = {not_found: true}; (st.not_found ??= []).push(id); return; }
        await noteCharges('GET /documents/{id}', chargeText(data));
        const doc = data.document;
        const row = dbDocumentRow(caseId, doc, receipt); rows.push(row);
        st.details_done[id] = {restricted: doc.restricted, downloaded: doc.downloaded, queued: false};
        if (pdfEligible(doc)) {
          const recordSha = sha256(JSON.stringify(doc));
          queue.push({schema_version: 'source-qualified-pdf-queue/1', provider: 'docketbird', native_document_id: doc.id, native_case_id: caseId, eligible: true, download_url: doc.docketbird_document_url, durable_url: null, expected_sha1: null, expected_bytes: null,
            provider_flags: {restricted: false, downloaded: 1}, selected_source_record_sha256: recordSha,
            origins: [{native_case_id: caseId, native_record_sha256: recordSha, native_record_hash_codec: 'json-stringify-of-docketbird-rest-document/1', source_tool: 'GET /documents/{id}', source_url: `${receipt.source_url}`.split('?')[0], source_response_sha256: receipt.source_sha256, retrieved_at: receipt.retrieved_at, parent_qualification: `followed case ${caseId}; document row with explicit restricted=false, downloaded=1`}]});
          st.details_done[id].queued = true;
        }
      });
      ck.totals.documents_read += rows.length;
      for (const r of rows) await appendJsonl(path.join(stage, 'docket-document.jsonl'), r);
      if (queue.length) {
        const qFile = path.join(work, 'queues', `${caseId.replace(/[^A-Za-z0-9]/g, '_')}-${String(b).padStart(6, '0')}.jsonl`);
        await fs.mkdir(path.dirname(qFile), {recursive: true});
        const text = queue.map(q => JSON.stringify(q)).join('\n') + '\n'; await fs.writeFile(qFile, text, {mode: 0o600});
        const cache = path.join(work, 'transfer');
        await run('node', [path.join(here, '../backfill-pdfs-to-supabase.mjs'), `--queue=${qFile}`, `--queue-sha256=${sha256(Buffer.from(text))}`, `--cache=${cache}`, '--max-files=1000', '--concurrency=6', '--source-delay-ms=50', '--execute']);
        await fs.rm(qFile);
        ck.totals.pdfs_cloud_verified += queue.length; st.uploaded += queue.length;
      }
      await save();
      console.log(JSON.stringify({case: caseId, read: ck.totals.documents_read, pdfs_cloud_verified: ck.totals.pdfs_cloud_verified, remaining: todo.length - b - batch.length}));
    }
    st.complete = Object.keys(st.details_done).length >= st.search.ids.length; await save();
    console.log(JSON.stringify({case: caseId, complete: st.complete, totals: ck.totals}));
  } catch (e) { if (e instanceof Stop) { await save(); console.log(JSON.stringify({stopped: e.message, totals: ck.totals})); process.exitCode = 3; } else throw e; }
}
