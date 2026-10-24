/**
 * Takeaway helpers: turn the values a chart plots into the plain-words title it carries ("Filings peaked in FY2020 at
 * 236,431; 45,713 in FY2025"). Pure and deterministic. Every sentence is computed from the values passed in, never
 * from anything else; when a statement cannot be made reliably (fewer than two recorded values, ties that make "the
 * highest" ambiguous) the helpers return null and the caller keeps its neutral, descriptive title.
 *
 * Partial periods (a year still in progress) are left out of every comparison: a partial count is not a fall.
 */

export type TakeawayPoint = {
  /** Period or category label exactly as the chart shows it ("FY2025", "2024", "D. New Jersey"). */
  label: string;
  value: number | null | undefined;
  /** Partial period: drawn by the chart but never compared. */
  partial?: boolean | undefined;
};

export type Located = { label: string; value: number; index: number };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Recorded, complete points in their original order. */
export function recordedPoints(points: readonly TakeawayPoint[]): Located[] {
  const out: Located[] = [];
  points.forEach((p, index) => {
    if (isNum(p.value) && !p.partial) out.push({ label: p.label, value: p.value, index });
  });
  return out;
}

/** Highest recorded value; on a tie the earliest. Null when nothing is recorded. */
export function peakOf(points: readonly TakeawayPoint[]): Located | null {
  let best: Located | null = null;
  for (const p of recordedPoints(points)) if (!best || p.value > best.value) best = p;
  return best;
}

/** Lowest recorded value; on a tie the earliest. */
export function lowOf(points: readonly TakeawayPoint[]): Located | null {
  let best: Located | null = null;
  for (const p of recordedPoints(points)) if (!best || p.value < best.value) best = p;
  return best;
}

/** Last recorded complete value. */
export function latestOf(points: readonly TakeawayPoint[]): Located | null {
  const r = recordedPoints(points);
  return r.length ? r[r.length - 1]! : null;
}

/** First recorded complete value. */
export function firstOf(points: readonly TakeawayPoint[]): Located | null {
  return recordedPoints(points)[0] ?? null;
}

/** Absolute and relative change from `from` to `to`; the relative change is null when the base is zero. */
export function changeBetween(
  from: number,
  to: number,
): { absolute: number; percent: number | null } {
  return { absolute: to - from, percent: from === 0 ? null : ((to - from) / Math.abs(from)) * 100 };
}

export type TrendSummary = {
  first: Located;
  latest: Located;
  peak: Located;
  low: Located;
  /** Number of recorded complete points. */
  n: number;
  change: { absolute: number; percent: number | null };
  /** The latest value is the single highest of the series (no earlier value equals it). */
  latestIsPeak: boolean;
  /** The latest value is the single lowest of the series. */
  latestIsLow: boolean;
};

/** Summary of a time series, or null with fewer than two recorded complete values. */
export function summarizeTrend(points: readonly TakeawayPoint[]): TrendSummary | null {
  const r = recordedPoints(points);
  if (r.length < 2) return null;
  const first = r[0]!;
  const latest = r[r.length - 1]!;
  const peak = peakOf(points)!;
  const low = lowOf(points)!;
  const unique = (v: number) => r.filter((p) => p.value === v).length === 1;
  return {
    first,
    latest,
    peak,
    low,
    n: r.length,
    change: changeBetween(first.value, latest.value),
    latestIsPeak: latest.value === peak.value && unique(latest.value),
    latestIsLow: latest.value === low.value && unique(latest.value),
  };
}

/** "18.2%" for a relative change, sign dropped (the verb carries the direction). */
export function percentWords(p: number): string {
  const a = Math.abs(p);
  return `${a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(a >= 10 ? 0 : 1)}%`;
}

export type TrendTakeawayOptions = {
  /** Below this relative change (percent) the series is described as changing little. Default 5. */
  flatBelow?: number;
  /** A peak counts as "since fallen" when the latest value is at least this much below it (percent). Default 10. */
  fallFromPeak?: number;
};

/**
 * One sentence about a time series, subject first: "Product liability filings peaked at 236,431 in FY2020; 45,713 in
 * FY2025". The verbs are past tense so the subject's number never matters. `format` writes a value with its unit.
 * Returns null when the series has fewer than two recorded complete values.
 */
export function trendTakeaway(
  subject: string,
  points: readonly TakeawayPoint[],
  format: (v: number) => string,
  options: TrendTakeawayOptions = {},
): string | null {
  const s = summarizeTrend(points);
  if (!s) return null;
  const flatBelow = options.flatBelow ?? 5;
  const fallFromPeak = options.fallFromPeak ?? 10;
  if (s.n >= 3 && s.latestIsPeak)
    return `${subject} reached a high of ${format(s.latest.value)} in ${s.latest.label}`;
  if (s.n >= 3 && s.latestIsLow && s.latest.value !== s.first.value)
    return `${subject} fell to a low of ${format(s.latest.value)} in ${s.latest.label}`;
  const peakInterior = s.peak.index !== s.first.index && s.peak.index !== s.latest.index;
  if (
    s.n >= 3 &&
    peakInterior &&
    s.peak.value > 0 &&
    ((s.peak.value - s.latest.value) / Math.abs(s.peak.value)) * 100 >= fallFromPeak
  )
    return `${subject} peaked at ${format(s.peak.value)} in ${s.peak.label}; ${format(s.latest.value)} in ${s.latest.label}`;
  const p = s.change.percent;
  if (p === null) {
    if (s.change.absolute === 0)
      return `${subject} stood at ${format(s.latest.value)} in ${s.first.label} and ${s.latest.label}`;
    return `${subject} ${s.change.absolute > 0 ? "rose" : "fell"} from ${format(s.first.value)} in ${s.first.label} to ${format(s.latest.value)} in ${s.latest.label}`;
  }
  if (Math.abs(p) < flatBelow)
    return `${subject} changed little from ${s.first.label} to ${s.latest.label} (${format(s.first.value)} to ${format(s.latest.value)})`;
  return `${subject} ${p > 0 ? "rose" : "fell"} ${percentWords(p)} from ${s.first.label} to ${s.latest.label}, to ${format(s.latest.value)}`;
}

/** Change between the last two recorded complete points: "+4.4% vs FY2024" style building block. */
export function lastChange(
  points: readonly TakeawayPoint[],
): { from: Located; to: Located; absolute: number; percent: number | null } | null {
  const r = recordedPoints(points);
  if (r.length < 2) return null;
  const from = r[r.length - 2]!;
  const to = r[r.length - 1]!;
  return { from, to, ...changeBetween(from.value, to.value) };
}

export type RankTakeawayItem = { label: string; value: number | null | undefined };

/**
 * One sentence about a ranking: "D. South Carolina leads with 1,130.7; D. New Jersey next at 659.7". A tie for first
 * names both. Null when no value is recorded. `ascending` ranks the lowest first ("fastest", "shortest").
 */
export function rankTakeaway(
  items: readonly RankTakeawayItem[],
  format: (v: number) => string,
  options: { ascending?: boolean; verb?: string; withRunnerUp?: boolean } = {},
): string | null {
  const sorted = items
    .filter((i): i is { label: string; value: number } => isNum(i.value))
    .sort((a, b) => (options.ascending ? a.value - b.value : b.value - a.value));
  const top = sorted[0];
  if (!top) return null;
  const tied = sorted.filter((i) => i.value === top.value);
  if (tied.length > 1) {
    const names =
      tied.length === 2 ? `${tied[0]!.label} and ${tied[1]!.label}` : `${tied.length} entries`;
    return `${names} tie at ${format(top.value)}`;
  }
  const verb = options.verb ?? "leads with";
  const next = sorted[1];
  const runnerUp =
    (options.withRunnerUp ?? true) && next ? `; ${next.label} next at ${format(next.value)}` : "";
  return `${top.label} ${verb} ${format(top.value)}${runnerUp}`;
}

/**
 * Share of the largest part: "Drug accounts for 46% of 5,290 entries". Null when the total is not positive or the
 * largest part is tied.
 */
export function shareTakeaway(
  parts: readonly RankTakeawayItem[],
  options: { totalLabel?: (total: number) => string } = {},
): string | null {
  const rec = parts.filter((p): p is { label: string; value: number } => isNum(p.value));
  const total = rec.reduce((a, p) => a + p.value, 0);
  if (!(total > 0) || rec.some((p) => p.value < 0)) return null;
  const sorted = [...rec].sort((a, b) => b.value - a.value);
  const top = sorted[0]!;
  if (sorted[1] && sorted[1].value === top.value) return null;
  const pct = (top.value / total) * 100;
  const of = options.totalLabel ? ` of ${options.totalLabel(total)}` : " of the total";
  return `${top.label} accounts for ${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%${of}`;
}

export type FoldResult<T> = {
  shown: T[];
  /** Sum of the folded parts that carry a value; null when nothing was folded. */
  other: { label: string; value: number; count: number } | null;
  /** Parts without a value: never folded into a sum, listed by the caller as Not recorded. */
  missing: T[];
};

/**
 * Top `n` parts by value, the rest folded into one "Other" part (sum of the recorded values). Parts without a value
 * are returned apart and never summed. Folding a single part is pointless, so with n + 1 parts all are shown.
 */
export function foldTail<T extends { value: number | null | undefined }>(
  parts: readonly T[],
  n: number,
  otherLabel = "Other",
): FoldResult<T> {
  const withValue = parts.filter((p) => isNum(p.value));
  const missing = parts.filter((p) => !isNum(p.value));
  const sorted = [...withValue].sort((a, b) => (b.value as number) - (a.value as number));
  if (sorted.length <= n + 1) return { shown: sorted, other: null, missing };
  const tail = sorted.slice(n);
  return {
    shown: sorted.slice(0, n),
    other: {
      label: otherLabel,
      value: tail.reduce((a, p) => a + (p.value as number), 0),
      count: tail.length,
    },
    missing,
  };
}

/**
 * For a stacked or multi-series chart over rows: keep the `n` series with the largest totals and sum the others
 * into `otherKey` per row (null in a row where none of the folded series has a value). Returns the kept keys in
 * descending total order. Rows are copied, never mutated.
 */
export function foldSeries<R extends Record<string, unknown>>(
  rows: readonly R[],
  keys: readonly string[],
  n: number,
  otherKey = "__other",
): { rows: (R & Record<string, number | null>)[]; kept: string[]; folded: string[] } {
  const total = (k: string) => rows.reduce((a, r) => a + (isNum(r[k]) ? (r[k] as number) : 0), 0);
  const ranked = [...keys].sort((a, b) => total(b) - total(a));
  if (ranked.length <= n + 1)
    return { rows: rows.map((r) => ({ ...r })) as never, kept: ranked, folded: [] };
  const kept = ranked.slice(0, n);
  const folded = ranked.slice(n);
  const out = rows.map((r) => {
    const vals = folded.map((k) => r[k]).filter(isNum);
    return { ...r, [otherKey]: vals.length ? vals.reduce((a, v) => a + v, 0) : null };
  });
  return { rows: out as never, kept, folded };
}

/** Median of the recorded values, or null when none is recorded. */
export function medianOf(values: readonly (number | null | undefined)[]): number | null {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export type RankRowInput = { id: string; label: string; value: number | null | undefined };
export type RankRow = { id: string; label: string; value: number; rank: number; focus: boolean };

/**
 * Rows for a ranked bar chart: recorded values sorted (descending unless `ascending`), competition-ranked (ties share
 * a rank). With `limit`, the top rows are kept and the focus row, when it ranks below the cut, replaces the last kept
 * row so it is always visible. Items without a value are returned apart (listed as Not recorded, never drawn as 0).
 */
export function rankRows(
  items: readonly RankRowInput[],
  options: {
    ascending?: boolean | undefined;
    limit?: number | undefined;
    focusId?: string | null | undefined;
  } = {},
): { rows: RankRow[]; total: number; missing: RankRowInput[]; focusRank: number | null } {
  const recorded = items
    .filter((i): i is RankRowInput & { value: number } => isNum(i.value))
    .sort(
      (a, b) =>
        (options.ascending ? a.value - b.value : b.value - a.value) ||
        a.label.localeCompare(b.label),
    );
  const ranked: RankRow[] = [];
  recorded.forEach((r, i) => {
    const prev = ranked[i - 1];
    ranked.push({
      id: r.id,
      label: r.label,
      value: r.value,
      rank: prev && prev.value === r.value ? prev.rank : i + 1,
      focus: options.focusId != null && r.id === options.focusId,
    });
  });
  const focus = ranked.find((r) => r.focus) ?? null;
  let rows = ranked;
  const limit = options.limit;
  if (limit && ranked.length > limit) {
    rows = ranked.slice(0, limit);
    if (focus && !rows.includes(focus)) rows = [...rows.slice(0, limit - 1), focus];
  }
  return {
    rows,
    total: ranked.length,
    missing: items.filter((i) => !isNum(i.value)),
    focusRank: focus ? focus.rank : null,
  };
}

/**
 * One sentence placing a focus item against a benchmark: "D. Minnesota: 8.2 months, 0.3 above the median district
 * (7.9)". `format` writes a value with its unit; `diff` writes the absolute difference.
 */
export function benchmarkTakeaway(
  focusLabel: string,
  value: number | null | undefined,
  benchmark: number | null | undefined,
  benchmarkLabel: string,
  format: (v: number) => string,
  diff: (d: number) => string = format,
): string | null {
  if (!isNum(value) || !isNum(benchmark)) return null;
  const d = value - benchmark;
  if (d === 0) return `${focusLabel}: ${format(value)}, level with ${benchmarkLabel}`;
  return `${focusLabel}: ${format(value)}, ${diff(Math.abs(d))} ${d > 0 ? "above" : "below"} ${benchmarkLabel} (${format(benchmark)})`;
}
