/**
 * The house trend chart of a hub block, drawn with the shared chart primitives (src/components/charts): lines or
 * (stacked) bars, gaps left open, partial periods dashed or hatched, source markers as labelled rules. Every card that
 * shows a TrendBlockData (Analytics/Insights trends, MDL and profile cards) gets the same visual language.
 */
import { useMemo } from "react";
import { BarTrend } from "@/components/charts/BarTrend";
import { LineTrend } from "@/components/charts/LineTrend";
import type { ValueFormatter } from "@/components/charts/format";
import type { PeriodAxis, TrendSeriesInput } from "@/components/charts/series";
import {
  compareX,
  formatTick,
  formatValue,
  periodLabel,
  tickLabel,
  type TrendBlockData,
} from "@/lib/analytics/trend";
import { axisTicks, describeChart } from "./chartData";

/** Value formatter for a block's format (count, US dollars, percent). */
export function blockFormatter(block: Pick<TrendBlockData, "format">): ValueFormatter {
  return {
    full: (v) => formatValue(v, block.format),
    tick: (v) => formatTick(v, block.format),
    delta: (d) =>
      `${d > 0 ? "+" : d < 0 ? "−" : ""}${
        block.format === "pct"
          ? `${Math.abs(d).toFixed(1)} percentage points`
          : formatValue(Math.abs(d), block.format)
      }`,
  };
}

/** Period axis of a block: every period any series lists, in order; a long monthly axis labels fixed January marks. */
export function blockAxis(block: TrendBlockData): PeriodAxis {
  const keys = [...new Set(block.series.flatMap((s) => s.points.map((p) => p.x)))].sort(compareX);
  const fixed = axisTicks(block);
  const marks = fixed ? new Set(fixed) : null;
  return {
    keys,
    label: (x) => periodLabel(x, block.xKind),
    tick: (x) => tickLabel(x, block.xKind),
    ...(marks ? { showTick: (x: string) => marks.has(x) } : {}),
  };
}

export function blockSeries(block: TrendBlockData): TrendSeriesInput[] {
  return block.series.map((s) => ({
    id: s.id,
    label: s.label,
    points: s.points.map((p) => ({ key: p.x, value: p.value, partial: p.partial })),
  }));
}

export function TrendChart({ block, measure }: { block: TrendBlockData; measure: string }) {
  const axis = useMemo(() => blockAxis(block), [block]);
  const series = useMemo(() => blockSeries(block), [block]);
  const formatter = useMemo(() => blockFormatter(block), [block]);
  const annotations = block.markers.map((m) => ({ key: m.x, label: m.label }));
  const ariaLabel = describeChart(block, measure);
  return block.chart === "bar" ? (
    <BarTrend
      series={series}
      axis={axis}
      formatter={formatter}
      unit={block.unit}
      ariaLabel={ariaLabel}
      stacked={block.stacked}
      annotations={annotations}
      height={160}
    />
  ) : (
    <LineTrend
      series={series}
      axis={axis}
      formatter={formatter}
      unit={block.unit}
      ariaLabel={ariaLabel}
      annotations={annotations}
      height={160}
      directLabels={false}
    />
  );
}
