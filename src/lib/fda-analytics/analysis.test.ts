import { describe, expect, it } from "vitest";
import { aggregateSeries, comparePeriods, facetBreakdown, sourceAlignedRange } from "./analysis";
import type { FdaAnalyticsDataset, FdaAnalyticsFacet } from "./types";

const dataset = (
  patch: Partial<NonNullable<FdaAnalyticsDataset["series"]>> = {},
): FdaAnalyticsDataset => ({
  id: "food_enforcement",
  label: "Offline arithmetic fixture",
  endpoint: "https://api.fda.gov/food/enforcement.json",
  documentationUrl: "https://open.fda.gov/apis/food/enforcement/",
  productFamily: "food",
  countUnit: "enforcement report records",
  status: "ready",
  statusReason: null,
  retrievedAt: "2026-03-04T12:00:00Z",
  sourceUpdatedAt: null,
  qualification: "Synthetic offline fixture only.",
  total: { value: 10, scope: "all_time", receiptIds: [] },
  facets: [],
  series: {
    dateField: "report_date",
    dateMeaning: "Report date",
    range: { from: "2026-02-01", to: "2026-03-03" },
    complete: true,
    completeThrough: "2026-03-02",
    points: [
      { date: "2026-02-01", count: 2 },
      { date: "2026-02-02", count: 2 },
      { date: "2026-02-03", count: 4 },
      { date: "2026-03-02", count: 2 },
    ],
    matchedRecords: 10,
    receiptIds: [],
    qualification: "API enumeration only",
    ...patch,
  },
});
const facet = (patch: Partial<FdaAnalyticsFacet> = {}): FdaAnalyticsFacet => ({
  id: "classification",
  label: "Recall classification",
  field: "classification",
  countUnit: "enforcement report records",
  scope: { kind: "window", from: "2026-02-01", to: "2026-02-28" },
  buckets: [
    { key: "I", label: "Class I", count: 2 },
    { key: "II", label: "Class II", count: 6 },
  ],
  denominator: 8,
  denominatorLabel: "matching reports in February",
  multiValued: false,
  exhaustive: true,
  truncated: false,
  receiptIds: [],
  qualification: "Fixture",
  ...patch,
});

describe("FDA aggregate calendar calculations", () => {
  it("anchors presets to observed source dates rather than retrieval or release dates", () => {
    expect(sourceAlignedRange(dataset(), 30)).toEqual({ from: "2026-02-01", to: "2026-03-02" });
    expect(sourceAlignedRange(dataset(), 31)).toBeNull();
    expect(sourceAlignedRange(dataset({ completeThrough: null }), 7)).toBeNull();
    expect(sourceAlignedRange(dataset(), 0)).toBeNull();
  });
  it("fills sparse zero days only within reconciled observed coverage", () => {
    const range = { from: "2026-03-01", to: "2026-03-03" };
    expect(aggregateSeries(dataset(), range, "day").map((point) => point.value)).toEqual([
      0,
      2,
      null,
    ]);
    expect(
      aggregateSeries(dataset({ complete: false }), range, "day").map((point) => point.value),
    ).toEqual([null, 2, null]);
    expect(
      aggregateSeries(dataset({ completeThrough: null }), range, "day").map((point) => point.value),
    ).toEqual([null, 2, null]);
  });
  it("uses Monday weeks and real leap/month boundaries without extrapolating partial buckets", () => {
    const value = dataset({
      range: { from: "2024-02-01", to: "2024-03-03" },
      points: [
        { date: "2024-02-29", count: 5 },
        { date: "2024-03-03", count: 1 },
      ],
      completeThrough: "2024-03-03",
      matchedRecords: 6,
    });
    const points = aggregateSeries(value, { from: "2024-02-01", to: "2024-03-03" }, "month");
    expect(points.map((point) => [point.totalDays, point.value, point.partial])).toEqual([
      [29, 5, false],
      [3, 1, true],
    ]);
    const weeks = aggregateSeries(value, { from: "2024-02-29", to: "2024-03-03" }, "week");
    expect(weeks).toMatchObject([
      { label: "2024-02-26", start: "2024-02-29", end: "2024-03-03", value: 6, partial: true },
    ]);
  });
  it("returns null for a period containing an unknown day, never an understated sum", () => {
    const points = aggregateSeries(
      dataset({ complete: false }),
      { from: "2026-02-01", to: "2026-02-04" },
      "month",
    );
    expect(points[0]).toMatchObject({ value: null, knownDays: 3, totalDays: 4, partial: true });
    expect(
      aggregateSeries(
        { ...dataset(), status: "failed", series: null },
        { from: "2026-02-01", to: "2026-02-02" },
        "day",
      ).every((point) => point.value === null),
    ).toBe(true);
  });
  it("compares equal durations only and withholds lag-induced false percentage drops", () => {
    const comparison = comparePeriods(dataset(), { from: "2026-02-03", to: "2026-02-04" });
    expect(comparison).toMatchObject({
      comparable: true,
      current: { value: 4 },
      previous: { value: 4, range: { from: "2026-02-01", to: "2026-02-02" } },
      absoluteChange: 0,
      percentChange: 0,
    });
    const lag = comparePeriods(dataset(), { from: "2026-03-03", to: "2026-03-03" });
    expect(lag).toMatchObject({
      comparable: false,
      current: { value: null },
      previous: { value: 2 },
      absoluteChange: null,
      percentChange: null,
    });
    const partial = comparePeriods(dataset({ points: [{ date: "2026-03-03", count: 1 }] }), {
      from: "2026-03-03",
      to: "2026-03-03",
    });
    expect(partial.current.value).toBe(1);
    expect(partial.comparable).toBe(false);
  });
  it("distinguishes missing prior coverage from a genuine zero denominator", () => {
    expect(comparePeriods(dataset(), { from: "2026-02-01", to: "2026-02-02" })).toMatchObject({
      comparable: false,
      previous: { value: null },
    });
    expect(comparePeriods(dataset(), { from: "2026-03-02", to: "2026-03-02" })).toMatchObject({
      comparable: true,
      absoluteChange: 2,
      percentChange: null,
      previous: { value: 0 },
    });
  });
  it("rejects reversed, invalid and unbounded date inputs", () => {
    for (const range of [
      { from: "2026-02-30", to: "2026-03-03" },
      { from: "2026-03-03", to: "2026-02-01" },
      { from: "2020-01-01", to: "2026-01-01" },
    ])
      expect(() => aggregateSeries(dataset(), range, "month")).toThrow();
  });
});
describe("FDA category denominators", () => {
  it("uses scoped source records rather than displayed top-category sums", () => {
    const result = facetBreakdown(facet({ denominator: 10, exhaustive: false, truncated: true }));
    expect(result.buckets.map((bucket) => bucket.percent)).toEqual([20, 60]);
    expect(result.canSumTo100).toBe(false);
    expect(facetBreakdown(facet()).canSumTo100).toBe(true);
    expect(facetBreakdown(facet({ multiValued: true })).canSumTo100).toBe(false);
  });
  it("withholds mismatched windows and does not invent percentages for unknown or zero totals", () => {
    expect(facetBreakdown(facet(), { from: "2026-02-02", to: "2026-02-28" })).toMatchObject({
      available: false,
      buckets: [],
    });
    expect(
      facetBreakdown(facet({ scope: { kind: "inventory" } }), {
        from: "2026-02-01",
        to: "2026-02-28",
      }).available,
    ).toBe(false);
    expect(
      facetBreakdown(facet({ denominator: null })).buckets.every(
        (bucket) => bucket.percent === null,
      ),
    ).toBe(true);
    expect(facetBreakdown(facet({ denominator: 0, buckets: [] })).canSumTo100).toBe(false);
  });
});
