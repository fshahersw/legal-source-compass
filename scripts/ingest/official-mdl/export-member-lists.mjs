// Hand-off of a court's own "member cases" table (when its MDL page lists one) to the matter registry, in the agreed shape
// _work/contracts/official-member-lists/mdl<N>.jsonl (+ .manifest.json): one row per table row, fields exactly as printed (whitespace collapsed only).
//   node --use-system-ca scripts/ingest/official-mdl/export-member-lists.mjs --mdl=3060 [--run-dir=<dir>] [--out-dir=<ROOT>/_work/contracts/official-member-lists]
// Only ILND's table (Case # | Plaintiff | Defendant | Orig. District Case # | Originating District | Date Closed) exists among the pages captured so far.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseHtml, findAll, findFirst, textOf } from './html-lite.mjs';
import { SEAL_PATTERN } from './parsers.mjs';
import { MATTERS } from './targets.mjs';
import { resolveRunDir, parseArgs, latestCaptures, readBody } from './store.mjs';

const sha256 = x => createHash('sha256').update(x).digest('hex');
const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args['run-dir']);
const outDir = path.resolve(String(args['out-dir'] ?? new URL('../../../../_work/contracts/official-member-lists', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
fs.mkdirSync(outDir, { recursive: true });
const mdls = String(args.mdl ?? '3060').split(',').map(x => x.trim());
const captures = latestCaptures(runDir);
const COLUMN = { 'case #': 'case_number_as_printed', plaintiff: 'plaintiff_as_printed', defendant: 'defendant_as_printed', 'orig. district case #': 'orig_district_case_number_as_printed', 'originating district': 'orig_district_as_printed', 'date closed': 'date_closed_as_printed' };
for (const mdl of mdls) {
  const matter = MATTERS[mdl];
  const pages = matter.pages.filter(p => p.family === 'ilnd-mdl-details');
  if (!pages.length) { console.log(JSON.stringify({ mdl, skipped: 'no page with a member table' })); continue; }
  const rows = [], pageShas = {}, headersSeen = new Set();
  let retrievedAt = null, headers = [];
  for (const target of pages) {
    const entry = captures.get(target.url);
    if (!entry) throw Error('NO_CAPTURE ' + target.url);
    const bytes = readBody(runDir, entry);
    if (sha256(bytes) !== entry.sha256) throw Error('CAPTURE_HASH_MISMATCH');
    const root = parseHtml(bytes.toString('utf8'));
    const table = findFirst(root, n => n.tag === 'table' && n.attrs.id === 'membercases');
    if (!table) continue;
    headers = findAll(table, n => n.tag === 'th').map(th => textOf(th));
    pageShas[target.url] = entry.sha256; retrievedAt = entry.retrieved_at;
    let rowNo = 0;
    for (const tr of findAll(table, n => n.tag === 'tr')) {
      const tds = findAll(tr, n => n.tag === 'td'); if (!tds.length) continue;
      rowNo++;
      const values = tds.map(td => textOf(td));
      const row = { schema_version: 'official-member-row/1', mdl, court_id: matter.court_id, page_url: target.url, page_sha256: entry.sha256, retrieved_at: entry.retrieved_at, row_no: rowNo,
        case_number_as_printed: null, plaintiff_as_printed: null, defendant_as_printed: null, orig_district_as_printed: null, orig_district_case_number_as_printed: null, date_closed_as_printed: null, extra: {} };
      headers.forEach((h, i) => { const key = COLUMN[h.toLowerCase()]; const value = values[i] === '' ? null : values[i] ?? null; if (key) row[key] = value; else row.extra[h] = value; headersSeen.add(h); });
      rows.push(row);
    }
  }
  const body = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  const rowsFile = path.join(outDir, `mdl${mdl}.jsonl`);
  fs.writeFileSync(rowsFile, body);
  const caseNumbers = rows.map(r => r.case_number_as_printed);
  const dup = caseNumbers.filter((c, i) => c && caseNumbers.indexOf(c) !== i);
  const formatOk = c => /^\d{1,2}:\d{2}-(?:cv|md|mc)-\d{3,6}(?:-[A-Za-z]{1,5})*$/.test(c ?? '');
  const sealish = rows.filter(r => SEAL_PATTERN.test([r.plaintiff_as_printed, r.defendant_as_printed, r.case_number_as_printed].join(' ')));
  const byDistrict = {};
  for (const r of rows) if (r.orig_district_as_printed) byDistrict[r.orig_district_as_printed] = (byDistrict[r.orig_district_as_printed] ?? 0) + 1;
  const manifest = { schema_version: 'official-member-list-manifest/1', mdl, court_id: matter.court_id, generated_at: new Date().toISOString(), page_urls: Object.keys(pageShas), page_sha256: pageShas, retrieved_at: retrievedAt, column_headers: headers,
    row_count: rows.length, rows_file: path.basename(rowsFile), rows_file_sha256: sha256(body),
    parser_notes: 'Rows of the court page table #membercases parsed with the official-mdl html-lite parser; cell text = decoded entities, whitespace collapsed, empty cell = null. Nothing normalised, merged or inferred (plaintiff is the last name as printed, defendant as printed).',
    qa_caveats: { rows_with_case_number_not_matching_docket_pattern: rows.filter(r => !formatOk(r.case_number_as_printed)).length, duplicate_case_numbers: [...new Set(dup)].length, rows_with_original_district: Object.values(byDistrict).reduce((a, b) => a + b, 0), rows_with_date_closed: rows.filter(r => r.date_closed_as_printed).length,
      rows_with_seal_restricted_in_camera_ex_parte_redact_wording: sealish.length, note: 'The court lists the lead case itself (1:23-cv-00818) and every member case filed in or transferred to the transferee court; counts are as of the capture, the page is updated by the clerk. Plaintiff column holds last names only; do not treat it as a party identity.' },
    originating_districts_top: Object.entries(byDistrict).sort((a, b) => b[1] - a[1]).slice(0, 15) };
  fs.writeFileSync(path.join(outDir, `mdl${mdl}.manifest.json`), JSON.stringify(manifest, null, 1) + '\n');
  console.log(JSON.stringify({ mdl, rows: rows.length, rows_file: rowsFile, sha256: manifest.rows_file_sha256, qa: manifest.qa_caveats, headers }));
}
