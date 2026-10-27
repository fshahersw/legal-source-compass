/** Synthetic fixtures only. These examples are not source records and are never collected. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256, payloadHash, record, isoDate, sourceDate, allowedUrl, publicCaptureClient, retryDelay, uniqueRecords, htmlText } from './core.mjs';
import { parseCpsc, normalizeFederalRegister, collectFederalRegister, collectOpenFda, collectFda, normalizeEnforcement, fdaDetailData, SOURCES } from './adapters.mjs';
import { parseArgs, isDue, captureSource } from './run.mjs';
import { cloudClient, putVerified, validatePacket, landPacket, recoverRun } from './cloud.mjs';
import { collectNhtsa } from './nhtsa.mjs';
import { collectCpscRss, parseCpscRss, CPSC_RSS_URL } from './cpsc.mjs';

const options = { from: '2026-10-01', through: '2026-10-12', maxPages: 3, maxRecords: 500 };
const captured = (json, source_url = 'https://www.federalregister.gov/api/v1/documents.json', text = null) => { const bytes = Buffer.from(JSON.stringify(json ?? text)); const hash = sha256(bytes); return { json, text, bytes, receipt: { sha256: hash, byte_count: bytes.length, content_type: 'application/json', storage_key: `regulatory/${hash.slice(0, 2)}/${hash}.raw`, source_url, retrieved_at: '2026-10-12T12:00:00Z', http_status: 200 } }; };
const fr = (id = '2026-12345') => ({ document_number: id, title: 'SYNTHETIC TEST NOTICE', type: 'Notice', publication_date: '2026-10-09', agencies: [], html_url: `https://www.federalregister.gov/documents/2026/10/09/${id}/synthetic`, correction_of: [], abstract: 'Synthetic test evidence.' });
function sequence(values) { let at = 0; return { capture: async () => { assert.ok(at < values.length, 'unexpected extra request'); const value = values[at++]; if (value instanceof Error) throw value; return value; }, count: () => at }; }
async function temporary(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'regulatory-test-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }

test('strict flags never interpret explicit false as write authorization', () => {
  assert.throws(() => parseArgs(['land', '--output=private/test', '--execute=false']), /BOOLEAN_FLAG/);
  assert.throws(() => parseArgs(['daily', '--output=private/test', '--force=false']), /BOOLEAN_FLAG/);
  assert.equal(parseArgs(['land', '--output=private/test']).execute, undefined);
  assert.equal(parseArgs(['land', '--output=private/test', '--execute']).execute, true);
});
test('source allowlist excludes deleted datasets and output never enters public application paths', () => {
  assert.throws(() => parseArgs(['capture', '--output=public/data', '--sources=cpsc_recalls']), /PRIVATE_OUTPUT/);
  assert.throws(() => parseArgs(['capture', '--output=private/test', '--sources=cpsc_injury_data']), /SOURCE_NOT_CONFIGURED/);
  assert.equal(Object.hasOwn(SOURCES, 'open_us_law'), false);
});
test('calendar date validation rejects normalized impossible dates', () => { assert.throws(() => isoDate('2026-02-30')); assert.equal(sourceDate('20261009'), '2026-10-09'); });
test('source URLs reject lookalike hosts, credentials, http and fragments', () => {
  for (const u of ['http://api.fda.gov/x', 'https://api.fda.gov.evil.test/x', 'https://secret@api.fda.gov/x', 'https://api.fda.gov/x#fragment']) assert.throws(() => allowedUrl(u, ['api.fda.gov']));
});
test('canonical content hashes ignore retrieval time and pagination pointer, preserving corrections', () => {
  const d = normalizeFederalRegister(fr()); const a = record(d, captured({}), '/results/0'); const b = record(d, { ...captured({}), receipt: { ...captured({}).receipt, retrieved_at: '2026-10-12T13:00:00Z' } }, '/results/99');
  assert.equal(a.payload_sha256, b.payload_sha256); assert.notEqual(record({ ...d, title: 'Corrected synthetic title' }, captured({}), '/results/0').payload_sha256, a.payload_sha256);
});
test('FR native correction prefixes and explicit correction links remain literal', () => {
  const r = normalizeFederalRegister({ ...fr('C1-2026-12345'), correction_of: [{ document_number: '2026-12345' }] }); assert.equal(r.native_id, 'C1-2026-12345'); assert.deepEqual(r.correction_of, ['2026-12345']);
});
test('duplicate native IDs and conflicting versions never inflate counts', () => {
  const r = record(normalizeFederalRegister(fr()), captured({}), '/results/0'); assert.throws(() => uniqueRecords([r, r]), /DUPLICATE_SOURCE_RECORD/); assert.throws(() => uniqueRecords([r, { ...r, payload_sha256: 'different' }]), /CONFLICTING_SOURCE_RECORD/);
});
test('CPSC HTTP200 error sentinel is a failure, not a recall or zero result', () => {
  assert.throws(() => parseCpsc([{ RecallID: 0, Title: 'Error retrieving Recalls: provider failed' }], captured([]), options), /CPSC_API_ERROR/);
  assert.throws(() => parseCpsc({ error: 'blocked' }, captured({}), options), /CPSC_PAGE_INVALID/);
});
test('CPSC rejects records outside the requested publication-change window', () => {
  assert.throws(() => parseCpsc([{ RecallID: 10, RecallNumber: '00001', Title: 'Synthetic', Description: 'Test', LastPublishDate: '2025-10-01', RecallDate: '2025-09-01', URL: 'https://www.cpsc.gov/Recalls/2025/synthetic' }], captured([]), options), /SOURCE_WINDOW/);
});
test('FR partial page, count drift and caps prevent complete runs', async () => {
  await assert.rejects(collectFederalRegister(sequence([captured({ count: 2, results: [fr()] })]), '', options), /SOURCE_PAGE_TRUNCATED/);
  await assert.rejects(collectFederalRegister(sequence([captured({ count: 501, results: [] })]), '', options), /SOURCE_RECORD_CAP/);
  await assert.rejects(collectFederalRegister(sequence([captured({ count: 1, results: [fr()] }), captured({ count: 2, results: [fr()] })]), '', options), /SOURCE_CHANGED_DURING_RUN/);
});
test('FR repeated count/content proof yields complete declared window', async () => {
  const c = captured({ count: 1, results: [fr()] }); const result = await collectFederalRegister(sequence([c, c]), '', options); assert.equal(result.expected, 1); assert.equal(result.scope.full_history, false);
});
test('FDA enforcement dates and lifecycle qualification remain distinct', () => {
  const d = normalizeEnforcement({ recall_number: 'D-TEST', event_id: '10', recalling_firm: 'Synthetic', product_description: 'Synthetic product', reason_for_recall: 'Synthetic reason', report_date: '20261009', recall_initiation_date: '20260801', status: 'Ongoing', openfda: { arbitrary: 'not copied' } }, 'drug');
  assert.equal(d.published_on, '2026-10-09'); assert.equal(d.fields.recall_initiation_date, '2026-08-01'); assert.match(d.fields.qualification, /not for current public alerts/); assert.equal(d.fields.publisher_record.openfda, undefined);
});
test('oversized device lot lists are shortened with a recorded cut; ordinary records are untouched', () => {
  const base = { recall_number: 'Z-TEST', event_id: '11', recalling_firm: 'Synthetic', product_description: 'Synthetic device', reason_for_recall: 'Synthetic reason', report_date: '20261009', code_info: 'LOT-1, LOT-2' };
  const small = normalizeEnforcement({ ...base, more_code_info: 'LOT-3' }, 'device');
  assert.equal(small.fields.shortened_publisher_fields, undefined); assert.equal(small.fields.publisher_record.more_code_info, 'LOT-3');
  const lots = Array.from({ length: 60000 }, (_, i) => `SN${i}`).join(', ');
  const big = normalizeEnforcement({ ...base, more_code_info: lots }, 'device');
  assert.deepEqual(big.fields.shortened_publisher_fields, [{ field: 'more_code_info', kept_chars: 20000, published_chars: lots.length }]);
  assert.equal(big.fields.publisher_record.more_code_info, lots.slice(0, 20000)); assert.equal(big.fields.publisher_record.code_info, 'LOT-1, LOT-2');
  assert.doesNotThrow(() => record(big, captured({}), 'results/0'));
});
test('only exact repeated openFDA no-match JSON can establish an empty window', async () => {
  const empty = captured({ error: { code: 'NOT_FOUND', message: 'No matches found!' } }); empty.receipt.http_status = 404;
  assert.equal((await collectOpenFda(sequence([empty, empty]), 'openfda_enforcement_drug', options)).expected, 0);
  const wrong = captured({ error: { code: 'NOT_FOUND', message: 'Unknown API endpoint' } }); wrong.receipt.http_status = 404;
  await assert.rejects(collectOpenFda(sequence([wrong]), 'openfda_enforcement_drug', options), /OPENFDA_ERROR_RESPONSE/);
});
test('unnumbered enforcement rows stay raw and explicitly withheld, without invented product IDs', async () => {
  const base = { recall_number: 'D-TEST', event_id: '10', product_description: 'Synthetic product', reason_for_recall: 'Synthetic reason', report_date: '20261009' };
  const c = captured({ meta: { last_updated: '2026-10-09', results: { total: 2 } }, results: [base, { ...base, recall_number: '', event_id: '11' }] });
  const result = await collectOpenFda(sequence([c, c]), 'openfda_enforcement_drug', options); assert.equal(result.expected, 1); assert.equal(result.scope.publisher_record_count, 2); assert.equal(result.scope.excluded_record_count, 1); assert.equal(result.scope.withheld_records[0].event_id, '11');
});
test('public client rejects 403 HTML, 200 HTML at JSON endpoint and redirects', async (t) => {
  const directory = await temporary(t);
  for (const response of [new Response('<html>blocked</html>', { status: 403 }), new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }), new Response('', { status: 302, headers: { location: 'https://evil.test/' } })]) {
    let calls = 0; const client = publicCaptureClient({ directory, hosts: ['api.fda.gov'], fetchImpl: async (_u, init) => { calls++; assert.equal(init.redirect, 'manual'); return response; }, sleep: async () => {} });
    await assert.rejects(client.capture('https://api.fda.gov/test')); assert.equal(calls, 1); assert.equal(client.captures.length, 0);
  }
});
test('bounded source body rejects oversize content and does not save a partial object', async (t) => {
  const directory = await temporary(t); const client = publicCaptureClient({ directory, hosts: ['api.fda.gov'], maxBytes: 10, fetchImpl: async () => new Response('{"too_long":true}', { headers: { 'content-type': 'application/json' } }), sleep: async () => {} }); await assert.rejects(client.capture('https://api.fda.gov/test'), /SOURCE_BODY_TOO_LARGE/); assert.equal(client.captures.length, 0);
});
test('raw bytes are immutable and identical rechecks share exact capture binding', async (t) => {
  const directory = await temporary(t); const raw = '{ "synthetic": true }\r\n'; const client = publicCaptureClient({ directory, hosts: ['api.fda.gov'], fetchImpl: async () => new Response(raw, { headers: { 'content-type': 'application/json' } }), sleep: async () => {} }); const a = await client.capture('https://api.fda.gov/test'); const b = await client.capture('https://api.fda.gov/test'); assert.deepEqual(a.receipt, b.receipt); assert.equal(client.captures.length, 1); assert.equal(await fs.readFile(path.join(directory, 'objects', sha256(raw) + '.raw'), 'utf8'), raw);
});
test('Retry-After numeric/date honored; long cooldown defers instead of hammering', () => { assert.equal(retryDelay('12', 0), 12000); assert.equal(retryDelay('Mon, 12 Oct 2026 12:00:20 GMT', 0, Date.parse('2026-10-12T12:00:00Z')), 20000); assert.throws(() => retryDelay('120', 0), /DEFERRED/); });
test('failed JSON parsing retains raw evidence but never becomes successful empty packet', async (t) => {
  const output = await temporary(t); const packet = await captureSource('federal_register', { ...options, output, mode: 'initial' }, { fetchImpl: async () => new Response('{bad', { headers: { 'content-type': 'application/json' } }), sleep: async () => {} }); assert.equal(packet.status, 'failed'); assert.equal(packet.error_code, 'SOURCE_JSON_INVALID'); assert.equal(packet.expected_count, null); assert.equal(packet.captures.length, 1);
});
test('due schedule uses completed time, never a failed attempt as successful freshness', () => { const now = Date.parse('2026-10-12T12:00:00Z'); assert.equal(isDue('fda_warning_letters', { sources: [{ id: 'fda_warning_letters', latestCompletedAt: null, latestAttemptAt: new Date(now).toISOString() }] }, now), true); assert.equal(isDue('fda_warning_letters', { sources: [{ id: 'fda_warning_letters', latestCompletedAt: new Date(now - 3600000).toISOString() }] }, now), false); });
test('six-hour source completed at 00:25 is due at the next 06:23 UTC cron slot', () => {
  const overview = { sources: [{ id: 'fda_recall_notices', latestCompletedAt: '2026-10-12T00:25:00Z' }] };
  assert.equal(isDue('fda_recall_notices', overview, Date.parse('2026-10-12T06:23:00Z')), true);
  assert.equal(isDue('fda_recall_notices', overview, Date.parse('2026-10-12T06:00:00Z')), true);
});
test('daily source completed at 00:25 is due at next-day 00:23 UTC', () => {
  const overview = { sources: [{ id: 'fda_warning_letters', latestCompletedAt: '2026-10-12T00:25:00Z' }] };
  assert.equal(isDue('fda_warning_letters', overview, Date.parse('2026-10-13T00:23:00Z')), true);
});
test('completed sources remain not due inside the same UTC cadence bucket', () => {
  for (const [source, now] of [['cpsc_recalls', '2026-10-12T05:59:59.999Z'], ['fda_warning_letters', '2026-10-12T23:59:59.999Z']]) {
    // The explicit offset represents 00:25 UTC and must not shift cadence to local time.
    const overview = { sources: [{ id: source, latestCompletedAt: '2026-10-11T19:25:00-05:00' }] };
    assert.equal(isDue(source, overview, Date.parse(now)), false);
  }
});
test('invalid completion freshness remains due instead of suppressing collection indefinitely', () => {
  const now = Date.parse('2026-10-12T06:23:00Z');
  for (const latestCompletedAt of ['not-a-timestamp', '', null]) {
    assert.equal(isDue('cpsc_recalls', { sources: [{ id: 'cpsc_recalls', latestCompletedAt }] }, now), true);
  }
  assert.equal(isDue('cpsc_recalls', { sources: [] }, now), true);
});
test('cloud credentials restricted to service role on exact corpus host', () => { assert.throws(() => cloudClient({ EXTERNAL_SUPABASE_URL: 'https://evil.test', EXTERNAL_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' }), /CREDENTIALS/); assert.throws(() => cloudClient({ EXTERNAL_SUPABASE_URL: 'https://xosqzzsnhxcyehcnirpa.supabase.co', EXTERNAL_SUPABASE_SERVICE_ROLE_KEY: 'anon' }), /SERVICE_ROLE/); });
test('storage creation is journaled before failed readback and never upserts', async (t) => {
  const directory = await temporary(t); const bytes = Buffer.from('synthetic source'); const hash = sha256(bytes); const c = { sha256: hash, byte_count: bytes.length, storage_key: `regulatory/${hash.slice(0, 2)}/${hash}.raw`, content_type: 'text/plain' }; const journal = path.join(directory, 'objects.jsonl'); let calls = 0;
  const cloud = { request: async (method) => { calls++; if (calls === 1) return { status: 404 }; if (calls === 2) { assert.equal(method, 'POST'); return { status: 200 }; } assert.match(await fs.readFile(journal, 'utf8'), /"created":true,"verified":false/); return { status: 200, bytes: Buffer.from('wrong') }; } };
  await assert.rejects(putVerified(cloud, c, bytes, journal), /STORAGE_HASH_READBACK/); assert.equal(calls, 3);
});
test('missing-object response distinguished from denied access', async () => {
  const env = { EXTERNAL_SUPABASE_URL: 'https://xosqzzsnhxcyehcnirpa.supabase.co', EXTERNAL_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic' }; const route = '/storage/v1/object/corpus-originals/regulatory/ab/test.raw';
  const missing = cloudClient(env, async () => new Response(JSON.stringify({ statusCode: '404', error: 'not_found' }), { status: 400 }), async () => {}); assert.equal((await missing.request('GET', route, { accepted: [404] })).status, 404);
  const denied = cloudClient(env, async () => new Response('denied', { status: 403 }), async () => {}); await assert.rejects(denied.request('GET', route, { accepted: [404] }), /CORPUS_HTTP_403/);
});
test('packet capture binding and payload hash are independently checked', () => {
  const c = captured({}); const row = record(normalizeFederalRegister(fr()), c, '/results/0'); const p = { schema_version: 'regulatory-packet/1', status: 'completed', expected_count: 1, rows: [row], captures: [c.receipt] }; validatePacket(p); assert.throws(() => validatePacket({ ...p, captures: [] }), /PACKET_CAPTURE_UNBOUND/); assert.throws(() => validatePacket({ ...p, rows: [{ ...row, data: { ...row.data, title: 'tampered' } }] }), /PACKET_PAYLOAD_HASH/);
});
test('completed run replay binds exact packet hash, not just scope and row count', async () => {
  const { packet, c, row } = recoveryFixture();
  const expected = payloadHash(packet); const cloud = { request: async () => ({ bytes: Buffer.from('{"id":"corpus-originals","public":false}') }), rpc: async (name) => { assert.equal(name, 'corpus_regulatory_run_v1'); return { id: packet.run_id, source: packet.source_id, windowFrom: packet.window_from, windowTo: packet.window_to, expectedCount: 1, scope: { ...packet.scope, packet_sha256: expected }, status: 'completed' }; } };
  assert.equal((await landPacket({ packet, cloud, directory: 'unused' })).resumed_finalized, true);
  const different = { ...packet, rows: [record({ ...row.data, title: 'changed but same count' }, c, '/results/0')] }; await assert.rejects(landPacket({ packet: different, cloud, directory: 'unused' }), /RUN_PACKET_HASH_MISMATCH/);
});

function recoveryFixture() {
  const c = captured({ results: [fr()] }); const row = record(normalizeFederalRegister(fr()), c, '/results/0');
  const packet = { schema_version: 'regulatory-packet/1', run_id: '10000000-0000-4000-8000-000000000001', source_id: 'federal_register', window_from: options.from, window_to: options.through, scope: { mode: 'initial' }, status: 'completed', error_code: null, expected_count: 1, rows: [row], captures: [c.receipt] };
  return { packet, c, row };
}
async function writeFixture(directory, fixture) {
  await fs.mkdir(path.join(directory, 'objects'), { recursive: true });
  await fs.writeFile(path.join(directory, 'objects', `${fixture.c.receipt.sha256}.raw`), fixture.c.bytes);
  await fs.writeFile(path.join(directory, 'packet.json'), JSON.stringify(fixture.packet, null, 2) + '\n');
}
function recoveryCloud() {
  const objects = new Map(); let run = null; let kill = true; const calls = [];
  return { objects, calls, getRun: () => run, setRun: (value) => { run = value; }, resume: () => { kill = false; },
    async request(method, route, input = {}) {
      calls.push({ method, route });
      if (route === '/storage/v1/bucket/corpus-originals') return { bytes: Buffer.from('{"id":"corpus-originals","public":false}') };
      const key = route.replace('/storage/v1/object/corpus-originals/', '');
      if (method === 'POST') { assert.equal(objects.has(key), false, 'never overwrite an object'); objects.set(key, Buffer.from(input.bytes)); return { status: 200 }; }
      return objects.has(key) ? { status: 200, bytes: objects.get(key) } : { status: 404, bytes: null };
    },
    async rpc(name, args) {
      calls.push({ name });
      if (name === 'corpus_regulatory_run_v1') return run;
      if (name === 'corpus_regulatory_open_run_v1') {
        if (run) assert.deepEqual(args.p_scope, run.scope, 'existing scope never changes');
        else {
          assert.ok(objects.has(args.p_scope.packet_storage_key), 'packet durable before DB lease');
          const saved = JSON.parse(objects.get(args.p_scope.packet_storage_key));
          for (const capture of saved.captures) assert.ok(objects.has(capture.storage_key), 'all raw bytes durable before DB lease');
          run = { id: args.p_run, source: args.p_source, windowFrom: args.p_window_from, windowTo: args.p_window_to, expectedCount: args.p_expected_count, scope: args.p_scope, status: 'running', observedCount: 0 };
        }
        return { status: run.status };
      }
      if (name === 'corpus_regulatory_capture_v1') return { received: args.p_captures.length };
      if (name === 'corpus_regulatory_intake_v1') { if (kill) throw new Error('simulated hard kill after open'); run.observedCount = args.p_rows.length; return { observed_count: run.observedCount }; }
      if (name === 'corpus_regulatory_finish_run_v1') { run.status = args.p_status; return { status: run.status, observed_count: args.p_observed_count }; }
      throw new Error('unexpected RPC');
    },
  };
}
test('hard kill after opening recovers exact private packet and every raw object in a fresh directory', async (t) => {
  const root = await temporary(t); const directory = path.join(root, 'original'); const fixture = recoveryFixture(); await writeFixture(directory, fixture);
  const cloud = recoveryCloud(); await assert.rejects(landPacket({ packet: fixture.packet, directory, cloud }), /simulated hard kill/);
  assert.equal(cloud.getRun().status, 'running'); assert.equal(cloud.objects.size, 2);
  const originalBytes = await fs.readFile(path.join(directory, 'packet.json')); assert.equal(cloud.getRun().scope.packet_file_sha256, sha256(originalBytes));
  cloud.resume(); const output = path.join(root, 'recovered'); const receipt = await recoverRun({ runId: fixture.packet.run_id, output, cloud });
  assert.equal(receipt.landing.status, 'completed'); assert.equal(receipt.recovered_objects, 1);
  assert.deepEqual(await fs.readFile(path.join(output, fixture.packet.source_id, 'packet.json')), originalBytes);
  assert.deepEqual(await fs.readFile(path.join(output, fixture.packet.source_id, 'objects', `${fixture.c.receipt.sha256}.raw`)), fixture.c.bytes);
  assert.equal(cloud.calls.filter((c) => c.method === 'POST').length, 2, 'recovery reuses immutable objects');
});
test('recovery rejects traversal locators, wrong packet hashes and wrong run identity before local writes', async (t) => {
  const root = await temporary(t); const directory = path.join(root, 'original'); const fixture = recoveryFixture(); await writeFixture(directory, fixture);
  const cloud = recoveryCloud(); await assert.rejects(landPacket({ packet: fixture.packet, directory, cloud }), /simulated hard kill/); const valid = structuredClone(cloud.getRun());
  for (const [change, code] of [[{ scope: { ...valid.scope, packet_storage_key: '../outside' } }, /LOCATOR/], [{ source: 'cpsc_recalls' }, /IDENTITY/]]) {
    cloud.setRun({ ...valid, ...change }); const output = path.join(root, `blocked-${code.source}`);
    await assert.rejects(recoverRun({ runId: fixture.packet.run_id, output, cloud }), code); await assert.rejects(fs.access(output));
  }
  cloud.setRun(valid); cloud.objects.set(valid.scope.packet_storage_key, Buffer.from('{}')); const output = path.join(root, 'bad-packet');
  await assert.rejects(recoverRun({ runId: fixture.packet.run_id, output, cloud }), /RECOVERY_PACKET_HASH_MISMATCH/); await assert.rejects(fs.access(output));
});
test('recovery never overwrites a conflicting local packet and detects corrupted retained raw bytes', async (t) => {
  const root = await temporary(t); const directory = path.join(root, 'original'); const fixture = recoveryFixture(); await writeFixture(directory, fixture);
  const cloud = recoveryCloud(); await assert.rejects(landPacket({ packet: fixture.packet, directory, cloud }), /simulated hard kill/); cloud.resume();
  const output = path.join(root, 'recovered'); await fs.mkdir(path.join(output, fixture.packet.source_id), { recursive: true });
  await fs.writeFile(path.join(output, fixture.packet.source_id, 'packet.json'), 'preserve local content');
  await assert.rejects(recoverRun({ runId: fixture.packet.run_id, output, cloud }), /LOCAL_OBJECT_COLLISION/);
  assert.equal(await fs.readFile(path.join(output, fixture.packet.source_id, 'packet.json'), 'utf8'), 'preserve local content');
  cloud.objects.set(fixture.c.receipt.storage_key, Buffer.from('corrupt'));
  await assert.rejects(recoverRun({ runId: fixture.packet.run_id, output: path.join(root, 'raw-bad'), cloud }), /RECOVERY_RAW_HASH_MISMATCH/);
  assert.equal(cloud.getRun().status, 'running');
});
test('legacy running scope remains unchanged and legacy recovery clearly requires its local packet', async (t) => {
  const root = await temporary(t); const fixture = recoveryFixture(); await writeFixture(root, fixture); const cloud = recoveryCloud(); cloud.resume();
  const legacyScope = { ...fixture.packet.scope, packet_sha256: payloadHash(fixture.packet) };
  cloud.setRun({ id: fixture.packet.run_id, source: fixture.packet.source_id, windowFrom: fixture.packet.window_from, windowTo: fixture.packet.window_to, expectedCount: 1, scope: legacyScope, status: 'running' });
  await assert.rejects(recoverRun({ runId: fixture.packet.run_id, output: path.join(root, 'recovery'), cloud }), /RUN_RECOVERY_LOCATOR_MISSING/);
  assert.equal((await landPacket({ packet: fixture.packet, directory: root, cloud })).status, 'completed'); assert.deepEqual(cloud.getRun().scope, legacyScope);
});
test('recovery CLI requires one exact run and forbids changing its source/window or false execute values', () => {
  const args = ['recover', '--output=private/test', '--run-id=10000000-0000-4000-8000-000000000001'];
  assert.equal(parseArgs([...args, '--execute']).command, 'recover');
  assert.throws(() => parseArgs([...args, '--from=2026-10-01']), /RECOVERY_SCOPE_IMMUTABLE/);
  assert.throws(() => parseArgs([...args, '--execute=false']), /BOOLEAN_FLAG/);
  assert.throws(() => parseArgs(['recover', '--output=private/test', '--run-id=../bad']), /RUN_ID_INVALID/);
});
test('NHTSA same-width dictionary reorder is held before ZIP download', async () => {
  const dictionary = captured(null); dictionary.bytes = Buffer.from('2 RECORD_ID\n1 CAMPNO\n29 PARK_OUTSIDE'); dictionary.receipt.sha256 = sha256(dictionary.bytes); const client = sequence([dictionary]); await assert.rejects(collectNhtsa(client, 'nhtsa_recalls', options), /NHTSA_DICTIONARY_CHANGED/); assert.equal(client.count(), 1);
});
test('source text conversion preserves numeric entities and discards script text', () => { assert.equal(htmlText('<p>A &#039;quote&#039; &amp; B</p><script>attack()</script>'), "A 'quote' & B"); });

function fdaIndex() { return `<script type="application/json" data-drupal-selector="drupal-settings-json">${JSON.stringify({ datatables: { test: { serverSide: true, deferLoading: 4, aoColumnHeaders: Array(8).fill({}), ajax: { url: '/datatables/views/ajax', type: 'GET', data: { view_name: 'recall_solr_index' } } } } })}</script>`; }
const fdaCells = (name, date) => [date, `<a href="/safety/recalls-market-withdrawals-safety-alerts/${name}">${name}</a>`, 'Synthetic product', 'Synthetic category', 'Synthetic reason', 'Synthetic firm', '', ''];
function detail(name) { return `<h1>${name}</h1><article id="main-content"><p>${'Synthetic test source evidence. '.repeat(8)}</p></article><script data-drupal-selector="drupal-settings-json">{"path":{"currentPath":"node/${name === 'synthetic-a' ? '1' : '2'}"}}</script>`; }
test('FDA verifies full selected set twice despite tie reorder and irrelevant historical total drift', async () => {
  const a = fdaCells('synthetic-a', '10/09/2026'); const b = fdaCells('synthetic-b', '10/09/2026'); const old = fdaCells('synthetic-old', '09/01/2026'); const older = fdaCells('synthetic-older', '08/01/2026');
  const client = sequence([captured(null, 'https://www.fda.gov/index', fdaIndex()), captured({ recordsTotal: 3, recordsFiltered: 3, data: [a, b, old] }), captured({ recordsTotal: 4, recordsFiltered: 4, data: [b, a, old, older] }), captured(null, 'https://www.fda.gov/a', detail('synthetic-a')), captured(null, 'https://www.fda.gov/b', detail('synthetic-b'))]);
  const r = await collectFda(client, 'fda_recall_notices', options); assert.equal(r.rows.length, 2); assert.equal(r.scope.publisher_total_discrepancy, true);
});
test('FDA selected material change fails before fetching or projecting detail records', async () => {
  const a = fdaCells('synthetic-a', '10/09/2026'); const changed = [...a]; changed[4] = 'Changed synthetic reason'; const client = sequence([captured(null, '', fdaIndex()), captured({ recordsTotal: 1, recordsFiltered: 1, data: [a] }), captured({ recordsTotal: 1, recordsFiltered: 1, data: [changed] })]); await assert.rejects(collectFda(client, 'fda_recall_notices', options), /SOURCE_CHANGED_DURING_RUN/); assert.equal(client.count(), 3);
});
test('FDA detail must provide native Drupal node and substantive publisher article', () => { assert.throws(() => fdaDetailData('<h1>Error</h1>', { cells: [], url: 'https://www.fda.gov/a', date: '2026-10-09' }, 'fda_recall_notices'), /FDA_SETTINGS_MISSING|FDA_DETAIL_SCHEMA_CHANGED/); });

const rssFixture = (title = 'SYNTHETIC RECALL', date = 'October 08, 2026') => Buffer.from(`<rss version="2.0"><channel><title>Recall List</title><item><title>${title}</title><link>https://www.cpsc.gov/Recalls/2026/Synthetic</link><description>&lt;p&gt;Synthetic hazard &amp;amp; qualification.&lt;/p&gt;</description><pubDate>${date}</pubDate><guid>https://www.cpsc.gov/_00000000-0000-4000-8000-000000000001</guid></item></channel></rss>`);
const rssCapture = (bytes = rssFixture()) => ({ ...captured(null, CPSC_RSS_URL), bytes });
test('CPSC RSS uses literal publisher GUID with no inferred API identity or window completeness', async () => {
  const client = sequence([rssCapture(), rssCapture()]); const result = await collectCpscRss(client, 'cpsc_recalls', options);
  assert.equal(result.rows[0].data.native_id, 'rss:https://www.cpsc.gov/_00000000-0000-4000-8000-000000000001');
  assert.equal(result.rows[0].data.fields.description, 'Synthetic hazard & qualification.');
  assert.equal(result.scope.date_window_complete, false); assert.equal(result.scope.feed_item_count, 1);
  assert.equal(result.rows[0].data.source_updated_on, null); assert.equal(result.rows[0].record_pointer, '/rss/channel/item[1]');
});
test('CPSC RSS changed content, malformed XML and caps fail; older feed remains bounded zero', async () => {
  await assert.rejects(collectCpscRss(sequence([rssCapture(), rssCapture(rssFixture('CHANGED'))]), 'cpsc_recalls', options), /SOURCE_CHANGED_DURING_RUN/);
  assert.throws(() => parseCpscRss(rssCapture(Buffer.from('<html>error</html>')), options), /CPSC_RSS_INVALID/);
  assert.throws(() => parseCpscRss(rssCapture(), { ...options, maxRecords: 0 }), /SOURCE_RECORD_CAP/);
  const result = await collectCpscRss(sequence([rssCapture(), rssCapture()]), 'cpsc_recalls', { ...options, from: '2026-10-09' });
  assert.equal(result.expected, 0); assert.equal(result.scope.feed_item_count, 1); assert.equal(result.scope.date_window_complete, false);
});
