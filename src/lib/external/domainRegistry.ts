import { datasetLabel, sectionOf, type SectionId } from "./groups";

export type DatasetPurpose =
  "Directory" | "Documents" | "Activity" | "Analysis" | "Reference" | "Source data";

const PURPOSES: Record<string, DatasetPurpose> = {
  court_spine: "Directory",
  court_reference: "Directory",
  court_statistics: "Analysis",
  court_documents: "Documents",
  court_forms_expansion_20260912: "Documents",
  judges: "Directory",
  judge_enrichment: "Reference",
  judge_disclosures: "Documents",
  judge_entities: "Reference",
  judge_portraits: "Documents",
  mdls: "Directory",
  mdl_docket_activity: "Activity",
  mdl_docket_documents: "Documents",
  mdl_case_inventory: "Directory",
  mdl_counsel: "Directory",
  settlements: "Analysis",
  verdict_reports: "Analysis",
  expert_rulings: "Analysis",
  open_us_law: "Directory",
  federal_regulations_sections: "Directory",
  federal_regulations_parts: "Directory",
  federal_regulations_documents: "Documents",
  federal_register_history: "Activity",
  regulatory_backfill: "Reference",
  statutory_limitations_review: "Reference",
  cl_docket_metadata: "Reference",
  cl_reporter_citations: "Reference",
  cl_citation_edges: "Reference",
  public_laws: "Documents",
  sources: "Directory",
  url_directory: "Directory",
  saved_pages: "Documents",
  source_documents: "Documents",
};

const LABELS: Record<string, string> = {
  court_spine: "Court directory",
  court_reference: "Court profiles & seals",
  court_statistics: "Court statistics",
  court_documents: "Court documents",
  court_forms_expansion_20260912: "Court forms",
  uscourts_pages: "U.S. Courts pages",
  judges: "Judge directory",
  judge_enrichment: "Judge profiles",
  judge_disclosures: "Financial disclosures",
  judge_entities: "Judge relationships",
  judge_portraits: "Judge portraits",
  mdl_appearances: "Judge MDL appearances",
  mdls: "MDL directory",
  mdl_docket_activity: "Docket activity",
  mdl_docket_documents: "Docket documents",
  mdl_case_inventory: "Related cases",
  mdl_counsel: "Counsel",
  mdl_crosswalk: "Matter crosswalk",
  settlements: "Settlements",
  verdict_reports: "Reported verdicts",
  expert_rulings: "Expert rulings",
  state_proceedings: "State proceedings",
  counsel_directory: "Counsel directory",
  open_us_law: "U.S. law collection",
  federal_regulations_sections: "CFR sections",
  federal_regulations_parts: "CFR parts",
  federal_regulations_documents: "CFR source documents",
  federal_register_history: "Federal Register history",
  public_laws: "Public laws",
  limitation_periods: "Limitation periods",
  statutory_limitations_review: "Cited limitations rules",
  regulatory_backfill: "Federal Register metadata backfill",
  cl_docket_metadata: "Native docket metadata",
  cl_reporter_citations: "Native reporter citations",
  cl_citation_edges: "Directed citation mentions",
  citation_reference: "Citation reference",
  citation_index: "Citation index",
  cpsc_injury_data: "CPSC injury data",
  agency_science_documents: "Agency science documents",
  url_directory: "URL directory",
  saved_pages: "Saved source pages",
  source_documents: "Source documents",
  docsupload_coverage: "Document coverage",
  coverage_labels: "Coverage labels",
  coverage_topics: "Coverage topics",
  library_assets: "Library files",
};

const DESCRIPTIONS: Partial<Record<SectionId, string>> = {
  courts: "Court profiles, seals, statistics, forms, rules, and documents.",
  judges: "Judicial profiles, disclosures, relationships, portraits, and matter appearances.",
  matters: "MDLs, dockets, related cases, counsel, settlements, verdicts, and experts.",
  law: "Statutes, regulations, public laws, notices, limitation periods, and citations.",
  safety: "FDA and CPSC recalls, enforcement, science, and injury records.",
  sources: "Source directories, captured pages, documents, coverage, and provenance.",
  other: "Additional imported corpus records that do not yet have a dedicated domain.",
};

export function datasetDisplayName(id: string, storedLabel?: string | null) {
  return LABELS[id] ?? datasetLabel(id, storedLabel);
}

export function datasetPurpose(id: string): DatasetPurpose {
  return PURPOSES[id] ?? (sectionOf(id) === "sources" ? "Source data" : "Reference");
}

export function sectionDescription(section: SectionId) {
  return DESCRIPTIONS[section] ?? DESCRIPTIONS.other ?? "Imported corpus records.";
}

export function fieldLabel(key: string) {
  const aliases: Record<string, string> = {
    ecfr_url: "eCFR link",
    source_url: "Source link",
    photo_url: "Portrait",
    court_id: "Court ID",
    judge_id: "Judge ID",
    mdl_no: "MDL number",
    in_slice: "Included in source slice",
    mdls: "MDL appearances",
    judge_links: "Linked judges",
    counsel_directory: "Counsel",
    docket_activity: "Docket activity",
  };
  if (aliases[key]) return aliases[key];
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bCl\b/g, "CourtListener")
    .replace(/\bFjc\b/g, "FJC")
    .replace(/\bJpml\b/g, "JPML")
    .replace(/\bMdls?\b/g, (m) => m.toUpperCase())
    .replace(/\bNid\b/g, "ID")
    .replace(/\bId\b/g, "ID");
}

export function displayValue(value: string | undefined) {
  if (value == null || value === "") return "—";
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  return value;
}
