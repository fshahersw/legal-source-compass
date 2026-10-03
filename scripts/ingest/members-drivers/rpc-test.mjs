// Smoke test of public.corpus_sw_matter_case_ids_v1 through PostgREST with the server key (what the app server sees).
import { rpc } from '../members-pgrest.mjs';
const tests = [
  { p_mdl: '3014', p_roles: ['master', 'jpml_panel'], p_limit: 10, p_offset: 0 },
  { p_mdl: '2804', p_roles: ['master', 'jpml_panel'], p_limit: 10, p_offset: 0 },
  { p_mdl: '3080', p_roles: null, p_limit: 3, p_offset: 0 },
  { p_mdl: '9999', p_roles: null, p_limit: 3, p_offset: 0 },
];
for (const t of tests) {
  try {
    const r = await rpc('corpus_sw_matter_case_ids_v1', t);
    const rows = r?.rows ?? [];
    console.log(JSON.stringify({ args: t, total: r?.total ?? null, matter: r?.matter ?? null, returned: rows.length, first: rows[0] ? { role: rows[0].role, docket_key: rows[0].docket_key, ids: (rows[0].native_case_ids ?? []).map(n => `${n.provider}:${n.id}:${n.resolution_basis ?? '-'}:${n.pdf_lookup}`) } : null, keys: r ? Object.keys(r) : null }));
  } catch (e) { console.log(JSON.stringify({ args: t, error: String(e.message).slice(0, 200) })); }
}
