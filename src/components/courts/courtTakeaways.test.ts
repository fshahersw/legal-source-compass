import { describe, expect, it } from "vitest";
import { courtTakeaways, type CourtTakeawayInput } from "./courtTakeaways";

const base: CourtTakeawayInput = {
  yearLabel: "FY2025",
  priorLabel: "FY2024",
  plFilings: 45_713,
  plFilingsPrior: 55_869,
  plSharePct: 15.1,
  plShareSeries: [10, 20, 15.7, null],
  top5SharePct: 71.3,
  hhi: 1461,
  medianMonthsNational: 15.6,
  medianMonthsDistrict: 7.9,
  nationalSkewed: true,
  flagCount: 12,
  flaggedDistricts: 9,
};

describe("courtTakeaways", () => {
  it("states each figure with its comparison", () => {
    const items = courtTakeaways(base);
    expect(items.map((t) => t.id)).toEqual(["pl-filings", "pl-share", "top5", "months", "flags"]);
    expect(items[0]!.figure).toBe("−18.2%");
    expect(items[0]!.text).toContain("45,713");
    expect(items[0]!.text).toContain("55,869");
    expect(items[1]!.text).toContain("median year in this series is 15.7%");
    expect(items[2]!.text).toContain("HHI 1,461");
    expect(items[3]!.text).toContain("2.0×");
    expect(items[4]!.figure).toBe("12");
    expect(items[4]!.text).toContain("flags across 9 districts");
  });

  it("omits the change for the first year and the skew note when no docket dominates", () => {
    const items = courtTakeaways({
      ...base,
      priorLabel: null,
      plFilingsPrior: null,
      nationalSkewed: false,
    });
    expect(items.some((t) => t.id === "pl-filings")).toBe(false);
    expect(items.find((t) => t.id === "months")!.text).not.toContain("skews");
  });

  it("never invents a value for unknown inputs", () => {
    const items = courtTakeaways({
      ...base,
      plFilings: null,
      plSharePct: null,
      top5SharePct: null,
      medianMonthsNational: null,
      flagCount: 1,
      flaggedDistricts: 1,
    });
    // Only the flag count is left, and one takeaway is not shown as a summary.
    expect(items).toEqual([]);
  });
});
