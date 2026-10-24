import { useId, type ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartCard as BaseChartCard,
  type ChartSource,
  type KpiItem,
  type TableSpec,
} from "@/components/charts/ChartCard";
import {
  chartDateLabel,
  FDA_COLORS,
  numberLabel,
  timelineRows,
  type ChartPoint,
  type ChartSeries,
  type FacetBar,
} from "./chartView";
const compact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const axis = { fontSize: 12, fill: "var(--muted-foreground)" };

/**
 * Card around a chart: the shared ChartCard look (takeaway title, measure subtitle, footer line), with an optional
 * source-and-coverage button in the header. Kept for the many callers of this API.
 */
export function ChartCard({
  title,
  subtitle,
  children,
  onSource,
  className = "",
  footnote,
  id,
  kpis,
  table,
  about,
  sources,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  onSource?: (() => void) | undefined;
  className?: string;
  footnote?: ReactNode;
  /** Anchor target for in-page links such as "Key takeaways". */
  id?: string | undefined;
  kpis?: readonly KpiItem[] | undefined;
  table?: TableSpec | undefined;
  about?: ReactNode;
  sources?: readonly ChartSource[] | undefined;
}) {
  return (
    <BaseChartCard
      title={title}
      subtitle={subtitle}
      id={id}
      className={className}
      padded={false}
      kpis={kpis}
      table={table}
      about={about}
      sources={sources}
      footer={footnote}
      actions={
        onSource ? (
          <button
            type="button"
            className="-my-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={`Source and coverage for ${title}`}
            onClick={onSource}
          >
            <Info className="size-4" aria-hidden />
          </button>
        ) : undefined
      }
    >
      {children}
    </BaseChartCard>
  );
}

export function ChartUnavailable({
  reason = "No verified series is available for this window.",
}: {
  reason?: string | undefined;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="text-sm font-medium text-muted-foreground">Not available</span>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">{reason}</p>
    </div>
  );
}

export function TimelineChart({
  series,
  unit,
  stacked = false,
}: {
  series: ChartSeries[];
  unit: string;
  stacked?: boolean;
}) {
  const rows = timelineRows(series);
  const hasValue = series.some((line) => line.points.some((point) => point.value !== null));
  if (!hasValue) return <ChartUnavailable />;
  const spansYears =
    String(rows[0]?.["date"]).slice(0, 4) !== String(rows.at(-1)?.["date"]).slice(0, 4);
  const axes = [
    <CartesianGrid key="grid" vertical={false} stroke="var(--border)" strokeDasharray="3 3" />,
    <XAxis
      key="x"
      dataKey="date"
      minTickGap={32}
      tick={axis}
      tickLine={false}
      axisLine={false}
      tickFormatter={(value: string) => (spansYears ? chartDateLabel(value) : value.slice(5))}
    />,
    <YAxis
      key="y"
      width={48}
      tick={axis}
      tickLine={false}
      axisLine={false}
      tickFormatter={compact}
      allowDecimals={false}
    />,
    <Tooltip
      key="tooltip"
      contentStyle={{
        fontSize: 12,
        borderRadius: 4,
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
      formatter={(value: number, name: string, item) => [
        numberLabel(value),
        `${name}${item.payload?.[`${item.dataKey}__partial`] ? " (partial bucket)" : ""}`,
      ]}
      labelFormatter={(label, payload) => {
        const item = payload[0];
        const end = item?.payload?.[`${item.dataKey}__end`];
        return `${label}${end && end !== label ? ` – ${end}` : ""} · ${unit}`;
      }}
    />,
    <Legend key="legend" iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />,
  ];
  return (
    <div
      className="h-[240px] min-w-0 px-1 pb-1 pt-3"
      aria-label={`${unit} by date; arrow keys explore recorded points`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {stacked ? (
          <BarChart
            data={rows}
            accessibilityLayer
            margin={{ top: 3, right: 12, left: 0, bottom: 0 }}
          >
            {axes}
            {series.map((line, i) => (
              <Bar
                key={line.id}
                dataKey={line.id}
                name={line.label}
                stackId="records"
                fill={line.color ?? FDA_COLORS[i % FDA_COLORS.length]}
                isAnimationActive={false}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart
            data={rows}
            accessibilityLayer
            margin={{ top: 3, right: 12, left: 0, bottom: 0 }}
          >
            {axes}
            {series.map((line, i) => (
              <Line
                key={line.id}
                dataKey={line.id}
                name={line.label}
                stroke={line.color ?? FDA_COLORS[i % FDA_COLORS.length]}
                strokeWidth={2}
                strokeDasharray={i === 2 ? "5 3" : undefined}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                type="linear"
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function DistributionChart({
  bars,
  unit,
  color = FDA_COLORS[1]!,
  height = 240,
}: {
  bars: FacetBar[];
  unit: string;
  color?: string | undefined;
  height?: number;
}) {
  if (!bars.length)
    return <ChartUnavailable reason="No facet counts are recorded for this selected window." />;
  return (
    <div
      className="min-w-0 px-1 py-2"
      style={{ height }}
      aria-label={`${unit} by recorded category`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart
          data={bars}
          layout="vertical"
          accessibilityLayer
          margin={{ left: 0, right: 18, top: 0, bottom: 0 }}
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            tick={axis}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickFormatter={compact}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={125}
            tick={{ ...axis, width: 120 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: string) =>
              value.length > 20 ? `${value.slice(0, 19)}…` : value
            }
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              maxWidth: 300,
              whiteSpace: "normal",
              borderRadius: 4,
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
            }}
            formatter={(value: number, _name, item) => [
              `${numberLabel(value)}${typeof item.payload?.percent === "number" ? ` · ${item.payload.percent.toLocaleString("en-US", { maximumFractionDigits: 1 })}% of matching records` : ""}`,
              unit,
            ]}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          />
          <Bar dataKey="value" name={unit} fill={color} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GroupedDistributionChart({
  groups,
  categories,
  unit,
}: {
  groups: Array<{ label: string; [key: string]: string | number | null }>;
  categories: Array<{ id: string; label: string }>;
  unit: string;
}) {
  if (!groups.length) return <ChartUnavailable />;
  return (
    <div
      className="h-[240px] min-w-0 px-1 pb-1 pt-3"
      aria-label={`${unit} by classification and product family`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart
          data={groups}
          accessibilityLayer
          margin={{ top: 3, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
          <YAxis
            width={48}
            tick={axis}
            tickFormatter={compact}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 4, backgroundColor: "var(--surface)" }}
            formatter={(value: number, name: string) => [numberLabel(value), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {categories.map((category, i) => (
            <Bar
              key={category.id}
              dataKey={category.id}
              name={category.label}
              stackId="classification"
              fill={FDA_COLORS[i % FDA_COLORS.length]}
              maxBarSize={54}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({
  points,
  color = FDA_COLORS[1]!,
}: {
  points: ChartPoint[];
  color?: string | undefined;
}) {
  const titleId = useId();
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  if (!values.length)
    return <div className="h-6 border-b border-dashed border-border" aria-hidden />;
  const max = Math.max(...values, 1);
  const paths: string[] = [];
  let path = "";
  points.forEach((point, index) => {
    if (point.value === null) {
      if (path) paths.push(path);
      path = "";
      return;
    }
    const x = 2 + (index / Math.max(points.length - 1, 1)) * 156;
    const y = 33 - (point.value / max) * 29;
    path += `${path ? " L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  if (path) paths.push(path);
  return (
    <svg viewBox="0 0 160 36" className="h-6 w-full" role="img" aria-labelledby={titleId}>
      <title id={titleId}>Selected-window trend; missing observations break the line</title>
      {paths.map((segment, i) => (
        <path
          key={i}
          d={segment}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
