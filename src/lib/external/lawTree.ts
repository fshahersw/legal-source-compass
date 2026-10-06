/** Pure folder mapping for Law & Safety. Unmapped dataset IDs fall into "other" so nothing is hidden. */

export type LawGroup =
  "statutes" | "regulations" | "register" | "notices" | "reference" | "state" | "other";

export const LAW_GROUP_LABELS: Record<LawGroup, string> = {
  statutes: "Statutes",
  regulations: "Regulations",
  register: "Federal Register",
  notices: "Agency notices",
  reference: "Reference tools",
  state: "State code datasets",
  other: "Other law records",
};

/** State code for state-specific law datasets (only where the dataset itself is one state's code). */
export const STATE_DATASETS: Record<string, string> = { indiana_code: "IN", sd_statutes: "SD" };

export function lawGroup(id: string): LawGroup {
  if (id === "public_laws") return "statutes";
  if (id.startsWith("federal_regulations_")) return "regulations";
  if (id === "federal_register_history") return "register";
  if (id === "federal") return "notices";
  if (id === "ecfr_hierarchy" || id === "ecfr_authority_notes") return "reference";
  if (
    id === "citation_index" ||
    id === "citation_reference" ||
    id === "limitation_periods" ||
    id === "statutory_limitations_review" ||
    id === "cl_reporter_citations" ||
    id === "cl_citation_edges" ||
    id === "regulatory_backfill" ||
    id === "mass_tort_authority_evidence" ||
    id === "jpml_html_reference"
  )
    return "reference";
  if (id in STATE_DATASETS || id === "state_codes") return "state";
  return "other";
}

/** These datasets contain individual law provisions. Reference indexes open as records. */
export const PROVISION_DATASETS = [
  "indiana_code",
  "sd_statutes",
  "federal_regulations_sections",
] as const;
export const isProvisionDataset = (id: string): id is (typeof PROVISION_DATASETS)[number] =>
  (PROVISION_DATASETS as readonly string[]).includes(id);

/** Provision kinds → readable type of law. */
const KIND_LABELS: Record<string, string> = {
  constitutions: "Constitution",
  statutes: "Statutes",
  regulations: "Regulations",
  court_rules: "Court rules",
  guidance: "Guidance",
  administrative_guidance: "Administrative guidance",
  executive_order: "Executive orders",
  faq: "FAQs",
  guideline: "Guidelines",
  irs_announcement: "IRS announcements",
  irs_notice: "IRS notices",
  irs_rev_proc: "IRS revenue procedures",
  irs_rev_rul: "IRS revenue rulings",
  memorandum: "Memoranda",
};
export const kindLabel = (k: string) =>
  KIND_LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export type SafetyAgency = "FDA" | "CPSC" | "Other";
export function safetyAgency(id: string): SafetyAgency {
  if (id.includes("cpsc")) return "CPSC";
  if (id.includes("fda")) return "FDA";
  return "Other";
}

/** Readable record kind from a safety dataset ID, e.g. agency_safety_openfda_drug_enforcement → "Drug enforcement (openFDA)". */
export function safetyKind(id: string): string {
  const datedLabels: Record<string, string> = {
    agency_safety_openfda_device_classification_20261002: "Device classifications",
    agency_safety_openfda_device_enforcement_20260928:
      "Device enforcement metadata (September 28, 2026)",
    agency_safety_openfda_drug_enforcement_20260928:
      "Drug enforcement metadata (September 28, 2026)",
    agency_safety_openfda_device_recalls_20261002: "Device recall metadata (October 2, 2026)",
  };
  if (Object.hasOwn(datedLabels, id)) return datedLabels[id]!;
  let s = id.replace(/^agency_safety_/, "").replace(/_local$/, "");
  const open = s.startsWith("openfda_");
  s = s
    .replace(/^openfda_/, "")
    .replace(/^fda_/, "")
    .replace(/^cpsc_/, "");
  const fix: Record<string, string> = {
    crl: "complete response letters",
    pma: "PMA approvals",
    drugsfda: "Drugs@FDA approvals",
    orangebook: "Orange Book",
  };
  const words = s
    .split("_")
    .map((w) => fix[w] ?? w)
    .join(" ");
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return open ? `${label} (openFDA)` : label;
}
