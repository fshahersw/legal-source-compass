// Parses the captured official court pages into deterministic document listings (one JSONL per matter) in the private run dir.
//   node --use-system-ca scripts/ingest/official-mdl/build-listings.mjs --mdl=2738,3060 [--run-dir=<dir>]
// Output: <run>/listings/<mdl>.listing.jsonl (one row per listed document), <run>/listings/<mdl>.pages.json (per-page summary + case-number evidence).
// No network access. Every row keeps: the printed title/date/doc number exactly as shown, the absolute URL, the capture it came from (sha256, retrieved_at,
// HTTP status) and the byte span of the row inside that capture. A row's record hash covers ONLY the row's own fields (not the page hash), so an unchanged row
// keeps its identity when the page changes elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonicalIntegerJson, hashBytes } from '../../admin/local-catalog-evidence-contract.mjs';
import { FAMILIES, SEAL_PATTERN, printedCaseNumbers } from './parsers.mjs';
import { MATTERS, pagesFor } from './targets.mjs';
import { resolveRunDir, parseArgs, latestCaptures, readBody, appendJsonl } from './store.mjs';

const sha256 = x => createHash('sha256').update(x).digest('hex');
export const RECORD_CODEC = 'official-mdl-listing-row/1';

const RECORD_FIELDS = ['section', 'row_ordinal', 'printed_title', 'printed_label', 'printed_date', 'date_iso', 'date_iso_basis', 'doc_number', 'order_label_printed', 'order_kind', 'order_number', 'doc_kind',
  'href_as_printed', 'url', 'url_kind', 'title_source', 'date_source', 'attachment_of', 'attachment_number', 'printed_title_lead', 'page_reported_bytes', 'machine_date_attribute', 'date_iso_cross_check', 'file_name_attribute', 'node_page_href',
  'mdl_number_printed', 'mdl_title_printed', 'session_label_printed'];
export function listingRecord({ mdl, courtId, pageUrl, pageRole, row }) {
  const record = { schema: RECORD_CODEC, mdl, court_id: courtId, page_url: pageUrl, page_role: pageRole };
  for (const key of RECORD_FIELDS) if (row[key] !== undefined) record[key] = row[key];
  return JSON.parse(JSON.stringify(record)); // drops undefined, guarantees plain JSON
}
export const recordSha256 = record => hashBytes(canonicalIntegerJson(record));

// Decision about the row itself, before any registry question. Held rows are never downloaded.
export function queueDecision(row) {
  if (row.url_kind === 'ecf_login') return { decision: 'not_queued', reason: 'ecf_login_pacer_required' };
  if (row.url_kind !== 'pdf_direct') return { decision: 'not_queued', reason: 'not_a_direct_pdf_link' };
  const haystack = [row.printed_title, row.printed_label, row.row_text, row.url].filter(Boolean).join(' \n ');
  if (SEAL_PATTERN.test(haystack)) return { decision: 'held', reason: 'sealing_related_wording', matched: (SEAL_PATTERN.exec(haystack) ?? [])[0] ?? null };
  return { decision: 'queue', reason: null };
}

function parseIlndMemberCases(html, entry) {
  // The court's own "Member Cases" table (Case # | Plaintiff | Defendant | Orig. District Case # | Originating District | Date Closed). Kept in the private run dir only.
  const start = html.indexOf("<table id='membercases'");
  if (start < 0) return [];
  const end = html.indexOf('</table>', start);
  const rows = [];
  for (const m of html.slice(start, end).matchAll(/<tr><td[^>]*>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)) {
    const dec = s => s.replace(/&#035;/g, '#').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    rows.push({ case_number: dec(m[1]), plaintiff_printed: dec(m[2]), defendant_printed: dec(m[3]), original_district_case_number: dec(m[4]) || null, originating_district: dec(m[5]) || null, date_closed_printed: dec(m[6]) || null, source: { page_sha256: entry.sha256, retrieved_at: entry.retrieved_at, url: entry.url } });
  }
  return rows;
}

export function buildMatter({ runDir, mdl, captures }) {
  const matter = MATTERS[mdl];
  const pages = [], rows = [], problems = [];
  for (const target of pagesFor([mdl], { includeIndex: true })) {
    const entry = captures.get(target.url);
    if (!entry) { problems.push({ page_id: target.id, url: target.url, problem: 'no_successful_capture' }); continue; }
    const bytes = readBody(runDir, entry);
    if (sha256(bytes) !== entry.sha256) throw Error('CAPTURE_HASH_MISMATCH ' + entry.body_file);
    const html = bytes.toString('utf8');
    const parser = FAMILIES[target.family];
    const parsed = parser({ html, pageUrl: entry.final_url ?? target.url });
    // one JPML page lists many MDLs: a matter keeps only the rows whose printed MDL number is its own
    if (target.role === 'jpml_panel_orders') parsed.rows = parsed.rows.filter(r => r.mdl_number_printed === mdl);
    const isIndex = target.role === 'court_mdl_index';
    const summary = { page_id: target.id, role: target.role, family: target.family, url: target.url, final_url: entry.final_url, capture: { body_file: entry.body_file, sha256: entry.sha256, bytes: entry.bytes, retrieved_at: entry.retrieved_at, http_status: entry.http_status, robots: entry.robots?.verdict ?? null }, page: parsed.page, rows: parsed.rows.length };
    if (isIndex || target.family === 'index-links') summary.index_links = parsed.index_links ?? [];
    if (!isIndex) summary.printed_case_numbers = printedCaseNumbers(html);
    pages.push(summary);
    if (isIndex) continue;
    for (const row of parsed.rows) {
      const record = listingRecord({ mdl, courtId: matter.court_id, pageUrl: target.url, pageRole: target.role, row });
      const decision = queueDecision(row);
      rows.push({ record, record_sha256: recordSha256(record), decision, row_text: row.row_text, row_span: row.row_span, row_html_sha256: row.row_html_sha256,
        source: { page_id: target.id, page_url: target.url, final_url: entry.final_url, page_sha256: entry.sha256, capture_file: entry.body_file, retrieved_at: entry.retrieved_at, http_status: entry.http_status } });
    }
    if (target.family === 'ilnd-mdl-details') {
      const members = parseIlndMemberCases(html, entry);
      if (members.length) { summary.member_cases_table_rows = members.length; fs.mkdirSync(path.join(runDir, 'listings'), { recursive: true }); fs.writeFileSync(path.join(runDir, 'listings', mdl + '.court-member-cases.jsonl'), members.map(r => JSON.stringify(r)).join('\n') + '\n'); }
    }
  }
  return { pages, rows, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolveRunDir(args['run-dir']);
  const mdls = String(args.mdl ?? Object.keys(MATTERS).join(',')).split(',').map(x => x.trim()).filter(Boolean);
  const captures = latestCaptures(runDir);
  fs.mkdirSync(path.join(runDir, 'listings'), { recursive: true });
  for (const mdl of mdls) {
    const { pages, rows, problems } = buildMatter({ runDir, mdl, captures });
    const file = path.join(runDir, 'listings', mdl + '.listing.jsonl');
    fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    const counts = {};
    for (const r of rows) counts[r.decision.decision + ':' + (r.decision.reason ?? 'ok')] = (counts[r.decision.decision + ':' + (r.decision.reason ?? 'ok')] ?? 0) + 1;
    const summaryFile = path.join(runDir, 'listings', mdl + '.pages.json');
    fs.writeFileSync(summaryFile, JSON.stringify({ schema_version: 'official-mdl-listing-summary/1', mdl, built_at: new Date().toISOString(), listing_file: path.basename(file), listing_sha256: sha256(fs.readFileSync(file)), rows: rows.length, decisions: counts, problems, pages, note: MATTERS[mdl].note ?? null }, null, 1));
    console.log(JSON.stringify({ mdl, rows: rows.length, decisions: counts, pages: pages.map(p => ({ id: p.page_id, rows: p.rows })), problems }));
  }
}
