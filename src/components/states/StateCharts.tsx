import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import type { MetricDef, StateProfile } from "@/lib/external/stateMetrics.functions";
import { cn } from "@/lib/utils";
import { formatValue, histogram, leastSquares, type RankedValue } from "./stateMetricsMath";

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const compact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const tooltipStyle = {
  fontSize: 12,
  borderRadius: 4,
  borderColor: "var(--border)",
  backgroundColor: "var(--surface)",
};

/** Selected state against the cross-state median, interquartile bounds and (comparable) national value. */
export function TrendChart({
  def,
  state,
  years,
  bandYears,
}: {
  def: MetricDef;
  state: StateProfile | null;
  years: number[];
  /** Years whose cross-state median / percentiles may be drawn (enough states report). */
  bandYears: Set<string>;
}) {
  const comparableNational = def.format !== "int" && def.format !== "money_m";
  const rows = years.map((year) => {
    const y = String(year);
    const d = bandYears.has(y) ? def.distribution[y] : undefined;
    return {
      year: y,
      state: state?.series[def.key]?.[y] ?? null,
      median: d?.median ?? null,
      p25: d?.p25 ?? null,
      p75: d?.p75 ?? null,
      national: comparableNational ? (def.national[y] ?? null) : null,
    };
  });
  if (!rows.some((r) => r.median != null || r.state != null)) return <ChartUnavailable />;
  const hasNational = rows.some((r) => r.national != null);
  return (
    <div className="h-[240px] min-w-0 px-1 pb-1 pt-3">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart
          data={rows}
          accessibilityLayer
          margin={{ top: 3, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis width={52} tick={axis} tickLine={false} axisLine={false} tickFormatter={compact} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number, name: string) => [formatValue(value, def.format), name]}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Line
            dataKey="p75"
            name="State 75th percentile"
            stroke={FDA_COLORS[5]}
            strokeWidth={1}
            strokeDasharray="2 3"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            dataKey="median"
            name="State median"
            stroke={FDA_COLORS[5]}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            dataKey="p25"
            name="State 25th percentile"
            stroke={FDA_COLORS[5]}
            strokeWidth={1}
            strokeDasharray="2 3"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          {hasNational ? (
            <Line
              dataKey="national"
              name="United States"
              stroke={FDA_COLORS[2]}
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          ) : null}
          {state ? (
            <Line
              dataKey="state"
              name={state.name}
              stroke={FDA_COLORS[0]}
              strokeWidth={2.4}
              dot={{ r: 2 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Equal-width bins of the selected year's state values, with the median marked. */
export function HistogramChart({
  def,
  ranked,
  median,
}: {
  def: MetricDef;
  ranked: RankedValue[];
  median: number | null;
}) {
  const bins = useMemo(() => histogram(ranked.map((r) => r.value)), [ranked]);
  if (!bins.length) return <ChartUnavailable />;
  const data = bins.map((b) => ({
    label: `${formatValue(b.from, def.format)}–${formatValue(b.to, def.format)}`,
    mid: (b.from + b.to) / 2,
    count: b.count,
    hasMedian: median != null && median >= b.from && median <= b.to,
  }));
  return (
    <div className="h-[200px] min-w-0 px-1 pb-1 pt-3">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} accessibilityLayer margin={{ top: 3, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="mid"
            tick={axis}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => compact(def.format === "money_m" ? v * 1e6 : v)}
          />
          <YAxis width={28} tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(_, p) => String(p?.[0]?.payload?.label ?? "")}
            formatter={(value: number) => [`${value} states`, "Jurisdictions"]}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          />
          <Bar dataKey="count" name="States" maxBarSize={36} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.hasMedian ? FDA_COLORS[0] : FDA_COLORS[1]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One mini trend per state on a shared y-scale, sorted by the selected year's value. */
export function SmallMultiples({
  def,
  states,
  ranked,
  years,
  selected,
  onSelect,
  bandYears,
}: {
  def: MetricDef;
  states: StateProfile[];
  ranked: RankedValue[];
  years: number[];
  bandYears: Set<string>;
  selected: string | null;
  onSelect: (usps: string) => void;
}) {
  const byUsps = useMemo(() => new Map(states.map((s) => [s.usps, s])), [states]);
  const max = useMemo(() => {
    let m = 0;
    for (const s of states)
      for (const y of years) {
        const v = s.series[def.key]?.[String(y)];
        if (typeof v === "number" && v > m) m = v;
      }
    return m || 1;
  }, [states, years, def.key]);
  const order = [
    ...ranked.map((r) => r.usps),
    ...states.filter((s) => !ranked.some((r) => r.usps === s.usps)).map((s) => s.usps),
  ];
  const rankBy = new Map(ranked.map((r) => [r.usps, r]));
  const x = (i: number) => 2 + (i / Math.max(years.length - 1, 1)) * 96;
  const y = (v: number) => 30 - (Math.max(0, v) / max) * 27;
  const medianPath = years
    .map((yr, i) => {
      const m = bandYears.has(String(yr)) ? def.distribution[String(yr)]?.median : undefined;
      return m == null ? null : `${x(i).toFixed(1)},${y(m).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" L");
  if (years.length < 2)
    return <ChartUnavailable reason="At least two years are needed for trends." />;
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1.5 p-2"
      aria-label={`${def.short} trend for each state`}
    >
      {order.map((usps) => {
        const s = byUsps.get(usps)!;
        const r = rankBy.get(usps);
        const segments: string[] = [];
        let path = "";
        years.forEach((yr, i) => {
          const v = s.series[def.key]?.[String(yr)];
          if (typeof v !== "number") {
            if (path) segments.push(path);
            path = "";
            return;
          }
          path += `${path ? " L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        });
        if (path) segments.push(path);
        return (
          <li key={usps}>
            <button
              type="button"
              onClick={() => onSelect(usps)}
              aria-pressed={selected === usps}
              title={`${s.name}: ${formatValue(r?.value, def.format)}${r ? ` · rank ${r.rank}` : ""}`}
              className={cn(
                "w-full rounded border bg-surface px-1.5 pb-1 pt-1 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
                selected === usps
                  ? "border-primary ring-1 ring-primary/30"
                  : r?.outlier
                    ? "border-warning"
                    : "border-border",
              )}
            >
              <span className="flex items-baseline justify-between gap-1 text-[10.5px]">
                <span className="font-semibold">{usps}</span>
                <span className="truncate font-mono text-muted-foreground">
                  {r ? formatValue(r.value, def.format) : "—"}
                </span>
              </span>
              <svg viewBox="0 0 100 32" className="mt-0.5 h-7 w-full" aria-hidden>
                {medianPath ? (
                  <path
                    d={`M${medianPath}`}
                    fill="none"
                    stroke={FDA_COLORS[5]}
                    strokeWidth="1"
                    strokeDasharray="3 2"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {segments.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={r?.outlier ? "var(--warning)" : FDA_COLORS[0]}
                    strokeWidth="1.6"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export type ScatterPoint = { usps: string; name: string; x: number; y: number };

/** Scatter of two metrics in one year with the least-squares line; the selected state is emphasised. */
export function StateScatter({
  points,
  xDef,
  yDef,
  selected,
  onSelect,
}: {
  points: ScatterPoint[];
  xDef: MetricDef;
  yDef: MetricDef;
  selected: string | null;
  onSelect: (usps: string) => void;
}) {
  const fit = leastSquares(points.map((p) => [p.x, p.y]));
  if (points.length < 3)
    return <ChartUnavailable reason="Fewer than three states report both metrics for this year." />;
  const xs = points.map((p) => p.x);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const others = points.filter((p) => p.usps !== selected);
  const focus = points.filter((p) => p.usps === selected);
  return (
    <div className="h-[300px] min-w-0 px-1 pb-1 pt-3">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ScatterChart margin={{ top: 6, right: 16, bottom: 18, left: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name={xDef.short}
            domain={["auto", "auto"]}
            tick={axis}
            tickLine={false}
            tickFormatter={(v: number) => compact(xDef.format === "money_m" ? v * 1e6 : v)}
            label={{ value: xDef.short, position: "insideBottom", offset: -10, fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yDef.short}
            domain={["auto", "auto"]}
            width={52}
            tick={axis}
            tickLine={false}
            tickFormatter={(v: number) => compact(yDef.format === "money_m" ? v * 1e6 : v)}
            label={{ value: yDef.short, angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={tooltipStyle}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as ScatterPoint | undefined;
              if (!p) return null;
              return (
                <div className="rounded border border-border bg-surface px-2 py-1 text-[11px] shadow-sm">
                  <div className="font-semibold">{p.name}</div>
                  <div>
                    {xDef.short}: {formatValue(p.x, xDef.format)}
                  </div>
                  <div>
                    {yDef.short}: {formatValue(p.y, yDef.format)}
                  </div>
                </div>
              );
            }}
          />
          {fit ? (
            <ReferenceLine
              segment={[
                { x: x0, y: fit.intercept + fit.slope * x0 },
                { x: x1, y: fit.intercept + fit.slope * x1 },
              ]}
              stroke={FDA_COLORS[2]}
              strokeDasharray="5 3"
              ifOverflow="hidden"
            />
          ) : null}
          <Scatter
            data={others}
            fill={FDA_COLORS[1]}
            fillOpacity={0.75}
            isAnimationActive={false}
            onClick={(d: { payload?: ScatterPoint }) => d.payload && onSelect(d.payload.usps)}
            cursor="pointer"
          />
          <Scatter
            data={focus}
            fill={FDA_COLORS[0]}
            isAnimationActive={false}
            shape="diamond"
            legendType="none"
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
