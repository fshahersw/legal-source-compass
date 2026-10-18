import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  median,
  normalizeCompany,
  parseAdverse,
  parseManufacturer,
  parsePopulation,
  parseState,
  pearson,
  sameCompany,
} from "./openPayments.functions";

describe("normalizeCompany (same rule as scripts/enrichment/open_payments/names.py)", () => {
  it("ignores case, punctuation, initial spacing and legal-form suffixes", () => {
    expect(normalizeCompany("C. R. BARD, INC. & SUBSIDIARIES")).toBe("CR BARD");
    expect(normalizeCompany("C.R. Bard, Inc")).toBe("CR BARD");
    expect(normalizeCompany("C R BARD INCORPORATED")).toBe("CR BARD");
    expect(normalizeCompany("Boston Scientific Corporation")).toBe("BOSTON SCIENTIFIC");
    expect(normalizeCompany("ACME L.L.C.")).toBe("ACME");
    expect(normalizeCompany("Johnson & Johnson")).toBe("JOHNSON AND JOHNSON");
  });
  it("keeps distinct businesses distinct", () => {
    expect(normalizeCompany("MEDTRONIC USA, INC.")).not.toBe(normalizeCompany("MEDTRONIC, INC."));
    expect(normalizeCompany("C. R. BARD INC. (BASD)")).not.toBe(
      normalizeCompany("C. R. BARD, INC."),
    );
    expect(normalizeCompany("INC")).toBe("INC");
    expect(normalizeCompany(null)).toBe("");
  });
});

describe("sameCompany", () => {
  it("requires matching legal forms when both names carry one", () => {
    expect(sameCompany("Stryker Corp", "STRYKER CORPORATION")).toBe(true);
    expect(sameCompany("C R BARD", "C. R. BARD, INC. & SUBSIDIARIES")).toBe(true);
    expect(sameCompany("BIOSENSE WEBSTER LTD", "BIOSENSE WEBSTER, INC.")).toBe(false);
    expect(sameCompany("Medtronic plc", "MEDTRONIC, INC.")).toBe(false);
    expect(sameCompany("MEDTRONIC USA, INC.", "MEDTRONIC, INC.")).toBe(false);
    expect(sameCompany("", "")).toBe(false);
  });
});

describe("statistics", () => {
  it("computes Pearson r and refuses degenerate input", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it("computes medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

const goodManufacturer = {
  entityId: "100000000057",
  name: "C. R. BARD, INC. & SUBSIDIARIES",
  rank: 12,
  totals: { general: 10, research: 5, generalRecords: 3, researchRecords: 1 },
  years: [
    {
      year: 2025,
      general: 6,
      generalRecords: 2,
      research: 5,
      researchRecords: 1,
      source: "summary",
    },
    {
      year: 2017,
      general: 4,
      generalRecords: 1,
      research: 0,
      researchRecords: 0,
      source: "archive",
    },
    { year: 2018, general: 1, source: "guessed" },
  ],
  nature: [
    { code: "1", label: "Consulting Fee", amount: 7, records: 2 },
    { label: "", amount: 3 },
  ],
  states: [
    { state: "PA", amount: 6, records: 1 },
    { state: "Pennsylvania", amount: 1 },
  ],
  sourceUrl: "javascript:alert(1)",
  sources: [
    { label: "CMS", url: "https://openpaymentsdata.cms.gov/x" },
    { label: "bad", url: "http://x" },
  ],
};

describe("stored record validation", () => {
  it("keeps valid fields, drops malformed rows and unsafe links", () => {
    const m = parseManufacturer("op-100000000057", goodManufacturer)!;
    expect(m.years.map((y) => y.year)).toEqual([2017, 2025]);
    expect(m.nature).toHaveLength(1);
    expect(m.states).toEqual([{ state: "PA", amount: 6, records: 1 }]);
    expect(m.sourceUrl).toBe("https://openpaymentsdata.cms.gov/");
    expect(m.sources).toHaveLength(1);
    expect(m.deviceShare).toBeNull();
  });
  it("rejects records without identity or totals", () => {
    expect(parseManufacturer("x", { ...goodManufacturer, entityId: "abc" })).toBeNull();
    expect(parseManufacturer("x", { ...goodManufacturer, totals: { general: 1 } })).toBeNull();
    expect(parseManufacturer("x", null)).toBeNull();
  });
  it("never reports a count for an unmatched MAUDE search", () => {
    const a = parseAdverse({
      entityId: "1",
      name: "X",
      matched: false,
      total: 0,
      years: [{ year: 2024, reports: 0 }],
      seriesUrl: "https://api.fda.gov/x",
    })!;
    expect(a.total).toBeNull();
    expect(a.years).toEqual([]);
    expect(a.seriesUrl).toBeNull();
    expect(parseAdverse({ entityId: "1", name: "X" })).toBeNull();
    const b = parseAdverse({
      entityId: "2",
      name: "Y",
      matched: true,
      total: 40,
      coverage: 1.4,
      denominator: 30,
      years: [
        { year: 2024, reports: 30, denominator: 40, coverage: 0.75 },
        { year: 2025, reports: 10, denominator: 5, coverage: 2 },
      ],
      ambiguous: [{ name: "Y CO", owners: ["2", "3"] }, { owners: [] }],
    })!;
    expect(b.coverage).toBeNull();
    expect(b.years.map((y) => y.coverage)).toEqual([0.75, null]);
    expect(b.ambiguous).toEqual([{ name: "Y CO", owners: ["2", "3"] }]);
  });
  it("parses state records and population series defensively", () => {
    const s = parseState({
      state: "CA",
      name: "California",
      years: [
        { year: 2024, general: 1, source: "summary" },
        { year: "2023", source: "summary" },
      ],
      nature: [{ label: "Food and Beverage", amount: 1 }],
      natureByYear: { "2024": [{ label: "Gift", amount: 2 }], bad: [] },
      reportingEntities: { "2024": 1800, x: 1 },
    })!;
    expect(s.years).toHaveLength(1);
    expect(Object.keys(s.natureByYear)).toEqual(["2024"]);
    expect(s.reportingEntities).toEqual({ "2024": 1800 });
    expect(parsePopulation([{ usps: "CA", population: { "2024": 39000000, "2025": -1 } }])).toEqual(
      {
        CA: { "2024": 39000000 },
      },
    );
    expect(parsePopulation([{ usps: "California", population: { "2024": 1 } }])).toBeNull();
  });
});
