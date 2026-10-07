// Source-qualified PDF queue (`source-qualified-pdf-queue/1`, consumed by backfill-pdfs-to-supabase.mjs) for RECAP documents of the registry master dockets.
// Input: recap-download-candidates.jsonl from plan-recap-pdfs.mjs. A document is queued only when CourtListener serves it from its own storage
// (is_available true with a storage path; no API quota is used) and is not explicitly sealed. Tier `free` has is_sealed === false; tier
// `available_unknown_seal` has is_sealed null and is private quarantine only (never projected publicly), as authorised on 2026-10-02.
//   node build-recap-pdf-queue.mjs <candidates.jsonl> <tier> <outQueue.jsonl> [--limit=N]
import fs from 'node:fs/promises';
import {rpc} from '../members-pgrest.mjs';
import {sha256} from './lib.mjs';

export const STORAGE_HOST = 'https://storage.courtlistener.com/';
export function queueRow(c, prov) {
  if (!/^recap\/.+\.pdf$/i.test(c.filepath_local ?? '')) throw new Error('RECAP_PATH_INVALID');
  if (c.is_sealed === true) throw new Error('SEALED_NOT_QUEUED');
  const url = STORAGE_HOST + c.filepath_local.split('/').map(encodeURIComponent).join('/');
  return {schema_version: 'source-qualified-pdf-queue/1', provider: 'courtlistener', native_document_id: c.native_document_id, native_case_id: c.docket_id, eligible: true,
    download_url: url, durable_url: url, expected_sha1: /^[a-f0-9]{40}$/.test(c.sha1 ?? '') ? c.sha1 : null, expected_bytes: Number.isSafeInteger(c.bytes) && c.bytes > 0 ? c.bytes : null,
    provider_flags: {is_available: true, is_sealed: c.is_sealed ?? null}, selected_source_record_sha256: prov.payload_sha256,
    origins: [{native_case_id: c.docket_id, native_record_sha256: prov.payload_sha256, native_record_hash_codec: 'corpus-ingest-entity-payload-sha256/1', source_tool: 'courtlistener docket-entries', source_entry_id: c.entry_id,
      source_url: prov.source_url, source_response_sha256: prov.source_sha256, retrieved_at: prov.retrieved_at, source_document_id: c.native_document_id}]};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [candFile, tier, outFile, ...rest] = process.argv.slice(2);
  const limit = Number((rest.find(a => a.startsWith('--limit=')) ?? '--limit=0').slice(8)) || Infinity;
  const tierName = {free: 'free', unknown: 'available_unknown_seal'}[tier]; if (!tierName) throw new Error('tier must be free or unknown');
  const cands = (await fs.readFile(candFile, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.tier === tierName).slice(0, limit);
  const prov = new Map();
  const entries = [...new Set(cands.map(c => c.entry_id))];
  for (let i = 0; i < entries.length; i += 500) for (const p of await rpc('corpus_gapfill_lake_entry_provenance_v1', {p_native_ids: entries.slice(i, i + 500)})) prov.set(p.native_id, p);
  const rows = [], stats = {candidates: cands.length, queued: 0, no_provenance: 0, bad_path: 0};
  for (const c of cands) {
    const p = prov.get(c.entry_id);
    if (!p || !/^[0-9a-f]{64}$/.test(p.source_sha256 ?? '') || p.http_status !== '200') { stats.no_provenance++; continue; }
    try { rows.push(queueRow(c, p)); stats.queued++; } catch { stats.bad_path++; }
  }
  const text = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  await fs.writeFile(outFile, text);
  console.log(JSON.stringify({...stats, tier: tierName, queue_sha256: sha256(Buffer.from(text))}));
}
