/** Pure display helpers for the CourtListener bulk-data panels added by the courtlistener_rest stream. */

/**
 * Where a yearly chart starts: the first year holding at least `minShare` of the busiest year's count, so a handful of very old
 * rows does not stretch the axis. Returns the plotted rows and the count left out before them (stated in the footnote).
 */
export function chartFrom<T extends { yr: number }>(
  rows: readonly T[],
  value: (row: T) => number,
  minShare = 0.02,
): { rows: T[]; earlier: number } {
  const peak = Math.max(0, ...rows.map(value));
  const start = rows.findIndex((r) => value(r) >= minShare * peak);
  if (start <= 0) return { rows: [...rows], earlier: 0 };
  return {
    rows: rows.slice(start),
    earlier: rows.slice(0, start).reduce((a, r) => a + value(r), 0),
  };
}

/** "1998–2022", a single year, or null when neither end is recorded. */
export function yearSpan(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): string | null {
  const ya = a == null ? null : String(a).slice(0, 4);
  const yb = b == null ? null : String(b).slice(0, 4);
  if (!ya && !yb) return null;
  if (!ya || !yb || ya === yb) return ya ?? yb;
  return `${ya}–${yb}`;
}
