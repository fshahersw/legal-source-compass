import { describe, expect, it } from "vitest";
import { beeswarm, densityBands, ridges } from "./layouts";

describe("d3 layouts", () => {
  it("beeswarm keeps marks at their value and resolves overlaps inside the lane", () => {
    const pts = Array.from({ length: 60 }, (_, i) => ({
      id: `p${i}`,
      x: 200 + (i % 3),
      lane: 100,
      r: 3,
    }));
    const out = beeswarm(pts, { spread: 60 });
    expect(out).toHaveLength(60);
    // deterministic for the same input
    expect(beeswarm(pts, { spread: 60 })).toEqual(out);
    for (const n of out) {
      expect(Math.abs(n.cy - 100)).toBeLessThanOrEqual(60);
      expect(n.x).toBe(pts.find((p) => p.id === n.id)!.x);
    }
    // few overlaps remain once the lane has room
    let overlaps = 0;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!,
          b = out[j]!;
        if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r - 0.5) overlaps++;
      }
    expect(overlaps).toBeLessThan(6);
    // a per-mark spread caps the drift
    const tight = beeswarm(pts.map((p) => ({ ...p, spread: 5 })));
    expect(Math.max(...tight.map((n) => Math.abs(n.cy - 100)))).toBeLessThanOrEqual(5);
  });

  it("density bands cover a cloud and return nothing for too few points", () => {
    const cloud = Array.from({ length: 200 }, (_, i) => ({
      x: 100 + (i % 20) * 2,
      y: 80 + Math.floor(i / 20) * 2,
    }));
    const bands = densityBands(cloud, 300, 200, { levels: 4 });
    expect(bands.length).toBeGreaterThan(0);
    expect(bands[0]!.path.startsWith("M")).toBe(true);
    expect(densityBands([{ x: 1, y: 1 }], 100, 100)).toEqual([]);
  });

  it("ridges scale each row to its own peak and break at gaps", () => {
    const [a, b] = ridges(
      [
        { id: "a", values: [0, 5, 10] },
        { id: "b", values: [100, null, 50] },
      ],
      { x0: 0, x1: 100, top: 0, step: 20, overlap: 2 },
    );
    expect(a!.base).toBe(20);
    expect(b!.base).toBe(40);
    expect(a!.peak).toBe(10);
    // the peak of each row reaches the same height above its own baseline
    expect(a!.base - a!.points[2]!.y).toBeCloseTo(40);
    expect(b!.base - b!.points[0]!.y).toBeCloseTo(40);
    expect(b!.points[1]!.value).toBeNull();
    // a gap splits the line into two segments
    expect((b!.line.match(/M/g) ?? []).length).toBe(2);
  });
});
