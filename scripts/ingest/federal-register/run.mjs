/**
 * Federal Register continuation runner (daily, resumable, checkpointed).
 *
 *   node run.mjs status                       checkpoint + corpus state (read-only)
 *   node run.mjs acquire [--from D] [--through D]
 *   node run.mjs archive                      upload retained raw pages to private storage (sha256 readback)
 *   node run.mjs land    [--dry-run]          corpus_ingest intake in bounded, verified batches
 *   node run.mjs project [--dry-run]          project landed documents to federal_register_history
 *   node run.mjs check [--from D]             fresh API count == acquired == projected, per day (fails on any mismatch)
 *   node run.mjs daily                        acquire -> archive -> land -> project -> check
 *
 * Environment (never written to disk or logs):
 *   FR_PRIVATE_DIR                private working directory (default ~/.cache/legal-source-atlas/federal-register)
 *   EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_KEY | EXTERNAL_SUPABASE_SERVICE_ROLE_KEY
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireRange, apiGet, loadCheckpoint, readPage, saveCheckpoint } from './acquire.mjs';
import { corpusClient } from './corpus.mjs';
import {
  CONTRACT, DATASET, SCHEMA_VERSION, addDays, compareNewestFirst, entityRow, pickFields, projectRecord, sha256, splitBounded,
} from './lib.mjs';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const dryRun = args.includes('--dry-run');
const dir = process.env.FR_PRIVATE_DIR ?? path.join(os.homedir(), '.cache', 'legal-source-atlas', 'federal-register');
const today = () => new Date().toISOString().slice(0, 10);
const log = (o) => console.log(JSON.stringify(o));
const BUCKET = 'corpus-originals';
const HISTORY_FIRST_DAY = '1994-01-03';
const HISTORY_COLLECTED = '2026-08-20';

/* ---- state helpers ---- */

async function corpusHead(corpus) {
  const [head] = await corpus.get(`corpus_records?dataset=eq.${DATASET}&select=id,ordinal,source_url,item&order=ordinal.asc&limit=1`);
  const base = Number(head.id) + Number(head.ordinal);
  return { head, base, publishedThrough: head.item.cells.published, minOrdinal: Number(head.ordinal), total: await corpus.count(`corpus_records?dataset=eq.${DATASET}`) };
}

/** Latest acquired page set per day, as parsed documents with their page provenance. */
function acquiredDocuments(cp) {
  const out = [];
  for (const day of Object.keys(cp.days).sort()) {
    const entry = cp.days[day];
    if (entry.status !== 'acquired') continue;
    for (const page of entry.pages) for (const row of readPage(dir, page).results) out.push({ row, page, day });
  }
  return out;
}

/* ---- commands ---- */

async function status() {
  const corpus = corpusClient();
  const cp = loadCheckpoint(dir);
  const c = await corpusHead(corpus);
  const days = Object.keys(cp.days).sort();
  log({
    corpus: { dataset: DATASET, records: c.total, newestPublished: c.publishedThrough, minOrdinal: c.minOrdinal },
    checkpoint: {
      dir, acquiredDays: days.length, firstDay: days[0] ?? null, lastDay: days.at(-1) ?? null,
      documents: days.reduce((s, d) => s + cp.days[d].actual, 0),
      archived: Object.keys(cp.archived ?? {}).length, landedDocuments: Object.keys(cp.landed ?? {}).length,
      projectedDocuments: Object.keys(cp.projected ?? {}).length,
      runs: Object.fromEntries(Object.entries(cp.runs).map(([id, r]) => [id, { status: r.status, batches: Object.keys(r.batches ?? {}).length, scope: r.scope }])),
    },
  });
}

async function acquire() {
  const corpus = corpusClient();
  const cp = loadCheckpoint(dir);
  const days = Object.keys(cp.days).sort();
  const held = (await corpusHead(corpus)).publishedThrough;
  // Resume from the checkpoint (or, on a fresh machine, from the corpus's newest date). The last
  // three days are always re-read so late additions and corrections are caught.
  const from = flag('--from') ?? addDays(days.length ? days.at(-1) : held, -2);
  const through = flag('--through') ?? today();
  log({ step: 'acquire', from, through });
  const next = await acquireRange(dir, from, through, { recheckDays: 3, log: (m) => console.log(m) });
  saveCheckpoint(dir, next);
}

async function archive() {
  const corpus = corpusClient();
  const cp = loadCheckpoint(dir);
  cp.archived ??= {};
  let uploaded = 0, verified = 0;
  for (const entry of Object.values(cp.days)) {
    const pages = [...entry.pages, ...(entry.history ?? []).flatMap((h) => h.pages)];
    for (const page of pages) {
      if (cp.archived[page.sha256]) continue;
      const bytes = fs.readFileSync(path.join(dir, 'pages', page.sha256 + '.json'));
      if (sha256(bytes) !== page.sha256) throw new Error('Retained page checksum changed');
      const key = `federal-register/sha256/${page.sha256.slice(0, 2)}/${page.sha256}.json`;
      if (dryRun) { uploaded++; continue; }
      try {
        await corpus.request('POST', `${BUCKET}/${key}`, { base: '/storage/v1/object/', raw: bytes, extraHeaders: { 'Content-Type': 'application/json' } });
        uploaded++;
      } catch (error) {
        if (error.status !== 400 && error.status !== 409) throw error; // already present: verified by readback below
      }
      const back = await corpus.request('GET', `authenticated/${BUCKET}/${key}`, { base: '/storage/v1/object/' });
      if (sha256(back.buffer) !== page.sha256 || back.buffer.length !== bytes.length) throw new Error('Storage readback differs from retained bytes');
      cp.archived[page.sha256] = { bucket: BUCKET, key, bytes: bytes.length, verified_at: new Date().toISOString() };
      verified++;
      saveCheckpoint(dir, cp);
    }
  }
  log({ step: 'archive', uploaded, verified, dryRun });
}

function pendingEntities(cp) {
  cp.landed ??= {};
  const rows = [];
  for (const { row, page } of acquiredDocuments(cp)) {
    const e = entityRow(row, page, page.retrieved_at.slice(0, 10));
    if (cp.landed[e.native_id]?.includes(e.provenance.record_sha256)) continue;
    rows.push(e);
  }
  return rows.sort((a, b) => a.data.publication_date.localeCompare(b.data.publication_date) || a.native_id.localeCompare(b.native_id));
}

async function land() {
  const cp = loadCheckpoint(dir);
  cp.landed ??= {};
  let pending = pendingEntities(cp);
  log({ step: 'land', pending: pending.length, dryRun });
  if (!pending.length) return;
  if (dryRun) {
    log({ batches: splitBounded(pending).length, from: pending[0].data.publication_date, through: pending.at(-1).data.publication_date });
    return;
  }
  const corpus = corpusClient();
  let [runId, run] = Object.entries(cp.runs).find(([, r]) => r.status === 'open') ?? [];
  if (!runId) {
    runId = randomUUID();
    const dates = pending.map((r) => r.data.publication_date);
    const scope = {
      source_system: 'federalregister', contract: CONTRACT, schema_version: SCHEMA_VERSION, source_name: 'FederalRegister.gov API v1',
      publication_from: dates[0], publication_through: dates.at(-1), private_only: true,
      selection: 'every document the API lists per publication day (all agencies and types); no topic filter',
    };
    run = { status: 'open', scope, batches: {}, started_at: new Date().toISOString() };
    cp.runs[runId] = run;
    saveCheckpoint(dir, cp);
  }
  const opened = await corpus.rpc('corpus_federal_register_open_run_v1', { p_run: runId, p_scope: run.scope });
  pending = pending.filter((r) => r.data.publication_date >= run.scope.publication_from && r.data.publication_date <= run.scope.publication_through);
  const totals = { received: 0, new_versions: 0, new_observations: 0, entities_written: 0 };
  for (const [index, batch] of splitBounded(pending).entries()) {
    const batchSha = sha256(JSON.stringify(batch.map((r) => [r.native_id, r.provenance.record_sha256])));
    const result = await corpus.rpc('corpus_federal_register_intake_v1', { p_run: runId, p_rows: batch });
    if (result.received !== batch.length) throw new Error('Intake aggregate count mismatch');
    const proof = await corpus.rpc('corpus_federal_register_status_v1', { p_run: runId, p_rows: batch });
    if (proof.expected !== batch.length || proof.versions_matched !== batch.length || proof.observations_matched !== batch.length || proof.conflicts !== 0) {
      throw new Error('Readback verification failed; the batch is idempotent and may be replayed after audit');
    }
    for (const r of batch) (cp.landed[r.native_id] ??= []).push(r.provenance.record_sha256);
    run.batches[index] = { sha256: batchSha, records: batch.length, result, proof };
    for (const k of Object.keys(totals)) totals[k] += result[k];
    saveCheckpoint(dir, cp);
    log({ batch: index, records: batch.length, result, proof });
  }
  const closed = await corpus.rpc('corpus_federal_register_finish_run_v1', { p_run: runId, p_status: 'completed', p_counts: { ...totals, documents: pending.length } });
  run.status = 'completed';
  run.finished_at = new Date().toISOString();
  run.counts = closed.counts;
  saveCheckpoint(dir, cp);
  log({ step: 'land', run: runId, opened: opened.status, closed: closed.status, counts: closed.counts });
}

async function holdsByUrl(corpus, urls) {
  const held = new Set();
  for (let i = 0; i < urls.length; i += 50) {
    const chunk = urls.slice(i, i + 50).map((u) => `"${u}"`).join(',');
    const rows = await corpus.get(`corpus_records?dataset=eq.${DATASET}&select=source_url&source_url=in.(${chunk})`);
    for (const r of rows) held.add(r.source_url);
  }
  return held;
}

async function project() {
  const corpus = corpusClient();
  const cp = loadCheckpoint(dir);
  cp.projected ??= {};
  const landed = cp.landed ?? {};
  const docs = acquiredDocuments(cp).map(({ row, page }) => ({ d: pickFields(row), sha: entityRow(row, page, page.retrieved_at.slice(0, 10)).provenance.record_sha256, page }));
  const notLanded = docs.filter((x) => !landed[x.d.document_number]?.includes(x.sha));
  if (notLanded.length && dryRun) log({ warning: 'not landed yet; a real projection would stop here', documents: notLanded.length });
  else if (notLanded.length) throw new Error(`${notLanded.length} acquired documents are not landed and verified in corpus_ingest; run "land" first`);
  const { head, base, publishedThrough, minOrdinal } = await corpusHead(corpus);
  const unique = new Map();
  for (const x of docs) unique.set(x.d.document_number, x);
  const candidates = [...unique.values()].filter((x) => !cp.projected[x.d.document_number]);
  const heldNow = await holdsByUrl(corpus, candidates.map((x) => `https://www.federalregister.gov/d/${x.d.document_number}`));
  const fresh = candidates.filter((x) => !heldNow.has(`https://www.federalregister.gov/d/${x.d.document_number}`));
  for (const x of candidates) if (heldNow.has(`https://www.federalregister.gov/d/${x.d.document_number}`)) cp.projected[x.d.document_number] ??= { id: 'already-held' };
  // Documents older than the newest held date cannot be placed in chronological order; report, never reorder history.
  const late = fresh.filter((x) => x.d.publication_date < publishedThrough);
  const addable = fresh.filter((x) => x.d.publication_date >= publishedThrough).sort((a, b) => compareNewestFirst(a.d, b.d));
  log({ step: 'project', head: head.source_url, base, publishedThrough, alreadyHeld: candidates.length - fresh.length, toAdd: addable.length, lateNotOrdered: late.map((x) => x.d.document_number), dryRun });
  if (dryRun || !addable.length) return;
  const newest = addable[0].d.publication_date;
  const collected = addable.map((x) => x.page.retrieved_at.slice(0, 10)).sort().at(-1);
  const coverage = { from: HISTORY_FIRST_DAY, through: newest };
  const n = addable.length;
  const records = addable.map((x, i) => {
    const ordinal = minOrdinal - n + i;
    return projectRecord(x.d, { id: String(base - ordinal), ordinal, collected, coverage });
  });
  for (let i = 0; i < records.length; i += 200) {
    const batch = records.slice(i, i + 200);
    await corpus.request('POST', 'corpus_records?on_conflict=dataset,id', { body: batch, prefer: 'resolution=ignore-duplicates,return=minimal' });
    for (const r of batch) cp.projected[r.source_url.split('/').pop()] = { id: r.id, ordinal: r.ordinal, metadata_applied: false };
    saveCheckpoint(dir, cp);
    log({ inserted: Math.min(i + 200, records.length), of: records.length });
  }
  await verifyProjection(corpus, records);
  await updateDatasetMetadata(corpus, cp, addable, coverage, collected);
  saveCheckpoint(dir, cp);
}

async function verifyProjection(corpus, records) {
  const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
  let mismatches = 0;
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const ids = chunk.map((r) => `"${r.id}"`).join(',');
    const live = new Map((await corpus.get(`corpus_records?dataset=eq.${DATASET}&id=in.(${ids})&select=id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters`)).map((r) => [r.id, r]));
    for (const r of chunk) {
      const l = live.get(r.id);
      const keys = ['category', 'state', 'county_geoids', 'title', 'source_url', 'ordinal', 'item', 'detail', 'text', 'filters'];
      if (!l || keys.some((k) => stable(l[k]) !== stable(r[k]))) mismatches++;
    }
  }
  if (mismatches) throw new Error(`Projection readback mismatch on ${mismatches} rows`);
  log({ step: 'verify-projection', rows: records.length, fullFieldMismatches: 0 });
}

async function updateDatasetMetadata(corpus, cp, added, coverage, collected) {
  const [ds] = await corpus.get(`corpus_datasets?id=eq.${DATASET}&select=*`);
  const total = await corpus.count(`corpus_records?dataset=eq.${DATASET}`);
  const pendingMeta = added.filter((x) => cp.projected[x.d.document_number]?.metadata_applied === false);
  const bump = (options, value, by) => { const o = options?.find((x) => String(x.value) === String(value)); if (o) o.count += by; };
  const meta = structuredClone(ds.metadata);
  const sets = [meta.listing?.filters, meta.listing_modes?.default?.filters].filter(Boolean);
  for (const filters of sets) {
    for (const { d } of pendingMeta) {
      bump(filters.find((f) => f.name === 'type')?.options, d.type, 1);
      bump(filters.find((f) => f.name === 'year')?.options, d.publication_date.slice(0, 4), 1);
      for (const id of new Set((d.agencies ?? []).filter((a) => a.id != null).map((a) => a.id))) bump(filters.find((f) => f.name === 'agency')?.options, id, 1);
      for (const t of new Set((d.cfr_references ?? []).filter((r) => r.part != null).map((r) => r.title))) bump(filters.find((f) => f.name === 'cfr_title')?.options, t, 1);
    }
  }
  meta.listing.total = total;
  if (meta.listing_modes?.default) meta.listing_modes.default.total = total;
  if (meta.summary) Object.assign(meta.summary, { records: total, listing_records: total, native_default_records: total });
  const tail = ' CFR parts, agencies, docket identifiers and RINs are the ones the API lists for each document; documents published later, and any later correction, are not included. A document that cites a CFR part may propose, amend, correct or merely discuss it: read the document.';
  const qualificationText = `Federal Register documents published ${coverage.from} to ${coverage.through} as listed by the federalregister.gov API and GovInfo. The historical index was collected on ${HISTORY_COLLECTED}; later publication days are added by daily continuation runs from the same API (latest collection ${collected}, each document records its own collection date).${tail}`;
  for (const l of [meta.listing, meta.listing_modes?.default]) if (l) l.qualification = qualificationText;
  meta.continuations = [...(meta.continuations ?? []), {
    contract: CONTRACT, schema_version: SCHEMA_VERSION, source: 'FederalRegister.gov API v1', published_from: pendingMeta.length ? pendingMeta.map((x) => x.d.publication_date).sort()[0] : null,
    published_through: coverage.through, records_added: pendingMeta.length, collected, runs: Object.keys(cp.runs).filter((id) => cp.runs[id].status === 'completed'), applied_at: new Date().toISOString(),
  }];
  await corpus.request('PATCH', `corpus_datasets?id=eq.${DATASET}`, { body: { expected_records: total, imported_records: total, metadata: meta, updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
  for (const { d } of pendingMeta) cp.projected[d.document_number].metadata_applied = true;
  const [after] = await corpus.get(`corpus_datasets?id=eq.${DATASET}&select=ready,expected_records,imported_records`);
  log({ step: 'dataset-metadata', before: ds.imported_records, after, liveRecordCount: total });
}

/**
 * Independent per-day count check: a fresh API count, the acquired pages and the projected
 * corpus rows must all agree. Any mismatch fails the run.
 */
async function check() {
  const corpus = corpusClient();
  const cp = loadCheckpoint(dir);
  const through = flag('--through') ?? today();
  const from = flag('--from') ?? addDays(through, -6);
  const failures = [];
  for (const day of Object.keys(cp.days).sort()) {
    if (day < from || day > through) continue;
    const u = new URL('https://www.federalregister.gov/api/v1/documents.json');
    u.searchParams.set('per_page', '1');
    u.searchParams.set('conditions[publication_date][gte]', day);
    u.searchParams.set('conditions[publication_date][lte]', day);
    const api = JSON.parse((await apiGet(u.href)).bytes).count;
    const acquired = cp.days[day].actual;
    const projected = await corpus.count(`corpus_records?dataset=eq.${DATASET}&item->cells->>published=eq.${day}`);
    const ok = api === acquired && acquired === projected;
    log({ check: day, api, acquired, projected, ok });
    if (!ok) failures.push({ day, api, acquired, projected });
  }
  if (failures.length) throw new Error(`Day counts disagree: ${JSON.stringify(failures)}`);
  log({ step: 'check', from, through, result: 'all day counts agree' });
}

async function daily() {
  await acquire();
  await archive();
  await land();
  await project();
  await check();
}

const commands = { status, acquire, archive, land, project, check, daily };
if (!commands[command]) {
  console.error('Usage: run.mjs status|acquire|archive|land|project|check|daily [--from D] [--through D] [--dry-run]');
  process.exit(2);
}
try {
  await commands[command]();
} catch (error) {
  console.error(`Stopped: ${error.message}`);
  process.exitCode = 1;
}
