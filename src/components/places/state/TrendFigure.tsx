import { InfoPopover } from "@/components/kit/InfoPopover";
import { useId } from "react";
import {
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
import { NOT_RECORDED } from "@/lib/external/censusModel";

export type FigureSeries = { id: string; label: string; tone: "primary" | "ring" | "muted" };
export type FigureRow = { x: number } & Record<string, number | null>;

const TONE: Record<FigureSeries["tone"], { stroke: string; dash?: string }> = {
  // Blue and orange: distinct in both themes and for common colour-vision differences.
  primary: { stroke: "var(--status-info)" },
  ring: { stroke: "var(--status-serious)" },
  muted: { stroke: "var(--muted-foreground)", dash: "5 3" },
};

/**
 * A trend chart for a count or rate by year, with what is counted, the unit, the period and the source stated, the same
 * numbers as a table, and a "how to read this" note. A year with no value is a gap in the line, never a zero.
 */
export function TrendFigure({
  title,
  unit,
  period,
  source,
  series,
  rows,
  format,
  xLabel,
  how,
  note,
  height = 200,
}: {
  title: string;
  unit: string;
  period: string;
  source: { label: string; href: string | null };
  series: FigureSeries[];
  rows: FigureRow[];
  format: (v: number) => string;
  xLabel: string;
  how: Measure[];
  note?: string | undefined;
  height?: number;
}) {
  const id = useId();
  const populated = rows.some((r) => series.some((s) => r[s.id] != null));
  const tick = (v: number) =>
    Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : v.toLocaleString("en-US");
  const tip = ({
    active,
    label,
    payload,
  }: {
    active?: boolean;
    label?: number | string;
    payload?: { payload?: FigureRow }[];
  }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]!.payload;
    return (
      <div className="rounded border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md">
        <div className="font-semibold">
          {xLabel} {label}
        </div>
        {series.map((s) => {
          const v = row?.[s.id];
          return (
            <div key={s.id} className="flex justify-between gap-3">
              <span style={{ color: TONE[s.tone].stroke }}>{s.label}</span>
              <span className="font-mono tabular-nums">
                {typeof v === "number" ? format(v) : NOT_RECORDED}
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
        <h4 id={`${id}-t`} className="m-0 text-[13px] font-semibold leading-5">
          {title}
        </h4>
        <p className="m-0 text-[11px] leading-4 text-muted-foreground">
          {unit} · {period}
        </p>
      </figcaption>
      {populated ? (
        <div className="px-1 pt-2" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 6, right: 14, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="x" tick={axisTick} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={axisTick} tickFormatter={tick} width={46} domain={[0, "auto"]} />
              <Tooltip content={tip as never} contentStyle={tooltipStyle} />
              {series.map((s) => (
                <Line
                  key={s.id}
                  dataKey={s.id}
                  name={s.label}
                  stroke={TONE[s.tone].stroke}
                  strokeDasharray={TONE[s.tone].dash}
                  strokeWidth={s.tone === "primary" ? 2 : 1.5}
                  dot={{ r: 2.5, strokeWidth: 0, fill: TONE[s.tone].stroke }}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p role="status" className="m-0 px-3 py-10 text-center text-xs text-muted-foreground">
          {NOT_RECORDED}: the source records no complete year for this series.
        </p>
      )}
      {series.length > 1 ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 px-3 pb-2 pt-1 text-[11px] text-muted-foreground">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <svg width="18" height="8" aria-hidden>
                <line
                  x1="0"
                  y1="4"
                  x2="18"
                  y2="4"
                  stroke={TONE[s.tone].stroke}
                  strokeWidth="2"
                  strokeDasharray={TONE[s.tone].dash}
                />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-1.5 border-t border-border/60 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <span>{note ?? period}</span>
          <InfoPopover label="Source and notes">
            <p>
              {source.href ? (
                <SourceLink href={source.href}>{source.label}</SourceLink>
              ) : (
                source.label
              )}
            </p>
          </InfoPopover>
        </div>
        <details className="rounded-md border border-border/70 bg-surface">
          <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/40">
            Show data
          </summary>
          <div className="max-h-56 overflow-auto border-t border-border/60">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1 font-medium">
                    {xLabel}
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
                  <tr key={r.x} className="border-t border-border/50">
                    <th scope="row" className="px-2 py-0.5 text-left font-normal tabular-nums">
                      {r.x}
                    </th>
                    {series.map((s) => {
                      const v = r[s.id];
                      return (
                        <td key={s.id} className="px-2 py-0.5 text-right font-mono tabular-nums">
                          {typeof v === "number" ? format(v) : NOT_RECORDED}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <HowToRead measures={how} title="How to read this" className="text-foreground" />
      </div>
    </figure>
  );
}
