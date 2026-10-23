/** Scales and ticks for the SVG charts. Pure: no DOM, no React. */

export type Linear = ((v: number) => number) & {
  domain: [number, number];
  range: [number, number];
  invert: (px: number) => number;
};

/** A linear map from `domain` to `range`. A zero-width domain maps every value to the middle of the range. */
export function linearScale(domain: [number, number], range: [number, number]): Linear {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const f = ((v: number) =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0)) as Linear;
  f.domain = [d0, d1];
  f.range = [r0, r1];
  f.invert = (px: number) => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * span);
  return f;
}

/** A "nice" step (1, 2, 2.5 or 5 times a power of ten) giving about `count` intervals over [lo, hi]. */
export function niceStep(lo: number, hi: number, count = 5): number {
  const span = Math.abs(hi - lo);
  if (!Number.isFinite(span) || span === 0) return 1;
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const err = raw / power;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 2.25 ? 2.5 : err >= 1.5 ? 2 : 1;
  return mult * power;
}

/**
 * Domain and ticks rounded outward to a nice step. `zero` forces 0 into the domain (honest baselines for counts and
 * amounts). A flat series gets a small symmetric pad so it is drawn mid-plot rather than on an edge.
 */
export function niceDomain(
  values: readonly number[],
  options: { zero?: boolean; count?: number } = {},
): { domain: [number, number]; ticks: number[] } {
  const finite = values.filter(Number.isFinite);
  let lo = finite.length ? Math.min(...finite) : 0;
  let hi = finite.length ? Math.max(...finite) : 1;
  if (options.zero ?? true) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
    if ((options.zero ?? true) && lo < 0 && finite.every((v) => v >= 0)) lo = 0;
  }
  const step = niceStep(lo, hi, options.count ?? 4);
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = a; t <= b + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { domain: [a, b], ticks };
}

/** Evenly spaced positions for `n` categories in [r0, r1] with outer padding of half a step. */
export function pointPositions(n: number, range: [number, number]): number[] {
  if (n <= 0) return [];
  if (n === 1) return [(range[0] + range[1]) / 2];
  const step = (range[1] - range[0]) / n;
  return Array.from({ length: n }, (_, i) => range[0] + step * (i + 0.5));
}

/** Bands for `n` categories: start offset and width of each band, with `padding` (0–1) of each step left empty. */
export function bands(
  n: number,
  range: [number, number],
  padding = 0.2,
): { step: number; width: number; start: (i: number) => number } {
  const step = n > 0 ? (range[1] - range[0]) / n : 0;
  const width = step * (1 - padding);
  return { step, width, start: (i: number) => range[0] + step * i + (step - width) / 2 };
}

/**
 * Indices of the labels to draw on a category axis so labels never overlap: every label when they fit, else every
 * k-th label at a regular step (never an irregular subset, which hides which mark belongs to which period). The last
 * index is always kept when the step lands on it.
 */
export function labelStride(count: number, available: number, labelWidth: number): number {
  if (count <= 0) return 1;
  const fit = Math.max(1, Math.floor(available / Math.max(1, labelWidth)));
  return Math.max(1, Math.ceil(count / fit));
}

/**
 * Vertical label positions that keep at least `gap` px between labels, staying inside [min, max]. Labels keep their
 * order; each is moved as little as possible (used for direct end-labels of line charts).
 */
export function dodgeLabels(
  wanted: readonly number[],
  gap: number,
  min: number,
  max: number,
): number[] {
  const order = wanted.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const placed = order.map((o) => Math.min(max, Math.max(min, o.y)));
  for (let k = 1; k < placed.length; k++)
    if (placed[k]! - placed[k - 1]! < gap) placed[k] = placed[k - 1]! + gap;
  const overflow = placed.length ? placed[placed.length - 1]! - max : 0;
  if (overflow > 0) {
    placed[placed.length - 1] = max;
    for (let k = placed.length - 2; k >= 0; k--)
      if (placed[k + 1]! - placed[k]! < gap) placed[k] = placed[k + 1]! - gap;
  }
  const out = new Array<number>(wanted.length);
  order.forEach((o, k) => (out[o.i] = placed[k]!));
  return out;
}
