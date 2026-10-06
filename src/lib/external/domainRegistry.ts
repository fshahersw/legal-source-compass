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
  federal_regulations_sections: "Directory",
  federal_regulations_parts: "Directory",
  federal_regulations_documents: "Documents",
  federal_register_history: "Activity",
  regulatory_backfill: "Reference",
  mass_tort_authority_evidence: "Reference",
  jpml_html_reference: "Reference",
  agency_safety_openfda_device_classification_20261002: "Reference",
  ecfr_hierarchy: "Reference",
  ecfr_authority_notes: "Reference",
  statutory_limitations_review: "Reference",
  cl_docket_metadata: "Reference",
  cl_master_entries: "Activity",
  cl_reporter_citations: "Reference",
  public_laws: "Documents",
  sources: "Directory",
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
  cl_people: "CourtListener people",
  judge_enrichment: "Judge profiles",
  judge_entities: "Consolidated judge profiles",
  judge_portraits: "Judge portraits",
  mdl_appearances: "MDL counsel appearances",
  mdls: "MDL directory",
  mdl_docket_activity: "Docket activity",
  mdl_docket_documents: "Docket documents",
  mdl_case_inventory: "Related cases",
  mdl_counsel: "Counsel",
  mdl_crosswalk: "Matter crosswalk",
  sw_matters_v1: "Seeger Weiss matter registry — MDL matters",
  sw_matter_dockets_v1: "Seeger Weiss matter registry — dockets in matters",
  settlements: "Settlements",
  verdict_reports: "Reported verdicts",
  expert_rulings: "Expert-admissibility docket entries (keyword scan)",
  state_proceedings: "State proceedings",
  counsel_directory: "Counsel directory",
  federal_regulations_sections: "CFR sections",
  federal_regulations_parts: "CFR parts",
  federal_regulations_documents: "CFR source documents",
  federal_register_history: "Federal Register history",
  public_laws: "Public laws",
  limitation_periods: "Historical limitations summaries",
  statutory_limitations_review: "Limitations calculator rule records",
  regulatory_backfill: "Federal Register metadata backfill",
  mass_tort_authority_evidence: "Selected mass-tort authority evidence",
  jpml_html_reference: "JPML source reference metadata",
  agency_safety_openfda_device_classification_20261002: "FDA device classifications",
  ecfr_hierarchy: "Dated eCFR hierarchy metadata",
  ecfr_authority_notes: "Selected eCFR authority and citation metadata",
  cl_docket_metadata: "Native docket metadata",
  cl_master_entries: "Native master-docket entry metadata",
  cl_reporter_citations: "Native reporter citations",
  citation_reference: "Citation reference",
  citation_index: "Citation index",
  agency_science_documents: "Agency science documents",
  saved_pages: "Saved source pages",
  source_documents: "Source documents",
  docsupload_coverage: "Document coverage",
  coverage_labels: "Coverage labels",
  coverage_topics: "Coverage topics",
};

const DESCRIPTIONS: Partial<Record<SectionId, string>> = {
  courts: "Court profiles, seals, statistics, forms, rules, and documents.",
  judges: "Judicial profiles, consolidated profile records, financial disclosures, and portraits.",
  matters:
    "MDLs, dockets, related cases, counsel and counsel appearances, settlements, verdicts, and expert-admissibility docket entries.",
  law: "Statutes, regulations, public laws, notices, limitation periods, and citations.",
  safety: "FDA and CPSC recalls, enforcement, and science records.",
  sources: "Source directories, captured pages, documents, coverage, and provenance.",
  other: "Additional imported corpus records that do not yet have a dedicated domain.",
};

/**
 * The label the corpus publishes for a dataset (`corpus_datasets.label`) is the source of truth and wins whenever the
 * caller has it. The table above is only the fallback for call sites that do not have the stored label and for a
 * stored label that is just the raw id, so a corrected label in the database never needs a code change.
 */
export function datasetDisplayName(id: string, storedLabel?: string | null) {
  const stored = storedLabel?.trim();
  if (stored && stored !== id) return stored;
  return LABELS[id] ?? datasetLabel(id, storedLabel);
}

export function datasetPurpose(id: string): DatasetPurpose {
  return PURPOSES[id] ?? (sectionOf(id) === "sources" ? "Source data" : "Reference");
}

/** Reviewed native record grains. Counts describe these rows, never an inferred person/court census. */
const RECORD_GRAINS: Readonly<Record<string, { unit: string; description: string }>> = {
  jpml_html_reference: {
    unit: "public HTML reference records",
    description:
      "Selected JPML panel-membership observations, statistical references and report locators retain their separate source kinds and dates. Panel membership is not MDL judicial assignment. July observations, linked October report locators and selected statistics do not establish a current or complete case census; linked report contents were not downloaded.",
  },
  mass_tort_authority_evidence: {
    unit: "selected source-evidence records",
    description:
      "Opinion bodies, federal provisions, research routes, access gaps and legislative-status evidence retain their separate source kinds. A research route or gap is not a case holding, binding-authority finding or activated calculator rule.",
  },
  agency_safety_openfda_device_classification_20261002: {
    unit: "FDA product categories",
    description:
      "Dated product-category metadata counts category codes, not individual devices, approvals or recalls. Device regulatory class 1/2/3 is separate from recall hazard class I/II/III; native flags and CFR locators do not establish historical or current legal applicability.",
  },
  agency_safety_openfda_device_enforcement: {
    unit: "native recall enforcement-report records",
    description:
      "FDA device enforcement reports retain their native recall tracking designation. Source status is not a current recall-lifecycle or public-alert finding; counts do not describe unique products, affected patients, liability or litigation membership.",
  },
  agency_safety_openfda_drug_enforcement: {
    unit: "native recall enforcement-report records",
    description:
      "FDA drug enforcement reports retain their native recall tracking designation. Source status is not a current recall-lifecycle or public-alert finding; counts do not describe unique products, affected patients, liability or litigation membership.",
  },
  ecfr_hierarchy: {
    unit: "publisher hierarchy nodes",
    description:
      "Dated headings, reserved nodes and appendices describe the publisher tree. Section-heading counts are not a census of current operative law; title currentness and received_on values are not provision effective dates.",
  },
  ecfr_authority_notes: {
    unit: "selected XML metadata snapshots",
    description:
      "Dated authority, source and section-citation notes retain their publisher context, including a separate historical snapshot. These selected metadata excerpts do not establish case applicability or binding authority.",
  },
  judges: {
    unit: "profile records",
    description:
      "Consolidated profiles and official-source profiles remain separate. Recorded geography and service history do not establish current service or governing law.",
  },
  judge_entities: {
    unit: "consolidated profile records",
    description:
      "Consolidated entity profiles retain their source evidence. This is not a census of currently serving judges.",
  },
  people: {
    unit: "native person reference records",
    description:
      "Source-native person IDs include historical biographies and aliases. Different IDs remain distinct; the count is not a verified unique-person or current-judge census.",
  },
  cl_people: {
    unit: "native person reference records",
    description:
      "Source-native person IDs include historical biographies and aliases. Different IDs remain distinct; the count is not a verified unique-person or current-judge census.",
  },
  cl_positions: {
    unit: "position records",
    description:
      "Native employment/service positions may have multiple rows per person, including historical and nonjudicial positions. Position counts are not judge counts.",
  },
  cl_educations: {
    unit: "education records",
    description:
      "Native education rows may have multiple entries per person. These counts describe education records, not people or schools.",
  },
  cl_schools: {
    unit: "school reference records",
    description:
      "Source-native school IDs describe institutional references, not enrollment, education events or unique people.",
  },
  court_spine: {
    unit: "court registry records",
    description:
      "The source registry includes historical and other court references. Its size does not establish the number of currently operating courts.",
  },
  cl_courts: {
    unit: "native court reference records",
    description:
      "Source-native court IDs include historical or inactive references. Current operation and precedential hierarchy require separate source evidence.",
  },
  cl_courthouses: {
    unit: "courthouse reference records",
    description:
      "Courthouse location records are separate from court identities; several locations can refer to one court.",
  },
  cl_court_appeals_to: {
    unit: "directed appellate relationship records",
    description:
      "Recorded appeals-to links describe native court relationships. They do not establish the binding effect or treatment of a particular decision.",
  },
  cl_docket_metadata: {
    unit: "native docket metadata records",
    description:
      "Approved source-native docket IDs retain their recorded metadata and explicit FJC MDL selection. This coverage is not a complete member-case census or a determination of governing law.",
  },
  cl_master_entries: {
    unit: "native docket-entry metadata records",
    description:
      "Privacy-reviewed entry IDs retain their native docket, filing date, entry number and document locators. A master-docket association does not establish MDL member status, a complete docket history or a legal outcome; document bytes are not included.",
  },
  cl_reporter_citations: {
    unit: "reporter citation records",
    description:
      "Reporter locators are separate from opinions; an opinion can have several citation records. Citation counts do not establish precedential weight.",
  },
  court_forms_expansion_20260912: {
    unit: "saved document records",
    description:
      "The source collection includes forms and supporting instructions. Source document-type labels and capture dates do not establish current applicability or effective dates.",
  },
};

export function datasetRecordGrain(id: string): { unit: string; description: string } | null {
  return Object.hasOwn(RECORD_GRAINS, id) ? RECORD_GRAINS[id]! : null;
}

/** Inventory rows across separate datasets/snapshots; never a unique-entity census. */
export function inventoryRecordTotal(
  datasets: readonly { records: number | null }[],
): number | null {
  let total = 0;
  for (const dataset of datasets) {
    if (dataset.records == null || !Number.isSafeInteger(dataset.records) || dataset.records < 0)
      return null;
    total += dataset.records;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
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
  if (value == null || value.trim() === "") return "Not recorded";
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  return value;
}
