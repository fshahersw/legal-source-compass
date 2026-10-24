import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/corpus/store", () => ({
  useCorpus: () => ({ status: "loading", error: null, geo: null, insights: null, retry: () => {} }),
}));

import { BarTrend } from "./BarTrend";
import { ChartFrame } from "./ChartFrame";
import { Choropleth, stateFipsOf, toMapValues } from "./Choropleth";
import { DistributionStrip } from "./DistributionStrip";
import { metricFormatter } from "./format";
import { Heatmap } from "./Heatmap";
import { LineTrend } from "./LineTrend";
import { Network } from "./Network";
import { RankedBars } from "./RankedBars";
import { Sankey } from "./Sankey";
import { ScatterCorrelation, StatsBox, scatterStats } from "./ScatterCorrelation";
import type { PeriodAxis } from "./series";
import { SlopeChart } from "./SlopeChart";
import { SmallMultiples } from "./SmallMultiples";
import { Sparkline } from "./Sparkline";
import { kaplanMeier } from "./stats";
import { SurvivalCurve } from "./SurvivalCurve";

const html = (node: ReactNode) => renderToStaticMarkup(node as never);
const count = metricFormatter("count");
const axis: PeriodAxis = {
  keys: ["2019", "2020", "2021", "2022", "2023"],
  label: (k) => k,
  tick: (k) => k,
};
const series = [
  {
    id: "a",
    label: "Filed",
    points: [
      { key: "2019", value: 100 },
      { key: "2020", value: 120 },
      { key: "2021", value: null },
      { key: "2022", value: 140 },
      { key: "2023", value: 90, partial: true },
    ],
  },
];

describe("ChartFrame states", () => {
  const base = {
    title: "Federal civil cases filed",
    unit: "cases",
    period: "2019–2023",
    sources: [{ label: "FJC Integrated Database", url: "https://www.fjc.gov/research/idb" }],
  };

  it("shows a busy skeleton while loading", () => {
    const out = html(createElement(ChartFrame, { ...base, status: { kind: "loading" } }));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('role="status"');
    expect(out).toContain("FJC Integrated Database");
  });

  it("shows the error with a retry, the empty reason, and the partial notice", () => {
    const err = html(
      createElement(ChartFrame, { ...base, status: { kind: "error", onRetry: () => {} } }),
    );
    expect(err).toContain('role="alert"');
    expect(err).toContain("Retry");
    const empty = html(
      createElement(ChartFrame, {
        ...base,
        status: { kind: "empty", reason: "No rows published." },
      }),
    );
    expect(empty).toContain("No rows published.");
    const ready = html(
      createElement(
        ChartFrame,
        {
          ...base,
          status: { kind: "ready" },
          partialNotice: "One source could not be read.",
          notes: ["Counts are filings, not people."],
          footnotes: ["* Partial period."],
          table: {
            caption: "Cases",
            columns: [{ label: "Year" }, { label: "Filed", align: "right" }],
            rows: [{ key: "2019", cells: ["2019", "100"] }],
          },
        },
        createElement("div", null, "chart"),
      ),
    );
    expect(ready).toContain("One source could not be read.");
    expect(ready).toContain("View data");
    expect(ready).toContain("Source and notes");
    expect(ready).toContain("Cases · 2019–2023");
    expect(ready).toContain("* Partial period.");
    expect(ready).toContain("Source and notes");
  });
});

describe("period charts", () => {
  it("draws a line with a gap and a dashed partial tail", () => {
    const out = html(
      createElement(LineTrend, {
        series,
        axis,
        formatter: count,
        unit: "cases",
        ariaLabel: "Filed cases",
        width: 600,
      }),
    );
    expect((out.match(/<polyline/g) ?? []).length).toBe(2);
    expect(out).toContain('stroke-dasharray="4 4"');
    expect(out).toContain('aria-roledescription="chart"');
  });

  it("draws bars with a not-recorded stub, never a zero bar", () => {
    const out = html(
      createElement(BarTrend, {
        series,
        axis,
        formatter: count,
        ariaLabel: "Filed cases",
        width: 600,
      }),
    );
    expect(out).toContain("2021: Not recorded");
    expect((out.match(/<path/g) ?? []).length).toBe(4);
  });

  it("renders sparklines and small multiples", () => {
    expect(html(createElement(Sparkline, { series: series[0]!, keys: axis.keys }))).toContain(
      "<polyline",
    );
    const sm = html(
      createElement(SmallMultiples, {
        series: [series[0]!, { ...series[0]!, id: "b", label: "Terminated" }],
        axis,
        formatter: count,
      }),
    );
    expect(sm).toContain("Terminated");
    expect(sm).toContain("2022");
  });
});

describe("comparison charts", () => {
  const items = [
    { id: "CA", label: "California", value: 12 },
    { id: "TX", label: "Texas", value: 9 },
    { id: "NY", label: "New York", value: null },
  ];

  it("ranks bars and lists the entities without a value", () => {
    const out = html(
      createElement(RankedBars, {
        items,
        formatter: count,
        ariaLabel: "Ranked",
        references: [{ label: "United States", value: 10 }],
        width: 500,
      }),
    );
    expect(out).toContain("California");
    expect(out).toContain("United States: 10");
    expect(out).toContain("Not recorded (1): New York.");
  });

  it("draws a slope chart and a distribution strip", () => {
    const slope = html(
      createElement(SlopeChart, {
        items: [
          { id: "CA", label: "California", values: { "2019": 5, "2023": 12 } },
          { id: "TX", label: "Texas", values: { "2019": 9, "2023": 9 } },
        ],
        periods: ["2019", "2023"],
        periodLabel: (p: string) => p,
        formatter: count,
        ariaLabel: "Slope",
        width: 500,
      }),
    );
    expect(slope).toContain("California");
    const strip = html(
      createElement(DistributionStrip, { items, formatter: count, ariaLabel: "Strip", width: 500 }),
    );
    expect(strip).toContain("n = 2");
    expect(strip).toContain("1 not recorded.");
  });
});

describe("scatter and statistics", () => {
  const points = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i}`,
    label: `State ${i}`,
    x: i + 1,
    y: (i + 1) * 2 + (i % 2),
  }));

  it("states n, both coefficients, the small-sample warning and the group-level note", () => {
    const stats = scatterStats(points);
    const out = html(
      createElement(StatsBox, { stats, entityNoun: "states", adjusted: { q: 0.04, m: 3 } }),
    );
    expect(out).toContain("6 states with both values");
    expect(out).toContain("Pearson r");
    expect(out).toContain("Spearman ρ");
    expect(out).toContain("Small sample");
    expect(out).toContain("does not");
    expect(out).toContain("Benjamini–Hochberg across 3 comparisons");
  });

  it("draws the points and the fitted line", () => {
    const out = html(
      createElement(ScatterCorrelation, {
        points,
        xFormatter: count,
        yFormatter: count,
        xLabel: "X",
        yLabel: "Y",
        ariaLabel: "Scatter",
        width: 500,
      }),
    );
    expect((out.match(/<circle/g) ?? []).length).toBe(6);
    expect(out).toContain('stroke-dasharray="5 4"');
  });
});

describe("matrix, flow, network and survival charts", () => {
  it("hatches cells that are not recorded", () => {
    const out = html(
      createElement(Heatmap, {
        rows: [{ id: "r", label: "Row" }],
        columns: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        value: (_r: string, c: string) => (c === "a" ? 3 : null),
        formatter: count,
        ariaLabel: "Heat",
        width: 400,
      }),
    );
    expect(out).toContain("Not recorded");
    expect(out).toContain("url(#");
  });

  it("draws sankey ribbons and network nodes with labels", () => {
    const s = html(
      createElement(Sankey, {
        nodes: [
          { id: "o", label: "N.D. Cal.", column: 0 },
          { id: "m", label: "MDL 2738", column: 1 },
        ],
        links: [{ source: "o", target: "m", value: 40 }],
        formatter: count,
        unit: "actions",
        ariaLabel: "Flows",
        width: 500,
      }),
    );
    expect(s).toContain("MDL 2738");
    const n = html(
      createElement(Network, {
        nodes: [
          { id: "a", label: "Firm A", weight: 3 },
          { id: "b", label: "Firm B", weight: 2 },
        ],
        edges: [{ a: "a", b: "b", weight: 4 }],
        formatter: count,
        edgeUnit: "shared parties",
        nodeUnit: "appearances",
        ariaLabel: "Network",
        width: 400,
      }),
    );
    expect(n).toContain("Firm A");
    expect((n.match(/<line/g) ?? []).length).toBe(1);
  });

  it("draws the survival curve with the number under observation", () => {
    const subjects = [
      { id: "a", entry: 0, exit: 2, event: true },
      { id: "b", entry: 0, exit: 5, event: false },
    ];
    const out = html(
      createElement(SurvivalCurve, {
        groups: [{ id: "all", label: "All", km: kaplanMeier(subjects), subjects }],
        timeUnit: "years",
        eventLabel: "termination",
        ariaLabel: "Survival",
        width: 500,
      }),
    );
    expect(out).toContain("Under observation");
    expect(out).toContain("<polyline");
  });
});

describe("choropleth wrapper", () => {
  it("maps state ids written as USPS or FIPS and reports what it cannot place", () => {
    expect(stateFipsOf("CA")).toBe("06");
    expect(stateFipsOf("6")).toBe("06");
    expect(stateFipsOf("ZZ")).toBeNull();
    const { byFips, unplaced } = toMapValues(
      new Map<string, number | null>([
        ["CA", 3],
        ["TX", null],
        ["Guam", 1],
      ]),
      "state",
    );
    expect(byFips).toEqual({ "06": 3 });
    expect(unplaced).toEqual(["Guam"]);
  });

  it("shows the map skeleton while the map file loads", () => {
    const out = html(
      createElement(Choropleth, {
        level: "state",
        title: "Map",
        values: new Map([["CA", 3]]),
        format: "count",
        unit: "cases",
        periodLabel: "2024",
      }),
    );
    expect(out).toContain("Loading map");
  });
});
