// Builds pdf-backfill queue additions (rows in the existing 'source-qualified-pdf-queue/1' shape, provider 'courtlistener')
// from CourtListener REST docket-entry observations. No PDF bytes are requested here; the pdf-backfill agent freezes/transfers them.
//
// Usage:
//   node scripts/ingest/members-pdf-queue.mjs --out=<file.jsonl> --dockets=65407433,6240169 --passes=<dir>,<dir> [--filter=cto|all] [--note=text]
//
// Eligibility: recap_document.is_available === true, a non-empty filepath_local, is_sealed !== true.
// Rows already present in any frozen queue (courtlistener-pdf-batches/*.queue.jsonl, docketbird-*), or in other
// pdf-queue-additions files, are skipped (by download URL / native document id).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { validateQueueRow, sourcePrivacyQualification } from './backfill-pdfs-to-supabase.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
const sha = x => createHash('sha256').update(x).digest('hex');
const dockets = new Set((args.dockets ?? '').split(',').filter(Boolean));
const passes = (args.passes ?? '').split(',').filter(Boolean).map(p => path.resolve(p));
const filter = args.filter ?? 'all';
const out = path.resolve(args.out ?? '');
if (!dockets.size || !passes.length || !args.out) throw new Error('--dockets, --passes and --out are required');
const CTO = /(conditional transfer order|\bCTO\b|tag-?along|transfer order|order denying transfer|order vacating|schedule a)/i;

// known URLs
const known = new Set();
async function scanQueue(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.download_url) known.add(r.download_url); if (r.durable_url) known.add(r.durable_url); } catch { /* skip */ }
  }
}
const pdfFocus = 'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/pdf-focus-20261002';
for (const d of ['courtlistener-pdf-batches', 'docketbird-pdf-batches']) {
  const dir = path.join(pdfFocus, d);
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.queue.jsonl')) await scanQueue(path.join(dir, f));
}
const additions = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/contracts/pdf-queue-additions';
if (fs.existsSync(additions)) for (const f of fs.readdirSync(additions)) if (f.endsWith('.jsonl') && !f.startsWith('_') && path.resolve(additions, f) !== out) await scanQueue(path.join(additions, f));
// pdf-backfill's own frozen queues (q-series CourtListener public locators, a-/z- addition queues) and its stored index
const pb = 'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-03/pdf-backfill-20261003';
for (const d of ['courtlistener-pdf-batches', 'docketbird-pdf-batches', 'additions-pdf-batches']) {
  const dir = path.join(pb, d);
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.queue.jsonl')) await scanQueue(path.join(dir, f));
}
const storedIds = new Set();
const storedFile = path.join(additions, '_stored.jsonl');
if (fs.existsSync(storedFile)) for (const l of fs.readFileSync(storedFile, 'utf8').split('\n')) { if (!l.trim()) continue; try { const r = JSON.parse(l); storedIds.add(`${r.provider}:${r.native_case_id}:${r.native_document_id}`); } catch { /* skip */ } }

// registered assets known by URL (exported once by the caller, optional)
if (args['known-urls'] && fs.existsSync(args['known-urls'])) for (const l of fs.readFileSync(args['known-urls'], 'utf8').split('\n')) if (l.trim()) known.add(l.trim());

const captureIndex = new Map();
function captureFile(sourceUrl) {
  const key = sha(`GET ${sourceUrl}`);
  if (captureIndex.has(key)) return captureIndex.get(key);
  for (const p of passes) {
    const f = path.join(p, 'api', `${key}.json`);
    if (fs.existsSync(f)) { const r = { file: f, sha256: sha(fs.readFileSync(f)) }; captureIndex.set(key, r); return r; }
  }
  captureIndex.set(key, null); return null;
}

const rows = []; const seenDocs = new Set();
const stats = { entries_scanned: 0, entries_matched: 0, docs_seen: 0, docs_unavailable: 0, docs_sealed: 0, docs_known_skipped: 0, docs_missing_path: 0, rows: 0, origin_capture_missing: 0 };
for (const p of passes) {
  const file = path.join(p, 'live-normalized', 'docket-entries.jsonl');
  if (!fs.existsSync(file)) continue;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    const docketId = entry.data.docket?.match(/dockets\/(\d+)\//)?.[1];
    if (!docketId || !dockets.has(docketId)) continue;
    stats.entries_scanned++;
    if (filter === 'cto' && !CTO.test(entry.data.description ?? '')) continue;
    stats.entries_matched++;
    for (const doc of entry.data.recap_documents ?? []) {
      stats.docs_seen++;
      if (seenDocs.has(doc.id)) continue;
      if (doc.is_available !== true) { stats.docs_unavailable++; continue; }
      if (doc.is_sealed === true) { stats.docs_sealed++; continue; }
      if (!doc.filepath_local) { stats.docs_missing_path++; continue; }
      const url = `https://storage.courtlistener.com/${doc.filepath_local}`;
      if (known.has(url) || storedIds.has(`courtlistener:${docketId}:${doc.id}`)) { stats.docs_known_skipped++; continue; }
      seenDocs.add(doc.id);
      const docData = { ...doc, docket_entry_id: entry.data.id, docket_id: Number(docketId) };
      const recordSha = sha(JSON.stringify(docData));
      const cap = captureFile(entry.provenance.source_url);
      if (!cap) stats.origin_capture_missing++;
      const expectedSha1 = /^[a-f0-9]{40}$/.test(doc.sha1 ?? '') ? doc.sha1 : null;
      const expectedBytes = Number.isSafeInteger(doc.file_size) && doc.file_size > 0 ? doc.file_size : null;
      const row = {
        schema_version: 'source-qualified-pdf-queue/1', provider: 'courtlistener',
        native_document_id: String(doc.id), native_case_id: docketId,
        durable_url: doc.absolute_url ? `https://www.courtlistener.com${doc.absolute_url}` : `https://www.courtlistener.com/docket/${docketId}/`,
        download_url: url, expected_sha1: expectedSha1, expected_bytes: expectedBytes,
        title: null, filing_date: entry.data.date_filed ?? null,
        selected_source_record_sha256: recordSha,
        provider_flags: { is_available: true, is_sealed: doc.is_sealed ?? null },
        eligible: true, held_reason: null, seal_status_unknown: (doc.is_sealed ?? null) === null,
        scope_evidence: [{ kind: 'sw_matter_registry_priority', filter, docket_id: docketId, entry_number: entry.data.entry_number ?? null, note: args.note ?? 'Matter-registry evidence document (CTO schedule / master docket order)', firm_appearance_certified: false }],
        origins: [{ capture_file: cap?.file ?? null, capture_file_sha256: cap?.sha256 ?? entry.provenance.source_sha256, native_case_id: docketId, native_record_sha256: recordSha,
          retrieved_at: entry.provenance.retrieved_at, source_url: entry.provenance.source_url, source_sha256: entry.provenance.source_sha256, source_response_sha256: entry.provenance.source_sha256,
          is_available: true, is_sealed: doc.is_sealed ?? null, expected_sha1: expectedSha1, expected_bytes: expectedBytes, source_entry_native_id: String(entry.data.id) }],
        provenance: { adapter_version: 'sw-matter-registry-pdf-queue/1', metadata_only_adapter: true, pdf_transfers: 0, source_entity_type: 'docket-entries', source_native_id: String(entry.data.id), record_hash_codec: 'sha256(JSON.stringify({...recap_document, docket_entry_id, docket_id}))' },
      };
      row.source_privacy_qualification = sourcePrivacyQualification(row);
      validateQueueRow(row);
      rows.push(row); stats.rows++;
    }
  }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
if (args.map) {
  // --map=docketId:mdl,... : one output file per matter (name pattern in --out with {mdl}); one scan of the frozen queues serves all
  const toMdl = new Map(args.map.split(',').map(s => s.split(':')));
  const grouped = new Map();
  for (const r of rows) { const mdl = toMdl.get(r.native_case_id) ?? 'unmapped'; grouped.set(mdl, [...(grouped.get(mdl) ?? []), r]); }
  const results = [];
  for (const [mdl, list] of grouped) {
    const file = out.replace('{mdl}', mdl);
    if (!list.length) continue;
    const body = list.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(file, body);
    const manifest = { file, rows: list.length, bytes: Buffer.byteLength(body), sha256: sha(body), filter, dockets: [...new Set(list.map(r => r.native_case_id))], stats, created_at: new Date().toISOString(), schema_version: 'source-qualified-pdf-queue/1' };
    fs.writeFileSync(file + '.manifest.json', JSON.stringify(manifest, null, 1));
    results.push({ mdl, rows: list.length, file: path.basename(file) });
  }
  console.log(JSON.stringify({ event: 'multi', stats, results }));
} else {
  const body = rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(out, body);
  const manifest = { file: out, rows: rows.length, bytes: Buffer.byteLength(body), sha256: sha(body), filter, dockets: [...dockets], passes, stats, created_at: new Date().toISOString(), schema_version: 'source-qualified-pdf-queue/1' };
  fs.writeFileSync(out + '.manifest.json', JSON.stringify(manifest, null, 1));
  console.log(JSON.stringify(manifest));
}
