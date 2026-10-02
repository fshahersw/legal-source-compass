/**
 * Port of corpussite `delivery/archive-directory/categories.py` (commit 9385b59).
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
  mixed: "Mixed legal resources",
  other: "Other / not matched by rule",
} as const;
export type CategoryId = keyof typeof CATEGORY_LABELS;

const STATUTES = new Set(["statutes", "statutory_provision", "law_chapter_body", "local_laws_codes", "county_ordinance_text", "municipal_code_of_ordinances_pdf", "unsigned_county_ordinance_text"]);
const FORMS = new Set(["court_form_or_other_document", "court_forms_filing_documents", "judicial_records_request_form", "document"]);
const GUIDANCE = new Set(["guidance", "administrative_guidance", "guideline", "faq", "memorandum", "irs_announcement", "irs_notice", "irs_rev_proc", "irs_rev_rul", "reference_original", "federal_legal_reference_resource", "doj_manual_resource", "federal_court_practice_or_case_resource"]);

/** Exact port of corpussite classify(kind). */
export function classify(kind: string | null | undefined): CategoryId {
  const v = (kind ?? "").toLowerCase();
  if (v.includes("constitution")) return "constitutions";
  if (v.includes("regulat") || v === "administrative_code") return "regulations";
  if (v.includes("rule") || v === "federal_order_document_link" || v === "executive_order") return "rules";
  if (STATUTES.has(v)) return "statutes";
  if (FORMS.has(v)) return "forms";
  if (GUIDANCE.has(v)) return "guidance";
  if (v === "legal_inventory_navigation" || v === "court_clerk_office" || ["directory", "website", "portal", "roster", "coverage_county"].some((p) => v.includes(p))) return "directories";
  return "other";
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

const KNOWN_KINDS = new Set([...STATUTES, ...FORMS, ...GUIDANCE, "constitutions", "state_constitution", "court_rules", "regulations", "administrative_code", "federal_order_document_link", "executive_order", "legal_inventory_navigation", "court_clerk_office"]);

/** Broad source groups derived from headings, not verified document types. Original headings stay intact. */
export function classifySource(headings: string[]): CategoryId[] {
  const out = new Set<CategoryId>();
  for (const h of headings) {
    const normalized = h.trim().replace(/\s+/g, " ");
    out.add(HEADING_CATEGORIES[normalized.toUpperCase()] ?? (KNOWN_KINDS.has(normalized.toLowerCase()) ? classify(normalized) : "other"));
  }
  if (out.size === 0) out.add("other");
  return [...out];
}
