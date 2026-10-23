/**
 * Pure view logic for the Analytics trend charts: chart rows, axis ticks, the data table and the accessible
 * description. No React, so it is tested without a DOM.
 */
import {
  compareX,
  formatValue,
  markedPeriod,
  periodLabel,
  NOT_RECORDED,
  type TrendBlockData,
  type TrendPoint,
} from "@/lib/analytics/trend";

/** Series colours: design tokens only. The fourth is for the rare four-part stack. */
export const SERIES_COLORS = [
  "var(--primary)",
  "var(--warning)",
  "var(--success)",
  "var(--muted-foreground)",
] as const;

export const seriesColor = (index: number): string => SERIES_COLORS[index % SERIES_COLORS.length]!;

export type ChartRow = {
  x: string;
  partial: boolean;
  /** Value per series id; the dashed continuation of a line is under `<id>__p`. */
  [key: string]: string | number | boolean | null;
};

/** One row per period, in order. A line's partial tail is stored under `<id>__p`, joined to the last complete point. */
export function chartRows(block: TrendBlockData): ChartRow[] {
  const xs = [...new Set(block.series.flatMap((s) => s.points.map((p) => p.x)))].sort(compareX);
  const rows = new Map<string, ChartRow>(xs.map((x) => [x, { x, partial: false }] as const));
  for (const s of block.series) {
    const byX = new Map<string, TrendPoint>(s.points.map((p) => [p.x, p] as const));
    let lastComplete: { x: string; value: number } | null = null;
    for (const x of xs) {
      const p = byX.get(x);
      const row = rows.get(x)!;
      row[s.id] = p ? p.value : null;
      row[`${s.id}__p`] = null;
      if (p?.partial) row.partial = true;
      if (p && !p.partial && p.value !== null) lastComplete = { x, value: p.value };
      if (p?.partial && p.value !== null) {
        row[`${s.id}__p`] = p.value;
        // Join the dashed tail to the last complete point so the line is continuous.
        if (lastComplete) rows.get(lastComplete.x)![`${s.id}__p`] = lastComplete.value;
      }
    }
  }
  // A dashed tail is drawn for partial points only: blank the solid value there so it is not drawn twice.
  for (const s of block.series)
    if (block.chart === "line")
      for (const x of xs) {
        const p = s.points.find((q) => q.x === x);
        if (p?.partial) rows.get(x)![s.id] = null;
      }
  return xs.map((x) => rows.get(x)!);
}

/** Ticks for the x axis: undefined lets the chart choose; a long monthly axis is labelled on the first month of 5-year marks. */
export function axisTicks(block: TrendBlockData): string[] | undefined {
  if (block.xKind !== "month") return undefined;
  const xs = [...new Set(block.series.flatMap((s) => s.points.map((p) => p.x)))].sort(compareX);
  const ticks = xs.filter((x) => x.endsWith("-01") && Number(x.slice(0, 4)) % 5 === 0);
  return ticks.length ? ticks : undefined;
}

/** Periods up to this many always get a label each; a skipped label reads like a missing period. */
export const LABEL_EVERY_PERIOD_MAX = 8;

/**
 * Which x labels the chart draws: every label for a short axis or one with fixed ticks; otherwise every n-th label at a
 * regular step that fits (never an irregular subset, which hides which bar belongs to which period).
 */
export function axisInterval(block: TrendBlockData): 0 | "equidistantPreserveStart" {
  if (axisTicks(block)) return 0;
  const periods = new Set(block.series.flatMap((s) => s.points.map((p) => p.x))).size;
  return periods <= LABEL_EVERY_PERIOD_MAX ? 0 : "equidistantPreserveStart";
}

/** True when the point at `index` is recorded but both neighbours are not: a line would draw nothing for it. */
export function isolatedPoint(rows: readonly ChartRow[], index: number, key: string): boolean {
  const here = rows[index]?.[key];
  if (typeof here !== "number") return false;
  const prev = index > 0 ? rows[index - 1]?.[key] : null;
  const next = index < rows.length - 1 ? rows[index + 1]?.[key] : null;
  return typeof prev !== "number" && typeof next !== "number";
}

export type TableRow = { period: string; partial: boolean; cells: string[] };

/** The chart's values as a table, one row per period, "Not recorded" for a gap. */
export function tableRows(block: TrendBlockData): TableRow[] {
  const xs = [...new Set(block.series.flatMap((s) => s.points.map((p) => p.x)))].sort(compareX);
  return xs.map((x) => {
    const points = block.series.map((s) => s.points.find((p) => p.x === x));
    const partial = points.some((p) => p?.partial);
    return {
      period: markedPeriod(points.find((p) => p) ?? { x, value: null }, block.xKind),
      partial,
      cells: points.map((p) =>
        p && p.value !== null ? formatValue(p.value, block.format) : NOT_RECORDED,
      ),
    };
  });
}

/** Text alternative of the chart: what it counts, the period and the latest value. */
export function describeChart(block: TrendBlockData, measure: string): string {
  const series = block.series.map((s) => s.label).join(", ");
  const latest = block.latest
    ? ` Latest complete period ${block.latest.period}: ${formatValue(block.latest.value, block.format)} ${block.unit}.`
    : "";
  return `${block.chart === "bar" ? "Bar" : "Line"} chart of ${measure}, ${block.period}. Series: ${series}.${latest} The data table lists every value.`;
}

/** Tooltip text for one period of one series. */
export function tooltipValue(block: TrendBlockData, value: number | null): string {
  return value === null ? NOT_RECORDED : `${formatValue(value, block.format)} ${block.unit}`;
}

export { periodLabel };
