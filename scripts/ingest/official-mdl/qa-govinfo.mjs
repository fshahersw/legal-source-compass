// QA of stored GovInfo PDFs: the downloaded bytes must equal what GPO's PREMIS record published (SHA-256 fixity and byte size), and (when pdf-peek.jsonl covers the file) the
// court stamp on the PDF must name the same docket (or lead case) and a filing date near the MODS dateIssued.
//   node scripts/ingest/official-mdl/qa-govinfo.mjs --label=g001-govinfo[,...] [--run-dir=<dir>]
import fs from 'node:fs';
import path from 'node:path';
import { resolveRunDir, parseArgs, readJsonl } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args['run-dir']);
const labels = String(args.label ?? '').split(',').map(x => x.trim()).filter(Boolean);
const peeks = new Map(readJsonl(path.join(runDir, 'pdf-peek.jsonl')).map(p => [p.sha256, p]));
const report = { schema_version: 'official-mdl-govinfo-qa/1', at: new Date().toISOString(), labels, rows: 0, receipts: 0, fixity_equal: 0, fixity_mismatch: [], size_mismatch: [], missing_receipt: [], stamp_found: 0, stamp_case_other: [], stamp_date_gap_days_gt_5: [], object_origin: {} };
for (const label of labels) {
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'queues', label + '.queue.jsonl.manifest.json'), 'utf8'));
  const receipts = new Map(readJsonl(path.join(runDir, 'transfers', label, 'transfer-receipts.jsonl')).filter(r => r.state === 'cloud_verified' || r.state === 'dedup_matched').map(r => [r.native_document_id, r]));
  for (const line of fs.readFileSync(manifest.queue, 'utf8').trim().split('\n')) {
    const row = JSON.parse(line); report.rows++;
    const r = receipts.get(row.native_document_id);
    if (!r) { report.missing_receipt.push(row.native_document_id); continue; }
    report.receipts++; report.object_origin[r.object_origin ?? 'n/a'] = (report.object_origin[r.object_origin ?? 'n/a'] ?? 0) + 1;
    if (r.sha256 === row.source_claims.provider_fixity_sha256) report.fixity_equal++; else report.fixity_mismatch.push({ granule: row.native_document_id, gpo: row.source_claims.provider_fixity_sha256, stored: r.sha256 });
    if (r.bytes !== row.expected_bytes) report.size_mismatch.push({ granule: row.native_document_id, premis: row.expected_bytes, stored: r.bytes });
    const stamp = peeks.get(r.sha256)?.stamp;
    if (stamp) {
      report.stamp_found++;
      const caseNorm = s => String(s).replace(/-[A-Za-z]{1,5}(?:-[A-Za-z]{1,5})*$/, '').replace(/^(\d+:\d{2})-?([a-z]{2})-?0*(\d+)$/i, (_, a, t, n) => `${a}-${t.toLowerCase()}-${Number(n)}`);
      if (!row.native_case_id.startsWith('MDL No.') && caseNorm(stamp.case) !== caseNorm(row.native_case_id)) report.stamp_case_other.push({ granule: row.native_document_id, stamp_case: stamp.case, matter_case: row.native_case_id });
      const issued = row.source_claims.index_date_iso;
      if (issued && stamp.filed_iso) { const gap = Math.abs((Date.parse(issued) - Date.parse(stamp.filed_iso)) / 86400000); if (gap > 5) report.stamp_date_gap_days_gt_5.push({ granule: row.native_document_id, date_issued: issued, stamp_filed: stamp.filed_iso, gap_days: Math.round(gap) }); }
    }
  }
}
const file = path.join(runDir, 'qa-govinfo-' + labels.join('+').slice(0, 80) + '.json');
fs.writeFileSync(file, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ rows: report.rows, receipts: report.receipts, fixity_equal: report.fixity_equal, fixity_mismatch: report.fixity_mismatch.length, size_mismatch: report.size_mismatch.length, missing_receipt: report.missing_receipt.length, stamp_found: report.stamp_found, stamp_case_other: report.stamp_case_other.length, stamp_date_gap_gt_5d: report.stamp_date_gap_days_gt_5.length, object_origin: report.object_origin, file }));
