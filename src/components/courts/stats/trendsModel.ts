/**
 * Pure shaping helpers for the court statistics trend charts (CourtStatsTrendsPanel). Every helper returns null or
 * "Not recorded" for an unknown input; nothing is estimated, interpolated or carried forward, a published dash stays a
 * dash, and the only derived figure is a court's share of the national total for the same column and period.
 */
import type {
  UstColumn,
  UstPeriod,
  UstTable,
  UstUnit,
} from "@/lib/external/uscourtsTables.functions";

export const NOT_RECORDED = "Not recorded";

/**
 * "fy": the 12-month periods ending September 30 (the publisher's fiscal year, Judicial Business).
 * "rolling": every published 12-month period, whatever month it ends in (September, March, June, December): consecutive
 * points overlap by nine months, so a point is never added to its neighbour.
 */
export type PeriodMode = "fy" | "rolling";

export type TrendPoint = {
  end: string;
  value: number | null;
  /** The publisher printed a dash in this cell (not zero, not computed). */
  dash: boolean;
  pub: string;
  /** Index into the table's `sources`. */
  src: number;
};

export type TrendSeries = {
  id: string;
  label: string;
  points: TrendPoint[];
  /** Dashed, muted line (the national row). */
  dashed?: boolean;
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Indexes of the periods a mode shows. `months` is the period length the chart is about: 12 for a flow measured over twelve
 * months, 0 for a count of cases pending "as of" a date (a point in time). A period of unknown length is never plotted as one.
 */
export function periodIndexes(
  periods: readonly UstPeriod[],
  mode: PeriodMode,
  months = 12,
): number[] {
  const out: number[] = [];
  periods.forEach((p, i) => {
    if (p.months !== months) return;
    if (mode === "fy" && !p.end.endsWith("-09-30")) return;
    out.push(i);
  });
  return out;
}

/** Which modes have at least two points for a table, so a toggle never offers an empty or one-point view. */
export function availableModes(periods: readonly UstPeriod[], months = 12): PeriodMode[] {
  const modes: PeriodMode[] = [];
  if (periodIndexes(periods, "fy", months).length >= 2) modes.push("fy");
  if (periodIndexes(periods, "rolling", months).length >= 2) modes.push("rolling");
  return modes;
}

export type SeriesOf = "court" | "national" | "circuit";

/** The points of one column for the court, its circuit or the nation, over the periods a mode shows. */
export function columnPoints(
  table: UstTable,
  key: string,
  of: SeriesOf,
  mode: PeriodMode,
  months = 12,
): TrendPoint[] {
  const values =
    of === "court"
      ? table.data[key]
      : of === "national"
        ? table.national[key]
        : table.circuit?.[key];
  if (!values) return [];
  const dash = new Set(
    (of === "court" ? table.dash[key] : of === "national" ? table.nationalDash[key] : undefined) ??
      [],
  );
  return periodIndexes(table.periods, mode, months).map((i) => ({
    end: table.periods[i]!.end,
    value: values[i] ?? null,
    dash: dash.has(i),
    pub: table.periods[i]!.pub,
    src: table.periods[i]!.src,
  }));
}

export function hasValues(points: readonly TrendPoint[], atLeast = 1): boolean {
  return points.filter((p) => p.value != null).length >= atLeast;
}

export function latest(points: readonly TrendPoint[]): TrendPoint | null {
  for (let i = points.length - 1; i >= 0; i -= 1) if (points[i]!.value != null) return points[i]!;
  return null;
}

/** The court's share of the national figure for the same column and period, in percent; null unless both are known. */
export function shareOfNational(
  court: readonly TrendPoint[],
  national: readonly TrendPoint[],
): TrendPoint[] {
  const byEnd = new Map(national.map((p) => [p.end, p]));
  return court.map((p) => {
    const n = byEnd.get(p.end);
    const value =
      p.value != null && n?.value != null && n.value > 0 ? (100 * p.value) / n.value : null;
    return { ...p, value, dash: false };
  });
}

/** "Sep 2025" for a rolling window, "FY2025" for a September 30 fiscal-year window. */
export function periodLabel(end: string, mode: PeriodMode): string {
  const year = end.slice(0, 4);
  if (mode === "fy" && end.endsWith("-09-30")) return `FY${year}`;
  const month = MONTH[Number(end.slice(5, 7)) - 1];
  return month ? `${month} ${year}` : end;
}

/** The length of a period in words: "12 months ending", "3 months ending", "As of" for a count at a date, "Period ending" if unknown. */
export function periodHeader(months: number | null = 12): string {
  if (months === 0) return "As of";
  if (months == null) return "Period ending";
  return `${months} ${months === 1 ? "month" : "months"} ending`;
}

function dateText(end: string): string | null {
  const names = [
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
  const name = names[Number(end.slice(5, 7)) - 1];
  if (!name || end.length !== 10) return null;
  return `${name} ${Number(end.slice(8, 10))}, ${end.slice(0, 4)}`;
}

/** "12 months ending September 30, 2025", "As of September 30, 2025". */
export function periodEndText(end: string, months: number | null = 12): string {
  const date = dateText(end);
  return date ? `${periodHeader(months)} ${date}` : end;
}

/** "to September 30, 2025" for a period, "as of September 30, 2025" for a count at a date. */
export function periodShort(end: string, months: number | null = 12): string {
  const date = dateText(end);
  if (!date) return end;
  return months === 0 ? `as of ${date}` : `to ${date}`;
}

export function valueText(
  value: number | null | undefined,
  unit: UstUnit,
  decimals: number | null,
  dash = false,
): string {
  if (value == null || !Number.isFinite(value))
    return dash ? "– (dash as published)" : NOT_RECORDED;
  const d = decimals ?? (unit === "count" ? 0 : 1);
  const body = value.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return unit === "percent" ? `${body}%` : body;
}

export type ChartRow = { end: string; label: string } & Record<
  string,
  number | string | boolean | null
>;

/** One row per period end across the series; a series with no point at an end gets null (a gap, never zero). */
export function chartRows(series: readonly TrendSeries[], mode: PeriodMode): ChartRow[] {
  const ends = new Set<string>();
  for (const s of series) for (const p of s.points) ends.add(p.end);
  const rows: ChartRow[] = [...ends].sort().map((end) => ({ end, label: periodLabel(end, mode) }));
  const index = new Map(rows.map((r) => [r.end, r]));
  for (const s of series) {
    for (const row of rows) row[s.id] = null;
    for (const p of s.points) {
      const row = index.get(p.end)!;
      row[s.id] = p.value;
      row[`${s.id}__dash`] = p.dash;
    }
  }
  return rows;
}

/**
 * First column whose published heading matches every pattern, in column order. The match is on the heading path joined
 * with " / "; returns null when no column matches, so a chart is omitted rather than pointed at the wrong column.
 */
export function findColumn(
  columns: readonly UstColumn[],
  patterns: readonly RegExp[],
): UstColumn | null {
  return columns.find((c) => patterns.every((p) => p.test(c.label))) ?? null;
}

/** Footnote groups that apply to the latest plotted period, as published. */
export function latestNotes(table: UstTable, mode: PeriodMode, months = 12): string[] {
  const idx = periodIndexes(table.periods, mode, months).at(-1);
  if (idx == null) return [];
  const group = table.notes.find((n) => n.at.includes(idx));
  return group ? group.lines : [];
}

/**
 * Footnotes the publisher attached to this court's row (col null), or to one of the given columns' headings (col = its key),
 * in the plotted window, each with the period ends it applies to. A footnote on the court's own row can change what its
 * figures mean; a column footnote applies to every court.
 */
export function marksInWindow(
  table: UstTable,
  mode: PeriodMode,
  columnKeys: readonly string[],
  months = 12,
): { text: string; col: string | null; ends: string[] }[] {
  const shown = new Set(periodIndexes(table.periods, mode, months));
  const out: { text: string; col: string | null; ends: string[] }[] = [];
  for (const m of table.marks) {
    if (m.col != null && !columnKeys.includes(m.col)) continue;
    const ends = m.at.filter((i) => shown.has(i)).map((i) => table.periods[i]!.end);
    if (!ends.length) continue;
    const hit = out.find((o) => o.text === m.text && o.col === m.col);
    if (hit) hit.ends = [...new Set([...hit.ends, ...ends])].sort();
    else out.push({ text: m.text, col: m.col, ends });
  }
  return out;
}

/** Breaks (column set, title or footnote changes) inside the plotted window, as period labels with the detail. */
export function breaksInWindow(
  table: UstTable,
  mode: PeriodMode,
  months = 12,
): { end: string; kind: string; detail: string }[] {
  const shown = new Set(periodIndexes(table.periods, mode, months));
  return table.breaks
    .filter((b) => shown.has(b.at))
    .map((b) => ({ end: table.periods[b.at]!.end, kind: b.kind, detail: b.detail }));
}
