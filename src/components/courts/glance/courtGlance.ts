/**
 * Pure helpers for the court profile's identity strip: the latest recorded value of a yearly series together with
 * the year it belongs to, and the change on the immediately preceding year only (never across a gap).
 */
export type LatestYear = {
  year: number;
  value: number;
  /** Change on year - 1, in percent; null when year - 1 is not recorded or is zero. */
  changePct: number | null;
  previous: number | null;
};

export function latestWithYear(
  years: readonly number[],
  values: readonly (number | null)[] | undefined,
): LatestYear | null {
  if (!values) return null;
  for (let i = Math.min(years.length, values.length) - 1; i >= 0; i--) {
    const v = values[i];
    if (typeof v !== "number") continue;
    const year = years[i]!;
    const j = years.indexOf(year - 1);
    const p = j >= 0 ? values[j] : null;
    const previous = typeof p === "number" ? p : null;
    return {
      year,
      value: v,
      previous,
      changePct: previous ? (100 * (v - previous)) / previous : null,
    };
  }
  return null;
}
