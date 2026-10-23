import { describe, expect, it } from "vitest";
import {
  alignEvents,
  averageRanks,
  benjaminiHochberg,
  cagr,
  erfc,
  incompleteBeta,
  kaplanMeier,
  kmeans,
  logGamma,
  normalCdf,
  normalQuantile,
  ols,
  pearson,
  percentChange,
  seededRandom,
  spearman,
  tTwoSidedP,
} from "./model";

// Anscombe's quartet, data set I (Anscombe 1973; R `datasets::anscombe` x1, y1).
const X1 = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
const Y1 = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];

describe("distributions", () => {
  it("log-gamma matches known values", () => {
    expect(logGamma(1)).toBeCloseTo(0, 12);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
  });
  it("incomplete beta matches closed forms", () => {
    expect(incompleteBeta(0.3, 1, 1)).toBeCloseTo(0.3, 12);
    expect(incompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 12);
    expect(incompleteBeta(0.2, 2, 3)).toBeCloseTo(0.1808, 10); // 1 − (1−x)^3 (1 + 3x)
  });
  it("Student t two-sided p-values match t tables", () => {
    expect(tTwoSidedP(2.262157, 9)).toBeCloseTo(0.05, 6);
    expect(tTwoSidedP(3.249836, 9)).toBeCloseTo(0.01, 6);
    expect(tTwoSidedP(1.959964, 1e7)).toBeCloseTo(0.05, 5);
    expect(tTwoSidedP(0, 5)).toBeCloseTo(1, 12);
  });
  it("normal quantile and CDF match tables", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 13);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 15);
    expect(normalQuantile(0.005)).toBeCloseTo(-2.5758293035489, 12);
    expect(normalQuantile(1e-10)).toBeCloseTo(-6.361340902404056, 9);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 14);
    expect(erfc(0.5)).toBeCloseTo(0.4795001221869535, 14);
    expect(erfc(3)).toBeCloseTo(2.209049699858544e-5, 18);
    expect(() => normalQuantile(1)).toThrow(RangeError);
  });
});

describe("correlation", () => {
  it("Pearson on Anscombe I matches R cor.test (r, t-test p, Fisher interval)", () => {
    const c = pearson(X1, Y1);
    expect(c.n).toBe(11);
    expect(c.r).toBeCloseTo(0.8164205, 7);
    expect(c.p).toBeCloseTo(0.00217, 5);
    // Fisher z interval as R computes it: tanh(atanh(r) ± qnorm(0.975) / sqrt(n − 3))
    const z = Math.atanh(c.r!);
    const half = 1.959963984540054 / Math.sqrt(8);
    expect(c.ci!.low).toBeCloseTo(Math.tanh(z - half), 12);
    expect(c.ci!.high).toBeCloseTo(Math.tanh(z + half), 12);
    expect(c.ci!.low).toBeCloseTo(0.4244, 4);
    expect(c.ci!.high).toBeCloseTo(0.9507, 4);
    expect(c.warning).toBeNull();
  });
  it("Spearman on Anscombe I matches R (rho) with a t-approximation p-value", () => {
    const c = spearman(X1, Y1);
    expect(c.r).toBeCloseTo(0.8181818, 7);
    const t = 0.8181818181818182 * Math.sqrt(9 / (1 - 0.8181818181818182 ** 2));
    expect(c.p).toBeCloseTo(tTwoSidedP(t, 9), 12);
    expect(c.p!).toBeLessThan(0.01);
    expect(c.ci!.low).toBeLessThan(c.r!);
    expect(c.ci!.high).toBeGreaterThan(c.r!);
  });
  it("average ranks give ties their mean rank", () => {
    expect(averageRanks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });
  it("drops non-finite pairs, warns on small n and refuses a constant variable", () => {
    const c = pearson([1, 2, Number.NaN, 4], [2, 4, 5, 9]);
    expect(c.n).toBe(3);
    expect(c.warning).toMatch(/Only 3 pairs/);
    expect(c.ci).toBeNull();
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4]).r).toBeNull();
    expect(pearson([1, 2], [3, 4]).r).toBeNull();
  });
});

describe("least squares", () => {
  it("matches R lm(y1 ~ x1) on Anscombe I", () => {
    const fit = ols(X1, Y1)!;
    expect(fit.intercept).toBeCloseTo(3.000091, 5);
    expect(fit.slope).toBeCloseTo(0.5000909, 6);
    expect(fit.r2).toBeCloseTo(0.6665425, 6);
    expect(fit.residualSe).toBeCloseTo(1.236603, 5);
    expect(fit.seSlope).toBeCloseTo(0.1179055, 6);
    expect(fit.seIntercept).toBeCloseTo(1.1247468, 6);
    expect(fit.pSlope).toBeCloseTo(0.00217, 5);
  });
  it("returns null without enough variation", () => {
    expect(ols([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(ols([1, 2], [1, 2])).toBeNull();
  });
});

describe("Benjamini–Hochberg", () => {
  it("matches R p.adjust(..., 'BH') in the input order", () => {
    expect(benjaminiHochberg([0.01, 0.04, 0.03, 0.005])).toEqual([0.02, 0.04, 0.04, 0.02]);
    const q = benjaminiHochberg([0.01, 0.02, 0.03, 0.04, 0.05]);
    for (const v of q) expect(v).toBeCloseTo(0.05, 12);
    expect(benjaminiHochberg([])).toEqual([]);
    expect(() => benjaminiHochberg([1.2])).toThrow(RangeError);
  });
});

describe("k-means", () => {
  const rows = [
    [1, 1000],
    [1.2, 1100],
    [0.8, 900],
    [10, 9000],
    [10.5, 9100],
    [9.5, 8900],
  ];
  it("separates clearly separated groups and is deterministic for a seed", () => {
    const a = kmeans(rows, 2, { seed: 7 })!;
    const b = kmeans(rows, 2, { seed: 7 })!;
    expect(a).toEqual(b);
    expect(new Set(a.assignments.slice(0, 3)).size).toBe(1);
    expect(new Set(a.assignments.slice(3)).size).toBe(1);
    expect(a.assignments[0]).not.toBe(a.assignments[3]);
    expect(a.sizes.sort()).toEqual([3, 3]);
    const low = a.centroids[a.assignments[0]!]!;
    expect(low[0]).toBeCloseTo(1, 12);
    expect(low[1]).toBeCloseTo(1000, 9);
  });
  it("standardizes features, so a change of units does not change the clusters", () => {
    const scaled = rows.map(([x, y]) => [x! * 1000, y! / 1000]);
    expect(kmeans(scaled, 2, { seed: 7 })!.assignments).toEqual(
      kmeans(rows, 2, { seed: 7 })!.assignments,
    );
  });
  it("refuses bad input and too few rows", () => {
    expect(kmeans(rows.slice(0, 1), 2)).toBeNull();
    expect(() => kmeans([[1, Number.NaN]], 1)).toThrow(RangeError);
    expect(() => kmeans(rows, 0)).toThrow(RangeError);
  });
  it("seeded generator is reproducible", () => {
    const r1 = seededRandom(42);
    const r2 = seededRandom(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});

describe("Kaplan–Meier", () => {
  it("matches R survfit on the aml data, maintained group (Greenwood standard errors)", () => {
    // R: survival::aml[aml$x == "Maintained", ] — times with + are censored.
    const obs = [9, 13, -13, 18, 23, -28, 31, 34, -45, 48, -161].map((t) => ({
      time: Math.abs(t),
      event: t > 0,
    }));
    const km = kaplanMeier(obs);
    expect(km.n).toBe(11);
    expect(km.events).toBe(7);
    const table = km.steps.map((s) => [
      s.time,
      s.atRisk,
      s.events,
      Number(s.survival.toFixed(3)),
      Number(s.stdErr.toFixed(4)),
    ]);
    expect(table).toEqual([
      [9, 11, 1, 0.909, 0.0867],
      [13, 10, 1, 0.818, 0.1163],
      [18, 8, 1, 0.716, 0.1397],
      [23, 7, 1, 0.614, 0.1526],
      [31, 5, 1, 0.491, 0.1642],
      [34, 4, 1, 0.368, 0.1627],
      [48, 2, 1, 0.184, 0.1535],
    ]);
    expect(km.median).toBe(31);
  });
  it("has no median when survival never reaches one half", () => {
    expect(
      kaplanMeier([
        { time: 1, event: true },
        { time: 2, event: false },
        { time: 3, event: false },
      ]).median,
    ).toBeNull();
  });
});

describe("event study", () => {
  it("aligns a series around event periods without filling gaps", () => {
    const series = [
      { period: "2024-01", value: 1 },
      { period: "2024-02", value: 2 },
      { period: "2024-03", value: null },
      { period: "2024-04", value: 4 },
      { period: "2024-05", value: 5 },
    ];
    const es = alignEvents(series, ["2024-02", "2024-04", "2023-12"], 1);
    expect(es.offsets).toEqual([-1, 0, 1]);
    expect(es.events).toEqual([
      { event: "2024-02", values: [1, 2, null] },
      { event: "2024-04", values: [null, 4, 5] },
    ]);
    expect(es.mean).toEqual([
      { offset: -1, n: 1, mean: 1 },
      { offset: 0, n: 2, mean: 3 },
      { offset: 1, n: 1, mean: 5 },
    ]);
    expect(es.missing).toEqual(["2023-12"]);
    expect(() =>
      alignEvents(
        [
          { period: "b", value: 1 },
          { period: "a", value: 2 },
        ],
        [],
        1,
      ),
    ).toThrow(RangeError);
  });
});

describe("change between complete periods", () => {
  const p = (period: string, value: number | null, partial = false) => ({ period, value, partial });
  it("computes percent change and CAGR", () => {
    expect(percentChange(p("2020", 100), p("2021", 125))).toEqual({ value: 25, reason: null });
    const g = cagr(p("2020", 100), p("2022", 121), 2);
    expect(g.value).toBeCloseTo(10, 12);
  });
  it("refuses partial periods, missing values and non-positive bases", () => {
    expect(percentChange(p("2020", 100), p("2021", 120, true)).value).toBeNull();
    expect(percentChange(p("2020", null), p("2021", 120)).reason).toMatch(/not recorded/);
    expect(percentChange(p("2020", 0), p("2021", 120)).reason).toMatch(/zero or negative/);
    expect(cagr(p("2020", 100), p("2021", 120), 0).value).toBeNull();
    expect(cagr(p("2020", -1), p("2021", 120), 1).value).toBeNull();
  });
});
