// Freezes the GovInfo queue ('source-qualified-pdf-queue/1', provider 'govinfo') from the discovery listings (govinfo-discover.mjs).
//   node --use-system-ca scripts/ingest/official-mdl/build-govinfo-queue.mjs --keys=2738,3140 --batch=g001 [--run-dir=<dir>]
// One row per granule PDF that PREMIS lists. Identity: native_document_id = granule id, native_case_id = the case number as printed (the matter's official-court id when it has one,
// the docket number GovInfo publishes otherwise, "MDL No. <n>" for the JPML packages). expected_bytes = PREMIS size; GPO's SHA-256 fixity is carried as provider_fixity_sha256 and
// compared with the downloaded bytes by qa-govinfo.mjs. Rows whose docket text carries sealed/restricted/in camera/ex parte/redacted wording are held, never queued.
// No network, no database, no PDF bytes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonicalIntegerJson, hashBytes } from '../../admin/local-catalog-evidence-contract.mjs';
import { validateQueueRow, sourcePrivacyQualification } from '../backfill-pdfs-to-supabase.mjs';
import { SEAL_PATTERN, docKind, orderLabel } from './parsers.mjs';
import { granuleDetailsUrl, packageModsUrl, GOVINFO_MASTERS } from './govinfo.mjs';
import { resolveRunDir, parseArgs, readJsonl } from './store.mjs';

const sha256 = x => createHash('sha256').update(x).digest('hex');
export const GOVINFO_CODEC = 'official-mdl-govinfo-listing-row/1';

export function buildRows({ runDir, key, rows: granules, summary, registered = new Set() }) {
  const out = [], held = [], skipped = [];
  for (const g of granules) {
    const text = g.mods?.docket_text ?? null;
    const label = text ? text : null;
    const kind = docKind(label);
    const order = orderLabel(label);
    const listing = {
      schema: GOVINFO_CODEC, mdl: g.mdl, court_id: g.court, page_url: granuleDetailsUrl(g.package_id, g.part), page_role: 'govinfo_granule', package_id: g.package_id, granule_id: g.granule_id, part: g.part,
      section: summary.package_title?.case_title ?? null, printed_title: label, printed_label: null, printed_date: g.mods?.date_issued ?? null, date_iso: g.mods?.date_issued ?? null, date_iso_basis: g.mods?.date_issued ? 'govinfo_mods_dateIssued' : null,
      doc_number: null, order_label_printed: order?.printed ?? null, order_kind: order?.kind ?? null, order_number: order?.number ?? null, doc_kind: kind, case_title_published: g.mods?.case_title ?? null,
      docket_number_published: g.mods?.docket_number_published ?? summary.package_title?.docket_number_published ?? null, court_name: g.mods?.court_name ?? null, href_as_printed: g.pdf_url, url: g.pdf_url, url_kind: 'pdf_direct',
    };
    const record = JSON.parse(JSON.stringify(listing));
    const recordSha = hashBytes(canonicalIntegerJson(record));
    if (g.problems?.length && g.problems.includes('premis_fixity_missing')) { held.push({ granule_id: g.granule_id, reason: 'premis_fixity_missing' }); continue; }
    if (text && SEAL_PATTERN.test(text)) { held.push({ granule_id: g.granule_id, reason: 'sealing_related_wording', matched: (SEAL_PATTERN.exec(text) ?? [])[0], printed_title: text.slice(0, 200), date_issued: g.mods?.date_issued ?? null }); continue; }
    if (registered.has(['govinfo', g.granule_id, g.native_case_id, recordSha].join('|'))) { skipped.push({ granule_id: g.granule_id, reason: 'already_registered_by_official_mdl_run' }); continue; }
    const caseKind = g.court === 'jpml' ? 'jpml_mdl_number_literal' : (GOVINFO_MASTERS.find(m => m.mdl === g.mdl)?.official_id ? 'matter_official_case_id' : 'govinfo_published_docket_number');
    const row = {
      schema_version: 'source-qualified-pdf-queue/1', provider: 'govinfo',
      native_document_id: g.granule_id, native_document_identity_kind: 'govinfo_granule_id',
      native_case_id: g.native_case_id, native_case_identity_kind: caseKind,
      durable_url: g.pdf_url, download_url: g.pdf_url, expected_sha1: null, expected_bytes: g.premis.bytes,
      title: text, filing_date: null, selected_source_record_sha256: recordSha,
      provider_flags: { sealing_related_locator_held: false, pdf_http_access_verified: false, pdf_content_verified: false },
      eligible: true, held_reason: null,
      source_claims: { matter_scope: 'mdl:' + g.mdl, source_document_label: text, index_date_printed: g.mods?.date_issued ?? null, index_date_iso: g.mods?.date_issued ?? null, index_date_iso_basis: g.mods?.date_issued ? 'govinfo_mods_dateIssued' : null,
        date_semantics: 'dateIssued of the granule as published by GPO in the package MODS', date_is_verified_native_filing_date: false, pdf_content_verified: false, source_metadata_only: true, provider_fixity_sha256: g.premis.sha256, provider_fixity_bytes: g.premis.bytes },
      scope_evidence: [{ evidence_kind: g.court === 'jpml' ? 'govinfo_jpml_package_mdl_number' : 'govinfo_package_docket_number', field: g.court === 'jpml' ? 'mdl_number_literal' : 'master_docket_literal', value: g.native_case_id,
        qualification: 'GovInfo package ' + g.package_id + ' (published docket number ' + (listing.docket_number_published ?? 'not recorded') + ')', source: { source_url: packageModsUrl(g.package_id), source_sha256: summary.mods?.sha256 ?? null, package_id: g.package_id } }],
      origins: [{ native_document_id: g.granule_id, native_case_id: g.native_case_id, native_record_sha256: recordSha, native_record_hash_codec: 'canonical-integer-jsonb/1',
        native_record_hash_serialization: 'canonical-integer-jsonb/1 of the ' + GOVINFO_CODEC + ' record (GPO MODS fields of the constituent, no party data)', native_record_identity_kind: 'govinfo_package_mods_constituent',
        source_url: packageModsUrl(g.package_id), source_sha256: summary.mods.sha256, source_response_sha256: summary.mods.sha256,
        source_response_hash_semantics: 'SHA256 of the UNCOMPRESSED package MODS response bytes as received; the private run dir keeps them gzip-compressed', http_status: summary.mods.status ?? 200, retrieved_at: summary.mods.retrieved_at,
        retrieved_at_basis: 'http_response_time_of_package_mods_capture', capture_file: path.join(runDir, summary.mods.body_file), capture_file_sha256: summary.mods.sha256,
        source_locator: { kind: 'mods_constituent', granule_id: g.granule_id, part: g.part }, listing: record,
        govinfo: { package_id: g.package_id, granule_id: g.granule_id, premis_url: summary.premis.file ? 'https://www.govinfo.gov/metadata/pkg/' + g.package_id + '/premis.xml' : null, premis_sha256: summary.premis.sha256, premis_retrieved_at: summary.premis.retrieved_at, provider_fixity_sha256: g.premis.sha256, provider_bytes: g.premis.bytes, fdsys_id: g.premis.fdsys_id } }],
      provenance: { adapter_version: 'official-mdl-govinfo-queue/1', matter: 'mdl:' + g.mdl, court_id: g.court, court_host: 'www.govinfo.gov', package_id: g.package_id, listing_record_codec: GOVINFO_CODEC, native_document_identity_is_source_locator: true,
        expected_pdf_checksum_and_size: 'size from GPO PREMIS; SHA-256 fixity compared by qa-govinfo.mjs', exact_official_host_allowlist: ['www.govinfo.gov'], new_api_requests: 0, pdf_transfers: 0 },
    };
    row.source_privacy_qualification = sourcePrivacyQualification(row);
    validateQueueRow(row);
    out.push(row);
  }
  return { rows: out, held, skipped };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolveRunDir(args['run-dir']);
  const keys = String(args.keys ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const batch = String(args.batch ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!keys.length || !batch) throw Error('--keys and --batch are required');
  const ledger = new Set(readJsonl(path.join(runDir, 'registered-official.jsonl')).filter(x => x.provider === 'govinfo').map(x => ['govinfo', x.native_document_id, x.native_case_id, x.record_sha256].join('|')));
  const all = [], heldAll = [], skippedAll = [], perKey = [];
  for (const key of keys) {
    const summaryFile = path.join(runDir, 'govinfo', 'listings', key + '.summary.json');
    if (!fs.existsSync(summaryFile)) { perKey.push({ key, error: 'no discovery summary' }); continue; }
    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    if (!summary.exists || !summary.granules) { perKey.push({ key, package_id: summary.package_id, exists: summary.exists, granules: 0, note: summary.note ?? summary.stopped_reason ?? null }); continue; }
    const granules = readJsonl(path.join(runDir, 'govinfo', 'listings', key + '.granules.jsonl'));
    const built = buildRows({ runDir, key, rows: granules, summary, registered: ledger });
    all.push(...built.rows); heldAll.push(...built.held.map(h => ({ key, ...h }))); skippedAll.push(...built.skipped.map(s => ({ key, ...s })));
    perKey.push({ key, package_id: summary.package_id, native_case_id: summary.native_case_id, granules: granules.length, queued: built.rows.length, held: built.held.length, skipped: built.skipped.length });
  }
  const queueDir = path.join(runDir, 'queues');
  fs.mkdirSync(queueDir, { recursive: true });
  const body = Buffer.from(all.map(r => JSON.stringify(r) + '\n').join(''));
  const queueFile = path.join(queueDir, `${batch}-govinfo.queue.jsonl`);
  fs.writeFileSync(queueFile, body, { flag: 'wx' });
  const manifest = { schema_version: 'official-mdl-queue-manifest/1', created_at: new Date().toISOString(), provider: 'govinfo', host: 'www.govinfo.gov', batch, queue: queueFile, sha256: sha256(body), bytes: body.length, records: all.length,
    matters: [...new Set(all.map(r => r.provenance.matter))], keys, urls: all.map(r => r.download_url), qualification: 'GovInfo USCOURTS granule PDFs (published court opinions/orders) listed by GPO PREMIS; held rows (sealing wording) are not queued. Bytes and SHA-256 are verified at transfer / by qa-govinfo.mjs.' };
  fs.writeFileSync(queueFile + '.manifest.json', JSON.stringify(manifest, null, 1) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(queueDir, `${batch}-govinfo-excluded.json`), JSON.stringify({ schema_version: 'official-mdl-queue-excluded/1', batch, held: heldAll, skipped: skippedAll }, null, 1) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ batch, queue: queueFile, rows: all.length, sha256: manifest.sha256, held: heldAll.length, skipped: skippedAll.length, per_key: perKey }, null, 1));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
