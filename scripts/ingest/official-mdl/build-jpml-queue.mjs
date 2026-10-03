// Queue for JPML-hosted panel orders (www.jpml.uscourts.gov) of Seeger Weiss MDLs, for matters where the transferee court publishes little or nothing
// (MDL 3180 Dupixent, MDL 3125 AngioDynamics) and as a second official copy for the others. The JPML site lists only the CURRENT hearing session's orders on
// /panel-orders; older PDFs stay on the site under predictable file names, so the URLs come from search discovery (saved verbatim under
// _work/agents/official-mdl/discovery/, copied into the run dir with sha256) and every file is fetched directly and hash-verified by the transfer worker.
// Titles are NOT printed on a listing page here: the label is derived from the file name and marked as such (printed_title = null).
//   node --use-system-ca scripts/ingest/official-mdl/build-jpml-queue.mjs --batch=b002 --discovery=<path to jpml-search-results.json> [--run-dir=<dir>]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonicalIntegerJson, hashBytes } from '../../admin/local-catalog-evidence-contract.mjs';
import { validateQueueRow, sourcePrivacyQualification } from '../backfill-pdfs-to-supabase.mjs';
import { resolveRunDir, parseArgs, readJsonl } from './store.mjs';

const sha256 = x => createHash('sha256').update(x).digest('hex');
export const JPML_CODEC = 'official-mdl-jpml-discovery-row/1';
const HOST = 'www.jpml.uscourts.gov';
// UUIDv7 operation ids carry their creation time in the first 48 bits.
export const uuidV7Time = id => new Date(parseInt(String(id).replace(/-/g, '').slice(0, 12), 16)).toISOString();
const searchedAt = search => search.searched_at ?? uuidV7Time(search.operation_id);
const clean = url => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; }; // drops tracking parameters (utm_source, _sp)
function labelFromFile(url) {
  const file = decodeURIComponent(new URL(url).pathname.split('/').pop());
  const m = /^MDL-(\d{3,4})-(Transfer_Order|Tag-Along-Transfer|Order_Denying_Transfer|Order_Vacating_CTO)-(\d{1,2})-(\d{2})(?:\s*\((.*)\))?\.pdf$/i.exec(file);
  if (!m) return { file, kind: 'jpml_order', derived_label: null, session: null };
  const kinds = { transfer_order: 'JPML transfer order', 'tag-along-transfer': 'JPML tag-along transfer order', order_denying_transfer: 'JPML order denying transfer', order_vacating_cto: 'JPML order vacating conditional transfer order' };
  return { file, mdl: m[1], kind: m[2].toLowerCase(), derived_label: kinds[m[2].toLowerCase()] + (m[5] ? ' (' + m[5] + ')' : ''), session: { month: Number(m[3]), year_2digit: m[4] } };
}

// Curated from the discovery file: documents whose file name carries the MDL number of a tracked matter. Nothing else is queued.
export function candidates(discovery) {
  const out = new Map();
  for (const search of discovery.searches) {
    for (const r of search.results ?? []) {
      let u; try { u = new URL(r.url); } catch { continue; }
      if (u.hostname !== HOST) continue;
      const label = labelFromFile(r.url);
      if (!label.mdl || label.mdl !== search.mdl || !/^(transfer_order|tag-along-transfer|order_denying_transfer|order_vacating_cto)$/.test(label.kind)) continue;
      const url = clean(r.url);
      if (!out.has(url)) out.set(url, { mdl: label.mdl, url, label, discovery: { operation_id: search.operation_id, query: search.query, result_title: r.title ?? null, result_description: r.description ?? null, searched_at: searchedAt(search) } });
    }
    if (search.also_seen) {
      const m = /(https:\/\/www\.jpml\.uscourts\.gov\/sites\/jpml\/files\/MDL-(\d{3,4})-[^\s)]+?\.pdf)/.exec(search.also_seen);
      if (m && m[2] === search.mdl) { const url = clean(m[1]); const label = labelFromFile(url); if (!out.has(url)) out.set(url, { mdl: label.mdl, url, label, discovery: { operation_id: search.operation_id, query: search.query, result_title: null, result_description: 'hint from a third-party page; verified by direct fetch', searched_at: searchedAt(search) } }); }
    }
  }
  // the 3114 July 2026 order is linked in the JPML /panel-orders snapshot returned by the 3114 search
  for (const search of discovery.searches) for (const r of search.results ?? []) {
    const m = /\((https:\/\/www\.jpml\.uscourts\.gov\/sites\/jpml\/files\/(MDL-(\d{3,4})-[^)\s]+\.pdf))\)/.exec(r.description ?? '');
    if (m && m[3] === search.mdl) { const url = clean(m[1]), label = labelFromFile(url); if (!out.has(url)) out.set(url, { mdl: label.mdl, url, label, discovery: { operation_id: search.operation_id, query: search.query, result_title: r.title ?? null, result_description: r.description, searched_at: searchedAt(search) } }); }
  }
  return [...out.values()].sort((a, b) => a.mdl.localeCompare(b.mdl) || a.url.localeCompare(b.url));
}

export function buildRows({ items, discoverySha256, discoveryFile }) {
  const rows = [];
  for (const [ordinal, item] of items.entries()) {
    const caseId = 'MDL No. ' + item.mdl;
    const listing = { schema: JPML_CODEC, mdl: item.mdl, court_id: 'jpml', page_url: item.url, page_role: 'jpml_file_discovered_by_search', row_ordinal: ordinal + 1,
      printed_title: null, printed_label: item.label.file, derived_label: item.label.derived_label, derived_label_basis: item.label.derived_label ? 'file name pattern MDL-<n>-<order kind>-<hearing session month>-<yy>' : null,
      hearing_session_month: item.label.session?.month ?? null, hearing_session_year_2digit: item.label.session?.year_2digit ?? null, printed_date: null, date_iso: null, date_iso_basis: null, doc_number: null,
      doc_kind: item.label.kind === 'transfer_order' ? 'jpml_transfer_order' : item.label.kind === 'tag-along-transfer' ? 'jpml_tag_along_transfer_order' : 'jpml_order', href_as_printed: item.url, url: item.url, url_kind: 'pdf_direct',
      discovery_operation_id: item.discovery.operation_id, discovery_query: item.discovery.query, discovery_result_title: item.discovery.result_title };
    const record = JSON.parse(JSON.stringify(listing));
    const recordSha = hashBytes(canonicalIntegerJson(record));
    const row = {
      schema_version: 'source-qualified-pdf-queue/1', provider: 'official-court',
      native_document_id: item.url, native_document_identity_kind: 'publisher_observed_pdf_locator_url',
      native_case_id: caseId, native_case_identity_kind: 'jpml_mdl_number_literal',
      durable_url: item.url, download_url: item.url, expected_sha1: null, expected_bytes: null,
      title: item.label.derived_label ?? item.label.file, filing_date: null, selected_source_record_sha256: recordSha,
      provider_flags: { sealing_related_locator_held: false, pdf_http_access_verified: false, pdf_content_verified: false },
      eligible: true, held_reason: null,
      source_claims: { matter_scope: 'mdl:' + item.mdl, source_document_label: item.label.derived_label ?? item.label.file, index_date_printed: null, index_date_iso: null, date_semantics: 'no date printed on a listing page; hearing session month/year only appears in the file name', date_is_verified_native_filing_date: false, pdf_content_verified: false, source_metadata_only: true },
      scope_evidence: [{ evidence_kind: 'jpml_file_name_mdl_number', field: 'mdl_number_literal', value: caseId, qualification: 'MDL number carried by the JPML file name; the JPML ECF stamp "Case MDL No. <n>" is re-checked on the downloaded PDF', source: { source_url: item.url, discovery_operation_id: item.discovery.operation_id } }],
      origins: [{ native_document_id: item.url, native_case_id: caseId, native_record_sha256: recordSha, native_record_hash_codec: 'canonical-integer-jsonb/1',
        native_record_hash_serialization: 'canonical-integer-jsonb/1 of the ' + JPML_CODEC + ' record (file name derived label, discovery operation id)', native_record_identity_kind: 'jpml_file_discovered_by_search',
        source_url: item.url, source_sha256: discoverySha256, source_response_sha256: discoverySha256, source_response_hash_semantics: 'SHA256 of the saved discovery file (verbatim search-connector result entries); not the PDF bytes',
        http_status: null, retrieved_at: item.discovery.searched_at, retrieved_at_basis: 'creation time encoded in the search operation id (UUIDv7)', capture_file: discoveryFile, capture_file_sha256: discoverySha256,
        source_locator: { kind: 'search_result_entry', operation_id: item.discovery.operation_id }, listing: record }],
      provenance: { adapter_version: 'official-mdl-jpml-queue/1', matter: 'mdl:' + item.mdl, court_id: 'jpml', court_host: HOST, listing_record_codec: JPML_CODEC, native_document_identity_is_source_locator: true, expected_pdf_checksum_and_size: 'not_recorded', exact_official_host_allowlist: [HOST], new_api_requests: 0, pdf_transfers: 0 },
    };
    row.source_privacy_qualification = sourcePrivacyQualification(row);
    validateQueueRow(row);
    rows.push(row);
  }
  return rows;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolveRunDir(args['run-dir']);
  const batch = String(args.batch ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!batch || !args.discovery) throw Error('--batch and --discovery are required');
  const bytes = fs.readFileSync(path.resolve(String(args.discovery)));
  const discovery = JSON.parse(bytes);
  const discoverySha = sha256(bytes);
  const copy = path.join(runDir, 'discovery', 'jpml-search-results-' + discoverySha.slice(0, 12) + '.json');
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  if (!fs.existsSync(copy)) fs.writeFileSync(copy, bytes, { flag: 'wx' });
  const ledger = new Set(readJsonl(path.join(runDir, 'registered-official.jsonl')).map(x => [x.url, x.native_case_id].join('|')));
  const wanted = args.mdl ? new Set(String(args.mdl).split(',')) : null;
  const items = candidates(discovery).filter(i => (!wanted || wanted.has(i.mdl)) && !ledger.has([i.url, 'MDL No. ' + i.mdl].join('|')));
  const rows = buildRows({ items, discoverySha256: discoverySha, discoveryFile: copy });
  const body = Buffer.from(rows.map(r => JSON.stringify(r) + '\n').join(''));
  const queueDir = path.join(runDir, 'queues');
  fs.mkdirSync(queueDir, { recursive: true });
  const queueFile = path.join(queueDir, `${batch}-jpml.queue.jsonl`);
  fs.writeFileSync(queueFile, body, { flag: 'wx' });
  const manifest = { schema_version: 'official-mdl-queue-manifest/1', created_at: new Date().toISOString(), provider: 'official-court', host: HOST, batch, queue: queueFile, sha256: sha256(body), bytes: body.length, records: rows.length,
    matters: [...new Set(rows.map(r => r.provenance.matter))], urls: rows.map(r => r.download_url), discovery_file: copy, discovery_sha256: discoverySha, qualification: 'JPML-hosted panel order PDFs found by search discovery; fetched directly from the JPML site, hash-verified at transfer. Not a complete inventory of JPML orders.' };
  fs.writeFileSync(queueFile + '.manifest.json', JSON.stringify(manifest, null, 1) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ batch, rows: rows.length, by_mdl: Object.fromEntries([...new Set(items.map(i => i.mdl))].map(m => [m, items.filter(i => i.mdl === m).length])), sha256: manifest.sha256, queue: queueFile }, null, 1));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
