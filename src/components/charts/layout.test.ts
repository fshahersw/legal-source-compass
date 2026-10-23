import { describe, expect, it } from "vitest";
import {
  comparePeriods,
  compactNumber,
  densePeriods,
  formatUsd,
  metricFormatter,
  percentChange,
  periodLabel,
  periodTick,
  valueWithUnit,
} from "./format";
import { networkLayout } from "./networkLayout";
import { rankItems } from "./RankedBars";
import { ribbonPath, sankeyLayout } from "./sankeyLayout";
import {
  dodgeLabels,
  labelStride,
  linearScale,
  niceDomain,
  niceStep,
  pointPositions,
} from "./scale";
import {
  alignToAxis,
  changeVsPrevious,
  extentValues,
  gapCount,
  isolatedIndices,
  lineSegments,
  moeRuns,
  tableRows,
  type PeriodAxis,
} from "./series";
import { ranksIn, topMovers } from "./SlopeChart";
import { stepPoints, survivalAt } from "./SurvivalCurve";
import { stackDots } from "./DistributionStrip";
import { kaplanMeier } from "./stats";
import { seriesVar, sequentialFill, divergingFill, MAX_SERIES } from "./palette";

describe("format", () => {
  it("writes each contract format, and Not recorded for a missing value", () => {
    expect(metricFormatter("count").full(1234567)).toBe("1,234,567");
    expect(metricFormatter("rate_per_100k").full(12.345)).toBe("12.3");
    expect(metricFormatter("percent").full(7)).toBe("7.0%");
    expect(metricFormatter("currency_usd").full(4_100_000)).toBe("$4.1 million");
    expect(metricFormatter("months").full(14.25)).toBe("14.3");
    expect(metricFormatter("ratio").full(1.5)).toBe("1.50");
    expect(metricFormatter("count").full(null)).toBe("Not recorded");
    expect(metricFormatter("percent").delta(-2.25)).toBe("−2.3 percentage points");
    expect(metricFormatter("count").delta(1204)).toBe("+1,204");
  });

  it("adds the unit only when the format does not already carry it", () => {
    expect(valueWithUnit(1200, "count", "cases")).toBe("1,200 cases");
    expect(valueWithUnit(12, "percent", "percent")).toBe("12.0%");
    expect(valueWithUnit(null, "count", "cases")).toBe("Not recorded");
  });

  it("compacts ticks and dollars", () => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(1200)).toBe("1.2k");
    expect(compactNumber(12000)).toBe("12k");
    expect(compactNumber(1_400_000)).toBe("1.4M");
    expect(compactNumber(2_000_000, "$")).toBe("$2M");
    expect(formatUsd(497000)).toBe("$497,000");
    expect(formatUsd(3.94e9)).toBe("$3.94 billion");
  });

  it("computes a relative change only from a non-zero base", () => {
    expect(percentChange(100, 125)).toBe(25);
    expect(percentChange(0, 5)).toBeNull();
    expect(percentChange(null, 5)).toBeNull();
  });

  it("labels every contract period type", () => {
    expect(periodLabel("2024", "year")).toBe("2024");
    expect(periodLabel("FY2024", "fiscal_year")).toBe("FY2024");
    expect(periodTick("FY2024", "fiscal_year")).toBe("FY24");
    expect(periodLabel("2024-Q3", "quarter")).toBe("Q3 2024");
    expect(periodLabel("2024-06", "month")).toBe("June 2024");
    expect(periodTick("2024-06", "month")).toBe("Jun 2024");
    expect(periodLabel("2024-06-30", "twelve_months_ending")).toBe(
      "12 months ending June 30, 2024",
    );
    expect(periodLabel("2026-10-01", "snapshot")).toBe("As of October 1, 2026");
    expect(periodLabel("2026-02-30", "snapshot")).toBe("2026-02-30");
  });

  it("orders fiscal years numerically and fills fixed-cadence gaps", () => {
    expect(["FY2010", "FY999", "FY2009"].sort(comparePeriods)).toEqual([
      "FY999",
      "FY2009",
      "FY2010",
    ]);
    expect(densePeriods(["2019", "2022"], "year")).toEqual(["2019", "2020", "2021", "2022"]);
    expect(densePeriods(["FY2019", "FY2021"], "fiscal_year")).toEqual([
      "FY2019",
      "FY2020",
      "FY2021",
    ]);
    expect(densePeriods(["2023-Q4", "2024-Q2"], "quarter")).toEqual([
      "2023-Q4",
      "2024-Q1",
      "2024-Q2",
    ]);
    expect(densePeriods(["2023-11", "2024-02"], "month")).toEqual([
      "2023-11",
      "2023-12",
      "2024-01",
      "2024-02",
    ]);
    // no fixed cadence: kept as given
    expect(densePeriods(["2024-06-30", "2022-06-30"], "twelve_months_ending")).toEqual([
      "2022-06-30",
      "2024-06-30",
    ]);
  });
});

describe("scale", () => {
  it("maps and inverts linearly", () => {
    const s = linearScale([0, 10], [100, 200]);
    expect(s(5)).toBe(150);
    expect(s.invert(150)).toBe(5);
    expect(linearScale([3, 3], [0, 10])(3)).toBe(5);
  });

  it("chooses nice steps and domains that include zero by default", () => {
    expect(niceStep(0, 100, 5)).toBe(20);
    expect(niceStep(0, 7, 4)).toBe(2);
    const d = niceDomain([12, 87]);
    expect(d.domain).toEqual([0, 100]);
    expect(d.ticks).toEqual([0, 20, 40, 60, 80, 100]);
    const nz = niceDomain([52, 87], { zero: false });
    expect(nz.domain[0]).toBeGreaterThan(0);
    const flat = niceDomain([5, 5]);
    expect(flat.domain[0]).toBe(0);
    expect(flat.domain[1]).toBeGreaterThanOrEqual(5);
    expect(niceDomain([5, 5], { zero: false }).domain[1]).toBeGreaterThan(5);
  });

  it("spaces categories and labels regularly", () => {
    expect(pointPositions(2, [0, 100])).toEqual([25, 75]);
    expect(labelStride(20, 200, 40)).toBe(4);
    expect(labelStride(4, 400, 40)).toBe(1);
  });

  it("dodges colliding end labels without reordering them", () => {
    const out = dodgeLabels([50, 52, 120], 12, 0, 200);
    expect(out[1]! - out[0]!).toBeGreaterThanOrEqual(12);
    expect(out[2]).toBe(120);
    const crowded = dodgeLabels([195, 196, 197], 10, 0, 200);
    expect(Math.max(...crowded)).toBeLessThanOrEqual(200);
    expect(crowded[2]! - crowded[1]!).toBeGreaterThanOrEqual(10);
  });
});

describe("series model", () => {
  const keys = ["2019", "2020", "2021", "2022", "2023", "2024"];
  const s = {
    id: "a",
    label: "A",
    points: [
      { key: "2019", value: 10 },
      { key: "2020", value: 12 },
      { key: "2021", value: null },
      { key: "2022", value: 15 },
      { key: "2023", value: 16 },
      { key: "2024", value: 9, partial: true },
    ],
  };

  it("never draws across a gap and dashes edges touching a partial period", () => {
    const a = alignToAxis(s, keys);
    expect(lineSegments(a)).toEqual([
      { dashed: false, indices: [0, 1] },
      { dashed: false, indices: [3, 4] },
      { dashed: true, indices: [4, 5] },
    ]);
    expect(gapCount(a)).toBe(1);
  });

  it("dots a recorded point with no recorded neighbour", () => {
    const a = alignToAxis({ id: "b", label: "B", points: [{ key: "2021", value: 3 }] }, keys);
    expect(isolatedIndices(a)).toEqual([2]);
    expect(lineSegments(a)).toEqual([]);
  });

  it("computes the change from the last complete period to the one before it, else withholds it", () => {
    const change = changeVsPrevious(alignToAxis(s, keys), keys)!;
    expect(change).toMatchObject({ latestKey: "2023", previousKey: "2022", absolute: 1 });
    expect(change.percent).toBeCloseTo(6.6667, 3);
    const gapBefore = {
      ...s,
      points: s.points.map((p) => (p.key === "2022" ? { ...p, value: null } : p)),
    };
    expect(changeVsPrevious(alignToAxis(gapBefore, keys), keys)).toBeNull();
  });

  it("keeps margin-of-error runs and extents, and lists a table row per period", () => {
    const m = {
      id: "m",
      label: "M",
      points: [
        { key: "2019", value: 10, moe: 2 },
        { key: "2020", value: 11, moe: 1 },
        { key: "2021", value: 12 },
      ],
    };
    const a = alignToAxis(m, keys);
    expect(moeRuns(a)).toEqual([
      [
        { index: 0, lo: 8, hi: 12 },
        { index: 1, lo: 10, hi: 12 },
      ],
    ]);
    expect(Math.min(...extentValues([m]))).toBe(8);
    const axis: PeriodAxis = { keys, label: (k) => k, tick: (k) => k };
    const rows = tableRows([s, m], axis, (v) => String(v));
    expect(rows[2]).toEqual({ key: "2021", period: "2021", cells: ["Not recorded", "12"] });
    expect(rows[0]!.cells[1]).toBe("10 ± 2");
    expect(rows[5]!.period).toBe("2024*");
  });
});

describe("ranking helpers", () => {
  it("competition-ranks and sets entities without a value apart", () => {
    const { ranked, missing } = rankItems([
      { id: "a", label: "A", value: 5 },
      { id: "b", label: "B", value: 9 },
      { id: "c", label: "C", value: 5 },
      { id: "d", label: "D", value: null },
    ]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 2],
    ]);
    expect(missing.map((m) => m.id)).toEqual(["d"]);
  });

  it("ranks periods and finds the largest movers", () => {
    const items = [
      { id: "a", label: "A", values: { "2020": 1, "2024": 10 } },
      { id: "b", label: "B", values: { "2020": 5, "2024": 4 } },
      { id: "c", label: "C", values: { "2020": 3, "2024": null } },
    ];
    expect([...ranksIn(items, "2020").entries()]).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
    expect(topMovers(items, "2020", "2024", 2)).toEqual(["a", "b"]);
    expect(topMovers(items, "2020", "2024", 1, "rank")).toEqual(["a"]);
  });
});

describe("sankey layout", () => {
  const nodes = [
    { id: "o1", label: "Origin 1", column: 0 },
    { id: "o2", label: "Origin 2", column: 0 },
    { id: "m1", label: "MDL 1", column: 1 },
    { id: "m2", label: "MDL 2", column: 1 },
  ];
  const links = [
    { source: "o1", target: "m1", value: 30 },
    { source: "o1", target: "m2", value: 10 },
    { source: "o2", target: "m2", value: 20 },
    { source: "o2", target: "zz", value: 99 },
  ];
  const lay = sankeyLayout(nodes, links, { width: 300, height: 200, nodeWidth: 10, padding: 10 });

  it("sizes nodes by flow and keeps ribbon widths summing to node heights", () => {
    const byId = new Map(lay.nodes.map((n) => [n.id, n]));
    expect(byId.get("o1")!.value).toBe(40);
    expect(byId.get("m2")!.value).toBe(30);
    const h = (id: string) => byId.get(id)!.y1 - byId.get(id)!.y0;
    expect(h("o1") / h("o2")).toBeCloseTo(2, 9);
    const outW = lay.links.filter((l) => l.source === "o1").reduce((s, l) => s + l.width, 0);
    expect(outW).toBeCloseTo(h("o1"), 9);
    // links to unknown nodes are dropped, never guessed
    expect(lay.links.some((l) => l.target === "zz")).toBe(false);
  });

  it("fits inside the box without overlapping nodes in a column", () => {
    for (const col of [0, 1]) {
      const ns = lay.nodes.filter((n) => n.column === col).sort((a, b) => a.y0 - b.y0);
      for (let i = 1; i < ns.length; i++) expect(ns[i]!.y0).toBeGreaterThanOrEqual(ns[i - 1]!.y1);
      expect(Math.max(...ns.map((n) => n.y1))).toBeLessThanOrEqual(200 + 1e-9);
    }
    expect(ribbonPath({ x0: 0, x1: 10, y0: 1, y1: 2 })).toBe("M0,1C5,1 5,2 10,2");
  });
});

describe("network layout", () => {
  const nodes = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, label: id, weight: 5 - i }));
  const edges = [
    { a: "a", b: "b", weight: 5 },
    { a: "b", b: "c", weight: 2 },
    { a: "d", b: "e", weight: 1 },
  ];

  it("is deterministic and stays inside the box", () => {
    const one = networkLayout(nodes, edges, { width: 400, height: 300, seed: 3 });
    const two = networkLayout(nodes, edges, { width: 400, height: 300, seed: 3 });
    expect(one.nodes.map((n) => [n.x, n.y])).toEqual(two.nodes.map((n) => [n.x, n.y]));
    for (const n of one.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(400);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(300);
    }
    expect(one.nodes.find((n) => n.id === "b")!.degree).toBe(2);
  });

  it("draws linked nodes nearer than unlinked ones", () => {
    const laid = networkLayout(nodes, edges, { width: 400, height: 300, seed: 3 });
    const at = new Map(laid.nodes.map((n) => [n.id, n]));
    const d = (p: string, q: string) =>
      Math.hypot(at.get(p)!.x - at.get(q)!.x, at.get(p)!.y - at.get(q)!.y);
    expect(d("a", "b")).toBeLessThan(d("a", "e"));
  });
});

describe("survival drawing helpers", () => {
  it("steps through the estimate and reads the level at a time", () => {
    const km = kaplanMeier([
      { id: "a", entry: 0, exit: 1, event: true },
      { id: "b", entry: 0, exit: 3, event: true },
      { id: "c", entry: 0, exit: 4, event: false },
    ]);
    const pts = stepPoints(km, 4);
    const want = [
      [0, 1],
      [1, 1],
      [1, 2 / 3],
      [3, 2 / 3],
      [3, 1 / 3],
      [4, 1 / 3],
    ];
    expect(pts).toHaveLength(want.length);
    pts.forEach(([t, s], i) => {
      expect(t).toBe(want[i]![0]);
      expect(s).toBeCloseTo(want[i]![1]!, 12);
    });
    expect(survivalAt(km, 2).s).toBeCloseTo(2 / 3, 12);
    expect(survivalAt(km, 0.5).s).toBe(1);
  });
});

describe("distribution helpers", () => {
  it("stacks dots that would overlap", () => {
    const levels = stackDots([10, 11, 12, 100], 5);
    expect(levels[3]).toBe(0);
    expect(new Set(levels.slice(0, 3)).size).toBe(3);
  });
});

describe("palette", () => {
  it("never cycles categorical slots and clamps scales", () => {
    expect(seriesVar(0)).toBe("var(--chart-1)");
    expect(() => seriesVar(MAX_SERIES)).toThrow(RangeError);
    expect(sequentialFill(2)).toContain("95%");
    expect(divergingFill(-1)).toContain("var(--chart-2) 85%");
    expect(divergingFill(0)).toContain("0%");
  });
});
