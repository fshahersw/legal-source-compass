// Re-projection overlay. A projector that rebuilds sw_matter_dockets_v1 / cl_docket_metadata from registry bundles calls this on every
// rebuilt record so the approved gap-fill values (and their provenance) are reproduced from the landed evidence instead of being
// overwritten: blanks (filed, terminated, CourtListener native id), the date-semantics correction with `reopened_or_reinstated`,
// and FJC IDB MDL numbers. Evidence = the same `docket-bulk-match` / `fjc-idb-mdl-match` rows that were landed in corpus_ingest.
import fs from 'node:fs';
import path from 'node:path';
import {planDocket, planMdl, planCaption, planTerminationNote, VARIANT_RULE} from './project-registry.mjs';

const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** Index evidence rows by the registry docket they concern; ambiguous or blocked bulk rows never produce a decision. */
export function indexEvidence(bulkRows, fjcRows = []) {
  const byRegistry = new Map(), evByNative = new Map();
  for (const r of bulkRows) {
    const d = r.data;
    evByNative.set(r.native_id, d);
    if (!d.key_unique_in_bulk || d.blocked) continue;
    const base = {native_id: r.native_id, source_row_ordinal: d.source_row_ordinal, snapshot_date: d.snapshot_date, archive_sha256: d.archive_sha256};
    for (const id of d.registry_dockets ?? []) {
      const e = byRegistry.get(id) ?? byRegistry.set(id, {}).get(id);
      if (d.key_match_rule === VARIANT_RULE) { e.native = {...base, action: 'fill', field: 'native_case_id', value: r.native_id, key_match_rule: VARIANT_RULE}; continue; }
      if ((d.purposes ?? []).includes('no_termination_recorded')) e.termnote = {...base, as_of: d.snapshot_date};
      if (d.date_filed) { e.filed = {...base, action: 'fill', field: 'filed', value: d.date_filed}; e.conflict = {...base, action: 'conflict', field: 'filed', incoming: d.date_filed}; }
      if (d.date_terminated) e.terminated = {...base, action: 'fill', field: 'terminated', value: d.date_terminated};
      e.native = {...base, action: 'fill', field: 'native_case_id', value: r.native_id};
      if (d.case_name) e.caption = {native_id: r.native_id, source_row_ordinal: d.source_row_ordinal, value: d.case_name, snapshot_date: d.snapshot_date, archive_sha256: d.archive_sha256};
    }
  }
  const fjcByDocket = new Map(fjcRows.filter(r => r.data.docket_id).map(r => [`cl:dockets:${r.data.docket_id}`, r.data]));
  return {byRegistry, evByNative, fjcByDocket};
}

export function loadEvidenceDir(dir) {
  return indexEvidence(readJsonl(path.join(dir, 'stage-bulk/docket-bulk-match.jsonl')), readJsonl(path.join(dir, 'stage-bulk/fjc-idb-mdl-match.jsonl')));
}

/** Apply blanks then the date correction to one rebuilt registry-docket record. Returns {record, changed, held}. */
export function overlayDocket(record, index, now) {
  const d = index.byRegistry.get(record.id);
  if (!d) return {record, changed: false, held: []};
  let cur = {id: record.id, item: record.item, detail: record.detail, filters: record.filters};
  const held = []; let changed = false;
  for (const phase of ['blanks', 'dates']) {
    const r = planDocket(cur, d, index.evByNative, phase, now);
    held.push(...r.held);
    if (r.patch.ops.length) { cur = {id: record.id, ...r.patch.cols}; changed = true; }
  }
  if (d.termnote) {
    const r = planTerminationNote({id: record.id, title: record.title, text: record.text, ...cur}, d.termnote, now);
    held.push(...r.held);
    if (r.patch.ops.length) { cur = {id: record.id, ...r.patch.cols}; changed = true; }
  }
  if (d.caption) {
    const r = planCaption({id: record.id, title: record.title, text: record.text, ...cur}, d.caption, now);
    held.push(...r.held);
    if (r.patch.ops.length) { cur = {id: record.id, ...r.patch.cols}; changed = true; }
  }
  return {record: changed ? {...record, ...(cur.title !== undefined ? {title: cur.title} : {}), ...(cur.text !== undefined ? {text: cur.text} : {}), item: cur.item, detail: cur.detail, filters: cur.filters} : record, changed, held};
}

export function overlayMdl(record, index, now) {
  const fjc = index.fjcByDocket.get(record.id);
  if (!fjc) return {record, changed: false, held: []};
  const r = planMdl({id: record.id, item: record.item, detail: record.detail, filters: record.filters}, fjc, now);
  return r.patch.ops.length ? {record: {...record, ...r.patch.cols}, changed: true, held: r.held} : {record, changed: false, held: r.held};
}

export function overlayRecords(records, index, now) {
  const out = {records: [], changed: 0, held: 0};
  for (const rec of records) {
    const r = rec.dataset === 'cl_docket_metadata' ? overlayMdl(rec, index, now) : overlayDocket(rec, index, now);
    out.records.push(r.record); out.changed += r.changed ? 1 : 0; out.held += r.held.length;
  }
  return out;
}
