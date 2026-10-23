/**
 * Deterministic statistics for the Insights views: correlation with its sample size, confidence interval and p-value,
 * least-squares fit, Benjamini–Hochberg adjustment, seeded k-means on standardized features, Kaplan–Meier with
 * censoring, event-study alignment, and percent change / CAGR between complete periods only.
 *
 * Pure and client-safe: no clock, no randomness except the seeded generator of k-means, no I/O. Every function returns
 * null (with a reason where a reader needs one) instead of a number when the inputs cannot support the statistic; it
 * never fills, estimates or extrapolates. These are descriptions of group-level data: a correlation across states says
 * nothing about any individual, and a Kaplan–Meier curve is a historical base rate with its n, not a prediction.
 */

// ------------------------------------------------------------------------------------------------ distributions

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0 (Lanczos approximation, g = 7). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += LANCZOS[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction of the incomplete beta function (modified Lentz). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Two-sided p-value of Student's t with `df` degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** Complementary error function: Taylor series for |x| < 2, Lentz continued fraction beyond (about 1e-15). */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2) {
    let sum = x;
    let term = x;
    for (let n = 1; n < 100; n += 1) {
      term *= (-x * x) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  // erfc(x) = exp(-x²)/√π · 1/(x + 1/2/(x + 1/(x + 3/2/(x + ...))))
  const TINY = 1e-300;
  let f = x;
  let c = x;
  let d = 0;
  for (let n = 1; n < 300; n += 1) {
    const a = n / 2;
    d = x + a * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = x + a / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}

/** Standard normal CDF. */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** Inverse of the standard normal CDF: Acklam's algorithm refined by one Halley step (machine precision). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("p must be in (0, 1)");
  const x = acklam(p);
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

function acklam(p: number): number {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > 1 - lo) return -acklam(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

// ------------------------------------------------------------------------------------------------ correlation

export type Interval = { level: number; low: number; high: number };

export type Correlation = {
  method: "pearson" | "spearman";
  /** Pairs used (both values finite). */
  n: number;
  /** Null when n < 3 or a variable does not vary. */
  r: number | null;
  /** Fisher z interval; null when n < 4. */
  ci: Interval | null;
  /** Two-sided p-value, t with n − 2 degrees of freedom; null when r is null. */
  p: number | null;
  /** Reading note for small samples (n < 10), else null. */
  warning: string | null;
};

const SMALL_N = 10;

function finitePairs(xs: readonly number[], ys: readonly number[]): [number[], number[]] {
  if (xs.length !== ys.length) throw new RangeError("x and y must have the same length");
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i]!;
    const b = ys[i]!;
    if (Number.isFinite(a) && Number.isFinite(b)) {
      x.push(a);
      y.push(b);
    }
  }
  return [x, y];
}

function mean(v: readonly number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

function pearsonR(x: readonly number[], y: readonly number[]): number | null {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** Fisher z interval for a correlation: tanh(atanh(r) ± z·se). */
export function fisherInterval(r: number, se: number, level = 0.95): Interval {
  const z = normalQuantile(1 - (1 - level) / 2);
  const center = Math.atanh(Math.max(-0.9999999999999999, Math.min(0.9999999999999999, r)));
  return { level, low: Math.tanh(center - z * se), high: Math.tanh(center + z * se) };
}

function correlationResult(
  method: Correlation["method"],
  n: number,
  r: number | null,
  se: number | null,
  level: number,
): Correlation {
  const warning =
    n < SMALL_N ? `Only ${n} pairs: the coefficient and its interval are unstable.` : null;
  if (r === null || n < 3) return { method, n, r: null, ci: null, p: null, warning };
  const p = Math.abs(r) === 1 ? 0 : tTwoSidedP(r * Math.sqrt((n - 2) / (1 - r * r)), n - 2);
  const ci = n >= 4 && se !== null ? fisherInterval(r, se, level) : null;
  return { method, n, r, ci, p, warning };
}

/** Pearson's r with a Fisher z interval (se = 1/√(n−3)) and the t-test p-value. Non-finite pairs are dropped. */
export function pearson(xs: readonly number[], ys: readonly number[], level = 0.95): Correlation {
  const [x, y] = finitePairs(xs, ys);
  const n = x.length;
  const r = n >= 3 ? pearsonR(x, y) : null;
  return correlationResult("pearson", n, r, n >= 4 ? 1 / Math.sqrt(n - 3) : null, level);
}

/** Ranks 1..n with ties given their average rank. */
export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const ranks = new Array<number>(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]!.v === order[start]!.v) end += 1;
    const avg = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) ranks[order[k]!.i] = avg;
    start = end + 1;
  }
  return ranks;
}

/**
 * Spearman's rank correlation (Pearson on average ranks), p-value from the t approximation with n − 2 degrees of
 * freedom (as R's cor.test with exact = FALSE), Fisher z interval with the Bonett–Wright standard error
 * √((1 + r²/2)/(n − 3)).
 */
export function spearman(xs: readonly number[], ys: readonly number[], level = 0.95): Correlation {
  const [x, y] = finitePairs(xs, ys);
  const n = x.length;
  const r = n >= 3 ? pearsonR(averageRanks(x), averageRanks(y)) : null;
  const se = r !== null && n >= 4 ? Math.sqrt((1 + (r * r) / 2) / (n - 3)) : null;
  return correlationResult("spearman", n, r, se, level);
}

// ------------------------------------------------------------------------------------------------ least squares

export type OlsFit = {
  n: number;
  slope: number;
  intercept: number;
  r2: number;
  /** Residual standard error, n − 2 degrees of freedom. */
  residualSe: number;
  seSlope: number;
  seIntercept: number;
  /** Two-sided p-value of the slope (t with n − 2 degrees of freedom). */
  pSlope: number;
};

/** Ordinary least squares y = intercept + slope·x; null with fewer than 3 finite pairs or a constant x. */
export function ols(xs: readonly number[], ys: readonly number[]): OlsFit | null {
  const [x, y] = finitePairs(xs, ys);
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (x[i]! - mx) ** 2;
    sxy += (x[i]! - mx) * (y[i]! - my);
    syy += (y[i]! - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i += 1) sse += (y[i]! - intercept - slope * x[i]!) ** 2;
  const residualSe = Math.sqrt(sse / (n - 2));
  const seSlope = residualSe / Math.sqrt(sxx);
  const seIntercept = residualSe * Math.sqrt(1 / n + (mx * mx) / sxx);
  const r2 = syy === 0 ? 1 : 1 - sse / syy;
  const pSlope = seSlope === 0 ? 0 : tTwoSidedP(slope / seSlope, n - 2);
  return { n, slope, intercept, r2, residualSe, seSlope, seIntercept, pSlope };
}

// ------------------------------------------------------------------------------------------------ multiple comparisons

/** Benjamini–Hochberg adjusted p-values (q-values), in the input order (as R's p.adjust(p, "BH")). */
export function benjaminiHochberg(pvalues: readonly number[]): number[] {
  const m = pvalues.length;
  for (const p of pvalues)
    if (!(p >= 0 && p <= 1)) throw new RangeError("p-values must be in [0, 1]");
  const order = pvalues.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p || b.i - a.i);
  const out = new Array<number>(m);
  let running = 1;
  order.forEach(({ p, i }, k) => {
    const rank = m - k;
    running = Math.min(running, (p * m) / rank);
    out[i] = running;
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ k-means

/** Small deterministic PRNG (mulberry32): the same seed gives the same sequence on every platform. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type KMeansResult = {
  k: number;
  /** Cluster index of each input row. */
  assignments: number[];
  /** Cluster centres in standardized units (z-scores of each feature). */
  centroidsStandardized: number[][];
  /** Cluster centres in the features' own units (mean of the members). */
  centroids: number[][];
  sizes: number[];
  /** Sum of squared standardized distances to the assigned centre. */
  inertia: number;
  iterations: number;
  /** Mean and standard deviation (n − 1) used to standardize each feature; a constant feature gets sd 0. */
  scale: { mean: number; sd: number }[];
};

/**
 * k-means on features standardized to z-scores (so units do not weigh), k-means++ seeding from a seeded generator,
 * Lloyd iterations until assignments stop changing. Rows with a non-finite value are refused (caller drops them, so the
 * gap stays visible). Null when there are fewer rows than k.
 */
export function kmeans(
  rows: readonly (readonly number[])[],
  k: number,
  options: { seed?: number; maxIterations?: number } = {},
): KMeansResult | null {
  if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be a positive integer");
  const n = rows.length;
  if (n < k) return null;
  const dims = rows[0]?.length ?? 0;
  if (dims === 0) throw new RangeError("rows need at least one feature");
  for (const r of rows)
    if (r.length !== dims || r.some((v) => !Number.isFinite(v)))
      throw new RangeError("every row needs the same number of finite features");
  const scale = Array.from({ length: dims }, (_, j) => {
    const col = rows.map((r) => r[j]!);
    const m = mean(col);
    const sd = n > 1 ? Math.sqrt(col.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0;
    return { mean: m, sd };
  });
  const z = rows.map((r) =>
    r.map((v, j) => (scale[j]!.sd > 0 ? (v - scale[j]!.mean) / scale[j]!.sd : 0)),
  );
  const dist2 = (a: readonly number[], b: readonly number[]) =>
    a.reduce((s, v, j) => s + (v - b[j]!) ** 2, 0);
  const random = seededRandom(options.seed ?? 1);

  // k-means++ seeding
  const centres: number[][] = [z[Math.floor(random() * n)]!.slice()];
  while (centres.length < k) {
    const d = z.map((p) => Math.min(...centres.map((c) => dist2(p, c))));
    const total = d.reduce((s, v) => s + v, 0);
    let pick = 0;
    if (total > 0) {
      let target = random() * total;
      for (pick = 0; pick < n - 1; pick += 1) {
        target -= d[pick]!;
        if (target < 0) break;
      }
    } else pick = centres.length % n;
    centres.push(z[pick]!.slice());
  }

  const assignments = new Array<number>(n).fill(-1);
  let iterations = 0;
  const maxIterations = options.maxIterations ?? 300;
  for (; iterations < maxIterations; iterations += 1) {
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      let best = 0;
      let bestD = Infinity;
      centres.forEach((c, ci) => {
        const dd = dist2(z[i]!, c);
        if (dd < bestD) {
          bestD = dd;
          best = ci;
        }
      });
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
    for (let ci = 0; ci < k; ci += 1) {
      const members = z.filter((_, i) => assignments[i] === ci);
      if (members.length)
        centres[ci] = Array.from({ length: dims }, (_, j) => mean(members.map((m) => m[j]!)));
    }
  }
  const sizes = Array.from({ length: k }, (_, ci) => assignments.filter((a) => a === ci).length);
  const centroids = Array.from({ length: k }, (_, ci) => {
    const members = rows.filter((_, i) => assignments[i] === ci);
    return Array.from({ length: dims }, (_, j) =>
      members.length ? mean(members.map((m) => m[j]!)) : NaN,
    );
  });
  const inertia = z.reduce((s, p, i) => s + dist2(p, centres[assignments[i]!]!), 0);
  return {
    k,
    assignments,
    centroidsStandardized: centres,
    centroids,
    sizes,
    inertia,
    iterations,
    scale,
  };
}

// ------------------------------------------------------------------------------------------------ Kaplan–Meier

export type SurvivalStep = {
  time: number;
  atRisk: number;
  events: number;
  /** Observations censored at this time (still at risk at it). */
  censored: number;
  survival: number;
  /** Greenwood standard error of the survival estimate. */
  stdErr: number;
};

export type KaplanMeier = {
  n: number;
  events: number;
  steps: SurvivalStep[];
  /** Smallest time at which survival falls to 0.5 or below; null when it never does. */
  median: number | null;
};

/**
 * Kaplan–Meier product-limit estimate with Greenwood standard errors. `event: false` is a censored observation (the
 * time it was last seen without the event). An event and a censoring at the same time: the censored observation counts
 * as at risk at that time. A historical base rate with its n, never a prediction for any one case.
 */
export function kaplanMeier(
  observations: readonly { time: number; event: boolean }[],
): KaplanMeier {
  const obs = observations.filter((o) => Number.isFinite(o.time) && o.time >= 0);
  const times = [...new Set(obs.map((o) => o.time))].sort((a, b) => a - b);
  let atRisk = obs.length;
  let survival = 1;
  let greenwood = 0;
  const steps: SurvivalStep[] = [];
  let median: number | null = null;
  for (const time of times) {
    const here = obs.filter((o) => o.time === time);
    const events = here.filter((o) => o.event).length;
    const censored = here.length - events;
    if (events > 0) {
      survival *= 1 - events / atRisk;
      greenwood += atRisk > events ? events / (atRisk * (atRisk - events)) : Infinity;
      steps.push({
        time,
        atRisk,
        events,
        censored,
        survival,
        stdErr: Number.isFinite(greenwood) ? survival * Math.sqrt(greenwood) : NaN,
      });
      if (median === null && survival <= 0.5) median = time;
    }
    atRisk -= here.length;
  }
  return { n: obs.length, events: obs.filter((o) => o.event).length, steps, median };
}

// ------------------------------------------------------------------------------------------------ event study

export type SeriesPoint = { period: string; value: number | null };

export type EventWindow = {
  event: string;
  /** Values at offsets −window..+window from the event period (null where the series has no value). */
  values: (number | null)[];
};

export type EventStudy = {
  offsets: number[];
  events: EventWindow[];
  /** Mean of the non-null values at each offset, with how many events contributed. */
  mean: { offset: number; n: number; mean: number | null }[];
  /** Events whose period is not in the series (listed, not aligned). */
  missing: string[];
};

/**
 * Align one series around event periods (e.g. an MDL's creation month) for an event study. Offsets count positions in
 * the series as given (one period apart), which must be sorted and of one period type. Nothing is interpolated.
 */
export function alignEvents(
  series: readonly SeriesPoint[],
  eventPeriods: readonly string[],
  window: number,
): EventStudy {
  if (!Number.isInteger(window) || window < 0)
    throw new RangeError("window must be a non-negative integer");
  for (let i = 1; i < series.length; i += 1)
    if (!(series[i - 1]!.period < series[i]!.period))
      throw new RangeError("series periods must be sorted and unique");
  const index = new Map(series.map((p, i) => [p.period, i] as const));
  const offsets = Array.from({ length: 2 * window + 1 }, (_, i) => i - window);
  const events: EventWindow[] = [];
  const missing: string[] = [];
  for (const e of eventPeriods) {
    const at = index.get(e);
    if (at === undefined) {
      missing.push(e);
      continue;
    }
    events.push({ event: e, values: offsets.map((o) => series[at + o]?.value ?? null) });
  }
  const meanRows = offsets.map((offset, k) => {
    const vals = events
      .map((ev) => ev.values[k])
      .filter((v): v is number => v !== null && Number.isFinite(v));
    return { offset, n: vals.length, mean: vals.length ? mean(vals) : null };
  });
  return { offsets, events, mean: meanRows, missing };
}

// ------------------------------------------------------------------------------------------------ change between periods

export type Observation = { period: string; value: number | null; partial: boolean };
export type Change = { value: number; reason: null } | { value: null; reason: string };

function completePair(a: Observation, b: Observation): string | null {
  if (a.partial || b.partial)
    return "A period is still in progress or only partly covered; no change is computed.";
  if (
    a.value === null ||
    b.value === null ||
    !Number.isFinite(a.value) ||
    !Number.isFinite(b.value)
  )
    return "A value is not recorded; no change is computed.";
  return null;
}

/** Percent change from `from` to `to` (100 × (to − from) / from), only between complete periods with a positive base. */
export function percentChange(from: Observation, to: Observation): Change {
  const why = completePair(from, to);
  if (why) return { value: null, reason: why };
  if (from.value! <= 0)
    return {
      value: null,
      reason: "The base value is zero or negative; a percent change is not meaningful.",
    };
  return { value: (100 * (to.value! - from.value!)) / from.value!, reason: null };
}

/** Compound annual growth rate in percent over `years` years, only between complete periods with positive values. */
export function cagr(from: Observation, to: Observation, years: number): Change {
  const why = completePair(from, to);
  if (why) return { value: null, reason: why };
  if (!(years > 0))
    return { value: null, reason: "The periods must be at least part of a year apart." };
  if (from.value! <= 0 || to.value! < 0)
    return {
      value: null,
      reason: "Growth rates need a positive starting value and a non-negative end value.",
    };
  return { value: 100 * ((to.value! / from.value!) ** (1 / years) - 1), reason: null };
}
