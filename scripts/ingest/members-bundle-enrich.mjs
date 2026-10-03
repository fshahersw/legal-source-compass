// Enriches the matter bundles (registry-staging/bundle-<mdl>.json) with CourtListener docket headers that are already in the lake
// (public.corpus_sw_docket_headers_v1; no REST quota):
//   (a) court-record captions (and filed/terminated dates) for member dockets whose CourtListener id is already known, and
//   (b) EXACT court + docket-key resolution of member dockets that have no CourtListener id yet (several matches are recorded as ambiguous; nothing is attached).
// A header whose own court+number does not equal the docket key is not used; a docket flagged blocked at source is never attached and gives no caption.
// Idempotent; run after members-bundle.mjs and before members-registry-post.mjs.
//
// node --use-system-ca scripts/ingest/members-bundle-enrich.mjs --mdls=3047,3140,...
import fs from 'node:fs';
import path from 'node:path';
import { rpc } from './members-pgrest.mjs';
import { parseDocketNumber, docketKey } from './members-registry-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
const mdls = (args.mdls ?? '').split(',').filter(Boolean).map(Number);
if (!mdls.length) throw new Error('--mdls is required');
const staging = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members/registry-staging';
const instCaption = s => { const t = String(s ?? ''); if (/\s(?:v|vs)\.?\s/i.test(t)) return false; return /^\s*in\s*re\b/i.test(t) || /\b(?:litigation|multidistrict|antitrust|data security breach|products liability)\b/i.test(t); };
const bundles = new Map(mdls.map(m => [m, JSON.parse(fs.readFileSync(path.join(staging, `bundle-${m}.json`), 'utf8'))]));

const byIdTargets = new Map(); // CL id -> [{b, d}]
const byKeyTargets = new Map(); // docket key -> [{b, d}]
for (const [, b] of bundles) for (const d of b.dockets) {
  if (d.role === 'master' || d.role === 'jpml_panel') continue;
  const cl = d.provider_ids.filter(p => p.provider === 'courtlistener' && !/header_conflicts/.test(p.resolution_basis ?? ''));
  if (cl.length) for (const p of cl) byIdTargets.set(String(p.id), [...(byIdTargets.get(String(p.id)) ?? []), { b, d }]);
  else byKeyTargets.set(d.key, [...(byKeyTargets.get(d.key) ?? []), { b, d }]);
}
const stats = { by_id_requested: byIdTargets.size, by_id_found: 0, captions_attached: 0, header_mismatch: 0, blocked_skipped: 0, by_key_requested: byKeyTargets.size, by_key_unique: 0, by_key_ambiguous: 0, by_key_none: 0 };

function attachHeader(d, clId, r) {
  const h = r.header;
  const hk = h.docket_number ? docketKey(h.court_id, parseDocketNumber(h.docket_number)) : null;
  if (hk !== d.key) { stats.header_mismatch++; if (!d.notes.some(n => n.includes(`CourtListener ${clId} header`))) d.notes.push(`CourtListener ${clId} header (${h.court_id} ${h.docket_number}) does not equal this docket key; caption and dates not taken`); return false; }
  if (h.blocked === true) { stats.blocked_skipped++; if (!d.notes.some(n => n.includes(`CourtListener ${clId} is flagged blocked`))) d.notes.push(`CourtListener ${clId} is flagged blocked at source; caption not taken`); return false; }
  if (h.case_name && !d.captions.some(c => c.source === 'courtlistener_header' && String(c.cl_docket_id) === clId)) { d.captions.push({ value: h.case_name, source: 'courtlistener_header', institutional: instCaption(h.case_name), retrieved_at: r.retrieved_at, cl_docket_id: clId }); stats.captions_attached++; }
  d.date_filed = d.date_filed ?? h.date_filed ?? null;
  d.date_terminated = d.date_terminated ?? h.date_terminated ?? null;
  if (h.docket_number && !d.docket_numbers.some(x => x.value === h.docket_number && x.source === 'courtlistener_header')) d.docket_numbers.push({ value: h.docket_number, source: 'courtlistener_header' });
  const pid = d.provider_ids.find(p => p.provider === 'courtlistener' && String(p.id) === clId);
  if (pid) { pid.pacer_case_id ??= h.pacer_case_id ?? null; pid.header_retrieved_at ??= r.retrieved_at; }
  return true;
}

const ids = [...byIdTargets.keys()];
for (let i = 0; i < ids.length; i += 400) {
  for (const r of await rpc('corpus_sw_docket_headers_v1', { p_mode: 'by-id', p_ids: ids.slice(i, i + 400) })) {
    stats.by_id_found++;
    for (const { d } of byIdTargets.get(r.cl_id) ?? []) attachHeader(d, r.cl_id, r);
  }
}
const keys = [...byKeyTargets.keys()];
const found = new Map();
for (let i = 0; i < keys.length; i += 1500) for (const r of await rpc('corpus_sw_docket_headers_v1', { p_mode: 'by-key', p_ids: keys.slice(i, i + 1500) })) found.set(r.docket_key, [...(found.get(r.docket_key) ?? []), r]);
for (const key of keys) {
  const list = found.get(key) ?? [];
  if (!list.length) { stats.by_key_none++; continue; }
  for (const { d } of byKeyTargets.get(key)) {
    if (list.length > 1) { stats.by_key_ambiguous++; const msg = `Ambiguous: ${list.length} CourtListener dockets (${list.map(r => r.cl_id).join(', ')}) match this court and docket number exactly; none attached`; if (!d.notes.includes(msg)) d.notes.push(msg); continue; }
    const r = list[0];
    if (r.header.blocked === true) { stats.blocked_skipped++; const msg = `CourtListener ${r.cl_id} matches this court and docket number but is flagged blocked at source; not attached`; if (!d.notes.includes(msg)) d.notes.push(msg); continue; }
    if (!d.provider_ids.some(p => p.provider === 'courtlistener' && String(p.id) === r.cl_id)) d.provider_ids.push({ provider: 'courtlistener', source_system: 'courtlistener', id: r.cl_id, url: `https://www.courtlistener.com/docket/${r.cl_id}/`, resolution_basis: 'exact_docket_key_lake_header', pacer_case_id: r.header.pacer_case_id ?? null, header_retrieved_at: r.retrieved_at });
    if (attachHeader(d, r.cl_id, r)) stats.by_key_unique++;
  }
}
for (const [m, b] of bundles) { b.enrich = { at: new Date().toISOString(), basis: 'lake CourtListener docket headers (public.corpus_sw_docket_headers_v1)' }; fs.writeFileSync(path.join(staging, `bundle-${m}.json`), JSON.stringify(b, null, 1)); }
console.log(JSON.stringify({ event: 'enriched', matters: mdls.length, ...stats }));
