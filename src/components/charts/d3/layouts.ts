/**
 * Pure d3 layouts for the force, density and ridge chart forms (React renders them; see swarmCharts.tsx):
 *   beeswarm      d3-force: every point held at its value on the x axis and its group's lane, collisions resolved
 *                 so no two marks overlap; positions on x move only as far as collision requires
 *   density       d3-contour: smoothed density bands of a point cloud in screen space (the "usual" region)
 *   ridges        d3-shape: each row's values scaled to its own peak, drawn as overlapping areas
 * Every layout is deterministic for the same input (force runs a fixed number of ticks from fixed starting points).
 */
import { contourDensity } from "d3-contour";
import { forceCollide, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { area, curveMonotoneX, line } from "d3-shape";

export type SwarmInput = {
  id: string;
  x: number;
  lane: number;
  r: number;
  /** How far this mark may drift from its lane centre (defaults to the layout's `spread`). */
  spread?: number | undefined;
};
export type SwarmNode = SwarmInput & { cx: number; cy: number };

type SimNode = SimulationNodeDatum & SwarmInput & { tx: number; ty: number };

/**
 * Beeswarm positions: `x` is the target position in pixels, `lane` the lane's centre in pixels. The x force is strong
 * and the y force weak, so collisions push marks up and down inside their lane rather than along the value axis.
 * `spread` caps how far a mark may drift from its lane centre (marks beyond it are clamped, never dropped).
 */
export function beeswarm(
  points: readonly SwarmInput[],
  {
    ticks = 160,
    spread = 40,
    padding = 0.6,
  }: { ticks?: number; spread?: number; padding?: number } = {},
): SwarmNode[] {
  const nodes: SimNode[] = points.map((p, i) => ({
    ...p,
    tx: p.x,
    ty: p.lane,
    x: p.x,
    // a fixed alternating start keeps the layout the same on every render
    y: p.lane + (i % 2 ? 1 : -1) * ((i % 7) + 1) * 0.5,
  }));
  const sim = forceSimulation<SimNode>(nodes)
    .force("x", forceX<SimNode>((d) => d.tx).strength(1))
    .force("y", forceY<SimNode>((d) => d.ty).strength(0.06))
    .force("collide", forceCollide<SimNode>((d) => d.r + padding).iterations(2))
    .stop();
  for (let i = 0; i < ticks; i++) sim.tick();
  return nodes.map((n) => {
    const limit = n.spread ?? spread;
    return {
      id: n.id,
      x: n.tx,
      lane: n.ty,
      r: n.r,
      cx: n.x ?? n.tx,
      cy: Math.max(n.ty - limit, Math.min(n.ty + limit, n.y ?? n.ty)),
    };
  });
}

export type DensityBand = { value: number; path: string };

/**
 * Density bands of points in screen space (pixels), `levels` thresholds from the sparse edge to the dense core.
 * Returns SVG path strings; an empty cloud returns no band.
 */
export function densityBands(
  points: readonly { x: number; y: number }[],
  width: number,
  height: number,
  { bandwidth = 18, levels = 6 }: { bandwidth?: number; levels?: number } = {},
): DensityBand[] {
  if (points.length < 3 || width <= 0 || height <= 0) return [];
  const contours = contourDensity<{ x: number; y: number }>()
    .x((d) => d.x)
    .y((d) => d.y)
    .size([Math.ceil(width), Math.ceil(height)])
    .bandwidth(bandwidth)
    .thresholds(levels)(points as { x: number; y: number }[]);
  return contours.map((c) => ({ value: c.value, path: geoPath(c.coordinates) }));
}

/** SVG path of contour MultiPolygon coordinates (planar, already in pixels). */
function geoPath(coords: number[][][][]): string {
  let d = "";
  for (const polygon of coords)
    for (const ring of polygon) {
      ring.forEach(([x, y], i) => {
        d += `${i ? "L" : "M"}${(x ?? 0).toFixed(1)},${(y ?? 0).toFixed(1)}`;
      });
      d += "Z";
    }
  return d;
}

export type RidgeInput = { id: string; values: readonly (number | null)[] };
export type Ridge = {
  id: string;
  /** Baseline y of the ridge in pixels. */
  base: number;
  /** Peak value used to scale the ridge (its own maximum). */
  peak: number;
  area: string;
  line: string;
  /** Pixel position of each value, for hover. */
  points: { x: number; y: number; value: number | null }[];
};

/**
 * Ridgeline geometry: rows stacked `step` pixels apart, each scaled to its own peak and drawn `overlap` steps tall, so
 * the shape of each series reads against the others regardless of size. Gaps (null) break the line.
 */
export function ridges(
  rows: readonly RidgeInput[],
  {
    x0,
    x1,
    top,
    step,
    overlap = 1.8,
  }: { x0: number; x1: number; top: number; step: number; overlap?: number },
): Ridge[] {
  return rows.map((row, i) => {
    const n = row.values.length;
    const base = top + (i + 1) * step;
    const peak = Math.max(0, ...row.values.map((v) => (typeof v === "number" ? v : 0)));
    const h = step * overlap;
    const pts = row.values.map((v, j) => ({
      x: n > 1 ? x0 + (j / (n - 1)) * (x1 - x0) : (x0 + x1) / 2,
      y: typeof v === "number" && peak > 0 ? base - (v / peak) * h : base,
      value: typeof v === "number" ? v : null,
    }));
    const defined = (p: { value: number | null }) => p.value !== null;
    const a = area<{ x: number; y: number; value: number | null }>()
      .defined(defined)
      .x((p) => p.x)
      .y0(base)
      .y1((p) => p.y)
      .curve(curveMonotoneX);
    const l = line<{ x: number; y: number; value: number | null }>()
      .defined(defined)
      .x((p) => p.x)
      .y((p) => p.y)
      .curve(curveMonotoneX);
    return { id: row.id, base, peak, area: a(pts) ?? "", line: l(pts) ?? "", points: pts };
  });
}
