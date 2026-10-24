import { describe, expect, it } from "vitest";
import { divergingDomain, rebase, stackLayers, sunburstLayout } from "./maths";

describe("d3 maths", () => {
  it("rebases to the chosen date and keeps gaps null", () => {
    const [s] = rebase([{ id: "a", label: "A", points: [{ date: "2020", value: 50 }, { date: "2021", value: 100 }, { date: "2022", value: null }] }], "2020");
    expect(s!.points.map((p) => p.value)).toEqual([0, 1, null]);
  });
  it("yields nulls when the base value is missing", () => {
    const [s] = rebase([{ id: "a", label: "A", points: [{ date: "2020", value: null }, { date: "2021", value: 5 }] }], "2020");
    expect(s!.points.every((p) => p.value === null)).toBe(true);
  });
  it("stacks and reports missing cells", () => {
    const r = stackLayers([{ period: "2024", values: { x: 2, y: null } }, { period: "2025", values: { x: 1, y: 3 } }], ["x", "y"]);
    expect(r.max).toBe(4);
    expect(r.gaps).toEqual([{ period: "2024", key: "y" }]);
  });
  it("centres the diverging domain on the baseline", () => {
    expect(divergingDomain([8, 14, null], 10)).toEqual([6, 14]);
  });
  it("partitions a sunburst over the full circle", () => {
    const nodes = sunburstLayout({ name: "r", children: [{ name: "a", value: 3 }, { name: "b", value: 1 }] }, 100);
    const a = nodes.find((n) => n.data.name === "a")!;
    expect(a.x1 - a.x0).toBeCloseTo(1.5 * Math.PI);
  });
});
