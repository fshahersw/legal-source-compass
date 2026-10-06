// Resumable, checkpointed gap-fill collector (CourtListener REST v4 + DocketBird REST). STAGE ONLY: this tool has no
// code path that writes to Supabase. Staged JSONL follows the existing corpus_ingest envelopes and is sent by the
// existing importers (members-import-cl.mjs for CourtListener) or the docketbird-rest wrapper once an open run exists.
//
//   COURTLISTENER_API_TOKEN=... DOCKETBIRD_API_KEY=... node scripts/ingest/gap-fill/run-gap-fill.mjs \
//     --work=<dir> --targets=<targets.jsonl> [--discover-docketbird] [--baseline=<matters.jsonl>] \
//     [--cl-max-requests=20] [--cl-reserve=30] [--db-max-requests=40] [--plan-only]
//
// Target lines (JSONL):
//   {"kind":"cl-docket","docket_id":123}                       GET /dockets/123/
//   {"kind":"cl-find","court":"njd","docket_number":"2:24-md-03113"}   GET /dockets/?court=&docket_number= (exact filters)
//   {"kind":"cl-entries","docket_id":123,"max_pages":2}        GET /docket-entries/?docket=123 (cursor-paged, checkpointed per page)
//   {"kind":"cl-entry","entry_id":123}                    GET /docket-entries/123/ (one native entry; used to re-check blank descriptions)
//   {"kind":"cl-parties","docket_id":123,"max_pages":2}        GET /parties/?docket=123&filter_nested_results=True
//   {"kind":"db-case","case_id":"njd-2:2024-md-03113"}          GET /documents?case_id=  (tracked cases only; never follows a case)
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicWriteJson, readJson, appendJsonl, sha256, decideField, docketKey, isBlank} from './lib.mjs';
import {CourtListener, DocketBird, Stop, CL_ORIGIN} from './clients.mjs';
import {clRow, dbCaseRow, dbDocumentRow, clDocketFields, dbCaseFields, indexBaselineByDocketKey} from './normalize.mjs';

export const CHECKPOINT_SCHEMA = 'gap-fill-checkpoint/1';
const CONTACT_KEYS = new Set(['contact_raw', 'email', 'phone', 'fax', 'address', 'address1', 'address2', 'city', 'state', 'zip_code', 'website']);

export const taskId = t => sha256(JSON.stringify(Object.fromEntries(Object.entries(t).filter(([k]) => !['max_pages','priority','mdl_label','complaint'].includes(k)).sort()))).slice(0, 16);

/** Counsel appear by name, firm and role only. Contact fields are removed from staged rows; the raw response keeps them privately. */
export function stripContactFields(value, removed = new Set()) {
  if (Array.isArray(value)) return value.map(v => stripContactFields(v, removed));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) { if (CONTACT_KEYS.has(k)) { removed.add(k); continue; } out[k] = stripContactFields(v, removed); }
    return out;
  }
  return value;
}

export class Runner {
  constructor({work, cl, db, baseline = null}) {
    Object.assign(this, {work, cl, db, baseline, stage: path.join(work, 'stage'), ckFile: path.join(work, 'checkpoint.json'), keys: new Set()});
  }
  async init() {
    this.ck = await readJson(this.ckFile, {schema: CHECKPOINT_SCHEMA, created_at: new Date().toISOString(), tasks: {}, stops: {}, counters: {}});
    if (this.ck.schema !== CHECKPOINT_SCHEMA) throw new Error('CHECKPOINT_SCHEMA_MISMATCH');
    // A stop describes the previous process; the provider's live quota/auth state is re-detected on the first request.
    this.ck.last_stops = this.ck.stops; this.ck.stops = {};
    try { for (const l of (await fs.readFile(path.join(this.stage, 'keys.txt'), 'utf8')).split('\n')) if (l) this.keys.add(l); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return this;
  }
  save() {
    this.saving = (this.saving ?? Promise.resolve()).then(() => { this.ck.updated_at = new Date().toISOString(); return atomicWriteJson(this.ckFile, this.ck); });
    return this.saving;
  }
  bump(k, n = 1) { this.ck.counters[k] = (this.ck.counters[k] ?? 0) + n; }

  async emit(file, row) {
    const key = `${row.source_system}|${row.entity_type}|${row.native_id}|${row.provenance.record_sha256}|${row.provenance.source_url}`;
    if (this.keys.has(key)) { this.bump('rows_deduplicated_on_resume'); return false; }
    await appendJsonl(path.join(this.stage, file), row);
    await fs.appendFile(path.join(this.stage, 'keys.txt'), key + '\n');
    this.keys.add(key); this.bump(`rows_staged.${row.source_system}.${row.entity_type}`);
    return true;
  }

  /** Compare incoming fields with the baseline row sharing the exact provider-neutral docket key. Nothing is ever applied. */
  async reconcile({key, entity, native_id, incoming, source, receipt}) {
    if (!this.baseline) return;
    const hit = key ? this.baseline.get(key) : null;
    const base = {entity, native_id, docket_key: key, source, source_url: receipt.source_url, retrieved_at: receipt.retrieved_at, source_sha256: receipt.source_sha256};
    if (!hit) { await appendJsonl(path.join(this.stage, 'field-decisions.jsonl'), {...base, result: 'no_baseline_match'}); this.bump('baseline_no_match'); return; }
    if (hit.ambiguous) { await appendJsonl(path.join(this.stage, 'field-decisions.jsonl'), {...base, result: 'ambiguous_baseline_key_held'}); this.bump('baseline_ambiguous'); return; }
    for (const [field, value] of Object.entries(incoming)) {
      if (!(field in hit.row) && field !== 'case_name') continue;
      const decision = decideField({field, existing: {value: hit.row[field], source: hit.source}, incoming: {value, source}});
      this.bump(`field_${decision.action}`);
      await appendJsonl(path.join(this.stage, decision.action === 'conflict' ? 'conflicts.jsonl' : 'field-decisions.jsonl'), {...base, baseline_record_id: hit.row.record_id ?? null, ...decision});
    }
  }

  async runClDocket(t, st) {
    const url = `${CL_ORIGIN}/api/rest/v4/dockets/${Number(t.docket_id)}/`;
    const {data, receipt} = await this.cl.get(url);
    if (!data) { st.status = 'held'; st.note = 'HTTP 404 from source'; return; }
    await this.emit('live-normalized/dockets.jsonl', clRow('dockets', data, receipt));
    await this.reconcile({key: docketKey(data.court_id, data.docket_number), entity: 'dockets', native_id: String(data.id), incoming: clDocketFields(data), source: 'courtlistener', receipt});
    st.status = 'complete'; st.records = 1;
  }
  async runClFind(t, st) {
    // The registry prints docket numbers without zero padding or case type ("1:18-45090"); CourtListener stores "1:18-op-45090". Query the court's
    // docket_number_core (yy + 5-digit sequence) and classify the candidates locally on court + office + year + sequence + type.
    const m = String(t.docket_number).match(/^(\d{1,2}):(\d{2}|\d{4})-?(?:([a-z]{2,4})-?)?(\d{1,6})/i);
    const core = m ? `${m[2].slice(-2)}${m[4].padStart(5, '0')}` : null;
    const q = new URLSearchParams(core ? {court: t.court, docket_number_core: core} : {court: t.court, docket_number: t.docket_number});
    const {data, receipt} = await this.cl.get(`${CL_ORIGIN}/api/rest/v4/dockets/?${q}`);
    const results = data?.results ?? [];
    for (const d of results) await this.emit('live-normalized/dockets.jsonl', clRow('dockets', d, receipt));
    st.status = 'complete'; st.records = results.length;
    const key = d => { const x = String(d.docket_number ?? '').match(/^(\d{1,2}):(\d{2}|\d{4})-?([a-z]{2,4})?-?(\d{1,6})/i); return x ? {office: Number(x[1]), year: x[2].slice(-2), type: (x[3] ?? '').toLowerCase(), seq: String(Number(x[4]))} : null; };
    const want = m ? {office: Number(m[1]), year: m[2].slice(-2), type: (m[3] ?? '').toLowerCase(), seq: String(Number(m[4]))} : null;
    const same = results.filter(d => { const k = key(d); return want && k && k.office === want.office && k.year === want.year && k.seq === want.seq; });
    // A number printed without a case type is assumed civil (`cv`) by the registry; a different CourtListener type is a variant, never an exact match.
    const exact = same.filter(d => key(d).type === (want?.type || 'cv'));
    st.resolution = exact.length === 1 && same.length === 1 ? 'unique_exact_court_office_year_type_sequence' : same.length === 1 ? 'unique_type_variant_candidate_not_accepted' : same.length === 0 ? 'no_exact_match' : 'ambiguous_multiple_native_dockets_held';
    st.candidate_native_ids = same.map(d => String(d.id)); st.candidate_types = same.map(d => key(d).type);
    if (data?.next) st.note = 'more candidates exist beyond first page; resolution held';
  }
  async runClEntry(t, st) {
    const {data, receipt} = await this.cl.get(`${CL_ORIGIN}/api/rest/v4/docket-entries/${Number(t.entry_id)}/`);
    if (!data) { st.status = 'held'; st.note = 'HTTP 404 from source'; return; }
    if (String(data.id) !== String(t.entry_id)) throw new Stop('IDENTITY_MISMATCH', String(t.entry_id));
    await this.emit('live-normalized/docket-entries.jsonl', clRow('docket-entries', data, receipt));
    st.status = 'complete'; st.records = 1; st.description_present = !isBlank(data.description);
  }
  async runClPaged(t, st, endpoint, entityType, file, transform = x => x) {
    const maxPages = t.max_pages ?? 1;
    let next = st.next ?? (endpoint === 'docket-entries'
      ? `${CL_ORIGIN}/api/rest/v4/docket-entries/?${new URLSearchParams({docket: String(t.docket_id), order_by: 'entry_number'})}`
      : `${CL_ORIGIN}/api/rest/v4/parties/?${new URLSearchParams({docket: String(t.docket_id), filter_nested_results: 'True'})}`);
    st.pages ??= 0; st.records ??= 0;
    while (next && st.pages < maxPages) {
      const {data, receipt} = await this.cl.get(next);
      if (!data || !Array.isArray(data.results)) throw new Stop('UNEXPECTED_SHAPE', endpoint);
      for (const item of data.results) {
        const removed = new Set();
        const clean = transform(item, removed);
        await this.emit(file, clRow(entityType, clean, receipt, removed.size ? {contact_fields_removed: [...removed].sort()} : {}));
        st.records++;
      }
      st.pages++; st.next = data.next ?? null; next = st.next;
      st.status = st.next ? 'partial' : 'complete';
      await this.save();
    }
    if (st.next && st.pages >= maxPages) st.status = 'partial';
  }
  async runDbCase(t, st) {
    const {data, untracked, timeout, transient, receipt} = await this.db.get('/documents', {case_id: t.case_id});
    if (transient) { st.status = 'pending'; st.note = 'Provider 502/503 after retries; will retry on next pass'; st.attempts = (st.attempts ?? 0) + 1; if (st.attempts >= 5) { st.status = 'held'; st.note = 'Provider 5xx on 5 passes'; } return; }
    if (untracked) { st.status = 'held'; st.note = 'Not a case tracked by this account; the provider requires following it (charges may apply). Not followed.'; return; }
    if (timeout) { st.status = 'held'; st.note = 'Provider gateway timeout (very large docket); retry later or use paged tool'; return; }
    const header = data.case;
    if (header?.id !== t.case_id) throw new Stop('IDENTITY_MISMATCH', t.case_id);
    await this.emit('docketbird-rest/case.jsonl', dbCaseRow(header, receipt, {complaint: t.complaint}));
    await this.reconcile({key: docketKeyFromId(header.id), entity: 'case', native_id: header.id, incoming: dbCaseFields(header), source: 'docketbird', receipt});
    let n = 0;
    for (const doc of data.documents ?? []) { await this.emit('docketbird-rest/docket-document.jsonl', dbDocumentRow(t.case_id, doc, receipt)); n++; }
    st.status = 'complete'; st.records = n; st.provider_documents = n;
  }

  async runTask(t) {
    const id = taskId(t);
    const st = this.ck.tasks[id] ??= {task: t, status: 'pending'};
    if (st.status === 'complete' || st.status === 'held') return st;
    const provider = t.kind.startsWith('cl-') ? 'courtlistener' : 'docketbird';
    if (this.ck.stops[provider]) { st.deferred = this.ck.stops[provider]; return st; }
    try {
      if (t.kind === 'cl-docket') await this.runClDocket(t, st);
      else if (t.kind === 'cl-find') await this.runClFind(t, st);
      else if (t.kind === 'cl-entry') await this.runClEntry(t, st);
      else if (t.kind === 'cl-entries') await this.runClPaged(t, st, 'docket-entries', 'docket-entries', 'live-normalized/docket-entries.jsonl');
      else if (t.kind === 'cl-parties') await this.runClPaged(t, st, 'parties', 'parties', 'live-normalized/parties.jsonl', (x, removed) => stripContactFields(x, removed));
      else if (t.kind === 'db-case') await this.runDbCase(t, st);
      else throw new Error('UNKNOWN_TASK_KIND ' + t.kind);
      delete st.deferred; delete st.error;
    } catch (e) {
      if (e instanceof Stop) { this.ck.stops[provider] = e.message; st.deferred = e.message; }
      else { st.status = 'error'; st.error = String(e.message).slice(0, 300); }
    }
    st.updated_at = new Date().toISOString();
    await this.save();
    return st;
  }
}

import {docketKeyFromDocketBirdId as docketKeyFromId} from './lib.mjs';

export async function loadTargets(file) {
  return (await fs.readFile(file, 'utf8')).split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = Object.fromEntries(argv.map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  if (!args.work) throw new Error('--work=<dir> is required');
  const work = path.resolve(args.work);
  const targets = args.targets ? await loadTargets(args.targets) : [];
  let baseline = null;
  if (args.baseline) baseline = indexBaselineByDocketKey((await fs.readFile(args.baseline, 'utf8')).split('\n').filter(Boolean).map(l => ({...JSON.parse(l), source: 'baseline'})));
  if (args['plan-only']) {
    const ck = await readJson(path.join(work, 'checkpoint.json'), {tasks: {}});
    const plan = targets.map(t => ({id: taskId(t), kind: t.kind, status: ck.tasks[taskId(t)]?.status ?? 'pending'}));
    console.log(JSON.stringify({plan_only: true, tasks: plan.length, by_status: plan.reduce((a, p) => (a[p.status] = (a[p.status] ?? 0) + 1, a), {})}));
    return;
  }
  const cl = new CourtListener({cacheDir: path.join(work, 'raw-cl'), reserve: Number(args['cl-reserve'] ?? 30), maxRequests: Number(args['cl-max-requests'] ?? 20)});
  const db = new DocketBird({cacheDir: path.join(work, 'raw-db'), maxRequests: Number(args['db-max-requests'] ?? 40)});
  const runner = await new Runner({work, cl, db, baseline}).init();
  if (args['discover-docketbird']) {
    try {
      const {data, receipt} = await db.get('/cases', {scope: 'company'});
      await appendJsonl(path.join(work, 'stage', 'docketbird-rest', 'tracked-cases-receipts.jsonl'), {retrieved_at: receipt.retrieved_at, source_sha256: receipt.source_sha256, cases: data.cases.length});
      for (const c of data.cases) targets.push({kind: 'db-case', case_id: c.id, complaint: {complaint_document_id: c.complaint_document_id, complaint_status: c.complaint_status}});
    } catch (e) { if (!(e instanceof Stop)) throw e; runner.ck.stops.docketbird = e.message; await runner.save(); }
  }
  targets.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));
  const lane = provider => targets.filter(t => (t.kind.startsWith('cl-') ? 'courtlistener' : 'docketbird') === provider);
  const passes = Number(args.passes ?? 3);
  const drain = async provider => {
    for (let pass = 0; pass < passes; pass++) {
      for (const t of lane(provider)) await runner.runTask(t);
      const retry = lane(provider).some(t => runner.ck.tasks[taskId(t)]?.status === 'pending' && !runner.ck.stops[provider]);
      if (!retry) break;
    }
  };
  await Promise.all([drain('courtlistener'), drain('docketbird')]);
  const by = {}; for (const s of Object.values(runner.ck.tasks)) by[s.status] = (by[s.status] ?? 0) + 1;
  console.log(JSON.stringify({tasks: Object.keys(runner.ck.tasks).length, by_status: by, stops: runner.ck.stops, counters: runner.ck.counters, cl_requests: cl.requests, docketbird_requests: db.requests}));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(String(e.message ?? e).replace(/[A-Za-z0-9]{32,}/g, '[redacted]')); process.exitCode = 1; });
}
