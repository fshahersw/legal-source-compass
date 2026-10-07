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
import {batches, expandCourtListenerRows} from './send-staged.mjs';
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

test('expandCourtListenerRows splits oversized docket-entries', () => {
  const fat = {
    schema_version: 'courtlistener-rest-v4.7/1', source_system: 'courtlistener', entity_type: 'docket-entries', native_id: '9',
    data: {id: 9, docket: 'https://www.courtlistener.com/api/rest/v4/dockets/1/', recap_documents: [{id: 42, plain_text: 'x'.repeat(2_000_000)}]},
    provenance: {record_sha256: 'a'.repeat(64), source_sha256: 'b'.repeat(64)},
  };
  const out = expandCourtListenerRows([fat], 100_000);
  assert.equal(out.length, 2);
  assert.equal(out[0].entity_type, 'docket-entries');
  assert.deepEqual(out[0].data.recap_documents, []);
  assert.equal(out[1].entity_type, 'recap-documents');
  assert.equal(out[1].native_id, '42');
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

import {decide, evidenceRow, fjcRows} from './build-bulk-evidence.mjs';

const bulk = (id, key, extra = {}) => ({id, docket_key: key, court_id: 'njd', docket_number: '2:18-cv-05195', date_filed: '2018-04-02', date_terminated: '2018-08-02', blocked: 'f', source_row_ordinal: 1, ...extra});

test('bulk decisions fill blanks only from a unique exact key, record conflicts, hold ambiguity and blocked dockets', () => {
  const reg = [
    {id: 'a', docket_key: 'njd:2:2018-cv-05195', court_id: 'njd', docket_number: '2:18-05195', filed: 'Not recorded', terminated: 'Not recorded', native_case_ids: []},
    {id: 'b', docket_key: 'njd:2:2018-cv-00002', court_id: 'njd', docket_number: '2:18-cv-00002', filed: '2019-03-07', terminated: 'Not recorded', native_case_ids: [{id: 'dbird:1'}]},
    {id: 'c', docket_key: 'njd:2:2018-cv-00003', court_id: 'njd', docket_number: '2:18-cv-00003', filed: 'Not recorded', terminated: 'Not recorded', native_case_ids: []},
    {id: 'd', docket_key: 'njd:2:2018-cv-00004', court_id: 'njd', docket_number: '2:18-cv-00004', filed: 'Not recorded', terminated: 'Not recorded', native_case_ids: []}];
  const matches = [bulk('1', 'njd:2:2018-cv-05195'), bulk('2', 'njd:2:2018-cv-00002'), bulk('3', 'njd:2:2018-cv-00003'), bulk('4', 'njd:2:2018-cv-00003'), bulk('5', 'njd:2:2018-cv-00004', {blocked: 't'})];
  const {stats, decisions, evidence} = decide(reg, matches);
  assert.equal(stats.filed_fill, 1); assert.equal(stats.native_id_fill, 2); assert.equal(stats.ambiguous_key, 1);
  assert.equal(stats.filed_conflict, 1); assert.equal(stats.blocked_unique_skipped, 1);
  assert.ok(decisions.every(d => d.applied === false || d.result));
  assert.ok(decisions.find(d => d.registry_id === 'b' && d.action === 'conflict' && d.field === 'filed'));
  assert.equal(decisions.filter(d => d.registry_id === 'c' && d.action === 'fill').length, 0);
  const row = evidenceRow(evidence.get('1'), {archive_sha256: 'f'.repeat(64), snapshot_date: '2026-09-30', archive_bytes: 1, rows_scanned: 2}, '2026-10-06T00:00:00Z');
  assert.equal(row.native_id, '1'); assert.equal(row.data.docket_id, '1'); assert.equal(row.provenance.record_sha256, sha256(canonicalIntegerJson(row.data)));
});

test('FJC MDL evidence rows are exact idb joins labelled historical, and blank MDL values are skipped', () => {
  const rows = fjcRows({archive_sha256: 'a'.repeat(64), rows_scanned: 1, found_rows: {'1': {mdl: '2789', origin: '1', date_filed: '2018-01-01'}, '2': {mdl: null, origin: '1', date_filed: '2018-01-01'}}}, {1: '99'}, 't');
  assert.equal(rows.length, 1); assert.equal(rows[0].data.join_rule, 'exact idb_data_id'); assert.match(rows[0].data.label, /historical/);
});

test('cl-entry fetches one native entry, stages it verbatim and records whether the source description is present', async () => {
  const work = await tmp();
  const cl = {requests: 0, get: async url => ({data: {id: 256350793, description: '', recap_documents: []}, receipt: {source_url: url, retrieved_at: '2026-10-06T00:00:00Z', http_status: 200, source_sha256: 'a'.repeat(64)}})};
  const r = await new Runner({work, cl, db: null}).init();
  const st = await r.runTask({kind: 'cl-entry', entry_id: 256350793});
  assert.equal(st.status, 'complete'); assert.equal(st.description_present, false);
  const line = JSON.parse((await fs.readFile(path.join(work, 'stage/live-normalized/docket-entries.jsonl'), 'utf8')).trim());
  assert.equal(line.native_id, '256350793'); assert.match(line.provenance.source_url, /docket-entries\/256350793\/$/);
});

test('CourtListener client waits for a closed minute or hour window instead of provoking a 429', async () => {
  const work = await tmp(); let usageCalls = 0; const waits = [];
  const mk = hourRemaining => ({current_usage: [{scope: 'user', rate: '1400/day', used: 0, limit: 1400, remaining: 1000, window_seconds: 86400, reset_at: 'x', blocked: false}, {scope: 'user', rate: '300/hour', used: 299, limit: 300, remaining: hourRemaining, window_seconds: 3600, reset_at: null, blocked: false}]});
  const fetchImpl = async url => {
    if (String(url).includes('api-usage')) { usageCalls++; return new Response(JSON.stringify(mk(usageCalls >= 3 ? 250 : 1)), {status: 200}); }
    return new Response(JSON.stringify({id: 1}), {status: 200});
  };
  const cl = new CourtListener({cacheDir: work, token: 't', fetchImpl, reserve: 5});
  cl.sleepFn = async ms => { waits.push(ms); };
  const out = await cl.get('https://www.courtlistener.com/api/rest/v4/dockets/1/');
  assert.equal(out.data.id, 1); assert.deepEqual(waits, [300000, 300000]); assert.equal(cl.requests, 1);
});

test('DocketBird client paces requests, backs off on 429 and retries instead of stopping', async () => {
  const work = await tmp(); const waits = []; let n = 0;
  const fetchImpl = async () => { n++; return n === 1 ? new Response('{"message":"Too Many Requests"}', {status: 429}) : new Response(JSON.stringify({status: 'success', data: {ok: n}}), {status: 200}); };
  const db = new DocketBird({cacheDir: work, key: 'K', fetchImpl, minGapMs: 100, sleepFn: async ms => { waits.push(ms); }});
  const r = await db.get('/cases/x-1:2024-cv-00001');
  assert.equal(r.data.ok, 2); assert.equal(db.rateLimited, 1); assert.ok(waits.length >= 1); assert.equal(db.stopped, null);
});

import {amountsIn, chargeText} from './docketbird-follow.mjs';
test('only explicit money in a provider message counts as a charge; filing titles are never scanned', () => {
  assert.deepEqual(amountsIn('Charges may apply. This follow costs $3.50 to unlock.'), ['$3.50']);
  assert.deepEqual(amountsIn('{"status":"success"}'), []);
  assert.deepEqual(amountsIn(chargeText({document: {title: 'Order re fees and costs 11/13, $5,000 sanction'}, message: 'ok'})), []);
  assert.deepEqual(amountsIn(chargeText({message: 'Balance charged 2.5 USD'})), ['2.5 USD']);
});

test('DocketBird "document not found" is a recorded miss, not a stop', async () => {
  const work = await tmp();
  const fetchImpl = async () => new Response('{"status": "error", "message": "document not found"}', {status: 400});
  const db = new DocketBird({cacheDir: work, key: 'K', fetchImpl});
  const r = await db.get('/documents/x-1:2024-cv-00001-00009-001');
  assert.equal(r.notFound, true); assert.equal(db.stopped, null);
});

test('cl-find queries the docket_number_core and classifies exact vs type-variant candidates locally', async () => {
  const work = await tmp(); const urls = [];
  const cl = {requests: 0, get: async url => { urls.push(String(url)); return {data: {results: [{id: 11, docket_number: '1:18-op-45090'}, {id: 12, docket_number: '2:18-cv-45090'}], next: null}, receipt: {source_url: url, retrieved_at: 't', http_status: 200, source_sha256: 'a'.repeat(64)}}; }};
  const r = await new Runner({work, cl, db: null}).init();
  const a = await r.runTask({kind: 'cl-find', court: 'ohnd', docket_number: '1:18-45090'});
  assert.match(urls[0], /docket_number_core=1845090/); assert.equal(a.resolution, 'unique_type_variant_candidate_not_accepted'); assert.deepEqual(a.candidate_native_ids, ['11']);
  const b = await r.runTask({kind: 'cl-find', court: 'ohnd', docket_number: '1:18-op-45090'});
  assert.equal(b.resolution, 'unique_exact_court_office_year_type_sequence');
});
