// Projects matter bundles into the public read model (contract sw-matter-registry/1, section 6):
//   public.corpus_datasets  sw_matters_v1, sw_matter_dockets_v1
//   public.corpus_records    one row per matter / per docket-in-matter
//   public.corpus_workspace_docket_links  rows with source_dataset='sw_matter_dockets_v1' only
// Rows are upserted (never deleted). Datasets stay ready=false until --ready=true is passed after verification.
//
// node --use-system-ca scripts/ingest/members-project.mjs --mdls=3047,3140,... --run=<registry run> [--ready=true] [--dry-run=true] [--gapfill-evidence=<dir>]
// --gapfill-evidence=<dir> (dir with stage-bulk/docket-bulk-match.jsonl and fjc-idb-mdl-match.jsonl, the rows landed in corpus_ingest) re-applies the approved
// gap-fill values, source provenance and the date-semantics rule to every rebuilt docket so a re-run reproduces them instead of overwriting them.
// Required whenever gap-fill values have been projected (see docs/docket-backfill.md); the run refuses to continue without it unless --no-gapfill=true.
import fs from 'node:fs';
import path from 'node:path';
import { rest } from './members-pgrest.mjs';
import { sha256, ROLE_LABEL, EVIDENCE_LABEL, docketbirdIdFromKey, docketNumberFromKey, courtOfKey } from './members-registry-lib.mjs';
import { excluded, ws, scheduleCaptionQuality } from './members-publish-rules.mjs';
import { loadEvidenceDir, overlayRecords } from './gap-fill/gapfill-overlay.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
const mdls = (args.mdls ?? '').split(',').filter(Boolean).map(Number);
const run = args.run;
const dry = args['dry-run'] === 'true';
const setReady = args.ready === 'true';
if (!mdls.length || !/^[0-9a-f-]{36}$/.test(run ?? '')) throw new Error('--mdls and --run are required');
if (!args['gapfill-evidence'] && args['no-gapfill'] !== 'true') throw new Error('--gapfill-evidence=<dir> is required so a re-run reproduces the gap-fill values; pass --no-gapfill=true only to deliberately drop them');
const work = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members';
const staging = path.join(work, 'registry-staging');
const PROJECTED_AT = new Date().toISOString();
const DS_MATTERS = 'sw_matters_v1', DS_DOCKETS = 'sw_matter_dockets_v1';
const bundles = mdls.map(m => JSON.parse(fs.readFileSync(path.join(staging, `bundle-${m}.json`), 'utf8')));
// per-matter projection counts of the entries/parties datasets (written by members-project-extras.mjs; absent before the first run)
const extras = fs.existsSync(path.join(staging, 'extras-summary.json')) ? JSON.parse(fs.readFileSync(path.join(staging, 'extras-summary.json'), 'utf8')) : { matters: {} };
const tierOrder = { tier1: 0, tier2: 1, other: 2 };
bundles.sort((a, b) => (tierOrder[a.seed.tier] - tierOrder[b.seed.tier]) || a.mdl - b.mdl);

// docket-in-several-matters conflicts
const byDocket = new Map();
for (const b of bundles) for (const d of b.dockets) if (d.role !== 'master' && d.role !== 'jpml_panel') byDocket.set(d.key, [...(byDocket.get(d.key) ?? []), b.mdl]);
const conflictsOf = key => (byDocket.get(key) ?? []);

const PRIORITY_NUM = ['courtlistener_header', 'docketbird_id', 'firm_crosswalk', 'jpml_schedule_as_printed', 'official_court_page', 'master_party_list'];
const numRank = s => { const i = PRIORITY_NUM.indexOf(s); return i < 0 ? 99 : i; };
const CAP_RANK = { courtlistener_header: 0, docketbird: 1, docketbird_jpml: 1, jpml_schedule: 2 };
const CAP_LABEL = { courtlistener_header: 'CourtListener docket header', docketbird: 'DocketBird case title', docketbird_jpml: 'DocketBird JPML docket title', jpml_schedule: 'JPML order schedule, as printed' };
const capLabel = c => (c.source === 'jpml_schedule' ? (c.doc_type === 'cto' ? 'JPML conditional transfer order table, as printed' : c.doc_type === 'transfer_order' ? 'JPML transfer order Schedule A, as printed' : CAP_LABEL.jpml_schedule) : CAP_LABEL[c.source] ?? c.source);
const bestNumber = d => [...d.docket_numbers].sort((a, b) => numRank(a.source) - numRank(b.source))[0]?.value ?? docketNumberFromKey(d.key);
const clUrl = id => `https://www.courtlistener.com/docket/${id}/`;
const nativeIdsFlat = d => d.provider_ids.map(p => p.id);
const year = v => (v ? String(v).slice(0, 4) : null);
const itemOf = (id, title, subtitle, cells, links, badges) => ({ id, cells, links, title, badges, subtitle });

const matterRecords = [], docketRecords = [], links = [];
let matterOrdinal = 0, docketOrdinal = 0;
const optionCounts = { matters: { tier: {}, status: {}, court_id: {} }, dockets: { mdl: {}, role: {}, route: {}, court_id: {}, basis: {}, status: {} } };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

for (const b of bundles) {
  const mdl = b.mdl;
  const masterD = b.dockets.find(d => d.role === 'master');
  const jpmlD = b.dockets.filter(d => d.role === 'jpml_panel');
  const members = b.dockets.filter(d => d.role !== 'master' && d.role !== 'jpml_panel');
  const jp = b.seed.jpml;
  const first = b.jpml_documents.filter(d => d.doc_type === 'transfer_order' && d.doc_date).map(d => d.doc_date).sort()[0] ?? null;
  const byBasis = b.counts.by_basis;
  const countsAs = d => !['master', 'jpml_panel', 'not_member'].includes(d.role) && !d.membership_conflict;
  const actions = members.filter(countsAs).length;
  const entry = b.entry_captures[0] ?? null;
  const judges = (masterD?.judge_refs ?? []).map(j => ({ docket_key: masterD.key, role: j.role, cl_person_id: j.cl_person_id, source_string: j.source_string, basis: j.basis }));
  const judgeLine = judges.find(j => j.role === 'assigned_to')?.source_string ?? null;
  const caseIds = [masterD, ...jpmlD].filter(Boolean).map(d => ({
    role: d.role, docket_key: d.key, court_id: d.court_id, docket_number: bestNumber(d),
    native_case_ids: d.provider_ids.map(p => ({ provider: p.provider, source_system: p.source_system, id: p.id, resolution_basis: p.resolution_basis, ...(p.pacer_case_id ? { pacer_case_id: p.pacer_case_id } : {}) })),
    basis: [...d.basis], evidence_ids: d.evidence_ids,
  }));
  // ids whose own provider header conflicts with the master identity (only the firm crosswalk names them) are not offered as master PDF lookups
  const pdfCaseIds = [...new Set(caseIds.flatMap(c => c.native_case_ids.filter(n => !/header_conflicts/.test(n.resolution_basis ?? '')).map(n => n.id)))];
  const status = jp?.scope?.startsWith('active') ? (jp.pending === 0 ? 'no_pending_actions' : 'pending') : jp?.scope?.startsWith('terminated') ? 'terminated' : 'unknown';
  const mid = `sw-matter:${mdl}`;
  const ex = extras.matters?.[String(mdl)] ?? null;
  const cells = { mdl_number: mdl, status, tier: b.seed.tier, transferee_court: courtOfKey(masterD.key), judge_as_printed: judgeLine ?? 'Not recorded', jpml_pending: jp?.pending ?? null, jpml_total: jp?.historical ?? null, registry_members: members.length, registry_actions: actions, entries_captured: entry?.captured_manifest_records ?? null, entries_total: entry?.provider_total ?? null, entries_published: ex?.entries?.projected ?? null, entries_withheld: ex?.entries ? ex.entries.withheld_sealed_document + ex.entries.withheld_text : null, parties_published: ex?.parties?.projected ?? null, counsel_links: ex?.parties?.counsel_links ?? null, masters: 1 };
  const links0 = [{ url: clUrl(masterD.provider_ids.find(p => p.provider === 'courtlistener')?.id ?? ''), label: 'CourtListener master docket' }].filter(l => !l.url.endsWith('//'));
  const dbMaster = masterD.provider_ids.find(p => p.provider === 'docketbird');
  if (dbMaster) links0.push({ url: dbMaster.url, label: 'DocketBird master docket' });
  if (jp?.url) links0.push({ url: jp.url, label: 'JPML pending-MDL report (Oct 1 2026)' });
  const registry = {
    schema: 'sw-matter-registry/1', mdl: String(mdl), tier: b.seed.tier, case_ids: caseIds, pdf_case_ids: pdfCaseIds,
    members: { rows: members.length, actions, by_basis: byBasis, list: `dataset ${DS_DOCKETS}, filters mdl=${mdl}` },
    unassigned_native_case_ids: [], judges, entries: b.entry_captures.map(e => ({ docket_key: masterD.key, provider: e.provider, cl_docket_id: e.cl_docket_id, captured: e.captured_manifest_records, provider_total: e.provider_total, complete: e.complete, observed_at: e.provider_total_observed_at })),
    parties_summary: b.party_captures.map(p => ({ docket_key: masterD.key, provider: p.provider, kind: p.kind, captured: p.captured_manifest_records, complete: p.complete })),
    jpml: { as_of: jp?.report_date ?? null, pending: jp?.pending ?? null, historical_total: jp?.historical ?? null, report_url: jp?.url ?? null, scope: jp?.scope ?? null },
    jpml_orders: b.jpml_documents.map(x => ({ doc_type: x.doc_type, doc_date: x.doc_date, cto_no: x.cto_no ?? null, rows: x.rows, url: x.url, document_sha256: x.document_sha256, alt_copies: x.alt_copies })),
    candidate_identity_links: b.candidate_identity_links.map(c => ({ keys: c.keys, basis: c.basis, merged: false })),
    docketbird_graph: (b.docketbird_graph ?? []).map(g => ({ retrieved_at: g.retrieved_at, master_case_id: g.master, returned: g.returned, total_members: g.total_members, truncated: g.truncated })),
    gaps: [], provenance: { run_ids: [run], projection_schema: 'sw-matter-registry-view/1', projected_at: PROJECTED_AT },
  };
  const gaps = [];
  if (jp?.pending != null) gaps.push(`Registry holds ${members.length} distinct member-like dockets (all roles) versus ${jp.pending.toLocaleString('en-US')} actions pending and ${jp.historical?.toLocaleString('en-US')} historical per JPML (${jp.report_date}); it is evidence-backed, not a census.`);
  for (const e of b.entry_captures) if (!e.complete) gaps.push(`CourtListener entries for docket ${e.cl_docket_id}: ${e.captured_manifest_records} captured of ${e.provider_total ?? 'an unrecorded'} total; collection continues.`);
  if (!jpmlD.length) gaps.push('No JPML panel docket found in DocketBird for this MDL number.');
  for (const p of masterD.provider_ids.filter(x => x.provider === 'courtlistener' && x.blocked)) {
    const extN = Object.entries(ex?.entries?.external ?? {}).map(([k, n]) => `${n} from ${k}`).join(', ');
    gaps.push(`CourtListener docket ${p.id} is blocked at the source: its entries, parties and attorneys are not collected or published. Entries shown come from the remaining routes${extN ? ` (${extN})` : ''} and are partial.`);
  }
  for (const [k, n] of Object.entries(ex?.entries?.external ?? {})) registry.entries.push({ docket_key: masterD.key, provider: k, cl_docket_id: null, captured: n, provider_total: null, complete: false, observed_at: extras.projected_at ?? null });
  for (const g of b.docketbird_graph ?? []) gaps.push(`DocketBird member graph (${g.retrieved_at}): ${g.returned} member dockets returned${g.total_members != null && g.total_members !== g.returned ? ` of ${g.total_members} indexed` : ''}${g.truncated ? ' (truncated by the row limit)' : ''}; a short or empty answer describes DocketBird's index, not membership.`);
  if (b.candidate_identity_links.length) gaps.push(`${b.candidate_identity_links.length} pair(s) of dockets share court, year, type and sequence but differ in office digit (possible divisional renumbering); not merged.`);
  registry.gaps = gaps;
  const facts = [
    ['MDL number', String(mdl)], ['Caption (JPML report)', b.seed.caption], ['Status (JPML report)', status === 'pending' ? `Pending (JPML report ${jp?.report_date})` : status === 'terminated' ? `Terminated (JPML terminated-MDL report ${jp?.report_date})` : status === 'no_pending_actions' ? `Active MDL with no pending actions (JPML report ${jp?.report_date})` : 'Not recorded'],
    ['Tier (firm priority list)', b.seed.tier === 'tier1' ? 'Tier 1' : b.seed.tier === 'tier2' ? 'Tier 2' : 'Other'], ['Transferee court (CourtListener court id)', courtOfKey(masterD.key)],
    ['Date centralized (earliest parsed JPML transfer order)', first ?? 'Not recorded'], ['Judge (CourtListener docket, as recorded)', judgeLine ?? 'Not recorded'],
    ['JPML actions pending', jp?.pending != null ? String(jp.pending) : 'Not recorded'], ['JPML historical actions', jp?.historical != null ? String(jp.historical) : 'Not recorded'],
    ['Registry member-like dockets', String(members.length)], ['Master docket (CourtListener id)', masterD.provider_ids.find(p => p.provider === 'courtlistener')?.id ?? 'Not recorded'],
    ['Master docket (DocketBird id)', dbMaster?.id ?? 'Not recorded'], ['JPML panel docket (DocketBird id)', jpmlD[0]?.provider_ids[0]?.id ?? 'Not recorded'],
    ['Docket entries captured / provider total (CourtListener)', entry ? `${entry.captured_manifest_records} / ${entry.provider_total ?? 'Not recorded'}${entry.complete ? ' (complete at capture)' : ' (partial)'}` : 'Not recorded'],
  ];
  const sections = [
    { heading: 'Master and JPML dockets', header: ['Role', 'Court', 'Docket number', 'Provider ids', 'Evidence basis'], rows: caseIds.map(c => [ROLE_LABEL[c.role], c.court_id, c.docket_number, c.native_case_ids.map(n => `${n.provider}:${n.id}`).join('; '), c.basis.map(k => EVIDENCE_LABEL[k] ?? k).join('; ')]) },
    { heading: 'Members by evidence kind', header: ['Evidence kind', 'Dockets'], rows: Object.entries(byBasis).map(([k, n]) => [EVIDENCE_LABEL[k] ?? k, String(n)]) },
    { heading: 'Known gaps', header: ['Gap'], rows: gaps.map(g => [g]) },
  ];
  const detail = {
    id: mid, title: b.seed.caption, subtitle: `MDL ${mdl} · ${courtOfKey(masterD.key)} · ${status}`, facts, links: links0, sections, registry,
    provenance: { source_system: 'sw-matter-registry', run_ids: [run], projection_schema: 'sw-matter-registry-view/1', projected_at: PROJECTED_AT, source_urls: [jp?.url].filter(Boolean) },
    qualification: 'Evidence-backed registry for a Seeger Weiss tracked MDL. Roles are as stated by sources; master/member role stays unknown unless a source states it. Member lists are partial and never a census; JPML counts are the MDL size. Captions, docket entries and parties are shown as the court record shows them in the companion datasets (excluding sealed, restricted, in camera, ex parte and redacted material); no PDFs are exposed here.',
  };
  matterRecords.push({
    dataset: DS_MATTERS, id: mid, category: 'sw_matter', state: null, county_geoids: [], title: b.seed.caption, source_url: links0[0]?.url ?? jp?.url ?? null, ordinal: matterOrdinal++,
    item: itemOf(mid, b.seed.caption, `MDL ${mdl} · ${courtOfKey(masterD.key)} · ${status}`, cells, links0, [`Tier ${b.seed.tier.replace('tier', '')}`, status === 'pending' ? 'Pending' : 'Status not recorded', 'Registry']),
    detail, text: `MDL ${mdl} ${b.seed.caption} ${courtOfKey(masterD.key)} ${masterD.docket_numbers.map(n => n.value).join(' ')} ${pdfCaseIds.join(' ')} ${judgeLine ?? ''} Seeger Weiss ${b.seed.tier}`.replace(/\s+/g, ' ').trim(),
    filters: { _listing: 'true', native_id: `mdl:${mdl}`, mdl: String(mdl), tier: b.seed.tier, status, court_id: courtOfKey(masterD.key), year_centralized: year(first) ?? '', has_members: members.length ? 'true' : 'false' },
  });
  bump(optionCounts.matters.tier, b.seed.tier); bump(optionCounts.matters.status, status); bump(optionCounts.matters.court_id, courtOfKey(masterD.key));

  const sorted = [...b.dockets].sort((x, y) => (['master', 'jpml_panel', 'transferee', 'transferor', 'member', 'associated_unspecified', 'unknown'].indexOf(x.role) - ['master', 'jpml_panel', 'transferee', 'transferor', 'member', 'associated_unspecified', 'unknown'].indexOf(y.role)) || String(y.date_filed ?? '').localeCompare(String(x.date_filed ?? '')) || x.key.localeCompare(y.key));
  for (const d of sorted) {
    const id = `sw-md:${mdl}:${d.key}`;
    const num = bestNumber(d);
    const cl = d.provider_ids.find(p => p.provider === 'courtlistener');
    const evs = b.evidence.filter(e => e.claim.member_docket_key === d.key);
    const isInst = d.role === 'master' || d.role === 'jpml_panel';
    const conf = conflictsOf(d.key).filter(m => m !== mdl);
    const dstatus = d.date_terminated ? 'header_terminated' : 'no_termination_date_recorded';
    // Captions are published as the court record shows them (show-as-published, owner decision 2026-10-03) except text that is sealed, restricted,
    // in camera, ex parte or redacted. Preference: CourtListener header, DocketBird title, then the JPML schedule as printed.
    const capSeen = new Set(); const caps = []; let capExcluded = 0; let capUnreliable = 0;
    for (const c of [...d.captions].sort((x, y) => (CAP_RANK[x.source] ?? 9) - (CAP_RANK[y.source] ?? 9))) {
      const v = ws(c.value);
      if (!v) continue;
      if (excluded(v)) { capExcluded++; continue; }
      // text extracted from JPML schedule PDFs is published only when it is a single well-formed caption (see members-publish-rules.mjs)
      if (c.source === 'jpml_schedule' && scheduleCaptionQuality(v) !== 'ok') { capUnreliable++; continue; }
      if (capSeen.has(v.toLowerCase())) continue;
      capSeen.add(v.toLowerCase()); caps.push({ value: v, source: c.source, ...(c.doc_type ? { doc_type: c.doc_type } : {}) });
    }
    const caption = caps[0]?.value ?? null;
    const title = caption ? `${caption} — ${num} (${d.court_id})` : `${num} (${d.court_id}) — ${ROLE_LABEL[d.role]}`;
    const sourceUrl = cl ? clUrl(cl.id) : d.provider_ids[0]?.url ?? evs[0]?.source?.url ?? null;
    const dCells = { mdl: String(mdl), role: d.role, route: d.route, docket_number: num, court_id: d.court_id, caption, caption_source: caps[0]?.source ?? null, filed: d.date_filed ?? 'Not recorded', terminated: d.date_terminated ?? 'Not recorded', status: dstatus, basis: [...d.basis].map(k => EVIDENCE_LABEL[k] ?? k).join('; '), evidence_count: evs.length, action_id: 'act:' + sha256(d.key).slice(0, 16), counts_as_action: !isInst && d.role !== 'not_member' && !d.membership_conflict };
    const dLinks = [];
    if (cl) dLinks.push({ url: clUrl(cl.id), label: 'CourtListener docket' });
    const dbp = d.provider_ids.find(p => p.provider === 'docketbird' || p.provider === 'jpml');
    if (dbp) dLinks.push({ url: dbp.url, label: 'DocketBird docket' });
    for (const e of evs) if (e.source?.url && /^https?:/.test(e.source.url) && !dLinks.some(l => l.url === e.source.url) && e.kind.startsWith('jpml')) dLinks.push({ url: e.source.url, label: `${EVIDENCE_LABEL[e.kind] ?? e.kind} (${e.source.doc_date ?? ''})`.trim() });
    const reg = {
      schema: 'sw-matter-registry/1', mdl: String(mdl), docket_key: d.key, role: d.role, roles_stated: d.roles_stated, route: d.route, membership_basis: [...d.basis],
      native_case_ids: d.provider_ids.map(p => ({ provider: p.provider, source_system: p.source_system, id: p.id, resolution_basis: p.resolution_basis, ...(p.pacer_case_id ? { pacer_case_id: p.pacer_case_id } : {}) })),
      evidence: evs.map(e => ({ evidence_id: e.id, kind: e.kind, label: e.label, asserted_role: e.claim.asserted_role, asserted_route: e.claim.asserted_route, source_url: e.source.url ?? null, source_sha256: e.source.document_sha256 ?? null, source_id: e.source.id ?? null, locator: e.locator, quote: e.quote ?? null, retrieved_at: e.retrieved_at, as_of: e.source.as_of ?? null, qualification: e.qualification })),
      action_id: dCells.action_id, counts_as_action: dCells.counts_as_action, linked_dockets: [], judges: d.judge_refs.map(j => ({ role: j.role, cl_person_id: j.cl_person_id, source_string: j.source_string, basis: j.basis })), caption, captions: caps, caption_withheld: !caption, caption_excluded_count: capExcluded, caption_unreliable_count: capUnreliable,
      conflicts: conf.length ? [{ other_mdl: conf, note: 'This docket is asserted as a member of more than one MDL by different sources; shown, not resolved.' }] : [], held: d.notes,
      possible_identity_links: b.candidate_identity_links.filter(c => c.keys.includes(d.key)).map(c => ({ keys: c.keys.filter(k => k !== d.key), basis: c.basis, merged: false })),
    };
    const dFacts = [
      ['MDL', `${mdl}`], ['Role (as stated by sources)', ROLE_LABEL[d.role]], ['Route', d.route === 'unknown' ? 'Not recorded' : d.route.replace(/_/g, ' ')], ['Court (CourtListener court id)', d.court_id], ['Docket number', num],
      ['Filed', d.date_filed ?? 'Not recorded'], ['Docket header termination date', d.date_terminated ?? 'Not recorded'], ['Evidence kinds', [...d.basis].map(k => EVIDENCE_LABEL[k] ?? k).join('; ') || 'Not recorded'],
      ['Provider case ids', d.provider_ids.map(p => `${p.provider}: ${p.id}`).join('; ')],
    ];
    if (caption) dFacts.push(['Caption (as published)', caption], ['Caption source', capLabel(caps[0])]);
    if (caps.length > 1) dFacts.push(['Other captions recorded', caps.slice(1).map(c => `${c.value} (${capLabel(c)})`).join(' | ')]);
    if (!caption && capExcluded) dFacts.push(['Caption', 'Withheld (sealed, restricted or redacted in the record)']);
    if (!caption && !capExcluded && capUnreliable) dFacts.push(['Caption', 'Not shown: the JPML schedule text for this row could not be read reliably']);
    if (d.role === 'master') dFacts.push(['MDL caption (JPML report)', b.seed.caption]);
    if (isInst && d.judge_refs.length) dFacts.push(['Judges (CourtListener docket)', d.judge_refs.map(j => `${j.role.replace('_', ' ')}: ${j.source_string ?? 'Not recorded'}${j.cl_person_id ? ` (CourtListener person ${j.cl_person_id})` : ''}`).join('; ')]);
    if (conf.length) dFacts.push(['Also asserted for MDL', conf.join(', ')]);
    docketRecords.push({
      dataset: DS_DOCKETS, id, category: 'sw_matter_docket', state: null, county_geoids: [], title, source_url: sourceUrl, ordinal: docketOrdinal++,
      item: itemOf(id, title, `MDL ${mdl} · filed ${d.date_filed ?? 'not recorded'}`, dCells, dLinks, [ROLE_LABEL[d.role], ...(d.route !== 'unknown' ? [d.route.replace(/_/g, ' ')] : []), ...(conf.length ? ['Conflicting MDL assertion'] : []), ...(!caption && capExcluded ? ['Caption withheld'] : [])]),
      detail: { id, title, subtitle: `MDL ${mdl} · ${d.court_id}`, facts: dFacts, links: dLinks, sections: [{ heading: 'Evidence', header: ['Kind', 'Source', 'Locator', 'Retrieved'], rows: reg.evidence.map(e => [e.label, e.source_url ?? 'Not recorded', JSON.stringify(e.locator), e.retrieved_at]) }], registry: reg,
        provenance: { source_system: 'sw-matter-registry', run_ids: [run], projection_schema: 'sw-matter-registry-view/1', projected_at: PROJECTED_AT }, qualification: 'One docket-in-matter. Roles and routes are as stated by the evidence listed; a transferor and a transferee docket are two records of one action. Captions are shown as the court record or the cited source prints them (JPML schedules print them in capitals); captions that are sealed, restricted or redacted are not shown.' },
      text: `${caps.map(c => c.value).join(' ')} ${num} ${d.court_id} MDL ${mdl} ${ROLE_LABEL[d.role]} ${nativeIdsFlat(d).join(' ')} ${[...d.basis].join(' ')}`.replace(/\s+/g, ' ').trim(),
      filters: { _listing: 'true', native_id: id, mdl: String(mdl), role: d.role, route: d.route, basis: [...d.basis], court_id: d.court_id, year: year(d.date_filed) ?? String(d.key.match(/:(\d{4})-/)?.[1] ?? ''), status: dstatus, counts_as_action: String(dCells.counts_as_action), tier: b.seed.tier, native_case_id: nativeIdsFlat(d), conflict: conf.length ? 'true' : 'false', has_caption: caption ? 'true' : 'false' },
    });
    bump(optionCounts.dockets.mdl, String(mdl)); bump(optionCounts.dockets.role, d.role); bump(optionCounts.dockets.route, d.route); bump(optionCounts.dockets.court_id, d.court_id); bump(optionCounts.dockets.status, dstatus);
    for (const k of d.basis) bump(optionCounts.dockets.basis, k);
    if (cl) links.push({ source_dataset: DS_DOCKETS, source_record_id: id, mdl: String(mdl), cl_docket_id: cl.id, court_id: d.court_id, docket_number: num, entry_number: null, event_date: d.date_filed ?? null, date_basis: d.date_filed ? 'case_filed_date' : null, document_type: null, evidence_url: clUrl(cl.id), linkage_basis: `Matter registry (${[...d.basis].map(k => EVIDENCE_LABEL[k] ?? k).join('; ')}); exact CourtListener docket id as recorded by the cited source` });
  }
}

const opt = (counts, labeler = x => x) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: labeler(value), count }));
const datasets = [
  { id: DS_MATTERS, label: 'Seeger Weiss matter registry — MDL matters', expected_records: matterRecords.length, imported_records: matterRecords.length, metadata: {
    grain: 'One tracked MDL matter (JPML MDL number)', aliases: [DS_MATTERS, 'sw-matters'], source_system: 'sw-matter-registry', schema_version: 'sw-matter-registry-view/1', source_runs: [run],
    qualification: 'Evidence-backed registry rows for firm-tracked MDLs. Roles are as stated by sources; JPML counts are the MDL size; member lists are partial. Dockets, captions, entries and parties are shown as the court record shows them in the companion datasets; no PDFs are exposed here. Not legal advice.',
    privacy_policy: 'Show as published (owner decision 2026-10-03): excluded are sealed, restricted, in camera, ex parte and redacted material and source-blocked dockets; no contact fields; judge strings are source strings; native person ids only from CourtListener docket resources.',
    listing: { columns: [{ key: 'mdl_number', label: 'MDL' }, { key: 'status', label: 'Status' }, { key: 'tier', label: 'Tier' }, { key: 'transferee_court', label: 'Transferee court' }, { key: 'judge_as_printed', label: 'Judge' }, { key: 'jpml_pending', label: 'JPML pending' }, { key: 'jpml_total', label: 'JPML historical' }, { key: 'registry_members', label: 'Registry dockets' }],
      filters: [{ name: 'tier', type: 'select', label: 'Tier', options: opt(optionCounts.matters.tier, v => v.replace('tier', 'Tier ')), placeholder: 'All tiers' }, { name: 'status', type: 'select', label: 'Status', options: opt(optionCounts.matters.status), placeholder: 'All statuses' }, { name: 'court_id', type: 'select', label: 'Transferee court', options: opt(optionCounts.matters.court_id), placeholder: 'All courts' }] } } },
  { id: DS_DOCKETS, label: 'Seeger Weiss matter registry — dockets in matters', expected_records: docketRecords.length, imported_records: docketRecords.length, metadata: {
    grain: 'One docket within one MDL matter (master, JPML panel, member, transferor)', aliases: [DS_DOCKETS, 'sw-matter-dockets'], source_system: 'sw-matter-registry', schema_version: 'sw-matter-registry-view/1', source_runs: [run],
    qualification: 'One docket-in-matter with the evidence behind its role and route. A transferor and a transferee docket are two records of one action (action_id). Captions are shown as the court record or the cited source prints them. Not a member census.',
    privacy_policy: 'Show as published (owner decision 2026-10-03): captions as printed by the cited source, except sealed, restricted, in camera, ex parte or redacted text; no contact fields.',
    listing: { columns: [{ key: 'docket_number', label: 'Docket' }, { key: 'court_id', label: 'Court' }, { key: 'role', label: 'Role' }, { key: 'route', label: 'Route' }, { key: 'basis', label: 'Evidence' }, { key: 'filed', label: 'Filed' }, { key: 'evidence_count', label: 'Evidence rows' }],
      filters: [{ name: 'mdl', type: 'select', label: 'MDL', options: opt(optionCounts.dockets.mdl, v => `MDL ${v}`), placeholder: 'All MDLs' }, { name: 'role', type: 'select', label: 'Role', options: opt(optionCounts.dockets.role, v => ROLE_LABEL[v] ?? v), placeholder: 'All roles' }, { name: 'route', type: 'select', label: 'Route', options: opt(optionCounts.dockets.route), placeholder: 'All routes' }, { name: 'basis', type: 'select', label: 'Evidence kind', options: opt(optionCounts.dockets.basis, v => EVIDENCE_LABEL[v] ?? v), placeholder: 'All evidence kinds' }, { name: 'court_id', type: 'select', label: 'Court', options: opt(optionCounts.dockets.court_id), placeholder: 'All courts' }] } } },
];

if (args['gapfill-evidence']) {
  const overlaid = overlayRecords(docketRecords, loadEvidenceDir(args['gapfill-evidence']), PROJECTED_AT);
  docketRecords.splice(0, docketRecords.length, ...overlaid.records);
  console.log(JSON.stringify({ gapfill_overlay: { dockets_changed: overlaid.changed, held: overlaid.held } }));
}
console.log(JSON.stringify({ matters: matterRecords.length, dockets: docketRecords.length, links: links.length, conflicts: [...byDocket].filter(([, v]) => v.length > 1).length, dry }));
fs.writeFileSync(path.join(staging, 'projection-preview.json'), JSON.stringify({ datasets, matters: matterRecords.length, dockets: docketRecords.length, links: links.length }, null, 1));
// Canonical JSON (sorted keys, undefined dropped) so a PostgREST read-back (jsonb re-orders keys) can be compared with what was sent.
const canon = x => Array.isArray(x) ? '[' + x.map(v => (v === undefined ? 'null' : canon(v))).join(',') + ']'
  : (x && typeof x === 'object') ? '{' + Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}' : JSON.stringify(x);
const digest = recs => sha256(canon([...recs].sort((a, b) => a.ordinal - b.ordinal).map(r => [r.id, r.title, r.item, r.detail, r.filters, r.ordinal])));
async function readBack(dataset) {
  const out = [];
  for (let off = 0; ; off += 400) {
    const page = (await rest(`corpus_records?select=id,title,item,detail,filters,ordinal&dataset=eq.${dataset}&order=ordinal.asc&limit=400&offset=${off}`)).data;
    out.push(...page);
    if (page.length < 400) break;
  }
  return out;
}

if (!dry) {
  // A dataset that is already ready stays ready while it is re-projected (no flap for readers); a new one starts not ready.
  for (const ds of datasets) {
    const existing = (await rest(`corpus_datasets?select=id,ready&id=eq.${ds.id}`)).data[0] ?? null;
    await rest('corpus_datasets?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [{ id: ds.id, label: ds.label, ...(existing ? {} : { ready: false }), expected_records: ds.expected_records, imported_records: ds.imported_records, metadata: ds.metadata, updated_at: PROJECTED_AT }] });
  }
  const upsert = async (table, conflict, recs) => {
    for (let i = 0; i < recs.length; i += 150) await rest(`${table}?on_conflict=${conflict}`, { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: recs.slice(i, i + 150) });
  };
  await upsert('corpus_records', 'dataset,id', matterRecords);
  await upsert('corpus_records', 'dataset,id', docketRecords);
  // workspace links count only for ready datasets (see corpus_workspace_dockets); insert always, they appear once the dataset is ready
  await upsert('corpus_workspace_docket_links', 'source_dataset,source_record_id,mdl', links.map(l => ({ ...l, refreshed_at: PROJECTED_AT })));
  // read-back verification: what the app will read equals what was projected (canonical sha256 over id, title, item, detail, filters, ordinal)
  const validation = {};
  for (const [id, recs] of [[DS_MATTERS, matterRecords], [DS_DOCKETS, docketRecords]]) {
    const remote = await readBack(id);
    validation[id] = { records: remote.length, local_records: recs.length, verified: remote.length === recs.length && digest(remote) === digest(recs), full_fields_sha256: digest(recs) };
  }
  for (const ds of datasets) {
    const v = validation[ds.id];
    const projection_validation = { records: v.records, verified: v.verified, validated_at: new Date().toISOString(), contract_version: 'sw-matter-registry-view/1', full_fields_sha256: v.full_fields_sha256, method: 'PostgREST read-back of id,title,item,detail,filters,ordinal compared as canonical JSON (sorted keys) sha256' };
    await rest(`corpus_datasets?id=eq.${ds.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { metadata: { ...ds.metadata, projection_validation }, updated_at: new Date().toISOString() } });
  }
  const allVerified = Object.values(validation).every(v => v.verified);
  if (setReady && allVerified) for (const ds of datasets) await rest(`corpus_datasets?id=eq.${ds.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ready: true, updated_at: new Date().toISOString() } });
  console.log(JSON.stringify({ event: 'projected', ready: setReady && allVerified, validation }));
  if (!allVerified) { console.error('projection read-back did not match; datasets left in their previous ready state'); process.exitCode = 2; }
}
