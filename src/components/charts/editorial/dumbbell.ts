/**
 * Pure model of the dumbbell range: two values per row on one shared zero-based scale, the connector between them,
 * the gap, row order. A missing value is never drawn as zero. Tested in editorial.test.ts.
 */
import { niceDomain } from "../scale";

export type DumbbellRow = {
  id: string;
  label: string;
  /** First and second value (for example filed and terminated); null means not recorded. */
  a: number | null | undefined;
  b: number | null | undefined;
  highlight?: boolean | undefined;
  note?: string | undefined;
};

const rec = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The shared scale: 0 to a nice maximum over every recorded value, with its ticks. */
export function dumbbellScale(
  rows: readonly DumbbellRow[],
  maxValue?: number,
): { max: number; ticks: number[] } {
  const vals = rows.flatMap((r) => [r.a, r.b]).filter(rec);
  const top = maxValue ?? Math.max(0, ...vals);
  if (!(top > 0)) return { max: 1, ticks: [0, 1] };
  const nd = niceDomain([0, top], { zero: true, count: 4 });
  return { max: nd.domain[1], ticks: nd.ticks };
}

export type DumbbellLayout = {
  /** Positions on the scale in percent (0–100), or null when the value is not recorded. */
  a: number | null;
  b: number | null;
  /** Connector from the smaller to the larger position; null unless both are recorded. */
  connector: { left: number; width: number } | null;
  /** b − a, or null unless both are recorded. */
  gap: number | null;
};

export function dumbbellLayout(row: DumbbellRow, max: number): DumbbellLayout {
  const pos = (v: number | null | undefined) => (rec(v) ? (Math.min(v, max) / max) * 100 : null);
  const a = pos(row.a);
  const b = pos(row.b);
  const both = a !== null && b !== null;
  return {
    a,
    b,
    connector: both ? { left: Math.min(a, b), width: Math.max(Math.abs(b - a), 0.6) } : null,
    gap: rec(row.a) && rec(row.b) ? row.b - row.a : null,
  };
}

export type DumbbellSort = "given" | "a-desc" | "b-desc" | "gap-desc" | "gap-asc";

/** Rows ordered by a value or by the gap; rows without the sort value go last, in their order. */
export function sortDumbbell(rows: readonly DumbbellRow[], sort: DumbbellSort): DumbbellRow[] {
  if (sort === "given") return [...rows];
  const key = (r: DumbbellRow): number | null =>
    sort === "a-desc"
      ? rec(r.a)
        ? r.a
        : null
      : sort === "b-desc"
        ? rec(r.b)
          ? r.b
          : null
        : rec(r.a) && rec(r.b)
          ? r.b - r.a
          : null;
  const dir = sort === "gap-asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((x, y) => {
      if (x.k === null && y.k === null) return x.i - y.i;
      if (x.k === null) return 1;
      if (y.k === null) return -1;
      return dir * (x.k - y.k) || x.i - y.i;
    })
    .map((o) => o.r);
}
