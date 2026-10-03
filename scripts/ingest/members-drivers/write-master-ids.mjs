// Writes _work/contracts/registry-master-ids.md from the registry bundles (master identity per MDL: exact-join, ambiguous, excluded, blocked).
// node write-master-ids.mjs <comma mdls in order> <live mdls comma>
import fs from 'node:fs';
const staging = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members/registry-staging';
const mdls = (process.argv[2] ?? '').split(',').filter(Boolean);
const live = new Set((process.argv[3] ?? '').split(',').filter(Boolean));
const PRIORITY_NUM = ['courtlistener_header', 'docketbird_id', 'firm_crosswalk', 'jpml_schedule_as_printed', 'official_court_page', 'master_party_list'];
const numRank = s => { const i = PRIORITY_NUM.indexOf(s); return i < 0 ? 99 : i; };
const rows = [];
const special = [];
for (const m of mdls) {
  const b = JSON.parse(fs.readFileSync(`${staging}/bundle-${m}.json`, 'utf8'));
  const d = b.dockets.find(x => x.role === 'master');
  const num = [...d.docket_numbers].sort((a, c) => numRank(a.source) - numRank(c.source))[0]?.value ?? '';
  const cl = d.provider_ids.filter(p => p.provider === 'courtlistener');
  const kept = cl.filter(p => !/header_conflicts/.test(p.resolution_basis ?? ''));
  const excl = cl.filter(p => /header_conflicts/.test(p.resolution_basis ?? ''));
  const db = d.provider_ids.find(p => p.provider === 'docketbird')?.id ?? '';
  const oc = d.provider_ids.find(p => p.provider === 'official-court')?.id ?? '';
  const flags = [];
  if (kept.length > 1) flags.push('AMBIGUOUS (several CourtListener dockets share court + number)');
  if (excl.length) flags.push('CONFLICT (firm crosswalk id excluded)');
  if (kept.some(p => p.blocked)) flags.push('BLOCKED at source');
  if (!kept.length) flags.push('NO CourtListener id');
  rows.push(`| ${m} | ${b.seed.tier.replace('tier', 'T')} | ${d.court_id} | ${num} | ${kept.map(p => `${p.id}${p.blocked ? ' (blocked)' : ''}`).join(', ') || '-'} | ${excl.map(p => p.id).join(', ') || '-'} | ${db || '-'} | ${oc || '-'} | ${flags.join('; ') || 'exact'} | ${live.has(m) ? 'live' : 'bundle only'} |`);
  if (kept.length > 1 || excl.length || kept.some(p => p.blocked)) special.push({ m, d, kept, excl, cl });
}
const out = [];
out.push('# Registry master docket ids (authoritative where the registry has them)');
out.push('');
out.push('Owner: `mdl-members`. Consumer: `data-quality` (fills `mdls.cl_docket_id`). Generated ' + new Date().toISOString() + ' from the registry bundles; contract `sw-matter-registry.md` v1.3.');
out.push('');
out.push('How to read: **CourtListener id(s) used** are ids whose own header has the master\'s court and docket number (exact join, `courtlistener.dockets` header captured). "live" rows are published in `sw_matters_v1` / `sw_matter_dockets_v1`; "bundle only" rows have the identity resolved but are not projected yet (Tier-2 pipeline pending). `mdls.cl_docket_id` should be filled only from the **CourtListener id(s) used** column and only when exactly one id is listed and it is not blocked; for the AMBIGUOUS, CONFLICT and BLOCKED rows below leave it empty (or use the id the notes call primary).');
out.push('');
out.push('| MDL | Tier | Court | Docket number | CourtListener id(s) used | CourtListener id excluded | DocketBird id | Official-court id | Status | Registry |');
out.push('|---|---|---|---|---|---|---|---|---|---|');
out.push(...rows);
out.push('');
out.push('## Ambiguous, excluded and blocked master ids (details)');
out.push('');
for (const s of special) {
  out.push(`### MDL ${s.m} — ${s.d.key}`);
  for (const p of s.cl) out.push(`* CourtListener ${p.id}: ${p.resolution_basis}${p.pacer_case_id ? `, PACER case id ${p.pacer_case_id}` : ''}${p.blocked ? ', **blocked=true at source** (no entries/parties are collected)' : ''}`);
  for (const n of s.d.notes) out.push(`* note: ${n}`);
  out.push('');
}
out.push('## Rules the registry applies to master ids');
out.push('');
out.push('* A CourtListener docket is the master only if its header has the master\'s court id and docket number (exact join). Several matches are all kept and labelled ambiguous; the one with the most captured docket entries is listed first.');
out.push('* A docket that shares the master\'s number but has a different PACER case id **and** a party-v-party caption is not attached by header. If the firm crosswalk (`mdl_case_inventory`) names it as master, it is kept only as `firm_crosswalk_only_courtlistener_header_conflicts`, flagged `pdf_lookup=false`, and listed in the "excluded" column. MDL 3014: 63571952 (crosswalk) vs 60866823 (exact join).');
out.push('* `blocked=true` dockets (CourtListener withholds relations at source) stay blocked: no entries, parties or attorneys are collected or published for them; DocketBird and official-court pages are the only routes.');
fs.writeFileSync('C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/contracts/registry-master-ids.md', out.join('\n') + '\n');
console.log('written', rows.length, 'rows,', special.length, 'special');
