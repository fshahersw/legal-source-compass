import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {canonicalIntegerJson, decideField, docketKey, docketKeyFromDocketBirdId, sanitizeUrl, isDisplayWithheld, sha256} from './lib.mjs';
import {dbDocumentRow, dbCaseRow, clRow} from './normalize.mjs';
import {stripContactFields, Runner, taskId} from './run-gap-fill.mjs';
import {gapTable} from './analyze-snapshots.mjs';
import {blankFilter} from './gap-analysis-live.mjs';
import {plan} from './plan-internal-crosswalk.mjs';
import {batches} from './send-staged-docketbird.mjs';
import {CourtListener, DocketBird, Stop} from './clients.mjs';

test('canonical json sorts keys, keeps unicode, rejects floats', () => {
  assert.equal(canonicalIntegerJson({b: 1, a: 'é', c: [null, true]}), '{"a":"é","b":1,"c":[null,true]}');
  assert.throws(() => canonicalIntegerJson({x: 1.5}));
});

test('decideField never overwrites a populated value', () => {
  assert.equal(decideField({field: 'f', existing: {value: null}, incoming: {value: 'x', source: 'courtlistener'}}).action, 'fill');
  assert.equal(decideField({field: 'f', existing: {value: ' A  b ', source: 'courtlistener'}, incoming: {value: 'a b', source: 'docketbird'}}).action, 'confirm');
  const c = decideField({field: 'f', existing: {value: '2020-01-01', source: 'courtlistener'}, incoming: {value: '2021-01-01', source: 'official_court'}});
  assert.equal(c.action, 'conflict'); assert.equal(c.proposed_supersede, true); assert.equal(c.applied, false);
  const lower = decideField({field: 'f', existing: {value: 'a', source: 'official_court'}, incoming: {value: 'b', source: 'courtlistener'}});
  assert.equal(lower.proposed_supersede, false);
  assert.equal(decideField({field: 'f', existing: {value: 'a', source: 'baseline'}, incoming: {value: 'b', source: 'courtlistener'}}).proposed_supersede, false);
  assert.equal(decideField({field: 'f', existing: {value: 'a'}, incoming: {value: ''}}).action, 'skip');
});

test('docket keys link only on exact court, office, year, type and sequence', () => {
  assert.equal(docketKey('njd', '2:24-md-03113'), 'njd:2:2024-md-03113');
  assert.equal(docketKeyFromDocketBirdId('njd-2:2024-md-03113'), 'njd:2:2024-md-03113');
  assert.equal(docketKey('cand', '3:16-03838'), null);
  assert.notEqual(docketKey('ilnd', '1:24-cv-06795'), docketKey('ohnd', '1:24-cv-06795'));
});

test('signed URL query is removed and never survives normalization', () => {
  const signed = 'https://b.s3.amazonaws.com/njd-2%3A2024-md-03113-00001.pdf?AWSAccessKeyId=AKIAXXXX&Signature=abc&Expires=1';
  assert.equal(sanitizeUrl(signed).removed, true);
  const row = dbDocumentRow('njd-2:2024-md-03113', {id: 'njd-2:2024-md-03113-00001', title: 'Order', filing_date: '2024-06-07', restricted: false, primary_docket_sheet_number: 1,
    pacer_document_url: 'https://ecf.njd.uscourts.gov/doc1/1', court_document_url: 'https://ecf.njd.uscourts.gov/doc1/1', downloaded: 1, docketbird_document_url: signed}, {source_url: 'https://api.docketbird.com/documents?case_id=x', retrieved_at: 't', http_status: 200, source_sha256: 'a'.repeat(64)});
  assert.equal(row.data.docketbird_object_name, 'njd-2:2024-md-03113-00001.pdf');
  assert.equal(row.provenance.source_url, 'https://api.docketbird.com/documents');
  assert.equal(row.provenance.pdf_downloaded, false);
  assert.doesNotMatch(JSON.stringify(row), /AWSAccessKeyId|Signature/);
  assert.equal(row.provenance.record_sha256, sha256(canonicalIntegerJson(row.data)));
});

test('sealed, restricted and unknown-seal text is flagged for display withholding', () => {
  assert.equal(isDisplayWithheld({restricted: true, text: 'x'}), true);
  assert.equal(isDisplayWithheld({restricted: null, text: 'x'}), true);
  assert.equal(isDisplayWithheld({restricted: false, text: 'MOTION to file under seal'}), true);
  assert.equal(isDisplayWithheld({restricted: false, text: 'Ex parte application'}), true);
  assert.equal(isDisplayWithheld({restricted: false, text: 'Case Management Order'}), false);
});

test('DocketBird case header omits the account client code', () => {
  const r = dbCaseRow({id: 'njd-2:2024-md-03113', title: 't', court_id: 'njd', date_filed: '2024-06-07', url: 'https://ecf.njd.uscourts.gov/x?1', pacer_case_id: '1', client_code: 'SECRET-MATTER'}, {source_url: 'https://api.docketbird.com/documents?case_id=x', retrieved_at: 't', http_status: 200, source_sha256: 'a'.repeat(64)});
  assert.doesNotMatch(JSON.stringify(r), /SECRET-MATTER/);
});

test('counsel contact fields are stripped from staged party rows', () => {
  const removed = new Set();
  const out = stripContactFields({name: 'A', attorneys: [{attorney_id: 1, role: 1, email: 'a@b.c', phone: '1', contact_raw: 'x'}]}, removed);
  assert.deepEqual(out, {name: 'A', attorneys: [{attorney_id: 1, role: 1}]});
  assert.deepEqual([...removed].sort(), ['contact_raw', 'email', 'phone']);
});

test('gapTable counts null, empty and whitespace; conditional scope shrinks the denominator', () => {
  const t = gapTable([{a: null, s: 'x'}, {a: ' ', s: 'x'}, {a: 'v', s: 'y'}], [{field: 'a'}, {field: 'a', label: 'a|x', when: r => r.s === 'x'}]);
  assert.deepEqual([t[0].missing, t[0].rows_in_scope, t[1].missing, t[1].rows_in_scope], [2, 3, 2, 2]);
});

test('live blank filter covers null, empty and the Not recorded placeholder', () => {
  assert.match(blankFilter('item->cells->>filed'), /is\.null.*\.eq\.,.*Not%20recorded/);
});

test('internal crosswalk fills only on a unique exact key and records conflicts instead of overwriting', () => {
  const cl = [{id: 'cl:1', cells: {native_id: '1', court_id: 'njd', docket_number: '2:17-cv-01', date_filed: '2017-01-02', date_terminated: null}},
    {id: 'cl:2', cells: {native_id: '2', court_id: 'njd', docket_number: '2:18-cv-05', date_filed: '2018-01-01'}}, {id: 'cl:3', cells: {native_id: '3', court_id: 'njd', docket_number: '2:18-cv-05', date_filed: '2018-02-01'}}];
  const sw = [{id: 'a', cells: {court_id: 'njd', docket_number: '2:17-cv-01', filed: 'Not recorded', terminated: 'Not recorded'}},
    {id: 'b', cells: {court_id: 'njd', docket_number: '2:18-cv-05', filed: 'Not recorded'}},
    {id: 'c', cells: {court_id: 'njd', docket_number: '2:17-cv-01', filed: '2019-09-09'}}];
  const r = plan(sw, cl);
  assert.equal(r.stats.filed_blank_with_exact_unique_native_match, 1);
  assert.equal(r.stats.filed_blank_ambiguous_native_key, 1);
  assert.equal(r.stats.populated_filed_conflict, 1);
  assert.equal(r.conflicts[0].applied, false);
});

test('batches respect row and byte bounds', () => {
  const rows = Array.from({length: 5}, (_, i) => ({entity_type: 'case', native_id: String(i), provenance: {record_sha256: 'a', source_sha256: 'b'}, data: {}}));
  assert.equal(batches(rows, 2).length, 3);
});

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'gapfill-'));

test('CourtListener client refuses to start when quota reaches the reserve and never leaks the token', async () => {
  const work = await tmp(); let calls = 0;
  const usage = {current_usage: [{scope: 'user', rate: '1400/day', used: 1380, limit: 1400, remaining: 20, window_seconds: 86400, reset_at: 'x', blocked: false}]};
  const fetchImpl = async url => { calls++; return new Response(JSON.stringify(usage), {status: 200}); };
  const cl = new CourtListener({cacheDir: work, token: 'SECRETTOKEN', fetchImpl, reserve: 25});
  await assert.rejects(cl.get('https://www.courtlistener.com/api/rest/v4/dockets/1/'), e => e instanceof Stop && /DAILY_RESERVE_REACHED/.test(e.message) && !/SECRETTOKEN/.test(e.message));
  assert.equal(calls, 1);
  await assert.rejects(cl.get('https://evil.example/api/rest/v4/dockets/1/'));
});

test('DocketBird client never follows an untracked case and refuses unlisted paths', async () => {
  const work = await tmp(); const seen = [];
  const fetchImpl = async url => { seen.push(String(url)); return new Response(JSON.stringify({status: 'error', message: 'Your company does not have access to this case. To access it, please follow it. Charges may apply.'}), {status: 403}); };
  const db = new DocketBird({cacheDir: work, key: 'K', fetchImpl});
  assert.equal((await db.get('/documents', {case_id: 'x-1:2024-cv-00001'})).untracked, true);
  await assert.rejects(db.get('/follow', {case_id: 'x'}), /REFUSED_PATH/);
  assert.equal(seen.length, 1);
});

test('runner resumes from its checkpoint without duplicating staged rows', async () => {
  const work = await tmp();
  const page = {results: [{id: 7, docket: 'https://www.courtlistener.com/api/rest/v4/dockets/9/'}], next: null};
  let n = 0;
  const cl = {requests: 0, get: async url => { n++; return {data: page, receipt: {source_url: url, retrieved_at: '2026-10-06T00:00:00Z', http_status: 200, source_sha256: 'a'.repeat(64)}}; }};
  const t = {kind: 'cl-entries', docket_id: 9, max_pages: 2};
  let r = await new Runner({work, cl, db: null}).init(); await r.runTask(t);
  r = await new Runner({work, cl, db: null}).init(); await r.runTask(t);
  assert.equal(n, 1);
  const lines = (await fs.readFile(path.join(work, 'stage/live-normalized/docket-entries.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(taskId({...t, priority: 1}), taskId(t));
  assert.doesNotMatch(await fs.readFile(path.join(work, 'checkpoint.json'), 'utf8'), /SECRET|token/i);
});

test('clRow keeps the verbatim API object and its native id', () => {
  const r = clRow('dockets', {id: 5, x: 1}, {source_url: 'https://www.courtlistener.com/api/rest/v4/dockets/5/', retrieved_at: 't', http_status: 200, source_sha256: 'a'.repeat(64)});
  assert.equal(r.native_id, '5'); assert.deepEqual(r.data, {id: 5, x: 1}); assert.equal(r.provenance.record_sha256, sha256(JSON.stringify({id: 5, x: 1})));
});
