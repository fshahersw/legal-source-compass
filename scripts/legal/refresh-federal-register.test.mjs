// Offline end-to-end test of the legal atlas Federal Register refresh: acquisition (injected
// transport serving synthetic API pages), window normalization, staging and the dry-run packet.
// No network, credentials or database. Run: node --test scripts/legal/refresh-federal-register.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { acquireFederalRegister } from './acquire-federal-register.mjs';
import { prepareWindow } from './prepare-fr-staging.mjs';
import { refresh } from './refresh-federal-register.mjs';
import { FEDERAL_REGISTER_FIELDS } from '../../src/lib/legal/frRefresh.ts';

// Synthetic documents shaped like API rows; content is invented for the test and never stored.
const doc = (number, day, over = {}) => ({
  ...Object.fromEntries(FEDERAL_REGISTER_FIELDS.map(f => [f, null])),
  document_number: number, title: `Test document ${number}`, type: 'Proposed Rule', publication_date: day,
  agencies: [{ id: 1, slug: 'test-agency' }], cfr_references: [], regulation_id_numbers: [], docket_ids: [], dockets: [],
  html_url: `https://www.federalregister.gov/documents/${day.replaceAll('-', '/')}/${number}/test`, ...over,
});
const DOCS = [
  doc('2026-30001', '2026-10-05', { regulation_id_numbers: ['0910-AA01'], comments_close_on: '2026-12-07' }),
  doc('2026-30002', '2026-10-05', { type: 'Rule', regulation_id_numbers: ['0910-AA01', '7100 AG79'] }),
  doc('2026-30003', '2026-11-02', { type: 'Notice' }),
  doc('R1-2026-30004', '2026-11-02', { type: 'Notice' }),
];

function fakeApi({ docs = DOCS, perPage = 2 } = {}) {
  const calls = [];
  const fetchImpl = async (u) => {
    const url = new URL(u); calls.push(url.href);
    if (url.pathname === '/api/v1/agencies.json') return Response.json([{ id: 1, slug: 'test-agency', name: 'Test Agency', parent_id: null, url: 'https://www.federalregister.gov/agencies/test-agency' }]);
    const gte = url.searchParams.get('conditions[publication_date][gte]'); const lte = url.searchParams.get('conditions[publication_date][lte]');
    const page = Number(url.searchParams.get('page') ?? 1);
    const rows = docs.filter(d => d.publication_date >= gte && d.publication_date <= lte);
    if (!rows.length) return Response.json({ description: 'none', count: 0 });
    const slice = rows.slice((page - 1) * perPage, page * perPage);
    const next = page * perPage < rows.length ? (() => { const n = new URL(url); n.searchParams.set('page', String(page + 1)); return n.href; })() : undefined;
    return Response.json({ count: rows.length, results: slice, ...(next ? { next_page_url: next } : {}) });
  };
  return { fetchImpl, calls };
}
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fr-refresh-'));
const quiet = () => {};

test('acquires a window month by month, follows cursors and checks the publisher count', async () => {
  const dir = temp(); const api = fakeApi();
  const summary = await acquireFederalRegister({ destination: dir, from: '2026-10-03', through: '2026-11-02', fetchImpl: api.fetchImpl, minIntervalMs: 0, diskReserveBytes: 0, log: quiet });
  assert.equal(summary.rows, 4);
  const db = new DatabaseSync(path.join(dir, 'native.sqlite'), { readOnly: true });
  assert.deepEqual(db.prepare('select start_date,end_date,expected,actual from periods order by start_date').all().map(r => ({ ...r })),
    [{ start_date: '2026-10-03', end_date: '2026-10-31', expected: 2, actual: 2 }, { start_date: '2026-11-01', end_date: '2026-11-02', expected: 2, actual: 2 }]);
  const prov = JSON.parse(db.prepare("select provenance from publications where id='2026-30001'").get().provenance);
  assert.equal(prov.schema_version, 'federal-register-api-v1/round3');
  db.close();
  // A rerun reuses acquired periods and makes no new document requests.
  const before = api.calls.length;
  await acquireFederalRegister({ destination: dir, from: '2026-10-03', through: '2026-11-02', fetchImpl: api.fetchImpl, minIntervalMs: 0, diskReserveBytes: 0, log: quiet });
  assert.equal(api.calls.slice(before).filter(c => c.includes('documents.json')).length, 0);
});

test('an empty window (count 0, no results array) is acquired as zero rows', async () => {
  const dir = temp(); const api = fakeApi({ docs: [] });
  const summary = await acquireFederalRegister({ destination: dir, from: '2026-10-03', through: '2026-10-04', fetchImpl: api.fetchImpl, minIntervalMs: 0, diskReserveBytes: 0, log: quiet });
  assert.equal(summary.rows, 0);
});

test('a short page against the published count never marks a period complete', async () => {
  const dir = temp(); const api = fakeApi();
  const lying = async (u) => { const r = await api.fetchImpl(u); if (!String(u).includes('documents.json')) return r; const j = await r.json(); return Response.json({ ...j, count: (j.count ?? 0) + 1, next_page_url: undefined }); };
  await assert.rejects(acquireFederalRegister({ destination: dir, from: '2026-10-03', through: '2026-10-31', fetchImpl: lying, minIntervalMs: 0, diskReserveBytes: 0, log: quiet }), /published count/);
});

test('window preparation refuses a window that was not completely acquired, and skips held publications by URL', async () => {
  const dir = temp(); const api = fakeApi();
  await acquireFederalRegister({ destination: path.join(dir, 'native'), from: '2026-10-03', through: '2026-10-31', fetchImpl: api.fetchImpl, minIntervalMs: 0, diskReserveBytes: 0, log: quiet });
  assert.throws(() => prepareWindow(path.join(dir, 'native'), path.join(dir, 'a'), { from: '2026-10-03', through: '2026-11-02' }), /not completely acquired/);
  const config = prepareWindow(path.join(dir, 'native'), path.join(dir, 'b'), { from: '2026-10-03', through: '2026-10-31', held: [{ id: '2026-30001', source_url: DOCS[0].html_url }] });
  assert.deepEqual(config.window, { from: '2026-10-03', through: '2026-10-31', source_rows: 2, staged_rows: 1, held_skipped: 1, by_day: { '2026-10-05': 1 } });
  assert.deepEqual(config.support_files.map(f => path.basename(f)), ['agencies-native.jsonl']);
  assert.deepEqual(config.files.map(f => path.basename(f)), ['documents-2026-10-03_2026-10-31.jsonl']);
});

test('refresh stages a valid dry-run packet: exact RIN links, republication numbers, no database write', async () => {
  const out = temp(); const api = fakeApi();
  const acquire = (o) => acquireFederalRegister({ ...o, fetchImpl: api.fetchImpl, minIntervalMs: 0, diskReserveBytes: 0, log: quiet });
  const log = console.log; console.log = quiet;
  let run;
  try { run = await refresh({ out, from: '2026-10-03', through: '2026-11-02', acquire, now: '2026-11-02' }); } finally { console.log = log; }
  assert.deepEqual(run.inputs, { accepted: 4 });
  assert.deepEqual(run.records_by_type, { fr_document: 4, rule_proceeding: 2 });
  assert.deepEqual(run.edges_by_type, { finalizes: 1, proposes: 1 });
  assert.deepEqual(run.unlinked_regulation_id_numbers, [{ id: '2026-30002', regulation_id_numbers: ['7100 AG79'] }]);
  assert.deepEqual(run.rejected, []);
  assert.equal(run.written_to_database, false);
  assert.deepEqual(run.published, { first: '2026-10-05', last: '2026-11-02' });
  assert.equal(run.open_comment_periods_at_through.count, 1);
  assert.ok(fs.existsSync(path.join(out, 'packet-summary.json')));
  assert.ok(fs.existsSync(path.join(out, 'staging', 'reports', 'schema-report.json')));
});

test('refresh fails when a staged row would be rejected, unless review is requested', async () => {
  const docs = [doc('2026-30001', '2026-10-05'), doc('00-23477-Filed', '2026-10-05', { type: 'Notice' })];
  const run = async (allowRejected) => {
    const api = fakeApi({ docs }); const out = temp();
    const acquire = (o) => acquireFederalRegister({ ...o, fetchImpl: api.fetchImpl, minIntervalMs: 0, diskReserveBytes: 0, log: quiet });
    const log = console.log; console.log = quiet;
    try { return await refresh({ out, from: '2026-10-03', through: '2026-10-31', acquire, allowRejected, now: '2026-11-02' }); } finally { console.log = log; }
  };
  await assert.rejects(run(false), /would be rejected/);
  const kept = await run(true);
  assert.equal(kept.rejected.length, 1);
  assert.equal(kept.rejected[0].id, '00-23477-Filed');
});

test('live mode starts on the newest held day and never restages a held publication', async () => {
  const out = temp(); const api = fakeApi();
  const acquire = (o) => acquireFederalRegister({ ...o, fetchImpl: api.fetchImpl, minIntervalMs: 0, diskReserveBytes: 0, log: quiet });
  const calls = [];
  const readWindow = async (from) => {
    calls.push(from);
    return { latest_published: '2026-10-05', held: from ? [{ id: '2026-30001', source_url: DOCS[0].html_url, published: '2026-10-05' }, { id: '2026-30002', source_url: DOCS[1].html_url, published: '2026-10-05' }] : [] };
  };
  const log = console.log; console.log = quiet;
  let run;
  try { run = await refresh({ out, through: '2026-11-02', live: true, acquire, readWindow, now: '2026-11-02' }); } finally { console.log = log; }
  assert.deepEqual(calls, [null, '2026-10-05']);
  assert.equal(run.window.from, '2026-10-05');
  assert.equal(run.window.held_skipped, 2);
  assert.deepEqual(run.records_by_type, { fr_document: 2 });
  assert.deepEqual(run.published, { first: '2026-11-02', last: '2026-11-02' });
});

test('live mode skips publications production already staged but does not hold, and lists them for review', async () => {
  const api = fakeApi();
  const acquire = (o) => acquireFederalRegister({ ...o, fetchImpl: api.fetchImpl, minIntervalMs: 0, diskReserveBytes: 0, log: quiet });
  // First pass: learn the window's input keys exactly as staging computes them.
  const seen = [];
  const probe = async (from, keys) => { seen.push({ from, keys }); return { latest_published: '2026-10-05', held: [], staged: [] }; };
  const log = console.log; console.log = quiet;
  try {
    await refresh({ out: temp(), from: '2026-10-05', through: '2026-11-02', live: true, acquire, readWindow: probe, now: '2026-11-02' });
    assert.equal(seen.length, 1); assert.equal(seen[0].keys.length, 4);
    assert.ok(seen[0].keys.every(k => /^[0-9a-f]{64}$/.test(k)));
    // Second pass: production reports the first key as already staged (rejected there, so not held).
    const rejectedKey = seen[0].keys[0];
    const readWindow = async () => ({ latest_published: '2026-10-05', held: [], staged: [rejectedKey] });
    const run = await refresh({ out: temp(), from: '2026-10-05', through: '2026-11-02', live: true, acquire, readWindow, now: '2026-11-02' });
    assert.equal(run.window.already_staged_skipped, 1);
    assert.equal(run.window.held_skipped, 0);
    assert.equal(run.window.staged_rows, 3);
    assert.deepEqual(run.already_staged_not_held.map(s => [s.id, s.input_key]), [['2026-30001', rejectedKey]]);
  } finally { console.log = log; }
});

test('refresh refuses an --out that already holds a packet, and can restage an earlier acquisition offline', async () => {
  const out = temp(); const api = fakeApi();
  const acquire = (o) => acquireFederalRegister({ ...o, fetchImpl: api.fetchImpl, minIntervalMs: 0, diskReserveBytes: 0, log: quiet });
  const log = console.log; console.log = quiet;
  try {
    await refresh({ out, from: '2026-10-03', through: '2026-11-02', acquire, now: '2026-11-02' });
    await assert.rejects(refresh({ out, from: '2026-10-03', through: '2026-11-02', acquire, now: '2026-11-02' }), /new --out directory/);
    const requests = api.calls.length;
    const noNetwork = () => { throw Error('acquisition must not run with --native'); };
    const again = await refresh({ out: temp(), from: '2026-10-03', through: '2026-11-02', native: path.join(out, 'native'), acquire: noNetwork, now: '2026-11-02' });
    assert.equal(api.calls.length, requests);
    assert.deepEqual(again.records_by_type, { fr_document: 4, rule_proceeding: 2 });
  } finally { console.log = log; }
});
