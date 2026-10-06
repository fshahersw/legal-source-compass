// Offline comparison of staged source records with the LIVE registry rows (read via PostgREST; nothing is written).
// Join key: exact provider-neutral docket key. Differences become conflict records; blanks become fill candidates.
// A staged value never overwrites a populated live value, whatever its source rank.
import fs from 'node:fs/promises';
import path from 'node:path';
import {decideField, docketKey, docketKeyFromDocketBirdId, isBlank} from './lib.mjs';
import {Live} from './gap-analysis-live.mjs';
import {pageAll} from './plan-internal-crosswalk.mjs';

const blank = v => isBlank(v) || /^not recorded$/i.test(String(v).trim());
const readJsonl = async f => (await fs.readFile(f, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l));

export function reconcile(liveRows, staged) {
  const idx = new Map();
  for (const r of liveRows) { const k = docketKey(r.cells?.court_id, r.cells?.docket_number); if (k) idx.set(k, idx.has(k) ? {ambiguous: true} : r); }
  const stats = {staged: staged.length, no_live_row: 0, ambiguous_live_key: 0, fill: 0, confirm: 0, conflict: 0}; const decisions = [];
  for (const s of staged) {
    const hit = s.key ? idx.get(s.key) : null;
    if (!hit) { stats.no_live_row++; continue; }
    if (hit.ambiguous) { stats.ambiguous_live_key++; continue; }
    for (const [field, liveField] of [['date_filed', 'filed'], ['date_terminated', 'terminated']]) {
      if (!(field in s.fields) || isBlank(s.fields[field])) continue;
      const d = decideField({field: liveField, existing: {value: blank(hit.cells[liveField]) ? null : hit.cells[liveField], source: 'baseline'}, incoming: {value: s.fields[field], source: s.source}});
      if (d.action in stats) stats[d.action]++;
      decisions.push({target_dataset: 'sw_matter_dockets_v1', target_id: hit.id, docket_key: s.key, native_id: s.native_id, source_url: s.source_url, retrieved_at: s.retrieved_at, source_sha256: s.source_sha256, applied: false, ...d});
    }
  }
  return {stats, decisions};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stageDir = process.argv[2];
  const staged = [];
  for (const r of await readJsonl(path.join(stageDir, 'live-normalized/dockets.jsonl')))
    staged.push({key: docketKey(r.data.court_id, r.data.docket_number), source: 'courtlistener', native_id: r.native_id, fields: {date_filed: r.data.date_filed, date_terminated: r.data.date_terminated}, ...r.provenance});
  for (const r of await readJsonl(path.join(stageDir, 'docketbird-rest/case.jsonl')))
    staged.push({key: docketKeyFromDocketBirdId(r.native_id), source: 'docketbird', native_id: r.native_id, fields: {date_filed: r.data.date_filed}, ...r.provenance});
  const live = await pageAll(new Live(), 'sw_matter_dockets_v1', 'id,cells:item->cells');
  const {stats, decisions} = reconcile(live, staged);
  await fs.writeFile(path.join(stageDir, 'reconcile-live.jsonl'), decisions.map(d => JSON.stringify(d)).join('\n') + (decisions.length ? '\n' : ''));
  console.log(JSON.stringify(stats));
}
