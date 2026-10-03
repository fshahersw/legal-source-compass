// Prints the per-matter verification table from the PUBLIC projection (what the app reads), via PostgREST with the server key.
// node --use-system-ca verify-table.mjs [--format=md|json]
import { rest } from '../members-pgrest.mjs';

const format = (process.argv.find(a => a.startsWith('--format=')) ?? '--format=md').split('=')[1];
const matters = (await rest('corpus_records?select=id,item,detail&dataset=eq.sw_matters_v1&order=ordinal.asc&limit=500')).data;
const dockets = [];
for (let off = 0; ; off += 1000) {
  const page = (await rest('corpus_records?select=id,item&dataset=eq.sw_matter_dockets_v1&order=ordinal.asc&limit=1000&offset=' + off)).data;
  dockets.push(...page);
  if (page.length < 1000) break;
}
const byMdl = new Map();
for (const d of dockets) {
  const c = d.item.cells;
  const m = byMdl.get(c.mdl) ?? { roles: {}, rows: 0, basis: {} };
  m.rows++; m.roles[c.role] = (m.roles[c.role] ?? 0) + 1;
  for (const b of String(c.basis ?? '').split('; ').filter(Boolean)) m.basis[b] = (m.basis[b] ?? 0) + 1;
  byMdl.set(c.mdl, m);
}
const out = [];
for (const m of matters) {
  const c = m.item.cells; const r = m.detail.registry;
  const ids = role => r.case_ids.filter(x => x.role === role).flatMap(x => x.native_case_ids.map(n => `${n.provider}:${n.id}`)).join(' ');
  const judge = (r.judges ?? []).filter(j => j.role === 'assigned_to').map(j => `${j.source_string ?? '-'}${j.cl_person_id ? ' #' + j.cl_person_id : ' (no native id)'}`).join('; ');
  const e = (r.entries ?? [])[0];
  const parties = (r.parties_summary ?? []).map(p => `${p.kind} ${p.captured}${p.complete ? ' (complete)' : ''}`).join(', ');
  const roles = byMdl.get(String(c.mdl_number))?.roles ?? {};
  out.push({ mdl: c.mdl_number, tier: c.tier, master: ids('master'), jpml_panel: ids('jpml_panel'), judge, rows: c.registry_members, actions: c.registry_actions, by_basis: r.members.by_basis, roles, entries: e ? `${e.captured}/${e.provider_total ?? '?'}${e.complete ? ' complete' : ''}` : 'n/a', parties: parties || 'n/a', jpml: `${c.jpml_pending}/${c.jpml_total}` });
}
if (format === 'json') console.log(JSON.stringify(out));
else {
  console.log('| MDL | Master native ids | JPML panel | Judge (CL native) | Registry dockets (actions) | By evidence kind | Entries captured/total | Parties/attorneys | JPML pending/hist |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const o of out) console.log(`| ${o.mdl} | ${o.master} | ${o.jpml_panel || '-'} | ${o.judge || '-'} | ${o.rows} (${o.actions}) | ${Object.entries(o.by_basis).map(([k, v]) => `${k} ${v}`).join(', ')} | ${o.entries} | ${o.parties} | ${o.jpml} |`);
}
console.error(JSON.stringify({ matters: matters.length, dockets: dockets.length }));
