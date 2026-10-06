// Caption evidence from the same exact-key bulk matches. For each registry docket with no caption, a UNIQUE (court + docket key) non-blocked bulk
// row with a non-blank case_name becomes a fill candidate; ambiguous, missing, blocked, blank and seal/restricted/redacted text are held.
// The matching `docket-bulk-match` evidence row gains the registry id, the `fills_caption` purpose and the caption (new payload = new version;
// earlier versions stay). Only changed/new rows are written to the delta stage for versioned ingest.
//   node build-caption-evidence.mjs <matches.jsonl> <registry.jsonl> <existing stage-bulk/docket-bulk-match.jsonl> <receipt.json> <outDir>
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonicalIntegerJson, sha256, isBlank} from './lib.mjs';
import {evidenceRow} from './build-bulk-evidence.mjs';
import {excluded, ws} from '../members-publish-rules.mjs';

const readJsonl = async f => (await fs.readFile(f, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));

export function captionCandidates(registry, matches) {
  const byKey = new Map();
  for (const m of matches) (byKey.get(m.docket_key) ?? byKey.set(m.docket_key, []).get(m.docket_key)).push(m);
  const stats = {blank_caption_rows: 0, candidates: 0, no_bulk_row: 0, ambiguous: 0, blocked: 0, bulk_caption_blank: 0, excluded_text: 0};
  const cands = [], held = [];
  for (const r of registry) {
    if (!isBlank(r.caption)) continue; stats.blank_caption_rows++;
    const ms = byKey.get(r.docket_key) ?? [];
    if (!ms.length) { stats.no_bulk_row++; held.push({registry_id: r.id, reason: 'no bulk row for the exact key'}); continue; }
    if (ms.length > 1) { stats.ambiguous++; held.push({registry_id: r.id, reason: 'ambiguous key', candidates: ms.map(m => m.id)}); continue; }
    const m = ms[0];
    if (m.blocked === 't') { stats.blocked++; held.push({registry_id: r.id, reason: 'blocked docket', native_id: m.id}); continue; }
    const value = ws(m.case_name || m.case_name_full);
    if (!value) { stats.bulk_caption_blank++; held.push({registry_id: r.id, reason: 'bulk caption blank', native_id: m.id}); continue; }
    if (excluded(value)) { stats.excluded_text++; held.push({registry_id: r.id, reason: 'caption text matches the exclusion rule', native_id: m.id}); continue; }
    stats.candidates++; cands.push({registry_id: r.id, match: m, value});
  }
  return {stats, cands, held};
}

/** Merge candidates into the evidence set; returns {merged, delta}. */
export function mergeEvidence(existing, cands, receipt, retrievedAt) {
  const byNative = new Map(existing.map(r => [r.native_id, r]));
  const delta = new Map();
  for (const c of cands) {
    const cur = delta.get(c.match.id) ?? byNative.get(c.match.id);
    const base = cur?.data ?? evidenceRow({m: c.match, regs: new Set(), purposes: new Set(), unique: true}, receipt, retrievedAt).data;
    const regs = [...new Set([...(base.registry_dockets ?? []), c.registry_id])].sort(), purposes = [...new Set([...(base.purposes ?? []), 'fills_caption'])].sort();
    const data = {...base, case_name: c.match.case_name || c.match.case_name_full || base.case_name, registry_dockets: regs, purposes};
    delta.set(c.match.id, {schema_version: 'courtlistener-bulk-match/1', source_system: 'courtlistener', entity_type: 'docket-bulk-match', native_id: c.match.id, data,
      provenance: {...(cur?.provenance ?? evidenceRow({m: c.match, regs: new Set(), purposes: new Set(), unique: true}, receipt, retrievedAt).provenance), record_sha256: sha256(canonicalIntegerJson(data))}});
  }
  const merged = existing.filter(r => !delta.has(r.native_id)).concat([...delta.values()]);
  return {merged, delta: [...delta.values()]};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [matchesF, registryF, evidenceF, receiptF, outDir] = process.argv.slice(2);
  const receipt = JSON.parse(await fs.readFile(receiptF, 'utf8'));
  const {stats, cands, held} = captionCandidates(await readJsonl(registryF), await readJsonl(matchesF));
  const {merged, delta} = mergeEvidence(await readJsonl(evidenceF), cands, receipt, receipt.completed_at);
  await fs.mkdir(path.join(outDir, 'delta/stage-bulk'), {recursive: true}); await fs.mkdir(path.join(outDir, 'merged/stage-bulk'), {recursive: true});
  const w = (f, a) => fs.writeFile(f, a.map(x => JSON.stringify(x)).join('\n') + (a.length ? '\n' : ''));
  await w(path.join(outDir, 'delta/stage-bulk/docket-bulk-match.jsonl'), delta);
  await w(path.join(outDir, 'merged/stage-bulk/docket-bulk-match.jsonl'), merged);
  await w(path.join(outDir, 'caption-held.jsonl'), held);
  console.log(JSON.stringify({...stats, evidence_rows_changed_or_new: delta.length, merged_rows: merged.length}));
}
