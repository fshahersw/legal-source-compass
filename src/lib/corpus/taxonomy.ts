/**
 * Port of corpussite `delivery/archive-directory/categories.py` (commit 9385b59).
 * The same rule is applied to V2.2A heading-category text. Anything the rule
 * does not recognise lands in "other" and is labelled as not matched — never guessed.
 */
export const CATEGORY_LABELS = {
  statutes: "Statutes & codes",
  rules: "Rules & orders",
  constitutions: "Constitutions",
  regulations: "Regulations",
  forms: "Forms & documents",
  guidance: "Guides & references",
  directories: "Courts & directories",
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

/** Categories for a source: the rule applied to each of its imported heading categories. */
export function classifySource(headings: string[]): CategoryId[] {
  const out = new Set<CategoryId>();
  for (const h of headings) out.add(classify(h));
  if (out.size === 0) out.add("other");
  return [...out];
}
