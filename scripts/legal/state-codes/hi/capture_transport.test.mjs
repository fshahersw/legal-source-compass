import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCaptureArgs, retryAfterMs, createRequestGate, fetchWithRetries, transientTransport } from './capture_transport.mjs';

test('rate remains bounded and action flags cannot be assigned false strings', () => {
  assert.deepEqual(parseCaptureArgs(['private/capture', '--sections', '--rate-ms=125']), { output: 'private/capture', sections: true, rateMs: 125 });
  assert.equal(parseCaptureArgs([]).rateMs, 250);
  for (const args of [['--rate-ms=0'], ['--rate-ms=124'], ['--rate-ms=1.5'], ['--sections=false'], ['--rate-ms=125', '--rate-ms=250']]) {
    assert.throws(() => parseCaptureArgs(args));
  }
});
test('Retry-After accepts seconds and HTTP date without shortening it', () => {
  assert.equal(retryAfterMs('12', 0), 12000);
  assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:00:20 GMT', 5000), 15000);
  assert.equal(retryAfterMs('bad', 0), 0);
});
test('shared gate spaces requests and respects global cooldown', async () => {
  let now = 1000; const times = [];
  const gate = createRequestGate({ rateMs: 125, now: () => now, sleep: async ms => { now += ms; } });
  await gate.take(); times.push(now); await gate.take(); times.push(now);
  gate.defer(5000); await gate.take(); times.push(now);
  assert.deepEqual(times, [1000, 1125, 6125]);
  gate.stop(); await assert.rejects(gate.take(), /paused/);
});
function fakeGate() { return { takes: 0, delays: [], stopped: false, async take() { this.takes++; }, defer(ms) { this.delays.push(ms); }, stop() { this.stopped = true; } }; }
function response(status, retryAfter = null) { return { status, headers: new Headers(retryAfter ? { 'retry-after': retryAfter } : {}), body: { async cancel() {} } }; }
test('429 observes Retry-After and uses same identity/redirect policy', async () => {
  const gate = fakeGate(); let calls = 0;
  const result = await fetchWithRetries('https://example.invalid/source', { gate, fetcher: async (url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(options.headers['User-Agent'], 'LegalSourceAtlas-SourceCapture/1.0');
    return response(++calls === 1 ? 429 : 200, '12');
  }, consume: async () => 'captured' });
  assert.deepEqual(gate.delays, [12000]); assert.equal(result.value, 'captured'); assert.equal(result.attempts, 2);
});
test('transient body/network failures are retried but TLS and access restrictions are not', async () => {
  const gate = fakeGate(); let bodies = 0;
  const result = await fetchWithRetries('https://example.invalid/source', { gate, fetcher: async () => response(200), consume: async () => {
    if (++bodies === 1) throw Object.assign(Error('reset'), { code: 'ECONNRESET' }); return 'ok';
  } });
  assert.equal(result.attempts, 2); assert.deepEqual(gate.delays, [2000]);
  assert.equal(transientTransport({ cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } }), false);
  const restricted = fakeGate(); await assert.rejects(fetchWithRetries('https://example.invalid/source', { gate: restricted,
    fetcher: async () => response(403), consume: async () => 'bad' }), /access response/);
  assert.equal(restricted.stopped, true); assert.equal(restricted.takes, 1);
  const tls = fakeGate(); await assert.rejects(fetchWithRetries('https://example.invalid/source', { gate: tls,
    fetcher: async () => { throw Object.assign(Error('certificate verification failed'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }); },
    consume: async () => 'bad' }), /Non-retryable source transport/);
  assert.equal(tls.stopped, true); assert.equal(tls.takes, 1);
});
test('long Retry-After and repeated failure pause the entire acquisition', async () => {
  const long = fakeGate(); await assert.rejects(fetchWithRetries('https://example.invalid/source', { gate: long,
    fetcher: async () => response(429, '120'), consume: async () => 'bad' }), /automatic acquisition paused/);
  assert.equal(long.stopped, true); assert.equal(long.takes, 1);
  const failed = fakeGate(); await assert.rejects(fetchWithRetries('https://example.invalid/source', { gate: failed,
    fetcher: async () => response(503), consume: async () => 'bad' }), /retry limit/);
  assert.equal(failed.stopped, true); assert.equal(failed.takes, 4);
});
