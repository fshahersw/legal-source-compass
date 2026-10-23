import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatTick, periodLabel, tickLabel, type TrendBlockData } from "@/lib/analytics/trend";
import {
  axisTicks,
  chartRows,
  describeChart,
  isolatedPoint,
  seriesColor,
  tooltipValue,
  type ChartRow,
} from "./chartData";

const axisTick = { fontSize: 10, fill: "var(--muted-foreground)" } as const;
const MARGIN = { top: 14, right: 8, bottom: 0, left: 0 } as const;

function TrendTooltip({
  active,
  payload,
  block,
}: {
  active?: boolean | undefined;
  payload?: { payload?: ChartRow }[] | undefined;
  block: TrendBlockData;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] shadow-sm">
      <p className="font-semibold">
        {periodLabel(row.x, block.xKind)}
        {row.partial ? " (partial)" : ""}
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {block.series.map((s, i) => {
          const raw = row[s.id] ?? row[`${s.id}__p`];
          const value = typeof raw === "number" ? raw : null;
          return (
            <li key={s.id} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2 shrink-0 rounded-[2px]"
                style={{ background: seriesColor(i) }}
              />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="ml-auto pl-3 font-mono tabular-nums">
                {tooltipValue(block, value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Line or bar chart of one block: tokens only, gaps left open, partial periods dashed or faded. */
export function TrendChart({ block, measure }: { block: TrendBlockData; measure: string }) {
  const rows = useMemo(() => chartRows(block), [block]);
  const ticks = useMemo(() => axisTicks(block), [block]);
  const xAxis = (
    <XAxis
      dataKey="x"
      tick={axisTick}
      tickFormatter={(x: string) => tickLabel(x, block.xKind)}
      tickLine={false}
      axisLine={{ stroke: "var(--border)" }}
      interval={ticks ? 0 : "preserveStartEnd"}
      minTickGap={14}
      {...(ticks ? { ticks } : {})}
    />
  );
  const yAxis = (
    <YAxis
      tick={axisTick}
      tickFormatter={(v: number) => formatTick(v, block.format)}
      tickLine={false}
      axisLine={false}
      width={42}
      allowDecimals={false}
    />
  );
  const grid = <CartesianGrid stroke="var(--border)" vertical={false} />;
  const tooltip = (
    <Tooltip
      cursor={{ stroke: "var(--border-strong)", fill: "var(--muted)", fillOpacity: 0.5 }}
      content={(props) => (
        <TrendTooltip
          block={block}
          active={props.active}
          payload={props.payload as unknown as { payload?: ChartRow }[]}
        />
      )}
    />
  );
  const markers = block.markers.map((m) => (
    <ReferenceLine
      key={m.x}
      x={m.x}
      stroke="var(--muted-foreground)"
      strokeDasharray="3 3"
      label={{
        value: m.label,
        position: "insideTopLeft",
        fontSize: 10,
        fill: "var(--muted-foreground)",
      }}
    />
  ));
  return (
    <div role="img" aria-label={describeChart(block, measure)} className="h-40 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        {block.chart === "bar" ? (
          <BarChart data={rows} margin={MARGIN} barGap={1} barCategoryGap="14%">
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            {markers}
            {block.series.map((s, i) => (
              <Bar
                key={s.id}
                dataKey={s.id}
                name={s.label}
                {...(block.stacked ? { stackId: "parts" } : {})}
                fill={seriesColor(i)}
                isAnimationActive={false}
                maxBarSize={block.stacked ? 18 : 12}
              >
                {rows.map((r) => (
                  <Cell
                    key={r.x}
                    fill={seriesColor(i)}
                    fillOpacity={r.partial ? 0.4 : 1}
                    {...(r.partial
                      ? { stroke: seriesColor(i), strokeDasharray: "3 2" }
                      : { stroke: "none" })}
                  />
                ))}
              </Bar>
            ))}
          </BarChart>
        ) : (
          <LineChart data={rows} margin={MARGIN}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            {markers}
            {block.series.flatMap((s, i) => {
              const color = seriesColor(i);
              const dot = (key: string) =>
                function Dot(props: { cx?: number; cy?: number; index?: number }) {
                  return props.cx !== undefined &&
                    props.cy !== undefined &&
                    props.index !== undefined &&
                    isolatedPoint(rows, props.index, key) ? (
                    <circle key={props.index} cx={props.cx} cy={props.cy} r={2} fill={color} />
                  ) : (
                    <g key={props.index} />
                  );
                };
              return [
                <Line
                  key={s.id}
                  type="linear"
                  dataKey={s.id}
                  name={s.label}
                  stroke={color}
                  strokeWidth={1.75}
                  dot={dot(s.id)}
                  activeDot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />,
                <Line
                  key={`${s.id}__p`}
                  type="linear"
                  dataKey={`${s.id}__p`}
                  name={`${s.label} (partial)`}
                  stroke={color}
                  strokeWidth={1.75}
                  strokeDasharray="4 3"
                  dot={dot(`${s.id}__p`)}
                  activeDot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />,
              ];
            })}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
