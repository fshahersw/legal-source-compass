// Smoke test of the read path the app uses (public.corpus_query_bounded) against the two registry datasets, with the server key.
import { rpc } from '../members-pgrest.mjs';
const calls = [
  { p_dataset: 'sw_matters_v1', p_filters: { tier: 'tier1' }, p_q: null, p_limit: 5, p_offset: 0, p_count_cap: 1000 },
  { p_dataset: 'sw_matters_v1', p_filters: {}, p_q: 'insulin', p_limit: 5, p_offset: 0, p_count_cap: 1000 },
  { p_dataset: 'sw_matter_dockets_v1', p_filters: { mdl: '3014', role: 'master' }, p_q: null, p_limit: 5, p_offset: 0, p_count_cap: 1000 },
  { p_dataset: 'sw_matter_dockets_v1', p_filters: { mdl: '3047', basis: 'jpml_cto_schedule' }, p_q: null, p_limit: 3, p_offset: 0, p_count_cap: 5000 },
  { p_dataset: 'sw_matter_dockets_v1', p_filters: { native_case_id: 'cand-4:2022-md-03047' }, p_q: null, p_limit: 3, p_offset: 0, p_count_cap: 1000 },
  { p_dataset: 'sw_matter_dockets_v1', p_filters: { conflict: 'true' }, p_q: null, p_limit: 10, p_offset: 0, p_count_cap: 1000 },
];
for (const c of calls) {
  try {
    const r = await rpc('corpus_query_bounded', c);
    const items = r?.items ?? r?.records ?? [];
    console.log(JSON.stringify({ call: { ds: c.p_dataset, filters: c.p_filters, q: c.p_q }, total: r?.total ?? r?.count ?? null, returned: items.length, first_title: items[0]?.title ?? null, keys: r ? Object.keys(r) : null }));
  } catch (e) { console.log(JSON.stringify({ call: { ds: c.p_dataset, filters: c.p_filters }, error: String(e.message).slice(0, 200) })); }
}
