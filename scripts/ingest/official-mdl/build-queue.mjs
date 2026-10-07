// Freezes official-court PDF queues ('source-qualified-pdf-queue/1', provider 'official-court') from the parsed listings.
//   node --use-system-ca scripts/ingest/official-mdl/build-queue.mjs --mdl=3114,3185 --batch=b001 [--run-dir=<dir>]
// One queue file per court host (hosts are paced separately: robots Crawl-delay), each with a sha256 manifest. No network access, no database access, no PDF bytes.
// Rows: one per distinct PDF URL (several listing rows for the same URL become several origins). Held rows (sealed/restricted/in camera/ex parte/redacted wording)
// and ECF/PACER links are never queued; they are written to the excluded file with the reason. Rows identical to ones the official-mdl run already registered are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateQueueRow, sourcePrivacyQualification } from '../backfill-pdfs-to-supabase.mjs';
import { MATTERS } from './targets.mjs';
import { resolveRunDir, parseArgs, readJsonl, readBody } from './store.mjs';
import { RECORD_CODEC } from './build-listings.mjs';

const sha256 = x => createHash('sha256').update(x).digest('hex');
export const ADAPTER_VERSION = 'official-mdl-queue/1';

function caseEvidence({ runDir, mdl, summary }) {
  const matter = MATTERS[mdl];
  if (!matter.case_number) return null;
  const { literal } = matter.case_number;
  if (matter.case_number.pdf_evidence) {
    const e = matter.case_number.pdf_evidence;
    return { literal, kind: 'docket_literal_in_court_pdf_stamp', source: { source_url: e.url, source_sha256: e.sha256, page: e.page, context: e.context, retrieval_method: 'direct_http_get_pdf_text_extraction_pymupdf', retrieved_at: e.retrieved_at ?? null }, note: matter.case_number.note ?? null };
  }
  const page = summary.pages.find(p => p.page_id === matter.case_number.page_id);
  if (!page) throw Error('CASE_LITERAL_PAGE_NOT_CAPTURED ' + mdl);
  const bytes = readBody(runDir, { body_file: page.capture.body_file });
  if (sha256(bytes) !== page.capture.sha256) throw Error('CAPTURE_HASH_MISMATCH');
  const html = bytes.toString('utf8');
  const at = html.indexOf(literal);
  if (at < 0) throw Error('CASE_LITERAL_NOT_FOUND_ON_PAGE ' + mdl + ' ' + literal);
  return { literal, kind: 'exact_master_docket_literal_in_primary_court_page',
    source: { source_url: page.url, source_sha256: page.capture.sha256, retrieved_at: page.capture.retrieved_at, http_status: page.capture.http_status, capture_file: page.capture.body_file, html_char_start: at, html_char_end: at + literal.length, context: html.slice(Math.max(0, at - 80), at + literal.length + 60).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() },
    note: matter.case_number.note ?? null };
}

export function buildRows({ runDir, mdl, listing, summary, registeredKeys = new Set() }) {
  const matter = MATTERS[mdl];
  const evidence = caseEvidence({ runDir, mdl, summary });
  const caseId = evidence?.literal ?? (matter.printed_mdl_literal ?? null);
  const caseKind = evidence ? 'exact_sourced_master_docket_literal' : caseId ? 'printed_mdl_number_literal' : 'not_recorded';
  const excluded = [], byUrl = new Map();
  const hrefNeedle = matter.listing_href_substring ?? null;
  for (const row of listing) {
    const r = row.record;
    if (hrefNeedle && ![r.url, r.href_as_printed].some(h => String(h ?? '').includes(hrefNeedle))) {
      excluded.push({ url: r.url, printed_title: r.printed_title, printed_date: r.printed_date, doc_number: r.doc_number, page_id: row.source.page_id, row_ordinal: r.row_ordinal, decision: 'excluded', reason: 'listing_href_substring_mismatch', listing_href_substring: hrefNeedle });
      continue;
    }
    if (row.decision.decision !== 'queue') { excluded.push({ url: r.url, printed_title: r.printed_title, printed_date: r.printed_date, doc_number: r.doc_number, page_id: row.source.page_id, row_ordinal: r.row_ordinal, ...row.decision }); continue; }
    if (!byUrl.has(r.url)) byUrl.set(r.url, []);
    byUrl.get(r.url).push(row);
  }
  const rows = [], skipped = [];
  for (const [url, group] of byUrl) {
    // the most informative listing is the selected source version: dated rows first, then page order
    const ordered = [...group].sort((a, b) => (b.record.date_iso ? 1 : 0) - (a.record.date_iso ? 1 : 0));
    const selected = ordered[0];
    if (registeredKeys.has([url, caseId, selected.record_sha256].join('|'))) { skipped.push({ url, reason: 'already_registered_by_official_mdl_run', record_sha256: selected.record_sha256 }); continue; }
    const r = selected.record;
    const origins = ordered.map(g => ({
      native_document_id: url, native_case_id: caseId,
      native_record_sha256: g.record_sha256, native_record_hash_codec: 'canonical-integer-jsonb/1',
      native_record_hash_serialization: 'canonical-integer-jsonb/1 of the ' + RECORD_CODEC + ' record: the listing row\'s own printed fields; the page hash and retrieval time are NOT part of the record',
      native_record_identity_kind: 'court_mdl_page_listing_row',
      source_url: g.source.page_url, source_sha256: g.source.page_sha256, source_response_sha256: g.source.page_sha256,
      source_response_hash_semantics: 'SHA256 of the raw HTTP response body of the page capture, bytes as received',
      http_status: g.source.http_status, retrieved_at: g.source.retrieved_at, retrieved_at_basis: 'http_response_time_of_page_capture',
      capture_file: path.join(runDir, g.source.capture_file), capture_file_sha256: g.source.page_sha256,
      source_locator: { kind: 'html_row_span', start: g.row_span.start, end: g.row_span.end, row_html_sha256: g.row_html_sha256, page_id: g.source.page_id, section: g.record.section ?? null, row_ordinal: g.record.row_ordinal },
      listing: g.record,
    }));
    const row = {
      schema_version: 'source-qualified-pdf-queue/1', provider: 'official-court',
      native_document_id: url, native_document_identity_kind: 'publisher_observed_pdf_locator_url',
      native_case_id: caseId, native_case_identity_kind: caseKind,
      durable_url: url, download_url: url, expected_sha1: null, expected_bytes: null,
      title: r.printed_title ?? r.printed_label ?? null, filing_date: null,
      selected_source_record_sha256: selected.record_sha256,
      provider_flags: { sealing_related_locator_held: false, pdf_http_access_verified: false, pdf_content_verified: false },
      eligible: true, held_reason: null,
      source_claims: { matter_scope: 'mdl:' + mdl, source_document_label: r.printed_title ?? r.printed_label ?? null, index_date_printed: r.printed_date, index_date_iso: r.date_iso, index_date_iso_basis: r.date_iso_basis,
        date_semantics: 'date printed beside the document on the court MDL page (' + (r.page_role ?? 'listing') + ')', date_is_verified_native_filing_date: false, pdf_content_verified: false, source_metadata_only: true },
      scope_evidence: evidence ? [{ evidence_kind: evidence.kind, field: 'master_docket_literal', value: evidence.literal, qualification: evidence.kind === 'docket_literal_in_court_pdf_stamp' ? 'literal printed in the court-stamped header of a court PDF' : 'literal_page_assertion', source: evidence.source, note: evidence.note }] : [],
      origins,
      provenance: { adapter_version: ADAPTER_VERSION, matter: 'mdl:' + mdl, court_id: matter.court_id, court_host: matter.host, listing_record_codec: RECORD_CODEC, native_document_identity_is_source_locator: true, expected_pdf_checksum_and_size: 'not_recorded', exact_official_host_allowlist: [new URL(url).hostname], ecf_paid_login_excluded: true, new_api_requests: 0, pdf_transfers: 0 },
    };
    row.source_privacy_qualification = sourcePrivacyQualification(row);
    validateQueueRow(row);
    rows.push(row);
  }
  return { rows, excluded, skipped, case_id: caseId, case_kind: caseKind, case_evidence: evidence };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolveRunDir(args['run-dir']);
  const mdls = String(args.mdl ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const batch = String(args.batch ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!mdls.length || !batch) throw Error('--mdl and --batch are required');
  const ledger = readJsonl(path.join(runDir, 'registered-official.jsonl'));
  const registeredKeys = new Set(ledger.map(x => [x.url, x.native_case_id, x.record_sha256].join('|')));
  const perHost = new Map(), excludedAll = [], skippedAll = [], matters = [];
  for (const mdl of mdls) {
    const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'listings', mdl + '.pages.json'), 'utf8'));
    const listing = readJsonl(path.join(runDir, 'listings', mdl + '.listing.jsonl'));
    if (sha256(fs.readFileSync(path.join(runDir, 'listings', mdl + '.listing.jsonl'))) !== summary.listing_sha256) throw Error('LISTING_HASH_MISMATCH ' + mdl);
    const built = buildRows({ runDir, mdl, listing, summary, registeredKeys });
    for (const row of built.rows) { const host = new URL(row.download_url).hostname; if (!perHost.has(host)) perHost.set(host, []); perHost.get(host).push(row); }
    for (const e of built.excluded) excludedAll.push({ mdl, ...e });
    for (const s of built.skipped) skippedAll.push({ mdl, ...s });
    matters.push({ mdl, native_case_id: built.case_id, native_case_identity_kind: built.case_kind, queued: built.rows.length, excluded: built.excluded.length, skipped: built.skipped.length, listing_rows: listing.length });
  }
  const queueDir = path.join(runDir, 'queues');
  fs.mkdirSync(queueDir, { recursive: true });
  const manifests = [];
  for (const [host, rows] of perHost) {
    const slug = host.replace(/^www\./, '').replace(/\.uscourts\.gov$/, '');
    const queueFile = path.join(queueDir, `${batch}-${slug}.queue.jsonl`);
    const body = Buffer.from(rows.map(r => JSON.stringify(r) + '\n').join(''));
    fs.writeFileSync(queueFile, body, { flag: 'wx' });
    const manifest = { schema_version: 'official-mdl-queue-manifest/1', created_at: new Date().toISOString(), provider: 'official-court', host, batch, queue: queueFile, sha256: sha256(body), bytes: body.length, records: rows.length,
      matters: [...new Set(rows.map(r => r.provenance.matter))], urls: rows.map(r => r.download_url), pacing: 'one process per host; robots Crawl-delay honoured by the transfer pacing', qualification: 'Direct public official-court PDF links listed on the court MDL page. ECF/PACER links and sealing-related wording excluded. URL is the observed native locator identity; PDF body, checksum and size are verified at transfer time.' };
    fs.writeFileSync(queueFile + '.manifest.json', JSON.stringify(manifest, null, 1) + '\n', { flag: 'wx' });
    manifests.push({ host, queue: path.basename(queueFile), rows: rows.length, sha256: manifest.sha256 });
  }
  const excludedFile = path.join(queueDir, `${batch}-excluded.json`);
  fs.writeFileSync(excludedFile, JSON.stringify({ schema_version: 'official-mdl-queue-excluded/1', batch, created_at: new Date().toISOString(), excluded: excludedAll, skipped: skippedAll }, null, 1) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ batch, matters, queues: manifests, excluded: excludedAll.length, skipped: skippedAll.length, excluded_file: excludedFile }, null, 1));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
