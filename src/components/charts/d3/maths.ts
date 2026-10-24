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

export type StackRow = { period: string; values: Record<string, number | null> };

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
export function divergingDomain(values: readonly (number | null)[], baseline: number): [number, number] {
  const spread = Math.max(0, ...values.filter((v): v is number => v != null).map((v) => Math.abs(v - baseline)));
  const half = spread === 0 ? 1 : spread;
  return [baseline - half, baseline + half];
}

export type TreeNode = { name: string; value?: number; children?: TreeNode[] };

/** Radial partition: x = angle in [0, 2π], y = radius in [0, radius]. */
export function sunburstLayout(root: TreeNode, radius: number): HierarchyRectangularNode<TreeNode>[] {
  const h = hierarchy(root)
    .sum((d) => (d.children?.length ? 0 : Math.max(0, d.value ?? 0)))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return partition<TreeNode>().size([2 * Math.PI, radius])(h).descendants();
}

/** Spread end-of-line labels so none sits closer than `gap` to its neighbour, keeping order and staying in [min, max]. */
export function spreadLabels(ys: readonly number[], gap: number, min: number, max: number): number[] {
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
