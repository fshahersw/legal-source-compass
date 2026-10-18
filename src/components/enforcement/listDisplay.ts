/** Pure display helpers for /law/enforcement lists, flags and chart axes. */

/** "2.4×", or "from 0" when the five-year baseline is zero (the ratio is undefined, not infinite). */
export function surgeRatioLabel(ratio: number): string {
  return Number.isFinite(ratio) ? `${ratio.toFixed(1)}×` : "from 0";
}

/**
 * Highest surge ratio first; a zero baseline (ratio Infinity) ranks above every finite ratio, and
 * equal ratios (including two zero baselines) fall back to more cases opened in the latest year.
 * Never subtracts ratios, so Infinity − Infinity cannot yield a NaN comparator.
 */
export function bySurgeDesc(
  a: { ratio: number; latest: number },
  b: { ratio: number; latest: number },
): number {
  if (a.ratio === b.ratio) return b.latest - a.latest;
  return b.ratio > a.ratio ? 1 : -1;
}

/** The first `limit` rows unless expanded, and how many are hidden: lists never cap silently. */
export function capped<T>(
  rows: readonly T[],
  limit: number,
  expanded = false,
): { shown: T[]; hidden: number } {
  const shown = expanded ? [...rows] : rows.slice(0, limit);
  return { shown, hidden: rows.length - shown.length };
}

/**
 * "a; b +3 more": the first `limit` items joined, then how many were left out. `total` is the true
 * number of items when the stored list is itself a capped sample (e.g. a builder keeps five case
 * numbers for a group of twelve cases); it never counts fewer than the items supplied. Nothing is
 * returned when no item is stored, so a bare "+N more" never stands alone.
 */
export function joinCapped(
  items: readonly string[],
  limit: number,
  separator: string,
  total: number = items.length,
): string {
  const head = items.slice(0, limit).join(separator);
  if (!head) return "";
  const hidden = Math.max(total, items.length) - Math.min(limit, items.length);
  return hidden > 0 ? `${head} +${hidden.toLocaleString("en-US")} more` : head;
}

/** Axis ticks: thousands separators, compact from 10,000 ("12K", "1.5M"). */
export function numTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  return Math.abs(value) >= 10_000
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
        value,
      )
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Axis ticks for values already in millions of dollars: "$950M", "$1.5B", "$12.4B" (never "$12KM"). */
export function usdMillionsTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return abs >= 1000
    ? `${sign}$${(abs / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`
    : `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
}
