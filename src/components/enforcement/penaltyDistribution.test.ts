import { describe, expect, it } from "vitest";
import {
  dojSizeCallout,
  dojSizeYears,
  epaPenaltySizes,
  median,
} from "./penaltyDistribution";

describe("dojSizeYears", () => {
  const years = dojSizeYears(
    [
      {
        year: "2025",
        count: 1000,
        amount: { under_1m: 50, "1m_plus": 30, "10m_plus": 15, "100m_plus": 4, "1b_plus": 1, none: 900 },
      },
      { year: "2024", count: 800, amount: { under_1m: 10, "1m_plus": 10, none: 780 } },
      {
        year: "2026",
        count: 300,
        amount: { under_1m: 5, "1m_plus": 5, "10m_plus": 0, "100m_plus": 0, "1b_plus": 0 },
      },
    ],
    2026,
  );

  it("sorts by year and marks the unfinished year", () => {
    expect(years.map((y) => [y.year, y.partial])).toEqual([
      ["2024", false],
      ["2025", false],
      ["2026", true],
    ]);
  });

  it("computes shares of releases that state a figure, excluding releases with none", () => {
    const y = years[1]!;
    expect(y.withFigure).toBe(100);
    expect(y.shares).toEqual({
      under_1m: 50,
      "1m_plus": 30,
      "10m_plus": 15,
      "100m_plus": 4,
      "1b_plus": 1,
    });
    expect(y.noFigure).toBe(900);
  });

  it("leaves a year's shares unknown when a band is not recorded, never zero-filled", () => {
    const y = years[0]!;
    expect(y.withFigure).toBeNull();
    expect(y.counts["10m_plus"]).toBeNull();
    expect(Object.values(y.shares).every((v) => v === null)).toBe(true);
  });

  it("headlines the latest complete year with known shares", () => {
    expect(dojSizeCallout(years)).toEqual({
      year: "2025",
      withFigure: 100,
      tenMillionPlus: 20,
      sharePct: 20,
    });
  });
});

describe("epaPenaltySizes", () => {
  const base = { states: ["TX"], nationalCase: null };
  const rows = [
    { ...base, caseNumber: "A", name: "A", typeCode: "JDC", fedPenalty: 2_000_000, settlementFy: 2020 },
    { ...base, caseNumber: "B", name: "B", typeCode: "AFR", fedPenalty: 150_000, settlementFy: 2021 },
    { ...base, caseNumber: "C", name: "C", typeCode: "AFR", fedPenalty: 250_000, settlementFy: 2022 },
    { ...base, caseNumber: "D", name: "D", typeCode: "JDC", fedPenalty: 50_000_000, settlementFy: 2023 },
    { ...base, caseNumber: "E", name: "E", typeCode: "JDC", fedPenalty: 900_000, settlementFy: null },
    { ...base, caseNumber: "F", name: "F", typeCode: "AFR", fedPenalty: 400_000, settlementFy: 2010 },
    // One national case split across two regional records: counts once at the combined penalty.
    {
      caseNumber: "N1",
      name: "National",
      typeCode: "JDC",
      fedPenalty: 60_000_000,
      settlementFy: 2024,
      states: ["CA"],
      nationalCase: { lead: "N1", records: ["N1", "N2"], combined: 120_000_000 },
    },
    {
      caseNumber: "N2",
      name: "National (region 2)",
      typeCode: "AFR",
      fedPenalty: 60_000_000,
      settlementFy: 2024,
      states: ["TX"],
      nationalCase: { lead: "N1", records: ["N1", "N2"], combined: 120_000_000 },
    },
  ];

  it("bins by log decade, splits by case type and merges national cases", () => {
    const r = epaPenaltySizes(rows, { fromFy: 2017, toFy: 2025 });
    expect(r.bins.map((b) => [b.id, b.judicial, b.administrative, b.total])).toEqual([
      ["100k", 0, 2, 2],
      ["1m", 1, 0, 1],
      ["10m", 1, 0, 1],
      ["100m", 1, 0, 1],
    ]);
    expect(r.mergedNational).toBe(1);
    expect(r.cases.find((c) => c.key === "N1")).toMatchObject({
      penalty: 120_000_000,
      type: "judicial",
      records: 2,
      name: "National",
    });
    expect(r.unsettled).toBe(1);
    expect(r.count).toEqual({ judicial: 3, administrative: 2, other: 0, all: 5 });
  });

  it("takes medians from the records themselves", () => {
    const r = epaPenaltySizes(rows, { fromFy: 2017, toFy: 2025 });
    expect(r.median.administrative).toBe(200_000);
    expect(r.median.judicial).toBe(50_000_000);
    expect(r.median.all).toBe(2_000_000);
    expect(r.median.other).toBeNull();
  });

  it("filters to cases with a facility in the chosen state", () => {
    const r = epaPenaltySizes(rows, { fromFy: 2017, toFy: 2025, state: "CA" });
    expect(r.count.all).toBe(1);
    expect(r.cases[0]!.key).toBe("N1");
  });

  it("median of an even list averages the middle pair", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
