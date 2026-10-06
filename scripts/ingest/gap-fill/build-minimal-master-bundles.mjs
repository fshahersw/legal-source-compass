// Minimal bundle-<mdl>.json for members-project-extras (lake read only; no CourtListener API).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Live } from './gap-analysis-live.mjs';
import { pageAll } from './plan-internal-crosswalk.mjs';
import { docketKeyFromNumber, courtOfKey } from '../members-registry-lib.mjs';

const T1 = new Set([3047, 3140, 3094, 3163, 3180, 3166, 3080, 3113, 3081, 2846, 2873, 2804, 3108, 3149, 3114, 3185, 3125, 3144, 3043, 3060, 3014, 2738, 2741, 3026]);
const staging = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'minimal-staging'));
await fs.mkdir(staging, { recursive: true });

const mdls = await pageAll(new Live(), 'mdls', 'id,item,filters');
let written = 0;
for (const m of mdls) {
  const mdl = Number(m.id);
  if (!T1.has(mdl)) continue;
  const i = m.item ?? {};
  const cl = String(i.cl_docket_id ?? '');
  if (!/^\d+$/.test(cl)) continue;
  const court = i.cl_court_id ?? i.transferee_court_id;
  const num = i.master_docket;
  if (!court || !num) continue;
  const key = docketKeyFromNumber(court, num);
  if (!key) continue;
  const tier = m.filters?.tier === 'tier1' ? 1 : m.filters?.tier === 'tier2' ? 2 : 1;
  const bundle = {
    schema_version: 'sw-matter-registry-bundle/1',
    mdl,
    built_at: new Date().toISOString(),
    seed: { tier, caption: i.caption ?? null, cl_master_ids: [cl], registry_projected: true },
    counts: { dockets: 1, member_like_dockets: 0, evidence: 0, by_basis: {}, docketbird_members: 0, crosswalk_rows: 0, candidate_identity_links: 0 },
    candidate_identity_links: [],
    docketbird_graph: [],
    entry_captures: [],
    party_captures: [],
    jpml_documents: [],
    dockets: [{
      key,
      court_id: courtOfKey(key),
      docket_numbers: [{ value: num, source: 'mdls.cl_docket_id' }],
      provider_ids: [{ provider: 'courtlistener', source_system: 'courtlistener', id: cl, url: `https://www.courtlistener.com/docket/${cl}/`, resolution_basis: 'mdls.cl_docket_id' }],
      captions: [],
      date_filed: null,
      date_terminated: null,
      judge_refs: [],
      roles: ['master'],
      roles_stated: ['master'],
      routes: [],
      basis: ['mdls_master'],
      evidence_ids: [],
      notes: ['Minimal bundle for lake-only entry projection (CourtListener expand worker)'],
      role: 'master',
      route: 'unknown',
    }],
    evidence: [],
  };
  await fs.writeFile(path.join(staging, `bundle-${mdl}.json`), JSON.stringify(bundle, null, 1));
  written++;
}
console.log(JSON.stringify({ staging, bundles: written }));
