/**
 * Statistics behind the Insights charts. Pure, deterministic and tested (stats.test.ts). Every function returns null
 * rather than a number when its inputs cannot support one (too few observations, no variance).
 *
 * These are the chart layer's own implementations, written before the insights data layer's model
 * (src/lib/insights/model.ts) landed; the lead may replace them with that model's functions one for one:
 * pearson, spearman, correlationTest, ols, benjaminiHochberg, kaplanMeier, kmeans, standardize, quantile, boxStats.
 */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function mean(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n − 1). */
export function sd(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Quantile of already sorted values, linear interpolation between order statistics (R type 7, the default). */
export function quantile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length || !(p >= 0 && p <= 1)) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

export function median(xs: readonly number[]): number | null {
  return quantile(
    [...xs].sort((a, b) => a - b),
    0.5,
  );
}

/** Ranks 1..n with ties given the average of the ranks they span. */
export function ranks(xs: readonly number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1]!.v === order[k]!.v) j++;
    const avg = (k + j) / 2 + 1;
    for (let t = k; t <= j; t++) out[order[t]!.i] = avg;
    k = j + 1;
  }
  return out;
}

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n))!;
  const my = mean(ys.slice(0, n))!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  return pearson(ranks(xs.slice(0, n)), ranks(ys.slice(0, n)));
}

// ------------------------------------------------------------------------------------------------ distributions

/**
 * ln Γ(x) for x > 0: the recurrence Γ(x) = Γ(x + 1) / x moves x to at least 10, then Stirling's series with five
 * correction terms (absolute error below 1e-13 there).
 */
export function lnGamma(x: number): number {
  if (!(x > 0)) return Number.NaN;
  let shift = 0;
  let y = x;
  while (y < 10) {
    shift += Math.log(y);
    y += 1;
  }
  const inv = 1 / y;
  const inv2 = inv * inv;
  const series =
    inv * (1 / 12 - inv2 * (1 / 360 - inv2 * (1 / 1260 - inv2 * (1 / 1680 - inv2 / 1188))));
  return (y - 0.5) * Math.log(y) - y + 0.5 * Math.log(2 * Math.PI) + series - shift;
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value of Student's t with `df` degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

const Z_975 = 1.959963984540054;

export type CorrelationTest = {
  method: "pearson" | "spearman";
  n: number;
  coefficient: number;
  /** 95% interval via Fisher's z (Spearman with the Fieller–Hartley–Pearson variance 1.06 / (n − 3)). */
  ci: [number, number] | null;
  /** Two-sided p-value for "no association", from the t approximation with n − 2 degrees of freedom. */
  p: number;
};

/** Coefficient, 95% interval and p-value for paired values. Null below 4 pairs or without variance. */
export function correlationTest(
  xs: readonly number[],
  ys: readonly number[],
  method: "pearson" | "spearman",
): CorrelationTest | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 4) return null;
  const r = method === "pearson" ? pearson(xs, ys) : spearman(xs, ys);
  if (r === null) return null;
  const df = n - 2;
  const p = Math.abs(r) >= 1 ? 0 : tTwoSidedP(r * Math.sqrt(df / (1 - r * r)), df);
  let ci: [number, number] | null = null;
  if (n > 3 && Math.abs(r) < 1) {
    const z = Math.atanh(r);
    const se = Math.sqrt((method === "spearman" ? 1.06 : 1) / (n - 3));
    ci = [Math.tanh(z - Z_975 * se), Math.tanh(z + Z_975 * se)];
  } else if (Math.abs(r) >= 1) ci = [r, r];
  return { method, n, coefficient: r, ci, p };
}

export type OlsFit = {
  n: number;
  slope: number;
  intercept: number;
  r2: number;
  /** y − ŷ for each input pair, in input order. */
  residuals: number[];
};

/** Ordinary least squares of y on x. Null below 3 pairs or when x has no variance. */
export function ols(xs: readonly number[], ys: readonly number[]): OlsFit | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n))!;
  const my = mean(ys.slice(0, n))!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = Array.from({ length: n }, (_, i) => ys[i]! - (intercept + slope * xs[i]!));
  let sse = 0;
  for (const r of residuals) sse += r * r;
  return { n, slope, intercept, r2: syy === 0 ? 0 : 1 - sse / syy, residuals };
}

/** Benjamini–Hochberg adjusted p-values (q-values), in input order; same as R's p.adjust(p, "BH"). */
export function benjaminiHochberg(ps: readonly number[]): number[] {
  const n = ps.length;
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p || b.i - a.i);
  const out = new Array<number>(n);
  let running = 1;
  order.forEach((o, k) => {
    const rank = n - k;
    running = Math.min(running, (o.p * n) / rank);
    out[o.i] = Math.min(1, running);
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ survival

export type SurvivalSubject = {
  id: string;
  /** Time the subject comes under observation (0 unless observation started late: delayed entry). */
  entry: number;
  /** Time of the event, or of the last observation when censored. */
  exit: number;
  event: boolean;
};

export type KmStep = {
  time: number;
  atRisk: number;
  events: number;
  survival: number;
  lower: number | null;
  upper: number | null;
};

export type KaplanMeier = {
  n: number;
  events: number;
  censored: number;
  /** Survival just after each distinct event time, in time order (S = 1 before the first). */
  steps: KmStep[];
  /** Censoring times with the survival level drawn at each (the "+" marks). */
  censorMarks: { time: number; survival: number }[];
  /** Smallest time at which survival is at or below 0.5, or null when it never is ("not reached"). */
  medianTime: number | null;
  maxTime: number;
};

/**
 * Kaplan–Meier product-limit estimate with delayed entry (left truncation): a subject is at risk at time t when
 * entry < t ≤ exit. 95% intervals use Greenwood's variance on the log scale (R survfit's default, conf.type = "log"),
 * capped at 1. Subjects with exit < entry or non-finite times are dropped by the caller's validation; here they are
 * ignored.
 */
export function kaplanMeier(subjects: readonly SurvivalSubject[]): KaplanMeier {
  const valid = subjects.filter(
    (s) => isNum(s.entry) && isNum(s.exit) && s.entry >= 0 && s.exit >= s.entry,
  );
  const eventTimes = [...new Set(valid.filter((s) => s.event).map((s) => s.exit))].sort(
    (a, b) => a - b,
  );
  const steps: KmStep[] = [];
  let surv = 1;
  let greenwood = 0;
  for (const t of eventTimes) {
    let atRisk = 0;
    let events = 0;
    for (const s of valid) {
      if (s.entry < t && t <= s.exit) atRisk++;
      if (s.event && s.exit === t) events++;
    }
    if (atRisk === 0) continue;
    surv *= 1 - events / atRisk;
    if (atRisk > events) greenwood += events / (atRisk * (atRisk - events));
    const se = Math.sqrt(greenwood);
    const ok = surv > 0 && atRisk > events;
    steps.push({
      time: t,
      atRisk,
      events,
      survival: surv,
      lower: ok ? surv * Math.exp(-Z_975 * se) : null,
      upper: ok ? Math.min(1, surv * Math.exp(Z_975 * se)) : null,
    });
  }
  const survivalAt = (t: number) => {
    let s = 1;
    for (const st of steps) if (st.time <= t) s = st.survival;
    return s;
  };
  const censored = valid.filter((s) => !s.event);
  const median = steps.find((s) => s.survival <= 0.5)?.time ?? null;
  return {
    n: valid.length,
    events: valid.length - censored.length,
    censored: censored.length,
    steps,
    censorMarks: censored.map((s) => ({ time: s.exit, survival: survivalAt(s.exit) })),
    medianTime: median,
    maxTime: valid.reduce((m, s) => Math.max(m, s.exit), 0),
  };
}

/** Subjects under observation at time t (entry ≤ t ≤ exit), for the "number at risk" row under the curve. */
export function underObservation(subjects: readonly SurvivalSubject[], t: number): number {
  let n = 0;
  for (const s of subjects) if (s.entry <= t && t <= s.exit) n++;
  return n;
}

// ------------------------------------------------------------------------------------------------ clustering

/** Seeded pseudo-random numbers (mulberry32): same seed, same sequence. */
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

/** Column-wise z-scores (mean 0, sample SD 1). Columns without variance become all zeros. */
export function standardize(rows: readonly (readonly number[])[]): {
  z: number[][];
  means: number[];
  sds: number[];
} {
  const cols = rows[0]?.length ?? 0;
  const means: number[] = [];
  const sds: number[] = [];
  for (let c = 0; c < cols; c++) {
    const col = rows.map((r) => r[c]!);
    means.push(mean(col) ?? 0);
    sds.push(sd(col) ?? 0);
  }
  return {
    z: rows.map((r) => r.map((v, c) => (sds[c]! > 0 ? (v - means[c]!) / sds[c]! : 0))),
    means,
    sds,
  };
}

const dist2 = (a: readonly number[], b: readonly number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i]! - b[i]!) ** 2;
  return s;
};

export type KMeansResult = {
  k: number;
  seed: number;
  /** Cluster of each row, 0-based, numbered by cluster size (0 = largest; ties by first member). */
  assignments: number[];
  centroids: number[][];
  sizes: number[];
  /** Within-cluster sum of squared distances. */
  inertia: number;
  /** Mean silhouette width (−1..1); null when k < 2 or a cluster has one member only in every row. */
  silhouette: number | null;
};

function lloyd(rows: readonly (readonly number[])[], k: number, rand: () => number) {
  // k-means++ seeding
  const centroids: number[][] = [[...rows[Math.floor(rand() * rows.length)]!]];
  while (centroids.length < k) {
    const d = rows.map((r) => Math.min(...centroids.map((c) => dist2(r, c))));
    const total = d.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let pick = rand() * total;
    let idx = 0;
    for (; idx < d.length - 1; idx++) {
      pick -= d[idx]!;
      if (pick <= 0) break;
    }
    centroids.push([...rows[idx]!]);
  }
  let assign = new Array<number>(rows.length).fill(0);
  for (let iter = 0; iter < 100; iter++) {
    const next = rows.map((r) => {
      let best = 0;
      let bestD = Infinity;
      centroids.forEach((c, j) => {
        const dd = dist2(r, c);
        if (dd < bestD - 1e-12) {
          bestD = dd;
          best = j;
        }
      });
      return best;
    });
    const changed = next.some((a, i) => a !== assign[i]);
    assign = next;
    for (let j = 0; j < centroids.length; j++) {
      const members = rows.filter((_, i) => assign[i] === j);
      if (members.length)
        centroids[j] = members[0]!.map((_, c) => mean(members.map((m) => m[c]!))!);
    }
    if (!changed && iter > 0) break;
  }
  const inertia = rows.reduce((s, r, i) => s + dist2(r, centroids[assign[i]!]!), 0);
  return { assign, centroids, inertia };
}

/**
 * k-means on (already standardized) rows: k-means++ seeding from a seeded generator, Lloyd iterations, the best of
 * `starts` runs by inertia. Deterministic for a given seed. Clusters are renumbered by size so labels are stable.
 */
export function kmeans(
  rows: readonly (readonly number[])[],
  k: number,
  options: { seed?: number; starts?: number } = {},
): KMeansResult | null {
  const seed = options.seed ?? 20261023;
  if (!Number.isInteger(k) || k < 1 || rows.length < k) return null;
  const rand = seededRandom(seed);
  let best: ReturnType<typeof lloyd> | null = null;
  for (let s = 0; s < (options.starts ?? 10); s++) {
    const run = lloyd(rows, k, rand);
    if (!best || run.inertia < best.inertia - 1e-9) best = run;
  }
  if (!best) return null;
  const fit = best;
  const used = fit.centroids.length;
  const sizes = Array.from({ length: used }, (_, j) => fit.assign.filter((a) => a === j).length);
  const firstMember = Array.from({ length: used }, (_, j) => fit.assign.indexOf(j));
  const order = Array.from({ length: used }, (_, j) => j)
    .filter((j) => sizes[j]! > 0)
    .sort((a, b) => sizes[b]! - sizes[a]! || firstMember[a]! - firstMember[b]!);
  const remap = new Map(order.map((old, neu) => [old, neu] as const));
  const assignments = fit.assign.map((a) => remap.get(a)!);
  return {
    k: order.length,
    seed,
    assignments,
    centroids: order.map((j) => fit.centroids[j]!),
    sizes: order.map((j) => sizes[j]!),
    inertia: fit.inertia,
    silhouette: silhouette(rows, assignments, order.length),
  };
}

/** Mean silhouette width of a clustering (Euclidean). */
export function silhouette(
  rows: readonly (readonly number[])[],
  assignments: readonly number[],
  k: number,
): number | null {
  if (k < 2 || rows.length < 3) return null;
  const widths: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const own = assignments[i]!;
    const sums = new Array<number>(k).fill(0);
    const counts = new Array<number>(k).fill(0);
    rows.forEach((o, j) => {
      if (i === j) return;
      sums[assignments[j]!]! += Math.sqrt(dist2(r, o));
      counts[assignments[j]!]! += 1;
    });
    if (counts[own] === 0) {
      widths.push(0);
      continue;
    }
    const a = sums[own]! / counts[own]!;
    let b = Infinity;
    for (let c = 0; c < k; c++)
      if (c !== own && counts[c]! > 0) b = Math.min(b, sums[c]! / counts[c]!);
    widths.push(Number.isFinite(b) && Math.max(a, b) > 0 ? (b - a) / Math.max(a, b) : 0);
  }
  return mean(widths);
}

// ------------------------------------------------------------------------------------------------ distributions

export type BoxStats = {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Whisker ends: the most extreme values within 1.5 × IQR of the box. */
  lowWhisker: number;
  highWhisker: number;
  outliers: number[];
};

export function boxStats(values: readonly number[]): BoxStats | null {
  const s = values.filter(isNum).sort((a, b) => a - b);
  if (!s.length) return null;
  const q1 = quantile(s, 0.25)!;
  const q3 = quantile(s, 0.75)!;
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inside = s.filter((v) => v >= loFence && v <= hiFence);
  return {
    n: s.length,
    min: s[0]!,
    q1,
    median: quantile(s, 0.5)!,
    q3,
    max: s[s.length - 1]!,
    lowWhisker: inside[0] ?? s[0]!,
    highWhisker: inside[inside.length - 1] ?? s[s.length - 1]!,
    outliers: s.filter((v) => v < loFence || v > hiFence),
  };
}

/** Median and interquartile range of the values at each aligned offset (event studies), with n at each offset. */
export function alignedSummary(
  rows: readonly { offset: number; value: number }[],
): { offset: number; n: number; median: number; q1: number; q3: number }[] {
  const by = new Map<number, number[]>();
  for (const r of rows) {
    if (!isNum(r.value) || !Number.isInteger(r.offset)) continue;
    const list = by.get(r.offset) ?? [];
    list.push(r.value);
    by.set(r.offset, list);
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([offset, vs]) => {
      const s = vs.sort((a, b) => a - b);
      return {
        offset,
        n: s.length,
        median: quantile(s, 0.5)!,
        q1: quantile(s, 0.25)!,
        q3: quantile(s, 0.75)!,
      };
    });
}
