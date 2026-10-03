import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateQueueRow } from './backfill-pdfs-to-supabase.mjs';
const base = 'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02';
const root = path.join(base, 'pdf-focus-20261002');
const sha = value => createHash('sha256').update(value).digest('hex');
const matches = new Map();
for (const n of [1, 2]) {
  const file = path.join(root, `docketbird/search-recent-${n}.json`), bytes = fs.readFileSync(file), capture = JSON.parse(bytes);
  for (const row of capture.result.documents) matches.set(row.document_id, { row, source_file: file, source_sha256: sha(bytes), retrieved_at: capture.retrieved_at });
}
const documents = new Map(), held = [];
for (const name of fs.readdirSync(path.join(root, 'docketbird')).filter(n => /^(recent-detail-\d+|att-final-approval|dupixent-sheet)\.json$/.test(n))) {
  const file = path.join(root, 'docketbird', name), bytes = fs.readFileSync(file), capture = JSON.parse(bytes);
  for (const doc of capture.result.documents ?? [capture.result.document].filter(Boolean)) {
    const match = matches.get(doc.id), caseId = capture.arguments.case_id ?? match?.row.case_id;
    if (!caseId) { held.push({ document_id: doc.id, reason: 'No source-qualified parent case' }); continue; }
    const origin = { capture_file: file, capture_file_sha256: sha(bytes), source_response_sha256: sha(JSON.stringify(capture.result)),
      retrieved_at: capture.retrieved_at, native_case_id: caseId, native_record_sha256: sha(JSON.stringify(doc)) };
    const scope = match ? { kind: 'publisher_full_text_firm_match', query: '"Seeger Weiss"', ...match, firm_appearance_certified: false }
      : { kind: 'native_parent_of_firm_matched_document', case_id: caseId, firm_appearance_certified: false };
    // Expiring PDF URLs stay in private source captures and the transfer queue.
    if (scope.row) { scope.row = { ...scope.row }; delete scope.row.pdf_url; }
    const row = { schema_version: 'source-qualified-pdf-queue/1', provider: 'docketbird', native_document_id: doc.id, native_case_id: caseId,
      durable_url: doc.canonical_url ?? null, download_url: doc.pdf_url ?? null, expected_sha1: null, expected_bytes: null,
      title: doc.title ?? null, filing_date: doc.filing_date ?? null, selected_source_record_sha256: origin.native_record_sha256,
      provider_flags: { restricted: doc.restricted, downloaded: doc.downloaded }, eligible: doc.restricted === false && [1, true].includes(doc.downloaded) && !!doc.pdf_url,
      origins: [origin], scope_evidence: [scope] };
    if (!row.eligible) { held.push({ document_id: doc.id, native_case_id: caseId, reason: doc.restricted ? 'Publisher restricted' : 'Publisher PDF unavailable' }); continue; }
    try { validateQueueRow(row); } catch (error) { held.push({ document_id: doc.id, native_case_id: caseId, reason: error.message }); continue; }
    const prior = documents.get(doc.id); if (prior) prior.origins.push(origin); else documents.set(doc.id, row);
  }
}
const previouslyVerified = new Set();
for (const dir of ['pdf-library-v1/transfers', 'pdf-library-tail-v1/transfers', 'pdf-library-recent-v1/transfers', 'pdf-library-gap-retry-v1/transfers']) {
  const file = path.join(base, dir, 'transfer-receipts.jsonl'); if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line); if (r.state === 'cloud_verified' && r.provider === 'docketbird') previouslyVerified.add(r.native_document_id);
  }
}
const stateOnly = process.argv.includes('--state-only');
const rows = [...documents.values()].filter(r => !previouslyVerified.has(r.native_document_id) && (!stateOnly || r.native_case_id.startsWith('c-')));
const queue = Buffer.from(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const file = path.join(root, stateOnly ? 'docketbird-state-queue.jsonl' : 'docketbird-recent-queue.jsonl');
fs.writeFileSync(file, queue, { flag: 'wx' });
const manifest = { created_at: new Date().toISOString(), queue: file, sha256: sha(queue), queued: rows.length,
  held, already_verified: documents.size - rows.length, courtlistener_api_requests: 0, public_projection_allowed: false };
fs.writeFileSync(path.join(root, stateOnly ? 'docketbird-state-queue-manifest.json' : 'docketbird-recent-queue-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...manifest, held: held.length }));
