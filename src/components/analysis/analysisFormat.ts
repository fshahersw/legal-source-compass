/**
 * Pure formatting and ranking helpers shared by the "Key takeaways", "How to read this" and coverage
 * blocks. Every helper returns "Not recorded" (or null) for an unknown input; none guesses a number.
 */

export const NOT_RECORDED = "Not recorded";

/** A short, number-backed statement computed from data a page has already loaded. */
export type Takeaway = {
  id: string;
  /** The headline number or phrase, 12 characters or fewer when possible ("41.8%", "2.3×", "$7.2B"). */
  figure: string;
  /** One sentence saying what the figure is and what it is measured against. */
  text: string;
  /** DOM id of the section the figure comes from; rendered as an in-page link. */
  anchor?: string;
  anchorLabel?: string;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** "12,345"; Not recorded for null, undefined or non-finite values. */
export function int(v: number | null | undefined): string {
  return isNum(v) ? Math.round(v).toLocaleString("en-US") : NOT_RECORDED;
}

/** "41.8%" from a value already in percent units. */
export function pct(v: number | null | undefined, digits = 1): string {
  return isNum(v)
    ? `${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
    : NOT_RECORDED;
}

/** "+4.2%" / "−3.1%" from percent units; the minus sign is a real minus, not a hyphen. */
export function signedPct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return NOT_RECORDED;
  const body = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return v > 0 ? `+${body}%` : v < 0 ? `−${body}%` : `${body}%`;
}

/** "12K", "1.5M", "2.4B"; thousands separators below 10,000. */
export function compact(v: number | null | undefined): string {
  if (!isNum(v)) return NOT_RECORDED;
  return Math.abs(v) >= 10_000
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)
    : v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** "$7.2B", "$24.3M", "$950K", "$12,400"; dollars, never guessed. */
export function usdCompact(v: number | null | undefined): string {
  if (!isNum(v)) return NOT_RECORDED;
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e9)
    return `${sign}$${(abs / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 })}B`;
  if (abs >= 1e6)
    return `${sign}$${(abs / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (abs >= 1e5)
    return `${sign}$${(abs / 1e3).toLocaleString("en-US", { maximumFractionDigits: 0 })}K`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

/** "1 MDL", "3 MDLs". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${int(count)} ${count === 1 ? one : many}`;
}

/** part ÷ whole as percent units; null when the whole is zero, negative or unknown. */
export function shareOf(
  part: number | null | undefined,
  whole: number | null | undefined,
): number | null {
  if (!isNum(part) || !isNum(whole) || whole <= 0) return null;
  return (100 * part) / whole;
}

/** "2.3×" for a ÷ b when b is positive; null otherwise (a zero base has no ratio). */
export function times(
  a: number | null | undefined,
  b: number | null | undefined,
  digits = 1,
): string | null {
  if (!isNum(a) || !isNum(b) || b <= 0) return null;
  return `${(a / b).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}×`;
}

/** Relative change in percent units from `before` to `after`; null when `before` is zero or unknown. */
export function changePct(
  after: number | null | undefined,
  before: number | null | undefined,
): number | null {
  if (!isNum(after) || !isNum(before) || before === 0) return null;
  return (100 * (after - before)) / Math.abs(before);
}

/** Share of the total held by the k largest values, in percent units; null for an empty or zero total. */
export function topShare(values: readonly number[], k: number): number | null {
  const clean = values.filter((v) => isNum(v) && v > 0);
  const total = clean.reduce((a, b) => a + b, 0);
  if (!total || k <= 0) return null;
  const top = [...clean].sort((a, b) => b - a).slice(0, k);
  return (100 * top.reduce((a, b) => a + b, 0)) / total;
}

/** Median of the finite values; null when there are none. */
export function medianOf(values: readonly (number | null | undefined)[]): number | null {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/**
 * The first `max` takeaways with unknowns (null) removed and duplicate ids dropped. A page that has
 * fewer than two usable takeaways shows none, so a lone bullet never poses as a summary.
 */
export function usableTakeaways(
  items: readonly (Takeaway | null | undefined)[],
  max = 5,
): Takeaway[] {
  const seen = new Set<string>();
  const out: Takeaway[] = [];
  for (const item of items) {
    if (!item || seen.has(item.id) || !item.figure || item.figure === NOT_RECORDED) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= max) break;
  }
  return out.length >= 2 ? out : [];
}

/** "a, b and c"; "a and b"; "a". */
export function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Segments for a proportion bar with the zero-valued and non-finite ones removed and shares attached. */
export function coverageShares<T extends { value: number }>(
  segments: readonly T[],
): { segment: T; sharePct: number }[] {
  const live = segments.filter((s) => isNum(s.value) && s.value > 0);
  const total = live.reduce((a, s) => a + s.value, 0);
  if (!total) return [];
  return live.map((segment) => ({ segment, sharePct: (100 * segment.value) / total }));
}
