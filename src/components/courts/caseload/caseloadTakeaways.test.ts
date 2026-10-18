import { describe, expect, it } from "vitest";
import type { CaseloadYear, DistrictRow } from "@/lib/external/courtCaseload.functions";
import { caseloadTakeaways } from "./caseloadTakeaways";

const year = (fy: number, over: Partial<CaseloadYear> = {}): CaseloadYear => ({
  fy,
  partial: false,
  filings: null,
  terminations: null,
  pendingEnd: null,
  medianDays: null,
  p25Days: null,
  p75Days: null,
  p90Days: null,
  classActionPct: null,
  proSePct: null,
  productPct: null,
  juryDemandedPct: null,
  settledPct: null,
  trialPct: null,
  withMdlNumber: null,
  mdlTransferIn: null,
  mdlOriginating: null,
  ...over,
});

const district = (
  id: string,
  name: string,
  filings: number | null,
  medianDays: number | null,
): DistrictRow => ({
  id,
  name: `District Court, ${name}`,
  state: "XX",
  circuitId: "ca1",
  circuit: "First Circuit",
  filings,
  terminations: null,
  pending: null,
  medianDays,
  classActionPct: null,
  proSePct: null,
  productPct: null,
  trialPct: null,
  hasCourtPage: true,
});

// Twelve districts: the ten busiest hold 1,000 + 900 + ... + 200 and two small ones hold 100 and 50.
const DISTRICTS = [
  district("a", "D. Alpha", 1000, 150),
  district("b", "D. Bravo", 900, 400),
  district("c", "D. Charlie", 800, 300),
  ...["d", "e", "f", "g", "h", "i", "j"].map((id, i) =>
    district(id, `D. ${id.toUpperCase()}`, 700 - i * 100, 250),
  ),
  district("k", "D. Kilo", 100, 120),
  district("l", "D. Lima", 50, null),
];

const NATIONAL = year(2025, {
  filings: 303716,
  pendingEnd: 432535,
  medianDays: 452,
  withMdlNumber: 34765,
});
const PRIOR = year(2024, { filings: 330000, pendingEnd: 400000 });

describe("caseloadTakeaways", () => {
  const items = caseloadTakeaways({
    fy: 2025,
    national: NATIONAL,
    nationalPrior: PRIOR,
    districts: DISTRICTS,
  });
  const byId = (id: string) => items.find((t) => t.id === id);

  it("computes each figure from the loaded rows and names the fiscal year", () => {
    expect(byId("filings-change")?.figure).toBe("−8.0%");
    expect(byId("filings-change")?.text).toContain("FY2025 (303,716) against 330,000 in FY2024");
    expect(byId("pending-change")?.figure).toBe("+8.1%");
    expect(byId("mdl-share")?.figure).toBe("11.4%");
    expect(byId("mdl-share")?.text).toContain("not JPML membership");
  });

  it("measures the ten busiest districts against the filings of the districts that report them", () => {
    const top = byId("top-ten")!;
    const all = DISTRICTS.reduce((a, d) => a + (d.filings ?? 0), 0);
    const ten = 1000 + 900 + 800 + 700 + 600 + 500 + 400 + 300 + 200 + 100;
    expect(top.figure).toBe(`${((100 * ten) / all).toFixed(1)}%`);
    expect(top.text).toContain("D. Alpha, D. Bravo and D. Charlie lead");
  });

  it("names the slowest and quickest medians among districts that record one, skipping the unrecorded", () => {
    const spread = byId("median-spread")!;
    expect(spread.figure).toBe("400 days");
    expect(spread.text).toContain("D. Bravo");
    expect(spread.text).toContain("120 days in D. Kilo");
    expect(spread.text).toContain("national median is 452 days");
  });

  it("links every takeaway to a section on the page", () => {
    expect(items.every((t) => t.anchor && t.anchorLabel)).toBe(true);
    expect(new Set(items.map((t) => t.anchor))).toEqual(
      new Set(["caseload-kpis", "caseload-districts"]),
    );
  });

  it("leaves out a takeaway whose inputs are unknown, and all of them when fewer than two remain", () => {
    const partialInput = caseloadTakeaways({
      fy: 2025,
      national: year(2025, { filings: 10 }),
      nationalPrior: null,
      districts: [],
    });
    expect(partialInput).toEqual([]);
    const noPrior = caseloadTakeaways({
      fy: 2025,
      national: NATIONAL,
      nationalPrior: null,
      districts: DISTRICTS,
    });
    expect(noPrior.map((t) => t.id)).toEqual(["top-ten", "median-spread", "mdl-share"]);
  });

  it("does not claim a ratio for a zero base", () => {
    const zero = caseloadTakeaways({
      fy: 2025,
      national: NATIONAL,
      nationalPrior: year(2024, { filings: 0, pendingEnd: 0 }),
      districts: DISTRICTS,
    });
    expect(zero.map((t) => t.id)).not.toContain("filings-change");
    expect(zero.map((t) => t.id)).not.toContain("pending-change");
  });

  it("needs ten districts before it ranks the ten busiest", () => {
    const few = caseloadTakeaways({
      fy: 2025,
      national: NATIONAL,
      nationalPrior: PRIOR,
      districts: DISTRICTS.slice(0, 5),
    });
    expect(few.map((t) => t.id)).not.toContain("top-ten");
  });
});
