import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { runSettledWorkers, nativeObservationKey, sourceDocketAllowsRelations, verifiedNativeDocketHeader } from './metadata-workflow.mjs';

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
