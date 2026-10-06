// Read-only planning: which blank filing dates / terminations in the matter-registry dockets (sw_matter_dockets_v1)
// are answered by a native CourtListener bulk row (cl_docket_metadata) that matches on the EXACT provider-neutral
// docket key (same court id, same office/year/type/sequence) and is the only such native row.
// Output is candidate field fills with evidence; NOTHING is written to the database and nothing is inferred
// from caption, judge, firm, product or MDL membership. An ambiguous key (several native dockets) is held.
import fs from 'node:fs/promises';
import path from 'node:path';
import {docketKey, isBlank} from './lib.mjs';
import {Live} from './gap-analysis-live.mjs';

const PLACEHOLDER = v => isBlank(v) || /^not recorded$/i.test(String(v).trim());

export async function pageAll(live, dataset, select, extra = '') {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await live.fetchImpl(`${live.url}/rest/v1/corpus_records?select=${select}&dataset=eq.${dataset}${extra}&order=id.asc&limit=1000&offset=${offset}`, {headers: live.headers, signal: AbortSignal.timeout(120000)});
    if (!r.ok) throw new Error(`HTTP ${r.status} ${dataset} offset ${offset}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export function plan(swRows, clRows) {
  const byKey = new Map();
  for (const r of clRows) {
    const c = r.cells; const key = docketKey(c.court_id, c.docket_number);
    if (!key) continue;
    byKey.set(key, byKey.has(key) ? {ambiguous: true} : {native_id: c.native_id, row_id: r.id, date_filed: c.date_filed, date_terminated: c.date_terminated, source_as_of: c.source_as_of});
  }
  const stats = {sw_rows: swRows.length, filed_blank: 0, filed_blank_with_exact_unique_native_match: 0, filed_blank_ambiguous_native_key: 0, filed_blank_no_native_match: 0,
    filed_blank_unparseable_docket_number: 0, terminated_blank: 0, terminated_blank_native_has_termination_date: 0, populated_filed_checked: 0, populated_filed_agree: 0, populated_filed_conflict: 0};
  const candidates = [], conflicts = [];
  for (const r of swRows) {
    const c = r.cells; const key = docketKey(c.court_id, c.docket_number);
    const hit = key ? byKey.get(key) : null;
    if (PLACEHOLDER(c.filed)) {
      stats.filed_blank++;
      if (!key) stats.filed_blank_unparseable_docket_number++;
      else if (!hit) stats.filed_blank_no_native_match++;
      else if (hit.ambiguous) stats.filed_blank_ambiguous_native_key++;
      else if (!PLACEHOLDER(hit.date_filed)) { stats.filed_blank_with_exact_unique_native_match++; candidates.push({target_dataset: 'sw_matter_dockets_v1', target_id: r.id, field: 'filed', value: hit.date_filed, source: 'courtlistener bulk native docket', native_docket_id: hit.native_id, source_row: hit.row_id, source_as_of: hit.source_as_of, docket_key: key, basis: 'exact court id + exact docket key, unique native row'}); }
    } else if (hit && !hit.ambiguous && !PLACEHOLDER(hit.date_filed)) {
      stats.populated_filed_checked++;
      if (String(c.filed) === String(hit.date_filed)) stats.populated_filed_agree++;
      else { stats.populated_filed_conflict++; conflicts.push({target_dataset: 'sw_matter_dockets_v1', target_id: r.id, field: 'filed', existing: c.filed, incoming: hit.date_filed, native_docket_id: hit.native_id, docket_key: key, applied: false}); }
    }
    if (PLACEHOLDER(c.terminated)) {
      stats.terminated_blank++;
      if (hit && !hit.ambiguous && !PLACEHOLDER(hit.date_terminated)) { stats.terminated_blank_native_has_termination_date++; candidates.push({target_dataset: 'sw_matter_dockets_v1', target_id: r.id, field: 'terminated', value: hit.date_terminated, source: 'courtlistener bulk native docket', native_docket_id: hit.native_id, source_row: hit.row_id, source_as_of: hit.source_as_of, docket_key: key, basis: 'exact court id + exact docket key, unique native row'}); }
    }
  }
  return {stats, candidates, conflicts};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2];
  const live = new Live();
  const sw = (await pageAll(live, 'sw_matter_dockets_v1', 'id,cells:item->cells')).filter(r => r.cells);
  const cl = (await pageAll(live, 'cl_docket_metadata', 'id,cells:item->cells')).filter(r => r.cells);
  const result = plan(sw, cl);
  result.stats.cl_native_rows = cl.length;
  if (outDir) {
    await fs.mkdir(outDir, {recursive: true});
    await fs.writeFile(path.join(outDir, 'crosswalk-fill-candidates.jsonl'), result.candidates.map(x => JSON.stringify(x)).join('\n') + '\n');
    await fs.writeFile(path.join(outDir, 'crosswalk-conflicts.jsonl'), result.conflicts.map(x => JSON.stringify(x)).join('\n') + (result.conflicts.length ? '\n' : ''));
    await fs.writeFile(path.join(outDir, 'crosswalk-stats.json'), JSON.stringify({measured_at: new Date().toISOString(), ...result.stats}, null, 2));
  }
  console.log(JSON.stringify(result.stats, null, 2));
}
