import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CATALOG, PRESET_DAYS, SOURCE_QUALIFICATIONS } from './catalog.mjs';
import { MonitorError, requireValue, sha256, payloadHash, isoDate, sourceDate, addDays, publicCaptureClient, atomicJson, immutableWrite } from '../regulatory/core.mjs';
import { canonicalIntegerJson } from '../../admin/local-catalog-evidence-contract.mjs';

export const MAX_REQUESTS = 600;
const code = (error) => error instanceof MonitorError ? error.code : 'SOURCE_OPERATION_FAILED';
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
export function queryUrl(endpoint, search, count, sort) {
  const u = new URL(endpoint); requireValue(CATALOG.some((d) => d.endpoint === endpoint), 'ENDPOINT_NOT_IN_CATALOG');
  if (search) u.searchParams.set('search', search);
  if (count) u.searchParams.set('count', count);
  if (sort) u.searchParams.set('sort', sort);
  u.searchParams.set('limit', count ? '1000' : '1'); return u.href;
}
export const dateSearch = (field, range) => `${field}:[${range.from.replaceAll('-', '')} TO ${range.to.replaceAll('-', '')}]`;
export const enumSearch = (field, value, search) => `${search ? `(${search}) AND ` : ''}${field}:"${value}"`;
export function analyticsClient({ directory, fetchImpl = fetch, sleep, intervalMs = 1000, maxRequests = MAX_REQUESTS, seedDirectory = null, apiKey = process.env.OPENFDA_API_KEY } = {}) {
  requireValue(Number.isInteger(maxRequests) && maxRequests > 0 && maxRequests <= MAX_REQUESTS, 'REQUEST_BUDGET_INVALID');
  requireValue(apiKey === undefined || (typeof apiKey === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(apiKey)), 'API_KEY_FORMAT_INVALID');
  let requests = 0; const receipts = new Map(); const cache = new Map(); const blockedCounts = new Map(); let seeded = false;
  const raw = publicCaptureClient({ directory, hosts: ['api.fda.gov'], sleep, intervalMs,
    fetchImpl: async (url, init) => { requireValue(requests < maxRequests, 'REQUEST_BUDGET_EXHAUSTED'); requests++; return fetchImpl(url, { ...init, headers: { ...init.headers, ...(apiKey ? { Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}` } : {}) } }); } });
  async function get(url, { fresh = false } = {}) {
    if (!seeded) {
      seeded = true;
      if (seedDirectory) {
        let previous;
        try { const saved = JSON.parse(await fs.readFile(path.join(seedDirectory, 'snapshot.json'), 'utf8')); previous = saved.receipts.map((r) => ({ sha256: r.sha256, source_url: r.url, retrieved_at: r.retrievedAt, byte_count: r.byteCount, content_type: r.contentType, http_status: r.httpStatus })); }
        catch (error) { if (error.code !== 'ENOENT') throw error; previous = JSON.parse(await fs.readFile(path.join(seedDirectory, 'captures.json'), 'utf8')); }
        requireValue(Array.isArray(previous) && previous.length <= MAX_REQUESTS, 'SEED_CAPTURE_LIMIT');
        for (const r of previous) {
          requireValue(/^[a-f0-9]{64}$/.test(r.sha256) && Date.now() - Date.parse(r.retrieved_at) >= 0 && Date.now() - Date.parse(r.retrieved_at) < 6 * 3600000, 'SEED_CAPTURE_INVALID');
          const u = new URL(r.source_url); requireValue(CATALOG.some((d) => d.endpoint === u.origin + u.pathname), 'SEED_ENDPOINT_INVALID');
          const bytes = await fs.readFile(path.join(seedDirectory, 'objects', r.sha256 + '.raw')); requireValue(sha256(bytes) === r.sha256 && bytes.length === r.byte_count, 'SEED_HASH_MISMATCH');
          await immutableWrite(path.join(directory, 'objects', r.sha256 + '.raw'), bytes);
          if (!/application\/(?:[a-z.-]+\+)?json/i.test(r.content_type)) continue;
          let json; try { json = JSON.parse(bytes); } catch { continue; }
          const id = sha256(r.source_url + '\n' + r.sha256);
          const receipt = { id, url: r.source_url, sha256: r.sha256, retrievedAt: r.retrieved_at, lastUpdated: typeof json?.meta?.last_updated === 'string' ? json.meta.last_updated : null, byteCount: bytes.length, contentType: 'application/json', httpStatus: r.http_status };
          const noMatches = r.http_status === 404 && json?.error?.code === 'NOT_FOUND' && json?.error?.message === 'No matches found!';
          if (r.http_status === 200 || noMatches) cache.set(r.source_url, { json, receipt, noMatches });
          if (r.http_status === 403 && json?.error?.code === 'API_KEY_MISSING' && u.searchParams.has('count')) blockedCounts.set(u.origin + u.pathname, receipt);
        }
      }
    }
    if (!fresh && cache.has(url)) { const result = cache.get(url); receipts.set(result.receipt.id, result.receipt); return result; }
    const requestedUrl = new URL(url); const blocked = blockedCounts.get(requestedUrl.origin + requestedUrl.pathname);
    if (!apiKey && blocked && requestedUrl.searchParams.has('count')) { receipts.set(blocked.id, blocked); throw new MonitorError('OPENFDA_API_KEY_REQUIRED'); }
    const captured = await raw.capture(url, 'bytes', { acceptedStatuses: [400, 403, 404] });
    requireValue(/application\/(?:[a-z.-]+\+)?json/i.test(captured.receipt.content_type), `SOURCE_CONTENT_TYPE_INVALID_HTTP_${captured.receipt.http_status}`);
    let json; try { json = JSON.parse(captured.bytes.toString('utf8')); } catch { throw new MonitorError('SOURCE_JSON_INVALID'); }
    const r = captured.receipt; const id = sha256(url + '\n' + r.sha256);
    const receipt = { id, url, sha256: r.sha256, retrievedAt: r.retrieved_at, lastUpdated: typeof json?.meta?.last_updated === 'string' ? json.meta.last_updated : null, byteCount: r.byte_count, contentType: 'application/json', httpStatus: r.http_status };
    receipts.set(id, receipt);
    const result = { json, receipt, noMatches: r.http_status === 404 && json?.error?.code === 'NOT_FOUND' && json?.error?.message === 'No matches found!' };
    if (r.http_status === 403 && json?.error?.code === 'API_KEY_MISSING') { if (requestedUrl.searchParams.has('count')) blockedCounts.set(requestedUrl.origin + requestedUrl.pathname, receipt); throw new MonitorError('OPENFDA_API_KEY_REQUIRED'); }
    if (r.http_status !== 200 && !result.noMatches) throw new MonitorError(`SOURCE_HTTP_${r.http_status}`);
    cache.set(url, result); return result;
  }
  return { get, receipts, get requests() { return requests; } };
}
export function readTotal(result) {
  if (result.noMatches) return 0;
  requireValue(result.json && Array.isArray(result.json.results) && isCount(result.json.meta?.results?.total), 'TOTAL_SCHEMA_INVALID');
  return result.json.meta.results.total;
}
export function readDatePoints(result, range) {
  if (result.noMatches) return [];
  requireValue(Array.isArray(result.json?.results) && result.json.results.length <= 1000, 'DATE_COUNT_SCHEMA_INVALID');
  const seen = new Set(); const points = result.json.results.map((row) => {
    requireValue(row && typeof row.time === 'string' && isCount(row.count) && row.count > 0, 'DATE_COUNT_SCHEMA_INVALID');
    const date = sourceDate(row.time); requireValue(date >= range.from && date <= range.to && !seen.has(date), 'DATE_COUNT_RANGE_OR_DUPLICATE'); seen.add(date);
    return { date, count: row.count };
  }); return points.sort((a, b) => a.date.localeCompare(b.date));
}
export function readFacet(result, denominator, definition, scope, receiptIds) {
  requireValue(isCount(denominator), 'FACET_DENOMINATOR_INVALID');
  const rows = result?.noMatches ? [] : result?.json?.results ?? [];
  requireValue(Array.isArray(rows) && rows.length <= 1000 && (!result || result.noMatches || Array.isArray(result.json?.results)), 'FACET_SCHEMA_INVALID');
  const seen = new Set(); const buckets = rows.map((row) => {
    requireValue(row && (typeof row.term === 'string' || Number.isSafeInteger(row.term)) && isCount(row.count) && row.count > 0 && row.count <= denominator, 'FACET_COUNT_INVALID');
    const key = String(row.term); requireValue(key.length <= 1000 && !seen.has(key), 'FACET_KEY_INVALID'); seen.add(key);
    return { key, label: key || '(empty term in source)', count: row.count };
  });
  const sum = buckets.reduce((n, b) => n + b.count, 0); const truncated = buckets.length === 1000;
  requireValue(Number.isSafeInteger(sum) && (definition.multiValued || sum <= denominator), 'FACET_EXCLUSIVE_COUNT_INVALID');
  const suffix = scope.kind === 'window' ? `${Math.round((Date.parse(scope.to) - Date.parse(scope.from)) / 86400000) + 1}d` : scope.kind;
  return { id: `${definition.field.replace(/[^a-zA-Z0-9]+/g, '_')}_${suffix}`, label: definition.label, field: definition.field, countUnit: 'records containing the recorded term', scope, buckets, denominator, denominatorLabel: 'API records matching the exact scope', multiValued: definition.multiValued,
    exhaustive: !truncated && !definition.multiValued && sum === denominator, truncated, receiptIds,
    qualification: `${definition.multiValued ? 'A record may appear in multiple categories; percentages can sum above 100%.' : 'Records with missing category fields may not appear.'} ${truncated ? 'API top-1000 term limit reached; remaining categories are not enumerated.' : 'All returned API terms are retained; this does not impute missing categories.'}` };
}
export function readEnumeratedFacet(results, denominator, definition, scope, receiptIds) {
  requireValue(Array.isArray(definition.enumTerms) && results.length === definition.enumTerms.length, 'ENUM_FACET_INCOMPLETE');
  const rows = results.map((r, index) => ({ term: definition.enumTerms[index][0], count: readTotal(r) })).filter((r) => r.count > 0);
  const facet = readFacet({ json: { results: rows } }, denominator, definition, scope, receiptIds);
  facet.buckets = facet.buckets.map((b) => ({ ...b, label: definition.enumTerms.find(([key]) => key === b.key)[1] }));
  facet.qualification = `Counts are exact source-code search totals for categories documented at ${definition.enumSource}. Each code has its own retained query. ${facet.exhaustive ? 'The documented categories reconcile to all scoped records.' : 'Unlisted or missing values are not fabricated; these categories do not exhaust the scoped records.'}`;
  return facet;
}
function sameRelease(result, release) {
  // A documented zero result has no meta. Its exact URL and 404 JSON remain its evidence.
  requireValue(result.noMatches || result.receipt.lastUpdated === release, 'SOURCE_RELEASE_CHANGED');
}
export async function collectDataset(definition, window, client, now = () => new Date().toISOString()) {
  const d = definition;
  const out = { id: d.id, label: d.label, endpoint: d.endpoint, documentationUrl: d.documentationUrl, productFamily: d.productFamily, countUnit: d.countUnit, status: 'ready', statusReason: null, retrievedAt: now(), sourceUpdatedAt: null, qualification: d.qualification, total: { value: null, scope: d.dateField ? 'all_time' : 'inventory', receiptIds: [] }, series: null, facets: [] };
  const problems = new Set(); let release = null;
  try {
    const base = await client.get(queryUrl(d.endpoint)); const total = readTotal(base); release = base.receipt.lastUpdated;
    out.sourceUpdatedAt = release; out.total = { ...out.total, value: total, receiptIds: [base.receipt.id] };
    const scopes = [];
    if (d.dateField) {
      try {
        const latest = await client.get(queryUrl(d.endpoint, dateSearch(d.dateField, { from: '1900-01-01', to: window.to }), undefined, `${d.dateField}:desc`)); sameRelease(latest, release);
        requireValue(!latest.noMatches && Array.isArray(latest.json?.results) && latest.json.results.length === 1, 'LATEST_DATE_NOT_RECORDED');
        const latestDate = sourceDate(latest.json.results[0][d.dateField]); requireValue(latestDate && latestDate <= window.to, 'LATEST_DATE_INVALID');
        let cutoff = [latestDate, window.to, addDays(now().slice(0, 10), -1)].sort()[0];
        try { if (release) cutoff = [cutoff, sourceDate(release)].sort()[0]; } catch { /* Native date, not release text, supplies the maximum. */ }
        const seriesRange = { from: addDays(cutoff, -729), to: cutoff };
        const search = dateSearch(d.dateField, seriesRange);
        const matched = await client.get(queryUrl(d.endpoint, search)); sameRelease(matched, release); const matchedRecords = readTotal(matched);
        const dates = await client.get(queryUrl(d.endpoint, search, d.dateField)); sameRelease(dates, release); const points = readDatePoints(dates, seriesRange);
        const complete = points.reduce((n, p) => n + p.count, 0) === matchedRecords;
        if (!complete) problems.add('DATE_ENUMERATION_NOT_RECONCILED');
        cutoff = complete && points.length ? [cutoff, points.at(-1).date].sort()[0] : null;
        out.series = { dateField: d.dateField, dateMeaning: d.dateMeaning, range: seriesRange, complete, completeThrough: cutoff, points, matchedRecords, receiptIds: [...new Set([latest.receipt.id, matched.receipt.id, dates.receipt.id])], qualification: 'Counts are API records for this date field. The source-aligned range ends at an observed native date, bounded by release date and the prior UTC day. Enumeration reconciliation does not establish complete real-world reporting. Missing days after the cutoff are unknown; historical counts may be revised.' };
        for (const days of cutoff ? PRESET_DAYS : []) {
          const range = { from: addDays(cutoff, 1 - days), to: cutoff };
          const q = dateSearch(d.dateField, range);
          try { const r = await client.get(queryUrl(d.endpoint, q)); sameRelease(r, release); scopes.push({ scope: { kind: 'window', ...range }, search: q, denominator: readTotal(r), receipt: r.receipt }); }
          catch (error) { if (code(error) === 'SOURCE_RELEASE_CHANGED') throw error; problems.add(`${days}D_${code(error)}`); }
        }
      } catch (error) { if (code(error) === 'SOURCE_RELEASE_CHANGED') throw error; problems.add(code(error)); }
    } else scopes.push({ scope: { kind: 'inventory' }, search: undefined, denominator: total, receipt: base.receipt });
    for (const scoped of scopes) for (const f of d.facets) {
      try {
        if (f.enumTerms) {
          const results = [];
          for (const [value] of f.enumTerms) { const r = await client.get(queryUrl(d.endpoint, enumSearch(f.field, value, scoped.search))); sameRelease(r, release); results.push(r); }
          out.facets.push(readEnumeratedFacet(results, scoped.denominator, f, scoped.scope, [...new Set([scoped.receipt.id, ...results.map((r) => r.receipt.id)])])); continue;
        }
        const r = scoped.denominator === 0 ? null : await client.get(queryUrl(d.endpoint, scoped.search, f.field));
        if (r) sameRelease(r, release);
        const result = readFacet(r, scoped.denominator, f, scoped.scope, [...new Set([scoped.receipt.id, ...(r ? [r.receipt.id] : [])])]); out.facets.push(result);
      } catch (error) { if (code(error) === 'SOURCE_RELEASE_CHANGED') throw error; problems.add(`${f.field}:${code(error)}`); }
    }
    const final = await client.get(queryUrl(d.endpoint), { fresh: true }); sameRelease(final, release);
    requireValue(readTotal(final) === total, 'SOURCE_TOTAL_CHANGED'); out.total.receiptIds = [...new Set([...out.total.receiptIds, final.receipt.id])];
    if (problems.size) { out.status = 'partial'; out.statusReason = [...problems].join('; ').slice(0, 2000); }
  } catch (error) { out.status = /HTTP_(403|404)/.test(code(error)) ? 'unavailable' : 'failed'; out.statusReason = code(error); out.total.value = null; out.total.receiptIds = []; out.series = null; out.facets = []; }
  out.retrievedAt = now(); return out;
}
export async function captureSnapshot({ directory, through = addDays(new Date().toISOString().slice(0, 10), -1), client, runId = randomUUID(), catalog = CATALOG } = {}) {
  isoDate(through); requireValue(through <= addDays(new Date().toISOString().slice(0, 10), -1), 'FUTURE_WINDOW');
  requireValue(typeof directory === 'string' && /(?:^|[\\/])private(?:[\\/]|$)/i.test(path.resolve(directory)), 'PRIVATE_DIRECTORY_REQUIRED');
  const window = { from: addDays(through, -729), to: through }; client ??= analyticsClient({ directory });
  const datasets = [];
  for (const d of catalog) { const result = await collectDataset(d, window, client); datasets.push(result); await atomicJson(path.join(directory, 'progress.json'), { runId, completed: datasets.map((v) => ({ id: v.id, status: v.status, total: v.total.value, facets: v.facets.length, points: v.series?.points.length ?? 0, reason: v.statusReason })), requests: client.requests }); console.log(JSON.stringify({ id: result.id, status: result.status, total: result.total.value, facets: result.facets.length, points: result.series?.points.length ?? 0, reason: result.statusReason, requests: client.requests })); }
  const coverageWindow = { from: [window.from, ...datasets.map((d) => d.series?.range.from).filter(Boolean), ...datasets.flatMap((d) => d.facets.filter((f) => f.scope.kind === 'window').map((f) => f.scope.from))].sort()[0], to: window.to };
  const snapshot = { schemaVersion: 'fda-analytics/1', runId, generatedAt: new Date().toISOString(), window: coverageWindow, datasets, receipts: [...client.receipts.values()], qualifications: SOURCE_QUALIFICATIONS };
  const canonical = Buffer.from(canonicalIntegerJson(snapshot)); const hash = payloadHash(snapshot);
  await immutableWrite(path.join(directory, 'snapshot.json'), canonical); await atomicJson(path.join(directory, 'manifest.json'), { schemaVersion: 'fda-analytics-capture/1', runId, payloadSha256: hash, snapshotFile: 'snapshot.json', snapshotBytes: canonical.length, requests: client.requests, datasetCount: datasets.length, receiptCount: snapshot.receipts.length, statuses: Object.fromEntries(['ready', 'partial', 'failed', 'unavailable'].map((s) => [s, datasets.filter((d) => d.status === s).length])) });
  return { payloadSha256: hash, snapshot };
}
