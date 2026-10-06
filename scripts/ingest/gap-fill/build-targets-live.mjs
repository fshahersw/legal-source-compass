// Builds the prioritised, deduplicated target list for run-gap-fill.mjs from the live gaps (read-only).
//   P1  cl-find for registry dockets with a blank filing date (exact court + docket number; Tier-1 matters first)
//   P1  cl-find for JPML MDLs with no recorded CourtListener master docket id
// Rows with an unparseable docket number are skipped, never guessed.
import fs from 'node:fs/promises';
import {docketKey, isBlank} from './lib.mjs';
import {Live} from './gap-analysis-live.mjs';
import {pageAll} from './plan-internal-crosswalk.mjs';

const blank = v => isBlank(v) || /^not recorded$/i.test(String(v).trim());

export function buildTargets(swRows, mdlRows) {
  const seen = new Set(), out = [];
  const add = (t, key) => { if (!seen.has(key)) { seen.add(key); out.push(t); } };
  for (const m of mdlRows) {
    const i = m.item ?? {};
    if (blank(i.cl_docket_id) && !blank(i.cl_court_id) && !blank(i.master_docket)) add({kind: 'cl-find', court: i.cl_court_id, docket_number: i.master_docket, priority: 1, reason: 'mdls.cl_docket_id blank', mdl: String(i.mdl_number ?? m.id)}, `${i.cl_court_id}|${i.master_docket}`);
  }
  const rank = r => (r.filters?.tier === 'tier1' ? 0 : r.filters?.tier === 'tier2' ? 1 : 2);
  for (const r of [...swRows].sort((a, b) => rank(a) - rank(b))) {
    const c = r.cells; if (!c || !blank(c.filed) || !docketKey(c.court_id, c.docket_number)) continue;
    add({kind: 'cl-find', court: c.court_id, docket_number: c.docket_number, priority: 2 + rank(r), reason: 'sw_matter_dockets_v1.filed blank'}, `${c.court_id}|${c.docket_number}`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const live = new Live();
  const sw = await pageAll(live, 'sw_matter_dockets_v1', 'id,cells:item->cells,filters');
  const mdls = await pageAll(live, 'mdls', 'id,item');
  const t = buildTargets(sw, mdls);
  await fs.writeFile(process.argv[2], t.map(x => JSON.stringify(x)).join('\n') + '\n');
  console.log(JSON.stringify({targets: t.length, p1: t.filter(x => x.priority === 1).length}));
}
