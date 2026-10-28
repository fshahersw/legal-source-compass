/** Pure layout maths for the d3 chart forms. Missing values stay null ("Not recorded"), never interpolated. */
import { stack, stackOrderNone, stackOffsetNone } from "d3-shape";
import { hierarchy, partition, type HierarchyRectangularNode } from "d3-hierarchy";

export type Point = { date: string; value: number | null };
export type Series = { id: string; label: string; points: readonly Point[] };

/** Rebase each series to its value at `baseDate` (ratio - 1). A series with no positive value there yields nulls. */
export function rebase(series: readonly Series[], baseDate: string): Series[] {
  return series.map((s) => {
    const base = s.points.find((p) => p.date === baseDate)?.value;
    const ok = base != null && base > 0;
    return {
      ...s,
      points: s.points.map((p) => ({
        date: p.date,
        value: ok && p.value != null ? p.value / base - 1 : null,
      })),
    };
  });
}

export type StackRow = {
  period: string;
  values: Record<string, number | null>;
  /** An unfinished period (drawn faded, marked with an asterisk). */
  partial?: boolean;
};

/** Stacked layers; a null category contributes 0 height but is reported in `gaps`. */
export function stackLayers(rows: readonly StackRow[], keys: readonly string[]) {
  const gaps: { period: string; key: string }[] = [];
  const flat = rows.map((r) => {
    const o: Record<string, number> = {};
    for (const k of keys) {
      const v = r.values[k];
      if (v == null) gaps.push({ period: r.period, key: k });
      o[k] = v ?? 0;
    }
    return o;
  });
  const layers = stack<Record<string, number>>()
    .keys(keys as string[])
    .order(stackOrderNone)
    .offset(stackOffsetNone)(flat);
  const max = Math.max(0, ...layers.flatMap((l) => l.map((d) => d[1])));
  return { layers, gaps, max };
}

/** Symmetric domain around the baseline so left and right arms are comparable. */
export function divergingDomain(
  values: readonly (number | null)[],
  baseline: number,
): [number, number] {
  const spread = Math.max(
    0,
    ...values.filter((v): v is number => v != null).map((v) => Math.abs(v - baseline)),
  );
  const half = spread === 0 ? 1 : spread;
  return [baseline - half, baseline + half];
}

/** `slot` (top level only) pins a categorical colour slot; without it the slot follows size order. */
export type TreeNode = { name: string; value?: number; slot?: number; children?: TreeNode[] };

/** Radial partition: x = angle in [0, 2π], y = radius in [0, radius]. */
export function sunburstLayout(
  root: TreeNode,
  radius: number,
): HierarchyRectangularNode<TreeNode>[] {
  const h = hierarchy(root)
    .sum((d) => (d.children?.length ? 0 : Math.max(0, d.value ?? 0)))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return partition<TreeNode>()
    .size([2 * Math.PI, radius])(h)
    .descendants();
}

/** One sunburst segment in ring units: x in radians [0, 2π], y in rings (the root is ring 0, its children ring 1). */
export type RingArc = { x0: number; x1: number; y0: number; y1: number };

/**
 * Where segment `d` sits when the chart is zoomed to `p` (both in ring units): `p` fills the full circle and its
 * children become the first ring. Segments outside `p` collapse to zero width; ancestors drop to ring 0 and below.
 */
export function zoomArc(d: RingArc, p: RingArc & { depth: number }): RingArc {
  const span = p.x1 - p.x0 || 1;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    x0: clamp((d.x0 - p.x0) / span) * 2 * Math.PI,
    x1: clamp((d.x1 - p.x0) / span) * 2 * Math.PI,
    y0: Math.max(0, d.y0 - p.depth),
    y1: Math.max(0, d.y1 - p.depth),
  };
}

/** A segment is drawn while it sits in rings 1..`rings` with some angle. */
export function ringVisible(a: RingArc, rings: number): boolean {
  return a.y0 >= 1 && a.y1 <= rings + 1 + 1e-9 && a.x1 - a.x0 > 1e-6;
}

/**
 * A label fits a segment when the arc at the middle radius is at least `minArcPx` long (the text height) and the
 * segment is not a sliver. `rad` maps ring units to pixels.
 */
export function ringLabelFits(
  a: RingArc,
  rings: number,
  rad: (y: number) => number,
  minArcPx = 11,
): boolean {
  if (!ringVisible(a, rings)) return false;
  const mid = (rad(a.y0) + rad(a.y1)) / 2;
  return (a.x1 - a.x0) * mid >= minArcPx && (a.y1 - a.y0) * (a.x1 - a.x0) > 0.06;
}

/** Shorten a label to `max` characters with an ellipsis; very short budgets drop the label. */
export function fitLabel(name: string, max: number): string | null {
  if (max < 3) return null;
  return name.length > max ? `${name.slice(0, Math.max(1, max - 1)).trimEnd()}…` : name;
}

/** Spread end-of-line labels so none sits closer than `gap` to its neighbour, keeping order and staying in [min, max]. */
export function spreadLabels(
  ys: readonly number[],
  gap: number,
  min: number,
  max: number,
): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = order.map((o) => Math.min(max, Math.max(min, o.y)));
  for (let k = 1; k < out.length; k += 1) out[k] = Math.max(out[k]!, out[k - 1]! + gap);
  const over = out.length ? out[out.length - 1]! - max : 0;
  if (over > 0) {
    out[out.length - 1] = max;
    for (let k = out.length - 2; k >= 0; k -= 1) out[k] = Math.min(out[k]!, out[k + 1]! - gap);
  }
  const res = new Array<number>(ys.length);
  order.forEach((o, k) => (res[o.i] = out[k]!));
  return res;
}
