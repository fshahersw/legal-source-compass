// Builds the evidence bundle and registry entity rows for one MDL matter (contract sw-matter-registry/1).
// Inputs are local captures + public-schema reads; nothing is inferred. Output: <out>/bundle-<mdl>.json and <out>/rows-<mdl>.jsonl
//
// node --use-system-ca scripts/ingest/members-bundle.mjs --mdl=3047 --work=<_work/agents/mdl-members> --out=<dir>
import fs from 'node:fs';
import path from 'node:path';
import { rest } from './members-pgrest.mjs';
import {
  REGISTRY_SOURCE, sha256, canonSha, parseDocketNumber, docketKey, docketKeyFromNumber, parseDocketbirdId, docketbirdIdFromKey, docketNumberFromKey,
  courtOfKey, evidenceId, registryRow, primaryRole, EVIDENCE_LABEL,
} from './members-registry-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
const mdl = Number(args.mdl);
if (!mdl) throw new Error('--mdl is required');
const work = path.resolve(args.work ?? 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members');
const out = path.resolve(args.out ?? path.join(work, 'registry-staging'));
fs.mkdirSync(out, { recursive: true });
const BUILD_AT = new Date().toISOString();

const PASSES = [
  'C:/Users/firas/OneDrive/Documents/ChatGPT/corpusss/audit/2026-10-02/metadata',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T101805Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T112700Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T115000Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T124500Z',
  'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members',
];
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = f => fs.existsSync(f);
// A caption is institutional (an MDL / subject-matter name) only if it has no "X v. Y" party form AND either starts "In re" or names the
// litigation itself. Person-v-company captions (e.g. a lead case that became the master docket) are never institutional, even on a master.
const instCaption = s => { const t = String(s ?? ''); if (/\s(?:v|vs)\.?\s/i.test(t)) return false; return /^\s*in\s*re\b/i.test(t) || /\b(?:litigation|multidistrict|antitrust|data security breach|products liability)\b/i.test(t); };

// ---------- seed ----------
const seed = readJson(path.join(work, 'matters-seed.json')).find(s => s.mdl === mdl);
if (!seed) throw new Error(`MDL ${mdl} is not in matters-seed.json`);
const CL_MASTER_OVERRIDE = { 3094: '68222905', 3163: '72052106', 3180: '73443394', 2782: '6078886' }; // resolved by exact court+docket-number lookup / prior verified header
const clMasterIds = [...new Set([...(CL_MASTER_OVERRIDE[mdl] ? [CL_MASTER_OVERRIDE[mdl]] : []), ...seed.cl_ids_parent_csv])];

// ---------- CourtListener docket headers (latest observation per id) ----------
const clHeaders = new Map();
function loadHeaderFile(f) {
  if (!exists(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.entity_type !== 'dockets') continue;
    const prev = clHeaders.get(r.native_id);
    if (!prev || String(r.provenance.retrieved_at) >= String(prev.provenance.retrieved_at)) clHeaders.set(r.native_id, r);
  }
}
for (const p of PASSES) { loadHeaderFile(path.join(p, 'source-docket-headers.jsonl')); loadHeaderFile(path.join(p, 'live-normalized', 'dockets.jsonl')); }

// ---------- evidence + docket accumulators ----------
const dockets = new Map(); // key -> docket record
const evidence = new Map(); // id -> evidence record
function dk(key) {
  if (!dockets.has(key)) dockets.set(key, { key, court_id: courtOfKey(key), docket_numbers: [], provider_ids: [], captions: [], date_filed: null, date_terminated: null, judge_refs: [], roles: new Set(), routes: new Set(), basis: new Set(), evidence_ids: [], notes: [] });
  return dockets.get(key);
}
function addNumber(d, value, source) { if (value && !d.docket_numbers.some(x => x.value === value && x.source === source)) d.docket_numbers.push({ value, source }); }
function addProvider(d, p) { if (!d.provider_ids.some(x => x.provider === p.provider && x.id === p.id)) d.provider_ids.push(p); }
function addEvidence(ev) {
  const id = evidenceId({ k: ev.kind, m: mdl, member: ev.claim.member_docket_key, master: ev.claim.master_docket_key ?? null, src: ev.id_source ?? ev.source.url ?? ev.source.document_sha256 ?? ev.source.id ?? null, loc: ev.id_source ? null : (ev.locator ?? null), role: ev.claim.asserted_role });
  if (evidence.has(id)) return id;
  const full = { id, label: EVIDENCE_LABEL[ev.kind] ?? ev.kind, ...ev };
  evidence.set(id, full);
  const d = dk(ev.claim.member_docket_key);
  d.evidence_ids.push(id); d.basis.add(ev.kind); d.roles.add(ev.claim.asserted_role);
  if (ev.claim.asserted_route && ev.claim.asserted_route !== 'unknown') d.routes.add(ev.claim.asserted_route);
  return id;
}

// ---------- master + JPML identity ----------
const master = seed.master;
const masterKey = master.docket_key;
const masterDk = dk(masterKey);
if (master.docketbird_id) {
  addNumber(masterDk, master.docket_number, 'docketbird_id');
  addProvider(masterDk, { provider: 'docketbird', source_system: 'docketbird', id: master.docketbird_id, url: `https://www.docketbird.com/cases?case_id=${master.docketbird_id}`, resolution_basis: 'provider_native_id' });
}
const census = seed.census_latest;
const jpmlReport = census ? { url: census.url, as_of: census.report_date } : null;
if (census?.official_master_docket) {
  addEvidence({ kind: 'jpml_master_docket_list', claim: { asserted_role: 'master', asserted_route: 'unknown', member_docket_key: masterKey, master_docket_key: masterKey },
    source: { system: 'jpml', url: census.url, id: `census:${census.report_date}:mdl:${mdl}`, retrieved_at: '2026-10-02T17:05:00Z', as_of: census.report_date }, locator: { report: 'Pending_MDL_Dockets_By_Actions_Pending', mdl_number: mdl, official_master_docket: census.official_master_docket },
    quote: null, native_ids: { docketbird_case_id: master.docketbird_id }, qualification: 'JPML Oct 1 2026 pending-MDL report as parsed in the Oct 2 full-matter audit (jpml-census.json); the report supplies the MDL number, caption and counts; the master docket identity is the audit\'s exact court+number join.', retrieved_at: '2026-10-02T17:05:00Z' });
}
const clMatches = clMasterIds.filter(clId => { const h = clHeaders.get(clId); const num = h ? parseDocketNumber(h.data.docket_number) : null; return h && num && docketKey(h.data.court_id, num) === masterKey; });
// A CourtListener docket that carries the master's court and docket number but has a party-v-party caption AND a different PACER case id than an
// institutionally captioned one is a different docket (e.g. a single plaintiff's action numbered under the master number). It is not attached to the
// master identity and is not counted as a member (a shared number alone is not membership evidence).
const instMatches = clMatches.filter(id => instCaption(clHeaders.get(id).data.case_name));
const clExcluded = new Set(instMatches.length ? clMatches.filter(id => !instMatches.includes(id) && !instMatches.some(m => String(clHeaders.get(m).data.pacer_case_id ?? '') === String(clHeaders.get(id).data.pacer_case_id ?? ''))) : []);
for (const id of clExcluded) masterDk.notes.push(`CourtListener ${id} carries the master's court and docket number but its header has a different PACER case id (${clHeaders.get(id).data.pacer_case_id ?? 'not recorded'}) and a party-v-party caption than the institutionally captioned docket(s) ${instMatches.join(', ')}; the header alone does not establish it as the master, and it is not counted as a member (a shared number is not membership evidence)`);
const clKept = clMatches.filter(id => !clExcluded.has(id));
const clAmbiguous = clKept.length > 1;
if (clAmbiguous) masterDk.notes.push(`Ambiguous: ${clKept.length} CourtListener dockets (${clKept.join(', ')}) carry the same court and docket number with different native ids; all kept as separate identities, none merged`);
for (const clId of clMasterIds) {
  if (clExcluded.has(clId)) continue;
  const h = clHeaders.get(clId);
  if (!h) { masterDk.notes.push(`CourtListener header ${clId} not captured`); continue; }
  const num = parseDocketNumber(h.data.docket_number);
  const k = num ? docketKey(h.data.court_id, num) : null;
  if (k === masterKey) {
    addProvider(masterDk, { provider: 'courtlistener', source_system: 'courtlistener', id: clId, url: `https://www.courtlistener.com/docket/${clId}/`, resolution_basis: clAmbiguous ? 'ambiguous_same_docket_key_multiple_courtlistener_dockets' : 'exact_docket_key', pacer_case_id: h.data.pacer_case_id ?? null, header_retrieved_at: h.provenance.retrieved_at, header_date_filed: h.data.date_filed ?? null, header_date_terminated: h.data.date_terminated ?? null, blocked: h.data.blocked === true });
    addNumber(masterDk, h.data.docket_number, 'courtlistener_header');
    if (h.data.blocked === true) masterDk.notes.push(`CourtListener docket ${clId} is flagged blocked at source (blocked=true): relations (entries, parties, attorneys) are not collected`);
    masterDk.captions.push({ value: h.data.case_name, source: 'courtlistener_header', institutional: instCaption(h.data.case_name) });
    masterDk.date_filed = h.data.date_filed ?? masterDk.date_filed;
    masterDk.date_terminated = h.data.date_terminated ?? null;
    masterDk.cl_header_date_terminated_note = h.data.date_terminated ? 'Docket header lists a termination date; shown as recorded, not as MDL status' : null;
    const person = u => (typeof u === 'string' ? u.match(/\/people\/(\d+)\/$/)?.[1] ?? null : null);
    const a = person(h.data.assigned_to), r = person(h.data.referred_to);
    // several CourtListener dockets can carry the same master identity (ambiguous case); the same judge reference is listed once
    const addJudge = ref => { if (!masterDk.judge_refs.some(x => x.role === ref.role && x.cl_person_id === ref.cl_person_id && x.source_string === ref.source_string)) masterDk.judge_refs.push(ref); };
    if (a || h.data.assigned_to_str) addJudge({ role: 'assigned_to', cl_person_id: a, source_string: h.data.assigned_to_str || null, provider: 'courtlistener', basis: a ? 'courtlistener docket resource assigned_to' : 'source string only' });
    if (r || h.data.referred_to_str) addJudge({ role: 'referred_to', cl_person_id: r, source_string: h.data.referred_to_str || null, provider: 'courtlistener', basis: r ? 'courtlistener docket resource referred_to' : 'source string only' });
    addEvidence({ kind: 'cl_docket_header', claim: { asserted_role: 'master', asserted_route: 'unknown', member_docket_key: masterKey, master_docket_key: masterKey },
      source: { system: 'courtlistener', url: h.provenance.source_url, document_sha256: h.provenance.source_sha256, id: clId, retrieved_at: h.provenance.retrieved_at, http_status: h.provenance.http_status }, locator: { field: 'docket_number+court_id' },
      quote: null, native_ids: { cl_docket_id: clId }, qualification: 'CourtListener docket header whose court and docket number equal the JPML master docket identity; header identity only, not a judgment of role by CourtListener.', retrieved_at: h.provenance.retrieved_at });
  } else {
    masterDk.notes.push(`CourtListener ${clId} (${h.data.court_id} ${h.data.docket_number}) is a different docket identity than ${masterKey}; kept out of the master identity`);
  }
}

// official-court case ids (as printed by the court page) attach to the master only when the court host's court id equals the master's
// court AND the id parses to the master's office/year/type/sequence.
const officialFile = path.join(work, 'official-court-ids.json');
if (exists(officialFile)) {
  for (const oc of readJson(officialFile).rows) {
    const m = String(oc.native_case_id).match(/^(\d{1,2}):(\d{2})-?([a-z]{2})-?(\d{1,6})(?:-[a-z]+)?$/i);
    if (!m || oc.court_id !== courtOfKey(masterKey)) continue;
    const k = docketKey(oc.court_id, { office: String(Number(m[1])), year: Number(`20${m[2]}`), type: m[3].toLowerCase(), seq: String(Number(m[4])).padStart(5, '0') });
    if (k !== masterKey) continue;
    addProvider(masterDk, { provider: 'official-court', source_system: 'official-court', id: oc.native_case_id, url: oc.origin_page, resolution_basis: 'court_host_and_exact_docket_number', documents_in_pdf_registry: oc.documents });
    addNumber(masterDk, oc.native_case_id, 'official_court_page');
  }
}

// DocketBird JPML panel docket (exact search result recorded in db-results)
// db-results/jpml-dockets.json holds batches of transcribed search_cases results ({retrieved_at, by_mdl: {mdl: [ids]}}); several JPML dockets can carry one MDL number
const jpmlFile = path.join(work, 'db-results', 'jpml-dockets.json');
const jpmlHits = []; // { id, retrieved_at }
const jpmlTitles = new Map(); // DocketBird id -> { title, retrieved_at } (latest observation)
if (exists(jpmlFile)) {
  const jf = readJson(jpmlFile);
  for (const b of jf.batches ?? []) for (const id of (b.by_mdl ?? {})[String(mdl)] ?? []) jpmlHits.push({ id, retrieved_at: b.retrieved_at });
  for (const o of jf.title_observations ?? []) for (const [id, title] of Object.entries(o.titles ?? {})) { const prev = jpmlTitles.get(id); if (!prev || String(o.retrieved_at) >= String(prev.retrieved_at)) jpmlTitles.set(id, { title, retrieved_at: o.retrieved_at }); }
}
for (const hit of jpmlHits) {
  const p = parseDocketbirdId(hit.id);
  if (!p) continue;
  const d = dk(p.docket_key);
  const jt = jpmlTitles.get(hit.id);
  if (jt?.title) d.captions.push({ value: jt.title, source: 'docketbird_jpml', institutional: instCaption(jt.title), retrieved_at: jt.retrieved_at });
  addNumber(d, p.docket_number, 'docketbird_id');
  addProvider(d, { provider: 'jpml', source_system: 'docketbird', id: hit.id, url: `https://www.docketbird.com/cases?case_id=${hit.id}`, resolution_basis: 'provider_native_id' });
  addEvidence({ kind: 'docketbird_search_exact', claim: { asserted_role: 'jpml_panel', asserted_route: 'unknown', member_docket_key: p.docket_key, master_docket_key: masterKey },
    source: { system: 'docketbird', url: `https://www.docketbird.com/cases?case_id=${hit.id}`, id: hit.id, retrieved_at: hit.retrieved_at }, locator: { tool: 'search_cases', q: String(mdl), court_id: 'jpml' },
    quote: null, native_ids: { docketbird_case_id: hit.id }, qualification: 'DocketBird search in court "jpml" for the MDL number returned this exact MDL docket (id jpml-<office>:<year>-md-<MDL number>); DocketBird court jpml is the Judicial Panel on Multidistrict Litigation.', retrieved_at: hit.retrieved_at });
}
if (jpmlHits.length > 1) masterDk.notes.push(`${jpmlHits.length} DocketBird JPML dockets carry MDL number ${mdl} (${jpmlHits.map(h => h.id).join(', ')}); all kept as separate identities, none merged`);

// ---------- DocketBird relationship members ----------
// Coverage of the DocketBird member graph for this MDL: one entry per recorded query (including queries that returned zero members).
// A zero or partial answer is a coverage fact about DocketBird's index, never evidence that other actions are not members.
const dbGraph = [];
function loadDocketbirdMembers() {
  const list = [];
  const f3047 = path.join(work, 'db-results', '3047-members.json');
  if (mdl === 3047 && exists(f3047)) {
    const j = readJson(f3047);
    dbGraph.push({ retrieved_at: j.retrieved_at, master: j.response.records[0]['master.case_id'], returned: j.response.records.length, total_members: null, truncated: false });
    for (const r of j.response.records) list.push({ case_id: r['member.case_id'], title: r['member.case_title'], year: r['member.year_filed'], date: r['member.date_filed'], complaint_id: r['member.complaint_document_id'], complaint_status: r['member.complaint_status'], retrieved_at: j.retrieved_at, question: j.arguments.question, master: j.response.records[0]['master.case_id'] });
  }
  const fc = path.join(work, 'db-results', 'members-condensed-batch1.json');
  const files = [fc, ...fs.readdirSync(path.join(work, 'db-results')).filter(n => /^members-condensed-.*\.json$/.test(n) && n !== 'members-condensed-batch1.json').map(n => path.join(work, 'db-results', n))];
  for (const f of files) {
    if (!exists(f)) continue;
    const j = readJson(f);
    const q = j.queries?.[String(mdl)];
    if (!q) continue;
    dbGraph.push({ retrieved_at: j.retrieved_at, master: q.master, returned: q.members.length, total_members: q.total_members ?? q.members.length, truncated: q.truncated ?? false });
    for (const m of q.members) list.push({ case_id: m[0], title: m[1], year: m[2], date: m[3], complaint_id: m[4], complaint_status: m[5], retrieved_at: j.retrieved_at, question: j.query_template.replace('<master>', q.master), master: q.master, ...(q.total_members != null && q.truncated ? { provider_total_members: q.total_members, provider_truncated: true } : {}) });
  }
  return list;
}
const dbMembers = loadDocketbirdMembers();
for (const m of dbMembers) {
  const p = parseDocketbirdId(m.case_id);
  if (!p) { continue; }
  const d = dk(p.docket_key);
  addNumber(d, p.docket_number, 'docketbird_id');
  addProvider(d, { provider: 'docketbird', source_system: 'docketbird', id: m.case_id, url: `https://www.docketbird.com/cases?case_id=${m.case_id}`, resolution_basis: 'provider_native_id' });
  if (m.title) d.captions.push({ value: m.title, source: 'docketbird', institutional: false });
  d.date_filed = d.date_filed ?? m.date ?? null;
  d.year_filed = d.year_filed ?? m.year ?? null;
  addEvidence({ kind: 'docketbird_relationship', claim: { asserted_role: 'member', asserted_route: 'unknown', member_docket_key: p.docket_key, master_docket_key: parseDocketbirdId(m.master)?.docket_key ?? masterKey },
    source: { system: 'docketbird', url: `https://www.docketbird.com/cases?case_id=${m.case_id}`, id: `graph:${m.master}`, retrieved_at: m.retrieved_at, channel: 'DocketBird MCP connector find_litigation_relationships; transcribed result, not HTTP wire bytes' },
    locator: { graph_edge: 'CONSOLIDATED_INTO_MDL_MASTER', mdl_no: mdl, member_complaint_document_id: m.complaint_id ?? null, ...(m.provider_truncated ? { provider_total_members: m.provider_total_members, provider_truncated: true } : {}) }, quote: null,
    native_ids: { docketbird_case_id: m.case_id }, qualification: 'DocketBird graph edge; DocketBird indexes only a subset of an MDL (its member total is far below the JPML count).', retrieved_at: m.retrieved_at });
}

// ---------- JPML schedule parses ----------
const parseDir = path.join(work, 'jpml-parse');
const transfereeCourt = courtOfKey(masterKey);
const jpmlDocs = [];
// master docket entry descriptions (to state whether a CTO's stay was lifted on the master docket)
const entryDesc = new Map();
if (exists(parseDir) && fs.readdirSync(parseDir).some(n => n.startsWith('cl-'))) {
  for (const p of PASSES) {
    const f = path.join(p, 'live-normalized', 'docket-entries.jsonl');
    if (!exists(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.includes('"description"') || !clMasterIds.some(id => line.includes(`/dockets/${id}/`))) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      entryDesc.set(String(r.data.id), { description: r.data.description ?? '', number: r.data.entry_number ?? null, date_filed: r.data.date_filed ?? null });
    }
  }
}
const ctoStatusOf = text => /stay is lifted|inasmuch as no objection is pending/i.test(text) ? 'stay_lifted' : /opposition|oppose|vacat/i.test(text) ? 'opposition_or_vacatur_text' : 'conditional_order_entered';
if (exists(parseDir)) {
  // The same order can sit in several copies (jpml.uscourts.gov, govinfo.gov, the master docket's RECAP document). One evidence record
  // per (order, listed action); the preferred copy is the source, other copies are listed under source.alt_copies.
  const rank = u => (/jpml\.uscourts\.gov/.test(u ?? '') ? 0 : /govinfo\.gov/.test(u ?? '') ? 1 : 2);
  const docs = fs.readdirSync(parseDir).filter(n => n.endsWith('.json')).map(f => readJson(path.join(parseDir, f))).filter(j => j.mdl_no === mdl && ['transfer_order', 'cto', 'other_order', 'order_denying_transfer', 'order_vacating_cto'].includes(j.doc_type));
  docs.sort((a, b) => rank(a.source_url) - rank(b.source_url) || String(a.doc_date).localeCompare(String(b.doc_date)));
  const orderIdx = new Map(); // orderKey -> { jpmlDocsIndex, evidenceByRow }
  for (const j of docs) {
    const orderKey = `${j.doc_type}|${j.doc_date ?? ''}|${j.cto_no ?? ''}`;
    const copyInfo = { url: j.source_url, document_sha256: j.file_sha256, retrieved_at: j.retrieved_at, rows: j.row_count, cl_recap_document_id: j.cl?.recap_document_id ?? null };
    if (orderIdx.has(orderKey)) {
      const o = orderIdx.get(orderKey);
      if (j.file_sha256 !== o.primary.document_sha256 && !o.primary.alt_copies.some(c => c.document_sha256 === j.file_sha256)) o.primary.alt_copies.push(copyInfo);
      for (const id of o.evidenceIds) { const ev = evidence.get(id); if (ev && !(ev.source.alt_copies ?? []).some(c => c.document_sha256 === j.file_sha256) && ev.source.document_sha256 !== j.file_sha256) (ev.source.alt_copies ??= []).push(copyInfo); }
      continue;
    }
    const entry = j.cl?.entry_native_id ? entryDesc.get(String(j.cl.entry_native_id)) : null;
    const ctoStatus = j.doc_type === 'cto' ? (entry ? ctoStatusOf(entry.description) : 'unknown_no_master_entry') : null;
    const primary = { doc_type: j.doc_type, doc_date: j.doc_date, cto_no: j.cto_no, url: j.source_url, document_sha256: j.file_sha256, rows: j.row_count, alt_copies: [], cto_status: ctoStatus, entry: entry ? { native_id: String(j.cl.entry_native_id), number: entry.number, date_filed: entry.date_filed } : null, notes: j.notes ?? [] };
    jpmlDocs.push(primary);
    const o = { primary, evidenceIds: [] };
    orderIdx.set(orderKey, o);
    const negative = j.doc_type === 'order_denying_transfer' || j.doc_type === 'order_vacating_cto';
    for (const r of j.rows) {
      if (!r.docket_key) continue;
      const d = dk(r.docket_key);
      addNumber(d, r.docket_number_as_printed, 'jpml_schedule_as_printed');
      d.captions.push({ value: r.caption, source: 'jpml_schedule', institutional: false, doc_type: j.doc_type });
      const inTransferee = r.court_id === transfereeCourt;
      const kind = negative ? (j.doc_type === 'order_denying_transfer' ? 'transfer_denied' : 'cto_vacated') : j.doc_type === 'cto' ? 'jpml_cto_schedule' : 'jpml_schedule_a';
      const id = addEvidence({ kind, id_source: `jpml-order:${mdl}:${orderKey}`,
        claim: { asserted_role: negative ? 'not_member' : inTransferee ? 'member' : 'transferor', asserted_route: negative ? 'unknown' : inTransferee ? 'pending_in_transferee_court' : 'transferred', member_docket_key: r.docket_key, master_docket_key: masterKey },
        source: { system: 'jpml', url: j.source_url, document_sha256: j.file_sha256, id: `${j.doc_type}${j.cto_no ? ':' + j.cto_no : ''}:${j.doc_date ?? ''}`, retrieved_at: j.retrieved_at ?? BUILD_AT, doc_date: j.doc_date ?? null, ...(j.cl ? { cl_recap_document_id: j.cl.recap_document_id, cl_docket_entry_id: j.cl.entry_native_id } : {}) },
        locator: { page: r.page, row: r.ordinal, as_printed: r.docket_number_as_printed, district: r.district_heading ?? r.district_code, doc_type: j.doc_type, cto_no: j.cto_no ?? null, cto_status: ctoStatus, master_entry_number: entry?.number ?? null }, quote: null,
        native_ids: {}, qualification: negative ? 'Row of a JPML order denying transfer or vacating a conditional transfer order: the listed action was NOT transferred by that order. Shown, never counted as a member.' : 'Row of a JPML order schedule; civil-action type "cv" is the schedule convention. A CTO row is a conditional transfer unless cto_status says the stay was lifted on the master docket. The office digit is as printed and can differ from the later docket number after divisional reassignment (not linked without a stating source).', retrieved_at: j.retrieved_at ?? BUILD_AT });
      o.evidenceIds.push(id);
    }
  }
}

// ---------- master docket party list: member case numbers named in party extra_info ----------
// CourtListener `parties` records of the MASTER docket carry party_types[].extra_info free text. Where it names a civil action number
// (bare number or "(... 4:24-cv-08921-YGR)") the master docket itself references that action. Court is taken as the master's court only
// when the text contains no other court cue. Evidence is one record per referenced action (party ids listed), kind master_party_case_reference.
const COURT_CUE = /(?:\b[NSEWMC]\.\s?D\.|\b(?:district|court|state of|county)\b)/i;
const partyRefs = new Map(); // docket key -> { party_ids:Set, first:{provenance, party_id, extra}, count }
for (const clId of clMasterIds) {
  if (!masterDk.provider_ids.some(p => p.provider === 'courtlistener' && p.id === clId)) continue;
  const seenParty = new Set();
  for (const p of PASSES) {
    const f = path.join(p, 'live-normalized', 'parties.jsonl');
    if (!exists(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      (r.data.party_types ?? []).forEach((pt, idx) => {
        if (String(pt.docket_id) !== clId) return; // the association's own docket, never the query docket by substitution
        const key0 = `${r.native_id}:${idx}`;
        if (seenParty.has(key0)) return; seenParty.add(key0);
        const extra = String(pt.extra_info ?? '');
        if (!extra || COURT_CUE.test(extra)) return;
        const nums = new Set([...extra.matchAll(/\b(\d{1,2}):(\d{2})-([a-z]{2})-(\d{3,6})\b/gi)].map(m => `${m[1]}:${m[2]}-${m[3].toLowerCase()}-${m[4].padStart(5, '0')}`));
        if (nums.size !== 1) return; // zero or ambiguous (several different numbers in one text)
        const parts = parseDocketNumber([...nums][0]);
        const k = docketKey(courtOfKey(masterKey), parts);
        if (!k || k === masterKey) return;
        const e = partyRefs.get(k) ?? { party_ids: new Set(), refs: 0, first: { source_url: r.provenance.source_url, source_sha256: r.provenance.source_sha256, retrieved_at: r.provenance.retrieved_at, party_id: r.native_id, extra: /^\(?\s*\d{1,2}:\d{2}-[a-z]{2}-\d{3,6}(?:-[A-Za-z]{2,5})*\s*\)?$/.test(extra.trim()) ? extra.trim() : null } };
        e.party_ids.add(r.native_id); e.refs++;
        partyRefs.set(k, e);
      });
    }
  }
}
for (const [k, e] of partyRefs) {
  const d = dk(k);
  addNumber(d, docketNumberFromKey(k), 'master_party_list');
  addEvidence({ kind: 'master_party_case_reference', id_source: `master-party-list:${mdl}`, claim: { asserted_role: 'member', asserted_route: 'unknown', member_docket_key: k, master_docket_key: masterKey },
    source: { system: 'courtlistener', url: e.first.source_url, document_sha256: e.first.source_sha256, id: `master-party-list:${mdl}`, retrieved_at: e.first.retrieved_at, http_status: 200 },
    locator: { field: 'party_types[].extra_info', party_ids: [...e.party_ids].sort().slice(0, 25), reference_count: e.refs, first_party_id: e.first.party_id }, quote: e.first.extra, native_ids: { cl_party_id: e.first.party_id },
    qualification: 'The master docket\'s CourtListener party list names this civil action number in a party\'s extra_info text. The court is taken from the master (no other court was named). It is a docket-native reference, not a transfer record; individual party names are not stored in this evidence.', retrieved_at: e.first.retrieved_at });
}

// ---------- native crosswalk (firm dataset) ----------
async function crosswalk() {
  const q = `corpus_records?select=id,cells:item->cells,facts:detail->facts&dataset=eq.mdl_case_inventory&filters=cs.${encodeURIComponent(JSON.stringify({ mdl: [String(mdl)] }))}&limit=1000`;
  const r = await rest(q);
  return r.data;
}
const xwalk = await crosswalk();
for (const row of xwalk) {
  const c = row.cells; const clId = row.id.replace(/^cl_docket:/, '');
  const key = docketKeyFromNumber(c.court, c.docket);
  if (!key) { continue; }
  const d = dk(key);
  addNumber(d, c.docket, 'firm_crosswalk');
  // The firm crosswalk may name a CourtListener docket as the master although that docket's own header conflicts with the institutionally captioned one
  // (different PACER case id, party-v-party caption). Both statements are kept and labelled; neither is resolved.
  const headerConflict = key === masterKey && clExcluded.has(clId);
  addProvider(d, { provider: 'courtlistener', source_system: 'courtlistener', id: clId, url: `https://www.courtlistener.com/docket/${clId}/`, resolution_basis: headerConflict ? 'firm_crosswalk_only_courtlistener_header_conflicts' : 'native_crosswalk_exact_cl_docket_id' });
  if (headerConflict) d.notes.push(`The firm crosswalk (AWS release 2026-08-24) lists CourtListener ${clId} as the master docket of this MDL, but that docket's own CourtListener header disagrees (see the note above); both statements are kept and neither is resolved`);
  d.date_filed = d.date_filed ?? c.filed ?? null;
  const roleFact = (row.facts ?? []).find(f => f[0] === 'Role in the release')?.[1] ?? null;
  const isMaster = key === masterKey;
  addEvidence({ kind: 'native_crosswalk', claim: { asserted_role: isMaster ? 'master' : 'member', asserted_route: 'unknown', member_docket_key: key, master_docket_key: masterKey },
    source: { system: 'firm-dataset', url: `https://www.courtlistener.com/docket/${clId}/`, id: `mdl_case_inventory:${row.id}`, retrieved_at: '2026-09-30T13:11:32Z', as_of: '2026-08-24', dataset: 'mdl_case_inventory' },
    locator: { source_record_id: row.id, role_in_release: roleFact }, quote: null, native_ids: { cl_docket_id: clId },
    qualification: 'Firm-focused docket sample (AWS release 2026-08-24, SW-BULK): the MDL link comes from a member_of_mdl edge or catalog mdl_master_docket_id of that release. It is the firm collection, not an MDL member census.' + (headerConflict ? ' The CourtListener header of this docket id has a different PACER case id and a party-v-party caption than the institutionally captioned docket with the same number; the conflict is recorded, not resolved.' : ''), retrieved_at: '2026-09-30T13:11:32Z' });
}


// ---------- roles, links, counts ----------
const memberRows = [];
for (const d of dockets.values()) {
  const roles = [...d.roles];
  if (d.key === masterKey && !roles.includes('master')) roles.push('master');
  const hasPositive = roles.some(r => !['not_member', 'unknown'].includes(r));
  if (roles.includes('not_member') && hasPositive && d.key !== masterKey) { d.role = 'unknown'; d.membership_conflict = true; d.notes.push('Positive and negative (denied/vacated) JPML evidence both exist for this docket; role not resolved'); }
  else d.role = primaryRole(roles);
  d.roles_stated = roles;
  d.route = d.routes.size === 1 ? [...d.routes][0] : d.routes.size > 1 ? 'multiple_sources' : 'unknown';
  if (d.role !== 'master' && d.role !== 'jpml_panel' && d.role !== 'not_member' && !d.membership_conflict) memberRows.push(d);
}
const byBasis = {};
for (const d of memberRows) for (const b of d.basis) byBasis[b] = (byBasis[b] ?? 0) + 1;
// Same court + year + case type + sequence but a different office digit (e.g. N.D. Cal. 3:22-cv-00401 vs 4:22-cv-00401): possible
// divisional renumbering of ONE action. Never merged without a stating source; listed so a human/another source can confirm.
const looseGroups = new Map();
for (const d of memberRows) {
  const m = d.key.match(/^([a-z]+):(\d+):(\d{4}-[a-z]+-\d{5})$/);
  if (!m) continue;
  const g = `${m[1]}|${m[3]}`;
  looseGroups.set(g, [...(looseGroups.get(g) ?? []), d]);
}
const candidateIdentityLinks = [];
for (const [g, list] of looseGroups) {
  const offices = new Set(list.map(d => d.key.split(':')[1]));
  if (list.length > 1 && offices.size > 1) candidateIdentityLinks.push({ court_year_type_seq: g, keys: list.map(d => d.key), bases: list.map(d => [...d.basis]), basis: 'same_court_year_type_seq_office_digit_differs', merged: false });
}

// entry/party coverage from manifests
let manifest = {};
for (const p of PASSES) { const f = path.join(p, 'live-backfill-manifest.json'); if (exists(f)) { const m = readJson(f); if (!manifest.updated_at || String(m.updated_at) > String(manifest.updated_at)) manifest = m; } }
const countsFile = path.join(PASSES.at(-1), 'live-backfill-manifest.json');
const scopeFor = (kind, id) => (manifest.scopes ?? {})[`${kind}:${id}`] ?? null;
const countFor = (kind, id) => (manifest.counts ?? {})[`${kind}:${id}`] ?? null;
// When several CourtListener dockets share the master identity (ambiguous), the one with the most captured docket entries comes first
// (deterministic: ties by lowest numeric id); only the order among CourtListener ids changes.
{
  const cls = masterDk.provider_ids.filter(p => p.provider === 'courtlistener').sort((a, b) => (scopeFor('docket-entries', b.id)?.records ?? 0) - (scopeFor('docket-entries', a.id)?.records ?? 0) || Number(a.id) - Number(b.id));
  let i = 0; masterDk.provider_ids = masterDk.provider_ids.map(p => (p.provider === 'courtlistener' ? cls[i++] : p));
}
const baseCounts = exists(path.join(PASSES[3], 'master-scope-counts.json')) ? readJson(path.join(PASSES[3], 'master-scope-counts.json')).sources : [];
const entryCaptures = [];
for (const clId of clMasterIds) {
  if (!masterDk.provider_ids.some(p => p.provider === 'courtlistener' && p.id === clId)) continue;
  const s = scopeFor('docket-entries', clId); const c = countFor('docket-entries', clId) ?? (baseCounts.find(x => String(x.docket_id) === clId) ? { count: baseCounts.find(x => String(x.docket_id) === clId).entries, observed_at: baseCounts.find(x => String(x.docket_id) === clId).provenance.retrieved_at } : null);
  if (!s && !c) continue;
  entryCaptures.push({ provider: 'courtlistener', cl_docket_id: clId, captured_manifest_records: s?.records ?? 0, complete: s?.complete === true, provider_total: c?.count ?? null, provider_total_observed_at: c?.observed_at ?? null, scope_updated_at: s?.updated_at ?? null, next_cursor_retained: !!s?.next, ...(s?.status === 'source_blocked_or_missing_header' ? { status: s.status } : {}) });
  if (s?.status === 'source_blocked_or_missing_header') masterDk.notes.push(`CourtListener docket ${clId}: relations (entries, parties, attorneys) are not collected because the source marks the docket blocked or the header is unavailable`);
}
const partyCaptures = [];
for (const clId of clMasterIds) {
  if (!masterDk.provider_ids.some(p => p.provider === 'courtlistener' && p.id === clId)) continue;
  for (const kind of ['parties', 'attorneys']) { const s = scopeFor(kind, clId); if (!s) continue; partyCaptures.push({ provider: 'courtlistener', kind, cl_docket_id: clId, captured_manifest_records: s?.records ?? 0, complete: s?.complete === true, scope_updated_at: s?.updated_at ?? null }); }
}

const bundle = {
  schema_version: 'sw-matter-registry-bundle/1', mdl, built_at: BUILD_AT, seed: { tier: seed.tier, caption: seed.census_latest?.caption ?? seed.caption_parent_csv, master_docketbird_id: seed.master_docketbird_id, cl_master_ids: clMasterIds, jpml: seed.census_latest },
  counts: { dockets: dockets.size, member_like_dockets: memberRows.length, evidence: evidence.size, by_basis: byBasis, docketbird_members: dbMembers.length, crosswalk_rows: xwalk.length, candidate_identity_links: candidateIdentityLinks.length },
  candidate_identity_links: candidateIdentityLinks, docketbird_graph: dbGraph,
  entry_captures: entryCaptures, party_captures: partyCaptures, jpml_documents: jpmlDocs,
  dockets: [...dockets.values()].map(d => ({ ...d, roles: [...d.roles], routes: [...d.routes], basis: [...d.basis] })),
  evidence: [...evidence.values()],
};
fs.writeFileSync(path.join(out, `bundle-${mdl}.json`), JSON.stringify(bundle, null, 1));
console.log(JSON.stringify({ mdl, counts: bundle.counts, entry_captures: entryCaptures, party_captures: partyCaptures.map(p => `${p.kind}:${p.captured_manifest_records}:${p.complete}`) }));
