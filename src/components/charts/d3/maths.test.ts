import { describe, expect, it } from "vitest";
import {
  divergingDomain,
  fitLabel,
  rebase,
  ringLabelFits,
  ringVisible,
  spreadLabels,
  stackLayers,
  sunburstLayout,
  zoomArc,
} from "./maths";

describe("d3 maths", () => {
  it("rebases to the chosen date and keeps gaps null", () => {
    const [s] = rebase(
      [
        {
          id: "a",
          label: "A",
          points: [
            { date: "2020", value: 50 },
            { date: "2021", value: 100 },
            { date: "2022", value: null },
          ],
        },
      ],
      "2020",
    );
    expect(s!.points.map((p) => p.value)).toEqual([0, 1, null]);
  });
  it("yields nulls when the base value is missing", () => {
    const [s] = rebase(
      [
        {
          id: "a",
          label: "A",
          points: [
            { date: "2020", value: null },
            { date: "2021", value: 5 },
          ],
        },
      ],
      "2020",
    );
    expect(s!.points.every((p) => p.value === null)).toBe(true);
  });
  it("stacks and reports missing cells", () => {
    const r = stackLayers(
      [
        { period: "2024", values: { x: 2, y: null } },
        { period: "2025", values: { x: 1, y: 3 } },
      ],
      ["x", "y"],
    );
    expect(r.max).toBe(4);
    expect(r.gaps).toEqual([{ period: "2024", key: "y" }]);
  });
  it("centres the diverging domain on the baseline", () => {
    expect(divergingDomain([8, 14, null], 10)).toEqual([6, 14]);
  });
  it("partitions a sunburst over the full circle", () => {
    const nodes = sunburstLayout(
      {
        name: "r",
        children: [
          { name: "a", value: 3 },
          { name: "b", value: 1 },
        ],
      },
      100,
    );
    const a = nodes.find((n) => n.data.name === "a")!;
    expect(a.x1 - a.x0).toBeCloseTo(1.5 * Math.PI);
  });
  it("spreads colliding labels apart and keeps them in bounds", () => {
    expect(spreadLabels([50, 52, 200], 12, 0, 300)).toEqual([50, 62, 200]);
    expect(spreadLabels([295, 298], 12, 0, 300)).toEqual([288, 300]);
  });
  it("zooms a segment to the full circle and lifts its children to the first ring", () => {
    const p = { x0: Math.PI / 2, x1: Math.PI, y0: 1, y1: 2, depth: 1 };
    const self = zoomArc(p, p);
    expect(self.x0).toBeCloseTo(0);
    expect(self.x1).toBeCloseTo(2 * Math.PI);
    expect(self.y0).toBe(0);
    const child = zoomArc({ x0: Math.PI / 2, x1: (3 * Math.PI) / 4, y0: 2, y1: 3 }, p);
    expect(child.x1).toBeCloseTo(Math.PI);
    expect(child.y0).toBe(1);
    const outside = zoomArc({ x0: 0, x1: Math.PI / 4, y0: 1, y1: 2 }, p);
    expect(outside.x1 - outside.x0).toBe(0);
  });
  it("shows rings 1..n only and labels only segments wide enough", () => {
    expect(ringVisible({ x0: 0, x1: 1, y0: 1, y1: 2 }, 2)).toBe(true);
    expect(ringVisible({ x0: 0, x1: 1, y0: 0, y1: 1 }, 2)).toBe(false);
    expect(ringVisible({ x0: 0, x1: 1, y0: 3, y1: 4 }, 2)).toBe(false);
    const rad = (y: number) => y * 50;
    expect(ringLabelFits({ x0: 0, x1: 0.5, y0: 1, y1: 2 }, 2, rad)).toBe(true);
    expect(ringLabelFits({ x0: 0, x1: 0.05, y0: 1, y1: 2 }, 2, rad)).toBe(false);
    expect(fitLabel("Products liability", 10)).toBe("Products…");
    expect(fitLabel("Torts", 10)).toBe("Torts");
    expect(fitLabel("Torts", 2)).toBeNull();
  });
});
