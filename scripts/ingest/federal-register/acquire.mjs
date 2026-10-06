/**
 * Resumable, checkpointed acquisition from the official Federal Register API.
 * One request series per publication day so every day's count can be reconciled
 * exactly. Raw response bytes are retained content-addressed with sha256 and
 * retrieval timestamps. Network only; no corpus credentials are used here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { API_ORIGIN, addDays, dayUrl, eachDay, sha256 } from './lib.mjs';

const MIN_INTERVAL_MS = 1100; // one request per ~1.1 s; the API publishes no hard limit
const USER_AGENT = 'LegalSourceAtlas-corpus-ingest/1.0 (official-source metadata acquisition)';
let last = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function apiGet(url) {
  const u = new URL(url);
  if (u.origin !== API_ORIGIN || !u.pathname.startsWith('/api/v1/') || u.username || u.password) throw new Error('Unexpected source endpoint');
  let lastError;
  for (let attempt = 0; attempt < 7; attempt++) {
    await pause(Math.max(0, MIN_INTERVAL_MS - (Date.now() - last)));
    last = Date.now();
    let response;
    try {
      response = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    } catch (error) {
      lastError = error;
      await pause(Math.min(30000, 1000 * 2 ** attempt));
      continue;
    }
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      return { bytes, status: response.status, retrievedAt: new Date().toISOString() };
    }
    await response.body?.cancel();
    if (response.status !== 429 && response.status < 500) throw new Error(`Federal Register HTTP ${response.status}`);
    const retry = response.headers.get('retry-after');
    const wait = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 0;
    if (wait > 120000) throw new Error(`Federal Register cooldown; resume after ${new Date(Date.now() + wait).toISOString()}`);
    await pause(Math.max(wait, Math.min(30000, 1000 * 2 ** attempt)));
  }
  throw new Error(`Federal Register retries exhausted${lastError ? ' (network)' : ''}; acquisition is resumable`);
}

export function loadCheckpoint(dir) {
  const file = path.join(dir, 'checkpoint.json');
  if (!fs.existsSync(file)) return { schema: 'federal-register-checkpoint/1', days: {}, runs: {}, projected: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function saveCheckpoint(dir, cp) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'checkpoint.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(cp, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}

export function readPage(dir, page) {
  const bytes = fs.readFileSync(path.join(dir, 'pages', page.sha256 + '.json'));
  if (sha256(bytes) !== page.sha256) throw new Error('Retained page checksum changed');
  const data = JSON.parse(bytes);
  if (data.count === 0 && data.results === undefined) data.results = [];
  return data;
}

/** Acquire one publication day; returns the checkpoint entry (not yet persisted). */
export async function acquireDay(dir, day) {
  const pages = [];
  let expected = null;
  const seen = new Set();
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const url = dayUrl(day, page);
    const { bytes, status, retrievedAt } = await apiGet(url);
    const data = JSON.parse(bytes);
    // A day with no publication returns count 0 and no results key.
    if (data.count === 0 && data.results === undefined) data.results = [];
    if (!Array.isArray(data.results) || !Number.isSafeInteger(data.count)) throw new Error('Unexpected Federal Register result shape');
    if (expected !== null && expected !== data.count) throw new Error(`Publisher count changed while acquiring ${day}; retry`);
    expected = data.count;
    if (expected > 9000) throw new Error(`Day ${day} exceeds the bounded API window`);
    for (const row of data.results) {
      if (typeof row.document_number !== 'string' || row.publication_date !== day || seen.has(row.document_number)) {
        throw new Error(`Duplicate or out-of-day record in ${day}: ${row.document_number}`);
      }
      seen.add(row.document_number);
    }
    total += data.results.length;
    const sha = sha256(bytes);
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    const file = path.join(dir, 'pages', sha + '.json');
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' });
    pages.push({ url, sha256: sha, bytes: bytes.length, retrieved_at: retrievedAt, http_status: status, results: data.results.length });
    if (total >= expected) break;
    if (!data.results.length) throw new Error(`Pagination does not reconcile for ${day}`);
  }
  if (total !== expected) throw new Error(`Day ${day}: received ${total} of ${expected}`);
  return { expected, actual: total, status: 'acquired', acquired_at: new Date().toISOString(), pages };
}

/**
 * Acquire every day in [from, through]. Days already acquired are skipped,
 * except the last `recheckDays` days, which are re-acquired because the
 * publisher can add late documents; both versions of the raw pages are kept.
 */
export async function acquireRange(dir, from, through, { recheckDays = 3, log = console.log } = {}) {
  const cp = loadCheckpoint(dir);
  const recheckFrom = addDays(through, -(recheckDays - 1));
  for (const day of eachDay(from, through)) {
    const prior = cp.days[day];
    if (prior?.status === 'acquired' && day < recheckFrom) continue;
    const entry = await acquireDay(dir, day);
    const history = prior?.history ?? [];
    if (prior) history.push({ expected: prior.expected, acquired_at: prior.acquired_at, pages: prior.pages });
    cp.days[day] = { ...entry, history };
    saveCheckpoint(dir, cp);
    log(JSON.stringify({ day, documents: entry.actual, pages: entry.pages.length, reacquired: Boolean(prior) }));
  }
  return cp;
}
