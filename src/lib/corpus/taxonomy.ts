/**
 * Reviewed successor to corpussite `delivery/archive-directory/categories.py` (commit 9385b59).
 * Technical record kinds and human source headings have different vocabularies.
 * Source headings use an explicit crosswalk; broad topics are not inferred types.
 */
export const CATEGORY_LABELS = {
  statutes: "Statutes & codes",
  rules: "Rules & orders",
  constitutions: "Constitutions",
  regulations: "Regulations",
  forms: "Forms & documents",
  guidance: "Guides & references",
  directories: "Courts & directories",
  opinions: "Case law & decisions",
  dockets: "Dockets & case systems",
  settlements: "Settlements & recoveries",
  safety: "Safety & scientific evidence",
  enforcement: "Administrative enforcement",
  data: "Data & download systems",
  mixed: "Mixed legal resources",
  other: "Other / not matched by rule",
} as const;
export type CategoryId = keyof typeof CATEGORY_LABELS;
export const TAXONOMY_VERSION = "2026-10-06.3";

const STATUTES = new Set([
  "statutes",
  "statutory_provision",
  "law_chapter_body",
  "local_laws_codes",
  "county_ordinance_text",
  "municipal_code_of_ordinances_pdf",
  "unsigned_county_ordinance_text",
]);
const FORMS = new Set([
  "court_form_or_other_document",
  "court_forms_filing_documents",
  "judicial_records_request_form",
  "document",
]);
const GUIDANCE = new Set([
  "guidance",
  "administrative_guidance",
  "guideline",
  "faq",
  "memorandum",
  "irs_announcement",
  "irs_notice",
  "irs_rev_proc",
  "irs_rev_rul",
  "reference_original",
  "federal_legal_reference_resource",
  "doj_manual_resource",
  "federal_court_practice_or_case_resource",
]);

/** Exact observed vocabularies and documented record kinds; unknown values stay unmatched. */
export function classify(kind: string | null | undefined): CategoryId {
  const v = (kind ?? "").trim().toLowerCase();
  const recorded = mappedCategory(RECORD_CATEGORIES, v);
  if (recorded) return recorded;
  const heading = mappedCategory(HEADING_CATEGORIES, v.replace(/\s+/g, " ").toUpperCase());
  if (heading) return heading;
  if (["constitution", "constitutions", "state_constitution", "federal_constitution"].includes(v))
    return "constitutions";
  if (
    [
      "regulation",
      "regulations",
      "administrative_code",
      "regulatory_provision",
      "federal_regulation",
    ].includes(v)
  )
    return "regulations";
  if (
    [
      "rule",
      "rules",
      "court_rule",
      "court_rules",
      "federal_order_document_link",
      "executive_order",
    ].includes(v)
  )
    return "rules";
  if (STATUTES.has(v)) return "statutes";
  if (FORMS.has(v)) return "forms";
  if (GUIDANCE.has(v)) return "guidance";
  if (
    [
      "legal_inventory_navigation",
      "court_clerk_office",
      "directory",
      "court_directory",
      "court_website",
      "court website",
      "agency_website",
      "portal",
      "roster",
      "coverage_county",
    ].includes(v)
  )
    return "directories";
  return "other";
}

/** Only explicit crosswalk keys match; inherited object properties are not source categories. */
function mappedCategory(
  map: Readonly<Record<string, CategoryId>>,
  key: string,
): CategoryId | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

/** Exact, reviewable crosswalk for the supplied heading vocabulary. No keyword guesses. */
export const HEADING_CATEGORIES: Record<string, CategoryId> = {
  "STATE LEGAL RESOURCES --- ALL 50 STATES + DC (FULL DOJ JMD RESOURCE TREES)": "mixed",
  "STATUTES, CONSTITUTION & LEGISLATION": "mixed",
  "FEDERAL CASE LAW, COURTS & PROCEDURE": "mixed",
  "FEDERAL LEGAL RESEARCH & SPECIAL COLLECTIONS": "mixed",
  "REGULATIONS & RULEMAKING": "regulations",
  "FEDERAL COURTS OF APPEALS (BY CIRCUIT)": "directories",
  "U.S. TERRITORIES --- COURTS, BARS, LEGISLATURES & AGENCIES": "directories",
  "STATE LAW DIRECTORIES": "directories",
  "50-STATE CIVIL-LIABILITY & PROCEDURAL-TRIGGER COVERAGE GUIDE": "guidance",
  "50-STATE REGULATORY-EVIDENCE COVERAGE GUIDE": "guidance",
  "JURY INSTRUCTIONS & TRIAL-PRACTICE FINDING AIDS": "guidance",
};

const KNOWN_KINDS = new Set([
  ...STATUTES,
  ...FORMS,
  ...GUIDANCE,
  "constitutions",
  "state_constitution",
  "court_rules",
  "regulations",
  "administrative_code",
  "federal_order_document_link",
  "executive_order",
  "legal_inventory_navigation",
  "court_clerk_office",
]);

/** Content/resource vocabularies observed in the uploaded catalog and Registry V2.2.
 * Registry sourceType (official-primary, nonprofit, etc.) describes the publisher,
 * not the resource type, and deliberately does not appear in this crosswalk.
 */
export const RESOURCE_CATEGORIES: Readonly<Record<string, CategoryId>> = {
  uncategorized: "other",
  court_forms: "forms",
  court_rules: "rules",
  opinions_decisions: "opinions",
  regulations_register: "regulations",
  statutes_codes: "statutes",
  settlement_agreements: "settlements",
  efiling_cmecf: "dockets",
  docket_access: "dockets",
  enforcement_actions: "enforcement",
  facility_provider_data: "directories",
  attorney_admission_discipline: "mixed",
  agency_guidance: "guidance",
  judge_pages: "directories",
  public_records_foia: "mixed",
  jury_instructions: "guidance",
  data_portal: "data",
  lien_msp: "mixed",
  standing_orders: "rules",
  licensing_verification: "directories",
  api: "data",
  self_help_pro_se: "guidance",
  recall_safety_data: "safety",
  adverse_event_data: "safety",
  bulk_data: "data",
  ethics_professional_resp: "mixed",
  corporate: "directories",
  "landing-page": "other",
  "court-opinion": "opinions",
  "statute-code": "statutes",
  regulation: "regulations",
  "court-form": "forms",
  "enforcement-index": "enforcement",
  "mdl-resource": "mixed",
  "jury-instruction-set": "guidance",
  "facility-search": "directories",
  "court-rule": "rules",
  "license-lookup": "directories",
  "insurance-filing": "forms",
  "administrative-decision": "opinions",
  "scientific-evidence": "safety",
  archive: "data",
  "corporate-registry": "directories",
  "search-system": "data",
  "settlement-recovery": "settlements",
  directory: "directories",
  "public-records": "mixed",
  "standing-order": "rules",
  "judge-practice": "guidance",
  "ucc-search": "data",
  dataset: "data",
};

/** Explicit corpus record vocabulary. Indexes and summaries retain their own grain;
 * a notice or proposed rule is not classified as operative regulation. */
export const RECORD_CATEGORIES: Readonly<Record<string, CategoryId>> = {
  ...RESOURCE_CATEGORIES,
  statutes: "statutes",
  constitutions: "constitutions",
  rules: "rules",
  regulations: "regulations",
  forms: "forms",
  guidance: "guidance",
  directories: "directories",
  settlements: "settlements",
  opinions: "opinions",
  dockets: "dockets",
  safety: "safety",
  enforcement: "enforcement",
  data: "data",
  mixed: "mixed",
  other: "other",
  agency_safety: "safety",
  openfda_device_classification_metadata: "data",
  mass_tort_authority_evidence: "mixed",
  jpml_html_reference: "mixed",
  agency_science_documents: "safety",
  citation_index: "data",
  citation_reference: "guidance",
  biographical_reference: "directories",
  historical_biography: "directories",
  judicial_service: "directories",
  counsel_directory: "directories",
  county_directory: "directories",
  court_contact: "directories",
  court_documents: "mixed",
  court_form: "forms",
  court_information: "guidance",
  court_orders_index: "data",
  court_reference: "directories",
  court_spine: "directories",
  court_staff: "directories",
  court_statistics: "data",
  docsupload_coverage: "data",
  expert_rulings: "opinions",
  federal_register_history: "mixed",
  ecfr_hierarchy: "data",
  ecfr_authority_notes: "data",
  fee_schedule: "guidance",
  filing_guidance: "guidance",
  indiana_code: "statutes",
  judge_profile: "directories",
  judges: "directories",
  limitation_periods: "guidance",
  statutory_limitations_review: "guidance",
  local_rule: "rules",
  mdl_appearances: "dockets",
  mdl_case_inventory: "dockets",
  docket_metadata: "dockets",
  master_docket_entry: "dockets",
  mdl_counsel: "directories",
  mdl_crosswalk: "data",
  mdl_docket_activity: "dockets",
  mdl_docket_documents: "dockets",
  multidistrict_litigation: "mixed",
  order_denying_transfer: "rules",
  order_vacating_conditional_transfer: "rules",
  public_laws: "statutes",
  saved_pages: "other",
  sd_statutes: "statutes",
  source_directory: "directories",
  source_documents: "mixed",
  standing_order: "rules",
  state_codes: "statutes",
  state_proceedings: "dockets",
  transfer_order: "rules",
  uscourts_pages: "mixed",
  verdict_reports: "data",
};

/** Harmless presentation differences share one filter identity; source bytes remain untouched. */
export function headingIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Broad source groups derived from headings, not verified document types. Original headings stay intact. */
export function classifySource(headings: string[]): CategoryId[] {
  const out = new Set<CategoryId>();
  for (const h of headings) {
    const normalized = h.trim().replace(/\s+/g, " ");
    out.add(
      mappedCategory(HEADING_CATEGORIES, normalized.toUpperCase()) ??
        mappedCategory(RESOURCE_CATEGORIES, normalized.toLowerCase()) ??
        (KNOWN_KINDS.has(normalized.toLowerCase()) ? classify(normalized) : "other"),
    );
  }
  if (out.size === 0) out.add("other");
  return [...out];
}
