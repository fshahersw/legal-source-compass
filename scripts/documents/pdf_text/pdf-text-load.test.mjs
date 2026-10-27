import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { chunkRecord, buildBatches, payloadHeader, loadPass, createProgress, readReceipts, readOrder, scanStaged, recordPath, loadCredentials, callRpc, LIMITS } from './pdf-text-load.mjs';

const sha = label => createHash('sha256').update(label).digest('hex');
const record = (label, pages = 2, over = {}) => {
  const rows = Array.from({ length: pages }, (_, i) => ({ page: i + 1, text: 'text of ' + label + ' page ' + (i + 1), engine: 'pdf-text-layer' }));
  return {
    schema: 'pdf-text-record/1', sha256: sha(label), bytes: 123, status: 'complete', page_count: pages, ocr_pending_pages: 0, chars: rows.reduce((s, r) => s + r.text.length, 0), pages_with_text: pages,
    engine_version: 'pymupdf test', extractor_version: 'pdf-text/1', text_sha256: sha('t' + label), note: null, extracted_at: '2026-10-03T00:00:00Z',
    pages_meta: rows.map(r => ({ p: r.page, state: 'text', engine: 'pdf-text-layer', chars: r.text.length })), pages: rows, provenance: { source: 'local', timing_ms: {} }, ...over,
  };
};
const stage = records => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdftext-'));
  for (const r of records) {
    const file = recordPath(dir, r.sha256);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(r)));
  }
  return dir;
};
// A fake PostgREST: every document is 'stored' unless its sha256 is listed otherwise; records what it was sent.
const fakeRpc = (outcomes = {}, { failOnce = 0, poison = null } = {}) => {
  const calls = [];
  let failures = failOnce;
  const fetchImpl = async (url, init) => {
    assert.match(url, /\/rest\/v1\/rpc\/corpus_admin_register_pdf_texts_v1$/);
    const body = JSON.parse(init.body);
    calls.push(body.p_docs);
    if (failures > 0) { failures--; return { ok: false, status: 503, text: async () => 'upstream down' }; }
    if (poison && body.p_docs.some(d => d.sha256 === poison)) return { ok: false, status: 400, text: async () => '{"message":"bad"}' };
    const results = body.p_docs.map(d => ({ sha256: d.sha256, result: outcomes[d.sha256] ?? 'stored', pages_written: d.pages.length }));
    return { ok: true, status: 200, json: async () => ({ docs_stored: results.filter(r => r.result === 'stored').length, results }) };
  };
  return { fetchImpl, calls };
};
const ctxOf = fake => ({ baseUrl: 'https://example.invalid', headers: { apikey: 'x' }, fetchImpl: fake.fetchImpl, pause: async () => {} });
const setup = (records, fake, extra = {}) => {
  const staging = stage(records);
  const receiptsFile = path.join(staging, 'load-receipts.jsonl');
  const progress = createProgress(path.join(staging, 'progress-load.json'));
  const run = (order = records.map(r => r.sha256)) => loadPass({ staging, order, ctx: ctxOf(fake), receiptsFile, progress, concurrency: 1, ...extra });
  return { staging, receiptsFile, progress, run };
};

test('the payload carries exactly the writer fields and no provenance or byte counts', () => {
  const header = payloadHeader(record('a'));
  assert.deepEqual(Object.keys(header).sort(), ['engine_version', 'extracted_at', 'extractor_version', 'note', 'ocr_pending_pages', 'page_count', 'pages_meta', 'sha256', 'status', 'text_sha256']);
  assert.equal('provenance' in header, false);
  assert.equal('bytes' in header, false);
});

test('a document splits into page chunks of at most 400 pages and the header repeats on every chunk', () => {
  const chunks = chunkRecord(record('big', 950));
  assert.deepEqual(chunks.map(c => c.pages.length), [400, 400, 150]);
  assert.ok(chunks.every(c => c.sha256 === sha('big') && c.pages_meta.length === 950 && c.status === 'complete'));
  assert.deepEqual(chunks.flatMap(c => c.pages.map(p => p.page)), Array.from({ length: 950 }, (_, i) => i + 1));
});

test('a document with no text pages is one header-only chunk; huge pages split by bytes', () => {
  assert.deepEqual(chunkRecord(record('none', 0, { status: 'no_text' })).map(c => c.pages.length), [0]);
  const fat = record('fat', 3);
  fat.pages = fat.pages.map(p => ({ ...p, text: 'x'.repeat(500_000) }));
  assert.deepEqual(chunkRecord(fat).map(c => c.pages.length), [1, 1, 1]);
});

test('batches hold at most 25 documents and 1.5 MB', () => {
  const chunks = Array.from({ length: 60 }, (_, i) => payloadHeader(record('d' + i)));
  assert.deepEqual(buildBatches(chunks).map(b => b.length), [25, 25, 10]);
  const wide = Array.from({ length: 4 }, (_, i) => ({ ...payloadHeader(record('w' + i)), pages: [{ page: 1, text: 'y'.repeat(700_000), engine: 'pdf-text-layer' }] }));
  assert.deepEqual(buildBatches(wide).map(b => b.length), [2, 2]);
  assert.ok(buildBatches(wide).every(b => JSON.stringify(b).length <= LIMITS.maxBytes + 10));
});

test('records are sent in order, stored ones are receipted, and a second pass sends nothing', async () => {
  const records = [record('one'), record('two', 3), record('three', 1)];
  const fake = fakeRpc();
  const { run, receiptsFile, progress } = setup(records, fake);
  assert.equal(await run(), 3);
  assert.deepEqual(fake.calls.flat().map(d => d.sha256), records.map(r => r.sha256));
  const receipts = readReceipts(receiptsFile);
  assert.deepEqual([...receipts.values()].map(r => r.result), ['stored', 'stored', 'stored']);
  assert.equal(progress.counts.pages, 6);
  assert.equal(progress.counts.docs, 3);
  const before = fake.calls.length;
  assert.equal(await run(), 0);
  assert.equal(fake.calls.length, before);
});

test('not_open_scope is reported and final until the record changes; a rewritten record (OCR filled a pending page) is sent again', async () => {
  const held = record('held'), grown = record('grown', 1, { status: 'partial_ocr_pending', ocr_pending_pages: 1 });
  const fake = fakeRpc({ [held.sha256]: 'not_open_scope' });
  const { run, receiptsFile, staging, progress } = setup([held, grown], fake);
  await run();
  assert.equal(readReceipts(receiptsFile).get(held.sha256).result, 'not_open_scope');
  assert.equal(progress.counts.not_open_scope, 1);
  assert.equal(progress.counts.docs, 1);
  const before = fake.calls.flat().length;
  await run();
  assert.equal(fake.calls.flat().length, before);
  const done = { ...grown, status: 'complete', ocr_pending_pages: 0, pages: [...grown.pages, { page: 2, text: 'ocr text', engine: 'surya-ocr', ocr_confidence: 0.9 }] };
  const file = recordPath(staging, grown.sha256);
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(done)));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(await run(), 1);
  const resent = fake.calls.flat().filter(d => d.sha256 === grown.sha256).at(-1);
  assert.equal(resent.status, 'complete');
  assert.equal(resent.pages.length, 2);
});

test('missing records are skipped (not yet extracted), and a transient outage is retried', async () => {
  const records = [record('x1'), record('x2')];
  const fake = fakeRpc({}, { failOnce: 2 });
  const { run, receiptsFile } = setup(records, fake);
  assert.equal(await run([records[0].sha256, sha('never extracted'), records[1].sha256]), 2);
  assert.deepEqual([...readReceipts(receiptsFile).values()].map(r => r.result), ['stored', 'stored']);
});

test('a poison document is isolated by halving and does not block its batch', async () => {
  const records = [record('p1'), record('p2'), record('poison'), record('p4')];
  const fake = fakeRpc({}, { poison: sha('poison') });
  const { run, receiptsFile } = setup(records, fake);
  await run();
  const receipts = readReceipts(receiptsFile);
  assert.equal(receipts.get(sha('poison')).result, 'transport_error');
  assert.deepEqual(['p1', 'p2', 'p4'].map(l => receipts.get(sha(l)).result), ['stored', 'stored', 'stored']);
  // a transport_error is not final: the next pass retries it
  assert.equal(await run(), 1);
});

test('a response that omits a document is a failure, never a silent success', async () => {
  const records = [record('m1')];
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ docs_stored: 0, results: [] }) });
  const staging = stage(records);
  const receiptsFile = path.join(staging, 'load-receipts.jsonl');
  const progress = createProgress(path.join(staging, 'progress-load.json'));
  await loadPass({ staging, order: [records[0].sha256], ctx: { baseUrl: 'https://example.invalid', headers: {}, fetchImpl, pause: async () => {} }, receiptsFile, progress, concurrency: 1 });
  assert.equal(readReceipts(receiptsFile).get(records[0].sha256).result, 'missing_result');
});

test('a large document is sent as several chunks and receipted once with the summed page count', async () => {
  const big = record('chunked', 650);
  const fake = fakeRpc();
  const { run, receiptsFile } = setup([big], fake);
  await run();
  assert.equal(fake.calls.flat().length, 2);
  const receipt = readReceipts(receiptsFile).get(big.sha256);
  assert.equal(receipt.result, 'stored');
  assert.equal(receipt.pages_written, 650);
});

test('several worklists merge in order, the first position of a sha256 wins, and a missing list is skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-'));
  const a = path.join(dir, 'a.jsonl'), b = path.join(dir, 'b.jsonl');
  fs.writeFileSync(a, [sha('1'), sha('2')].map(s => JSON.stringify({ sha256: s })).join('\n') + '\n');
  fs.writeFileSync(b, [sha('2'), sha('3')].map(s => JSON.stringify({ sha256: s })).join('\n') + '\n');
  assert.deepEqual(readOrder(a + ',' + path.join(dir, 'missing.jsonl') + ',' + b), [sha('1'), sha('2'), sha('3')]);
  assert.deepEqual(readOrder(b + ',' + a), [sha('2'), sha('3'), sha('1')]);
});

test('scanStaged lists every staged record and nothing else', () => {
  const records = [record('s1'), record('s2')];
  const staging = stage(records);
  fs.writeFileSync(path.join(staging, 'records', 'README.txt'), 'x');
  assert.deepEqual(scanStaged(staging).sort(), records.map(r => r.sha256).sort());
  assert.deepEqual(scanStaged(path.join(staging, 'does-not-exist')), []);
});

test('progress and receipts never contain page text', async () => {
  const { run, receiptsFile, staging } = setup([record('secret words here')], fakeRpc());
  await run();
  const written = fs.readFileSync(receiptsFile, 'utf8') + fs.readFileSync(path.join(staging, 'progress-load.json'), 'utf8');
  assert.equal(written.includes('secret words'), false);
});

test('credentials come from the environment, must name the right project and a server key; callRpc retries only transient statuses', async () => {
  const URL = 'https://xosqzzsnhxcyehcnirpa.supabase.co';
  assert.throws(() => loadCredentials({ EXTERNAL_SUPABASE_URL: 'https://other.supabase.co', EXTERNAL_SUPABASE_KEY: 'sb_secret_x' }), /WRONG_PROJECT/);
  assert.throws(() => loadCredentials({}), /WRONG_PROJECT/);
  assert.throws(() => loadCredentials({ EXTERNAL_SUPABASE_URL: URL }), /SERVER_KEY_MISSING/);
  assert.throws(() => loadCredentials({ EXTERNAL_SUPABASE_URL: URL, EXTERNAL_SUPABASE_KEY: 'sb_publishable_x' }), /SERVER_ROLE_REQUIRED/);
  const anonJwt = 'ey.' + Buffer.from(JSON.stringify({ role: 'anon', ref: 'xosqzzsnhxcyehcnirpa' })).toString('base64url') + '.sig';
  assert.throws(() => loadCredentials({ EXTERNAL_SUPABASE_URL: URL, EXTERNAL_SUPABASE_KEY: anonJwt }), /WRONG_SERVER_ROLE/);
  const ok = loadCredentials({ EXTERNAL_SUPABASE_URL: URL + '/', EXTERNAL_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', EXTERNAL_SUPABASE_KEY: 'sb_publishable_x' });
  assert.equal(ok.baseUrl, URL);
  assert.equal(ok.headers.apikey, 'sb_secret_x'); // the service-role variable wins over the generic one
  assert.equal('Authorization' in ok.headers, false);
  let n = 0;
  const permanent = async () => { n++; return { ok: false, status: 400, text: async () => 'nope' }; };
  await assert.rejects(() => callRpc({ baseUrl: 'https://x', headers: {}, body: {}, fetchImpl: permanent, pause: async () => {} }), /RPC_HTTP_400/);
  assert.equal(n, 1);
});
