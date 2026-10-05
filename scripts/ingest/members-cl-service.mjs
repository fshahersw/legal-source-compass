// CourtListener REST service for the matter-registry loop (agent: mdl-members).
//
// One long-lived process owns the pass directory's filesystem lock and persisted rolling
// request ledger (scripts/ingest/courtlistener-client.mjs). Work arrives as JSON task files in
// <pass>/queue; the service always runs the lowest `priority` number first, then file name order.
// Every response is cached byte-exact under <pass>/api with a provenance sidecar; normalized,
// append-only observations go to <pass>/live-normalized/<entity_type>.jsonl.
//
// Task types
//   {"type":"docket","docket_id":123}
//   {"type":"docket_lookup","court":"cand","docket_number":"4:22-md-03047"}
//   {"type":"count","kind":"docket-entries","docket_id":123}
//   {"type":"scope","kind":"docket-entries|parties|attorneys","docket_id":123,"max_pages":50,"page_size":100}
//   {"type":"url","url":"https://www.courtlistener.com/api/rest/v4/<endpoint>/?..."}   (one page)
//
// Stops (never bypassed): HTTP 401/403/429 -> the client sets `stopped`; the service exits and
// keeps the queue. No host/proxy changes. Only read-only metadata endpoints are permitted by the
// client. No PDF bytes are requested.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CourtListenerClient, sha256, sleep } from './courtlistener-client.mjs';
import { nativeObservationKey, sourceDocketAllowsRelations, rememberDocketHeader, docketHeaderState, fetchFreshDocketHeader } from './metadata-workflow.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
if (!args.pass) throw new Error('--pass=<pass directory> is required');
const pass = path.resolve(args.pass);
const maxRequests = Number(args['max-requests'] ?? 1300);
const idleExitMinutes = Number(args['idle-exit-minutes'] ?? 0);
const pollMs = Number(args['poll-seconds'] ?? 10) * 1000;
const API = 'https://www.courtlistener.com/api/rest/v4';
const dirs = { queue: path.join(pass, 'queue'), done: path.join(pass, 'done'), failed: path.join(pass, 'failed'), out: path.join(pass, 'live-normalized') };
for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });

const manifestPath = path.join(pass, 'live-backfill-manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8').catch(() => JSON.stringify({ schema_version: 'courtlistener-backfill/1', created_at: new Date().toISOString(), dockets: {}, scopes: {}, counts: {} })));
manifest.counts ??= {};
let saveChain = Promise.resolve();
async function saveManifest() {
  manifest.updated_at = new Date().toISOString();
  const text = JSON.stringify(manifest, null, 2);
  saveChain = saveChain.then(() => fs.writeFile(manifestPath + '.tmp', text).then(() => fs.rename(manifestPath + '.tmp', manifestPath)));
  await saveChain;
}
const state = { pid: process.pid, started_at: new Date().toISOString(), status: 'starting', requests: 0, tasks_done: 0, tasks_failed: 0, last_task: null, last_event_at: null, stop_reason: null };
async function saveState(patch = {}) {
  Object.assign(state, patch, { last_event_at: new Date().toISOString() });
  await fs.writeFile(path.join(pass, 'service-state.json'), JSON.stringify(state, null, 2)).catch(() => {});
}
const log = obj => console.log(JSON.stringify({ t: new Date().toISOString(), ...obj }));

// ---- sinks (append-only, dedupe on the observation key) ----
const sinks = new Map(); const seen = new Map();
// An unchanged header still has a new check time, needed across service restarts.
const observationKey = record => record.entity_type === 'dockets'
  ? JSON.stringify([nativeObservationKey(record), record.provenance.retrieved_at])
  : nativeObservationKey(record);
async function sink(record) {
  const kind = record.entity_type;
  if (!sinks.has(kind)) {
    const filename = path.join(dirs.out, `${kind}.jsonl`);
    const previous = await fs.readFile(filename, 'utf8').catch(() => '');
    seen.set(kind, new Set(previous.trim().split('\n').filter(Boolean).map(x => observationKey(JSON.parse(x)))));
    sinks.set(kind, filename);
  }
  const key = observationKey(record);
  if (seen.get(kind).has(key)) return false;
  await fs.appendFile(sinks.get(kind), JSON.stringify(record) + '\n');
  seen.get(kind).add(key);
  return true;
}
const envelope = (entityType, item, provenance) => ({ schema_version: 'courtlistener-rest-v4.7/1', source_system: 'courtlistener', entity_type: entityType, native_id: String(item.id), data: item, provenance: { ...provenance, record_sha256: sha256(JSON.stringify(item)) } });

// ---- docket header map (blocking flags gate relation collection) ----
const docketHeaders = new Map();
async function loadHeaders(file) {
  for (const line of (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean)) {
    try { rememberDocketHeader(docketHeaders, JSON.parse(line)); } catch { /* unverifiable header is ignored */ }
  }
}
await loadHeaders(path.join(pass, 'source-docket-headers.jsonl'));
await loadHeaders(path.join(dirs.out, 'dockets.jsonl'));

const client = new CourtListenerClient(pass, maxRequests);

async function fetchDocket(id) {
  const rec = await fetchFreshDocketHeader(client, id);
  const {data, provenance} = rec;
  rememberDocketHeader(docketHeaders, rec);
  await sink(rec);
  manifest.dockets[id] = { status: 'complete', retrieved_at: provenance.retrieved_at, source_modified_at: data.date_modified ?? null, court_id: data.court_id ?? null, docket_number: data.docket_number ?? null };
  await saveManifest();
  return { id: data.id, court_id: data.court_id, docket_number: data.docket_number, case_name: data.case_name, assigned_to_id: data.assigned_to_id ?? null, referred_to_id: data.referred_to_id ?? null, date_filed: data.date_filed, date_terminated: data.date_terminated, blocked: data.blocked };
}

async function docketLookup(task) {
  const params = new URLSearchParams({ court: task.court, docket_number: task.docket_number });
  const url = `${API}/dockets/?${params}`;
  const { data, provenance } = await client.request(url);
  if (!Array.isArray(data.results)) throw new Error('Expected paginated results');
  const rows = [];
  for (const item of data.results) {
    const rec = envelope('dockets', item, provenance);
    try { rememberDocketHeader(docketHeaders, rec); } catch { /* keep going; header unverifiable */ }
    await sink(rec);
    manifest.dockets[item.id] = { status: 'complete', via: 'lookup', retrieved_at: provenance.retrieved_at, source_modified_at: item.date_modified ?? null, court_id: item.court_id ?? null, docket_number: item.docket_number ?? null };
    rows.push({ id: item.id, court_id: item.court_id, docket_number: item.docket_number, case_name: item.case_name, assigned_to_id: item.assigned_to_id ?? null, date_filed: item.date_filed, date_terminated: item.date_terminated, pacer_case_id: item.pacer_case_id ?? null, blocked: item.blocked });
  }
  await saveManifest();
  return { lookup: { court: task.court, docket_number: task.docket_number }, count: rows.length, next: data.next ?? null, rows };
}

async function countScope(task) {
  const id = task.docket_id; const kind = task.kind ?? 'docket-entries';
  const { data, provenance } = await client.request(`${API}/${kind}/?docket=${id}&count=on`);
  if (!Number.isInteger(data.count)) throw new Error('Count response missing exact count');
  manifest.counts[`${kind}:${id}`] = { count: data.count, observed_at: provenance.retrieved_at, source_url: provenance.source_url, source_sha256: provenance.source_sha256 };
  await saveManifest();
  return { kind, docket_id: id, count: data.count };
}

function withPageSize(url, pageSize) {
  if (!pageSize) return url;
  const u = new URL(url);
  if (!u.searchParams.has('page_size')) u.searchParams.set('page_size', String(pageSize));
  return u.toString();
}

async function runScope(task) {
  const id = task.docket_id; const kind = task.kind;
  if (!['docket-entries', 'parties', 'attorneys'].includes(kind)) throw new Error('Unsupported scope kind');
  const key = `${kind}:${id}`;
  if (manifest.scopes[key]?.complete && !task.force) return { scope: key, skipped: 'already complete' };
  const headerState = docketHeaderState(docketHeaders.get(String(id)));
  if (headerState === 'missing' || headerState === 'stale') await fetchDocket(id);
  if (!sourceDocketAllowsRelations(docketHeaders.get(String(id))?.data)) {
    manifest.scopes[key] = { ...(manifest.scopes[key] ?? {}), complete: false, status: 'source_blocked_or_missing_header', docket_id: id, updated_at: new Date().toISOString() };
    await saveManifest();
    return { scope: key, held: 'source_blocked_or_missing_header' };
  }
  const params = new URLSearchParams(kind === 'docket-entries' ? { docket: String(id), order_by: '-date_created', omit: 'recap_documents__plain_text' } : { docket: String(id), filter_nested_results: 'True', order_by: 'id' });
  const start = withPageSize(manifest.scopes[key]?.next ?? `${API}/${kind}/?${params}`, task.page_size);
  const previous = manifest.scopes[key] ?? {};
  let lastPageSize = null;
  const checkpoint = async progress => {
    manifest.scopes[key] = { ...progress, records: (previous.records ?? 0) + progress.records, pages: (previous.pages ?? 0) + progress.pages, updated_at: new Date().toISOString(), docket_id: id, page_size: task.page_size ?? previous.page_size ?? null };
    await saveManifest();
    state.requests = client.requests; await saveState({ status: 'running', current_scope: key, scope_records: manifest.scopes[key].records });
  };
  const wrappedSink = async rec => { lastPageSize = lastPageSize ?? null; return sink(rec); };
  const result = await client.paginate(start, kind, wrappedSink, { maxPages: task.max_pages ?? 1000, onPage: checkpoint });
  await checkpoint(result);
  return { scope: key, records_this_task: result.records, pages_this_task: result.pages, complete: result.complete, next: result.next ? '(cursor retained)' : null, cumulative_records: manifest.scopes[key].records };
}

async function runUrl(task) {
  const u = new URL(task.url);
  const m = u.pathname.match(/^\/api\/rest\/v4\/([^/]+)\//);
  if (!m) throw new Error('Bad endpoint');
  const { data, provenance } = await client.request(task.url);
  const results = Array.isArray(data.results) ? data.results : [data];
  const written = [];
  for (const item of results) if (item.id !== undefined) written.push(await sink(envelope(m[1], item, provenance)));
  return { endpoint: m[1], returned: results.length, new_observations: written.filter(Boolean).length, next: data.next ?? null };
}

async function listTasks() {
  const names = (await fs.readdir(dirs.queue)).filter(n => n.endsWith('.json')).sort();
  const tasks = [];
  for (const n of names) {
    try { const t = JSON.parse(await fs.readFile(path.join(dirs.queue, n), 'utf8')); tasks.push({ name: n, task: t }); }
    catch { /* partially written file: pick up next loop */ }
  }
  tasks.sort((a, b) => (a.task.priority ?? 5) - (b.task.priority ?? 5) || a.name.localeCompare(b.name));
  return tasks;
}

async function execute(task) {
  switch (task.type) {
    case 'docket': return fetchDocket(task.docket_id);
    case 'docket_lookup': return docketLookup(task);
    case 'count': return countScope(task);
    case 'scope': return runScope(task);
    case 'url': return runUrl(task);
    default: throw new Error(`Unknown task type ${task.type}`);
  }
}

let idleSince = Date.now();
try {
  await client.initialize();
  await saveState({ status: 'running' });
  log({ event: 'service_started', pass, maxRequests });
  while (true) {
    if (await fs.stat(path.join(pass, 'STOP')).then(() => true, () => false)) { log({ event: 'stop_file' }); break; }
    if (client.stopped) { log({ event: 'client_stopped', reason: client.stopped }); break; }
    const tasks = await listTasks();
    if (!tasks.length) {
      await saveState({ status: 'idle', pending: 0 });
      if (idleExitMinutes && Date.now() - idleSince > idleExitMinutes * 60000) { log({ event: 'idle_exit' }); break; }
      await sleep(pollMs); continue;
    }
    idleSince = Date.now();
    const { name, task } = tasks[0];
    const attempt = (task.attempts ?? 0) + 1;
    await saveState({ status: 'running', last_task: name, pending: tasks.length });
    try {
      const result = await execute(task);
      await fs.writeFile(path.join(dirs.done, name), JSON.stringify({ task, result, finished_at: new Date().toISOString(), requests_total: client.requests }, null, 1));
      await fs.unlink(path.join(dirs.queue, name));
      state.tasks_done++; state.requests = client.requests;
      log({ event: 'task_done', name, requests: client.requests, result });
    } catch (e) {
      const msg = String(e.message ?? e);
      log({ event: 'task_error', name, attempt, error: msg });
      if (/RATE_LIMIT_STOP|AUTHORIZATION_STOP|REQUEST_BUDGET_REACHED|RATE_WINDOW_DEFERRED|CACHE_EVIDENCE_|CACHE_ARCHIVE_/.test(msg)) { state.stop_reason = msg; break; }
      if (attempt >= 3) {
        await fs.writeFile(path.join(dirs.failed, name), JSON.stringify({ task, error: msg, attempts: attempt, failed_at: new Date().toISOString() }, null, 1));
        await fs.unlink(path.join(dirs.queue, name)); state.tasks_failed++;
      } else {
        await fs.writeFile(path.join(dirs.queue, name), JSON.stringify({ ...task, attempts: attempt, last_error: msg }, null, 1));
        await sleep(5000);
      }
    }
    await saveState({ status: 'running' });
  }
  await saveState({ status: state.stop_reason ? 'stopped' : 'exited', stop_reason: state.stop_reason ?? client.stopped ?? null });
} catch (e) {
  log({ event: 'fatal', error: String(e.message ?? e) });
  await saveState({ status: 'failed', stop_reason: String(e.message ?? e) });
  process.exitCode = 1;
} finally {
  await saveManifest().catch(() => {});
  await client.close().catch(() => {});
  log({ event: 'service_exit', requests: client.requests });
}
