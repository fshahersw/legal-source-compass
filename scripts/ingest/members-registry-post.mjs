// Converts a matter bundle (members-bundle.mjs) into sw-matter-registry entity rows + relationships and writes them
// through public.corpus_registry_intake_v1 / corpus_registry_relationships_v1 (service_role).
//
// node --use-system-ca scripts/ingest/members-registry-post.mjs --mdl=3047 --run=<registry run uuid> [--dry-run=true]
import fs from 'node:fs';
import path from 'node:path';
import { rest } from './members-pgrest.mjs';
import { REGISTRY_SOURCE, sha256, canonSha, registryRow, courtOfKey, docketNumberFromKey, docketbirdIdFromKey } from './members-registry-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
const mdl = Number(args.mdl);
const run = args.run;
if (!mdl || !/^[0-9a-f-]{36}$/.test(run ?? '')) throw new Error('--mdl and --run are required');
const dry = args['dry-run'] === 'true';
const work = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members';
const stagingDir = path.join(work, 'registry-staging');
const bundle = JSON.parse(fs.readFileSync(path.join(stagingDir, `bundle-${mdl}.json`), 'utf8'));
const clean = x => JSON.parse(JSON.stringify(x)); // drops undefined, enforces JSON-only values
const matterId = `mdl:${mdl}`;
const seed = bundle.seed;
const jpml = seed.jpml;
const BUILT = bundle.built_at;

// existing public MDL directory (JPML 2026-09-01 listing) for judge strings; absent for closed or very new MDLs
const mdls = (await rest(`corpus_records?select=id,item,tj:detail->transferee_judge,court:detail->court_name,dt:detail->date_transferred,asof:detail->temporal->source_as_of&dataset=eq.mdls&id=eq.${mdl}`)).data[0] ?? null;

const rows = [];
const rels = [];
const row = (type, nativeId, data, prov) => { const r = registryRow(type, nativeId, clean(data), prov); rows.push(r); return r; };

// ----- dockets -----
const firstTransfer = bundle.jpml_documents.filter(d => d.doc_type === 'transfer_order' && d.doc_date).map(d => d.doc_date).sort()[0] ?? null;
const memberDockets = bundle.dockets.filter(d => d.role !== 'master' && d.role !== 'jpml_panel');
const masters = bundle.dockets.filter(d => d.role === 'master').map(d => d.key);
const panels = bundle.dockets.filter(d => d.role === 'jpml_panel').map(d => d.key);
const distinctMembers = memberDockets.length;
const gaps = [];
if (jpml?.pending != null) gaps.push(`Registry holds ${distinctMembers} distinct member-like dockets; JPML reports ${jpml.pending} pending and ${jpml.historical} historical actions (${jpml.report_date}). The registry is evidence-backed, not a member census.`);
for (const c of bundle.entry_captures) if (!c.complete) gaps.push(`CourtListener docket entries ${c.cl_docket_id}: ${c.captured_manifest_records} captured, provider total ${c.provider_total ?? 'not recorded'}; cursor ${c.next_cursor_retained ? 'retained' : 'none'}.`);
if (!panels.length) gaps.push('No JPML panel docket identified in DocketBird for this MDL number.');
for (const g of bundle.docketbird_graph ?? []) gaps.push(`DocketBird member graph (${g.retrieved_at}): ${g.returned} member dockets returned${g.total_members != null && g.total_members !== g.returned ? ` of ${g.total_members} indexed` : ''}${g.truncated ? ' (truncated by the row limit)' : ''}; a short or empty answer describes DocketBird's index, not membership.`);
const matterData = {
  mdl_number: mdl, caption_as_printed: seed.caption, caption_source: { kind: 'jpml_report', url: jpml?.url ?? null, as_of: jpml?.report_date ?? null },
  status: jpml?.scope?.startsWith('active') ? (jpml.pending === 0 ? 'no_pending_actions' : 'pending') : jpml?.scope?.startsWith('terminated') ? 'terminated' : 'unknown', status_source: { kind: 'jpml_report', url: jpml?.url ?? null, as_of: jpml?.report_date ?? null, scope: jpml?.scope ?? null },
  tier: seed.tier, transferee_court_id: masters[0] ? courtOfKey(masters[0]) : null, date_centralized: firstTransfer, date_centralized_source: firstTransfer ? 'earliest JPML transfer order parsed by the registry' : null,
  jpml_counts: { as_of: jpml?.report_date ?? null, pending: jpml?.pending ?? null, historical_total: jpml?.historical ?? null, report_url: jpml?.url ?? null },
  judge_strings: mdls?.tj?.name_as_printed ? [{ string: mdls.tj.name_as_printed, source: 'mdls directory (JPML report 2026-09-01 by-district Judge column)', as_of: mdls.asof ?? '2026-09-01' }] : [],
  masters, jpml_panel: panels, docketbird_graph: bundle.docketbird_graph ?? [], firm_evidence: { note: 'Firm-linked source evidence only (CourtListener firm index, DocketBird appearances); not a representation or current-participation claim', parent_matters_csv_role: null },
  known_gaps: gaps,
};
row('matter', matterId, matterData, { sourceUrl: jpml?.url ?? 'https://www.jpml.uscourts.gov/pending-mdls-0', retrievedAt: BUILT, sourceAsOf: jpml?.report_date ?? null });

const docketIdx = new Map();
for (const d of bundle.dockets) {
  const providerIds = d.provider_ids;
  const cl = providerIds.find(p => p.provider === 'courtlistener');
  const caseType = d.key.match(/-([a-z]+)-\d{5}$/)?.[1] ?? null;
  const data = {
    docket_key: d.key, court_id: d.court_id, case_type: caseType, docket_number_as_recorded: d.docket_numbers, provider_ids: providerIds,
    captions: d.captions.map(c => ({ value: c.value, source: c.source, institutional: c.institutional === true })),
    date_filed: d.date_filed ?? null, year_filed: d.year_filed ?? null, date_terminated: d.date_terminated ?? null, header_termination_note: d.cl_header_date_terminated_note ?? null,
    judge_refs: d.judge_refs, held: d.notes.length ? d.notes : [], schema_note: 'Provider ids are linked only by exact court + docket key; no cross-provider merge of native entities.',
  };
  const url = cl ? cl.url : providerIds[0]?.url ?? 'https://www.docketbird.com/';
  const r = row('docket', d.key, data, { sourceUrl: url, retrievedAt: BUILT });
  docketIdx.set(d.key, r);
}

// ----- matter-dockets -----
const mdIdx = new Map();
for (const d of bundle.dockets) {
  const evs = bundle.evidence.filter(e => e.claim.member_docket_key === d.key);
  const firstEv = evs.map(e => e.retrieved_at).sort()[0] ?? BUILT;
  const actionId = 'act:' + sha256(d.key).slice(0, 16);
  const data = {
    matter: matterId, docket_key: d.key, role: d.role, roles_stated: d.roles_stated, route: d.route, membership_basis: [...d.basis], evidence_ids: d.evidence_ids,
    first_evidence_at: firstEv, action_id: actionId, counts_as_action: !['master', 'jpml_panel', 'not_member'].includes(d.role) && !d.membership_conflict, membership_conflict: d.membership_conflict === true, status: null,
  };
  const dr = docketIdx.get(d.key);
  const r = row('matter-docket', `${matterId}|${d.key}`, data, { sourceUrl: dr.provenance.source_url, retrievedAt: BUILT });
  mdIdx.set(d.key, r);
  rels.push({ from_type: 'matter-docket', from_id: r.native_id, field: 'matter', to_type: 'matter', to_id: matterId, evidence_sha256: r.provenance.record_sha256 });
  rels.push({ from_type: 'matter-docket', from_id: r.native_id, field: 'docket', to_type: 'docket', to_id: d.key, evidence_sha256: r.provenance.record_sha256 });
}

// ----- membership-evidence -----
for (const e of bundle.evidence) {
  const data = {
    evidence_kind: e.kind, label: e.label, matter: matterId, claim: e.claim, source: e.source, locator: e.locator, quote: e.quote ?? null, native_ids: e.native_ids ?? {}, qualification: e.qualification,
  };
  const r = row('membership-evidence', e.id, data, { sourceUrl: e.source.url ?? 'https://www.jpml.uscourts.gov/', retrievedAt: e.retrieved_at, sourceSha256: e.source.document_sha256 ?? null, sourceAsOf: e.source.as_of ?? null });
  const md = mdIdx.get(e.claim.member_docket_key);
  rels.push({ from_type: 'membership-evidence', from_id: r.native_id, field: 'supports', to_type: 'matter-docket', to_id: md.native_id, evidence_sha256: r.provenance.record_sha256 });
}

// ----- entry / party captures -----
const masterDocket = bundle.dockets.find(d => d.role === 'master');
for (const c of bundle.entry_captures) {
  const r = row('entry-capture', `${masterDocket.key}|courtlistener|docket-entries`, { matter: matterId, docket_key: masterDocket.key, provider: 'courtlistener', cl_docket_id: c.cl_docket_id, captured: c.captured_manifest_records, provider_total: c.provider_total, provider_total_observed_at: c.provider_total_observed_at, complete: c.complete, cursor_retained: c.next_cursor_retained, scope_updated_at: c.scope_updated_at, counting_unit: 'distinct native docket entries captured (cumulative across passes) vs the provider count=on total' }, { sourceUrl: `https://www.courtlistener.com/docket/${c.cl_docket_id}/`, retrievedAt: BUILT });
  rels.push({ from_type: 'entry-capture', from_id: r.native_id, field: 'docket', to_type: 'docket', to_id: masterDocket.key, evidence_sha256: r.provenance.record_sha256 });
}
for (const c of bundle.party_captures) {
  const r = row('party-capture', `${masterDocket.key}|courtlistener|${c.kind}`, { matter: matterId, docket_key: masterDocket.key, provider: 'courtlistener', kind: c.kind, cl_docket_id: c.cl_docket_id, captured: c.captured_manifest_records, complete: c.complete, scope_updated_at: c.scope_updated_at, note: 'Associations keep their own native docket id; the query docket is never substituted.' }, { sourceUrl: `https://www.courtlistener.com/docket/${c.cl_docket_id}/`, retrievedAt: BUILT });
  rels.push({ from_type: 'party-capture', from_id: r.native_id, field: 'docket', to_type: 'docket', to_id: masterDocket.key, evidence_sha256: r.provenance.record_sha256 });
}

fs.writeFileSync(path.join(stagingDir, `rows-${mdl}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(stagingDir, `rels-${mdl}.jsonl`), rels.map(r => JSON.stringify(r)).join('\n') + '\n');
const summary = { mdl, rows: rows.length, rels: rels.length, by_type: rows.reduce((a, r) => (a[r.entity_type] = (a[r.entity_type] ?? 0) + 1, a), {}), dry };
console.log(JSON.stringify(summary));
if (!dry) {
// ----- write -----
const cfg = JSON.parse(fs.readFileSync(process.env.CORPUS_PREVIEW_CREDENTIALS ?? 'C:/Users/firas/.codex/private/legal-source-compass.preview.json', 'utf8'));
const token = cfg.EXTERNAL_SUPABASE_KEY;
const headers = { apikey: token, 'Content-Type': 'application/json', ...(token.startsWith('sb_') ? {} : { Authorization: `Bearer ${token}` }) };
async function call(fn, body) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try { r = await fetch(`${cfg.EXTERNAL_SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) }); }
    catch { if (attempt >= 4) throw new Error('network failure'); await new Promise(res => setTimeout(res, 2000 * 2 ** attempt)); continue; }
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise(res => setTimeout(res, 3000 * 2 ** attempt)); continue; }
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${data?.code ?? ''} ${String(data?.message ?? '').slice(0, 220)}`);
    return data;
  }
}
const batches = [];
for (let i = 0, cur = [], bytes = 2; i <= rows.length; i++) {
  const r = rows[i];
  const size = r ? Buffer.byteLength(JSON.stringify(r)) + 1 : 0;
  if (!r || (cur.length && (bytes + size > 1_400_000 || cur.length >= 1500))) { if (cur.length) batches.push(cur); cur = []; bytes = 2; }
  if (r) { cur.push(r); bytes += size; }
}
const totals = { entities: 0, new_versions: 0, new_observations: 0, entities_written: 0, rel_written: 0, rel_unresolved: 0 };
for (const b of batches) {
  const res = await call('corpus_registry_intake_v1', { p_run: run, p_mode: 'sw-registry', p_rows: b });
  totals.entities += res.received; totals.new_versions += res.new_versions; totals.new_observations += res.new_observations; totals.entities_written += res.entities_written;
}
for (let i = 0; i < rels.length; i += 5000) {
  const res = await call('corpus_registry_relationships_v1', { p_run: run, p_rows: rels.slice(i, i + 5000) });
  totals.rel_written += res.written; totals.rel_unresolved += res.unresolved_targets;
}
console.log(JSON.stringify({ event: 'posted', mdl, run, ...totals }));
}
