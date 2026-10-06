import { describe, expect, it } from "vitest";
import { kindLabel, lawGroup, safetyAgency, safetyKind } from "./lawTree";
import { sectionOf } from "./groups";

// The law & safety dataset IDs present in the connected corpus (read 2026-09-30).
const LAW = [
  "citation_index",
  "citation_reference",
  "federal",
  "federal_register_history",
  "federal_regulations_documents",
  "federal_regulations_parts",
  "federal_regulations_sections",
  "indiana_code",
  "limitation_periods",
  "provider_laws",
  "public_laws",
  "sd_statutes",
  "state_codes",
];
const SAFETY = [
  "agency_safety_cpsc_recalls_local",
  "agency_safety_fda_press_recalls",
  "agency_safety_fda_warning_letters",
  "agency_safety_openfda_crl",
  "agency_safety_openfda_device_enforcement",
  "agency_safety_openfda_drug_enforcement",
  "agency_science_documents",
];

describe("law & safety folders", () => {
  it("puts every law dataset in exactly one folder", () => {
    for (const id of LAW) {
      expect(sectionOf(id)).toBe("law");
      expect(lawGroup(id)).toBeTruthy();
    }
    expect(lawGroup("federal_regulations_parts")).toBe("regulations");
    expect(lawGroup("public_laws")).toBe("statutes");
    expect(lawGroup("provider_laws")).toBe("state");
    expect(sectionOf("statutory_limitations_review")).toBe("law");
    expect(lawGroup("statutory_limitations_review")).toBe("reference");
    for (const id of [
      "cl_reporter_citations",
      "cl_citation_edges",
      "regulatory_backfill",
      "ecfr_hierarchy",
      "ecfr_authority_notes",
      "mass_tort_authority_evidence",
      "jpml_html_reference",
    ]) {
      expect(sectionOf(id)).toBe("law");
      expect(lawGroup(id)).toBe("reference");
    }
  });
  it("groups safety datasets by agency", () => {
    expect(sectionOf("agency_safety_openfda_device_classification_20261002")).toBe("safety");
    expect(safetyKind("agency_safety_openfda_device_classification_20261002")).toBe(
      "Device classifications",
    );
    expect(safetyKind("agency_safety_openfda_device_enforcement")).toBe("Device enforcement (openFDA)");
    for (const id of SAFETY) expect(sectionOf(id)).toBe("safety");
    expect(safetyAgency("agency_safety_cpsc_recalls_local")).toBe("CPSC");
    expect(safetyAgency("agency_safety_openfda_crl")).toBe("FDA");
    expect(safetyAgency("agency_science_documents")).toBe("Other");
    expect(safetyKind("agency_safety_openfda_drug_enforcement")).toBe("Drug enforcement (openFDA)");
    expect(safetyKind("agency_safety_cpsc_recalls_local")).toBe("Recalls");
    expect(kindLabel("irs_notice")).toBe("IRS notices");
  });
});
