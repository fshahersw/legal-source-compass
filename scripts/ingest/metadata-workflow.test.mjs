import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { runSettledWorkers, nativeObservationKey, sourceDocketAllowsRelations, verifiedNativeDocketHeader,
  docketHeaderState, rememberDocketHeader, fetchFreshDocketHeader, DOCKET_HEADER_MAX_AGE_MS } from './metadata-workflow.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
function docketHeader({ id = '123', retrieved_at = '2026-10-05T11:00:00.000Z', blocked = false,
  date_blocked = null, data: dataChanges = {}, provenance: provenanceChanges = {} } = {}) {
  const data = { id: Number(id), resource_uri: `https://www.courtlistener.com/api/rest/v4/dockets/${id}/`,
    blocked, date_blocked, ...dataChanges };
  const provenance = { source_url: data.resource_uri, retrieved_at, http_status: 200,
    source_sha256: 'a'.repeat(64), schema_version: 'courtlistener-rest-v4.7/1', ...provenanceChanges };
  provenance.record_sha256 = sha256(JSON.stringify(data));
  return { schema_version: 'courtlistener-rest-v4.7/1', source_system: 'courtlistener',
    entity_type: 'dockets', native_id: String(id), data, provenance };
}

test('a failed worker cannot finish the pool while another worker still writes', async () => {
  let release, finished = false, laterWrite = false;
  const blocked = new Promise(resolve => { release = resolve; });
  const work = runSettledWorkers([
    async () => { throw new Error('Transport timeout'); },
    async () => { await blocked; laterWrite = true; },
  ], { concurrency: 2 }).catch(error => { finished = true; return error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  assert.ok(await work instanceof AggregateError);
  assert.equal(laterWrite, true);
});

test('a global publisher stop prevents pending work after active workers settle', async () => {
  let stop = null, called = 0;
  await assert.rejects(runSettledWorkers([
    async () => { called++; stop = 'PUBLISHER_STOP 429'; },
    async () => { called++; },
  ], { concurrency: 1, shouldStop: () => stop }), /PUBLISHER_STOP 429/);
  assert.equal(called, 1);
});

test('native versions and query scopes retain separate observation identities', () => {
  const r = { source_system: 'courtlistener', entity_type: 'parties', native_id: '123',
    provenance: { record_sha256: 'a'.repeat(64), source_url: 'https://www.courtlistener.com/api/rest/v4/parties/?docket=1' } };
  const secondScope = { ...r, provenance: { ...r.provenance, source_url: 'https://www.courtlistener.com/api/rest/v4/parties/?docket=2' } };
  const newVersion = { ...r, provenance: { ...r.provenance, record_sha256: 'b'.repeat(64) } };
  assert.equal(new Set([r, r, secondScope, newVersion].map(nativeObservationKey)).size, 3);
});

test('relation acquisition requires an explicitly unblocked native docket header', () => {
  assert.equal(sourceDocketAllowsRelations({ blocked: false, date_blocked: null }), true);
  for (const docket of [null, {}, { blocked: true }, { blocked: 'false' }, { blocked: 0 },
    { blocked: false, date_blocked: '2026-10-02' }]) {
    assert.equal(sourceDocketAllowsRelations(docket), false);
  }
});

test('header support cannot substitute an identity, source host or mutated payload', () => {
  const data={id:123,resource_uri:'https://www.courtlistener.com/api/rest/v4/dockets/123/',blocked:false,date_blocked:null};
  const record={source_system:'courtlistener',entity_type:'dockets',native_id:'123',schema_version:'courtlistener-rest-v4.7/1',data,
    provenance:{source_url:data.resource_uri,source_sha256:'a'.repeat(64),record_sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      retrieved_at:'2026-10-02T10:00:00.000Z',http_status:200,schema_version:'courtlistener-rest-v4.7/1'}};
  assert.equal(verifiedNativeDocketHeader(record),data);
  for(const altered of [
    {...record,native_id:'124'},
    {...record,data:{...data,resource_uri:'https://www.courtlistener.com/api/rest/v4/dockets/124/'}},
    {...record,provenance:{...record.provenance,source_url:'https://example.com/api/rest/v4/dockets/123/'}},
    {...record,provenance:{...record.provenance,source_url:'https://www.courtlistener.com/api/rest/v4/dockets/124/'}},
    {...record,data:{...data,blocked:true}},
    {...record,provenance:{...record.provenance,http_status:403}},
  ])assert.throws(()=>verifiedNativeDocketHeader(altered),/Invalid native docket/);
});

test('docket header freshness includes the exact 24-hour boundary and rejects future age', () => {
  const now = Date.parse('2026-10-05T12:00:00.000Z');
  assert.equal(docketHeaderState(docketHeader({ retrieved_at: new Date(now - 1).toISOString() }), now), 'current');
  assert.equal(docketHeaderState(docketHeader({ retrieved_at: new Date(now - DOCKET_HEADER_MAX_AGE_MS).toISOString() }), now), 'current');
  assert.equal(docketHeaderState(docketHeader({ retrieved_at: new Date(now - DOCKET_HEADER_MAX_AGE_MS - 1).toISOString() }), now), 'stale');
  assert.equal(docketHeaderState(docketHeader({ retrieved_at: new Date(now + 1).toISOString() }), now), 'stale');
});

test('stale blocked and unknown-flag headers remain held regardless of age', () => {
  const now = Date.parse('2026-10-05T12:00:00.000Z');
  const old = new Date(now - 10 * DOCKET_HEADER_MAX_AGE_MS).toISOString();
  assert.equal(docketHeaderState(docketHeader({ retrieved_at: old, blocked: true }), now), 'held');
  assert.equal(docketHeaderState(docketHeader({ retrieved_at: old, data: { blocked: undefined } }), now), 'held');
  assert.equal(docketHeaderState(docketHeader({ retrieved_at: old, blocked: false, date_blocked: '2026-10-04' }), now), 'held');
});

test('remembering headers selects newest retrieval independent of input order', () => {
  const older = docketHeader({ retrieved_at: '2026-10-05T10:00:00.000Z' });
  const newer = docketHeader({ retrieved_at: '2026-10-05T11:00:00.000Z', data: { docket_number: '2:26-cv-00001' } });
  const first = new Map(), second = new Map();
  rememberDocketHeader(first, older, Date.parse('2026-10-05T12:00:00.000Z'));
  rememberDocketHeader(first, newer, Date.parse('2026-10-05T12:00:00.000Z'));
  rememberDocketHeader(second, newer, Date.parse('2026-10-05T12:00:00.000Z'));
  rememberDocketHeader(second, older, Date.parse('2026-10-05T12:00:00.000Z'));
  assert.equal(first.get('123').provenance.retrieved_at, newer.provenance.retrieved_at);
  assert.equal(second.get('123').provenance.retrieved_at, newer.provenance.retrieved_at);
});

test('same-time header ties conservatively retain a hold in either input order', () => {
  const at = '2026-10-05T11:00:00.000Z';
  const open = docketHeader({ retrieved_at: at });
  const held = docketHeader({ retrieved_at: at, blocked: true });
  const holdAfterOpen = new Map(), openAfterHold = new Map();
  rememberDocketHeader(holdAfterOpen, open, Date.parse('2026-10-05T12:00:00.000Z'));
  rememberDocketHeader(holdAfterOpen, held, Date.parse('2026-10-05T12:00:00.000Z'));
  rememberDocketHeader(openAfterHold, held, Date.parse('2026-10-05T12:00:00.000Z'));
  rememberDocketHeader(openAfterHold, open, Date.parse('2026-10-05T12:00:00.000Z'));
  assert.equal(docketHeaderState(holdAfterOpen.get('123'), Date.parse('2026-10-05T12:00:00.000Z')), 'held');
  assert.equal(docketHeaderState(openAfterHold.get('123'), Date.parse('2026-10-05T12:00:00.000Z')), 'held');
});

test('remembering a future or mismatched-identity header is rejected', () => {
  const headers = new Map();
  assert.throws(() => rememberDocketHeader(headers, docketHeader({ retrieved_at: '2026-10-05T12:00:01.000Z' }), Date.parse('2026-10-05T12:00:00.000Z')), /Future native docket support timestamp/);
  const mismatched = docketHeader({ id: '123', data: { id: 124 } });
  assert.throws(() => rememberDocketHeader(headers, mismatched, Date.parse('2026-10-05T12:00:00.000Z')), /Invalid native docket/);
  assert.equal(headers.size, 0);
});

test('fresh header fetch forces exact native URL and validates the returned envelope', async () => {
  const data = { id: 98765, resource_uri: 'https://www.courtlistener.com/api/rest/v4/dockets/98765/',
    court: 'https://www.courtlistener.com/api/rest/v4/courts/cand/', docket_number: '4:22-md-03047', blocked: false, date_blocked: null };
  const provenance = { source_url: data.resource_uri, retrieved_at: '2026-10-05T11:30:00.000Z', http_status: 200,
    source_sha256: 'b'.repeat(64), schema_version: 'courtlistener-rest-v4.7/1', request_method: 'GET' };
  const calls = [];
  const client = { async request(url, options) { calls.push({ url, options }); return { data, provenance }; } };
  const record = await fetchFreshDocketHeader(client, '98765');
  assert.deepEqual(calls, [{ url: 'https://www.courtlistener.com/api/rest/v4/dockets/98765/', options: { refresh: true } }]);
  assert.equal(record.native_id, '98765');
  assert.equal(record.provenance.record_sha256, sha256(JSON.stringify(data)));
  assert.equal(verifiedNativeDocketHeader(record), data);
  const wrongNativeData = { ...data, id: 98766 };
  const mismatchedClient = { async request() { return { data: wrongNativeData, provenance }; } };
  await assert.rejects(fetchFreshDocketHeader(mismatchedClient, '98765'), /Invalid native docket/);
});

test('fresh header request failure propagates without returning a stale record', async () => {
  let calls = 0;
  const client = { async request(url, options) {
    calls++;
    assert.equal(url, 'https://www.courtlistener.com/api/rest/v4/dockets/123/');
    assert.deepEqual(options, { refresh: true });
    throw new Error('fresh request failed');
  } };
  await assert.rejects(fetchFreshDocketHeader(client, '123'), /fresh request failed/);
  assert.equal(calls, 1);
});
