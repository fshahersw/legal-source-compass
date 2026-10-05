import test from 'node:test';
import assert from 'node:assert/strict';
import { hashBytes } from '../../admin/local-catalog-evidence-contract.mjs';
import { ensurePublisherObject, verifyPublisherReadback } from './publisher-code-storage.mjs';

const bytes = Buffer.from('synthetic publisher bytes'), asset = { bytes: bytes.length, sha256: hashBytes(bytes) };
// Synthetic, nonfunctional credential. No test performs any network requests.
const credentials = { url: 'https://xosqzzsnhxcyehcnirpa.supabase.co', headers: { apikey: 'sb_secret_SYNTHETIC_TEST_ONLY' } };
const privateBucket = () => Response.json({ id: 'corpus-originals', public: false });
const body = () => new Response(bytes);
async function exercise(responses, overrides = {}) {
  const calls = [], events = [];
  const fetcher = async (url, init) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers, redirect: init.redirect });
    const next = responses.shift(); if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected request'); return typeof next === 'function' ? next() : next;
  };
  const pending = ensurePublisherObject({ asset, bytes, credentials, record: async row => events.push(row), fetcher, ...overrides });
  return { calls, events, pending };
}
test('verified existing bytes are reused with no upload', async () => {
  const { calls, events, pending } = await exercise([privateBucket, body]);
  const receipt = await pending;
  assert.equal(receipt.disposition, 'verified_reuse'); assert.equal(receipt.readback_sha256, asset.sha256);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  assert.ok(calls.every(c => c.redirect === 'error')); assert.equal(events.at(-1).state, 'whole_object_verified');
});
test('proven missing object is uploaded once without overwrite then fully verified', async () => {
  const { calls, pending } = await exercise([privateBucket, new Response(null, { status: 404 }), new Response('{}', { status: 201 }), body]);
  assert.equal((await pending).disposition, 'uploaded_verified');
  const posts = calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 1); assert.equal(posts[0].headers['x-upsert'], 'false');
});
test('conflicts and unknown write outcomes require a matching complete readback', async () => {
  for (const outcome of [new Response(null, { status: 409 }), new Error('simulated disconnected write')]) {
    const { calls, pending } = await exercise([privateBucket, new Response(null, { status: 404 }), outcome, body]);
    assert.equal((await pending).disposition, 'upload_outcome_resolved_by_full_readback');
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  }
});
test('corrupt existing object stops without replacing it or issuing a verification receipt', async () => {
  const { calls, events, pending } = await exercise([privateBucket, new Response(Buffer.alloc(bytes.length))]);
  await assert.rejects(pending, /HASH_OR_LENGTH_MISMATCH/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  assert.ok(events.every(e => e.state !== 'whole_object_verified'));
});
test('blocked responses and public buckets stop without an upload', async () => {
  for (const status of [401, 403, 429, 500]) {
    const { calls, pending } = await exercise([privateBucket, new Response(null, { status })]);
    await assert.rejects(pending, /WHOLE_OBJECT_HTTP_REQUIRED/); assert.equal(calls.length, 2);
  }
  const { calls, pending } = await exercise([Response.json({ id: 'corpus-originals', public: true })]);
  await assert.rejects(pending, /PRIVATE_BUCKET_CHECK_FAILED/); assert.equal(calls.length, 1);
});
test('partial, oversized, truncated and changed bodies cannot verify', async () => {
  for (const response of [new Response(bytes, { status: 206 }), new Response(bytes, { headers: { 'content-range': 'bytes 0-9/20' } }),
    new Response(Buffer.concat([bytes, bytes])), new Response(bytes.subarray(1)), new Response(Buffer.alloc(bytes.length))]) {
    await assert.rejects(verifyPublisherReadback(response, asset), /PUBLISHER_/);
  }
});
test('changed local bytes and wrong project fail before any request', async () => {
  for (const overrides of [{ bytes: Buffer.from('changed') }, { credentials: { ...credentials, url: 'https://other.supabase.co' } }]) {
    const { calls, pending } = await exercise([], overrides); await assert.rejects(pending, /PINNED_/); assert.equal(calls.length, 0);
  }
});
test('failed durable journal blocks the upload and no missing-object write is retried', async () => {
  const failed = await exercise([privateBucket], { record: async () => { throw new Error('journal unavailable'); } });
  await assert.rejects(failed.pending, /journal unavailable/); assert.equal(failed.calls.length, 1);
  const missing = await exercise([privateBucket, new Response(null, { status: 404 }), new Error('write failed'), new Response(null, { status: 404 })]);
  await assert.rejects(missing.pending, /MISSING_AFTER_UPLOAD/); assert.equal(missing.calls.filter(c => c.method === 'POST').length, 1);
});
