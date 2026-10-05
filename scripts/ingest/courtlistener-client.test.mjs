import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CourtListenerClient, sha256} from './courtlistener-client.mjs';

const url = 'https://www.courtlistener.com/api/rest/v4/dockets/42/';
const key = sha256(`GET ${url}`);
const body = Buffer.from('{ "id": 42, "blocked": false }\n');
const oldReceipt = {
  source_url: url, request_method: 'GET', http_status: 200,
  source_sha256: sha256(body), schema_version: 'courtlistener-rest-v4.7/1',
  retrieved_at: '2026-10-04T00:00:00.000Z',
};

async function fixture(t, receipt = oldReceipt) {
  const base = path.join(os.tmpdir(), 'cl-cache-test-');
  const cache = await fs.mkdtemp(base);
  t.after(async () => {
    assert.ok(path.resolve(cache).startsWith(path.resolve(base)));
    await fs.rm(cache, {recursive: true, force: true});
  });
  await fs.mkdir(path.join(cache, 'api'));
  const filename = path.join(cache, 'api', `${key}.json`);
  const provenanceFile = path.join(cache, 'api', `${key}.provenance.json`);
  await fs.writeFile(filename, body);
  await fs.writeFile(provenanceFile, JSON.stringify(receipt));
  const client = new CourtListenerClient(cache, 5);
  client.keys = {COURTLISTENER_API_KEY: 'test-only-placeholder'};
  client.ledger = {timestamps: []}; client.baseline = [];
  // Every test starts with a network trap; only explicitly mocked calls can run.
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected network call'); });
  return {client, cache, filename, provenanceFile};
}

test('valid cached evidence retains its original retrieval time and spends no quota', async t => {
  const {client} = await fixture(t);
  const result = await client.request(url);
  assert.deepEqual(result, {data: JSON.parse(body), provenance: oldReceipt, cached: true});
  assert.equal(client.requests, 0);
});

test('tampered bytes, sidecar identity, schema, status and missing pairs fail closed', async t => {
  for (const change of [
    {source_url: url.replace('/42/', '/43/')}, {request_method: 'OPTIONS'},
    {http_status: 403}, {schema_version: 'unknown'}, {retrieved_at: 'invalid'},
    {source_sha256: 'a'.repeat(64)},
  ]) {
    await t.test(JSON.stringify(change), async child => {
      const {client} = await fixture(child, {...oldReceipt, ...change});
      await assert.rejects(client.request(url), /CACHE_EVIDENCE_MISMATCH/);
      await assert.rejects(client.request(url, {refresh: true}), /CACHE_EVIDENCE_MISMATCH/);
      assert.equal(client.requests, 0);
    });
  }
  await t.test('changed raw body', async child => {
    const {client, filename} = await fixture(child);
    await fs.writeFile(filename, '{"id":43}');
    await assert.rejects(client.request(url), /CACHE_EVIDENCE_MISMATCH/);
  });
  await t.test('missing receipt', async child => {
    const {client, provenanceFile} = await fixture(child);
    await fs.unlink(provenanceFile);
    await assert.rejects(client.request(url, {refresh: true}), /CACHE_EVIDENCE_MISSING_PAIR/);
  });
  await t.test('missing body', async child => {
    const {client, filename} = await fixture(child);
    await fs.unlink(filename);
    await assert.rejects(client.request(url), /CACHE_EVIDENCE_MISSING_PAIR/);
  });
});

test('a forced refresh preserves both byte versions and retrieval receipts before replacing current files', async t => {
  const {client, cache, filename, provenanceFile} = await fixture(t);
  const next = Buffer.from('{"id":42,"blocked":true}\n');
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    assert.equal(input, url); assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(await fs.readFile(path.join(cache, 'api/raw', `${sha256(body)}.json`)), body);
    return new Response(next, {status: 200});
  });
  const result = await client.request(url, {refresh: true});
  assert.equal(result.cached, false); assert.equal(client.requests, 1);
  assert.deepEqual(await fs.readFile(filename), next);
  assert.deepEqual(JSON.parse(await fs.readFile(provenanceFile)), result.provenance);
  for (const bytes of [body, next]) {
    assert.deepEqual(await fs.readFile(path.join(cache, 'api/raw', `${sha256(bytes)}.json`)), bytes);
  }
  const receipts = await Promise.all((await fs.readdir(path.join(cache, 'api/observations')))
    .map(name => fs.readFile(path.join(cache, 'api/observations', name), 'utf8').then(JSON.parse)));
  assert.equal(receipts.length, 2);
  assert.ok(receipts.some(r => r.retrieved_at === oldReceipt.retrieved_at));
  assert.ok(receipts.some(r => r.retrieved_at === result.provenance.retrieved_at));
});

test('an unchanged response retains a distinct fresh retrieval without duplicating raw bytes', async t => {
  const {client, cache} = await fixture(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(body, {status: 200}));
  const result = await client.request(url, {refresh: true});
  assert.notEqual(result.provenance.retrieved_at, oldReceipt.retrieved_at);
  assert.equal((await fs.readdir(path.join(cache, 'api/raw'))).length, 1);
  assert.equal((await fs.readdir(path.join(cache, 'api/observations'))).length, 2);
});

test('failed archive verification prevents a request or current-cache replacement', async t => {
  const {client, cache, filename} = await fixture(t);
  await fs.mkdir(path.join(cache, 'api/raw'));
  await fs.writeFile(path.join(cache, 'api/raw', `${sha256(body)}.json`), 'corrupt archive');
  await assert.rejects(client.request(url, {refresh: true}), /CACHE_ARCHIVE_READBACK_MISMATCH/);
  assert.equal(client.requests, 0);
  assert.deepEqual(await fs.readFile(filename), body);
});

test('new response archive corruption cannot replace the previous successful cache', async t => {
  const {client, cache, filename, provenanceFile} = await fixture(t);
  const next = Buffer.from('{"id":42,"blocked":true}');
  await fs.mkdir(path.join(cache, 'api/raw'));
  await fs.writeFile(path.join(cache, 'api/raw', `${sha256(next)}.json`), 'corrupt new archive');
  t.mock.method(globalThis, 'fetch', async () => new Response(next, {status: 200}));
  await assert.rejects(client.request(url, {refresh: true}), /CACHE_ARCHIVE_READBACK_MISMATCH/);
  assert.equal(client.requests, 1);
  assert.deepEqual(await fs.readFile(filename), body);
  assert.deepEqual(JSON.parse(await fs.readFile(provenanceFile)), oldReceipt);
});

test('authorization or throttle failure preserves prior bytes and stops even cached fallback', async t => {
  for (const status of [401, 403, 429]) await t.test(String(status), async child => {
    const {client, filename, provenanceFile} = await fixture(child);
    child.mock.method(globalThis, 'fetch', async () => new Response('{}', {status, headers: {'retry-after': '2'}}));
    const stop = status === 429 ? /RATE_LIMIT_STOP/ : /AUTHORIZATION_STOP/;
    await assert.rejects(client.request(url, {refresh: true}), stop);
    await assert.rejects(client.request(url), stop);
    assert.deepEqual(await fs.readFile(filename), body);
    assert.deepEqual(JSON.parse(await fs.readFile(provenanceFile)), oldReceipt);
  });
});

test('refresh respects request budget and defers hour-long rolling quota waits', async t => {
  const {client} = await fixture(t);
  client.maxRequests = 0;
  await assert.rejects(client.request(url, {refresh: true}), /REQUEST_BUDGET_REACHED/);
  client.stopped = null; client.maxRequests = 5;
  client.baseline = [{window_seconds: 3600, limit: 300, used: 270, checkedAt: Date.now()}];
  await assert.rejects(client.request(url, {refresh: true}), /RATE_WINDOW_DEFERRED/);
  assert.equal(client.requests, 0);
});
