import { describe, expect, it } from "vitest";
import { renderSectionContext } from "@/lib/assistant/sectionContext";
import { filingsContext } from "./courtAiContext";

const base = {
  years: [2023, 2024, 2025],
  totals: [210000, 241438, null] as (number | null)[],
  selected: 1,
  changePercent: 14.97,
  otherShare: 61.25,
  source: "Judicial Business of the United States Courts, Table C-11",
};

describe("filingsContext", () => {
  const text = renderSectionContext(filingsContext(base));

  it("lists each year's total with its unit and period, a gap as Not recorded", () => {
    expect(text).toContain("- Product liability filings: 210,000 cases (FY2023)");
    expect(text).toContain("- Product liability filings: 241,438 cases (FY2024)");
    expect(text).toContain("- Product liability filings: Not recorded (FY2025)");
  });
  it("prints the selected year's change with its sign and one decimal, and the share", () => {
    expect(text).toContain("- Change in filings, FY2024 on FY2023: +15.0%");
    expect(text).toContain("(365, 367), share of filings: 61.3% (FY2024)");
  });
  it("names the scope, the period range and the source", () => {
    expect(text).toContain("Scope: U.S. district courts");
    expect(text).toContain("Period: FY2023–FY2025");
    expect(text).toContain("Source: Judicial Business of the United States Courts, Table C-11");
  });
  it("leaves out a change or share the card does not show", () => {
    const bare = renderSectionContext(
      filingsContext({ ...base, changePercent: null, otherShare: null }),
    );
    expect(bare).not.toContain("Change in filings");
    expect(bare).not.toContain("share of filings");
  });
  it("has no prior year to name for the first year", () => {
    const first = renderSectionContext(filingsContext({ ...base, selected: 0 }));
    expect(first).not.toContain("Change in filings");
  });
});
