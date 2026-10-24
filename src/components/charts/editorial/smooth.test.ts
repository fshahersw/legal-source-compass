import { describe, expect, it } from "vitest";
import { seededRandom } from "../stats";
import { MIN_SMOOTH_POINTS, loess, outlierIndices, t95 } from "./smooth";

describe("t quantile", () => {
  it("matches the textbook two-sided 95% values", () => {
    expect(t95(10)).toBeCloseTo(2.228, 2);
    expect(t95(30)).toBeCloseTo(2.042, 2);
    expect(t95(1000)).toBe(1.96);
    expect(t95(0)).toBeNaN();
  });
});

describe("loess", () => {
  const xs = Array.from({ length: 24 }, (_, i) => i + 1);

  it("reproduces an exact line with a zero-width band", () => {
    const ys = xs.map((x) => 2 * x + 1);
    const r = loess(xs, ys)!;
    r.fitted.forEach((f, i) => expect(f).toBeCloseTo(ys[i]!, 6));
    for (const g of r.grid) {
      expect(g.fit).toBeCloseTo(2 * g.x + 1, 5);
      expect(g.hi - g.lo).toBeLessThan(1e-5);
    }
    expect(r.grid[0]!.x).toBe(1);
    expect(r.grid.at(-1)!.x).toBe(24);
  });

  it("follows a curve a straight line would miss", () => {
    const ys = xs.map((x) => (x - 12) ** 2);
    const r = loess(xs, ys, { span: 0.5, degree: 2 })!;
    const mid = r.grid.find((g) => Math.abs(g.x - 12) < 0.4)!;
    expect(mid.fit).toBeLessThan(5);
    expect(r.grid[0]!.fit).toBeGreaterThan(80);
  });

  it("gives a band that covers the true line most of the time across noisy samples", () => {
    let covered = 0;
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rnd = seededRandom(seed);
      const px = Array.from({ length: 80 }, (_, i) => i / 4);
      const py = px.map((x) => 3 + 0.5 * x + (rnd() + rnd() + rnd() + rnd() - 2) * 1.7);
      const r = loess(px, py)!;
      for (const g of r.grid) {
        total += 1;
        if (g.lo <= 3 + 0.5 * g.x && 3 + 0.5 * g.x <= g.hi) covered += 1;
      }
      expect(r.sigma).toBeGreaterThan(0.3);
      expect(r.sigma).toBeLessThan(1.5);
      expect(r.df).toBeGreaterThan(40);
      expect(r.grid.every((g) => g.lo < g.fit && g.fit < g.hi)).toBe(true);
    }
    expect(covered / total).toBeGreaterThan(0.8);
  });

  it("draws nothing for too few points or too few distinct x values", () => {
    expect(loess([1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7])).toBeNull();
    expect(MIN_SMOOTH_POINTS).toBe(8);
    expect(loess([1, 1, 1, 2, 2, 2, 2, 2], [1, 2, 3, 4, 5, 6, 7, 8])).toBeNull();
  });

  it("names the points farthest from the fit", () => {
    const ys = xs.map((x) => 2 * x);
    const noisy = [...ys];
    noisy[10] = ys[10]! + 40;
    const r = loess(xs, noisy)!;
    expect(outlierIndices(noisy, r.fitted, r.sigma, { z: 1.5 })[0]).toBe(10);
    expect(outlierIndices(noisy, r.fitted, 0)).toEqual([]);
  });
});
