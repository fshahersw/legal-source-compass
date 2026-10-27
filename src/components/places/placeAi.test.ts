import { describe, expect, it } from "vitest";
import type { CountyAnalysis } from "@/lib/external/countyAnalysis.functions";
import type { StateAnalysis } from "@/lib/external/stateAnalysis.functions";
import { countyLegalFigures, mdlShareOfFilings, stateStandoutFigures } from "./placeAi";

// Middlesex County NJ as stored (county_legal_activity 34023, queried 2026-10-27).
const middlesex = {
  fips: "34023",
  usps: "NJ",
  name: "Middlesex County",
  state: "New Jersey",
  metrics: { fjc_rate: 1097.22, fjc_core_rate: 60.6, fjc_5y: 47891, fjc_core_5y: 2645, osha_rate: 12.1 },
  legal: { window: { mdl: 45053 }, screened: [] },
  stateDistributions: { fjc_core_rate: { n: 21, min: 30, p25: 40, median: 50, p75: 60, max: 90 } },
  stateValues: { fjc_core_rate: 62.3, fjc_rate: 176.95 },
  usValues: { fjc_core_rate: 55 },
} as unknown as CountyAnalysis;

describe("county legal AI context", () => {
  it("computes the MDL share of county-coded filings", () => {
    expect(mdlShareOfFilings(middlesex)).toBeCloseTo((45053 / 47891) * 100);
  });
  it("never sends the MDL-inflated rate", () => {
    const figs = countyLegalFigures(middlesex);
    const text = JSON.stringify(figs);
    expect(text).not.toContain("1,097");
    expect(text).not.toContain("1097");
    expect(text).not.toContain("176.95");
    expect(figs.some((f) => f.label.startsWith("Federal civil filings by residents (core)"))).toBe(true);
    expect(figs.find((f) => f.label.startsWith("Share of the county-coded filings"))?.value).toBe("94.1%");
  });
  it("leaves out a measure the record does not carry (unpublished product rate)", () => {
    expect(JSON.stringify(countyLegalFigures(middlesex))).not.toContain("Product-liability filings");
  });
});

describe("state stand-out AI context", () => {
  const a = {
    counties: 21,
    districts: [{}],
    testsRun: 84,
    testsHold: 20,
    standouts: [
      { kind: "county", text: "Middlesex has the highest federal civil filings by residents in the state.", metric: "fjc_rate", county: "34023", courtId: null },
      { kind: "county", text: "Essex has the highest OSHA inspection rate.", metric: "osha_rate", county: "34013", courtId: null },
    ],
    tests: [
      { x: "fjc_rate", y: "poverty_rate", label: "", rho: 0.9, n: 21, ci: null, p: 0.001, pBh: 0.002, holds: true, strength: null },
      { x: "cfpb_rate", y: "pct_black_nh", label: "", rho: 0.7, n: 21, ci: null, p: 0.001, pBh: 0.004, holds: true, strength: null },
      { x: "osha_rate", y: "poverty_rate", label: "", rho: 0.2, n: 21, ci: null, p: 0.4, pBh: 0.6, holds: false, strength: null },
    ],
  } as unknown as StateAnalysis;
  const figs = stateStandoutFigures(a);
  it("drops stand-outs and tests that use fjc_rate and keeps only holding tests", () => {
    const text = JSON.stringify(figs);
    expect(text).not.toContain("Middlesex has");
    expect(text).toContain("Essex has");
    expect(figs.filter((f) => f.label.startsWith("Spearman"))).toHaveLength(1);
  });
  it("frames associations as patterns, not causes, with n and adjusted p", () => {
    const t = figs.find((f) => f.label.startsWith("Spearman"))!;
    expect(t.note).toMatch(/n = 21 counties/);
    expect(t.note).toMatch(/BH-adjusted p 0.004/);
    expect(t.note).toMatch(/not a cause/);
  });
});
