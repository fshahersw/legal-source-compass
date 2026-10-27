// Loads staged PDF text records into the private corpus through public.corpus_admin_register_pdf_texts_v1 (live writer; service role only).
// Input: the extractor's staging directory (records/<aa>/<sha256>.json.gz) in worklist order. The database is the second gate: the writer itself refuses any
// sha256 that has no OPEN association ('not_open_scope'), so a record for a held-only PDF is reported, never stored. Documents are sent in batches of at most
// 25 documents / 1.5 MB; a document with many or large pages is split into page chunks that repeat the (identical) header. Everything is resumable through
// load-receipts.jsonl (a record is re-sent only when its file changed, e.g. after OCR filled pending pages). Credentials come only from the environment
// (EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_SERVICE_ROLE_KEY, or EXTERNAL_SUPABASE_KEY); no page text, credential or URL query is ever written to a log.
// Imported on 2026-10-27 from the out-of-tree loader (wt-backfill scripts/ingest/pdf-text) that loaded the 2026-10-03/04 texts; only credential handling
// and the required --staging changed. Run (the lead only): node scripts/documents/pdf_text/pdf-text-load.mjs --staging <dir> --order <worklist.jsonl>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'xosqzzsnhxcyehcnirpa';
export const RPC = 'corpus_admin_register_pdf_texts_v1';
export const LIMITS = { maxDocs: 25, maxBytes: 1_500_000, maxPagesPerChunk: 400, maxChunkBytes: 900_000 };
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

export const recordPath = (staging, sha) => path.join(staging, 'records', sha.slice(0, 2), sha + '.json.gz');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Windows denies a rename/append while another process (the extractor replacing a record, a virus scanner, an operator reading a progress file) has the file
// open; retry briefly, and let the caller decide what a final failure means.
export function retrySync(fn, attempts = 20, delayMs = 250) {
  for (let i = 1; ; i++) {
    try { return fn(); } catch (error) {
      if (i >= attempts || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}
const size = value => Buffer.byteLength(JSON.stringify(value));

export function readRecord(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

// The exact payload of one document chunk (the loader strips provenance and staging-only fields).
export function payloadHeader(record) {
  return {
    sha256: record.sha256, status: record.status, page_count: record.page_count, ocr_pending_pages: record.ocr_pending_pages,
    engine_version: record.engine_version, extractor_version: record.extractor_version, text_sha256: record.text_sha256 ?? null,
    note: record.note ?? null, pages_meta: record.pages_meta, extracted_at: record.extracted_at,
  };
}

// Splits one record into payload documents whose page arrays respect the writer's 500 pages / our byte budget.
export function chunkRecord(record, limits = LIMITS) {
  const header = payloadHeader(record), headerBytes = size({ ...header, pages: [] });
  const chunks = [];
  let pages = [], bytes = headerBytes;
  for (const page of record.pages) {
    const pageBytes = size(page);
    if (pages.length && (pages.length >= limits.maxPagesPerChunk || bytes + pageBytes > limits.maxChunkBytes)) {
      chunks.push({ ...header, pages });
      pages = []; bytes = headerBytes;
    }
    pages.push(page); bytes += pageBytes;
  }
  chunks.push({ ...header, pages });
  return chunks;
}

// Greedy batches of chunks under the writer's 25-document and our byte limit; a chunk is never split further.
export function buildBatches(chunks, limits = LIMITS) {
  const batches = [];
  let current = [], bytes = 0;
  for (const chunk of chunks) {
    const b = size(chunk);
    if (current.length && (current.length >= limits.maxDocs || bytes + b > limits.maxBytes)) {
      batches.push(current);
      current = []; bytes = 0;
    }
    current.push(chunk); bytes += b;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function loadCredentials(env = process.env, project = PROJECT) {
  const url = String(env.EXTERNAL_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  if (url !== 'https://' + project + '.supabase.co') throw Error('WRONG_PROJECT');
  const key = String(env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? env.EXTERNAL_SUPABASE_KEY ?? '').trim();
  if (!key) throw Error('SERVER_KEY_MISSING');
  if (key.startsWith('ey')) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'));
    if (claims.role !== 'service_role' || claims.ref !== project) throw Error('WRONG_SERVER_ROLE');
  } else if (!key.startsWith('sb_secret_')) throw Error('SERVER_ROLE_REQUIRED');
  return { baseUrl: url, headers: { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + key }), 'Content-Type': 'application/json' } };
}

export async function callRpc({ baseUrl, headers, fn = RPC, body, fetchImpl = fetch, pause = sleep, attempts = 6 }) {
  let delay = 2000, last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(baseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(170000) });
      if (response.ok) return await response.json();
      const text = (await response.text()).slice(0, 300);
      const error = Error('RPC_HTTP_' + response.status + ':' + text.replace(/\s+/g, ' '));
      error.status = response.status; error.transient = TRANSIENT.has(response.status);
      if (!error.transient) throw error;
      last = error;
    } catch (error) {
      if (error.status && !error.transient) throw error;
      last = error;
    }
    await pause(delay);
    delay = Math.min(delay * 2, 60000);
  }
  throw last;
}

// Sends one batch; a failing multi-document batch is halved (a poison document is isolated instead of blocking the batch).
export async function sendBatch(batch, ctx) {
  try {
    const response = await callRpc({ ...ctx, body: { p_docs: batch } });
    return (response.results ?? []).map(r => ({ ...r }));
  } catch (error) {
    if (batch.length > 1) {
      const mid = batch.length >> 1;
      return [...await sendBatch(batch.slice(0, mid), ctx), ...await sendBatch(batch.slice(mid), ctx)];
    }
    return [{ sha256: batch[0].sha256, result: 'transport_error', reason: String(error.message).slice(0, 200) }];
  }
}

export function readReceipts(file) {
  const done = new Map();
  if (!fs.existsSync(file)) return done;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); done.set(r.sha256, r); } catch { /* torn last line */ }
  }
  return done;
}

// Every sha256 that has a staged record, in directory order: the tail of a pass, so records outside the named worklists (e.g. a document rewritten after OCR)
// are still loaded.
export function scanStaged(staging) {
  const root = path.join(staging, 'records'), out = [];
  if (!fs.existsSync(root)) return out;
  for (const shard of fs.readdirSync(root)) {
    const dir = path.join(root, shard);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) if (name.endsWith('.json.gz')) out.push(name.slice(0, -8));
  }
  return out;
}

const fileKey = file => { const s = fs.statSync(file); return s.size + ':' + Math.floor(s.mtimeMs); };

// One or more worklist files (comma-separated); the first occurrence of a sha256 decides its position. A missing file is skipped, so a watcher can name
// lists that do not exist yet.
export function readOrder(files) {
  const seen = new Set(), order = [];
  for (const file of String(files).split(',').map(f => f.trim()).filter(Boolean)) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const sha = JSON.parse(line).sha256;
      if (!seen.has(sha)) { seen.add(sha); order.push(sha); }
    }
  }
  return order;
}

// One pass over the ordered shas: loads every record that exists and is not already loaded in its current form.
export async function loadPass({ staging, order, ctx, receiptsFile, progress, maxDocs = Infinity, stopRequested = () => false, log = () => {}, concurrency = 2 }) {
  const receipts = readReceipts(receiptsFile);
  const pending = [];
  for (const sha of order) {
    const file = recordPath(staging, sha);
    if (!fs.existsSync(file)) continue;
    const key = fileKey(file), prior = receipts.get(sha);
    if (prior && prior.key === key && ['stored', 'not_open_scope', 'unknown_object'].includes(prior.result)) continue;
    pending.push({ sha, file, key });
    if (pending.length >= maxDocs) break;
  }
  const counts = progress.counts;
  const queue = pending.slice();
  const worker = async () => {
    const buffer = [];
    const flush = async () => {
      if (!buffer.length) return;
      const items = buffer.splice(0, buffer.length);
      const chunks = items.flatMap(i => i.chunks);
      const perSha = new Map(items.map(i => [i.sha, { item: i, results: [] }]));
      for (const batch of buildBatches(chunks)) {
        const results = await sendBatch(batch, ctx);
        for (const r of results) perSha.get(r.sha256)?.results.push(r);
      }
      for (const { item, results } of perSha.values()) {
        const bad = results.find(r => r.result !== 'stored') ?? (results.length < item.chunks.length ? { result: 'missing_result' } : null);
        const result = bad ? bad.result : 'stored';
        const pages = results.reduce((s, r) => s + (r.pages_written ?? 0), 0);
        const receipt = { sha256: item.sha, key: item.key, result, pages_written: pages, ...(bad?.reason ? { reason: bad.reason } : {}), ts: new Date().toISOString() };
        retrySync(() => fs.appendFileSync(receiptsFile, JSON.stringify(receipt) + '\n'));
        counts[result] = (counts[result] ?? 0) + 1;
        if (result === 'stored') { counts.pages += pages; counts.chars += item.record.chars; counts.docs += 1; }
        counts.attempted += 1;
      }
      progress.write();
    };
    let bytes = 0;
    while (queue.length && !stopRequested()) {
      const next = queue.shift();
      let record;
      try { record = readRecord(next.file); } catch (error) { counts.unreadable_record = (counts.unreadable_record ?? 0) + 1; log({ sha: next.sha.slice(0, 12), unreadable_record: error.message }); continue; }
      const chunks = chunkRecord(record);
      buffer.push({ sha: next.sha, key: next.key, record, chunks });
      bytes += chunks.reduce((s, c) => s + size(c), 0);
      if (buffer.length >= LIMITS.maxDocs || bytes >= LIMITS.maxBytes) { await flush(); bytes = 0; }
    }
    await flush();
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return pending.length;
}

export function createProgress(file) {
  const started = Date.now();
  const counts = { attempted: 0, docs: 0, pages: 0, chars: 0 };
  return {
    counts,
    write(extra = {}) {
      const minutes = Math.max((Date.now() - started) / 60000, 1e-6);
      const doc = { stage: 'load', updated_at: new Date().toISOString(), elapsed_s: Math.round(minutes * 60), ...counts, pages_per_min: Math.round(counts.pages / minutes), docs_per_min: Math.round(counts.docs / minutes), ...extra };
      // a progress snapshot is only a convenience: a locked file never stops the loader
      try { fs.writeFileSync(file + '.part', JSON.stringify(doc, null, 1)); retrySync(() => fs.renameSync(file + '.part', file), 6, 200); } catch { /* skipped */ }
    },
  };
}

export async function main(argv = process.argv.slice(2), { fetchImpl = fetch, pause = sleep } = {}) {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort: the loader never competes with the transfer runners at normal priority */ }
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); args[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  if (!args.staging || args.staging === true) throw Error('--staging <dir> required');
  const staging = path.resolve(String(args.staging));
  if (!args.order) throw Error('--order <worklist.jsonl[,more.jsonl]> required');
  const creds = loadCredentials(process.env);
  const ctx = { ...creds, fetchImpl, pause };
  const progress = createProgress(path.join(staging, 'progress-load.json'));
  const receiptsFile = path.join(staging, 'load-receipts.jsonl');
  const stopFile = path.join(staging, 'STOP-LOAD');
  const stopRequested = () => fs.existsSync(stopFile);
  const watchSeconds = Number(args['watch-seconds'] ?? 0), maxMinutes = Number(args['max-minutes'] ?? 0), started = Date.now();
  const log = o => console.log(JSON.stringify(o));
  log({ event: 'start', order_files: String(args.order).split(',').length, staging, watch_seconds: watchSeconds });
  for (;;) {
    const order = readOrder(String(args.order)); // re-read every pass: the worklists are refreshed while the loader runs
    const named = new Set(order);
    for (const sha of scanStaged(staging)) if (!named.has(sha)) order.push(sha);
    const n = await loadPass({ staging, order, ctx, receiptsFile, progress, maxDocs: Number(args['max-docs'] ?? Infinity), stopRequested, log, concurrency: Number(args.concurrency ?? 2) });
    progress.write({ last_pass_docs: n });
    log({ event: 'pass_done', docs_in_pass: n, ...progress.counts });
    if (!watchSeconds || stopRequested() || (maxMinutes && (Date.now() - started) / 60000 > maxMinutes) || args['max-docs']) break;
    await pause(watchSeconds * 1000);
  }
  progress.write({ finished: true });
  return 0;
}

// exitCode instead of process.exit(): on Windows an immediate exit while fetch timers are pending trips a libuv assertion (UV_HANDLE_CLOSING).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().then(code => { process.exitCode = code; }, error => { console.error(String(error.message ?? error)); process.exitCode = 1; });
