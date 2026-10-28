/**
 * Small chart forms of the judge profile console: a rate dot plot with 95% intervals, 100% split bars and stacked
 * count bars. Colours come only from chart tokens; every chart sits in a ChartFrame that carries its data table.
 */
import { useWidth } from "@/components/charts/d3/charts";
import { chartTokens, seriesOn, seriesVar } from "@/components/charts/palette";
import { cn } from "@/lib/utils";
import { RULING_FADE_N, type RulingRow } from "./judgeConsoleView";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** One row per challenge group: this judge (dot and 95% interval) against all other attributed judges (grey dot). */
export function RulingDotPlot({
  rows,
  judgeLabel,
}: {
  rows: readonly RulingRow[];
  judgeLabel: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>(560);
  const labelW = Math.min(170, Math.max(110, w * 0.32));
  const right = 64;
  const rowH = 34;
  const top = 6;
  const axisH = 22;
  const h = top + rows.length * rowH + axisH;
  const x0 = labelW + 8;
  const x1 = Math.max(x0 + 60, w - right);
  const x = (v: number) => x0 + v * (x1 - x0);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div ref={ref} className="w-full" style={chartTokens}>
      <svg
        width={w}
        height={h}
        role="img"
        aria-label={`Share of expert challenges granted: ${judgeLabel} against all other judges`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={top}
              y2={h - axisH}
              style={{ stroke: "var(--chart-grid)" }}
            />
            <text
              x={x(t)}
              y={h - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[10.5px] tabular-nums"
            >
              {pct(t)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = top + i * rowH + rowH / 2;
          const faded = r.judge.n < RULING_FADE_N;
          const ci = r.judge.ci;
          return (
            <g key={r.id}>
              <text
                x={labelW}
                y={y}
                dy="0.32em"
                textAnchor="end"
                className="fill-foreground text-[11.5px]"
              >
                {r.label}
              </text>
              {r.others.shown && r.others.ci ? (
                <circle
                  cx={x(r.others.ci.p)}
                  cy={y}
                  r={4}
                  style={{ fill: "var(--chart-muted-mark)" }}
                >
                  <title>{`All other judges: ${pct(r.others.ci.p)} granted (${r.others.k} of ${r.others.n} decided)`}</title>
                </circle>
              ) : null}
              {r.judge.shown && ci ? (
                <g opacity={faded ? 0.72 : 1}>
                  <line
                    x1={x(ci.lo)}
                    x2={x(ci.hi)}
                    y1={y}
                    y2={y}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    style={{ stroke: seriesVar(0) }}
                  />
                  <line
                    x1={x(ci.lo)}
                    x2={x(ci.lo)}
                    y1={y - 4}
                    y2={y + 4}
                    strokeWidth={1.5}
                    style={{ stroke: seriesVar(0) }}
                  />
                  <line
                    x1={x(ci.hi)}
                    x2={x(ci.hi)}
                    y1={y - 4}
                    y2={y + 4}
                    strokeWidth={1.5}
                    style={{ stroke: seriesVar(0) }}
                  />
                  <circle
                    cx={x(ci.p)}
                    cy={y}
                    r={5.5}
                    strokeWidth={1.5}
                    style={{ fill: seriesVar(0), stroke: "var(--chart-surface)" }}
                  >
                    <title>{`${judgeLabel}: ${pct(ci.p)} granted (${r.judge.k} of ${r.judge.n} decided), 95% interval ${pct(ci.lo)} to ${pct(ci.hi)}`}</title>
                  </circle>
                </g>
              ) : (
                <text
                  x={x0 + 4}
                  y={y}
                  dy="0.32em"
                  className="fill-muted-foreground text-[11px] italic"
                >
                  {r.judge.n ? `Too few decided rulings (${r.judge.n})` : "None recorded"}
                </text>
              )}
              <text
                x={w - 4}
                y={y}
                dy="0.32em"
                textAnchor="end"
                className={cn(
                  "text-[11px] tabular-nums",
                  faded ? "fill-warning-foreground dark:fill-warning" : "fill-muted-foreground",
                )}
              >
                n={r.judge.n}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A bar part: categorical `slot` (0-based), or null for the neutral fill. */
export type BarPart = { id: string; value: number; slot: number | null; label: string };
const partFill = (p: BarPart) => (p.slot === null ? "var(--chart-other)" : seriesVar(p.slot));
const partInk = (p: BarPart) => (p.slot === null ? "var(--chart-ink)" : seriesOn(p.slot));

export type SplitRow = {
  id: string;
  label: string;
  parts: BarPart[];
  highlight?: boolean;
  note?: string;
};

/** 100% bars: each row splits into its parts; the share is written in a part when it fits. */
export function SplitBars({
  rows,
  labelWidth = "minmax(0,11rem)",
}: {
  rows: readonly SplitRow[];
  labelWidth?: string;
}) {
  return (
    <ul className="m-0 grid list-none gap-2 p-0" style={chartTokens}>
      {rows.map((r) => {
        const total = r.parts.reduce((s, p) => s + p.value, 0);
        return (
          <li
            key={r.id}
            className="grid items-center gap-x-3 gap-y-0.5 text-[12px]"
            style={{ gridTemplateColumns: `${labelWidth} minmax(0,1fr)` }}
          >
            <span
              className={cn(
                "min-w-0 truncate",
                r.highlight ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
              title={r.label}
            >
              {r.label}
            </span>
            <span
              className="flex h-5 min-w-0 overflow-hidden rounded-[3px] bg-muted"
              role="img"
              aria-label={`${r.label}: ${r.parts.map((p) => `${p.label} ${total ? Math.round((p.value / total) * 100) : 0}%`).join(", ")}`}
            >
              {r.parts.map((p) => {
                const share = total ? p.value / total : 0;
                return share > 0 ? (
                  <span
                    key={p.id}
                    className="flex h-full items-center justify-center overflow-hidden text-[10.5px] font-medium tabular-nums"
                    style={{ width: `${share * 100}%`, background: partFill(p), color: partInk(p) }}
                    title={`${p.label}: ${p.value.toLocaleString("en-US")} (${(share * 100).toFixed(1)}%)`}
                  >
                    {share >= 0.12 ? `${Math.round(share * 100)}%` : ""}
                  </span>
                ) : null;
              })}
            </span>
            {r.note ? (
              <span className="col-start-2 text-[10.5px] text-muted-foreground tabular-nums">
                {r.note}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export type StackRow = {
  id: string;
  label: string;
  parts: BarPart[];
  title?: string;
};

/** Horizontal stacked count bars on one shared scale, with the total at the right. */
export function StackBars({ rows, unit }: { rows: readonly StackRow[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((s, p) => s + p.value, 0)));
  return (
    <ul className="m-0 grid list-none gap-1.5 p-0" style={chartTokens}>
      {rows.map((r) => {
        const total = r.parts.reduce((s, p) => s + p.value, 0);
        return (
          <li
            key={r.id}
            className="grid grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-[12px]"
          >
            <span className="min-w-0 truncate text-foreground" title={r.title ?? r.label}>
              {r.label}
            </span>
            <span
              className="flex h-3.5 min-w-0 rounded-[2px]"
              role="img"
              aria-label={`${r.label}: ${r.parts
                .filter((p) => p.value)
                .map((p) => `${p.label} ${p.value.toLocaleString("en-US")}`)
                .join(", ")} ${unit}`}
            >
              {r.parts.map((p) =>
                p.value ? (
                  <span
                    key={p.id}
                    className="block h-full first:rounded-l-[2px] last:rounded-r-[2px]"
                    style={{ width: `${(p.value / max) * 100}%`, background: partFill(p) }}
                    title={`${p.label}: ${p.value.toLocaleString("en-US")} ${unit}`}
                  />
                ) : null,
              )}
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              {total.toLocaleString("en-US")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
