// Plan (read-only, no source requests): how many RECAP documents of the registry master dockets are freely downloadable vs PACER-only vs sealed,
// how many are already stored (by native document id or by SHA-1 of an already verified object), and the download volume.
// Source: the lake's CourtListener `docket-entries` rows (with nested `recap_documents`) read through corpus_sw_registry_read_v1, the private
// PDF dedup index (`corpus_admin_pdf_dedup_index_v1`) and the registry itself. A document is "free" only when is_available === true AND is_sealed is false/null
// is NOT enough: unknown seal (null) is counted separately and never queued.
//   node plan-recap-pdfs.mjs <outDir>
import fs from 'node:fs/promises';
import path from 'node:path';
import {rpc, rest} from '../members-pgrest.mjs';

export function classify(doc) {
  if (doc.is_sealed === true) return 'sealed';
  if (doc.is_available === true && doc.is_sealed === false && doc.filepath_local) return 'free';
  if (doc.is_available === true && doc.is_sealed === null) return 'available_unknown_seal';
  if (doc.is_available === true) return 'available_no_path';
  return 'pacer_only';
}

export function summarize(rows, storedIds, storedSha1) {
  const blank = () => ({documents: 0, total_bytes: 0, already_stored_by_id: 0, already_stored_by_sha1: 0, to_download: 0, to_download_bytes: 0, unknown_size: 0});
  const s = {entries: 0, documents: 0, by_class: {}, tier_free_explicit_not_sealed: blank(), tier_available_unknown_seal_private_quarantine: blank()};
  const todo = [];
  for (const r of rows) {
    s.entries++;
    for (const d of r.data.recap_documents ?? []) {
      s.documents++;
      const k = classify(d); s.by_class[k] = (s.by_class[k] ?? 0) + 1;
      const tier = k === 'free' ? s.tier_free_explicit_not_sealed : k === 'available_unknown_seal' && d.filepath_local ? s.tier_available_unknown_seal_private_quarantine : null;
      if (!tier) continue;
      const bytes = Number.isSafeInteger(d.file_size) ? d.file_size : null;
      tier.documents++; if (bytes === null) tier.unknown_size++; else tier.total_bytes += bytes;
      if (storedIds.has(String(d.id))) { tier.already_stored_by_id++; continue; }
      if (d.sha1 && storedSha1.has(d.sha1)) { tier.already_stored_by_sha1++; continue; }
      tier.to_download++; if (bytes) tier.to_download_bytes += bytes;
      todo.push({tier: k, native_document_id: String(d.id), entry_id: String(r.native_id), docket_id: (r.data.docket ?? '').match(/\/dockets\/(\d+)\//)?.[1] ?? null, filepath_local: d.filepath_local, sha1: d.sha1 || null, bytes, page_count: d.page_count ?? null, is_sealed: d.is_sealed ?? null});
    }
  }
  return {stats: s, todo};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2];
  await fs.mkdir(outDir, {recursive: true});
  // master dockets whose entries the registry projects
  const dockets = new Set();
  for (let off = 0; ; off += 1000) {
    const p = (await rest(`corpus_records?select=d:item->cells->>native_docket_id&dataset=eq.sw_docket_entries_v1&order=id.asc&limit=1000&offset=${off}`)).data;
    for (const x of p) if (x.d) dockets.add(x.d);
    if (p.length < 1000) break;
  }
  const storedIds = new Set(), storedSha1 = new Set();
  for (let after = ''; ;) { const r = await rpc('corpus_admin_pdf_dedup_index_v1', {p_kind: 'assets', p_after: after, p_limit: 10000}); for (const x of r.rows) if (x.source_system === 'courtlistener') storedIds.add(String(x.native_document_id)); if (!r.rows.length || !r.last) break; after = r.last; }
  for (let after = ''; ;) { const r = await rpc('corpus_admin_pdf_dedup_index_v1', {p_kind: 'objects', p_after: after, p_limit: 10000}); for (const x of r.rows) if (x.sha1) storedSha1.add(x.sha1); if (!r.rows.length || !r.last) break; after = r.last; }
  const rows = [];
  let after = null;
  for (;;) {
    const r = await rpc('corpus_sw_registry_read_v1', {p_kind: 'docket-entries', p_docket_ids: [...dockets], p_after: after, p_limit: 500});
    rows.push(...r.rows.map(x => ({native_id: x.native_id, data: {docket: x.data.docket, recap_documents: (x.data.recap_documents ?? []).map(d => ({id: d.id, is_available: d.is_available, is_sealed: d.is_sealed, filepath_local: d.filepath_local, file_size: d.file_size, sha1: d.sha1, page_count: d.page_count}))}})));
    if (!r.next) break; after = r.next;
  }
  const {stats, todo} = summarize(rows, storedIds, storedSha1);
  stats.master_dockets = dockets.size; stats.stored_courtlistener_assets = storedIds.size; stats.stored_objects_sha1 = storedSha1.size; stats.measured_at = new Date().toISOString();
  await fs.writeFile(path.join(outDir, 'recap-plan-stats.json'), JSON.stringify(stats, null, 2));
  await fs.writeFile(path.join(outDir, 'recap-download-candidates.jsonl'), todo.map(x => JSON.stringify(x)).join('\n') + '\n');
  console.log(JSON.stringify(stats, null, 2));
}
