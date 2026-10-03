// Shared helpers for the Seeger Weiss matter registry (contract sw-matter-registry/1).
import { createHash } from 'node:crypto';
import { canonicalIntegerJson } from '../admin/local-catalog-evidence-contract.mjs';

export const REGISTRY_SOURCE = 'sw-matter-registry';
export const REGISTRY_SCHEMA = 'sw-matter-registry/1';
export const sha256 = x => createHash('sha256').update(x).digest('hex');
export const canon = canonicalIntegerJson;
export const canonSha = data => sha256(canonicalIntegerJson(data));

/** 2-digit year rule of the contract: 00-69 -> 20yy, 70-99 -> 19yy. */
export function year4(y) {
  const s = String(y);
  if (s.length === 4) return Number(s);
  const n = Number(s);
  return n < 70 ? 2000 + n : 1900 + n;
}

/** Parse a docket number as recorded by CourtListener/court pages: "4:22-cv-00401", "1:23-cv-00818-XYZ", "2:18-md-02846-EAS-KAJ". */
export function parseDocketNumber(value) {
  const m = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2}|\d{4})\s*-?\s*([A-Za-z]{2,4})\s*-?\s*(\d{1,6})(?:-[A-Za-z]{2,5})*$/);
  if (!m) return null;
  return { office: String(Number(m[1])), year: year4(m[2]), type: m[3].toLowerCase(), seq: String(Number(m[4])).padStart(5, '0') };
}

/** docket_key = <court>:<office>:<yyyy>-<type>-<seq5> (DocketBird id with the first '-' replaced by ':'). */
export function docketKey(court, parts) {
  if (!court || !parts) return null;
  return `${court}:${parts.office}:${parts.year}-${parts.type}-${parts.seq}`;
}
export function docketKeyFromNumber(court, number) { return docketKey(court, parseDocketNumber(number)); }

/** DocketBird id "cand-4:2022-md-03047" -> parts. */
export function parseDocketbirdId(id) {
  const m = String(id ?? '').match(/^([a-z]+)-(\d{1,2}):(\d{4})-([a-z]{2,4})-(\d{3,6})$/);
  if (!m) return null;
  const parts = { office: String(Number(m[2])), year: Number(m[3]), type: m[4], seq: m[5].padStart(5, '0') };
  return { court_id: m[1], ...parts, docket_key: docketKey(m[1], parts), docket_number: `${parts.office}:${String(parts.year).slice(2)}-${parts.type}-${parts.seq}` };
}
export const docketbirdIdFromKey = key => { const m = String(key).match(/^([a-z]+):(.*)$/); return m ? `${m[1]}-${m[2]}` : null; };
export const docketNumberFromKey = key => { const m = String(key).match(/^[a-z]+:(\d+):(\d{4})-([a-z]+)-(\d{5})$/); return m ? `${m[1]}:${m[2].slice(2)}-${m[3]}-${m[4]}` : null; };
export const courtOfKey = key => String(key).split(':')[0];

export function evidenceId(parts) { return sha256(canonicalIntegerJson(parts)); }

/** Build a registry entity envelope accepted by public.corpus_registry_intake_v1 (mode sw-registry). */
export function registryRow(entityType, nativeId, data, { sourceUrl, retrievedAt, sourceSha256 = null, sourceAsOf = null, extra = {} }) {
  const provenance = { source_url: sourceUrl, retrieved_at: retrievedAt, record_sha256: canonSha(data), builder: 'members-registry/1', ...extra };
  if (sourceSha256) provenance.source_sha256 = sourceSha256;
  if (sourceAsOf) provenance.source_as_of = sourceAsOf;
  return { schema_version: REGISTRY_SCHEMA, source_system: REGISTRY_SOURCE, entity_type: entityType, native_id: nativeId, data, provenance };
}

/** Primary role precedence for a docket within a matter. */
export const ROLE_ORDER = ['master', 'jpml_panel', 'transferee', 'transferor', 'member', 'associated_unspecified', 'not_member', 'unknown'];
export const primaryRole = roles => ROLE_ORDER.find(r => roles.includes(r)) ?? 'unknown';

export const ROLE_LABEL = {
  master: 'MDL master docket', jpml_panel: 'JPML panel proceeding', transferee: 'Transferee-court docket of a transferred action', transferor: 'Transferor (originating) docket',
  member: 'MDL member case', associated_unspecified: 'MDL-associated docket (role not stated)', not_member: 'Not transferred (order denying transfer or vacating a CTO)', unknown: 'Role not recorded',
};
export const EVIDENCE_LABEL = {
  docketbird_relationship: 'Provider-reported (DocketBird)', jpml_schedule_a: 'JPML order, Schedule A', jpml_cto_schedule: 'JPML conditional transfer order schedule',
  docket_transfer_entry: 'Docket entry', native_crosswalk: 'Firm dataset crosswalk', fjc_idb_mdl_number: 'Historical administrative (FJC IDB)',
  identity_resolution: 'Identity (exact court + number)', master_party_case_reference: 'Master docket party list (case number named)', jpml_master_docket_list: 'JPML master docket list', docketbird_is_mdl_master: 'Provider-reported master (DocketBird)',
  cl_docket_header: 'CourtListener docket header', docketbird_search_exact: 'Provider search (DocketBird, exact)', transfer_denied: 'Panel order denying transfer',
};
