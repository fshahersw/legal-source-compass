import { describe, expect, it } from "vitest";
import { sparkGeometry } from "./sparkline";

describe("sparkGeometry", () => {
  it("draws one solid segment through complete points from a zero baseline", () => {
    const g = sparkGeometry([{ value: 0 }, { value: 5 }, { value: 10 }], 100, 20);
    expect(g.solid).toHaveLength(1);
    expect(g.solid[0]).toBe("M2 18 L50 10 L98 2");
    expect(g.dashed).toEqual([]);
    expect(g.dots).toEqual([]);
    expect(g.max).toBe(10);
  });

  it("breaks the line at a gap instead of interpolating across it", () => {
    const g = sparkGeometry(
      [{ value: 1 }, { value: 2 }, { value: null }, { value: 3 }, { value: 4 }],
      100,
      20,
    );
    expect(g.solid).toHaveLength(2);
  });

  it("joins a partial point by a dashed segment and marks it as a partial dot", () => {
    const g = sparkGeometry([{ value: 4 }, { value: 8 }, { value: 10, partial: true }], 100, 20);
    expect(g.solid).toHaveLength(1);
    expect(g.dashed).toHaveLength(1);
    expect(g.dots).toEqual([{ x: 98, y: 2, partial: true }]);
  });

  it("draws an isolated complete point as a dot", () => {
    const g = sparkGeometry([{ value: null }, { value: 3 }, { value: null }], 100, 20);
    expect(g.solid).toEqual([]);
    expect(g.dots).toEqual([{ x: 50, y: 2, partial: false }]);
  });

  it("returns nothing for a series with no value", () => {
    const g = sparkGeometry([{ value: null }, { value: null }], 100, 20);
    expect(g.solid).toEqual([]);
    expect(g.dashed).toEqual([]);
    expect(g.dots).toEqual([]);
    expect(g.max).toBe(0);
  });

  it("places the design-break tick midway between the two points it separates", () => {
    const points = Array.from({ length: 5 }, (_, i) => ({ value: i + 1 }));
    // x positions with pad 2 over width 100: 2, 26, 50, 74, 98; the tick sits between points 2 and 3
    expect(sparkGeometry(points, 100, 20, { breakBefore: 3 }).breakX).toBe(62);
    expect(sparkGeometry(points, 100, 20, { breakBefore: 0 }).breakX).toBeNull();
    expect(sparkGeometry(points, 100, 20, { breakBefore: 5 }).breakX).toBeNull();
    expect(sparkGeometry(points, 100, 20).breakX).toBeNull();
  });
});
