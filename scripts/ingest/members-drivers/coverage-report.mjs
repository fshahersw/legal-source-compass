// Coverage of the Tier-1 masters: entries / parties / attorneys in the lake (as projected) versus the CourtListener totals from the service's count tasks.
//   node coverage-report.mjs            -> prints a markdown table and writes registry-staging/coverage-latest.json
import fs from 'node:fs';
import path from 'node:path';
const work = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members';
const pass = 'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members';
const extras = JSON.parse(fs.readFileSync(path.join(work, 'registry-staging', 'extras-summary.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(pass, 'live-backfill-manifest.json'), 'utf8'));
// count tasks: kind + docket_id -> latest count
const counts = new Map();
for (const f of fs.readdirSync(path.join(pass, 'done')).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(pass, 'done', f), 'utf8'));
  const r = j.result;
  if (r && r.kind && r.count != null && r.docket_id != null) counts.set(`${r.kind}:${r.docket_id}`, r.count);
}
const T1 = [3047, 3140, 3094, 3163, 3180, 3166, 3080, 3113, 3081, 2846, 2873, 2804, 3108, 3149, 3114, 3185, 3125, 3144, 3043, 3060, 3014, 2738, 2741, 3026];
const masters = {};
for (const m of T1) {
  const b = JSON.parse(fs.readFileSync(path.join(work, 'registry-staging', `bundle-${m}.json`), 'utf8'));
  const master = b.dockets.find(d => d.role === 'master');
  const cl = (master.provider_ids ?? []).filter(p => p.provider === 'courtlistener' && !/header_conflicts/.test(p.resolution_basis ?? ''));
  masters[m] = { cl_ids: cl.filter(p => p.blocked !== true).map(p => String(p.id)), blocked: cl.some(p => p.blocked === true) };
}
const rows = [];
for (const m of T1) {
  const s = extras.matters?.[m] ?? extras[m] ?? null;
  const ids = masters[m].cl_ids;
  const id = ids[0] ?? null;
  const cnt = k => (id ? counts.get(`${k}:${id}`) ?? null : null);
  const sc = k => (id ? manifest.scopes?.[`${k}:${id}`] : null);
  rows.push({
    mdl: m, cl_id: id, blocked: masters[m].blocked,
    entries_projected: s?.entries?.projected ?? 0, entries_total_cl: cnt('docket-entries'), entries_scope_complete: sc('docket-entries')?.complete ?? null,
    parties_projected: s?.parties?.projected ?? 0, parties_total_cl: cnt('parties'), parties_scope_complete: sc('parties')?.complete ?? null,
    attorneys_scope_records: sc('attorneys')?.records ?? null, attorneys_total_cl: cnt('attorneys'), attorneys_scope_complete: sc('attorneys')?.complete ?? null,
    counsel_links: s?.parties?.counsel_links ?? 0, counsel_unresolved: s?.parties?.counsel_unresolved ?? 0,
    external: s?.entries?.external ?? null,
  });
}
fs.writeFileSync(path.join(work, 'registry-staging', 'coverage-latest.json'), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
const f = x => (x == null ? '-' : String(x));
console.log('| MDL | CL id | entries projected / CL total | entries done | parties projected / CL total | parties done | attorneys collected / CL total | attorneys done | counsel links (unresolved) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.mdl} | ${r.blocked ? 'blocked' : f(r.cl_id)} | ${r.entries_projected} / ${f(r.entries_total_cl)}${r.external ? ` (+${Object.values(r.external).reduce((a, c) => a + c, 0)} external)` : ''} | ${f(r.entries_scope_complete)} | ${r.parties_projected} / ${f(r.parties_total_cl)} | ${f(r.parties_scope_complete)} | ${f(r.attorneys_scope_records)} / ${f(r.attorneys_total_cl)} | ${f(r.attorneys_scope_complete)} | ${r.counsel_links} (${r.counsel_unresolved}) |`);
