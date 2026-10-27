// Projects docket-sheet documents of DocketBird cases into the public read model as dataset `sw_docket_documents_v1` (one row per document,
// contract sw-matter-registry/1 style). Sources:
//   * docketbird-rest `docket-document` / `case` rows: from stage directories (--stage) or from the lake (--lake=true, read through
//     public.corpus_sw_docketbird_read_v1). Title, filing date, sheet number, object name, court URL, flags.
//   * docketbird-mcp `document_metadata` rows from the lake (--mcp=true): filing date, sheet number, provider flags. The lake keeps no title;
//     the title is read from the private get_docket_sheet capture the lake row cites, and only when that capture file's sha256 and the
//     document object's canonical sha256 both equal the hashes the lake recorded (--captures=<root of the docketbird capture folders>).
//     A row whose title cannot be verified is still projected, with the description "Not recorded".
//   * the private PDF registry (`corpus_matter_pdf_documents_v1`: sha256 + bytes when stored) and the native crosswalk `mdls` (exact docket
//     key = CourtListener docket id and MDL label). For a DocketBird-MCP case the CourtListener docket the intake qualified is linked only when
//     the lake holds that docket and its court and docket number give the same docket key as the DocketBird case id.
// Nothing is inferred; unknown values stay null ("Not recorded"). The personalized DocketBird locators (account user id in the query) are
// never read or published.
//
// Publication rule (owner decision 2026-10-27, "dont withhold any data. If its accurate and valuable, USE IT"): a document is held back only on
// explicit evidence from its own source, i.e. the provider flags it restricted (`restricted === true` on either source). Unknown seal status
// (`restricted` null) and titles that merely mention sealing words are published. A description carrying a contact field (phone, email) is
// withheld as published (owner decision 2026-10-03: no contact fields); the row is still projected.
//
// Re-running for some cases never touches rows of other cases: only rows of the cases in this run that the rule no longer allows are removed,
// after their before-image is written to the ledger.
//
//   node project-docketbird-documents.mjs [--stage=<dirs with docketbird-rest/>] [--lake=true] [--mcp=true --captures=<dir>]
//        [--cases=<id,id>] [--dry-run=true] [--ledger=<file>] [--packet=<dir>]
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {rpc, rest} from '../members-pgrest.mjs';
import {ws, hasContact, clipDescription, canon, sha256, daysSince1970} from '../members-publish-rules.mjs';
import {docketKey, docketKeyFromDocketBirdId} from './lib.mjs';

export const DS = 'sw_docket_documents_v1';
export const SCHEMA = 'sw-matter-registry-view/1';
export const RUN_ID = '3e9f9e50-1ef8-4410-a91d-96a194666c82';
export const RULE = 'owner-decision-2026-10-27';
const enc = encodeURIComponent;

export const availabilityOf = ({stored, downloaded, registryAvailability}) =>
  stored ? 'stored' : downloaded === false ? 'provider_not_downloaded' : registryAvailability === 'held' ? 'held_by_registry' : 'not_stored';
export const AVAILABILITY_LABEL = {stored: 'PDF stored', provider_not_downloaded: 'Provider has not downloaded the file', held_by_registry: 'Held by the PDF registry', not_stored: 'Not stored'};
/** The only hold: the provider itself flags the document restricted. */
export const sourceHold = ({restricted}) => restricted === true;
const SEAL_STATUS = {false: 'Not restricted by the provider', null: 'Not recorded by the provider'};
// Wording the earlier display rule withheld; counted so the release can be audited, never used to withhold.
const LEGACY_WORDING = /seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact/i;

/** Pure ordinal: filing day then entry number, so adding cases never renumbers rows already projected. */
export const documentOrdinal = (dateFiled, entryNumber) => daysSince1970(dateFiled) * 1e6 + Math.min(Math.max(Number(entryNumber ?? 0) || 0, 0), 99_999) * 10;

/** Exact native crosswalk from `mdls` rows: docket key -> {cl_docket_id, mdl}. Ambiguous keys are dropped. */
export function crosswalkFromMdls(mdlRows) {
  const m = new Map();
  for (const r of mdlRows) {
    const i = r.item ?? {};
    const key = docketKey(i.cl_court_id, String(i.master_docket ?? ''));
    if (!key || !i.cl_docket_id) continue;
    m.set(key, m.has(key) ? null : {cl_docket_id: String(i.cl_docket_id), mdl: String(i.mdl_number ?? r.id)});
  }
  return new Map([...m].filter(([, v]) => v));
}

/** The lake CourtListener docket of a DocketBird-MCP row, kept only when its court + docket number give the case's own docket key. */
export function exactClDocket(caseId, cl) {
  if (!cl?.id) return null;
  const key = docketKeyFromDocketBirdId(caseId);
  return key && docketKey(cl.court_id, String(cl.docket_number ?? '')) === key ? {id: String(cl.id), case_name: ws(cl.case_name) || null} : null;
}

/** The JSON body of a get_docket_sheet capture (the text can start with a NOTE line before the JSON). */
export function sheetBody(capture) {
  const text = JSON.parse(capture.original_rpc_response).result.content[0].text;
  return JSON.parse(text.slice(text.indexOf('{')));
}

/** Title of a DocketBird-MCP document from its capture, only when the file hash and the document's canonical hash match the lake. */
export function verifiedTitle(prov, captureIndex) {
  const cap = captureIndex.get(prov?.source_capture_file_sha256 ?? '');
  if (!cap) return {title: null, verified: false, reason: 'capture_not_available'};
  const doc = cap.get(prov.native_document_id);
  if (!doc) return {title: null, verified: false, reason: 'document_not_in_capture'};
  if (sha256(canon(doc)) !== prov.source_original_document_sha256) return {title: null, verified: false, reason: 'document_hash_mismatch'};
  return {title: doc.title ?? null, restricted: doc.restricted, verified: true, reason: null};
}

const NAMED_ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', sect: '\u00a7', para: '\u00b6', hellip: '\u2026'};
/** Decodes HTML character references (numeric, hex and the common named ones) so a title reads as the court record does
 * ("PLAINTIFFS&#039; MOTION" -> "PLAINTIFFS' MOTION"). Applied after hash verification, which stays on the raw capture object. */
export function decodeEntities(s) {
  if (s == null) return s;
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    const v = NAMED_ENTITIES[g.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Normalizes a docketbird-mcp document_metadata lake row to the docket-document shape of the REST rows. */
export function mcpDocument(row, captureIndex) {
  const d = row.data ?? {};
  const prov = {...(row.provenance ?? {}), native_document_id: d.native_document_id ?? row.native_id};
  const t = verifiedTitle(prov, captureIndex);
  const ind = d.source_provider_downloaded_indicator;
  return {
    native_id: row.native_id, source: 'docketbird-mcp', title_verification: t.verified ? 'verified' : t.reason,
    data: {id: d.native_document_id ?? row.native_id, case_id: d.native_case_id, title: decodeEntities(t.title), filing_date: d.source_filing_date ?? null,
      // Either the lake flag or the capture's own flag restricts the document.
      restricted: d.source_restricted === true || t.restricted === true ? true : d.source_restricted === false ? false : null,
      docket_sheet_number: Number.isInteger(d.source_primary_docket_sheet_number) ? d.source_primary_docket_sheet_number : null,
      downloaded_by_provider: ind === 1 || ind === true ? true : ind === 0 || ind === false ? false : null, court_document_url: null, pacer_document_url: null, docketbird_object_name: null},
    provenance: {record_sha256: prov.record_sha256 ?? row.payload_sha256, source_sha256: prov.source_sha256 ?? null, retrieved_at: prov.retrieved_at ?? row.retrieved_at,
      source_tool: prov.source_tool ?? 'get_docket_sheet', capture_file_sha256: prov.source_capture_file_sha256 ?? null, original_document_sha256: prov.source_original_document_sha256 ?? null},
    cl_docket: exactClDocket(d.native_case_id, row.cl_docket),
  };
}

/** One document per native id. REST rows win over MCP rows (richer), but a restriction on either source holds the document. */
export function mergeDocuments(restRows, mcpRows) {
  const out = new Map();
  for (const r of mcpRows) out.set(r.native_id, r);
  for (const r of restRows) {
    const prior = out.get(r.native_id);
    const restricted = r.data.restricted === true || prior?.data?.restricted === true ? true : r.data.restricted;
    out.set(r.native_id, {...r, source: r.source ?? 'docketbird-rest', data: {...r.data, restricted}, cl_docket: r.cl_docket ?? prior?.cl_docket ?? null});
  }
  return [...out.values()];
}

export function buildRows({caseRows, docRows, registry, crosswalk, matterIds, partyCounts, projectedAt}) {
  const cases = new Map(caseRows.map(c => [c.native_id, c]));
  const caseOrder = [...new Set(docRows.map(d => d.data.case_id))].sort();
  const stats = {sheet_documents: docRows.length, rows: 0, withheld_no_row: 0, held_source_restricted: 0, published_unknown_seal: 0, published_legacy_wording: 0,
    stored: 0, provider_not_downloaded: 0, held_by_registry: 0, not_stored: 0, description_withheld_contact: 0, title_not_verified: 0, by_source: {}, by_case: {}};
  const rows = [];
  const byCase = new Map();
  for (const r of docRows) byCase.set(r.data.case_id, [...(byCase.get(r.data.case_id) ?? []), r]);
  for (const caseId of caseOrder) {
    const c = cases.get(caseId)?.data ?? {};
    const key = docketKeyFromDocketBirdId(caseId);
    const xw = key ? crosswalk.get(key) ?? null : null;
    const reg = new Map((registry[caseId] ?? []).map(x => [x.native_document_id, x]));
    const docs = byCase.get(caseId).sort((a, b) => (a.data.docket_sheet_number ?? 1e9) - (b.data.docket_sheet_number ?? 1e9) || a.native_id.localeCompare(b.native_id));
    // Case title, docket key and MDL in the metadata so the overview never needs one query per case (review 2026-10-27).
    const caseStats = stats.by_case[caseId] = {sheet_documents: docs.length, rows: 0, withheld_no_row: 0, rule: RULE,
      case_title: c.title ?? docs.find(r => r.cl_docket?.case_name)?.cl_docket?.case_name ?? null, docket_key: key, mdl: xw?.mdl ?? null};
    for (const r of docs) {
      const d = r.data;
      const source = r.source ?? 'docketbird-rest';
      if (sourceHold(d)) { stats.withheld_no_row++; stats.held_source_restricted++; caseStats.withheld_no_row++; continue; }
      const x = reg.get(d.id) ?? null;
      const stored = Boolean(x?.sha256);
      const availability = availabilityOf({stored, downloaded: d.downloaded_by_provider, registryAvailability: x?.availability});
      const raw = ws(decodeEntities(d.title));
      const contact = hasContact(raw);
      const clip = clipDescription(raw, 500);
      const description = contact || !raw ? null : clip.text;
      if (contact) stats.description_withheld_contact++;
      if (d.restricted == null) stats.published_unknown_seal++;
      if (description && LEGACY_WORDING.test(description)) stats.published_legacy_wording++;
      const titleUnverified = source === 'docketbird-mcp' && r.title_verification !== 'verified';
      if (titleUnverified) stats.title_not_verified++;
      const entryNumber = Number.isInteger(d.docket_sheet_number) ? d.docket_sheet_number : null;
      const id = `sw-doc:docketbird:${d.id}`;
      const year = d.filing_date ? d.filing_date.slice(0, 4) : '';
      const mdl = xw?.mdl ?? null;
      const clId = xw?.cl_docket_id ?? r.cl_docket?.id ?? null;
      const clBasis = xw ? 'exact_docket_key_mdls_master_docket' : r.cl_docket ? 'exact_docket_key_lake_courtlistener_docket' : null;
      const caseTitle = c.title ?? r.cl_docket?.case_name ?? null;
      const courtId = c.court_id ?? (key ? key.split(':')[0] : null);
      const fileName = d.docketbird_object_name ?? null;
      const label = `${entryNumber != null ? `Entry ${entryNumber}` : 'Unnumbered'}`;
      const title = description ? `${label} — ${description.length > 110 ? description.slice(0, 109) + '…' : description}` : `${label} — description ${contact ? 'withheld' : 'not recorded'}`;
      const sealStatus = SEAL_STATUS[String(d.restricted === false ? false : null)];
      const cells = {
        provider: 'docketbird', native_document_id: d.id, native_case_id: caseId, case_title: caseTitle, court_id: courtId, docket_key: key,
        native_docket_id: clId, mdl, entry_number: entryNumber, date_filed: d.filing_date ?? null, description, description_withheld: contact ? 'contact_or_access_data' : null,
        file_name: fileName, court_url: d.court_document_url ?? d.pacer_document_url ?? null, availability, stored, sha256: stored ? x.sha256 : null, bytes: stored ? x.bytes : null,
        label: null, restricted: d.restricted === false ? false : null, source_system: source,
      };
      const clUrl = clId ? `https://www.courtlistener.com/docket/${clId}/` : null;
      const links = [...(cells.court_url ? [{url: cells.court_url, label: 'Court document page'}] : []), ...(clUrl ? [{url: clUrl, label: 'CourtListener docket'}] : []),
        ...(mdl && matterIds.has(mdl) ? [{url: `#record/sw_matters_v1/${enc(`sw-matter:${mdl}`)}`, label: 'Matter'}] : [])];
      const descriptionFact = description ?? (contact ? 'Withheld (the text carries contact or hearing access data)' : titleUnverified ? 'Not recorded (the source capture could not be verified)' : 'Not recorded');
      const facts = [['DocketBird case', caseId], ['Case', caseTitle ?? 'Not recorded'], ['Entry number', entryNumber != null ? String(entryNumber) : 'Not numbered'], ['Filed', d.filing_date ?? 'Not recorded'],
        ['Description', descriptionFact], ['File name', fileName ?? 'Not recorded'], ['Seal status', sealStatus],
        ['Availability', AVAILABILITY_LABEL[availability]], ['Size', stored ? `${x.bytes} bytes` : 'Not recorded'], ['SHA-256', stored ? x.sha256 : 'Not recorded'], ['Label', 'Not recorded (the provider supplies no document category)'],
        ['MDL', mdl ? `${mdl} (exact native crosswalk)` : 'Not recorded'], ['CourtListener docket', clId ? `${clId} (${clBasis === 'exact_docket_key_mdls_master_docket' ? 'exact native crosswalk' : 'same court and docket number'})` : 'Not recorded'],
        ['Source', source === 'docketbird-mcp' ? 'DocketBird docket sheet (get_docket_sheet)' : 'DocketBird documents API'], ['Native document id', d.id]];
      if (mdl && partyCounts.has(mdl)) facts.push(['Parties of the matter in the registry', String(partyCounts.get(mdl))]);
      const rec = {
        dataset: DS, id, category: 'sw_docket_document', state: null, county_geoids: [], title, source_url: cells.court_url ?? clUrl,
        ordinal: documentOrdinal(d.filing_date, entryNumber),
        item: {id, cells, links, title, badges: ['Docket document', ...(stored ? ['PDF stored'] : []), ...(availability === 'provider_not_downloaded' ? ['File not downloaded by provider'] : [])], subtitle: `${caseTitle ?? caseId} · filed ${d.filing_date ?? 'not recorded'}`},
        detail: {id, title, facts, links, sections: [],
          registry: {schema: 'sw-matter-registry/1', docketbird_case_id: caseId, docket_key: key, mdl, native_case_ids: [{provider: 'docketbird', source_system: source, id: caseId}, ...(clId ? [{provider: 'courtlistener', source_system: 'courtlistener', id: clId, resolution_basis: clBasis}] : [])]},
          provenance: {source_system: source, source_entity_type: source === 'docketbird-mcp' ? 'document_metadata' : 'docket-document', source_native_id: d.id, source_record_sha256: r.provenance?.record_sha256 ?? null, source_response_sha256: r.provenance?.source_sha256 ?? null,
            retrieved_at: r.provenance?.retrieved_at ?? null, run_ids: [RUN_ID], projection_schema: SCHEMA, publication_rule: RULE,
            ...(source === 'docketbird-mcp' ? {title_source: {verification: r.title_verification ?? null, capture_file_sha256: r.provenance?.capture_file_sha256 ?? null, original_document_sha256: r.provenance?.original_document_sha256 ?? null}} : {}),
            pdf: stored ? {registry: 'corpus_matter_pdf_documents_v1', sha256: x.sha256, bytes: x.bytes, verified_at: x.verified_at ?? null, read_api: 'corpus_matter_pdf_object_v1'} : null},
          qualification: 'One document of a DocketBird case as the provider docket sheet shows it (title as published). Documents the provider flags restricted are not projected; documents of unrecorded seal status are shown with that status. The provider supplies no document category, so the label is not recorded. Not legal advice.'},
        text: [description ?? '', entryNumber ?? '', caseTitle ?? '', fileName ?? '', mdl ? `MDL ${mdl}` : '', d.filing_date ?? ''].join(' ').replace(/\s+/g, ' ').trim(),
        filters: {_listing: 'true', native_id: d.id, case_id: caseId, court_id: courtId ?? '', mdl: mdl ?? '', year, availability, has_pdf: stored ? 'true' : 'false', native_docket_id: clId ?? '', source_system: source},
      };
      // The row hash leaves out projected_at, so an unchanged row hashes the same on every run (recovery reruns show changed_existing 0).
      rec.detail.provenance.projection_row_sha256 = sha256(canon([rec.id, rec.title, rec.item, rec.detail, rec.filters, rec.text, rec.source_url]));
      rec.detail.provenance.projected_at = projectedAt;
      rows.push(rec); stats.rows++; caseStats.rows++; stats[availability]++; stats.by_source[source] = (stats.by_source[source] ?? 0) + 1;
    }
  }
  return {rows, stats};
}

const countBy = (filters, f) => { const c = new Map(); for (const x of filters) { const v = x?.[f]; if (v !== '' && v != null) c.set(v, (c.get(v) ?? 0) + 1); } return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };

/**
 * Dataset metadata over the whole dataset after a run: `allFilters` are the filters of every row now in the dataset, `stats` this run's
 * counts, `priorCoverage` the previous metadata coverage (cases outside this run keep their entry, marked with the rule they were projected under).
 */
export function datasetMetadata(allFilters, stats, priorCoverage = {}) {
  const opt = (f, label = x => x) => countBy(allFilters, f).map(([value, n]) => ({value, label: label(value), count: n}));
  const byCase = {};
  for (const [k, v] of Object.entries(priorCoverage?.by_case ?? {})) if (!stats.by_case[k]) byCase[k] = {...v, rule: v.rule ?? 'display-rule-2026-10-03'};
  Object.assign(byCase, stats.by_case);
  const sum = f => Object.values(byCase).reduce((n, c) => n + (Number(c[f]) || 0), 0);
  const legacy = Object.values(byCase).filter(c => c.rule !== RULE).reduce((n, c) => n + (Number(c.withheld_no_row) || 0), 0);
  const avail = Object.fromEntries(countBy(allFilters, 'availability'));
  return {
    grain: 'One docket-sheet document of a DocketBird case', aliases: [DS, 'sw-docket-documents'], source_system: 'docketbird', schema_version: SCHEMA, source_runs: [RUN_ID], publication_rule: RULE,
    qualification: 'Documents of DocketBird cases (the account\'s tracked cases and the firm-portfolio docket sheets), as the provider docket sheet shows them. Documents the provider flags restricted are counted, not shown; documents whose seal status the provider does not record are shown with that status. File names are the provider\'s stored object names; PDFs live in the private store and are read through the PDF read API. The provider supplies no document category. Not legal advice.',
    privacy_policy: 'Show as published (owner decisions 2026-10-03 and 2026-10-27): held back only when the provider flags the document restricted. No contact fields or hearing access data (dial-in numbers, meeting IDs, passcodes). No signed or personalized storage links.',
    ordinal_note: 'Rows projected from 2026-10-27 order by filing day then entry number. The earlier ilnd-1:2023-cv-00818 rows keep their case-index ordinals (10,000,010-10,028,490) until that case is captured and projected again, so in ordinal order they sort ahead of the other cases.',
    withheld_counts: {sheet_documents: sum('sheet_documents'), not_projected: sum('withheld_no_row'), source_restricted: sum('withheld_no_row') - legacy, legacy_rule_not_projected: legacy},
    coverage: {rows: allFilters.length, stored: avail.stored ?? 0, provider_not_downloaded: avail.provider_not_downloaded ?? 0, held_by_registry: avail.held_by_registry ?? 0, not_stored: avail.not_stored ?? 0, by_case: byCase,
      // Rows projected before the source_system filter existed all came from the DocketBird documents API (docketbird-rest stage files).
      by_source: Object.fromEntries(countBy(allFilters.map(f => ({source_system: f?.source_system || 'docketbird-rest'})), 'source_system'))},
    listing: {columns: [{key: 'entry_number', label: 'Entry'}, {key: 'date_filed', label: 'Filed'}, {key: 'description', label: 'Description'}, {key: 'file_name', label: 'File name'}, {key: 'availability', label: 'Availability'}, {key: 'case_title', label: 'Case'}],
      filters: [{name: 'case_id', type: 'select', label: 'Case', options: opt('case_id'), placeholder: 'All cases'}, {name: 'mdl', type: 'select', label: 'MDL', options: opt('mdl', v => `MDL ${v}`), placeholder: 'All MDLs'},
        {name: 'year', type: 'select', label: 'Year filed', options: opt('year'), placeholder: 'All years'}, {name: 'availability', type: 'select', label: 'Availability', options: opt('availability', v => AVAILABILITY_LABEL[v] ?? v), placeholder: 'Any'}]},
  };
}

/** Rows of the cases in this run that the current rule no longer produces (never rows of any other case). */
export function staleRows(remoteRows, projectedRows) {
  const keep = new Set(projectedRows.map(r => r.id));
  const runCases = new Set(projectedRows.map(r => r.filters.case_id));
  return remoteRows.filter(r => !keep.has(r.id) && runCases.has(r.filters?.case_id));
}

/** Indexes the capture files the lake rows cite: capture sha256 -> Map(document id -> document object). Files whose bytes do not hash to the recorded sha256 are skipped. */
export async function loadCaptures(mcpRawRows, root) {
  const index = new Map(); const report = {files: 0, missing: 0, sha_mismatch: 0};
  const files = new Map();
  for (const r of mcpRawRows) { const p = r.provenance ?? {}; if (p.source_capture_file_sha256 && p.source_capture_file_uri) files.set(p.source_capture_file_sha256, p.source_capture_file_uri); }
  for (const [want, uri] of files) {
    report.files++;
    const local = root ? path.join(root, uri.replace(/^.*\/docketbird\//, '')) : fileURLToPath(uri);
    let buf; try { buf = await fs.readFile(local); } catch { report.missing++; continue; }
    if (sha256(buf) !== want) { report.sha_mismatch++; continue; }
    const body = sheetBody(JSON.parse(buf.toString('utf8')));
    index.set(want, new Map((body.documents ?? []).map(d => [d.id, d])));
  }
  return {index, report};
}

const readJsonl = async f => (await fs.readFile(f, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));

async function lakeAll(kind, caseIds) {
  const out = []; let after = null;
  for (;;) { const r = await rpc('corpus_sw_docketbird_read_v1', {p_kind: kind, p_case_ids: caseIds, p_after: after, p_limit: 500}); out.push(...r.rows); if (!r.next) return out; after = r.next; }
}

async function registryFor(caseIds) {
  const out = {};
  for (let i = 0; i < caseIds.length; i += 50) {
    const batch = caseIds.slice(i, i + 50);
    for (let off = 0; ; off += 500) {
      const r = await rpc('corpus_matter_pdf_documents_v1', {p_native_case_ids: batch, p_limit: 500, p_offset: off});
      for (const x of r.rows) (out[x.native_case_id] ??= []).push(x);
      if (r.rows.length < 500) break;
    }
  }
  return out;
}

async function remoteIndex() {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const p = (await rest(`corpus_records?select=id,ordinal,filters,h:detail->provenance->>projection_row_sha256&dataset=eq.${DS}&order=id.asc&limit=1000&offset=${off}`)).data;
    out.push(...p); if (p.length < 1000) return out;
  }
}
async function remoteRowsByIds(ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 100) rows.push(...(await rest(`corpus_records?select=*&dataset=eq.${DS}&id=in.(${ids.slice(i, i + 100).map(id => `"${id}"`).map(enc).join(',')})`)).data);
  return rows;
}

export async function main(argv) {
  const args = Object.fromEntries(argv.map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), 'true'] : [a.slice(2, i), a.slice(i + 1)]; }));
  const dry = args['dry-run'] === 'true';
  const onlyCases = args.cases ? String(args.cases).split(',').filter(Boolean) : null;
  // --stage accepts several stage directories (comma separated); the last row for a native id wins.
  const uniq = rows => [...new Map(rows.map(r => [r.native_id, r])).values()];
  const stages = String(args.stage ?? '').split(',').filter(Boolean).filter(s => s !== 'true');
  let caseRows = uniq((await Promise.all(stages.map(d => readJsonl(path.join(d, 'docketbird-rest/case.jsonl')).catch(() => [])))).flat());
  let restDocs = uniq((await Promise.all(stages.map(d => readJsonl(path.join(d, 'docketbird-rest/docket-document.jsonl')).catch(() => [])))).flat()).map(r => ({...r, source: 'docketbird-rest'}));
  if (args.lake === 'true') {
    caseRows = uniq([...(await lakeAll('rest-cases', onlyCases)), ...caseRows]);
    restDocs = uniq([...(await lakeAll('rest-documents', onlyCases)).map(r => ({...r, source: 'docketbird-rest'})), ...restDocs]);
  }
  let mcpDocs = []; let captureReport = null;
  if (args.mcp === 'true') {
    const raw = await lakeAll('mcp-documents', onlyCases);
    const {index, report} = await loadCaptures(raw, args.captures && args.captures !== 'true' ? args.captures : null);
    captureReport = report;
    mcpDocs = raw.map(r => mcpDocument(r, index));
  }
  const docRows = mergeDocuments(restDocs, mcpDocs);
  if (!docRows.length) throw new Error('no input documents (pass --stage, --lake=true and/or --mcp=true)');
  const caseIds = [...new Set(docRows.map(d => d.data.case_id))].sort();
  const registry = await registryFor(caseIds);
  const mdlRows = (await rest('corpus_records?select=id,item&dataset=eq.mdls&limit=1000')).data;
  const matterIds = new Set((await rest('corpus_records?select=id&dataset=eq.sw_matters_v1&limit=1000')).data.map(r => r.id.replace('sw-matter:', '')));
  const partyCounts = new Map();
  const crosswalk = crosswalkFromMdls(mdlRows);
  for (const mdl of new Set([...crosswalk.values()].map(v => v.mdl))) {
    const r = await rest(`corpus_records?select=id&dataset=eq.sw_matter_parties_v1&filters->>mdl=eq.${mdl}&limit=1`, {prefer: 'count=exact'});
    const n = Number((r.headers.get('content-range') ?? '').split('/')[1]); if (n > 0) partyCounts.set(mdl, n);
  }
  const projectedAt = new Date().toISOString();
  const {rows, stats} = buildRows({caseRows, docRows, registry, crosswalk, matterIds, partyCounts, projectedAt});
  const before = await remoteIndex();
  const beforeById = new Map(before.map(r => [r.id, r]));
  const stale = staleRows(before, rows);
  const todo = rows.filter(r => { const x = beforeById.get(r.id); return !x || x.h !== r.detail.provenance.projection_row_sha256 || Number(x.ordinal) !== r.ordinal; });
  const changedExisting = todo.filter(r => beforeById.has(r.id)).map(r => r.id);
  const summary = {dry, ...stats, by_case: undefined, cases: caseIds.length, capture_report: captureReport, remote_before: before.length, to_upsert: todo.length, new_rows: todo.length - changedExisting.length, changed_existing: changedExisting.length, stale_to_remove: stale.length,
    remote_after_expected: before.length - stale.length + (todo.length - changedExisting.length)};
  console.log(JSON.stringify(summary));
  if (args.packet && args.packet !== 'true') {
    await fs.mkdir(args.packet, {recursive: true});
    await fs.writeFile(path.join(args.packet, 'dry-run-summary.json'), JSON.stringify({...summary, by_case: stats.by_case}, null, 1));
    await fs.writeFile(path.join(args.packet, `${DS}.upsert.jsonl`), todo.map(r => JSON.stringify(r)).join('\n') + (todo.length ? '\n' : ''));
  }
  if (dry) return {rows, stats, summary};
  if ((stale.length || changedExisting.length) && !args.ledger) throw new Error('--ledger=<file> is required when rows of this dataset are changed or removed');
  if (stale.length || changedExisting.length) {
    const images = await remoteRowsByIds([...stale.map(r => r.id), ...changedExisting]);
    if (images.length !== stale.length + changedExisting.length) throw new Error('could not read every before-image');
    await fs.writeFile(args.ledger, images.map(r => JSON.stringify({captured_at: projectedAt, action: stale.some(s => s.id === r.id) ? 'removed' : 'replaced', before: r})).join('\n') + '\n', {flag: 'a'});
  }
  const existing = (await rest(`corpus_datasets?select=id,ready,metadata&id=eq.${DS}`)).data[0] ?? null;
  // Not ready while rows change: a crash mid-run must not leave a partial dataset marked ready (review 2026-10-27).
  if (existing) await rest(`corpus_datasets?id=eq.${DS}`, {method: 'PATCH', prefer: 'return=minimal', body: {ready: false}});
  await rest('corpus_datasets?on_conflict=id', {method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [{id: DS, label: 'Seeger Weiss matter registry — documents of DocketBird dockets', ...(existing ? {} : {ready: false}), updated_at: projectedAt}]});
  for (let i = 0; i < stale.length; i += 100) await rest(`corpus_records?dataset=eq.${DS}&id=in.(${stale.slice(i, i + 100).map(r => `"${r.id}"`).map(enc).join(',')})`, {method: 'DELETE', prefer: 'return=minimal'});
  for (let i = 0; i < todo.length; i += 150) await rest('corpus_records?on_conflict=dataset,id', {method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: todo.slice(i, i + 150)});
  // Read-back: every projected row's stored hash and ordinal, the exact dataset count, and a full-field digest of a fixed sample.
  const after = await remoteIndex();
  const afterById = new Map(after.map(r => [r.id, r]));
  const mismatched = rows.filter(r => { const x = afterById.get(r.id); return !x || x.h !== r.detail.provenance.projection_row_sha256 || Number(x.ordinal) !== r.ordinal; }).length;
  const sample = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 500)) === 0);
  const back = await remoteRowsByIds(sample.map(r => r.id));
  const noStamp = detail => ({...detail, provenance: {...(detail?.provenance ?? {}), projected_at: undefined}});
  const digest = recs => sha256(canon([...recs].sort((a, b) => a.id.localeCompare(b.id)).map(r => [r.id, r.title, r.item, noStamp(r.detail), r.filters, Number(r.ordinal)])));
  const verified = mismatched === 0 && after.length === summary.remote_after_expected && digest(back) === digest(sample);
  const projection_validation = {projected_records: rows.length, remote_records: after.length, expected_remote_records: summary.remote_after_expected, mismatched, sample_rows: sample.length, verified, validated_at: new Date().toISOString(), contract_version: SCHEMA,
    rows_sha256: sha256(rows.map(r => `${r.id}:${r.detail.provenance.projection_row_sha256}`).sort().join('\n')), method: 'PostgREST read-back of every projected row hash and ordinal, exact dataset count, full-field digest of a fixed sample'};
  const metadata = datasetMetadata(after.map(r => r.filters ?? {}), stats, existing?.metadata?.coverage ?? {});
  await rest(`corpus_datasets?id=eq.${DS}`, {method: 'PATCH', prefer: 'return=minimal', body: {expected_records: after.length, imported_records: after.length, metadata: {...metadata, projection_validation}, updated_at: new Date().toISOString(), ready: verified ? true : false}});
  console.log(JSON.stringify({event: 'synced', dataset: DS, projected: rows.length, upserted: todo.length, removed: stale.length, remote: after.length, verified, ready: verified}));
  if (!verified) process.exitCode = 2;
  return {rows, stats, summary};
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) main(process.argv.slice(2)).catch(e => { console.error(String(e.message ?? e).replace(/sb_secret_[A-Za-z0-9_]+/g, '[redacted]')); process.exitCode = 1; });
