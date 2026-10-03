// Smoke test of public.corpus_sw_registry_read_v1 through PostgREST with the server key (never prints contact data: only counts and key sets).
import { rpc } from '../members-pgrest.mjs';
const e = await rpc('corpus_sw_registry_read_v1', { p_kind: 'docket-entries', p_docket_ids: ['68869775'], p_after: null, p_limit: 3 });
console.log(JSON.stringify({ kind: 'docket-entries', rows: e.rows.length, next: e.next, first_keys: Object.keys(e.rows[0]?.data ?? {}).slice(0, 8), first_native: e.rows[0]?.native_id }));
const p = await rpc('corpus_sw_registry_read_v1', { p_kind: 'parties', p_docket_ids: ['72030009'], p_after: null, p_limit: 2 });
console.log(JSON.stringify({ kind: 'parties', rows: p.rows.length, next: p.next, first_keys: Object.keys(p.rows[0]?.data ?? {}), attorneys_in_first: p.rows[0]?.data?.attorneys?.length ?? 0 }));
const ids = [...new Set(p.rows.flatMap(r => (r.data.attorneys ?? []).map(a => String(a.attorney_id))))].slice(0, 5);
const a = await rpc('corpus_sw_registry_read_v1', { p_kind: 'attorneys', p_ids: ids, p_after: null, p_limit: 10 });
console.log(JSON.stringify({ kind: 'attorneys', asked: ids.length, rows: a.rows.length, keys: Object.keys(a.rows[0]?.data ?? {}), lines_in_first: a.rows[0]?.data?.contact_lines?.length ?? null, has_email_key: 'email' in (a.rows[0]?.data ?? {}) }));
