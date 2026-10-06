// Evidence for the factual termination status (owner decision 2026-10-06): for a registry docket whose termination date is blank, the unique, unblocked
// bulk row (exact court + docket key) carries no termination date at the snapshot. The statement is "No termination recorded (CourtListener bulk <as_of>)";
// the date stays "Not recorded" and nothing is inferred about the docket being open. The matching `docket-bulk-match` evidence row gains the registry id and
// the purpose `no_termination_recorded` (new payload = new version).
//   node build-termination-note-evidence.mjs <matches.jsonl> <registry.jsonl> <existing docket-bulk-match.jsonl> <receipt.json> <outDir>
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonicalIntegerJson, sha256, isBlank} from './lib.mjs';
import {evidenceRow} from './build-bulk-evidence.mjs';

const readJsonl = async f => (await fs.readFile(f, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
const blank = v => isBlank(v) || /^not recorded$/i.test(String(v).trim());

export function terminationCandidates(registry, matches) {
  const byKey = new Map();
  for (const m of matches) (byKey.get(m.docket_key) ?? byKey.set(m.docket_key, []).get(m.docket_key)).push(m);
  const stats = {termination_blank: 0, candidates: 0, no_bulk_row: 0, ambiguous: 0, blocked: 0, bulk_has_termination: 0};
  const cands = [];
  for (const r of registry) {
    if (!blank(r.terminated)) continue; stats.termination_blank++;
    const ms = byKey.get(r.docket_key) ?? [];
    if (!ms.length) { stats.no_bulk_row++; continue; }
    if (ms.length > 1) { stats.ambiguous++; continue; }
    const m = ms[0];
    if (m.blocked === 't') { stats.blocked++; continue; }
    if (!isBlank(m.date_terminated)) { stats.bulk_has_termination++; continue; }
    stats.candidates++; cands.push({registry_id: r.id, match: m});
  }
  return {stats, cands};
}

export function mergeTerminationEvidence(existing, cands, receipt, retrievedAt) {
  const byNative = new Map(existing.map(r => [r.native_id, r]));
  const delta = new Map();
  for (const c of cands) {
    const cur = delta.get(c.match.id) ?? byNative.get(c.match.id);
    const fresh = () => evidenceRow({m: c.match, regs: new Set(), purposes: new Set(), unique: true}, receipt, retrievedAt);
    const base = cur?.data ?? fresh().data;
    const data = {...base, registry_dockets: [...new Set([...(base.registry_dockets ?? []), c.registry_id])].sort(), purposes: [...new Set([...(base.purposes ?? []), 'no_termination_recorded'])].sort()};
    delta.set(c.match.id, {schema_version: 'courtlistener-bulk-match/1', source_system: 'courtlistener', entity_type: 'docket-bulk-match', native_id: c.match.id, data,
      provenance: {...(cur?.provenance ?? fresh().provenance), record_sha256: sha256(canonicalIntegerJson(data))}});
  }
  return {merged: existing.filter(r => !delta.has(r.native_id)).concat([...delta.values()]), delta: [...delta.values()]};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [matchesF, registryF, evidenceF, receiptF, outDir] = process.argv.slice(2);
  const receipt = JSON.parse(await fs.readFile(receiptF, 'utf8'));
  const {stats, cands} = terminationCandidates(await readJsonl(registryF), await readJsonl(matchesF));
  const {merged, delta} = mergeTerminationEvidence(await readJsonl(evidenceF), cands, receipt, receipt.completed_at);
  await fs.mkdir(path.join(outDir, 'delta/stage-bulk'), {recursive: true}); await fs.mkdir(path.join(outDir, 'merged/stage-bulk'), {recursive: true});
  const w = async (f, a) => { const h = await fs.open(f, 'w'); try { for (const x of a) await h.write(JSON.stringify(x) + '\n'); } finally { await h.close(); } };
  await w(path.join(outDir, 'delta/stage-bulk/docket-bulk-match.jsonl'), delta);
  await w(path.join(outDir, 'merged/stage-bulk/docket-bulk-match.jsonl'), merged);
  console.log(JSON.stringify({...stats, evidence_rows_changed_or_new: delta.length, merged_rows: merged.length}));
}
