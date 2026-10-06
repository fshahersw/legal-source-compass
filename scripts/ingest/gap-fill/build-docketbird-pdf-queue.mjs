// Builds a `source-qualified-pdf-queue/1` queue (consumed by backfill-pdfs-to-supabase.mjs) from the retained DocketBird REST docket sheets of the
// account's tracked cases. A row is eligible only when the provider states restricted === false AND downloaded === 1 for that document, the document
// is not already stored as a verified PDF, and its title carries no sealed/restricted/in camera/ex parte/redacted wording. The presigned S3 URL comes
// from the private raw archive and lives only in this private queue; it is never written to ingest rows, the repository or the report.
//   node build-docketbird-pdf-queue.mjs <rawCacheDir> <registry-docs.json> <outQueue.jsonl>
import fs from 'node:fs/promises';
import path from 'node:path';
import {sha256, isDisplayWithheld} from './lib.mjs';

export function buildQueue({observations, rawBytes, storedIds, now = Date.now()}) {
  const latest = new Map();
  for (const o of observations) {
    const m = o.source_url.match(/\/documents\?case_id=(.+)$/);
    if (!m || o.http_status !== 200) continue;
    const caseId = decodeURIComponent(m[1]);
    if (!latest.has(caseId) || latest.get(caseId).retrieved_at < o.retrieved_at) latest.set(caseId, o);
  }
  const rows = [], stats = {cases: latest.size, documents: 0, queued: 0, already_stored: 0, restricted_or_unknown: 0, not_downloaded: 0, title_withheld: 0, no_url: 0, expired_url: 0};
  for (const [caseId, o] of latest) {
    const body = JSON.parse(rawBytes(o.source_sha256).toString('utf8'));
    for (const doc of body.data?.documents ?? []) {
      stats.documents++;
      if (storedIds.has(doc.id)) { stats.already_stored++; continue; }
      if (doc.restricted !== false) { stats.restricted_or_unknown++; continue; }
      if (doc.downloaded !== 1) { stats.not_downloaded++; continue; }
      if (isDisplayWithheld({restricted: doc.restricted, text: doc.title})) { stats.title_withheld++; continue; }
      if (!doc.docketbird_document_url) { stats.no_url++; continue; }
      const exp = Number(new URL(doc.docketbird_document_url).searchParams.get('Expires'));
      if (!Number.isFinite(exp) || exp * 1000 < now + 3600_000) { stats.expired_url++; continue; }
      const recordSha = sha256(JSON.stringify(doc));
      rows.push({schema_version: 'source-qualified-pdf-queue/1', provider: 'docketbird', native_document_id: doc.id, native_case_id: caseId, eligible: true,
        download_url: doc.docketbird_document_url, durable_url: null, expected_sha1: null, expected_bytes: null,
        provider_flags: {restricted: false, downloaded: 1},
        selected_source_record_sha256: recordSha,
        origins: [{native_case_id: caseId, native_record_sha256: recordSha, native_record_hash_codec: 'json-stringify-of-docketbird-rest-document/1', source_tool: 'GET /documents', source_url: o.source_url.split('?')[0],
          source_response_sha256: o.source_sha256, retrieved_at: o.retrieved_at, parent_qualification: 'account-tracked case; document row from the provider docket sheet with explicit restricted=false, downloaded=1'}]});
      stats.queued++;
    }
  }
  return {rows, stats};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cacheDir, registryFile, outFile] = process.argv.slice(2);
  const observations = (await fs.readFile(path.join(cacheDir, 'observations.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
  const reg = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  const storedIds = new Set(Object.values(reg).flat().filter(x => x.sha256).map(x => x.native_document_id));
  const cache = new Map();
  const files = new Map();
  for (const o of observations) files.set(o.source_sha256, path.join(cacheDir, 'raw', `${o.source_sha256}.bin`));
  const loaded = new Map();
  for (const [h, f] of files) { const b = await fs.readFile(f); if (sha256(b) !== h) throw new Error('RAW_HASH_MISMATCH ' + h); loaded.set(h, b); }
  const {rows, stats} = buildQueue({observations, rawBytes: h => loaded.get(h), storedIds});
  const text = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  await fs.writeFile(outFile, text, {mode: 0o600});
  console.log(JSON.stringify({...stats, queue_sha256: sha256(Buffer.from(text))}));
}
