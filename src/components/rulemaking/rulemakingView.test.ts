import { describe, expect, it } from "vitest";
import { parseActivity } from "@/lib/external/rulemaking.functions";
import { lastYearVsAverage, monthlyRows, yearlyRows } from "./rulemakingView";

const raw = {
  slug: "food-and-drug-administration",
  short: "FDA",
  name: "Food and Drug Administration",
  yearly: {
    RULE: {
      "2019": 10,
      "2020": 10,
      "2021": 10,
      "2022": 10,
      "2023": 10,
      "2024": 10,
      "2025": 20,
      "2026": 5,
    },
    PRORULE: { "2025": 4 },
    NOTICE: { "2025": 100, bogus: 4 },
  },
  monthly: { RULE: { "2026-09": 2, "2026-10": 1 }, PRORULE: {}, NOTICE: {} },
  significantYearly: { RULE: { "2025": 3 }, PRORULE: {} },
  significantFinalRulesTotal: 249,
  latestSignificantRules: [
    {
      title: "A rule",
      date: "2026-10-13",
      url: "https://www.federalregister.gov/documents/x",
      cfr: ["21 CFR 101"],
    },
    { title: "Not an FR link", date: "2026-10-13", url: "https://example.com/x" },
  ],
  partialMonth: "2026-10",
  partialYear: "2026",
  flags: {
    RULE: {
      recent: 30,
      baselineAnnual: 10,
      ratio: 3,
      window: "w",
      baselineWindow: "b",
      surprise: 6,
      flag: "surge",
    },
  },
};

describe("rulemaking activity", () => {
  const a = parseActivity(raw)!;
  it("keeps only well-formed series keys and Federal Register links", () => {
    expect(a.yearly.NOTICE).toEqual({ "2025": 100 });
    expect(a.latestSignificantRules.map((r) => r.title)).toEqual(["A rule"]);
    expect(a.flags.RULE?.flag).toBe("surge");
    expect(parseActivity({ short: "X" })).toBeNull();
  });
  it("excludes the partial current year from yearly trends", () => {
    expect(yearlyRows(a, 2019).map((r) => r.year)).not.toContain("2026");
    expect(yearlyRows(a, 2019).at(-1)).toMatchObject({ year: "2025", RULE: 20, significant: 3 });
  });
  it("marks the partial current month", () => {
    expect(monthlyRows(a).at(-1)).toMatchObject({ month: "2026-10", partial: true });
  });
  it("compares the last complete year with the prior five-year average", () => {
    expect(lastYearVsAverage(a.yearly.RULE, a.partialYear)).toMatchObject({
      year: "2025",
      value: 20,
      avg5: 10,
      ratio: 2,
    });
  });
});
