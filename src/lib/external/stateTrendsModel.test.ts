import { describe, expect, it } from "vitest";
import { parseCfpbYears, parseOshaYears } from "./stateTrendsModel";

describe("parseCfpbYears", () => {
  const raw = [
    { year: "2011", complete: false, complaints: 2, per_100k: null, population: null },
    {
      year: "2024",
      complete: true,
      complaints: 815,
      per_100k: 138.91,
      population: 586722,
      population_vintage: "Vintage 2025",
    },
    {
      year: "2023",
      complete: true,
      complaints: 622,
      per_100k: 106.39,
      population: 584666,
      population_vintage: "Vintage 2025",
    },
    { year: "2026", complete: false, complaints: 1400, per_100k: null, population: null },
    { year: "x", complete: true, complaints: 5 },
    { year: "2022", complete: true, complaints: -3 },
  ];
  it("keeps complete years only, oldest first", () => {
    const years = parseCfpbYears(raw);
    expect(years.map((y) => y.year)).toEqual([2023, 2024]);
    expect(years[1]).toEqual({
      year: 2024,
      complaints: 815,
      per100k: 138.91,
      population: 586722,
      vintage: "Vintage 2025",
    });
  });
  it("keeps a missing rate as null, not zero", () => {
    expect(parseCfpbYears([{ year: "2012", complete: true, complaints: 72 }])[0]).toMatchObject({
      per100k: null,
      population: null,
    });
  });
  it("is empty for malformed input", () => {
    expect(parseCfpbYears("nope")).toEqual([]);
    expect(parseCfpbYears(null)).toEqual([]);
  });
});

describe("parseOshaYears", () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({
    fy: 2006 + i,
    inspections: 100 + i,
    federal: 90 + i,
    state_plan: 0,
  }));
  it("stops at the latest complete fiscal year and keeps the last years", () => {
    const years = parseOshaYears(raw, 2025, 15);
    expect(years).toHaveLength(15);
    expect(years.at(-1)).toEqual({ fy: 2025, inspections: 119, federal: 109, statePlan: 0 });
    expect(years[0]!.fy).toBe(2011);
  });
  it("has no series without a latest complete year", () => {
    expect(parseOshaYears(raw, null)).toEqual([]);
    expect(parseOshaYears("x", 2025)).toEqual([]);
  });
  it("drops a year with no inspection count", () => {
    expect(parseOshaYears([{ fy: 2024 }, { fy: 2023, inspections: 4 }], 2025)).toEqual([
      { fy: 2023, inspections: 4, federal: null, statePlan: null },
    ]);
  });
});
