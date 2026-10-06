// Owner-approved rule A1 (2026-10-06): fill a CourtListener native id for a registry docket that has none, from the bulk dockets archive, only where
//  (a) the bulk row is UNIQUE on court + office + year + sequence,
//  (b) the case-type letter differs only by a civil-series code (op, md, cv, mc) and the registry type is one of those,
//  (c) the bulk case_name equals the registry caption after whitespace/case normalisation, or the registry has no caption.
// The rule name is recorded in provenance so these rows are distinguishable from exact-key matches. Only the native id is filled (no dates).
//   node build-variant-evidence.mjs <near-miss-full.jsonl> <registry.jsonl> <existing docket-bulk-match.jsonl> <receipt.json> <outDir>
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonicalIntegerJson, sha256, isBlank} from './lib.mjs';

export const RULE = 'court+office+year+sequence, civil-series type variant, caption-confirmed';
export const SERIES = new Set(['op', 'md', 'cv', 'mc']);
export const SCHEMA_V2 = 'courtlistener-bulk-match/2';
const SOURCE_URL = 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-2026-09-30.csv.bz2';
export const normCaption = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const readJsonl = async f => (await fs.readFile(f, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
const parts = key => { const [court, office, rest] = key.split(':'); const [year, type, seq] = rest.split('-'); return {court, office, year, type, seq: String(Number(seq))}; };

export function decideVariants(registry, bulkRows, existingNatives) {
  const byRelaxed = new Map();
  for (const m of bulkRows) (byRelaxed.get(m.relaxed) ?? byRelaxed.set(m.relaxed, []).get(m.relaxed)).push(m);
  const stats = {registry_rows_without_cl_id: 0, no_bulk_row: 0, ambiguous_relaxed_key: 0, blocked: 0, type_not_civil_series: 0, same_type_not_a_variant: 0, caption_mismatch_held: 0, native_collision_held: 0, accepted: 0, accepted_registry_caption_blank: 0, accepted_caption_equal: 0, by_bulk_type: {}};
  const accepted = [], held = [];
  const claimed = new Map();
  for (const r of registry) {
    const ids = (r.native_case_ids ?? []).map(x => String(x?.id ?? x));
    if (ids.some(x => /^\d+$/.test(x))) continue;
    stats.registry_rows_without_cl_id++;
    const p = parts(r.docket_key), relaxed = `${p.court}:${Number(p.office)}:${p.year}-${p.seq}`;
    const ms = byRelaxed.get(relaxed) ?? [];
    if (!ms.length) { stats.no_bulk_row++; continue; }
    if (ms.length > 1) { stats.ambiguous_relaxed_key++; held.push({registry_id: r.id, reason: 'relaxed key not unique in bulk', candidates: ms.map(m => m.id)}); continue; }
    const m = ms[0];
    if (m.blocked === 't') { stats.blocked++; held.push({registry_id: r.id, reason: 'blocked docket', native_id: m.id}); continue; }
    if (!SERIES.has(m.type) || !SERIES.has(p.type)) { stats.type_not_civil_series++; held.push({registry_id: r.id, reason: 'type letter outside the civil-series codes', registry_type: p.type, bulk_type: m.type, native_id: m.id}); continue; }
    if (m.type === p.type) { stats.same_type_not_a_variant++; continue; }
    const registryBlank = isBlank(r.caption);
    if (!registryBlank && normCaption(r.caption) !== normCaption(m.case_name)) { stats.caption_mismatch_held++; held.push({registry_id: r.id, reason: 'caption differs after whitespace/case normalisation', registry_caption: r.caption, bulk_case_name: m.case_name, native_id: m.id}); continue; }
    if (existingNatives.has(m.id) || claimed.has(m.id)) { stats.native_collision_held++; held.push({registry_id: r.id, reason: 'native docket already matched another registry docket', native_id: m.id}); continue; }
    claimed.set(m.id, r.id);
    stats.accepted++; stats[registryBlank ? 'accepted_registry_caption_blank' : 'accepted_caption_equal']++; stats.by_bulk_type[m.type] = (stats.by_bulk_type[m.type] ?? 0) + 1;
    accepted.push({registry: r, bulk: m, registry_type: p.type, caption_basis: registryBlank ? 'registry_caption_blank' : 'equal_after_whitespace_case_normalisation'});
  }
  return {stats, accepted, held};
}

export function variantRow(a, receipt, retrievedAt) {
  const m = a.bulk;
  const data = {docket_id: m.id, court_id: a.registry.court_id, docket_number: m.docket_number, docket_key: a.registry.docket_key, date_filed: m.date_filed, date_terminated: m.date_terminated,
    pacer_case_id: m.pacer_case_id ?? null, case_name: m.case_name || null, blocked: false, source_row_ordinal: m.source_row_ordinal, archive_sha256: receipt.archive_sha256, snapshot_date: receipt.snapshot_date,
    key_match_rule: RULE, type_variant: {registry_type: a.registry_type, bulk_type: m.type}, caption_basis: a.caption_basis, key_unique_in_bulk: true, registry_dockets: [a.registry.id], purposes: ['fills_native_id']};
  return {schema_version: SCHEMA_V2, source_system: 'courtlistener', entity_type: 'docket-bulk-match', native_id: m.id, data,
    provenance: {source_url: SOURCE_URL, source_sha256: receipt.archive_sha256, source_as_of: receipt.snapshot_date, retrieved_at: retrievedAt, http_status: 200, schema_version: SCHEMA_V2,
      record_sha256: sha256(canonicalIntegerJson(data)), record_sha256_codec: 'canonical-integer-jsonb/1', archive_bytes: receipt.archive_bytes, rows_scanned: receipt.rows_scanned}};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [bulkF, registryF, existingF, receiptF, outDir] = process.argv.slice(2);
  const receipt = JSON.parse(await fs.readFile(receiptF, 'utf8'));
  const existing = new Set((await readJsonl(existingF)).map(r => r.native_id));
  const {stats, accepted, held} = decideVariants(await readJsonl(registryF), await readJsonl(bulkF), existing);
  const rows = accepted.map(a => variantRow(a, receipt, receipt.completed_at));
  await fs.mkdir(path.join(outDir, 'stage-bulk'), {recursive: true});
  const w = (f, a) => fs.writeFile(f, a.map(x => JSON.stringify(x)).join('\n') + (a.length ? '\n' : ''));
  await w(path.join(outDir, 'stage-bulk/docket-bulk-match.jsonl'), rows);
  await w(path.join(outDir, 'variant-held.jsonl'), held);
  await fs.writeFile(path.join(outDir, 'variant-stats.json'), JSON.stringify({measured_at: new Date().toISOString(), rule: RULE, ...stats}, null, 2));
  console.log(JSON.stringify({rule: RULE, ...stats}, null, 2));
}
