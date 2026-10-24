/**
 * Local regression (LOESS) with a pointwise 95% confidence band, for the scatter-with-ribbon form. Pure and tested.
 *
 * At each x0 the fit is a weighted least-squares line (or parabola) through the nearest `span` share of the points,
 * tricube-weighted by distance. The fit is a linear smoother, fit(x0) = Σ l_i(x0) y_i, so its standard error is
 * σ · sqrt(Σ l_i(x0)²). σ² is the residual sum of squares over δ1 = n − 2·tr(L) + tr(LᵀL), the usual residual degrees
 * of freedom of a linear smoother, and the band uses a t quantile on that many degrees of freedom. The band is the
 * confidence interval of the smooth curve (where the average sits), not a prediction interval for one more point; it
 * assumes errors of similar size across x. It is drawn over the observed x range only: no extrapolation.
 */
import { tTwoSidedP } from "../stats";

export type Smoothed = {
  x: number;
  fit: number;
  lo: number;
  hi: number;
};

export type LoessResult = {
  /** Fit and band on an even grid over the observed x range. */
  grid: Smoothed[];
  /** Fitted value at every input point (same order as the input). */
  fitted: number[];
  /** Residual standard deviation σ. */
  sigma: number;
  /** Residual degrees of freedom δ1. */
  df: number;
  /** Equivalent number of parameters tr(L). */
  parameters: number;
};

/** Smallest sample a smooth is drawn for; below it the points stand alone. */
export const MIN_SMOOTH_POINTS = 8;

/** Two-sided 95% critical value of Student's t on `df` degrees of freedom (bisection on the exact tail). */
export function t95(df: number): number {
  if (!(df > 0)) return NaN;
  if (df > 400) return 1.96;
  let lo = 0.5;
  let hi = 60;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > 0.05) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const tricube = (u: number) => (u >= 1 ? 0 : (1 - u ** 3) ** 3);

/** Smoother weights l_i(x0) of the local fit at x0 (degree 1 or 2), or null when the local system is singular. */
export function localWeights(
  xs: readonly number[],
  x0: number,
  span: number,
  degree: 1 | 2,
): number[] | null {
  const n = xs.length;
  const q = Math.min(n, Math.max(degree + 2, Math.ceil(span * n)));
  const dist = xs.map((x) => Math.abs(x - x0));
  const h0 = [...dist].sort((a, b) => a - b)[q - 1]!;
  const h = h0 > 0 ? h0 * 1.0000001 : 1e-9;
  const w = dist.map((d) => tricube(d / h));
  const p = degree + 1;
  // normal equations on centred x: M = Σ w φφᵀ with φ = [1, d, d²]
  const m: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < n; i++) {
    if (w[i] === 0) continue;
    const d = xs[i]! - x0;
    const phi = [1, d, d * d].slice(0, p);
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) m[a]![b]! += w[i]! * phi[a]! * phi[b]!;
  }
  const inv = invert(m);
  if (!inv) return null;
  // l_i = w_i · (M⁻¹ φ_i)[0]
  return xs.map((x, i) => {
    if (w[i] === 0) return 0;
    const d = x - x0;
    const phi = [1, d, d * d].slice(0, p);
    let s = 0;
    for (let b = 0; b < p; b++) s += inv[0]![b]! * phi[b]!;
    return w[i]! * s;
  });
}

function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    if (Math.abs(m[piv]![c]!) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    const d = m[c]![c]!;
    for (let k = 0; k < 2 * n; k++) m[c]![k]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      if (f === 0) continue;
      for (let k = 0; k < 2 * n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row) => row.slice(n));
}

/**
 * LOESS fit and 95% band for points (xs, ys). Null when fewer than MIN_SMOOTH_POINTS points, fewer than three distinct
 * x values, or the fit is degenerate. `grid` points are evenly spaced over [min x, max x].
 */
export function loess(
  xs: readonly number[],
  ys: readonly number[],
  options: { span?: number; degree?: 1 | 2; gridSize?: number } = {},
): LoessResult | null {
  const n = xs.length;
  if (n < MIN_SMOOTH_POINTS || ys.length !== n) return null;
  if (new Set(xs).size < 3) return null;
  const span = Math.min(1, Math.max(0.2, options.span ?? 0.75));
  const degree = options.degree ?? 1;
  const rows: number[][] = [];
  for (const x0 of xs) {
    const l = localWeights(xs, x0, span, degree);
    if (!l) return null;
    rows.push(l);
  }
  const fitted = rows.map((l) => l.reduce((a, li, i) => a + li * ys[i]!, 0));
  const rss = fitted.reduce((a, f, i) => a + (ys[i]! - f) ** 2, 0);
  let trL = 0;
  for (let i = 0; i < n; i++) trL += rows[i]![i]!;
  // tr(LᵀL) = Σ_ij l_ij²
  let trLtL = 0;
  for (const l of rows) for (const v of l) trLtL += v * v;
  const df = n - 2 * trL + trLtL;
  if (!(df > 1)) return null;
  const sigma = Math.sqrt(rss / df);
  const t = t95(df);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const size = Math.max(8, options.gridSize ?? 72);
  const grid: Smoothed[] = [];
  for (let k = 0; k < size; k++) {
    const x0 = lo + ((hi - lo) * k) / (size - 1);
    const l = localWeights(xs, x0, span, degree);
    if (!l) return null;
    const fit = l.reduce((a, li, i) => a + li * ys[i]!, 0);
    const se = sigma * Math.sqrt(l.reduce((a, li) => a + li * li, 0));
    grid.push({ x: x0, fit, lo: fit - t * se, hi: fit + t * se });
  }
  return { grid, fitted, sigma, df, parameters: trL };
}

/**
 * Points whose residual from the smooth is largest: standardised residuals (residual / σ) at or beyond `z`, the `max`
 * largest by size. Returns indices into the input order.
 */
export function outlierIndices(
  ys: readonly number[],
  fitted: readonly number[],
  sigma: number,
  options: { z?: number; max?: number } = {},
): number[] {
  if (!(sigma > 0)) return [];
  const z = options.z ?? 2;
  return ys
    .map((y, i) => ({ i, r: Math.abs((y - fitted[i]!) / sigma) }))
    .filter((o) => o.r >= z)
    .sort((a, b) => b.r - a.r)
    .slice(0, options.max ?? 4)
    .map((o) => o.i);
}
