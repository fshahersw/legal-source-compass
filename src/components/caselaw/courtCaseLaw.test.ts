import { describe, expect, it } from "vitest";
import { normalizeCourtCases, normalizeDirectory, tierTotals, yearSeries } from "./courtCaseLaw";
import type { CourtOption } from "@/lib/external/caselaw.functions";

const court = (
  id: string,
  tier: CourtOption["tier"],
  cases: number,
  withText: number | null,
  jur: string | null = null,
): CourtOption => ({
  courtId: id,
  tier,
  name: id,
  shortName: null,
  cases,
  casesWithText: withText,
  level: null,
  system: null,
  jurisdiction: jur,
  parentCourtId: null,
  citationString: null,
  url: null,
});

describe("court case-law helpers", () => {
  it("normalizes the directory and court-page URL state", () => {
    expect(normalizeDirectory({ tier: "4", jur: "TX" })).toEqual({ tier: 4, jur: "TX" });
    expect(normalizeDirectory({ tier: 9, jur: "tx" })).toEqual({});
    expect(normalizeCourtCases({ year: "2016", sort: "cited", page: "3" })).toEqual({
      year: 2016,
      sort: "cited",
      page: 3,
    });
    expect(normalizeCourtCases({ year: 99, sort: "best", page: 1 })).toEqual({});
  });
  it("sums tiers and keeps an unknown text count unknown", () => {
    const t = tierTotals([court("a", 4, 10, 8, "TX"), court("b", 4, 5, 5), court("c", 5, 3, null)]);
    expect(t).toEqual([
      { tier: 4, courts: 2, cases: 15, withText: 13 },
      { tier: 5, courts: 1, cases: 3, withText: null },
    ]);
  });
  it("lays out every year between the first and last, split by stored text", () => {
    const s = yearSeries({
      court: null,
      available: true,
      undated: 2,
      years: [
        { year: 2014, cases: 3, withText: 1 },
        { year: 2016, cases: 2, withText: 2 },
      ],
    });
    expect(s?.keys).toEqual(["2014", "2015", "2016"]);
    expect(s?.withText.map((p) => p.value)).toEqual([1, 0, 2]);
    expect(s?.noText.map((p) => p.value)).toEqual([2, 0, 0]);
    expect(yearSeries({ court: null, available: true, undated: 0, years: [] })).toBeNull();
  });
});
