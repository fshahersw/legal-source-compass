import type { ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { axis } from "@/components/courts/courtStatsData";
import { fmtDec, fmtInt, tick } from "./clbFormat";

const MARGIN = { top: 6, right: 8, bottom: 0, left: 0 };
const GRID = { stroke: "var(--border)", vertical: false, strokeDasharray: "3 3" } as const;
const LEGEND = { fontSize: 11 } as const;
const CURSOR = { fill: "var(--muted)", opacity: 0.45 } as const;

export type YearPoint = { label: string; bar: number; line?: number | null };

function Tip({
  barName,
  lineName,
  lineUnit,
  ...props
}: TooltipProps<number, string> & {
  barName: string;
  lineName?: string | undefined;
  lineUnit?: string | undefined;
}): ReactNode {
  if (!props.active || !props.payload?.length) return null;
  const r = props.payload[0]?.payload as YearPoint | undefined;
  if (!r) return null;
  return (
    <div className="rounded border border-border bg-surface px-2 py-1.5 text-xs shadow-sm">
      <p className="mb-0.5 font-semibold">{r.label}</p>
      <p className="flex justify-between gap-4 tabular-nums">
        <span className="text-muted-foreground">{barName}</span>
        <span className="font-mono">{fmtInt(r.bar)}</span>
      </p>
      {lineName ? (
        <p className="flex justify-between gap-4 tabular-nums">
          <span className="text-muted-foreground">{lineName}</span>
          <span className="font-mono">
            {r.line == null
              ? "Not recorded"
              : `${fmtDec(r.line, 0)}${lineUnit ? ` ${lineUnit}` : ""}`}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Counts per year as bars and, optionally, a median per year as a line on its own axis. A year whose median is not shown
 * (too few cases) leaves a gap in the line rather than an invented value.
 */
export function YearBarLine({
  rows,
  barName,
  lineName,
  lineUnit,
}: {
  rows: readonly YearPoint[];
  barName: string;
  lineName?: string | undefined;
  lineUnit?: string | undefined;
}) {
  const hasLine = !!lineName && rows.some((r) => r.line != null);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows as YearPoint[]} margin={MARGIN} barCategoryGap={2}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="label"
          tick={axis}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="bar"
          tick={axis}
          tickFormatter={tick}
          width={42}
          tickLine={false}
          axisLine={false}
        />
        {hasLine ? (
          <YAxis
            yAxisId="line"
            orientation="right"
            tick={axis}
            tickFormatter={tick}
            width={38}
            tickLine={false}
            axisLine={false}
          />
        ) : null}
        <Tooltip
          content={
            <Tip barName={barName} lineName={hasLine ? lineName : undefined} lineUnit={lineUnit} />
          }
          cursor={CURSOR}
        />
        {hasLine ? <Legend wrapperStyle={LEGEND} iconSize={8} /> : null}
        <Bar
          yAxisId="bar"
          dataKey="bar"
          name={barName}
          fill={FDA_COLORS[0]}
          isAnimationActive={false}
        />
        {hasLine ? (
          <Line
            yAxisId="line"
            dataKey="line"
            name={lineName}
            stroke={FDA_COLORS[2]}
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
