// Discover DocketBird case ids in scope for the expanded Seeger Weiss / MDL backfill.
// Scope: every sw_matters_v1 MDL, and every sw_matter_dockets_v1 row in those MDLs whose
// detail.registry.membership_basis includes explicit MDL membership evidence (never caption/judge/firm/court alone).
// Output: universe.json + partition-<shards>.json (disjoint case lists per shard).
//   node discover-docketbird-universe.mjs --out=<dir> [--shards=4] [--exclude=case,case]
import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicWriteJson} from './lib.mjs';
import {Live} from './gap-analysis-live.mjs';
import {pageAll} from './plan-internal-crosswalk.mjs';

const ALLOWED_BASIS = new Set([
  'docketbird_relationship', 'jpml_schedule_a', 'jpml_cto_schedule', 'docket_transfer_entry', 'native_crosswalk', 'fjc_idb_mdl_number',
]);
const TIER1 = [
  'azd-2:2023-md-03081', 'scd-2:2018-mn-02873', 'pawd-2:2021-mc-01230', 'nysd-1:2022-md-03043', 'ilnd-1:2023-cv-00818', 'ohnd-1:2017-md-02804',
  'cand-4:2022-md-03047', 'casd-3:2024-md-03125', 'flnd-3:2025-md-03140', 'ilnd-1:2022-cv-00071', 'njd-2:2023-md-03080', 'casd-3:2025-md-03149',
  'cacd-2:2025-ml-03144', 'mnd-0:2024-md-03108', 'cand-3:2025-md-03166', 'ohsd-2:2018-md-02846', 'njd-2:2024-md-03113', 'paed-2:2024-md-03094',
  'paed-2:2025-md-03163', 'txnd-3:2024-md-03114', 'moed-4:2026-md-03185', 'njd-3:2026-md-03180', 'njd-3:2016-md-02738', 'cand-3:2016-md-02741',
];

function dbCaseId(x) {
  const id = String(x?.id ?? '');
  if (!/^[a-z]{2,4}-\d:/.test(id)) return null;
  if (x.provider === 'docketbird' || x.source_system === 'docketbird-rest') return id;
  return null;
}

export async function discover({exclude = new Set()} = {}) {
  const live = new Live();
  const matters = await pageAll(live, 'sw_matters_v1', 'id,filters,item');
  const swMdls = new Set(matters.map(m => String(m.filters?.mdl ?? '').trim()).filter(Boolean));
  const mdls = await pageAll(live, 'mdls', 'id,item,filters');
  const cases = new Map();
  const dockets = await pageAll(live, 'sw_matter_dockets_v1', 'id,filters,detail');
  for (const d of dockets) {
    const mdl = d.filters?.mdl;
    if (!mdl || !swMdls.has(String(mdl))) continue;
    const basis = d.detail?.registry?.membership_basis ?? [];
    if (!basis.some(b => ALLOWED_BASIS.has(b))) continue;
    for (const x of d.detail?.registry?.native_case_ids ?? []) {
      const cid = dbCaseId(x);
      if (!cid || exclude.has(cid)) continue;
      if (!cases.has(cid)) cases.set(cid, {case_id: cid, mdls: new Set(), registry_dockets: 0, membership_basis: new Set()});
      const c = cases.get(cid);
      c.mdls.add(String(mdl));
      c.registry_dockets++;
      for (const b of basis) if (ALLOWED_BASIS.has(b)) c.membership_basis.add(b);
    }
  }
  const list = [...cases.values()].map(c => ({
    case_id: c.case_id,
    mdls: [...c.mdls].sort(),
    registry_dockets: c.registry_dockets,
    membership_basis: [...c.membership_basis].sort(),
    tier1_rank: TIER1.indexOf(c.case_id),
  }));
  list.sort((a, b) => {
    const ta = a.tier1_rank >= 0 ? a.tier1_rank : 1e6;
    const tb = b.tier1_rank >= 0 ? b.tier1_rank : 1e6;
    if (ta !== tb) return ta - tb;
    return a.case_id.localeCompare(b.case_id);
  });
  return {
    discovered_at: new Date().toISOString(),
    sw_matters: matters.length,
    jpml_mdls_in_corpus: mdls.length,
    sw_mdl_numbers: [...swMdls].sort(),
    scoped_registry_dockets_with_explicit_mdl_basis: dockets.filter(d => {
      const mdl = d.filters?.mdl;
      if (!mdl || !swMdls.has(String(mdl))) return false;
      return (d.detail?.registry?.membership_basis ?? []).some(b => ALLOWED_BASIS.has(b));
    }).length,
    docketbird_cases: list.length,
    cases: list,
  };
}

export function partition(universe, shards) {
  const parts = Array.from({length: shards}, () => []);
  universe.cases.forEach((c, i) => parts[i % shards].push(c.case_id));
  return parts.map((ids, i) => ({shard: i, shards, case_ids: ids}));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const out = path.resolve(args.out ?? '/tmp/gf/universe');
  const shards = Number(args.shards ?? 4);
  const exclude = new Set(String(args.exclude ?? '').split(',').map(s => s.trim()).filter(Boolean));
  const universe = await discover({exclude});
  await fs.mkdir(out, {recursive: true});
  await atomicWriteJson(path.join(out, 'universe.json'), universe);
  const parts = partition(universe, shards);
  for (const p of parts) await atomicWriteJson(path.join(out, `partition-shard-${p.shard}-of-${p.shards}.json`), p);
  console.log(JSON.stringify({out, sw_matters: universe.sw_matters, docketbird_cases: universe.docketbird_cases, shards, per_shard: parts.map(p => p.case_ids.length)}));
}
