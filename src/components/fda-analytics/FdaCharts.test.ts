import { cloneElement, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Supply measured dimensions while retaining the actual Recharts child parser/renderers.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children as ReactElement<{ width: number; height: number }>, {
        width: 900,
        height: 240,
      }),
  };
});

import { TimelineChart } from "./FdaCharts";

describe("FDA timeline chart rendering", () => {
  it.each([false, true])("renders actual axes, grid and legend with stacked=%s", (stacked) => {
    const html = renderToStaticMarkup(
      createElement(TimelineChart, {
        unit: "Source reports",
        stacked,
        series: [
          {
            id: "reports",
            label: "Recorded source reports",
            points: [
              { date: "2025-12-01", end: "2025-12-31", value: 4 },
              { date: "2026-01-01", end: "2026-01-31", value: 7, partial: true },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("recharts-xAxis");
    expect(html).toContain("recharts-yAxis");
    expect(html).toContain("recharts-cartesian-grid");
    expect(html).toContain("recharts-legend-wrapper");
    expect(html).toContain("Recorded source reports");
    expect(html).toContain("recharts-tooltip-wrapper");
  });
});
