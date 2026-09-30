import { describe, expect, it } from "vitest";
import { datasetDisplayName, datasetPurpose, displayValue, fieldLabel } from "./domainRegistry";

describe("domain registry", () => {
  it("gives important datasets clear names and purposes", () => {
    expect(datasetDisplayName("federal_regulations_parts", "federal_regulations_parts")).toBe("CFR parts");
    expect(datasetPurpose("mdl_docket_activity")).toBe("Activity");
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