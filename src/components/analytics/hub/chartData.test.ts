import { describe, expect, it } from "vitest";
import { assembleBlock, type TrendBlockData } from "@/lib/analytics/trend";
import {
  SERIES_COLORS,
  axisTicks,
  chartRows,
  describeChart,
  isolatedPoint,
  seriesColor,
  tableRows,
  tooltipValue,
} from "./chartData";

const block = (overrides: Partial<Parameters<typeof assembleBlock>[0]> = {}): TrendBlockData =>
  assembleBlock({
    id: "t",
    xKind: "year",
    unit: "cases",
    series: [
      {
        id: "a",
        label: "Filed",
        points: [
          { x: "2023", value: 10 },
          { x: "2024", value: null },
          { x: "2025", value: 30 },
          { x: "2026", value: 15, partial: true },
        ],
      },
      {
        id: "b",
        label: "Terminated",
        points: [
          { x: "2023", value: 5 },
          { x: "2024", value: 6 },
          { x: "2025", value: 7 },
          { x: "2026", value: 8, partial: true },
        ],
      },
    ],
    source: { label: "Source", url: "https://example.gov/" },
    ...overrides,
  });

describe("chartRows", () => {
  it("makes one row per period with a null where the source records nothing", () => {
    const rows = chartRows(block({ chart: "bar" }));
    expect(rows.map((r) => r["x"])).toEqual(["2023", "2024", "2025", "2026"]);
    expect(rows[1]!["a"]).toBeNull();
    expect(rows[1]!["b"]).toBe(6);
    expect(rows.map((r) => r.partial)).toEqual([false, false, false, true]);
  });
  it("draws a line's partial tail apart and joins it to the last complete point", () => {
    const rows = chartRows(block({ chart: "line" }));
    // The solid value is blanked at the partial period and the dashed key carries it.
    expect(rows[3]!["a"]).toBeNull();
    expect(rows[3]!["a__p"]).toBe(15);
    expect(rows[2]!["a"]).toBe(30);
    expect(rows[2]!["a__p"]).toBe(30);
    expect(rows[0]!["a__p"]).toBeNull();
  });
  it("keeps the value on a partial bar so it can be faded, not blanked", () => {
    const rows = chartRows(block({ chart: "bar" }));
    expect(rows[3]!["a"]).toBe(15);
  });
  it("orders Congress keys numerically", () => {
    const rows = chartRows(
      block({
        xKind: "congress",
        series: [
          {
            id: "a",
            label: "Received",
            points: [
              { x: "100", value: 1 },
              { x: "97", value: 2 },
              { x: "108", value: 3 },
            ],
          },
        ],
      }),
    );
    expect(rows.map((r) => r["x"])).toEqual(["97", "100", "108"]);
  });
});

describe("axisTicks", () => {
  it("leaves year axes to the chart", () => {
    expect(axisTicks(block())).toBeUndefined();
  });
  it("labels a monthly axis on January of every fifth year", () => {
    const points = [];
    for (let y = 1981; y <= 2012; y += 1)
      for (let m = 1; m <= 12; m += 1)
        points.push({ x: `${y}-${String(m).padStart(2, "0")}`, value: 1 });
    const ticks = axisTicks(block({ xKind: "month", series: [{ id: "a", label: "v", points }] }));
    expect(ticks).toEqual(["1985-01", "1990-01", "1995-01", "2000-01", "2005-01", "2010-01"]);
  });
});

describe("isolatedPoint", () => {
  it("is true only for a recorded value with no recorded neighbour", () => {
    const rows = chartRows(block({ chart: "bar" }));
    expect(isolatedPoint(rows, 0, "a")).toBe(true);
    expect(isolatedPoint(rows, 2, "a")).toBe(false);
    expect(isolatedPoint(rows, 1, "a")).toBe(false);
    expect(isolatedPoint(rows, 1, "b")).toBe(false);
    expect(isolatedPoint(rows, 99, "a")).toBe(false);
  });
});

describe("tableRows", () => {
  it("lists every period, marks the partial one and writes a gap as Not recorded", () => {
    const rows = tableRows(block());
    expect(rows.map((r) => r.period)).toEqual(["2023", "2024", "2025", "2026*"]);
    expect(rows[1]!.cells).toEqual(["Not recorded", "6"]);
    expect(rows[3]!.partial).toBe(true);
    expect(rows[2]!.cells).toEqual(["30", "7"]);
  });
  it("names fiscal years and formats dollars", () => {
    const rows = tableRows(
      block({
        xKind: "fy",
        format: "usd",
        series: [{ id: "a", label: "Penalty", points: [{ x: "2025", value: 3_400_000 }] }],
      }),
    );
    expect(rows[0]).toEqual({ period: "FY2025", partial: false, cells: ["$3.4 million"] });
  });
});

describe("text alternatives", () => {
  it("describes the chart, its period, series and latest complete value", () => {
    const text = describeChart(block({ chart: "bar" }), "civil cases");
    expect(text).toContain("Bar chart of civil cases");
    expect(text).toContain("2023–2026*");
    expect(text).toContain("Series: Filed, Terminated");
    expect(text).toContain("Latest complete period 2025: 30 cases");
    expect(text).toContain("data table");
  });
  it("writes a tooltip value with its unit, or Not recorded", () => {
    const b = block();
    expect(tooltipValue(b, 1234)).toBe("1,234 cases");
    expect(tooltipValue(b, null)).toBe("Not recorded");
  });
});

describe("series colours", () => {
  it("are design tokens only and cycle after the last", () => {
    for (const c of SERIES_COLORS) expect(c).toMatch(/^var\(--[a-z-]+\)$/);
    expect(seriesColor(0)).toBe("var(--primary)");
    expect(seriesColor(SERIES_COLORS.length)).toBe(seriesColor(0));
  });
});
