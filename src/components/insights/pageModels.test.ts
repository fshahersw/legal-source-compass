import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MetricDef } from "@/lib/insights/contract";
import type { StateMetricsBundle, MetricDef as SmDef } from "@/lib/external/stateMetrics.functions";
import type { TrendBlockData } from "@/lib/analytics/trend";
import { TrendChart, blockAxis, blockFormatter } from "@/components/analytics/hub/TrendChart";
import { clusterInput, clusterStates } from "./clusters";
import { urlChoice, urlEntityType, urlToken } from "./searchParams";
import { axisFor, parseIds, perCapitaPair, seriesFrom } from "./trendsModel";

const metric = (id: string, over: Partial<MetricDef> = {}): MetricDef => ({
  id,
  label: id,
  description: "",
  unit: "deaths",
  format: "count",
  topic: "places",
  entityTypes: ["state"],
  periodType: "year",
  sourceDatasets: [],
  sourceLinks: [],
  numerator: id,
  denominator: null,
  method: "",
  caveats: [],
  direction: "higher_is_more",
  coverage: { from: "2020", to: "2022", entities: 51, facts: 153 },
  refreshedAt: null,
  ...over,
});

describe("trends model", () => {
  it("offers a per-capita toggle only with a stated denominator", () => {
    const all = [
      metric("sm.overdose_deaths"),
      metric("sm.overdose_rate", { format: "rate_per_100k", denominator: "Resident population" }),
      metric("fjc_civil_filed"),
      metric("fjc_civil_filed_per_100k", {
        format: "rate_per_100k",
        denominator: "Census population",
      }),
      metric("epa_cases"),
      metric("epa_cases_per_100k", { format: "rate_per_100k", denominator: null }),
    ];
    expect(perCapitaPair(all, "sm.overdose_deaths")?.rate.id).toBe("sm.overdose_rate");
    expect(perCapitaPair(all, "sm.overdose_rate")?.count.id).toBe("sm.overdose_deaths");
    expect(perCapitaPair(all, "fjc_civil_filed_per_100k")?.count.id).toBe("fjc_civil_filed");
    expect(perCapitaPair(all, "epa_cases")).toBeNull();
    expect(perCapitaPair(all, "sm.unknown")).toBeNull();
  });

  it("parses at most six unique, well-formed ids", () => {
    expect(parseIds("CA,TX,CA, NY ,<x>,FL,PA,IL,OH")).toEqual(["CA", "TX", "NY", "FL", "PA", "IL"]);
    expect(parseIds(undefined)).toEqual([]);
  });

  it("builds a dense period axis and per-entity series from facts", () => {
    const def = metric("m");
    const f = (id: string, p: string, v: number | null) => ({
      metricId: "m",
      entityType: "state" as const,
      entityId: id,
      period: p,
      periodStart: `${p}-01-01`,
      periodEnd: `${p}-12-31`,
      value: v,
      moe: null,
      partial: false,
      n: null,
      notRecordedReason: null,
    });
    const facts = [f("CA", "2022", 3), f("CA", "2020", 1), f("TX", "2020", 2)];
    expect(axisFor(def, facts).keys).toEqual(["2020", "2021", "2022"]);
    const s = seriesFrom(facts, ["CA", "TX"], (id) => `State ${id}`);
    expect(s[0]!.points.map((p) => p.key)).toEqual(["2020", "2022"]);
    expect(s[1]!.label).toBe("State TX");
  });
});

describe("URL parameters", () => {
  it("accepts plain tokens (and parsed numbers), known entity types and choices only", () => {
    expect(urlToken("sm.overdose_rate")).toBe("sm.overdose_rate");
    expect(urlToken(2738)).toBe("2738");
    expect(urlToken("<script>")).toBeUndefined();
    expect(urlToken("x".repeat(200))).toBeUndefined();
    expect(urlEntityType("state")).toBe("state");
    expect(urlEntityType("planet")).toBeUndefined();
    expect(urlChoice("xy", ["x", "y", "xy"] as const)).toBe("xy");
    expect(urlChoice("z", ["x"] as const)).toBeUndefined();
  });
});

const smDef = (key: string, over: Partial<SmDef> = {}): SmDef => ({
  key,
  label: key,
  short: key,
  unit: "per 100k",
  format: "rate",
  group: "Health & injury",
  method: "",
  denominator: "population",
  per: 100000,
  higher: "neutral",
  selectable: true,
  caveats: [],
  years: [2022, 2023],
  rankYears: [],
  latestYear: 2023,
  partialYears: {},
  national: {},
  nationalBasis: null,
  distribution: {},
  sources: [],
  order: 1,
  provisional: null,
  ...over,
});

describe("state clusters", () => {
  // 44 states with two clearly separated groups on two features; two states miss a feature
  const states = Array.from({ length: 46 }, (_, i) => {
    const usps = `S${String(i).padStart(2, "0")}`;
    const hi = i % 2 === 0;
    return {
      usps,
      fips: String(i).padStart(2, "0"),
      name: usps,
      series: {
        a: i === 45 ? {} : { "2022": 1, "2023": hi ? 100 + (i % 5) : 10 + (i % 5) },
        b: { "2022": 1, "2023": hi ? 50 + (i % 3) : 5 + (i % 3) },
      },
      latest: {},
      notes: {},
      overdose12mo: {},
    };
  });
  const bundle: StateMetricsBundle = {
    generatedAt: null,
    rankRule: null,
    outlierRule: null,
    metrics: [smDef("a"), smDef("b")],
    states,
  };

  it("uses the latest common complete year and lists the states it leaves out", () => {
    const input = clusterInput(bundle, ["sm.a", "sm.b"]);
    expect(input.year).toBe("2023");
    expect(input.states).toHaveLength(45);
    expect(input.excluded).toEqual([{ usps: "S45", missing: ["sm.a"] }]);
  });

  it("finds the two groups deterministically, with profiles on both scales", () => {
    const input = clusterInput(bundle, ["sm.a", "sm.b"]);
    const one = clusterStates(input, 2)!;
    const two = clusterStates(input, 2)!;
    expect(one.fit.assignments).toEqual(two.fit.assignments);
    expect(one.members.map((m) => m.length).sort()).toEqual([22, 23]);
    expect(one.fit.silhouette!).toBeGreaterThan(0.8);
    const high = one.profileRaw.findIndex((r) => r[0]! > 50);
    expect(one.profileZ[high]![0]).toBeGreaterThan(0);
    expect(clusterStates(input, 30)).toBeNull();
  });
});

describe("hub trend chart on the shared primitives", () => {
  const block: TrendBlockData = {
    id: "x",
    xKind: "month",
    chart: "line",
    stacked: false,
    format: "pct",
    unit: "percent",
    series: [
      {
        id: "s",
        label: "Share",
        points: [
          { x: "2019-12", value: 10 },
          { x: "2020-01", value: 11 },
          { x: "2020-02", value: null },
          { x: "2020-03", value: 12, partial: true },
        ],
      },
    ],
    primary: 0,
    latest: null,
    period: "December 2019–March 2020*",
    source: { label: "S", url: "https://example.gov" },
    asOf: null,
    notes: [],
    gaps: 1,
    markers: [{ x: "2020-01", label: "New form" }],
  };

  it("labels a long monthly axis on fixed January marks and formats percentages", () => {
    const axis = blockAxis(block);
    expect(axis.keys).toEqual(["2019-12", "2020-01", "2020-02", "2020-03"]);
    expect(axis.showTick?.("2020-01", 1)).toBe(true);
    expect(axis.showTick?.("2019-12", 0)).toBe(false);
    expect(blockFormatter(block).full(12.34)).toBe("12.3%");
    expect(blockFormatter(block).delta(-1.25)).toBe("−1.3 percentage points");
  });

  it("draws the block with its marker and a dashed partial tail", () => {
    const out = renderToStaticMarkup(createElement(TrendChart, { block, measure: "share" }));
    // measured width is unknown on the server: the frame renders and the svg waits for the client
    expect(out).toContain('aria-roledescription="chart"');
    expect(out).toContain("Line chart of share");
  });
});
