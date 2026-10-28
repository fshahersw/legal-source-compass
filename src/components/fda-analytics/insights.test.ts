import { describe, expect, it } from "vitest";
import type { FdaAnalyticsDataset, FdaAnalyticsFacet } from "@/lib/fda-analytics/types";
import {
  categoryLabel,
  classMix,
  fdaFindings,
  fdaMovers,
  fdaPeriodAxis,
  fdaTrend,
  latestVsBaseline,
  peakOf,
  percentText,
  rankedCategories,
  rollingMean,
  shortCount,
  signedPercent,
  trendLines,
} from "./insights";

const DAY = 86_400_000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => iso(Date.parse(`${from}T00:00:00Z`) + i * DAY));

function dataset(
  id: string,
  endpoint: string,
  family: FdaAnalyticsDataset["productFamily"],
  counts: (date: string, index: number) => number,
  facets: FdaAnalyticsFacet[] = [],
): FdaAnalyticsDataset {
  const all = days("2025-01-01", 730);
  return {
    id,
    label: id,
    endpoint: `https://api.fda.gov/${endpoint}.json`,
    documentationUrl: `https://open.fda.gov/apis/${endpoint}/`,
    productFamily: family,
    countUnit: "enforcement report records",
    status: "ready",
    statusReason: null,
    retrievedAt: "2027-01-02T00:00:00Z",
    sourceUpdatedAt: null,
    qualification: "Synthetic fixture.",
    total: { value: null, scope: "all_time", receiptIds: [] },
    facets,
    series: {
      dateField: "report_date",
      dateMeaning: "Report date",
      range: { from: all[0]!, to: all.at(-1)! },
      complete: true,
      completeThrough: all.at(-1)!,
      points: all.map((date, index) => ({ date, count: counts(date, index) })),
      matchedRecords: null,
      receiptIds: [],
      qualification: "Synthetic.",
    },
  };
}

const windowFacet = (
  field: string,
  from: string,
  to: string,
  buckets: [string, number][],
  denominator: number,
  patch: Partial<FdaAnalyticsFacet> = {},
): FdaAnalyticsFacet => ({
  id: `${field}_window`,
  label: field,
  field,
  countUnit: "records",
  scope: { kind: "window", from, to },
  buckets: buckets.map(([key, count]) => ({ key, label: key, count })),
  denominator,
  denominatorLabel: "records",
  multiValued: false,
  exhaustive: true,
  truncated: false,
  receiptIds: [],
  qualification: "Synthetic.",
  ...patch,
});

describe("FDA dashboard insights", () => {
  it("formats shares, signed changes and short counts without inventing precision", () => {
    expect(percentText(0.04)).toBe("<0.1%");
    expect(percentText(41.25)).toBe("41.3%");
    expect(percentText(null)).toBe("Not recorded");
    expect(signedPercent(12.34)).toBe("+12.3%");
    expect(signedPercent(-4.8)).toBe("−4.8%");
    expect(signedPercent(null)).toBeNull();
    expect(shortCount(2_424_630)).toBe("2.42M");
    expect(shortCount(123_279)).toBe("123K");
    expect(shortCount(13_420)).toBe("13.4K");
    expect(shortCount(2_972)).toBe("2,972");
    expect(shortCount(null)).toBe("Not recorded");
  });

  it("decodes published FDA codes and keeps unknown ones as recorded", () => {
    const decision = { field: "decision_code.exact" };
    expect(categoryLabel(decision, "SESE", "SESE")).toBe(
      "Substantially equivalent, cleared (SESE)",
    );
    expect(categoryLabel(decision, "DENG", "DENG")).toBe("De Novo request granted (DENG)");
    expect(categoryLabel(decision, "OK30", "OK30")).toBe(
      "OK30 (not defined in the openfda field reference)",
    );
    expect(categoryLabel(decision, "ZZZZ", "ZZZZ")).toBe("ZZZZ");
    expect(categoryLabel({ field: "serious" }, "2", "2")).toBe("Not serious");
    expect(categoryLabel({ field: "device.brand_name.exact" }, "X", "X")).toBe("X");
  });

  it("averages only full windows, finds the peak and compares the latest period with its baseline", () => {
    const data = [1, 2, 3, 4, 100, 5].map((value, i) => ({ key: `k${i}`, value }));
    expect(rollingMean(data, 3).map((d) => d.value)).toEqual([null, null, 2, 3, 35.7, 36.3]);
    const gap = [
      { key: "a", value: 1 },
      { key: "b", value: null },
      { key: "c", value: 3 },
    ];
    expect(rollingMean(gap, 2).map((d) => d.value)).toEqual([null, null, null]);
    expect(peakOf([...data, { key: "p", value: 999, partial: true }])).toEqual({
      key: "k4",
      value: 100,
    });
    const weeks = Array.from({ length: 13 }, (_, i) => ({
      key: `w${i}`,
      value: i === 12 ? 30 : 10,
    }));
    expect(latestVsBaseline(weeks, 12)).toMatchObject({
      key: "w12",
      value: 30,
      baseline: 10,
      ratio: 3,
    });
    expect(latestVsBaseline(weeks.slice(0, 4), 12)).toBeNull();
  });

  it("builds a period axis whose month ticks sit on a bucket starting in the month's first week", () => {
    const keys = days("2026-01-01", 120).filter((_, i) => i % 7 === 0);
    const axis = fdaPeriodAxis(keys, "week");
    const shown = keys.filter((key, i) => axis.showTick?.(key, i) ?? true);
    expect(shown.every((key) => Number(key.slice(8, 10)) <= 7)).toBe(true);
    expect(new Set(shown.map((key) => key.slice(0, 7))).size).toBe(shown.length);
    expect(axis.label(keys[0]!)).toBe("Week of Jan 1, 2026");
    expect(fdaPeriodAxis(["2026-03"], "month").label("2026-03")).toBe("March 2026");
  });

  it("splits recalls by class in severity order and ranks categories with shares", () => {
    const food = dataset("food_enforcement", "food/enforcement", "food", () => 1, [
      windowFacet(
        "classification.exact",
        "2026-01-01",
        "2026-12-31",
        [
          ["Class II", 60],
          ["Class I", 30],
          ["Class III", 10],
        ],
        100,
      ),
    ]);
    const mix = classMix(food, { from: "2026-01-01", to: "2026-12-31" });
    expect(mix?.parts.map((part) => part.key)).toEqual(["Class I", "Class II", "Class III"]);
    expect(mix?.parts[0]?.share).toBe(30);
    expect(classMix(food, { from: "2026-02-01", to: "2026-12-31" })).toBeNull();
    const ranked = rankedCategories(food.facets[0]!, { from: "2026-01-01", to: "2026-12-31" });
    expect(ranked.available && ranked.items.map((item) => [item.key, item.share])).toEqual([
      ["Class II", 60],
      ["Class I", 30],
      ["Class III", 10],
    ]);
  });

  it("compares windows, writes findings from recorded figures and leaves out what it cannot compute", () => {
    // 2025: 1 per day; 2026: 2 per day
    const device = dataset("device_enforcement", "device/enforcement", "device", (date) =>
      date.startsWith("2026") ? 2 : 1,
    );
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const [mover] = fdaMovers([{ dataset: device, label: "Device recalls", range }]);
    expect(mover).toMatchObject({ current: 730, previous: 365, percent: 100, comparable: true });
    const findings = fdaFindings({
      datasets: [device],
      ranges: { device_enforcement: range },
      fallback: range,
      labels: { device_enforcement: "Device recalls" },
      interval: "week",
    });
    expect(findings[0]?.text).toBe(
      "Device recalls rose 100% to 730 in the 365 days through Dec 31, 2026 (prior 365 days: 365).",
    );
    // no class facet, no event datasets: nothing else is stated
    expect(findings).toHaveLength(1);
  });

  it("adds the rolling average line only when the window holds enough periods", () => {
    const device = dataset("device_event", "device/event", "device", () => 3);
    const trend = fdaTrend(device, { from: "2026-01-01", to: "2026-12-31" }, "week");
    expect(trendLines(trend, "week", "Device reports").map((line) => line.id)).toEqual([
      "count",
      "average",
    ]);
    expect(trendLines(trend, "month", "Device reports").map((line) => line.id)).toEqual(["count"]);
    expect(trend.data[0]?.partial).toBe(true); // Jan 1, 2026 is a Thursday: the first week is cut
  });
});
