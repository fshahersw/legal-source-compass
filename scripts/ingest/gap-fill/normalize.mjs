// Source records -> corpus_ingest rows and per-field gap candidates.
// CourtListener rows are verbatim API objects in the existing `courtlistener-rest-v4.7/1` envelope (so the existing
// corpus_registry_intake_v1 'courtlistener-rest' mode accepts them). DocketBird REST rows use the new
// `docketbird-rest/1` namespace (database/contracts/corpus-gapfill-docketbird-rest-v1.sql).
import {canonicalIntegerJson, sha256, sanitizeUrl, isDisplayWithheld, isBlank, docketKeyFromDocketBirdId, docketKey} from './lib.mjs';

export const CL_SCHEMA = 'courtlistener-rest-v4.7/1';
export const DB_SCHEMA = 'docketbird-rest/1';

export function clRow(entityType, item, receipt, extra = {}) {
  if (item?.id === undefined || item?.id === null) throw new Error(`Missing native ID in ${entityType}`);
  return {schema_version: CL_SCHEMA, source_system: 'courtlistener', entity_type: entityType, native_id: String(item.id), data: item,
    provenance: {source_url: receipt.source_url, retrieved_at: receipt.retrieved_at, http_status: receipt.http_status, source_sha256: receipt.source_sha256,
      schema_version: CL_SCHEMA, request_method: 'GET', record_sha256: sha256(JSON.stringify(item)), ...extra}};
}

const dbProv = (receipt, tool, caseId, extra = {}) => ({source_url: receipt.source_url.split('?')[0], request: receipt.source_url, retrieved_at: receipt.retrieved_at,
  http_status: receipt.http_status, source_sha256: receipt.source_sha256, schema_version: DB_SCHEMA, source_tool: tool, source_tool_case_id: caseId, ...extra});

function intOrNull(v) { return Number.isSafeInteger(v) ? v : null; }

/** DocketBird case header. `client_code` is the account's own internal reference, not a court record, so it is never copied. */
export function dbCaseRow(header, receipt, {complaint = null} = {}) {
  const data = {id: header.id, title: header.title ?? null, court_id: header.court_id ?? null, case_number: header.case_number ?? null,
    date_filed: header.date_filed ?? null, court_case_url: sanitizeUrl(header.url).url ?? null, pacer_case_id: header.pacer_case_id ?? null,
    complaint_document_id: complaint?.complaint_document_id ?? null, complaint_status: complaint?.complaint_status ?? null,
    docket_key: docketKeyFromDocketBirdId(header.id)};
  const field_map = Object.fromEntries(Object.keys(data).map(k => [k, `docketbird.case.${k === 'court_case_url' ? 'url' : k}`]));
  return {schema_version: DB_SCHEMA, source_system: 'docketbird-rest', entity_type: 'case', native_id: header.id, data,
    provenance: dbProv(receipt, 'GET /documents', header.id, {record_sha256: sha256(canonicalIntegerJson(data)), record_sha256_codec: 'canonical-integer-jsonb/1',
      field_map, excluded_source_fields: ['client_code']})};
}

/**
 * DocketBird docket-sheet row. The signed S3 query (AWS access key id, signature, expiry) is removed before anything is
 * stored; `docketbird_object_name` is the stored object's own file name from that URL path, nothing is downloaded.
 * Titles that are restricted, unknown-seal or mention sealed/in camera/ex parte/redacted are flagged display_withheld.
 */
export function dbDocumentRow(caseId, doc, receipt) {
  if (typeof doc.id !== 'string' || !doc.id.startsWith(caseId + '-')) throw new Error('Docket document identity mismatch');
  const stored = sanitizeUrl(doc.docketbird_document_url);
  let objectName = null;
  if (stored.url) { try { objectName = decodeURIComponent(new URL(stored.url).pathname.split('/').pop()) || null; } catch { objectName = null; } }
  const pacer = sanitizeUrl(doc.pacer_document_url), court = sanitizeUrl(doc.court_document_url);
  const data = {id: doc.id, case_id: caseId, title: doc.title ?? null, filing_date: doc.filing_date ?? null, restricted: typeof doc.restricted === 'boolean' ? doc.restricted : null,
    docket_sheet_number: intOrNull(doc.primary_docket_sheet_number), pacer_document_url: pacer.url, court_document_url: court.url,
    downloaded_by_provider: doc.downloaded === 1 ? true : doc.downloaded === 0 ? false : null, docketbird_object_name: objectName,
    display_withheld: isDisplayWithheld({restricted: doc.restricted, text: doc.title})};
  const field_map = {id: 'docketbird.documents[].id', title: 'docketbird.documents[].title', filing_date: 'docketbird.documents[].filing_date', restricted: 'docketbird.documents[].restricted',
    docket_sheet_number: 'docketbird.documents[].primary_docket_sheet_number', pacer_document_url: 'docketbird.documents[].pacer_document_url', court_document_url: 'docketbird.documents[].court_document_url',
    downloaded_by_provider: 'docketbird.documents[].downloaded', docketbird_object_name: 'docketbird.documents[].docketbird_document_url (path only)'};
  return {schema_version: DB_SCHEMA, source_system: 'docketbird-rest', entity_type: 'docket-document', native_id: doc.id, data,
    provenance: dbProv(receipt, 'GET /documents', caseId, {record_sha256: sha256(canonicalIntegerJson(data)), record_sha256_codec: 'canonical-integer-jsonb/1', field_map,
      signed_query_removed: stored.removed || pacer.removed || court.removed, pdf_downloaded: false})};
}

/** Fields a baseline matter/docket row can be compared on, taken from a CourtListener docket object. */
export function clDocketFields(d) {
  return {case_name: d.case_name_full || d.case_name, court_id: d.court_id, docket_number: d.docket_number, date_filed: d.date_filed, date_terminated: d.date_terminated};
}
export function dbCaseFields(h) { return {case_name: h.title, court_id: h.court_id, date_filed: h.date_filed}; }

/** Baseline matter index keyed by provider-neutral docket key; duplicate keys are marked ambiguous and never matched. */
export function indexBaselineByDocketKey(rows) {
  const idx = new Map();
  for (const r of rows) {
    const key = docketKey(r.court_id, r.docket_number);
    if (!key) continue;
    idx.set(key, idx.has(key) ? {ambiguous: true} : {row: r, source: r.source ?? 'baseline'});
  }
  return idx;
}

export const blankFields = (obj, fields) => fields.filter(f => isBlank(obj?.[f]));
