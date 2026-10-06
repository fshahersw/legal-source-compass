// Turns the local bulk docket matches into (a) reviewable fill/conflict decisions per registry docket and (b) private
// evidence rows `courtlistener / docket-bulk-match` for versioned ingest. Nothing is applied to any projected value.
//   node build-bulk-evidence.mjs <matchDir> <registry-dockets.jsonl> <outDir>
// Rules: exact court + docket key only; a fill needs exactly ONE native bulk row for the key; several rows => ambiguous,
// held and listed; blocked dockets are never captioned; populated registry values are never overwritten (conflicts are recorded).
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonicalIntegerJson, sha256, docketKey, isBlank} from './lib.mjs';

export const SCHEMA = 'courtlistener-bulk-match/1';
export const SOURCE_URL = 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-2026-09-30.csv.bz2';
const blank = v => isBlank(v) || /^not recorded$/i.test(String(v).trim());
const readJsonl = async f => (await fs.readFile(f, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));

export function decide(registry, matches) {
  const byKey = new Map();
  for (const m of matches) (byKey.get(m.docket_key) ?? byKey.set(m.docket_key, []).get(m.docket_key)).push(m);
  const stats = {registry_rows: registry.length, keyed: 0, no_native_row: 0, ambiguous_key: 0, unique_native: 0, blocked_unique_skipped: 0,
    filed_blank: 0, filed_fill: 0, filed_blank_ambiguous: 0, filed_blank_no_native_date: 0, filed_confirm: 0, filed_conflict: 0,
    terminated_blank: 0, terminated_fill: 0, terminated_conflict: 0, native_id_blank: 0, native_id_fill: 0, native_id_ambiguous: 0, native_id_confirm: 0, native_id_conflict: 0};
  const decisions = [], evidence = new Map();
  const note = (reg, m, purpose) => {
    const ev = evidence.get(m.id) ?? {m, regs: new Set(), purposes: new Set(), unique: byKey.get(m.docket_key).length === 1};
    ev.regs.add(reg.id); ev.purposes.add(purpose); evidence.set(m.id, ev);
  };
  for (const reg of registry) {
    const key = docketKey(reg.court_id, reg.docket_number) ?? reg.docket_key; if (!key) continue; stats.keyed++;
    const ms = byKey.get(key) ?? [];
    const filedBlank = blank(reg.filed), termBlank = blank(reg.terminated), clIds = (reg.native_case_ids ?? []).map(x => String(x?.id ?? x)).filter(x => /^\d+$/.test(x)), nativeBlank = clIds.length === 0;
    if (filedBlank) stats.filed_blank++; if (termBlank) stats.terminated_blank++; if (nativeBlank) stats.native_id_blank++;
    if (!ms.length) { stats.no_native_row++; continue; }
    if (ms.length > 1) {
      stats.ambiguous_key++;
      if (filedBlank) stats.filed_blank_ambiguous++; if (nativeBlank) stats.native_id_ambiguous++;
      decisions.push({registry_id: reg.id, docket_key: key, result: 'ambiguous_key_held', candidate_native_ids: ms.map(x => x.id)});
      for (const m of ms) note(reg, m, 'ambiguous_candidate');
      continue;
    }
    const m = ms[0]; stats.unique_native++;
    if (m.blocked === 't' || m.blocked === 'true') { stats.blocked_unique_skipped++; decisions.push({registry_id: reg.id, docket_key: key, result: 'blocked_native_docket_skipped', native_id: m.id}); continue; }
    const base = {registry_id: reg.id, docket_key: key, native_id: m.id, source_row_ordinal: m.source_row_ordinal, applied: false};
    if (filedBlank) { if (blank(m.date_filed)) stats.filed_blank_no_native_date++; else { stats.filed_fill++; decisions.push({...base, field: 'filed', action: 'fill', value: m.date_filed}); note(reg, m, 'fills_filed'); } }
    else if (!blank(m.date_filed)) { if (String(reg.filed) === m.date_filed) stats.filed_confirm++; else { stats.filed_conflict++; decisions.push({...base, field: 'filed', action: 'conflict', existing: reg.filed, incoming: m.date_filed}); note(reg, m, 'filed_conflict'); } }
    if (termBlank) { if (!blank(m.date_terminated)) { stats.terminated_fill++; decisions.push({...base, field: 'terminated', action: 'fill', value: m.date_terminated}); note(reg, m, 'fills_terminated'); } }
    else if (!blank(m.date_terminated) && String(reg.terminated) !== m.date_terminated) { stats.terminated_conflict++; decisions.push({...base, field: 'terminated', action: 'conflict', existing: reg.terminated, incoming: m.date_terminated}); note(reg, m, 'terminated_conflict'); }
    if (nativeBlank) { stats.native_id_fill++; decisions.push({...base, field: 'native_case_id', action: 'fill', value: m.id, basis: 'exact court id + exact docket key, unique native bulk row'}); note(reg, m, 'fills_native_id'); }
    else {
      const have = new Set(clIds);
      if (have.has(m.id)) stats.native_id_confirm++; else { stats.native_id_conflict++; decisions.push({...base, field: 'native_case_id', action: 'conflict', existing: [...have], incoming: m.id}); note(reg, m, 'native_id_conflict'); }
    }
  }
  return {stats, decisions, evidence};
}

export function evidenceRow(ev, receipt, retrievedAt) {
  const m = ev.m;
  const data = {docket_id: m.id, court_id: m.court_id, docket_number: m.docket_number, docket_key: m.docket_key, date_filed: m.date_filed, date_terminated: m.date_terminated,
    date_last_filing: m.date_last_filing ?? null, pacer_case_id: m.pacer_case_id, idb_data_id: m.idb_data_id ?? null,
    case_name: m.blocked === 't' ? null : (m.case_name_full || m.case_name || null), blocked: m.blocked === 't',
    source_row_ordinal: m.source_row_ordinal, archive_sha256: receipt.archive_sha256, snapshot_date: receipt.snapshot_date,
    key_match_rule: 'exact court id + exact docket key', key_unique_in_bulk: ev.unique, registry_dockets: [...ev.regs].sort(), purposes: [...ev.purposes].sort()};
  return {schema_version: SCHEMA, source_system: 'courtlistener', entity_type: 'docket-bulk-match', native_id: m.id, data,
    provenance: {source_url: SOURCE_URL, source_sha256: receipt.archive_sha256, source_as_of: receipt.snapshot_date, retrieved_at: retrievedAt, http_status: 200,
      schema_version: SCHEMA, record_sha256: sha256(canonicalIntegerJson(data)), record_sha256_codec: 'canonical-integer-jsonb/1', archive_bytes: receipt.archive_bytes, rows_scanned: receipt.rows_scanned}};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [matchDir, registryFile, outDir] = process.argv.slice(2);
  const receipt = JSON.parse(await fs.readFile(path.join(matchDir, 'receipt.json'), 'utf8'));
  const {stats, decisions, evidence} = decide(await readJsonl(registryFile), await readJsonl(path.join(matchDir, 'matches.jsonl')));
  const retrievedAt = receipt.completed_at;
  const rows = [...evidence.values()].map(e => evidenceRow(e, receipt, retrievedAt));
  await fs.mkdir(outDir, {recursive: true});
  const w = (n, a) => fs.writeFile(path.join(outDir, n), a.map(x => JSON.stringify(x)).join('\n') + (a.length ? '\n' : ''));
  await w('bulk-decisions.jsonl', decisions.filter(d => d.action !== 'conflict'));
  await w('bulk-conflicts.jsonl', decisions.filter(d => d.action === 'conflict'));
  await fs.mkdir(path.join(outDir, 'stage-bulk'), {recursive: true});
  await w('stage-bulk/docket-bulk-match.jsonl', rows);
  const out = {measured_at: new Date().toISOString(), archive_sha256: receipt.archive_sha256, rows_scanned: receipt.rows_scanned, evidence_rows: rows.length, ...stats};
  await fs.writeFile(path.join(outDir, 'bulk-stats.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

export const FJC_URL = 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2';
/** FJC IDB rows that populate multidistrict_litigation_docket_number for saved native dockets (exact idb_data_id join, historical label). */
export function fjcRows(check, idbToDocket, retrievedAt) {
  const rows = [];
  for (const [idb, v] of Object.entries(check.found_rows)) {
    if (!v.mdl) continue;
    const data = {idb_data_id: idb, docket_id: idbToDocket[idb] ?? null, mdl_number_raw: v.mdl, origin: v.origin, date_filed: v.date_filed, archive_sha256: check.archive_sha256, snapshot_date: '2026-09-30',
      join_rule: 'exact idb_data_id', label: 'historical administrative association; not a current MDL member census', field: 'multidistrict_litigation_docket_number'};
    rows.push({schema_version: 'courtlistener-fjc-idb-match/1', source_system: 'courtlistener', entity_type: 'fjc-idb-mdl-match', native_id: idb, data,
      provenance: {source_url: FJC_URL, source_sha256: check.archive_sha256, source_as_of: '2026-09-30', retrieved_at: retrievedAt, http_status: 200, schema_version: 'courtlistener-fjc-idb-match/1',
        record_sha256: sha256(canonicalIntegerJson(data)), record_sha256_codec: 'canonical-integer-jsonb/1', rows_scanned: check.rows_scanned}});
  }
  return rows;
}
