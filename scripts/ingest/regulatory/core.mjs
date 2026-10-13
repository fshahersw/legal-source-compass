/** Regulatory monitoring: bounded public acquisition. No corpus credentials are used here. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalIntegerJson } from '../../admin/local-catalog-evidence-contract.mjs';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const payloadHash = (value) => sha256(canonicalIntegerJson(value));
export class MonitorError extends Error {
  constructor(code) { super(code); this.name = 'MonitorError'; this.code = code; }
}
export function requireValue(condition, code = 'SOURCE_SCHEMA_INVALID') { if (!condition) throw new MonitorError(code); }
export function isoDate(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_DATE');
  requireValue(!Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'INVALID_DATE');
  return value;
}
export const addDays = (date, days) => new Date(Date.parse(isoDate(date)) + days * 86400000).toISOString().slice(0, 10);
export function sourceDate(value) {
  if (value === null || value === undefined || value === '') return null;
  requireValue(typeof value === 'string', 'SOURCE_DATE_INVALID');
  if (/^\d{8}$/.test(value)) return isoDate(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return isoDate(value.slice(0, 10));
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return isoDate(`${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`);
  throw new MonitorError('SOURCE_DATE_INVALID');
}
export function allowedUrl(value, hosts) {
  let u; try { u = new URL(value); } catch { throw new MonitorError('SOURCE_URL_INVALID'); }
  requireValue(u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && hosts.includes(u.hostname), 'SOURCE_URL_DISALLOWED');
  return u.href;
}
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}
export async function immutableWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; requireValue(sha256(await fs.readFile(file)) === sha256(bytes), 'LOCAL_OBJECT_COLLISION'); }
}
export function retryDelay(header, attempt, now = Date.now()) {
  let delay = 1000 * 2 ** attempt;
  if (header) { const n = Number(header); const parsed = Number.isFinite(n) ? n * 1000 : Date.parse(header) - now; if (Number.isFinite(parsed)) delay = Math.max(delay, parsed); }
  requireValue(delay <= 60000, 'SOURCE_RETRY_AFTER_DEFERRED');
  return Math.max(0, delay);
}
export async function boundedBytes(response, maximum) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) { await response.body?.cancel(); throw new MonitorError('SOURCE_BODY_TOO_LARGE'); }
  requireValue(response.body, 'SOURCE_BODY_MISSING');
  const reader = response.body.getReader(); const chunks = []; let count = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; count += value.byteLength; requireValue(count <= maximum, 'SOURCE_BODY_TOO_LARGE'); chunks.push(Buffer.from(value)); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  requireValue(count > 0, 'SOURCE_BODY_EMPTY'); return Buffer.concat(chunks);
}
export function publicCaptureClient({ directory, hosts, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), intervalMs = 1000, maxBytes = 8 * 1024 * 1024, timeoutMs = 30000 }) {
  const captures = []; let nextAt = 0;
  async function capture(url, type = 'json', options = {}) {
    allowedUrl(url, hosts);
    let bytes, response;
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(Math.max(0, nextAt - Date.now())); nextAt = Date.now() + intervalMs;
      try {
        response = await fetchImpl(url, { redirect: 'manual', headers: { Accept: type === 'json' ? 'application/json' : type === 'html' ? 'text/html' : '*/*', 'User-Agent': 'SeegerWeissResearch-RegulatoryMonitor/1.0 (bounded official-source research)' }, signal: AbortSignal.timeout(timeoutMs) });
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          if (attempt === 3) throw new MonitorError(`SOURCE_HTTP_${response.status}`);
          await sleep(retryDelay(response.headers.get('retry-after'), attempt)); continue;
        }
        requireValue(response.ok || options.acceptedStatuses?.includes(response.status), `SOURCE_HTTP_${response.status}`);
        const contentType = response.headers.get('content-type') ?? '';
        requireValue(type !== 'json' || /application\/(?:[a-z.-]+\+)?json/i.test(contentType), 'SOURCE_CONTENT_TYPE_INVALID');
        requireValue(type !== 'html' || /text\/html/i.test(contentType), 'SOURCE_CONTENT_TYPE_INVALID');
        requireValue(type !== 'xml' || /(?:application\/(?:rss\+)?xml|text\/xml)/i.test(contentType), 'SOURCE_CONTENT_TYPE_INVALID');
        bytes = await boundedBytes(response, options.maxBytes ?? maxBytes); break;
      } catch (error) {
        await response?.body?.cancel().catch(() => {});
        if (error instanceof MonitorError || attempt === 3) throw error instanceof MonitorError ? error : new MonitorError('SOURCE_TRANSPORT_FAILED');
        await sleep(retryDelay(null, attempt));
      }
    }
    const hash = sha256(bytes); const retrieved = new Date().toISOString();
    await immutableWrite(path.join(directory, 'objects', hash + '.raw'), bytes);
    const receipt = { sha256: hash, byte_count: bytes.length, content_type: (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0], source_url: url, retrieved_at: retrieved, storage_key: `regulatory/${hash.slice(0, 2)}/${hash}.raw`, http_status: response.status, publisher_last_modified: response.headers.get('last-modified'), etag: response.headers.get('etag') };
    const existing = captures.find((c) => c.sha256 === hash && c.source_url === url);
    if (!existing) captures.push(receipt);
    await atomicJson(path.join(directory, 'captures.json'), captures);
    let json = null;
    if (type === 'json') { try { json = JSON.parse(bytes.toString('utf8')); } catch { throw new MonitorError('SOURCE_JSON_INVALID'); } }
    return { receipt: existing ?? receipt, bytes, json, text: ['html', 'xml'].includes(type) ? bytes.toString('utf8') : null };
  }
  return { capture, captures };
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', reg: '®', copy: '©', trade: '™', hellip: '…' };
export function htmlText(value) {
  requireValue(typeof value === 'string');
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (raw, key) => {
    if (key[0] === '#') { const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw; }
    return ENTITIES[key.toLowerCase()] ?? raw;
  }).replace(/\s+/g, ' ').trim();
}
export function anchors(value, base, hosts) {
  return [...value.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ url: allowedUrl(new URL(m[1].replace(/&amp;/g, '&'), base).href, hosts), label: htmlText(m[2]) }));
}
export function record(data, captured, pointer) {
  const full = { native_id: data.native_id, title: data.title, document_type: data.document_type, published_on: data.published_on ?? null, source_updated_on: data.source_updated_on ?? null, source_url: data.source_url, agency_ids: data.agency_ids ?? [], agency_names: data.agency_names ?? [], entity_refs: data.entity_refs ?? [], identifiers: data.identifiers ?? [], status: data.status ?? null, fields: data.fields ?? {}, correction_of: data.correction_of ?? [], evidence_excerpt: data.evidence_excerpt ?? '' };
  requireValue(typeof full.native_id === 'string' && full.native_id.length > 0 && typeof full.title === 'string' && full.title.length > 0);
  requireValue(full.title.length <= 2000, 'RECORD_TITLE_TOO_LARGE');
  requireValue(Buffer.byteLength(JSON.stringify(full)) <= 180000, 'RECORD_PAYLOAD_TOO_LARGE');
  if (full.published_on) isoDate(full.published_on); if (full.source_updated_on) isoDate(full.source_updated_on);
  return { schema_version: 'regulatory-record/1', data: full, payload_sha256: payloadHash(full), raw_sha256: captured.receipt.sha256, raw_storage_key: captured.receipt.storage_key, retrieved_at: captured.receipt.retrieved_at, capture_source_url: captured.receipt.source_url, record_pointer: pointer };
}
export function uniqueRecords(rows) {
  const seen = new Map();
  for (const row of rows) { const old = seen.get(row.data.native_id); requireValue(!old, old?.payload_sha256 === row.payload_sha256 ? 'DUPLICATE_SOURCE_RECORD' : 'CONFLICTING_SOURCE_RECORD'); seen.set(row.data.native_id, row); }
  return rows;
}
