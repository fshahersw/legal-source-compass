/**
 * Adapter from an analytics trend block (`getAnalyticsBlock`, src/lib/analytics/trend.ts) to the themed charts: rows,
 * series specs, formatters, a takeaway title computed from the primary series and the table view. Pure, client-safe.
 *
 *   const c = blockChart(block, def);
 *   <ChartCard title={c.title} subtitle={c.subtitle} table={c.table} sources={[c.source]} ...>
 *     <TrendLines rows={c.rows} xKey="x" series={c.series} format={c.format} ... />
 */
import {
  formatTick,
  formatValue,
  periodLabel,
  summarizeLatest,
  tickLabel,
  type TrendBlockData,
} from "@/lib/analytics/trend";
import type { TableSpec } from "../ChartCard";
import { trendTakeaway, type TakeawayPoint } from "../takeaway";
import type { ChartSeriesSpec } from "./charts";
import { periodTable } from "./tables";

export const PARTIAL_KEY = "__partial";

export type BlockChart = {
  rows: Record<string, unknown>[];
  xKey: "x";
  series: ChartSeriesSpec[];
  partialKey: string;
  format: (v: number) => string;
  tick: (v: number) => string;
  xTick: (x: string) => string;
  tooltipTitle: (x: string) => string;
  /** Takeaway computed from the primary series; the block title when none is reliable. */
  title: string;
  subtitle: string;
  table: TableSpec;
  source: { label: string; url: string };
  /** Primary series points, complete periods only compared. */
  points: TakeawayPoint[];
  /** Latest-value line with its change, when the block states one. */
  latest: { label: string; value: string; change: string | null } | null;
  hasPartial: boolean;
};

/**
 * Rows keyed by period (`x`), one column per series, `__partial` true when any series marks the period partial.
 * `def` supplies the block's own title and measure (registry.ts); the subject of the takeaway is the primary series'
 * label unless `subject` is given.
 */
export function blockChart(
  data: TrendBlockData,
  def: { title: string; measure: string },
  subject?: string,
): BlockChart {
  const xs: string[] = [];
  const seen = new Set<string>();
  for (const s of data.series)
    for (const p of s.points)
      if (!seen.has(p.x)) {
        seen.add(p.x);
        xs.push(p.x);
      }
  const order = (a: string, b: string) =>
    /^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b);
  xs.sort(order);
  const rows = xs.map((x) => {
    const row: Record<string, unknown> = { x };
    let partial = false;
    for (const s of data.series) {
      const p = s.points.find((q) => q.x === x);
      row[s.id] = p && typeof p.value === "number" ? p.value : null;
      if (p?.partial) partial = true;
    }
    row[PARTIAL_KEY] = partial;
    return row;
  });
  const series: ChartSeriesSpec[] = data.series.map((s) => ({ key: s.id, label: s.label }));
  const format = (v: number) => formatValue(v, data.format);
  const tick = (v: number) => formatTick(v, data.format).replace(/k$/, "K");
  const primary = data.series[data.primary] ?? data.series[0];
  // A stack is read by its totals (a period's total only when every part is recorded); otherwise the primary series.
  const totalSeries =
    data.stacked && data.series.length > 1
      ? {
          id: "__total",
          label: "Total",
          points: rows.map((r) => {
            const vals = data.series.map((s) => r[s.id]);
            return {
              x: String(r["x"]),
              value: vals.every((v) => typeof v === "number")
                ? (vals as number[]).reduce((a, v) => a + v, 0)
                : null,
              partial: Boolean(r[PARTIAL_KEY]),
            };
          }),
        }
      : null;
  const read = totalSeries ?? primary;
  const points: TakeawayPoint[] = read
    ? read.points.map((p) => ({
        label: periodLabel(p.x, data.xKind),
        value: p.value,
        partial: p.partial,
      }))
    : [];
  const takeaway = trendTakeaway(
    subject ?? subjectOf(def.measure, primary?.label, data),
    points,
    format,
  );
  const latestSummary = read ? summarizeLatest(read, data.xKind) : data.latest;
  const latest = latestSummary
    ? {
        label: latestSummary.period,
        value: format(latestSummary.value),
        change: latestSummary.change
          ? `${latestSummary.change.absolute > 0 ? "+" : latestSummary.change.absolute < 0 ? "−" : "±"}${format(Math.abs(latestSummary.change.absolute))}${latestSummary.change.percent !== null ? ` (${latestSummary.change.percent > 0 ? "+" : latestSummary.change.percent < 0 ? "−" : ""}${Math.abs(latestSummary.change.percent).toFixed(1)}%)` : ""} vs ${latestSummary.change.comparedWith}`
          : null,
      }
    : null;
  const hasPartial = rows.some((r) => r[PARTIAL_KEY]);
  return {
    rows,
    xKey: "x",
    series,
    partialKey: PARTIAL_KEY,
    format,
    tick,
    xTick: (x: string) => tickLabel(x, data.xKind),
    tooltipTitle: (x: string) => periodLabel(x, data.xKind),
    title: takeaway ?? def.title,
    subtitle: `${capitalize(data.unit)} · ${data.period}${hasPartial ? " · * partial period" : ""}`,
    table: periodTable(
      rows.map((r) => ({ ...r, x: periodLabel(String(r["x"]), data.xKind) })),
      "x",
      series,
      format,
      { caption: def.title, xLabel: "Period", partialKey: PARTIAL_KEY },
    ),
    source: data.source,
    points,
    latest,
    hasPartial,
  };
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Subject of a block's takeaway: the measure ("CPSC recalls"); for several unstacked series whose primary label is a
 * verb such as "Filed", the measure and that verb ("Civil cases filed"); otherwise the primary series' own label.
 */
export function subjectOf(
  measure: string,
  primaryLabel: string | undefined,
  data: Pick<TrendBlockData, "series" | "stacked">,
): string {
  if (data.series.length <= 1 || data.stacked || !primaryLabel) return capitalize(measure);
  const l = primaryLabel.trim();
  if (/^[A-Za-z]+ed$/.test(l)) return `${capitalize(measure)} ${l.toLowerCase()}`;
  return l;
}
