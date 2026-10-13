import { describe, expect, it } from "vitest";
import type { FdaAnalyticsDataset, FdaAnalyticsFacet } from "@/lib/fda-analytics/types";
import { normalizeMonitoringSearch, monitoringQuery } from "@/components/regulatory/monitoringView";
import {
  analyticsDatasetRanges,
  datasetAt,
  domainDatasets,
  findFacet,
  percentChangeLabel,
  selectedAnalyticsRange,
  snapshotAgeLabel,
} from "./analyticsView";
import { chartDateLabel, timelineRows } from "./chartView";

const dataset = (id: string, cutoff: string): FdaAnalyticsDataset => ({
  id,
  label: "Synthetic offline source",
  endpoint: `https://api.fda.gov/${id.replace("_", "/")}.json`,
  documentationUrl: "https://open.fda.gov/",
  productFamily: "drug",
  countUnit: "source records",
  status: "ready",
  statusReason: null,
  retrievedAt: "2026-10-12T00:00:00Z",
  sourceUpdatedAt: cutoff,
  qualification: "Offline test only",
  total: { value: 7, scope: "all_time", receiptIds: [] },
  facets: [],
  series: {
    dateField: "date",
    dateMeaning: "Source date",
    range: { from: "2024-01-01", to: cutoff },
    complete: true,
    completeThrough: cutoff,
    points: [],
    matchedRecords: 0,
    receiptIds: [],
    qualification: "Offline synthetic date coverage",
  },
});
const available = { from: "2001-01-01", to: "2026-10-11" };

describe("FDA dashboard view boundaries", () => {
  it("opens analytics by default while preserving existing views and separate filter scopes", () => {
    expect(normalizeMonitoringSearch({}).view).toBe("analytics");
    expect(normalizeMonitoringSearch({ view: "signals" }).view).toBe("signals");
    const state = normalizeMonitoringSearch({
      view: "analytics",
      analyticsPeriod: "custom",
      analyticsFrom: "2026-01-01",
      analyticsTo: "2026-03-01",
      analyticsInterval: "month",
      analyticsDomain: "tobacco",
      from: "2025-01-01",
      to: "2025-02-01",
    });
    expect(selectedAnalyticsRange(state, available)).toEqual({
      from: "2026-01-01",
      to: "2026-03-01",
    });
    expect(monitoringQuery(state)).toMatchObject({ from: "2025-01-01", to: "2025-02-01" });
    expect(monitoringQuery(state)).not.toHaveProperty("analyticsDomain");
    expect(
      normalizeMonitoringSearch({
        analyticsPeriod: "forever",
        analyticsInterval: "hour",
        analyticsDomain: "private",
        analyticsFrom: "2026-02-30",
      }),
    ).toMatchObject({
      analyticsPeriod: undefined,
      analyticsInterval: undefined,
      analyticsDomain: undefined,
      analyticsFrom: undefined,
    });
  });
  it("uses bounded preset durations instead of the union of historical source coverage", () => {
    expect(selectedAnalyticsRange(normalizeMonitoringSearch({}), available)).toEqual({
      from: "2025-10-12",
      to: "2026-10-11",
    });
    expect(
      selectedAnalyticsRange(normalizeMonitoringSearch({ analyticsPeriod: "30d" }), {
        from: "2023-01-01",
        to: "2024-03-01",
      }),
    ).toEqual({ from: "2024-02-01", to: "2024-03-01" });
    expect(
      selectedAnalyticsRange(
        normalizeMonitoringSearch({
          analyticsPeriod: "custom",
          analyticsFrom: "2026-10-12",
          analyticsTo: "2026-10-01",
        }),
        available,
      ),
    ).toBeNull();
  });
  it("aligns relative windows to each recorded complete source cutoff and leaves custom dates literal", () => {
    const first = dataset("drug_enforcement", "2026-10-08");
    const second = dataset("food_enforcement", "2026-09-30");
    const selected = { from: "2026-09-12", to: "2026-10-11" };
    expect(analyticsDatasetRanges([first, second], selected, "30d")).toEqual({
      drug_enforcement: { from: "2026-09-09", to: "2026-10-08" },
      food_enforcement: { from: "2026-09-01", to: "2026-09-30" },
    });
    expect(analyticsDatasetRanges([first, second], selected, "custom")).toEqual({
      drug_enforcement: selected,
      food_enforcement: selected,
    });
  });
  it("matches exact endpoints and domains without fabricating substitute datasets", () => {
    const first = dataset("drug_enforcement", "2026-10-08");
    const tobacco = {
      ...dataset("tobacco_problem", "2026-10-08"),
      productFamily: "tobacco" as const,
    };
    const letter = {
      ...dataset("transparency_crl", "2026-10-08"),
      productFamily: "other" as const,
    };
    expect(datasetAt([first], "drug/enforcement")).toBe(first);
    expect(datasetAt([first], "device/enforcement")).toBeUndefined();
    expect(domainDatasets([first, tobacco, letter], "tobacco")).toEqual([tobacco]);
    expect(domainDatasets([first, tobacco, letter], "transparency")).toEqual([letter]);
  });
  it("selects only the exact dated facet while preserving unavailable custom scopes for the core guard", () => {
    const source = dataset("drug_enforcement", "2026-10-08");
    const facet: FdaAnalyticsFacet = {
      id: "classification_30d",
      label: "Classification",
      field: "classification",
      countUnit: "records",
      scope: { kind: "window", from: "2026-09-09", to: "2026-10-08" },
      buckets: [],
      denominator: 0,
      denominatorLabel: "matching records",
      multiValued: false,
      exhaustive: true,
      truncated: false,
      receiptIds: [],
      qualification: "Offline only",
    };
    source.facets = [
      {
        ...facet,
        id: "classification_90d",
        scope: { kind: "window", from: "2026-07-11", to: "2026-10-08" },
      },
      facet,
    ];
    expect(findFacet(source, /classification/, { from: "2026-09-09", to: "2026-10-08" })).toBe(
      facet,
    );
  });
  it("retains unknown observations and partial bucket metadata without zero-filling another series", () => {
    const rows = timelineRows([
      {
        id: "drug",
        label: "Drug",
        points: [{ date: "2026-01-01", value: null, partial: true, end: "2026-01-03" }],
      },
      { id: "food", label: "Food", points: [{ date: "2026-01-02", value: 0 }] },
    ]);
    expect(rows[0]).toMatchObject({
      date: "2026-01-01",
      drug: null,
      drug__partial: true,
      drug__end: "2026-01-03",
    });
    expect(rows[0]).not.toHaveProperty("food");
    expect(rows[1]?.["food"]).toBe(0);
    expect(rows[1]).not.toHaveProperty("drug");
  });
  it("makes multi-year chart labels distinct and does not format missing comparisons as zero percent", () => {
    expect(chartDateLabel("2025-01-01")).toContain("25");
    expect(chartDateLabel("2026-01-01")).toContain("26");
    expect(percentChangeLabel(null)).toBeNull();
    expect(percentChangeLabel(0)).toBe("0%");
    expect(percentChangeLabel(12.34)).toBe("+12.3%");
    expect(snapshotAgeLabel("2026-10-10T00:00:00Z", Date.parse("2026-10-12T12:00:00Z"))).toBe(
      "Captured 2d ago",
    );
  });
});
