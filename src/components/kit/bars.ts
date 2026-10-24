/** Bar geometry for BarList (pure and tested in recipe.test.ts). */

/** Where a bar starts and how wide it is, in percent of the track. Pure and tested. */
export function barExtent(
  value: number | null,
  maxAbs: number,
  diverging: boolean,
): { left: number; width: number } | null {
  if (value === null || !Number.isFinite(value) || !(maxAbs > 0)) return null;
  const share = Math.min(1, Math.abs(value) / maxAbs);
  if (!diverging) return { left: 0, width: share * 100 };
  return value >= 0
    ? { left: 50, width: share * 50 }
    : { left: 50 - share * 50, width: share * 50 };
}
