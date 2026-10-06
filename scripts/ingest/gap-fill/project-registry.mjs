// Versioned, reversible projection of source-attributed gap fills into the public registry read model
// (public.corpus_records, dataset sw_matter_dockets_v1 and cl_docket_metadata). Blanks first, then the approved date-semantics correction.
//
//   node project-registry.mjs --phase=blanks|dates|mdl --decisions=<dir> --ledger=<file.jsonl> [--limit=N] [--apply]
//   node project-registry.mjs --revert=<ledger.jsonl> [--phase=...] [--apply]
//
// Every change is recorded in the ledger as {id, dataset, ops:[{path, before, after}]}; reverting restores `before` only where the
// current value still equals `after`. Nothing is ever deleted; a displaced date is kept in a labelled field. Held rows are listed
// with the reason and the conflict stays recorded. Only item/detail/filters of rows already present are PATCHed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {isBlank, appendJsonl, sha256} from './lib.mjs';
import {Live} from './gap-analysis-live.mjs';

export const RUN_ID = '05eea679-6570-4812-989a-53369021ab6d';
export const ARCHIVE_SHA = 'f40588851cee0d95696c40b8740106473f83ea3ffd8745799e03c42a15b9399b';
export const FJC_SHA = '7615684b31e06199a20f0ecd1424398f4cca0f17fd3797ccd637e0669492d957';
export const BULK_URL = 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-2026-09-30.csv.bz2';
export const REOPEN_ORIGINS = new Set(['4', '8', '9', '10', '11', '12', 'A', 'B', 'C', 'D', 'E']);
export const ORIGINAL_ORIGINS = new Set(['1', '2', '3', '13']);
const blank = v => isBlank(v) || /^not recorded$/i.test(String(v).trim());
const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const stable = v => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'undefined');
/** Order-insensitive: jsonb does not preserve object key order. */
export const sameJson = (a, b) => stable(a) === stable(b);

/** Path-tracked mutation of {item, detail, filters}; each set records before/after for the ledger. */
export class Patch {
  constructor(cols) { this.cols = clone(cols); this.ops = []; }
  get(p) { return p.reduce((o, k) => (o == null ? undefined : o[k]), this.cols); }
  set(p, value) {
    const before = clone(this.get(p));
    if (sameJson(before, value)) return;
    let o = this.cols; for (const k of p.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    o[p.at(-1)] = clone(value);
    const existing = this.ops.find(x => sameJson(x.path, p));
    if (existing) existing.after = clone(value); else this.ops.push({path: p, before, after: clone(value)});
  }
}

export function applyOps(cols, ops, direction) {
  const next = clone(cols), skipped = [];
  for (const op of direction === 'revert' ? [...ops].reverse() : ops) {
    const want = direction === 'revert' ? op.after : op.before, set = direction === 'revert' ? op.before : op.after;
    let o = next, ok = true;
    for (const k of op.path.slice(0, -1)) { if (o?.[k] == null) { ok = false; break; } o = o[k]; }
    const cur = ok ? o[op.path.at(-1)] : undefined;
    if (sameJson(cur, set)) continue;
    if (!sameJson(cur, want)) { skipped.push({path: op.path, reason: 'current value differs from the ledger'}); continue; }
    if (set === undefined) delete o[op.path.at(-1)]; else { if (!ok) continue; o[op.path.at(-1)] = clone(set); }
  }
  return {cols: next, skipped};
}

function setFact(patch, label, value, afterLabel) {
  const facts = clone(patch.get(['detail', 'facts'])) ?? [];
  const i = facts.findIndex(f => f[0] === label);
  if (i >= 0) facts[i] = [label, value]; else { const j = afterLabel ? facts.findIndex(f => f[0] === afterLabel) : -1; facts.splice(j >= 0 ? j + 1 : facts.length, 0, [label, value]); }
  patch.set(['detail', 'facts'], facts);
}
function insertFactAfter(patch, afterLabel, label, value) {
  const facts = clone(patch.get(['detail', 'facts'])) ?? [];
  const i = facts.findIndex(f => f[0] === label);
  if (i >= 0) facts[i] = [label, value]; else { const j = facts.findIndex(f => f[0] === afterLabel); facts.splice(j >= 0 ? j + 1 : facts.length, 0, [label, value]); }
  patch.set(['detail', 'facts'], facts);
}
const keyYear = id => (id.match(/:(\d{4})-[a-z]{2,4}-\d+$/) ?? [])[1] ?? null;
const sourceText = (what, g) => `${what}: CourtListener bulk 2026-09-30, archive sha256 ${ARCHIVE_SHA.slice(0, 12)}…, source row ${g.source_row_ordinal}, native docket ${g.native_id}`;

/**
 * Plan one registry docket. `d` = {filed, terminated, native, conflict} decisions (bulk), `ev` = bulk evidence data by native id.
 * Returns {patch, applied:[...], held:[{field, reason}]}.
 */
export function planDocket(row, d, evByNative, phase, now) {
  const patch = new Patch({item: row.item, detail: row.detail, filters: row.filters});
  const cells = row.item?.cells ?? {};
  const year = keyYear(row.id);
  const applied = [], held = [], gapfill = [];
  const curFiled = blank(cells.filed) ? null : cells.filed, curTerm = blank(cells.terminated) ? null : cells.terminated;
  let filed = curFiled, term = curTerm;

  if (phase === 'blanks') {
    const f = d.filed && curFiled === null ? d.filed : null, t = d.terminated && curTerm === null ? d.terminated : null;
    let fillFiled = f?.value ?? null, fillTerm = t?.value ?? null;
    if (fillFiled && year && fillFiled.slice(0, 4) !== year) { held.push({field: 'filed', reason: 'filed year disagrees with docket-number year', value: fillFiled}); fillFiled = null; }
    const effFiled = fillFiled ?? curFiled, effTerm = fillTerm ?? curTerm;
    if (effFiled && effTerm && effTerm < effFiled) {
      if (fillFiled) { held.push({field: 'filed', reason: 'filed would be later than termination', value: fillFiled}); fillFiled = null; }
      if (fillTerm) { held.push({field: 'terminated', reason: 'termination earlier than filed', value: fillTerm}); fillTerm = null; }
    }
    if (fillFiled) { filed = fillFiled; gapfill.push({field: 'filed', value: fillFiled, g: f}); }
    if (fillTerm) { term = fillTerm; gapfill.push({field: 'terminated', value: fillTerm, g: t}); }
    if (fillFiled) {
      patch.set(['item', 'cells', 'filed'], fillFiled);
      patch.set(['item', 'subtitle'], String(row.item.subtitle ?? '').replace(/· filed not recorded$/, `· filed ${fillFiled}`));
      patch.set(['filters', 'year'], fillFiled.slice(0, 4));
      insertFactAfter(patch, 'Filed', 'Filed — source', sourceText('Filed', f));
      setFact(patch, 'Filed', fillFiled);
    }
    if (fillTerm) {
      patch.set(['item', 'cells', 'terminated'], fillTerm);
      patch.set(['item', 'cells', 'status'], 'header_terminated');
      patch.set(['filters', 'status'], 'header_terminated');
      setFact(patch, 'Docket header termination date', fillTerm);
      insertFactAfter(patch, 'Docket header termination date', 'Docket header termination date — source', sourceText('Terminated', t));
    }
    const n = d.native;
    const clIds = (row.detail?.registry?.native_case_ids ?? []).filter(x => /^\d+$/.test(String(x?.id)));
    if (n && !clIds.length) {
      const pacer = evByNative.get(n.native_id)?.pacer_case_id ?? null;
      const entry = {id: n.native_id, provider: 'courtlistener', source_system: 'courtlistener', pacer_case_id: pacer, resolution_basis: 'exact_docket_key_bulk_2026-09-30'};
      patch.set(['detail', 'registry', 'native_case_ids'], [...(row.detail?.registry?.native_case_ids ?? []), entry]);
      const strings = [...(row.filters?.native_case_id ?? []), n.native_id];
      patch.set(['filters', 'native_case_id'], strings);
      const url = `https://www.courtlistener.com/docket/${n.native_id}/`;
      for (const col of ['item', 'detail']) {
        const links = clone(patch.get([col, 'links'])) ?? [];
        if (!links.some(l => l.url === url)) { links.push({url, label: 'CourtListener docket'}); patch.set([col, 'links'], links); }
      }
      const facts = patch.get(['detail', 'facts']) ?? [];
      const cur = (facts.find(f => f[0] === 'Provider case ids') ?? [])[1] ?? '';
      setFact(patch, 'Provider case ids', cur ? `${cur}; courtlistener: ${n.native_id}` : `courtlistener: ${n.native_id}`);
      insertFactAfter(patch, 'Provider case ids', 'Provider case ids — source', sourceText('CourtListener docket id', n));
      gapfill.push({field: 'native_case_id', value: n.native_id, g: n});
    }
  } else if (phase === 'dates') {
    const c = d.conflict;
    if (!c || c.field !== 'filed') return {patch, applied, held, gapfill};
    const header = c.incoming;
    if (curFiled === header) return {patch, applied, held, gapfill};
    const locs = (row.detail?.registry?.evidence ?? []).filter(e => e.kind === 'fjc_idb_mdl_number').map(e => e.locator).filter(Boolean);
    const qual = locs.filter(l => ORIGINAL_ORIGINS.has(String(l.origin)) && l.date_filed);
    const earliestQual = qual.length ? qual.map(l => l.date_filed).sort()[0] : null;
    const displaced = locs.filter(l => l.date_filed === curFiled && REOPEN_ORIGINS.has(String(l.origin)));
    const reasons = [];
    if (!displaced.length) reasons.push('(a) current value is not a reopen/reinstate IDB row date');
    else if (!earliestQual || !(earliestQual < curFiled)) reasons.push('(a) no earlier original-filing IDB row for the current value to be later than');
    if (!earliestQual || header !== earliestQual) reasons.push('(b) docket header date does not equal the earliest qualifying IDB row');
    if (!year || header.slice(0, 4) !== year) reasons.push('(c) header year differs from docket-number year');
    if (curTerm && header > curTerm) reasons.push('header later than termination');
    if (reasons.length) { held.push({field: 'filed', reason: reasons.join('; '), existing: curFiled, incoming: header}); return {patch, applied, held, gapfill}; }
    const idbOrigin = [...new Set(displaced.map(l => String(l.origin)))].sort().join(',');
    const reopened = {date: curFiled, idb_origin: idbOrigin, idb_ids: displaced.map(l => l.idb_id).filter(Boolean), source: 'FJC IDB via CourtListener bulk 2026-09-30', label: 'reopened or reinstated (FJC IDB origin code ' + idbOrigin + ')'};
    patch.set(['item', 'cells', 'filed'], header);
    patch.set(['item', 'cells', 'reopened_or_reinstated'], `${curFiled} (FJC IDB origin ${idbOrigin})`);
    patch.set(['detail', 'registry', 'reopened_or_reinstated'], [reopened]);
    patch.set(['item', 'subtitle'], String(row.item.subtitle ?? '').replace(/· filed \d{4}-\d\d-\d\d$/, `· filed ${header}`));
    patch.set(['filters', 'year'], header.slice(0, 4));
    setFact(patch, 'Filed', header);
    insertFactAfter(patch, 'Filed', 'Filed — source', sourceText('Filed (original filing date, docket header)', c));
    insertFactAfter(patch, 'Filed — source', 'Reopened or reinstated (FJC IDB)', `${curFiled}, FJC IDB origin ${idbOrigin} (displaced from "Filed"; kept, not discarded)`);
    gapfill.push({field: 'filed', value: header, g: c, displaced: reopened});
    filed = header;
  }
  if (gapfill.length) {
    const prev = patch.get(['detail', 'provenance', 'gapfill']) ?? [];
    patch.set(['detail', 'provenance', 'gapfill'], [...prev, ...gapfill.map(x => ({field: x.field, value: x.value, phase, source: 'courtlistener-bulk', archive_sha256: ARCHIVE_SHA, archive_url: BULK_URL, source_row_ordinal: x.g.source_row_ordinal, native_docket_id: x.g.native_id, run_id: RUN_ID, projected_at: now, ...(x.displaced ? {displaced: x.displaced} : {})}))]);
  }
  for (const x of gapfill) applied.push({field: x.field, value: x.value});
  return {patch, applied, held, gapfill};
}

/** cl_docket_metadata MDL number from an exact FJC IDB join; labelled historical administrative association. */
export function planMdl(row, fjc, now) {
  const patch = new Patch({item: row.item, detail: row.detail, filters: row.filters});
  const cells = row.item?.cells ?? {};
  if (!blank(cells.mdl_number) || !fjc.mdl_number_raw) return {patch, applied: [], held: [{field: 'mdl_number', reason: 'already populated or no FJC value'}]};
  const mdl = String(Number(fjc.mdl_number_raw));
  if (!/^[1-9]\d*$/.test(mdl)) return {patch, applied: [], held: [{field: 'mdl_number', reason: 'FJC value not a positive integer', value: fjc.mdl_number_raw}]};
  if (String(cells.idb_data_id) !== String(fjc.idb_data_id)) return {patch, applied: [], held: [{field: 'mdl_number', reason: 'idb_data_id mismatch'}]};
  const label = 'historical administrative association (FJC IDB)';
  patch.set(['item', 'cells', 'mdl_number'], mdl);
  patch.set(['item', 'cells', 'mdl_number_raw'], fjc.mdl_number_raw);
  patch.set(['item', 'cells', 'mdl_number_basis'], label);
  patch.set(['filters', 'mdl_number'], mdl);
  const facts = clone(row.detail?.facts) ?? [];
  const add = [['FJC MDL number (as recorded)', fjc.mdl_number_raw], ['MDL association basis', `${label}; not a current membership claim`], ['MDL number source', `FJC IDB row ${fjc.idb_data_id}, archive sha256 ${FJC_SHA.slice(0, 12)}…, joined on exact idb_data_id (origin ${fjc.origin})`]];
  for (const [k, v] of add) { const i = facts.findIndex(f => f[0] === k); if (i >= 0) facts[i] = [k, v]; else facts.push([k, v]); }
  patch.set(['detail', 'facts'], facts);
  patch.set(['detail', 'provenance', 'gapfill'], [...(row.detail?.provenance?.gapfill ?? []), {field: 'mdl_number', value: mdl, phase: 'mdl', source: 'fjc-idb', archive_sha256: FJC_SHA, idb_data_id: fjc.idb_data_id, run_id: RUN_ID, label, projected_at: now}]);
  return {patch, applied: [{field: 'mdl_number', value: mdl}], held: []};
}

async function readJsonl(f) { return (await fs.readFile(f, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l)); }

async function fetchRows(live, dataset, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const q = ids.slice(i, i + 40).map(x => `"${x}"`).join(',');
    const r = await live.fetchImpl(`${live.url}/rest/v1/corpus_records?select=id,item,detail,filters&dataset=eq.${dataset}&id=in.(${encodeURIComponent(q)})`, {headers: live.headers, signal: AbortSignal.timeout(120000)});
    if (!r.ok) throw new Error(`HTTP ${r.status} read`);
    out.push(...await r.json());
  }
  return out;
}
async function patchRow(live, dataset, id, cols) {
  for (let attempt = 0; ; attempt++) {
    const r = await live.fetchImpl(`${live.url}/rest/v1/corpus_records?dataset=eq.${dataset}&id=eq.${encodeURIComponent(id)}`, {method: 'PATCH', headers: {...live.headers, 'Content-Type': 'application/json', Prefer: 'return=minimal'}, body: JSON.stringify(cols), signal: AbortSignal.timeout(120000)});
    if (r.ok) return;
    if (attempt >= 3 || (r.status < 429 && r.status !== 408)) throw new Error(`HTTP ${r.status} patch ${id}`);
    await new Promise(res => setTimeout(res, 1500 * 2 ** attempt));
  }
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({length: n}, async () => { while (i < items.length) await fn(items[i++]); })); }

export async function main(argv) {
  const args = Object.fromEntries(argv.map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const live = new Live();
  const apply = Boolean(args.apply), limit = args.limit ? Number(args.limit) : Infinity;
  if (args.revert) {
    const ledger = (await readJsonl(args.revert)).filter(l => l.ops && (!args.phase || l.phase === args.phase));
    const stats = {rows: ledger.length, reverted: 0, skipped: 0};
    const byDs = new Map(); for (const l of ledger) (byDs.get(l.dataset) ?? byDs.set(l.dataset, []).get(l.dataset)).push(l);
    for (const [ds, entries] of byDs) {
      for (let i = 0; i < entries.length; i += 200) {
        const chunk = entries.slice(i, i + 200), rows = new Map((await fetchRows(live, ds, chunk.map(e => e.id))).map(r => [r.id, r]));
        await pool(chunk, 8, async e => {
          const row = rows.get(e.id); if (!row) { stats.skipped++; return; }
          const {cols, skipped} = applyOps({item: row.item, detail: row.detail, filters: row.filters}, e.ops, 'revert');
          if (skipped.length) stats.skipped++; else stats.reverted++;
          if (apply && !sameJson(cols, {item: row.item, detail: row.detail, filters: row.filters})) await patchRow(live, ds, e.id, cols);
        });
      }
    }
    console.log(JSON.stringify({revert: true, apply, ...stats})); return;
  }
  const dir = args.decisions, phase = args.phase;
  if (!dir || !args.ledger || !['blanks', 'dates', 'mdl'].includes(phase)) throw new Error('--decisions=<dir> --ledger=<file> --phase=blanks|dates|mdl required');
  const done = new Set((await readJsonl(args.ledger)).filter(l => l.phase === phase && l.ops).map(l => l.id));
  const now = new Date().toISOString();
  const stats = {phase, apply, candidates: 0, already_done: 0, changed: 0, held: 0, unchanged: 0, gone: 0, by_field: {}, held_reasons: {}};
  if (phase === 'mdl') {
    const fjc = await readJsonl(path.join(dir, 'stage-bulk/fjc-idb-mdl-match.jsonl'));
    const byDocket = new Map(fjc.map(r => [`cl:dockets:${r.data.docket_id}`, r.data]));
    const ids = [...byDocket.keys()].filter(x => !done.has(x)).slice(0, limit);
    stats.candidates = fjc.length; stats.already_done = byDocket.size - ids.length;
    for (const row of await fetchRows(live, 'cl_docket_metadata', ids)) {
      const r = planMdl(row, byDocket.get(row.id), now);
      for (const h of r.held) { stats.held++; stats.held_reasons[h.reason] = (stats.held_reasons[h.reason] ?? 0) + 1; await appendJsonl(`${args.ledger}.held`, {id: row.id, phase, ...h}); }
      if (!r.patch.ops.length) { stats.unchanged++; continue; }
      await appendJsonl(args.ledger, {id: row.id, dataset: 'cl_docket_metadata', phase, applied: r.applied, projected_at: now, ops: r.patch.ops});
      if (apply) await patchRow(live, 'cl_docket_metadata', row.id, {item: r.patch.cols.item, detail: r.patch.cols.detail, filters: r.patch.cols.filters});
      stats.changed++; stats.by_field.mdl_number = (stats.by_field.mdl_number ?? 0) + 1;
    }
    console.log(JSON.stringify(stats)); return;
  }
  const decisions = [...await readJsonl(path.join(dir, 'bulk-decisions.jsonl')), ...await readJsonl(path.join(dir, 'bulk-conflicts.jsonl'))];
  const by = new Map();
  for (const x of decisions) {
    if (!x.registry_id || !x.field) continue;
    const e = by.get(x.registry_id) ?? by.set(x.registry_id, {}).get(x.registry_id);
    if (x.action === 'fill') e[x.field === 'native_case_id' ? 'native' : x.field] = x;
    else if (x.action === 'conflict' && x.field === 'filed') e.conflict = x;
  }
  const evByNative = new Map((await readJsonl(path.join(dir, 'stage-bulk/docket-bulk-match.jsonl'))).map(r => [r.native_id, r.data]));
  const ids = [...by.keys()].filter(id => phase === 'dates' ? by.get(id).conflict : (by.get(id).filed || by.get(id).terminated || by.get(id).native)).filter(id => !done.has(id)).slice(0, limit);
  stats.candidates = ids.length;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200), rows = await fetchRows(live, 'sw_matter_dockets_v1', chunk);
    stats.gone += chunk.length - rows.length;
    const ledgerLines = [], writes = [];
    for (const row of rows) {
      const r = planDocket(row, by.get(row.id), evByNative, phase, now);
      for (const h of r.held) { stats.held++; stats.held_reasons[h.reason.slice(0, 80)] = (stats.held_reasons[h.reason.slice(0, 80)] ?? 0) + 1; await appendJsonl(`${args.ledger}.held`, {id: row.id, phase, ...h, decision: by.get(row.id).conflict ?? null}); }
      if (!r.patch.ops.length) { stats.unchanged++; continue; }
      ledgerLines.push({id: row.id, dataset: 'sw_matter_dockets_v1', phase, applied: r.applied, projected_at: now, ops: r.patch.ops});
      writes.push({id: row.id, cols: {item: r.patch.cols.item, detail: r.patch.cols.detail, filters: r.patch.cols.filters}});
      for (const a of r.applied) stats.by_field[a.field] = (stats.by_field[a.field] ?? 0) + 1;
      stats.changed++;
    }
    for (const l of ledgerLines) await appendJsonl(args.ledger, l);
    if (apply) await pool(writes, 8, w => patchRow(live, 'sw_matter_dockets_v1', w.id, w.cols));
  }
  console.log(JSON.stringify(stats));
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(e => { console.error(String(e.message ?? e).replace(/sb_secret_[A-Za-z0-9_]+/g, '[redacted]')); process.exitCode = 1; });
