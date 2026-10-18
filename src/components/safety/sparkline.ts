/**
 * Pure geometry for the small trend lines in the safety tables. No chart library: a table row draws one inline SVG.
 * A null value breaks the line (no interpolation across a gap); a partial point is joined to the line by a dashed
 * segment so an incomplete period never reads as a complete one; a design break is a vertical tick between two points.
 */

export type SparkPoint = { value: number | null; partial?: boolean };

export type SparkGeometry = {
  /** Solid path segments (runs of complete, non-null points). */
  solid: string[];
  /** Dashed path segments (a partial point and the point before it). */
  dashed: string[];
  /** Isolated complete points (a run of one) and the partial endpoints, as circles. */
  dots: { x: number; y: number; partial: boolean }[];
  /** x of the break tick, when `breakBefore` named a point. */
  breakX: number | null;
  max: number;
};

const r = (n: number) => Math.round(n * 10) / 10;

export function sparkGeometry(
  points: readonly SparkPoint[],
  width: number,
  height: number,
  opts: { pad?: number; breakBefore?: number | null } = {},
): SparkGeometry {
  const pad = opts.pad ?? 2;
  const n = points.length;
  const values = points.flatMap((p) =>
    p.value != null && Number.isFinite(p.value) ? [p.value] : [],
  );
  const max = values.length ? Math.max(...values, 0) : 0;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));
  // Counts are drawn from a zero baseline so a small change never looks like a collapse.
  const y = (v: number) =>
    max <= 0 ? height - pad : height - pad - (v / max) * (height - 2 * pad);
  const solid: string[] = [];
  const dashed: string[] = [];
  const dots: SparkGeometry["dots"] = [];
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length > 1)
      solid.push(run.map((p, i) => `${i === 0 ? "M" : "L"}${r(p.x)} ${r(p.y)}`).join(" "));
    else if (run.length === 1) dots.push({ x: r(run[0]!.x), y: r(run[0]!.y), partial: false });
    run = [];
  };
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    if (p.value == null || !Number.isFinite(p.value)) {
      flush();
      prev = null;
      continue;
    }
    const pt = { x: x(i), y: y(p.value) };
    if (p.partial) {
      flush();
      if (prev) dashed.push(`M${r(prev.x)} ${r(prev.y)} L${r(pt.x)} ${r(pt.y)}`);
      dots.push({ x: r(pt.x), y: r(pt.y), partial: true });
      prev = pt;
      continue;
    }
    run.push(pt);
    prev = pt;
  }
  flush();
  const b = opts.breakBefore;
  const breakX = b != null && b > 0 && b < n ? r((x(b - 1) + x(b)) / 2) : null;
  return { solid, dashed, dots, breakX, max };
}
