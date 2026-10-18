import { describe, expect, it } from "vitest";
import type { MetricDef, StateProfile } from "@/lib/external/stateMetrics.functions";
import { parseMetric, parseProfile, parseSeries } from "@/lib/external/stateMetrics.functions";
import {
  changePct,
  commonYear,
  correlationLabel,
  formatValue,
  histogram,
  leastSquares,
  median,
  pearson,
  rankStates,
  stdev,
} from "./stateMetricsMath";

const profile = (usps: string, fips: string, series: StateProfile["series"]): StateProfile => ({
  usps,
  fips,
  name: usps,
  series,
  latest: {},
  notes: {},
  overdose12mo: {},
});

const def = (key: string, partial: Record<string, string> = {}): MetricDef =>
  ({ key, partialYears: partial, latestYear: null }) as unknown as MetricDef;

describe("formatValue", () => {
  it("formats each unit and never invents a value", () => {
    expect(formatValue(30861292, "money_m")).toBe("$30.86T");
    expect(formatValue(339035.1, "money_m")).toBe("$339.0B");
    expect(formatValue(65286.4, "dollars")).toBe("$65,286");
    expect(formatValue(4, "pct")).toBe("4.0%");
    expect(formatValue(44.94, "rate")).toBe("44.9");
    expect(formatValue(5193088, "int")).toBe("5,193,088");
    expect(formatValue(null, "int")).toBe("Not recorded");
    expect(formatValue(Number.NaN, "rate")).toBe("Not recorded");
  });
});

describe("statistics", () => {
  it("computes Pearson r and the least-squares line", () => {
    expect(
      pearson([
        [1, 2],
        [2, 4],
        [3, 6],
      ]),
    ).toBeCloseTo(1, 10);
    expect(
      pearson([
        [1, 3],
        [2, 2],
        [3, 1],
      ]),
    ).toBeCloseTo(-1, 10);
    expect(
      pearson([
        [1, 1],
        [2, 1],
        [3, 1],
      ]),
    ).toBeNull();
    expect(
      pearson([
        [1, 1],
        [2, 2],
      ]),
    ).toBeNull();
    const fit = leastSquares([
      [0, 1],
      [1, 3],
      [2, 5],
    ]);
    expect(fit?.slope).toBeCloseTo(2);
    expect(fit?.intercept).toBeCloseTo(1);
    expect(correlationLabel(0.82)).toBe("strong positive");
    expect(correlationLabel(-0.3)).toBe("weak negative");
    expect(correlationLabel(null)).toBe("Not computable");
  });

  it("median, population SD and 5-year change", () => {
    expect(median([3, 1, 2, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(changePct({ "2019": 100, "2024": 125 }, 2024)).toBe(25);
    expect(changePct({ "2024": 125 }, 2024)).toBeNull();
    expect(changePct({ "2019": 0, "2024": 1 }, 2024)).toBeNull();
  });

  it("ranks highest first with shared ties and flags |z| > 2", () => {
    const states = [
      ...Array.from({ length: 10 }, (_, i) =>
        profile(`S${i}`, String(i).padStart(2, "0"), { m: { "2024": 10 } }),
      ),
      profile("HI", "15", { m: { "2024": 100, "2019": 50 } }),
      profile("NA", "16", { other: { "2024": 1 } }),
    ];
    const ranked = rankStates(states, "m", 2024);
    expect(ranked).toHaveLength(11);
    expect(ranked[0]).toMatchObject({ usps: "HI", rank: 1, outlier: "high", change5: 100 });
    expect(ranked[1]!.rank).toBe(2);
    expect(ranked.at(-1)!.rank).toBe(2);
    expect(ranked.filter((r) => r.outlier)).toHaveLength(1);
  });

  it("picks the latest common full year and builds a histogram", () => {
    const states = Array.from({ length: 31 }, (_, i) =>
      profile(`S${i}`, String(i), {
        x: { "2023": i, "2024": i, "2025": i },
        y: { "2023": i, "2024": i, "2026": i },
      }),
    );
    expect(commonYear(states, def("x"), def("y"))).toBe(2024);
    expect(commonYear(states, def("x"), def("y", { "2024": "partial" }))).toBe(2023);
    const bins = histogram([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(8);
    expect(bins[0]!.from).toBe(1);
    expect(bins.at(-1)!.to).toBe(8);
  });
});

describe("stored JSON validation", () => {
  it("drops malformed series values and metrics", () => {
    expect(parseSeries({ "2024": 5, "2025": "6", x: 1, "2023": Number.NaN })).toEqual({
      "2024": 5,
    });
    expect(parseMetric({ key: "Bad Key", label: "x", format: "int" })).toBeNull();
    expect(parseMetric({ key: "ok", label: "OK", format: "weird" })).toBeNull();
    const m = parseMetric({
      key: "ok",
      label: "OK",
      format: "rate",
      years: [2010, 2025],
      sources: [
        { url: "http://insecure", name: "x" },
        { url: "https://a.gov/x", name: "A" },
      ],
      distribution: { "2024": { n: 51, median: 1, p25: 0.5, p75: 2 }, "2025": { n: 1 } },
    });
    expect(m?.sources).toHaveLength(1);
    expect(Object.keys(m!.distribution)).toEqual(["2024"]);
    expect(m?.years).toEqual([2010, 2025]);
  });

  it("rejects profiles without a valid state identity", () => {
    expect(parseProfile({ usps: "ca", fips: "06", name: "California" })).toBeNull();
    const p = parseProfile({
      usps: "CA",
      fips: "06",
      name: "California",
      series: { population: { "2025": 39 }, empty: {} },
      latest: { population: { year: 2025, value: 39, rank: 1, of: 51, z: 4.2, outlier: "high" } },
    });
    expect(Object.keys(p!.series)).toEqual(["population"]);
    expect(p!.latest["population"]!.outlier).toBe("high");
  });
});
