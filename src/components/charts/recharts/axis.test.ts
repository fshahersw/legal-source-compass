import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  axisWidth,
  categoryAxisWidth,
  fitText,
  niceAxis,
  niceAxisFor,
  percentTick,
  plottedValues,
  tickIndices,
  tickText,
} from "./axis";
import { EndLabels, SeriesLegend, ThemedTooltip } from "./content";
import { periodTable } from "./tables";
import { barProps, endLabelMargin, seriesColor, tooltipProps, yValueAxis } from "./theme";
import { ChartCard } from "../ChartCard";

const html = (node: ReactNode) => renderToStaticMarkup(node as never);

describe("nice value axes", () => {
  it("uses 1, 2 or 5 times a power of ten, never 11/22/33 or 65K/130K", () => {
    expect(niceAxis([0, 55]).ticks).toEqual([0, 20, 40, 60]);
    expect(niceAxis([0, 236_431]).ticks).toEqual([0, 50_000, 100_000, 150_000, 200_000, 250_000]);
    expect(niceAxis([0, 99]).ticks).toEqual([0, 20, 40, 60, 80, 100]);
    for (const max of [7, 13, 44, 99, 260_000, 1.4e6, 0.37]) {
      const { ticks } = niceAxis([0, max]);
      const step = ticks[1]! - ticks[0]!;
      const mant = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Number(mant.toFixed(6)));
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(6);
      expect(ticks.at(-1)!).toBeGreaterThanOrEqual(max);
    }
  });

  it("keeps zero by default, can leave it out, and includes reference values", () => {
    expect(niceAxis([52, 87]).domain[0]).toBe(0);
    expect(niceAxis([39_000_000, 39_600_000], { zero: false }).domain[0]).toBeGreaterThan(0);
    expect(niceAxis([1, 4], { include: [9] }).domain[1]).toBeGreaterThanOrEqual(9);
    expect(niceAxis([])).toEqual({ domain: [0, 1], ticks: [0, 1] });
  });

  it("reads stack totals for stacked bars", () => {
    const rows = [
      { y: 2020, a: 3, b: 4, c: null },
      { y: 2021, a: -2, b: 5, c: "x" },
    ];
    expect(plottedValues(rows, ["a", "b", "c"])).toEqual([3, 4, -2, 5]);
    expect(plottedValues(rows, ["a", "b", "c"], true)).toEqual([7, 0, 5, -2]);
    expect(niceAxisFor(rows, ["a", "b"], { stacked: true }).domain).toEqual([-2, 8]);
  });

  it("writes compact ticks and sizes the axis for them", () => {
    expect(tickText(50_000)).toBe("50K");
    expect(tickText(1_200_000, { prefix: "$" })).toBe("$1.2M");
    expect(tickText(12, { suffix: "%" })).toBe("12%");
    expect(percentTick(12.5)).toBe("12.5%");
    expect(axisWidth([0, 50_000, 100_000], tickText)).toBeGreaterThanOrEqual(24);
    expect(categoryAxisWidth(["A very long district name, Eastern District"], { max: 120 })).toBe(
      120,
    );
    expect(fitText("Eastern District of Pennsylvania", 60)).toMatch(/…$/);
  });

  it("thins category ticks at a regular step that keeps the last label", () => {
    expect(tickIndices(5, 1000, 30)).toEqual([0, 1, 2, 3, 4]);
    const idx = tickIndices(54, 400, 30);
    expect(idx.at(-1)).toBe(53);
    const steps = new Set(idx.slice(1).map((v, i) => v - idx[i]!));
    expect(steps.size).toBe(1);
  });
});

describe("theme props and content", () => {
  it("colours series in fixed order and refuses a slot past the palette", () => {
    expect(seriesColor(0)).toBe("var(--chart-1, light-dark(#2a78d6, #3987e5))");
    expect(() => seriesColor(6)).toThrow(RangeError);
  });

  it("rounds only the data end of bars and caps their thickness", () => {
    expect(barProps().radius).toEqual([4, 4, 0, 0]);
    expect(barProps({ horizontal: true }).radius).toEqual([0, 4, 4, 0]);
    expect(barProps({ stacked: true }).radius).toBe(0);
    expect(barProps({ stacked: true, top: true }).radius).toEqual([4, 4, 0, 0]);
    expect(barProps().maxBarSize).toBe(24);
  });

  it("builds a value axis with explicit nice ticks", () => {
    const y = yValueAxis(niceAxis([0, 44]), tickText);
    expect(y.ticks).toEqual([0, 10, 20, 30, 40, 50]);
    expect(y.domain).toEqual([0, 50]);
    expect(yValueAxis(niceAxis([0, 13]), tickText).ticks).toEqual([0, 5, 10, 15]);
    expect(y.tick.fontSize).toBe(12);
  });

  it("renders a tooltip where the value leads and missing values read Not recorded", () => {
    const out = html(
      createElement(ThemedTooltip, {
        active: true,
        label: "FY2025",
        payload: [
          { name: "Filed", value: 1204, color: "red", dataKey: "f", payload: {} },
          { name: "Pending", value: null, color: "blue", dataKey: "p", payload: {} },
        ],
        valueFormat: (v) => `${v.toLocaleString("en-US")} cases`,
      }),
    );
    expect(out).toContain("FY2025");
    expect(out.indexOf("1,204 cases")).toBeLessThan(out.indexOf("Filed"));
    expect(out).toContain("Not recorded");
    expect(html(createElement(ThemedTooltip, { active: false, payload: [] }))).toBe("");
    expect(tooltipProps({ cursor: "bar" }).cursor).toEqual({
      fill: "var(--muted)",
      fillOpacity: 0.7,
    });
  });

  it("draws a legend only for two or more series", () => {
    expect(
      html(createElement(SeriesLegend, { items: [{ id: "a", label: "A", color: "red" }] })),
    ).toBe("");
    const two = html(
      createElement(SeriesLegend, {
        items: [
          { id: "a", label: "A", color: "red" },
          { id: "b", label: "B", color: "blue", dashed: true },
        ],
      }),
    );
    expect(two).toContain('aria-label="Legend"');
    expect(two).toContain("stroke-dasharray");
  });

  it("labels line ends with dodged, non-overlapping labels", () => {
    const line = (key: string, y: number) => ({
      item: { type: { displayName: "Line" }, props: { dataKey: key, name: key.toUpperCase() } },
      props: {
        points: [
          { x: 10, y: 50, value: 1 },
          { x: 100, y, value: 7 },
          { x: 110, y: null, value: null },
        ],
      },
    });
    const out = html(
      createElement(
        "svg",
        null,
        createElement(EndLabels, {
          format: (v) => String(v),
          formattedGraphicalItems: [line("a", 60), line("b", 62)],
          offset: { top: 0, height: 200 },
        }),
      ),
    );
    const ys = [...out.matchAll(/<text[^>]* y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(2);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThanOrEqual(14);
    expect(out).toContain("A 7");
    expect(endLabelMargin(["Filed 37,443"])).toBeGreaterThan(60);
  });
});

describe("period table", () => {
  it("lists periods newest first with Not recorded gaps, partial marks and totals", () => {
    const t = periodTable(
      [
        { y: "2024", a: 1, b: 2 },
        { y: "2025", a: 3, b: null, p: true },
      ],
      "y",
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
      String,
      { caption: "C", xLabel: "Year", partialKey: "p", total: true },
    );
    expect(t.columns.map((c) => c.label)).toEqual(["Year", "A", "B", "Total"]);
    expect(t.rows[0]!.cells).toEqual(["2025 (partial)", "3", "Not recorded", "Not recorded"]);
    expect(t.rows[1]!.cells).toEqual(["2024", "1", "2", "3"]);
  });
});

describe("ChartCard", () => {
  it("shows the takeaway title, subtitle, KPI strip, View data and source footer", () => {
    const out = html(
      createElement(
        ChartCard,
        {
          title: "Filings peaked in FY2020",
          subtitle: "Product liability filings · cases · FY2014–FY2025",
          kpis: [{ label: "FY2025", value: "45,713", delta: { text: "18.2%", direction: "down" } }],
          table: {
            caption: "Filings",
            columns: [{ label: "Year" }, { label: "Filed", align: "right" }],
            rows: [{ key: "2025", cells: ["FY2025", "45,713"] }],
          },
          sources: [{ label: "U.S. Courts", url: "https://www.uscourts.gov" }],
          period: "FY2014–FY2025",
          about: "Counts are filings, not people.",
        },
        createElement("div", null, "chart body"),
      ),
    );
    expect(out).toContain("Filings peaked in FY2020");
    expect(out).toContain("Product liability filings · cases · FY2014–FY2025");
    expect(out).toContain("45,713");
    expect(out).toContain("View data");
    expect(out).toContain("chart body");
    expect(out).toContain("Source and notes");
  });

  it("renders loading, error and empty states", () => {
    expect(html(createElement(ChartCard, { title: "T", status: { kind: "loading" } }))).toContain(
      'aria-busy="true"',
    );
    expect(
      html(createElement(ChartCard, { title: "T", status: { kind: "error", onRetry: () => {} } })),
    ).toContain("Retry");
    expect(
      html(createElement(ChartCard, { title: "T", status: { kind: "empty", reason: "No rows." } })),
    ).toContain("No rows.");
  });
});
