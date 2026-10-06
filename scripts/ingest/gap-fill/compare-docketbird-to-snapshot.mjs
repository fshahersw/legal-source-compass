// Field-level comparison of staged DocketBird docket sheets with the verified snapshot's MDL document rows.
// Join: exact provider-neutral docket key (court + office + year + type + sequence) of the master docket, then exact
// entry number == DocketBird docket-sheet number. Descriptions are not compared: attachments share an entry's sheet number,
// so a row-level text join would be unsound. Nothing is applied; conflicts and fillable blanks are only counted.
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadManifest, ensureSnapshot} from './fetch-snapshots.mjs';
import {docketKey, docketKeyFromDocketBirdId, isBlank, decideField} from './lib.mjs';

export function compare(bundleRows, dbDocs) {
  const byEntry = new Map();
  for (const r of bundleRows) { const k = r.entry_number; if (k == null) continue; (byEntry.get(k) ?? byEntry.set(k, []).get(k)).push(r); }
  const dbByNum = new Map();
  for (const d of dbDocs) if (d.docket_sheet_number != null) (dbByNum.get(d.docket_sheet_number) ?? dbByNum.set(d.docket_sheet_number, []).get(d.docket_sheet_number)).push(d);
  const out = {bundle_rows: bundleRows.length, bundle_entries: byEntry.size, docketbird_documents: dbDocs.length, docketbird_sheet_numbers: dbByNum.size,
    entries_in_both: 0, entries_only_in_docketbird: 0, entries_only_in_bundle: 0, filing_date: {confirm: 0, conflict: 0, fill: 0}, filing_date_conflict_direction: {snapshot_later: 0, snapshot_earlier: 0}, conflict_samples: [], conflicts: []};
  for (const n of dbByNum.keys()) byEntry.has(n) ? out.entries_in_both++ : out.entries_only_in_docketbird++;
  for (const n of byEntry.keys()) if (!dbByNum.has(n)) out.entries_only_in_bundle++;
  for (const [n, rows] of byEntry) {
    const dbs = dbByNum.get(n); if (!dbs) continue;
    for (const r of rows) {
      const dd = decideField({field: 'filing_date', existing: {value: r.entry_date_filed, source: 'courtlistener'}, incoming: {value: dbs[0].filing_date, source: 'docketbird'}});
      if (dd.action in out.filing_date) out.filing_date[dd.action]++;
      if (dd.action === 'conflict') out.filing_date_conflict_direction[r.entry_date_filed > dbs[0].filing_date ? 'snapshot_later' : 'snapshot_earlier']++;
      if (dd.action === 'conflict') out.conflicts.push({entity: 'docket-document', entry_number: n, field: 'filing_date', existing: dd.existing, incoming: dd.incoming, proposed_supersede: dd.proposed_supersede, applied: false, snapshot_doc_uid: r.doc_uid});
      if (dd.action === 'conflict' && out.conflict_samples.length < 5) out.conflict_samples.push({entry: n, field: 'filing_date', existing: r.entry_date_filed, incoming: dbs[0].filing_date});
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [origin, cacheDir, stageDir, outFile] = process.argv.slice(2);
  const files = await loadManifest();
  const bundle = [];
  for (const n of Object.keys(files).filter(n => /^mdl-documents\/mdl-[a-z0-9]+\.json$/.test(n))) bundle.push(...JSON.parse((await ensureSnapshot(origin, cacheDir, n, files)).toString('utf8')));
  const masters = new Map();
  for (const r of bundle) { const k = docketKey(r.court, r.docket_number); if (k) (masters.get(k) ?? masters.set(k, []).get(k)).push(r); }
  const dbDocs = (await fs.readFile(path.join(stageDir, 'docketbird-rest/docket-document.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l).data);
  const byCase = new Map();
  for (const d of dbDocs) (byCase.get(d.case_id) ?? byCase.set(d.case_id, []).get(d.case_id)).push(d);
  const result = {basis: 'staged DocketBird REST vs verified snapshot mdl-documents', cases: {}};
  for (const [caseId, docs] of byCase) {
    const key = docketKeyFromDocketBirdId(caseId);
    result.cases[caseId] = key && masters.has(key) ? {docket_key: key, ...compare(masters.get(key), docs)} : {docket_key: key, snapshot_master_found: false, docketbird_documents: docs.length};
  }
  const lines = [];
  for (const [caseId, c] of Object.entries(result.cases)) { for (const x of c.conflicts ?? []) lines.push(JSON.stringify({docketbird_case_id: caseId, ...x})); delete c.conflicts; }
  await fs.appendFile(path.join(stageDir, 'conflicts.jsonl'), lines.map(l => l + '\n').join(''));
  const text = JSON.stringify(result, null, 2);
  if (outFile) await fs.writeFile(outFile, text);
  console.log(text);
}
