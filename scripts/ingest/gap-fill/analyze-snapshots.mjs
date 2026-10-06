// Exact gap counts over the verified protected snapshot bundles (the release the application serves).
// This measures the SNAPSHOT, not the live corpus; gap-analysis-live.mjs measures the live read model.
// A value is a gap only when it is null, absent, or an empty/whitespace string. Legitimately conditional
// fields (date_terminated on a non-terminated matter) are reported separately and never counted as gaps.
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadManifest, ensureSnapshot} from './fetch-snapshots.mjs';

export const isBlank = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** Count blanks per field. `when` restricts the denominator to rows where the field is expected. */
export function gapTable(rows, fields) {
  return fields.map(({field, label = field, when = () => true, get = r => r[field]}) => {
    const scope = rows.filter(when);
    const missing = scope.filter(r => isBlank(get(r))).length;
    return {field: label, rows_in_scope: scope.length, missing, populated: scope.length - missing,
      pct_missing: scope.length ? Number((100 * missing / scope.length).toFixed(2)) : null};
  });
}

const jsonl = buf => buf.toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

export function analyze({matters, parties, attorneys, outcomes, registryDocs, mdlDocs}) {
  const out = {};
  out.matters = {rows: matters.length, by_status: Object.fromEntries([...matters.reduce((m, r) => m.set(r.case_status ?? 'null', (m.get(r.case_status ?? 'null') ?? 0) + 1), new Map())]),
    gaps: gapTable(matters, [
      {field: 'case_name'}, {field: 'court_id'}, {field: 'docket_number'}, {field: 'date_filed'},
      {field: 'case_status', label: 'status'},
      {field: 'date_terminated', when: r => r.case_status === 'terminated'},
    ]),
    open_without_termination_not_a_gap: matters.filter(r => r.case_status !== 'terminated' && isBlank(r.date_terminated)).length};
  out.parties = {rows: parties.length, gaps: gapTable(parties, [{field: 'name'}, {field: 'party_types', label: 'label (party_types)'}])};
  out.attorneys = {rows: attorneys.length, gaps: gapTable(attorneys, [{field: 'name'}])};
  out.outcomes = {rows: outcomes.length, gaps: gapTable(outcomes, [{field: 'date_terminated'}, {field: 'outcome_type'}, {field: 'evidence_level'}])};
  out.registry_documents = {rows: registryDocs.length, gaps: gapTable(registryDocs, [
    {field: 'description'}, {field: 'byte_count', label: 'byte_count (size)'}, {field: 'sha256'}, {field: 's3_key', label: 's3_key (stored object)'},
    {field: 'docket_entry_id', label: 'docket_entry_id (link)'}, {field: 'verification_status'},
  ]), file_name_field_exists: false, filing_date_field_exists: false};
  const docs = mdlDocs;
  const uidCounts = new Map();
  for (const d of docs) uidCounts.set(d.doc_uid, (uidCounts.get(d.doc_uid) ?? 0) + 1);
  out.mdl_documents = {rows: docs.length, distinct_doc_uid: uidCounts.size,
    doc_uid_not_a_unique_key: 'doc_uid repeats where attachment numbers are absent; every row is counted, none collapsed', gaps: gapTable(docs, [
    {field: 'entry_date_filed', label: 'filing date'}, {field: 'entry_description'}, {field: 'document_number'},
    {field: 'document_description'}, {field: 'doc_category', label: 'label (doc_category)'},
    {field: 'page_count'}, {field: 'file_size'}, {field: 'pacer_doc_id', label: 'pacer_doc_id (native)'},
    {field: 'courtlistener_url'}, {field: 'sha1'}, {field: 'download_url', label: 'download_url (public)'},
    {field: 'is_sealed', label: 'seal flag'}, {field: 'is_available', label: 'availability flag'},
  ]), availability: {available: docs.filter(d => d.is_available === true).length, unavailable: docs.filter(d => d.is_available === false).length, unknown: docs.filter(d => d.is_available == null).length},
  file_name_field_exists: false};
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [origin, cacheDir, outFile] = process.argv.slice(2);
  if (!origin || !cacheDir) { console.error('usage: analyze-snapshots.mjs <origin> <cacheDir> [outFile]'); process.exit(2); }
  const files = await loadManifest();
  const get = n => ensureSnapshot(origin, cacheDir, n, files);
  const regDocs = [], mdlDocs = [];
  for (const n of Object.keys(files).filter(n => n.startsWith('matter-registry/docs/'))) regDocs.push(...JSON.parse((await get(n)).toString('utf8')));
  for (const n of Object.keys(files).filter(n => /^mdl-documents\/mdl-[a-z0-9]+\.json$/.test(n))) mdlDocs.push(...JSON.parse((await get(n)).toString('utf8')));
  const result = {basis: 'protected snapshot bundles verified against manifest.server.json', measured_at: new Date().toISOString(),
    ...analyze({matters: jsonl(await get('matter-registry/matters.jsonl')), parties: jsonl(await get('matter-registry/parties.jsonl')),
      attorneys: jsonl(await get('matter-registry/attorneys.jsonl')), outcomes: jsonl(await get('matter-registry/outcomes.jsonl')), registryDocs: regDocs, mdlDocs})};
  const text = JSON.stringify(result, null, 2);
  if (outFile) { await fs.mkdir(path.dirname(outFile), {recursive: true}); await fs.writeFile(outFile, text); }
  console.log(text);
}
