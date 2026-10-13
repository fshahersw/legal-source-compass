import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CATALOG } from './catalog.mjs';
import { analyticsClient, collectDataset, dateSearch, enumSearch, queryUrl, readDatePoints, readEnumeratedFacet, readFacet, readTotal } from './collect.mjs';
import { parseArgs } from './run.mjs';

const result = (json, extra = {}) => ({ json, receipt: { id: 'a'.repeat(64), lastUpdated: '2026-10-10', ...extra }, noMatches: false });
const facet = { field: 'classification.exact', label: 'Classification', multiValued: false };
const range = { from: '2024-10-13', to: '2026-10-12' };
function fixtureClient(overrides = {}) {
  const requests = [];
  return { requests, async get(url, options) {
    const u = new URL(url); requests.push({ url, options });
    if (overrides.get) { const custom = overrides.get(u, options); if (custom) return custom; }
    const count = u.searchParams.get('count');
    if (u.searchParams.has('sort')) return result({ results: [{ report_date: '20261009' }] });
    if (count === 'report_date') return result({ results: [{ time: '20261009', count: 10 }] });
    if (count) return result({ results: [{ term: 'Class I', count: 6 }, { term: 'Class II', count: 4 }] });
    return result({ results: [{}], meta: { results: { total: 10 } } });
  } };
}
test('catalog uses26 distinct official endpoints and explicit dated versus inventory semantics', () => {
  assert.equal(CATALOG.length, 26); assert.equal(new Set(CATALOG.map((d) => d.id)).size, 26);
  assert(CATALOG.every((d) => d.endpoint.startsWith('https://api.fda.gov/') && d.documentationUrl.startsWith('https://open.fda.gov/')));
  assert.equal(CATALOG.find((d) => d.id === 'drug_shortages').dateField, null);
  assert.equal(CATALOG.find((d) => d.id === 'device_pma').countUnit, 'PMA decision records including supplements');
  assert(CATALOG.find((d) => d.id === 'drug_event').facets.some((f) => f.field === 'patient.drug.medicinalproduct.exact' && f.multiValued));
});
test('only explicit exact NOT_FOUND result can establish zero; malformed success does not', () => {
  assert.equal(readTotal({ noMatches: true }), 0);
  assert.throws(() => readTotal(result({ results: [] })), /TOTAL_SCHEMA_INVALID/);
  assert.throws(() => readTotal(result({ results: [], meta: { results: { total: -1 } } })), /TOTAL_SCHEMA_INVALID/);
});
test('date enumeration rejects duplicate, invalid, out-of-range and unsafe counts', () => {
  for (const rows of [[{ time: '20261013', count: 1 }], [{ time: '20260230', count: 1 }], [{ time: '20261001', count: 1.5 }], [{ time: '20261001', count: 1 }, { time: '20261001', count: 2 }]]) assert.throws(() => readDatePoints(result({ results: rows }), range));
});
test('facet denominator is scoped records, missing categories are not fabricated', () => {
  const f = readFacet(result({ results: [{ term: 'A', count: 6 }] }), 10, facet, { kind: 'inventory' }, ['a']);
  assert.equal(f.denominator, 10); assert.equal(f.exhaustive, false); assert.equal(f.buckets.length, 1);
  assert.throws(() => readFacet(result({ results: [{ term: 'A', count: 6 }, { term: 'B', count: 5 }] }), 10, facet, { kind: 'inventory' }, ['a']), /FACET_EXCLUSIVE_COUNT_INVALID/);
});
test('overlapping multi-valued terms can exceed100percent but each count cannot exceed denominator', () => {
  const f = readFacet(result({ results: [{ term: 'A', count: 8 }, { term: 'B', count: 7 }] }), 10, { ...facet, multiValued: true }, { kind: 'inventory' }, ['a']);
  assert.equal(f.exhaustive, false); assert.equal(f.buckets.reduce((n, b) => n + b.count, 0), 15);
  assert.throws(() => readFacet(result({ results: [{ term: 'A', count: 11 }] }), 10, { ...facet, multiValued: true }, { kind: 'inventory' }, ['a']), /FACET_COUNT_INVALID/);
});
test('API top1000 is explicitly truncated and not exhaustive', () => {
  const f = readFacet(result({ results: Array.from({ length: 1000 }, (_, n) => ({ term: String(n), count: 1 })) }), 1000, facet, { kind: 'inventory' }, ['a']);
  assert.equal(f.truncated, true); assert.equal(f.exhaustive, false);
});
test('documenteddeviceclasscodes each require retained exact-search totals and reconcile withoutinventedOther', () => {
  const definition = CATALOG.find((d) => d.id === 'device_classification').facets[0];
  const results = [3, 4, 1, 1, 1, 0].map((n) => result({ results: [{}], meta: { results: { total: n } } }));
  const f = readEnumeratedFacet(results, 10, definition, { kind: 'inventory' }, ['a']);
  assert.equal(f.exhaustive, true); assert.equal(f.buckets[0].key, '1'); assert.equal(f.buckets[0].label, 'Class I');
  assert.equal(enumSearch('device_class', '1'), 'device_class:"1"');
  assert.throws(() => readEnumeratedFacet(results.slice(1), 10, definition, { kind: 'inventory' }, ['a']), /ENUM_FACET_INCOMPLETE/);
  assert.equal(readEnumeratedFacet(results, 11, definition, { kind: 'inventory' }, ['a']).exhaustive, false);
});
test('literalemptyAPItermisretained with explicit display label, never silently discarded', () => {
  const f = readFacet(result({ results: [{ term: '', count: 1 }] }), 1, facet, { kind: 'inventory' }, ['a']);
  assert.equal(f.buckets[0].key, ''); assert.equal(f.buckets[0].label, '(empty term in source)'); assert.equal(f.exhaustive, true);
});
test('dataset reconciles730days and exact source-aligned30/90/365/730facets', async () => {
  const client = fixtureClient(); const d = await collectDataset(CATALOG[0], range, client, () => '2026-10-13T00:00:00Z');
  assert.equal(d.status, 'ready'); assert.equal(d.series.complete, true); assert.equal(d.series.completeThrough, '2026-10-09');
  assert.deepEqual(d.series.range, { from: '2024-10-10', to: '2026-10-09' });
  assert.equal(d.facets.length, 8); assert(d.facets.every((f) => f.scope.to === '2026-10-09' && f.denominator === 10));
  assert(client.requests.some((r) => r.url.includes('sort=report_date%3Adesc')));
});
test('nonreconciled series retains observations but no coverage cutoff or percent facets', async () => {
  const d = await collectDataset(CATALOG[0], range, fixtureClient({ get: (u) => u.searchParams.get('count') === 'report_date' ? result({ results: [{ time: '20261009', count: 9 }] }) : null }), () => '2026-10-13T00:00:00Z');
  assert.equal(d.status, 'partial'); assert.equal(d.series.complete, false); assert.equal(d.series.completeThrough, null); assert.equal(d.facets.length, 0);
});
test('midcapture source release changes invalidate entire dataset, never combine releases', async () => {
  const d = await collectDataset(CATALOG[0], range, fixtureClient({ get: (u, options) => options?.fresh ? result({ results: [{}], meta: { results: { total: 10 } } }, { lastUpdated: '2026-10-11' }) : null }), () => '2026-10-13T00:00:00Z');
  assert.equal(d.status, 'failed'); assert.equal(d.statusReason, 'SOURCE_RELEASE_CHANGED'); assert.equal(d.total.value, null); assert.equal(d.series, null); assert.deepEqual(d.facets, []);
});
test('inventory never invents an event series', async () => {
  const d = await collectDataset(CATALOG.find((v) => v.id === 'drug_ndc'), range, fixtureClient());
  assert.equal(d.series, null); assert.equal(d.total.scope, 'inventory'); assert(d.facets.every((f) => f.scope.kind === 'inventory'));
});
test('query paths are catalog allowlisted and exact field/date scope encoded', () => {
  assert.equal(new URL(queryUrl(CATALOG[0].endpoint, dateSearch('report_date', range), 'classification.exact')).searchParams.get('search'), 'report_date:[20241013 TO 20261012]');
  assert.throws(() => queryUrl('https://example.com/a'), /ENDPOINT_NOT_IN_CATALOG/);
});
test('public HTTP retains JSONerror evidence, rejectsHTML403, enforces requestcap and does not follow redirects', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fda-test-'));
  try {
    let calls = 0; const client = analyticsClient({ directory, intervalMs: 0, sleep: async () => {}, maxRequests: 2, fetchImpl: async (_url, init) => { calls++; assert.equal(init.redirect, 'manual'); return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No matches found!' } }), { status: 404, headers: { 'content-type': 'application/json' } }); } });
    const zero = await client.get(queryUrl(CATALOG[0].endpoint)); assert.equal(readTotal(zero), 0); assert.equal(zero.receipt.httpStatus, 404);
    await client.get(queryUrl(CATALOG[1].endpoint)); await assert.rejects(client.get(queryUrl(CATALOG[2].endpoint)), /REQUEST_BUDGET_EXHAUSTED/); assert.equal(calls, 2);
    const html = analyticsClient({ directory, intervalMs: 0, sleep: async () => {}, fetchImpl: async () => new Response('<html>Denied</html>', { status: 403, headers: { 'content-type': 'text/html' } }) });
    await assert.rejects(html.get(queryUrl(CATALOG[0].endpoint)), /SOURCE_CONTENT_TYPE_INVALID_HTTP_403/); assert.equal(html.receipts.size, 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('CLI only bare execute can authorize landing and requires private output', () => {
  assert.throws(() => parseArgs(['land', '--output=private/test', '--execute=false']), /ARGUMENT_INVALID/);
  assert.throws(() => parseArgs(['land', '--output=private/test']), /EXECUTE_REQUIRED/);
  assert.throws(() => parseArgs(['capture', '--output=public/data']), /PRIVATE_DIRECTORY_REQUIRED/);
  assert.equal(parseArgs(['land', '--output=private/test', '--execute']).execute, true);
});
test('authorizedopenFDAkey uses documentedBasicheader only and never receiptURLorfiles', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fda-key-test-')); const key = 'synthetic_api_key_not_secret';
  try {
    const client = analyticsClient({ directory, apiKey: key, intervalMs: 0, sleep: async () => {}, fetchImpl: async (url, init) => { assert(!url.includes(key)); assert.equal(init.headers.Authorization, `Basic ${Buffer.from(key + ':').toString('base64')}`); return new Response(JSON.stringify({ meta: { last_updated: '2026-10-12', results: { total: 1 } }, results: [{}] }), { headers: { 'content-type': 'application/json' } }); } });
    await client.get(queryUrl(CATALOG[0].endpoint)); assert(!JSON.stringify([...client.receipts.values()]).includes(key)); assert(!(await fs.readFile(path.join(directory, 'captures.json'), 'utf8')).includes(key));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
