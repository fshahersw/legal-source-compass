import { useId, type ReactNode } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { axisTick, SourceLink, tooltipStyle } from "@/components/enforcement/parts";
import {
  formatCensus,
  formatMoe,
  NOT_RECORDED,
  type CensusFormat,
  type TrendPoint,
} from "@/lib/external/censusModel";
import type { ChartRow } from "./censusView";

type SeriesRef = { id: string; label: string };

/** Series colours come from tokens: the area in the primary colour, its state in the ring colour, the nation muted. */
const SERIES_STYLE: Record<string, { stroke: string; dash?: string }> = {
  area: { stroke: "var(--primary)" },
  state: { stroke: "var(--ring)" },
  us: { stroke: "var(--muted-foreground)", dash: "5 3" },
  v2025: { stroke: "var(--primary)" },
  v2019: { stroke: "var(--ring)" },
};
const styleOf = (id: string) => SERIES_STYLE[id] ?? { stroke: "var(--primary)" };

/** Compact trend line for a key-figure tile. A year with no published value breaks the line; it is never drawn as zero. */
export function Spark({ points, label }: { points: TrendPoint[]; label: string }) {
  const values = points.map((p) => p.value);
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return <span className="h-6 w-20 shrink-0" aria-hidden />;
  const min = Math.min(...nums);
  const span = Math.max(...nums) - min || 1;
  const x = (i: number) => 2 + (i / Math.max(values.length - 1, 1)) * 76;
  const y = (v: number) => 22 - ((v - min) / span) * 18;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? " L" : " M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  const first = points.find((p) => p.value != null)!;
  const last = [...points].reverse().find((p) => p.value != null)!;
  return (
    <svg
      viewBox="0 0 80 26"
      className="h-6 w-20 shrink-0"
      role="img"
      aria-label={`${label}: ${first.year} to ${last.year}`}
    >
      <path
        d={d.trim()}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      {values.map((v, i) =>
        v != null &&
        (values[i - 1] == null || i === 0) &&
        (values[i + 1] == null || i === values.length - 1) ? (
          <circle key={i} cx={x(i)} cy={y(v)} r="1.6" fill="var(--primary)" />
        ) : null,
      )}
    </svg>
  );
}

type TipProps = {
  active?: boolean;
  label?: number | string;
  payload?: { dataKey?: string; value?: number | [number, number] | null; payload?: ChartRow }[];
};

/**
 * Trend of one measure across releases for an area and its comparators. The shaded band is each release's published
 * margin of error. The chart states what is counted, the unit, the period and the source, offers the same numbers as a
 * table, and explains what a reader should not read into it.
 */
export function TrendChart({
  title,
  unit,
  format,
  series,
  rows,
  period,
  source,
  how,
  height = 210,
  band = true,
}: {
  title: string;
  unit: string;
  format: CensusFormat;
  series: SeriesRef[];
  rows: ChartRow[];
  period: string;
  source: { label: string; href: string };
  how: Measure[];
  height?: number;
  /** Whether the series carry a published margin of error (the shaded band). Population estimates have none. */
  band?: boolean;
}) {
  const id = useId();
  const populated = rows.some((r) => series.some((s) => r[s.id] != null));
  const tick = (v: number) =>
    format === "pct"
      ? `${v}%`
      : format === "dollars"
        ? `$${Math.round(v / 1000)}k`
        : formatCensus(v, format);
  const tip = ({ active, label, payload }: TipProps) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]!.payload;
    return (
      <div className="rounded border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md">
        <div className="font-semibold">{label} release</div>
        {series.map((s) => {
          const v = row?.[s.id];
          const moe = row?.[`${s.id}_moe`];
          return (
            <div key={s.id} className="flex justify-between gap-3">
              <span style={{ color: styleOf(s.id).stroke }}>{s.label}</span>
              <span className="font-mono tabular-nums">
                {typeof v === "number" ? formatCensus(v, format) : NOT_RECORDED}
                {typeof moe === "number" ? ` ${formatMoe({ moe, note: null }, format)}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <figure
      className="m-0 min-w-0 rounded-md border border-border bg-surface"
      aria-labelledby={`${id}-t`}
    >
      <figcaption className="border-b border-border/70 px-3 py-2">
        <h4 id={`${id}-t`} className="text-[13px] font-semibold leading-5">
          {title}
        </h4>
        <p className="m-0 text-[11px] leading-4 text-muted-foreground">
          {unit} · {period}
          {band ? " · shaded band: margin of error" : ""}
        </p>
      </figcaption>
      {populated ? (
        <div className="px-1 pt-2" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 6, right: 14, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="year" tick={axisTick} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={axisTick} tickFormatter={tick} width={48} domain={["auto", "auto"]} />
              <Tooltip content={tip as never} contentStyle={tooltipStyle} />
              {(band ? series : []).map((s) => (
                <Area
                  key={`${s.id}-band`}
                  dataKey={`${s.id}_band`}
                  stroke="none"
                  fill={styleOf(s.id).stroke}
                  fillOpacity={0.14}
                  connectNulls={false}
                  isAnimationActive={false}
                  legendType="none"
                  tooltipType="none"
                />
              ))}
              {series.map((s) => (
                <Line
                  key={s.id}
                  dataKey={s.id}
                  name={s.label}
                  stroke={styleOf(s.id).stroke}
                  strokeWidth={s.id === "area" ? 2 : 1.5}
                  strokeDasharray={styleOf(s.id).dash}
                  dot={{ r: 2.5, strokeWidth: 0, fill: styleOf(s.id).stroke }}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p role="status" className="px-3 py-10 text-center text-xs text-muted-foreground">
          {NOT_RECORDED}: the Census Bureau published no value for this measure and area.
        </p>
      )}
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 px-3 pb-2 pt-1 text-[11px] text-muted-foreground">
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden>
              <line
                x1="0"
                y1="4"
                x2="18"
                y2="4"
                stroke={styleOf(s.id).stroke}
                strokeWidth="2"
                strokeDasharray={styleOf(s.id).dash}
              />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <div className="space-y-1.5 border-t border-border/60 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
        <div>
          Source: <SourceLink href={source.href}>{source.label}</SourceLink>
        </div>
        <ShowData series={series} rows={rows} format={format} />
        <HowToRead measures={how} title="How to read this" className="text-foreground" />
      </div>
    </figure>
  );
}

/** The chart's numbers as a table (the accessible alternative), with margins of error. */
export function ShowData({
  series,
  rows,
  format,
}: {
  series: SeriesRef[];
  rows: ChartRow[];
  format: CensusFormat;
}): ReactNode {
  return (
    <details className="rounded-md border border-border/70 bg-surface">
      <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/40">
        Show data
      </summary>
      <div className="overflow-x-auto border-t border-border/60">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1 font-medium">
                Release
              </th>
              {series.map((s) => (
                <th key={s.id} scope="col" className="px-2 py-1 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-t border-border/50">
                <th scope="row" className="px-2 py-0.5 text-left font-normal tabular-nums">
                  {r.year}
                </th>
                {series.map((s) => {
                  const v = r[s.id];
                  const moe = r[`${s.id}_moe`];
                  return (
                    <td key={s.id} className="px-2 py-0.5 text-right font-mono tabular-nums">
                      {typeof v === "number" ? formatCensus(v, format) : NOT_RECORDED}
                      {typeof moe === "number" ? (
                        <span className="text-muted-foreground">
                          {" "}
                          {formatMoe({ moe, note: null }, format)}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
