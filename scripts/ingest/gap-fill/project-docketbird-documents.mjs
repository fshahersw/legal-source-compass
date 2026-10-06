// Projects the docket-sheet documents of the account's DocketBird-tracked cases into the public read model as dataset `sw_docket_documents_v1`
// (one row per document, contract sw-matter-registry/1 style). Sources: the landed `docketbird-rest / docket-document` rows (title, filing date,
// sheet number, object name, court URL, flags), the private PDF registry (`corpus_matter_pdf_documents_v1`: sha256 + bytes when stored) and the
// native crosswalk `mdls` (exact docket key = CourtListener docket id and MDL label). Nothing is inferred; unknown values stay null ("Not recorded").
//
// Withheld: documents that are restricted, of unknown seal, or titled with sealed/restricted/in camera/ex parte/redacted wording get NO row (count only
// in the dataset metadata). A description carrying a contact field is withheld as in the other registry projections.
//
//   node project-docketbird-documents.mjs --stage=<dir with docketbird-rest/> [--dry-run=true] [--ledger=<file>]
import fs from 'node:fs/promises';
import path from 'node:path';
import {rpc, rest} from '../members-pgrest.mjs';
import {ws, hasContact, excluded, clipDescription, canon, sha256} from '../members-publish-rules.mjs';
import {docketKey, docketKeyFromDocketBirdId, isDisplayWithheld} from './lib.mjs';

export const DS = 'sw_docket_documents_v1';
export const SCHEMA = 'sw-matter-registry-view/1';
export const RUN_ID = '3e9f9e50-1ef8-4410-a91d-96a194666c82';
const enc = encodeURIComponent;

export const availabilityOf = ({stored, downloaded, registryAvailability}) =>
  stored ? 'stored' : downloaded === false ? 'provider_not_downloaded' : registryAvailability === 'held' ? 'held_by_registry' : 'not_stored';
export const AVAILABILITY_LABEL = {stored: 'PDF stored', provider_not_downloaded: 'Provider has not downloaded the file', held_by_registry: 'Held by the PDF registry', not_stored: 'Not stored'};

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

export function buildRows({caseRows, docRows, registry, crosswalk, matterIds, partyCounts, projectedAt}) {
  const cases = new Map(caseRows.map(c => [c.native_id, c]));
  const caseOrder = [...new Set(docRows.map(d => d.data.case_id))].sort();
  const stats = {sheet_documents: docRows.length, rows: 0, withheld_no_row: 0, withheld_restricted_or_unknown: 0, withheld_sealed_wording: 0, stored: 0, provider_not_downloaded: 0, held_by_registry: 0, not_stored: 0, description_withheld_contact: 0, by_case: {}};
  const rows = [];
  for (const caseId of caseOrder) {
    const c = cases.get(caseId)?.data ?? {};
    const key = docketKeyFromDocketBirdId(caseId);
    const xw = key ? crosswalk.get(key) ?? null : null;
    const reg = new Map((registry[caseId] ?? []).map(x => [x.native_document_id, x]));
    const docs = docRows.filter(d => d.data.case_id === caseId).sort((a, b) => (a.data.docket_sheet_number ?? 1e9) - (b.data.docket_sheet_number ?? 1e9) || a.native_id.localeCompare(b.native_id));
    const caseStats = stats.by_case[caseId] = {sheet_documents: docs.length, rows: 0, withheld_no_row: 0};
    docs.forEach((r, idx) => {
      const d = r.data;
      // Same broad exclusion as every registry projection ("seal" also catches a motion to seal); such documents get no row, only a count.
      if (isDisplayWithheld({restricted: d.restricted, text: d.title}) || excluded(d.title)) {
        stats.withheld_no_row++; caseStats.withheld_no_row++;
        if (d.restricted !== false) stats.withheld_restricted_or_unknown++; else stats.withheld_sealed_wording++;
        return;
      }
      const x = reg.get(d.id) ?? null;
      const stored = Boolean(x?.sha256);
      const availability = availabilityOf({stored, downloaded: d.downloaded_by_provider, registryAvailability: x?.availability});
      const raw = ws(d.title);
      const contact = hasContact(raw);
      const clip = clipDescription(raw, 500);
      const description = contact || !raw ? null : clip.text;
      if (contact) stats.description_withheld_contact++;
      const entryNumber = Number.isInteger(d.docket_sheet_number) ? d.docket_sheet_number : null;
      const id = `sw-doc:docketbird:${d.id}`;
      const year = d.filing_date ? d.filing_date.slice(0, 4) : '';
      const mdl = xw?.mdl ?? null;
      const fileName = d.docketbird_object_name ?? null;
      const title = description ? `${entryNumber != null ? `Entry ${entryNumber}` : 'Unnumbered'} \u2014 ${description.length > 110 ? description.slice(0, 109) + '\u2026' : description}` : `${entryNumber != null ? `Entry ${entryNumber}` : 'Unnumbered'} \u2014 description ${contact ? 'withheld' : 'not recorded'}`;
      const cells = {
        provider: 'docketbird', native_document_id: d.id, native_case_id: caseId, case_title: c.title ?? null, court_id: c.court_id ?? null, docket_key: key,
        native_docket_id: xw?.cl_docket_id ?? null, mdl, entry_number: entryNumber, date_filed: d.filing_date ?? null, description, description_withheld: contact ? 'contact_or_access_data' : null,
        file_name: fileName, court_url: d.court_document_url ?? d.pacer_document_url ?? null, availability, stored, sha256: stored ? x.sha256 : null, bytes: stored ? x.bytes : null,
        label: null, restricted: false,
      };
      const links = [...(cells.court_url ? [{url: cells.court_url, label: 'Court document page'}] : []), ...(xw ? [{url: `https://www.courtlistener.com/docket/${xw.cl_docket_id}/`, label: 'CourtListener docket'}] : []),
        ...(mdl && matterIds.has(mdl) ? [{url: `#record/sw_matters_v1/${enc(`sw-matter:${mdl}`)}`, label: 'Matter'}] : [])];
      const facts = [['DocketBird case', caseId], ['Case', c.title ?? 'Not recorded'], ['Entry number', entryNumber != null ? String(entryNumber) : 'Not numbered'], ['Filed', d.filing_date ?? 'Not recorded'],
        ['Description', description ?? (contact ? 'Withheld (the text carries contact or hearing access data)' : 'Not recorded')], ['File name', fileName ?? 'Not recorded'],
        ['Availability', AVAILABILITY_LABEL[availability]], ['Size', stored ? `${x.bytes} bytes` : 'Not recorded'], ['SHA-256', stored ? x.sha256 : 'Not recorded'], ['Label', 'Not recorded (the provider supplies no document category)'],
        ['MDL', mdl ? `${mdl} (exact native crosswalk)` : 'Not recorded'], ['CourtListener docket', xw ? xw.cl_docket_id : 'Not recorded'], ['Native document id', d.id]];
      if (mdl && partyCounts.has(mdl)) facts.push(['Parties of the matter in the registry', String(partyCounts.get(mdl))]);
      const rec = {
        dataset: DS, id, category: 'sw_docket_document', state: null, county_geoids: [], title, source_url: cells.court_url ?? (xw ? `https://www.courtlistener.com/docket/${xw.cl_docket_id}/` : null),
        ordinal: (caseOrder.indexOf(caseId) + 1) * 1e7 + (idx + 1) * 10,
        item: {id, cells, links, title, badges: ['Docket document', ...(stored ? ['PDF stored'] : []), ...(availability === 'provider_not_downloaded' ? ['File not downloaded by provider'] : [])], subtitle: `${c.title ?? caseId} \u00b7 filed ${d.filing_date ?? 'not recorded'}`},
        detail: {id, title, facts, links, sections: [],
          registry: {schema: 'sw-matter-registry/1', docketbird_case_id: caseId, docket_key: key, mdl, native_case_ids: [{provider: 'docketbird', source_system: 'docketbird-rest', id: caseId}, ...(xw ? [{provider: 'courtlistener', source_system: 'courtlistener', id: xw.cl_docket_id, resolution_basis: 'exact_docket_key_mdls_master_docket'}] : [])]},
          provenance: {source_system: 'docketbird-rest', source_entity_type: 'docket-document', source_native_id: d.id, source_record_sha256: r.provenance.record_sha256, source_response_sha256: r.provenance.source_sha256, retrieved_at: r.provenance.retrieved_at, run_ids: [RUN_ID], projection_schema: SCHEMA,
            pdf: stored ? {registry: 'corpus_matter_pdf_documents_v1', sha256: x.sha256, bytes: x.bytes, verified_at: x.verified_at ?? null, read_api: 'corpus_matter_pdf_object_v1'} : null},
          qualification: 'One document of a DocketBird-tracked case as the provider docket sheet shows it (title as published). Documents that are restricted, of unknown seal or titled with sealed/restricted/in camera/ex parte/redacted wording are not projected. The provider supplies no document category, so the label is not recorded. Not legal advice.'},
        text: [description ?? '', entryNumber ?? '', c.title ?? '', fileName ?? '', mdl ? `MDL ${mdl}` : '', d.filing_date ?? ''].join(' ').replace(/\s+/g, ' ').trim(),
        filters: {_listing: 'true', native_id: d.id, case_id: caseId, court_id: c.court_id ?? '', mdl: mdl ?? '', year, availability, has_pdf: stored ? 'true' : 'false', native_docket_id: xw?.cl_docket_id ?? ''},
      };
      rec.detail.provenance.projected_at = projectedAt;
      rec.detail.provenance.projection_row_sha256 = sha256(canon([rec.id, rec.title, rec.item, rec.detail, rec.filters, rec.text, rec.source_url]));
      rows.push(rec); stats.rows++; caseStats.rows++; stats[availability]++;
    });
  }
  return {rows, stats};
}

const count = (rows, f) => { const c = new Map(); for (const r of rows) { const v = r.filters[f]; if (v !== '' && v != null) c.set(v, (c.get(v) ?? 0) + 1); } return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
export function datasetMetadata(rows, stats) {
  const opt = (f, label = x => x) => count(rows, f).map(([value, n]) => ({value, label: label(value), count: n}));
  return {
    grain: 'One docket-sheet document of a DocketBird-tracked case', aliases: [DS, 'sw-docket-documents'], source_system: 'docketbird-rest', schema_version: SCHEMA, source_runs: [RUN_ID],
    qualification: 'Documents of the cases tracked by the DocketBird account, as the provider docket sheet shows them. Restricted, unknown-seal and sealed/redacted/ex-parte/in-camera-titled documents are counted, not shown. File names are the provider\'s stored object names; PDFs live in the private store and are read through the PDF read API. The provider supplies no document category. Not legal advice.',
    privacy_policy: 'Show as published (owner decision 2026-10-03) excluding sealed, restricted, in camera, ex parte and redacted material. No contact fields. No signed storage links.',
    withheld_counts: {sheet_documents: stats.sheet_documents, not_projected: stats.withheld_no_row, restricted_or_unknown_seal: stats.withheld_restricted_or_unknown, sealed_wording_in_title: stats.withheld_sealed_wording},
    coverage: {rows: stats.rows, stored: stats.stored, provider_not_downloaded: stats.provider_not_downloaded, held_by_registry: stats.held_by_registry, not_stored: stats.not_stored, by_case: stats.by_case},
    listing: {columns: [{key: 'entry_number', label: 'Entry'}, {key: 'date_filed', label: 'Filed'}, {key: 'description', label: 'Description'}, {key: 'file_name', label: 'File name'}, {key: 'availability', label: 'Availability'}, {key: 'case_title', label: 'Case'}],
      filters: [{name: 'case_id', type: 'select', label: 'Case', options: opt('case_id'), placeholder: 'All cases'}, {name: 'mdl', type: 'select', label: 'MDL', options: opt('mdl', v => `MDL ${v}`), placeholder: 'All MDLs'},
        {name: 'year', type: 'select', label: 'Year filed', options: opt('year'), placeholder: 'All years'}, {name: 'availability', type: 'select', label: 'Availability', options: opt('availability', v => AVAILABILITY_LABEL[v] ?? v), placeholder: 'Any'}]},
  };
}

const readJsonl = async f => (await fs.readFile(f, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));

async function registryFor(caseId) {
  const out = []; let off = 0;
  for (;;) { const r = await rpc('corpus_matter_pdf_documents_v1', {p_native_case_ids: [caseId], p_limit: 200, p_offset: off}); out.push(...r.rows); if (r.rows.length < 200) return out; off += 200; }
}

export async function main(argv) {
  const args = Object.fromEntries(argv.map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), 'true'] : [a.slice(2, i), a.slice(i + 1)]; }));
  const dry = args['dry-run'] === 'true';
  const caseRows = await readJsonl(path.join(args.stage, 'docketbird-rest/case.jsonl'));
  const docRows = await readJsonl(path.join(args.stage, 'docketbird-rest/docket-document.jsonl'));
  const registry = {};
  for (const c of new Set(docRows.map(d => d.data.case_id))) registry[c] = await registryFor(c);
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
  const metadata = datasetMetadata(rows, stats);
  console.log(JSON.stringify({dry, ...stats, by_case: undefined}));
  if (dry) return {rows, stats};
  const existing = (await rest(`corpus_datasets?select=id,ready&id=eq.${DS}`)).data[0] ?? null;
  // Rows of THIS dataset that the current rules no longer allow (never rows of any other dataset) are removed after their before-image is saved to the ledger.
  if (existing) {
    await rest(`corpus_datasets?id=eq.${DS}`, {method: 'PATCH', prefer: 'return=minimal', body: {ready: false}});
    const keep = new Set(rows.map(r => r.id)), stale = [];
    for (let off = 0; ; off += 400) { const p = (await rest(`corpus_records?select=*&dataset=eq.${DS}&order=id.asc&limit=400&offset=${off}`)).data; stale.push(...p.filter(r => !keep.has(r.id))); if (p.length < 400) break; }
    if (stale.length) {
      if (!args.ledger) throw new Error('--ledger=<file> is required to remove rows the current rules no longer allow');
      await fs.writeFile(args.ledger, stale.map(r => JSON.stringify({removed_at: projectedAt, before: r})).join('\n') + '\n');
      for (let i = 0; i < stale.length; i += 100) await rest(`corpus_records?dataset=eq.${DS}&id=in.(${stale.slice(i, i + 100).map(r => `"${r.id}"`).map(enc).join(',')})`, {method: 'DELETE', prefer: 'return=minimal'});
      console.log(JSON.stringify({event: 'removed_stale_rows', count: stale.length}));
    }
  }
  await rest('corpus_datasets?on_conflict=id', {method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [{id: DS, label: 'Seeger Weiss matter registry \u2014 documents of tracked dockets', ...(existing ? {} : {ready: false}), expected_records: rows.length, imported_records: 0, updated_at: projectedAt}]});
  for (let i = 0; i < rows.length; i += 150) await rest('corpus_records?on_conflict=dataset,id', {method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: rows.slice(i, i + 150)});
  const back = [];
  for (let off = 0; ; off += 400) { const p = (await rest(`corpus_records?select=id,title,item,detail,filters,ordinal&dataset=eq.${DS}&order=ordinal.asc&limit=400&offset=${off}`)).data; back.push(...p); if (p.length < 400) break; }
  const digest = recs => sha256(canon([...recs].sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id)).map(r => [r.id, r.title, r.item, r.detail, r.filters, r.ordinal])));
  const verified = back.length === rows.length && digest(back) === digest(rows);
  const projection_validation = {projected_records: rows.length, remote_records: back.length, verified, validated_at: new Date().toISOString(), contract_version: SCHEMA, full_fields_sha256: digest(rows), method: 'PostgREST read-back of every projected row (canonical sha256 over id, title, item, detail, filters, ordinal)'};
  await rest(`corpus_datasets?id=eq.${DS}`, {method: 'PATCH', prefer: 'return=minimal', body: {expected_records: back.length, imported_records: back.length, metadata: {...metadata, projection_validation}, updated_at: new Date().toISOString(), ...(verified ? {ready: true} : {})}});
  console.log(JSON.stringify({event: 'synced', dataset: DS, rows: rows.length, remote: back.length, verified, ready: verified}));
  if (!verified) process.exitCode = 2;
  return {rows, stats};
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(e => { console.error(String(e.message ?? e).replace(/sb_secret_[A-Za-z0-9_]+/g, '[redacted]')); process.exitCode = 1; });
