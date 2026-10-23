import { describe, expect, it } from "vitest";
import {
  alignedSummary,
  benjaminiHochberg,
  boxStats,
  correlationTest,
  incompleteBeta,
  kaplanMeier,
  kmeans,
  lnGamma,
  median,
  ols,
  pearson,
  quantile,
  ranks,
  sd,
  seededRandom,
  silhouette,
  spearman,
  standardize,
  tTwoSidedP,
  underObservation,
} from "./stats";

describe("descriptive statistics", () => {
  it("computes R type-7 quantiles, the median and the sample SD", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(s, 0.25)).toBeCloseTo(3.25, 12);
    expect(quantile(s, 0.75)).toBeCloseTo(7.75, 12);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138089935, 8);
    expect(quantile([], 0.5)).toBeNull();
  });

  it("gives tied values the average of their ranks", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(ranks([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it("summarizes a box plot with Tukey whiskers and outliers", () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])!;
    expect(b.median).toBe(5.5);
    expect(b.q1).toBe(3.25);
    expect(b.q3).toBe(7.75);
    expect(b.highWhisker).toBe(9);
    expect(b.outliers).toEqual([100]);
    expect(boxStats([])).toBeNull();
  });
});

describe("special functions", () => {
  it("matches known values of ln Γ and the incomplete beta", () => {
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 10);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
    expect(incompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 10);
    expect(incompleteBeta(0.3, 1, 1)).toBeCloseTo(0.3, 10);
  });

  it("gives Student t two-sided p-values that match the tables", () => {
    expect(tTwoSidedP(2.228138852, 10)).toBeCloseTo(0.05, 6);
    expect(tTwoSidedP(12.70620474, 1)).toBeCloseTo(0.05, 6);
    expect(tTwoSidedP(2.008559112, 50)).toBeCloseTo(0.05, 6);
    expect(tTwoSidedP(0, 7)).toBeCloseTo(1, 10);
  });
});

describe("correlation", () => {
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 5, 4, 5];

  it("matches R's cor.test for Pearson (r, t-based p, Fisher-z interval)", () => {
    const t = correlationTest(x, y, "pearson")!;
    expect(t.coefficient).toBeCloseTo(0.7745966692, 9);
    // R: t = 2.1213, df = 3, p-value = 0.124; 95% CI -0.3401 to 0.9844
    expect(t.p).toBeCloseTo(0.124, 3);
    expect(t.ci![0]).toBeCloseTo(-0.3401, 3);
    expect(t.ci![1]).toBeCloseTo(0.9844, 3);
  });

  it("computes Spearman on average ranks", () => {
    expect(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])).toBeCloseTo(0.8207826817, 9);
    expect(spearman([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
  });

  it("returns null without enough pairs or without variance", () => {
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(correlationTest([1, 2, 3], [2, 1, 3], "pearson")).toBeNull();
  });

  it("reports a perfect association with p = 0 and a degenerate interval", () => {
    const t = correlationTest([1, 2, 3, 4, 5], [2, 4, 6, 8, 10], "pearson")!;
    expect(t.coefficient).toBe(1);
    expect(t.p).toBe(0);
    expect(t.ci).toEqual([1, 1]);
  });

  it("widens the Spearman interval by the 1.06 variance factor", () => {
    const xs = Array.from({ length: 30 }, (_, i) => i);
    const ys = xs.map((v, i) => v + ((i * 7) % 5));
    const p = correlationTest(xs, ys, "pearson")!;
    const s = correlationTest(xs, ys, "spearman")!;
    expect(s.ci![1] - s.ci![0]).toBeGreaterThan(0);
    expect(p.ci![0]).toBeLessThan(p.coefficient);
  });
});

describe("least squares", () => {
  it("fits slope, intercept, R² and residuals", () => {
    const fit = ols([1, 2, 3, 4], [2, 4, 5, 8])!;
    expect(fit.slope).toBeCloseTo(1.9, 12);
    expect(fit.intercept).toBeCloseTo(0, 12);
    expect(fit.residuals.map((r) => Number(r.toFixed(6)))).toEqual([0.1, 0.2, -0.7, 0.4]);
    expect(fit.r2).toBeCloseTo(0.9627, 4);
    expect(ols([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe("Benjamini–Hochberg", () => {
  it("matches R's p.adjust(method = 'BH')", () => {
    expect(benjaminiHochberg([0.01, 0.04, 0.03, 0.005])).toEqual([0.02, 0.04, 0.04, 0.02]);
    const q = benjaminiHochberg([0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205]);
    expect(q.map((v) => Number(v.toFixed(4)))).toEqual([
      0.008, 0.032, 0.0672, 0.0672, 0.0672, 0.08, 0.0846, 0.205,
    ]);
    expect(benjaminiHochberg([0.9, 0.95])).toEqual([0.95, 0.95]);
  });
});

describe("Kaplan–Meier", () => {
  it("reproduces the textbook product-limit estimate with censoring", () => {
    // times 1, 2, 2, 3+, 4, 5+  (event unless +)
    const km = kaplanMeier([
      { id: "a", entry: 0, exit: 1, event: true },
      { id: "b", entry: 0, exit: 2, event: true },
      { id: "c", entry: 0, exit: 2, event: true },
      { id: "d", entry: 0, exit: 3, event: false },
      { id: "e", entry: 0, exit: 4, event: true },
      { id: "f", entry: 0, exit: 5, event: false },
    ]);
    expect(km.steps.map((s) => [s.time, s.atRisk, s.events])).toEqual([
      [1, 6, 1],
      [2, 5, 2],
      [4, 2, 1],
    ]);
    expect(km.steps[0]!.survival).toBeCloseTo(5 / 6, 12);
    expect(km.steps[1]!.survival).toBeCloseTo(0.5, 12);
    expect(km.steps[2]!.survival).toBeCloseTo(0.25, 12);
    expect(km.medianTime).toBe(2);
    expect(km.censorMarks).toEqual([
      { time: 3, survival: 0.5 },
      { time: 5, survival: 0.25 },
    ]);
    expect(km.events).toBe(4);
    expect(km.censored).toBe(2);
    // Greenwood log-scale interval at t = 1: se(log S) = sqrt(1 / (6 * 5))
    const se = Math.sqrt(1 / 30);
    expect(km.steps[0]!.lower).toBeCloseTo((5 / 6) * Math.exp(-1.959964 * se), 5);
    expect(km.steps[0]!.upper).toBe(1);
  });

  it("keeps late entrants out of the risk set until they enter (delayed entry)", () => {
    const subjects = [
      { id: "early", entry: 0, exit: 2, event: false },
      { id: "late", entry: 3, exit: 6, event: true },
      { id: "late2", entry: 3, exit: 8, event: false },
    ];
    const km = kaplanMeier(subjects);
    expect(km.steps.map((s) => [s.time, s.atRisk, s.events])).toEqual([[6, 2, 1]]);
    expect(km.steps[0]!.survival).toBeCloseTo(0.5, 12);
    expect(underObservation(subjects, 1)).toBe(1);
    expect(underObservation(subjects, 4)).toBe(2);
  });

  it("reports a median that is not reached as null", () => {
    const km = kaplanMeier([
      { id: "a", entry: 0, exit: 1, event: true },
      { id: "b", entry: 0, exit: 9, event: false },
      { id: "c", entry: 0, exit: 9, event: false },
    ]);
    expect(km.medianTime).toBeNull();
  });
});

describe("k-means", () => {
  const blobs = [
    [0, 0],
    [0.1, 0.2],
    [0.2, -0.1],
    [5, 5],
    [5.2, 4.9],
    [4.8, 5.1],
    [5.1, 5.2],
  ];

  it("is deterministic for a seed and finds well separated groups", () => {
    const a = kmeans(blobs, 2, { seed: 7 })!;
    const b = kmeans(blobs, 2, { seed: 7 })!;
    expect(a.assignments).toEqual(b.assignments);
    // the larger group (4 points) is cluster 0
    expect(a.assignments).toEqual([1, 1, 1, 0, 0, 0, 0]);
    expect(a.sizes).toEqual([4, 3]);
    expect(a.silhouette!).toBeGreaterThan(0.9);
  });

  it("refuses impossible requests", () => {
    expect(kmeans(blobs, 0)).toBeNull();
    expect(kmeans(blobs.slice(0, 2), 3)).toBeNull();
  });

  it("standardizes columns to mean 0 and SD 1", () => {
    const { z, means, sds } = standardize([
      [1, 10],
      [2, 10],
      [3, 10],
    ]);
    expect(means).toEqual([2, 10]);
    expect(sds[0]).toBeCloseTo(1, 12);
    expect(z.map((r) => r[0])).toEqual([-1, 0, 1]);
    expect(z.map((r) => r[1])).toEqual([0, 0, 0]);
  });

  it("produces a repeatable random sequence", () => {
    const r1 = seededRandom(42);
    const r2 = seededRandom(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });

  it("scores a meaningless split near zero or below", () => {
    const line = [[0], [1], [2], [3]];
    expect(silhouette(line, [0, 1, 0, 1], 2)!).toBeLessThan(0.1);
  });
});

describe("aligned summaries (event studies)", () => {
  it("gives the median, quartiles and n at each offset", () => {
    const s = alignedSummary([
      { offset: 0, value: 1 },
      { offset: 0, value: 3 },
      { offset: 0, value: 5 },
      { offset: 1, value: 10 },
      { offset: 1, value: Number.NaN },
    ]);
    expect(s).toEqual([
      { offset: 0, n: 3, median: 3, q1: 2, q3: 4 },
      { offset: 1, n: 1, median: 10, q1: 10, q3: 10 },
    ]);
  });
});
