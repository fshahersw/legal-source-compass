import { describe, expect, it } from "vitest";
import {
  datasetDisplayName,
  datasetPurpose,
  datasetRecordGrain,
  displayValue,
  fieldLabel,
  inventoryRecordTotal,
} from "./domainRegistry";

describe("domain registry", () => {
  it("never turns an unknown source-inventory count into zero or a partial known total", () => {
    expect(inventoryRecordTotal([{ records: 3 }, { records: null }])).toBeNull();
    expect(inventoryRecordTotal([{ records: 0 }, { records: 3 }])).toBe(3);
    expect(inventoryRecordTotal([])).toBe(0);
    expect(inventoryRecordTotal([{ records: Number.MAX_SAFE_INTEGER }, { records: 1 }])).toBeNull();
    expect(inventoryRecordTotal([{ records: -1 }])).toBeNull();
  });
  it("keeps dated FDA source grains separate from device and legal findings", () => {
    expect(datasetRecordGrain("agency_safety_openfda_device_classification_20261002")?.unit).toBe(
      "FDA product categories",
    );
    expect(
      datasetRecordGrain("agency_safety_openfda_device_classification_20261002")?.description,
    ).toContain("recall hazard class I/II/III");
    expect(datasetRecordGrain("agency_safety_openfda_device_enforcement")?.description).toContain(
      "not a current recall-lifecycle",
    );
    expect(datasetRecordGrain("agency_safety_openfda_device_recalls_20261002")).toBeNull();
    expect(datasetRecordGrain("mass_tort_authority_evidence")?.description).toContain(
      "not a case holding",
    );
    expect(datasetRecordGrain("jpml_html_reference")?.description).toContain(
      "Panel membership is not MDL judicial assignment",
    );
    expect(datasetDisplayName("jpml_html_reference")).toBe("JPML source reference metadata");
  });
  it("keeps people, positions, court locations and citations at their native count grains", () => {
    expect(datasetRecordGrain("cl_people")?.unit).toBe("native person reference records");
    expect(datasetRecordGrain("cl_positions")?.unit).toBe("position records");
    expect(datasetRecordGrain("cl_courthouses")?.unit).toBe("courthouse reference records");
    expect(datasetRecordGrain("cl_citation_edges")?.description).toContain(
      "do not establish positive treatment",
    );
    expect(datasetRecordGrain("unreviewed_future_dataset")).toBeNull();
    expect(datasetRecordGrain("constructor")).toBeNull();
    expect(datasetRecordGrain("ecfr_hierarchy")?.unit).toBe("publisher hierarchy nodes");
    expect(datasetRecordGrain("ecfr_authority_notes")?.unit).toBe(
      "selected XML metadata snapshots",
    );
    expect(datasetRecordGrain("cl_master_entries")?.unit).toBe(
      "native docket-entry metadata records",
    );
    expect(datasetRecordGrain("cl_master_entries")?.description).toContain(
      "does not establish MDL member status",
    );
  });
  it("gives important datasets clear names and purposes", () => {
    expect(datasetDisplayName("federal_regulations_parts", "federal_regulations_parts")).toBe(
      "CFR parts",
    );
    expect(datasetPurpose("mdl_docket_activity")).toBe("Activity");
    expect(datasetPurpose("cl_master_entries")).toBe("Activity");
    expect(datasetDisplayName("cl_master_entries")).toBe("Native master-docket entry metadata");
  });

  it("shows the label the corpus publishes, and keeps the fallback names truthful about the rows", () => {
    // Published label wins over the fallback table.
    expect(datasetDisplayName("mdls", "JPML multidistrict litigation")).toBe(
      "JPML multidistrict litigation",
    );
    expect(datasetDisplayName("mdl_appearances", " MDL counsel appearances ")).toBe(
      "MDL counsel appearances",
    );
    // A stored label that is just the raw id falls back.
    expect(datasetDisplayName("mdl_appearances", "mdl_appearances")).toBe(
      "MDL counsel appearances",
    );
    // The rows of these datasets are counsel appearances, consolidated profiles and keyword-scanned entries.
    expect(datasetDisplayName("mdl_appearances")).toBe("MDL counsel appearances");
    expect(datasetDisplayName("judge_entities")).toBe("Consolidated judge profiles");
    expect(datasetDisplayName("expert_rulings")).toBe(
      "Expert-admissibility docket entries (keyword scan)",
    );
  });

  it("keeps every unknown dataset reachable with readable fallbacks", () => {
    expect(datasetDisplayName("new_legal_rows", null)).toBe("New Legal Rows");
    expect(datasetPurpose("new_legal_rows")).toBe("Reference");
  });

  it("formats fields without changing stored values", () => {
    expect(fieldLabel("ecfr_url")).toBe("eCFR link");
    expect(fieldLabel("chapter_name")).toBe("Chapter Name");
    expect(displayValue("false")).toBe("No");
  });
});
