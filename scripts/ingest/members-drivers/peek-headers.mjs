// node peek-headers.mjs <docket ids...>  — prints identity fields of the latest stored CourtListener docket header per id
import fs from 'node:fs';
import path from 'node:path';
const passes = [
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T101805Z', 'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T112700Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T115000Z', 'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T124500Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members',
];
const want = new Set(process.argv.slice(2));
const best = new Map();
for (const p of passes) for (const f of ['source-docket-headers.jsonl', 'live-normalized/dockets.jsonl']) {
  const file = path.join(p, f);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || !want.size) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.entity_type !== 'dockets' || !want.has(r.native_id)) continue;
    const prev = best.get(r.native_id);
    if (!prev || String(r.provenance.retrieved_at) >= String(prev.provenance.retrieved_at)) best.set(r.native_id, r);
  }
}
for (const [id, r] of best) {
  const d = r.data;
  console.log(JSON.stringify({ id, court_id: d.court_id, docket_number: d.docket_number, case_name: d.case_name, pacer_case_id: d.pacer_case_id, date_filed: d.date_filed, date_terminated: d.date_terminated, assigned_to_str: d.assigned_to_str, mdl_status: d.mdl_status ?? null, blocked: d.blocked ?? null, retrieved_at: r.provenance.retrieved_at }));
}
