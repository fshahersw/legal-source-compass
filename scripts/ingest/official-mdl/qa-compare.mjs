// Cross-checks every stored official-court PDF of a batch against (a) the court listing row it came from and (b) what the court printed ON the PDF (ECF stamp).
//   node scripts/ingest/official-mdl/qa-compare.mjs --label=b001-njd,... [--run-dir=<dir>]
// Output: <run>/qa-report.json (mismatches listed) and <run>/documents.jsonl (one enriched document row per PDF, append-only per label set).
import fs from 'node:fs';
import path from 'node:path';
import { resolveRunDir, parseArgs, readJsonl } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args['run-dir']);
const labels = String(args.label ?? '').split(',').map(x => x.trim()).filter(Boolean);
const peeks = new Map(readJsonl(path.join(runDir, 'pdf-peek.jsonl')).map(p => [p.sha256, p]));
const verify = new Map(readJsonl(path.join(runDir, 'verify-objects.jsonl')).filter(v => v.match).map(v => [v.native_document_id, v]));
const normCase = s => String(s ?? '').replace(/-[A-Za-z]{1,5}(?:-[A-Za-z]{1,5})*$/, '').replace(/^(\d+:\d{2})-?([a-z]{2})-?0*(\d+)$/i, (_, a, t, n) => `${a}-${t.toLowerCase()}-${Number(n)}`);
const report = { schema_version: 'official-mdl-qa/1', at: new Date().toISOString(), labels, documents: 0, stamp_found: 0, no_text: [], case_mismatch: [], date_mismatch: [], doc_number_mismatch: [], no_stamp: [], by_case: {} };
const docs = [];
for (const label of labels) {
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'queues', label + '.queue.jsonl.manifest.json'), 'utf8'));
  const rows = fs.readFileSync(manifest.queue, 'utf8').trim().split('\n').map(x => JSON.parse(x));
  const receipts = new Map(readJsonl(path.join(runDir, 'transfers', label, 'transfer-receipts.jsonl')).filter(r => r.state === 'cloud_verified' || r.state === 'dedup_matched').map(r => [r.native_document_id, r]));
  for (const row of rows) {
    const receipt = receipts.get(row.native_document_id), v = verify.get(row.native_document_id);
    const listing = row.origins.map(o => o.listing).sort((a, b) => (b.date_iso ? 1 : 0) - (a.date_iso ? 1 : 0))[0];
    const peek = receipt ? peeks.get(receipt.sha256) : null;
    const stamp = peek?.stamp ?? null;
    const doc = { label, mdl: row.provenance.matter.replace('mdl:', ''), url: row.native_document_id, native_case_id: row.native_case_id, sha256: receipt?.sha256 ?? null, bytes: receipt?.bytes ?? null, storage_key: receipt?.storage_key ?? null, object_origin: receipt?.object_origin ?? null,
      byte_reread_exact: !!v, listing: { printed_title: listing.printed_title, printed_date: listing.printed_date, date_iso: listing.date_iso, doc_number: listing.doc_number, order_label_printed: listing.order_label_printed, doc_kind: listing.doc_kind, section: listing.section, page_url: listing.page_url },
      pdf: peek ? { pages: peek.pages, has_text: peek.has_text, stamp, metadata: peek.metadata, first_lines: peek.first_lines?.slice(0, 8) } : null };
    report.documents++; (report.by_case[row.native_case_id] ??= { documents: 0, stamped: 0 }).documents++;
    if (!peek) { report.no_stamp.push({ url: doc.url, why: 'no peek record' }); docs.push(doc); continue; }
    if (!peek.has_text) report.no_text.push({ url: doc.url, pages: peek.pages });
    if (!stamp) report.no_stamp.push({ url: doc.url, why: peek.has_text ? 'text present but no ECF stamp matched' : 'no extractable text' });
    else {
      report.stamp_found++; report.by_case[row.native_case_id].stamped++;
      if (normCase(stamp.case) !== normCase(row.native_case_id)) report.case_mismatch.push({ url: doc.url, listing_case: row.native_case_id, stamp_case: stamp.case });
      if (listing.date_iso && stamp.filed_iso && listing.date_iso !== stamp.filed_iso) report.date_mismatch.push({ url: doc.url, title: listing.printed_title?.slice(0, 60), listing_date: listing.printed_date, listing_iso: listing.date_iso, stamp_filed: stamp.filed_raw, stamp_iso: stamp.filed_iso });
      if (listing.doc_number && /^\d+$/.test(listing.doc_number) && Number(listing.doc_number) !== stamp.document_number) report.doc_number_mismatch.push({ url: doc.url, listing_doc: listing.doc_number, stamp_doc: stamp.document_number });
    }
    docs.push(doc);
  }
}
fs.writeFileSync(path.join(runDir, 'qa-report-' + labels.join('+').slice(0, 80) + '.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(runDir, 'documents-' + labels.join('+').slice(0, 80) + '.jsonl'), docs.map(d => JSON.stringify(d)).join('\n') + '\n');
console.log(JSON.stringify({ documents: report.documents, stamp_found: report.stamp_found, no_text: report.no_text.length, no_stamp: report.no_stamp.length, case_mismatch: report.case_mismatch.length, date_mismatch: report.date_mismatch.length, doc_number_mismatch: report.doc_number_mismatch.length, by_case: report.by_case }, null, 1));
