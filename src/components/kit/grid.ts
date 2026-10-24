/**
 * Balanced KPI grid columns. A row of KPI cards should never leave one card alone in the last row (three cards in two
 * columns), so the column count follows the number of cards:
 *
 * - no more cards than columns: one full row, no empty cell;
 * - otherwise the column count with the fewest empty cells in the last row that never leaves a lone card (a perfect
 *   rectangle wins; on equal gaps the wider grid wins);
 * - when no column count avoids a lone card: a short stack (one column) up to four cards, else the widest grid.
 *
 * `kpiGridClass` turns that into the Tailwind classes for each breakpoint from `columns`, the widest grid the page
 * wants at xl. The class names are written out in full so Tailwind finds them. Pure and tested (grid.test.ts).
 */

export function balancedColumns(count: number, max: number): number {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const m = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 1;
  if (n <= 1 || m === 1) return 1;
  if (n <= m) return n;
  let best = 0;
  let bestEmpty = Number.POSITIVE_INFINITY;
  for (let c = m; c >= 2; c--) {
    const rest = n % c;
    if (rest === 1) continue; // a lone card in the last row
    const empty = rest === 0 ? 0 : c - rest;
    if (empty < bestEmpty) {
      best = c;
      bestEmpty = empty;
    }
  }
  if (best) return best;
  return n <= 4 ? 1 : m;
}

export type GridColumns = 2 | 3 | 4 | 5 | 6;

/** The widest column count at each breakpoint for a grid whose widest layout (xl) has `columns` columns. */
export function gridMaxima(columns: GridColumns): {
  base: number;
  sm: number;
  lg: number;
  xl: number;
} {
  const small = columns >= 5;
  return {
    base: small ? 2 : 1,
    sm: small ? 3 : 2,
    lg: small ? 3 : Math.min(columns, 3),
    xl: columns,
  };
}

const BASE = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" } as const;
const SM = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
} as const;
const LG = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
} as const;
const XL = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
} as const;

const pick = <T extends Record<number, string>>(table: T, n: number): string =>
  table[Math.min(Math.max(1, n), Math.max(...Object.keys(table).map(Number))) as keyof T] as string;

/** Classes for a grid of `count` cards whose widest layout has `columns` columns. */
export function kpiGridClass(count: number, columns: GridColumns): string {
  const max = gridMaxima(columns);
  return [
    pick(BASE, balancedColumns(count, max.base)),
    pick(SM, balancedColumns(count, max.sm)),
    pick(LG, balancedColumns(count, max.lg)),
    pick(XL, balancedColumns(count, max.xl)),
  ].join(" ");
}
