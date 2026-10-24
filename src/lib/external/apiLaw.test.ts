import { describe, expect, it } from "vitest";
import { API_LAW_DATASETS, searchPath } from "./apiLaw";

describe("law browser result order", () => {
  it("lists GovInfo packages by their date issued, newest first", () => {
    for (const dataset of ["govinfo_hearings", "govinfo_committee_prints", "govinfo_gao_reports"]) {
      const { path } = searchPath({ dataset, q: "", filters: {} });
      expect(path).toContain("&order=item->package->>dateIssued.desc.nullslast,ordinal.asc");
      expect(API_LAW_DATASETS[dataset]!.order?.label).toBe("newest issued first");
    }
  });

  it("keeps corpus order where no single date orders the records", () => {
    const { path } = searchPath({ dataset: "govinfo_bill_versions", q: "", filters: {} });
    expect(path.endsWith("&order=ordinal.asc")).toBe(true);
    expect(API_LAW_DATASETS["govinfo_bill_versions"]!.order).toBeUndefined();
  });

  it("orders word searches the same way", () => {
    const { path, mode } = searchPath({ dataset: "govinfo_hearings", q: "patent", filters: {} });
    expect(mode).toBe("words");
    expect(path).toContain("search_vector=fts(simple).");
    expect(path).toContain("order=item->package->>dateIssued.desc.nullslast");
  });
});
