/**
 * Shared shapes and pure helpers for the Analytics trend blocks. Client-safe: no I/O.
 *
 * Rules every block follows (owner decision 2026-10-23): a point is plotted only as the source states it; a period the
 * source does not record is `null` and is drawn as a gap and listed as "Not recorded", never as zero; an unfinished
 * period is flagged `partial` and is never the "latest value" a change is computed from; nothing is estimated,
 * interpolated or projected. The latest value and its change are a deterministic derivation (see `summarizeLatest`).
 */

/** How a point's `x` is written and shown. */
export type XKind = "year" | "fy" | "month" | "congress";

export type TrendPoint = {
  /** Period key: "2013", "1988" (fiscal year), "2026-10" (month) or "108" (Congress number). */
  x: string;
  /** null means the source does not record this period. */
  value: number | null;
  /** The period was still in progress when the data was taken. */
  partial?: boolean;
};

export type TrendSeries = {
  id: string;
  label: string;
  points: TrendPoint[];
};

export type ValueFormat = "count" | "usd";

export type LatestSummary = {
  /** Period the latest value belongs to, as shown ("FY2025", "October 2026", "118th Congress"). */
  period: string;
  seriesLabel: string;
  value: number;
  /** null when no earlier recorded period exists to compare with. */
  change: {
    comparedWith: string;
    previousValue: number;
    absolute: number;
    /** null when the earlier value is zero (a percentage of zero is undefined). */
    percent: number | null;
  } | null;
  /** Why the change is missing, when it is. */
  changeNote: string | null;
};

/** A vertical line on the chart where the source or its documentation says what is counted changes. */
export type TrendMarker = { x: string; label: string };

export type TrendBlockData = {
  id: string;
  xKind: XKind;
  chart: "line" | "bar";
  /** Bars of the series are stacked (the series are parts of one whole). */
  stacked: boolean;
  format: ValueFormat;
  /** What one unit of a value is: "cases", "releases"... */
  unit: string;
  series: TrendSeries[];
  /** The series the latest value is read from (an index into `series`). */
  primary: number;
  latest: LatestSummary | null;
  /** First and last period shown, written the way the source writes them. */
  period: string;
  source: { label: string; url: string };
  /** The date the source says its data runs through or was retrieved, when it states one. */
  asOf: string | null;
  /** "How to read this" and coverage caveats, one short sentence each. */
  notes: string[];
  /** Number of periods the source does not record (drawn as gaps). */
  gaps: number;
  markers: TrendMarker[];
};

export type AnalyticsBlockResult =
  | { status: "ok"; id: string; data: TrendBlockData }
  | { status: "empty"; id: string; reason: string };

export const NOT_RECORDED = "Not recorded";

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A count the source gave as a non-negative number, or null. Anything else is "Not recorded". */
export function count(v: unknown): number | null {
  return finite(v) && v >= 0 ? v : null;
}

export function formatCount(v: number | null | undefined): string {
  return finite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : NOT_RECORDED;
}

/** "$12.5 billion" / "$497,000" style: whole dollars below a million, then millions, billions, trillions. */
export function formatUsd(v: number | null | undefined): string {
  if (!finite(v)) return NOT_RECORDED;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)} trillion`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)} billion`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)} million`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatValue(v: number | null | undefined, format: ValueFormat): string {
  return format === "usd" ? formatUsd(v) : formatCount(v);
}

/** Compact axis tick ("12k", "1.4M"); counts only. */
export function formatTick(v: number, format: ValueFormat = "count"): string {
  const abs = Math.abs(v);
  const prefix = format === "usd" ? "$" : "";
  const pick = (n: number, unit: string) => {
    const s = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(0) : n.toFixed(1);
    return `${prefix}${s.replace(/\.0$/, "")}${unit}`;
  };
  if (abs >= 1e9) return pick(v / 1e9, "B");
  if (abs >= 1e6) return pick(v / 1e6, "M");
  if (abs >= 1e3) return pick(v / 1e3, "k");
  return `${prefix}${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** The two calendar years a Congress sits in: the 1st began in 1789. */
export function congressYears(n: number): string {
  const start = 1789 + (n - 1) * 2;
  return `${start}–${start + 1}`;
}

/** Full label of a period, as shown in tooltips, tables and the latest-value line. */
export function periodLabel(x: string, kind: XKind): string {
  if (kind === "fy") return `FY${x}`;
  if (kind === "congress") {
    const n = Number(x);
    return Number.isInteger(n) && n > 0 ? `${ordinal(n)} Congress (${congressYears(n)})` : x;
  }
  if (kind === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(x);
    const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
    return m && name ? `${name} ${m[1]}` : x;
  }
  return x;
}

/** Short label for an axis tick. */
export function tickLabel(x: string, kind: XKind): string {
  if (kind === "fy") return `FY${x.slice(-2)}`;
  if (kind === "congress") return ordinal(Number(x));
  if (kind === "month") return x.slice(0, 4);
  return x;
}

/** Order of two period keys: numeric for "1988" and "108", textual for "2026-10". */
export function compareX(a: string, b: string): number {
  const plain = /^\d+$/;
  return plain.test(a) && plain.test(b) ? Number(a) - Number(b) : a.localeCompare(b);
}

/** Period label with the partial-year asterisk used in charts and tables. */
export function markedPeriod(point: TrendPoint, kind: XKind): string {
  return `${periodLabel(point.x, kind)}${point.partial ? "*" : ""}`;
}

/**
 * Latest value and its change, from one series.
 *
 * The latest value is the last point that is complete (not partial) and recorded. The change compares it with the
 * point `lag` periods earlier in the series (default: the previous point), and only when that point is recorded and
 * complete; otherwise the change is withheld with a note. The series must list every period in order, with `null` for
 * a period the source does not record, so a lag of 12 on a monthly series means twelve calendar months.
 */
export function summarizeLatest(
  series: TrendSeries,
  kind: XKind,
  options: { lag?: number } = {},
): LatestSummary | null {
  const lag = options.lag ?? 1;
  let i = series.points.length - 1;
  while (i >= 0) {
    const p = series.points[i]!;
    if (!p.partial && p.value !== null) break;
    i -= 1;
  }
  if (i < 0) return null;
  const cur = series.points[i]!;
  const prev = i - lag >= 0 ? series.points[i - lag] : undefined;
  const base = {
    period: periodLabel(cur.x, kind),
    seriesLabel: series.label,
    value: cur.value as number,
  };
  if (!prev) return { ...base, change: null, changeNote: "No earlier period to compare with." };
  if (prev.value === null || prev.partial)
    return {
      ...base,
      change: null,
      changeNote: `${periodLabel(prev.x, kind)} is not recorded${prev.partial ? " as a complete period" : ""}, so no change is shown.`,
    };
  const absolute = base.value - prev.value;
  return {
    ...base,
    change: {
      comparedWith: periodLabel(prev.x, kind),
      previousValue: prev.value,
      absolute,
      percent: prev.value === 0 ? null : (absolute / prev.value) * 100,
    },
    changeNote: null,
  };
}

/** "+5,752 (+2.1%) vs FY2024" — the change line under the latest value. */
export function formatChange(
  change: NonNullable<LatestSummary["change"]>,
  format: ValueFormat = "count",
): string {
  const sign = change.absolute > 0 ? "+" : change.absolute < 0 ? "−" : "";
  const abs = formatValue(Math.abs(change.absolute), format);
  const pct =
    change.percent === null
      ? ""
      : ` (${change.percent > 0 ? "+" : change.percent < 0 ? "−" : ""}${Math.abs(change.percent).toFixed(1)}%)`;
  return `${sign}${abs}${pct} vs ${change.comparedWith}`;
}

export function changeDirection(
  change: NonNullable<LatestSummary["change"]>,
): "up" | "down" | "flat" {
  return change.absolute > 0 ? "up" : change.absolute < 0 ? "down" : "flat";
}

/** Number of recorded-gap periods across every series (null values). */
export function countGaps(series: TrendSeries[]): number {
  let gaps = 0;
  for (const s of series) for (const p of s.points) if (p.value === null) gaps += 1;
  return gaps;
}

/** First and last period of the longest series, with a trailing asterisk for a partial last period. */
export function describePeriod(series: TrendSeries[], kind: XKind): string {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return "";
  const xs = [...new Set(all.map((p) => p.x))].sort(compareX);
  const first = xs[0]!;
  const last = xs[xs.length - 1]!;
  const lastPartial = all.some((p) => p.x === last && p.partial);
  const a = periodLabel(first, kind);
  const b = `${periodLabel(last, kind)}${lastPartial ? "*" : ""}`;
  return first === last ? b : `${a}–${b}`;
}

/** Drop a series' points that are outside [from, to] by `x` (numeric compare for year-like keys). */
export function windowPoints(
  points: TrendPoint[],
  from: number,
  to: number = Infinity,
): TrendPoint[] {
  return points.filter((p) => {
    const n = Number(p.x.slice(0, 4));
    return Number.isFinite(n) && n >= from && n <= to;
  });
}

/**
 * Fill every integer year in [first, last] so a missing year is an explicit `null` (a gap), never skipped over.
 * Years the source lists keep their value and partial flag.
 */
export function densifyYears(points: TrendPoint[]): TrendPoint[] {
  if (!points.length) return [];
  const byX = new Map(points.map((p) => [p.x, p] as const));
  const nums = points.map((p) => Number(p.x)).filter(Number.isInteger);
  if (nums.length !== points.length) return points;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const out: TrendPoint[] = [];
  for (let y = lo; y <= hi; y += 1) out.push(byX.get(String(y)) ?? { x: String(y), value: null });
  return out;
}

/** Every calendar month in [first, last] ("YYYY-MM"), with `null` for a month the map does not hold. */
export function densifyMonths(
  values: ReadonlyMap<string, number | null>,
  firstMonth: string,
  lastMonth: string,
): TrendPoint[] {
  const out: TrendPoint[] = [];
  const [fy, fm] = firstMonth.split("-").map(Number) as [number, number];
  const [ly, lm] = lastMonth.split("-").map(Number) as [number, number];
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m += 1) {
    if (m > 12) {
      y += 1;
      m = 1;
    }
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ x: key, value: values.get(key) ?? null });
  }
  return out;
}

/** Build the common envelope of a block from its series; `latest` follows the primary series. */
export function assembleBlock(args: {
  id: string;
  xKind: XKind;
  chart?: "line" | "bar";
  stacked?: boolean;
  format?: ValueFormat;
  unit: string;
  series: TrendSeries[];
  primary?: number;
  /** Series the latest value is read from when it is not one of the drawn series (e.g. the total of stacked parts). */
  latestFrom?: TrendSeries;
  lag?: number;
  source: { label: string; url: string };
  asOf?: string | null;
  notes?: string[];
  markers?: TrendMarker[];
}): TrendBlockData {
  const primary = args.primary ?? 0;
  const lead = args.latestFrom ?? args.series[primary];
  return {
    id: args.id,
    xKind: args.xKind,
    chart: args.chart ?? "line",
    stacked: args.stacked ?? false,
    format: args.format ?? "count",
    unit: args.unit,
    series: args.series,
    primary,
    latest: lead
      ? summarizeLatest(lead, args.xKind, args.lag === undefined ? {} : { lag: args.lag })
      : null,
    period: describePeriod(args.series, args.xKind),
    source: args.source,
    asOf: args.asOf ?? null,
    notes: args.notes ?? [],
    gaps: countGaps(args.series),
    markers: args.markers ?? [],
  };
}

export type YearEntry = { year: number; value: number | null; partial?: boolean };

/**
 * Points for a list of per-year entries: sorted, de-duplicated by year (the first entry for a year wins) and
 * densified so a year the source does not list becomes an explicit gap (`value: null`).
 */
export function yearPoints(entries: readonly YearEntry[]): TrendPoint[] {
  const byYear = new Map<number, YearEntry>();
  for (const e of entries) {
    if (!Number.isInteger(e.year) || byYear.has(e.year)) continue;
    byYear.set(e.year, e);
  }
  const points: TrendPoint[] = [...byYear.values()]
    .sort((a, b) => a.year - b.year)
    .map((e) => ({
      x: String(e.year),
      value: e.value !== null && Number.isFinite(e.value) ? e.value : null,
      ...(e.partial ? { partial: true } : {}),
    }));
  return densifyYears(points);
}

function validIso(s: string): string | null {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** The ISO date (YYYY-MM-DD) a snapshot description says its data runs through, or null. */
export function throughDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const iso = /through (\d{4}-\d{2}-\d{2})/i.exec(text);
  if (iso) return validIso(iso[1]!);
  const long = /through ([A-Z][a-z]+) (\d{1,2}), (\d{4})/.exec(text);
  if (long) {
    const month = MONTHS.indexOf(long[1]!);
    if (month >= 0)
      return validIso(
        `${long[3]}-${String(month + 1).padStart(2, "0")}-${long[2]!.padStart(2, "0")}`,
      );
  }
  return null;
}

/** "June 30, 2026" for an ISO date; the input itself when it is not a valid ISO date. */
export function longDate(iso: string): string {
  const ok = validIso(iso);
  if (!ok) return iso;
  const [y, m, d] = ok.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * Whether Congress `n` is still sitting on `asOf` (ISO date): a Congress from the 73rd on begins on January 3 of an
 * odd year and ends on January 3 two years later. Earlier Congresses are never reported as open.
 */
export function congressIsOpen(n: number, asOf: string): boolean {
  if (!Number.isInteger(n) || n < 73) return false;
  const endYear = 1789 + (n - 1) * 2 + 2;
  return asOf < `${endYear}-01-03`;
}
